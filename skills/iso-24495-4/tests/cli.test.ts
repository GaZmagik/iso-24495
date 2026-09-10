import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCorpus, runCli as runCorpusCli } from "../scripts/audit-corpus.ts";
import { runCli as runEvidenceCli } from "../scripts/audit-evidence.ts";
import { runCli as runReportCli } from "../scripts/generate-report.ts";
import { runCli as runMaturityCli } from "../scripts/score-maturity.ts";
import { runCli as runTextAuditCli } from "../../iso-24495-text-audit/scripts/audit-text.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const CORPUS = join(FIXTURES, "corpus");
const REPOSITORY = join(FIXTURES, "repo-level2");
const ANSWERS = join(FIXTURES, "answers.sample.json");
const SCRIPTS = join(import.meta.dir, "..", "scripts");
const TEXT_AUDIT_SCRIPT = join(
  import.meta.dir,
  "..",
  "..",
  "iso-24495-text-audit",
  "scripts",
  "audit-text-cli.ts",
);

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

/** How many findings a totals map describes. */
function countFrom(totals: unknown): number {
  return Object.values((totals ?? {}) as Record<string, number>)
    .reduce((sum, count) => sum + count, 0);
}

describe("audit-corpus runCli", () => {
  test("prints the golden table and writes JSON", () => {
    const output = capture();
    const temp = mkdtempSync(join(tmpdir(), "iso-corpus-cli-"));
    try {
      const jsonPath = join(temp, "findings.json");
      expect(runCorpusCli(["bun", "audit-corpus-cli.ts", CORPUS, "--json", jsonPath], output.writeOut, output.writeErr)).toBe(0);
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
    expect(runCorpusCli(["bun", "audit-corpus-cli.ts"], missing.writeOut, missing.writeErr)).toBe(2);
    expect(missing.stderr).toEqual(["Usage: bun audit-corpus-cli.ts <corpus-dir> [--json <out-file>]"]);

    const malformed = capture();
    expect(runCorpusCli(["bun", "audit-corpus-cli.ts", CORPUS, "--json"], malformed.writeOut, malformed.writeErr)).toBe(2);
    expect(malformed.stderr[0]).toContain("--json requires");

    const absent = capture();
    expect(runCorpusCli(["bun", "audit-corpus-cli.ts", join(CORPUS, "missing")], absent.writeOut, absent.writeErr)).toBe(1);
    expect(absent.stderr[0]).toStartWith("audit-corpus:");
  });

  test("rejects malformed corpus options before writing any output", () => {
    const temp = mkdtempSync(join(tmpdir(), "iso-corpus-options-"));
    const originalDirectory = process.cwd();
    try {
      process.chdir(temp);
      writeFileSync("--project-dir", "keep this content");

      const collision = capture();
      expect(runCorpusCli(
        ["bun", "audit-corpus-cli.ts", CORPUS, "--json", "--project-dir"],
        collision.writeOut,
        collision.writeErr,
      )).toBe(2);
      expect(collision.stderr[0]).toContain("--json requires");
      expect(readFileSync("--project-dir", "utf8")).toBe("keep this content");

      const unknown = capture();
      expect(runCorpusCli(
        ["bun", "audit-corpus-cli.ts", CORPUS, "--unknown"],
        unknown.writeOut,
        unknown.writeErr,
      )).toBe(2);
      expect(unknown.stderr[0]).toContain("unknown option");

      const extra = capture();
      expect(runCorpusCli(
        ["bun", "audit-corpus-cli.ts", CORPUS, "extra.md"],
        extra.writeOut,
        extra.writeErr,
      )).toBe(2);
      expect(extra.stderr[0]).toContain("unexpected argument");

      const duplicate = capture();
      expect(runCorpusCli(
        ["bun", "audit-corpus-cli.ts", CORPUS, "--json", "one.json", "--json", "two.json"],
        duplicate.writeOut,
        duplicate.writeErr,
      )).toBe(2);
      expect(duplicate.stderr[0]).toContain("--json appears more than once");
    } finally {
      process.chdir(originalDirectory);
      rmSync(temp, { recursive: true, force: true });
    }
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
      expect(runCorpusCli(["bun", "audit-corpus-cli.ts", temp], output.writeOut, output.writeErr)).toBe(0);
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
      expect(runEvidenceCli(["bun", "audit-evidence-cli.ts", REPOSITORY, "--json", jsonPath], output.writeOut, output.writeErr)).toBe(0);
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
    expect(runEvidenceCli(["bun", "audit-evidence-cli.ts"], missing.writeOut, missing.writeErr)).toBe(2);
    expect(missing.stderr[0]).toStartWith("Usage:");
    const flag = capture();
    expect(runEvidenceCli(["bun", "audit-evidence-cli.ts", REPOSITORY, "--json"], flag.writeOut, flag.writeErr)).toBe(2);
    const absent = capture();
    expect(runEvidenceCli(["bun", "audit-evidence-cli.ts", join(REPOSITORY, "missing")], absent.writeOut, absent.writeErr)).toBe(1);
    expect(absent.stderr[0]).toStartWith("audit-evidence:");
  });
});

describe("score-maturity runCli", () => {
  test("prints the golden table and writes JSON", () => {
    const output = capture();
    const temp = mkdtempSync(join(tmpdir(), "iso-maturity-cli-"));
    try {
      const jsonPath = join(temp, "maturity.json");
      expect(runMaturityCli(["bun", "score-maturity-cli.ts", ANSWERS, "--json", jsonPath], output.writeOut, output.writeErr)).toBe(0);
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
    expect(runMaturityCli(["bun", "score-maturity-cli.ts"], missing.writeOut, missing.writeErr)).toBe(2);
    const flag = capture();
    expect(runMaturityCli(["bun", "score-maturity-cli.ts", ANSWERS, "--json"], flag.writeOut, flag.writeErr)).toBe(2);
    const absent = capture();
    expect(runMaturityCli(["bun", "score-maturity-cli.ts", join(FIXTURES, "missing.json")], absent.writeOut, absent.writeErr)).toBe(1);
    const temp = mkdtempSync(join(tmpdir(), "iso-maturity-bad-"));
    try {
      const bad = join(temp, "bad.json");
      writeFileSync(bad, "{not json");
      const malformed = capture();
      expect(runMaturityCli(["bun", "score-maturity-cli.ts", bad], malformed.writeOut, malformed.writeErr)).toBe(1);
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
      runCorpusCli(["bun", "audit-corpus-cli.ts", CORPUS, "--json", findingsPath], () => {}, () => {});
      runEvidenceCli(["bun", "audit-evidence-cli.ts", REPOSITORY, "--json", evidencePath], () => {}, () => {});
      runMaturityCli(["bun", "score-maturity-cli.ts", ANSWERS, "--json", maturityPath], () => {}, () => {});
      const output = capture();
      expect(runReportCli(
        ["bun", "generate-report-cli.ts", findingsPath, evidencePath, maturityPath, "--state", statePath, "--out", reportPath],
        output.writeOut,
        output.writeErr,
        () => "2026-08-13T12:00:00.000Z",
      )).toBe(0);
      expect(output).toMatchObject({ stdout: [], stderr: [] });
      expect(readFileSync(reportPath, "utf8")).toContain("Audit date: 2026-08-13T12:00:00.000Z.");
      expect(JSON.parse(readFileSync(statePath, "utf8")).snapshots).toHaveLength(1);

      const printed = capture();
      expect(runReportCli(
        ["bun", "generate-report-cli.ts", findingsPath, evidencePath, maturityPath, "--state", statePath],
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
    expect(runReportCli(["bun", "generate-report-cli.ts"], missing.writeOut, missing.writeErr)).toBe(2);
    const flag = capture();
    expect(runReportCli(["bun", "generate-report-cli.ts", "a", "b", "c", "--out"], flag.writeOut, flag.writeErr)).toBe(2);
    const stateFlag = capture();
    expect(runReportCli(["bun", "generate-report-cli.ts", "a", "b", "c", "--state"], stateFlag.writeOut, stateFlag.writeErr)).toBe(2);
    const absent = capture();
    expect(runReportCli(["bun", "generate-report-cli.ts", "missing-a", "missing-b", "missing-c"], absent.writeOut, absent.writeErr)).toBe(1);
    expect(absent.stderr[0]).toStartWith("generate-report:");
    const temp = mkdtempSync(join(tmpdir(), "iso-report-bad-"));
    try {
      const bad = join(temp, "bad.json");
      writeFileSync(bad, "{not json");
      const malformed = capture();
      expect(runReportCli(["bun", "generate-report-cli.ts", bad, bad, bad], malformed.writeOut, malformed.writeErr)).toBe(1);
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
      runCorpusCli(["bun", "audit-corpus-cli.ts", CORPUS, "--json", findingsPath], () => {}, () => {});
      runEvidenceCli(["bun", "audit-evidence-cli.ts", REPOSITORY, "--json", evidencePath], () => {}, () => {});
      runMaturityCli(["bun", "score-maturity-cli.ts", ANSWERS, "--json", maturityPath], () => {}, () => {});
      const output = capture();
      expect(runReportCli(
        ["bun", "generate-report-cli.ts", findingsPath, evidencePath, maturityPath],
        output.writeOut,
        output.writeErr,
      )).toBe(0);
      expect(output.stdout[0]).toMatch(/Audit date: \d{4}-\d{2}-\d{2}T/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

// The conventions test proves each entry file is logic-free, which a mistyped
// import path would also satisfy. Only running them proves they still work.
// Bun does not add a child process's execution to the parent's coverage data,
// so these earn no coverage and exist purely as end-to-end proof.
describe("command line entry files", () => {
  // Every test here pays for at least one cold Bun start, which takes seconds on
  // a loaded machine and longer on a shared build runner. The default five
  // second limit turns that cost into a random failure, so each test states its
  // own budget: a timeout here means the entry file hung, not that the box was
  // busy.
  const ENTRY_TIMEOUT_MS = 20_000;

  async function runScript(script: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", script, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    return { stdout, exitCode: await proc.exited };
  }

  function run(entry: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
    return runScript(join(SCRIPTS, entry), args);
  }

  test("audit-corpus-cli reports the fixture corpus", async () => {
    const { stdout, exitCode } = await run("audit-corpus-cli.ts", [CORPUS]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Total: 11 across 7 files.");
  }, ENTRY_TIMEOUT_MS);

  test("audit-text-cli reports one selected file", async () => {
    const file = join(CORPUS, "legalese-sample.md");
    const { stdout, exitCode } = await runScript(TEXT_AUDIT_SCRIPT, [file, "--project-dir", CORPUS]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("| legalese-sample.md | 3 | legalese |");
    expect(stdout).toContain("The user decides whether the text suits its readers and purpose.");
  }, ENTRY_TIMEOUT_MS);

  test("audit-evidence-cli reports the fixture repository", async () => {
    const { stdout, exitCode } = await run("audit-evidence-cli.ts", [REPOSITORY]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("| policy | yes | docs/plain-language-policy.md |");
  }, ENTRY_TIMEOUT_MS);

  test("score-maturity-cli reports the sample answers", async () => {
    const { stdout, exitCode } = await run("score-maturity-cli.ts", [ANSWERS]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Overall (weakest dimension): 0");
  });

  test("generate-report-cli writes a report from the three inputs", async () => {
    const temp = mkdtempSync(join(tmpdir(), "iso-entry-report-"));
    try {
      const findings = join(temp, "findings.json");
      const evidence = join(temp, "evidence.json");
      const maturity = join(temp, "maturity.json");
      await run("audit-corpus-cli.ts", [CORPUS, "--json", findings]);
      await run("audit-evidence-cli.ts", [REPOSITORY, "--json", evidence]);
      await run("score-maturity-cli.ts", [ANSWERS, "--json", maturity]);
      const { stdout, exitCode } = await run("generate-report-cli.ts", [findings, evidence, maturity]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("# Plain Language Gap Analysis");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }, ENTRY_TIMEOUT_MS);

  // Spawned concurrently: four cold Bun starts in sequence outrun the default
  // per-test timeout on a loaded machine.
  test("each entry file propagates the failure exit code", async () => {
    const entries = [
      join(SCRIPTS, "audit-corpus-cli.ts"),
      join(SCRIPTS, "audit-evidence-cli.ts"),
      join(SCRIPTS, "score-maturity-cli.ts"),
      join(SCRIPTS, "generate-report-cli.ts"),
      TEXT_AUDIT_SCRIPT,
    ];
    const results = await Promise.all(entries.map((entry) => runScript(entry, [])));
    expect(results.map((result) => result.exitCode)).toEqual(entries.map(() => 2));
  }, ENTRY_TIMEOUT_MS);

  // What a command saves must be what it would have shown.
  //
  // A review changed each writing call so the file differed from the
  // terminal: a saved report claiming certification, saved findings
  // recommending the legalese they had banned, saved evidence inventing
  // paths, saved maturity levels raised to the top. My first attempt at this
  // test read one side only, or looked for a shape rather than a value, and
  // four of those mutations walked straight past it.
  //
  // So each command runs twice on the same input, once to a file and once to
  // the terminal, and the two are compared whole. A reader keeps the file:
  // it is the copy that gets circulated and the one nobody re-runs.
  test("what a command writes is what it would have printed", () => {
    const workspace = mkdtempSync(join(tmpdir(), "iso-write-through-"));
    try {
      // A command prints a table and saves JSON, so the two are compared
      // by rebuilding the table the saved file implies and requiring the
      // printed one to be exactly that.
      //
      // Reading the saved file and looking for its entries in the terminal
      // was not enough, and a review proved it four ways: dropping every
      // category but one, emptying the dimensions, renaming the file a
      // finding belonged to, and keeping only the first finding of each. A
      // check that walks what survived cannot see what did not.
      const rows = (text: string): string[] => text.split(/\r?\n/)
        .filter((line) => line.startsWith("| ") && !line.startsWith("|--"));

      const findingsPath = join(workspace, "findings.json");
      const printedCorpus = capture();
      runCorpusCli(["bun", "audit-corpus-cli.ts", CORPUS, "--json", findingsPath],
        () => {}, () => {});
      runCorpusCli(["bun", "audit-corpus-cli.ts", CORPUS], printedCorpus.writeOut, () => {});
      const savedFindings = JSON.parse(readFileSync(findingsPath, "utf8"));
      expect(
        rows(printedCorpus.stdout.join("\n")),
        "the printed table must be exactly the saved totals",
      ).toEqual([
        "| Rule | Violations |",
        ...Object.entries(savedFindings.totals as Record<string, number>)
          .map(([rule, count]) => `| ${rule} | ${count} |`),
      ]);

      // The printed table carries counts, not details, so the saved detail has
      // nowhere to be compared against. A review used that to reverse the
      // advice in the file alone. It is compared against the library instead,
      // which is what the command is supposed to be writing down.
      const expectedCorpus = auditCorpus(CORPUS);
      expect(
        savedFindings.files,
        "the saved findings must be the findings the engine produced",
      ).toEqual(expectedCorpus.files);

      const evidencePath = join(workspace, "evidence.json");
      const printedEvidence = capture();
      runEvidenceCli(["bun", "audit-evidence-cli.ts", REPOSITORY, "--json", evidencePath],
        () => {}, () => {});
      runEvidenceCli(["bun", "audit-evidence-cli.ts", REPOSITORY],
        printedEvidence.writeOut, () => {});
      const savedEvidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      expect(
        rows(printedEvidence.stdout.join("\n")),
        "the printed table must be exactly the saved artefacts",
      ).toEqual([
        "| Artefact category | Found | Paths |",
        ...Object.entries(savedEvidence.artefacts as Record<string, {
          found: boolean; paths: string[];
        }>).map(([category, record]) =>
          `| ${category} | ${record.found ? "yes" : "no"} | `
          + `${record.paths.join("<br>") || "-"} |`),
      ]);

      const maturityPath = join(workspace, "maturity.json");
      const printedMaturity = capture();
      runMaturityCli(["bun", "score-maturity-cli.ts", ANSWERS, "--json", maturityPath],
        () => {}, () => {});
      runMaturityCli(["bun", "score-maturity-cli.ts", ANSWERS],
        printedMaturity.writeOut, () => {});
      const savedMaturity = JSON.parse(readFileSync(maturityPath, "utf8"));
      expect(
        rows(printedMaturity.stdout.join("\n")),
        "the printed table must be exactly the saved dimensions",
      ).toEqual([
        "| Dimension | Level | Blocking criteria |",
        ...Object.entries(savedMaturity.dimensions as Record<string, {
          level: number; missing: string[];
        }>).map(([dimension, scored]) =>
          `| ${dimension} | ${scored.level} | ${scored.missing.join(", ") || "-"} |`),
      ]);
      expect(printedMaturity.stdout.join("\n"),
        "the saved overall level must be printed")
        .toContain(`Overall (weakest dimension): ${savedMaturity.overall}`);
      // The report, on a fixed clock and with no state, so neither run
      // changes what the other would produce.
      const reportPath = join(workspace, "report.md");
      const printedReport = capture();
      const reportArgv = ["bun", "generate-report-cli.ts", findingsPath, evidencePath,
        maturityPath];
      runReportCli(
        [...reportArgv, "--out", reportPath],
        () => {}, () => {}, () => "2026-08-13T12:00:00.000Z",
      );
      runReportCli(
        reportArgv,
        printedReport.writeOut, () => {}, () => "2026-08-13T12:00:00.000Z",
      );
      expect(readFileSync(reportPath, "utf8"),
        "the saved report must be the report it prints")
        .toBe(printedReport.stdout.join(""));

      // And again with state, because a review made the saved copy differ
      // only when a state file was asked for.
      const statePath = join(workspace, "state.json");
      const withState = [...reportArgv, "--state", statePath];
      const statefulPath = join(workspace, "stateful.md");
      const printedStateful = capture();
      runReportCli(
        [...withState, "--out", statefulPath],
        () => {}, () => {}, () => "2026-08-14T12:00:00.000Z",
      );
      rmSync(statePath, { force: true });
      runReportCli(
        withState,
        printedStateful.writeOut, () => {}, () => "2026-08-14T12:00:00.000Z",
      );
      expect(readFileSync(statefulPath, "utf8"),
        "saving with a state file must not change the report")
        .toBe(printedStateful.stdout.join(""));

      // The text audit saves JSON and prints a table, so its findings are
      // compared through the details they share.
      const auditTarget = join(workspace, "notice.md");
      writeFileSync(auditTarget, "The party shall comply with the terms herein.\n");
      const auditJson = join(workspace, "audit.json");
      const printedAudit = capture();
      runTextAuditCli(
        ["bun", "audit-text-cli.ts", auditTarget, "--json", auditJson],
        () => {}, () => {},
      );
      runTextAuditCli(
        ["bun", "audit-text-cli.ts", auditTarget],
        printedAudit.writeOut, () => {},
      );
      // Every finding, with the file it belongs to, compared as the table.
      // A review renamed the saved file key and kept only the first finding
      // of each, and a check that walked the saved side saw neither.
      const savedAudit = JSON.parse(readFileSync(auditJson, "utf8"));
      const savedRows = Object.entries(savedAudit.files as Record<string, {
        violations: Array<{ rule: string; line: number; detail: string }>;
      }>).flatMap(([file, record]) => record.violations
        .map((violation) =>
          `| ${file} | ${violation.line} | ${violation.rule} | ${violation.detail} |`));
      expect(savedRows.length, "the probe must produce findings").toBeGreaterThan(0);
      expect(
        rows(printedAudit.stdout.join("\n")),
        "the printed table must be exactly the saved findings",
      ).toEqual([
        "| File | Line | Rule | Finding |",
        ...savedRows,
      ]);

      // The summary line as well as the table. A review saved a total of one
      // where the terminal reported two, and invented a skipped file the
      // terminal never mentioned. Neither of those shows up in a row.
      expect(
        printedAudit.stdout.join("\n"),
        "the saved counts must be the counts it printed",
      ).toContain(
        `Finding count: ${countFrom(savedAudit.totals)}. `
        + `Files read: ${Object.keys(savedAudit.files as Record<string, unknown>).length}. `
        + `Skipped entries: ${(savedAudit.skipped as string[]).length}.`,
      );

      // The saved totals must also be the findings the saved rows describe. A
      // review saved a total of one where two findings sat in the same file,
      // and the printed count is built from the totals rather than the rows.
      expect(
        countFrom(savedAudit.totals),
        "the saved totals must count the saved findings",
      ).toBe(savedRows.length);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

