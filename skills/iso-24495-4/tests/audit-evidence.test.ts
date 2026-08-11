import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { auditEvidence, CATEGORIES } from "../scripts/audit-evidence.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("auditEvidence", () => {
  test("a bare repository has no artefacts in any category", () => {
    const evidence = auditEvidence(join(FIXTURES, "repo-level0"));
    for (const category of CATEGORIES) {
      expect(evidence.artefacts[category].found).toBe(false);
      expect(evidence.artefacts[category].paths).toHaveLength(0);
    }
  });

  test("an organised repository is detected across all five categories", () => {
    const evidence = auditEvidence(join(FIXTURES, "repo-level2"));
    for (const category of CATEGORIES) {
      expect(evidence.artefacts[category].found).toBe(true);
    }
  });

  test("the policy artefact cites its path", () => {
    const evidence = auditEvidence(join(FIXTURES, "repo-level2"));
    const paths = evidence.artefacts["policy"].paths.map((p) => p.replaceAll("\\", "/"));
    expect(paths).toContain("docs/plain-language-policy.md");
  });

  test("evidence records presence only, never content quality scores", () => {
    const evidence = auditEvidence(join(FIXTURES, "repo-level2"));
    for (const category of CATEGORIES) {
      expect(Object.keys(evidence.artefacts[category]).sort()).toEqual(["found", "paths"]);
    }
  });
});
