// Deterministic corpus audit: mechanical proxies for the Part 1/2 rules.
// Emits counts and locations only. It never judges clarity and its output
// must never be presented as ISO compliance.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { headings, mergedSentences, proseBlocks, splitSentences, wordCount } from "./lib/parse.ts";
import { COMMON_WORDS } from "./lib/lexicon.ts";
import type { Findings, Violation } from "./lib/types.ts";

// Thresholds recalibrated 2026-08-13. Public guidance (Cutts, the Plain
// English Campaign, the Clear English Standard) specifies an AVERAGE of 15 to
// 20 words, not a per-sentence cap. The 30-word cap and the 10-sentence
// minimum sample are this project's own proxy choices, informed by local
// session measurements that are not part of this repository.
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
});

const SENTENCE_WORD_LIMIT = ENGINE_THRESHOLDS.sentenceWordLimit;
const SENTENCE_AVERAGE_LIMIT = ENGINE_THRESHOLDS.sentenceAverageLimit;
const AVERAGE_MIN_SENTENCES = ENGINE_THRESHOLDS.averageMinimumSentences;
const PARAGRAPH_SENTENCE_LIMIT = ENGINE_THRESHOLDS.paragraphSentenceLimit;
const MAX_HEADING_LEVEL = ENGINE_THRESHOLDS.maximumHeadingLevel;
const HEADING_WORD_LIMIT = ENGINE_THRESHOLDS.headingWordLimit;
// Exported so the hook and the repository's own dogfood guard read the same
// list. While each kept its own copy, a .txt file could ship unaudited.
export const TEXT_EXTENSIONS = [".md", ".markdown", ".txt"];

