import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { identifierOf, uncitedNumberingViolations, type HeadingNumbers } from "../../scripts/lib/numbering.ts";
import { layoutViolations } from "../../scripts/lib/layout.ts";
import { structure, toLines } from "../../scripts/lib/parse.ts";
import { auditText } from "../../scripts/audit-corpus.ts";

/**
 * Every text a test below gave the rule, with the lines of the findings it
 * made there, so the oracle can check each one. Every direct call to the
 * rule in this file goes through `run`, which fills it. The calls through
 * `layoutViolations` and `auditText` give it `BASE` alone, which `run` also
 * records.
 */
const SPECIMENS = new Map<string, Set<number>>();

/** The rule's findings for a text, recorded for the oracle. */
function run(
  text: string, options: { fileName?: string; headingNumbers?: HeadingNumbers } = {},
  parsed: ReturnType<typeof structure> = structure(text), tally?: { lines: number },
): ReturnType<typeof uncitedNumberingViolations> {
  const found = uncitedNumberingViolations(text, parsed, options, tally);
  const recorded = SPECIMENS.get(text) ?? new Set<number>();
  for (const finding of found) {
    recorded.add(finding.line);
  }
  SPECIMENS.set(text, recorded);
  return found;
}

/** The lines of the uncited-numbering findings for a text. */
function lines(text: string, options: { fileName?: string; headingNumbers?: HeadingNumbers } = {}): number[] {
  return run(text, options).map(finding => finding.line);
}

/** What the rule sees, and the start of every question it asks. */
const SEEN = "This heading and at least one other are numbered, and no reference to one of them by its number is found as written in this file, outside those headings and any contents section.";
const QUESTION = `${SEEN} Must a reader cite these headings by their numbers? A project can declare the answer as headingNumbers in .iso-24495-4/document-facts.json.`;
const FAULT = `${SEEN} .iso-24495-4/document-facts.json declares that readers do not cite these headings by number. Remove the numbers.`;

/** A titled document with two numbered sections on lines 5 and 9 and nothing that cites them. */
const BASE = "# Guide\n\nIntro.\n\n## 1. Install\n\nText.\n\n## 2. Run\n\nText.\n";

/** The details of the uncited-numbering findings `auditText` gives on the base document. */
function rule(options: Parameters<typeof auditText>[1]): string[] {
  return auditText(BASE, options).filter(finding => finding.rule === "uncited-numbering").map(finding => finding.detail);
}

/** Every other finding `auditText` gives on the base document with this declaration, as JSON. */
function others(headingNumbers?: HeadingNumbers): string {
  return JSON.stringify(auditText(BASE, { markdown: true, ...(headingNumbers === undefined ? {} : { headingNumbers }) }).filter(finding => finding.rule !== "uncited-numbering"));
}

/** How long the rule takes on a text, the parse done beforehand. */
function ruleTime(text: string): number {
  const parsed = structure(text);
  const started = performance.now();
  run(text, {}, parsed);
  return performance.now() - started;
}

/** How many lines one run of the rule searched. */
function searched(text: string): number {
  const tally = { lines: 0 };
  run(text, {}, structure(text), tally);
  return tally.lines;
}

describe("uncited-numbering: numbered headings that nothing in the file cites", () => {
  test("two numbered headings below the title give one question on the first", () => {
    expect(lines(BASE)).toEqual([5]);
    expect(run(BASE)).toEqual([{ rule: "uncited-numbering", line: 5, detail: QUESTION }]);
  });

  test("declared cited gives nothing, and declared not-cited gives the finding as a fault", () => {
    expect(lines(BASE, { headingNumbers: "cited" })).toEqual([]);
    expect(run(BASE, { headingNumbers: "not-cited" })).toEqual([{ rule: "uncited-numbering", line: 5, detail: FAULT }]);
  });

  test("the question says only what the audit can see, and never that the numbering is wrong", () => {
    expect(QUESTION).not.toMatch(/wrong|should not|unnecessary|remove/i);
    expect(QUESTION).toContain("?");
  });

  test("each identifier form counts: a dot, a bracket, a colon and a dotted number", () => {
    for (const [one, two] of [["1.", "2."], ["1)", "2)"], ["1:", "2:"], ["01.", "02."]]) {
      expect(lines(`# T\n\n## ${one} A\n\n## ${two} B\n`), `${one} ${two}`).toEqual([3]);
    }
    for (const [one, two] of [["2.1", "2.2"], ["2.1.", "2.2."]]) {
      expect(lines(`# T\n\n## 2. P\n\n### ${one} A\n\n### ${two} B\n`), `${one} ${two}`).toEqual([3]);
    }
  });

  test("a heading and its first child, or two at different levels, make a numbering", () => {
    expect(lines("# T\n\n## 2. A\n\n### 2.1 B\n")).toEqual([3]);
    expect(lines("# T\n\n## 1. A\n\n### 2. B\n")).toEqual([3]);
  });

  test("setext headings below a blank line count", () => {
    expect(lines("Guide\n=====\n\n1: One\n------\n\n2: Two\n------\n")).toEqual([4]);
  });

  test("a number counts only as written: no formatting, escape or character reference before it or inside it", () => {
    const literal: ReadonlyArray<[string, string]> = [
      ["*1. A", "*2. B"], ["_1. A", "_2. B"], ["\\*1. A", "\\*2. B"], ["`*1. A`", "`*2. B`"], ["&#42;1. A", "&#42;2. B"],
      ["**1.** A", "**2.** B"], ["1\\. A", "2\\. B"], ["&#49;. A", "&#50;. B"], ["[1. A](x)", "[2. B](x)"], ["`1.` A", "`2.` B"],
      ["**1. A**", "**2. B**"], ["<b>1.</b> A", "<b>2.</b> B"], ["<!-- c -->1. A", "<!-- c -->2. B"],
    ];
    for (const [one, two] of literal) {
      expect(lines(`# T\n\n## ${one}\n\n## ${two}\n`), one).toEqual([]);
    }
    expect(lines("# T\n\n## *1. A\n\n## 2. B\n")).toEqual([]);
    expect(lines("1\\. A\n---\n\n2\\. B\n---\n")).toEqual([]);
    expect(identifierOf("1. Install")).toBe("1");
    expect(identifierOf("*1. Install")).toBeNull();
    expect(identifierOf("1. <!-- x -->")).toBeNull();
  });
});

