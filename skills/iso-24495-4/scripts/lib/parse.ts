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

/**
 * Read a document once, for the rules that work line by line.
 *
 * They skip metadata and code, and deliberately not tables: a rule about
 * links, images or table headings has to look at a table to do its job.
 *
 * @returns `lines` and `markupLines` hold one entry for each source line, so
 *     index 0 is line 1. A line a reader never sees is blank in both.
 *     `markupLines` keeps HTML tags and `lines` does not. `hidden` takes such
 *     an index and is true for front matter and code. `references` holds
 *     each defined label as `normaliseReference` gives it. Empty text gives
 *     one empty line.
 */
export function readDocument(text: string, reading: Reading = {}): Document {
  const lines = toLines(text);
  const parsed = parse(lines, reading);
  return {
    lines: parsed.readable.map((line) => visibleInline(line, false)),
    markupLines: parsed.markup,
    references: parsed.references,
    hidden: (index) => parsed.hidden.has(index),
  };
}

export interface ProseBlock {
  /** 1-indexed line number of the block's first line. */
  line: number;
  /** The block's lines, in order, with container markers removed. */
  lines: string[];
}

/**
 * Where one link or image label sits in text whose links were replaced by
 * their labels: the offset of its first character, and the offset just past
 * its last.
 */
export interface LabelRange {
  start: number;
  end: number;
}

/** A block of reader text, with where each link label sits in it. */
export interface LabelledBlock extends ProseBlock {
  /**
   * Every label that stands in place of its link or image, as offsets into
   * the lines joined by line breaks. A label inside another label is listed
   * too. The order is not defined.
   */
  labels: LabelRange[];
}

export interface Heading {
  level: number;
  line: number;
  text: string;
  /** How many source lines the text spans: a setext heading's text can wrap. */
  lines: number;
  /** True when an underline on the line after the text makes this a heading. */
  setext: boolean;
}

/** How a document is read, where the place it is shown decides. */
export interface Reading {
  /**
   * Whether a leading "---" block is front matter, excluded from prose checks.
   * A file in a repository may carry it, so that is the default. A pull request
   * description cannot, and GitHub shows the block as a rule and a heading, so the
   * check that reads a description passes false and the block is read as text.
   */
  frontMatter?: boolean;
}

