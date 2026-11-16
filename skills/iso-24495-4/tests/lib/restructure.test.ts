import { describe, expect, test } from "bun:test";
import {
  compareUnits,
  compareVersions,
  comparisonReport,
  documentUnits,
  formatComparison,
  type Comparison,
  type Unit,
} from "../../scripts/lib/restructure.ts";

/** The paths every printed comparison here names. */
const PATHS = { before: "old.md", after: "new.md", authorText: null };

/** The first line, the table header and divider, of every printed comparison with no author's wording. */
const HEAD = ["Restructure comparison: before `old.md`, after `new.md`", "| Kind | Before | After | Finding |", "|------|--------|-------|---------|"];

/** The closing statement of every printed comparison. */
const CLOSE = "The comparison reads wording, not meaning.";

/** The line of counts, from the counts in the order it prints them. */
function counts(kept: number, dropped: number, added: number, author: number, gaps: number, newHeadings: number, headingsGone: number, newLabels: number, labelsGone: number): string {
  return `Kept ${kept}. Dropped ${dropped}. Added ${added}. From the author ${author}. Marked gaps ${gaps}. `
    + `New headings ${newHeadings}. Headings gone ${headingsGone}. New labels ${newLabels}. Labels gone ${labelsGone}.`;
}

/** The printed comparison of two texts, with the author's wording when given. */
function printed(before: string, after: string, authorText: string | null = null): string[] {
  return formatComparison(compareVersions(before, after, authorText), PATHS).split("\n");
}

/** The keys of each unit of a text, with the kind of each. */
function keys(text: string): Array<[string, string]> {
  return documentUnits(text).map(unit => [unit.kind, unit.key]);
}

/** How a comparison sorted the units, by key. */
function sorted(comparison: Comparison): Record<string, string[]> {
  return {
    kept: comparison.kept.map(pair => pair.after.key),
    dropped: comparison.dropped.map(unit => unit.key),
    added: comparison.added.map(unit => unit.key),
    fromAuthor: comparison.fromAuthor.map(unit => unit.key),
    gaps: comparison.gaps.map(unit => unit.key),
    newHeadings: comparison.newHeadings.map(unit => unit.key),
    headingsGone: comparison.headingsGone.map(unit => unit.key),
    newLabels: comparison.newLabels.map(unit => unit.label ?? ""),
    labelsGone: comparison.labelsGone.map(unit => unit.label ?? ""),
  };
}

/** 10,000 sentence units, each text standing twice, on lines 1 to 10,000. */
function manyUnits(prefix: string): Unit[] {
  return Array.from({ length: 10_000 }, (unused, index) => ({ kind: "sentence", line: index + 1, key: `${prefix} ${index % 5_000}.`, block: index }));
}

/** The module the timed child processes read text with. */
const RESTRUCTURE_MODULE = new URL("../../scripts/lib/restructure.ts", import.meta.url).href;

/** How long a timed child process may run before it is stopped. Linear code needs a small part of it. */
const CHILD_LIMIT_MS = 30_000;

/**
 * Reads `text` once, and once more with every `[` and every `.` made a
 * space, and gives the time each read took and the units of the first.
 * The reads run in a child process, because a read that never returns cannot
 * be stopped in this one. The second text is as long, and is one sentence
 * with no slot opening, so a search repeated for each slot or each sentence
 * cannot slow it. It sets the pace of this machine for the comparison.
 */
function timedReads(text: string): { exitCode: number | null; slotsMs: number; plainMs: number; units: number } {
  const script = [
    `const { documentUnits } = await import(${JSON.stringify(RESTRUCTURE_MODULE)});`,
    "const text = await Bun.stdin.text();",
    "const plain = text.replace(/[[.]/g, \" \");",
    "let started = performance.now();",
    "const units = documentUnits(text).length;",
    "const slotsMs = performance.now() - started;",
    "started = performance.now();",
    "documentUnits(plain);",
    "const plainMs = performance.now() - started;",
    "console.log(JSON.stringify({ slotsMs, plainMs, units }));",
  ].join("\n");
  const run = Bun.spawnSync([process.execPath, "-e", script], { stdin: Buffer.from(text), timeout: CHILD_LIMIT_MS });
  if (run.exitCode !== 0) return { exitCode: run.exitCode, slotsMs: Number.NaN, plainMs: Number.NaN, units: Number.NaN };
  return { exitCode: 0, ...(JSON.parse(run.stdout.toString()) as { slotsMs: number; plainMs: number; units: number }) };
}

/**
 * The longest a read of slot openings may take: 10 times the read of the
 * same text with no openings and no full stops, or one second, whichever is
 * longer.
 */
function slotBudget(plainMs: number): number {
  return Math.max(1_000, 10 * plainMs);
}

