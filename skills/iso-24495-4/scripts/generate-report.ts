// Merge corpus findings, evidence, and maturity into the gap report, and
// append a snapshot to the audit state. State is append-only: history is
// never rewritten, so successive audits prove (or disprove) progress.

import type { AuditState, Evidence, Findings, Maturity } from "./lib/types.ts";
import { readJsonFile, unexpectedKind, writeTextFile, type JsonFile } from "./lib/failure.ts";
import { existsSync } from "node:fs";

export interface ReportInput {
  findings: Findings;
  evidence: Evidence;
  maturity: Maturity;
  state: AuditState | null;
  /** ISO 8601 timestamp for this audit, passed in so runs are reproducible. */
  now: string;
}

/**
 * Builds the gap report for one audit, and the audit state with this audit
 * added to its history.
 *
 * @param input The three results to merge and the state so far. A `state` of
 *     `null` means a first audit. The input is not altered: the history is
 *     copied before the new snapshot joins it.
 * @returns `report` is Markdown. Its Trend section appears only once the
 *     history holds two audits or more. `state` holds every earlier snapshot
 *     and one more, and is what the caller must save for the next audit.
 *     Nothing is written to disk.
 * @throws A `TypeError` when an input lacks a part the report reads, such as
 *     `findings.totals`. The shape is not checked first.
 */
export function generateReport(input: ReportInput): { report: string; state: AuditState } {
  const { findings, evidence, maturity, now } = input;
  const snapshots = input.state ? structuredClone(input.state.snapshots) : [];
  snapshots.push({
    timestamp: now,
    totals: structuredClone(findings.totals),
    overall: maturity.overall,
  });
  const state: AuditState = { snapshots };

  const lines: string[] = [];
  lines.push("# Plain Language Gap Analysis");
  lines.push("");
  lines.push(
    `> Provisional: this analysis is based on the public scope of ISO/CD 24495-4 (committee draft, unpublished). It is not a compliance statement and confers no certification. Audit date: ${now}.`,
  );
  lines.push("");
  lines.push("## Maturity");
  lines.push("");
  lines.push("| Dimension | Level | Blocking criteria |");
  lines.push("|-----------|-------|-------------------|");
  for (const [dimension, result] of Object.entries(maturity.dimensions)) {
    lines.push(`| ${dimension} | ${result.level} | ${result.missing.join(", ") || "-"} |`);
  }
  lines.push("");
  lines.push(`Overall maturity (weakest dimension): **${maturity.overall}**.`);
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  lines.push("| Artefact category | Found | Paths |");
  lines.push("|-------------------|-------|-------|");
  for (const [category, artefact] of Object.entries(evidence.artefacts)) {
    lines.push(
      `| ${category} | ${artefact.found ? "yes" : "no"} | ${artefact.paths.join("<br>") || "-"} |`,
    );
  }
  lines.push("");
  lines.push("## Corpus findings");
  lines.push("");
  lines.push("| Rule | Violations |");
  lines.push("|------|------------|");
  for (const [rule, count] of Object.entries(findings.totals)) {
    lines.push(`| ${rule} | ${count} |`);
  }
  lines.push("");
  lines.push(
    "Corpus metrics are proxies for the Measurement dimension only. Text quality alone never raises a maturity level.",
  );
  if (snapshots.length >= 2) {
    lines.push("");
    lines.push("## Trend");
    lines.push("");
    lines.push("| Audit date | Overall | Total violations |");
    lines.push("|------------|---------|------------------|");
    for (const snapshot of snapshots) {
      const total = Object.values(snapshot.totals).reduce((a, b) => a + b, 0);
      lines.push(`| ${snapshot.timestamp} | ${snapshot.overall} | ${total} |`);
    }
  }
  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  lines.push("- The underlying standard is an unpublished committee draft; criteria may change.");
  lines.push("- Text heuristics are English-centric and approximate.");
  lines.push("- Maturity levels reflect the evidence supplied; absent evidence scores as absent.");
  lines.push("- A human reviewer must validate this report before the organisation acts on it.");
  lines.push("");

  return { report: lines.join("\n"), state };
}

