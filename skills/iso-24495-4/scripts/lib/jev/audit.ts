import { appendFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { auditText, configHash, isAuditedDocument, listTextFiles, projectAcronyms } from "../../audit-corpus.ts";
import type { Findings } from "../types.ts";
import { calibrationEvidence, MODEL, sha256, validateCalibration, type GateEvidence } from "./catalogue.ts";
import { createAsk, JevError, type ClientOptions } from "./client.ts";
import { classify, planDocument, type Candidate, type Decision, type DocumentPlan } from "./engine.ts";
import { controllingTerminal, type Terminal } from "./terminal.ts";

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
export interface SelectedDocument { file: string; path: string; plan: DocumentPlan }
export interface Selection { documents: SelectedDocument[]; mechanical: Findings; skipped: string[]; paths: string[] }
interface Arguments { target: string; projectDir: string; send: boolean; yes: boolean; preview: boolean; json?: string; includeText: boolean; frontMatter: boolean }
interface Counts { assessed: number; pass: number; fail: number; unsure: number; skipped: number }
export interface Judgement extends Decision { file: string; line: number; id: string; excerpt: string; stateHash: string; state?: Record<string, string | number>; detail: string }
export interface JevReport { complete: boolean; limitation: string; evidence: GateEvidence[]; results: Judgement[]; localFindings: Array<{ file: string; line: number; rule: string; detail: string }>; coverage: Array<{ file: string; eligibleOpenings: number; eligibleBlocks: number; checks: { purpose: Counts; colour: Counts } }> }

export async function runAuditCli(mode: "text" | "design", argv: string[], stdout: (text: string) => void, stderr: (text: string) => void, dependencies: AuditDependencies = {}): Promise<number> {
  let args: Arguments;
  try { args = readArguments(mode, argv); } catch { stderr("Invalid audit arguments. Use --jev-preview or --jev --send for text; use --send for design. Non-interactive sending also requires --yes. Full judged text requires --include-judged-text and --json <file>."); return 2; }
  try { (dependencies.client?.validate ?? validateCalibration)(); } catch { stderr("Calibration integrity failed. Nothing was sent."); return 3; }
  let selection: Selection;
  try { selection = selectDocuments(args.target, args.projectDir, mode, dependencies.read, args.frontMatter); } catch { stderr("The selected path could not be read or is not a supported document."); return 1; }
  for (const path of selection.skipped) stderr(`warning: skipped unreadable entry: ${safeText(path)}`);
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
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;
      const { document, candidate } = items[index];
      sent.add(index);
      try {
        const decision = classify(candidate.kind, await ask(candidate.body));
        const result = judgement(document.file, candidate, decision, args.includeText);
        report.results.push(result);
      } catch { failed = true; }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  report.results.sort((first, second) => selection.documents.findIndex(document => document.file === first.file) - selection.documents.findIndex(document => document.file === second.file) || first.line - second.line || first.id.localeCompare(second.id));
  if (failed) { report.complete = false; report.results = []; }
  fillCoverage(report);
  report.results = report.results.filter(result => result.band !== "pass");
  try {
    const record: AuditLog = { disclosureVersion: DISCLOSURE_VERSION, digest: sha256(JSON.stringify(items.filter((item, index) => sent.has(index)).map(item => item.candidate.body))), paths: selection.paths, timestamp: (dependencies.now?.() ?? new Date()).toISOString(), complete: !failed };
    (dependencies.writeLog ?? writeAuditLog)(record, join(args.projectDir, ".iso-24495-4", "jev-audit.jsonl"));
    if (args.json !== undefined) writeFileSync(args.json, JSON.stringify({ mechanical: selection.mechanical, jev: report }, null, 2));
  } catch { stderr("The audit log or report could not be written. Execution is incomplete."); return 1; }
  stdout(formatFindings(report));
  if (failed) { stderr("Jev execution is incomplete. Jev verdicts were discarded; mechanical findings remain available."); return 3; }
  return 0;
}

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
      const violations = auditText(text, { knownAcronyms, frontMatter, markdown });
      selection.mechanical.files[file] = { violations };
      for (const finding of violations) selection.mechanical.totals[finding.rule] = (selection.mechanical.totals[finding.rule] ?? 0) + 1;
    }
    selection.documents.push({ file, path, plan: markdown ? planDocument(text) : { candidates: [], findings: [] } });
  }
  return selection;
}

