// Markdown block structure, read the way CommonMark describes it: each line is
// matched against the containers already open, then against any new container
// it starts, and only what remains is the leaf block a rule can measure.
//
// Seven review rounds attacked scanners that inferred structure line by line.
// Each repair fixed the shape in front of it and broke a neighbouring one,
// because a flag cannot express a quotation inside a list item, a paragraph
// that continues without its marker, or an item whose content sits four
// columns in. This is the algorithm those scanners were approximating.

import { EXCLUSIVE_STARTERS, LOWERCASE_NAMES } from "./lexicon.ts";

export interface ProseBlock {
  /** 1-indexed line number of the block's first line. */
  line: number;
  /** The block's lines, in order, with container markers removed. */
  lines: string[];
}

export interface Heading {
  level: number;
  line: number;
  text: string;
}

export interface Document {
  lines: string[];
  /** True when the line is metadata or fenced code, which no rule reads. */
  hidden: (index: number) => boolean;
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const QUOTE_MARKER = /^ {0,3}>[ \t]?/;
// A marker with no content is still a marker: "-" on its own opens an empty
// item, and reading it as text put a hyphen into the sentence below it.
const LIST_MARKER = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const TASK_MARKER = /^\[[ xX]\][ \t]+/;
const TABLE_DIVIDER = /^\|?[\s:|-]*-[\s:|-]*\|?$/;
// GitHub renders "> [!WARNING]" as an alert. The marker is a label, not a
// sentence, so it is skipped while the warning beneath it is measured.
// Markup a reader never meets. A comment, a declaration or a processing
// instruction interrupts a paragraph, as CommonMark says an HTML block
// does. A link reference definition cannot interrupt one, so it counts
// only where a paragraph is not already open. A footnote body is visible,
// which is why its label starts with "^" and it is not here.
const INVISIBLE_MARKUP = /^ {0,3}(?:<!--|<!|<\?)/;
// A definition is a label, a colon, a destination, and an optional title.
// Matching the label alone removed "[Question]: The supplier shall comply."
// from the document, and a reader reads that as a sentence.
const LINK_DEFINITION = /^ {0,3}\[[^\]^][^\]]*\]:[ \t]*(?:<[^>]*>|[^ \t]+)[ \t]*(?:['"(][^'")]*['")])?[ \t]*$/;
// A definition's title may sit on its own line beneath it.
const DEFINITION_TITLE = /^ {0,3}['"(][^'")]*['")][ \t]*$/;
const ALERT_MARKER = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i;

/**
 * Split text into lines the way a reader sees them.
 *
 * Splitting on /\r?\n/ alone left a bare-carriage-return document as one line,
 * so a heading prefix swallowed every sentence after it. A leading byte order
 * mark is removed for the same reason: it made the first line something other
 * than "---", so front matter was not recognised.
 */
export function toLines(text: string): string[] {
  return text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
}

/** Expand tabs to four-column stops, as CommonMark measures indentation. */
function expandTabs(line: string): string {
  let out = "";
  for (const character of line) {
    if (character !== "\t") {
      out += character;
      continue;
    }
    out += " ".repeat(4 - (out.length % 4));
  }
  return out;
}

/**
 * The lines a document devotes to front matter, or none.
 *
 * The delimiter sits at column 0, because an indented "---" inside a YAML
 * block scalar once closed the block early and hid the whole document body.
 * Jekyll closes with "..." as well as "---".
 */
export function frontMatterRange(lines: string[]): { start: number; end: number } | null {
  if (!/^---[ \t]*$/.test(lines[0] ?? "")) return null;
  const closing = lines.findIndex(
    (line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line),
  );
  if (closing === -1) return null;
  // Every line between the delimiters must look like YAML. Without this, a
  // document opening with a thematic break lost everything down to the next
  // one: "---", a paragraph a reader reads, "---" hid the paragraph.
  const yaml = lines.slice(1, closing).every((line) =>
    line.trim() === ""
    || /^[ \t]/.test(line)
    || /^#/.test(line.trim())
    || /^- /.test(line.trim())
    // A key may be quoted, and it may be written in any language.
    || /^(?:['"][^'"]*['"]|[^:\s]+)[ \t]*:( |$)/.test(line));
  return yaml ? { start: 0, end: closing } : null;
}

