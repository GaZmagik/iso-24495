import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  auditText,
  configHash,
  isAuditedDocument,
  listTextFiles,
  projectAcronyms,
} from "../../iso-24495-4/scripts/audit-corpus.ts";
import { pathFailure, writeTextFile } from "../../iso-24495-4/scripts/lib/failure.ts";
import type { Reading } from "../../iso-24495-4/scripts/lib/parse.ts";
import type { Findings } from "../../iso-24495-4/scripts/lib/types.ts";
import { runAuditCli, type AuditDependencies } from "../../iso-24495-4/scripts/lib/jev/audit.ts";

export interface TextAuditResult extends Findings {
  skipped: string[];
}

type ReadTextFile = (path: string, encoding: "utf8") => string;

/**
 * The selected path names a file the audit does not read. This file writes the
 * message, from a length and a fixed list of endings, so the message is safe
 * to print as it stands.
 */
export class UnsupportedSelection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSelection";
  }
}

function displayPath(path: string, projectDir: string): string {
  return relative(projectDir, path).replaceAll("\\", "/");
}

/**
 * Runs the mechanical audit over one file, or over every audited document
 * under a directory. Nothing is sent or changed.
 *
 * @param target A file ending in .md, .markdown or .txt, or a directory. It
 *     is resolved against the current directory, not against `projectDir`.
 * @param projectDir Files are named by their path from it, with forward
 *     slashes, so a target outside it is named with a leading "../". Its
 *     `.iso-24495-4/acronyms.json` supplies known acronyms.
 * @param readText Replaces the file reader.
 * @param reading Pass `frontMatter: false` for text that cannot carry front
 *     matter. A leading "---" block is then read as text.
 * @returns The findings for each file read, the totals for each rule that
 *     fired, and `skipped`, the full path of every entry that was not read.
 *     A file that cannot be read is skipped and never thrown, so a single
 *     unreadable file returns no files and one skipped path. A target that
 *     is a symbolic link is skipped the same way. The layout rules run for
 *     Markdown files and not for `.txt` files.
 * @throws `UnsupportedSelection` when a selected file has another ending.
 *     The file system error when the target does not exist or a selected
 *     directory cannot be listed.
 */
export function auditTarget(
  target: string,
  projectDir: string,
  readText: ReadTextFile = readFileSync,
  reading: Reading = {},
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
    throw new UnsupportedSelection(
      `Select a file ending in .md, .markdown or .txt; got a path of ${target.length} characters with another ending`,
    );
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
    const violations = auditText(text, { knownAcronyms, fileName: path, frontMatter: reading.frontMatter, markdown: /\.(?:md|markdown)$/i.test(path) });
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

/**
 * The result of a text audit as a Markdown table, one row for each finding,
 * followed by the counts and the two closing statements.
 *
 * @returns The lines joined by line breaks. With no findings the table has
 *     its header and no rows, and the counts still appear. A pipe in a cell
 *     is escaped and a line break becomes a space.
 */
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

/**
 * The text audit command.
 *
 *   bun audit-text-cli.ts <file-or-directory> [--project-dir <directory>] [--json <out-file>] [--no-front-matter]
 *
 * `--project-dir` sets where paths are reported from and where the acronyms
 * file is looked for; the default is the current directory. `--json` also
 * writes the findings to that file, replacing it. `--no-front-matter` reads a
 * leading "---" block as text.
 *
 * Any of `--jev`, `--jev-preview`, `--send`, `--yes` or
 * `--include-judged-text` hands the whole command to `runAuditCli` in text
 * mode, which can send document text to TypeSafe. Its arguments and its exit
 * codes, 0 to 4, then apply, and the result is a promise.
 *
 * Otherwise nothing leaves the machine and the result is a number. Exit 0
 * means the audit ran, whatever it found. Exit 1 means the path could not be
 * read, the file has an unsupported ending, or the findings file could not
 * be written. Exit 2 means the arguments were wrong.
 *
 * @param argv The whole command line, so the path is at index 2.
 * @param stdout Receives the table of findings.
 * @param stderr Receives a warning for each skipped entry, and the reason for
 *     exit 1 or 2.
 * @param dependencies Passed to `runAuditCli`, and unused otherwise.
 */
export function runCli(
  argv: string[],
  stdout: (text: string) => void,
  stderr: (text: string) => void,
  dependencies: AuditDependencies = {},
): number | Promise<number> {
  if (argv.slice(3).some(option => ["--jev", "--jev-preview", "--send", "--yes", "--include-judged-text"].includes(option))) {
    return runAuditCli("text", argv, stdout, stderr, dependencies);
  }
  const target = argv[2];
  if (!target) {
    stderr(
      "Usage: bun audit-text-cli.ts <file-or-directory> [--project-dir <directory>] [--json <out-file>] [--no-front-matter]",
    );
    return 2;
  }
  let jsonPath: string | undefined;
  let projectDir = process.cwd();
  // A file in a repository may open with front matter, which is metadata. A pull
  // request description cannot, and GitHub shows a leading "---" block as a rule
  // and a heading, so the check that reads one says there is no front matter.
  let frontMatter = true;
  const seenOptions = new Set<string>();
  for (let index = 3; index < argv.length; index++) {
    const option = argv[index];
    if (option !== "--json" && option !== "--project-dir" && option !== "--no-front-matter") {
      const kind = option.startsWith("--") ? "unknown option" : "unexpected argument";
      stderr(
        `audit-text: ${kind} of ${option.length} characters at argument ${index - 1}; `
          + "expected --json, --project-dir or --no-front-matter",
      );
      return 2;
    }
    if (seenOptions.has(option)) {
      stderr(`audit-text: ${option} appears more than once`);
      return 2;
    }
    seenOptions.add(option);
    if (option === "--no-front-matter") {
      frontMatter = false;
      continue;
    }
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
    const findings = auditTarget(target, projectDir, readFileSync, { frontMatter });
    for (const path of findings.skipped) {
      stderr(`warning: skipped unreadable entry: ${path}`);
    }
    if (jsonPath !== undefined) {
      const problem = writeTextFile(jsonPath, JSON.stringify(findings, null, 2), "--json");
      if (problem !== null) {
        stderr(`audit-text: ${problem}`);
        return 1;
      }
    }
    stdout(formatFindings(findings));
    return 0;
  } catch (error) {
    if (error instanceof UnsupportedSelection) {
      stderr(`audit-text: ${error.message}`);
      return 1;
    }
    // The report is written without throwing, and an unreadable entry below a
    // selected directory is skipped. So a file fault here is the selected path
    // itself refusing to be read.
    stderr(`audit-text: ${pathFailure(error, target, "<file-or-directory>", "cannot be read")}`);
    return 1;
  }
}