describe("what does not count as numbered", () => {
  test("one numbered heading, or a numbered title, gives nothing", () => {
    expect(lines("# T\n\n## 1. A\n\n## B\n")).toEqual([]);
    expect(lines("# 1. T\n\n## 2. A\n")).toEqual([]);
    expect(lines("# 1. T\n\n## 2. A\n\n## 3. B\n")).toEqual([3]);
  });

  test("a title is only the first level-1 heading, so a later one is counted", () => {
    expect(lines("# T\n\n# 1. A\n\n# 2. B\n")).toEqual([3]);
  });

  test("letters, Roman numerals, step labels and bare numbers are not read", () => {
    for (const [one, two] of [["A.", "B."], ["I.", "II."], ["Step 1:", "Step 2:"], ["1", "2"], ["100", "101"]]) {
      expect(lines(`# T\n\n## ${one} A\n\n## ${two} B\n`), one).toEqual([]);
    }
  });

  test("a version alone is not numbered, and numbers that are not neighbours are not a numbering", () => {
    expect(lines("# T\n\n## 1.2.0 (2020-01-01)\n\n## 1.1.0\n")).toEqual([]);
    expect(lines("# T\n\n## 2.0 Migration\n\n## 1.5 Notes\n")).toEqual([]);
    expect(lines("# T\n\n## 1.2.0 (2020-01-01)\n\n## 1.2.1 (2020-02-01)\n")).toEqual([]);
    expect(lines("# T\n\n## 1. A\n\n## 3. C\n")).toEqual([]);
    expect(lines("# T\n\n## 1. A\n\n## 3. C\n\n## 2. B\n")).toEqual([3]);
  });

  test("a dotted number counts only below a counted heading that its parent number opens", () => {
    const versions = "# Migration\n\nThese headings name product versions, not section identifiers.\n\n## 1.2.0 Release notes\n\nFixes.\n\n## 1.2.1 Release notes\n\nFixes.\n";
    expect(lines(versions)).toEqual([]);
    expect(lines("# T\n\n## 1.2.0 Notes\n\n## 1.2.1 Notes\n")).toEqual([]);
    expect(lines("# T\n\n## 2.1 A\n\n## 2.2 B\n")).toEqual([]);
    expect(lines("# T\n\n### 2.1 A\n\n## 2. B\n")).toEqual([]);
    expect(lines("# 2. T\n\n## 2.1 A\n\n## 2.2 B\n")).toEqual([]);
    expect(lines("# T\n\n## 2. A\n\n### 2.1 B\n")).toEqual([3]);
    expect(lines("# T\n\n## 1. A\n\n### 1.1 B\n\n#### 1.1.1 C\n")).toEqual([3]);
  });

  test("a dotted heading that is not counted has its line searched, so its own number names it and the file is not reported", () => {
    expect(lines("# T\n\n#### 1.1.1 C\n\n## 1. A\n\n### 1.1 B\n")).toEqual([]);
    expect(lines("# T\n\n## 1. A\n\n## 2. B\n\n## 1.2.0 Release notes\n")).toEqual([]);
    expect(lines("# T\n\n## 1. A\n\n## 2. B\n\n## Release notes\n")).toEqual([3]);
  });

  test("headings in a list or a quotation are not counted", () => {
    expect(lines("# T\n\n- ## 1. A\n- ## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n> ## 1. A\n>\n> ## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n## 1. A\n\n> ## 2. B\n")).toEqual([]);
  });

  test("a change log or a licence, by its file name in any case and folder, is not read", () => {
    for (const name of ["CHANGELOG.md", "docs/changes.md", "History.markdown", "NEWS", "releases.md", "LICENSE.md", "licence.md", "COPYING.md"]) {
      expect(lines(BASE, { fileName: name }), name).toEqual([]);
    }
    expect(lines(BASE, { fileName: "docs/guide.md" })).toEqual([5]);
    expect(lines(BASE, { fileName: "license-notes/guide.md" })).toEqual([5]);
  });
});

