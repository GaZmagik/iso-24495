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

// A pipe is not in this list. Table rows are recognised by tableLines, which
// requires a header and a matching divider, so a line that merely begins with a
// pipe is the ordinary text GitHub renders it as. Excluding it here dropped
// "| Important note: the supplier shall comply." from the document in silence.
const NON_PROSE_PREFIX = /^(#{1,6}[ \t]|[-*+][ \t]|\d{1,9}[.)][ \t]|>)/;
// CommonMark lets an ordered list interrupt a paragraph only when it starts at
// 1, which exists to protect hard-wrapped numbers. Without that rule, a line
// continuing "The system was updated in" with "2024. The supplier shall
// respond." became a list item and its sentence left the document. A marker of
// ten digits or more is not a list marker at all.
const ORDERED_MARKER = /^(\d{1,9})[.)][ \t]/;

/** True when the line begins a block rather than continuing a paragraph. */
function startsStructure(line: string, midParagraph: boolean): boolean {
  // Only ASCII space and tab indent a block. Trimming every Unicode space
  // made a non-breaking space before ">" a blockquote, which GitHub renders
  // as ordinary text, so the sentence left the document.
  const trimmed = line.replace(/^[ \t]+/, "");
  const ordered = ORDERED_MARKER.exec(trimmed);
  if (ordered !== null) return !midParagraph || ordered[1] === "1";
  return NON_PROSE_PREFIX.test(trimmed);
}
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
/**
 * Split text into lines the way a reader sees them.
 *
 * Splitting on /\r?\n/ alone left a bare-carriage-return document as one line,
 * so a heading prefix swallowed every sentence after it. A leading byte order
 * mark is removed for the same reason: it made the first line something other
 * than "---", so front matter was not recognised and its contents opened fence
 * state instead.
 */
export function toLines(text: string): string[] {
  return text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * The lines a document devotes to fenced code.
 *
 * Toggling on any line that starts with three backticks or tildes ignored what
 * CommonMark actually requires, and each mistake hid visible text: a
 * four-space-indented marker opened a fence that never legitimately opened, a
 * tilde run closed a backtick fence, and a short run closed a longer one. A
 * fence closes only with the same character, at least as long as its opener.
 */
function fencedLines(lines: string[], from: number): Set<number> {
  const fenced = new Set<number>();
  let open: { char: string; length: number } | null = null;
  // A fence inside a list item is indented to the item's content, which is
  // usually four spaces and always more than the three a top-level fence may
  // have. Reading those as ordinary text produced findings against sample code:
  // "shall" in an example, and a "click here" written to show what not to write.
  let listIndent = 0;
  for (let i = from; i < lines.length; i++) {
    // At most three spaces before a quote marker: four is indented code, and
    // stripping it turned "    > ```" into a fence that hid the document.
    let after: string;
    const raw = lines[i].replace(/^(?: {0,3}>[ \t]?)+/, "");
    if (open === null) {
      const item = /^( {0,3})([-*+]|\d{1,9}[.)])( +)/.exec(raw);
      // The content column is where the item's text starts, so an ordered
      // marker earns more room than a bullet. A blank line does not end a list
      // item, but a non-blank line at the left margin does.
      if (item !== null) {
        // Up to four spaces after a marker set the content column. Five or
        // more make indented code inside the item, so a fence there is not
        // a fence, and treating it as one hid the prose beneath it.
        // Up to four spaces after a marker set the content column. Five or
        // more make indented code inside the item, so a fence written there
        // is not a fence at all.
        const indented = item[3].length > 4;
        listIndent = item[1].length + item[2].length + (indented ? 1 : item[3].length);
        // A fence may be the item's first content: "1. ```md" opens one. The
        // marker has to go, or the real closing fence becomes an opener and
        // everything after it disappears.
        if (!indented) after = raw.slice(item[0].length);
      }
      else if (raw.trim() !== "" && !/^ /.test(raw)) listIndent = 0;
    }
    after = after ?? raw;
    const indent = /^ */.exec(after)?.[0].length ?? 0;
    const match = FENCE_OPEN.exec(indent > 3 && indent <= listIndent + 3
      ? after.slice(indent - 3)
      : after);
    if (open === null) {
      // An info string on a backtick fence cannot itself contain a backtick.
      if (match === null || (match[2][0] === "`" && match[3].includes("`"))) continue;
      open = { char: match[2][0], length: match[2].length };
      fenced.add(i);
      continue;
    }
    fenced.add(i);
    if (match !== null
      && match[2][0] === open.char
      && match[2].length >= open.length
      && match[3].trim() === "") {
      open = null;
    }
  }
  return fenced;
}

