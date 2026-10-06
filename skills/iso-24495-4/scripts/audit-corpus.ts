// Deterministic corpus audit: mechanical proxies for the Part 1/2 rules.
// Emits counts and locations only. It never judges clarity and its output
// must never be presented as ISO compliance.

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  flattenedOffsets,
  headings,
  labelledHeadings,
  labelledProseBlocks,
  type LabelledBlock,
  markdownLinks,
  mergedSentences,
  normaliseReference,
  readerProseBlocks,
  readDocument,
  type ProseBlock,
  type Reading,
  locateSentences,
  wordCount,
} from "./lib/parse.ts";
import {
  COMMON_WORDS,
  COMPLEX_WORDS,
  DOUBLE_NEGATIVES,
  FILLER_OPENINGS,
} from "./lib/lexicon.ts";
import type { Findings, Violation } from "./lib/types.ts";
import { layoutViolations } from "./lib/layout.ts";
import { emphasisMarkOffsets, withoutEmphasis } from "./lib/inline-wording.ts";
import { pathFailure, writeTextFile } from "./lib/failure.ts";
import { skippedEntryWarning } from "./lib/safe-text.ts";

/**
 * Audits a corpus directory and prints the count of findings for each rule.
 *
 *   bun audit-corpus-cli.ts <corpus-dir> [--json <out-file>]
 *
 * `--json` also writes the full findings to that file, replacing it.
 *
 * Exit 0 means the audit ran, whatever it found. Exit 1 means the directory
 * could not be listed or the findings file could not be written. Exit 2 means
 * the arguments were wrong.
 *
 * @param argv The whole command line, so the directory is at index 2.
 * @param stdout Receives the table and the total, one line at a time.
 * @param stderr Receives a warning for each skipped entry, and the reason for
 *     exit 1 or 2.
 */
export function runCli(
  argv: string[],
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): number {
  const dir = argv[2];
  if (!dir) {
    stderr("Usage: bun audit-corpus-cli.ts <corpus-dir> [--json <out-file>]");
    return 2;
  }
  let jsonPath: string | undefined;
  const seenOptions = new Set<string>();
  for (let index = 3; index < argv.length; index++) {
    const option = argv[index];
    if (option !== "--json") {
      const kind = option.startsWith("--") ? "unknown option" : "unexpected argument";
      stderr(`audit-corpus: ${kind} of ${option.length} characters at argument ${index - 1}; expected --json`);
      return 2;
    }
    if (seenOptions.has(option)) {
      stderr(`audit-corpus: ${option} appears more than once`);
      return 2;
    }
    seenOptions.add(option);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      stderr("audit-corpus: --json requires an output file");
      return 2;
    }
    jsonPath = value;
    index++;
  }
  try {
    const skipped: string[] = [];
    const findings = auditCorpus(dir, (path) => skipped.push(path));
    for (const path of skipped) {
      stderr(skippedEntryWarning(path));
    }
    if (jsonPath !== undefined) {
      const problem = writeTextFile(jsonPath, JSON.stringify(findings, null, 2), "--json");
      if (problem !== null) {
        stderr(`audit-corpus: ${problem}`);
        return 1;
      }
    }
    stdout("| Rule | Violations |");
    stdout("|------|------------|");
    for (const [rule, count] of Object.entries(findings.totals)) {
      stdout(`| ${rule} | ${count} |`);
    }
    const total = Object.values(findings.totals).reduce((a, b) => a + b, 0);
    stdout(`\nTotal: ${total} across ${Object.keys(findings.files).length} files.`);
    return 0;
  } catch (error) {
    // The report is written without throwing, and an unreadable entry below
    // the corpus directory is skipped. So a file fault here is the directory
    // itself refusing to be listed.
    stderr(`audit-corpus: ${pathFailure(error, dir, "<corpus-dir>", "cannot be listed")}`);
    return 1;
  }
}

type ReadTextFile = (path: string, encoding: "utf8") => string;

/**
 * Audits every document under a directory and totals the findings by rule.
 *
 * The directory is also the project: its `.iso-24495-4/acronyms.json` applies
 * to every document. The layout rules run for Markdown files and not for
 * `.txt` files.
 *
 * @param dir The corpus directory.
 * @param onSkip Called with the path of each entry or file that could not be
 *     read. Such a file has no entry in the result.
 * @param readText Replaces the file reader.
 * @returns `files` is keyed by path from `dir`, with forward slashes, and
 *     holds an entry for every file read, findings or none. `totals` names
 *     only the rules that fired. Both are empty for an empty corpus.
 * @throws The file system error when `dir` itself cannot be listed.
 */
export function auditCorpus(
  dir: string,
  onSkip?: (path: string) => void,
  readText: ReadTextFile = readFileSync,
): Findings {
  const paths = listTextFiles(dir, onSkip);
  // A corpus is audited from its own directory, so the project's acronyms
  // apply to every document in it.
  const knownAcronyms = projectAcronyms(dir);
  const findings: Findings = { configHash: configHash(), files: {}, totals: {} };
  for (const path of paths) {
    const key = relative(dir, path).replaceAll("\\", "/");
    let text: string;
    try {
      text = readText(path, "utf8");
    } catch {
      onSkip?.(path);
      continue;
    }
    const violations = auditText(text, { knownAcronyms, fileName: path, markdown: /\.(?:md|markdown)$/i.test(path) });
    findings.files[key] = { violations };
    for (const v of violations) {
      findings.totals[v.rule] = (findings.totals[v.rule] ?? 0) + 1;
    }
  }
  return findings;
}

export interface AuditOptions extends Reading {
  /** The selected file name supplies document-specific scope exemptions. */
  fileName?: string;
  /** Extra acronyms this project treats as known. */
  knownAcronyms?: ReadonlySet<string>;
  /** File-aware callers enable structural rules for Markdown rather than plain text. */
  markdown?: boolean;
}

/**
 * Every mechanical finding in one text.
 *
 * The four layout rules (`contents-list`, `opening-version-date`,
 * `bullet-depth` and `overview-label`) run only when `options.markdown` is
 * true. It defaults to false, so a caller that passes no options gets the
 * other rules alone, and nothing in the result says that layout was skipped.
 *
 * @param text The whole document, with any line ending.
 * @param options `markdown` turns the layout rules on; pass true for a
 *     Markdown file and leave it unset for plain text. `fileName` only
 *     exempts files such as README from the edition advisory. `knownAcronyms`
 *     are passed over by the acronym rule, and must be in capitals without
 *     dots. `frontMatter` set to false reads a leading "---" block as text
 *     and switches the edition advisory off; unset, the block is metadata.
 * @returns The findings grouped by rule, not sorted by line. Each `line` is
 *     counted from 1. Empty when no rule fires, which is the result for empty
 *     text and is not evidence that the text suits its readers.
 */
