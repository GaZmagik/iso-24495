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
] as const;

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
]);

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
    ];
    const violations = inputs.flatMap(auditText);
    expect(violations.length).toBeGreaterThan(0);
    for (const violation of violations) {
      expect(violation.line).toBeGreaterThanOrEqual(1);
      expect(KNOWN_RULES.has(violation.rule)).toBe(true);
      expect(violation.detail.trim().length).toBeGreaterThan(0);
    }
  });
});