export function formatPlan(selection: Selection, includeText = false, json?: string): string {
  const candidates = selection.documents.flatMap(document => document.plan.candidates);
  const largest = [...selection.documents].sort((first, second) => payloadBytes(second.plan) - payloadBytes(first.plan) || first.file.localeCompare(second.file)).slice(0, 5);
  return [
    `Transmission preview: TypeSafe, model ${MODEL}, disclosure ${DISCLOSURE_VERSION}.`,
    "Document text leaves this machine when you agree to send. Charges may apply. Pricing and retention have not been checked.",
    "Privacy terms: https://typesafe.ai/legal/privacy-policy and https://typesafe.ai/legal/data-processing.",
    ...selection.paths.map(path => `Selected: ${safeText(path)}`),
    ...selection.documents.map(document => `- ${safeText(document.file)}: ${document.plan.candidates.filter(candidate => candidate.kind === "opening").length} eligible openings, ${document.plan.candidates.filter(candidate => candidate.kind === "block").length} eligible blocks, ${document.plan.candidates.length} requests.`),
    `Total: ${candidates.length} requests, ${candidates.length * 2} questions.`,
    "Purpose travels with the reader companion question; colour travels with the position companion question. Reader and position judgements are discarded.",
    "Five largest payload totals (UTF-8 bytes, including questions):",
    ...largest.map(document => `- ${safeText(document.file)}: ${payloadBytes(document.plan)} bytes.`),
    ...(includeText ? [`This export saves full judged document text locally to ${safeText(json as string)}.`] : ["JSON exports contain excerpts and state hashes by default."]),
    "A local send log records the payload digest, selected paths and timestamp. It records transmission; it does not prove agreement.",
    LIMITATION,
    ...formatEvidence(calibrationEvidence()),
  ].join("\n");
}

export function formatFindings(report: JevReport): string {
  const lines = ["Calibrated Jev checks", `Execution: ${report.complete ? "complete" : "incomplete"}.`, LIMITATION,
    ...formatEvidence(report.evidence),
    "| File | Line | Item | Check | Band | Score | Cut-off | Finding |",
    "|------|------|------|-------|------|-------|---------|---------|"];
  for (const finding of report.localFindings) lines.push(`| ${cell(finding.file)} | ${finding.line} | local | ${finding.rule} | local | | | ${cell(finding.detail)} |`);
  for (const result of report.results.filter(result => result.band !== "pass")) {
    const diagnosis = result.diagnosisGate;
    const refinement = diagnosis === undefined ? "" : ` neither score ${diagnosis.score}, cut-off ${diagnosis.cutOff}, prerequisite ${diagnosis.prerequisite}.`;
    lines.push(`| ${cell(result.file)} | ${result.line} | ${result.id} | ${result.rule} | ${result.band} | ${result.score} | ${result.cutOff} | ${cell(result.detail)}${refinement} Excerpt: ${cell(result.excerpt)} |`);
  }
  lines.push("| File | Check | Assessed | Pass | Fail | Unsure | Skipped |", "|------|-------|----------|------|------|--------|---------|");
  for (const coverage of report.coverage) for (const [check, counts] of Object.entries(coverage.checks)) lines.push(`| ${cell(coverage.file)} | ${check} | ${counts.assessed} | ${counts.pass} | ${counts.fail} | ${counts.unsure} | ${counts.skipped} |`);
  lines.push("Colour passes appear only in counts and never approve a document. Unsure asserts no fault. Findings are proxies, not an ISO judgement.");
  return lines.join("\n");
}

export function safeText(text: string): string { return text.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim(); }
function formatEvidence(gates: readonly GateEvidence[]): string[] {
  return ["| Gate | Cut-off | Prerequisite | Clusters | Wrong | Lower bound |", "|------|---------|--------------|----------|-------|-------------|",
    ...gates.map(gate => `| ${gate.id} | ${gate.cutOff} | ${gate.dependencies.join(", ") || "none"} | ${gate.clusters} | ${gate.wrong} | ${gate.bound} |`)];
}
function cell(text: string): string { return safeText(text).replaceAll("|", "\\|"); }
function payloadBytes(plan: DocumentPlan): number { return plan.candidates.reduce((sum, candidate) => sum + Buffer.byteLength(JSON.stringify(candidate.body)), 0); }
function scopeDigest(selection: Selection, args: Arguments): string { return sha256(JSON.stringify({ paths: selection.paths, bodies: selection.documents.flatMap(document => document.plan.candidates.map(candidate => candidate.body)), report: args.json === undefined ? null : resolve(args.json), includeText: args.includeText })); }
function writeAuditLog(record: AuditLog, path: string): void { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(record) + "\n"); }

function emptyReport(selection: Selection, complete: boolean): JevReport {
  return { complete, limitation: LIMITATION, evidence: calibrationEvidence(), results: [], localFindings: selection.documents.flatMap(document => document.plan.findings.map(finding => ({ file: document.file, ...finding }))),
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
  return ["Mechanical findings", "| File | Line | Rule | Finding |", "|------|------|------|---------|", ...Object.entries(findings.files).flatMap(([file, result]) => result.violations.map(finding => `| ${cell(file)} | ${finding.line} | ${finding.rule} | ${cell(finding.detail)} |`)), "Mechanical findings are proxies, not an ISO judgement."].join("\n");
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
