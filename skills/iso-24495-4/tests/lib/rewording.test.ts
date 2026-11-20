import { describe, expect, test } from "bun:test";
import { compareUnits, compareVersions, comparisonReport, formatComparison, type Comparison, type Unit } from "../../scripts/lib/restructure.ts";
import { figureFound, figureValues, foundIn, numberWords, pairReworded, wordsOf, WEIGHING_BUDGET, type Meter } from "../../scripts/lib/rewording.ts";

/** The paths every printed comparison here names. */
const PATHS = { before: "old.md", after: "new.md", authorText: null };

/** The first line, the table header and divider, of every printed comparison here. */
const HEAD = ["Restructure comparison: before `old.md`, after `new.md`", "| Kind | Before | After | Finding |", "|------|--------|-------|---------|"];

/** The closing statements of a printed comparison that weighed its rewording. */
const TAIL = [
  "The comparison reads wording, not meaning.",
  "It pairs a reworded unit only where the two share half the longer one's words or more, and reads only figures as values, not code spans.",
];

/** The line printed in place of the rows part N gives, when the weighing passed its limit. */
const NOT_WEIGHED = "Its searches for reworded units, new tables and values passed their limit, so it paired no reworded unit, read no new table and traced no value.";

/** The printed comparison of two texts. */
function printed(before: string, after: string): string[] {
  return formatComparison(compareVersions(before, after, null), PATHS).split("\n");
}

/** Each rewritten pair as its two texts, the words shared and the words of the longer. */
function rewritten(comparison: Comparison): Array<[string, string, number, number]> {
  return comparison.rewritten.map(pair => [pair.before.key, pair.after.key, pair.shared, pair.longer]);
}

/** Each value not found, as its kind and its text. */
function values(comparison: Comparison): Array<[string, string]> {
  return comparison.values.map(value => [value.kind, value.value]);
}

/** The values of the original a comparison of two texts lists as not found. */
function lost(before: string, after: string): string[] {
  return compareVersions(before, after, null).values.map(value => value.value);
}

/** The line of counts, with every count zero but those given. */
function counts(given: Partial<Record<"kept" | "rewritten" | "tables" | "dropped" | "added" | "values", number>>): string {
  const count = { kept: 0, rewritten: 0, tables: 0, dropped: 0, added: 0, values: 0, ...given };
  return `Kept ${count.kept}: moved 0, steps out of order 0. Rewritten ${count.rewritten}. Into new tables ${count.tables}. `
    + `Dropped ${count.dropped}. Added ${count.added}. Values not found ${count.values}. From the author 0. Marked gaps 0. `
    + "New headings 0. Headings gone 0. New labels 0. Labels gone 0.";
}

/** A fresh meter with the given limit. */
function meter(limit = WEIGHING_BUDGET): Meter {
  return { spent: 0, limit };
}

/** A sentence unit for each text, each a paragraph of its own, as a file of them separated by blank lines would give. */
function sentencesOf(texts: readonly string[]): Unit[] {
  return texts.map((key, index) => ({ kind: "sentence", line: 2 * index + 1, key, block: index }));
}

/** The steps pairing `count` reworded units takes, each unit pairing once. */
function spentFor(count: number): number {
  const before = Array.from({ length: count }, (unused, index) => ({ kind: "sentence" as const, line: index + 1, key: `Step ${index} now.`, block: index }));
  const after = Array.from({ length: count }, (unused, index) => ({ kind: "sentence" as const, line: index + 1, key: `Step ${index} today.`, block: index }));
  const counted = meter(Number.POSITIVE_INFINITY);
  expect(pairReworded(before, after, counted)?.length).toBe(count);
  return counted.spent;
}

/** A source of numbers from 0 to 1 that gives the same run for the same seed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * One of the items, drawn from `random`.
 *
 * @throws {Error} When there are no items.
 */
function pick<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("pick needs at least one item");
  return item;
}

/** Part 5's own plans example, as its skill gives it, before and after. */
const PLANS_BEFORE = "The Basic plan costs £5 per month and includes 10 GB of storage but no\npriority support, whereas the Pro plan is £15 per month with 100 GB and\n"
  + "priority support, and the Team plan, at £40 per month, offers 1 TB,\npriority support, and audit logs.\n";
const PLANS_AFTER = "Choose a plan based on storage and support needs:\n\n| Plan | Price / month | Storage | Priority support | Audit logs |\n"
  + "|------|---------------|---------|------------------|------------|\n| Basic | £5 | 10 GB | No | No |\n| Pro | £15 | 100 GB | Yes | No |\n| Team | £40 | 1 TB | Yes | Yes |\n";

