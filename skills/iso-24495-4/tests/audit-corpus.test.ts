import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCorpus, auditText, listTextFiles } from "../scripts/audit-corpus.ts";

const CORPUS = join(import.meta.dir, "fixtures", "corpus");

describe("listTextFiles", () => {
  test("returns absolute paths of text files, including nested ones, excluding other types", () => {
    const root = join(import.meta.dir, "fixtures", "repo-level2");
    const files = listTextFiles(root);
    expect(files).toHaveLength(4);
    expect(files).toContain(join(root, "docs", "plain-language-policy.md"));
    expect(files.some((f) => f.endsWith(".yml"))).toBe(false);
  });

  test("skips entries that cannot be inspected and reports each skip", () => {
    const root = mkdtempSync(join(tmpdir(), "iso-24495-4-walk-"));
    try {
      writeFileSync(join(root, "good.md"), "A short sentence.\n");
      const target = join(root, "target-dir");
      mkdirSync(target);
      symlinkSync(target, join(root, "dangling"), "junction");
      rmSync(target, { recursive: true, force: true });
      const skipped: string[] = [];
      expect(listTextFiles(root, (path) => skipped.push(path))).toEqual([join(root, "good.md")]);
      expect(skipped).toEqual([join(root, "dangling")]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("throws on a missing or unreadable root instead of reporting an empty corpus", () => {
    expect(() => listTextFiles(join(tmpdir(), "iso-24495-4-no-such-root"))).toThrow();
  });
});

describe("auditCorpus skip reporting", () => {
  test("forwards walk skips to the caller so partial audits are visible", () => {
    const root = mkdtempSync(join(tmpdir(), "iso-24495-4-audit-skip-"));
    try {
      writeFileSync(join(root, "good.md"), "A short sentence.\n");
      const target = join(root, "target-dir");
      mkdirSync(target);
      symlinkSync(target, join(root, "dangling"), "junction");
      rmSync(target, { recursive: true, force: true });
      const skipped: string[] = [];
      const findings = auditCorpus(root, (path) => skipped.push(path));
      expect(Object.keys(findings.files)).toEqual(["good.md"]);
      expect(skipped).toEqual([join(root, "dangling")]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auditCorpus", () => {
  const findings = auditCorpus(CORPUS);

  test("pins per-rule totals across the fixture corpus", () => {
    expect(findings.totals["sentence-length"]).toBe(2);
    expect(findings.totals["sentence-average"]).toBe(1);
    expect(findings.totals["paragraph-length"]).toBe(1);
    expect(findings.totals["legalese"]).toBe(5);
    expect(findings.totals["heading-depth"]).toBe(2);
  });

  test("a proxy-clean file has zero violations", () => {
    expect(findings.files["good-policy.md"].violations).toHaveLength(0);
  });

  test("long-sentences.md flags only sentences over the 30-word cap", () => {
    const v = findings.files["long-sentences.md"].violations;
    expect(v.filter((x) => x.rule === "sentence-length")).toHaveLength(2);
    expect(v.filter((x) => x.rule !== "sentence-length")).toHaveLength(0);
  });

  test("a sustained high average is caught even with no single offender", () => {
    const v = findings.files["average-heavy.md"].violations;
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("sentence-average");
    expect(v[0].detail).toContain("average 22.0");
    expect(v[0].detail).toContain("12 sentences");
    expect(v[0].detail).toContain("limit 20");
  });

  test("indented list items are structure, not prose", () => {
    // Regression for the column-zero bug: list markers must be recognised
    // at any indentation, or nested bullets merge into giant fake sentences.
    const nested = [
      "1. **Top item:**",
      "   - **First nested point:** some words that continue along here",
      "   - **Second nested point:** more words that continue along here",
      "   * another marker style, indented",
      "     2) a doubly indented numbered item with several words in it",
    ].join("\n");
    expect(auditText(nested)).toEqual([]);
  });

  // A synthetic sentence of exactly n words; programmatic, so the count
  // cannot be wrong by hand.
  const sentenceOf = (n: number) =>
    Array.from({ length: n }, (_, i) => `word${i}`).join(" ") + ".";

  test("the average fires at exactly ten sentences and not at 20.0 exactly", () => {
    const tenAt21 = Array(10).fill(sentenceOf(21)).join(" ");
    const fired = auditText(tenAt21).filter((x) => x.rule === "sentence-average");
    expect(fired).toHaveLength(1);
    expect(fired[0].detail).toContain("21.0");
    expect(fired[0].detail).toContain("10 sentences");

    const nineAt21 = Array(9).fill(sentenceOf(21)).join(" ");
    expect(auditText(nineAt21).filter((x) => x.rule === "sentence-average")).toHaveLength(0);

    const tenAt20 = Array(10).fill(sentenceOf(20)).join(" ");
    expect(auditText(tenAt20).filter((x) => x.rule === "sentence-average")).toHaveLength(0);
  });

  test("the average accumulates across separate prose blocks", () => {
    const spread = Array(10).fill(sentenceOf(21)).join("\n\n");
    expect(auditText(spread).filter((x) => x.rule === "sentence-average")).toHaveLength(1);
  });

  test("short documents are exempt from the average rule", () => {
    // good-policy.md is clean and has fewer than ten sentences; the average
    // rule must not fire on samples too small to judge fairly.
    expect(findings.files["good-policy.md"].violations).toHaveLength(0);
  });

  test("fenced code is immune to every rule", () => {
    expect(findings.files["code-fenced.md"].violations).toHaveLength(0);
  });

  test("legalese violations name the matched term", () => {
    const terms = findings.files["legalese-sample.md"].violations
      .filter((x) => x.rule === "legalese")
      .map((x) => x.detail);
    expect(terms.filter((t) => t.includes("shall"))).toHaveLength(3);
    expect(terms.filter((t) => t.includes("hereby"))).toHaveLength(1);
    expect(terms.filter((t) => t.includes("hereinafter"))).toHaveLength(1);
  });

  test("every violation cites a line number", () => {
    for (const file of Object.values(findings.files)) {
      for (const v of file.violations) {
        expect(v.line).toBeGreaterThan(0);
      }
    }
  });
});