describe("what counts as a citation", () => {
  const cites: ReadonlyArray<[string, string]> = [
    ["see", "See 2."], ["section", "As section 1 says."], ["rule list", "In rules 1 and 2."], ["step", "Do step 2 first."],
    ["section sign", "Under §2."], ["section sign apart", "Under § 2."], ["number sign", "Read #2."], ["no.", "Item no. 1."],
    ["range", "Steps 3-5 and 1."], ["dash range", `Parts 0${String.fromCharCode(0x2013)}9.`], ["to range", "Steps 0 to 3."],
    ["parenthesis", "As (2) shows."], ["bracket", "See [1]."], ["fragment", "[Run](#2-run)"], ["padded path", "[Run](cat/02-run/x.md)"],
    ["file", "[Run](02-run.md)"], ["number word after", "In step two."], ["number word before", "The second rule."],
    ["criterion", "Criterion 1 holds."], ["in", "Covered in 2."], ["capitals", "SEE 1."],
  ];
  for (const [name, citation] of cites) {
    test(`${name}: ${citation}`, () => {
      expect(lines(`${BASE}\n${citation}\n`)).toEqual([]);
    });
  }

  test("a dotted identifier standing alone cites, and so does a fragment without its dots", () => {
    const dotted = "# T\n\n## 2. P\n\n### 2.1 A\n\n### 2.2 B\n";
    expect(lines(dotted)).toEqual([3]);
    expect(lines(`${dotted}\nAs 2.2 says.\n`)).toEqual([]);
    expect(lines(`${dotted}\n[B](#22-b)\n`)).toEqual([]);
    expect(lines(`${dotted}\nVersion 2.2.4 is out.\n`)).toEqual([3]);
  });

  test("numbers that do not cite leave the question", () => {
    for (const text of ["It takes 2 minutes.", "![x](https://img.shields.io/badge/python-3.8-blue)", "[x](https://a.b/c?v=1)", "In one place.", "Port 8080.", "Read step 7.", "See 12."]) {
      expect(lines(`${BASE}\n${text}\n`), text).toEqual([5]);
    }
  });

  test("a citation that wraps onto the next line of its paragraph cites", () => {
    const wrapped = ["See section\n2.", "See\n2 for details.", "See the second\nsection.", "> See section\n2.", "- See section\n  2.", "See section\\\n2.", "See section  \n2.", "See steps\n> 2 and 3."];
    for (const text of wrapped) {
      expect(lines(`${BASE}\n${text}\n`), text).toEqual([]);
    }
    expect(lines(`${BASE}\nSee section\n\n2.\n`)).toEqual([5]);
    expect(lines(`${BASE}\nSee section\n3.\n`)).toEqual([5]);
  });

  test("every marker a line opens with reads as one space, so a citation around one cites", () => {
    for (const text of ["See step\n- 2 then.", "See step\n* 2 then.", "See step\n> - 2 then.", "See step\n+ 2 then.", "See step\n## 2 notes", "See step\n3. 2 more"]) {
      expect(lines(`${BASE}\n${text}\n`), text).toEqual([]);
    }
    expect(lines(`${BASE}\nSee step\n- 3 then.\n`)).toEqual([5]);
    // In `- 2.` the `2.` is a marker too, of a list inside the item, so nothing cites.
    expect(lines(`${BASE}\nSee step\n- 2.\n`)).toEqual([5]);
  });

  test("a counted heading breaks a run of lines, so words either side of it do not join", () => {
    // commonmark.js reads `See section` and `2.` as two paragraphs, with the heading between.
    expect(lines("# T\n\n## 1. A\nSee section\n## 2. B\n2.\n")).toEqual([3]);
  });

  test("a number that opens the next line after a citing word cites, list marker or not, so some list items quiet the rule", () => {
    // These are misses, never false findings: a renderer may read the number as text.
    for (const text of ["1. Read the guidelines\n2. Then run it.", "- Read the guidelines\n2. Then run it.", "See step\n1. Then run it."]) {
      expect(lines(`${BASE}\n${text}\n`), text).toEqual([]);
    }
    expect(lines(`${BASE}\n1. Read the guidelines\n\n2. Then run it.\n`)).toEqual([5]);
    // Each of these is a citation in commonmark.js 0.31.2, found by the sweeps.
    const cited = [
      "1. See section\n   2.", "1. See section\n   2. Then run it.", "See step\n1.", "2.\nSee section\n2.", "- ## Notes\nSee section\n2.",
      "1. Read\n---\nSee section\n2.", "2) more\n> See section\n> 2.", "> See\nsection.\n> 1.", "> See section\n<b>step</b>\n> 2.",
      "> 1.\n2) x\n> See section\n> 1.", "> > See step\n>\n> See section\nSee section\n>  2.", "10. x\n   2.\nsection.\n2.", "10. See section\n    2.",
    ];
    for (const text of cited) {
      expect(lines(`${BASE}\n${text}\n`), text).toEqual([]);
    }
  });

  test("a contents section ends where the text of a setext heading below it may start, the start of its run of lines", () => {
    expect(lines("# T\n\n## Contents\n\n3)\nSee steps 1\nand 2.\n===\n\n## 1. A\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n## Contents\n\n3)\nSee steps 3\nand 4.\n===\n\n## 1. A\n\n## 2. B\n")).toEqual([10]);
  });

  test("a citation spelt with a character reference, an inline tag, an escape or a link around its words cites", () => {
    for (const [text, control] of [
      ["See section &#50;.", "See section &#51;."], ["See section &#x32;.", "See section &#x33;."], ["See section <em>2</em>.", "See section <em>3</em>."],
      ["See <b>section</b> 2.", "See <b>section</b> 3."], ["[See section](x) 2.", "[See section](x) 3."], ["See&nbsp;2.", "See&nbsp;3."],
    ]) {
      expect(lines(`${BASE}\n${text}\n`), text).toEqual([]);
      expect(lines(`${BASE}\n${control}\n`), control).toEqual([5]);
    }
  });

  test("inline HTML of every kind and every shape of link between a citing word and its number is read past", () => {
    // commonmark.js 0.31.2 renders each of these with `See section 2.` in its text.
    const spelt = [
      "See section <!-- x --> 2.", "See section <?x?> 2.", "See section <a title=\">\">2</a>.", "See section <a href='>'>2</a>.", "[See section](a(b)c) 2.",
      "[See section] 2.\n\n[see section]: x", "See section <![CDATA[x]]> 2.", "See section <!DOCTYPE x> 2.", "[See section](<a b>) 2.", "[See section](x \"t(i)\") 2.",
      "![See section](x) 2.", "See section <span\nclass=\"a\">2</span>.", "See section <x-y>2</x-y>.", "[See section][r] 2.\n\n[r]: x",
    ];
    for (const text of spelt) {
      expect(lines(`${BASE}\n${text}\n`), text).toEqual([]);
      expect(lines(`${BASE}\n${text.replace(" 2", " 3").replace(">2", ">3")}\n`), `${text} with 3`).toEqual([5]);
    }
    // A comment runs to its `-->`, past any `>` inside it.
    expect(lines(`${BASE}\nSee section <!-- a > b --> 2.\n`)).toEqual([]);
    // A `<` that ends nowhere is text, and text between a citing word and its number breaks the form.
    expect(lines(`${BASE}\nSee section < 2.\n`)).toEqual([5]);
    // A `<` with no letter after it starts no HTML, so it cannot take a citation below it to the next `>`.
    expect(lines(`${BASE}\n<\nstep &#x32;\n<![CDATA[x]]>\n`)).toEqual([]);
    // HTML is also read as written, so a `<` that a renderer shows as text cannot hide one either.
    expect(lines(`${BASE}\n<a\nstep &#x32;\n>\n`)).toEqual([]);
    // A `<` that starts no tag, as no tag holds the `<` after it, does not take the citation either.
    expect(lines(`${BASE}\nif x <y then see section <em>2</em>.\n`)).toEqual([]);
    expect(lines(`${BASE}\nif x <y then see section <em>3</em>.\n`)).toEqual([5]);
    // A `<` with a space after it is text, so it and the `>` after it stay, and the words between them break the form.
    expect(lines(`${BASE}\nSee section < x > 2.\n`)).toEqual([5]);
    // A lone `<` does not swallow the tags after it, which are still taken out.
    expect(lines(`${BASE}\n< see section <em>2</em>.\n`)).toEqual([]);
    // What only looks like a tag, as `&#x32;` cannot name an attribute, is shown as text, and read so.
    expect(lines(`${BASE}\nSee <a step &#x32; x>\n`)).toEqual([]);
    // A quotation mark outside any tag does not pair with one inside a tag below it.
    expect(lines(`${BASE}\n"\nSee section <a title=">">\n2.\n`)).toEqual([]);
    // A citation inside quotation marks is read with them kept as well.
    expect(lines(`${BASE}\nHe wrote "see section &#50;".\n`)).toEqual([]);
  });

  test("number words reach ninety-nine, and a file that counts a number past them is not reported", () => {
    const teens = "# T\n\n## 13. A\n\n## 14. B\n";
    for (const text of ["See step thirteen.", "See the thirteenth step.", "See step 13."]) {
      expect(lines(`${teens}\n${text}\n`), text).toEqual([]);
    }
    expect(lines(`${teens}\nSee step fifteen.\n`)).toEqual([3]);
    expect(lines("# T\n\n## 21. A\n\n## 22. B\n\nThe twenty-first rule.\n")).toEqual([]);
    expect(lines("# T\n\n## 21. A\n\n## 22. B\n\nThe twenty\nsecond step.\n")).toEqual([]);
    expect(lines("# T\n\n## 0. A\n\n## 1. B\n\nStep zero first.\n")).toEqual([]);
    expect(lines("# T\n\n## 0. A\n\n## 1. B\n")).toEqual([3]);
    expect(lines("# T\n\n## 99. A\n\n## 100. B\n")).toEqual([]);
  });

  test("a number word counts only beside a noun such as step, never beside in or see", () => {
    expect(lines(`${BASE}\nPick one option.\n`)).toEqual([]);
    expect(lines(`${BASE}\nSee one.\n`)).toEqual([5]);
  });

  test("every other line is searched: code, a comment, front matter and other headings", () => {
    expect(lines(`${BASE}\n\`\`\`\nsee 1\n\`\`\`\n`)).toEqual([]);
    expect(lines(`${BASE}\n<!-- see 1 -->\n`)).toEqual([]);
    expect(lines(`---\nnote: see 1\n---\n${BASE}`)).toEqual([]);
    expect(lines(`${BASE}\n## Notes on section 2\n`)).toEqual([]);
    expect(lines(`${BASE}\n- ## Notes on step 1\n`)).toEqual([]);
  });

  test("a counted heading's own lines are not searched", () => {
    expect(lines("# T\n\n## 1. A\n\n## 2. Unlike step 1\n")).toEqual([3]);
  });

  test("a number in the title, or in a heading the guards set aside, is still one a citation names", () => {
    expect(lines("# 1. T\n\n## 2. A\n\n## 3. B\n\nSee 1.\n")).toEqual([]);
    expect(lines("# T\n\n<div>\n## 1. A\n\n## 2. B\n\n## 3. C\n\nSee 1.\n")).toEqual([]);
    expect(lines("# T\n\n<div>\n## 1. A\n\n## 2. B\n\n## 3. C\n")).toEqual([6]);
  });

  test("a setext title whose number is on its first line of two is still one a citation names", () => {
    const title = "1\\. Guide\nfor all\n=======\n\n## 2. A\n\n## 3. B\n";
    expect(lines(title)).toEqual([5]);
    expect(lines(`${title}\nSee 1.\n`)).toEqual([]);
  });

  test("a contents section ends where a setext heading's text starts, above the line its underline marks", () => {
    expect(lines("# T\n\n## Contents\n\n- x\n\nSee step 2 for\nnotes\n---\n\n## 1. A\n\n## 2. B\n")).toEqual([]);
  });

  test("a contents section is not searched, and ends at the next heading at any level", () => {
    const contents = "# T\n\n## Contents\n\n- See 1 and [Run](#2-run)\n\n## 1. Install\n\n## 2. Run\n";
    expect(lines(contents)).toEqual([7]);
    expect(lines(contents.replace("## Contents", "## Notes"))).toEqual([]);
    expect(lines("# T\n\n## Contents\n\n### 1. A\n\nSee 2.\n\n### 2. B\n")).toEqual([]);
    expect(lines("# T\n\n## 1. Contents\n\nSee 2.\n\n## 2. B\n")).toEqual([3]);
  });

  test("a contents section ends where a setext heading's text starts, so a citation in that heading's text cites", () => {
    // commonmark.js 0.31.2 reads `See 2 extra` as one level-2 heading starting on line 5.
    expect(lines("# Contents\n\nEntries.\n\nSee 2\nextra\n---\n\n## 1. A\n\n## 2. B\n")).toEqual([]);
    expect(lines("# Contents\n\nEntries.\n\nSee 3\nextra\n---\n\n## 1. A\n\n## 2. B\n")).toEqual([9]);
    // A line shaped like a heading inside that text does not end the section late, as the heading itself ends it first.
    expect(lines("# Contents\n\nEntries.\n\nSee 2\n** # x\n---\n\n## 1. A\n\n## 2. B\n")).toEqual([]);
  });

  test("a contents section also ends at a line that may be a heading in any container, or that stands above an underline", () => {
    const contents = "# T\n\n## Contents\n\n- [A](#1-a)\n> # x\n\nSee 2.\n\n## 1. A\n\n## 2. B\n";
    expect(lines(contents)).toEqual([]);
    expect(lines(contents.replace("> # x", "> x"))).toEqual([10]);
    expect(lines("# T\n\n## Contents\n\n>\nx\n---\n\nSee 2.\n\n## 1. A\n\n## 2. B\n")).toEqual([]);
  });

  test("any line of the run above an underline names a target, as a setext heading's text may start there", () => {
    // commonmark.js 0.31.2 reads the last four lines as a level-2 heading, `10. x 2.`, once the link definition is taken.
    expect(lines(`${BASE}\nsee section 10.\n\n[d]: x\n10. x\n2.\n-\n`)).toEqual([]);
    expect(lines(`${BASE}\nsee section 11.\n\n[d]: x\n10. x\n2.\n-\n`)).toEqual([5]);
  });

  test("a line above an underline names a target in either reading of its markers", () => {
    expect(lines(`${BASE}\n> 3. C\n> ---\n\nSee 3.\n`)).toEqual([]);
    expect(lines(`${BASE}\n2.1 C\n---\n\nSee 2.1 there.\n`)).toEqual([]);
  });
});