describe("a reworded unit is paired with its original", () => {
  test("a unit left over that shares half the longer one's words or more is rewritten, and neither dropped nor added", () => {
    const comparison = compareVersions("Close the valve now.\n", "Close the valve today.\n", null);
    expect(rewritten(comparison)).toEqual([["Close the valve now.", "Close the valve today.", 3, 4]]);
    expect([comparison.dropped, comparison.added]).toEqual([[], []]);
    expect(printed("Close the valve now.\n", "Close the valve today.\n")).toEqual([
      ...HEAD,
      "| rewritten | 1 | 1 | Reworded, keeping 3 of 4 words. Confirm that it still says what the original said: \"Close the valve today.\", from \"Close the valve now.\" |",
      counts({ rewritten: 1 }),
      ...TAIL,
    ]);
  });

  test("half the longer one's words pairs, and less does not, counted against the longer of the two", () => {
    expect(rewritten(compareVersions("Lead with the outcome.\n", "Opening states the outcome.\n", null))).toEqual([["Lead with the outcome.", "Opening states the outcome.", 2, 4]]);
    expect(rewritten(compareVersions("Lead with the clear outcome.\n", "Opening states the outcome.\n", null))).toEqual([]);
    expect(rewritten(compareVersions("Opening states the outcome.\n", "Lead with the clear outcome.\n", null))).toEqual([]);
    const control = compareVersions("Lead with the clear outcome.\n", "Opening states the outcome.\n", null);
    expect([control.dropped.map(unit => unit.key), control.added.map(unit => unit.key)]).toEqual([["Lead with the clear outcome."], ["Opening states the outcome."]]);
  });

  test("two shared words are the least that pairs, so short units sharing one word stay dropped and added", () => {
    expect(rewritten(compareVersions("Close.\n", "Close it.\n", null))).toEqual([]);
    expect(rewritten(compareVersions("| Size |\n|---|\n| 10 GB |\n", "| Size |\n|---|\n| 100 GB |\n", null))).toEqual([]);
    expect(rewritten(compareVersions("Close it.\n", "Close it!\n", null))).toEqual([["Close it.", "Close it!", 2, 2]]);
  });

  test("a word counts as often as it stands, in any letter case, and punctuation and a bold label are not words", () => {
    expect(wordsOf("The the VALVE, café!")).toEqual(["the", "the", "valve", "café"]);
    expect(rewritten(compareVersions("The the valve.\n", "The valve valve.\n", null))).toEqual([["The the valve.", "The valve valve.", 2, 3]]);
    expect(rewritten(compareVersions("CLOSE THE VALVE.\n", "close the valve!\n", null))).toEqual([["CLOSE THE VALVE.", "close the valve!", 3, 3]]);
    expect(rewritten(compareVersions("**Purpose:** Close the valve now.\n", "Close the valve today.\n", null))).toEqual([["Purpose: Close the valve now.", "Close the valve today.", 3, 4]]);
  });

  test("a sentence, a list item, a table cell and an image alternative pair across kinds", () => {
    expect(rewritten(compareVersions("Close the valve now.\n", "- Close the valve today.\n", null))).toEqual([["Close the valve now.", "Close the valve today.", 3, 4]]);
    expect(rewritten(compareVersions("![Pressure chart for May](a.png)\n", "| Chart |\n|---|\n| Pressure chart for June |\n", null))).toEqual([["Pressure chart for May", "Pressure chart for June", 3, 4]]);
  });

  test("a heading, a code block, a slot and the author's wording never pair", () => {
    const headings = compareVersions("## Close the valve now\n\nText.\n", "## Close the valve today\n\nText.\n", null);
    expect([rewritten(headings), headings.newHeadings.length, headings.headingsGone.length]).toEqual([[], 1, 1]);
    const code = compareVersions("```\nclose the valve now\n```\n", "```\nclose the valve today\n```\n", null);
    expect([rewritten(code), code.dropped.length, code.added.length]).toEqual([[], 1, 1]);
    const slot = compareVersions("[Author needed: the valve now]\n", "[Author needed: the valve today]\n", null);
    expect([rewritten(slot), slot.dropped.length, slot.gaps.length]).toEqual([[], 1, 1]);
    const author = compareVersions("Close the valve now.\n", "Close the valve today.\n", "Close the valve today.\n");
    expect([rewritten(author), author.dropped.length, author.fromAuthor.length]).toEqual([[], 1, 1]);
  });

  test("the pair sharing the largest part of its words is taken first, and copies pair earliest first", () => {
    const steps = compareVersions("Run step one now. Run step two now.\n", "Run step two today. Run step one today.\n", null);
    expect(rewritten(steps)).toEqual([["Run step one now.", "Run step one today.", 3, 4], ["Run step two now.", "Run step two today.", 3, 4]]);
    const copies = compareVersions("Close the valve now.\n\nClose the valve now.\n", "Close the valve today.\n", null);
    expect(copies.rewritten.map(pair => pair.before.line)).toEqual([1]);
    expect(copies.dropped.map(unit => unit.line)).toEqual([3]);
  });

  test("two units sharing one word do not pair, even where that word is the rarer word of each", () => {
    const apart = compareVersions("Close valves.\n\nShut valves.\n\nFix valves.\n", "Close pumps.\n\nRun pumps.\n\nTest pumps.\n", null);
    expect(rewritten(apart)).toEqual([]);
    const together = compareVersions("Close the valves.\n\nShut valves.\n\nFix valves.\n", "Close the pumps.\n\nRun pumps.\n\nTest pumps.\n", null);
    expect(rewritten(together)).toEqual([["Close the valves.", "Close the pumps.", 2, 3]]);
  });

  test("taking the closest pair first can make fewer pairs than another pairing would", () => {
    // Pairing the first with the second new unit, and the second with the first, would make two pairs.
    const comparison = compareVersions("Close the red valve now.\n\nShut the red valve today.\n", "Close the red valve today.\n\nClose the blue pump now.\n", null);
    expect(rewritten(comparison)).toEqual([["Close the red valve now.", "Close the red valve today.", 4, 5]]);
    expect([comparison.dropped.map(unit => unit.key), comparison.added.map(unit => unit.key)]).toEqual([["Shut the red valve today."], ["Close the blue pump now."]]);
  });

  test("a label added to one copy of repeated wording keeps both copies, and pairs nothing", () => {
    const comparison = compareVersions("Close the valve.\n\nClose the valve.\n", "**Purpose:** Close the valve.\n\nClose the valve.\n", null);
    expect([comparison.kept.length, comparison.rewritten.length, comparison.newLabels.length, comparison.moved.length]).toEqual([2, 0, 1, 0]);
  });

  test("swapping the two versions pairs the same units", () => {
    const before = "Fit the new seal. Close the valve now. Read the gauge daily.\n";
    const after = "Close the valve today.\n\n- Fit the seal.\n- Read the gauge weekly.\n";
    const forward = rewritten(compareVersions(before, after, null));
    const backward = rewritten(compareVersions(after, before, null)).map(([first, second, shared, longer]) => [second, first, shared, longer]);
    expect(forward).toHaveLength(3);
    expect(backward.sort()).toEqual(forward.sort());
  });

  test("a reworded unit is not read for order, so moving it lists no move", () => {
    const comparison = compareVersions("Fit the seal. Check the lip. Close the valve now.\n", "Close the valve today. Fit the seal. Check the lip.\n", null);
    expect([comparison.kept.length, comparison.moved.length, comparison.rewritten.length]).toEqual([2, 0, 1]);
  });

  test("CRLF line endings, tabs, characters past the basic plane, a hard line break and a wrapped line pair as in plain text", () => {
    const plain = rewritten(compareVersions("Close the valve now 🙂.\n", "Close the valve today 🙂.\n", null));
    expect(plain).toEqual([["Close the valve now 🙂.", "Close the valve today 🙂.", 3, 4]]);
    expect(rewritten(compareVersions("Close the\tvalve now 🙂.\r\n", "Close the valve\\\ntoday 🙂.\r\n", null))).toEqual([["Close the valve now 🙂.", "Close the valve today 🙂.", 3, 4]]);
  });

  test("empty and identical files pair nothing and list no value", () => {
    for (const [before, after] of [["", ""], ["Keep 5 bar.\n", "Keep 5 bar.\n"], ["", "Close the valve.\n"], ["Close the valve 5 times.\n", ""]]) {
      const comparison = compareVersions(before ?? "", after ?? "", null);
      expect(comparison.rewritten).toEqual([]);
      expect(comparison.tables).toEqual([]);
    }
    expect(lost("Close the valve 5 times.\n", "")).toEqual(["5"]);
    expect(lost("Keep 5 bar.\n", "Keep 5 bar.\n")).toEqual([]);
  });

  test("the JSON report lists each rewritten pair with both lines, both excerpts and the words counted", () => {
    const report = comparisonReport(compareVersions("Text.\n\nClose the valve now.\n", "Close the valve today.\n", null), PATHS);
    expect(report.rewritten).toEqual([{ before: 3, after: 1, kind: "sentence", excerpt: "Close the valve today.", original: "Close the valve now.", shared: 3, words: 4 }]);
    expect(report.dropped).toEqual([{ line: 1, kind: "sentence", excerpt: "Text." }]);
    expect(report.weighed).toBe(true);
  });
});