/** A comparison's sorting with every list empty but those given. */
function only(lists: Partial<Record<string, string[]>>): Record<string, string[]> {
  return { kept: [], dropped: [], added: [], fromAuthor: [], gaps: [], newHeadings: [], headingsGone: [], newLabels: [], labelsGone: [], ...lists };
}

// Part 5's own worked examples of a restructure, from the output style.
// Each is a restructure the skill permits, so none may read as a fault.

const EXAMPLE_15_BEFORE = "# Deployment guide\n\nThis guide covers deploying the application to production. Last updated\nMarch 2026.\n\n## Prerequisites\n";
const EXAMPLE_15_AFTER = "# Deployment guide\n\n- **Purpose:** This guide covers deploying the application to production.\n- **Date:** Last updated March 2026.\n"
  + "- **Reader:** [Author needed: reader]\n- **Other guides:** [Author needed: referral, or confirm that none exists]\n\n## Prerequisites\n";
const EXAMPLE_16_BEFORE = "# Migration plan\n\n## Step 1: Back up the database\n\nRun the backup.\n\n## Step 9: Summary\n"
  + "The migration moves the billing database to PostgreSQL 16 and takes the\napplication offline for up to 30 minutes.\n";
const EXAMPLE_16_AFTER = "# Migration plan\n\n## Overview\nThe migration moves the billing database to PostgreSQL 16 and takes the\n"
  + "application offline for up to 30 minutes.\n\n## Step 1: Back up the database\n\nRun the backup.\n";
const EXAMPLE_17_BEFORE = "To restore a backup, stop the service, then copy the backup file into the\ndata directory. If the copy fails, check the disk space. Otherwise, start\nthe service.\n";
const EXAMPLE_17_AFTER = "To restore a backup, stop the service, then copy the backup file into the\ndata directory.\n\n- **If the copy fails**, check the disk space.\n- **Otherwise**, start the service.\n";

describe("Part 5's own examples of a restructure read as kept", () => {
  test("example 15: an opening block of labelled fields keeps both sentences and lists the two slots as gaps", () => {
    expect(printed(EXAMPLE_15_BEFORE, EXAMPLE_15_AFTER)).toEqual([
      ...HEAD,
      "| marked gap | | 5 | A slot left for the author: \"Reader: [Author needed: reader]\" |",
      "| marked gap | | 6 | A slot left for the author: \"Other guides: [Author needed: referral, or confirm that none...\" |",
      counts(4, 0, 0, 0, 2, 0, 0, 4, 0),
      CLOSE,
    ]);
  });

  test("example 16: a conclusion moved under a new overview heading, with the summary heading gone", () => {
    expect(printed(EXAMPLE_16_BEFORE, EXAMPLE_16_AFTER)).toEqual([...HEAD, counts(4, 0, 0, 0, 0, 1, 1, 0, 0), CLOSE]);
  });

  test("example 17: a fork turned into labelled conditions", () => {
    expect(printed(EXAMPLE_17_BEFORE, EXAMPLE_17_AFTER)).toEqual([...HEAD, counts(3, 0, 0, 0, 0, 0, 0, 0, 0), CLOSE]);
  });

  test("the plans example adds a lead-in and turns a sentence into a table, which reads as a drop and one grouped row", () => {
    const before = "The Basic plan costs £5 per month and includes 10 GB of storage but no\npriority support.\n";
    const after = "Choose a plan:\n\n| Plan | Price |\n|---|---|\n| Basic | £5 |\n";
    expect(printed(before, after)).toEqual([
      ...HEAD,
      "| dropped | 1 | | No unchanged copy is in the new version: \"The Basic plan costs £5 per month and includes 10 GB of stor...\" |",
      "| added | | 1 | Not in the original or the author's wording. Confirm its source: \"Choose a plan:\" |",
      "| added | | 3 | 4 units in one new table are not in the original or the author's wording. Confirm their source: \"Plan\" |",
      counts(0, 1, 5, 0, 0, 0, 0, 0, 0),
      CLOSE,
    ]);
  });
});

