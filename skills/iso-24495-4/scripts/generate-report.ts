// Merge corpus findings, evidence, and maturity into the gap report, and
// append a snapshot to the audit state. State is append-only: history is
// never rewritten, so successive audits prove (or disprove) progress.

import { EVIDENCE_SHAPE, FINDINGS_SHAPE, MATURITY_SHAPE, STATE_SHAPE } from "./lib/types.ts";
import type { AuditState, Evidence, Findings, Maturity } from "./lib/types.ts";
import { readJsonFile, writeTextFile, type JsonFile } from "./lib/failure.ts";
import { shapeProblem } from "./lib/json-shape.ts";
import { safeCell, safePathCell } from "./lib/safe-text.ts";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

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
 * means the arguments were wrong. That includes `--state` and `--out` naming
 * one file, as `asOneFile` decides: the report would be written over the
 * history. It is refused before anything is read or written.
 *
 * Every input is checked against its shape in `lib/types.ts` before the
 * report is built, the state file included when it exists. A maturity file
 * must also give the lowest level of its dimensions as `overall`. An input
 * that is refused leaves the state file as it was, and no report is written.
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
  const statePath = stateFlag !== -1 ? argv[stateFlag + 1] : null;
  const outPath = outFlag !== -1 ? argv[outFlag + 1] : null;
  if (stateFlag !== -1 && !statePath) {
    stderr("generate-report: --state requires a state file");
    return 2;
  }
  if (outFlag !== -1 && !outPath) {
    stderr("generate-report: --out requires a report file");
    return 2;
  }
  if (statePath && outPath && asOneFile(statePath) === asOneFile(outPath)) {
    stderr("generate-report: --state and --out name one file; give each a file of its own");
    return 2;
  }
  // A state file that does not exist yet is a first audit, not a failure. Whether
  // one exists is kept apart from what it holds, because no value can stand for
  // "no file": a state file holding the JSON text null parses to null, and that
  // file was once taken for a first audit, never checked, and replaced.
  const existingState = statePath && existsSync(statePath) ? statePath : undefined;
  const stateExists = existingState !== undefined;
  const inputs: JsonFile[] = [
    existingState !== undefined ? readJsonFile(existingState, "--state") : { ok: true, value: undefined },
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
  const shape = shapeProblem(findings, FINDINGS_SHAPE, "<findings.json>")
    ?? shapeProblem(evidence, EVIDENCE_SHAPE, "<evidence.json>")
    ?? maturityProblem(maturity)
    ?? (stateExists ? shapeProblem(priorState, STATE_SHAPE, "--state") : null);
  if (shape !== null) {
    stderr(`generate-report: ${shape}`);
    return 1;
  }
  // Each value was checked against the shape of its type just above.
  const { report, state } = generateReport({
    findings: findings as Findings,
    evidence: evidence as Evidence,
    maturity: maturity as Maturity,
    state: stateExists ? priorState as AuditState : null,
    now: now(),
  });
  const stateProblem = statePath ? writeTextFile(statePath, JSON.stringify(state, null, 2), "--state") : null;
  if (stateProblem !== null) {
    stderr(`generate-report: ${stateProblem}`);
    return 1;
  }
  if (!outPath) {
    stdout(report);
    return 0;
  }
  const reportProblem = writeTextFile(outPath, report, "--out");
  if (reportProblem !== null) {
    stderr(`generate-report: ${reportProblem}`);
    return 1;
  }
  return 0;
}

/**
 * One spelling for the file a path names, so that two paths to one file compare
 * equal: a relative path and an absolute one, a path through "." or "..", a path
 * through a symbolic link, and on Windows two cases of one name.
 *
 * A file that is there is named as the file system names it. One that is not
 * there yet is named by its directory as the file system names that, and its own
 * name as written. Where the directory is not there either, the path is only made
 * absolute. On Windows the result is in lower case, since a name there is one name
 * in any case.
 *
 * Two links to one file, made with a hard link, are not seen as one.
 */
function asOneFile(path: string): string {
  const absolute = resolve(path);
  const file = nameOnDisk(absolute);
  const directory = nameOnDisk(dirname(absolute));
  const one = file ?? (directory === null ? absolute : join(directory, basename(absolute)));
  return process.platform === "win32" ? one.toLowerCase() : one;
}

/** The path as the file system names it, or null where nothing is there. */
function nameOnDisk(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

/**
 * What is wrong with a parsed maturity file, or null when it is sound.
 *
 * The shape alone lets through a file whose `overall` is not the lowest level
 * of its dimensions, which the report would print and the history would keep.
 */
function maturityProblem(maturity: unknown): string | null {
  const shape = shapeProblem(maturity, MATURITY_SHAPE, "<maturity.json>");
  if (shape !== null) return shape;
  // The value was checked against the shape of the type on the line above.
  const { dimensions, overall } = maturity as Maturity;
  const lowest = Math.min(...Object.values(dimensions).map((dimension) => dimension.level));
  return overall === lowest
    ? null
    : '<maturity.json>, "overall" must be the lowest level of any dimension; got another whole number';
}

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
 * @returns `report` is Markdown. Every value in it that came from an input is
 *     cleaned with `safeCell`, numbers included, because an input is a file
 *     nobody has read: a control character, a line break or a mark that
 *     reverses text direction becomes a space, and a pipe is escaped. An
 *     evidence path is the one exception: it is printed as `safePathCell`
 *     prints a path, a code span with every character kept or shown as its
 *     code. Its
 *     Trend section appears only once the history holds two audits or more. `state` holds every earlier snapshot
 *     and one more, as given and not cleaned, and is what the caller must
 *     save for the next audit.
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
    lines.push(`| ${cell(dimension)} | ${cell(result.level)} | ${result.missing.map(cell).join(", ") || "-"} |`);
  }
  lines.push("");
  lines.push(`Overall maturity (weakest dimension): **${cell(maturity.overall)}**.`);
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  lines.push("| Artefact category | Found | Paths |");
  lines.push("|-------------------|-------|-------|");
  for (const [category, artefact] of Object.entries(evidence.artefacts)) {
    lines.push(
      `| ${cell(category)} | ${artefact.found ? "yes" : "no"} | ${artefact.paths.map((path) => safePathCell(String(path))).join("<br>") || "-"} |`,
    );
  }
  lines.push("");
  lines.push("## Corpus findings");
  lines.push("");
  lines.push("| Rule | Violations |");
  lines.push("|------|------------|");
  for (const [rule, count] of Object.entries(findings.totals)) {
    lines.push(`| ${cell(rule)} | ${cell(count)} |`);
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
      lines.push(`| ${cell(snapshot.timestamp)} | ${cell(snapshot.overall)} | ${cell(total)} |`);
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

/** A value from an input file as one table cell. The file is not checked, so a number may be anything. */
function cell(value: unknown): string {
  return safeCell(String(value));
}
