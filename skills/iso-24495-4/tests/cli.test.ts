import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
      // The argument has just failed the check, so the message gives its place
      // and its length, and never the text the caller typed.
      expect(unknown.stderr).toEqual([
        "audit-corpus: unknown option of 9 characters at argument 2; expected --json",
      ]);

      const extra = capture();
      expect(runCorpusCli(
        ["bun", "audit-corpus-cli.ts", CORPUS, "--json", "one.json", "extra.md"],
        extra.writeOut,
        extra.writeErr,
      )).toBe(2);
      expect(extra.stderr).toEqual([
        "audit-corpus: unexpected argument of 8 characters at argument 4; expected --json",
      ]);

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
      expect(output.stdout.join("\n")).not.toContain("opening-version-date");
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

      // The totals rebuilt from the saved findings, rule by rule. Comparing the
      // sum alone lost the names: a review moved every count onto one rule, so
      // the file said two findings of legalese where it had recorded one of
      // legalese and one complex word, and the sum still matched.
      const countedByRule: Record<string, number> = {};
      for (const file of Object.values(savedAudit.files as Record<string, {
        violations: Array<{ rule: string }>;
      }>)) {
        for (const violation of file.violations) {
          countedByRule[violation.rule] = (countedByRule[violation.rule] ?? 0) + 1;
        }
      }
      expect(
        savedAudit.totals,
        "the saved totals must be the findings the saved file records",
      ).toEqual(countedByRule);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