describe("a unit's text is its wording as a reader sees it", () => {
  test("a reflowed line, emphasis, a list marker and a reference link in place of an inline one all keep the unit", () => {
    const before = "Read the *guide* at [the site](https://x.org) before\nyou start. Then `run` it.\n";
    const after = "Read the **guide** at [the site][s] before you start.\n\n1. Then `run` it.\n\n[s]: https://x.org\n";
    expect(sorted(compareVersions(before, after, null))).toEqual(only({ kept: ["Read the guide at the site before you start.", "Then run it."] }));
  });

  test("an escape, a character reference and an HTML tag read as the text they show", () => {
    expect(keys("A \\*star\\* and &amp; and <b>bold</b> text.\n")).toEqual([["sentence", "A *star* and & and bold text."]]);
  });

  test("a hard line break, by a backslash, two spaces or a tag, keeps the unit and shows no backslash", () => {
    for (const after of ["Read the\\\nguide.\n", "Read the  \nguide.\n", "Read the<br>guide.\n", "Read the\\\r\nguide.\r\n", "- Read the\\\n  guide.\n"]) {
      expect(sorted(compareVersions("Read the guide.\n", after, null)), after).toEqual(only({ kept: ["Read the guide."] }));
    }
    expect(documentUnits("One.\n\nRead the\\\nguide.\n")[1]?.line).toBe(3);
    // A backslash that is itself escaped, or that ends the paragraph, is a character a reader sees.
    expect(keys("Read the\\\\\nguide.\n")).toEqual([["sentence", "Read the\\ guide."]]);
    expect(keys("Read the guide.\\\n")).toEqual([["sentence", "Read the guide.\\"]]);
  });

  test("struck wording is still wording a reader sees, so a strike added or removed keeps the unit", () => {
    expect(sorted(compareVersions("Close the valve.\n", "Close the ~~valve~~.\n", null))).toEqual(only({ kept: ["Close the valve."] }));
    expect(sorted(compareVersions("Close the ~~old~~ valve.\n", "Close the old valve.\n", null))).toEqual(only({ kept: ["Close the old valve."] }));
    // One tilde, three tildes and an unpaired pair are not a strike, and stay in the text.
    expect(keys("Use ~one~ and ~~~three~~~ and ~~open.\n")).toEqual([["sentence", "Use ~one~ and ~~~three~~~ and ~~open."]]);
  });

  test("a hard line break inside a heading underlined on the next line is read as a backslash, and only counted", () => {
    // A known limit: the parser joins the lines of such a heading with a space before the comparison reads it.
    expect(sorted(compareVersions("Read the guide.\n===\n", "Read the\\\nguide.\n===\n", null))).toEqual(only({ newHeadings: ["Read the\\ guide."], headingsGone: ["Read the guide."] }));
  });

  test("a sentence moved into a list item, a table cell, a heading or a quotation is still kept", () => {
    const before = "Close the valve. Open the vent. Check the gauge. Call the team.\n";
    const after = "- Close the valve.\n\n| Step |\n|---|\n| Open the vent. |\n\n## Check the gauge.\n\n> Call the team.\n";
    // The header cell "Step" is wording the original never held.
    expect(sorted(compareVersions(before, after, null))).toEqual(only({ kept: ["Close the valve.", "Open the vent.", "Check the gauge.", "Call the team."], added: ["Step"] }));
  });

  test("a sentence ending in an abbreviation, or holding a title, keeps its boundaries in its own list item", () => {
    const before = "Pack the tools, cables etc. The van leaves at noon. Meet Dr. Smith there.\n";
    const after = "- Pack the tools, cables etc.\n- The van leaves at noon.\n- Meet Dr. Smith there.\n";
    expect(sorted(compareVersions(before, after, null)).kept).toEqual(["Pack the tools, cables etc.", "The van leaves at noon.", "Meet Dr. Smith there."]);
  });

  test("case, punctuation, a number and a negation each change the unit", () => {
    for (const changed of ["close the valve.", "Close the valve!", "Close valve 2.", "Do not close the valve."]) {
      expect(sorted(compareVersions("Close the valve.\n", `${changed}\n`, null)), changed).toEqual(only({ dropped: ["Close the valve."], added: [changed] }));
    }
  });

  test("a changed link destination or image source keeps the unit, because only the wording is read", () => {
    expect(sorted(compareVersions("Read [the guide](a.md). ![Chart](a.png)\n", "Read [the guide](b.md). ![Chart](b.png)\n", null)))
      .toEqual(only({ kept: ["Chart", "Read the guide."] }));
  });

  test("a code block's contents are kept exactly, and any change to them drops it", () => {
    expect(sorted(compareVersions("```\ncode  here\n```\n", "    code  here\n", null))).toEqual(only({ kept: ["code  here"] }));
    expect(sorted(compareVersions("```\ncode  here\n```\n", "```\ncode here\n```\n", null))).toEqual(only({ dropped: ["code  here"], added: ["code here"] }));
    expect(keys("```\n```\n")).toEqual([]);
  });

  test("a tab inside a code block is kept as a tab, and only the columns its block takes off become spaces", () => {
    // Three spaces in place of a tab show differently in a code block, so the unit is not kept.
    expect(sorted(compareVersions("```\nx\ty\n```\n", "```\nx   y\n```\n", null))).toEqual(only({ dropped: ["x\ty"], added: ["x   y"] }));
    expect(keys("```\nx\ty\n```\n")).toEqual([["code", "x\ty"]]);
    // Indented code takes four columns off. A leading tab is those four, so a second tab stays.
    expect(keys("\tcode\tmore\n")).toEqual([["code", "code\tmore"]]);
    expect(keys("\t\tdeep\n")).toEqual([["code", "\tdeep"]]);
    expect(keys("  \tcode\n")).toEqual([["code", "code"]]);
    // A fence two columns in takes two columns off a tab, and the other two stay as spaces.
    expect(keys("  ```\n\tx\n  ```\n")).toEqual([["code", "  x"]]);
    // In a list item or a quotation, the container's columns come off first.
    expect(keys("- item\n\n  ```\n  a\tb\n  ```\n")).toEqual([["item", "item"], ["code", "a\tb"]]);
    expect(keys("> ```\n> a\tb\n> ```\n")).toEqual([["code", "a\tb"]]);
    expect(keys("> ```\n>\tx\n> ```\n")).toEqual([["code", "  x"]]);
    // A character past the basic plane before a tab is copied with the tab after it. The columns taken
    // off are only markers and spaces, so how such a character is counted cannot move where the cut falls.
    expect(keys("    \u{1F600}\tx\n")).toEqual([["code", "\u{1F600}\tx"]]);
  });

  test("an image's alternative text is a unit of its own, taken out of its sentence", () => {
    expect(keys("See ![A chart of sales](c.png) below.\n")).toEqual([["alternative", "A chart of sales"], ["sentence", "See below."]]);
    expect(keys("![Only](o.png)\n")).toEqual([["alternative", "Only"]]);
    expect(keys("![](empty.png)\n")).toEqual([]);
    expect(keys("![A *bold* claim](c.png)\n")).toEqual([["alternative", "A bold claim"]]);
  });

  test("a reference image counts when the document defines its label, and an image inside another's text goes with it", () => {
    expect(keys("![Chart][c] ![Pie][] ![Bar]\n\n[c]: c.png\n[pie]: p.png\n[bar]: b.png\n")).toEqual([["alternative", "Chart"], ["alternative", "Pie"], ["alternative", "Bar"]]);
    expect(keys("![Chart][none] stays.\n")).toEqual([["sentence", "![Chart][none] stays."]]);
    expect(keys("[![Badge](b.svg)](https://x.org) Text.\n")).toEqual([["alternative", "Badge"], ["sentence", "Text."]]);
    expect(keys("![Outer ![inner](i.png)](o.png) Done.\n")).toEqual([["alternative", "Outer inner"], ["sentence", "Done."]]);
  });

  test("an image on a later line of a paragraph is placed on that line", () => {
    expect(documentUnits("First line\nand ![Late](l.png) here.\n").map(unit => [unit.kind, unit.line])).toEqual([["sentence", 1], ["alternative", 2]]);
  });

  test("each cell of a table's header and body is a unit, and an empty cell is none", () => {
    expect(keys("| A | B |\n|---|---|\n| one. Two | |\n")).toEqual([["cell", "A"], ["cell", "B"], ["cell", "one."], ["cell", "Two"]]);
    expect(keys("| A \\| B |\n|---|\n")).toEqual([["cell", "A | B"]]);
  });

  test("front matter is not read unless it is read as text", () => {
    const text = "---\ntitle: The guide.\n---\n\nBody.\n";
    expect(keys(text)).toEqual([["sentence", "Body."]]);
    expect(documentUnits(text, { frontMatter: false }).map(unit => unit.key)).toContain("Body.");
    expect(documentUnits(text, { frontMatter: false }).length).toBeGreaterThan(1);
  });

  test("prose straight after a raw HTML code block is read, and the block itself is not", () => {
    expect(keys("<pre>\ncode\n</pre>\nThe prose stays.\n")).toEqual([["sentence", "The prose stays."]]);
  });

  test("each unit is placed on the line it starts on, and units of one list or table share a block", () => {
    const units = documentUnits("# Title\n\nOne. Two\nthree.\n\n- A\n- B\n\n| X |\n|---|\n| Y |\n\n```\nc\n```\n");
    expect(units.map(unit => [unit.kind, unit.line, unit.key])).toEqual([
      ["heading", 1, "Title"], ["sentence", 3, "One."], ["sentence", 3, "Two three."], ["item", 6, "A"], ["item", 7, "B"],
      ["cell", 9, "X"], ["cell", 11, "Y"], ["code", 13, "c"],
    ]);
    const blocks = new Map(units.map(unit => [unit.key, unit.block]));
    expect([blocks.get("A") === blocks.get("B"), blocks.get("X") === blocks.get("Y"), blocks.get("One.") === blocks.get("A"), blocks.get("Title") === blocks.get("c")])
      .toEqual([true, true, false, false]);
  });
});

