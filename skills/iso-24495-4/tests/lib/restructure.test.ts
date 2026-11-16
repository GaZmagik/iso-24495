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

/** The closing statements of every printed comparison: what it reads, and what it does not compare yet. */
const TAIL = [
  "The comparison reads wording, not meaning.",
  "It does not yet pair a reworded unit with its original, or check that each number and code span is still there.",
];

/**
 * The line of counts, from the counts in the order it prints them. The kept
 * units moved and the steps out of order are among those kept.
 */
function counts(kept: number, dropped: number, added: number, author: number, gaps: number, newHeadings: number, headingsGone: number, newLabels: number, labelsGone: number, moved = 0, steps = 0): string {
  return `Kept ${kept}: moved ${moved}, steps out of order ${steps}. `
    + `Dropped ${dropped}. Added ${added}. From the author ${author}. Marked gaps ${gaps}. `
    + `New headings ${newHeadings}. Headings gone ${headingsGone}. New labels ${newLabels}. Labels gone ${labelsGone}.`;
}

/** The printed comparison of two texts, with the author's wording when given. */
function printed(before: string, after: string, authorText: string | null = null): string[] {
  return formatComparison(compareVersions(before, after, authorText), PATHS).split("\n");
}

/** What a row says of one unit kept but moved, before the unit's excerpt. */
const MOVED_ONE = "Kept, but moved out of its original order. Check that it keeps what it depends on and the claim it qualifies:";

/** What a row says of a step out of order, before the unit's excerpt. */
const STEP_ONE = "A step of an ordered list now stands in another order against its neighbouring steps. Put it back, or confirm the steps can happen in this order:";

/** A unit's text as a row quotes it: its first 60 characters, in double quotes, with "..." where it was cut. */
function excerpt(text: string): string {
  const characters = Array.from(text);
  return characters.length > 60 ? `"${characters.slice(0, 60).join("").trimEnd()}..."` : `"${text}"`;
}

/** The keys of the kept units a comparison lists as moved, and of those it lists as steps out of order. */
function order(comparison: Comparison): { moved: string[]; stepOrder: string[] } {
  return { moved: comparison.moved.map(pair => pair.after.key), stepOrder: comparison.stepOrder.map(pair => pair.after.key) };
}

/** No kept unit moved, and no step out of order. */
const IN_ORDER = { moved: [], stepOrder: [] };

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

/** Sentence units of the given texts in order, one to a line and a block. */
function sentenceUnits(texts: readonly string[]): Unit[] {
  return texts.map((key, index) => ({ kind: "sentence", line: index + 1, key, block: index }));
}

/** `count` copies of one text. */
function copiesOf(text: string, count: number): string[] {
  return Array.from({ length: count }, () => text);
}

/** A source of numbers from 0 to 1 that gives the same run for the same seed, so a random test is the same test each time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The items in a random order drawn from `random`. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    const held = result[index] as T;
    result[index] = result[other] as T;
    result[other] = held;
  }
  return result;
}

/** The length of the longest strictly increasing run of values, read in order, found by comparing every pair: small inputs only. */
function longestIncreasingLength(values: readonly number[]): number {
  const lengths = values.map(() => 1);
  for (let index = 0; index < values.length; index++) {
    for (let earlier = 0; earlier < index; earlier++) {
      if ((values[earlier] ?? 0) < (values[index] ?? 0)) lengths[index] = Math.max(lengths[index] ?? 1, (lengths[earlier] ?? 1) + 1);
    }
  }
  return Math.max(0, ...lengths);
}

/** Whether values rise strictly, read in order. */
function isIncreasing(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || (values[index - 1] ?? 0) < value);
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

/**
 * Compares two versions in a child process, then compares the first with a
 * version of the same size that shares no unit with it, and prints and
 * reports both. Gives the time each took and what the first found. The
 * second keeps nothing, so no work on the order of kept units can slow it,
 * and it prints a row for every unit. It sets the pace of this machine.
 *
 * @param build JavaScript that defines `before`, `after` and `unrelated`,
 *     each a text or a list of units, and `compare`, which takes two of them.
 */
function timedOrder(build: string): { exitCode: number | null; orderMs: number; plainMs: number; kept: number; moved: number; stepOrder: number } {
  const script = [
    `const { compareUnits, compareVersions, formatComparison, comparisonReport } = await import(${JSON.stringify(RESTRUCTURE_MODULE)});`,
    "const paths = { before: \"old.md\", after: \"new.md\", authorText: null };",
    build,
    "const run = (first, second) => { const comparison = compare(first, second); formatComparison(comparison, paths); comparisonReport(comparison, paths); return comparison; };",
    "let started = performance.now();",
    "const found = run(before, after);",
    "const orderMs = performance.now() - started;",
    "started = performance.now();",
    "run(before, unrelated);",
    "const plainMs = performance.now() - started;",
    "console.log(JSON.stringify({ orderMs, plainMs, kept: found.kept.length, moved: found.moved.length, stepOrder: found.stepOrder.length }));",
  ].join("\n");
  const run = Bun.spawnSync([process.execPath, "-e", script], { timeout: CHILD_LIMIT_MS });
  if (run.exitCode !== 0) return { exitCode: run.exitCode, orderMs: Number.NaN, plainMs: Number.NaN, kept: Number.NaN, moved: Number.NaN, stepOrder: Number.NaN };
  return { exitCode: 0, ...(JSON.parse(run.stdout.toString()) as { orderMs: number; plainMs: number; kept: number; moved: number; stepOrder: number }) };
}

/** Units made in a child process: `units(count, key)` gives `count` sentences, the key of each made by `key` from its index. */
const MAKE_UNITS = "const units = (count, key) => Array.from({ length: count }, (unused, index) => ({ kind: \"sentence\", line: index + 1, key: key(index), block: index }));";

/** Three ordered-list steps, the specimen for step order. */
const STEPS_TO_VENT = "1. Close the valve.\n2. Open the vent.\n3. Check the gauge.\n";

