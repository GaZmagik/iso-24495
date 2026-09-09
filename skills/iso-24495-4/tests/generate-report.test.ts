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
    expect(report.toLowerCase()).not.toContain("certified");
  });

  // The two checks above read for words, and a review walked past both of
  // them in the source while every test stayed green. It changed "confers no
  // certification" to "confers certification", which contains no
  // "certified", and it changed "must validate" to "need not validate",
  // which is as provisional as the original by every word this file reads.
  //
  // These are the two sentences the report exists to carry. A gap analysis
  // that confers certification, or that nobody need check, is the claim this
  // whole project is built to avoid making. They are pinned whole, because a
  // word is not what they mean.
  test("the report keeps the two sentences that limit what it claims", () => {
    const { report } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    expect(report, "the report must confer no certification").toContain(
      "It is not a compliance statement and confers no certification.");
    expect(report, "the report must require a human reviewer").toContain(
      "A human reviewer must validate this report before the organisation acts on it.");
  });

  // A review replaced the expression that renders these counts with a literal
  // zero. Every row still appeared, so the section check above passed and the
  // reader was told there was nothing to fix. The maturity levels are the
  // report's other quantities, and they are checked below for the same reason.
  test("the corpus rows carry the counts they were given", () => {
    const { report } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    const totals = Object.entries(findings.totals);
    expect(totals.length, "the fixture corpus must produce findings").toBeGreaterThan(0);
    for (const [rule, count] of totals) {
      expect(report, `the row for ${rule} must show its own count`)
        .toContain(`| ${rule} | ${count} |`);
    }
    expect(
      totals.some(([, count]) => count > 0),
      "a corpus with findings must not report every rule as zero",
    ).toBe(true);
  });

  // Containing a sentence is not showing it. A review wrapped the whole report
  // in an HTML comment, and every check above passed while a browser rendered
  // an empty page. So the report must begin as a report, and must carry no
  // comment opener anywhere in it.
  test("the report reaches the reader rather than merely containing its words", () => {
    const { report } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    expect(report.split(/\r?\n/)[0], "the report must open with its own heading")
      .toBe("# Plain Language Gap Analysis");
    expect(report, "a report inside a comment shows a reader nothing")
      .not.toContain("<!--");
  });

  // Every number the report prints, checked against the numbers it was handed.
  // A review replaced each maturity level with a literal 4, and the rows still
  // appeared, so a reader was told the organisation had reached the top level
  // whatever its evidence said.
  test("the maturity rows carry the levels they were scored", () => {
    const { report } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    for (const [dimension, result] of Object.entries(maturity.dimensions)) {
      expect(report, `the row for ${dimension} must show its own level`)
        .toContain(`| ${dimension} | ${result.level} |`);
    }
    expect(report, "the overall level must be the one that was scored")
      .toContain(`**${maturity.overall}**`);
  });

  // The sentence that stops a good writing score standing in for evidence.
  // Reversing it to "always" survived every check.
  test("the report keeps text quality from raising a level", () => {
    const { report } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    expect(report, "text quality must never raise a maturity level")
      .toContain("Text quality alone never raises a maturity level.");
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
