import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auditCorpus, auditText, ENGINE_THRESHOLDS } from "../scripts/audit-corpus.ts";
import {
  classifyBoundary,
  headings,
  mergedSentences,
  proseBlocks,
  splitSentences,
  wordCount,
} from "../scripts/lib/parse.ts";

const KNOWN_GOOD = join(import.meta.dir, "fixtures", "known-good");
const DIFFICULT = join(import.meta.dir, "fixtures", "difficult");
const RULES = [
  "sentence-length",
  "sentence-average",
  "paragraph-length",
  "legalese",
  "heading-depth",
  "heading-skip",
  "heading-style",
  "acronym-undefined",
  "doublet",
  "prose-enumeration",
  "link-text",
  "image-alt",
] as const;

function rulesFor(text: string): string[] {
  return auditText(text).map((violation) => violation.rule);
}

function sentenceOf(words: number, stem = "word"): string {
  return `${Array.from({ length: words }, (_, index) => `${stem}${index}`).join(" ")}.`;
}

describe("reader-facing behaviour contracts", () => {
  test("technical punctuation and ambiguous boundaries cannot invent findings", () => {
    expect(classifyBoundary("packs etc.", "Customers receive them.")).toBe("ambiguous");
    expect(classifyBoundary("Dr.", "Smith explains it.")).toBe("merge");
    expect(classifyBoundary("paper.", "Next section.")).toBe("split");

    const abbreviations = "Items include e.g. tools, pens, and paper. Next section starts here.";
    expect(splitSentences(abbreviations)).toHaveLength(2);
    expect(mergedSentences(abbreviations)).toHaveLength(2);

    const atoms = [
      ["Call", "`system.config.init()`", "before", "running", "`service.start()`"],
      ["Upgrade", "to", "v2.4.1", "at", "staging.example.com"],
      ["The", "value", "is", "10.5", "before", "conversion"],
    ];
    for (const atom of atoms) {
      const short = `${atom.join(" ")}.`;
      expect(splitSentences(short), short).toHaveLength(1);
      const long = [...atom, ...Array.from({ length: 31 - atom.length }, (_, index) => `word${index}`)];
      const sentence = `${long.join(" ")}.`;
      expect(wordCount(sentence), sentence).toBe(31);
      expect(rulesFor(sentence).filter((rule) => rule === "sentence-length"), sentence).toHaveLength(1);
    }

    const firstHalf = `${Array(15).fill("alpha").join(" ")} etc.`;
    const secondHalf = `Customers ${Array(15).fill("beta").join(" ")}.`;
    expect(wordCount(`${firstHalf} ${secondHalf}`)).toBe(32);
    expect(rulesFor(`${firstHalf} ${secondHalf}`)).not.toContain("sentence-length");

    const paragraph = "One. Two. Three. Four. Packs etc. Customers wait.";
    expect(splitSentences(paragraph)).toHaveLength(6);
    expect(mergedSentences(paragraph)).toHaveLength(5);
    expect(rulesFor(paragraph)).not.toContain("paragraph-length");

    const average = [
      ...Array.from({ length: 8 }, () => sentenceOf(21)),
      `${Array(20).fill("alpha").join(" ")} etc.`,
      `Customers ${Array(20).fill("beta").join(" ")}.`,
    ].join(" ");
    expect(splitSentences(average)).toHaveLength(10);
    expect(mergedSentences(average)).toHaveLength(9);
    expect(rulesFor(average)).not.toContain("sentence-average");
    expect(rulesFor("# U.S. Customers receive support")).not.toContain("heading-style");
  });

  test("acronyms are separated from shouting and Roman numerals", () => {
    const cases: Array<[string, string[]]> = [
      ["ENABLE MFA before deployment.", ["MFA"]],
      ["VERIFY OTP before login.", ["OTP"]],
      ["ROTATE KEYS before deployment.", []],
      ["DO NOT USE S3 DATA.", []],
      ["AWS IAM SSO controls access.", ["AWS", "IAM", "SSO"]],
      ["Elizabeth II reigned for decades.", []],
      ["Chapter IV explains setup.", []],
      ["Open the form and review CI settings.", ["CI"]],
      ["The group uses CI during deployment.", ["CI"]],
      ["The MMIX architecture is described here.", ["MMIX"]],
    ];
    for (const [input, expected] of cases) {
      const found = auditText(input)
        .filter((violation) => violation.rule === "acronym-undefined")
        .map((violation) => /"([A-Z.]+)"/.exec(violation.detail)?.[1] ?? "");
      expect(found, input).toEqual(expected);
    }
  });

  // SOURCES.md documents where the corpus came from; it is not a corpus
  // document, so it is not measured as one.
  test("the plain-language corpus produces no false advisories", () => {
    const findings = auditCorpus(KNOWN_GOOD);
    const documents = Object.entries(findings.files).filter(([path]) => path !== "SOURCES.md");
    expect(documents).toHaveLength(7);
    const advised = documents.filter(([, file]) => file.violations.length > 0).map(([path]) => path);
    expect(advised).toEqual([]);
  });

  // Every other external document is expected to pass, so nothing measured
  // whether the engine finds real difficulty in real writing. This is the
  // opposite control: public-domain statute, adjudicated before the first run,
  // where silence would be the failure.
  test("published legal prose produces the findings adjudicated in advance", () => {
    const path = join(DIFFICULT, "us-foia-statute.md");
    const text = readFileSync(path, "utf8");
    const lengths: number[] = [];
    for (const block of proseBlocks(text)) {
      for (const sentence of splitSentences(block.lines.join(" "))) {
        const count = wordCount(sentence);
        if (count > 0) lengths.push(count);
      }
    }
    // Counted with a plain splitter before the engine ran: 11, 44, 31, 28.
    expect(lengths).toEqual([11, 44, 31, 28]);
    const found = auditText(text);
    expect(found.map((violation) => violation.rule).sort())
      .toEqual(["legalese", "sentence-length", "sentence-length"]);
    expect(found.filter((violation) => violation.rule === "sentence-length")
      .map((violation) => violation.detail))
      .toEqual(["44 words (limit 30)", "31 words (limit 30)"]);
    // Four sentences is below the sample floor, so the average must not run.
    expect(lengths.length).toBeLessThan(ENGINE_THRESHOLDS.averageMinimumSentences);
    expect(found.some((violation) => violation.rule === "sentence-average")).toBe(false);
  });

  // The corpus was worthless as a measurement while every document sat below
  // the ten-sentence floor, because the average rule was never even evaluated.
  // This document is external prose under the Open Government Licence, and its
  // expected numbers were written down before the engine first read it.
  test("external published prose is measured at the average rule's sample floor", () => {
    const path = join(KNOWN_GOOD, "govuk-universal-credit.md");
    const text = readFileSync(path, "utf8");
    let sentences = 0;
    let words = 0;
    let longest = 0;
    for (const block of proseBlocks(text)) {
      for (const sentence of splitSentences(block.lines.join(" "))) {
        const count = wordCount(sentence);
        if (count === 0) continue;
        sentences += 1;
        words += count;
        longest = Math.max(longest, count);
      }
    }
    // The adjudication, frozen before the first run: ten sentences, an average
    // of 18.0 words, a longest sentence of 26, and nothing to report.
    expect(sentences).toBe(10);
    expect(sentences).toBeGreaterThanOrEqual(ENGINE_THRESHOLDS.averageMinimumSentences);
    expect(Number((words / sentences).toFixed(1))).toBe(18.0);
    expect(longest).toBe(26);
    expect(auditText(text)).toEqual([]);
  });

  test("ATX and Setext headings share the complete heading contract", () => {
    const long = "A Very Long Heading Containing More Than Twelve Words In This Particular Document Today";
    const longSetext = `${long}\n${"-".repeat(80)}`;
    const violations = auditText(longSetext);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("heading-style");
    expect(violations[0].line).toBe(1);
    expect(proseBlocks(longSetext)).toEqual([]);

    const linked = "[Install the service](https://example.com/install)\n==================================================";
    expect(headings(linked)).toEqual([{ level: 1, line: 1, text: "Install the service" }]);
    const skipped = rulesFor("First heading\n=============\n### Third heading");
    expect(skipped).toContain("heading-skip");

    for (let spaces = 0; spaces <= 3; spaces++) {
      const indent = " ".repeat(spaces);
      expect(headings(`${indent}# ATX heading`), `ATX at ${spaces} spaces`).toHaveLength(1);
      expect(headings(`${indent}Setext heading\n${indent}---`), `Setext at ${spaces} spaces`).toHaveLength(1);
    }
    expect(headings("    # Indented code")).toEqual([]);
    expect(headings("    Setext-like code\n    ----------------")).toEqual([]);

    const negatives = [
      "---",
      "---\ntitle: Draft\n---",
      "```md\nFenced text\n---\n```",
      "- Listed text\n  ---",
      "Heading text\n\n---",
    ];
    for (const input of negatives) {
      expect(headings(input), input).toEqual([]);
    }
  });

  test("Markdown exclusions and visible prose follow an explicit contract", () => {
    const quoted = "> The supplier shall hereby provide each and every record.";
    const table = [
      "| Term | Explanation |",
      "| --- | --- |",
      `| Record | The supplier shall ${Array(31).fill("word").join(" ")} |`,
    ].join("\n");
    expect(auditText(quoted)).toEqual([]);
    expect(auditText(table)).toEqual([]);
    expect(auditText("- Parent\n  - The supplier shall respond.")).toEqual([]);

    const separated = [
      quoted,
      "",
      table,
      "",
      "```text",
      "The supplier shall respond.",
      "```",
      "",
      "- Listed item",
      "",
      "The supplier shall respond.",
    ].join("\n");
    const legalese = auditText(separated).filter((violation) => violation.rule === "legalese");
    expect(legalese).toHaveLength(1);
    expect(legalese[0].line).toBe(13);

    expect(proseBlocks("A hard line break stays  \ninside its paragraph.")).toEqual([
      { line: 1, lines: ["A hard line break stays  ", "inside its paragraph."] },
    ]);

    // Footnote bodies and HTML contain reader-visible prose, so their text is
    // audited. The deterministic parser ignores the markup rather than hiding
    // the words from every rule.
    expect(rulesFor("A note.[^1]\n\n[^1]: The supplier shall respond.")).toContain("legalese");
    expect(rulesFor("<p>The supplier shall respond.</p>")).toContain("legalese");
  });

  test("encoding, typography, and English variety do not change advice", () => {
    for (const separator of [" ", "\u00a0"]) {
      const thirty = Array(30).fill("word").join(separator) + ".";
      const thirtyOne = Array(31).fill("word").join(separator) + ".";
      expect(wordCount(thirty), JSON.stringify(separator)).toBe(30);
      expect(rulesFor(thirty)).not.toContain("sentence-length");
      expect(wordCount(thirtyOne), JSON.stringify(separator)).toBe(31);
      expect(rulesFor(thirtyOne)).toContain("sentence-length");
    }

    const lines = Array.from({ length: 50 }, (_, index) =>
      index === 41 ? "The supplier shall respond." : `Line ${index + 1} is short.`);
    const lf = auditText(lines.join("\n"));
    const crlf = auditText(lines.join("\r\n"));
    expect(crlf).toEqual(lf);
    expect(lf.find((violation) => violation.rule === "legalese")?.line).toBe(42);

    const straight = rulesFor("The \"XYZ\" service starts.");
    const smart = rulesFor("The \u201cXYZ\u201d service starts.");
    expect(straight).toEqual(["acronym-undefined"]);
    expect(smart).toEqual(straight);

    const compound = "First review the service, second inspect the contract, and third-party support follows.";
    expect(rulesFor(compound)).not.toContain("prose-enumeration");
    expect(wordCount("café l’école coöperate")).toBe(3);

    for (const pair of [
      ["CHECK COLOR FIRST", "CHECK COLOUR FIRST"],
      ["AUTHORIZE ACCESS NOW", "AUTHORISE ACCESS NOW"],
    ]) {
      expect(auditText(pair[0])).toEqual([]);
      expect(auditText(pair[1])).toEqual(auditText(pair[0]));
    }
  });

  test("rules compose independently and documentation states the capability boundary", () => {
    const tail = Array.from({ length: 23 }, (_, index) => `item${index}`);
    const sentence = `The XYZ service shall keep each and every ${tail.join(" ")}.`;
    expect(wordCount(sentence)).toBe(31);
    expect(rulesFor(sentence).sort()).toEqual([
      "acronym-undefined",
      "doublet",
      "legalese",
      "sentence-length",
    ]);

    const repairs: Array<[string, string]> = [
      [sentence.replace("shall", "must"), "legalese"],
      [sentence.replace("each and every", "each").replace("item22.", "item22 for every reader."), "doublet"],
      [sentence.replace("XYZ", "XYZ (Example Yield Zone)"), "acronym-undefined"],
      [sentence.replace("item10", "item10. Continue"), "sentence-length"],
    ];
    const originalRules = new Set(rulesFor(sentence));
    for (const [repaired, removed] of repairs) {
      const expected = [...originalRules].filter((rule) => rule !== removed).sort();
      expect(rulesFor(repaired).sort(), removed).toEqual(expected);
    }

    const positiveAndNegative: Record<string, [string, string]> = {
      "sentence-length": [sentenceOf(31), sentenceOf(30)],
      "sentence-average": [Array(10).fill(sentenceOf(21)).join(" "), Array(10).fill(sentenceOf(20)).join(" ")],
      "paragraph-length": ["One. Two. Three. Four. Five. Six.", "One. Two. Three. Four. Five."],
      legalese: ["The supplier shall respond.", "The supplier must respond."],
      "heading-depth": ["##### Deep", "#### Permitted"],
      "heading-skip": ["# First\n### Third", "# First\n## Second"],
      "heading-style": ["# One two three four five six seven eight nine ten eleven twelve thirteen", "# One two three four five six seven eight nine ten eleven twelve"],
      "acronym-undefined": ["The XYZ service starts.", "Example Yield Zone (XYZ) starts."],
      doublet: ["Check each and every record.", "Check each record."],
      "prose-enumeration": ["First inspect it, second test it, and third report it.", "First inspect it and second test it."],
      // A listener navigating by links hears only the link text, so "click
      // here" tells them nothing about where it goes.
      "link-text": ["See [click here](https://example.com/refunds).", "See [how to claim a refund](https://example.com/refunds)."],
      // A reader who cannot see the image gets nothing at all from it.
      "image-alt": ["![](diagram.png)", "![Order flow from basket to payment](diagram.png)"],
      // An empty label is the worst case: the listener hears the link
      // announced and is told nothing whatsoever about it.
      "link-text-empty": ["See [](https://example.com/refunds).", "See [the refund policy](https://example.com/refunds)."],
    };
    const empty = positiveAndNegative["link-text-empty"];
    expect(rulesFor(empty[0]), "an empty link label reports link-text").toContain("link-text");
    expect(rulesFor(empty[1]), "a described link stays clean").not.toContain("link-text");
    delete positiveAndNegative["link-text-empty"];

    expect(Object.keys(positiveAndNegative).sort()).toEqual([...RULES].sort());
    for (const rule of RULES) {
      const [positive, negative] = positiveAndNegative[rule];
      expect(rulesFor(positive), `${rule} positive`).toContain(rule);
      expect(rulesFor(negative), `${rule} negative`).not.toContain(rule);
    }

    const readme = readFileSync(join(import.meta.dir, "..", "..", "..", "README.md"), "utf8");
    const capability = "They also cover `heading-skip`, `heading-style`, `acronym-undefined`, `doublet`, `prose-enumeration`, `link-text`, and `image-alt`.";
    // The two rules for readers who cannot see the page must be explained, not
    // merely listed, or nobody knows why they exist.
    expect(readme).toContain("readers who hear or touch a document rather than look at it");
    expect(readme).toContain(capability);
    expect(auditText("The form was approved by the manager.\n\nThe office opened, and the service changed.")).toEqual([]);
    expect(capability).not.toMatch(/active voice|main idea/i);
  });
});
