// The text a reader sees in a Markdown file whose markup has been taken out,
// for the value search of the two-version comparison.
//
// The search once removed each tag as the expression /<[^<>]*>/ reads one.
// So a `>` inside a quoted attribute ended the tag early, and text a reader
// sees whole was missed (review R2-1 on pull request 85). Here markup is read
// as the HTML tokenizer reads it. A quoted attribute value runs to its closing
// quote. A comment runs to `-->` or `--!>`. The content of a raw text element,
// such as `script`, runs to its end tag.
//
// What counts as text is what a page's text content holds, as a browser that
// runs scripts builds it. Tags and comments are not text. Nor is the content
// of `script`, `style`, `title`, `iframe`, `noembed`, `noframes` and
// `noscript`, which such a browser never shows. The content of `textarea`,
// `xmp` and `plaintext` is text, and so is text that other elements,
// attributes or styles hide, such as the content of `template`. Text is read
// in the order the file writes it, though a browser moves some, as from
// inside a table to before it. A tag is removed with nothing in its place, so
// `np<b>m</b>` reads as `npm`. Character references are decoded in text, as
// HTML decodes them, and not inside markup.
//
// A Markdown file is not all HTML, so it is read twice. Read as HTML, every
// `<` the tokenizer reads as markup is markup. Read as Markdown, the file is
// read as CommonMark passes it to a browser: quotation and list markers are
// taken off, code spans and code blocks show their text as written,
// backslash escapes are read, an HTML block is read as HTML, and in prose
// only markup of CommonMark's form is markup. For the value search the file
// is read a third time, as HTML once each line's quotation and list markers,
// and a backslash that ends a line, are taken off, because a browser is never
// given them. A value is held when any reading holds it, so where the
// readings disagree it is treated as held.
//
// Markup is read only inside its block. A block runs to the next blank line,
// or, for a raw HTML block that CommonMark lets hold blank lines, to the line
// that ends it. In the Markdown reading a block also ends where CommonMark
// ends a quotation or opens a deeper one. Markup that does not end inside its
// block is read as text, so a stray `<` in prose deletes nothing after it,
// with these exceptions. The content of an element a browser never shows runs
// to its end tag wherever that stands, as a browser hides it. And in the
// Markdown reading a tag an HTML block leaves open ends with the block,
// because the markup CommonMark writes next closes it, and a comment the
// block leaves open runs on to its end wherever that stands, as a browser
// reads it on.
//
// Markup left open across the end of a block is read on by a browser into
// whatever CommonMark writes next, and what that is turns on Markdown's
// containers, which these readings do not follow. So the value search holds
// every value of a file in doubt in this way. The Markdown reading finds the
// doubt where markup does not end in the block it opens in: a tag, comment
// or other markup an HTML block leaves open, the content of an element read
// to its end tag where that tag is not in the block, unless it runs to the end
// of the file, and `plaintext`. It finds it too where an HTML block or a fence
// opens inside a list item or a quotation and a line before its end falls out
// of the container, because the container's end then ends the block first.
//
// The work grows in proportion to the file. Each character is looked at a
// fixed number of times, and `steps` counts every look, so a test can hold
// the count to its bound.

import entities from "./html-entities.json";
import { decodeEntities } from "./inline-wording.ts";
import { codeSpanEnds } from "./parse.ts";

/** The most looks at a character reading one file may take, for each character, both readings together. */
export const STEPS_PER_CHARACTER = 64;

/**
 * The text a reader sees in a file, read as HTML and read as Markdown, as
 * this module's opening comment describes. One text is given when the two
 * readings agree.
 *
 * @param source The whole file.
 * @param steps Counts each look at a character, when given.
 */
export function readerTexts(source: string, steps: { count: number } = { count: 0 }): string[] {
  return readTwice(source, steps).texts;
}

/** What the value search reads of a file, as `valueReading` gives it. */
export interface ValueReading {
  /** The texts a reader may see: those `readerTexts` gives, then the file read as HTML with its line marks taken off, when that differs. */
  readonly texts: readonly string[];
  /** Whether markup left open across the end of a block puts what a reader sees in doubt, so every value is held. */
  readonly inDoubt: boolean;
}

/**
 * What the value search reads of a file: the two readings, the third reading
 * of HTML with each line's quotation and list markers and a backslash that
 * ends a line taken off, and whether the file is in doubt, as this module's
 * opening comment describes.
 *
 * @param source The whole file.
 * @param steps Counts each look at a character, when given.
 */
export function valueReading(source: string, steps: { count: number } = { count: 0 }): ValueReading {
  const twice = readTwice(source, steps);
  steps.count += twice.text.length;
  const unmarked = withoutLineMarks(twice.text);
  const asUnmarked = readAsHtml(unmarked, unmarked.replace(/[A-Z]+/g, upper => upper.toLowerCase()), steps);
  return { texts: twice.texts.includes(asUnmarked) ? twice.texts : [...twice.texts, asUnmarked], inDoubt: twice.inDoubt };
}

/** The two readings of a file, the file with its line endings made `\n`, and whether the Markdown reading found it in doubt. */
function readTwice(source: string, steps: { count: number }): { text: string; texts: string[]; inDoubt: boolean } {
  const text = source.replace(/\r\n?/g, "\n");
  const lower = text.replace(/[A-Z]+/g, upper => upper.toLowerCase());
  const asHtml = readAsHtml(text, lower, steps);
  const asMarkdown = readAsMarkdown(text, lower, steps);
  return { text, texts: asMarkdown.read === asHtml ? [asHtml] : [asHtml, asMarkdown.read], inDoubt: asMarkdown.inDoubt };
}

/** What the content of an element the tokenizer reads to its end tag is to a reader. */
type RawText = "hidden" | "shown" | "decoded" | "script" | "plaintext";

/** The elements whose content the tokenizer reads as text to their end tag, and what that content is. */
const RAW_TEXT: ReadonlyMap<string, RawText> = new Map<string, RawText>([
  ["script", "script"], ["style", "hidden"], ["iframe", "hidden"], ["noembed", "hidden"], ["noframes", "hidden"],
  ["noscript", "hidden"], ["title", "hidden"], ["xmp", "shown"], ["textarea", "decoded"], ["plaintext", "plaintext"],
]);

/**
 * The names of the character references HTML decodes without a closing
 * semicolon. They are the names in the HTML standard's table that parse5
 * 7.3.0 decodes whole when written without one, and there are 106.
 */
const LEGACY_REFERENCES: ReadonlySet<string> = new Set([
  "Aacute", "aacute", "Acirc", "acirc", "acute", "AElig", "aelig", "Agrave", "agrave", "AMP", "amp", "Aring", "aring", "Atilde", "atilde",
  "Auml", "auml", "brvbar", "Ccedil", "ccedil", "cedil", "cent", "COPY", "copy", "curren", "deg", "divide", "Eacute", "eacute", "Ecirc",
  "ecirc", "Egrave", "egrave", "ETH", "eth", "Euml", "euml", "frac12", "frac14", "frac34", "GT", "gt", "Iacute", "iacute", "Icirc", "icirc",
  "iexcl", "Igrave", "igrave", "iquest", "Iuml", "iuml", "laquo", "LT", "lt", "macr", "micro", "middot", "nbsp", "not", "Ntilde", "ntilde",
  "Oacute", "oacute", "Ocirc", "ocirc", "Ograve", "ograve", "ordf", "ordm", "Oslash", "oslash", "Otilde", "otilde", "Ouml", "ouml", "para",
  "plusmn", "pound", "QUOT", "quot", "raquo", "REG", "reg", "sect", "shy", "sup1", "sup2", "sup3", "szlig", "THORN", "thorn", "times",
  "Uacute", "uacute", "Ucirc", "ucirc", "Ugrave", "ugrave", "uml", "Uuml", "uuml", "Yacute", "yacute", "yen", "yuml",
]);

