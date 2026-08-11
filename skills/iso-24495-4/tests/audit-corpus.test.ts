import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { auditCorpus, listTextFiles } from "../scripts/audit-corpus.ts";

const CORPUS = join(import.meta.dir, "fixtures", "corpus");

describe("listTextFiles", () => {
  test("returns absolute paths of text files, including nested ones, excluding other types", () => {
    const root = join(import.meta.dir, "fixtures", "repo-level2");
    const files = listTextFiles(root);
    expect(files).toHaveLength(4);
    expect(files).toContain(join(root, "docs", "plain-language-policy.md"));
    expect(files.some((f) => f.endsWith(".yml"))).toBe(false);
  });
});

describe("auditCorpus", () => {
  const findings = auditCorpus(CORPUS);

  test("pins per-rule totals across the fixture corpus", () => {
    expect(findings.totals["sentence-length"]).toBe(3);
    expect(findings.totals["paragraph-length"]).toBe(2);
    expect(findings.totals["legalese"]).toBe(5);
    expect(findings.totals["heading-depth"]).toBe(2);
  });

  test("a compliant file has zero violations", () => {
    expect(findings.files["good-policy.md"].violations).toHaveLength(0);
  });

  test("long-sentences.md carries exactly the sentence-length violations", () => {
    const v = findings.files["long-sentences.md"].violations;
    expect(v.filter((x) => x.rule === "sentence-length")).toHaveLength(3);
    expect(v.filter((x) => x.rule !== "sentence-length")).toHaveLength(0);
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
