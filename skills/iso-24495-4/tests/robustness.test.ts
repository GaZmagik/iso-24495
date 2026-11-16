import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auditCorpus, auditText, configHash, listTextFiles } from "../scripts/audit-corpus.ts";
import { proseBlocks, wordCount } from "../scripts/lib/parse.ts";

const CORPUS = join(import.meta.dir, "fixtures", "corpus");
const FUZZ_INPUTS = [
  "",
  " \t\r\n  ",
  "x".repeat(100_000),
  "```ts\n# not a heading\nconst value = 1;",
  "First line.\r\nSecond line.\r\n",
  "First line.\rSecond line.\r",
  "\uFEFF# Heading\nText follows.",
  "Emoji 😀 remain deterministic. 中文文本也应保持稳定。",
  "نص عربي واضح. טקסט עברי ברור.",
  "- item\n  | A | B |\n  | - | - |\n  | x | y |",
  "before\0after",
  // A link definition whose destination is a no-break space. The definition
  // check accepts it and the destination pattern matches nothing in it, so
  // reading the match threw.
  "[label]: " + String.fromCharCode(160),
] as const;

// Every rule an audit can report, with the five layout rules that report only
// when the audit is told the text is Markdown.
const KNOWN_RULES = new Set([
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
  "generic-alt",
  "wordy-phrase",
  "complex-word",
  "double-negative",
  "filler-opening",
  "table-header",
  "provisional-label",
  "opening-title",
  "opening-version-date",
  "bullet-depth",
  "empty-signpost",
  "contents-list",
  "overview-label",
]);

// One document that sets off every rule an audit of plain text can report.
const EVERY_RULE = join(import.meta.dir, "fixtures", "difficult", "every-rule.md");

describe("robustness and determinism", () => {
  test("auditText and proseBlocks never throw and are deterministic for hostile text shapes", () => {
    for (const input of FUZZ_INPUTS) {
      expect(() => auditText(input)).not.toThrow();
      expect(() => proseBlocks(input)).not.toThrow();
      expect(auditText(input)).toEqual(auditText(input));
      expect(proseBlocks(input)).toEqual(proseBlocks(input));
    }
  });

  test("full corpus audits and configuration hashes are deterministic", () => {
    expect(auditCorpus(CORPUS)).toEqual(auditCorpus(CORPUS));
    expect(configHash()).toBe(configHash());
  });

  test("wordCount deliberately counts whitespace-delimited tokens", () => {
    expect(wordCount("state-of-the-art guidance")).toBe(2);
    expect(wordCount("123 4.5 -7")).toBe(3);
    expect(wordCount("hello 👋 world")).toBe(3);
    expect(wordCount("café naïve façade")).toBe(3);
    expect(wordCount("中文文本")).toBe(1);
  });

  test("every violation satisfies the shared structural invariants", () => {
    const inputs = [
      ...FUZZ_INPUTS,
      ...listTextFiles(CORPUS).map((path) => readFileSync(path, "utf8")),
      readFileSync(EVERY_RULE, "utf8"),
      "![logo](logo.png)",
      "## See also\n",
    ];
    const violations = inputs.flatMap((input) => [...auditText(input), ...auditText(input, { markdown: true })]);
    expect(violations.length).toBeGreaterThan(0);
    // The inputs must reach the rules the list names, or a name missing from
    // it passes unseen, as generic-alt and eight older names did.
    expect(new Set(violations.map((violation) => violation.rule)).size).toBeGreaterThanOrEqual(20);
    for (const violation of violations) {
      expect(violation.line).toBeGreaterThanOrEqual(1);
      expect(KNOWN_RULES.has(violation.rule)).toBe(true);
      expect(violation.detail.trim().length).toBeGreaterThan(0);
    }
  });
});