describe("a value of the original that the new version does not hold", () => {
  test("a number from a reworded unit, found nowhere in the new version, is listed with both lines", () => {
    expect(printed("Keep it below 5 bar.\n", "Keep it below the limit.\n")).toEqual([
      ...HEAD,
      "| value | 1 | 1 | A number of the original is not found as written in the new version, nor as the same value in figures or words. Confirm that it was not cut or changed: \"5\" in \"Keep it below 5 bar.\" |",
      "| rewritten | 1 | 1 | Reworded, keeping 3 of 5 words. Confirm that it still says what the original said: \"Keep it below the limit.\", from \"Keep it below 5 bar.\" |",
      counts({ rewritten: 1, values: 1 }),
      ...TAIL,
    ]);
  });

  test("a number from a dropped unit is listed with no line in the new version", () => {
    expect(printed("Close the valve. Keep it below 5 bar.\n", "Close the valve.\n").slice(3, -3)).toEqual([
      "| dropped | 1 | | No unchanged copy is in the new version: \"Keep it below 5 bar.\" |",
      "| value | 1 | | A number of the original is not found as written in the new version, nor as the same value in figures or words. Confirm that it was not cut or changed: \"5\" in \"Keep it below 5 bar.\" |",
    ]);
  });

  test("a code span is not traced yet, so one whose text is gone lists no value, while a number beside it does", () => {
    const comparison = compareVersions("Run `npm test` 5 times before you merge.\n", "Run the tests before you merge.\n", null);
    expect(values(comparison)).toEqual([["number", "5"]]);
    expect(lost("Run `npm test` before you merge.\n", "Run the tests before you merge.\n")).toEqual([]);
    // Codex's second-round reproduction: the span's text stands in the HTML, split by a tag whose quoted attribute holds a `>`.
    expect(lost("Run `npm test` first.\n", "Run it first.\n\n<pre>np<span title=\">\">m</span> test</pre>\n")).toEqual([]);
  });

  test("a value found anywhere in the new version is not listed: in another unit, a new table or a code block", () => {
    expect(lost("Close the valve. Keep it below 5 bar.\n", "Close the valve.\n\nThe limit is 5 bar.\n")).toEqual([]);
    expect(lost("Keep it below 5 bar.\n", "Keep it low.\n\n| Limit | Pressure |\n|---|---|\n| 5 bar | high |\n")).toEqual([]);
    expect(lost("Keep it below 5 bar.\n", "Keep it low.\n\n```\nlimit 5\n```\n")).toEqual([]);
    expect(lost("Use port 8080 now.\n", "Use the port now. The port is `8080`.\n")).toEqual([]);
  });

  test("a number found in figures or words of the same value is not listed, and one written another way is", () => {
    const sameValue: Array<[string, string]> = [
      ["1,000", "1000"], ["1000", "1,000"], ["1 000", "1000"], ["1000", "1 000"], ["1.000", "1000"], ["2.50", "2.5"], ["05", "5"], ["1,5", "1.5"],
      ["50%", "50 per cent"], ["5", "five"], ["25", "twenty-five"], ["2000", "two thousand"], ["105", "one hundred and five"], ["3rd", "third"], ["12", "Twelve"],
    ];
    for (const [figure, written] of sameValue) {
      expect(lost(`It takes ${figure} days now.\n`, `It takes ${written} days today.\n`), `${figure} written as ${written}`).toEqual([]);
    }
    const anotherWay: Array<[string, string, string]> = [["0.5", "50%", "0.5"], ["5", "several", "5"], ["1.5", "15", "1.5"], ["1.13.0", "1.13", "1.13.0"], ["1 000", "2 000", "1 000"]];
    for (const [figure, written, value] of anotherWay) {
      expect(lost(`It takes ${figure} days now.\n`, `It takes ${written} days today.\n`), `${figure} written as ${written}`).toEqual([value]);
    }
  });

  test("a figure is found where its runs of digits stand in the same order with only marks or spaces between them", () => {
    const sameRuns: Array<[string, string]> = [["3,4", "3, 4"], ["10.30", "10:30"], ["2026-09-28", "2026/09/28"], ["1.2.3", "1 - 2 - 3"], ["4.2", "4|2"], ["3,4", "3,\n4"]];
    for (const [figure, written] of sameRuns) {
      expect(lost(`Use ${figure} now.\n`, `Use ${written} today.\n`), `${figure} written as ${written}`).toEqual([]);
    }
    // A word between the runs, other runs or another order is not the same figure.
    const notSame: Array<[string, string, string[]]> = [["4.2", "4 point 2", ["4.2"]], ["2.5", "2.7", ["2.5"]], ["10.30", "30.10", ["10.30"]], ["0.7.0", "0.7", ["0.7.0"]]];
    for (const [figure, written, listed] of notSame) {
      expect(lost(`Use ${figure} now.\n`, `Use ${written} today.\n`), `${figure} written as ${written}`).toEqual(listed);
    }
  });

  test("a date's month is found as the month's name, in full or cut to three letters", () => {
    expect(lost("Released on 2026-09-28 now.\n", "Released on 28 September 2026 today.\n")).toEqual([]);
    expect(lost("Released on 28/09/2026 now.\n", "Released on 28 Sep 2026 today.\n")).toEqual([]);
    expect(lost("Released on 2026-09-28 now.\n", "Released on 28 October 2026 today.\n")).toEqual(["09"]);
  });

  test("a value whose text stands anywhere in the new version is not listed, even inside a longer figure", () => {
    expect(lost("Read page 13 now.\n", "Read page 1.13.0 today.\n")).toEqual([]);
    expect(lost("Read clause 49 now.\n", "Read ISO 24495 today.\n")).toEqual([]);
    // Control: the same change with the text gone.
    expect(lost("Read page 13 now.\n", "Read page 1.14.0 today.\n")).toEqual(["13"]);
  });

  test("a number inside a code span is not read, and the span's own text is not traced", () => {
    expect(lost("Set `limit=1,000` now.\n", "Set `limit=1000` now.\n")).toEqual([]);
    expect(lost("Set `limit=1,000` now.\n", "Set the limit now.\n")).toEqual([]);
    expect(figureValues("Set limit=1,000 now.", [{ start: 4, end: 15 }]).map(value => value.text)).toEqual([]);
    // Control: the same figure outside a code span is read.
    expect(lost("Set limit=1,000 now.\n", "Set the limit now.\n")).toEqual(["1,000"]);
  });

  test("a code span that a full stop splits hides its numbers from every sentence it runs into", () => {
    const units = compareVersions("Run `a. b 5` now. Then stop here.\n", "", null).dropped;
    expect(units.map(unit => unit.key)).toEqual(["Run a.", "b 5 now.", "Then stop here."]);
    expect(lost("Run `a. b 5` now. Then stop here.\n", "")).toEqual([]);
    // Control: the same words with no code span.
    expect(lost("Run a. b 5 now. Then stop here.\n", "")).toEqual(["5"]);
  });

  test("a code span that ends its prose hides its numbers, as a list item or a table cell that is only code", () => {
    expect(lost("- `npm 5`\n", "- Run it.\n")).toEqual([]);
    expect(lost("| Command |\n|---|\n| `make 4` |\n", "| Command |\n|---|\n| make it |\n")).toEqual([]);
    expect(lost("Run `npm  5`\n", "Run it.\n")).toEqual([]);
    // Controls: the same units with no code span.
    expect(lost("- npm 5\n", "- Run it.\n")).toEqual(["5"]);
    expect(lost("| Command |\n|---|\n| make 4 |\n", "| Command |\n|---|\n| make it |\n")).toEqual(["4"]);
  });

  test("a character reference in the prose does not move a code span", () => {
    expect(lost("Use &#57344;fake&#57345; and `5 x` now.\n", "Use other now.\n")).toEqual([]);
    expect(lost("Use &#57344;fake&#57345; and 5 x now.\n", "Use other now.\n")).toEqual(["5"]);
    // Read from the source as written, four references would move the span sixteen places on, past the 5 and onto the 6.
    expect(lost("Use &amp;&amp;&amp;&amp; then `x 5` and 6 now.\n", "Use other now.\n")).toEqual(["6"]);
  });

  test("a code span in an image alternative is read as prose, and a number in it as a number", () => {
    expect(lost("![Set `limit=1000` now](x.png)\n", "![Set `limit=1,000` now](x.png)\n")).toEqual([]);
    expect(lost("![Set `limit=1000` now](x.png)\n", "![Set `limit=2000` now](x.png)\n")).toEqual(["1000"]);
    // Control: the same code span in a sentence hides its number.
    expect(lost("Set `limit=1000` now.\n", "Set `limit=2000` now.\n")).toEqual([]);
  });

  test("a value is looked for in the whole new file: image alternatives, link text and destinations, headings, HTML and character references", () => {
    const before = "Run the pump 4096 times first.\n";
    const places = [
      "![Run 4096](x.png)", "[4096](guide.md)", "[the guide](https://example.org/4096)", "## 4096", "<div>\n4096\n</div>",
      "<pre>\n<b>40</b>96\n</pre>", "---\ncount: &#52;096\n---", "Run `4096` there.",
    ];
    for (const place of places) {
      const after = place.startsWith("---") ? `${place}\n\nRun it first.\n` : `Run it first.\n\n${place}\n`;
      expect(lost(before, after), place).toEqual([]);
      expect(lost(before, after.replaceAll("96", "69")), `control: ${place}`).toEqual(["4096"]);
    }
  });

  test("a tag is read to the next angle bracket, so markup holding one can split a number a reader sees whole, but a number standing whole is held", () => {
    const before = "The total is 42 units.\n";
    // Each splits 42 with markup that holds an angle bracket, written or as a reference.
    for (const markup of ["<span title=\">\">", "<span title=\"&gt;\">", "<span title=\"<\">", "<!-- > -->"]) {
      expect(lost(before, `Something else.\n\n<pre>4${markup}2</pre>\n`), markup).toEqual(["42"]);
      expect(lost(before, `Something else.\n\n<pre>4${markup}2 and 42</pre>\n`), `${markup}, then 42 whole`).toEqual([]);
    }
    // Only tags are removed, not what a browser hides.
    expect(lost(before, "Something else.\n\n<pre>4<script>x</script>2</pre>\n")).toEqual(["42"]);
    // HTML text is searched for the number as written, not for its other forms; in prose the units hold them.
    expect(lost("The total is 2,500 units.\n", "Something else.\n\n<pre>2<b>500</b></pre>\n")).toEqual(["2,500"]);
    expect(lost("The total is 2,500 units.\n", "Something else.\n\n<pre>2&#53;00</pre>\n")).toEqual(["2,500"]);
    expect(lost("The total is 2,500 units.\n", "Something else, 2<b>500</b> in all.\n")).toEqual([]);
    // Controls: the same markup with no angle bracket inside is removed, and the number held.
    for (const markup of ["<span title=\"x\">", "<!-- x -->", "<b>"]) {
      expect(lost(before, `Something else.\n\n<pre>4${markup}2</pre>\n`), markup).toEqual([]);
    }
  });

  test("a value in a code block, a heading, a slot or a kept unit is not checked", () => {
    expect(lost("```\nport 8080\n```\n", "```\nport 9090\n```\n")).toEqual([]);
    expect(lost("## Step 4\n\nText.\n", "## Step five\n\nText.\n")).toEqual([]);
    expect(lost("[Author needed: 3 items]\n", "Text.\n")).toEqual([]);
    expect(lost("Keep 5 bar.\n", "Keep 5 bar.\n\nNothing else.\n")).toEqual([]);
  });

  test("a value counts as found however many times it stood", () => {
    expect(lost("Keep 5 bar now. Hold 5 bar later.\n", "Keep 5 bar now.\n")).toEqual([]);
  });

  test("a value not found is listed once for each unit it stands in, however often it stands there", () => {
    expect(lost("It was right on 14 of 14 headings.\n", "It was right on most headings.\n")).toEqual(["14"]);
    expect(lost("It was right on 14 of 14 headings.\n\nIt was wrong on 14 lines.\n", "It was right on most headings.\n")).toEqual(["14", "14"]);
    // The 14 inside the code span is not read, so only the other is listed.
    expect(lost("Set `14` on 14 of them.\n", "Set it on all of them.\n")).toEqual(["14"]);
  });

  test("figures that read as the same value are one value for their unit", () => {
    expect(lost("The threshold is 5 or 5.0 today.\n", "The threshold is absent today.\n")).toEqual(["5"]);
    expect(lost("The threshold is 5 or 05 today.\n", "The threshold is absent today.\n")).toEqual(["5"]);
    // Control: two values are two.
    expect(lost("The threshold is 5 or 6.0 today.\n", "The threshold is absent today.\n")).toEqual(["5", "6.0"]);
  });

  test("a figure is read from its first digit, and number words are read up to the billions", () => {
    expect(lost("Apply .5 litres now.\n", "Apply 0.5 litres today.\n")).toEqual([]);
    expect(lost("Apply .5 litres now.\n", "Apply half a litre today.\n")).toEqual(["5"]);
    expect(lost("Pay 1000000000 pounds now.\n", "Pay one billion pounds today.\n")).toEqual([]);
    expect(lost("Pay 1000000000000 pounds now.\n", "Pay one trillion pounds today.\n")).toEqual(["1000000000000"]);
  });

  test("a value in the new version's front matter, a link destination or an HTML block is found", () => {
    expect(lost("Read issue 22 today.\n", "---\nissue: 22\n---\n\nRead the issue today.\n")).toEqual([]);
    expect(lost("Read issue 22 today.\n", "Read [the issue](https://example.org/22) today.\n")).toEqual([]);
    expect(lost("Run the pump 12 times today.\n", "<pre>\npump 12\n</pre>\n\nRun it today.\n")).toEqual([]);
  });

  test("outside every unit, a number is held by its value too: in other figures, in words or by its runs", () => {
    // Front matter and an HTML block hold no unit, so only the whole file can hold these.
    const held: Array<[string, string]> = [["1,000", "---\ndays: 1000\n---"], ["5", "---\ndays: five\n---"], ["10.30", "<pre>\nopen 10:30\n</pre>"]];
    for (const [number, place] of held) {
      const after = place.startsWith("---") ? `${place}\n\nIt takes long today.\n` : `It takes long today.\n\n${place}\n`;
      expect(lost(`It takes ${number} days now.\n`, after), place).toEqual([]);
    }
    // Control: another value there is not the same number.
    expect(lost("It takes 1,000 days now.\n", "---\ndays: 2000\n---\n\nIt takes long today.\n")).toEqual(["1,000"]);
  });

  test("a figure grouped by spaces is held where each of its groups stands as a number, because the space may part two numbers", () => {
    expect(lost("Score 3 500 now.\n", "Score 3 then 500 today.\n")).toEqual([]);
    expect(lost("Score 3 500 now.\n", "Score 3500 today.\n")).toEqual([]);
    // Control: one group gone.
    expect(lost("Score 3 500 now.\n", "Score 3 then 600 today.\n")).toEqual(["3 500"]);
  });

  test("a reworded unit whose values all survive lists no value", () => {
    const comparison = compareVersions("Keep it below 5 bar with `valve-a` shut.\n", "Keep it under 5 bar, with `valve-a` shut.\n", null);
    expect([comparison.rewritten.length, comparison.values.length]).toEqual([1, 0]);
  });

  test("the JSON report lists each value with its lines, kind and text", () => {
    const report = comparisonReport(compareVersions("Keep it below 5 bar.\n\nRun `npm test` 3 times first.\n", "Keep it below the limit.\n", null), PATHS);
    expect(report.values).toEqual([
      { before: 1, after: 1, kind: "number", value: "5", excerpt: "Keep it below 5 bar." },
      { before: 3, after: null, kind: "number", value: "3", excerpt: "Run npm test 3 times first." },
    ]);
  });
});

