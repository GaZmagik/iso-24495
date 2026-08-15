import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditCorpus,
  auditText,
  ENGINE_THRESHOLDS,
  projectAcronyms,
} from "../scripts/audit-corpus.ts";
import { COMPLEX_WORDS } from "../scripts/lib/lexicon.ts";
import {
  classifyBoundary,
  headings,
  mergedSentences,
  proseBlocks,
  splitSentences,
  wordCount,
} from "../scripts/lib/parse.ts";

const BREAK = String.fromCharCode(10);
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
  "wordy-phrase",
  "complex-word",
  "double-negative",
  "filler-opening",
  "table-header",
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
    // Re-adjudicated on 2026-08-15 when complex-word was added. The statute
    // says "the methods whereby, the public may obtain information", so the
    // fourth finding is real: the rule did not drift, the rule set grew.
    expect(found.map((violation) => violation.rule).sort())
      .toEqual(["complex-word", "legalese", "sentence-length", "sentence-length"]);
    expect(found.filter((violation) => violation.rule === "sentence-length")
      .map((violation) => violation.detail))
      .toEqual(["44 words (limit 30)", "31 words (limit 30)"]);
    // Four sentences is below the sample floor, so the average must not run.
    expect(lengths.length).toBeLessThan(ENGINE_THRESHOLDS.averageMinimumSentences);
    expect(found.some((violation) => violation.rule === "sentence-average")).toBe(false);
  });

  // The isolated controls prove each rule can fire alone. This fixture adds
  // the composition case: every rule must remain observable when all seventeen
  // occur together in one realistic document.
  test("every rule fires together in one integrated document", () => {
    const text = readFileSync(join(DIFFICULT, "every-rule.md"), "utf8");
    const fired = new Set(auditText(text).map((violation) => violation.rule));
    expect([...fired].sort()).toEqual([...RULES].sort());
  });

  // Round 8, second pass. The first repairs fixed the symptom in one rule
  // rather than the shared parser, so metadata and table cells were still
  // audited as sentences by every other rule.
  test("metadata and table cells are structure, not prose", () => {
    const frontMatter = ["---", "title: Each and Every Shall Policy", "---", "", "Body text here."];
    expect(rulesFor(frontMatter.join(BREAK))).toEqual([]);
    expect(rulesFor(["---", "summary: We will utilise this", "---", "", "Body."].join(BREAK)))
      .toEqual([]);
    // No blank line after the closing marker must not merge metadata with body.
    expect(rulesFor(["---", "title: x", "---", "Certainly! The answer is 42."].join(BREAK)))
      .toContain("filler-opening");

    const pipeless = ["Term | Meaning", "---|---", "Rule | The supplier shall hereby comply."];
    expect(rulesFor(pipeless.join(BREAK))).toEqual([]);
    const piped = ["| Term | Meaning |", "|---|---|", "| Rule | The supplier shall hereby comply. |"];
    expect(rulesFor(piped.join(BREAK))).toEqual([]);
  });

  // Round 9. Both exclusions above were inferred from a neighbouring line, so
  // ordinary prose disappeared from the document with nothing to show for it.
  // Silent removal is worse than a wrong finding, because a reader who sees a
  // wrong finding can dismiss it, and a reader who sees nothing learns nothing.
  test("structure inference never removes prose or headings", () => {
    // A pipe in a heading, a quote or a list is punctuation, not a table.
    const afterHeading = ["## Compare A | B", "The supplier shall respond | today."];
    expect(rulesFor(afterHeading.join(BREAK))).toContain("legalese");
    const afterQuote = ["> Compare A | B", "The supplier shall respond | today."];
    expect(rulesFor(afterQuote.join(BREAK))).toContain("legalese");
    const afterList = ["- Compare A | B", "The supplier shall respond | today."];
    expect(rulesFor(afterList.join(BREAK))).toContain("legalese");

    // Front matter needs a closing marker. Without one the scanners disagreed:
    // prose kept the text while every heading below it vanished.
    const unclosed = ["---", "title: Draft", "##### This heading ends with a full stop."];
    const found = rulesFor(unclosed.join(BREAK));
    expect(found).toContain("heading-depth");
    expect(found).toContain("heading-style");

    // A table still ends where the pipes end, and prose after it is audited.
    const surrounded = [
      "| Term | Meaning |",
      "|---|---|",
      "| Rule | Text. |",
      "",
      "The supplier shall comply.",
    ];
    expect(rulesFor(surrounded.join(BREAK))).toContain("legalese");
  });

  // Round 10. Both structural exclusions were mine, and both lost the reader
  // text. A thematic break joined the sentence below it, so a 30-word
  // sentence became a false 31-word finding and an opening filler stopped
  // being an opening. An indented "---" inside a YAML block scalar closed the
  // front matter early, which left a code fence open and hid the whole body.
  test("rules across the page and YAML scalars are not read as sentences", () => {
    for (const rule of ["---", "***", "___", "- - -"]) {
      expect(rulesFor([rule, "Certainly! The answer is 42."].join(BREAK)), rule)
        .toContain("filler-opening");
    }
    // A break above a sentence must not add a word to it.
    const thirty = Array.from({ length: 30 }, (_unused, index) => `word${index}`).join(" ");
    expect(rulesFor(["---", `${thirty}.`].join(BREAK))).toEqual([]);
    // A setext underline is still a heading, not a break.
    expect(headings(["My Heading", "---", "", "Body text."].join(BREAK))).toHaveLength(1);

    const scalar = [
      "---",
      "description: |",
      "  ```md",
      "  ---",
      "  ```",
      "---",
      "The supplier shall be audited.",
    ];
    expect(rulesFor(scalar.join(BREAK))).toContain("legalese");
  });

  // Round 11. The three scanners each kept their own fence and front matter
  // state, and disagreed. A four-space-indented marker opened a fence that
  // never opened, a tilde run closed a backtick fence, a bare carriage return
  // left the file as one line, and a byte order mark stopped front matter
  // being front matter. Every one of them removed text a reader can see.
  test("code fences, line endings and byte order marks cannot hide text", () => {
    const CARRIAGE_RETURN = String.fromCharCode(13);
    const BYTE_ORDER_MARK = String.fromCharCode(65279);
    const legalese = "The supplier shall hereby comply.";

    // A fence opens with at most three leading spaces.
    expect(rulesFor(["    ```", legalese].join(BREAK))).toContain("legalese");
    // A fence closes only with its own character, at least as long.
    const nested = ["````md", "~~~bash", "example", "````", "", legalese];
    expect(rulesFor(nested.join(BREAK))).toContain("legalese");
    expect(headings(["````md", "~~~bash", "x", "````", "##### Deep."].join(BREAK)))
      .toHaveLength(1);
    // A real fence still hides its contents, closed or not.
    expect(rulesFor(["```", legalese, "```"].join(BREAK))).toEqual([]);
    expect(rulesFor(["```", legalese].join(BREAK))).toEqual([]);
    expect(rulesFor(["```js", "code", "```", "", legalese].join(BREAK))).toContain("legalese");

    // A bare carriage return separates lines, as CRLF already did.
    const bareCR = ["##### Deep heading.", legalese].join(CARRIAGE_RETURN);
    expect(rulesFor(bareCR)).toContain("legalese");
    expect(headings(bareCR)).toHaveLength(1);

    // A byte order mark precedes the opening delimiter in many Windows files.
    const withMark = BYTE_ORDER_MARK
      + ["---", "description: |", "  ```md", "---", legalese].join(BREAK);
    expect(rulesFor(withMark)).toContain("legalese");
  });

  // The block scanners were normalised while three rules still split the text
  // themselves, so the fix reached most of the engine and not all of it. A
  // bare carriage return put the image finding on line 1 rather than line 3,
  // and the table finding vanished. Every encoding must read alike.
  test("line-based rules read the same document as the block scanners", () => {
    const CARRIAGE_RETURN = String.fromCharCode(13);
    const BYTE_ORDER_MARK = String.fromCharCode(65279);
    const document = [
      "[click here](https://example.com)",
      "",
      "![](chart.png)",
      "",
      "| A |  |",
      "| --- | --- |",
    ];
    const expected = [
      ["table-header", 5],
      ["link-text", 1],
      ["image-alt", 3],
    ];
    const found = (text: string): Array<[string, number]> =>
      auditText(text).map((violation) => [violation.rule, violation.line]);
    expect(found(document.join(BREAK))).toEqual(expected);
    expect(found(document.join(CARRIAGE_RETURN))).toEqual(expected);
    expect(found(document.join(CARRIAGE_RETURN + BREAK))).toEqual(expected);
    expect(found(BYTE_ORDER_MARK + document.join(BREAK))).toEqual(expected);

    // They must honour the shared fence rules too, not their own.
    const fenced = ["````", "~~~", "[click here](https://example.com)", "````"];
    expect(auditText(fenced.join(BREAK))).toEqual([]);
  });

  // Round 12. Structure was still being inferred too eagerly in three places.
  // A table claimed lines GitHub would not render as a table at all, a fence
  // indented into a list item was read as text, and the rewired rules skipped
  // only fences, so front matter reached them.
  test("structure is claimed only where a reader would see it", () => {
    const legalese = "The supplier shall hereby comply.";

    // GitHub renders a table only when header and divider agree on columns.
    const mismatched = ["A | B | C", "---|---", "The supplier shall respond | today | now."];
    expect(rulesFor(mismatched.join(BREAK))).toContain("legalese");
    const setext = ["Comparison A | B", "---", "The supplier shall respond | today."];
    expect(rulesFor(setext.join(BREAK))).toContain("legalese");
    // A table that does agree is still structure.
    expect(rulesFor(["| A | B |", "|---|---|", `| x | ${legalese} |`].join(BREAK))).toEqual([]);
    expect(rulesFor(["Term | Meaning", "---|---", `Rule | ${legalese}`].join(BREAK))).toEqual([]);

    // A fence indented into a list item or a quote is still a fence, and its
    // contents are examples rather than advice to give back to the writer.
    const inList = ["1. Example:", "", "    ```md", `    ${legalese}`,
      "    [click here](https://example.com)", "    ![](chart.png)", "    ```"];
    expect(rulesFor(inList.join(BREAK))).toEqual([]);
    const inBullet = ["- Example:", "", "  ```md", `  ${legalese}`, "  ```"];
    expect(rulesFor(inBullet.join(BREAK))).toEqual([]);
    const inQuote = ["> ```", `> ${legalese}`, "> [click here](https://example.com)", "> ```"];
    expect(rulesFor(inQuote.join(BREAK))).toEqual([]);
    // Four spaces at the left margin is indented code, not a fence.
    expect(rulesFor(["    ```", "The supplier shall respond."].join(BREAK))).toContain("legalese");

    // Metadata is metadata for every rule, not only the block scanners.
    const metadata = ["---", "link: [click here](https://example.com)", "image: ![](chart.png)",
      "head: | A |  |", "rule: | --- | --- |", "---", "", "Body text here."];
    expect(rulesFor(metadata.join(BREAK))).toEqual([]);
  });

  // A third reviewer attacked the parser and offered six shapes. Five matched
  // what GitHub renders, so the engine was right about them. This one did not:
  // a line starting with a pipe, with no divider beneath it, is ordinary text.
  test("a pipe alone does not make a line a table row", () => {
    const legalese = "The supplier shall hereby comply.";
    expect(rulesFor(`| Important note: ${legalese}`)).toContain("legalese");
    expect(rulesFor([`| x | ${legalese} |`].join(BREAK))).toContain("legalese");
    // A header with a matching divider is still a table, rows and all.
    expect(rulesFor(["| A | B |", "|---|---|", `| x | ${legalese} |`].join(BREAK))).toEqual([]);
    expect(rulesFor(["Term | Meaning", "---|---", `Rule | ${legalese}`].join(BREAK))).toEqual([]);
  });

  // A filler word must survive emphasis and typography, and must not match
  // the start of an ordinary word.
  test("filler openings are matched as words, however they are typed", () => {
    for (const filler of [
      "Certainly! The answer is 42.",
      "**Certainly!** The answer is 42.",
      "*Certainly!* The answer is 42.",
      "I’d be happy to explain.",
      "I'd be happy to explain.",
    ]) {
      expect(rulesFor(filler), filler).toContain("filler-opening");
    }
    for (const ordinary of [
      "Surely the answer is correct.",
      "Sure-fire evidence supports the answer.",
      "Sure_footed evidence supports the answer.",
      "Let meadows grow naturally.",
      "The answer is 42.",
    ]) {
      expect(rulesFor(ordinary), ordinary).not.toContain("filler-opening");
    }
  });

  // Round 8. A technical writer met a dozen findings for ordinary vocabulary,
  // which is the shortest route to switching the hook off. The shipped list
  // stays universal; each project extends it for itself.
  test("a project can name the acronyms it treats as known", () => {
    const temp = mkdtempSync(join(tmpdir(), "iso-acronyms-"));
    try {
      expect(rulesFor("The SQL layer changed.")).toContain("acronym-undefined");
      const known = new Set(["SQL"]);
      expect(auditText("The SQL layer changed.", { knownAcronyms: known })).toEqual([]);

      // No config leaves the core list alone.
      expect(projectAcronyms(temp).size).toBe(0);

      mkdirSync(join(temp, ".iso-24495-4"), { recursive: true });
      const config = join(temp, ".iso-24495-4", "acronyms.json");
      writeFileSync(config, JSON.stringify(["sql", " SDK ", "", 7]));
      const loaded = projectAcronyms(temp);
      expect([...loaded].sort()).toEqual(["SDK", "SQL"]);

      // Malformed configuration must never stop a document being audited.
      writeFileSync(config, "{not json");
      expect(projectAcronyms(temp).size).toBe(0);
      writeFileSync(config, JSON.stringify({ allow: ["SQL"] }));
      expect(projectAcronyms(temp).size).toBe(0);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  // A definition counts wherever a reader can see it. Headings and lists are
  // not audited as prose, so a term defined there was reported as undefined.
  test("an acronym defined in a heading or list counts as defined", () => {
    const use = ["", "The DOM loads first.", ""];
    expect(rulesFor(["## Document Object Model (DOM)", ...use].join("\n")))
      .not.toContain("acronym-undefined");
    expect(rulesFor(["- Document Object Model (DOM)", ...use].join("\n")))
      .not.toContain("acronym-undefined");
    expect(rulesFor([
      "| Term | Meaning |",
      "|---|---|",
      "| Document Object Model (DOM) | tree |",
      ...use,
    ].join("\n")))
      .not.toContain("acronym-undefined");
    expect(rulesFor("The DOM loads first.")).toContain("acronym-undefined");
  });

  // Every complex-word suggestion must be no longer than the word it replaces,
  // or taking the advice pushes a sentence at the cap over it.
  test("complex-word advice never creates a longer sentence", () => {
    const padding = Array(27).fill("word").join(" ");
    for (const [word, plain] of COMPLEX_WORDS) {
      expect(plain.split(" ").length, `${word} -> ${plain}`).toBe(1);
    }
    expect(rulesFor(`The clause whereby ${padding}.`)).toEqual(["complex-word"]);
    expect(rulesFor(`The clause how ${padding}.`)).toEqual([]);
  });

  // Round 7 repairs, each a defect an external reviewer found and I reproduced.
  test("the newest rules survive the shapes real documents take", () => {
    // A filler word is only filler when it is a whole word.
    expect(rulesFor("Surely the answer is correct.")).not.toContain("filler-opening");
    expect(rulesFor("Let meadows grow naturally.")).not.toContain("filler-opening");
    expect(rulesFor("Certainly! The answer is 42.")).toContain("filler-opening");

    // Front matter is metadata, not the opening sentence.
    const frontMatter = ["---", "title: Guide", "---", ""];
    expect(rulesFor([...frontMatter, "Certainly! The answer is 42."].join("\n")))
      .toContain("filler-opening");
    expect(rulesFor([...frontMatter, "The answer is 42."].join("\n")))
      .not.toContain("filler-opening");

    // Outer pipes are optional, and the divider may carry colons and padding.
    const tables: Array<[string[], boolean]> = [
      [["Name | ", "---|---", " a | b "], true],
      [["Name | Role", "---|---", " a | b "], false],
      [["| Name | |", "|:---|---:|", "| a | b |"], true],
      [["| Name | |", "| --- | --- |", "| a | b |"], true],
      [["| Name | Role |", "|---|---|", "| a | b |"], false],
    ].map(([rows, expected]) => [(rows as string[]).join("\n"), expected as boolean]);
    for (const [table, expected] of tables) {
      expect(rulesFor(table).includes("table-header"), JSON.stringify(table)).toBe(expected);
    }

    // A word being quoted is being discussed, not used. Deleting the exemption
    // left every test green, because our own examples live in list items.
    expect(rulesFor("We will utilise the service.")).toContain("complex-word");
    for (const quoted of [
      "Prefer *use* over *utilise* in every case.",
      "Prefer `use` over `utilise` in every case.",
      "Prefer **use** over **utilise** in every case.",
      "The word \"utilise\" is the one to avoid.",
    ]) {
      expect(rulesFor(quoted), quoted).not.toContain("complex-word");
    }

    // The advice must not create the next violation. "ascertain" suggests
    // "find", which is shorter, so a sentence at the cap stays at the cap.
    const padding = Array(27).fill("word").join(" ");
    expect(rulesFor(`We must ascertain ${padding}.`)).toEqual(["complex-word"]);
    expect(rulesFor(`We must check ${padding}.`)).toEqual([]);

    // One violation per fault, so the advisory line counts honestly.
    expect(auditText("![](diagram.png)")).toHaveLength(1);
    expect(auditText("![   ](diagram.png)")).toHaveLength(1);
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
      // The core skill has listed these swaps since the first release and
      // nothing checked them, so the guidance asked for something the engine
      // never looked at.
      "wordy-phrase": ["Restart the service in order to apply the change.", "Restart the service to apply the change."],
      // The skill has always named the plain word; nothing checked it. A word
      // in emphasis is being discussed, so the skill can still name it.
      "complex-word": ["We will utilise the service.", "We will use the service."],
      // The part of positive framing a rule can judge. A blanket check for
      // "do not" was measured and rejected: 58 hits in our own documents, of
      // which three were warnings.
      "double-negative": ["It is not uncommon for the check to fail.", "The check often fails."],
      // The skill's first rule is to open with the answer.
      "filler-opening": ["Certainly! The answer is 42.", "The answer is 42."],
      // A listener hears each cell announced against its column name.
      "table-header": [
        ["| Name | |", "|---|---|", "| a | b |"].join("\n"),
        ["| Name | Role |", "|---|---|", "| a | b |"].join("\n"),
      ],
    };
    const empty = positiveAndNegative["link-text-empty"];
    expect(rulesFor(empty[0]), "an empty link label reports link-text").toContain("link-text");
    expect(rulesFor(empty[1]), "a described link stays clean").not.toContain("link-text");
    delete positiveAndNegative["link-text-empty"];

    // Two phrases in one paragraph, and one nested inside a longer phrase. The
    // longest wins, so "in spite of the fact that" is not also counted as the
    // shorter phrase inside it.
    const wordy = auditText(
      "In spite of the fact that it failed, restart it in order to apply the change.")
      .filter((violation) => violation.rule === "wordy-phrase");
    expect(wordy).toHaveLength(2);
    expect(wordy.map((violation) => violation.detail)).toEqual([
      '"in spite of the fact that" says what "although" says',
      '"in order to" says what "to" says',
    ]);

    expect(Object.keys(positiveAndNegative).sort()).toEqual([...RULES].sort());
    for (const rule of RULES) {
      const [positive, negative] = positiveAndNegative[rule];
      expect(rulesFor(positive), `${rule} positive`).toContain(rule);
      expect(rulesFor(negative), `${rule} negative`).not.toContain(rule);
    }

    const readme = readFileSync(join(import.meta.dir, "..", "..", "..", "README.md"), "utf8");
    const capability = "They also cover `heading-skip`, `heading-style`, `acronym-undefined`, `doublet`, `prose-enumeration`, `link-text`, `image-alt`, `wordy-phrase`, `complex-word`, `double-negative`, `filler-opening`, and `table-header`.";
    // The two rules for readers who cannot see the page must be explained, not
    // merely listed, or nobody knows why they exist.
    expect(readme).toContain("readers who hear or touch a document rather than look at it");
    expect(readme).toContain(capability);
    expect(auditText("The form was approved by the manager.\n\nThe office opened, and the service changed.")).toEqual([]);
    expect(capability).not.toMatch(/active voice|main idea/i);
  });
});