export function auditText(text: string, options: AuditOptions = {}): Violation[] {
  // Every rule re-reads the text, so each is told the same thing about front matter.
  const reading: Reading = { frontMatter: options.frontMatter };
  const violations: Violation[] = [];
  const sentenceLengths: number[] = [];
  const mergedLengths: number[] = [];
  for (const block of readerProseBlocks(text, reading)) {
    const paragraph = block.lines.join("\n");
    // The splitter reports where each sentence starts, so nothing needs locating twice.
    // Rebuilding a sentence as a regular expression threw on a long one.
    for (const sentence of locateSentences(paragraph)) {
      const words = wordCount(sentence.text);
      if (words > 0) sentenceLengths.push(words);
      if (words > SENTENCE_WORD_LIMIT) {
        violations.push({
          rule: "sentence-length",
          line: lineAtOffset(block.line, paragraph, sentence.start),
          detail: `${words} words (limit ${SENTENCE_WORD_LIMIT})`,
        });
      }
    }
    // Counted from the fewest sentences the paragraph can hold. An unresolved
    // full stop must never manufacture the sentence that breaks the limit.
    const fewest = mergedSentences(paragraph).length;
    for (const sentence of mergedSentences(paragraph)) {
      const words = wordCount(sentence);
      if (words > 0) mergedLengths.push(words);
    }
    if (fewest > PARAGRAPH_SENTENCE_LIMIT) {
      violations.push({
        rule: "paragraph-length",
        line: block.line,
        detail: `${fewest} sentences (limit ${PARAGRAPH_SENTENCE_LIMIT})`,
      });
    }
  }
  violations.push(...legaleseViolations(text, reading));
  // The standards specify an average across the document, not a cap; the cap
  // above only catches genuine sprawl. Small samples are exempt because an
  // average over a handful of sentences is noise, not judgement.
  //
  // Both readings must agree. Taking the longer reading alone let an undecided
  // full stop lift a document over the ten-sentence sample floor and produce a
  // finding the joined-up reading could not, which is the opposite of what
  // abstention is for.
  const readings = [sentenceLengths, mergedLengths].map((lengths) => ({
    count: lengths.length,
    average: lengths.length === 0 ? 0 : lengths.reduce((a, b) => a + b, 0) / lengths.length,
  }));
  if (readings.every((r) => r.count >= AVERAGE_MIN_SENTENCES && r.average > SENTENCE_AVERAGE_LIMIT)) {
    const reported = readings[0];
    violations.push({
      rule: "sentence-average",
      line: 1,
      detail: `average ${reported.average.toFixed(1)} words across ${reported.count} sentences (limit ${SENTENCE_AVERAGE_LIMIT})`,
    });
  }
  const documentHeadings = headings(text, reading);
  for (let i = 0; i < documentHeadings.length; i++) {
    const heading = documentHeadings[i];
    if (heading.level > MAX_HEADING_LEVEL) {
      violations.push({
        rule: "heading-depth",
        line: heading.line,
        detail: `heading level ${heading.level} (limit ${MAX_HEADING_LEVEL})`,
      });
    }

    // lucid-inspired, reimplemented; proxy choice, not a standard clause.
    const previous = documentHeadings[i - 1];
    if (previous && heading.level > previous.level + 1) {
      violations.push({
        rule: "heading-skip",
        line: heading.line,
        detail: `heading jumps from level ${previous.level} to level ${heading.level}`,
      });
    }

    // lucid-inspired, reimplemented; proxy choice, not a standard clause.
    const headingText = heading.text.replace(/^(?:\d+\.)+\s+/, "");
    const headingForm = headingText.replace(/(?<!\\)[*_~]+$/, "");
    const headingWords = wordCount(headingText);
    // Same abstention as the paragraph rule: a heading is only two sentences
    // if it is two even when every doubtful stop is joined up.
    const headingSentences = mergedSentences(headingText);
    if (headingWords > HEADING_WORD_LIMIT) {
      violations.push({
        rule: "heading-style",
        line: heading.line,
        detail: `${headingWords} words (limit ${HEADING_WORD_LIMIT})`,
      });
    } else if (headingSentences.length >= 2) {
      violations.push({
        rule: "heading-style",
        line: heading.line,
        detail: `${headingSentences.length} sentences in heading`,
      });
    } else if (headingForm.endsWith(".") && !headingForm.endsWith("...")) {
      violations.push({
        rule: "heading-style",
        line: heading.line,
        detail: "heading ends with a full stop",
      });
    }
  }

  // lucid-inspired, reimplemented; proxy choice, not a standard clause.
  violations.push(...acronymViolations(text, options.knownAcronyms ?? new Set(), reading));

  // lucid-inspired, reimplemented; proxy choice, not a standard clause.
  violations.push(...doubletViolations(text, reading));

  // lucid-inspired, reimplemented; proxy choice, not a standard clause.
  violations.push(...proseEnumerationViolations(text, reading));

  // The intended readers of a document include everyone who uses it, whether
  // they see it, hear it or touch it. These two rules are the only ones here
  // that serve a reader who is not looking at the page.
  violations.push(...wordyPhraseViolations(text, reading));
  violations.push(...complexWordViolations(text, reading));
  violations.push(...doubleNegativeViolations(text, reading));
  violations.push(...fillerOpeningViolations(text, reading));
  violations.push(...tableHeaderViolations(text, reading));
  violations.push(...linkTextViolations(text, reading));
  violations.push(...imageAltViolations(text, reading));
  if (options.markdown) violations.push(...layoutViolations(text, { ...reading, fileName: options.fileName }));
  return violations;
}

/**
 * Thresholds recalibrated 2026-08-13. Public guidance (Cutts, the Plain
 * English Campaign, the Clear English Standard) specifies an AVERAGE of 15 to
 * 20 words, not a per-sentence cap. The 30-word cap and the 10-sentence
 * minimum sample are this project's own proxy choices, informed by local
 * session measurements that are not part of this repository.
 */
export const ENGINE_THRESHOLDS = Object.freeze({
  sentenceWordLimit: 30,
  sentenceAverageLimit: 20,
  averageMinimumSentences: 10,
  paragraphSentenceLimit: 5,
  maximumHeadingLevel: 4,
  headingWordLimit: 12,
  acronymMinimumLetters: 2,
  acronymMaximumLetters: 6,
  acronymDefinitionWindow: 3,
  enumerationMinimumRanks: 3,
  layoutRecognitionVersion: 8,
  contentsMinimumSections: 6,
  maximumUnorderedDepth: 2,
});

const SENTENCE_WORD_LIMIT = ENGINE_THRESHOLDS.sentenceWordLimit;
const SENTENCE_AVERAGE_LIMIT = ENGINE_THRESHOLDS.sentenceAverageLimit;
const AVERAGE_MIN_SENTENCES = ENGINE_THRESHOLDS.averageMinimumSentences;
const PARAGRAPH_SENTENCE_LIMIT = ENGINE_THRESHOLDS.paragraphSentenceLimit;
const MAX_HEADING_LEVEL = ENGINE_THRESHOLDS.maximumHeadingLevel;
const HEADING_WORD_LIMIT = ENGINE_THRESHOLDS.headingWordLimit;
/**
 * Exported so each audit surface and the repository guard read the same list.
 * Separate copies once disagreed about whether a .txt file was covered.
 */
export const TEXT_EXTENSIONS = [".md", ".markdown", ".txt"];

/**
 * Whether this path is a document the engine audits. Every caller must use
 * this rather than its own test. Comparing extension lists proved nothing,
 * because one caller lower-cased the extension and another did not.
 *
 * @returns True when the path ends in .md, .markdown or .txt, in any letter
 *     case. The path is judged by its name and never opened, so a directory
 *     with such a name passes too.
 */