/** The row for one moved unit that opens with a word that points back, with the question it asks. */
function referentRow(word: string, sentence: string): string {
  return `| moved | 1 | 1 | ${MOVED_ONE} "${sentence}" It opens with "${word}". Check what "${word}" refers to in its new place. |`;
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
      ...TAIL,
    ]);
  });

  test("example 16: a conclusion moved under a new overview heading is kept and listed as moved, with the summary heading gone", () => {
    // Part 5 lets a restructure move a sentence, so the row asks a person to check the move, as an added row asks for a source.
    const conclusion = "The migration moves the billing database to PostgreSQL 16 and takes the application offline for up to 30 minutes.";
    expect(printed(EXAMPLE_16_BEFORE, EXAMPLE_16_AFTER)).toEqual([
      ...HEAD,
      `| moved | 8 | 4 | ${MOVED_ONE} ${excerpt(conclusion)} |`,
      counts(4, 0, 0, 0, 0, 1, 1, 0, 0, 1),
      ...TAIL,
    ]);
  });

  test("example 17: a fork turned into labelled conditions", () => {
    expect(printed(EXAMPLE_17_BEFORE, EXAMPLE_17_AFTER)).toEqual([...HEAD, counts(3, 0, 0, 0, 0, 0, 0, 0, 0), ...TAIL]);
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
      ...TAIL,
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
      .toEqual(only({ kept: ["Read the guide.", "Chart"] }));
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
    expect(keys("See ![A chart of sales](c.png) below.\n")).toEqual([["sentence", "See below."], ["alternative", "A chart of sales"]]);
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
      ...HEAD, "| dropped | 3 | | No unchanged copy is in the new version: \"Close the valve.\" |", counts(1, 1, 0, 0, 0, 0, 0, 0, 0), ...TAIL,
    ]);
  });

  test("a passage that stood once and stands twice is added once", () => {
    expect(sorted(compareVersions("Close the valve.\n", "Close the valve.\n\nClose the valve.\n", null))).toEqual(only({ kept: ["Close the valve."], added: ["Close the valve."] }));
  });

  test("occurrences pair so that the most units keep their order, and the kept pairs are in before order", () => {
    // Pairing the first copy with the first copy would keep the copy on line 1, which now stands after B,
    // and make B or that copy read as moved although only the first copy went.
    const comparison = compareVersions("A one.\n\nB two.\n\nA one.\n", "B two.\n\nA one.\n", null);
    expect(comparison.kept.map(pair => [pair.before.line, pair.after.line])).toEqual([[3, 1], [5, 3]]);
    expect(comparison.dropped.map(unit => unit.line)).toEqual([1]);
    expect(order(comparison)).toEqual(IN_ORDER);
  });

  test("copies out of the common order still pair, and read as moved", () => {
    const comparison = compareVersions("A one.\n\nB two.\n\nA one.\n\nC three.\n", "A one.\n\nC three.\n\nB two.\n\nA one.\n", null);
    expect(comparison.kept).toHaveLength(4);
    expect(order(comparison)).toEqual({ moved: ["C three."], stepOrder: [] });
  });

  test("a text past the pairing budget still steers which copy of another text is kept", () => {
    // 1,001 copies before and 1,002 after make 1,003,002 possible pairings, past the budget of 1,000,000,
    // so each copy of "Same." is offered only the original copy at the same place. Those offers still count
    // when the copy of "Mark." to keep is chosen: the last one keeps its place, and the first is dropped.
    const comparison = compareUnits(sentenceUnits(["Mark.", ...copiesOf("Same.", 1_001), "Mark."]), sentenceUnits([...copiesOf("Same.", 1_002), "Mark."]), []);
    expect({ kept: comparison.kept.length, added: comparison.added.map(unit => unit.line), dropped: comparison.dropped.map(unit => unit.line) })
      .toEqual({ kept: 1_002, added: [1_002], dropped: [1] });
    expect(order(comparison)).toEqual(IN_ORDER);
  });

  test("a copy past the original's, in a text past the pairing budget, is added and pairs with no other text", () => {
    // One copy before and 1,000,001 after are past the budget. The copies after the first have no original
    // copy at their place, so none is offered one, and none pairs with "Lead.", which stands before it.
    const comparison = compareUnits(sentenceUnits(["Lead.", "Same."]), sentenceUnits(copiesOf("Same.", 1_000_001)), []);
    expect({ kept: comparison.kept.map(pair => [pair.before.key, pair.after.line]), added: comparison.added.length, dropped: comparison.dropped.map(unit => unit.key) })
      .toEqual({ kept: [["Same.", 1]], added: 1_000_000, dropped: ["Lead."] });
  });

  test("a table that gains a row of repeated cells keeps every cell in order", () => {
    const before = "| Name | Ready |\n|---|---|\n| Pump | Yes |\n| Valve | Yes |\n";
    const after = "| Name | Ready |\n|---|---|\n| Pump | Yes |\n| Gauge | Yes |\n| Valve | Yes |\n";
    expect(order(compareVersions(before, after, null))).toEqual(IN_ORDER);
    // Keeping either the Pump row's Yes or the Gauge row's keeps every cell in order. The search meets the
    // Gauge row's last, so it keeps that one, and names the Pump row's copy as added.
    expect(comparisonReport(compareVersions(before, after, null), PATHS).added).toEqual([{ line: 3, kind: "cell", excerpt: "Yes" }, { line: 4, kind: "cell", excerpt: "Gauge" }]);
  });
});

