// Facts an author declares about a project's documents, from one file,
// `.iso-24495-4/document-facts.json`, and the report of what each declaration
// changed. Every declaration this module honours is echoed with its effect
// counted, so the file can never quietly mute a finding.

import { lstatSync, readFileSync, type Stats } from "node:fs";
import { join } from "node:path";
import { structure, type Reading } from "./parse.ts";
import { uncitedNumberingViolations, type HeadingNumbers } from "./numbering.ts";
import { safeCell, safePathCell } from "./safe-text.ts";

/** Where the facts file sits, from the project directory. */
export const FACTS_FILE = ".iso-24495-4/document-facts.json";
/** The only schema version this module reads. */
const VERSION = 1;
/** The most problems a report lists one by one; the rest are counted. */
const PROBLEMS_LISTED = 20;

/** What one document may declare. */
export interface DeclaredFacts {
  readonly headingNumbers?: HeadingNumbers;
}

/**
 * What the facts file declares, as `readDocumentFacts` read it.
 *
 * - `source`: `FACTS_FILE` when the file exists, even when nothing in it is
 *   honoured, and null when it does not.
 * - `documents`: the honoured facts, keyed by the exact path the file gives.
 * - `problems`: one sentence for each part of the file that is not honoured,
 *   in words safe to print.
 */
export interface DocumentFacts {
  readonly source: string | null;
  readonly documents: ReadonlyMap<string, DeclaredFacts>;
  readonly problems: readonly string[];
}

/**
 * Reads `.iso-24495-4/document-facts.json` under a project directory.
 *
 * The file holds an object with `version`, which must be 1, and `documents`,
 * an object keyed by each document's exact path from the project directory,
 * with forward slashes, as the reports print it. A key is never read as a
 * pattern. Each document's object may hold `headingNumbers`, `"cited"` or
 * `"not-cited"`. Any other key, at either level, is not understood and not
 * honoured, and a problem says so; the keys beside it still are.
 *
 * Nothing here stops an audit. A missing file or folder declares nothing
 * and is no problem. A file or folder that is a symbolic link, a file that cannot be
 * read, is not JSON, or is not an object of version 1 declares nothing, and
 * one problem says why.
 *
 * @param project The project directory.
 * @param inspect Replaces `lstatSync`, so a test can stand in a link.
 * @param read Replaces the file reader.
 */
export function readDocumentFacts(
  project: string,
  inspect: (path: string) => Stats = lstatSync,
  read: (path: string, encoding: "utf8") => string = readFileSync,
): DocumentFacts {
  const folder = join(project, ".iso-24495-4");
  const path = join(folder, "document-facts.json");
  let text: string;
  try {
    if (inspect(folder).isSymbolicLink()) return nothingHonoured("is in a folder that is a symbolic link");
    if (inspect(path).isSymbolicLink()) return nothingHonoured("is a symbolic link");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { source: null, documents: new Map(), problems: [] };
    return nothingHonoured("could not be read");
  }
  try {
    text = read(path, "utf8");
  } catch {
    return nothingHonoured("could not be read");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return nothingHonoured("is not valid JSON");
  }
  if (!isObject(parsed) || !Object.hasOwn(parsed, "version") || parsed.version !== VERSION) return nothingHonoured(`is not an object with "version": ${VERSION}`);
  const problems: string[] = [];
  for (const key of Object.keys(parsed)) {
    if (key !== "version" && key !== "documents") problems.push(`${capitalised(named("key", key))} is not understood and is not honoured.`);
  }
  const documents = new Map<string, DeclaredFacts>();
  const listed = Object.hasOwn(parsed, "documents") ? parsed.documents : {};
  if (!isObject(listed)) return nothingHonoured("has a \"documents\" that is not an object");
  for (const [file, entry] of Object.entries(listed)) {
    if (!isObject(entry)) {
      problems.push(`The entry for ${named("path", file)} is not an object and is not honoured.`);
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (key !== "headingNumbers") problems.push(`${capitalised(named("key", key))} for ${named("path", file)} is not understood and is not honoured.`);
    }
    if (!Object.hasOwn(entry, "headingNumbers")) continue;
    const value = entry.headingNumbers;
    if (value === "cited" || value === "not-cited") {
      documents.set(file, { headingNumbers: value });
    } else {
      problems.push(`headingNumbers for ${named("path", file)} must be "cited" or "not-cited", so it is not honoured.`);
    }
  }
  return { source: FACTS_FILE, documents, problems };
}