describe("headings the rule cannot be sure of are not counted", () => {
  test("a < on any line from the blank line above, or in a setext heading's text, sets a heading aside", () => {
    expect(lines("# T\n\n<div>\n## 1. A\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n<div>\n\n## 1. A\n\n## 2. B\n")).toEqual([5]);
    expect(lines("# T\n\n<b>x</b>\n1: A\n---\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n1: A <b>x</b>\n---\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n1: A\n---\n\n## 2. B <b>x</b>\n")).toEqual([3]);
  });

  test("a table's delimiter row on any line from the blank line above sets a heading aside, as the table may run on into it", () => {
    expect(lines("# T\n\n| a |\n|---|\n## 1. A\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n| a |\n|---|\n\n## 1. A\n\n## 2. B\n")).toEqual([6]);
    expect(lines("# T\n\n```\nx | y\n```\n\n## 1. A\n\n## 2. B\n")).toEqual([7]);
    expect(lines("# T\n\n## 1. A\n---\n## 2. B\n")).toEqual([3]);
  });

  test("below a line shaped like a fence straight below a table, no heading is counted", () => {
    expect(lines("# T\n\n| a |\n|---|\n```\n\n```\n\n## 1. A\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n| a |\n|---|\n\n```\n\n```\n\n## 1. A\n\n## 2. B\n")).toEqual([10]);
  });

  test("HTML that runs past a blank line sets aside every heading until the line that holds its end", () => {
    const forms: ReadonlyArray<[string, string]> = [["<!--", "-->"], ["<?php", "?>"], ["<!DOCTYPE", ">"], ["<![CDATA[", "]]>"], ["<pre>", "</pre>"], ["<script>", "</script>"], ["<STYLE>", "</style>"], ["<textarea>", "</textarea>"]];
    for (const [open, close] of forms) {
      expect(lines(`# T\n\n> q\n${open}\n\n## 1. A\n\n## 2. B\n`), open).toEqual([]);
      expect(lines(`# T\n\n> q\n${open}\n${close}\n\n## 1. A\n\n## 2. B\n`), close).toEqual([7]);
    }
    expect(lines("# T\n\n<!-- a --> <!-- b\n\n## 1. A\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n<!-- a -->\n\n## 1. A\n\n## 2. B\n")).toEqual([5]);
    expect(lines("# T\n\n    <!--\n\n## 1. A\n\n## 2. B\n")).toEqual([]);
  });

  test("every kind of HTML that may be open stays open until its own end, whatever else opens or closes", () => {
    const after = "\n\n## 1. A\n\n## 2. B\n";
    expect(lines(`# T \`<pre>\`\n\n<?pi\n\n</pre>${after}`)).toEqual([]);
    expect(lines(`# T<textarea>\n\n<?pi\n\n</textarea>${after}`)).toEqual([]);
    expect(lines(`# T<!--\n\n<?pi\n\n-->${after}`)).toEqual([]);
    expect(lines(`# T \`<pre>\`\n\n<?pi\n\n</pre>\n?>${after}`)).toEqual([8]);
    expect(lines(`# T<!--\n\n<?pi\n\n-->\n?>${after}`)).toEqual([8]);
    expect(lines(`# T\n\n<?pi ?> <!--\n\n?>${after}`)).toEqual([]);
    expect(lines(`# T\n\n<!-- <?pi -->\n\n-->${after}`)).toEqual([]);
    // A later start of another kind does not close the one already open.
    expect(lines(`# T\n\n<?pi\n\n\`<pre>\` x\n\n</pre>${after}`)).toEqual([]);
    expect(lines(`# T\n\n<?pi\n\n\`<pre>\` x\n\n</pre> ?>${after}`)).toEqual([9]);
  });

  test("below a line shaped like a fence inside HTML, no heading is counted", () => {
    expect(lines("# T\n\n<div>\n```\n\n```\n\n## 1. A\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n<div>\n\n```\n\n```\n\n## 1. A\n\n## 2. B\n")).toEqual([9]);
  });

  test("a setext heading needs a blank line above it or the start of the text", () => {
    expect(lines("# T\n| a |\n|---|\n| b |\n1: A\n---\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n1: A\n---\n\n## 2. B\n")).toEqual([3]);
    expect(lines("1: A\n---\n\n## 2. B\n")).toEqual([1]);
  });

  test("an ATX heading's own line must open with its hashes", () => {
    expect(lines("<!-- c -->## 1. A\n\n## 2. B\n\n## 3. C\n")).toEqual([3]);
    expect(lines("   ## 1. A\n\n## 2. B\n")).toEqual([1]);
  });
});