describe("matching counts each text as often as it occurs", () => {
  test("a passage that stood twice and stands once is dropped once", () => {
    expect(printed("Close the valve.\n\nClose the valve.\n", "Close the valve.\n")).toEqual([
      ...HEAD, "| dropped | 3 | | No unchanged copy is in the new version: \"Close the valve.\" |", counts(1, 1, 0, 0, 0, 0, 0, 0, 0), CLOSE,
    ]);
  });

  test("a passage that stood once and stands twice is added once", () => {
    expect(sorted(compareVersions("Close the valve.\n", "Close the valve.\n\nClose the valve.\n", null))).toEqual(only({ kept: ["Close the valve."], added: ["Close the valve."] }));
  });

  test("occurrences pair in document order, and the kept pairs are in before order", () => {
    const comparison = compareVersions("A one.\n\nB two.\n\nA one.\n", "B two.\n\nA one.\n", null);
    expect(comparison.kept.map(pair => [pair.before.line, pair.after.line])).toEqual([[1, 3], [3, 1]]);
    expect(comparison.dropped.map(unit => unit.line)).toEqual([5]);
  });
});

describe("a bold label is read only when the whole unit has no match", () => {
  test("a label gained, lost or changed keeps the sentence and counts the label", () => {
    expect(sorted(compareVersions("Fix the pump.\n", "- **Purpose:** Fix the pump.\n", null))).toEqual(only({ kept: ["Purpose: Fix the pump."], newLabels: ["Purpose:"] }));
    expect(sorted(compareVersions("- **Purpose:** Fix the pump.\n", "Fix the pump.\n", null))).toEqual(only({ kept: ["Fix the pump."], labelsGone: ["Purpose:"] }));
    expect(sorted(compareVersions("**Aim:** Fix the pump.\n", "**Purpose**: Fix the pump.\n", null))).toEqual(only({ kept: ["Purpose: Fix the pump."], newLabels: ["Purpose:"], labelsGone: ["Aim:"] }));
  });

  // Found in this repository's history: Part 3's example changed the label
  // "Concurrency Control:", on a line of its own, to "System Purpose:".
  test("a label on a line of its own, above its sentence, is read as a label", () => {
    const before = "> **Concurrency Control:**\n> Acquire a lock before you write.\n";
    const after = "> **System Purpose:**\n> Acquire a lock before you write.\n";
    expect(sorted(compareVersions(before, after, null))).toEqual(only({
      kept: ["System Purpose: Acquire a lock before you write."], newLabels: ["System Purpose:"], labelsGone: ["Concurrency Control:"],
    }));
  });

  test("the same label in plain text and in bold matches whole, so no label is counted", () => {
    expect(sorted(compareVersions("Purpose: Fix the pump.\n", "**Purpose:** Fix the pump.\n", null))).toEqual(only({ kept: ["Purpose: Fix the pump."] }));
  });

  test("bold text that ends in no colon, or stands alone, is no label", () => {
    expect(documentUnits("**If the copy fails**, check the disk.\n")[0]?.label).toBeUndefined();
    expect(documentUnits("**Note** Check the disk.\n")[0]?.label).toBeUndefined();
    expect(documentUnits("**Purpose:**\n")[0]?.label).toBeUndefined();
    expect(documentUnits("__Date__: Today.\n")[0]?.label).toBe("Date:");
    expect(documentUnits("**The *Purpose*:** Fix it. More.\n").map(unit => unit.label ?? null)).toEqual(["The Purpose:", null]);
  });

  test("a label's sentence that is the label alone takes no label", () => {
    expect(documentUnits("**Purpose:** Fix. it\n").map(unit => [unit.key, unit.label])).toEqual([["Purpose: Fix.", "Purpose:"], ["it", undefined]]);
    expect(documentUnits("**A:** B\n")[0]?.label).toBe("A:");
  });
});