/** Letters, digits and `. _ / -` alone, from 1 to 100 of them: the only keys and paths a problem quotes. */
const SAFE_NAME = /^[A-Za-z0-9._/-]{1,100}$/;

/**
 * A key or path from the file that failed its check, as a problem names it.
 * It is quoted in code only when `SAFE_NAME` holds for it, and otherwise
 * only its length is given, so nothing of it can reach a renderer as markup.
 *
 * @returns `` the key `x` `` or `` `docs/a.md` ``, or `a key of 30 characters
 *     (not shown)` or `a path of 30 characters (not shown)`.
 */
function named(noun: "key" | "path", value: string): string {
  if (SAFE_NAME.test(value)) return noun === "key" ? `the key \`${value}\`` : `\`${value}\``;
  const length = [...value].length;
  return `a ${noun} of ${length} ${length === 1 ? "character" : "characters"} (not shown)`;
}

/** The text with its first letter in capitals. */
function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A facts file that exists and declares nothing, with the one problem that says why. */
function nothingHonoured(problem: string): DocumentFacts {
  return { source: FACTS_FILE, documents: new Map(), problems: [`${FACTS_FILE} ${problem}, so nothing in it is honoured.`] };
}

/** Whether a value is an object that is neither null nor an array. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The facts declared for one document, by its exact path. Only the file's
 * own keys count, so `__proto__` or `constructor` names nothing.
 */
export function factsFor(facts: DocumentFacts, file: string): DeclaredFacts {
  return facts.documents.get(file) ?? {};
}

/** What one honoured declaration changed in one document. */
export interface DeclaredEffect {
  file: string;
  fact: "headingNumbers";
  value: HeadingNumbers;
  rule: "uncited-numbering";
  /** The questions the rule would ask without the declaration and did not. */
  questionsNotRaised: number;
  /** The questions the declaration turned into findings. */
  questionsMadeFindings: number;
}

/**
 * The `declared` key of a report: the facts file, the files read that it
 * declares facts for, what each declaration changed, its problems, and how
 * many of its declarations name a file the run did not read. A run of one
 * file reads only one of a project's files, so those are not problems.
 */
export interface DeclaredReport {
  source: string | null;
  files: Array<{ file: string; headingNumbers: HeadingNumbers }>;
  effects: DeclaredEffect[];
  problems: string[];
  unread: number;
}

/** One run's record of the declarations it honoured, filled as each file is read. */
export interface DeclaredRun {
  readonly facts: DocumentFacts;
  readonly effects: DeclaredEffect[];
  /** Every file read, by its path in the report. */
  readonly read: Set<string>;
  /** How many of those are Markdown, so the rule that reads a fact runs on them. */
  markdownFiles: number;
  /** How many of the Markdown files read have a declaration. */
  declaredMarkdownFiles: number;
}

/** A record for a run that has read no file yet. */
export function startDeclared(facts: DocumentFacts): DeclaredRun {
  return { facts, effects: [], read: new Set(), markdownFiles: 0, declaredMarkdownFiles: 0 };
}

/**
 * Records one file read, and what its declaration changed. The rule is run
 * again without the declaration, and the difference is counted: a `cited`
 * file counts each question not asked, and a `not-cited` file each question
 * made a finding. A file that is not Markdown changes nothing, as the rule
 * does not read it.
 *
 * @param file The file's path in the report.
 * @param reading How the audit read the file: its file name, whether it is
 *     Markdown, and any front matter setting.
 */