describe("the order of the kept units", () => {

  test("a kept unit that moved is listed as moved, and the units around it are not", () => {
    const comparison = compareVersions("Close the valve. Open the vent. Check the gauge.\n", "Open the vent. Check the gauge. Close the valve.\n", null);
    expect(order(comparison)).toEqual({ moved: ["Close the valve."], stepOrder: [] });
    expect(formatComparison(comparison, PATHS).split("\n")).toEqual([
      ...HEAD, `| moved | 1 | 1 | ${MOVED_ONE} "Close the valve." |`, counts(3, 0, 0, 0, 0, 0, 0, 0, 0, 1), ...TAIL,
    ]);
  });

  test("an unchanged document, a reflow, emphasis and a change of list marker keep every unit in order", () => {
    const before = "Close the valve. See ![the chart](c.png) here. Open the vent.\n\n- Check the gauge.\n- Call the team.\n";
    const reflowed = "Close the **valve**.\nSee ![the chart](c.png)\nhere. Open the\nvent.\n\n* Check the *gauge*.\n* Call the team.\n";
    for (const after of [before, reflowed]) {
      const comparison = compareVersions(before, after, null);
      expect(comparison.kept, after).toHaveLength(6);
      expect(order(comparison), after).toEqual(IN_ORDER);
    }
  });

  test("an image's alternative text stands where its image stands, so a reflow cannot move it past a sentence", () => {
    expect(keys("Close the valve. See ![the chart](c.png) here.\n")).toEqual([["sentence", "Close the valve."], ["sentence", "See here."], ["alternative", "the chart"]]);
    expect(keys("Close the valve.\nSee ![the chart](c.png) here.\n")).toEqual([["sentence", "Close the valve."], ["sentence", "See here."], ["alternative", "the chart"]]);
    // An image that starts where a sentence starts stands before it.
    expect(keys("Close the valve. ![The chart](c.png) Read it.\n")).toEqual([["sentence", "Close the valve."], ["alternative", "The chart"], ["sentence", "Read it."]]);
    // The place is marked with a private-use character the text does not hold.
    expect(keys("Close the \uE000 valve. See ![the chart](c.png) here.\n")).toEqual([["sentence", "Close the \uE000 valve."], ["sentence", "See here."], ["alternative", "the chart"]]);
  });

  test("an image in prose that holds every private-use character comes before the prose, as it did before places were read", () => {
    const every = Array.from({ length: 0xF8FF - 0xE000 + 1 }, (unused, index) => String.fromCharCode(0xE000 + index)).join("");
    expect(keys(`Close ${every}. See ![the chart](c.png) here.\n`).map(([kind]) => kind)).toEqual(["alternative", "sentence", "sentence"]);
  });

  test("units that changed kind but kept their place are in order", () => {
    const comparison = compareVersions("Close the valve. Open the vent. Check the gauge. Call the team.\n", "## Close the valve.\n\n- Open the vent.\n\n| Check the gauge. |\n|---|\n\n> Call the team.\n", null);
    expect(comparison.kept).toHaveLength(4);
    expect(order(comparison)).toEqual(IN_ORDER);
  });

  test("two ordered-list steps that swap places are one step out of order, and nothing else", () => {
    const comparison = compareVersions(STEPS_TO_VENT, "1. Open the vent.\n2. Close the valve.\n3. Check the gauge.\n", null);
    // Either step could be named. The comparison names the one that stood first in the original.
    expect(order(comparison)).toEqual({ moved: [], stepOrder: ["Close the valve."] });
    expect(formatComparison(comparison, PATHS).split("\n")).toEqual([
      ...HEAD, `| step order | 1 | 2 | ${STEP_ONE} "Close the valve." |`, counts(3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1), ...TAIL,
    ]);
  });

  test("steps renumbered, given another marker, or made bullets or prose in the same order are in order", () => {
    for (const after of [
      "3. Close the valve.\n4. Open the vent.\n5. Check the gauge.\n",
      "1. Close the valve.\n1. Open the vent.\n1. Check the gauge.\n",
      "1) Close the valve.\n2) Open the vent.\n3) Check the gauge.\n",
      "1.\tClose the valve.\n2.\tOpen the vent.\n3.\tCheck the gauge.\n",
      "- Close the valve.\n- Open the vent.\n- Check the gauge.\n",
      "Close the valve. Open the vent. Check the gauge.\n",
    ]) {
      expect(order(compareVersions(STEPS_TO_VENT, after, null)), after).toEqual(IN_ORDER);
    }
  });

  test("steps made bullets or prose in another order are still steps out of order", () => {
    for (const after of ["- Open the vent.\n- Close the valve.\n- Check the gauge.\n", "Open the vent. Close the valve. Check the gauge.\n"]) {
      expect(order(compareVersions(STEPS_TO_VENT, after, null)), after).toEqual({ moved: [], stepOrder: ["Close the valve."] });
    }
  });

  test("units of a bulleted list or of prose that change order are moved, not steps out of order", () => {
    expect(order(compareVersions("- Close the valve.\n- Open the vent.\n", "- Open the vent.\n- Close the valve.\n", null))).toEqual({ moved: ["Close the valve."], stepOrder: [] });
  });

  test("a step is an item: sentences that change order inside one step are moved, not a step out of order", () => {
    const before = "1. Close the valve. Wait a minute.\n2. Open the vent.\n";
    const comparison = compareVersions(before, "1. Wait a minute. Close the valve.\n2. Open the vent.\n", null);
    expect(order(comparison)).toEqual({ moved: ["Close the valve."], stepOrder: [] });
    // A bullet or a code block inside a step belongs to that step.
    const nested = "1. Close the valve.\n   - Use the lever.\n\n   ```\n   valve close\n   ```\n2. Open the vent.\n";
    expect(order(compareVersions(nested, "1. Close the valve.\n   - Use the lever.\n2. Open the vent.\n\n   ```\n   valve close\n   ```\n", null)))
      .toEqual({ moved: [], stepOrder: ["valve close"] });
    // Of two steps that swap, the one with fewer kept units is named, so the most units keep their order.
    expect(order(compareVersions(nested, "1. Open the vent.\n2. Close the valve.\n   - Use the lever.\n\n   ```\n   valve close\n   ```\n", null)))
      .toEqual({ moved: [], stepOrder: ["Open the vent."] });
  });

  test("a table, a heading and indented code inside a step belong to that step", () => {
    const before = "1. Close the valve.\n\n   | Valve | Turns |\n   |---|---|\n   | Main | 3 |\n2. ## Open the vent.\n\n       vent open\n3. Check the gauge.\n";
    const after = "1. Check the gauge.\n2. Close the valve.\n\n   | Valve | Turns |\n   |---|---|\n   | Main | 3 |\n3. ## Open the vent.\n\n       vent open\n";
    expect(order(compareVersions(before, after, null))).toEqual({ moved: [], stepOrder: ["Check the gauge."] });
    // The step with the heading and the code has one kept unit fewer than the table's, so it is the one named.
    // Were the heading, the code, a header cell or a row not read as part of its step, the other step would be.
    const longer = before.replace("vent open\n", "vent open\n\n   Wait. Then look.\n");
    const swapped = "1. ## Open the vent.\n\n       vent open\n\n   Wait. Then look.\n2. Close the valve.\n\n   | Valve | Turns |\n   |---|---|\n   | Main | 3 |\n3. Check the gauge.\n";
    expect(order(compareVersions(longer, swapped, null))).toEqual({ moved: [], stepOrder: ["Open the vent.", "vent open", "Wait.", "Then look."] });
  });

  test("lists nested on one line are read as separate lists", () => {
    const before = "1. 1. Close the valve. Open the vent.\n   2. Check the gauge.\n";
    expect(order(compareVersions(before, before, null))).toEqual(IN_ORDER);
    expect(order(compareVersions(before, "1. 1. Open the vent. Close the valve.\n   2. Check the gauge.\n", null))).toEqual({ moved: ["Close the valve."], stepOrder: [] });
    expect(order(compareVersions(before, "1. 1. Check the gauge.\n   2. Close the valve. Open the vent.\n", null))).toEqual({ moved: [], stepOrder: ["Check the gauge."] });
  });

  test("the steps of a nested ordered list are read against each other, and not against the steps around them", () => {
    const before = "1. Prepare.\n   1. Close the valve.\n   2. Open the vent.\n2. Finish.\n";
    expect(order(compareVersions(before, "1. Prepare.\n   1. Open the vent.\n   2. Close the valve.\n2. Finish.\n", null))).toEqual({ moved: [], stepOrder: ["Close the valve."] });
    expect(order(compareVersions(before, "1. Finish.\n2. Prepare.\n   1. Close the valve.\n   2. Open the vent.\n", null))).toEqual({ moved: [], stepOrder: ["Finish."] });
  });

  test("a nested list's units count for the step of the outer list that holds it, so moving the nested list past the next step puts that step out of order", () => {
    const before = "1. Prepare.\n   1. Close the valve.\n   2. Open the vent.\n2. Finish.\n";
    expect(order(compareVersions(before, "1. Prepare.\n2. Finish.\n   1. Close the valve.\n   2. Open the vent.\n", null))).toEqual({ moved: [], stepOrder: ["Finish."] });
  });

  test("a whole list moved elsewhere keeps its steps in order, so it is moved and no step is out of order", () => {
    const prose = "Read this first.\n\nThen rest.\n\nThen more.\n\nThe end.\n";
    const comparison = compareVersions(`${prose}\n${STEPS_TO_VENT}`, `${STEPS_TO_VENT}\n${prose}`, null);
    expect(order(comparison)).toEqual({ moved: ["Close the valve.", "Open the vent.", "Check the gauge."], stepOrder: [] });
    expect(formatComparison(comparison, PATHS).split("\n")[3]).toBe("| moved | 9 | 1 | 3 units kept, but moved together out of their original order. Check that they keep what they depend on and the claims they qualify: \"Close the valve.\" |");
  });

  test("a section moved whole is one row, which counts its units", () => {
    const before = "# Guide\n\n## Install\n\nRun the installer. Restart the machine.\n\n## Use\n\nOpen the app.\n\n## Remove\n\nDelete the folder. Empty the bin.\n";
    const after = "# Guide\n\n## Remove\n\nDelete the folder. Empty the bin.\n\n## Install\n\nRun the installer. Restart the machine.\n\n## Use\n\nOpen the app.\n";
    const comparison = compareVersions(before, after, null);
    expect(order(comparison)).toEqual({ moved: ["Remove", "Delete the folder.", "Empty the bin."], stepOrder: [] });
    expect(formatComparison(comparison, PATHS).split("\n")).toEqual([
      ...HEAD,
      "| moved | 11 | 3 | 3 units kept, but moved together out of their original order. Check that they keep what they depend on and the claims they qualify: \"Remove\" |",
      counts(9, 0, 0, 0, 0, 0, 0, 0, 0, 3),
      ...TAIL,
    ]);
  });

  test("units next to each other in the original but not in the new version are two rows", () => {
    const rows = printed("Fit the seal. Check the lip. Close the lid. Wipe it. Dry it.\n", "Close the lid. Check the lip. Fit the seal. Wipe it. Dry it.\n").filter(row => row.startsWith("| moved |"));
    expect(rows).toEqual([`| moved | 1 | 1 | ${MOVED_ONE} "Fit the seal." |`, `| moved | 1 | 1 | ${MOVED_ONE} "Check the lip." |`]);
  });

  test("a section added above numbered headings leaves their numbers unread for order, and a numbered section moved whole is one row", () => {
    const before = "# Guide\n\n## 1. Install\n\nRun it.\n\n## 2. Use\n\nOpen it.\n\n## 3. Update\n\nPull it.\n\n## 4. Remove\n\nDelete it.\n";
    const renumbered = "# Guide\n\n## 1. Install\n\nRun it.\n\n## 2. Configure\n\nSet it.\n\n## 3. Use\n\nOpen it.\n\n## 4. Update\n\nPull it.\n\n## 5. Remove\n\nDelete it.\n";
    const comparison = compareVersions(before, renumbered, null);
    expect(order(comparison)).toEqual(IN_ORDER);
    // A number is still kept: four pair, and the new section's number and the last are new headings.
    expect([comparison.kept.length, comparison.newHeadings.map(unit => unit.key)]).toEqual([13, ["Configure", "5."]]);
    const moved = "# Guide\n\n## 4. Remove\n\nDelete it.\n\n## 1. Install\n\nRun it.\n\n## 2. Use\n\nOpen it.\n\n## 3. Update\n\nPull it.\n";
    expect(printed(before, moved).filter(row => row.startsWith("| moved |")))
      .toEqual(["| moved | 15 | 3 | 2 units kept, but moved together out of their original order. Check that they keep what they depend on and the claims they qualify: \"Remove\" |"]);
  });

  test("a moved unit that opens with This, It or These is asked what that word refers to, and only the first of a run is", () => {
    const before = "Fit the seal. Tighten the bolts. This keeps the seal tight.\n";
    expect(printed(before, "This keeps the seal tight. Fit the seal. Tighten the bolts.\n")[3]).toBe(referentRow("This", "This keeps the seal tight."));
    expect(printed("Fit the seal. Check the lip. It keeps water out.\n", "It keeps water out. Fit the seal. Check the lip.\n")[3]).toBe(referentRow("It", "It keeps water out."));
    expect(printed("Fit the seals. Check the lips. These keep water out.\n", "These keep water out. Fit the seals. Check the lips.\n")[3]).toBe(referentRow("These", "These keep water out."));
    // A longer word that starts the same way asks nothing.
    expect(printed("Fit the seal. Check the lip. Its edge faces out.\n", "Its edge faces out. Fit the seal. Check the lip.\n")[3]).toBe(`| moved | 1 | 1 | ${MOVED_ONE} "Its edge faces out." |`);
    // The second unit of a run moved with the one before it, so its word still refers to that unit.
    expect(printed("Fit the seal. Check the lip. Close the lid. Wipe it. This cleans it.\n", "Wipe it. This cleans it. Fit the seal. Check the lip. Close the lid.\n")[3])
      .toBe(`| moved | 1 | 1 | 2 units kept, but moved together out of their original order. Check that they keep what they depend on and the claims they qualify: "Wipe it." |`);
    expect(compareVersions("Fit the seal. Check the lip. Close the lid. Wipe it. This cleans it.\n", "Wipe it. This cleans it. Fit the seal. Check the lip. Close the lid.\n", null).moved.map(pair => pair.opensWith))
      .toEqual([null, null]);
    // A run whose first unit opens with the word asks about the first.
    expect(printed("Fit the seal. Check the lip. Close the lid. This cleans it. Dry it.\n", "This cleans it. Dry it. Fit the seal. Check the lip. Close the lid.\n")[3])
      .toBe(`| moved | 1 | 1 | 2 units kept, but moved together out of their original order. Check that they keep what they depend on and the claims they qualify: "This cleans it." The first opens with "This". Check what "This" refers to in its new place. |`);
    // A heading, a code block and an image's alternative text are not prose, so nothing is asked.
    expect(compareVersions("# A\n\n## B\n\n## C\n\n## This week\n", "# A\n\n## This week\n\n## B\n\n## C\n", null).moved.map(pair => [pair.after.key, pair.opensWith])).toEqual([["This week", null]]);
  });

  test("the JSON report lists each moved unit and each step out of order, with both lines, the row it is printed in, and any word asked about", () => {
    const report = comparisonReport(compareVersions(`${STEPS_TO_VENT}\nThis keeps it tight.\n`, "This keeps it tight.\n\n1. Open the vent.\n2. Close the valve.\n3. Check the gauge.\n", null), PATHS);
    expect(report.moved).toEqual([{ before: 5, after: 1, kind: "sentence", excerpt: "This keeps it tight.", run: 1, opensWith: "This" }]);
    expect(report.stepOrder).toEqual([{ before: 1, after: 4, kind: "item", excerpt: "Close the valve.", run: 1, opensWith: null }]);
  });

  test("CRLF line endings, tabs and characters past the basic plane read as the same units in the same order", () => {
    const before = "1. Close the vanne \u{1F527}.\n2. Ouvrez l'\u00e9vent.\n\n\u00c9tape finale. Fermez.\n";
    expect(order(compareVersions(before, before.replaceAll("\n", "\r\n").replace("1. ", "1.\t"), null))).toEqual(IN_ORDER);
    const swapped = "1. Ouvrez l'\u00e9vent.\r\n2. Close the vanne \u{1F527}.\r\n\r\nFermez. \u00c9tape finale.\r\n";
    expect(order(compareVersions(before, swapped, null))).toEqual({ moved: ["\u00c9tape finale."], stepOrder: ["Close the vanne \u{1F527}."] });
  });

  test("empty and identical files list nothing as moved", () => {
    for (const [before, after] of [["", ""], ["", STEPS_TO_VENT], [STEPS_TO_VENT, ""], [STEPS_TO_VENT, STEPS_TO_VENT]]) {
      expect(order(compareVersions(before ?? "", after ?? "", null))).toEqual(IN_ORDER);
    }
  });

  test("swapping the two versions keeps as many units in order", () => {
    const pairs: Array<[string, string]> = [
      ["Close the valve. Open the vent. Check the gauge.\n", "Open the vent. Check the gauge. Close the valve.\n"],
      [STEPS_TO_VENT, "1. Check the gauge.\n2. Close the valve.\n3. Open the vent.\n"],
      ["A one. B two. A one. C three.\n", "C three. A one. B two.\n"],
    ];
    for (const [first, second] of pairs) {
      const forward = compareVersions(first, second, null);
      const backward = compareVersions(second, first, null);
      expect(backward.kept.length, first).toBe(forward.kept.length);
      expect(backward.moved.length + backward.stepOrder.length, first).toBe(forward.moved.length + forward.stepOrder.length);
    }
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

describe("a label gained or lost moves nothing", () => {
  const VALVE = "Close the valve.";

  test("a label added to one of two copies keeps both in order", () => {
    // Pairing the unlabelled copy first, with the original's first copy, left the labelled copy to pair
    // with the original's second, so the two pairs crossed and one copy read as moved.
    const comparison = compareVersions(`${VALVE}\n\n${VALVE}\n`, `**Purpose:** ${VALVE}\n\n${VALVE}\n`, null);
    expect(order(comparison)).toEqual(IN_ORDER);
    expect(formatComparison(comparison, PATHS).split("\n")).toEqual([...HEAD, counts(2, 0, 0, 0, 0, 0, 0, 1, 0), ...TAIL]);
    expect(comparisonReport(comparison, PATHS).newLabels).toEqual([{ line: 1, kind: "sentence", excerpt: "Purpose:" }]);
  });

  test("a label added to one step of an ordered list leaves every step in order", () => {
    expect(order(compareVersions(`1. ${VALVE}\n2. ${VALVE}\n`, `1. **Purpose:** ${VALVE}\n2. ${VALVE}\n`, null))).toEqual(IN_ORDER);
    expect(order(compareVersions(`1. ${VALVE}\n2. ${VALVE}\n3. ${VALVE}\n`, `1. ${VALVE}\n2. **Purpose:** ${VALVE}\n3. ${VALVE}\n`, null))).toEqual(IN_ORDER);
  });

  test("a label added to a middle copy, or to the first and the last, leaves every copy in order", () => {
    const three = `${VALVE}\n\n${VALVE}\n\n${VALVE}\n`;
    for (const after of [
      `${VALVE}\n\n**Purpose:** ${VALVE}\n\n${VALVE}\n`,
      `**Purpose:** ${VALVE}\n\n${VALVE}\n\n**Purpose:** ${VALVE}\n`,
      `${VALVE}\n\n${VALVE}\n\n**Purpose:** ${VALVE}\n`,
    ]) {
      const comparison = compareVersions(three, after, null);
      expect(order(comparison), after).toEqual(IN_ORDER);
      expect(comparison.kept, after).toHaveLength(3);
    }
  });

  test("a label lost from one of two copies keeps both in order", () => {
    const comparison = compareVersions(`**Purpose:** ${VALVE}\n\n${VALVE}\n`, `${VALVE}\n\n${VALVE}\n`, null);
    expect(order(comparison)).toEqual(IN_ORDER);
    expect(sorted(comparison)).toEqual(only({ kept: [VALVE, VALVE], labelsGone: ["Purpose:"] }));
    expect(order(compareVersions(`${VALVE}\n\n**Purpose:** ${VALVE}\n`, `${VALVE}\n\n${VALVE}\n`, null))).toEqual(IN_ORDER);
  });

  test("a copy that gains a label and moves is the one unit moved", () => {
    // Pairing so that the most units keep their order leaves one unit out of it, however the copies pair.
    const comparison = compareVersions("X one.\n\nA one.\n\nY one.\n\nA one.\n", "**Purpose:** A one.\n\nX one.\n\nA one.\n\nY one.\n", null);
    expect(order(comparison)).toEqual({ moved: ["Purpose: A one."], stepOrder: [] });
    expect(comparison.newLabels.map(unit => unit.line)).toEqual([1]);
    const unlabelled = compareVersions("X one.\n\nA one.\n\nY one.\n\nA one.\n", "A one.\n\nX one.\n\nA one.\n\nY one.\n", null);
    expect(order(unlabelled)).toEqual({ moved: ["A one."], stepOrder: [] });
  });

  test("a label that passes from one copy to another reads as a move, because whole wording pairs first", () => {
    // The labelled copy matches its original whole, so it is kept as it stood, and it now stands first.
    const comparison = compareVersions(`${VALVE}\n\n**Purpose:** ${VALVE}\n`, `**Purpose:** ${VALVE}\n\n${VALVE}\n`, null);
    expect(order(comparison)).toEqual({ moved: [VALVE], stepOrder: [] });
    expect([comparison.newLabels.length, comparison.labelsGone.length]).toEqual([0, 0]);
  });

  test("a text pairs by label no more often than it has copies to spare, so the labels counted are those whole wording leaves", () => {
    const comparison = compareVersions("Close the valve.\n\nClose the valve.\n\nOpen the vent.\n\n**Purpose:** Open the vent.\n\n1. **Purpose:** Open the vent.\n\nOpen the vent.\n", "**Purpose:** Open the vent.\n\nClose the valve.\n\n1. **Purpose:** Close the valve.\n\nOpen the vent.\n\n1. Open the vent.\n\nOpen the vent.\n", null);
    expect([comparison.kept.length, comparison.newLabels.length, comparison.labelsGone.length]).toEqual([6, 1, 1]);
    expect(order(comparison)).toEqual({ moved: ["Purpose: Open the vent."], stepOrder: [] });
  });

  test("where weighing labels in the order search keeps fewer units in order, whole wording alone is used", () => {
    const comparison = compareVersions("Close the valve.\n\nClose the valve.\n\nClose the valve.\n\nOpen the vent.\n\n**Purpose:** Check the gauge.\n\n**Purpose:** Close the valve.\n\n**Purpose:** Close the valve.\n", "1. Close the valve.\n2. **Purpose:** Close the valve.\n\n**Purpose:** Close the valve.\n\n**Purpose:** Close the valve.\n\nOpen the vent.\n\n**Purpose:** Check the gauge.\n\n1. **Purpose:** Close the valve.\n", null);
    expect(order(comparison)).toEqual({ moved: ["Purpose: Close the valve."], stepOrder: [] });
    expect([comparison.kept.length, comparison.newLabels.length]).toEqual([7, 2]);
  });

  test("where weighing labels in the order search keeps no more units in order, whole wording alone is used", () => {
    // Both matches keep four of five units in order. Each names a different copy as moved, and the one named is whole wording's.
    const comparison = compareVersions("1. **Purpose:** Check the gauge.\n\nOpen the vent.\n\n1. **Purpose:** Open the vent.\n2. Close the valve.\n\n**Purpose:** Open the vent.\n", "**Purpose:** Open the vent.\n\n**Purpose:** Check the gauge.\n\n1. **Purpose:** Open the vent.\n2. Close the valve.\n\n**Purpose:** Open the vent.\n", null);
    expect(order(comparison)).toEqual({ moved: ["Purpose: Check the gauge."], stepOrder: [] });
  });

  test("labels added to copies, or taken from them, but never both for one text, leave every unit in order", () => {
    const random = seeded(24_495);
    const texts = ["Close the valve.", "Open the vent.", "Check the gauge."];
    for (let trial = 0; trial < 400; trial++) {
      const length = 2 + Math.floor(random() * 6);
      const units = Array.from({ length }, () => ({ text: texts[Math.floor(random() * texts.length)] ?? "", label: random() < 0.4 }));
      // Each text either gains labels or loses them in the new version, so no label passes between its copies.
      const gains = new Map(texts.map(text => [text, random() < 0.5]));
      const changed = units.map(unit => (random() < 0.5 ? { ...unit, label: gains.get(unit.text) === true } : unit));
      const asList = random() < 0.5;
      const write = (version: ReadonlyArray<{ text: string; label: boolean }>): string =>
        `${version.map((unit, index) => `${asList ? `${index + 1}. ` : ""}${unit.label ? "**Purpose:** " : ""}${unit.text}`).join(asList ? "\n" : "\n\n")}\n`;
      const before = write(units);
      const after = write(changed);
      const comparison = compareVersions(before, after, null);
      expect(order(comparison), `${before}->\n${after}`).toEqual(IN_ORDER);
      expect(comparison.kept, `${before}->\n${after}`).toHaveLength(length);
    }
  });
});

describe("moved and step order agree on one longest order", () => {
  test("a step moved out of its list is a step out of order, and the prose around it is in order", () => {
    // Taking the step named first out before reading the rest left the opening sentence outside the longest
    // order of what remained, though it belongs to the one longest order of the whole document.
    const before = "Read this first.\n\n1. Close the valve.\n2. Open the vent.\n\nFinish now.\n";
    const after = "Open the vent.\n\nRead this first.\n\nClose the valve.\n\nFinish now.\n";
    const comparison = compareVersions(before, after, null);
    expect(order(comparison)).toEqual({ moved: [], stepOrder: ["Open the vent."] });
    expect(formatComparison(comparison, PATHS).split("\n")).toEqual([...HEAD, `| step order | 4 | 1 | ${STEP_ONE} "Open the vent." |`, counts(4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1), ...TAIL]);
  });

  test("of two steps that swap with prose between them, the one outside the document's longest order is named", () => {
    const comparison = compareVersions("Prepare.\n\n1. Close the valve.\n2. Open the vent.\n\nFinish now.\n", "Open the vent.\n\nPrepare.\n\nClose the valve.\n\nFinish now.\n", null);
    expect(order(comparison)).toEqual({ moved: [], stepOrder: ["Open the vent."] });
    // With nothing around them to settle it, the step that stood first is named, as before.
    expect(order(compareVersions(STEPS_TO_VENT, "1. Open the vent.\n2. Close the valve.\n3. Check the gauge.\n", null))).toEqual({ moved: [], stepOrder: ["Close the valve."] });
  });

  test("steps kept in step order but moved past prose are moved, and a step out of step order is never also moved", () => {
    const comparison = compareVersions("P one.\n\nQ one.\n\n1. S one.\n2. S two.\n3. S three.\n", "S two.\n\nS three.\n\nP one.\n\nQ one.\n\nS one.\n", null);
    expect(order(comparison)).toEqual({ moved: ["S two.", "S three."], stepOrder: ["S one."] });
  });

  test("of the longest orders, the one holding no step out of order is read, so a step is not listed with a moved unit beside it", () => {
    const comparison = compareVersions("1. **Purpose:** Open the vent.\n2. Close the valve.\n3. **Purpose:** Close the valve.\n\n**Purpose:** Close the valve.\n", "1. **Purpose:** Close the valve.\n2. Open the vent.\n3. **Purpose:** Close the valve.\n\nClose the valve.\n", null);
    expect(order(comparison)).toEqual({ moved: ["Close the valve."], stepOrder: ["Purpose: Close the valve."] });
  });

  test("on random documents, the moved leave a longest shared order, and each list keeps its longest order", () => {
    const random = seeded(21);
    for (let trial = 0; trial < 500; trial++) {
      const prose = Math.floor(random() * 4);
      const steps = 2 + Math.floor(random() * 4);
      const listAt = Math.floor(random() * (prose + 1));
      const texts = Array.from({ length: prose + steps }, (unused, index) => `Unit ${index} here.`);
      const proseTexts = texts.slice(0, prose);
      const stepTexts = texts.slice(prose);
      const blocks = [...proseTexts.slice(0, listAt), stepTexts.map((text, index) => `${index + 1}. ${text}`).join("\n"), ...proseTexts.slice(listAt)];
      const beforeOrder = [...proseTexts.slice(0, listAt), ...stepTexts, ...proseTexts.slice(listAt)];
      const afterOrder = shuffled(beforeOrder, random);
      const comparison = compareVersions(`${blocks.join("\n\n")}\n`, `${afterOrder.join("\n\n")}\n`, null);
      const label = `${beforeOrder.join(" ")} -> ${afterOrder.join(" ")}`;
      const place = (text: string): number => afterOrder.indexOf(text);
      const moved = new Set(comparison.moved.map(pair => pair.after.key));
      const outOfStep = new Set(comparison.stepOrder.map(pair => pair.after.key));
      expect([...moved].filter(text => outOfStep.has(text)), label).toEqual([]);
      expect(longestIncreasingLength(beforeOrder.filter(text => !moved.has(text)).map(place)), label).toBe(longestIncreasingLength(beforeOrder.map(place)));
      expect(isIncreasing(beforeOrder.filter(text => !moved.has(text) && !outOfStep.has(text)).map(place)), label).toBe(true);
      const kept = stepTexts.filter(text => !outOfStep.has(text)).map(place);
      expect([isIncreasing(kept), kept.length], label).toEqual([true, longestIncreasingLength(stepTexts.map(place))]);
    }
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
    expect(printed(one, two).at(-1 - TAIL.length)).toBe(counts(2, 0, 0, 0, 0, 1, 0, 0, 0));
    expect(printed(two, one).at(-1 - TAIL.length)).toBe(counts(2, 0, 0, 0, 0, 0, 1, 0, 0));
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
      ...TAIL,
    ]);
  });

  test("added items of a new list share one row, and a list that keeps a unit lists each added item", () => {
    expect(printed("Keep.\n", "Keep.\n\n- One.\n- Two.\n- Three.\n").slice(3, -3)).toEqual([
      "| added | | 3 | 3 units in one new list are not in the original or the author's wording. Confirm their source: \"One.\" |",
    ]);
    expect(printed("Keep.\n", "- Keep.\n- One.\n- Two.\n").slice(3, -3)).toEqual([
      "| added | | 2 | Not in the original or the author's wording. Confirm its source: \"One.\" |",
      "| added | | 3 | Not in the original or the author's wording. Confirm its source: \"Two.\" |",
    ]);
    expect(printed("Keep.\n", "Keep.\n\n- One.\n").slice(3, -3)).toEqual([
      "| added | | 3 | Not in the original or the author's wording. Confirm its source: \"One.\" |",
    ]);
  });

  test("a shared row counts units, so two items of two sentences each are 4 units, and the rows add up to the count of added units", () => {
    expect(printed("", "- First sentence. Second sentence.\n- Third sentence. Fourth sentence.\n").slice(3)).toEqual([
      "| added | | 1 | 4 units in one new list are not in the original or the author's wording. Confirm their source: \"First sentence.\" |",
      counts(0, 0, 4, 0, 0, 0, 0, 0, 0),
      ...TAIL,
    ]);
    expect(printed("", "| Header |\n|---|\n| First sentence. Second sentence. |\n").slice(3)).toEqual([
      "| added | | 1 | 3 units in one new table are not in the original or the author's wording. Confirm their source: \"Header\" |",
      counts(0, 0, 3, 0, 0, 0, 0, 0, 0),
      ...TAIL,
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
      moved: [],
      stepOrder: [],
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

  // A longest common order found by comparing every pair of kept units takes
  // time in the square of their number. These forms show it at an assertion.
  const orderForms: Array<[string, string, { kept: number; moved: number; stepOrder: number }]> = [
    [
      "100,000 units in reverse order",
      `${MAKE_UNITS} const before = units(100_000, index => \`S\${index}.\`); const after = units(100_000, index => \`S\${99_999 - index}.\`);`
        + " const unrelated = units(100_000, index => `T${index}.`); const compare = (first, second) => compareUnits(first, second, []);",
      { kept: 100_000, moved: 99_999, stepOrder: 0 },
    ],
    [
      "100,000 copies of one unit on each side",
      `${MAKE_UNITS} const before = units(100_000, () => "Same."); const after = units(100_000, () => "Same.");`
        + " const unrelated = units(100_000, index => `T${index}.`); const compare = (first, second) => compareUnits(first, second, []);",
      { kept: 100_000, moved: 0, stepOrder: 0 },
    ],
    [
      "100,000 copies of one unit, with every other unit one of 50,000 copies and dropped",
      `${MAKE_UNITS} const before = units(100_000, index => index % 2 === 0 ? "Same." : "Gone."); const after = units(50_000, () => "Same.");`
        + " const unrelated = units(50_000, index => `T${index}.`); const compare = (first, second) => compareUnits(first, second, []);",
      { kept: 50_000, moved: 0, stepOrder: 0 },
    ],
    [
      "100,000 sentences in reverse order inside 5,000 nested ordered lists",
      "const markers = \"1. \".repeat(5_000); const sentences = Array.from({ length: 100_000 }, (unused, index) => `Step ${index} now.`);"
        + " const before = markers + sentences.join(\" \"); const after = markers + [...sentences].reverse().join(\" \");"
        + " const unrelated = markers + sentences.map(sentence => sentence.replace(\"Step\", \"Task\")).join(\" \"); const compare = (first, second) => compareVersions(first, second, null);",
      { kept: 100_000, moved: 99_999, stepOrder: 0 },
    ],
    [
      "100,000 ordered-list steps in reverse order",
      "const lines = Array.from({ length: 100_000 }, (unused, index) => `${index + 1}. Step ${index}.`);"
        + " const before = lines.join(\"\\n\"); const after = [...lines].reverse().join(\"\\n\");"
        + " const unrelated = lines.map(line => line.replace(\"Step\", \"Task\")).join(\"\\n\"); const compare = (first, second) => compareVersions(first, second, null);",
      { kept: 100_000, moved: 0, stepOrder: 99_999 },
    ],
    [
      "100,000 units in reverse order, each gaining a label",
      "const texts = Array.from({ length: 100_000 }, (unused, index) => `S${index}.`); const before = texts.join(\"\\n\\n\");"
        + " const after = [...texts].reverse().map(text => `**Purpose:** ${text}`).join(\"\\n\\n\");"
        + " const unrelated = texts.map(text => `**Purpose:** T${text}`).join(\"\\n\\n\"); const compare = (first, second) => compareVersions(first, second, null);",
      { kept: 100_000, moved: 99_999, stepOrder: 0 },
    ],
    [
      "1,000 copies of one unit, every other one gaining a label, for 1,000,000 possible pairings",
      "const before = Array.from({ length: 1_000 }, () => \"Same.\").join(\"\\n\\n\");"
        + " const after = Array.from({ length: 1_000 }, (unused, index) => index % 2 === 0 ? \"**Purpose:** Same.\" : \"Same.\").join(\"\\n\\n\");"
        + " const unrelated = Array.from({ length: 1_000 }, () => \"Same.\").join(\"\\n\\n\"); const compare = (first, second) => compareVersions(first, second, null);",
      // Its baseline weighs the same 1,000,000 pairings by whole wording alone, so it sets the pace for that much work.
      { kept: 1_000, moved: 0, stepOrder: 0 },
    ],
    [
      "100,000 copies of one unit, every other one gaining a label, past the pairing budget",
      "const before = Array.from({ length: 100_000 }, () => \"Same.\").join(\"\\n\\n\");"
        + " const after = Array.from({ length: 100_000 }, (unused, index) => index % 2 === 0 ? \"**Purpose:** Same.\" : \"Same.\").join(\"\\n\\n\");"
        + " const unrelated = Array.from({ length: 100_000 }, (unused, index) => `T${index}.`).join(\"\\n\\n\"); const compare = (first, second) => compareVersions(first, second, null);",
      // Past the budget, copies pair in document order, so the labelled copies pair with the original's second half.
      { kept: 100_000, moved: 50_000, stepOrder: 0 },
    ],
  ];
  for (const [name, build, expected] of orderForms) {
    test(`${name} compare, print and report in time proportional to the units`, () => {
      const timed = timedOrder(build);
      expect(timed.exitCode, `the comparison was stopped after ${CHILD_LIMIT_MS} ms, or failed`).toBe(0);
      expect(timed.orderMs, `${timed.plainMs} ms for the baseline`).toBeLessThan(slotBudget(timed.plainMs));
      expect({ kept: timed.kept, moved: timed.moved, stepOrder: timed.stepOrder }).toEqual(expected);
    }, 2 * CHILD_LIMIT_MS);
  }

  test("a paragraph of 1,000,000 sentences is read without passing them all to one call", () => {
    // A spread of every unit into one call throws a RangeError on far fewer.
    const script = `const { documentUnits } = await import(${JSON.stringify(RESTRUCTURE_MODULE)}); console.log(documentUnits("Go now. ".repeat(1_000_000)).length);`;
    const run = Bun.spawnSync([process.execPath, "-e", script], { timeout: CHILD_LIMIT_MS });
    expect(run.exitCode, run.stderr.toString().slice(0, 500)).toBe(0);
    expect(run.stdout.toString().trim()).toBe("1000000");
  }, 2 * CHILD_LIMIT_MS);
});