export function frontMatterRange(lines: string[]): { start: number; end: number } | null {
  // The delimiter sits at column 0. Matching a trimmed line let an indented
  // "---" inside a YAML block scalar close the block early, which left a code
  // fence outside it and hid the whole document body.
  const isOpen = (line: string | undefined): boolean => /^---[ \t]*$/.test(line ?? "");
  // Jekyll closes a block with "..." as well as "---", and a block left
  // open hands its contents to the fence scanner, which hides the body.
  const isClose = (line: string): boolean => /^(?:---|\.\.\.)[ \t]*$/.test(line);
  if (!isOpen(lines[0])) return null;
  const closing = lines.findIndex((line, index) => index > 0 && isClose(line));
  return closing === -1 ? null : { start: 0, end: closing };
}

// A rule across the page, not a word in a sentence. Table detection used to
// remove these by accident; once it stopped, "---" joined the sentence beneath
// it and added a token, which turned a 30-word sentence into a false finding.
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * True when the line begins another block, which ends any table above it.
 *
 * Stopping only at HTML and blank lines let a table swallow the paragraph
 * after a heading: GitHub ends a table at a heading, a break, or indented
 * code, and the sentence left the document with no finding against it.
 */
function startsBlock(line: string): boolean {
  return /^ {0,3}<[a-zA-Z/!?]/.test(line)
    || /^ {0,3}#{1,6}[ \t]/.test(line)
    || /^ {4}/.test(line)
    || THEMATIC_BREAK.test(line);
}