/** The longest name in `LEGACY_REFERENCES`. */
const LONGEST_LEGACY = 6;

/** The characters HTML gives numeric references from 128 to 159, as Windows-1252 has them; the rest stand for themselves. */
const WINDOWS_1252: ReadonlyMap<number, number> = new Map([
  [0x80, 0x20AC], [0x82, 0x201A], [0x83, 0x0192], [0x84, 0x201E], [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02C6],
  [0x89, 0x2030], [0x8A, 0x0160], [0x8B, 0x2039], [0x8C, 0x0152], [0x8E, 0x017D], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201C],
  [0x94, 0x201D], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x02DC], [0x99, 0x2122], [0x9A, 0x0161], [0x9B, 0x203A],
  [0x9C, 0x0153], [0x9E, 0x017E], [0x9F, 0x0178],
]);

/** The character HTML puts in place of a reference to no character. */
const REPLACEMENT = String.fromCodePoint(0xFFFD);

// The states of a tag after its `<` and first letter, as the HTML tokenizer
// names them, and CLOSED for the `>` that ends it.
const TAG_NAME = 0;
const BEFORE_NAME = 1;
const NAME = 2;
const AFTER_NAME = 3;
const BEFORE_VALUE = 4;
const DOUBLE_QUOTED = 5;
const SINGLE_QUOTED = 6;
const UNQUOTED = 7;
const AFTER_QUOTED = 8;
const SELF_CLOSING = 9;
const TAG_STATES = 10;
const CLOSED = -2;

// The states of an open tag as CommonMark's grammar for raw HTML reads it,
// after its `<` and first letter, and FAILED for a character it does not
// allow there.
const CM_TAG_NAME = 0;
const CM_SPACE = 1;
const CM_NAME = 2;
const CM_AFTER_NAME = 3;
const CM_BEFORE_VALUE = 4;
const CM_UNQUOTED = 5;
const CM_DOUBLE_QUOTED = 6;
const CM_SINGLE_QUOTED = 7;
const CM_AFTER_QUOTED = 8;
const CM_SLASH = 9;
const CM_STATES = 10;
const FAILED = -3;

// The states of a script's content, each a bit so a place can keep every
// state found to reach no end tag.
const SCRIPT_DATA = 1;
const SCRIPT_ESCAPED = 2;
const SCRIPT_DOUBLE_ESCAPED = 4;

/** The white space that ends a tag's name, as the HTML tokenizer reads it. */
const TAG_SPACE = /[\t\n\f ]/;

/**
 * What may stand before the `<` that opens an HTML block, as CommonMark has
 * it: quotation and list markers, then at most three spaces.
 */
const CONTAINER_PREFIX = /^(?: {0,3}(?:> ?|(?:[-+*]|\d{1,9}[.)])[ \t]+))* {0,3}/;

/** The opening of an HTML block of CommonMark's kind 6: a block element's start or end tag, as commonmark.js 0.31.2 lists them. */
const BLOCK_TAG = /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t]|\/?>|$)/;

/** The list markers that open a line, each with the spaces after it. */
const LIST_MARKERS = /^(?: {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+)+/;

/** The quotation and list markers that open each line, as the third reading takes them off. */
const LINE_MARKS = /^(?: {0,3}(?:> ?|(?:[-+*]|\d{1,9}[.)])[ \t]+))+/gm;

/** A file with each line's quotation and list markers, and a backslash that ends a line, made spaces, for the third reading. */
function withoutLineMarks(text: string): string {
  return text.replace(LINE_MARKS, marks => " ".repeat(marks.length)).replace(/\\(?=\n)/g, " ");
}

/** What stands before a fence on its line: spaces, tabs, quotation markers and list markers. */
const FENCE_PREFIX = /^(?:[ \t>]|[-+*][ \t]|\d{1,9}[.)][ \t])*/;

/** The quotation markers that open a line, as a fence's later lines are read for them. */
const QUOTE_MARKERS = / {0,3}> ?/y;

/** What may follow the name of an end tag that closes a raw text element. */
const END_TAG_FOLLOWER = /[\t\n\f />]/;

/**
 * The file as the Markdown reading searches it for markup: in lower case,
 * with each code span, each code block and each `<` a backslash escapes made
 * spaces, because none of them is markup a browser is given.
 */
function markdownView(lower: string, code: ReadonlyArray<{ start: number; end: number }>): string {
  let view = "";
  let from = 0;
  for (const literal of [...code, { start: lower.length, end: lower.length }]) {
    view += lower.slice(from, literal.start).replace(/(?<!\\)((?:\\\\)*)\\</g, "$1  ") + " ".repeat(literal.end - literal.start);
    from = literal.end;
  }
  return view;
}

/**
 * The file with the quotation and list markers CommonMark takes off each
 * line made spaces, and the lines where the Markdown reading must end a block, because
 * CommonMark ends a quotation or opens a deeper one there and the markup it
 * writes closes a tag left open.
 *
 * Inside an HTML block, a line loses as many markers as its quotation is
 * deep, and any further `>` is the block's HTML. A line with fewer ends the
 * block and its quotation. Elsewhere a line loses every marker. One with more
 * markers than the line before opens a deeper quotation, and one with fewer
 * continues a paragraph, as a lazy line does. Lines of code blocks are left
 * as they are.
 */