describe("an after unit left over is a gap, a heading, the author's or added", () => {
  test("a unit that is one slot, after any label, is a marked gap", () => {
    expect(sorted(compareVersions("Fix it.\n", "Fix it.\n\n[Author needed: purpose]\n\n- **Reader:** [Author needed: reader]\n", null)))
      .toEqual(only({ kept: ["Fix it."], gaps: ["[Author needed: purpose]", "Reader: [Author needed: reader]"], newLabels: ["Reader:"] }));
  });

  test("a slot whose instructions hold a full stop, a question mark or an exclamation mark is still one slot", () => {
    expect(sorted(compareVersions("", "[Author needed: reader. Confirm role]\n", null))).toEqual(only({ gaps: ["[Author needed: reader. Confirm role]"] }));
    expect(sorted(compareVersions("Fix it.\n", "Fix it.\n\n[Author needed: who reads it? Confirm]\n\n[Author needed: check! Then confirm]\n", null)))
      .toEqual(only({ kept: ["Fix it."], gaps: ["[Author needed: who reads it? Confirm]", "[Author needed: check! Then confirm]"] }));
    expect(sorted(compareVersions("", "- **Reader:** [Author needed: reader. Confirm role]\n", null)))
      .toEqual(only({ gaps: ["Reader: [Author needed: reader. Confirm role]"], newLabels: ["Reader:"] }));
    // In a heading, a list item and a table cell too.
    expect(sorted(compareVersions("", "## [Author needed: title. Keep it short]\n\n- [Author needed: step. One verb]\n\n| [Author needed: field. Name it] |\n|---|\n", null)))
      .toEqual(only({ gaps: ["[Author needed: title. Keep it short]", "[Author needed: step. One verb]", "[Author needed: field. Name it]"] }));
    // A sentence before the slot is its own unit, and the slot is still a gap.
    expect(sorted(compareVersions("Then go.\n", "Then go. [Author needed: x. y]\n", null))).toEqual(only({ kept: ["Then go."], gaps: ["[Author needed: x. y]"] }));
  });

  test("a slot with a full stop inside it does not hide the wording after it, and two such slots are not one", () => {
    expect(sorted(compareVersions("", "[Author needed: reader. Confirm role] Then go.\n\n[Author needed: a. b] [Author needed: c. d]\n", null)))
      .toEqual(only({ added: ["[Author needed: reader. Confirm role] Then go.", "[Author needed: a. b] [Author needed: c. d]"] }));
    expect(keys("[Author needed: a.] [Author needed: b.]\n")).toEqual([["sentence", "[Author needed: a.]"], ["sentence", "[Author needed: b.]"]]);
  });

  test("a slot runs from its opening to the first closing bracket after it, and an opening with none after it is no slot", () => {
    // A bracket before any opening, an opening inside a slot, a character past the basic plane, and an opening left open at the end.
    expect(keys("Go. ] [Author needed: a [Author needed: b. c] Then. 😀 [Author needed: d. e] Done. [Author needed: f. g")).toEqual([
      ["sentence", "Go."],
      ["sentence", "] [Author needed: a [Author needed: b. c] Then."],
      ["sentence", "😀 [Author needed: d. e] Done."],
      ["sentence", "[Author needed: f."],
      ["sentence", "g"],
    ]);
    expect(keys("[Author needed:] x. [Author needed: [Author needed: y. z]] End. [Author needed:")).toEqual([
      ["sentence", "[Author needed:] x."],
      ["sentence", "[Author needed: [Author needed: y. z]] End."],
      ["sentence", "[Author needed:"],
    ]);
  });

  test("a slot inside invented wording does not hide it, and two slots are not one", () => {
    expect(sorted(compareVersions("Fix it.\n", "Fix it.\n\nThe reader is [Author needed: reader] today.\n\n[Author needed: a] [Author needed: b]\n", null)))
      .toEqual(only({ kept: ["Fix it."], added: ["The reader is [Author needed: reader] today.", "[Author needed: a] [Author needed: b]"] }));
  });

  test("a new heading and a heading gone are counted, and neither is dropped or added", () => {
    expect(sorted(compareVersions("## Old name\n\nText.\n", "## New name\n\nText.\n", null))).toEqual(only({ kept: ["Text."], newHeadings: ["New name"], headingsGone: ["Old name"] }));
  });

  test("a heading of two sentences is one new heading, or one heading gone, and not two", () => {
    const one = "# Old\n\nKeep this text.\n";
    const two = "# Old\n\n# One. Two.\n\nKeep this text.\n";
    expect(sorted(compareVersions(one, two, null))).toEqual(only({ kept: ["Old", "Keep this text."], newHeadings: ["One. Two."] }));
    expect(sorted(compareVersions(two, one, null))).toEqual(only({ kept: ["Old", "Keep this text."], headingsGone: ["One. Two."] }));
    expect(printed(one, two).at(-2)).toBe(counts(2, 0, 0, 0, 0, 1, 0, 0, 0));
    expect(printed(two, one).at(-2)).toBe(counts(2, 0, 0, 0, 0, 0, 1, 0, 0));
  });

  test("two new headings of two sentences each are two new headings, each on its own line", () => {
    // Words, not letters: "A. B." reads as initials, which no sentence boundary splits.
    const comparison = compareVersions("Text.\n", "## Fill it. Seal it.\n\nText.\n\n## Test it. Ship it.\n", null);
    expect(comparison.newHeadings.map(unit => [unit.line, unit.key])).toEqual([[1, "Fill it. Seal it."], [5, "Test it. Ship it."]]);
  });

  test("a heading that keeps one of its sentences is counted by the sentences it does not keep", () => {
    // Each sentence is still matched alone, so a sentence moved into a heading is kept.
    expect(sorted(compareVersions("Close the valve.\n", "## Close the valve. Then wait. Then go.\n", null))).toEqual(only({ kept: ["Close the valve."], newHeadings: ["Then wait. Then go."] }));
  });

  test("a unit matching the author's wording, whole or after its label, is from the author, once for each unit of it", () => {
    const author = "Readers are maintainers.\n\nThe pump is new.\n";
    const after = "Fix it.\n\nReaders are maintainers.\n\nReaders are maintainers.\n\n- **Note:** The pump is new.\n";
    expect(sorted(compareVersions("Fix it.\n", after, author))).toEqual(only({
      kept: ["Fix it."], fromAuthor: ["Readers are maintainers.", "Note: The pump is new."], added: ["Readers are maintainers."], newLabels: ["Note:"],
    }));
  });

  test("a heading in the author's wording is still a new heading", () => {
    expect(sorted(compareVersions("Text.\n", "## Overview\n\nText.\n", "Overview\n"))).toEqual(only({ kept: ["Text."], newHeadings: ["Overview"] }));
  });
});