/** True when every divider cell is a run of hyphens with optional colons. */
function isDividerRow(row: string): boolean {
  const inner = row.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/** The columns a table row declares, ignoring optional outer pipes. */
function cellCount(row: string): number {
  // A backslash escapes the next character, another backslash included, so
  // two of them leave the pipe that follows as a real column boundary.
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "\\" && i + 1 < row.length) {
      cell += row.slice(i, i + 2);
      i++;
      continue;
    }
    if (row[i] === "|") {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += row[i];
  }
  cells.push(cell);
  if (cells[0].trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.length;
}

/**
 * The lines a document devotes to tables.
 *
 * A table begins where a header row sits directly above a divider, and runs
 * until a line without a pipe. Inferring a row from a neighbouring pipe swallowed
 * ordinary prose: "## Compare A | B" above "The supplier shall respond | today."
 * removed the second line from the document entirely, and silent removal is
 * worse than a wrong finding because nobody sees it happen.
 */
function tableLines(lines: string[], skip: (index: number) => boolean): Set<number> {
  const table = new Set<number>();
  for (let i = 0; i < lines.length - 1; i++) {
    if (skip(i) || table.has(i)) continue;
    const header = lines[i].trim();
    const divider = lines[i + 1].trim();
    if (!header.includes("|") || !TABLE_DIVIDER.test(divider) || !divider.includes("-")) continue;
    // GitHub renders a table only when the two rows agree on the column count.
    // Without this, "A | B | C" above "---|---" claimed three lines of prose
    // and the reader's sentence vanished with no finding against it.
    if (cellCount(header) !== cellCount(divider) || !isDividerRow(divider)) continue;
    table.add(i);
    table.add(i + 1);
    for (let row = i + 2; row < lines.length; row++) {
      // A table ends where another block begins, HTML included, and not only
      // at a blank line. An HTML paragraph was being claimed as a row.
      if (skip(row) || !lines[row].includes("|") || startsBlock(lines[row])) break;
      table.add(row);
    }
  }
  return table;
}
interface Structure {
  frontMatter: { start: number; end: number } | null;
  fenced: Set<number>;
  tables: Set<number>;
  /** True when the line is metadata, code, or a table, rather than text. */
  skip: (index: number) => boolean;
}

/**
 * Read a document's structure once, so the scanners cannot disagree about it.
 *
 * They each kept their own front matter and fence state, and every round of
 * review found another place where two of them reached different answers and a
 * reader lost text with nothing to show for it.
 */
function structureOf(lines: string[]): Structure {
  const frontMatter = frontMatterRange(lines);
  const fenced = fencedLines(lines, frontMatter === null ? 0 : frontMatter.end + 1);
  const inMetadataOrCode = (index: number): boolean =>
    (frontMatter !== null && index <= frontMatter.end) || fenced.has(index);
  const tables = tableLines(lines, inMetadataOrCode);
  return {
    frontMatter,
    fenced,
    tables,
    skip: (index) => inMetadataOrCode(index) || tables.has(index),
  };
}

const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
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

function scanHeadings(lines: string[], structure: Structure): HeadingScan {
  const { tables } = structure;
  const found: Heading[] = [];
  const structuralLines = new Set<number>();
  const { frontMatter, fenced } = structure;
  for (let i = 0; i < lines.length; i++) {
    if ((frontMatter !== null && i <= frontMatter.end) || fenced.has(i)) continue;

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
    // A table row is not a paragraph line, so it cannot be a heading's
    // text. Reading one as a heading filled the gap between an h1 and an
    // h3, and the real heading-skip was never reported.
    if (tables.has(i - 1)) continue;
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
    // A setext heading is the whole paragraph above its underline, not the last
    // line of it. Taking one line let a fourteen-word heading split into a
    // seven-word heading and a line of prose, so heading-style never fired.
    let first = i - 1;
    while (first > 0) {
      const above = lines[first - 1];
      const aboveTrimmed = above.trimStart();
      if (tables.has(first - 1)
        || above.trim() === ""
        || /^ {4}/.test(above)
        || NON_PROSE_PREFIX.test(aboveTrimmed)
        || THEMATIC_BREAK.test(above)
        || ATX_HEADING.test(above)
        || /^(```|~~~)/.test(aboveTrimmed)
        || SETEXT_UNDERLINE.test(above)) {
        break;
      }
      first--;
    }
    const paragraph = lines.slice(first, i).map((line) => line.trim()).join(" ");
    found.push({
      level: underline[1][0] === "=" ? 1 : 2,
      // A heading starts where its text starts, which is where a reader
      // looks when the advice names a line.
      line: first + 1,
      text: visibleHeadingText(paragraph),
    });
    for (let line = first; line <= i; line++) structuralLines.add(line);
  }
  return { found, structuralLines };
}

/** Collect prose paragraphs, skipping headings, lists, tables, quotes, and fenced code. */
export function proseBlocks(text: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let current: ProseBlock | null = null;
  const lines = toLines(text);
  // Front matter is metadata, code is code, and a table is a grid. None of the
  // three is a sentence, and all three are decided once, before any rule runs.
  const structure = structureOf(lines);
  const headingLines = scanHeadings(lines, structure).structuralLines;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (structure.skip(i)) {
      current = null;
      continue;
    }
    // Test the trimmed line: list markers and quotes are structure at ANY
    // indentation. Testing the raw line made nested bullets count as prose,
    // which merged them into giant fake sentences and biased the average.
    // A setext underline is already a heading line, so anything left that looks
    // like a break is one.
    if (headingLines.has(i)
      || THEMATIC_BREAK.test(line)
      || line.trim() === ""
      || startsStructure(line, current !== null)) {
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
  const lines = toLines(text);
  return scanHeadings(lines, structureOf(lines)).found;
}

export interface Document {
  lines: string[];
  /**
   * True when the line is metadata or fenced code.
   *
   * Not tables: a rule about links, images or table headings has to look at a
   * table to do its job, and `table-header` fell silent for every table on the
   * day it was given the block scanners' predicate instead of this one.
   */
  hidden: (index: number) => boolean;
}

/**
 * Read a document once, for the rules that work line by line.
 *
 * Three rules split the text themselves and kept their own fence state, so the
 * normalisation and the fence rules the block scanners follow never reached
 * them. A bare carriage return put an image finding on the wrong line, and a
 * table finding disappeared entirely.
 */
export function readDocument(text: string): Document {
  const lines = toLines(text);
  const structure = structureOf(lines);
  return {
    lines,
    hidden: (index) => (structure.frontMatter !== null && index <= structure.frontMatter.end)
      || structure.fenced.has(index),
  };
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
