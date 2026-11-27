import { describe, expect, test } from "bun:test";
import { identifierOf, uncitedNumberingViolations, type HeadingNumbers } from "../../scripts/lib/numbering.ts";
import { layoutViolations } from "../../scripts/lib/layout.ts";
import { structure, toLines } from "../../scripts/lib/parse.ts";
import { auditText } from "../../scripts/audit-corpus.ts";

/** Every text a test below gave the rule, so the oracle can check each finding it made. */
const SPECIMENS = new Set<string>();

/** The lines of the uncited-numbering findings for a text. */
function lines(text: string, options: { fileName?: string; headingNumbers?: HeadingNumbers } = {}): number[] {
  SPECIMENS.add(text);
  return uncitedNumberingViolations(text, structure(text), options).map(finding => finding.line);
}

/** What the rule sees, and the start of every question it asks. */
const SEEN = "This heading and at least one other are numbered, and nothing in this file outside its headings and any contents section cites one by its number.";
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
  uncitedNumberingViolations(text, parsed);
  return performance.now() - started;
}

/** How many lines one run of the rule searched. */
function searched(text: string): number {
  const tally = { lines: 0 };
  uncitedNumberingViolations(text, structure(text), {}, tally);
  return tally.lines;
}

describe("uncited-numbering: numbered headings that nothing in the file cites", () => {
  test("two numbered headings below the title give one question on the first", () => {
    expect(lines(BASE)).toEqual([5]);
    expect(uncitedNumberingViolations(BASE, structure(BASE))).toEqual([{ rule: "uncited-numbering", line: 5, detail: QUESTION }]);
  });

  test("declared cited gives nothing, and declared not-cited gives the finding as a fault", () => {
    expect(lines(BASE, { headingNumbers: "cited" })).toEqual([]);
    expect(uncitedNumberingViolations(BASE, structure(BASE), { headingNumbers: "not-cited" })).toEqual([{ rule: "uncited-numbering", line: 5, detail: FAULT }]);
  });

  test("the question says only what the audit can see, and never that the numbering is wrong", () => {
    expect(QUESTION).not.toMatch(/wrong|should not|unnecessary|remove/i);
    expect(QUESTION).toContain("?");
  });

  test("each identifier form counts: a dot, a bracket, a colon and a dotted number", () => {
    for (const [one, two] of [["1.", "2."], ["1)", "2)"], ["1:", "2:"], ["2.1", "2.2"], ["2.1.", "2.2."], ["01.", "02."]]) {
      expect(lines(`# T\n\n## ${one} A\n\n## ${two} B\n`), `${one} ${two}`).toEqual([3]);
    }
  });

  test("a heading and its first child, or two at different levels, make a numbering", () => {
    expect(lines("# T\n\n## 2. A\n\n### 2.1 B\n")).toEqual([3]);
    expect(lines("# T\n\n## 1. A\n\n### 2. B\n")).toEqual([3]);
  });

  test("setext headings below a blank line count", () => {
    expect(lines("Guide\n=====\n\n1\\. One\n------\n\n2\\. Two\n------\n")).toEqual([4]);
  });

  test("emphasis, an escape or a character reference around the number still reads as one", () => {
    expect(identifierOf("**1.** Install")).toBe("1");
    expect(identifierOf("1\\. Install")).toBe("1");
    expect(identifierOf("&#49;. Install")).toBe("1");
    expect(identifierOf("[2. Run](x)")).toBe("2");
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
    expect(lines("# T\n\n## 1.2.0 Notes\n\n## 1.2.1 Notes\n")).toEqual([3]);
    expect(lines("# T\n\n## 1. A\n\n## 3. C\n")).toEqual([]);
    expect(lines("# T\n\n## 1. A\n\n## 3. C\n\n## 2. B\n")).toEqual([3]);
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
    const dotted = "# T\n\n## 2.1 A\n\n## 2.2 B\n";
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

  test("a contents section also ends at a line that may be a heading in any container, or that stands above an underline", () => {
    const contents = "# T\n\n## Contents\n\n- [A](#1-a)\n> # x\n\nSee 2.\n\n## 1. A\n\n## 2. B\n";
    expect(lines(contents)).toEqual([]);
    expect(lines(contents.replace("> # x", "> x"))).toEqual([10]);
    expect(lines("# T\n\n## Contents\n\n>\nx\n---\n\nSee 2.\n\n## 1. A\n\n## 2. B\n")).toEqual([]);
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
    expect(lines("# T\n\n<b>x</b>\n1\\. A\n---\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n1\\. A <b>x</b>\n---\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n1\\. A\n---\n\n## 2. B <b>x</b>\n")).toEqual([3]);
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

  test("below a line shaped like a fence inside HTML, no heading is counted", () => {
    expect(lines("# T\n\n<div>\n```\n\n```\n\n## 1. A\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n<div>\n\n```\n\n```\n\n## 1. A\n\n## 2. B\n")).toEqual([9]);
  });

  test("a setext heading needs a blank line above it or the start of the text", () => {
    expect(lines("# T\n| a |\n|---|\n| b |\n1\\. A\n---\n\n## 2. B\n")).toEqual([]);
    expect(lines("# T\n\n1\\. A\n---\n\n## 2. B\n")).toEqual([3]);
    expect(lines("1\\. A\n---\n\n## 2. B\n")).toEqual([1]);
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
  test("each line outside the counted headings is searched once, however many headings there are", () => {
    const body = "Text.\n".repeat(200);
    const few = `# T\n\n## 1. A\n\n## 2. B\n\n${body}`;
    expect(searched(few)).toBe(toLines(few).length - 2);
    const numbered: string[] = [];
    for (let index = 1; index <= 300; index++) {
      numbered.push(`## ${index}. H`);
    }
    const headings = numbered.join("\n\n");
    const many = `# T\n\n${headings}\n\n${body}`;
    expect(searched(many)).toBe(toLines(many).length - 300);
  });

  test("many contents sections, headings and ranges stay quick", () => {
    const contents = "## Contents\n\nx\n\n".repeat(5000);
    const ranges = `Steps ${Array.from({ length: 5000 }, () => "1000-1999").join(", ")}.\n`;
    const text = `# T\n\n${contents}## 1. A\n\n## 2. B\n\n${ranges}`;
    const started = performance.now();
    expect(uncitedNumberingViolations(text, structure(text))).toHaveLength(1);
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
    "## 1. One", "## 2. Two", "### 2.1 Sub", "1\\. Setext\n---", "## Contents", "## Notes", "Text.", "See 2.", "In rule 1.",
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
  const dotted = "# T\n\n## 2.1 A\n\n## 2.2 B\n";
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

  test("a dotted number at the end of a sentence cites, and one inside a longer number does not", () => {
    expect(lines("# T\n\n## 2.1 A\n\n## 2.2 B\n\nCompare with 2.2.\n")).toEqual([]);
    expect(lines("# T\n\n## 2.1 A\n\n## 2.2 B\n\nVersion 2.2.4.\n")).toEqual([3]);
  });

  test("a fragment of a dotted identifier with more than three digits cites", () => {
    expect(lines("# T\n\n## 10.11 A\n\n## 10.12 B\n\n[B](#1012-b)\n")).toEqual([]);
    expect(lines("# T\n\n## 10.11 A\n\n## 10.12 B\n\n[B](#1013-b)\n")).toEqual([3]);
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

  test("a line of many comments is searched once from each place, with nothing copied", () => {
    // The structural reading takes about 100 s on such a line, so the rule is
    // given the headings of the text above it, which stand on the same lines.
    const text = `${BASE}\n${"<!---->".repeat(100000)}\n`;
    const started = performance.now();
    expect(uncitedNumberingViolations(text, structure(BASE))).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(2000);
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
    for (const text of SPECIMENS) {
      if (uncitedNumberingViolations(text, structure(text)).length === 0) continue;
      checked++;
      if (renderedHeadings(renderer, text).filter(heading => numbered.test(heading)).length < 2) unconfirmed.push(text);
    }
    expect(unconfirmed).toEqual([]);
    expect(checked).toBeGreaterThan(100);
  });
});
