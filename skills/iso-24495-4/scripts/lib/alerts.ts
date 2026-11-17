import { toLines, type Quotation, type structure } from "./parse.ts";
import type { Violation } from "./types.ts";

/**
 * A link reference definition whose label is an alert marker, such as
 * `[!NOTE]: https://example.org`. It can make the marker a link, so an alert
 * of that kind is not read in a text that holds one. The label may run over
 * lines, hold quotation markers and spaces, and escape its `!`, so this
 * matches more than a renderer would take as a definition.
 */
const DEFINED_MARKER = /\[[\s>]*\\?!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)[\s>]*\]:/gi;
const QUOTE_MARKER = /^ {0,3}>[ \t]?/;
const BLANK = /^[ \t]*$/;
/**
 * The characters of a row that would make the marker line a table header,
 * when the row holds a dash. Each pattern here holds one repetition of one
 * class, so a long line is read once.
 */
const DELIMITER_ROW = /^[-:| \t]+$/;
/** A thematic break of stars or underscores, once its spaces and tabs are gone. */
const THEMATIC_BREAK = /^(?:\*{3,}|_{3,})$/;
/** A setext underline of equals signs, trimmed. */
const UNDERLINE = /^=+$/;
const SPACES = /[ \t]/g;
/**
 * The HTML blocks that run on over blank lines, as CommonMark has them, that
 * the structural reading can leave unread, each with what ends it. One is
 * opened by `<pre`, `<script`, `<style` or `<textarea`, which the reading
 * misses when the tag name ends its line. The other is a CDATA section. The
 * reading hides comments, processing instructions and declarations itself.
 */
const RAW_HTML: ReadonlyArray<{ open: RegExp; close: RegExp }> = [
  { open: /^ {0,3}<(?:pre|script|style|textarea)(?:[ \t>]|$)/i, close: /<\/(?:pre|script|style|textarea)>/i },
  { open: /^ {0,3}<!\[CDATA\[/, close: /\]\]>/ },
];
/** The elements HTML gives no end tag, so they hold nothing. */
const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
/** The elements whose content HTML reads as text up to their own end tag. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);
/** A line that may start an HTML block, in which Markdown is not read up to the next blank line. */
const MAY_START_HTML = /^[ \t]*<[A-Za-z/!?]/;
/** What may follow a tag name: white space, `/` or `>`. */
const TAG_NAME_END = /[ \t\n/>]/;
const LETTER = /[A-Za-z]/;
const NAME_CHARACTER = /[A-Za-z0-9-]/;
/** What ends a comment in HTML, searched from where the comment starts. */
const COMMENT_END = /--!?>/g;

/**
 * The `adjacent-alerts` findings: each GitHub alert that follows an alert of
 * the same kind with only blank lines between.
 *
 * It reports only an alert it is sure of, and reads anything else as no
 * alert. An alert here is a quotation outside every list and quotation whose
 * first line is the marker alone, such as `> [!NOTE]`, in any letter case.
 * It also needs a blank line or the start of the text above it, a next line
 * in the quotation that holds text, a first paragraph that is no heading,
 * no link definition of its marker anywhere in the text, no HTML block from
 * an earlier line still open around it, and every HTML element opened above
 * it closed above it.
 *
 * @param text The whole document, read as Markdown.
 * @param parsed What `structure` gave for the same text.
 * @returns One finding on the marker line of each such later alert, in
 *     document order, its detail naming the earlier alert's line. Three in a
 *     row give two. Empty when none, as for empty text.
 */
export function adjacentAlertViolations(text: string, parsed: Pick<ReturnType<typeof structure>, "quotations" | "allHeadings" | "markupLines" | "blocks">): Violation[] {
  const lines = toLines(text);
  const defined = new Set<string>();
  for (const match of text.matchAll(DEFINED_MARKER)) {
    defined.add((match[1] ?? "").toUpperCase());
  }
  const underlined = new Set<number>();
  for (const heading of parsed.allHeadings) {
    if (heading.setext) underlined.add(heading.line);
  }
  const insideHtml = linesInsideHtml(lines);
  const held = linesHeldByElements(lines, parsed.markupLines, parsed.blocks);
  for (const [index, flag] of held.entries()) {
    if (flag === 1) insideHtml[index] = 1;
  }
  const reading: AlertReading = { lines, defined, underlined, insideHtml };
  const findings: Violation[] = [];
  let previous: Quotation | null = null;
  for (const quotation of parsed.quotations) {
    const earlier = previous;
    previous = readableAlert(reading, quotation) ? quotation : null;
    if (earlier === null || previous === null || earlier.alert !== quotation.alert) continue;
    if (!onlyBlankBetween(lines, earlier.end, quotation.line)) continue;
    const kind = quotation.alert ?? "";
    findings.push({
      rule: "adjacent-alerts", line: quotation.line,
      detail: `This ${kind} alert follows the ${kind} alert on line ${earlier.line} with only blank lines between. If the two serve one purpose, merge them into one alert.`,
    });
  }
  return findings;
}