export function recordDeclared(run: DeclaredRun, file: string, text: string, reading: Reading & { fileName: string; markdown: boolean }): void {
  run.read.add(file);
  if (reading.markdown) run.markdownFiles++;
  const value = factsFor(run.facts, file).headingNumbers;
  if (value === undefined) return;
  if (reading.markdown) run.declaredMarkdownFiles++;
  const parsed = structure(text, reading.frontMatter === undefined ? {} : { frontMatter: reading.frontMatter });
  const questions = reading.markdown ? uncitedNumberingViolations(text, parsed, { fileName: reading.fileName }).length : 0;
  run.effects.push({
    file, fact: "headingNumbers", value, rule: "uncited-numbering",
    questionsNotRaised: value === "cited" ? questions : 0,
    questionsMadeFindings: value === "not-cited" ? questions : 0,
  });
}

/**
 * The run's `declared` report. A declaration for a file the run did not read
 * changed nothing, and `unread` counts such declarations.
 */
export function finishDeclared(run: DeclaredRun): DeclaredReport {
  return {
    source: run.facts.source,
    files: run.effects.map(effect => ({ file: effect.file, headingNumbers: effect.value })),
    effects: run.effects,
    problems: [...run.facts.problems],
    unread: [...run.facts.documents.keys()].filter(file => !run.read.has(file)).length,
  };
}

/**
 * The report as Markdown lines: a table of each honoured declaration with
 * what it changed, then a blank line that ends the table, then how many
 * Markdown files read declare nothing, how many declarations name a file the
 * run did not read, when any do, and each problem. Paths in the table are
 * code spans, as `safePathCell` prints them, and values pass through
 * `safeCell`. A problem names a rejected key or path only as `named` does.
 * At most 20 problems are listed, and the rest are counted.
 *
 * @param run The run the report was finished from, for its counts of
 *     Markdown files read and of those with a declaration.
 * @returns The lines joined by line breaks, or null when there is no facts
 *     file, so a run without one prints nothing about it.
 */
export function formatDeclared(report: DeclaredReport, run: Pick<DeclaredRun, "markdownFiles" | "declaredMarkdownFiles">): string | null {
  if (report.source === null) return null;
  const lines = [`Declared facts (${report.source})`, "| File | Fact | Value | Effect |", "|------|------|-------|--------|"];
  for (const effect of report.effects) {
    lines.push(`| ${safePathCell(effect.file)} | ${effect.fact} | ${safeCell(effect.value)} | ${effectWords(effect)} |`);
  }
  // A blank line ends the table, so no line below can be read as a row.
  lines.push("");
  const { markdownFiles } = run;
  lines.push(`Not declared: headingNumbers for ${markdownFiles - run.declaredMarkdownFiles} of ${markdownFiles} Markdown ${markdownFiles === 1 ? "file" : "files"} read.`);
  const { unread } = report;
  if (unread > 0) lines.push(`Not read: ${unread} ${unread === 1 ? "declaration names a file" : "declarations name files"} this run did not read, so ${unread === 1 ? "it" : "they"} changed nothing.`);
  for (const problem of report.problems.slice(0, PROBLEMS_LISTED)) {
    lines.push(`Problem: ${problem}`);
  }
  if (report.problems.length > PROBLEMS_LISTED) lines.push(`Problems not listed: ${report.problems.length - PROBLEMS_LISTED}.`);
  return lines.join("\n");
}

/** What one declaration changed, as a sentence. */
function effectWords(effect: DeclaredEffect): string {
  if (effect.questionsNotRaised > 0) return `${effect.questionsNotRaised} uncited-numbering ${effect.questionsNotRaised === 1 ? "question was" : "questions were"} not raised.`;
  if (effect.questionsMadeFindings > 0) return `${effect.questionsMadeFindings} uncited-numbering ${effect.questionsMadeFindings === 1 ? "question was" : "questions were"} reported as a finding.`;
  return "No finding changed.";
}
