import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { auditCorpus } from "../scripts/audit-corpus.ts";
import { auditEvidence } from "../scripts/audit-evidence.ts";
import { generateReport } from "../scripts/generate-report.ts";
import { scoreMaturity } from "../scripts/score-maturity.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const findings = auditCorpus(join(FIXTURES, "corpus"));
const evidence = auditEvidence(join(FIXTURES, "repo-level2"));
const answers = await Bun.file(join(FIXTURES, "answers.sample.json")).json();
const maturity = scoreMaturity(answers);
const NOW = "2026-08-11T14:00:00.000Z";

/** Named in the failure, because a difference of 45 lines needs a reason. */
const REPORT_MUST_MATCH =
  "the report changed. Read the diff as what a reader gains or loses, and update this only when that is what you meant.";

describe("generateReport", () => {
  test("the report contains every required section", () => {
    const { report } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    for (const heading of ["## Maturity", "## Evidence", "## Corpus findings", "## Limitations"]) {
      expect(report).toContain(heading);
    }
  });

  test("the report declares its provisional basis", () => {
    const { report } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    expect(report).toContain("ISO/CD 24495-4");
    expect(report.toLowerCase()).toContain("provisional");
  });

  // The whole report, line for line.
  //
  // Four checks tried to describe what the report must not do: no word
  // "certified", then no comment opener, then no less-than sign, then no
  // image syntax. A review walked past each in turn, and the last two also
  // refused output the generator legitimately produces, because a second
  // evidence path is separated with a break tag.
  //
  // Describing a document by what it may not contain was the mistake. This
  // is what it does contain, on fixed inputs and a fixed clock, checked
  // against a renderer when it was written down. Comparing the next report
  // with the one that was reviewed needs no renderer here.
  //
  // Every earlier survivor fails against this: a comment or a hidden div
  // around the body, the disclaimer as an image caption or a reference
  // definition, a maturity level replaced by a literal, a count replaced by
  // zero, and a reversed sentence about text quality. The four tests this
  // replaces each checked one of those and missed the rest.
  test("the report is exactly this document", () => {
    const { report } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    expect(report.split(/\r?\n/), REPORT_MUST_MATCH).toEqual([
    "# Plain Language Gap Analysis",
    "",
    "> Provisional: this analysis is based on the public scope of ISO/CD 24495-4 (committee draft, unpublished). It is not a compliance statement and confers no certification. Audit date: 2026-08-11T14:00:00.000Z.",
    "",
    "## Maturity",
    "",
    "| Dimension | Level | Blocking criteria |",
    "|-----------|-------|-------------------|",
    "| governance | 2 | resourced-mandated |",
    "| capability | 1 | training-delivered |",
    "| process | 2 | signoff-gates |",
    "| measurement | 0 | corpus-baseline-taken |",
    "| culture | 1 | leadership-champions |",
    "",
    "Overall maturity (weakest dimension): **0**.",
    "",
    "## Evidence",
    "",
    "| Artefact category | Found | Paths |",
    "|-------------------|-------|-------|",
    "| policy | yes | docs/plain-language-policy.md |",
    "| review-workflow | yes | .github/PULL_REQUEST_TEMPLATE.md |",
    "| automated-checks | yes | .github/workflows/text-lint.yml |",
    "| training | yes | training/introduction.md |",
    "| glossary | yes | glossary.md |",
    "",
    "## Corpus findings",
    "",
    "| Rule | Violations |",
    "|------|------------|",
    "| sentence-average | 1 |",
    "| paragraph-length | 1 |",
    "| heading-depth | 2 |",
    "| legalese | 5 |",
    "| sentence-length | 2 |",
    "",
    "Corpus metrics are proxies for the Measurement dimension only. Text quality alone never raises a maturity level.",
    "",
    "## Limitations",
    "",
    "- The underlying standard is an unpublished committee draft; criteria may change.",
    "- Text heuristics are English-centric and approximate.",
    "- Maturity levels reflect the evidence supplied; absent evidence scores as absent.",
    "- A human reviewer must validate this report before the organisation acts on it.",
    "",
    ]);
  });

  test("a first run creates state with one timestamped snapshot", () => {

    const { state } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0].timestamp).toBe(NOW);
    expect(state.snapshots[0].totals["legalese"]).toBe(5);
  });

  test("a later run appends a snapshot without rewriting history", () => {
    const first = generateReport({ findings, evidence, maturity, state: null, now: NOW }).state;
    const LATER = "2026-11-01T09:00:00.000Z";
    const { state, report } = generateReport({ findings, evidence, maturity, state: first, now: LATER });
    expect(state.snapshots).toHaveLength(2);
    expect(state.snapshots[0]).toEqual(first.snapshots[0]);
    expect(state.snapshots[1].timestamp).toBe(LATER);
    expect(report).toContain("## Trend");
  });
});