describe("number words and figures", () => {
  test("a run of English number words gives its value, and each word gives its own", () => {
    expect([...numberWords("It took twenty-five days, then one hundred and five, then a third.")].sort()).toEqual(["1", "100", "105", "20", "25", "3", "5"]);
    expect([...numberWords("Two thousand and ten people; the second.")].sort()).toEqual(["10", "1000", "2", "2000", "2010"]);
    expect([...numberWords("No numbers here.")]).toEqual([]);
    expect([...numberWords("Due in Sep, or by May, or in SEPTEMBER, but not in a separate month.")].sort()).toEqual(["5", "9"]);
    expect([...numberWords("It may close in march or sept, said the separate note.")]).toEqual([]);
  });

  test("a figure is read with either mark as the decimal point where the other groups digits in threes", () => {
    expect(figureValues("From 1,000.5 to 1.000,5 and 0.7.0 then 1 000 000.", []).map(value => [value.text, [...value.readings].sort()])).toEqual([
      ["1,000.5", ["1000.5"]], ["1.000,5", ["1000.5"]], ["0.7.0", ["0.7.0"]], ["1 000 000", ["1000000"]],
    ]);
  });

  test("a value is found in figures, in words or as text the new version holds", () => {
    const after = foundIn(["It takes five days.", "Use version 1.13.0 now."], "", meter());
    expect(after.number(figureValues("5", [])[0]?.readings ?? new Set())).toBe(true);
    expect(after.number(new Set(["6"]))).toBe(false);
    expect(after.text("13")).toBe(true);
    expect(after.text("14")).toBe(false);
  });
});

