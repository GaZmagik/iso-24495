import { lstatSync, readFileSync } from "node:fs";
import { join, parse, relative, resolve, sep } from "node:path";
import {
  auditText,
  configHash,
  isAuditedDocument,
  listTextFiles,
  projectAcronyms,
} from "../../iso-24495-4/scripts/audit-corpus.ts";
import { CHECKLIST } from "../../iso-24495-4/scripts/lib/checklist.ts";
import { checklistReading, formatChecklistReading } from "../../iso-24495-4/scripts/lib/checklist-reading.ts";
import { pathFailure, writeTextFile } from "../../iso-24495-4/scripts/lib/failure.ts";
import { compareVersions, comparisonReport, formatComparison, type ComparedPaths, type Comparison } from "../../iso-24495-4/scripts/lib/restructure.ts";
import { safeCell, safePathCell, skippedEntryWarning } from "../../iso-24495-4/scripts/lib/safe-text.ts";
import type { Reading } from "../../iso-24495-4/scripts/lib/parse.ts";
import type { Findings } from "../../iso-24495-4/scripts/lib/types.ts";
import { runAuditCli, type AuditDependencies } from "../../iso-24495-4/scripts/lib/jev/audit.ts";

/** The options the plain text audit takes, as its refusals list them. */
const TEXT_OPTIONS = new Set(["--json", "--project-dir", "--no-front-matter", "--before", "--author-text"]);
const EXPECTED_OPTIONS = "--json, --project-dir, --no-front-matter, --before or --author-text";

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