describe("uncited-numbering in the audits", () => {
  test("the layout rules and a Markdown audit report it; a plain text audit does not", () => {
    expect(layoutViolations(BASE).filter(finding => finding.rule === "uncited-numbering").map(finding => finding.line)).toEqual([5]);
    expect(auditText(BASE, { markdown: true }).filter(finding => finding.rule === "uncited-numbering")).toHaveLength(1);
    expect(auditText(BASE).filter(finding => finding.rule === "uncited-numbering")).toHaveLength(0);
  });

  test("the audit passes the file name and the declaration through to the rule", () => {
    expect(rule({ markdown: true, fileName: "CHANGELOG.md" })).toEqual([]);
    expect(rule({ markdown: true, headingNumbers: "cited" })).toEqual([]);
    expect(rule({ markdown: true, headingNumbers: "not-cited" })).toEqual([FAULT]);
    expect(layoutViolations(BASE, { headingNumbers: "not-cited", fileName: "guide.md" }).filter(finding => finding.rule === "uncited-numbering").map(finding => finding.detail)).toEqual([FAULT]);
  });

  test("other rules give the same findings whatever is declared", () => {
    expect(others("cited")).toBe(others());
    expect(others("not-cited")).toBe(others());
  });
});

describe("the work grows with the text", () => {
  test("each line outside the counted headings is counted once as searched, however many headings there are", () => {
    const body = "Text.\n".repeat(200);
    const few = `# T\n\n## 1. A\n\n## 2. B\n\n${body}`;
    expect(searched(few)).toBe(toLines(few).length - 2);
    const numbered: string[] = [];
    for (let index = 1; index <= 99; index++) {
      numbered.push(`## ${index}. H`);
    }
    const headings = numbered.join("\n\n");
    const many = `# T\n\n${headings}\n\n${body}`;
    expect(searched(many)).toBe(toLines(many).length - 99);
  });

  test("many contents sections, headings and ranges stay quick", () => {
    const contents = "## Contents\n\nx\n\n".repeat(5000);
    const ranges = `Steps ${Array.from({ length: 5000 }, () => "1000-1999").join(", ")}.\n`;
    const text = `# T\n\n${contents}## 1. A\n\n## 2. B\n\n${ranges}`;
    const started = performance.now();
    expect(run(text)).toHaveLength(1);
    const taken = performance.now() - started;
    // It took about 0.1 s on Windows when written, the parse included.
    expect(taken).toBeLessThan(5000);
  });
});