function unquote(text: string, lower: string, blocksOfCode: ReadonlyArray<{ start: number; end: number }>, steps: { count: number }): { text: string; cuts: ReadonlySet<number>; fallsOut: boolean } {
  const cuts = new Set<number>();
  let unquoted = "";
  let depth = 0;
  // The marks that end the HTML block a line stands in, none for one a blank line ends, or null outside every HTML block.
  let html: readonly string[] | null = null;
  // How far the HTML block's `<` stands into its line after the quotation's markers, and whether a line before its end falls short of it.
  let column = 0;
  let fallsOut = false;
  let afterBlank = true;
  // Whether a line may open an HTML block of kind 7: after a blank line, or after an HTML block.
  let opensBlock = true;
  let code = 0;
  let line = 0;
  while (line < text.length) {
    const newline = text.indexOf("\n", line);
    const next = newline === -1 ? text.length : newline + 1;
    const lineEnd = newline === -1 ? text.length : newline;
    steps.count += next - line;
    while (code < blocksOfCode.length && (blocksOfCode[code]?.end ?? 0) <= line) {
      code++;
    }
    if ((blocksOfCode[code]?.start ?? text.length) <= line) {
      unquoted += text.slice(line, next);
      line = next;
      continue;
    }
    const markers: number[] = [];
    const marker = / {0,3}> ?/y;
    marker.lastIndex = line;
    while (marker.exec(text) !== null && marker.lastIndex <= lineEnd + 1) {
      markers.push(Math.min(marker.lastIndex, lineEnd));
    }
    let kept = markers.length;
    if (html !== null && markers.length < depth) {
      cuts.add(line);
      html = null;
      depth = markers.length;
      opensBlock = true;
    } else if (html !== null) {
      kept = depth;
    }
    const content = kept === 0 ? line : markers[kept - 1] ?? line;
    // Outside an HTML block, a list item's marker is not text a reader sees either.
    const shown = html !== null ? content : content + (LIST_MARKERS.exec(text.slice(content, lineEnd))?.[0].length ?? 0);
    unquoted += " ".repeat(shown - line) + text.slice(shown, next);
    const blank = /^[ \t]*$/.test(text.slice(content, lineEnd));
    if (html !== null) {
      // A line indented less than the block's `<` falls out of the list item it opened in, which ends the block first.
      if (!blank && (/^[ \t]*/.exec(text.slice(content, lineEnd))?.[0].length ?? 0) < column) fallsOut = true;
      if (html.length === 0 && blank) {
        html = null;
        afterBlank = true;
        opensBlock = true;
      } else if (html.some(mark => lower.slice(content, lineEnd).includes(mark))) {
        html = null;
        opensBlock = true;
      }
      line = next;
      continue;
    }
    if (blank) {
      depth = markers.length;
      afterBlank = true;
      opensBlock = true;
      line = next;
      continue;
    }
    if (markers.length > depth && !afterBlank) cuts.add(line);
    if (markers.length >= depth || opensBlock) depth = markers.length;
    html = htmlBlockOpened(text, lower, content, lineEnd, opensBlock);
    column = CONTAINER_PREFIX.exec(lower.slice(content, lineEnd))?.[0].length ?? 0;
    opensBlock = false;
    // A block of kinds 1 to 5 that ends on the line it opens is over.
    if (html !== null && html.length > 0 && html.some(mark => lower.slice(content + 2, lineEnd).includes(mark))) {
      html = null;
      opensBlock = true;
    }
    afterBlank = false;
    line = next;
  }
  return { text: unquoted, cuts, fallsOut };
}

/**
 * The HTML block a line opens, as CommonMark reads its start: the marks that
 * end one of kinds 1 to 5, none for one of kinds 6 and 7, which a blank line
 * ends, or null when the line opens none. Kind 7, a line holding one whole
 * tag and nothing else, does not interrupt a paragraph, so it is read only
 * after a blank line.
 *
 * @param content Where the line's text starts, after its quotation markers.
 */
function htmlBlockOpened(text: string, lower: string, content: number, lineEnd: number, afterBlank: boolean): readonly string[] | null {
  const at = content + (CONTAINER_PREFIX.exec(lower.slice(content, lineEnd))?.[0].length ?? 0);
  const head = lower.slice(at, Math.min(at + 14, lineEnd));
  if (/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/.test(head)) return ["</script>", "</pre>", "</style>", "</textarea>"];
  if (head.startsWith("<!--")) return ["-->"];
  if (head.startsWith("<?")) return ["?>"];
  if (head.startsWith("<![cdata[")) return ["]]>"];
  if (/^<![a-z]/.test(head)) return [">"];
  if (BLOCK_TAG.test(head)) return [];
  if (!afterBlank || !head.startsWith("<")) return null;
  let close = -1;
  if (/[a-z]/.test(lower.charAt(at + 1))) {
    let state = CM_TAG_NAME;
    for (let place = at + 2; place < lineEnd && close === -1; place++) {
      state = commonMarkStep(state, text.charAt(place));
      if (state === FAILED) return null;
      if (state === CLOSED) close = place + 1;
    }
  } else if (/^<\/[a-z][a-z0-9-]*[ \t]*>/.test(lower.slice(at, lineEnd))) {
    close = at + (/^<\/[a-z][a-z0-9-]*[ \t]*>/.exec(lower.slice(at, lineEnd))?.[0].length ?? 0);
  }
  return close !== -1 && /^[ \t]*$/.test(text.slice(close, lineEnd)) ? [] : null;
}

/**
 * The code spans and code blocks of a Markdown file, in order, each with the
 * text it shows: a code span's content, its line endings made spaces and one
 * space taken from each end where both have one, and a code block's as
 * `codeBlocks` gives it.
 */
function literalCode(text: string, blocksOfCode: ReadonlyArray<{ start: number; end: number; shown: string }>, steps: { count: number }): Array<{ start: number; end: number; shown: string }> {
  const code: Array<{ start: number; end: number; shown: string }> = [];
  let from = 0;
  for (const fence of [...blocksOfCode, { start: text.length, end: text.length, shown: "" }]) {
    // Code spans do not cross a blank line, so each paragraph is read for them on its own.
    for (const paragraph of text.slice(from, fence.start).split(/(?<=\n[ \t]*\n)/)) {
      steps.count += paragraph.length;
      const spans = [...codeSpanEnds(paragraph)].sort((first, second) => first[0] - second[0]);
      for (const [start, end] of spans) {
        const ticks = tickRunLength(paragraph, start);
        let content = paragraph.slice(start + ticks, end - ticks).replaceAll("\n", " ");
        if (content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "") content = content.slice(1, -1);
        code.push({ start: from + start, end: from + end, shown: content });
      }
      from += paragraph.length;
    }
    if (fence.end > fence.start) code.push(fence);
    from = fence.end;
  }
  return code;
}

/** How many backticks stand in a row from `start`. */
function tickRunLength(text: string, start: number): number {
  let end = start;
  while (text[end] === "`") {
    end++;
  }
  return end - start;
}

/**
 * The fenced and indented code blocks of a file, each from its first line to
 * the end of its last, with the text it shows. A fence runs to the end of its
 * closing fence's line, or to the end of the file, and shows its content
 * lines. Indented code is a run of lines indented four columns or more,
 * after a blank line, another such line or the start of the file, and shows
 * them without those columns. Spaces, tabs, quotation markers and list
 * markers may stand before a fence.
 *
 * `fallsOut` is true when a fence opens behind such marks and a line up to
 * its closing fence falls out of the container: it holds fewer quotation
 * markers than the fence's line, or, past them, is not blank and is indented
 * less than the fence stands.
 */