describe("the printed comparison", () => {
  test("lists each dropped unit, then the after units left over by line, with the author's wording named", () => {
    const before = "Keep this. Drop this.\n";
    const after = "Keep this.\n\n- **Note:** From the author.\n- [Author needed: date]\n\nInvented here.\n";
    expect(formatComparison(compareVersions(before, after, "From the author.\n"), { ...PATHS, authorText: "notes.md" }).split("\n")).toEqual([
      "Restructure comparison: before `old.md`, after `new.md`, author's wording `notes.md`",
      ...HEAD.slice(1),
      "| dropped | 1 | | No unchanged copy is in the new version: \"Drop this.\" |",
      "| from the author | | 3 | Matches the author's wording: \"Note: From the author.\" |",
      "| marked gap | | 4 | A slot left for the author: \"[Author needed: date]\" |",
      "| added | | 6 | Not in the original or the author's wording. Confirm its source: \"Invented here.\" |",
      counts(1, 1, 1, 1, 1, 0, 0, 1, 0),
      CLOSE,
    ]);
  });

  test("added items of a new list share one row, and a list that keeps a unit lists each added item", () => {
    expect(printed("Keep.\n", "Keep.\n\n- One.\n- Two.\n- Three.\n").slice(3, -2)).toEqual([
      "| added | | 3 | 3 units in one new list are not in the original or the author's wording. Confirm their source: \"One.\" |",
    ]);
    expect(printed("Keep.\n", "- Keep.\n- One.\n- Two.\n").slice(3, -2)).toEqual([
      "| added | | 2 | Not in the original or the author's wording. Confirm its source: \"One.\" |",
      "| added | | 3 | Not in the original or the author's wording. Confirm its source: \"Two.\" |",
    ]);
    expect(printed("Keep.\n", "Keep.\n\n- One.\n").slice(3, -2)).toEqual([
      "| added | | 3 | Not in the original or the author's wording. Confirm its source: \"One.\" |",
    ]);
  });

  test("a shared row counts units, so two items of two sentences each are 4 units, and the rows add up to the count of added units", () => {
    expect(printed("", "- First sentence. Second sentence.\n- Third sentence. Fourth sentence.\n").slice(3)).toEqual([
      "| added | | 1 | 4 units in one new list are not in the original or the author's wording. Confirm their source: \"First sentence.\" |",
      counts(0, 0, 4, 0, 0, 0, 0, 0, 0),
      CLOSE,
    ]);
    expect(printed("", "| Header |\n|---|\n| First sentence. Second sentence. |\n").slice(3)).toEqual([
      "| added | | 1 | 3 units in one new table are not in the original or the author's wording. Confirm their source: \"Header\" |",
      counts(0, 0, 3, 0, 0, 0, 0, 0, 0),
      CLOSE,
    ]);
    for (const text of ["items in one new list", "cells in one new table"]) {
      expect(printed("", "- One. Two.\n- Three.\n\n| A | B |\n|---|---|\n| C. D. | E |\n").join("\n")).not.toContain(text);
    }
  });

  test("a quoted unit is cut at 60 characters and made safe for a table cell, and a path is a code span", () => {
    const long = `${"word ".repeat(15)}end.`;
    const rows = formatComparison(compareVersions("Keep.\n", `Keep.\n\n${long}\n\nA | pipe.\n`, null), { before: "a`b.md", after: "new.md", authorText: null }).split("\n");
    expect(rows[0]).toBe("Restructure comparison: before ``a`b.md``, after `new.md`");
    expect(rows[3]).toBe(`| added | | 3 | Not in the original or the author's wording. Confirm its source: "${long.slice(0, 60).trimEnd()}..." |`);
    expect(rows[4]).toBe("| added | | 5 | Not in the original or the author's wording. Confirm its source: \"A \\| pipe.\" |");
    const sixty = `${"x".repeat(59)}.`;
    expect(printed("", `${sixty}\n`)[3]).toBe(`| added | | 1 | Not in the original or the author's wording. Confirm its source: "${sixty}" |`);
  });
});