/** A small seeded generator, so a failure names a document that can be rebuilt. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe("uncited-numbering on seeded documents that vary what it keys on", () => {
  const parts = [
    "## 1. One", "## 2. Two", "## 3. Three", "### 2.1 Sub", "1: Setext\n---", "## Contents", "## Notes", "Text.", "See 2.", "In rule 1.",
    "<div>", "<!--", "-->", "```", "> quote", "- item", "[x](#1-one)", "<pre>", "</pre>", "| a |\n|---|", ">", "",
  ];
  const random = mulberry32(24495);
  const documents = new Set<string>();
  for (let count = 0; count < 3000; count++) {
    const pieces = ["# T"];
    const length = 3 + Math.floor(random() * 7);
    for (let index = 0; index < length; index++) {
      pieces.push(parts[Math.floor(random() * parts.length)] ?? "");
      pieces.push(random() < 0.5 ? "\n" : "\n\n");
    }
    documents.add(pieces.join(random() < 0.3 ? "" : "\n"));
  }

  test("the seeded documents are distinct and some give a finding", () => {
    expect(documents.size).toBeGreaterThan(2900);
    let found = 0;
    for (const text of documents) {
      found += lines(text).length;
    }
    expect(found).toBeGreaterThan(100);
  });
});


describe("each citation form holds whatever follows it", () => {
  const numbered = "# T\n\n## 1. A\n\n## 2. B\n";
  const dotted = "# T\n\n## 2. P\n\n### 2.1 A\n\n### 2.2 B\n";
  const forms: ReadonlyArray<[string, string, string]> = [
    ["see", numbered, "see 2"], ["step", numbered, "step 2"], ["rules", numbered, "rules 1 and 2"], ["section sign", numbered, "§2"],
    ["number sign", numbered, "#2"], ["parenthesis", numbered, "(2)"], ["number word", numbered, "step two"], ["ordinal", numbered, "the second step"],
    ["dotted", dotted, "2.2"], ["path", numbered, "[x](cat/02-b/)"], ["fragment", numbered, "[x](#2-b)"], ["bold number", numbered, "step **2**"],
    ["code number", numbered, "step `2`"], ["emphasised word", numbered, "*step* 2"], ["bold dotted", dotted, "**2.2**"], ["noun in a link", numbered, "[x](https://a.b/c#step-2-b)"],
  ];
  const endings = [".", ",", ")", ":", "*", ";", "!", "?", "", "]", "'"];
  for (const [name, document, form] of forms) {
    test(`${name}: ${form}, then each ending`, () => {
      const missed = endings.filter(ending => lines(`${document}\nCompare ${form}${ending}\n`).length > 0);
      expect(missed).toEqual([]);
      expect(lines(`${document}\nCompare nothing.\n`)).toEqual([3]);
    });
  }

  test("each form that holds a space cites with that space broken across lines, by a marker or a hard break", () => {
    const breaks = ["\n", "\n> ", "\n- ", "\\\n", "  \n", "\n    "];
    const missed: string[] = [];
    let tried = 0;
    for (const [, document, form] of forms) {
      for (let at = form.indexOf(" "); at !== -1; at = form.indexOf(" ", at + 1)) {
        for (const lineBreak of breaks) {
          for (const ending of ["", ",", " here."]) {
            tried++;
            const text = `${document}\nCompare ${form.slice(0, at)}${lineBreak}${form.slice(at + 1)}${ending}\n`;
            if (lines(text).length > 0) missed.push(text);
          }
        }
      }
    }
    expect(missed).toEqual([]);
    expect(tried).toBe(198);
  });

  test("a dotted number at the end of a sentence cites, and one inside a longer number does not", () => {
    expect(lines("# T\n\n## 2. P\n\n### 2.1 A\n\n### 2.2 B\n\nCompare with 2.2.\n")).toEqual([]);
    expect(lines("# T\n\n## 2. P\n\n### 2.1 A\n\n### 2.2 B\n\nVersion 2.2.4.\n")).toEqual([3]);
  });

  test("a fragment of a dotted identifier with more than three digits cites", () => {
    expect(lines("# T\n\n## 10. P\n\n### 10.11 A\n\n### 10.12 B\n\n[B](#1012-b)\n")).toEqual([]);
    expect(lines("# T\n\n## 10. P\n\n### 10.11 A\n\n### 10.12 B\n\n[B](#1013-b)\n")).toEqual([3]);
  });

  test("a number after a citing noun in a link target cites, and one after another word does not", () => {
    expect(lines(`${BASE}\n[Set up](https://a.b/docs#step-2-configure)\n`)).toEqual([]);
    expect(lines(`${BASE}\n[Set up](https://a.b/docs#node-2-configure)\n`)).toEqual([5]);
  });
});

describe("the rule's own work stays linear on hostile lines", () => {
  test("a long run of dashes is read once, not once for each place a marker might end", () => {
    // Quadratic matching took 0.56 s at 20,000 dashes and four times that at
    // twice as many, so 160,000 would take about 36 s.
    expect(ruleTime(`${BASE}\n${"-".repeat(160000)}x\n`)).toBeLessThan(2000);
  });

  test("HTML and link shapes that never end are looked for once, not once for each start", () => {
    // The structural reading is slow on such lines, so the rule is given the
    // headings of the text above them, which stand on the same lines.
    // A walk through every quoted value to an unended quotation mark, once
    // for each `<a`, took 23 s at 20,000 starts before a `<` ended it. The
    // slowest line here took 0.41 s on Windows when written.
    const parsed = structure(BASE);
    const hostile = [
      ...["<!--", "<?", "<![CDATA[", "<a ", "](", "]([", "\"<a \"", "'"].map(piece => piece.repeat(100000)),
      `${"<a \"x\" ".repeat(100000)}'`, `<a ${"\"<a \"".repeat(100000)}"'`,
    ];
    for (const line of hostile) {
      const text = `${BASE}\nSee ${line}\n`;
      const started = performance.now();
      expect(run(text, {}, parsed), line.slice(0, 12)).toHaveLength(1);
      expect(performance.now() - started, line.slice(0, 12)).toBeLessThan(2000);
    }
  });

  test("a line of many comments is read a fixed number of times, with nothing copied", () => {
    // The structural reading takes about 100 s on such a line, so the rule is
    // given the headings of the text above it, which stand on the same lines.
    const text = `${BASE}\n${"<!---->".repeat(100000)}\n`;
    const started = performance.now();
    expect(run(text, {}, structure(BASE))).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("round 2: overlapping number words, mismatched raw HTML ends and long delimiter rows", () => {
  test("a number word that names no heading does not hide a citation that shares its noun", () => {
    const nouns = ["section", "step", "rule", "part", "chapter", "item", "point", "clause", "stage", "phase", "task", "option"];
    const words = ["thirteen", "thirteenth", "twenty-first", "ninety", "nine", "eleventh"];
    const missed: string[] = [];
    for (const noun of nouns) {
      for (const word of words) {
        for (const text of [`${word} ${noun} one`, `${word} ${noun}\none`, `the ${noun} ${word} ${noun} two`]) {
          if (lines(`${BASE}\n${text}\n`).length > 0) missed.push(text);
        }
      }
    }
    expect(missed).toEqual([]);
    expect(lines(`${BASE}\nthirteen section nine\n`)).toEqual([5]);
  });

  test("wherever the round 1 matcher cited, the rule stays quiet", () => {
    expect(lines(`${BASE}\nFollow step twenty-one step by step.\n`)).toEqual([]);
    expect(lines(`${BASE}\ntwenty-first section two\n`)).toEqual([]);
  });

  test("a raw HTML element stays open until its own end tag, so a fence the two readings place apart stops the count", () => {
    const openers = ["<pre>", "<script>", "<style>", "<textarea>"];
    const closers = ["</pre>", "</script>", "</style>", "</textarea>"];
    const reported: string[] = [];
    for (const opener of openers) {
      for (const closer of closers) {
        for (const fence of ["~~~", "```"]) {
          const name = opener.slice(1, -1);
          const text = `# T\n\n${opener}\n${closer}\n\n${fence}\n</${name}>\n\n## 1. A\n## 2. B\n`;
          if (lines(text).length > 0) reported.push(text);
        }
      }
    }
    expect(reported).toEqual([]);
    // Without the fence the headings are real, and the question stands.
    expect(lines("# T\n\n<pre>\n</style>\n\n</pre>\n\n## 1. A\n\n## 2. B\n")).toEqual([8]);
  });

  test("a delimiter row is read in time that grows with its length, accepted or not", () => {
    const parsed = structure(BASE);
    for (const line of ["|---" + " ".repeat(64000) + "x", " ".repeat(64000) + "x|---", "|---" + " ".repeat(64000), " ".repeat(64000) + "|---|", "| " + "-".repeat(64000) + " |"]) {
      const started = performance.now();
      expect(run(`${BASE}\n${line}\n`, {}, parsed), JSON.stringify(line.slice(0, 6))).toHaveLength(1);
      expect(performance.now() - started, JSON.stringify(line.slice(0, 6))).toBeLessThan(500);
    }
  });
});

/** The part of Bun's renderer the oracle uses. Bun before 1.3.8 has none. */
interface MarkdownRenderer {
  render(text: string, callbacks: Record<string, (children: string) => string>): string;
}

