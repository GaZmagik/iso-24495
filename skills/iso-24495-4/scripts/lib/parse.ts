// Markdown text extraction shared by the audit scripts. Regex heuristics
// only. Anything smarter belongs to the agent, not to deterministic tooling.

import { EXCLUSIVE_STARTERS, LOWERCASE_NAMES } from "./lexicon.ts";

export interface ProseBlock {
  /** 1-indexed line number of the block's first line. */
  line: number;
  /** The block's lines, in order. */
  lines: string[];
}

export interface Heading {
  level: number;
  line: number;
  text: string;
}

const NON_PROSE_PREFIX = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>)/;
// A table row need not begin with a pipe: GitHub renders "Term | Meaning" with
// a divider beneath it, and those cells were being audited as prose, so a
// table's contents produced findings that belonged to no sentence.
const TABLE_DIVIDER = /^\|?[\s:|-]*-[\s:|-]*\|?$/;

/**
 * The lines a document devotes to front matter, or none.
 *
 * Both scanners must agree on this. While the heading scanner entered front
 * matter on the opening marker and the prose scanner required a closing one, an
 * unclosed block hid every heading in the document while keeping its text as
 * prose. A block with no closing marker is not front matter at all.
 */
export function frontMatterRange(lines: string[]): { start: number; end: number } | null {
  // The delimiter sits at column 0. Matching a trimmed line let an indented
  // "---" inside a YAML block scalar close the block early, which left a code
  // fence outside it and hid the whole document body.
  const isDelimiter = (line: string | undefined): boolean => /^---[ \t]*$/.test(line ?? "");
  if (!isDelimiter(lines[0])) return null;
  const closing = lines.findIndex((line, index) => index > 0 && isDelimiter(line));
  return closing === -1 ? null : { start: 0, end: closing };
}

// A rule across the page, not a word in a sentence. Table detection used to
// remove these by accident; once it stopped, "---" joined the sentence beneath
// it and added a token, which turned a 30-word sentence into a false finding.
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * The lines a document devotes to tables.
 *
 * A table begins where a header row sits directly above a divider, and runs
 * until a line without a pipe. Inferring a row from a neighbouring pipe swallowed
 * ordinary prose: "## Compare A | B" above "The supplier shall respond | today."
 * removed the second line from the document entirely, and silent removal is
 * worse than a wrong finding because nobody sees it happen.
 */
function tableLines(lines: string[]): Set<number> {
  const table = new Set<number>();
  let inFence = false;
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^(```|~~~)/.test(lines[i].trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence || table.has(i)) continue;
    const header = lines[i].trim();
    const divider = lines[i + 1].trim();
    if (!header.includes("|") || !TABLE_DIVIDER.test(divider) || !divider.includes("-")) continue;
    table.add(i);
    table.add(i + 1);
    for (let row = i + 2; row < lines.length; row++) {
      if (!lines[row].includes("|")) break;
      table.add(row);
    }
  }
  return table;
}
const ATX_HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;

interface HeadingScan {
  found: Heading[];
  structuralLines: Set<number>;
}

function visibleHeadingText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

function scanHeadings(lines: string[]): HeadingScan {
  const found: Heading[] = [];
  const structuralLines = new Set<number>();
  const frontMatter = frontMatterRange(lines);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (frontMatter !== null && i <= frontMatter.end) continue;
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const atx = ATX_HEADING.exec(lines[i]);
    if (atx) {
      found.push({
        level: atx[1].length,
        line: i + 1,
        text: atx[2].replace(/\s+#+\s*$/, "").trim(),
      });
      structuralLines.add(i);
      continue;
    }

    const underline = SETEXT_UNDERLINE.exec(lines[i]);
    if (!underline || i === 0) continue;
    const previous = lines[i - 1];
    const previousTrimmed = previous.trimStart();
    // Setext text must be the immediately preceding ordinary line. These
    // guards keep list content and indented code in their existing categories.
    if (previous.trim() === ""
      || /^ {4}/.test(previous)
      || NON_PROSE_PREFIX.test(previousTrimmed)
      || /^(```|~~~)/.test(previousTrimmed)) {
      continue;
    }
    found.push({
      level: underline[1][0] === "=" ? 1 : 2,
      line: i,
      text: visibleHeadingText(previous.trim()),
    });
    structuralLines.add(i - 1);
    structuralLines.add(i);
  }
  return { found, structuralLines };
}

/** Collect prose paragraphs, skipping headings, lists, tables, quotes, and fenced code. */
export function proseBlocks(text: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let current: ProseBlock | null = null;
  let inFence = false;
  const lines = text.split(/\r?\n/);
  const headingLines = scanHeadings(lines).structuralLines;
  // Front matter is metadata, not prose. It was audited as ordinary text, so
  // "title: Each and Every Shall Policy" produced legalese and doublet
  // findings against a line no reader reads as a sentence.
  const frontMatter = frontMatterRange(lines);
  const tables = tableLines(lines);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if ((frontMatter !== null && i <= frontMatter.end) || tables.has(i)) {
      current = null;
      continue;
    }
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
      current = null;
      continue;
    }
    // Test the trimmed line: list markers and quotes are structure at ANY
    // indentation. Testing the raw line made nested bullets count as prose,
    // which merged them into giant fake sentences and biased the average.
    // A setext underline is already a heading line, so anything left that looks
    // like a break is one.
    if (inFence
      || headingLines.has(i)
      || THEMATIC_BREAK.test(line)
      || line.trim() === ""
      || NON_PROSE_PREFIX.test(line.trimStart())) {
      current = null;
      continue;
    }
    if (current === null) {
      current = { line: i + 1, lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  }
  return blocks;
}

