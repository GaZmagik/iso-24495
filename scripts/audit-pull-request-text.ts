// Audits one piece of text and reports what the audit found.
//
// The suite audits the documents in this repository. A pull request description
// is text a reader receives too, and it lives on GitHub rather than in the tree,
// so nothing read it until this. Continuous integration runs this through
// scripts/audit-pull-request-text.sh, and so can a contributor, on any file.
//
// A shell script did this work before, and failed three reviews running. It
// read the file three times, started three programs and wrote two temporary
// files, and each of those could fail in another program's words or between
// two reads. Everything now happens here, in one process: the file is read
// once, and that one string is tested, audited and reported. There is no
// second read for a change to the file to reach.

import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { auditText, configHash, isAuditedDocument, projectAcronyms } from "../skills/iso-24495-4/scripts/audit-corpus.ts";
import { unexpectedKind } from "../skills/iso-24495-4/scripts/lib/failure.ts";
import { drawsNothing } from "../skills/iso-24495-4/scripts/lib/safe-text.ts";
import type { Violation } from "../skills/iso-24495-4/scripts/lib/types.ts";
import { formatFindings } from "../skills/iso-24495-text-audit/scripts/audit-text.ts";

/** What the check needs from outside itself, so a test can stand in for each. */
export interface Dependencies {
  /** Says what kind of thing a path names, without following a symbolic link. Throws when nothing is there. */
  inspect: (path: string) => { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean };
  /** Reads a file as UTF-8 text. Throws when it cannot. */
  readText: (path: string) => string;
  /** Audits text that has no front matter. `markdown` says whether the layout rules apply. */
  audit: (text: string, fileName: string, markdown: boolean) => Violation[];
  /** Adds text to the end of a file. Throws when it cannot. */
  appendText: (path: string, text: string) => void;
  /** The file a GitHub runner shows as the job's summary page. Empty or absent for none. */
  summaryPath: string | undefined;
}

/**
 * Audits the text of one file and prints what the audit found.
 *
 *   bun scripts/audit-pull-request-text-cli.ts <file>
 *
 * Findings are advice. They are mechanical proxies, not an ISO judgement, and
 * no explanation of why a text suits its readers could satisfy a check that
 * failed on them, so they never block.
 *
 * - Exit 0: the audit ran on a description that is not empty. Any findings are
 *   listed, as advice. A pass does not mean the description is clear.
 * - Exit 1: the description is empty, or holds nothing a reader can see.
 * - Exit 2: the arguments were wrong. That includes a path that names nothing,
 *   a directory, a symbolic link, anything else that is not a regular file,
 *   and a file that cannot be read.
 * - Exit 3: the audit did not run. The file has an ending the audit does not
 *   read, or the audit stopped on a failure nothing expected.
 *
 * The file is read once. A pass therefore means that the text which was read
 * is the text which was tested for emptiness and then audited.
 *
 * The argument is text nobody has read, so no message prints it. A message
 * names the argument and gives its length. The table names the file as the
 * caller gave it, printed as the text audit prints any path.
 *
 * Where `summaryPath` names a file, the heading, the table and the closing
 * paragraphs are added to it as well, because the job's summary page is where
 * a contributor looks. A summary that cannot be written is reported on
 * `stderr` and changes no exit code: the log already holds the whole result,
 * and the verdict on the description must not be replaced by a fault in the
 * place a copy of it was sent.
 *
 * @param argv The whole command line, so the path is at index 2.
 * @param stdout Receives the table and each paragraph of the result.
 * @param stderr Receives the usage line, the reason for exit 2, and a note
 *     when the summary could not be written.
 * @param dependencies Replaces the file system, the audit or the summary path.
 * @returns The exit code. Nothing is thrown.
 */
export function runCli(
  argv: string[],
  stdout: (text: string) => void,
  stderr: (text: string) => void,
  dependencies: Dependencies,
): number {
  const path = argv[2];
  if (!path) {
    stderr("usage: bash scripts/audit-pull-request-text.sh <file>");
    return 2;
  }
  const refusal = unreadableKind(path, dependencies);
  if (refusal !== null) {
    stderr(`The path given as the first argument, ${path.length} characters long, ${refusal}`);
    return 2;
  }
  let text: string;
  try {
    text = dependencies.readText(path);
  } catch {
    stderr(`The path given as the first argument, ${path.length} characters long, names a file that exists but cannot be read.`);
    return 2;
  }
  const result = verdict(path, text, dependencies);
  for (const part of result.parts) {
    stdout(part);
  }
  writeSummary(result.parts, stderr, dependencies);
  return result.exit;
}