export function isAuditedDocument(path: string): boolean {
  const lower = path.toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
const LEGALESE = ["shall", "hereby", "hereinafter", "wherefore", "heretofore", "aforesaid"];

const ACRONYM_ALLOWLIST = new Set([
  "KG", "KM", "CM", "MM", "MB", "GB", "KB", "TB", "PDF", "URL", "HTML", "TV", "PIN",
  "UN", "USA", "ISO", "AI", "API", "CLI", "JSON", "HTTP", "HTTPS", "SSH", "MIT",
  // Everyday words that happen to be capitals. Asking a writer to expand "OK"
  // is advice nobody can act on, and a shouted "DO NOT" is not an initialism.
  // A lone capitalised word is judged on its own. Runs of capitals are judged
  // by lexicon density instead, so no list of shouted words is needed here.
  "OK", "ID", "AM", "PM",
]);

// Numbering words that make a Roman numeral a numeral. Shape alone exempted
// "CI", "MD", "MIX" and "CD", which are ordinary acronyms in ordinary prose.
// "book", "type" and "class" are deliberately absent: they are verbs as often
// as they are labels, and "Book MD appointments" must still report MD.
const NUMBERING_WORDS = new Set([
  "section", "sections", "chapter", "chapters", "part", "parts", "volume",
  "volumes", "appendix", "appendices", "annex", "figure", "figures", "table",
  "tables", "phase", "step", "tier", "page", "article", "articles", "title",
  "titles", "schedule", "schedules", "clause", "clauses", "edition", "act",
  // "form", "round", "group" and "mark" were here and are gone: each is an
  // ordinary noun or verb, and "Open the form and review CI settings" then
  // excused CI. A numbering word has to be one that only numbers things.
  "level", "grade", "stage",
]);

// Titles and events numbered with Roman numerals by convention. Searched a few
// tokens back, because the numeral follows the given name: "Pope Paul VI".
const NAMED_BY_NUMERAL = new Set([
  "King", "Queen", "Pope", "Emperor", "Empress", "Tsar", "Prince", "Princess",
  "Duke", "Earl", "Bowl", "War", "Olympiad", "Cup", "Festival",
]);

// A numeral straight after a capitalised name is a regnal or sequel number:
// "Elizabeth II", "Rocky IV". Requiring the title word meant "Elizabeth II"
// asked for an expansion while "Queen Elizabeth II" did not.
// Five letters or more, because the short capitalised words that open a
// sentence are mostly verbs: "Type CD", "Open VI", "Book MD". A given name
// long enough to carry a regnal number is longer than that.
const CAPITALISED_NAME = /^[A-Z][a-z]{4,}$/;

// A short numeral is ambiguous by nature: two and three letter numerals are
// also common acronyms, and listing them one by one was a list that kept
// growing (DVI, MCC, MMC, DCL, MMI all slipped through). Length decides
// instead. Four letters or more, such as VIII or LVIII, is a numeral.
//
// Four letters is not proof, though: MMIX is Knuth's computer. A long numeral
// still needs evidence when it sits in prose with no numbering context, so
// this length only removes the requirement for repeated numerals in lists.
const NUMERAL_UNAMBIGUOUS_LENGTH = 4;
const NUMERAL_NAMED_EXCEPTIONS = new Set(["MMIX", "MMX", "MMXI", "MIX", "DIM"]);
const ACRONYM_SHAPE = new RegExp(
  `^(?:[A-Z]{${ENGINE_THRESHOLDS.acronymMinimumLetters},${ENGINE_THRESHOLDS.acronymMaximumLetters}}|[A-Z]\\.(?:[A-Z]\\.)+)$`,
);
// Canonical numerals only. Any string of numeral letters also matched "XML",
// "MIX" and "CIVIC", so common acronyms were silently exempt from the rule.
const ROMAN_NUMERAL = /^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

interface DoubletEntry {
  phrase: string;
  lean?: string;
  legalRegister?: boolean;
}

// Keep every doublet phrase out of LEGALESE so each phrase has one rule owner.
const DOUBLETS: DoubletEntry[] = [
  { phrase: "null and void", lean: "void" },
  { phrase: "cease and desist", legalRegister: true },
  { phrase: "terms and conditions", legalRegister: true },
  { phrase: "each and every", lean: "each" },
  { phrase: "first and foremost", lean: "first" },
  { phrase: "true and correct", lean: "true" },
  { phrase: "full and complete", lean: "complete" },
  { phrase: "revert back", lean: "revert" },
  { phrase: "repeat again", lean: "repeat" },
  { phrase: "free gift", lean: "gift" },
  { phrase: "past history", lean: "history" },
  { phrase: "future plans", lean: "plans" },
  { phrase: "end result", lean: "result" },
  { phrase: "unexpected surprise", lean: "surprise" },
  { phrase: "advance planning", lean: "planning" },
  { phrase: "close proximity", lean: "close" },
  { phrase: "general consensus", lean: "consensus" },
].sort((a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length);

// Wordy phrases with a shorter exact equivalent. The core skill has asked
// writers to make these swaps since the first release, and nothing checked
// them, so the guidance named a rule the engine never applied.
//
// Exact phrases only, like the doublets. Anything needing judgement about
// whether a longer phrase is justified belongs to the writer, not here.
const WORDY_PHRASES: Array<{ phrase: string; lean: string }> = [
  { phrase: "in order to", lean: "to" },
  { phrase: "due to the fact that", lean: "because" },
  { phrase: "in the event that", lean: "if" },
  { phrase: "at this point in time", lean: "now" },
  { phrase: "at this moment in time", lean: "now" },
  { phrase: "in the near future", lean: "soon" },
  { phrase: "for the purpose of", lean: "to" },
  { phrase: "with regard to", lean: "about" },
  { phrase: "with reference to", lean: "about" },
  { phrase: "in relation to", lean: "about" },
  { phrase: "in the absence of", lean: "without" },
  { phrase: "a large number of", lean: "many" },
  { phrase: "a small number of", lean: "a few" },
  { phrase: "the majority of", lean: "most" },
  { phrase: "prior to", lean: "before" },
  { phrase: "subsequent to", lean: "after" },
  { phrase: "in spite of the fact that", lean: "although" },
  { phrase: "notwithstanding the fact that", lean: "although" },
  { phrase: "it is possible that", lean: "may" },
  { phrase: "has the ability to", lean: "can" },
  { phrase: "is able to", lean: "can" },
  { phrase: "make a decision", lean: "decide" },
  { phrase: "provide assistance", lean: "help" },
  { phrase: "take into consideration", lean: "consider" },
].sort((a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length);

const ORDINAL_RANKS = new Map([
  ["first", 1], ["firstly", 1],
  ["second", 2], ["secondly", 2],
  ["third", 3], ["thirdly", 3],
  ["fourth", 4], ["fourthly", 4],
  ["fifth", 5], ["fifthly", 5],
  ["sixth", 6], ["sixthly", 6],
]);

/**
 * A short fingerprint of the thresholds an audit ran with, kept in its
 * findings so that two sets of findings can be seen to share their limits.
 *
 * @param thresholds The limits by name. The default is the limits this engine
 *     ships with. The order of the names does not change the result.
 * @returns Eight hexadecimal digits. It is a 32-bit hash, not a cryptographic
 *     one, so it shows a change and proves nothing more. An empty record
 *     still has a fingerprint.
 */
export function configHash(
  thresholds: Readonly<Record<string, number>> = ENGINE_THRESHOLDS,
): string {
  const stable = Object.entries(thresholds)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("|");
  let hash = 5381;
  for (let i = 0; i < stable.length; i++) {
    hash = ((hash * 33) ^ stable.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The last text asked about, because one block reports many findings in turn. */
let lineCacheText: string | null = null;
let lineCacheEnds: number[] | null = null;

function lineEnds(text: string): number[] {
  if (lineCacheText === text && lineCacheEnds !== null) return lineCacheEnds;
  const ends: number[] = [];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    ends.push(at);
  }
  lineCacheText = text;
  lineCacheEnds = ends;
  return ends;
}

/**
 * The line an offset falls on, counted from the block's first line.
 *
 * The line endings are collected once and searched, because slicing the text from its
 * start for every finding grew with the square of the block: 4,000 long sentences in one
 * paragraph cost 10.8 seconds.
 */
function lineAtOffset(blockLine: number, text: string, offset: number): number {
  const ends = lineEnds(text);
  let low = 0;
  let high = ends.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((ends[middle] as number) < offset) low = middle + 1;
    else high = middle;
  }
  return blockLine + low;
}

// The shape the scan looks for admits at most six initials once its dots are removed, so
// no more than six preceding words can ever spell one.
const LONGEST_ACRONYM = 6;

function acronymFromToken(raw: string): { display: string; key: string } | null {
  let token = raw.replace(/^["'“‘([{<]+/, "").replace(/["'”’\)\]}>,:;!?]+$/, "");
  if (!ACRONYM_SHAPE.test(token) && token.endsWith(".")) token = token.slice(0, -1);
  if (!ACRONYM_SHAPE.test(token)) return null;
  const key = token.replaceAll(".", "");
  if (/\d/.test(token)) return null;
  return { display: token, key };
}

function isLetter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z]/.test(character);
}

/**
 * The token with its surrounding punctuation removed, keeping a trailing full stop
 * because an acronym may be written "U.S.".
 *
 * Scanned from each end rather than trimmed with an anchored alternation, which retried
 * the suffix at every position: one token of 100,000 markers cost about ten seconds.
 */
function lettersOnly(raw: string): string {
  let start = 0;
  while (start < raw.length && !isLetter(raw[start])) start += 1;
  let end = raw.length;
  while (end > start && !isLetter(raw[end - 1]) && raw[end - 1] !== ".") end -= 1;
  return raw.slice(start, end);
}

function isAllCaps(raw: string): boolean {
  const stripped = lettersOnly(raw);
  return ACRONYM_SHAPE.test(stripped) || /^[A-Z]{2,}$/.test(stripped);
}

// A numeral is a numeral because of where it sits. Only a numbering word
// immediately before it, coordination with an unambiguous numeral, or a name
// pattern counts as evidence. Words that double as verbs ("book a room",
// "type the command") are deliberately absent from the numbering list.
function isUnambiguousNumeral(word: string): boolean {
  if (NUMERAL_NAMED_EXCEPTIONS.has(word)) return false;
  return word.length >= NUMERAL_UNAMBIGUOUS_LENGTH && ROMAN_NUMERAL.test(word);
}

function hasNumberingEvidence(tokens: Array<{ raw: string }>, index: number): boolean {
  const previous = bareLetters(tokens[index - 1]?.raw);
  // "Chapters II, III and IV": the numbering word governs the whole list, not
  // just the numeral touching it, so look back a short way.
  for (let back = index - 1; back >= 0 && back >= index - 3; back--) {
    if (NUMBERING_WORDS.has(bareLetters(tokens[back]?.raw).toLowerCase())) return true;
  }
  // "Pope Paul VI": the title sits before the given name, not before the
  // numeral, so look back a few tokens rather than one.
  for (let back = index - 1; back >= 0 && back >= index - 3; back--) {
    if (NAMED_BY_NUMERAL.has(bareLetters(tokens[back]?.raw))) return true;
  }
  // "Sections II and IV": the neighbour is a numeral no acronym collides with.
  // A short numeral is no evidence, or "CI and CD" would excuse itself.
  // A name, not merely a capital: "The", "Type" and "Open" begin sentences and
  // are ordinary words, so they cannot be evidence of a regnal number.
  if (CAPITALISED_NAME.test(previous)
    && !COMMON_WORDS.has(previous.toLowerCase())
    && !NUMBERING_WORDS.has(previous.toLowerCase())) {
    return true;
  }
  for (const neighbour of [previous, bareLetters(tokens[index + 1]?.raw)]) {
    if (isUnambiguousNumeral(neighbour)) return true;
  }
  if (/^(?:and|or|to|through)$/i.test(previous)) {
    for (let back = index - 2; back >= 0 && back >= index - 4; back--) {
      const candidate = bareLetters(tokens[back]?.raw);
      if (candidate && NUMBERING_WORDS.has(bareLetters(tokens[back - 1]?.raw).toLowerCase())
        && ROMAN_NUMERAL.test(candidate)) {
        return true;
      }
      if (isUnambiguousNumeral(candidate)) return true;
    }
  }
  return false;
}

/** The letters of a token, or nothing where there is no token. */
function bareLetters(raw: string | undefined): string {
  return (raw ?? "").replace(/[^A-Za-z]/g, "");
}

// Shouted text and a chain of initialisms have the same shape: capitals, of
// similar length, side by side. They differ in one measurable way, which is
// how many of the words are ordinary English. Counting tokens could not tell
// "SAVE DATA FIRST" from "AWS IAM SSO MFA"; asking the lexicon can.
function shoutedPositions(tokens: Array<{ raw: string }>): Set<number> {
  const shouted = new Set<number>();
  let runStart = 0;
  for (let i = 0; i <= tokens.length; i++) {
    if (i < tokens.length && isAllCaps(tokens[i].raw)) continue;
    markRun(tokens, shouted, runStart, i);
    runStart = i + 1;
  }
  return shouted;
}

/** Adds a run of capitalised tokens to the shouted positions where enough are ordinary words. */
function markRun(
  tokens: Array<{ raw: string }>,
  shouted: Set<number>,
  start: number,
  end: number,
): void {
  const length = end - start;
  if (length < 2) return;
  const known = tokens.slice(start, end)
    .filter((token) => COMMON_WORDS.has(lowerCaseLetters(token.raw))).length;
  // A pair carries almost no evidence, so it must be entirely ordinary words
  // to count as shouting. "ENABLE MFA" is one known word and one acronym, and
  // half of two was enough to silence it. Longer runs can carry a minority of
  // unknown words and still be a shout.
  const enough = length === 2 ? known === 2 : known * 2 >= length;
  if (!enough) return;
  for (let j = start; j < end; j++) shouted.add(j);
}

/** The letters of a token in lower case, as the lexicon lists a word. */
function lowerCaseLetters(raw: string): string {
  return raw.replace(/[^A-Za-z]/g, "").toLowerCase();
}

function expansionInitials(text: string): string {
  return (text.match(/[A-Za-z]+/g) ?? [])
    .filter((word) => !/^(?:a|an|and|for|in|of|on|the|to)$/i.test(word))
    .map((word) => word[0].toUpperCase())
    .join("");
}

/**
 * What the bracket after an acronym spells, or null where nothing does.
 *
 * The bracket must open a token, no more than two tokens after the acronym, which is what
 * the pattern this replaced allowed. The span then runs to the first token holding a
 * closing bracket. A span carrying a different number of words from the key cannot spell
 * it, and is refused without being read, which is what keeps a long one cheap.
 */
function expansionSpelling(
  tokens: ReadonlyArray<{ raw: string }>,
  from: number,
  want: number,
  carried: ReadonlyArray<number>,
  initials: ReadonlyArray<string>,
  nextClose: ReadonlyArray<number>,
): string | null {
  let open = -1;
  const window = Math.min(from + ENGINE_THRESHOLDS.acronymDefinitionWindow, tokens.length);
  for (let at = from; at < window; at++) {
    if ((tokens[at] as { raw: string }).raw.startsWith("(")) {
      open = at;
      break;
    }
  }
  if (open === -1) return null;
  const close = nextClose[open] ?? tokens.length;
  if (close >= tokens.length) return null;
  const opener = (tokens[open] as { raw: string }).raw;
  if (open === close) return expansionInitials(opener.slice(1, opener.indexOf(")")));
  const closer = (tokens[close] as { raw: string }).raw;
  const first = expansionInitials(opener.slice(1));
  const last = expansionInitials(closer.slice(0, closer.indexOf(")")));
  const between = (carried[close] as number) - (carried[open + 1] as number);
  if (first.length + between + last.length !== want) return null;
  return first + initials.slice(carried[open + 1], carried[close]).join("") + last;
}

function acronymViolations(
  text: string,
  known: ReadonlySet<string>,
  reading: Reading,
): Violation[] {
  const violations: Violation[] = [];
  const defined = new Set<string>();
  const seen = new Set<string>();
  const definitionLocations = new Map<string, { line: number; column: number }>();
  const document = readDocument(text, reading);
  const blocks = labelledProseBlocks(text, reading);
  // The block each line sits in. The words before a parenthesis carry across a soft
  // line break, which is a space to the reader, so "identity and access" wrapped
  // before "management (IAM)" still spells the acronym. They never carry across a
  // paragraph, a list item or a heading, which end the sentence the reader is in.
  const blockOfLine = new Map<number, number>();
  blocks.forEach((block, id) => {
    for (let offset = 0; offset < block.lines.length; offset++) {
      blockOfLine.set(block.line - 1 + offset, id);
    }
  });
  // The text of a setext heading can wrap across lines, and it is one heading, so
  // those lines are one block too, numbered after the prose blocks.
  headings(text, reading).forEach((heading, index) => {
    for (let offset = 0; offset < heading.lines; offset++) {
      blockOfLine.set(heading.line - 1 + offset, blocks.length + index);
    }
  });
  // Only the last few words before a parenthesis can spell the acronym inside it, so
  // they are carried forward rather than recovered by slicing the line from its start
  // every time. Slicing cost 8.8 seconds on 8,000 acronyms.
  let recent: string[] = [];
  let previousBlock: number | undefined;
  const marksByLine = pairedMarksByLine(document.lines, blockOfLine);
  for (let i = 0; i < document.lines.length; i++) {
    if (document.hidden(i)) continue;
    const block = blockOfLine.get(i);
    if (block === undefined || block !== previousBlock) recent = [];
    previousBlock = block;
    // Read without paired emphasis marks, so "(**IAM**)" defines as "(IAM)" does and
    // "ident*ity*" still gives its initial. The text is one source line, and its marks
    // were paired across the whole block the line sits in.
    const marks = marksByLine[i] as number[];
    const sourceLine = withoutOffsets(document.lines[i] as string, 0, new Set(marks));
    let scanned = 0;
    for (const match of sourceLine.matchAll(/\(([A-Z][A-Z.]{1,5})\)/g)) {
      const key = match[1].replaceAll(".", "");
      carry(recent, sourceLine.slice(scanned, match.index));
      scanned = match.index;
      if (expansionInitials(recent.slice(-key.length).join(" ")) !== key) continue;
      if (!definitionLocations.has(key)) {
        definitionLocations.set(key, { line: i + 1, column: sourceColumn(match.index, marks) });
      }
    }
    carry(recent, sourceLine.slice(scanned));
  }
  for (const block of blocks) {
    const tokens = unmarkedTokens(block);
    // The words that carry an initial, in order, and how many precede each token. An
    // expansion is judged against these rather than against the text it came from.
    const carried: number[] = new Array(tokens.length + 1);
    const initials: string[] = [];
    carried[0] = 0;
    for (let at = 0; at < tokens.length; at++) {
      initials.push(...expansionInitials((tokens[at] as { raw: string }).raw));
      carried[at + 1] = initials.length;
    }

    // The first token at or after each position that holds a closing bracket, built once
    // for the block so no acronym has to search forward for one.
    const nextClose: number[] = new Array(tokens.length);
    for (let at = tokens.length - 1, closing = tokens.length; at >= 0; at--) {
      if ((tokens[at] as { raw: string }).raw.includes(")")) closing = at;
      nextClose[at] = closing;
    }
    const shouted = shoutedPositions(tokens);
    for (let i = 0; i < tokens.length; i++) {
      const acronym = acronymFromToken(tokens[i].raw);
      if (!acronym || ACRONYM_ALLOWLIST.has(acronym.key) || known.has(acronym.key)) continue;
      if (ROMAN_NUMERAL.test(acronym.key)
        && (isUnambiguousNumeral(acronym.key) || hasNumberingEvidence(tokens, i))) {
        continue;
      }
      // The expansion has to spell the key exactly, so a span carrying a different number
      // of words that begin with a letter is refused before it is read. Reading each one
      // was quadratic: 8,000 acronyms cost 8.8 seconds, and a document of discounted words
      // defeated a guard that only refused spans carrying too many.
      const expansion = expansionSpelling(tokens, i + 1, acronym.key.length, carried,
        initials, nextClose);
      const parenthesisFollows = expansion === acronym.key;
      if (parenthesisFollows) {
        defined.add(acronym.key);
        continue;
      }
      if (shouted.has(i)) continue;
      // An ordinary English word is never an undefined acronym, even when it
      // sits in a run that is not shouting. "ENABLE MFA" reports MFA alone.
      if (COMMON_WORDS.has(acronym.key.toLowerCase())) continue;
      const definition = definitionLocations.get(acronym.key);
      const definitionPrecedes = definition !== undefined
        && (definition.line < tokens[i].line
          || (definition.line === tokens[i].line && definition.column <= tokens[i].column));
      if (definitionPrecedes
        || defined.has(acronym.key) || seen.has(acronym.key)) continue;
      seen.add(acronym.key);
      violations.push({
        rule: "acronym-undefined",
        line: tokens[i].line,
        detail: `define acronym "${acronym.display}" on first use`,
      });
    }
  }
  return violations;
}

/**
 * For each line of a document, where its paired emphasis marks sit in that line.
 *
 * The marks are paired across the whole block a line sits in, because emphasis can open
 * on one line and close on a later one. Pairing each line alone left "identi*ty and
 * access" above "management* (IAM)" with two marks that had no partner, so the word
 * gave two initials and the expansion did not spell the acronym. The uses of an acronym
 * were already read a block at a time, and the two readings now agree.
 *
 * A line in no block, such as a table row, is paired alone.
 *
 * @param lines The document as `readDocument` gives it, one entry for each source line.
 * @param blockOfLine The block each line sits in, by the index of the line. Lines of one
 *     block share a number and follow one another.
 * @returns One list for each line, in the same order: the offsets of its paired marks,
 *     ascending and counted from the start of that line. Empty for a line with none.
 */
function pairedMarksByLine(
  lines: readonly string[],
  blockOfLine: ReadonlyMap<number, number>,
): number[][] {
  const marksByLine: number[][] = lines.map(() => []);
  for (let first = 0; first < lines.length;) {
    const block = blockOfLine.get(first);
    let last = first;
    while (block !== undefined && blockOfLine.get(last + 1) === block) last++;
    let line = first;
    let lineStart = 0;
    for (const mark of emphasisMarkOffsets(lines.slice(first, last + 1).join("\n"))) {
      // A mark is never the line break, so this stops on the line that holds it.
      while (mark > lineStart + (lines[line] as string).length) {
        lineStart += (lines[line] as string).length + 1;
        line++;
      }
      (marksByLine[line] as number[]).push(mark - lineStart);
    }
    first = last + 1;
  }
  return marksByLine;
}

/**
 * The words of a block as a reader sees them, each at its place in the source.
 *
 * Paired emphasis marks are taken out of each word, so "**IAM**" is the acronym and
 * "**(identity" opens an expansion. The marks are the ones `readerMarks` gives. The column is where the first
 * character left of the word sits in the source line, marks before it counted. It is
 * compared with where a definition sits in that line, so "**(IAM)**" must not appear to
 * start before its own bracket.
 */
function unmarkedTokens(block: LabelledBlock): Array<{ raw: string; line: number; column: number }> {
  const marks = new Set(readerMarks(block));
  const tokens: Array<{ raw: string; line: number; column: number }> = [];
  let lineStart = 0;
  for (let lineIndex = 0; lineIndex < block.lines.length; lineIndex++) {
    const line = block.lines[lineIndex] as string;
    for (const match of line.matchAll(/\S+/g)) {
      const start = lineStart + match.index;
      // White space ends the word and is never a mark, so this stops inside the word.
      let leading = 0;
      while (marks.has(start + leading)) leading++;
      const raw = withoutOffsets(match[0], start, marks);
      tokens.push({ raw, line: block.line + lineIndex, column: match.index + leading });
    }
    lineStart += line.length + 1;
  }
  return tokens;
}

/**
 * Where a character sits in a source line, given its place in that line without marks.
 *
 * \param marks The offset in the source line of each mark that was removed, ascending.
 */
function sourceColumn(unmarked: number, marks: readonly number[]): number {
  // Mark k lay before this character when it sat at or before it once the k marks
  // ahead of it had gone. That holds for a first run of the marks, found by halving.
  let low = 0;
  let high = marks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((marks[middle] as number) - middle <= unmarked) low = middle + 1;
    else high = middle;
  }
  return unmarked + low;
}

/** A piece of a text without the characters at the given offsets of that text. */
function withoutOffsets(piece: string, start: number, offsets: ReadonlySet<number>): string {
  if (offsets.size === 0) return piece;
  let kept = "";
  for (let at = 0; at < piece.length; at++) {
    if (!offsets.has(start + at)) kept += piece[at];
  }
  return kept;
}

/** Adds the words of a fragment that carry an initial to the recent words, keeping the last few. */
function carry(recent: string[], fragment: string): void {
  for (const word of fragment.match(/[A-Za-z]+/g) ?? []) {
    if (/^(?:a|an|and|for|in|of|on|the|to)$/i.test(word)) continue;
    recent.push(word);
    if (recent.length > LONGEST_ACRONYM) recent.shift();
  }
}

const NAMED_WORK = "article|book|campaign|company|film|initiative|journal|organisation|" +
  "organization|paper|programme|program|project|publication|report|series|study|work";
const PROPER_NAME_CONTEXT = new RegExp(
  `(?:\\b(?:called|named|titled)|\\b(?:a|an|the)\\s+(?:${NAMED_WORK}))\\s*$`,
  "i",
);

/**
 * The blocks a reader reads as words: every prose block, and every heading as a
 * block of one line, in the order they appear.
 *
 * The five rules about words read these: legalese, doublet, wordy-phrase,
 * complex-word and double-negative. A banned word is the same word to a reader in
 * a heading as in a sentence. The rules about sentences read prose alone, because
 * a heading is not a sentence, and heading-style already bounds its length. The
 * acronym rule reads prose alone too: a heading that holds an acronym is usually
 * the name of the thing, and a use in the prose beneath it reports there.
 *
 * A Setext heading over several lines arrives as one line of text, so a finding in
 * it reports the line where the heading starts.
 *
 * Paired emphasis marks are removed, because a reader sees "in **order** to" and
 * "_shall_" as the words alone. With the marks left in, a mark inside a phrase broke
 * the match, and an underscore beside a word hid the word boundary. A strike is
 * removed the same way: the struck words are still on the page, and were already
 * reported where the whole phrase was struck. Code spans and escaped marks stay as
 * written, so a term in backticks is still named and not used.
 *
 * A link is read as its label, and the link still counts when the marks are paired,
 * as `readerMarks` describes.
 */
function readerTextBlocks(text: string, reading: Reading): ProseBlock[] {
  const blocks = [
    ...labelledProseBlocks(text, reading).map(withoutEmphasisMarks),
    ...labelledHeadings(text, reading).map(withoutEmphasisMarks),
  ];
  return blocks.sort((a, b) => a.line - b.line);
}

/**
 * The block with its paired emphasis marks removed, on the same lines.
 *
 * No line ending is removed, so each line keeps its number.
 */
function withoutEmphasisMarks(block: LabelledBlock): ProseBlock {
  return { line: block.line, lines: withoutEmphasis(block.lines.join("\n"), readerMarks(block)).split("\n") };
}

/**
 * Where the paired emphasis marks of a block sit in its lines joined by line breaks.
 *
 * The marks are paired in the text the block was read from, where each link is still
 * written out, and across the whole block, because emphasis can open on one line and
 * close on the next. A browser pairs them there, and two things follow that the
 * reader text alone cannot show. A mark outside a link is not paired with a mark
 * inside it: "in *or[der*](u) to" shows both asterisks. And a mark beside a bracket is
 * judged beside that bracket: "in or*[der](u)* to" shows both asterisks too, though the
 * reader text has the first between two letters. Each mark is then found again in the
 * reader text, where the rules about words look for it.
 *
 * @returns The offsets, ascending. Empty for a block with no paired mark.
 */
function readerMarks(block: LabelledBlock): number[] {
  return flattenedOffsets(emphasisMarkOffsets(block.source, block.links), block.source, block.links);
}

function legaleseViolations(text: string, reading: Reading): Violation[] {
  const violations: Violation[] = [];
  for (const block of readerTextBlocks(text, reading)) {
    for (let i = 0; i < block.lines.length; i++) {
      const line = block.lines[i];
      for (const term of LEGALESE) {
        const matches = withoutNamedTerms(line, term)
          .match(new RegExp(`\\b${term}\\b`, "gi"));
        for (let n = 0; n < (matches?.length ?? 0); n++) {
          violations.push({
            rule: "legalese",
            line: block.line + i,
            detail: `banned term "${term}"`,
          });
        }
      }
    }
  }
  return violations;
}

function doubletViolations(text: string, reading: Reading): Violation[] {
  const violations: Violation[] = [];
  for (const block of readerTextBlocks(text, reading)) {
    // The advice itself names "to" and "in order to" rather than using them.
    const paragraph = block.lines.join("\n");
    const occupied: Array<{ start: number; end: number }> = [];
    const matches: Array<{ start: number; end: number; entry: DoubletEntry }> = [];
    for (const entry of DOUBLETS) {
      const pattern = new RegExp(`\\b${entry.phrase.replaceAll(" ", "\\s+")}\\b`, "gi");
      for (const match of withoutNamedTerms(paragraph, entry.phrase).matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        const titleCased = match[0].split(/\s+/)
          .every((word) => /^(?:and|or|of|the|to)$/.test(word) || /^[A-Z][a-z]*$/.test(word));
        const before = paragraph.slice(Math.max(0, start - 80), start);
        if (titleCased && PROPER_NAME_CONTEXT.test(before)) continue;
        if (occupied.some((range) => start < range.end && end > range.start)) continue;
        occupied.push({ start, end });
        matches.push({ start, end, entry });
      }
    }
    matches.sort((a, b) => a.start - b.start);
    for (const match of matches) {
      violations.push({
        rule: "doublet",
        line: lineAtOffset(block.line, paragraph, match.start),
        detail: match.entry.legalRegister
          ? `legal-register phrase "${match.entry.phrase}"; review for audience fit`
          : `redundant phrase "${match.entry.phrase}"; consider "${match.entry.lean}"`,
      });
    }
  }
  return violations;
}

// Link text a listener can act on. Someone using a screen reader often moves
// through a document by its links, hearing the link text alone with no
// surrounding sentence, so "click here" and a bare address both say nothing
// about the destination.
const UNINFORMATIVE_LINK = /^(?:click here|here|this|link|this link|read more|more|more info|details|see more|learn more|go|page|website|download)$/i;
const HTML_ANCHOR = /<a\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/a\s*>/gi;
const HTML_IMAGE = /<img\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const HTML_TAG = /<(?:"[^"]*"|'[^']*'|[^'">])*>/g;

function spokenText(label: string): string {
  return label
    .replace(HTML_TAG, " ")
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, " ")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlAttribute(attributes: string, name: string): string | null {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(attributes);
  return match === null ? null : match[1] ?? match[2] ?? match[3] ?? "";
}

function linkTextViolations(text: string, reading: Reading): Violation[] {
  const violations: Violation[] = [];
  const { lines, markupLines, references, hidden } = readDocument(text, reading);
  for (let i = 0; i < lines.length; i++) {
    if (hidden(i)) continue;
    // One scan serves all three forms. Reading each with its own pattern was quadratic:
    // a label pattern scans to the end of the line from every "[" and then gives the
    // ground back one character at a time.
    for (const link of markdownLinks(lines[i] as string)) {
      // Skip image syntax: the alt-text rule owns that, and anything inside an alt
      // text, which a reader never meets as a link of its own.
      if (link.image || !link.rendered) continue;
      const label = link.label.trim();
      const spoken = spokenText(label);
      const bare = /^<?(?:https?:\/\/|www\.)/i.test(spoken);
      let target = link.target.trim();
      if (link.kind === "inline") {
        if (target.length === 0) continue;
      } else {
        // A reference names its destination, and a bare label names its own.
        target = link.kind === "reference" ? target || label : label;
        if (!references.has(normaliseReference(target))) continue;
      }
      if (spoken.length === 0) {
        // A shortcut reference with no text is not a link at all.
        if (link.kind === "shortcut") continue;
        violations.push({
          rule: "link-text",
          line: i + 1,
          detail: "link has no text; say where it goes",
        });
      } else if (UNINFORMATIVE_LINK.test(spoken) || bare) {
        violations.push({
          rule: "link-text",
          line: i + 1,
          detail: `link text "${spoken}" describes no destination (${target.slice(0, 40)})`,
        });
      }
    }
  }
  const markup = markupLines.join("\n");
  // A link whose label runs over a line ending. The same scan finds it, filtered to the
  // labels that hold one.
  for (const link of markdownLinks(markup)) {
    if (link.image || link.kind !== "inline" || !link.rendered) continue;
    if (!link.label.includes("\n")) continue;
    const target = link.target.trim();
    if (target.length === 0 || link.target.includes("\n")) continue;
    const whole = markup.slice(link.start, link.end);
    if (/\n[ \t]*\n/.test(whole)) continue;
    const spoken = spokenText(link.label);
    const bare = /^<?(?:https?:\/\/|www\.)/i.test(spoken);
    if (spoken.length > 0 && !UNINFORMATIVE_LINK.test(spoken) && !bare) continue;
    violations.push({
      rule: "link-text",
      line: lineAtOffset(1, markup, link.start),
      detail: spoken.length === 0
        ? "link has no text; say where it goes"
        : `link text "${spoken}" describes no destination (${target.slice(0, 40)})`,
    });
  }
  for (const match of markup.matchAll(HTML_ANCHOR)) {
    if (/\n[ \t]*\n/.test(match[0])) continue;
    const target = htmlAttribute(match[1], "href");
    if (target === null) continue;
    const spoken = spokenText(match[2]);
    const bare = /^<?(?:https?:\/\/|www\.)/i.test(spoken);
    if (spoken.length > 0 && !UNINFORMATIVE_LINK.test(spoken) && !bare) continue;
    violations.push({
      rule: "link-text",
      line: lineAtOffset(1, markup, match.index),
      detail: spoken.length === 0
        ? "link has no text; say where it goes"
        : `link text "${spoken}" describes no destination (${target.slice(0, 40)})`,
    });
  }
  return violations;
}

// An image with no alternative text is silence to a reader who cannot see it.
// An empty alt is legitimate for a purely decorative image, so the writer can
// mark that intent explicitly rather than leaving the alt blank by accident.
function imageAltViolations(text: string, reading: Reading): Violation[] {
  const violations: Violation[] = [];
  const { lines, markupLines, references, hidden } = readDocument(text, reading);
  for (let i = 0; i < lines.length; i++) {
    if (hidden(i)) continue;
    // One scan finds both image forms, filtered to the ones with no alternative text.
    for (const link of markdownLinks(lines[i] as string)) {
      if (!link.image || link.kind === "shortcut" || !link.rendered) continue;
      if (link.label.trim().length > 0) continue;
      const target = link.target.trim();
      if (link.kind === "inline") {
        if (target.length === 0) continue;
        // "decorative" as the title marks an image that carries no meaning.
        // A filename containing the word does not express that decision.
        if (/\s+(?:"decorative"|'decorative'|\(decorative\))\s*$/i.test(link.target)) continue;
      } else if (!references.has(normaliseReference(target))) continue;
      violations.push({
        rule: "image-alt",
        line: i + 1,
        detail: `image has no alternative text (${(link.kind === "inline" ? link.target : target).slice(0, 40)})`,
      });
    }
  }
  const markup = markupLines.join("\n");
  for (const match of markup.matchAll(HTML_IMAGE)) {
    if (/\n[ \t]*\n/.test(match[0])) continue;
    const attributes = match[1];
    if (htmlAttribute(attributes, "alt") !== null) continue;
    const target = (htmlAttribute(attributes, "src") ?? "image").slice(0, 40);
    violations.push({
      rule: "image-alt",
      line: lineAtOffset(1, markup, match.index),
      detail: `image has no alternative text (${target})`,
    });
  }
  return violations;
}

/**
 * Blank the spans in which a term is named rather than used.
 *
 * A term is named when a quotation or a pair of backticks holds it and
 * nothing else. "shall" names the word, while "Staff shall submit requests"
 * uses it inside a sentence the writer chose to quote. Emphasis names
 * nothing, because a writer emphasises a word they are using.
 */
function withoutNamedTerms(line: string, term: string): string {
  const wanted = term.trim().toLowerCase();
  const spans = /`[^`]*`|[\u201c\u201d"][^\u201c\u201d"]*[\u201c\u201d"]|'[^']*'|\u2018[^\u2019]*\u2019/g;
  return line.replace(spans, (span) => {
    const inner = span.slice(1, -1).trim().toLowerCase();
    return inner === wanted ? " ".repeat(span.length) : span;
  });
}

function complexWordViolations(text: string, reading: Reading): Violation[] {
  const violations: Violation[] = [];
  for (const block of readerTextBlocks(text, reading)) {
    for (let i = 0; i < block.lines.length; i++) {
      const line = block.lines[i];
      for (const match of line.matchAll(/[A-Za-z']+/g)) {
        const plain = COMPLEX_WORDS.get(match[0].toLowerCase());
        if (!plain) continue;
        if (withoutNamedTerms(line, match[0])[match.index] === " ") continue;
        violations.push({
          rule: "complex-word",
          line: block.line + i,
          detail: `"${match[0]}" where "${plain}" would do`,
        });
      }
    }
  }
  return violations;
}

function doubleNegativeViolations(text: string, reading: Reading): Violation[] {
  const violations: Violation[] = [];
  for (const block of readerTextBlocks(text, reading)) {
    // Named rather than used: the rule's own description quotes the phrase.
    const paragraph = block.lines.join("\n");
    for (const phrase of DOUBLE_NEGATIVES) {
      const pattern = new RegExp(`\\b${phrase.replaceAll(" ", "\\s+")}\\b`, "gi");
      for (const match of withoutNamedTerms(paragraph, phrase).matchAll(pattern)) {
        violations.push({
          rule: "double-negative",
          line: lineAtOffset(block.line, paragraph, match.index),
          detail: `"${match[0]}" makes the reader unpick two negatives`,
        });
      }
    }
  }
  return violations;
}

// The skill's first rule is to open with the answer. A filler opening spends
// the reader's first sentence saying nothing, and it is only a fault at the
// very start: "let me know" mid-document is ordinary English.
function fillerOpeningViolations(text: string, reading: Reading): Violation[] {
  // Front matter is metadata, not the opening sentence. It arrives as an
  // ordinary prose block, so without this the first real sentence of every
  // templated document escaped the rule entirely.
  const blocks = labelledProseBlocks(text, reading);
  if (blocks.length === 0) return [];
  // The marks of paired emphasis are removed, not the words inside them:
  // "**Certainly!**" is still a filler opening, and removing the emphasised
  // text hid it. A code span keeps its backticks, because it names a term and
  // is not the writer speaking. Smart apostrophes are normalised so "I'd"
  // matches however it was typed.
  const opening = (withoutEmphasisMarks(blocks[0]).lines[0] ?? "")
    .replace(/[‘’]/g, "'")
    .trimStart()
    .toLowerCase();
  for (const filler of FILLER_OPENINGS) {
    if (!opening.startsWith(filler)) continue;
    // The filler must be a whole word. "Surely the answer is correct" begins
    // with the letters of "sure", "Sure-fire evidence" with the same, and
    // "Let meadows grow" with "let me". All are ordinary sentences.
    const next = opening.charAt(filler.length);
    if (next !== "" && !/[\s.,;:!?)\]]/.test(next)) continue;
    const remainder = opening.slice(filler.length).replace(/^[\s.,;:!?]+/, "");
    if (/^not\b/.test(remainder)) continue;
    return [{
      rule: "filler-opening",
      line: blocks[0].line,
      detail: `opens with "${filler}" instead of the answer`,
    }];
  }
  return [];
}



// A listener hears each cell announced against its column name, so a table
// whose header cells are blank tells them nothing about what they are hearing.
function tableHeaderViolations(text: string, reading: Reading): Violation[] {
  const violations: Violation[] = [];
  const { lines, hidden } = readDocument(text, reading);
  for (let i = 0; i < lines.length - 1; i++) {
    if (hidden(i)) continue;
    const row = lines[i].trim();
    const divider = lines[i + 1].trim();
    // Outer pipes are optional in GitHub markdown, and the divider may carry
    // alignment colons and padding. Requiring the tidiest form meant a table
    // written the common way was never checked at all.
    if (!row.includes("|") || !/^\|?[\s:|-]+\|?$/.test(divider) || !divider.includes("-")) continue;
    // Strip the outer pipes only where the row actually has them. Removing a
    // trailing pipe from a row written without outer pipes deletes a real
    // column separator, and the empty column it marks is the whole point.
    const trimmed = row.startsWith("|") ? row.replace(/^\|/, "").replace(/\|$/, "") : row;
    const cells = trimmed.split("|").map((cell) => cell.replace(/[*_~`]/g, "").trim());
    if (cells.every((cell) => cell.length > 0)) continue;
    violations.push({
      rule: "table-header",
      line: i + 1,
      detail: "table header has an empty column name",
    });
  }
  return violations;
}

