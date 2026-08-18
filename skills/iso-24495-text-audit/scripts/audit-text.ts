import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  auditText,
  configHash,
  isAuditedDocument,
  listTextFiles,
  projectAcronyms,
} from "../../iso-24495-4/scripts/audit-corpus.ts";
import type { Findings } from "../../iso-24495-4/scripts/lib/types.ts";

export interface TextAuditResult extends Findings {
  skipped: string[];
}

type ReadTextFile = (path: string, encoding: "utf8") => string;

function displayPath(path: string, projectDir: string): string {
  return relative(projectDir, path).replaceAll("\\", "/");
}

export function auditTarget(
  target: string,
  projectDir: string,
  readText: ReadTextFile = readFileSync,
): TextAuditResult {
  const absoluteTarget = resolve(target);
  const absoluteProject = resolve(projectDir);
  const skipped: string[] = [];
  const targetStat = lstatSync(absoluteTarget);
  if (targetStat.isSymbolicLink()) {
    return { configHash: configHash(), files: {}, totals: {}, skipped: [absoluteTarget] };
  }
  const paths = targetStat.isDirectory()
    ? listTextFiles(absoluteTarget, (path) => skipped.push(path))
    : [absoluteTarget];
  if (!targetStat.isDirectory() && !isAuditedDocument(absoluteTarget)) {
    throw new Error(`Select a supported text file: ${target}`);
  }

  const knownAcronyms = projectAcronyms(absoluteProject);
  const findings: TextAuditResult = {
    configHash: configHash(),
    files: {},
    totals: {},
    skipped,
  };
  for (const path of paths) {
    let text: string;
    try {
      text = readText(path, "utf8");
    } catch {
      skipped.push(path);
      continue;
    }
    const violations = auditText(text, { knownAcronyms });
    findings.files[displayPath(path, absoluteProject)] = { violations };
    for (const violation of violations) {
      findings.totals[violation.rule] = (findings.totals[violation.rule] ?? 0) + 1;
    }
  }
  return findings;
}

function tableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}

export function formatFindings(findings: TextAuditResult): string {
  const lines = [
    "| File | Line | Rule | Finding |",
    "|------|------|------|---------|",
  ];
  for (const [file, result] of Object.entries(findings.files)) {
    for (const violation of result.violations) {
      lines.push(
        `| ${tableCell(file)} | ${violation.line} | ${tableCell(violation.rule)} | ${tableCell(violation.detail)} |`,
      );
    }
  }
  const findingCount = Object.values(findings.totals).reduce((total, count) => total + count, 0);
  lines.push(
    "",
    `Finding count: ${findingCount}. Files read: ${Object.keys(findings.files).length}. Skipped entries: ${findings.skipped.length}.`,
    "Mechanical findings are proxies, not an ISO judgement.",
    "The user decides whether the text suits its readers and purpose.",
  );
  return lines.join("\n");
}

export function runCli(
  argv: string[],
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): number {
  const target = argv[2];
  if (!target) {
    stderr(
      "Usage: bun audit-text-cli.ts <file-or-directory> [--project-dir <directory>] [--json <out-file>]",
    );
    return 2;
  }
  let jsonPath: string | undefined;
  let projectDir = process.cwd();
  const seenOptions = new Set<string>();
  for (let index = 3; index < argv.length; index++) {
    const option = argv[index];
    if (option !== "--json" && option !== "--project-dir") {
      const kind = option.startsWith("--") ? "unknown option" : "unexpected argument";
      stderr(`audit-text: ${kind}: ${option}`);
      return 2;
    }
    if (seenOptions.has(option)) {
      stderr(`audit-text: ${option} appears more than once`);
      return 2;
    }
    seenOptions.add(option);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      const expected = option === "--json" ? "an output file" : "a directory";
      stderr(`audit-text: ${option} requires ${expected}`);
      return 2;
    }
    if (option === "--json") {
      jsonPath = value;
    } else {
      projectDir = value;
    }
    index++;
  }

  try {
    const findings = auditTarget(target, projectDir);
    for (const path of findings.skipped) {
      stderr(`warning: skipped unreadable entry: ${path}`);
    }
    if (jsonPath !== undefined) {
      writeFileSync(jsonPath, JSON.stringify(findings, null, 2));
    }
    stdout(formatFindings(findings));
    return 0;
  } catch (error) {
    stderr(`audit-text: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