/** Heading levels with their 1-indexed line numbers, ignoring fenced code. */
export function headings(text: string): Heading[] {
  const lines = text.split(/\r?\n/);
  return scanHeadings(lines).found;
}

// A full stop ends a sentence far less often than it ends an abbreviation, and
// no single test settles which. Two rounds of review broke every binary rule
// tried here, in both directions. So a boundary now has three verdicts, and
// the rules that consume sentences decide what to do with the third.
//
// The evidence is what follows the stop. A capital proves nothing on its own,
// because proper nouns are capitalised anywhere; a capitalised function word
// such as "The" or "However" is strong evidence, because those are rarely
// capitalised mid-sentence.
const TITLES = new Set([
  "dr", "mr", "mrs", "ms", "messrs", "prof", "rev", "fr", "sr", "jr", "st",
  "gen", "gov", "sen", "rep", "capt", "col", "maj", "lt", "sgt",
]);
const INLINE_ABBREVIATIONS = new Set([
  "inc", "ltd", "co", "vs", "etc", "fig", "no", "al", "approx", "cf", "dept",
  "est", "vol", "ed", "eds", "pp", "ca", "min", "max", "ext", "ref", "eq", "ver",
]);
const DOTTED_FORM = /^[^A-Za-z]*(?:[A-Za-z]\.){2,}$/;
const SINGLE_INITIAL = /^[^A-Za-z]*[A-Z]\.$/;

export type Boundary = "merge" | "split" | "ambiguous";

function lastToken(fragment: string): string {
  return fragment.trimEnd().split(/\s+/).at(-1) ?? "";
}

function bareWord(token: string): string {
  return token.replace(/\./g, "").replace(/^[^A-Za-z]+/, "").toLowerCase();
}

/** Decide whether the stop between two fragments ends a sentence. */
export function classifyBoundary(previous: string, next: string): Boundary {
  const token = lastToken(previous);
  if (!token.endsWith(".")) return "split";
  const word = bareWord(token);
  // Only the first word of the next fragment carries evidence. Reading the
  // whole fragment made every test match something somewhere.
  const nextToken = next.trimStart().split(/\s+/)[0] ?? "";
  const nextWord = nextToken.replace(/[^A-Za-z]/g, "").toLowerCase();
  const nextIsCapitalised = /^[^A-Za-z]*[A-Z]/.test(nextToken);
  const nextIsLowercaseName = LOWERCASE_NAMES.has(nextToken.replace(/[^A-Za-z0-9]/g, ""));
  const nextIsLowercase = /^[^A-Za-z]*[a-z]/.test(nextToken) && !nextIsLowercaseName;

  // A title is followed by a name, never by a new sentence.
  if (TITLES.has(word)) return "merge";

  // "J. Smith": an initial followed by a capitalised name. A lower-case word
  // after an initial is undecided, because "J. de Vries" is one name and
  // "See J. the results follow" is not something anyone writes.
  if (SINGLE_INITIAL.test(token)) {
    if (nextIsCapitalised && !EXCLUSIVE_STARTERS.has(nextWord)) return "merge";
    return "ambiguous";
  }

  if (INLINE_ABBREVIATIONS.has(word)) {
    // "Fig. A", "No. 3": a label, not a new sentence.
    if (/^[^A-Za-z0-9]*[A-Z0-9][^A-Za-z]*$/.test(nextToken)) return "merge";
    if (nextIsCapitalised && EXCLUSIVE_STARTERS.has(nextWord)) return "split";
    // "e.g. iOS and Android" continues the list; "etc. iOS clients failed"
    // starts a sentence. Nothing here tells the two apart.
    if (nextIsLowercaseName) return "ambiguous";
    // "packs, tiers and tables etc. Customers receive it" is two sentences;
    // "vs. Customers of the old plan" is one. Merging by default joined real
    // sentences and hid a paragraph, so an unresolved capital abstains.
    if (nextIsCapitalised) return "ambiguous";
    return "merge";
  }

  if (DOTTED_FORM.test(token)) {
    // A lower-case word continues the phrase: "U.S. policy applies".
    if (nextIsLowercase) return "merge";
    if (nextIsCapitalised && EXCLUSIVE_STARTERS.has(nextWord)) return "split";
    if (nextIsLowercaseName) return "ambiguous";
    // "e.g. 2025 and 2026" lists years; "U.S. 2025 brought change" starts a
    // sentence. A number decides nothing on its own.
    if (/^\d/.test(nextToken)) return "ambiguous";
    // "U.S. Department" continues the phrase, "U.S. Customers receive support"
    // starts a sentence, and a capitalised noun cannot tell them apart.
    if (/^[A-Z][a-z]+/.test(nextToken)) return "ambiguous";
    return "ambiguous";
  }

  return "split";
}

function segment(text: string, ambiguous: "merge" | "split"): string[] {
  const sentences: string[] = [];
  for (const fragment of text.split(/(?<=[.!?])\s+/)) {
    const previous = sentences.at(-1);
    if (previous !== undefined) {
      const verdict = classifyBoundary(previous, fragment);
      const decided = verdict === "ambiguous" ? ambiguous : verdict;
      if (decided === "merge") {
        sentences[sentences.length - 1] = `${previous} ${fragment}`;
        continue;
      }
    }
    sentences.push(fragment);
  }
  return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * The most sentences the text can hold: every ambiguous stop is a boundary.
 * Rules that punish length use this, so an unresolved stop can never inflate a
 * sentence into a violation.
 */
export function splitSentences(text: string): string[] {
  return segment(text, "split");
}

/**
 * The fewest sentences the text can hold: every ambiguous stop is joined.
 * Rules that punish sentence count use this, so an unresolved stop can never
 * manufacture an extra sentence.
 */
export function mergedSentences(text: string): string[] {
  return segment(text, "merge");
}

export function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter(Boolean).length;
}
