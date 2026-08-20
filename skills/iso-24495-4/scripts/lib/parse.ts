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
  /** Reader-visible markup retained for rules about links and images. */
  markupLines: string[];
  /** Normalised reference labels that have valid definitions. */
  references: ReadonlySet<string>;
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
  /** Source lines with invisible markup removed for line-based rules. */
  readable: string[];
  /** Reader-visible source with HTML tags retained. */
  markup: string[];
  /** Valid link reference labels in this document. */
  references: Set<string>;
}

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

function parse(lines: string[]): Parsed {
  const paragraphs: ProseBlock[] = [];
  const found: Heading[] = [];
  const hidden = new Set<number>();
  const tables = new Set<number>();
  const readable = [...lines];
  const markup = [...lines];
  const references = new Set<string>();
  const stack: Container[] = [];
  const frontMatter = frontMatterRange(lines);

  let paragraph: ProseBlock | null = null;
  let paragraphDepth = 0;
  let fence: { char: string; length: number } | null = null;
  let tableUntil = -1;
  let invisible: { until: string; depth: number } | null = null;

  const closeParagraph = (): void => {
    paragraph = null;
  };

  for (let i = 0; i < lines.length; i++) {
    if (frontMatter !== null && i <= frontMatter.end) {
      hidden.add(i);
      readable[i] = "";
      markup[i] = "";
      closeParagraph();
      continue;
    }
    if (i <= tableUntil) continue;

    const line = expandTabs(lines[i]);
    const { rest, matched } = matchOpen(line, stack);
    const allMatched = matched === stack.length;
    let text = rest;

    if (invisible !== null) {
      if (matched < invisible.depth) {
        // An HTML block cannot escape the quotation or list item that owns it.
        // Carrying its close marker past that boundary hid ordinary margin text.
        invisible = null;
        closeParagraph();
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
          closeParagraph();
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
      closeParagraph();
      if (!allMatched) stack.length = matched;
      continue;
    }

    // A paragraph continues without its markers repeated. Without this, a
    // wrapped quotation or list item became a second block, and the advice
    // about the paragraph a reader sees never arrived.
    const lazy = !allMatched && paragraph !== null && !startsAnyBlock(rest);
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
      closeParagraph();
      if (text.trim() === "") continue;
    }
    // A tab is structural indentation, not link-definition whitespace. The
    // expanded line cannot preserve that distinction, so the safe reading is
    // visible prose rather than silently accepting a lookalike.
    if (paragraph === null && !lines[i].includes("\t") && isLinkDefinition(text)) {
      const label = /^ {0,3}\[((?:\\.|[^\]])+)\]:/.exec(text)?.[1];
      if (label !== undefined) references.add(normaliseReference(label));
      readable[i] = "";
      markup[i] = "";
      continue;
    }

    const fenceOpen = FENCE_OPEN.exec(text);
    if (fenceOpen !== null
      && !(fenceOpen[2][0] === "`" && fenceOpen[3].includes("`"))) {
      closeParagraph();
      fence = { char: fenceOpen[2][0], length: fenceOpen[2].length };
      hidden.add(i);
      readable[i] = "";
      markup[i] = "";
      continue;
    }

    const atx = ATX_HEADING.exec(text);
    if (atx !== null) {
      closeParagraph();
      found.push({
        level: atx[1].length,
        line: i + 1,
        text: (atx[2] ?? "").replace(/\s+#+\s*$/, "").trim(),
      });
      continue;
    }

    const underline = SETEXT_UNDERLINE.exec(text);
    if (underline !== null && !lazy && paragraph !== null && paragraphDepth === stack.length) {
      // The paragraph above becomes the heading's text, all of its lines.
      found.push({
        level: underline[1][0] === "=" ? 1 : 2,
        line: paragraph.line,
        text: paragraph.lines.join(" ").trim(),
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
      // Line-based table rules need the content after its quote or list
      // markers. Keeping the raw container syntax made a quoted empty header
      // invisible even though a listener still hears that table.
      readable[i] = text;
      readable[i + 1] = divider;
      markup[i] = text;
      markup[i + 1] = divider;
      tables.add(i);
      tables.add(i + 1);
      let row = i + 2;
      for (; row < lines.length; row++) {
        const content = nextContent(lines, row - 1, stack);
        if (content === null || !content.includes("|") || startsBlock(content)) break;
        readable[row] = content;
        markup[row] = content;
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
  for (const heading of found) {
    heading.text = visibleText(heading.text, references);
  }

  return { paragraphs, headings: found, hidden, tables, readable, markup, references };
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

function visibleText(text: string, references?: ReadonlySet<string>): string {
  return visibleInline(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (whole, alt: string) => keepLines(whole, alt))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, (whole, label: string) => keepLines(whole, label))
    .replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (whole, alt: string, label: string) =>
      references?.has(normaliseReference(label || alt)) ? keepLines(whole, alt) : whole)
    .replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (whole, label: string, target: string) =>
      references?.has(normaliseReference(target || label)) ? keepLines(whole, label) : whole)
    .replace(/(?<![!\]])\[([^\]]+)\](?![\[(])/g, (whole, label: string) =>
      references?.has(normaliseReference(label)) ? keepLines(whole, label) : whole);
}

/** Collect prose paragraphs: what a reader reads as sentences. */
export function proseBlocks(text: string): ProseBlock[] {
  return parse(toLines(text)).paragraphs;
}

/** Prose reduced to the words a reader meets, without link destinations. */
export function readerProseBlocks(text: string): ProseBlock[] {
  const parsed = parse(toLines(text));
  return parsed.paragraphs.map((block) => ({
    line: block.line,
    lines: visibleText(block.lines.join("\n"), parsed.references).split("\n"),
  }));
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
  return {
    lines: parsed.readable.map((line) => visibleInline(line, false)),
    markupLines: parsed.markup,
    references: parsed.references,
    hidden: (index) => parsed.hidden.has(index),
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
  // `**e.g.**` is the same abbreviation as `e.g.`, so the closing markup comes off
  // before the token is read. Leaving it on hid the stop and split the sentence.
  const token = lastToken(previous).replace(/[*_`"'’”)\]}]+$/, "");
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
 */
function codeSpanEnds(text: string): Map<number, number> {
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
      terminated = false;
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
    if (TERMINATOR.has(character)) {
      terminated = true;
    } else if (!CLOSING_MARKUP.has(character)) {
      terminated = false;
    }
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
 */
export function locateSentences(text: string): LocatedSentence[] {
  return segment(text, "split");
}

/**
 * The most sentences the text can hold: every ambiguous stop is a boundary.
 * Rules that punish length use this, so an unresolved stop can never inflate a
 * sentence into a violation.
 */
export function splitSentences(text: string): string[] {
  return segment(text, "split").map((sentence) => sentence.text);
}

/**
 * The fewest sentences the text can hold: every ambiguous stop is joined.
 * Rules that punish sentence count use this, so an unresolved stop can never
 * manufacture an extra sentence.
 */
export function mergedSentences(text: string): string[] {
  return segment(text, "merge").map((sentence) => sentence.text);
}

export function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter(Boolean).length;
}