/** What the rule reads of the whole text before it reads each quotation. */
interface AlertReading {
  lines: readonly string[];
  /** The kinds whose marker the text defines as a link label. */
  defined: ReadonlySet<string>;
  /** The first line, counted from 1, of each heading underlined on the line below it. */
  underlined: ReadonlySet<number>;
  /** For each line, counted from 0, whether an HTML block or element opened on an earlier line may hold it. */
  insideHtml: Uint8Array;
}

/**
 * Whether a quotation is an alert this rule is sure of: it names a kind, the
 * text defines no link label of that marker, no HTML block or element from an
 * earlier line may hold it, a blank line or the start of the text stands above it, its
 * next line is in the quotation and holds text, and that text does not
 * become a heading.
 */
function readableAlert(reading: AlertReading, quotation: Quotation): boolean {
  if (quotation.alert === null || reading.defined.has(quotation.alert) || reading.insideHtml[quotation.line - 1] === 1) return false;
  const above = reading.lines[quotation.line - 2];
  if (above !== undefined && !BLANK.test(above)) return false;
  const next = reading.lines[quotation.line] ?? "";
  const marker = QUOTE_MARKER.exec(next);
  if (marker === null) return false;
  const rest = next.slice(marker[0].length).trim();
  return rest !== "" && isText(rest) && !reading.underlined.has(quotation.line + 1);
}

/**
 * Whether the line after an alert's marker, trimmed, stays plain text in the
 * alert. It does not when it is an underline that would make the marker a
 * heading, a thematic break, a row of dashes, colons and pipes that would
 * make it a table header, or HTML, which may show nothing.
 */
function isText(rest: string): boolean {
  if (rest.startsWith("<")) return false;
  if (rest.includes("-") && DELIMITER_ROW.test(rest)) return false;
  return !UNDERLINE.test(rest) && !THEMATIC_BREAK.test(rest.replace(SPACES, ""));
}

/**
 * Which lines an HTML block that runs over blank lines holds, after the line
 * it opens on. A block opens on a line that starts with one, up to three
 * spaces in, and ends on the first line, its own included, that holds what
 * ends it, or at the end of the text. It reads every line as it stands, so
 * an opening in code or a quotation counts too, and some alerts that render
 * are not read.
 *
 * @returns One entry for each line, 1 where such a block holds it.
 */
function linesInsideHtml(lines: readonly string[]): Uint8Array {
  const inside = new Uint8Array(lines.length);
  let close: RegExp | null = null;
  for (const [index, line] of lines.entries()) {
    if (close !== null) {
      inside[index] = 1;
      if (close.test(line)) close = null;
      continue;
    }
    const block = RAW_HTML.find(candidate => candidate.open.test(line));
    if (block !== undefined && !block.close.test(line.replace(block.open, ""))) close = block.close;
  }
  return inside;
}

/**
 * Which lines an HTML element opened above them may hold. The rule reads the
 * text from its start as the structural reading shows it, where code,
 * comments and escaped tags are gone and tags stay, and keeps a list of the
 * elements still open.
 *
 * HTML and Markdown can disagree on what is a tag, so the reading leans one
 * way: an element it cannot see closed is open. Anything that may open an
 * element opens one: a start tag of an element HTML gives an end tag,
 * wherever it stands, and a tag whose end the reading cannot see. An end tag
 * closes the element last opened only when it is certainly a tag: written in
 * full as CommonMark has it, outside a link's destination and title, outside
 * a link definition, and after no backtick or backslash on its line, as code
 * and escapes in a heading or a table row are shown as written. The reading
 * is unsure of every line after an
 * end tag of an element opened before the last one, after a tag that may run
 * over a blank line, and after a line that may hold HTML its reading hides.
 *
 * @returns One entry for each line, 1 where an element may hold it.
 */