describe("the JSON report", () => {
  test("holds the paths, the unit counts, the kept count and a list for every other kind", () => {
    const comparison = compareVersions("## Old\n\n**Aim:** Keep. Drop.\n", "## New\n\n- **Goal:** Keep.\n- [Author needed: x]\n- From me.\n- Added.\n", "From me.\n");
    expect(comparisonReport(comparison, { before: "old.md", after: "new.md", authorText: "me.md" })).toEqual({
      before: "old.md", after: "new.md", authorText: "me.md",
      units: { before: 3, after: 5, authorText: 1 },
      kept: 1,
      dropped: [{ line: 3, kind: "sentence", excerpt: "Drop." }],
      added: [{ line: 6, kind: "item", excerpt: "Added." }],
      fromAuthor: [{ line: 5, kind: "item", excerpt: "From me." }],
      gaps: [{ line: 4, kind: "item", excerpt: "[Author needed: x]" }],
      newHeadings: [{ line: 1, kind: "heading", excerpt: "New" }],
      headingsGone: [{ line: 1, kind: "heading", excerpt: "Old" }],
      newLabels: [{ line: 3, kind: "item", excerpt: "Goal:" }],
      labelsGone: [{ line: 3, kind: "sentence", excerpt: "Aim:" }],
    });
  });

  test("a heading of two sentences is one entry, holding both", () => {
    const report = comparisonReport(compareVersions("# Old\n\nKeep this text.\n", "# Old\n\n# One. Two.\n\nKeep this text.\n", null), PATHS);
    expect(report.newHeadings).toEqual([{ line: 3, kind: "heading", excerpt: "One. Two." }]);
    expect(comparisonReport(compareVersions("# One. Two.\n", "", null), PATHS).headingsGone).toEqual([{ line: 1, kind: "heading", excerpt: "One. Two." }]);
  });

  test("an excerpt is the first 60 characters, uncleaned", () => {
    const long = `A|${"x".repeat(80)}.`;
    expect(comparisonReport(compareVersions("", `${long}\n`, null), PATHS).added[0]?.excerpt).toBe(long.slice(0, 60));
  });
});