/**
 * The text audit command.
 *
 *   bun audit-text-cli.ts <file-or-directory> [--project-dir <directory>] [--json <out-file>] [--no-front-matter]
 *       [--before <file> [--author-text <file>]]
 *
 * `--project-dir` sets where paths are reported from and where the acronyms
 * file is looked for; the default is the current directory. `--json` also
 * writes the findings to that file, replacing it. `--no-front-matter` reads a
 * leading "---" block as text.
 *
 * `--before` names the original of the selected file, which must then be one
 * file and not a directory. After the findings the command prints the
 * two-version comparison `formatComparison` describes, and the `--json`
 * report holds it under `restructure`, just before `checklist`.
 * `--author-text` names wording the author gave for the restructure, and
 * needs `--before`. None of the three files may be a symbolic link, and each
 * must end in .md, .markdown or .txt.
 *
 * Any of `--jev`, `--jev-preview`, `--send`, `--yes` or
 * `--include-judged-text` hands the whole command to `runAuditCli` in text
 * mode, which can send document text to TypeSafe. Its arguments and its exit
 * codes, 0 to 4, then apply, and the result is a promise.
 *
 * Otherwise nothing leaves the machine and the result is a number. After
 * the table of findings it prints the Part 5 checklist reading, and the
 * `--json` report holds the same reading under a last key, `checklist`.
 * Exit 0 means the audit ran, whatever it found. Exit 1 means a path could not be
 * read, is a symbolic link the comparison does not follow, or names a file
 * with an unsupported ending, or the findings file could not be written.
 * Exit 2 means the arguments were wrong, which includes `--before` with a
 * directory selected.
 *
 * @param argv The whole command line, so the path is at index 2.
 * @param stdout Receives the table of findings, then the checklist reading.
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
      "Usage: bun audit-text-cli.ts <file-or-directory> [--project-dir <directory>] [--json <out-file>] [--no-front-matter]"
        + " [--before <file> [--author-text <file>]]",
    );
    return 2;
  }
  let jsonPath: string | undefined;
  let projectDir = process.cwd();
  const compared: { before?: string; authorText?: string } = {};
  // A file in a repository may open with front matter, which is metadata. A pull
  // request description cannot, and GitHub shows a leading "---" block as a rule
  // and a heading, so the check that reads one says there is no front matter.
  let frontMatter = true;
  const seenOptions = new Set<string>();
  for (let index = 3; index < argv.length; index++) {
    const option = argv[index];
    // A list with a hole holds no argument here. It is refused, so nothing after it goes unread.
    if (option === undefined) {
      stderr(`audit-text: argument ${index - 1} is missing; expected ${EXPECTED_OPTIONS}`);
      return 2;
    }
    if (!TEXT_OPTIONS.has(option)) {
      const kind = option.startsWith("--") ? "unknown option" : "unexpected argument";
      stderr(`audit-text: ${kind} of ${option.length} characters at argument ${index - 1}; expected ${EXPECTED_OPTIONS}`);
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
      const expected = option === "--json" ? "an output file" : option === "--project-dir" ? "a directory" : "a file";
      stderr(`audit-text: ${option} requires ${expected}`);
      return 2;
    }
    if (option === "--json") {
      jsonPath = value;
    } else if (option === "--project-dir") {
      projectDir = value;
    } else if (option === "--before") {
      compared.before = value;
    } else {
      compared.authorText = value;
    }
    index++;
  }
  if (compared.authorText !== undefined && compared.before === undefined) {
    stderr("audit-text: --author-text needs --before");
    return 2;
  }

  try {
    if (compared.before !== undefined && lstatSync(resolve(target)).isDirectory()) {
      stderr("audit-text: --before compares one file, and the selected path is a directory");
      return 2;
    }
    const comparing = compared.before === undefined ? null : readComparison(target, compared.before, compared.authorText ?? null, projectDir, frontMatter);
    if (typeof comparing === "string") {
      stderr(`audit-text: ${comparing}`);
      return 1;
    }
    const findings = auditTarget(target, projectDir, readFileSync, { frontMatter });
    for (const path of findings.skipped) {
      stderr(skippedEntryWarning(path));
    }
    // The plain audit takes no Jev route, sends nothing and refuses no
    // document. Of what a run can meet, the Markdown need depends on the files
    // read and the front matter need on --no-front-matter.
    const files = Object.keys(findings.files);
    const checklist = checklistReading(CHECKLIST, {
      mode: "text",
      files: files.length,
      markdownFiles: files.filter(file => /\.(?:md|markdown)$/i.test(file)).length,
      refused: 0,
      frontMatter,
      jevPreview: false,
      jev: false,
      send: false,
      before: comparing !== null,
      facts: [],
    });
    if (jsonPath !== undefined) {
      const restructure = comparing === null ? {} : { restructure: comparisonReport(comparing.comparison, comparing.paths) };
      const problem = writeTextFile(jsonPath, JSON.stringify({ ...findings, ...restructure, checklist }, null, 2), "--json");
      if (problem !== null) {
        stderr(`audit-text: ${problem}`);
        return 1;
      }
    }
    stdout(formatFindings(findings));
    if (comparing !== null) stdout(formatComparison(comparing.comparison, comparing.paths));
    // Printed apart from the table: the pull request check reuses formatFindings, and prints no reading.
    stdout(formatChecklistReading(checklist, CHECKLIST));
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

/**
 * Reads the files of a two-version comparison and compares them: the
 * selected file as the version after, the original before it, and the
 * author's wording when given.
 *
 * @param target The selected file, which is known not to be a directory.
 * @param projectDir The paths are named from it, as findings are.
 * @param frontMatter Whether a leading "---" block in each file is front matter.
 * @returns The comparison and the paths it names, or the problem with one of
 *     the files, in words safe to print. A file is given by the argument
 *     that named it and the length of its path.
 */
function readComparison(
  target: string,
  before: string,
  authorText: string | null,
  projectDir: string,
  frontMatter: boolean,
): { comparison: Comparison; paths: ComparedPaths } | string {
  const after = readComparedFile(target, "<file-or-directory>");
  if (typeof after !== "object") return after;
  const original = readComparedFile(before, "--before");
  if (typeof original !== "object") return original;
  const author = authorText === null ? { text: null } : readComparedFile(authorText, "--author-text");
  if (typeof author !== "object") return author;
  const project = resolve(projectDir);
  const paths = {
    before: displayPath(resolve(before), project),
    after: displayPath(resolve(target), project),
    authorText: authorText === null ? null : displayPath(resolve(authorText), project),
  };
  return { comparison: compareVersions(original.text, after.text, author.text, { frontMatter }), paths };
}

