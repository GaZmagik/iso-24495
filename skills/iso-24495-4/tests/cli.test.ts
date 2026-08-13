import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli as runCorpusCli } from "../scripts/audit-corpus.ts";
import { runCli as runEvidenceCli } from "../scripts/audit-evidence.ts";
import { runCli as runReportCli } from "../scripts/generate-report.ts";
import { runCli as runMaturityCli } from "../scripts/score-maturity.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const CORPUS = join(FIXTURES, "corpus");
const REPOSITORY = join(FIXTURES, "repo-level2");
const ANSWERS = join(FIXTURES, "answers.sample.json");

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writeOut: (text: string) => stdout.push(text),
    writeErr: (text: string) => stderr.push(text),
  };
}

describe("audit-corpus runCli", () => {
  test("prints the golden table and writes JSON", () => {
    const output = capture();
    const temp = mkdtempSync(join(tmpdir(), "iso-corpus-cli-"));
    try {
      const jsonPath = join(temp, "findings.json");
      expect(runCorpusCli(["bun", "audit-corpus.ts", CORPUS, "--json", jsonPath], output.writeOut, output.writeErr)).toBe(0);
      expect(output.stderr).toEqual([]);
      expect(output.stdout.join("\n")).toBe(
        "| Rule | Violations |\n" +
        "|------|------------|\n" +
        "| sentence-average | 1 |\n" +
        "| paragraph-length | 1 |\n" +
        "| heading-depth | 2 |\n" +
        "| legalese | 5 |\n" +
        "| sentence-length | 2 |\n\n" +
        "Total: 11 across 7 files.",
      );
      const written = JSON.parse(readFileSync(jsonPath, "utf8"));
      expect(written.files["good-policy.md"]).toEqual({ violations: [] });
      expect(written.configHash).toMatch(/^[0-9a-f]{8}$/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("reports usage and filesystem errors", () => {
    const missing = capture();
    expect(runCorpusCli(["bun", "audit-corpus.ts"], missing.writeOut, missing.writeErr)).toBe(2);
    expect(missing.stderr).toEqual(["Usage: bun audit-corpus.ts <corpus-dir> [--json <out-file>]"]);

    const malformed = capture();
    expect(runCorpusCli(["bun", "audit-corpus.ts", CORPUS, "--json"], malformed.writeOut, malformed.writeErr)).toBe(2);
    expect(malformed.stderr[0]).toContain("--json requires");

    const absent = capture();
    expect(runCorpusCli(["bun", "audit-corpus.ts", join(CORPUS, "missing")], absent.writeOut, absent.writeErr)).toBe(1);
    expect(absent.stderr[0]).toStartWith("audit-corpus:");
  });

  test("reports skipped unreadable entries without failing the audit", () => {
    const temp = mkdtempSync(join(tmpdir(), "iso-corpus-skip-"));
    try {
      writeFileSync(join(temp, "clean.md"), "A short sentence.\n");
      const target = join(temp, "target");
      mkdirSync(target);
      symlinkSync(target, join(temp, "dangling"), "junction");
      rmSync(target, { recursive: true, force: true });
      const output = capture();
      expect(runCorpusCli(["bun", "audit-corpus.ts", temp], output.writeOut, output.writeErr)).toBe(0);
      expect(output.stderr).toEqual([`warning: skipped unreadable entry: ${join(temp, "dangling")}`]);
      expect(output.stdout.at(-1)).toBe("\nTotal: 0 across 1 files.");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

describe("audit-evidence runCli", () => {
  test("prints the golden table and writes JSON", () => {
    const output = capture();
    const temp = mkdtempSync(join(tmpdir(), "iso-evidence-cli-"));
    try {
      const jsonPath = join(temp, "evidence.json");
      expect(runEvidenceCli(["bun", "audit-evidence.ts", REPOSITORY, "--json", jsonPath], output.writeOut, output.writeErr)).toBe(0);
      expect(output.stderr).toEqual([]);
      expect(output.stdout.join("\n")).toBe(
        "| Artefact category | Found | Paths |\n" +
        "|-------------------|-------|-------|\n" +
        "| policy | yes | docs/plain-language-policy.md |\n" +
        "| review-workflow | yes | .github/PULL_REQUEST_TEMPLATE.md |\n" +
        "| automated-checks | yes | .github/workflows/text-lint.yml |\n" +
        "| training | yes | training/introduction.md |\n" +
        "| glossary | yes | glossary.md |",
      );
      expect(JSON.parse(readFileSync(jsonPath, "utf8")).artefacts.policy.found).toBe(true);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("reports usage, malformed flags, and missing directories", () => {
    const missing = capture();
    expect(runEvidenceCli(["bun", "audit-evidence.ts"], missing.writeOut, missing.writeErr)).toBe(2);
    expect(missing.stderr[0]).toStartWith("Usage:");
    const flag = capture();
    expect(runEvidenceCli(["bun", "audit-evidence.ts", REPOSITORY, "--json"], flag.writeOut, flag.writeErr)).toBe(2);
    const absent = capture();
    expect(runEvidenceCli(["bun", "audit-evidence.ts", join(REPOSITORY, "missing")], absent.writeOut, absent.writeErr)).toBe(1);
    expect(absent.stderr[0]).toStartWith("audit-evidence:");
  });
});

describe("score-maturity runCli", () => {
  test("prints the golden table and writes JSON", () => {
    const output = capture();
    const temp = mkdtempSync(join(tmpdir(), "iso-maturity-cli-"));
    try {
      const jsonPath = join(temp, "maturity.json");
      expect(runMaturityCli(["bun", "score-maturity.ts", ANSWERS, "--json", jsonPath], output.writeOut, output.writeErr)).toBe(0);
      expect(output.stderr).toEqual([]);
      expect(output.stdout.join("\n")).toBe(
        "| Dimension | Level | Blocking criteria |\n" +
        "|-----------|-------|-------------------|\n" +
        "| governance | 2 | resourced-mandated |\n" +
        "| capability | 1 | training-delivered |\n" +
        "| process | 2 | signoff-gates |\n" +
        "| measurement | 0 | corpus-baseline-taken |\n" +
        "| culture | 1 | leadership-champions |\n\n" +
        "Overall (weakest dimension): 0",
      );
      expect(JSON.parse(readFileSync(jsonPath, "utf8")).overall).toBe(0);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("reports usage, malformed flags, missing files, and invalid JSON", () => {
    const missing = capture();
    expect(runMaturityCli(["bun", "score-maturity.ts"], missing.writeOut, missing.writeErr)).toBe(2);
    const flag = capture();
    expect(runMaturityCli(["bun", "score-maturity.ts", ANSWERS, "--json"], flag.writeOut, flag.writeErr)).toBe(2);
    const absent = capture();
    expect(runMaturityCli(["bun", "score-maturity.ts", join(FIXTURES, "missing.json")], absent.writeOut, absent.writeErr)).toBe(1);
    const temp = mkdtempSync(join(tmpdir(), "iso-maturity-bad-"));
    try {
      const bad = join(temp, "bad.json");
      writeFileSync(bad, "{not json");
      const malformed = capture();
      expect(runMaturityCli(["bun", "score-maturity.ts", bad], malformed.writeOut, malformed.writeErr)).toBe(1);
      expect(malformed.stderr[0]).toStartWith("score-maturity:");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

describe("generate-report runCli", () => {
  test("writes the report and append-only state deterministically", () => {
    const temp = mkdtempSync(join(tmpdir(), "iso-report-cli-"));
    try {
      const findingsPath = join(temp, "findings.json");
      const evidencePath = join(temp, "evidence.json");
      const maturityPath = join(temp, "maturity.json");
      const statePath = join(temp, "state.json");
      const reportPath = join(temp, "report.md");
      runCorpusCli(["bun", "audit-corpus.ts", CORPUS, "--json", findingsPath], () => {}, () => {});
      runEvidenceCli(["bun", "audit-evidence.ts", REPOSITORY, "--json", evidencePath], () => {}, () => {});
      runMaturityCli(["bun", "score-maturity.ts", ANSWERS, "--json", maturityPath], () => {}, () => {});
      const output = capture();
      expect(runReportCli(
        ["bun", "generate-report.ts", findingsPath, evidencePath, maturityPath, "--state", statePath, "--out", reportPath],
        output.writeOut,
        output.writeErr,
        () => "2026-08-13T12:00:00.000Z",
      )).toBe(0);
      expect(output).toMatchObject({ stdout: [], stderr: [] });
      expect(readFileSync(reportPath, "utf8")).toContain("Audit date: 2026-08-13T12:00:00.000Z.");
      expect(JSON.parse(readFileSync(statePath, "utf8")).snapshots).toHaveLength(1);

      const printed = capture();
      expect(runReportCli(
        ["bun", "generate-report.ts", findingsPath, evidencePath, maturityPath, "--state", statePath],
        printed.writeOut,
        printed.writeErr,
        () => "2026-08-14T12:00:00.000Z",
      )).toBe(0);
      expect(printed.stdout).toHaveLength(1);
      expect(printed.stdout[0]).toContain("## Trend");
      expect(JSON.parse(readFileSync(statePath, "utf8")).snapshots).toHaveLength(2);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("reports usage, malformed flags, missing files, and invalid JSON", () => {
    const missing = capture();
    expect(runReportCli(["bun", "generate-report.ts"], missing.writeOut, missing.writeErr)).toBe(2);
    const flag = capture();
    expect(runReportCli(["bun", "generate-report.ts", "a", "b", "c", "--out"], flag.writeOut, flag.writeErr)).toBe(2);
    const stateFlag = capture();
    expect(runReportCli(["bun", "generate-report.ts", "a", "b", "c", "--state"], stateFlag.writeOut, stateFlag.writeErr)).toBe(2);
    const absent = capture();
    expect(runReportCli(["bun", "generate-report.ts", "missing-a", "missing-b", "missing-c"], absent.writeOut, absent.writeErr)).toBe(1);
    expect(absent.stderr[0]).toStartWith("generate-report:");
    const temp = mkdtempSync(join(tmpdir(), "iso-report-bad-"));
    try {
      const bad = join(temp, "bad.json");
      writeFileSync(bad, "{not json");
      const malformed = capture();
      expect(runReportCli(["bun", "generate-report.ts", bad, bad, bad], malformed.writeOut, malformed.writeErr)).toBe(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("uses the real clock when no clock is injected", () => {
    const temp = mkdtempSync(join(tmpdir(), "iso-report-clock-"));
    try {
      const findingsPath = join(temp, "findings.json");
      const evidencePath = join(temp, "evidence.json");
      const maturityPath = join(temp, "maturity.json");
      runCorpusCli(["bun", "audit-corpus.ts", CORPUS, "--json", findingsPath], () => {}, () => {});
      runEvidenceCli(["bun", "audit-evidence.ts", REPOSITORY, "--json", evidencePath], () => {}, () => {});
      runMaturityCli(["bun", "score-maturity.ts", ANSWERS, "--json", maturityPath], () => {}, () => {});
      const output = capture();
      expect(runReportCli(
        ["bun", "generate-report.ts", findingsPath, evidencePath, maturityPath],
        output.writeOut,
        output.writeErr,
      )).toBe(0);
      expect(output.stdout[0]).toMatch(/Audit date: \d{4}-\d{2}-\d{2}T/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