/**
 * Whether this path is a document the engine audits. Every caller must use
 * this rather than its own test: comparing extension lists proved nothing,
 * because one caller lower-cased the extension and another did not, so
 * `notes.TXT` was audited by the hook and skipped by the repository guard.
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
]);

// Titles and events numbered with Roman numerals by convention.
const NAMED_BY_NUMERAL = new Set([
  "King", "Queen", "Pope", "Emperor", "Tsar", "Louis", "Henry", "George",
  "Elizabeth", "Charles", "William", "Bowl", "War", "Olympiad",
]);

// Valid numerals that are far more often acronyms. Everything else valid is
// treated as a numeral, so "VIII" and "LVIII" never reach the acronym rule.
const NUMERAL_COLLISIONS = new Set(["CI", "CD", "DC", "MD", "DI", "MI", "VI", "MIX", "CM", "DIM"]);
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

const ORDINAL_RANKS = new Map([
  ["first", 1], ["firstly", 1],
  ["second", 2], ["secondly", 2],
  ["third", 3], ["thirdly", 3],
  ["fourth", 4], ["fourthly", 4],
  ["fifth", 5], ["fifthly", 5],
  ["sixth", 6], ["sixthly", 6],
]);

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

function lineAtOffset(blockLine: number, text: string, offset: number): number {
  return blockLine + (text.slice(0, offset).match(/\n/g)?.length ?? 0);
}

function acronymFromToken(raw: string): { display: string; key: string } | null {
  let token = raw.replace(/^["'“‘([{<]+/, "").replace(/["'”’\)\]}>,:;!?]+$/, "");
  if (!ACRONYM_SHAPE.test(token) && token.endsWith(".")) token = token.slice(0, -1);
  if (!ACRONYM_SHAPE.test(token)) return null;
  const key = token.replaceAll(".", "");
  if (/\d/.test(token)) return null;
  return { display: token, key };
}

function isAllCaps(raw: string): boolean {
  const stripped = raw.replace(/^[^A-Za-z]+|[^A-Za-z.]+$/g, "");
  return ACRONYM_SHAPE.test(stripped) || /^[A-Z]{2,}$/.test(stripped);
}

// A numeral is a numeral because of where it sits. Only a numbering word
// immediately before it, coordination with an unambiguous numeral, or a name
// pattern counts as evidence. Words that double as verbs ("book a room",
// "type the command") are deliberately absent from the numbering list.
function hasNumberingEvidence(tokens: Array<{ raw: string }>, index: number): boolean {
  const bare = (raw: string | undefined): string => (raw ?? "").replace(/[^A-Za-z]/g, "");
  const previous = bare(tokens[index - 1]?.raw);
  if (NUMBERING_WORDS.has(previous.toLowerCase())) return true;
  if (NAMED_BY_NUMERAL.has(previous)) return true;
  // "Sections II and IV": the neighbour is a numeral no acronym collides with.
  for (const neighbour of [bare(tokens[index - 1]?.raw), bare(tokens[index + 1]?.raw)]) {
    if (neighbour && ROMAN_NUMERAL.test(neighbour) && !NUMERAL_COLLISIONS.has(neighbour)) return true;
  }
  // A coordinator between two numerals: "II, III and IV".
  if (/^(?:and|or|to|through)$/i.test(previous)) {
    for (let back = index - 2; back >= 0 && back >= index - 4; back--) {
      const candidate = bare(tokens[back]?.raw);
      if (candidate && ROMAN_NUMERAL.test(candidate)) return true;
    }
  }
  return false;
}

// Shouted text and a chain of initialisms have the same shape: capitals, of
// similar length, side by side. They differ in one measurable way, which is
// how many of the words are ordinary English. Counting tokens could not tell
// "SAVE DATA FIRST" from "AWS IAM SSO MFA"; asking the lexicon can.
function shoutedPositions(tokens: Array<{ raw: string }>): Set<number> {
  const shouted = new Set<number>();
  const bare = (raw: string): string => raw.replace(/[^A-Za-z]/g, "").toLowerCase();
  const markRun = (start: number, end: number): void => {
    if (end - start < 2) return;
    const words = tokens.slice(start, end).filter((token) => COMMON_WORDS.has(bare(token.raw)));
    if (words.length * 2 < end - start) return;
    for (let j = start; j < end; j++) shouted.add(j);
  };
  let runStart = 0;
  for (let i = 0; i <= tokens.length; i++) {
    if (i < tokens.length && isAllCaps(tokens[i].raw)) continue;
    markRun(runStart, i);
    runStart = i + 1;
  }
  return shouted;
}

function acronymViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  const defined = new Set<string>();
  const seen = new Set<string>();
  for (const block of proseBlocks(text)) {
    const tokens = block.lines.flatMap((line, lineIndex) =>
      line.split(/\s+/).filter(Boolean).map((raw) => ({ raw, line: block.line + lineIndex })),
    );
    const shouted = shoutedPositions(tokens);
    for (let i = 0; i < tokens.length; i++) {
      const acronym = acronymFromToken(tokens[i].raw);
      if (!acronym || ACRONYM_ALLOWLIST.has(acronym.key)) continue;
      if (ROMAN_NUMERAL.test(acronym.key)
        && (!NUMERAL_COLLISIONS.has(acronym.key) || hasNumberingEvidence(tokens, i))) {
        continue;
      }
      const inParentheses = tokens[i].raw.includes("(");
      const parenthesisFollows = tokens
        .slice(i + 1, i + 1 + ENGINE_THRESHOLDS.acronymDefinitionWindow)
        .some((token) => token.raw.includes("("));
      if (inParentheses || parenthesisFollows) {
        defined.add(acronym.key);
        continue;
      }
      if (shouted.has(i)) continue;
      if (defined.has(acronym.key) || seen.has(acronym.key)) continue;
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

function doubletViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const block of proseBlocks(text)) {
    const paragraph = block.lines.join("\n");
    const occupied: Array<{ start: number; end: number }> = [];
    const matches: Array<{ start: number; end: number; entry: DoubletEntry }> = [];
    for (const entry of DOUBLETS) {
      const pattern = new RegExp(`\\b${entry.phrase.replaceAll(" ", "\\s+")}\\b`, "gi");
      for (const match of paragraph.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
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

function proseEnumerationViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const block of proseBlocks(text)) {
    const paragraph = block.lines.join(" ");
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

export function auditText(text: string): Violation[] {
  const violations: Violation[] = [];
  const sentenceLengths: number[] = [];
  for (const block of proseBlocks(text)) {
    const paragraph = block.lines.join(" ");
    const sentences = splitSentences(paragraph);
    for (const sentence of sentences) {
      const words = wordCount(sentence);
      if (words > 0) sentenceLengths.push(words);
      if (words > SENTENCE_WORD_LIMIT) {
        violations.push({
          rule: "sentence-length",
          line: block.line,
          detail: `${words} words (limit ${SENTENCE_WORD_LIMIT})`,
        });
      }
    }
    // Counted from the fewest sentences the paragraph can hold. An unresolved
    // full stop must never manufacture the sentence that breaks the limit.
    const fewest = mergedSentences(paragraph).length;
    if (fewest > PARAGRAPH_SENTENCE_LIMIT) {
      violations.push({
        rule: "paragraph-length",
        line: block.line,
        detail: `${fewest} sentences (limit ${PARAGRAPH_SENTENCE_LIMIT})`,
      });
    }
    for (let i = 0; i < block.lines.length; i++) {
      for (const term of LEGALESE) {
        const matches = block.lines[i].match(new RegExp(`\\b${term}\\b`, "gi"));
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
  // The standards specify an average across the document, not a cap; the cap
  // above only catches genuine sprawl. Small samples are exempt because an
  // average over a handful of sentences is noise, not judgement.
  if (sentenceLengths.length >= AVERAGE_MIN_SENTENCES) {
    const total = sentenceLengths.reduce((a, b) => a + b, 0);
    const average = total / sentenceLengths.length;
    if (average > SENTENCE_AVERAGE_LIMIT) {
      violations.push({
        rule: "sentence-average",
        line: 1,
        detail: `average ${average.toFixed(1)} words across ${sentenceLengths.length} sentences (limit ${SENTENCE_AVERAGE_LIMIT})`,
      });
    }
  }
  const documentHeadings = headings(text);
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
    } else if (headingText.endsWith(".") && !headingText.endsWith("...")) {
      violations.push({
        rule: "heading-style",
        line: heading.line,
        detail: "heading ends with a full stop",
      });
    }
  }

  // lucid-inspired, reimplemented; proxy choice, not a standard clause.
  violations.push(...acronymViolations(text));

  // lucid-inspired, reimplemented; proxy choice, not a standard clause.
  violations.push(...doubletViolations(text));

  // lucid-inspired, reimplemented; proxy choice, not a standard clause.
  violations.push(...proseEnumerationViolations(text));
  return violations;
}

function walk(
  dir: string,
  out: string[],
  onSkip: ((path: string) => void) | undefined,
  isRoot: boolean,
  readDirectory: typeof readdirSync,
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
    let isDirectory: boolean;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      // Dangling links and permission failures skip the entry, not the walk.
      // The caller is told, so it can distinguish "skipped" from "gone".
      onSkip?.(full);
      continue;
    }
    if (isDirectory) {
      walk(full, out, onSkip, false, readDirectory);
    } else if (TEXT_EXTENSIONS.some((ext) => entry.toLowerCase().endsWith(ext))) {
      out.push(full);
    }
  }
}

export function listTextFiles(
  dir: string,
  onSkip?: (path: string) => void,
  readDirectory: typeof readdirSync = readdirSync,
): string[] {
  const paths: string[] = [];
  walk(dir, paths, onSkip, true, readDirectory);
  return paths.sort();
}

export function auditCorpus(dir: string, onSkip?: (path: string) => void): Findings {
  const paths = listTextFiles(dir, onSkip);
  const findings: Findings = { configHash: configHash(), files: {}, totals: {} };
  for (const path of paths) {
    const key = relative(dir, path).replaceAll("\\", "/");
    const violations = auditText(readFileSync(path, "utf8"));
    findings.files[key] = { violations };
    for (const v of violations) {
      findings.totals[v.rule] = (findings.totals[v.rule] ?? 0) + 1;
    }
  }
  return findings;
}

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
  const jsonFlag = argv.indexOf("--json");
  if (jsonFlag !== -1 && !argv[jsonFlag + 1]) {
    stderr("audit-corpus: --json requires an output file");
    return 2;
  }
  try {
    const skipped: string[] = [];
    const findings = auditCorpus(dir, (path) => skipped.push(path));
    for (const path of skipped) {
      stderr(`warning: skipped unreadable entry: ${path}`);
    }
    if (jsonFlag !== -1) {
      writeFileSync(argv[jsonFlag + 1], JSON.stringify(findings, null, 2));
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
    stderr(`audit-corpus: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