function linesHeldByElements(lines: readonly string[], markup: readonly string[], blocks: ReadonlyMap<number, { kind: string }>): Uint8Array {
  const text = markup.join("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const shown of markup) {
    starts.push(offset);
    offset += shown.length + 1;
  }
  const reading: ElementReading = {
    text, starts, held: new Uint8Array(markup.length), hidden: hiddenOpenings(lines, markup), closingNothing: linesClosingNothing(lines, markup, blocks),
    open: [], openCount: new Map(), sure: true, line: 0, asked: 0, linkEnd: -1, lastMark: -1,
  };
  const lower = text.toLowerCase();
  let at = 0;
  while (at < text.length) {
    if (text[at] === "`" || text[at] === "\\") reading.lastMark = at;
    if (text[at] === "]" && text[at + 1] === "(" && at >= reading.linkEnd) {
      reading.linkEnd = linkTailEnd(text, at + 2);
      at += 2;
      continue;
    }
    if (text[at] !== "<") {
      at++;
      continue;
    }
    recordUntil(reading, at);
    const tag = reading.sure ? readTag(text, at) : { kind: "unsure" as const };
    if (tag === null) {
      at++;
      continue;
    }
    if (tag.kind === "unsure") {
      reading.sure = false;
      break;
    }
    let end = tag.end;
    if (tag.kind === "close" && endTagCertain(reading, at)) {
      closeElement(reading, tag.name);
    } else if (tag.kind === "open" && RAW_TEXT_ELEMENTS.has(tag.name)) {
      // Nothing inside is a tag, up to the element's own end tag.
      const closing = rawTextEnd(lower, tag.name, tag.end);
      const ending = closing === -1 ? null : readTag(text, closing);
      noteMarks(reading, at, Math.max(closing, at));
      if (ending === null || ending.kind !== "close" || !endTagCertain(reading, closing)) reading.sure = false;
      end = ending?.kind === "close" ? ending.end : end;
    } else if (tag.kind === "open" && !VOID_ELEMENTS.has(tag.name)) {
      reading.open.push(tag.name);
      reading.openCount.set(tag.name, (reading.openCount.get(tag.name) ?? 0) + 1);
    }
    if (!reading.sure) break;
    noteMarks(reading, at, end);
    coverUntil(reading, end);
    at = end;
  }
  if (!reading.sure) coverUntil(reading, Number.POSITIVE_INFINITY);
  recordUntil(reading, Number.POSITIVE_INFINITY);
  return reading.held;
}

/** What the reading of HTML elements knows as it moves through the shown text. */
interface ElementReading {
  /** The shown lines joined by line breaks, and the offset each line starts at. */
  readonly text: string;
  readonly starts: readonly number[];
  /** For each line, 1 where an element may hold it. */
  readonly held: Uint8Array;
  /** For each line, 1 where it may hold a start tag the structural reading hides. */
  readonly hidden: Uint8Array;
  /** For each line, 1 where an end tag on it closes nothing opened before it. */
  readonly closingNothing: Uint8Array;
  /** The names of the elements still open, the last opened last, and how many of each. */
  readonly open: string[];
  readonly openCount: Map<string, number>;
  /** False once the reading cannot tell what holds the lines after. */
  sure: boolean;
  /** The next line whose state is not yet recorded. */
  line: number;
  /** The line an end tag was last asked about. Questions come in text order. */
  asked: number;
  /** Where the link destination and title last met end. */
  linkEnd: number;
  /**
   * The offset of the last backtick or backslash. The structural reading
   * leaves both in a heading and a table row, where `</b>` after one may be
   * code or escaped.
   */
  lastMark: number;
}

/** Records what holds each line that starts at or before this offset, as the reading stands. */
function recordUntil(reading: ElementReading, until: number): void {
  for (; reading.line < reading.held.length && (reading.starts[reading.line] ?? 0) <= until; reading.line++) {
    if (reading.hidden[reading.line] === 1) reading.sure = false;
    reading.held[reading.line] = reading.sure && reading.open.length === 0 ? 0 : 1;
  }
}

/** Marks as held each line that starts before this offset, where a tag, a comment or raw text ends. */
function coverUntil(reading: ElementReading, end: number): void {
  for (; reading.line < reading.held.length && (reading.starts[reading.line] ?? 0) < end; reading.line++) {
    reading.held[reading.line] = 1;
  }
}

/** Notes the last backtick or backslash in a stretch of text the reading moves past. */
function noteMarks(reading: ElementReading, from: number, to: number): void {
  for (let index = from; index < to; index++) {
    const character = reading.text[index];
    if (character === "`" || character === "\\") reading.lastMark = index;
  }
}

/**
 * Whether an end tag at this offset is certainly a tag that may close an
 * element: outside a link's destination and title, on a line where an end
 * tag can close one, and after no backtick or backslash on its line.
 */