describe("matching takes time in proportion to the units", () => {
  test("10,000 units on each side compare within a fixed budget", () => {
    const start = performance.now();
    const comparison = compareUnits(manyUnits("same"), [...manyUnits("same")].reverse(), manyUnits("author"));
    expect(performance.now() - start).toBeLessThan(2_000);
    expect(comparison.kept).toHaveLength(10_000);
  });

  test("a paragraph of 50,000 slots, each with a full stop inside, is read within a fixed budget", () => {
    // Checking every slot for every sentence took 25 seconds here.
    const start = performance.now();
    const units = documentUnits("[Author needed: a. b] Then go. ".repeat(50_000));
    expect(performance.now() - start).toBeLessThan(5_000);
    // A slot and the wording after it, with no full stop between them, are one unit.
    expect(units).toHaveLength(50_000);
    expect(units[49_999]?.key).toBe("[Author needed: a. b] Then go.");
  });

  // Searching again for a closing bracket from every opening read the rest of
  // the text each time: 30,000 openings with none closed took 4.4 seconds.
  // Each text is made inside its test, so no test after these holds it.
  const openingForms: Array<[string, () => string, number]> = [
    ["100,000 slot openings with no closing bracket", () => "[Author needed: ".repeat(100_000), 1],
    ["300,000 slot openings with no closing bracket", () => "[Author needed: ".repeat(300_000), 1],
    ["100,000 slot openings, each followed by a full stop", () => "[Author needed: . ".repeat(100_000), 100_000],
    ["one slot opening followed by 300,000 full stops", () => `[Author needed: ${". ".repeat(300_000)}`, 300_000],
  ];
  for (const [name, makeText, expectedUnits] of openingForms) {
    test(`${name} are read in time proportional to the text`, () => {
      const timed = timedReads(makeText());
      expect(timed.exitCode, `the read was stopped after ${CHILD_LIMIT_MS} ms, or failed`).toBe(0);
      expect(timed.slotsMs, `${timed.plainMs} ms with no openings and no full stops`).toBeLessThan(slotBudget(timed.plainMs));
      expect(timed.units).toBe(expectedUnits);
    }, 2 * CHILD_LIMIT_MS);
  }
});