function indentOf(line: string): number {
  return (/^ */.exec(line)?.[0] ?? "").length;
}

/** The columns a table row declares, respecting escaped pipes. */
function cellCount(row: string): number {
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

/** True when every divider cell is hyphens, with optional colons. */
function isDividerRow(row: string): boolean {
  if (!TABLE_DIVIDER.test(row) || !row.includes("-")) return false;
  // A line that starts a list item is a list item. GitHub agrees: it
  // renders "A | B" above "- | -" as a paragraph and a list.
  if (LIST_MARKER.test(row)) return false;
  const inner = row.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/** True when the line begins a block, which ends any table above it. */
function startsBlock(line: string): boolean {
  return /^ {0,3}<[a-zA-Z/!?]/.test(line)
    || /^ {0,3}#{1,6}[ \t]/.test(line)
    || /^ {4}/.test(line)
    || THEMATIC_BREAK.test(line);
}

interface Container {
  kind: "quote" | "item";
  /** For an item, the column its content starts at. */
  column: number;
}

interface Parsed {
  paragraphs: ProseBlock[];
  headings: Heading[];
  /** Front matter and fenced code: lines no rule reads. */
  hidden: Set<number>;
  /** Table lines: structure, but rules about tables still read them. */
  tables: Set<number>;
}

/**
 * Match a line against the containers already open.
 *
 * Returns the text left after the markers that matched, and how many of them
 * did. A line that matches fewer than all of them has left some container,
 * unless it is a lazy continuation of a paragraph inside one.
 */
function matchOpen(line: string, stack: Container[]): { rest: string; matched: number } {
  let rest = line;
  let matched = 0;
  for (const container of stack) {
    if (container.kind === "quote") {
      const marker = QUOTE_MARKER.exec(rest);
      if (marker === null) break;
      rest = rest.slice(marker[0].length);
      matched++;
      continue;
    }
    if (rest.trim() === "") {
      // A blank line does not end a list item.
      matched++;
      continue;
    }
    if (indentOf(rest) >= container.column) {
      rest = rest.slice(container.column);
      matched++;
      continue;
    }
    break;
  }
  return { rest, matched };
}

/**
 * The list marker starting this line, if one may start here.
 *
 * CommonMark lets an ordered list interrupt a paragraph only when it starts at
 * 1, which is what keeps a hard-wrapped "2024." part of the sentence above it.
 * Five or more spaces after a marker begin indented code inside the item, so
 * the content column is the marker plus one space.
 */
function listMarkerAt(line: string, midParagraph: boolean): { length: number; column: number } | null {
  const marker = LIST_MARKER.exec(line);
  if (marker === null) return null;
  // A marker with no content cannot interrupt a paragraph: CommonMark
  // requires a non-blank first line for a list to do that.
  if (midParagraph && line.slice(marker[0].length).trim() === "") return null;
  const ordered = /^\d/.test(marker[2]);
  if (midParagraph && (!ordered || marker[2].slice(0, -1) !== "1")) {
    // A bullet may interrupt a paragraph; an ordered marker may not unless it
    // is 1. Both rules protect wrapped lines from being read as lists.
    if (ordered) return null;
  }
  const spaces = marker[3].length;
  // Five or more spaces after a marker begin indented code inside the item, so
  // only one of them belongs to the marker and the rest stay as indentation.
  const consumed = spaces > 4 ? marker[1].length + marker[2].length + 1 : marker[0].length;
  const column = marker[1].length + marker[2].length + (spaces > 4 ? 1 : spaces);
  return { length: consumed, column };
}

/** True when the text starts a block, so it cannot lazily continue a paragraph. */
function startsAnyBlock(text: string): boolean {
  return ATX_HEADING.test(text)
    || THEMATIC_BREAK.test(text)
    || FENCE_OPEN.test(text)
    || QUOTE_MARKER.test(text)
    || LIST_MARKER.test(text);
}

function parse(lines: string[]): Parsed {
  const paragraphs: ProseBlock[] = [];
  const found: Heading[] = [];
  const hidden = new Set<number>();
  const tables = new Set<number>();
  const stack: Container[] = [];
  const frontMatter = frontMatterRange(lines);

  let paragraph: ProseBlock | null = null;
  let paragraphDepth = 0;
  let fence: { char: string; length: number } | null = null;
  let tableUntil = -1;
  let invisibleUntil: string | null = null;
  let definedAbove = false;

  const closeParagraph = (): void => {
    paragraph = null;
  };

  for (let i = 0; i < lines.length; i++) {
    if (frontMatter !== null && i <= frontMatter.end) {
      hidden.add(i);
      closeParagraph();
      continue;
    }
    if (i <= tableUntil) continue;

    const line = expandTabs(lines[i]);
    if (invisibleUntil !== null) {
      if (line.includes(invisibleUntil)) invisibleUntil = null;
      continue;
    }
    const { rest, matched } = matchOpen(line, stack);
    const allMatched = matched === stack.length;

    if (fence !== null) {
      if (allMatched) {
        hidden.add(i);
        const closing = FENCE_OPEN.exec(rest);
        if (closing !== null
          && closing[2][0] === fence.char
          && closing[2].length >= fence.length
          && closing[3].trim() === "") {
          fence = null;
        }
        continue;
      }
      // The container holding the fence has ended, so the fence has too.
      fence = null;
      stack.length = matched;
    }

    if (rest.trim() === "") {
      closeParagraph();
      if (!allMatched) stack.length = matched;
      continue;
    }

    // A paragraph continues without its markers repeated. Without this, a
    // wrapped quotation or list item became a second block, and the advice
    // about the paragraph a reader sees never arrived.
    const lazy = !allMatched && paragraph !== null && !startsAnyBlock(rest);
    let text = rest;
    let openedQuote = false;
    if (!lazy) {
      if (!allMatched) {
        closeParagraph();
        stack.length = matched;
      }
      for (;;) {
        const quote = QUOTE_MARKER.exec(text);
        if (quote !== null) {
          closeParagraph();
          text = text.slice(quote[0].length);
          stack.push({ kind: "quote", column: 0 });
          openedQuote = true;
          continue;
        }
        // A thematic break outranks a list marker, so "- - -" is a rule across
        // the page rather than a bullet holding two more bullets. A setext
        // underline outranks it too, so a lone "-" under a paragraph is that
        // paragraph's underline rather than an empty item.
        const underlines = paragraph !== null && SETEXT_UNDERLINE.test(text);
        const marker = THEMATIC_BREAK.test(text) || underlines
          ? null
          : listMarkerAt(text, paragraph !== null);
        if (marker !== null) {
          closeParagraph();
          const consumed = text.slice(0, marker.length);
          text = text.slice(marker.length).replace(TASK_MARKER, "");
          stack.push({ kind: "item", column: indentOf(consumed) + marker.column - indentOf(consumed) });
          continue;
        }
        break;
      }
    }

    // The label opens an alert only as a quotation's first line. Elsewhere it
    // is ordinary text, and skipping it split a paragraph in two.
    // The label opens an alert, so it is only a label on the line that opens
    // the quotation. Later inside the same quotation GitHub renders it as
    // ordinary text, and a reader meets it as a word.
    if (openedQuote && stack.length === 1 && ALERT_MARKER.test(text.trim())) {
      continue;
    }

    if (INVISIBLE_MARKUP.test(text)) {
      closeParagraph();
      // A comment runs until it closes, and every line of it is invisible.
      if (text.startsWith("<!--") && !text.includes("-->")) invisibleUntil = "-->";
      continue;
    }
    if (paragraph === null && LINK_DEFINITION.test(text)) {
      definedAbove = true;
      continue;
    }
    if (definedAbove && DEFINITION_TITLE.test(text)) continue;
    definedAbove = false;

    const fenceOpen = FENCE_OPEN.exec(text);
    if (fenceOpen !== null
      && !(fenceOpen[2][0] === "`" && fenceOpen[3].includes("`"))) {
      closeParagraph();
      fence = { char: fenceOpen[2][0], length: fenceOpen[2].length };
      hidden.add(i);
      continue;
    }

    const atx = ATX_HEADING.exec(text);
    if (atx !== null) {
      closeParagraph();
      found.push({
        level: atx[1].length,
        line: i + 1,
        text: visibleText((atx[2] ?? "").replace(/\s+#+\s*$/, "").trim()),
      });
      continue;
    }

    const underline = SETEXT_UNDERLINE.exec(text);
    if (underline !== null && !lazy && paragraph !== null && paragraphDepth === stack.length) {
      // The paragraph above becomes the heading's text, all of its lines.
      found.push({
        level: underline[1][0] === "=" ? 1 : 2,
        line: paragraph.line,
        text: visibleText(paragraph.lines.join(" ").trim()),
      });
      paragraphs.splice(paragraphs.indexOf(paragraph), 1);
      closeParagraph();
      continue;
    }

    if (THEMATIC_BREAK.test(text)) {
      closeParagraph();
      continue;
    }

    // Indented code cannot interrupt a paragraph, so four columns past the
    // container is code only where a paragraph is not already open.
    if (paragraph === null && indentOf(text) >= 4) continue;

    const divider = nextContent(lines, i, stack);
    if (divider !== null
      && text.includes("|")
      && isDividerRow(divider.trim())
      && cellCount(text.trim()) === cellCount(divider.trim())) {
      closeParagraph();
      tables.add(i);
      tables.add(i + 1);
      let row = i + 2;
      for (; row < lines.length; row++) {
        const content = nextContent(lines, row - 1, stack);
        if (content === null || !content.includes("|") || startsBlock(content)) break;
        tables.add(row);
      }
      tableUntil = row - 1;
      continue;
    }

    if (paragraph === null) {
      paragraph = { line: i + 1, lines: [] };
      paragraphDepth = stack.length;
      paragraphs.push(paragraph);
    }
    paragraph.lines.push(withoutTags(text).trimStart());
  }

  return { paragraphs, headings: found, hidden, tables };
}

/** The next line's text, with the same containers stripped, or none. */
function nextContent(lines: string[], index: number, stack: Container[]): string | null {
  const next = lines[index + 1];
  if (next === undefined) return null;
  const { rest, matched } = matchOpen(expandTabs(next), stack);
  return matched === stack.length ? rest : null;
}

/**
 * Remove HTML tags, and only those.
 *
 * A generic "<...>" swallowed an autolink, which a reader sees as a link,
 * and the words between "< 5" and "> 2" in ordinary prose. A tag starts
 * with a letter or a slash, and an attribute may hold a greater-than sign.
 */
function withoutTags(text: string): string {
  const tag = /<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+(?:[^>"']|"[^"]*"|'[^']*')*)?\/?>/g;
  return text.replace(tag, " ");
}

function visibleText(text: string): string {
  return withoutTags(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

/** Collect prose paragraphs: what a reader reads as sentences. */
export function proseBlocks(text: string): ProseBlock[] {
  return parse(toLines(text)).paragraphs;
}

/** Heading levels with their 1-indexed line numbers. */
export function headings(text: string): Heading[] {
  return parse(toLines(text)).headings;
}

/**
 * Read a document once, for the rules that work line by line.
 *
 * They skip metadata and code, and deliberately not tables: a rule about
 * links, images or table headings has to look at a table to do its job.
 */
export function readDocument(text: string): Document {
  const lines = toLines(text);
  const parsed = parse(lines);
  return { lines, hidden: (index) => parsed.hidden.has(index) };
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