function endTagCertain(reading: ElementReading, at: number): boolean {
  while (reading.asked + 1 < reading.starts.length && (reading.starts[reading.asked + 1] ?? 0) <= at) {
    reading.asked++;
  }
  return at >= reading.linkEnd && reading.closingNothing[reading.asked] !== 1 && reading.lastMark < (reading.starts[reading.asked] ?? 0);
}

/**
 * Closes the element last opened when the end tag names it. An end tag of
 * an element opened before the last one leaves the reading unsure, as HTML
 * may then close more than one. An end tag of no open element closes none.
 */
function closeElement(reading: ElementReading, name: string): void {
  if (reading.open[reading.open.length - 1] === name) {
    reading.open.pop();
    reading.openCount.set(name, (reading.openCount.get(name) ?? 1) - 1);
  } else if ((reading.openCount.get(name) ?? 0) > 0) {
    reading.sure = false;
  }
}

/** A tag the reading met: a start tag, an end tag, something it skips, or a tag it is unsure of. */
type ReadTag = { kind: "open" | "close"; name: string; end: number } | { kind: "skip"; end: number } | { kind: "unsure" };

/**
 * The tag that starts at this `<`, with the offset after its end, or null
 * when HTML reads none there. A comment, a declaration and a processing
 * instruction are skipped whole. An end tag is read only as CommonMark
 * writes one, `</` and a name and `>`, with only white space before the `>`.
 * A start tag is read as HTML reads one, so its attributes may hold anything
 * and run over lines. It is unsure when its end cannot be seen, when it
 * holds a `<` outside quotes, or when it runs over a blank line.
 */
function readTag(text: string, at: number): ReadTag | null {
  const next = text[at + 1];
  if (next === "!" || next === "?") {
    const end = text.startsWith("<!--", at) ? commentEnd(text, at + 4) : text.indexOf(">", at + 2) + 1;
    // Markdown reads no comment over a blank line, so one that seems to run over one may hide a tag.
    return end <= 0 || holdsBlankLine(text, at, end) ? { kind: "unsure" } : { kind: "skip", end };
  }
  if (next === "/") {
    const nameEnd = tagNameEnd(text, at + 2);
    if (nameEnd === at + 2) return null;
    const close = closingBracket(text, nameEnd);
    return close === -1 ? null : { kind: "close", name: text.slice(at + 2, nameEnd).toLowerCase(), end: close + 1 };
  }
  const nameEnd = tagNameEnd(text, at + 1);
  if (nameEnd === at + 1) return null;
  // A name followed by anything else, such as the colon of an autolink, is no tag.
  if (nameEnd < text.length && !TAG_NAME_END.test(text[nameEnd] ?? "")) return null;
  const end = startTagEnd(text, nameEnd);
  return end === -1 ? { kind: "unsure" } : { kind: "open", name: text.slice(at + 1, nameEnd).toLowerCase(), end };
}

/** Where the tag name that starts at this offset ends: the offset itself when no letter starts one. */
function tagNameEnd(text: string, from: number): number {
  if (!LETTER.test(text[from] ?? "")) return from;
  let at = from + 1;
  while (at < text.length && NAME_CHARACTER.test(text[at] ?? "")) {
    at++;
  }
  return at;
}

/**
 * The offset after the end of a comment whose `<!--` ends just before this
 * offset, as HTML ends one, or -1 when it does not end.
 */
function commentEnd(text: string, from: number): number {
  if (text[from] === ">") return from + 1;
  if (text.startsWith("->", from)) return from + 2;
  COMMENT_END.lastIndex = from;
  const match = COMMENT_END.exec(text);
  return match === null ? -1 : match.index + match[0].length;
}

/** The offset of the `>` that ends an end tag after its name, with only white space before it and no blank line, or -1. */
function closingBracket(text: string, from: number): number {
  for (let at = from; at < text.length; at++) {
    const character = text[at];
    if (character === ">") return at;
    if (character === "\n" && blankLineAt(text, at + 1)) return -1;
    if (character !== " " && character !== "\t" && character !== "\n") return -1;
  }
  return -1;
}

/**
 * The offset after the `>` that ends a start tag whose name ends at this
 * offset, read as HTML reads one, or -1 when the reading is unsure of it.
 * A quote opens a value only after `=`.
 */
function startTagEnd(text: string, from: number): number {
  let quote = "";
  let valueNext = false;
  for (let at = from; at < text.length; at++) {
    const character = text[at];
    if (character === "\n" && blankLineAt(text, at + 1)) return -1;
    if (quote !== "") {
      if (character === quote) quote = "";
      continue;
    }
    if (character === ">") return at + 1;
    if (character === "<") return -1;
    if ((character === "\"" || character === "'") && valueNext) {
      quote = character;
      valueNext = false;
    } else if (character === "=") {
      valueNext = true;
    } else if (character !== " " && character !== "\t" && character !== "\n") {
      valueNext = false;
    }
  }
  return -1;
}