function codeBlocks(text: string, steps: { count: number }): { blocks: Array<{ start: number; end: number; shown: string }>; fallsOut: boolean } {
  const found: Array<{ start: number; end: number; shown: string }> = [];
  const prefix = FENCE_PREFIX;
  let fallsOut = false;
  let line = 0;
  let open: { start: number; mark: string; shown: string; quotes: number; column: number } | null = null;
  let indented: { start: number; end: number; shown: string } | null = null;
  let afterBlank = true;
  while (line < text.length) {
    const newline = text.indexOf("\n", line);
    const next = newline === -1 ? text.length : newline + 1;
    const content = text.slice(line, next);
    steps.count += content.length;
    const blank = content.trim() === "";
    const stripped = content.slice(prefix.exec(content)?.[0].length ?? 0);
    const fence = /^(`{3,}|~{3,})/.exec(stripped)?.[1];
    const indent = /^(?: {4}| {0,3}\t)/.exec(content)?.[0];
    if (open !== null) {
      if (open.quotes > 0 || open.column > 0) fallsOut ||= fallsOutOf(content, open.quotes, open.column);
      if (fence !== undefined && fence.startsWith(open.mark.charAt(0)) && fence.length >= open.mark.length && stripped.slice(fence.length).trim() === "") {
        found.push({ start: open.start, end: next, shown: open.shown });
        open = null;
      } else {
        open.shown += content;
      }
    } else if (indent !== undefined && !blank && (afterBlank || indented !== null)) {
      indented ??= { start: line, end: next, shown: "" };
      indented.end = next;
      indented.shown += content.slice(indent.length);
    } else {
      if (indented !== null) found.push(indented);
      indented = null;
      if (fence !== undefined && !(fence.startsWith("`") && stripped.slice(fence.length).includes("`"))) {
        const before = content.slice(0, content.length - stripped.length);
        const quotes = quotationMarkers(before);
        open = { start: line, mark: fence, shown: "", quotes: quotes.count, column: before.length - quotes.width };
      }
    }
    afterBlank = blank;
    line = next;
  }
  if (indented !== null) found.push(indented);
  if (open !== null) found.push({ start: open.start, end: text.length, shown: open.shown });
  return { blocks: found, fallsOut };
}

/** How many quotation markers open a line, as many as `most` at most, and how wide they are. */
function quotationMarkers(line: string, most = Number.POSITIVE_INFINITY): { count: number; width: number } {
  let count = 0;
  let width = 0;
  QUOTE_MARKERS.lastIndex = 0;
  while (count < most && QUOTE_MARKERS.exec(line) !== null) {
    count++;
    width = QUOTE_MARKERS.lastIndex;
  }
  return { count, width };
}

/**
 * Whether a line inside a fence falls out of the container the fence opened
 * in: it holds fewer than `quotes` quotation markers, or past them it is not
 * blank and is indented less than `column`.
 */
function fallsOutOf(line: string, quotes: number, column: number): boolean {
  const markers = quotationMarkers(line, quotes);
  if (markers.count < quotes) return true;
  const rest = line.slice(markers.width).replace(/\n$/, "");
  return rest.trim() !== "" && (/^[ \t]*/.exec(rest)?.[0].length ?? 0) < column;
}

/**
 * The next place a mark stands in a text. Each answer is kept, so a search
 * from a later place starts where the last one stopped.
 */
class Finder {
  private asked = -1;
  private answer = -1;

  constructor(private readonly text: string, private readonly mark: string, private readonly steps: { count: number }) {}

  /** The first place at or after `from` where the mark stands, or -1 for none. */
  from(from: number): number {
    if (this.asked !== -1 && from >= this.asked && (this.answer === -1 || from <= this.answer)) return this.answer;
    const found = this.text.indexOf(this.mark, from);
    this.steps.count += (found === -1 ? this.text.length : found + this.mark.length) - from;
    this.asked = from;
    this.answer = found;
    return found;
  }
}

/**
 * One reading of a file, left to right. Every search for the next place a
 * mark stands is kept, and asked again only from a later place, so each
 * character is read a fixed number of times however the file is split.
 */
class Pass {
  private readonly nextLess: Finder;
  private readonly nextNewline: Finder;
  private readonly nextGreater: Finder;
  private readonly nextCommentEnd: Finder;
  private readonly nextCommentBang: Finder;
  private readonly nextInstructionEnd: Finder;
  private readonly nextCdataEnd: Finder;
  private readonly endTags = new Map<string, Finder>();
  private readonly finders = new Map<string, Finder>();
  /** Whether the stretch being read is prose of the Markdown reading, whose markup is read as CommonMark passes it to a browser. */
  private commonMark = false;
  /**
   * Whether the stretch being read is an HTML block of the Markdown reading,
   * where a comment left open runs on past the block, as `through` reads it.
   */
  private runOn = false;
  /** The last place asked about, and the next blank line from it or -1, as `passedComment` keeps them. */
  private blankAsked = -1;
  private blankAnswer = -1;
  /** Where the comment CommonMark passed whole that a script's content entered ends, or -1, as `scriptEnd` leaves it. */
  private passedUntil = -1;
  /** For each place in a script's content, the states found to reach no end tag from it. */
  private readonly scriptDeadEnds: Uint8Array;
  /** Whether markup read here did not end in the block it opened in, as this module's opening comment describes the doubt. */
  leftOpen = false;

  /**
   * @param text The text read: the file, or for the Markdown reading the
   *     file with its quotation markers made spaces.
   * @param lower The text as markup is searched for in it: in lower case, and
   *     for the Markdown reading with code made spaces, as `markdownView` gives.
   * @param written The file in lower case, as written, to find its quotation
   *     and list markers in.
   * @param cuts The lines before which a block ends, as `unquote` gives them.
   */
  constructor(readonly text: string, private readonly lower: string, private readonly written: string, readonly steps: { count: number }, private readonly cuts: ReadonlySet<number> = new Set()) {
    this.nextLess = new Finder(lower, "<", steps);
    this.nextNewline = new Finder(lower, "\n", steps);
    this.nextGreater = new Finder(lower, ">", steps);
    this.nextCommentEnd = new Finder(lower, "-->", steps);
    this.nextCommentBang = new Finder(lower, "--!>", steps);
    this.nextInstructionEnd = new Finder(lower, "?>", steps);
    this.nextCdataEnd = new Finder(lower, "]]>", steps);
    this.scriptDeadEnds = new Uint8Array(text.length + 1);
  }

  /**
   * The blocks of a stretch of the file: each runs to the end of the next
   * blank line. One holding a line that opens a raw HTML block of a kind
   * CommonMark lets hold blank lines runs on to the end of the line that
   * closes it, or to the end of the stretch.
   *
   * A block also ends before each line in `cuts`, as `unquote` gives them.
   */
  blocks(start: number, end: number): Array<{ start: number; end: number }> {
    const found: Array<{ start: number; end: number }> = [];
    let blockStart = start;
    let line = start;
    let rawUntil = -1;
    while (line < end) {
      const newline = this.nextNewline.from(line);
      const lineEnd = newline === -1 || newline >= end ? end : newline;
      const next = Math.min(lineEnd + 1, end);
      this.steps.count += next - line;
      if (this.cuts.has(line) && line > blockStart) {
        found.push({ start: blockStart, end: line });
        blockStart = line;
        rawUntil = -1;
      }
      if (line >= rawUntil && /^[ \t]*$/.test(this.text.slice(line, lineEnd))) {
        found.push({ start: blockStart, end: next });
        blockStart = next;
      } else if (line >= rawUntil) {
        rawUntil = this.rawBlockEnd(line, lineEnd, end) ?? -1;
      }
      line = next;
    }
    if (blockStart < end) found.push({ start: blockStart, end });
    return found;
  }

  /**
   * What a reader sees of one block read as HTML: its text with markup taken
   * out and character references decoded. Content no browser shows may run
   * past the block's end, and `resume` is where the reading goes on, the
   * block's end or later.
   */
  readAsHtml(start: number, end: number): { read: string; resume: number } {
    return this.readStretch(start, end, false);
  }

  /**
   * What a reader sees of one block read as Markdown, as `readAsHtml` gives
   * it. Its lines before one that opens an HTML block are prose, whose markup
   * is read as CommonMark passes it to a browser. The HTML block is read as
   * the HTML tokenizer reads it, because a browser is given it as written.
   * One of CommonMark's kinds 6 and 7 runs to the end of the block, and one
   * of kinds 1 to 5 to the end of the line that closes it. A tag the HTML
   * block leaves open ends with it, because the markup CommonMark writes next
   * closes it. CommonMark shows a tag that prose leaves open as text.
   */
  readAsMarkdown(start: number, end: number): { read: string; resume: number } {
    let read = "";
    let stretch = start;
    let line = start;
    // Only a line that opens a block, or follows an HTML block, may open one of kind 7.
    let opensBlock = true;
    // Reading that starts where hidden content ended may start partway through a line, which opens no HTML block there.
    let partway = start > 0 && this.text.charAt(start - 1) !== "\n";
    while (line < end) {
      const newline = this.nextNewline.from(line);
      const lineEnd = newline === -1 || newline >= end ? end : newline;
      const htmlEnd = partway ? null : this.rawBlockEnd(line, lineEnd, end) ?? (this.opensHtmlBlock(line, lineEnd, opensBlock) ? end : null);
      partway = false;
      if (htmlEnd === null) {
        opensBlock = false;
        line = Math.min(lineEnd + 1, end);
        continue;
      }
      const prose = this.readStretch(stretch, line, true);
      read += prose.read;
      if (prose.resume >= end) return { read, resume: prose.resume };
      // The markup CommonMark writes after an HTML block closes a tag the block leaves open.
      const html = this.readStretch(Math.max(line, prose.resume), Math.max(htmlEnd, prose.resume), false, true);
      read += html.read;
      if (html.resume >= end) return { read, resume: html.resume };
      stretch = html.resume;
      line = html.resume;
      opensBlock = true;
      partway = this.text.charAt(line - 1) !== "\n";
    }
    const prose = this.readStretch(stretch, end, true);
    return { read: read + prose.read, resume: prose.resume };
  }

  /**
   * What a reader sees of a stretch of one block, read as CommonMark prose
   * or as HTML, as `readAsHtml` gives it.
   */
  private readStretch(start: number, end: number, commonMark: boolean, cut = false): { read: string; resume: number } {
    if (start >= end) return { read: "", resume: Math.max(start, end) };
    this.commonMark = commonMark;
    this.runOn = cut && !commonMark;
    const decode = commonMark ? decodeMarkdown : decodeHtml;
    let closes: Int32Array | null = null;
    let read = "";
    let pending = start;
    let at = this.nextLess.from(start);
    while (at !== -1 && at < end) {
      this.steps.count += 1;
      closes ??= commonMark ? commonMarkCloses(this.text, start, end, this.steps) : tagCloses(this.text, start, end, cut, this.steps);
      const markup = commonMark ? this.commonMarkAt(at, start, end, closes) : this.markupAt(at, start, end, closes);
      if (markup !== null) {
        read += decode(this.text.slice(pending, at)) + markup.shown;
        pending = markup.end;
        if (markup.end > end) {
          this.leftOpen = true;
          return { read, resume: markup.end };
        }
      }
      at = this.nextLess.from(markup === null ? at + 1 : markup.end);
    }
    this.steps.count += end - start;
    return { read: read + decode(this.text.slice(pending, end)), resume: end };
  }

  /**
   * Whether this line opens an HTML block of CommonMark's kind 6, a line
   * opening with a block element's tag, or, where `opensBlock` allows, kind
   * 7, a line holding one whole tag of CommonMark's form and nothing else.
   */
  private opensHtmlBlock(line: number, lineEnd: number, opensBlock: boolean): boolean {
    const at = line + (CONTAINER_PREFIX.exec(this.written.slice(line, lineEnd))?.[0].length ?? 0);
    if (this.lower.charAt(at) !== "<") return false;
    if (BLOCK_TAG.test(this.lower.slice(at, Math.min(at + 14, lineEnd)))) return true;
    if (!opensBlock) return false;
    let close = -1;
    if (/[a-z]/.test(this.lower.charAt(at + 1))) {
      let state = CM_TAG_NAME;
      for (let place = at + 2; place < lineEnd && close === -1; place++) {
        this.steps.count += 1;
        state = commonMarkStep(state, this.text.charAt(place));
        if (state === FAILED) return false;
        if (state === CLOSED) close = place + 1;
      }
    } else if (this.lower.charAt(at + 1) === "/") {
      close = this.closingTagEnd(at + 2, lineEnd);
    }
    return close !== -1 && /^[ \t]*$/.test(this.text.slice(close, lineEnd));
  }

  /**
   * Where a raw HTML block that may hold blank lines ends, when this line
   * opens one: after the line holding its end, as CommonMark's kinds 1 to 5
   * of HTML block end, or at the end of the stretch. Null when the line opens
   * none.
   */
  private rawBlockEnd(line: number, lineEnd: number, end: number): number | null {
    const at = line + (CONTAINER_PREFIX.exec(this.written.slice(line, lineEnd))?.[0].length ?? 0);
    const head = this.lower.slice(at, Math.min(at + 10, lineEnd));
    let closing: readonly string[] = [];
    if (/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/.test(head)) {
      closing = ["</script>", "</pre>", "</style>", "</textarea>"];
    } else if (head.startsWith("<!--")) {
      closing = ["-->"];
    } else if (head.startsWith("<?")) {
      closing = ["?>"];
    } else if (head.startsWith("<![cdata[")) {
      closing = ["]]>"];
    } else if (/^<![a-z]/.test(head)) {
      closing = [">"];
    }
    if (closing.length === 0) return null;
    let close = -1;
    for (const mark of closing) {
      const found = this.finder(mark).from(at + 2);
      if (found !== -1 && (close === -1 || found + mark.length < close)) close = found + mark.length;
    }
    if (close === -1 || close > end) return end;
    const newline = this.nextNewline.from(close);
    return newline === -1 || newline >= end ? end : newline + 1;
  }

  /** The finder of the next place `mark` stands in the searched text, made the first time it is asked for. */
  private finder(mark: string): Finder {
    let found = this.finders.get(mark);
    if (found === undefined) {
      found = new Finder(this.lower, mark, this.steps);
      this.finders.set(mark, found);
    }
    return found;
  }

  /**
   * The markup that opens with the `<` at `at`, as where it ends and what of
   * it a reader sees, or null when the `<` is text: when it opens no markup,
   * or markup that does not end before `end`.
   */
  private markupAt(at: number, start: number, end: number, closes: Int32Array): { end: number; shown: string } | null {
    const next = this.text.charAt(at + 1);
    if (/[A-Za-z]/.test(next)) {
      const close = this.noteCut(tagClose(closes, start, end, at + 2), end);
      return close === -1 ? null : this.contentAfter(at, close, start, end, closes);
    }
    if (next === "/") {
      const after = this.text.charAt(at + 2);
      if (/[A-Za-z]/.test(after)) {
        const close = this.noteCut(tagClose(closes, start, end, at + 3), end);
        return close === -1 ? null : { end: close, shown: "" };
      }
      if (after === ">") return at + 3 <= end ? { end: at + 3, shown: "" } : null;
      return after === "" ? null : this.through(this.nextGreater, at + 2, end, 1);
    }
    if (next === "!") {
      if (!this.text.startsWith("--", at + 2)) return this.through(this.nextGreater, at + 2, end, 1);
      // `<!-->` and `<!--->` are whole comments.
      if (this.text.startsWith(">", at + 4)) return at + 5 <= end ? { end: at + 5, shown: "" } : null;
      if (this.text.startsWith("->", at + 4)) return at + 6 <= end ? { end: at + 6, shown: "" } : null;
      const ending = this.nextCommentEnd.from(at + 4);
      const bang = this.nextCommentBang.from(at + 4);
      if (ending === -1) return this.closedBy(bang === -1 ? -1 : bang + 4, end);
      return this.closedBy(bang === -1 || ending < bang ? ending + 3 : bang + 4, end);
    }
    return next === "?" ? this.through(this.nextGreater, at + 1, end, 1) : null;
  }

  /**
   * A tag's end as `tagClose` gives it, noting that the tag was left open
   * when, in an HTML block of the Markdown reading, the block's end closes it
   * or it does not end in the block.
   */
  private noteCut(close: number, end: number): number {
    if (this.runOn && (close === -1 || close === end && this.text.charAt(end - 1) !== ">")) this.leftOpen = true;
    return close;
  }

  /**
   * The raw HTML that opens with the `<` at `at`, read as CommonMark's
   * grammar for it reads it, or null when the `<` is text.
   */
  private commonMarkAt(at: number, start: number, end: number, closes: Int32Array): { end: number; shown: string } | null {
    const next = this.text.charAt(at + 1);
    if (/[A-Za-z]/.test(next)) {
      const close = tagClose(closes, start, end, at + 2);
      return close === -1 ? null : this.contentAfter(at, close, start, end, closes);
    }
    if (next === "/") {
      const close = this.closingTagEnd(at + 2, end);
      return close === -1 ? null : { end: close, shown: "" };
    }
    if (next === "!") {
      if (this.text.startsWith("--", at + 2)) {
        // `<!-->` and `<!--->` are whole comments.
        if (this.text.startsWith(">", at + 4)) return at + 5 <= end ? { end: at + 5, shown: "" } : null;
        if (this.text.startsWith("->", at + 4)) return at + 6 <= end ? { end: at + 6, shown: "" } : null;
        return this.asBrowserReads(this.through(this.nextCommentEnd, at + 4, end, 3), at);
      }
      if (this.lower.startsWith("[cdata[", at + 2)) return this.asBrowserReads(this.through(this.nextCdataEnd, at + 9, end, 3), at);
      return /[A-Za-z]/.test(this.text.charAt(at + 2)) ? this.through(this.nextGreater, at + 2, end, 1) : null;
    }
    return next === "?" ? this.asBrowserReads(this.through(this.nextInstructionEnd, at + 2, end, 2), at) : null;
  }

  /**
   * Raw HTML that CommonMark passes whole, with what a browser shows of it.
   * A browser ends a comment at `--!>` as well as `-->`, and a processing
   * instruction or a CDATA section at its first `>`, so text after that end
   * shows. The text is read as HTML, with markup that does not end inside it
   * read as text.
   */
  private asBrowserReads(markup: { end: number; shown: string } | null, at: number, before = ""): { end: number; shown: string } | null {
    if (markup === null) return null;
    const shown = this.readStretch(at, markup.end, false).read;
    this.commonMark = true;
    return { end: markup.end, shown: before + shown };
  }

  /**
   * Where a closing tag of CommonMark's form ends, read from just after its
   * `</`: a letter, letters, digits and hyphens, white space and `>`. -1 when
   * the text there is not one, or it does not end before `end`.
   */
  private closingTagEnd(from: number, end: number): number {
    if (!/[A-Za-z]/.test(this.text.charAt(from))) return -1;
    let at = from + 1;
    while (at < end && /[A-Za-z0-9-]/.test(this.text.charAt(at))) {
      at++;
    }
    while (at < end && /[ \t\n]/.test(this.text.charAt(at))) {
      at++;
    }
    this.steps.count += at - from + 1;
    return at < end && this.text.charAt(at) === ">" ? at + 1 : -1;
  }

  /**
   * Markup that runs to the next `mark` from `from`, where the mark is
   * `length` long, when it ends before `end`. In an HTML block of the
   * Markdown reading, a comment, processing instruction or declaration left
   * open runs on past the block to its mark, or to the end of the file, as a
   * browser reads it on into the markup CommonMark writes next.
   */
  private through(finder: Finder, from: number, end: number, length: number): { end: number; shown: string } | null {
    const found = finder.from(from);
    return this.closedBy(found === -1 ? -1 : found + length, end);
  }

  /**
   * Markup that ends at `close`, or null when it does not end before `end`
   * or `close` is -1. In an HTML block of the Markdown reading it runs on
   * past `end` instead, to `close` or to the end of the file, as `through`
   * describes.
   */
  private closedBy(close: number, end: number): { end: number; shown: string } | null {
    if (close !== -1 && close <= end) return { end: close, shown: "" };
    if (!this.runOn) return null;
    return { end: close === -1 ? this.text.length : close, shown: "" };
  }

  /**
   * A start tag from `at` to `close`, with the content of a raw text element
   * it opens, as what that content shows and where its end tag ends. The
   * content of an element no browser shows runs to its end tag wherever that
   * stands, or to the end of the file, as a browser reads it: CommonMark
   * passes `<script>` in a paragraph to the browser, which then hides the
   * paragraphs after it. Another raw text element whose end tag is not in
   * the block is read as an ordinary tag, and its content as markup and text.
   */
  private contentAfter(at: number, close: number, start: number, end: number, closes: Int32Array): { end: number; shown: string } {
    const name = /^[a-z]+/.exec(this.lower.slice(at + 1, Math.min(at + 11, close)))?.[0] ?? "";
    const kind = RAW_TEXT.get(name);
    if (kind === undefined || !END_TAG_FOLLOWER.test(this.lower.charAt(at + 1 + name.length))) return { end: close, shown: "" };
    // Nothing ends `plaintext`, so the rest of its block is text as written, and a browser reads it on.
    if (kind === "plaintext") {
      this.leftOpen = true;
      return { end, shown: this.text.slice(close, end) };
    }
    const hidden = kind === "hidden" || kind === "script";
    const limit = hidden ? this.text.length : end;
    const content = kind === "script" ? this.scriptEnd(close, limit) : this.endTag(name, close, limit);
    if (content === -1 && !hidden) this.leftOpen = true;
    if (content === -1) return hidden ? { end: limit, shown: "" } : { end: close, shown: "" };
    let endTag = this.commonMark ? this.closingTagEnd(content + 2, this.text.length) : this.noteCut(tagClose(closes, start, end, content + 2), end);
    if (endTag === -1 && hidden && !this.commonMark) endTag = this.tagEndFrom(content + 2);
    if (endTag === -1) this.leftOpen = true;
    if (endTag === -1) return { end: close, shown: "" };
    const written = this.text.slice(close, content);
    const shown = kind === "shown" ? written : kind === "decoded" ? decodeHtml(written) : "";
    // A script that ends inside a comment CommonMark passed whole leaves the rest of that comment to the browser as HTML.
    const passed = this.passedUntil;
    if (this.commonMark && passed > endTag) return this.asBrowserReads({ end: passed, shown }, endTag, shown) ?? { end: endTag, shown };
    return { end: endTag, shown };
  }

  /**
   * Where a tag read from `from` in the tag name state ends, reading forward
   * past any block: just past its `>`, or the end of the file, where a
   * browser drops a tag left open.
   */
  private tagEndFrom(from: number): number {
    let state = TAG_NAME;
    for (let at = from; at < this.text.length; at++) {
      this.steps.count += 1;
      state = tagStep(state, this.text.charAt(at));
      if (state === CLOSED) return at + 1;
    }
    return this.text.length;
  }

  /**
   * Where the next end tag of the element `name` opens from `from`, or -1
   * when none opens before `end`. In the Markdown reading only a closing tag
   * of CommonMark's form counts, because CommonMark shows any other as text.
   */
  private endTag(name: string, from: number, end: number): number {
    let finder = this.endTags.get(name);
    if (finder === undefined) {
      finder = new Finder(this.lower, `</${name}`, this.steps);
      this.endTags.set(name, finder);
    }
    let found = finder.from(from);
    while (found !== -1 && found < end && !(this.commonMark ? this.closingTagEnd(found + 2, this.text.length) !== -1 : END_TAG_FOLLOWER.test(this.lower.charAt(found + name.length + 2)))) {
      found = finder.from(found + 1);
    }
    return found === -1 || found >= end ? -1 : found;
  }

  /**
   * Where a script's content ends, read from `from` as the tokenizer's
   * script data states read it: a `<!--` starts an escaped stretch, and a
   * `<script` inside that starts one where `</script` does not end the
   * content. -1 when no end tag opens before `end`. Each place and state
   * found to reach no end tag is kept, so it is not read again. In prose of
   * the Markdown reading, only what CommonMark passes to a browser counts: a
   * closing tag of its form, and a `<!--` that a `-->` closes before the next
   * blank line.
   */
  private scriptEnd(from: number, end: number): number {
    const lower = this.lower;
    let state = SCRIPT_DATA;
    this.passedUntil = -1;
    const read: Array<[number, number]> = [];
    for (let at = from; at < end; at++) {
      this.steps.count += 1;
      if (((this.scriptDeadEnds[at] ?? 0) & state) !== 0) break;
      read.push([at, state]);
      const character = lower.charAt(at);
      if (character === "-" && lower.startsWith("-->", at)) {
        state = SCRIPT_DATA;
        this.passedUntil = -1;
        continue;
      }
      if (character !== "<") continue;
      if (this.commonMark ? lower.startsWith("</script", at) && this.closingTagEnd(at + 2, end) !== -1 : scriptTagAt(lower, at, "</script")) {
        if (state !== SCRIPT_DOUBLE_ESCAPED) return at;
        state = SCRIPT_ESCAPED;
      } else if (state === SCRIPT_DATA && lower.startsWith("<!--", at) && (!this.commonMark || this.passedComment(at))) {
        state = SCRIPT_ESCAPED;
        if (this.commonMark) this.passedUntil = this.nextCommentEnd.from(at + 4) + 3;
        // The dashes of `<!--` can also end it, as in `<!-->`, so they are read next.
        at += 1;
      } else if (state === SCRIPT_ESCAPED && scriptTagAt(lower, at, "<script")) {
        state = SCRIPT_DOUBLE_ESCAPED;
      }
    }
    for (const [at, held] of read) {
      this.scriptDeadEnds[at] = (this.scriptDeadEnds[at] ?? 0) | held;
    }
    return -1;
  }

  /** Whether the `<!--` at `at` opens a comment CommonMark passes whole: one a `-->` closes before the next blank line. */
  private passedComment(at: number): boolean {
    const close = this.nextCommentEnd.from(at + 4);
    if (close === -1) return false;
    if (this.blankAsked === -1 || at < this.blankAsked || this.blankAnswer !== -1 && at > this.blankAnswer) {
      const blank = /\n[ \t]*\n/g;
      blank.lastIndex = at;
      const found = blank.exec(this.text);
      this.steps.count += (found === null ? this.text.length : found.index) - at;
      this.blankAsked = at;
      this.blankAnswer = found === null ? -1 : found.index;
    }
    return this.blankAnswer === -1 || this.blankAnswer > close;
  }
}

/** The file read as HTML, block by block. A block that hidden content runs into is read from where that content ends. */
function readAsHtml(text: string, lower: string, steps: { count: number }): string {
  const pass = new Pass(text, lower, lower, steps);
  let read = "";
  let resume = 0;
  for (const { start, end } of pass.blocks(0, pass.text.length)) {
    if (end <= resume) continue;
    const block = pass.readAsHtml(Math.max(start, resume), end);
    read += block.read;
    resume = block.resume;
  }
  return read;
}

/**
 * The file read as Markdown: code spans and code blocks show their text as
 * written. Elsewhere only what CommonMark passes to a browser as HTML is
 * markup: a tag, a comment, a processing instruction, a declaration or a
 * CDATA section of the form CommonMark gives, and any other `<` is text.
 * Backslash escapes are read, and only the character references CommonMark
 * decodes are decoded. Code that hidden content runs over is hidden with it.
 * `inDoubt` is true where the reading finds the file in doubt, as this
 * module's opening comment describes.
 */
function readAsMarkdown(text: string, lower: string, steps: { count: number }): { read: string; inDoubt: boolean } {
  const { blocks: blocksOfCode, fallsOut } = codeBlocks(text, steps);
  const code = literalCode(text, blocksOfCode, steps);
  const quotation = unquote(text, lower, blocksOfCode, steps);
  const view = markdownView(quotation.text.replace(/[A-Z]+/g, upper => upper.toLowerCase()), code);
  const pass = new Pass(quotation.text, view, lower, steps, quotation.cuts);
  let read = "";
  let from = 0;
  let resume = 0;
  for (const literal of [...code, { start: pass.text.length, end: pass.text.length, shown: "" }]) {
    for (const { start, end } of pass.blocks(from, literal.start)) {
      if (end <= resume) continue;
      const block = pass.readAsMarkdown(Math.max(start, resume), end);
      read += block.read;
      resume = block.resume;
    }
    if (literal.start >= resume) read += literal.shown;
    from = literal.end;
  }
  return { read, inDoubt: fallsOut || quotation.fallsOut || pass.leftOpen };
}

/** Whether `<script` or `</script`, as `opening` gives, stands at `at` as a whole tag name. */
function scriptTagAt(lower: string, at: number, opening: string): boolean {
  return lower.startsWith(opening, at) && END_TAG_FOLLOWER.test(lower.charAt(at + opening.length));
}

/**
 * Where a tag ends from each place in a block, in each state it may be read
 * in: just past its `>`, or -1 when the block ends first. A tag the end of a
 * `cut` block finds outside a quoted value ends there. Read from the block's
 * end back, so each place is read once for each state.
 *
 * @returns The ends, `TAG_STATES` to a place, from the block's start.
 */
function tagCloses(text: string, start: number, end: number, cut: boolean, steps: { count: number }): Int32Array {
  const closes = new Int32Array((end - start + 1) * TAG_STATES).fill(-1);
  if (cut) closeAtCut(closes, end - start, end, TAG_STATES, [DOUBLE_QUOTED, SINGLE_QUOTED]);
  for (let at = end - 1; at >= start; at--) {
    const character = text.charAt(at);
    const offset = (at - start) * TAG_STATES;
    for (let state = 0; state < TAG_STATES; state++) {
      steps.count += 1;
      const next = tagStep(state, character);
      closes[offset + state] = next === CLOSED ? at + 1 : closes[offset + TAG_STATES + next] ?? -1;
    }
  }
  return closes;
}

/**
 * Where an open tag of CommonMark's form ends from each place in a block, in
 * each state of `commonMarkStep`, as `tagCloses` gives a tag's end: -1 where
 * the grammar fails first or the block ends.
 */
function commonMarkCloses(text: string, start: number, end: number, steps: { count: number }): Int32Array {
  const closes = new Int32Array((end - start + 1) * CM_STATES).fill(-1);
  for (let at = end - 1; at >= start; at--) {
    const character = text.charAt(at);
    const offset = (at - start) * CM_STATES;
    for (let state = 0; state < CM_STATES; state++) {
      steps.count += 1;
      const next = commonMarkStep(state, character);
      closes[offset + state] = next === CLOSED ? at + 1 : next === FAILED ? -1 : closes[offset + CM_STATES + next] ?? -1;
    }
  }
  return closes;
}

/**
 * The state of an open tag after one more character, as CommonMark's grammar
 * reads one: a tag name, then attributes, each after white space, of a name
 * and an optional value, then an optional `/` and the `>`. FAILED where the
 * grammar allows no such character, and CLOSED at the `>`.
 */
function commonMarkStep(state: number, character: string): number {
  const space = character === " " || character === "\t" || character === "\n";
  const nameStart = /[A-Za-z_:]/.test(character);
  switch (state) {
    case CM_TAG_NAME:
      return /[A-Za-z0-9-]/.test(character) ? CM_TAG_NAME : space ? CM_SPACE : character === "/" ? CM_SLASH : character === ">" ? CLOSED : FAILED;
    case CM_SPACE:
      return space ? CM_SPACE : nameStart ? CM_NAME : character === "/" ? CM_SLASH : character === ">" ? CLOSED : FAILED;
    case CM_NAME:
      if (/[A-Za-z0-9_.:-]/.test(character)) return CM_NAME;
      return space ? CM_AFTER_NAME : character === "=" ? CM_BEFORE_VALUE : character === "/" ? CM_SLASH : character === ">" ? CLOSED : FAILED;
    case CM_AFTER_NAME:
      if (space) return CM_AFTER_NAME;
      return character === "=" ? CM_BEFORE_VALUE : nameStart ? CM_NAME : character === "/" ? CM_SLASH : character === ">" ? CLOSED : FAILED;
    case CM_BEFORE_VALUE:
      if (space) return CM_BEFORE_VALUE;
      return character === "\"" ? CM_DOUBLE_QUOTED : character === "'" ? CM_SINGLE_QUOTED : /[=<>`]/.test(character) ? FAILED : CM_UNQUOTED;
    case CM_UNQUOTED:
      return space ? CM_SPACE : character === ">" ? CLOSED : /["'=<`]/.test(character) ? FAILED : CM_UNQUOTED;
    case CM_DOUBLE_QUOTED:
      return character === "\"" ? CM_AFTER_QUOTED : CM_DOUBLE_QUOTED;
    case CM_SINGLE_QUOTED:
      return character === "'" ? CM_AFTER_QUOTED : CM_SINGLE_QUOTED;
    case CM_AFTER_QUOTED:
      return space ? CM_SPACE : character === "/" ? CM_SLASH : character === ">" ? CLOSED : FAILED;
    default:
      return character === ">" ? CLOSED : FAILED;
  }
}

/** Where a tag read from `from` in the tag name state ends, as `tagCloses` gives it, or -1. */
function tagClose(closes: Int32Array, start: number, end: number, from: number): number {
  return from > end ? -1 : closes[(from - start) * TAG_STATES + TAG_NAME] ?? -1;
}

/** Makes the end of a block the end of a tag in each state but those inside a quoted value, in the row after its last character. */
function closeAtCut(closes: Int32Array, length: number, end: number, states: number, quoted: readonly number[]): void {
  for (let state = 0; state < states; state++) {
    if (!quoted.includes(state)) closes[length * states + state] = end;
  }
}

/** The state of a tag after one more character, as the HTML tokenizer moves, or CLOSED at the `>` that ends it. */
function tagStep(state: number, character: string): number {
  const space = TAG_SPACE.test(character);
  switch (state) {
    case TAG_NAME:
      return space ? BEFORE_NAME : character === "/" ? SELF_CLOSING : character === ">" ? CLOSED : TAG_NAME;
    case NAME:
    case AFTER_NAME:
      if (space) return AFTER_NAME;
      return character === "/" ? SELF_CLOSING : character === ">" ? CLOSED : character === "=" ? BEFORE_VALUE : NAME;
    case BEFORE_VALUE:
      if (space) return BEFORE_VALUE;
      return character === "\"" ? DOUBLE_QUOTED : character === "'" ? SINGLE_QUOTED : character === ">" ? CLOSED : UNQUOTED;
    case DOUBLE_QUOTED:
      return character === "\"" ? AFTER_QUOTED : DOUBLE_QUOTED;
    case SINGLE_QUOTED:
      return character === "'" ? AFTER_QUOTED : SINGLE_QUOTED;
    case UNQUOTED:
      return space ? BEFORE_NAME : character === ">" ? CLOSED : UNQUOTED;
    case SELF_CLOSING:
      return character === ">" ? CLOSED : tagStep(BEFORE_NAME, character);
    default:
      // Before an attribute's name, and after a quoted value: `=` there starts a name, as any other character does.
      return space ? BEFORE_NAME : character === "/" ? SELF_CLOSING : character === ">" ? CLOSED : NAME;
  }
}

/** Text with its character references decoded as HTML decodes them in text. */
function decodeHtml(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(?:#[xX]([0-9a-fA-F]+);?|#(\d+);?|([A-Za-z][A-Za-z0-9]*)(;?))/g, (whole, hex?: string, decimal?: string, name?: string, semicolon?: string) => {
    if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16));
    if (decimal !== undefined) return fromCodePoint(Number(decimal));
    const named = name ?? "";
    const full = semicolon === ";" ? (entities as Record<string, string>)[`${named};`] : undefined;
    if (full !== undefined) return full;
    // A name HTML decodes without a semicolon is read as the longest such name that opens the run.
    for (let length = Math.min(named.length, LONGEST_LEGACY); length >= 2; length--) {
      const legacy = named.slice(0, length);
      if (LEGACY_REFERENCES.has(legacy)) return `${(entities as Record<string, string>)[`${legacy};`] ?? ""}${whole.slice(length + 1)}`;
    }
    return whole;
  });
}

/** The character HTML gives a numeric reference. */
function fromCodePoint(point: number): string {
  if (point === 0 || point > 0x10FFFF || point >= 0xD800 && point <= 0xDFFF) return REPLACEMENT;
  return String.fromCodePoint(WINDOWS_1252.get(point) ?? point);
}

/** Markdown text with its backslash escapes read, and the character references CommonMark decodes decoded, in one pass. */
function decodeMarkdown(text: string): string {
  if (!text.includes("\\") && !text.includes("&")) return text;
  return text.replace(/\\([!-/:-@[-`{-~])|&(?:#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g, (whole, escaped?: string) => escaped ?? decodeEntities(whole));
}