describe("a unit turned into a new table", () => {
  test("Part 5's own plans example prints once, as restructured or rewritten, with every value traced into the table", () => {
    const comparison = compareVersions(PLANS_BEFORE, PLANS_AFTER, null);
    expect(comparison.tables.map(table => [table.sources.map(unit => unit.line), table.cells.length, table.inTable, table.elsewhere, table.notFound])).toEqual([[[1], 20, 6, 0, 0]]);
    expect(printed(PLANS_BEFORE, PLANS_AFTER).slice(3)).toEqual([
      "| added | | 1 | Not in the original or the author's wording. Confirm its source: \"Choose a plan based on storage and support needs:\" |",
      "| restructured or rewritten | 1 | 3 | A unit of the original shares at least half of its different words with a new table of 20 units, which are not listed one by one. "
        + "Confirm that nothing was cut or reworded. Its numbers: 6 in the table, 0 elsewhere in the new version, 0 not found: "
        + "\"The Basic plan costs £5 per month and includes 10 GB of stor...\" |",
      counts({ tables: 1, added: 1 }),
      ...TAIL,
    ]);
  });

  test("a unit is read with a table only with at least half, and at least two, of its different words there", () => {
    // A quarter of the unit's twelve different words is in the table, and every word of the table is from the unit.
    expect(compareVersions("The Basic plan costs £5 per month for every user in the team.\n", "| Plan | Basic | £5 |\n|---|---|---|\n", null).tables).toEqual([]);
    expect(compareVersions("The Basic plan costs £5 now.\n", "| Plan | Basic | £5 |\n|---|---|---|\n", null).tables.map(table => table.sources.length)).toEqual([1]);
    // One word is too few, even when it is all the unit holds.
    expect(compareVersions("Done.\n", "| Done | Done |\n|---|---|\n", null).tables).toEqual([]);
    expect(compareVersions("Done twice.\n", "| Done | twice |\n|---|---|\n", null).tables.map(table => table.sources.length)).toEqual([1]);
  });

  test("a table of one unit is not a new table, however many of a unit's words it holds", () => {
    expect(compareVersions("Basic plan now.\n", "| plan plan plan basic basic |\n|---|\n", null).tables).toEqual([]);
    expect(compareVersions("Basic plan now.\n", "| plan plan plan basic basic | x |\n|---|---|\n", null).tables.map(table => table.cells.length)).toEqual([2]);
  });

  test("two units turned into one new table print one row, which says each shares at least half of its words with it", () => {
    const lines = printed("The Basic plan costs £5 per month.\n\nThe Pro plan costs £15 per month.\n", "| Plan | Price per month |\n|---|---|\n| Basic | £5 |\n| Pro | £15 |\n");
    expect(lines.slice(3)).toEqual([
      "| restructured or rewritten | 1 | 1 | 2 units of the original each share at least half of their different words with a new table of 6 units, which are not listed one by one. "
        + "Confirm that nothing was cut or reworded. Their numbers: 2 in the table, 0 elsewhere in the new version, 0 not found: \"The Basic plan costs £5 per month.\" |",
      counts({ tables: 2 }),
      ...TAIL,
    ]);
  });

  test("a value of the unit outside the table is counted as elsewhere, and one found nowhere is a value row", () => {
    const after = PLANS_AFTER.replace("| £40 |", "| £45 |").replace("Choose a plan", "Choose one of 40 plans");
    const comparison = compareVersions(PLANS_BEFORE.replace("1 TB", "1 TB for 7 users"), after, null);
    expect(comparison.tables.map(table => [table.inTable, table.elsewhere, table.notFound])).toEqual([[5, 1, 1]]);
    expect(values(comparison)).toEqual([["number", "7"]]);
    expect(comparison.values[0]?.after).toBe(3);
    // Two numbers elsewhere and one nowhere, so the two counts cannot be swapped unseen.
    const moreAfter = after.replace("| £15 |", "| £16 |").replace("40 plans", "40 plans, from 15 offers,");
    expect(compareVersions(PLANS_BEFORE.replace("1 TB", "1 TB for 7 users"), moreAfter, null).tables.map(table => [table.inTable, table.elsewhere, table.notFound])).toEqual([[4, 2, 1]]);
  });

  test("a table that keeps a unit of the original, or holds one unit, is not read with a unit", () => {
    const keeps = compareVersions(`${PLANS_BEFORE}\n| Basic |\n|---|\n`, `${PLANS_AFTER.replace("| Plan |", "| Basic |")}`, null);
    expect([keeps.tables.length, keeps.dropped.length]).toEqual([0, 1]);
    const one = compareVersions("Close the valve now and then.\n", "| Close the valve today |\n|---|\n", null);
    expect(one.tables).toEqual([]);
  });

  test("a unit with less than half its different words in the table, or a table with less than half its words from the units, is not read so", () => {
    const few = compareVersions("The Basic plan costs a modest sum each month for small teams who work alone.\n", "| Plan | Price |\n|---|---|\n| Basic | £5 |\n", null);
    expect([few.tables.length, few.dropped.length]).toEqual([0, 1]);
    const wide = compareVersions("The Basic plan costs £5.\n", "| Plan | Price | Owner | Region | Renewal |\n|---|---|---|---|---|\n| Basic | £5 | Ann | North | May |\n", null);
    expect([wide.tables.length, wide.dropped.length]).toEqual([0, 1]);
    const control = compareVersions("The Basic plan costs £5.\n", "| Plan | Price |\n|---|---|\n| Basic | £5 |\n", null);
    expect([control.tables.length, control.dropped.length]).toEqual([1, 0]);
  });

  test("the JSON report lists each table read with units of the original", () => {
    const report = comparisonReport(compareVersions(PLANS_BEFORE, PLANS_AFTER, null), PATHS);
    expect(report.tables).toEqual([{ before: [1], after: 3, units: 20, excerpt: "The Basic plan costs £5 per month and includes 10 GB of stor", values: { inTable: 6, elsewhere: 0, notFound: 0 } }]);
  });
});