/**
 * The text of one file of a comparison, or why it cannot be compared: it is
 * a symbolic link, a directory above it on its path is one, it has an ending
 * the audit does not read, or it cannot be read. The selected file's ending
 * is left for `auditTarget` to refuse.
 *
 * The path is made absolute first, and the file is read by that absolute
 * path, so the file read is the file whose path was checked. A link put on
 * the path between the check and the read is not caught. A directory
 * junction counts as a symbolic link.
 *
 * @param source The argument that named the file, as the usage line writes it.
 * @returns The text, or the problem in words safe to print.
 */
function readComparedFile(path: string, source: string): { text: string } | string {
  try {
    const absolute = resolve(path);
    const link = linkOnPath(absolute);
    if (link === "file") {
      return `${source} names a path of ${path.length} characters that is a symbolic link, which the comparison does not follow`;
    }
    if (link === "directory") {
      return `${source} names a path of ${path.length} characters that runs through a symbolic link, which the comparison does not follow; name the file by a path with no link in it`;
    }
    if (source !== "<file-or-directory>" && !isAuditedDocument(absolute)) {
      return `${source} names a path of ${path.length} characters with another ending; select a file ending in .md, .markdown or .txt`;
    }
    return { text: readFileSync(absolute, "utf8") };
  } catch (error) {
    return pathFailure(error, path, source, "cannot be read");
  }
}

/**
 * Where a symbolic link stands on an absolute path, looking at each name on
 * it from the root down: the last name, a directory above it, or nowhere.
 * The root itself, such as a drive or a network share, is not looked at.
 *
 * @throws The file system error when a name on the path cannot be looked at,
 *     as when it does not exist.
 */
function linkOnPath(absolute: string): "file" | "directory" | null {
  const { root } = parse(absolute);
  const names = absolute.slice(root.length).split(sep).filter(name => name !== "");
  let reached = root;
  for (const [index, name] of names.entries()) {
    reached = join(reached, name);
    if (lstatSync(reached).isSymbolicLink()) return index === names.length - 1 ? "file" : "directory";
  }
  return null;
}

/**
 * What the text audit finds in a selection: the mechanical findings, and
 * the entries it passed over.
 */
export interface TextAuditResult extends Findings {
  skipped: string[];
}

type ReadTextFile = (path: string, encoding: "utf8") => string;

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
    // Read by name: a spread would miss a property that is inherited or not enumerable.
    const frontMatter = reading.frontMatter;
    const violations = auditText(text, { ...(frontMatter === undefined ? {} : { frontMatter }), knownAcronyms, fileName: path, markdown: /\.(?:md|markdown)$/i.test(path) });
    findings.files[displayPath(path, absoluteProject)] = { violations };
    for (const violation of violations) {
      findings.totals[violation.rule] = (findings.totals[violation.rule] ?? 0) + 1;
    }
  }
  return findings;
}

/**
 * The result of a text audit as a Markdown table, one row for each finding,
 * followed by the counts and the two closing statements.
 *
 * A file name comes from a directory walk and a detail quotes the document, so
 * neither has been read. The file name is printed as `safePathCell` prints a
 * path: a code span in which every character is kept or shown as its code, so
 * two files never share a printed name and a renderer reads none of it as
 * Markdown. A rule and a detail are cleaned with `safeCell`: a
 * control character, a line break or a mark that reverses text direction
 * becomes a space, each run of white space becomes one space, and a pipe is
 * escaped.
 *
 * @returns The lines joined by line breaks. With no findings the table has
 *     its header and no rows, and the counts still appear.
 */
export function formatFindings(findings: TextAuditResult): string {
  const lines = [
    "| File | Line | Rule | Finding |",
    "|------|------|------|---------|",
  ];
  for (const [file, result] of Object.entries(findings.files)) {
    for (const violation of result.violations) {
      lines.push(
        `| ${safePathCell(file)} | ${violation.line} | ${safeCell(violation.rule)} | ${safeCell(violation.detail)} |`,
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
