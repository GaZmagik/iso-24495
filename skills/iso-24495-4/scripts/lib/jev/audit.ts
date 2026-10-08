import { appendFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { auditText, configHash, isAuditedDocument, listTextFiles, projectAcronyms } from "../../audit-corpus.ts";
import { frontMatterRange, toLines } from "../parse.ts";
import type { Findings } from "../types.ts";
import { calibrationEvidence, MODEL, sha256, validateCalibration, type GateEvidence } from "./catalogue.ts";
import { createAsk, JevError, type Ask, type ClientOptions } from "./client.ts";
import { classify, planDocument, type Candidate, type Decision, type DocumentPlan } from "./engine.ts";
import { controllingTerminal, type Terminal } from "./terminal.ts";
import { safeCell, safePath, safePathCell, safeText, skippedEntryWarning } from "../safe-text.ts";

export const DISCLOSURE_VERSION = "0.8.0-r1";
export const LIMITATION = "Only purpose and colour receive calibrated decisions. Bounds are one-sided 95% lower bounds on agreement for the protocol's cluster representatives, assuming independent clusters. They are neither per-block reliability nor a document-level success probability. Correlated blocks do not extend that guarantee.";
export interface AuditLog { disclosureVersion: string; digest: string; paths: string[]; timestamp: string; complete: boolean }
export interface AuditDependencies {
  env?: Record<string, string | undefined>;
  terminal?: Terminal;
  client?: ClientOptions;
  now?: () => Date;
  read?: (path: string, encoding: "utf8") => string;
  writeLog?: (record: AuditLog, path: string) => void;
}
// Why a document is refused for sending. The words are fixed, so they are safe to print.
const UNRECOGNISED_FRONT_MATTER = "front matter could not be recognised safely";
export interface SelectedDocument {
  file: string;
  path: string;
  plan: DocumentPlan;
  /** Set when nothing from the document may be sent. The plan is then empty. */
  refusal?: string;
}
export interface Selection { documents: SelectedDocument[]; mechanical: Findings; skipped: string[]; paths: string[] }
interface Arguments { target: string; projectDir: string; send: boolean; yes: boolean; preview: boolean; json?: string; includeText: boolean; frontMatter: boolean }
interface Counts { assessed: number; pass: number; fail: number; unsure: number; skipped: number }
export interface Judgement extends Decision { file: string; line: number; id: string; excerpt: string; stateHash: string; state?: Record<string, string | number>; detail: string }
export interface JevReport { complete: boolean; limitation: string; evidence: GateEvidence[]; results: Judgement[]; notSent?: Array<{ file: string; reason: string }>; localFindings: Array<{ file: string; line: number; rule: string; detail: string }>; coverage: Array<{ file: string; eligibleOpenings: number; eligibleBlocks: number; checks: { purpose: Counts; colour: Counts } }> }

/**
 * Runs the calibrated Jev audit for one file or directory, as a preview or as
 * a send. Document text leaves this machine only on a send, and only after
 * agreement.
 *
 * Arguments, after the file or directory at `argv[2]`:
 *
 * - `--send` sends once agreement is given. Without it the run is a preview.
 * - `--yes` stands for agreement where input or output is not a terminal. At
 *   a terminal it is not enough: the user is still asked, and must type
 *   exactly "yes".
 * - `--json <file>` writes the report to that file, replacing it.
 * - `--include-judged-text` adds the full judged text to that report, and is
 *   refused without `--json`.
 * - `--project-dir <directory>` sets where paths are reported from and where
 *   the send log goes. The default is the current directory.
 * - Text mode needs `--jev-preview`, or `--jev` together with `--send`.
 *   Design mode previews unless `--send` is given.
 * - `--no-front-matter` is refused here, as is any option given twice.
 *
 * A Markdown document that opens with a closed "---" block which
 * `frontMatterRange` does not accept is refused: nothing from it is planned
 * or sent, whatever else is. The preview names it before agreement is asked
 * for, and the Jev findings and the report name it again. Its mechanical
 * findings are still printed in text mode. A refusal does not change the exit
 * code, so exit 0 can mean that every selected document was refused.
 *
 * Exit codes:
 *
 * - 0: the preview or the send completed. Findings and unsure results never
 *   change it.
 * - 1: a local failure. The selected path could not be read or is not a
 *   supported document, or the report or the send log could not be written.
 * - 2: the arguments were invalid, agreement was missing or was not "yes", or
 *   the selected content changed between the preview and the send.
 * - 3: the calibration files failed their integrity check and nothing was
 *   sent, or the service failed and every Jev verdict was discarded.
 * - 4: `TYPESAFE_API_KEY` is missing or holds a control character.
 *
 * A send reads the key from the environment and posts each request to
 * TypeSafe, where charges may apply. It then appends one line to
 * `.iso-24495-4/jev-audit.jsonl` under the project directory, creating that
 * folder, and does so for a failed send as well. Exit 1 after agreement can
 * therefore mean that text was sent and only the log or the report failed.
 * A preview writes nothing but the `--json` report.
 *
 * @param mode "text" also prints the mechanical findings and accepts `.txt`
 *     files. "design" accepts Markdown alone.
 * @param argv The whole command line.
 * @param stdout Receives the mechanical findings in text mode, then the
 *     disclosure, then the Jev findings after a send.
 * @param stderr Receives a warning for each skipped entry and each refused
 *     document, and the reason for every exit code but 0.
 * @param dependencies Replacements for the environment, the terminal, the
 *     client, the clock, the document reader and the log writer. Each
 *     defaults to the real one.
 */
export async function runAuditCli(mode: "text" | "design", argv: string[], stdout: (text: string) => void, stderr: (text: string) => void, dependencies: AuditDependencies = {}): Promise<number> {
  let args: Arguments;
  try { args = readArguments(mode, argv); } catch { stderr("Invalid audit arguments. Use --jev-preview or --jev --send for text; use --send for design. Non-interactive sending also requires --yes. Full judged text requires --include-judged-text and --json <file>."); return 2; }
  try { (dependencies.client?.validate ?? validateCalibration)(); } catch { stderr("Calibration integrity failed. Nothing was sent."); return 3; }
  let selection: Selection;
  try { selection = selectDocuments(args.target, args.projectDir, mode, dependencies.read, args.frontMatter); } catch { stderr("The selected path could not be read or is not a supported document."); return 1; }
  for (const path of selection.skipped) stderr(skippedEntryWarning(path));
  for (const document of selection.documents) {
    if (document.refusal !== undefined) stderr(`warning: not sent: ${safePath(document.file)}: ${document.refusal}`);
  }
  if (mode === "text") stdout(formatMechanical(selection.mechanical));
  stdout(formatPlan(selection, args.includeText, args.json));
  if (!args.send) {
    try { if (args.json !== undefined) writeFileSync(args.json, JSON.stringify({ mechanical: selection.mechanical, jev: emptyReport(selection, false), preview: true }, null, 2)); } catch { stderr("The preview report could not be written."); return 1; }
    return 0;
  }
  const terminal = dependencies.terminal ?? controllingTerminal();
  if (!terminal.inputIsTTY || !terminal.outputIsTTY) {
    if (!args.yes) { stderr("No terminal agreement is available. A user-supplied --yes is required with --send."); return 2; }
  } else {
    let agreement: string;
    try { agreement = await terminal.prompt(); } catch { stderr("The controlling terminal could not read agreement. Nothing was sent."); return 2; }
    if (agreement !== "yes") { stderr("Agreement was not yes. Nothing was sent."); return 2; }
  }
  const digest = scopeDigest(selection, args);
  try {
    const rebuilt = selectDocuments(args.target, args.projectDir, mode, dependencies.read, args.frontMatter);
    if (scopeDigest(rebuilt, args) !== digest) { stderr("The selected content or scope changed. Preview it and agree again. Nothing was sent."); return 2; }
  } catch { stderr("The selected content could not be rechecked. Nothing was sent."); return 1; }
  let ask: ReturnType<typeof createAsk>;
  try { ask = createAsk((dependencies.env ?? process.env).TYPESAFE_API_KEY ?? "", dependencies.client); }
  catch (error) { stderr(error instanceof JevError ? error.message : "Jev could not initialise."); return error instanceof JevError ? error.exitCode : 3; }
  const report = emptyReport(selection, true);
  const items = selection.documents.flatMap(document => document.plan.candidates.map(candidate => ({ document, candidate })));
  const sent = new Set<number>();
  const queue: Queue = { items, sent, next: 0, failed: false };
  await Promise.all(Array.from({ length: 4 }, () => worker(queue, ask, args.includeText, report)));
  report.results.sort((first, second) => selection.documents.findIndex(document => document.file === first.file) - selection.documents.findIndex(document => document.file === second.file) || first.line - second.line || first.id.localeCompare(second.id));
  if (queue.failed) { report.complete = false; report.results = []; }
  fillCoverage(report);
  report.results = report.results.filter(result => result.band !== "pass");
  try {
    const record: AuditLog = { disclosureVersion: DISCLOSURE_VERSION, digest: sha256(JSON.stringify(items.filter((item, index) => sent.has(index)).map(item => item.candidate.body))), paths: selection.paths, timestamp: (dependencies.now?.() ?? new Date()).toISOString(), complete: !queue.failed };
    (dependencies.writeLog ?? writeAuditLog)(record, join(args.projectDir, ".iso-24495-4", "jev-audit.jsonl"));
    if (args.json !== undefined) writeFileSync(args.json, JSON.stringify({ mechanical: selection.mechanical, jev: report }, null, 2));
  } catch { stderr("The audit log or report could not be written. Execution is incomplete."); return 1; }
  stdout(formatFindings(report));
  if (queue.failed) { stderr("Jev execution is incomplete. Jev verdicts were discarded; mechanical findings remain available."); return 3; }
  return 0;
}

interface Queue { items: Array<{ document: SelectedDocument; candidate: Candidate }>; sent: Set<number>; next: number; failed: boolean }

/** Asks about one queued candidate after another, until none is left or one fails. */
async function worker(queue: Queue, ask: Ask, includeText: boolean, report: JevReport): Promise<void> {
  while (!queue.failed && queue.next < queue.items.length) {
    const index = queue.next++;
    const { document, candidate } = queue.items[index];
    queue.sent.add(index);
    try {
      const decision = classify(candidate.kind, await ask(candidate.body));
      const result = judgement(document.file, candidate, decision, includeText);
      report.results.push(result);
    } catch { queue.failed = true; }
  }
}

/**
 * Reads the selected file or directory and plans what a Jev audit would send
 * for each document. Nothing is sent.
 *
 * @param target A file or a directory, resolved against the current
 *     directory. A directory is walked at any depth without following links.
 * @param projectDir Files are named by their path from it, with forward
 *     slashes, and its `.iso-24495-4/acronyms.json` supplies known acronyms.
 * @param mode "design", the default, takes Markdown alone and leaves
 *     `mechanical` without files. "text" also takes `.txt` files and runs the
 *     mechanical audit; a `.txt` file gets a plan with no requests.
 * @param read Replaces the file reader.
 * @param frontMatter False makes the mechanical audit read a leading "---"
 *     block as text. The Jev plan reads it as front matter either way.
 * @returns `documents` holds a plan for each file read, and `paths` the full
 *     path of each. A Markdown document that opens with a closed "---" block
 *     which `frontMatterRange` does not accept has a `refusal` and a plan
 *     with no requests and no findings, because the plan would read that
 *     block as prose. It stays in `documents` and `paths`, and its mechanical
 *     findings are kept. `skipped` holds every entry passed over. A target that is
 *     itself a symbolic link is skipped and not read, so `skipped` names it
 *     and every other list is empty. A directory with no supported file
 *     returns empty lists.
 * @throws The file system error when the target does not exist or a selected
 *     directory cannot be listed. An `Error` when a selected file has an
 *     unsupported ending or cannot be read. A file that cannot be read inside
 *     a selected directory is skipped instead. Whatever `planDocument`
 *     throws.
 */
export function selectDocuments(target: string, projectDir: string, mode: "text" | "design" = "design", read = readFileSync, frontMatter = true): Selection {
  const selected = resolve(target);
  const project = resolve(projectDir);
  const skipped: string[] = [];
  const selection: Selection = { documents: [], mechanical: { configHash: configHash(), files: {}, totals: {} }, skipped, paths: [] };
  const stat = lstatSync(selected);
  if (stat.isSymbolicLink()) { skipped.push(selected); return selection; }
  const paths = stat.isDirectory() ? listTextFiles(selected, path => skipped.push(path)).filter(path => mode === "text" || /\.(?:md|markdown)$/i.test(path)) : [selected];
  if (!stat.isDirectory() && (!isAuditedDocument(selected) || (mode === "design" && !/\.(?:md|markdown)$/i.test(selected)))) throw new Error("Unsupported document.");
  const knownAcronyms = projectAcronyms(project);
  for (const path of paths) {
    let text: string;
    try { text = read(path, "utf8"); } catch { if (!stat.isDirectory()) throw new Error("Unreadable document."); skipped.push(path); continue; }
    const file = relative(project, path).replaceAll("\\", "/");
    selection.paths.push(path);
    const markdown = /\.(?:md|markdown)$/i.test(path);
    if (mode === "text") {
      const violations = auditText(text, { knownAcronyms, fileName: path, frontMatter, markdown });
      selection.mechanical.files[file] = { violations };
      for (const finding of violations) selection.mechanical.totals[finding.rule] = (selection.mechanical.totals[finding.rule] ?? 0) + 1;
    }
    if (markdown && hasUnrecognisedFrontMatter(text)) {
      selection.documents.push({ file, path, plan: { candidates: [], findings: [] }, refusal: UNRECOGNISED_FRONT_MATTER });
      continue;
    }
    selection.documents.push({ file, path, plan: markdown ? planDocument(text) : { candidates: [], findings: [] } });
  }
  return selection;
}

/**
 * Whether a document opens with a closed "---" block that the calibrated guard
 * does not accept as front matter.
 *
 * `planDocument` hides front matter only where `frontMatterRange` accepts it.
 * That guard is conservative: a tab after a colon is valid YAML and fails it.
 * The plan then reads the metadata as prose, and it would be sent. The guard
 * is frozen with the calibration, so the document is refused here instead.
 *
 * The block need not be YAML. Metadata with one malformed line is still
 * metadata, and a test that asked for valid YAML would send exactly that
 * block. The cost is a document that opens with a horizontal rule and holds a
 * later line of "---" or "...": it is refused until the leading rule goes.
 */
function hasUnrecognisedFrontMatter(text: string): boolean {
  const lines = toLines(text);
  if (frontMatterRange(lines) !== null) return false;
  return /^---[ \t]*$/.test(lines[0] ?? "") && lines.some((line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line));
}

/**
 * The disclosure a user reads before agreeing to send: the recipient and
 * model, each selected path, the requests for each file, each document that
 * is refused for sending and why, the five largest payloads, the privacy
 * terms, the limitation and the calibration evidence.
 *
 * @param selection What `selectDocuments` returned. An empty selection gives
 *     the same text with totals of zero.
 * @param includeText True says that the full judged text will be saved to
 *     `json`, so `json` must then be given.
 * @param json The report path named in that sentence. It is not written.
 * @returns The text, one statement to a line. Paths in it have control
 *     characters removed.
 * @throws Whatever `calibrationEvidence` throws, because the evidence table
 *     is read from disk and checked on every call. A `TypeError` when
 *     `includeText` is true and `json` is absent.
 */
export function formatPlan(selection: Selection, includeText = false, json?: string): string {
  const candidates = selection.documents.flatMap(document => document.plan.candidates);
  const refused = selection.documents.filter(document => document.refusal !== undefined);
  const largest = [...selection.documents].sort((first, second) => payloadBytes(second.plan) - payloadBytes(first.plan) || first.file.localeCompare(second.file)).slice(0, 5);
  return [
    `Transmission preview: TypeSafe, model ${MODEL}, disclosure ${DISCLOSURE_VERSION}.`,
    "Document text leaves this machine when you agree to send. Charges may apply. Pricing and retention have not been checked.",
    "Privacy terms: https://typesafe.ai/legal/privacy-policy and https://typesafe.ai/legal/data-processing.",
    ...selection.paths.map(path => `Selected: ${safePath(path)}`),
    ...selection.documents.map(document => document.refusal !== undefined ? `- ${safePath(document.file)}: not sent, because its ${document.refusal}.`
      : `- ${safePath(document.file)}: ${document.plan.candidates.filter(candidate => candidate.kind === "opening").length} eligible openings, ${document.plan.candidates.filter(candidate => candidate.kind === "block").length} eligible blocks, ${document.plan.candidates.length} requests.`),
    ...(refused.length === 0 ? [] : [`Documents not sent: ${refused.length} of ${selection.documents.length}. A leading "---" block that is closed but lacks the shape of front matter may hold metadata, so nothing from such a document is sent. Correct the block or remove it to have the document assessed.`]),
    `Total: ${candidates.length} requests, ${candidates.length * 2} questions.`,
    "Purpose travels with the reader companion question; colour travels with the position companion question. Reader and position judgements are discarded.",
    "Five largest payload totals (UTF-8 bytes, including questions):",
    ...largest.map(document => `- ${safePath(document.file)}: ${payloadBytes(document.plan)} bytes.`),
    ...(includeText ? [`This export saves full judged document text locally to ${safePath(json as string)}.`] : ["JSON exports contain excerpts and state hashes by default."]),
    "A local send log records the payload digest, selected paths and timestamp. It records transmission; it does not prove agreement.",
    LIMITATION,
    ...formatEvidence(calibrationEvidence()),
  ].join("\n");
}

/**
 * The Jev section of a report as text: whether execution completed, each
 * document that was refused for sending, the limitation, the evidence table,
 * the findings and the coverage counts.
 *
 * @returns Markdown tables joined by line breaks. The findings table lists
 *     each local finding and each result that did not pass; a pass appears in
 *     the coverage counts alone. A report with no findings and no coverage
 *     keeps both table headers and has no rows. A file name is printed as
 *     `safePathCell` prints a path. Every other cell has control characters
 *     removed and pipes escaped.
 */
export function formatFindings(report: JevReport): string {
  const lines = ["Calibrated Jev checks", `Execution: ${report.complete ? "complete" : "incomplete"}.`,
    ...(report.notSent ?? []).map(document => `Not sent: ${safePath(document.file)}, because its ${safeText(document.reason)}.`), LIMITATION,
    ...formatEvidence(report.evidence),
    "| File | Line | Item | Check | Band | Score | Cut-off | Finding |",
    "|------|------|------|-------|------|-------|---------|---------|"];
  for (const finding of report.localFindings) lines.push(`| ${safePathCell(finding.file)} | ${finding.line} | local | ${finding.rule} | local | | | ${safeCell(finding.detail)} |`);
  for (const result of report.results.filter(result => result.band !== "pass")) {
    const diagnosis = result.diagnosisGate;
    const refinement = diagnosis === undefined ? "" : ` neither score ${diagnosis.score}, cut-off ${diagnosis.cutOff}, prerequisite ${diagnosis.prerequisite}.`;
    lines.push(`| ${safePathCell(result.file)} | ${result.line} | ${result.id} | ${result.rule} | ${result.band} | ${result.score} | ${result.cutOff} | ${safeCell(result.detail)}${refinement} Excerpt: ${safeCell(result.excerpt)} |`);
  }
  lines.push("| File | Check | Assessed | Pass | Fail | Unsure | Skipped |", "|------|-------|----------|------|------|--------|---------|");
  for (const coverage of report.coverage) for (const [check, counts] of Object.entries(coverage.checks)) lines.push(`| ${safePathCell(coverage.file)} | ${check} | ${counts.assessed} | ${counts.pass} | ${counts.fail} | ${counts.unsure} | ${counts.skipped} |`);
  lines.push("Colour passes appear only in counts and never approve a document. Unsure asserts no fault. Findings are proxies, not an ISO judgement.");
  return lines.join("\n");
}

// `safeText` lives in `../safe-text.ts`, so the plain audits can use it without
// this module. It is still exported here for callers that import it from here.
export { safeText };
function formatEvidence(gates: readonly GateEvidence[]): string[] {
  return ["| Gate | Cut-off | Prerequisite | Clusters | Wrong | Lower bound |", "|------|---------|--------------|----------|-------|-------------|",
    ...gates.map(gate => `| ${gate.id} | ${gate.cutOff} | ${gate.dependencies.join(", ") || "none"} | ${gate.clusters} | ${gate.wrong} | ${gate.bound} |`)];
}
function payloadBytes(plan: DocumentPlan): number { return plan.candidates.reduce((sum, candidate) => sum + Buffer.byteLength(JSON.stringify(candidate.body)), 0); }
function scopeDigest(selection: Selection, args: Arguments): string { return sha256(JSON.stringify({ paths: selection.paths, bodies: selection.documents.flatMap(document => document.plan.candidates.map(candidate => candidate.body)), report: args.json === undefined ? null : resolve(args.json), includeText: args.includeText })); }
function writeAuditLog(record: AuditLog, path: string): void { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(record) + "\n"); }