/** Whether a blank line starts after a line break between these two offsets. */
function holdsBlankLine(text: string, from: number, to: number): boolean {
  for (let at = from; at < to; at++) {
    if (text[at] === "\n" && blankLineAt(text, at + 1)) return true;
  }
  return false;
}

/** Whether the line that starts at this offset is blank, or the text has ended. */
function blankLineAt(text: string, from: number): boolean {
  let at = from;
  while (text[at] === " " || text[at] === "\t") {
    at++;
  }
  return at >= text.length || text[at] === "\n";
}

/**
 * The offset of the end tag that ends raw text of this element, in the text
 * in lower case, or -1 when none does: `</`, the name, and white space, `/`
 * or `>`.
 */
function rawTextEnd(lower: string, name: string, from: number): number {
  const opening = `</${name}`;
  let at = lower.indexOf(opening, from);
  while (at !== -1 && !TAG_NAME_END.test(lower[at + opening.length] ?? "")) {
    at = lower.indexOf(opening, at + 1);
  }
  return at;
}

/**
 * Where a link's destination and title end, from the offset after its `](`:
 * after the `)` that closes the `(`, at a blank line, or at the end of the
 * text. A quote runs to the next quote of its kind, which may reach further
 * than a renderer would.
 */
function linkTailEnd(text: string, from: number): number {
  let depth = 1;
  let quote = "";
  for (let at = from; at < text.length; at++) {
    const character = text[at];
    if (character === "\n" && blankLineAt(text, at + 1)) return at;
    if (quote !== "") {
      if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;
      if (depth === 0) return at + 1;
    }
  }
  return text.length;
}

/**
 * The lines where an end tag closes nothing opened before them, as far as
 * the rule can tell. One is a line a link definition's destination may
 * stand on: each line whose shown text starts with `[` and holds `]:`, and
 * the line after it. Another is a line of a table, up to the next blank
 * line, as a row needs no pipe: there an end tag stands in a cell, and HTML
 * closes nothing outside a cell from inside it.
 */
function linesClosingNothing(lines: readonly string[], markup: readonly string[], blocks: ReadonlyMap<number, { kind: string }>): Uint8Array {
  const flags = new Uint8Array(markup.length + 1);
  let table = false;
  for (const [index, line] of markup.entries()) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("[") && trimmed.includes("]:")) {
      flags[index] = 1;
      flags[index + 1] = 1;
    }
    if (BLANK.test(lines[index] ?? "")) table = false;
    if (blocks.get(index)?.kind === "table") table = true;
    if (table) flags[index] = 1;
  }
  return flags;
}

/**
 * Which lines may hold a start tag the structural reading hides. Markdown
 * is not read inside an HTML block, which runs from a line that starts with
 * a tag to the next blank line, but the structural reading does not know
 * that. Inside one it can take a tag in backticks for code, or a fence for
 * code, and hide a tag HTML reads. So in each run of lines that are not
 * blank, from a shown line that starts with `<`, a line whose source holds
 * more start tags than its shown text is marked.
 */
function hiddenOpenings(lines: readonly string[], markup: readonly string[]): Uint8Array {
  const hidden = new Uint8Array(lines.length);
  let mayBeHtml = false;
  for (const [index, line] of lines.entries()) {
    if (BLANK.test(line)) {
      mayBeHtml = false;
      continue;
    }
    const shown = markup[index] ?? "";
    if (!BLANK.test(shown) && MAY_START_HTML.test(line)) mayBeHtml = true;
    if (mayBeHtml && startTagCount(line) > startTagCount(shown)) hidden[index] = 1;
  }
  return hidden;
}

/** How many places in a line `<` and a tag name stand, as a start tag starts. */
function startTagCount(line: string): number {
  let count = 0;
  for (let at = line.indexOf("<"); at !== -1; at = line.indexOf("<", at + 1)) {
    const end = tagNameEnd(line, at + 1);
    if (end > at + 1 && (end === line.length || TAG_NAME_END.test(line[end] ?? ""))) count++;
  }
  return count;
}

/**
 * Whether each line between two lines, counted from 1, is blank. The later
 * alert has a blank line above it, so at least one stands between.
 */
function onlyBlankBetween(lines: readonly string[], end: number, line: number): boolean {
  for (let index = end; index < line - 1; index++) {
    if (!BLANK.test(lines[index] ?? "")) return false;
  }
  return true;
}