describe("weighing has a limit", () => {
  test("past the limit nothing pairs, no table is read and no value is listed, and the comparison says so", () => {
    const before = "Close the valve 5 times.\n\n".repeat(2_500);
    const after = "Close the valve now please.\n\n".repeat(2_500);
    const comparison = compareVersions(before, after, null);
    expect([comparison.weighed, comparison.rewritten.length, comparison.values.length, comparison.dropped.length, comparison.added.length]).toEqual([false, 0, 0, 2_500, 2_500]);
    expect(formatComparison(comparison, PATHS).split("\n").slice(-3)).toEqual([counts({ dropped: 2_500, added: 2_500 }), TAIL[0] ?? "", NOT_WEIGHED]);
    expect(comparisonReport(comparison, PATHS).weighed).toBe(false);
    const under = compareVersions("Close the valve 5 times.\n\n".repeat(1_000), "Close the valve now please.\n\n".repeat(1_000), null);
    expect([under.weighed, under.rewritten.length]).toEqual([true, 1_000]);
  });

  test("a lookup that passes the limit answers null, and a comparison whose value search does so weighs nothing", () => {
    expect(foundIn(["A line holding w and x and more words."], "", meter(5)).text("7001")).toBeNull();
    const runs = foundIn(["Open at 10:30."], "", meter(0));
    expect(runs.runs(["10", "30"])).toBeNull();
    const figure = figureValues("10.30", [])[0];
    expect(figure === undefined ? "no figure" : figureFound(figure, runs)).toBeNull();
    // Ten numbers that stand in none of 2,000 long lines, so each is read for in every line.
    const numbers = ["7001", "7002", "7003", "7004", "7005", "7006", "7007", "7008", "7009", "7010"];
    const before = numbers.map(number => `Run ${number} now.`).join("\n\n");
    const line = `Then ${"w and x and y and z, ".repeat(48)}end.`;
    const comparison = compareVersions(`${before}\n`, `${Array.from({ length: 2_000 }, () => line).join("\n\n")}\n`, null);
    expect([comparison.weighed, comparison.values.length, comparison.dropped.length]).toEqual([false, 0, 10]);
    const fewer = compareVersions(`${before}\n`, `${Array.from({ length: 20 }, () => line).join("\n\n")}\n`, null);
    expect([fewer.weighed, fewer.values.length]).toEqual([true, 10]);
  });

  test("two versions of 100,000 units each, alike but for one reworded unit, are weighed, and the reworded unit pairs", () => {
    const keys = Array.from({ length: 100_000 }, (unused, index) => `Sentence ${index} says the valve shuts before the pump starts.`);
    const same = compareUnits(sentencesOf(keys), sentencesOf(keys), [], keys.join("\n\n"));
    expect([same.weighed, same.kept.length, same.rewritten.length, same.values.length]).toEqual([true, 100_000, 0, 0]);
    const changed = [...keys];
    changed[500] = "Sentence 500 says the valve shuts before the pump starts again.";
    const one = compareUnits(sentencesOf(keys), sentencesOf(changed), [], changed.join("\n\n"));
    expect([one.weighed, one.kept.length, one.rewritten.length, one.values.length, one.dropped.length, one.added.length]).toEqual([true, 99_999, 1, 0, 0, 0]);
  });

  test("pairing 100,000 reworded units takes steps in proportion to their words", () => {
    const before = Array.from({ length: 100_000 }, (unused, index) => ({ kind: "sentence" as const, line: index + 1, key: `Step ${index} now.`, block: index }));
    const after = Array.from({ length: 100_000 }, (unused, index) => ({ kind: "sentence" as const, line: index + 1, key: `Step ${99_999 - index} today.`, block: index }));
    const counted = meter(Number.POSITIVE_INFINITY);
    const pairs = pairReworded(before, after, counted);
    expect(pairs?.length).toBe(100_000);
    // Each unit holds 3 words. Building, indexing, probing and checking each read every word a fixed number of times.
    expect(counted.spent).toBeLessThan(40 * 600_000);
  });

  test("a unit's code spans are set aside from its figures in one pass, so 64,000 of them take well under a second", () => {
    const text = `Run ${"abc ".repeat(64_000)}now.`;
    const spans = Array.from({ length: 64_000 }, (unused, index) => ({ start: 4 + 4 * index, end: 7 + 4 * index }));
    const started = performance.now();
    const read = figureValues(text, spans);
    const elapsed = performance.now() - started;
    // Copying the whole unit once for each span took more than two seconds here; one pass takes a few milliseconds.
    expect([read.length, elapsed < 500]).toEqual([0, true]);
  });

  test("a paragraph of 32,000 code spans is compared, and only the number outside them traced", () => {
    const comparison = compareVersions(`Run ${"`abc 5` ".repeat(32_000)}now 7.\n`, "", null);
    expect([comparison.weighed, comparison.values.map(value => value.value)]).toEqual([true, ["7"]]);
  });

  test("the steps of pairing grow in proportion to the units, not with their square", () => {
    // Twice the units in the square of their number would take four times the steps.
    expect(spentFor(40_000) / spentFor(20_000)).toBeLessThan(2.5);
  });
});