/**
 * Reads the three audit results, writes the gap report and records the audit
 * in the state file.
 *
 *   bun generate-report-cli.ts <findings.json> <evidence.json> <maturity.json> [--state <state.json>] [--out <report.md>]
 *
 * `--state` names the audit history. It is read if it exists and then
 * replaced with the history plus this audit; a file that does not exist yet
 * is a first audit. Without `--state` no history is kept. `--out` writes the
 * report to a file, replacing it; without it the report goes to `stdout`.
 *
 * Exit 0 means the report was produced. Exit 1 means a file could not be read
 * or written, or an input did not hold the shape its command writes. Exit 2
 * means the arguments were wrong.
 *
 * The state is written before the report. So exit 1 from a failed `--out`
 * leaves this audit recorded, and a second run records it twice.
 *
 * @param argv The whole command line, so the three inputs start at index 2.
 * @param stdout Receives the report when `--out` is absent.
 * @param stderr Receives the usage line or the reason for exit 1 or 2.
 * @param now Supplies the timestamp of this audit. The default is the current
 *     time in ISO 8601 form.
 */
export function runCli(
  argv: string[],
  stdout: (text: string) => void,
  stderr: (text: string) => void,
  now: () => string = () => new Date().toISOString(),
): number {
  const [findingsPath, evidencePath, maturityPath] = argv.slice(2);
  if (!findingsPath || !evidencePath || !maturityPath) {
    stderr(
      "Usage: bun generate-report-cli.ts <findings.json> <evidence.json> <maturity.json> [--state <state.json>] [--out <report.md>]",
    );
    return 2;
  }
  const stateFlag = argv.indexOf("--state");
  const outFlag = argv.indexOf("--out");
  if (stateFlag !== -1 && !argv[stateFlag + 1]) {
    stderr("generate-report: --state requires a state file");
    return 2;
  }
  if (outFlag !== -1 && !argv[outFlag + 1]) {
    stderr("generate-report: --out requires a report file");
    return 2;
  }
  const statePath = stateFlag !== -1 ? argv[stateFlag + 1] : null;
  // A state file that does not exist yet is a first audit, not a failure.
  const inputs: JsonFile[] = [
    statePath && existsSync(statePath) ? readJsonFile(statePath, "--state") : { ok: true, value: null },
    readJsonFile(findingsPath, "<findings.json>"),
    readJsonFile(evidencePath, "<evidence.json>"),
    readJsonFile(maturityPath, "<maturity.json>"),
  ];
  const values: unknown[] = [];
  for (const input of inputs) {
    if (!input.ok) {
      stderr(`generate-report: ${input.problem}`);
      return 1;
    }
    values.push(input.value);
  }
  const [priorState, findings, evidence, maturity] = values;
  try {
    const { report, state } = generateReport({
      findings: findings as Findings,
      evidence: evidence as Evidence,
      maturity: maturity as Maturity,
      state: priorState as AuditState | null,
      now: now(),
    });
    const stateProblem = statePath ? writeTextFile(statePath, JSON.stringify(state, null, 2), "--state") : null;
    if (stateProblem !== null) {
      stderr(`generate-report: ${stateProblem}`);
      return 1;
    }
    if (outFlag === -1) {
      stdout(report);
      return 0;
    }
    const reportProblem = writeTextFile(argv[outFlag + 1], report, "--out");
    if (reportProblem !== null) {
      stderr(`generate-report: ${reportProblem}`);
      return 1;
    }
    return 0;
  } catch (error) {
    // Every file was read and parsed above, and both files are written without
    // throwing. So what remains is an input of a shape the report cannot be
    // built from.
    stderr(
      `generate-report: stopped by ${unexpectedKind(error)}; `
        + "check that each input file holds what its command wrote",
    );
    return 1;
  }
}