function wordyPhraseViolations(text: string, reading: Reading): Violation[] {
  const violations: Violation[] = [];
  for (const block of readerTextBlocks(text, reading)) {
    // The advice itself names "to" and "in order to" rather than using them.
    const paragraph = block.lines.join("\n");
    const occupied: Array<{ start: number; end: number }> = [];
    for (const entry of WORDY_PHRASES) {
      const pattern = new RegExp(`\\b${entry.phrase.replaceAll(" ", "\\s+")}\\b`, "gi");
      for (const match of withoutNamedTerms(paragraph, entry.phrase).matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        // The longest phrase wins, so "in spite of the fact that" is not also
        // reported as the shorter phrase inside it.
        if (occupied.some((range) => start < range.end && end > range.start)) continue;
        occupied.push({ start, end });
        violations.push({
          rule: "wordy-phrase",
          line: lineAtOffset(block.line, paragraph, start),
          detail: `"${entry.phrase}" says what "${entry.lean}" says`,
        });
      }
    }
  }
  return violations;
}

function proseEnumerationViolations(text: string, reading: Reading): Violation[] {
  const violations: Violation[] = [];
  for (const block of labelledProseBlocks(text, reading)) {
    // Read without emphasis marks, which hid "_First_" and "**(1)**" from the patterns.
    // A space is as long as the line break it stands for, so each mark keeps its place.
    const paragraph = withoutEmphasis(block.lines.join(" "), readerMarks(block));
    const ranks = new Set<number>();
    // A hyphenated compound is one word, not a rank: "third-party service" is
    // not a third item, and counting it turned ordinary prose into a finding.
    for (const match of paragraph.matchAll(/\b(first|firstly|second|secondly|third|thirdly|fourth|fourthly|fifth|fifthly|sixth|sixthly)\b(?!-)/gi)) {
      ranks.add(ORDINAL_RANKS.get(match[1].toLowerCase())!);
    }
    for (const match of paragraph.matchAll(/(?:^|\s)(?:\(([1-6])\)|([1-6])[.)])(?=\s|$)/g)) {
      ranks.add(Number(match[1] ?? match[2]));
    }
    if (ranks.has(1) && ranks.size >= ENGINE_THRESHOLDS.enumerationMinimumRanks) {
      violations.push({
        rule: "prose-enumeration",
        line: block.line,
        detail: `enumeration ranks ${[...ranks].sort((a, b) => a - b).join(", ")} in prose; consider a list`,
      });
    }
  }
  return violations;
}