function emptyReport(selection: Selection, complete: boolean): JevReport {
  return { complete, limitation: LIMITATION, evidence: calibrationEvidence(), results: [],
    notSent: selection.documents.flatMap(document => document.refusal === undefined ? [] : [{ file: document.file, reason: document.refusal }]),
    localFindings: selection.documents.flatMap(document => document.plan.findings.map(finding => ({ file: document.file, ...finding }))),
    coverage: selection.documents.map(document => ({ file: document.file, eligibleOpenings: document.plan.candidates.filter(candidate => candidate.kind === "opening").length, eligibleBlocks: document.plan.candidates.filter(candidate => candidate.kind === "block").length, checks: { purpose: { assessed: 0, pass: 0, fail: 0, unsure: 0, skipped: 1 }, colour: { assessed: 0, pass: 0, fail: 0, unsure: 0, skipped: document.plan.candidates.filter(candidate => candidate.kind === "block").length } } })) };
}
function fillCoverage(report: JevReport): void {
  for (const coverage of report.coverage) {
    for (const [check, rule] of [["purpose", "opening-purpose"], ["colour", "colour-only"]] as const) {
      const results = report.results.filter(result => result.file === coverage.file && result.rule === rule);
      const counts = coverage.checks[check];
      counts.assessed = results.length;
      counts.skipped -= results.length;
      for (const result of results) counts[result.band]++;
    }
  }
}
function judgement(file: string, candidate: Candidate, decision: Decision, includeText: boolean): Judgement {
  const text = String(candidate.body.state.opening ?? candidate.body.state.paragraph);
  const result: Judgement = { ...decision, file, line: candidate.line, id: candidate.id, excerpt: Array.from(safeText(text)).slice(0, 60).join(""), stateHash: sha256(JSON.stringify(candidate.body.state)),
    detail: decision.band === "unsure" ? "Jev could not decide. This asserts no fault."
      : decision.rule === "colour-only" ? "The calibrated colour pass gate acted."
        : decision.diagnosis === "neither" ? "Neither the reader's task nor the document's scope is stated. Add both explicitly in the opening."
          : "Add an explicit reader's task and document scope in the opening." };
  if (includeText) result.state = candidate.body.state;
  return result;
}
function formatMechanical(findings: Findings): string {
  return ["Mechanical findings", "| File | Line | Rule | Finding |", "|------|------|------|---------|", ...Object.entries(findings.files).flatMap(([file, result]) => result.violations.map(finding => `| ${safePathCell(file)} | ${finding.line} | ${finding.rule} | ${safeCell(finding.detail)} |`)), "Mechanical findings are proxies, not an ISO judgement."].join("\n");
}
function readArguments(mode: "text" | "design", argv: string[]): Arguments {
  if (!argv[2] || argv[2].startsWith("--")) throw new Error();
  const args: Arguments = { target: argv[2], projectDir: process.cwd(), send: false, yes: false, preview: mode === "design", includeText: false, frontMatter: true };
  const seen = new Set<string>();
  for (let index = 3; index < argv.length; index++) {
    const option = argv[index];
    if (seen.has(option)) throw new Error();
    seen.add(option);
    if (option === "--send") args.send = true;
    else if (option === "--yes") args.yes = true;
    else if (option === "--include-judged-text") args.includeText = true;
    else if (option === "--no-front-matter") args.frontMatter = false;
    else if (option === "--jev-preview" && mode === "text") args.preview = true;
    else if (option === "--jev" && mode === "text") args.preview = false;
    else if (option === "--json" || option === "--project-dir") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error();
      if (option === "--json") args.json = value; else args.projectDir = value;
    } else throw new Error();
  }
  if (!args.frontMatter || (args.yes && !args.send) || (args.includeText && args.json === undefined)
    || (mode === "text" && ((!args.preview && !args.send) || (args.send && !seen.has("--jev")) || (seen.has("--jev-preview") && (args.send || seen.has("--jev")))))) throw new Error();
  return args;
}