/**
 * The dependencies the command runs with: the real file system, the shipped
 * audit, and the summary file the environment names.
 *
 * @param projectDir The repository root, whose `.iso-24495-4/acronyms.json`
 *     supplies the acronyms the audit already knows.
 * @param summaryPath The value of `GITHUB_STEP_SUMMARY`, or nothing.
 */
export function realDependencies(projectDir: string, summaryPath: string | undefined): Dependencies {
  return {
    inspect: (path) => lstatSync(path),
    readText: (path) => readFileSync(path, "utf8"),
    audit: (text, fileName, markdown) =>
      auditText(text, { knownAcronyms: projectAcronyms(projectDir), fileName, frontMatter: false, markdown }),
    appendText: (path, text) => appendFileSync(path, text),
    summaryPath,
  };
}

/**
 * Why the path cannot be read as a file, or null when it names a regular file.
 *
 * The audit does not follow a symbolic link, so one is refused here before
 * anything is read. Without that, reading through the link would audit a file
 * the caller did not name.
 */
function unreadableKind(path: string, dependencies: Dependencies): string | null {
  let kind: ReturnType<Dependencies["inspect"]>;
  try {
    kind = dependencies.inspect(path);
  } catch {
    return "names no file to read.";
  }
  if (kind.isSymbolicLink()) return "names a symbolic link, which this check does not follow.";
  if (kind.isDirectory()) return "names a directory, where a file is needed.";
  return kind.isFile() ? null : "names something that is not a regular file.";
}

/**
 * The verdict on the text that was read, and the paragraphs that state it.
 *
 * An audit of nothing finds nothing, so an empty description would pass having
 * been read by nobody. Emptiness is a test of the Markdown source, not of what
 * a page would show: a description holding a comment or an image is not empty,
 * and the audit reads it. A description is empty when it holds nothing a reader
 * can see, as `drawsNothing` decides: white space of every kind, and every
 * character that draws nothing, such as a zero width space or a word joiner.
 *
 * A description has no front matter. GitHub shows a leading "---" block as a
 * rule and a heading, so the audit reads the block as that text.
 */
function verdict(path: string, text: string, dependencies: Dependencies): { exit: number; parts: string[] } {
  if (drawsNothing(text)) {
    return {
      exit: 1,
      parts: ["The description is empty or holds only whitespace, so there is nothing to audit. Write one: a reader needs to know what the change does and why."],
    };
  }
  if (!isAuditedDocument(path)) {
    return {
      exit: 3,
      parts: ["The audit did not run, because it reads a file ending in .md, .markdown or .txt and was given another ending. The description was not checked."],
    };
  }
  let violations: Violation[];
  try {
    violations = dependencies.audit(text, path, /\.(?:md|markdown)$/i.test(path));
  } catch (error) {
    return {
      exit: 3,
      parts: [`The audit did not run to completion: it was stopped by ${unexpectedKind(error)}. The description was not checked.`],
    };
  }
  const totals: Record<string, number> = {};
  for (const violation of violations) {
    totals[violation.rule] = (totals[violation.rule] ?? 0) + 1;
  }
  const table = formatFindings({ configHash: configHash(), files: { [path]: { violations } }, totals, skipped: [] });
  return {
    exit: 0,
    parts: [
      table,
      findingsSentence(violations.length),
      // General advice, printed on every pass. The check does not detect a
      // description holding only a comment or an image; that would need a
      // renderer, and the audit reads Markdown as written.
      "A pass means the audit ran on a description that is not empty. It is not a judgement that the description is clear, and a description holding only a comment or an image gives it little to read.",
    ],
  };
}

function findingsSentence(count: number): string {
  if (count === 0) return "The audit reported no findings.";
  return count === 1
    ? "The audit reported 1 finding. It is advice, and does not block this pull request. Edit the text if the finding points at a real problem for its readers."
    : `The audit reported ${count} findings. They are advice, and do not block this pull request. Edit the text where a finding points at a real problem for its readers.`;
}

/** Adds the result to the job's summary page, under a heading, where there is one. */
function writeSummary(parts: string[], stderr: (text: string) => void, dependencies: Dependencies): void {
  const summary = dependencies.summaryPath;
  if (!summary) return;
  try {
    dependencies.appendText(summary, `## Pull request description audit\n\n${parts.join("\n\n")}\n\n`);
  } catch {
    stderr(`The step summary named by GITHUB_STEP_SUMMARY, a path ${summary.length} characters long, could not be written. The result above is complete without it.`);
  }
}