/**
 * Acronyms a project treats as known, from `.iso-24495-4/acronyms.json`.
 *
 * The shipped list stays universal on purpose: this plugin targets
 * international English, and baking CSS, SQL and SDK into it would make the
 * core list a software list. But a technical writer met a dozen findings for
 * ordinary vocabulary, which is the shortest route to abandoning the audit,
 * so each project extends the list for itself.
 *
 * The file holds an array of strings. Anything unreadable or malformed leaves
 * the core list alone rather than failing the audit, because an advisory tool
 * must never be the reason a document cannot be checked.
 *
 * @param directory The project root, which holds the `.iso-24495-4` folder.
 * @returns The acronyms trimmed and in capitals, ready for
 *     `AuditOptions.knownAcronyms`. Entries that are not text are dropped.
 *     Empty when the file is missing, unreadable, not JSON or not an array.
 */
export function projectAcronyms(directory: string): ReadonlySet<string> {
  const path = join(directory, ".iso-24495-4", "acronyms.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toUpperCase())
        .filter((entry) => entry.length > 0),
    );
  } catch {
    return new Set();
  }
}

function walk(
  dir: string,
  out: string[],
  onSkip: ((path: string) => void) | undefined,
  isRoot: boolean,
  readDirectory: typeof readdirSync,
  inspectEntry: typeof lstatSync,
): void {
  let entries: string[];
  try {
    entries = readDirectory(dir);
  } catch (error) {
    // An unreadable root is an error the caller must see: a mistyped corpus
    // path must not read as a clean empty corpus. Below the root, the skip is
    // reported and the walk continues.
    if (isRoot) throw error;
    onSkip?.(dir);
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    let entryStat: ReturnType<typeof lstatSync>;
    try {
      entryStat = inspectEntry(full);
    } catch {
      // Dangling links and permission failures skip the entry, not the walk.
      // The caller is told, so it can distinguish "skipped" from "gone".
      onSkip?.(full);
      continue;
    }
    // Do not follow links found under the selected root. A link may leave the
    // approved path or form a cycle, so reading it would widen the audit.
    if (entryStat.isSymbolicLink()) {
      onSkip?.(full);
      continue;
    }
    if (entryStat.isDirectory()) {
      walk(full, out, onSkip, false, readDirectory, inspectEntry);
    } else if (TEXT_EXTENSIONS.some((ext) => entry.toLowerCase().endsWith(ext))) {
      out.push(full);
    }
  }
}

/**
 * Every audited document under a directory, at any depth.
 *
 * `node_modules` and `.git` are not entered. A symbolic link is never
 * followed, because it may leave the selected path or form a cycle.
 *
 * @param dir The directory to walk.
 * @param onSkip Called with the path of each entry passed over: a link, an
 *     entry that cannot be inspected, or a directory below `dir` that cannot
 *     be listed. Without it those entries vanish silently.
 * @param readDirectory Replaces the directory reader.
 * @param inspectEntry Replaces the call that inspects one entry.
 * @returns The paths sorted, each beginning with `dir` as it was given.
 *     Empty when the directory holds no such file.
 * @throws The file system error when `dir` itself cannot be listed, so a
 *     mistyped path is never read as an empty corpus.
 */
export function listTextFiles(
  dir: string,
  onSkip?: (path: string) => void,
  readDirectory: typeof readdirSync = readdirSync,
  inspectEntry: typeof lstatSync = lstatSync,
): string[] {
  const paths: string[] = [];
  walk(dir, paths, onSkip, true, readDirectory, inspectEntry);
  return paths.sort();
}