describe("on random documents", () => {
  test("every unit is read once, each pair shares half the longer one's words, and a value is listed only when the new version holds it nowhere", () => {
    const random = seeded(24495);
    const subjects = ["valve", "pump", "seal", "gauge"];
    const verbs = ["Close", "Open", "Check", "Fit"];
    const tails = ["now", "today", "with care", "at once", "before noon"];
    const numbers = ["5", "12", "1,000", "2.5", "50%"];
    const spans = ["`npm test`", "`make all`", "`x=1`"];
    for (let trial = 0; trial < 400; trial++) {
      const count = 2 + Math.floor(random() * 5);
      const sentences = Array.from({ length: count }, () => {
        const value = random() < 0.5 ? ` ${pick(numbers, random)} times` : "";
        const span = random() < 0.3 ? ` with ${pick(spans, random)}` : "";
        const label = random() < 0.2 ? "**Note:** " : "";
        return `${label}${pick(verbs, random)} the ${pick(subjects, random)}${value}${span} ${pick(tails, random)}.`;
      });
      const changed = sentences.map(sentence => {
        const roll = random();
        if (roll < 0.3) return sentence;
        if (roll < 0.5) return sentence.replace(/ (now|today|with care|at once|before noon)\.$/, ` ${pick(tails, random)}.`);
        if (roll < 0.65) return sentence.replace(/ \d[\d.,%]*/, ` ${pick(numbers, random)}`);
        if (roll < 0.75) return sentence.replace(/`[^`]*`/, pick(spans, random));
        if (roll < 0.85) return sentence.startsWith("**Note:** ") ? sentence.slice(10) : `**Purpose:** ${sentence}`;
        return random() < 0.5 ? sentence : `${pick(verbs, random)} it.`;
      });
      const doubled = random() < 0.3 ? [...changed, changed[0] ?? ""] : changed;
      const asList = random() < 0.4;
      const asTable = !asList && random() < 0.2;
      const after = asTable ? `| Step |\n|---|\n${doubled.map(sentence => `| ${sentence} |`).join("\n")}\n` : `${doubled.map(sentence => (asList ? `- ${sentence}` : sentence)).join("\n\n")}\n`;
      const before = `${sentences.join("\n\n")}\n`;
      const comparison = compareVersions(before, after, null);
      const label = `${before} -> ${after}`;
      const read = [...comparison.kept.map(pair => pair.before), ...comparison.rewritten.map(pair => pair.before), ...comparison.tables.flatMap(table => table.sources), ...comparison.dropped];
      expect(read.length, label).toBe(comparison.before.length);
      expect(new Set(read).size, label).toBe(comparison.before.length);
      for (const pair of comparison.rewritten) {
        expect(pair.shared * 2 >= pair.longer && pair.shared >= 2, label).toBe(true);
      }
      // A value listed is not in the new version as a whole figure.
      const plainAfter = `${comparison.after.map(unit => unit.key).join(" ")} ${after}`;
      const figures = new Set(plainAfter.match(/\d+(?:[.,]\d+)*/g) ?? []);
      for (const value of comparison.values) {
        expect(figures.has(value.value), `${label}: ${value.value}`).toBe(false);
      }
    }
  });

  test("the pairs are those weighing every unit against every other gives, every value the new version cannot hold is listed, and no value it holds is", () => {
    const random = seeded(5_2026);
    const subjects = ["valve", "pump", "seal", "gauge"];
    const verbs = ["Close", "Open", "Check", "Fit"];
    const tails = ["now", "today", "with care", "at once", "before noon"];
    const numbers = ["5", "12", "1,000", "2.5", "50%", "10.30", "09"];
    // Each number written another way that holds the same value, by its runs of digits or by a month's name too.
    const sameValue: Readonly<Record<string, readonly string[]>> = {
      "5": ["five", "05"], "12": ["twelve", "Dec"], "1,000": ["1000", "one thousand", "1 000"], "2.5": ["2,5", "2 - 5"], "50%": ["50 per cent", "fifty per cent"], "10.30": ["10:30", "10, 30"], "09": ["September", "9"],
    };
    // A code span with a full stop splits its sentence, and one with two spaces is read with one.
    const spans = ["npm test", "make all", "x=1", "a. b", "echo  foo"];
    // Character references, one of them a character the comparison once used as a mark of its own.
    const references = ["&#57344;x&#57345; ", "&amp; ", "&#xE001; "];
    // Each of the after file's places, other than a unit of prose, that a value can stand in.
    const places: ReadonlyArray<(value: string) => string> = [
      value => `![See ${value} here](x.png)`, value => `[${value}](guide.md)`, value => `[the guide](<${value}.md>)`, value => `## ${value}`,
      value => `<div>\n${value}\n</div>`, value => `<pre>\n<b>${value.slice(0, 1)}</b>${value.slice(1)}\n</pre>`,
      value => `<div>\n${[...value].map(character => `&#${character.codePointAt(0)};`).join("")}\n</div>`,
    ];
    const figures = numbers.map(number => number.replace("%", ""));
    let paired = 0;
    let listed = 0;
    let tablesRead = 0;
    let cleared = 0;
    let traced = 0;
    // What each axis of the generator gives the comparison to read, counted from what it read.
    let tailsChanged = 0;
    let itemPairs = 0;
    let cellPairs = 0;
    let copiesPaired = 0;
    let labelled = 0;
    for (let trial = 0; trial < 1_000; trial++) {
      const count = 2 + Math.floor(random() * 6);
      const drawn = Array.from({ length: count }, () => {
        // Most sentences hold a number, so the run lists and clears enough of them.
        const value = random() < 0.8 ? ` ${pick(numbers, random)} times` : "";
        const span = random() < 0.3 ? ` with \`${pick(spans, random)}\`` : "";
        const label = random() < 0.2 ? "**Note:** " : "";
        const reference = random() < 0.15 ? pick(references, random) : "";
        return `${label}${reference}${pick(verbs, random)} the ${pick(subjects, random)}${value}${span} ${pick(tails, random)}.`;
      });
      const sentences = random() < 0.25 ? [...drawn, drawn[0] ?? ""] : drawn;
      const moved: string[] = [];
      const changed = sentences.map(sentence => {
        const roll = random();
        if (roll < 0.25) return sentence;
        if (roll < 0.4) return sentence.replace(/ (now|today|with care|at once|before noon)\.$/, ` ${pick(tails, random)}.`);
        if (roll < 0.5) return sentence.replace(/ \d[\d.,%]*/, ` ${pick(numbers, random)}`);
        if (roll < 0.6) return sentence.replace(/ (\d[\d.,%]*)/, (whole, figure: string) => ` ${pick(sameValue[figure] ?? [figure], random)}`);
        if (roll < 0.67) return sentence.replace(/`[^`]*`/, `\`${pick(spans, random)}\``);
        if (roll < 0.74) {
          return sentence.replace(/ with `([^`]*)`/, (whole, code: string) => {
            moved.push(code);
            return "";
          });
        }
        if (roll < 0.84) return sentence.startsWith("**Note:** ") ? sentence.slice(10) : `**Purpose:** ${sentence}`;
        return random() < 0.5 ? sentence : `${pick(verbs, random)} it.`;
      });
      const doubled = random() < 0.3 ? [...changed, changed[0] ?? ""] : changed;
      // One sentence with its words split across the cells of a new table, as Part 5's plans example splits one.
      const split = doubled.length > 1 && random() < 0.35 ? Math.floor(random() * doubled.length) : -1;
      const rest = doubled.filter((unused, index) => index !== split);
      const asList = random() < 0.35;
      const asTable = !asList && random() < 0.25;
      const heading = random() < 0.3 ? `## ${pick(verbs, random)} the ${pick(subjects, random)}\n\n` : "";
      const body = asTable ? `| Step |\n|---|\n${rest.map(sentence => `| ${sentence} |`).join("\n")}\n` : `${rest.map(sentence => (asList ? `- ${sentence}` : sentence)).join("\n\n")}\n`;
      const splitTable = split === -1 ? "" : `\n${splitIntoTable(doubled[split] ?? "")}`;
      const block = moved.length > 0 ? `\n\`\`\`\n${moved.join("\n")}\n\`\`\`\n` : "";
      const ends = random() < 0.25 ? "\r\n" : "\n";
      const before = `${random() < 0.3 ? `## ${pick(verbs, random)} the ${pick(subjects, random)}\n\n` : ""}${sentences.join("\n\n")}\n`.replaceAll("\n", ends);
      // A value of the original, put again in a place of the new version that is not a unit of prose.
      const valuesBefore = sentences.flatMap(sentence => sentence.replace(/`[^`]*`/g, " ").match(/\d[\d.,]*/g) ?? []);
      const placed = valuesBefore.length > 0 && random() < 0.7 ? pick(valuesBefore, random) : null;
      const afterBody = `${heading}${body}${splitTable}${block}`;
      const after = `${afterBody}${placed === null ? "" : `\n${pick(places, random)(placed)}\n`}`.replaceAll("\n", ends);
      const comparison = compareVersions(before, after, null);
      const label = JSON.stringify([before, after]);
      // A value is listed only when its text stands nowhere in the new file as written, with its numeric references decoded, or in its units, and only as the original wrote it.
      const plain = plainTexts(after, comparison.after);
      for (const value of comparison.values) {
        expect(plain.some(text => text.includes(value.value)), `${label}: ${value.value} stands in the new version`).toBe(false);
        expect(figures.includes(value.value), `${label}: ${value.value} is not a figure the original wrote outside a code span`).toBe(true);
      }
      if (placed !== null && compareVersions(before, afterBody.replaceAll("\n", ends), null).values.some(value => value.value === placed)) {
        expect(comparison.values.some(value => value.value === placed), `${label}: ${placed}`).toBe(false);
        cleared++;
      }
      // A character reference beside a code span, where a span placed by another reading would hide the wrong figures.
      if (/&[#a-z]/.test(before) && before.includes("`") && comparison.values.length > 0) traced++;
      // Every unit of either version not kept, as the comparison held them before it paired any.
      const left = inOrderOf([...comparison.dropped, ...comparison.rewritten.map(pair => pair.before), ...comparison.tables.flatMap(table => table.sources)], comparison.before);
      const over = inOrderOf([...comparison.added, ...comparison.rewritten.map(pair => pair.after), ...comparison.tables.flatMap(table => table.cells)], comparison.after);
      const made = comparison.rewritten.map(pair => [pair.before.line, pair.before.key, pair.after.line, pair.after.key]);
      expect(made, label).toEqual(pairsByHand(left, over).map(([one, other]) => [one.line, one.key, other.line, other.key]));
      paired += made.length;
      tablesRead += comparison.tables.length;
      const beforeKeys = comparison.before.map(unit => unit.key);
      const afterKeys = comparison.after.map(unit => unit.key);
      for (const pair of comparison.rewritten) {
        if (pair.before.key.split(" ").at(-1) !== pair.after.key.split(" ").at(-1)) tailsChanged++;
        if (pair.after.kind === "item") itemPairs++;
        if (pair.after.kind === "cell") cellPairs++;
        if (beforeKeys.filter(key => key === pair.before.key).length > 1 || afterKeys.filter(key => key === pair.after.key).length > 1) copiesPaired++;
        if (pair.before.label !== undefined || pair.after.label !== undefined) labelled++;
      }
      // Each value of a unit not kept that nothing in the new version could be read as must be listed.
      const listedHere = new Set(comparison.values.map(value => `${value.unit.line} ${value.unit.key} ${value.value}`));
      const oracle = oracleTexts(after, comparison.after);
      for (const unit of [...comparison.dropped.filter(isProse), ...comparison.rewritten.map(pair => pair.before), ...comparison.tables.flatMap(table => table.sources)]) {
        for (const value of figuresOutside(unit.key, spans)) {
          if (cannotHold(oracle, value)) {
            expect(listedHere.has(`${unit.line} ${unit.key} ${value}`), `${label}: ${value}`).toBe(true);
            listed++;
          }
        }
      }
    }
    // The run must exercise every check, and every axis of the generator, or it tests nothing.
    expect(paired).toBeGreaterThan(300);
    expect(listed).toBeGreaterThan(100);
    expect(tablesRead).toBeGreaterThan(10);
    expect(cleared).toBeGreaterThan(30);
    expect(traced).toBeGreaterThan(10);
    expect(tailsChanged).toBeGreaterThan(200);
    expect(Math.min(itemPairs, cellPairs)).toBeGreaterThan(80);
    expect(copiesPaired).toBeGreaterThan(50);
    expect(labelled).toBeGreaterThan(60);
  });
});

/** A sentence's words two to a cell, as the header row of a new table. */
function splitIntoTable(sentence: string): string {
  const words = sentence.replace(/\.$/, "").split(" ");
  const cells = Array.from({ length: Math.ceil(words.length / 2) }, (unused, index) => words.slice(2 * index, 2 * index + 2).join(" "));
  return `| ${cells.join(" | ")} |\n|${cells.map(() => "---").join("|")}|\n`;
}

/** Whether a unit can be paired or hold a value looked for, for the random documents here, which hold no slot. */
function isProse(unit: Unit): boolean {
  return unit.kind === "sentence" || unit.kind === "item" || unit.kind === "cell" || unit.kind === "alternative";
}

/** The units given, in the order they stand among all the units of their version. */
function inOrderOf(units: readonly Unit[], all: readonly Unit[]): Unit[] {
  return all.filter(unit => units.includes(unit));
}

/** Each unit that `isProse` accepts, with where it stands among the units given. */
function proseAt(units: readonly Unit[]): Array<[Unit, number]> {
  return units.flatMap((unit, position): Array<[Unit, number]> => (isProse(unit) ? [[unit, position]] : []));
}

/** A unit's words after its label, as the pairing counts them. */
function wordsAfterLabel(unit: Unit): string[] {
  return wordsOf(unit.label === undefined ? unit.key : unit.key.slice(unit.label.length + 1));
}

/** How many words two lists share, each counted as often as it stands in both. */
function sharedWords(first: readonly string[], second: readonly string[]): number {
  const left = new Map<string, number>();
  for (const word of first) {
    left.set(word, (left.get(word) ?? 0) + 1);
  }
  let shared = 0;
  for (const word of second) {
    const held = left.get(word) ?? 0;
    if (held > 0) {
      shared++;
      left.set(word, held - 1);
    }
  }
  return shared;
}

/**
 * The pairs `pairReworded` describes, found by weighing every unit of the
 * original left over against every unit of the new version left over.
 */
function pairsByHand(before: readonly Unit[], after: readonly Unit[]): Array<[Unit, Unit]> {
  const candidates: Array<{ one: number; other: number; shared: number; longer: number }> = [];
  for (const [unit, one] of proseAt(before)) {
    for (const [otherUnit, other] of proseAt(after)) {
      const shared = sharedWords(wordsAfterLabel(unit), wordsAfterLabel(otherUnit));
      const longer = Math.max(wordsAfterLabel(unit).length, wordsAfterLabel(otherUnit).length);
      if (shared >= 2 && 2 * shared >= longer) candidates.push({ one, other, shared, longer });
    }
  }
  candidates.sort((first, second) => second.shared / second.longer - first.shared / first.longer || second.shared - first.shared || first.one - second.one || first.other - second.other);
  const pairs: Array<[Unit, Unit]> = [];
  const taken = new Set<number>();
  const takenAfter = new Set<number>();
  for (const candidate of candidates) {
    const one = before[candidate.one];
    const other = after[candidate.other];
    if (one === undefined || other === undefined || taken.has(candidate.one) || takenAfter.has(candidate.other)) continue;
    taken.add(candidate.one);
    takenAfter.add(candidate.other);
    pairs.push([one, other]);
  }
  return pairs.sort((first, second) => before.indexOf(first[0]) - before.indexOf(second[0]));
}

/** The figures of a unit's text once the given code texts are taken out of it. */
function figuresOutside(text: string, codes: readonly string[]): string[] {
  let plain = text;
  for (const code of codes) {
    plain = plain.replaceAll(code, " ");
  }
  return plain.match(/\d+(?:[.,]\d+)*/g) ?? [];
}

/** English number words, any of which could hold a number's value. */
const NUMBER_WORD = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|half|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i;

/** Text with each run of white space made one space. */
function singleSpace(text: string): string {
  return text.replace(/\s+/gu, " ");
}

/**
 * The new file as written, with its numeric character references decoded,
 * and as the units the comparison read. A figure whose text stands in one of
 * these is in the new version without reading any HTML, so no row may name it.
 */
function plainTexts(source: string, units: readonly Unit[]): string[] {
  return [source, source.replace(/&#(\d+);/g, (whole, code: string) => String.fromCodePoint(Number(code))), units.map(unit => unit.key).join(" ")];
}

/**
 * The new file as the random documents here can hold a value in it: the
 * texts `plainTexts` gives, and the decoded text with its tags removed too,
 * each with its white space made single. The documents hold no `<` or `>`
 * inside a tag, so removing each run from `<` to the next `>` removes their tags.
 */
function oracleTexts(source: string, units: readonly Unit[]): string[] {
  const [raw = "", decoded = "", keys = ""] = plainTexts(source, units);
  return [raw, decoded, decoded.replace(/<[^<>]*>/g, ""), keys].map(singleSpace);
}

/**
 * Whether nothing in the new version could be read as a number: its text
 * stands nowhere in the texts `oracleTexts` gives, no run of its digits, nor
 * all its digits joined, stands as a run of digits there, and no number word
 * does.
 */
function cannotHold(oracle: readonly string[], value: string): boolean {
  const text = oracle.join("\n");
  if (text.includes(value)) return false;
  const runs = new Set((text.match(/\d+/g) ?? []).map(run => run.replace(/^0+(?=\d)/, "")));
  const digits = [...(value.match(/\d+/g) ?? []), value.replace(/\D/g, "")];
  return !NUMBER_WORD.test(text) && digits.every(run => !runs.has(run.replace(/^0+(?=\d)/, "")));
}