// A runtime error's own message quotes what it choked on: Bun's JSON parser
// names the offending token, and a missing file's error names its whole path.
// Every failing input here carries one word, and no command may repeat it.
describe("a command never passes on what the runtime said about a failure", () => {
  const MARKER = "hunter2";
  const NUL = String.fromCharCode(0);

  /** Runs `check` with a fresh directory, and removes it afterwards. */
  function withWorkspace(check: (workspace: string) => void): void {
    const workspace = mkdtempSync(join(tmpdir(), "iso-relay-"));
    try {
      check(workspace);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }

  /** Requires one command to fail with exactly `message`, and with the marker nowhere in its output. */
  function expectFixedFailure(
    run: (stdout: (text: string) => number, stderr: (text: string) => number) => number,
    message: string,
  ): void {
    const output = capture();
    expect(run(output.writeOut, output.writeErr)).toBe(1);
    expect(output.stderr).toEqual([message]);
    expect([...output.stdout, ...output.stderr].join("\n")).not.toContain(MARKER);
  }

  test("audit-corpus", () => {
    withWorkspace((workspace) => {
      const absent = join(workspace, MARKER);
      expectFixedFailure(
        (out, err) => runCorpusCli(["bun", "audit-corpus-cli.ts", absent], out, err),
        `audit-corpus: <corpus-dir> names a path of ${absent.length} characters that cannot be listed: `
          + "no such file or directory",
      );
      const report = join(workspace, MARKER, "findings.json");
      expectFixedFailure(
        (out, err) => runCorpusCli(["bun", "audit-corpus-cli.ts", CORPUS, "--json", report], out, err),
        `audit-corpus: --json names a path of ${report.length} characters that cannot be written: `
          + "no such file or directory",
      );
      expectFixedFailure(
        (out, err) => runCorpusCli(["bun", "audit-corpus-cli.ts", `${MARKER}${NUL}`], out, err),
        "audit-corpus: stopped by an unexpected TypeError",
      );
    });
  });

  test("audit-evidence", () => {
    withWorkspace((workspace) => {
      const absent = join(workspace, MARKER);
      expectFixedFailure(
        (out, err) => runEvidenceCli(["bun", "audit-evidence-cli.ts", absent], out, err),
        `audit-evidence: <workspace-dir> names a path of ${absent.length} characters that cannot be read in full: `
          + "no such file or directory",
      );
      const report = join(workspace, MARKER, "evidence.json");
      expectFixedFailure(
        (out, err) => runEvidenceCli(["bun", "audit-evidence-cli.ts", REPOSITORY, "--json", report], out, err),
        `audit-evidence: --json names a path of ${report.length} characters that cannot be written: `
          + "no such file or directory",
      );
      expectFixedFailure(
        (out, err) => runEvidenceCli(["bun", "audit-evidence-cli.ts", `${MARKER}${NUL}`], out, err),
        "audit-evidence: stopped by an unexpected TypeError",
      );
    });
  });

  test("score-maturity", () => {
    withWorkspace((workspace) => {
      const absent = join(workspace, `${MARKER}.json`);
      expectFixedFailure(
        (out, err) => runMaturityCli(["bun", "score-maturity-cli.ts", absent], out, err),
        `score-maturity: <answers.json> names a path of ${absent.length} characters that cannot be read: `
          + "no such file or directory",
      );
      const broken = join(workspace, "broken.json");
      writeFileSync(broken, `{"dimensions": ${MARKER}}`);
      expectFixedFailure(
        (out, err) => runMaturityCli(["bun", "score-maturity-cli.ts", broken], out, err),
        "score-maturity: <answers.json> names a file of 23 characters that is not valid JSON",
      );
      // Valid JSON of the wrong shape is refused before anything is scored.
      const shapeless = join(workspace, "null.json");
      writeFileSync(shapeless, "null");
      expectFixedFailure(
        (out, err) => runMaturityCli(["bun", "score-maturity-cli.ts", shapeless], out, err),
        "score-maturity: <answers.json> must be an object; got null",
      );
      const report = join(workspace, MARKER, "maturity.json");
      expectFixedFailure(
        (out, err) => runMaturityCli(["bun", "score-maturity-cli.ts", ANSWERS, "--json", report], out, err),
        `score-maturity: --json names a path of ${report.length} characters that cannot be written: `
          + "no such file or directory",
      );
    });
  });

  test("generate-report", () => {
    withWorkspace((workspace) => {
      const findings = join(workspace, "findings.json");
      const evidence = join(workspace, "evidence.json");
      const maturity = join(workspace, "maturity.json");
      runCorpusCli(["bun", "audit-corpus-cli.ts", CORPUS, "--json", findings], () => {}, () => {});
      runEvidenceCli(["bun", "audit-evidence-cli.ts", REPOSITORY, "--json", evidence], () => {}, () => {});
      runMaturityCli(["bun", "score-maturity-cli.ts", ANSWERS, "--json", maturity], () => {}, () => {});
      const report = (...rest: string[]) =>
        (out: (text: string) => number, err: (text: string) => number) =>
          runReportCli(["bun", "generate-report-cli.ts", ...rest], out, err, () => "2026-10-06T12:00:00.000Z");

      // Each input is named by its own argument, so the user knows which to fix.
      const absent = join(workspace, `${MARKER}.json`);
      expectFixedFailure(
        report(absent, evidence, maturity),
        `generate-report: <findings.json> names a path of ${absent.length} characters that cannot be read: `
          + "no such file or directory",
      );
      const broken = join(workspace, "broken.json");
      writeFileSync(broken, `[${MARKER}]`);
      expectFixedFailure(
        report(findings, broken, maturity),
        "generate-report: <evidence.json> names a file of 9 characters that is not valid JSON",
      );
      expectFixedFailure(
        report(findings, evidence, workspace),
        `generate-report: <maturity.json> names a path of ${workspace.length} characters that cannot be read: `
          + "a directory where a file was expected",
      );
      expectFixedFailure(
        report(findings, evidence, maturity, "--state", broken),
        "generate-report: --state names a file of 9 characters that is not valid JSON",
      );

      // Valid JSON of the wrong shape is refused before the report is built.
      const shapeless = join(workspace, "empty.json");
      writeFileSync(shapeless, "{}");
      expectFixedFailure(
        report(shapeless, shapeless, shapeless),
        'generate-report: <findings.json>, "configHash" must be a string; got nothing',
      );

      const lost = join(workspace, MARKER, "out");
      expectFixedFailure(
        report(findings, evidence, maturity, "--state", lost),
        `generate-report: --state names a path of ${lost.length} characters that cannot be written: `
          + "no such file or directory",
      );
      expectFixedFailure(
        report(findings, evidence, maturity, "--out", lost),
        `generate-report: --out names a path of ${lost.length} characters that cannot be written: `
          + "no such file or directory",
      );
    });
  });

  // A value of the wrong shape does not always throw. The number 42 has no
  // "dimensions", so it scored as an organisation that had answered nothing,
  // and the command reported success.
  test("score-maturity refuses answers of the wrong shape, and scores nothing", () => {
    withWorkspace((workspace) => {
      const answers = join(workspace, "answers.json");
      const scores = join(workspace, "scores.json");
      const refused: Array<[text: string, problem: string]> = [
        ["42", "<answers.json> must be an object; got a number"],
        [`"${MARKER}"`, "<answers.json> must be an object; got a string"],
        ["[]", "<answers.json> must be an object; got an array"],
        ["{}", '<answers.json>, "dimensions" must be an object; got nothing'],
        [`{"dimensions": ["${MARKER}"]}`, '<answers.json>, "dimensions" must be an object; got an array'],
        [`{"dimensions": {"governance": {}, "${MARKER}": 1}}`,
          '<answers.json>, "dimensions", entry 2 must be an object; got a number'],
        [`{"dimensions": {"governance": {"policy-documented": "${MARKER}"}}}`,
          '<answers.json>, "dimensions", entry 1, entry 1 must be true or false; got a string'],
        ['{"organisation": 7, "dimensions": {}}', '<answers.json>, "organisation" must be a string; got a number'],
      ];
      for (const [text, problem] of refused) {
        writeFileSync(answers, text);
        expectFixedFailure(
          (out, err) => runMaturityCli(["bun", "score-maturity-cli.ts", answers, "--json", scores], out, err),
          `score-maturity: ${problem}`,
        );
        expect(existsSync(scores), text).toBe(false);
      }
      // A dimension left out, or one the catalogue does not list, is still scored.
      writeFileSync(answers, '{"dimensions": {"governance": {"policy-documented": true}, "other": {}}}');
      const output = capture();
      expect(runMaturityCli(["bun", "score-maturity-cli.ts", answers], output.writeOut, output.writeErr)).toBe(0);
      expect(output.stdout).toContain("| governance | 1 | owner-accountable |");
    });
  });

  // The reviewer gave it {"totals":{}}, {"artefacts":{}} and
  // {"dimensions":{},"overall":99}. It printed an overall maturity of 99 and
  // added "overall: 99" to the audit history.
  test("generate-report refuses an input of the wrong shape, and leaves the history alone", () => {
    withWorkspace((workspace) => {
      const write = (name: string, value: unknown): string => {
        const path = join(workspace, name);
        writeFileSync(path, JSON.stringify(value));
        return path;
      };
      const levels = (level: unknown) => Object.fromEntries(
        ["governance", "capability", "process", "measurement", "culture"]
          .map((dimension) => [dimension, { level, missing: [] }]),
      );
      const findings = write("findings.json", { configHash: "abcd1234", files: {}, totals: { legalese: 2 } });
      const evidence = write("evidence.json", { artefacts: { policy: { found: true, paths: ["policy.md"] } } });
      const maturity = write("maturity.json", { dimensions: levels(2), overall: 2 });
      const state = join(workspace, "state.json");
      const run = (...inputs: string[]) =>
        (out: (text: string) => number, err: (text: string) => number) => runReportCli(
          ["bun", "generate-report-cli.ts", ...inputs, "--state", state], out, err, () => "2026-10-06T12:00:00.000Z");
      const bad = (value: unknown): string => write("bad.json", value);

      // The three files the reviewer used, together and then one at a time.
      expectFixedFailure(
        run(write("f.json", { totals: {} }), write("e.json", { artefacts: {} }), write("m.json", { dimensions: {}, overall: 99 })),
        'generate-report: <findings.json>, "configHash" must be a string; got nothing',
      );
      expect(existsSync(state), "a refused audit must not start a history").toBe(false);
      const refused: Array<[which: number, value: unknown, problem: string]> = [
        [0, 42, "<findings.json> must be an object; got a number"],
        [0, { configHash: "c", files: {}, totals: { legalese: MARKER } },
          '<findings.json>, "totals", entry 1 must be a whole number of 0 or more; got a string'],
        [0, { configHash: "c", files: { [MARKER]: { violations: [{ rule: "r", line: 1 }] } }, totals: {} },
          '<findings.json>, "files", entry 1, "violations", entry 1, "detail" must be a string; got nothing'],
        [1, {}, '<evidence.json>, "artefacts" must be an object; got nothing'],
        [1, { artefacts: { policy: { found: "yes", paths: [] } } },
          '<evidence.json>, "artefacts", entry 1, "found" must be true or false; got a string'],
        [1, { artefacts: { policy: { found: true, paths: [7] } } },
          '<evidence.json>, "artefacts", entry 1, "paths", entry 1 must be a string; got a number'],
        [2, { dimensions: {}, overall: 99 }, '<maturity.json>, "dimensions", "governance" must be an object; got nothing'],
        [2, { dimensions: levels(2), overall: 99 },
          '<maturity.json>, "overall" must be a whole number from 0 to 4; got a whole number outside that range'],
        [2, { dimensions: levels(5), overall: 4 },
          '<maturity.json>, "dimensions", "governance", "level" must be a whole number from 0 to 4; got a whole number outside that range'],
        [2, { dimensions: levels(2.5), overall: 2 },
          '<maturity.json>, "dimensions", "governance", "level" must be a whole number from 0 to 4; got a number that is not whole'],
        [2, { dimensions: { ...levels(2), [MARKER]: { level: 1, missing: [] } }, overall: 2 },
          '<maturity.json>, "dimensions" must hold no member but those its shape names; got 1 more'],
        [2, { dimensions: levels(2), overall: 3 },
          '<maturity.json>, "overall" must be the lowest level of any dimension; got another whole number'],
      ];
      for (const [which, value, problem] of refused) {
        const inputs = [findings, evidence, maturity];
        inputs[which] = bad(value);
        expectFixedFailure(run(...inputs), `generate-report: ${problem}`);
        expect(existsSync(state), problem).toBe(false);
      }

      // A sound audit starts the history, and a refused one after it adds nothing.
      const sound = capture();
      expect(run(findings, evidence, maturity)(sound.writeOut, sound.writeErr)).toBe(0);
      const history = readFileSync(state, "utf8");
      expect(JSON.parse(history).snapshots).toHaveLength(1);
      expectFixedFailure(
        run(findings, evidence, bad({ dimensions: {}, overall: 99 })),
        'generate-report: <maturity.json>, "dimensions", "governance" must be an object; got nothing',
      );
      expect(readFileSync(state, "utf8")).toBe(history);

      // The history is an input too, and is refused the same way without being replaced.
      for (const [value, problem] of [
        [{ snapshots: MARKER }, '--state, "snapshots" must be an array; got a string'],
        [{ snapshots: [{ timestamp: "t", totals: {}, overall: 99 }] },
          '--state, "snapshots", entry 1, "overall" must be a whole number from 0 to 4; got a whole number outside that range'],
      ] as Array<[unknown, string]>) {
        const written = JSON.stringify(value);
        writeFileSync(state, written);
        expectFixedFailure(run(findings, evidence, maturity), `generate-report: ${problem}`);
        expect(readFileSync(state, "utf8")).toBe(written);
      }
    });
  });

  // The command held "no state file" as null, which is also what a state file
  // holding the JSON text null parses to. Such a file skipped the shape check,
  // and the command replaced it and the report beside it and exited 0.
  test("generate-report refuses a state file that holds null, and leaves it and the report alone", () => {
    withWorkspace((workspace) => {
      const write = (name: string, value: unknown): string => {
        const path = join(workspace, name);
        writeFileSync(path, JSON.stringify(value));
        return path;
      };
      const level = { level: 2, missing: [] };
      const inputs = [
        write("findings.json", { configHash: "abcd1234", files: {}, totals: { legalese: 2 } }),
        write("evidence.json", { artefacts: { policy: { found: true, paths: ["policy.md"] } } }),
        write("maturity.json", {
          dimensions: { governance: level, capability: level, process: level, measurement: level, culture: level },
          overall: 2,
        }),
      ];
      const state = join(workspace, "state.json");
      const report = join(workspace, "report.md");
      const run = (out: (text: string) => number, err: (text: string) => number) => runReportCli(
        ["bun", "generate-report-cli.ts", ...inputs, "--state", state, "--out", report], out, err,
        () => "2026-10-07T12:00:00.000Z");
      for (const [written, found] of [
        ["null", "null"],
        ["  null\n", "null"],
        ["0", "a number"],
        ["false", "a true or false value"],
        ['""', "a string"],
        ["[]", "an array"],
      ] as Array<[string, string]>) {
        writeFileSync(state, written);
        writeFileSync(report, "KEEP");
        expectFixedFailure(run, `generate-report: --state must be an object; got ${found}`);
        expect(readFileSync(state, "utf8"), written).toBe(written);
        expect(readFileSync(report, "utf8"), written).toBe("KEEP");
      }

      // No state file is still a first audit, and it starts the history.
      rmSync(state);
      const first = capture();
      expect(run(first.writeOut, first.writeErr), first.stderr).toBe(0);
      expect(JSON.parse(readFileSync(state, "utf8")).snapshots).toHaveLength(1);
      expect(readFileSync(report, "utf8")).toStartWith("# Plain Language Gap Analysis");
    });
  });

  test("audit-text", () => {
    withWorkspace((workspace) => {
      const absent = join(workspace, `${MARKER}.md`);
      expectFixedFailure(
        (out, err) => runTextAuditCli(["bun", "audit-text-cli.ts", absent], out, err) as number,
        `audit-text: <file-or-directory> names a path of ${absent.length} characters that cannot be read: `
          + "no such file or directory",
      );
      const document = join(workspace, "plain.md");
      writeFileSync(document, "# Plain\n\nA short sentence.\n");
      const report = join(workspace, MARKER, "findings.json");
      expectFixedFailure(
        (out, err) => runTextAuditCli(
          ["bun", "audit-text-cli.ts", document, "--project-dir", workspace, "--json", report],
          out,
          err,
        ) as number,
        `audit-text: --json names a path of ${report.length} characters that cannot be written: `
          + "no such file or directory",
      );
      expectFixedFailure(
        (out, err) => runTextAuditCli(["bun", "audit-text-cli.ts", `${MARKER}${NUL}.md`], out, err) as number,
        "audit-text: stopped by an unexpected TypeError",
      );
    });
  });
});

// Windows refuses a file name holding a line break or an escape character, so
// `lib/safe-text.test.ts` covers those. A mark that reverses text direction is
// cleaned by the same function and is a legal name on every platform, so it
// shows here that each command cleans the path it prints.
describe("a skipped entry is printed with its path cleaned", () => {
  const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);

  /** A directory holding one link that an audit skips, whose name reverses text direction. */
  function withReversingLink(run: (directory: string) => void): void {
    const directory = mkdtempSync(join(tmpdir(), "iso-skip-clean-"));
    try {
      const target = join(directory, "target");
      mkdirSync(target);
      symlinkSync(target, join(directory, `report${RIGHT_TO_LEFT_OVERRIDE}dm.exe`), "junction");
      rmSync(target, { recursive: true, force: true });
      run(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  test("audit-corpus", () => {
    withReversingLink((directory) => {
      const output = capture();
      expect(runCorpusCli(["bun", "audit-corpus-cli.ts", directory], output.writeOut, output.writeErr)).toBe(0);
      expect(output.stderr).toEqual([`warning: skipped unreadable entry: ${join(directory, "report dm.exe")}`]);
    });
  });

  test("audit-text", () => {
    withReversingLink((directory) => {
      const output = capture();
      expect(runTextAuditCli(
        ["bun", "audit-text-cli.ts", directory, "--project-dir", directory],
        output.writeOut,
        output.writeErr,
      )).toBe(0);
      expect(output.stderr).toEqual([`warning: skipped unreadable entry: ${join(directory, "report dm.exe")}`]);
    });
  });
});

describe("audit-evidence prints a path nobody has read", () => {
  // The paths come from a directory walk. A C1 control and a right-to-left
  // override are allowed in a file name on every platform, and an escape
  // character on Linux and macOS.
  test("a control character or a direction mark in a file name becomes a space, and the JSON keeps it", () => {
    const workspace = mkdtempSync(join(tmpdir(), "iso-evidence-unread-"));
    const temp = mkdtempSync(join(tmpdir(), "iso-evidence-unread-out-"));
    try {
      const control = String.fromCharCode(0x9b);
      const override = String.fromCharCode(0x202e);
      const name = `style-guide${override}[2J${control}x.md`;
      writeFileSync(join(workspace, name), "Words.\n");
      writeFileSync(join(workspace, "glossary.md"), "Words.\n");
      const jsonPath = join(temp, "evidence.json");
      const output = capture();
      expect(runEvidenceCli(["bun", "audit-evidence-cli.ts", workspace, "--json", jsonPath], output.writeOut, output.writeErr)).toBe(0);
      const printed = output.stdout.join("\n");
      expect(printed).not.toContain(control);
      expect(printed).not.toContain(override);
      expect(output.stdout[2]).toBe("| policy | yes | style-guide [2J x.md |");
      expect(output.stdout[6]).toBe("| glossary | yes | glossary.md |");
      expect(JSON.parse(readFileSync(jsonPath, "utf8")).artefacts.policy.paths).toEqual([name]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