/** Bun's renderer, or undefined where this Bun has none. */
function markdownRenderer(): MarkdownRenderer | undefined {
  return (Bun as unknown as { markdown?: MarkdownRenderer }).markdown;
}

const OPEN = String.fromCharCode(1);
const CLOSE = String.fromCharCode(2);
const SEPARATOR = String.fromCharCode(3);
/** The blocks the oracle asks Bun to name, so a heading can be told from one inside a container. */
const RENDERED_BLOCKS = ["blockquote", "paragraph", "heading", "list", "listItem", "code", "html", "hr", "table"];

/**
 * The text of each heading Bun renders at the top level of a text, outside
 * every list and quotation, in order.
 */
function renderedHeadings(renderer: MarkdownRenderer, text: string): string[] {
  const callbacks: Record<string, (children: string) => string> = {};
  for (const name of RENDERED_BLOCKS) {
    callbacks[name] = (children: string) => `${OPEN}${name}${SEPARATOR}${children ?? ""}${CLOSE}`;
  }
  const shown = renderer.render(text, callbacks);
  const found: string[] = [];
  let depth = 0;
  let heading: string | null = null;
  let headingDepth = -1;
  for (let index = 0; index < shown.length; index++) {
    const character = shown[index];
    if (character === OPEN) {
      const end = shown.indexOf(SEPARATOR, index);
      const name = shown.slice(index + 1, end);
      if (name === "heading" && depth === 0) {
        heading = "";
        headingDepth = depth;
      }
      depth++;
      index = end;
    } else if (character === CLOSE) {
      depth--;
      if (heading !== null && depth === headingDepth) {
        found.push(heading.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
        heading = null;
      }
    } else if (heading !== null) {
      heading += character;
    }
  }
  return found;
}

describe("uncited-numbering checked against Bun's renderer, a test oracle", () => {
  // Bun before 1.3.8 has no renderer, so these tests are skipped there. The
  // skip shows in the test count; it is not a pass. The rule never calls it.
  const renderer = markdownRenderer();
  const numbered = /^(?:\d{1,3}(?:\.\d{1,3})*[.):]|\d{1,3}(?:\.\d{1,3})+)\s+\S/;

  test.skipIf(renderer === undefined)("the oracle sees top-level headings, and none in a list, a quotation or HTML", () => {
    if (renderer === undefined) return;
    expect(renderedHeadings(renderer, BASE)).toEqual(["Guide", "1. Install", "2. Run"]);
    expect(renderedHeadings(renderer, "- ## 1. A\n\n> ## 2. B\n")).toEqual([]);
    expect(renderedHeadings(renderer, "<div>\n## 1. A\n")).toEqual([]);
  });

  test.skipIf(renderer === undefined)("every finding the tests above made has two top-level numbered headings in Bun's rendering", () => {
    if (renderer === undefined) return;
    const unconfirmed: string[] = [];
    let checked = 0;
    // The findings each test made, as `run` recorded them, so a text given
    // with a parse of another text is checked as the test gave it.
    for (const [text, found] of SPECIMENS) {
      if (found.size === 0) continue;
      checked++;
      if (renderedHeadings(renderer, text).filter(heading => numbered.test(heading)).length < 2) unconfirmed.push(text.slice(0, 200));
    }
    expect(unconfirmed).toEqual([]);
    expect(checked).toBeGreaterThan(100);
  });

  test("this file calls the rule directly only through run, so the oracle sees every finding it makes", () => {
    const source = readFileSync(import.meta.path, "utf8");
    const calls = [...source.matchAll(/uncitedNumberingViolations\(/g)].length;
    // The one call, inside run.
    expect(calls).toBe(1);
  });
});