export interface Document {
  lines: string[];
  /** Reader-visible markup retained for rules about links and images. */
  markupLines: string[];
  /** Normalised reference labels that have valid definitions. */
  references: ReadonlySet<string>;
  /** True when the line is metadata or fenced code, excluded from prose checks. */
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
const BLOCK_INVISIBLE_OPEN = /^ {0,3}(?:<!--|<\?|<![A-Z])/;
const ALERT_MARKER = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i;

/**
 * A conservative single-line link reference definition.
 *
 * CommonMark permits more forms across lines. Keeping those visible can add a
 * finding, while accepting a malformed definition removes a sentence without
 * telling its writer. This parser therefore recognises only forms whose label,
 * destination and optional title are complete on one line.
 */
function isLinkDefinition(line: string): boolean {
  const start = /^ {0,3}\[/.exec(line);
  if (start === null) return false;
  let index = start[0].length;
  let label = "";
  while (index < line.length) {
    if (line[index] === "\\" && index + 1 < line.length) {
      label += line.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (line[index] === "]") break;
    if (line[index] === "[") return false;
    label += line[index];
    index++;
  }
  if (line[index] !== "]" || line[index + 1] !== ":") return false;
  if (label.trim() === "" || label.startsWith("^") || label.length > 999) return false;
  index += 2;
  while (line[index] === " ") index++;

  if (line[index] === "<") {
    index++;
    let closed = false;
    while (index < line.length) {
      if (line[index] === "\\" && index + 1 < line.length && ESCAPABLE.test(line[index + 1])) {
        index += 2;
        continue;
      }
      if (line[index] === "<") return false;
      if (line[index] === ">") {
        index++;
        closed = true;
        break;
      }
      index++;
    }
    if (!closed) return false;
  } else {
    const destinationStart = index;
    let depth = 0;
    while (index < line.length && line[index] !== " " && line[index] !== "\t") {
      if (line[index] === "\\" && index + 1 < line.length && ESCAPABLE.test(line[index + 1])) {
        index += 2;
        continue;
      }
      if (line[index] === "(") depth++;
      if (line[index] === ")") depth--;
      if (depth < 0 || depth > 32) return false;
      index++;
    }
    if (index === destinationStart || depth !== 0) return false;
  }

  if (index === line.length) return true;
  if (line[index] !== " ") return false;
  while (line[index] === " ") index++;
  if (index === line.length) return true;

  const opening = line[index];
  const closing = opening === "(" ? ")" : opening;
  if (opening !== "\"" && opening !== "'" && opening !== "(") return false;
  index++;
  while (index < line.length && line[index] !== closing) index++;
  if (line[index] !== closing) return false;
  index++;
  while (line[index] === " ") index++;
  return index === line.length;
}

/**
 * Split text into lines the way a reader sees them.
 *
 * Splitting on /\r?\n/ alone left a bare-carriage-return document as one line,
 * so a heading prefix swallowed every sentence after it. A leading byte order
 * mark is removed for the same reason: it made the first line something other
 * than "---", so front matter was not recognised.
 *
 * @returns The lines without their endings. There is always at least one:
 *     empty text gives a single empty line.
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
 *
 * @param lines The document as `toLines` returns it.
 * @returns The indexes of the opening and closing delimiter lines, counted
 *     from 0, so `start` is always 0. Null when the first line is not "---",
 *     when nothing closes the block, or when a line inside it does not look
 *     like YAML.
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

/**
 * The columns a table row declares, respecting escaped pipes.
 *
 * @param row One line of a table, trimmed by the caller.
 * @returns The text of each cell as written: untrimmed, with an escaped pipe
 *     still behind its backslash. The empty cell that an outer pipe leaves at
 *     either end is dropped. A row with no pipe is one cell, and an empty row
 *     is no cells.
 */
export function tableCells(row: string): string[] {
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
  return cells;
}

function cellCount(row: string): number { return tableCells(row).length; }

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
  unordered?: boolean;
  listId?: number;
  marker?: string;
  /** For an item, the column its content starts at. */
  column: number;
}

interface Parsed {
  paragraphs: ProseBlock[];
  headings: Heading[];
  /** Where the link labels sit in the text of each heading, in the order of `headings`. */
  headingLabels: LabelRange[][];
  /** Front matter and fenced code: lines no rule reads. */
  hidden: Set<number>;
  /** Table lines: structure, but rules about tables still read them. */
  tables: Set<number>;
  /** Source lines with invisible markup removed for line-based rules. */
  readable: string[];
  /** Reader-visible source with HTML tags retained. */
  markup: string[];
  /** Valid link reference labels in this document. */
  references: Set<string>;
  destinations: Map<string, string>;
  rootLines: Set<number>;
  navigationLines: Set<number>;
  rootHeadingLines: Set<number>;
  items: Array<{ line: number; depth: number }>;
  blocks: Map<number, { id: number; kind: "paragraph" | "list" | "table"; data: boolean }>;
  tableRows: Map<number, string[]>;
}

/**
 * A link reference label in the form two labels are compared in.
 *
 * Use it on a label before looking it up in `Document.references` or in the
 * `destinations` that `structure` returns, whose keys are in this form.
 *
 * @param label The text between the square brackets, as written.
 * @returns The label with backslash escapes resolved, the ends trimmed, each
 *     run of white space made one space, and every letter in lower case.
 *     Empty for a blank label.
 */
export function normaliseReference(label: string): string {
  return label.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1")
    .trim().replace(/\s+/g, " ").toLowerCase();
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

function parse(lines: string[], reading: Reading = {}, structural = false): Parsed {
  const paragraphs: ProseBlock[] = [];
  const found: Heading[] = [];
  const hidden = new Set<number>();
  const tables = new Set<number>();
  const readable = [...lines];
  const markup = [...lines];
  const references = new Set<string>();
  const destinations = new Map<string, string>();
  const rootLines = new Set<number>();
  const navigationLines = new Set<number>();
  const rootHeadingLines = new Set<number>();
  const items: Array<{ line: number; depth: number }> = [];
  const blocks = new Map<number, { id: number; kind: "paragraph" | "list" | "table"; data: boolean }>();
  const tableRows = new Map<number, string[]>();
  const stack: Container[] = [];
  const frontMatter = reading.frontMatter === false ? null : frontMatterRange(lines);

  let paragraph: ProseBlock | null = null;
  let paragraphDepth = 0;
  let fence: { char: string; length: number } | null = null;
  let tableUntil = -1;
  let invisible: { until: string; depth: number } | null = null;
  let rawCode: { closing: RegExp; depth: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (frontMatter !== null && i <= frontMatter.end) {
      hidden.add(i);
      readable[i] = "";
      markup[i] = "";
      paragraph = null;
      continue;
    }
    if (i <= tableUntil) continue;

    const line = expandTabs(lines[i]);
    const { rest, matched } = matchOpen(line, stack);
    const allMatched = matched === stack.length;
    let text = rest;

    if (rawCode !== null) {
      if (matched < rawCode.depth) rawCode = null;
      else {
        if (rawCode.closing.test(text)) rawCode = null;
        readable[i] = "";
        markup[i] = "";
        paragraph = null;
        continue;
      }
    }

    if (invisible !== null) {
      if (matched < invisible.depth) {
        // An HTML block cannot escape the quotation or list item that owns it.
        // Carrying its close marker past that boundary hid ordinary margin text.
        invisible = null;
        paragraph = null;
        stack.length = matched;
      } else {
        const outside = withoutInvisible(text, invisible.until);
        if (outside.until !== null) {
          readable[i] = "";
          markup[i] = "";
          continue;
        }
        invisible = null;
        text = outside.text;
        readable[i] = text;
        markup[i] = text;
        if (text.trim() === "") {
          paragraph = null;
          continue;
        }
      }
    }

    if (fence !== null) {
      if (allMatched) {
        hidden.add(i);
        readable[i] = "";
        markup[i] = "";
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
      paragraph = null;
      if (!allMatched) stack.length = matched;
      continue;
    }

    // A paragraph continues without its markers repeated. Without this, a
    // wrapped quotation or list item became a second block, and the advice
    // about the paragraph a reader sees never arrived.
    const lazy = !allMatched && paragraph !== null && !startsAnyBlock(rest);
    let openedQuote = false;
    const previousItem = stack[matched];
    if (!lazy) {
      if (!allMatched) {
        paragraph = null;
        stack.length = matched;
      }
      for (;;) {
        const quote = QUOTE_MARKER.exec(text);
        if (quote !== null) {
          paragraph = null;
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
          paragraph = null;
          const consumed = text.slice(0, marker.length);
          text = text.slice(marker.length).replace(TASK_MARKER, "");
          const unordered = /^ {0,3}[-*+]/.test(consumed);
          const family = consumed.trim().replace(/\d+/g, "");
          const listId = stack.length === matched && previousItem?.kind === "item" && previousItem.marker === family ? previousItem.listId : i;
          stack.push({ kind: "item", column: indentOf(consumed) + marker.column - indentOf(consumed), unordered, listId, marker: family });
          if (unordered) items.push({ line: i + 1, depth: stack.filter(container => container.unordered).length });
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

    if (BLOCK_INVISIBLE_OPEN.test(text)) {
      const outside = withoutInvisible(text, null);
      text = outside.text;
      // The block belongs to its current containers. If they end before its
      // closing marker, visible text outside them must not disappear with it.
      if (outside.until !== null) {
        invisible = { until: outside.until, depth: stack.length };
      }
      readable[i] = text;
      markup[i] = text;
      // Invisible markup interrupts a paragraph, so the halves stay separate.
      paragraph = null;
      if (text.trim() === "") continue;
    }
    // Structural rules exclude raw HTML code specimens. The calibrated reading stays unchanged.
    const rawOpen = structural ? /^ {0,3}<(pre|script|style|textarea)(?=[\s>])/i.exec(text) : null;
    if (rawOpen !== null) {
      const closing = new RegExp(`</${rawOpen[1]}\\s*>`, "i");
      if (!closing.test(text)) rawCode = { closing, depth: stack.length };
      readable[i] = "";
      markup[i] = "";
      paragraph = null;
      continue;
    }
    // A tab is structural indentation, not link-definition whitespace. The
    // expanded line cannot preserve that distinction, so the safe reading is
    // visible prose rather than silently accepting a lookalike.
    if (paragraph === null && !lines[i].includes("\t") && isLinkDefinition(text)) {
      const label = /^ {0,3}\[((?:\\.|[^\]])+)\]:/.exec(text)?.[1];
      if (label !== undefined) {
        const name = normaliseReference(label);
        references.add(name);
        const destination = text.slice(text.indexOf("]:") + 2).trim().match(/^(?:<([^>]*)>|([^\s]+))/);
        if (!destinations.has(name)) destinations.set(name, destination[1] ?? destination[2]);
      }
      readable[i] = "";
      markup[i] = "";
      continue;
    }

    const fenceOpen = FENCE_OPEN.exec(text);
    if (fenceOpen !== null
      && !(fenceOpen[2][0] === "`" && fenceOpen[3].includes("`"))) {
      paragraph = null;
      fence = { char: fenceOpen[2][0], length: fenceOpen[2].length };
      hidden.add(i);
      readable[i] = "";
      markup[i] = "";
      continue;
    }

    const atx = ATX_HEADING.exec(text);
    if (atx !== null) {
      paragraph = null;
      if (stack.length === 0) rootHeadingLines.add(i + 1);
      found.push({
        level: atx[1].length,
        line: i + 1,
        text: (atx[2] ?? "").replace(/\s+#+\s*$/, "").trim(),
        lines: 1,
        setext: false,
      });
      continue;
    }

    const underline = SETEXT_UNDERLINE.exec(text);
    if (underline !== null && !lazy && paragraph !== null && paragraphDepth === stack.length) {
      if (stack.length === 0) rootHeadingLines.add(paragraph.line);
      // The paragraph above becomes the heading's text, all of its lines.
      found.push({
        level: underline[1][0] === "=" ? 1 : 2,
        line: paragraph.line,
        text: paragraph.lines.join(" ").trim(),
        lines: paragraph.lines.length,
        setext: true,
      });
      paragraphs.splice(paragraphs.indexOf(paragraph), 1);
      for (let row = paragraph.line - 1; row < i; row++) blocks.delete(row);
      paragraph = null;
      continue;
    }

    if (THEMATIC_BREAK.test(text)) {
      paragraph = null;
      continue;
    }

    // Indented code cannot interrupt a paragraph, so four columns past the
    // container is code only where a paragraph is not already open. It is hidden
    // as fenced code is, so the rules that read line by line skip it too.
    if (paragraph === null && indentOf(text) >= 4) {
      hidden.add(i);
      readable[i] = "";
      markup[i] = "";
      continue;
    }

    const divider = nextContent(lines, i, stack);
    if (divider !== null
      && text.includes("|")
      && isDividerRow(divider.trim())
      && cellCount(text.trim()) === cellCount(divider.trim())) {
      paragraph = null;
      // Line-based table rules need the content after its quote or list
      // markers. Keeping the raw container syntax made a quoted empty header
      // invisible even though a listener still hears that table.
      readable[i] = text;
      readable[i + 1] = divider;
      markup[i] = text;
      markup[i + 1] = divider;
      tables.add(i);
      tables.add(i + 1);
      blocks.set(i, { id: i, kind: "table", data: false });
      blocks.set(i + 1, { id: i, kind: "table", data: false });
      let row = i + 2;
      for (; row < lines.length; row++) {
        const content = nextContent(lines, row - 1, stack);
        if (content === null || !content.includes("|") || startsBlock(content)) break;
        readable[row] = content;
        markup[row] = content;
        tables.add(row);
        blocks.set(row, { id: i, kind: "table", data: true });
        tableRows.set(row, tableCells(content.trim()));
        if (stack.length === 0) rootLines.add(row);
        if (!stack.some(container => container.kind === "quote")) navigationLines.add(row);
      }
      if (stack.length === 0) { rootLines.add(i); rootLines.add(i + 1); }
      if (!stack.some(container => container.kind === "quote")) { navigationLines.add(i); navigationLines.add(i + 1); }
      tableUntil = row - 1;
      continue;
    }

    if (paragraph === null) {
      paragraph = { line: i + 1, lines: [] };
      paragraphDepth = stack.length;
      paragraphs.push(paragraph);
    }
    if (stack.length === 0) rootLines.add(i);
    if (!stack.some(container => container.kind === "quote")) navigationLines.add(i);
    const list = stack.find(container => container.kind === "item");
    blocks.set(i, { id: list?.listId ?? paragraph.line - 1, kind: list === undefined ? "paragraph" : "list", data: true });
    paragraph.lines.push(text.trimStart());
  }

  for (const block of paragraphs) {
    const source = block.lines.join("\n");
    const forLineRules = visibleInline(source, false).split("\n");
    const withTags = visibleInline(source, false, true).split("\n");
    for (let offset = 0; offset < forLineRules.length; offset++) {
      readable[block.line - 1 + offset] = forLineRules[offset];
      markup[block.line - 1 + offset] = withTags[offset];
    }
    block.lines = visibleInline(source).split("\n");
  }
  const headingLabels: LabelRange[][] = [];
  for (const heading of found) {
    const labels: LabelRange[] = [];
    heading.text = visibleText(heading.text, references, labels);
    headingLabels.push(labels);
  }

  return { paragraphs, headings: found, headingLabels, hidden, tables, readable, markup, references, destinations, rootLines, navigationLines, rootHeadingLines, items, blocks, tableRows };
}

/**
 * The block structure of a Markdown text, for the rules about layout.
 *
 * Structural metadata is separate so existing calibrated text remains
 * unchanged. This reading alone also blanks raw HTML code blocks: `pre`,
 * `script`, `style` and `textarea`.
 *
 * Two ways of counting meet in the result. Every `line` property is counted
 * from 1. Every index into `lines` or `markupLines`, and every key or member
 * of a set or map of lines, is counted from 0.
 *
 * @returns
 * - `headings`: the headings outside any list or quotation. `allHeadings`
 *   holds every heading.
 * - `lines` and `markupLines`: one entry for each source line, blank where a
 *   reader sees nothing. `markupLines` keeps HTML tags.
 * - `rootLines`: the paragraph and table lines outside every list and
 *   quotation. `navigationLines`: the paragraph, list and table lines outside
 *   every quotation. Neither holds a heading line.
 * - `destinations`: where each defined reference label points, keyed by the
 *   label as `normaliseReference` gives it.
 * - `items`: each unordered list item, with a depth of 1 at the top level.
 * - `blocks`: for each line of a paragraph, list or table, the block it
 *   belongs to. Lines of one block share an `id`. `data` is false for a
 *   table header and its divider.
 * - `tableRows`: the cells of each table row below the divider.
 *
 * Empty text gives one empty line and nothing else.
 */
export function structure(text: string, reading: Reading = {}): {
  headings: Heading[]; allHeadings: Heading[]; lines: string[]; markupLines: string[];
  rootLines: ReadonlySet<number>; destinations: ReadonlyMap<string, string>;
  navigationLines: ReadonlySet<number>;
  items: Array<{ line: number; depth: number }>;
  blocks: ReadonlyMap<number, { id: number; kind: "paragraph" | "list" | "table"; data: boolean }>;
  tableRows: ReadonlyMap<number, string[]>;
} {
  const parsed = parse(toLines(text), reading, true);
  return { headings: parsed.headings.filter(heading => parsed.rootHeadingLines.has(heading.line)), allHeadings: parsed.headings,
    lines: parsed.readable, markupLines: parsed.markup, rootLines: parsed.rootLines, navigationLines: parsed.navigationLines, destinations: parsed.destinations, items: parsed.items, blocks: parsed.blocks, tableRows: parsed.tableRows };
}

/**
 * Inline text for structural wording comparison, without altering calibrated extraction.
 *
 * @param text One heading, label or line of inline Markdown.
 * @param references The labels that have definitions, each as
 *     `normaliseReference` gives it. A reference link is replaced only when
 *     its label is among them, so with none passed every reference link
 *     stays as written.
 * @returns The text with each inline link and image replaced by its label,
 *     and each HTML tag and comment by a space. Backslash escapes, code spans
 *     and emphasis markers stay as written. Empty for empty text.
 */
export function inlineText(text: string, references?: ReadonlySet<string>): string {
  return visibleText(text, references);
}

/** The next line's text, with the same containers stripped, or none. */
function nextContent(lines: string[], index: number, stack: Container[]): string | null {
  const next = lines[index + 1];
  if (next === undefined) return null;
  const { rest, matched } = matchOpen(expandTabs(next), stack);
  return matched === stack.length ? rest : null;
}

/**
 * Remove comments, declarations and processing instructions from a line.
 *
 * Each is a span rather than a line: "<!-- hidden --> The supplier shall
 * comply." holds one and a sentence, and discarding the whole line took the
 * sentence with it. An unclosed one carries to the following lines.
 */
function withoutInvisible(
  text: string,
  until: string | null,
): { text: string; until: string | null } {
  if (until !== null) {
    const closing = closingMarkup(text, until);
    if (closing === null) return { text: "", until };
    return { text: text.slice(closing.at + closing.length), until: null };
  }

  const opening = /^ {0,3}(<!--|<\?|<![A-Z])/.exec(text);
  if (opening === null) return { text, until: null };
  const abrupt = opening[1] === "<!--"
    ? abruptCommentClose(text.slice(opening.index + opening[0].length))
    : 0;
  if (abrupt > 0) {
    const outside = text.slice(0, opening.index) + " "
      + text.slice(opening[0].length + abrupt);
    return { text: outside, until: null };
  }
  const close = opening[1] === "<!--" ? "-->" : ">";
  const closing = closingMarkup(text, close, opening[0].length);
  const before = text.slice(0, opening.index);
  if (closing === null) return { text: before, until: close };
  return { text: before + " " + text.slice(closing.at + closing.length), until: null };
}

const ESCAPABLE = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/;
const HTML_TAG_AT_START = /^(?:<\/[A-Za-z][A-Za-z0-9-]*[ \t\n]*>|<[A-Za-z][A-Za-z0-9-]*(?:[ \t\n]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t\n]*=[ \t\n]*(?:[^ \t\n"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t\n]*\/?>)/;

function abruptCommentClose(afterOpening: string): number {
  if (afterOpening.startsWith("->")) return 2;
  return afterOpening.startsWith(">") ? 1 : 0;
}

function closingMarkup(
  text: string,
  close: string,
  start = 0,
): { at: number; length: number } | null {
  const standard = text.indexOf(close, start);
  if (close !== "-->") {
    return standard === -1 ? null : { at: standard, length: close.length };
  }
  const malformed = text.indexOf("--!>", start);
  if (standard === -1 && malformed === -1) return null;
  if (standard !== -1 && (malformed === -1 || standard < malformed)) {
    return { at: standard, length: close.length };
  }
  return { at: malformed, length: 4 };
}

function tickRun(text: string, start: number): number {
  let end = start;
  while (text[end] === "`") end++;
  return end - start;
}

/** Remove only inline markup that CommonMark keeps out of rendered text. */
function visibleInline(text: string, keepLiteralSyntax = true, keepHtmlTags = false): string {
  let visible = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] === "\\" && index + 1 < text.length && ESCAPABLE.test(text[index + 1])) {
      visible += keepLiteralSyntax ? text.slice(index, index + 2) : "  ";
      index += 2;
      continue;
    }
    if (text[index] === "`") {
      const length = tickRun(text, index);
      // The shared index knows where every span ends. Searching the rest of the text for
      // each unmatched run was quadratic: 10,000 backticks cost 4.6 seconds.
      const end = codeSpanEnds(text).get(index);
      if (end !== undefined) {
        const closing = end - length;
        const span = text.slice(index, end);
        if (keepLiteralSyntax) {
          visible += span;
        } else {
          // Keep the words a reader sees in a code-formatted link label, but
          // neutralise syntax that would turn a Markdown example into a link.
          const content = text.slice(index + length, closing)
            .replace(/[!<>[\]()]/g, " ");
          visible += " ".repeat(length) + content + " ".repeat(length);
        }
        index = end;
        continue;
      }
      // An unmatched run is literal text. Emitting one character and looking again made
      // the next backtick rescan the rest of the run, which cost 4.6 seconds at 10,000.
      visible += text.slice(index, index + length);
      index += length;
      continue;
    }
    if (text[index] !== "<") {
      visible += text[index];
      index++;
      continue;
    }

    const rest = text.slice(index);
    const tag = HTML_TAG_AT_START.exec(rest);
    if (tag !== null) {
      visible += keepHtmlTags ? tag[0] : " " + tag[0].replace(/[^\n]/g, "");
      index += tag[0].length;
      continue;
    }
    const abrupt = rest.startsWith("<!--") ? abruptCommentClose(rest.slice(4)) : 0;
    if (abrupt > 0) {
      visible += " ";
      index += 4 + abrupt;
      continue;
    }
    const invisible = rest.startsWith("<!--")
      ? { close: "-->", offset: 4 }
      : rest.startsWith("<?")
        ? { close: ">", offset: 2 }
        : /^<![A-Z]/.test(rest)
          ? { close: ">", offset: 2 }
          : null;
    if (invisible !== null) {
      const closing = closingMarkup(rest, invisible.close, invisible.offset);
      if (closing !== null) {
        const length = closing.at + closing.length;
        visible += " " + rest.slice(0, length).replace(/[^\n]/g, "");
        index += length;
        continue;
      }
    }
    visible += "<";
    index++;
  }
  return visible;
}

const BACKSLASH = "\\";
const NEWLINE = "\n";

function countLines(text: string): number {
  return text.split(NEWLINE).length;
}

/**
 * Keep the label, and keep the line count.
 *
 * A link destination or title may hold a line ending. Deleting it with the rest of the
 * markup moved every later sentence in the block one line up, so a finding pointed at an
 * innocent line. The removed text always follows the label, so the endings go on the end.
 */
function keepLines(whole: string, kept: string): string {
  const removed = countLines(whole) - countLines(kept);
  return removed > 0 ? kept + NEWLINE.repeat(removed) : kept;
}

/**
 * Where each "[" meets its partner, matched in one pass.
 *
 * Scanning forward from every bracket for a partner that may not exist would be quadratic,
 * and generated Markdown can hold a hundred thousand of them. A bracket behind a backslash
 * is literal text and takes no part.
 */
function bracketPartners(text: string): Map<number, number> {
  const ends = codeSpanEnds(text);
  const partners = new Map<number, number>();
  const open: number[] = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] === BACKSLASH) {
      index += 2;
      continue;
    }
    // A bracket inside a code span is content. Counting it took the label's own closing
    // bracket and corrupted the text a reader sees. The moves here mirror the other two
    // scanners over this text, so a third one cannot drift from them.
    if (text[index] === "`") {
      const closing = ends.get(index);
      index = closing === undefined ? index + tickRun(text, index) : closing;
      continue;
    }
    if (text[index] === "[") open.push(index);
    else if (text[index] === "]") {
      const start = open.pop();
      if (start !== undefined) {
        partners.set(start, index);
        // CommonMark allows a square bracket inside a destination, where it is not
        // label structure. Counting it let a destination close a label that opened
        // before the link, and the link vanished from every rule.
        if (text[index + 1] === "(") {
          const paren = text.indexOf(")", index + 2);
          if (paren !== -1) {
            index = paren + 1;
            continue;
          }
        }
      }
    }
    index += 1;
  }
  return partners;
}

/** A link or image found in the text, with the offsets it occupies. */
export interface MarkdownLink {
  start: number;
  end: number;
  image: boolean;
  label: string;
  target: string;
  kind: "inline" | "reference" | "shortcut";
  /**
   * Whether a reader meets this as an element in its own right.
   *
   * What sits inside an image's alt text contributes words to that alt and is never
   * rendered separately, so the rules pass over it while the text still reads it.
   */
  rendered: boolean;
}

/**
 * Every link and image in the text, in the order they appear.
 *
 * One scan serves the flattener and every rule that reads links, so they cannot disagree
 * about where a link is. Each caller keeps its own filter, because the rules and the
 * flattener genuinely differ: an empty label is a finding for one and not a link for the
 * other.
 *
 * Reading each link with its own pattern was quadratic, because a label pattern scans to
 * the end of the text from every "[" and then gives the ground back one character at a
 * time. Ten thousand unmatched brackets cost about nine seconds across the rules.
 *
 * Two boundaries are unchanged: a destination still ends at the first ")", and a label
 * still ends at its matching "]" rather than at a nested link.
 *
 * @param text A line, or several lines joined. Offsets in the result count from its start.
 * @returns The links ordered by where they start, with one inside the label of another
 *     listed as well. `label` and `target` are as written and untrimmed. Any pair of
 *     square brackets with no "(" or "[" after it is returned as a "shortcut" with an
 *     empty target, whether or not a definition exists, so the caller must look the
 *     label up. Brackets behind a backslash or inside a code span are not links.
 *     Empty when the text holds none.
 */
export function markdownLinks(text: string): MarkdownLink[] {
  const partners = bracketPartners(text);
  const ends = codeSpanEnds(text);
  const links: MarkdownLink[] = [];
  // Where to carry on from, once the label being read inside comes to an end.
  const resume = new Map<number, number>();
  // The ends of the alt texts currently being read inside, innermost last.
  const withinAlt: number[] = [];
  let index = 0;
  let noClosingParen = false;
  while (index < text.length) {
    const onwards = resume.get(index);
    if (onwards !== undefined) {
      index = onwards;
      continue;
    }
    if (text[index] === BACKSLASH) {
      index += 2;
      continue;
    }
    if (text[index] === "`") {
      const closing = ends.get(index);
      index = closing === undefined ? index + tickRun(text, index) : closing;
      continue;
    }
    while (withinAlt.length > 0 && (withinAlt.at(-1) as number) <= index) withinAlt.pop();
    const rendered = withinAlt.length === 0;
    const image = text[index] === "!" && text[index + 1] === "[";
    const opens = image ? index + 1 : index;
    const closes = text[opens] === "[" ? partners.get(opens) : undefined;
    if (closes === undefined) {
      index += 1;
      continue;
    }
    const label = text.slice(opens + 1, closes);
    const after = text[closes + 1];

    if (after === "(" && !noClosingParen) {
      const paren = text.indexOf(")", closes + 2);
      // Once no ")" remains, none remains for any later link either.
      if (paren === -1) noClosingParen = true;
      else {
        links.push({
          start: index,
          end: paren + 1,
          image,
          label,
          target: text.slice(closes + 2, paren),
          kind: "inline",
          rendered,
        });
        // Read on inside a link label, because CommonMark allows an image there and
        // jumping past the whole thing hid it from every rule. The destination is
        // stepped over when the label ends, so nothing is read twice. A link inside a
        // link label is a separate matter: CommonMark resolves those to the innermost
        // link alone, and this scan reports both, which is a stated limitation.
        // An image's alt text is read for the words it contributes, but nothing inside
        // it is an element in its own right, so the rules are told to pass over it.
        if (image) withinAlt.push(closes);
        resume.set(closes, paren + 1);
        index = opens + 1;
        continue;
      }
    }

    if (after === "[") {
      const targetEnd = partners.get(closes + 1);
      if (targetEnd !== undefined) {
        links.push({
          start: index,
          end: targetEnd + 1,
          image,
          label,
          target: text.slice(closes + 2, targetEnd),
          kind: "reference",
          rendered,
        });
        // A reference link carries a label too, and a linked badge is written this way.
        if (image) withinAlt.push(closes);
        resume.set(closes, targetEnd + 1);
        index = opens + 1;
        continue;
      }
    }

    // A label followed by "(" or "[" is a link whose other half is malformed, and reads
    // as literal text, exactly as the patterns this replaced concluded.
    if (after !== "(" && after !== "[") {
      links.push({ start: index, end: closes + 1, image, label, target: "", kind: "shortcut", rendered });
      index = closes + 1;
      continue;
    }
    index += 1;
  }
  return links;
}

/** Where a link's label begins, past the "[" and any "!" before it. */
function labelStart(link: MarkdownLink): number {
  return link.start + (link.image ? 2 : 1);
}

/**
 * Whether a reader sees the label in place of this link.
 *
 * An inline link always reads as its label. An empty label is still a link, and a
 * reader sees nothing where it stands. Leaving it as written counted its destination
 * and title as prose. The rule that reports a link with no text reads the source lines,
 * so it is unaffected. A reference reads as its label only where the document defines
 * it; otherwise its brackets are text and it stays as written.
 */
function readsAsLabel(link: MarkdownLink, references?: ReadonlySet<string>): boolean {
  if (link.kind === "inline") return true;
  const named = link.kind === "reference" ? link.target || link.label : link.label;
  return references?.has(normaliseReference(named)) ?? false;
}

/**
 * Replace every link and image with the label a reader sees.
 *
 * A label may hold a link or an image of its own, so the labels are closed with a stack
 * rather than by reading each one again from the start. Every character is then read
 * once, however deeply the text nests.
 *
 * @param labels Receives where each label sits in the result, for a caller that needs
 *     to know which words came from inside a link. The result is the same without it.
 */
function flattenLinks(text: string, references?: ReadonlySet<string>, labels: LabelRange[] = []): string {
  const flattening: Flattening = { open: [], flattened: "", at: 0, labels };
  for (const link of markdownLinks(text)) {
    while (flattening.open.length > 0) {
      const inner = flattening.open.at(-1) as OpenLabel;
      if (link.start < labelStart(inner.link) + inner.link.label.length) break;
      closeLabel(flattening, text, references);
    }
    writeFragment(flattening, text.slice(flattening.at, link.start));
    flattening.at = labelStart(link);
    flattening.open.push({ link, label: "", labels: [] });
  }
  while (flattening.open.length > 0) {
    closeLabel(flattening, text, references);
  }
  return flattening.flattened + text.slice(flattening.at);
}

/** A label still being read. Its own `labels` are the ones inside it, measured from its start. */
interface OpenLabel {
  link: MarkdownLink;
  label: string;
  labels: LabelRange[];
}

interface Flattening {
  open: OpenLabel[];
  flattened: string;
  at: number;
  /** Where each finished label sits in `flattened`. */
  labels: LabelRange[];
}

/** Adds text to the innermost open label, or to the result where no label is open. */
function writeFragment(flattening: Flattening, fragment: string): void {
  const inner = flattening.open.at(-1);
  if (inner === undefined) flattening.flattened += fragment;
  else inner.label += fragment;
}

/** Ends the innermost open label and writes what a reader sees in its place. */
function closeLabel(flattening: Flattening, text: string, references?: ReadonlySet<string>): void {
  const inner = flattening.open.pop() as OpenLabel;
  inner.label += text.slice(flattening.at, labelStart(inner.link) + inner.link.label.length);
  flattening.at = inner.link.end;
  const whole = text.slice(inner.link.start, flattening.at);
  if (!readsAsLabel(inner.link, references)) {
    // The link stays as written, so the labels found inside it are not in the result.
    writeFragment(flattening, whole);
    return;
  }
  const outer = flattening.open.at(-1);
  const from = outer === undefined ? flattening.flattened.length : outer.label.length;
  const found = outer === undefined ? flattening.labels : outer.labels;
  found.push({ start: from, end: from + inner.label.length });
  for (const label of inner.labels) {
    found.push({ start: from + label.start, end: from + label.end });
  }
  writeFragment(flattening, keepLines(whole, inner.label));
}


function visibleText(text: string, references?: ReadonlySet<string>, labels?: LabelRange[]): string {
  return flattenLinks(visibleInline(text), references, labels);
}

/**
 * Collect prose paragraphs: what a reader reads as sentences.
 *
 * @returns Each paragraph in document order, wherever it sits, a list item
 *     or a quotation included. Headings, code, tables and front matter are
 *     left out. Links stay as written; HTML tags and comments are removed.
 *     Empty when the text holds no prose.
 */
export function proseBlocks(text: string, reading: Reading = {}): ProseBlock[] {
  return parse(toLines(text), reading).paragraphs;
}

/**
 * Prose reduced to the words a reader meets, without link destinations.
 *
 * @returns The blocks `proseBlocks` returns, on the same lines, with each
 *     link and image replaced by its label. A reference link is replaced only
 *     where the document defines its label. A block keeps its number of
 *     lines, so a finding still points at the right one. Empty when the text
 *     holds no prose.
 */
export function readerProseBlocks(text: string, reading: Reading = {}): ProseBlock[] {
  const parsed = parse(toLines(text), reading);
  return parsed.paragraphs.map((block) => ({
    line: block.line,
    lines: visibleText(block.lines.join("\n"), parsed.references).split("\n"),
  }));
}

/**
 * The blocks `readerProseBlocks` returns, each with where its link labels sit.
 *
 * Once a link is replaced by its label, nothing in the text says where the
 * link was. A rule that pairs emphasis marks needs to know, because a mark
 * outside a link never pairs with one inside it.
 *
 * @returns The same blocks, lines and line numbers as `readerProseBlocks`.
 *     `labels` is empty for a block with no link that reads as its label.
 *     Empty when the text holds no prose.
 */
export function labelledProseBlocks(text: string, reading: Reading = {}): LabelledBlock[] {
  const parsed = parse(toLines(text), reading);
  return parsed.paragraphs.map((block) => {
    const labels: LabelRange[] = [];
    const lines = visibleText(block.lines.join("\n"), parsed.references, labels).split("\n");
    return { line: block.line, lines, labels };
  });
}

/**
 * Every heading as a block of one line, with where its link labels sit.
 *
 * @returns One block for each heading `headings` returns, in the same order.
 *     Its one line is that heading's `text`, and `line` is where the heading
 *     starts. Empty when the text has no heading.
 */
export function labelledHeadings(text: string, reading: Reading = {}): LabelledBlock[] {
  const parsed = parse(toLines(text), reading);
  return parsed.headings.map((heading, index) => ({
    line: heading.line,
    lines: [heading.text],
    labels: parsed.headingLabels[index] as LabelRange[],
  }));
}

/**
 * Heading levels with their 1-indexed line numbers.
 *
 * @returns Every heading in document order, of either form, including one
 *     inside a list or a quotation. `text` has links replaced by their labels
 *     as `readerProseBlocks` replaces them, and closing hash marks removed. Empty when the text has no heading.
 */
export function headings(text: string, reading: Reading = {}): Heading[] {
  return parse(toLines(text), reading).headings;
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

const WHITESPACE = /\s/;

/**
 * The last whitespace-separated token in the fragment.
 *
 * Read from the end rather than split, because a merged sentence grows with every
 * boundary and splitting the whole of it again for each one cost the square of its
 * length: 3,000 merged fragments took 0.4 seconds.
 */
function lastToken(fragment: string): string {
  let end = fragment.length;
  while (end > 0 && WHITESPACE.test(fragment[end - 1] as string)) end -= 1;
  let start = end;
  while (start > 0 && !WHITESPACE.test(fragment[start - 1] as string)) start -= 1;
  return fragment.slice(start, end);
}

function bareWord(token: string): string {
  return token.replace(/\./g, "").replace(/^[^A-Za-z]+/, "").toLowerCase();
}

/**
 * The text as a reader sees it, with each backslash escape resolved to its character.
 *
 * The same test the scanners use decides what an escape covers, so a token can never be
 * classified as something the reader never sees.
 */
function rendered(text: string): string {
  let visible = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === BACKSLASH && ESCAPABLE.test(text[index + 1] ?? "")) index += 1;
    visible += text[index];
  }
  return visible;
}

/**
 * Decide whether the stop between two fragments ends a sentence.
 *
 * @param previous The text before the gap, ending with its stop. Only its
 *     last word is read.
 * @param next The text after the gap. Only its first word is read.
 * @returns "split" where a sentence ends, "merge" where a title, an initial
 *     or an abbreviation carries on, and "ambiguous" where the two words
 *     cannot settle it, which leaves the choice to the caller. A `previous`
 *     that does not end in a full stop, once closing quotation marks and
 *     emphasis are set aside, is always "split". So an exclamation mark, a
 *     question mark and empty text all split.
 */
export function classifyBoundary(previous: string, next: string): Boundary {
  // `**e.g.**` is the same abbreviation as `e.g.`, so the closing markup comes off
  // before the token is read. Leaving it on hid the stop and split the sentence.
  // An escape renders as the bare character, so `e.g.\)` is the same abbreviation
  // as `e.g.)`. Reading the source token left a backslash on the end and hid it.
  const token = rendered(lastToken(previous)).replace(/[*_`"'’”)\]}]+$/, "");
  if (!token.endsWith(".")) return "split";
  const word = bareWord(token);
  // Only the first word of the next fragment carries evidence. Reading the
  // whole fragment made every test match something somewhere.
  const nextToken = rendered(next.trimStart().split(/\s+/)[0] ?? "");
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

/** Markup that can close after a sentence ends, as in `**Lead in.**` or `("Done.")`. */
const CLOSING_MARKUP = new Set(["*", "_", "`", '"', "'", "’", "”", ")", "]", "}"]);
const TERMINATOR = new Set([".", "!", "?"]);

/** The last text asked about, because a block is read by many rules in turn. */
let spanCacheText: string | null = null;
let spanCacheEnds: Map<number, number> | null = null;

/**
 * Where each code span ends, keyed by where it opens.
 *
 * Every backtick run is collected in one pass, then each opener takes the next unused run
 * of its own length. Searching the remaining text per run was quadratic: an audit of
 * 10,000 backticks took 5.4 seconds.
 *
 * CommonMark reads escapes left to right, so a backslash stops a run from opening a span.
 * Once a span is open the search for its closer ignores backslashes, which is why an
 * escaped run is collected here rather than discarded: it can still close.
 *
 * @returns A map from the offset of the first backtick of each span to the offset just
 *     past its last. A run of backticks with no partner has no entry. Empty when the
 *     text holds no span. The map for the last text asked about is kept and handed out
 *     again, so treat it as read-only.
 */
export function codeSpanEnds(text: string): Map<number, number> {
  if (spanCacheText === text && spanCacheEnds !== null) return spanCacheEnds;
  const runs: Array<{ start: number; length: number; escaped: boolean }> = [];
  // Counted forward rather than looked up behind each run, because a long backslash
  // run before every backtick would make the lookup quadratic.
  let backslashes = 0;
  for (let index = 0; index < text.length; ) {
    if (text[index] === "\\") {
      backslashes += 1;
      index += 1;
      continue;
    }
    if (text[index] === "`") {
      const length = tickRun(text, index);
      runs.push({ start: index, length, escaped: backslashes % 2 === 1 });
      backslashes = 0;
      index += length;
      continue;
    }
    backslashes = 0;
    index += 1;
  }
  const byLength = new Map<number, number[]>();
  runs.forEach((run, position) => {
    const list = byLength.get(run.length);
    if (list === undefined) byLength.set(run.length, [position]);
    else list.push(position);
  });
  const cursors = new Map<number, number>();
  const ends = new Map<number, number>();
  let position = 0;
  while (position < runs.length) {
    const run = runs[position] as { start: number; length: number; escaped: boolean };
    // An escaped backslash consumes the first backtick only, so a longer run still
    // opens a span, one backtick shorter and one offset later.
    const openLength = run.escaped ? run.length - 1 : run.length;
    const openStart = run.escaped ? run.start + 1 : run.start;
    if (openLength === 0) {
      position += 1;
      continue;
    }
    const candidates = byLength.get(openLength) ?? [];
    let cursor = cursors.get(openLength) ?? 0;
    while (cursor < candidates.length && (candidates[cursor] as number) <= position) cursor += 1;
    cursors.set(openLength, cursor);
    if (cursor >= candidates.length) {
      position += 1;
      continue;
    }
    const closing = runs[candidates[cursor] as number] as { start: number; length: number };
    ends.set(openStart, closing.start + closing.length);
    position = (candidates[cursor] as number) + 1;
  }
  spanCacheText = text;
  spanCacheEnds = ends;
  return ends;
}

/**
 * Whether a stop is still standing after this character.
 *
 * A terminator starts one, closing markup leaves it alone, and anything else ends it.
 * Shared with the escape branch so an escaped character and a plain one cannot drift.
 */
function readTerminatorState(character: string, terminated: boolean): boolean {
  if (TERMINATOR.has(character)) return true;
  return CLOSING_MARKUP.has(character) ? terminated : false;
}

/**
 * Where each sentence boundary starts, as a span of whitespace to drop.
 *
 * One forward pass, so a long run of closing markup costs what it should. A regex with a
 * variable-length lookbehind rescanned that run instead, and 25,000 markers took two
 * seconds. A closed code span is skipped whole, because a span in backticks is a term
 * being named and its punctuation belongs to the name. An unmatched run is ordinary text
 * and leaves the sentence before it alone.
 */
function boundarySpans(text: string): Array<{ at: number; length: number }> {
  const ends = codeSpanEnds(text);
  const spans: Array<{ at: number; length: number }> = [];
  let terminated = false;
  let index = 0;
  while (index < text.length) {
    const character = text[index] as string;
    if (character === "\\" && index + 1 < text.length && ESCAPABLE.test(text[index + 1] as string)) {
      // The escape renders as the bare character, so the reader sees a terminator or a
      // closing marker and the state must follow it. Clearing the state outright was
      // right only for an escaped backtick, and it lost every other boundary.
      terminated = readTerminatorState(text[index + 1] as string, terminated);
      index += 2;
      continue;
    }
    if (character === "`") {
      const closing = ends.get(index);
      if (closing === undefined) {
        // Not a span at all, so the run is literal and the stop before it still stands.
        index += tickRun(text, index);
        continue;
      }
      terminated = false;
      index = closing;
      continue;
    }
    if (/\s/.test(character)) {
      let end = index;
      while (end < text.length && /\s/.test(text[end] as string)) end++;
      if (terminated) spans.push({ at: index, length: end - index });
      terminated = false;
      index = end;
      continue;
    }
    terminated = readTerminatorState(character, terminated);
    index += 1;
  }
  return spans;
}

/** A sentence and where it starts in the text it came from. */
export interface LocatedSentence {
  text: string;
  start: number;
}

function segment(text: string, ambiguous: "merge" | "split"): LocatedSentence[] {
  const fragments: LocatedSentence[] = [];
  let from = 0;
  for (const span of boundarySpans(text)) {
    fragments.push({ text: text.slice(from, span.at), start: from });
    from = span.at + span.length;
  }
  fragments.push({ text: text.slice(from), start: from });

  const sentences: LocatedSentence[] = [];
  for (const fragment of fragments) {
    const previous = sentences.at(-1);
    if (previous !== undefined) {
      const verdict = classifyBoundary(previous.text, fragment.text);
      const decided = verdict === "ambiguous" ? ambiguous : verdict;
      if (decided === "merge") {
        previous.text = `${previous.text} ${fragment.text}`;
        continue;
      }
    }
    sentences.push({ ...fragment });
  }
  return sentences
    .map((sentence) => {
      const leading = sentence.text.length - sentence.text.trimStart().length;
      return { text: sentence.text.trim(), start: sentence.start + leading };
    })
    .filter((sentence) => sentence.text.length > 0);
}

/**
 * Each sentence with the offset it starts at. Callers that need to report a line use
 * this, rather than rebuilding the sentence as a regular expression to find it again.
 * That rebuild threw `regular expression too large` on a long enough sentence.
 *
 * @param text One block of prose, which may run over several lines.
 * @returns The sentences in order, split as `splitSentences` splits them. `text` is
 *     trimmed, and `start` is the offset of its first character in the block. Where a
 *     title or an abbreviation joined two fragments, `text` holds one space at the join
 *     whatever the source held. Empty for blank text.
 */
export function locateSentences(text: string): LocatedSentence[] {
  return segment(text, "split");
}

/**
 * The most sentences the text can hold: every ambiguous stop is a boundary.
 * Rules that punish length use this, so an unresolved stop can never inflate a
 * sentence into a violation.
 *
 * @returns The sentences in order, each trimmed. Empty for blank text.
 */
export function splitSentences(text: string): string[] {
  return segment(text, "split").map((sentence) => sentence.text);
}

/**
 * The fewest sentences the text can hold: every ambiguous stop is joined.
 * Rules that punish sentence count use this, so an unresolved stop can never
 * manufacture an extra sentence.
 *
 * @returns The sentences in order, each trimmed. Empty for blank text.
 */
export function mergedSentences(text: string): string[] {
  return segment(text, "merge").map((sentence) => sentence.text);
}

/**
 * How many words the text holds, where a word is any run of characters
 * between white space. Punctuation standing alone therefore counts as a word.
 * Blank text has none.
 */
export function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter(Boolean).length;
}
