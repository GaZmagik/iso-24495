// Character references, read by the two rule sets the page applies.
//
// Markdown text follows CommonMark: a reference needs its semicolon, a decimal
// one has at most seven digits, and anything else is text. A raw HTML block
// follows the HTML tokeniser instead, because the Markdown renderer passes the
// block to the page unchanged and the browser decodes it: the semicolon is
// optional, the digits are unlimited, a null, a surrogate or a value past the
// last code point becomes U+FFFD, a value from 0x80 to 0x9F is a Windows-1252
// byte, and 106 legacy names decode without a semicolon by longest match. Both
// readers live here so that the audit and the visibility check cannot drift.
//
// Nothing existing does the HTML half. HTMLRewriter hands text and attribute
// values back with their references still encoded, Bun escapes HTML but does
// not unescape it, the repository has no npm dependency, and the Markdown
// renderer applies CommonMark's rules. So the HTML reader is written here, on
// what does exist: the named table comes from the renderer, and the Windows-1252
// remap from TextDecoder.
//
// An attribute value follows one further rule, that a legacy name followed by
// "=" or an alphanumeric stays as written. No attribute value reaches a reader
// as text, and no rule reads one, so that rule is not here.

/** The text a reference stands for, and how many source characters it spans. */
export interface DecodedReference {
  decoded: string;
  length: number;
}

/** What each reference rendered to, because a document repeats the same few. */
const renderedReferences = new Map<string, string | null>();

/**
 * The text a reference stands for by CommonMark's rules, or null where it is text.
 *
 * The Markdown renderer decodes it, so the entity table lives there and not here,
 * and it hands an unknown name back unchanged, which is also what a reader sees.
 */
function renderedReference(reference: string): string | null {
  const cached = renderedReferences.get(reference);
  if (cached !== undefined) return cached;
  const rendered = Bun.markdown.render(reference, {
    text: (text: string) => text,
    paragraph: (children: string) => children,
  });
  const result = rendered === reference ? null : rendered;
  renderedReferences.set(reference, result);
  return result;
}

// A character reference as CommonMark bounds it: a decimal or hexadecimal code
// point, or a name from the HTML5 entity list, each closed by a semicolon. One
// without the semicolon is text, as it is on GitHub. The pattern is sticky and
// read from the current index, because slicing the rest of the text at every
// ampersand would be quadratic.
const MARKDOWN_REFERENCE = /&(?:#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/y;

/** The reference opening at the index in Markdown text, or null where the ampersand is text. */
export function markdownReferenceAt(text: string, index: number): DecodedReference | null {
  MARKDOWN_REFERENCE.lastIndex = index;
  const match = MARKDOWN_REFERENCE.exec(text);
  if (match === null) return null;
  const decoded = renderedReference(match[0]);
  return decoded === null ? null : { decoded, length: match[0].length };
}

/**
 * The names that decode without a semicolon.
 *
 * The HTML Standard lists 2,231 named references at
 * https://html.spec.whatwg.org/entities.json, and these 106 are the ones it
 * lists without a trailing semicolon as well as with one. The characters are
 * not here: each name is looked up with its semicolon in the renderer's table.
 */
export const LEGACY_NAMES: ReadonlySet<string> = new Set([
  "AElig", "AMP", "Aacute", "Acirc", "Agrave", "Aring", "Atilde", "Auml", "COPY", "Ccedil",
  "ETH", "Eacute", "Ecirc", "Egrave", "Euml", "GT", "Iacute", "Icirc", "Igrave", "Iuml",
  "LT", "Ntilde", "Oacute", "Ocirc", "Ograve", "Oslash", "Otilde", "Ouml", "QUOT", "REG",
  "THORN", "Uacute", "Ucirc", "Ugrave", "Uuml", "Yacute", "aacute", "acirc", "acute", "aelig",
  "agrave", "amp", "aring", "atilde", "auml", "brvbar", "ccedil", "cedil", "cent", "copy",
  "curren", "deg", "divide", "eacute", "ecirc", "egrave", "eth", "euml", "frac12", "frac14",
  "frac34", "gt", "iacute", "icirc", "iexcl", "igrave", "iquest", "iuml", "laquo", "lt",
  "macr", "micro", "middot", "nbsp", "not", "ntilde", "oacute", "ocirc", "ograve", "ordf",
  "ordm", "oslash", "otilde", "ouml", "para", "plusmn", "pound", "quot", "raquo", "reg",
  "sect", "shy", "sup1", "sup2", "sup3", "szlig", "thorn", "times", "uacute", "ucirc",
  "ugrave", "uml", "uuml", "yacute", "yen", "yuml",
]);
const LONGEST_LEGACY_NAME = Math.max(...[...LEGACY_NAMES].map((name) => name.length));
const SHORTEST_LEGACY_NAME = Math.min(...[...LEGACY_NAMES].map((name) => name.length));
// The longest name in the table is "CounterClockwiseContourIntegral", at 31
// characters. A run longer than any name cannot be one, so the renderer is not
// asked about it.
const LONGEST_NAME = 32;

const HTML_DECIMAL_DIGITS = /[0-9]+/y;
const HTML_HEX_DIGITS = /[0-9A-Fa-f]+/y;
const HTML_NAME_RUN = /[A-Za-z0-9]+/y;
const REPLACEMENT_CHARACTER = "�";
const windows1252 = new TextDecoder("windows-1252");

/** The character a numeric reference produces, as the tokeniser maps its value. */
function codePointText(value: number): string {
  if (value === 0 || value > 0x10FFFF || (value >= 0xD800 && value <= 0xDFFF)) {
    return REPLACEMENT_CHARACTER;
  }
  // The tokeniser maps 0x80 to 0x9F through the Windows-1252 table, and leaves
  // the five bytes that table does not define as the control characters they
  // name. TextDecoder does exactly that.
  if (value >= 0x80 && value <= 0x9F) return windows1252.decode(Uint8Array.of(value));
  return String.fromCodePoint(value);
}

/** The character a legacy name stands for, from the renderer's table. */
function legacyReference(name: string): string {
  // Every name in the set is in the table, and a test proves it.
  return renderedReference(`&${name};`) as string;
}

/**
 * The reference opening at the index in raw HTML text, or null where the ampersand is text.
 *
 * A numeric reference takes every digit that follows, with or without a closing
 * semicolon, and the value is mapped as the tokeniser maps it. A named one takes
 * the longest name the table holds: the whole alphanumeric run with its semicolon,
 * or else the longest legacy name the run begins with, so that "&notit;" decodes
 * "&not" and leaves "it;" as text while "&notin;" is a name of its own.
 */
export function htmlReferenceAt(text: string, index: number): DecodedReference | null {
  if (text[index + 1] === "#") {
    const hexadecimal = text[index + 2] === "x" || text[index + 2] === "X";
    const digits = hexadecimal ? HTML_HEX_DIGITS : HTML_DECIMAL_DIGITS;
    digits.lastIndex = index + (hexadecimal ? 3 : 2);
    const match = digits.exec(text);
    if (match === null) return null;
    const end = digits.lastIndex;
    const length = end - index + (text[end] === ";" ? 1 : 0);
    return { decoded: codePointText(Number.parseInt(match[0], hexadecimal ? 16 : 10)), length };
  }
  HTML_NAME_RUN.lastIndex = index + 1;
  const run = HTML_NAME_RUN.exec(text);
  if (run === null) return null;
  const name = run[0];
  if (name.length <= LONGEST_NAME && text[index + 1 + name.length] === ";") {
    const decoded = renderedReference(`&${name};`);
    if (decoded !== null) return { decoded, length: name.length + 2 };
  }
  for (let length = Math.min(name.length, LONGEST_LEGACY_NAME); length >= SHORTEST_LEGACY_NAME; length--) {
    const legacy = name.slice(0, length);
    if (LEGACY_NAMES.has(legacy)) return { decoded: legacyReference(legacy), length: length + 1 };
  }
  return null;
}

/** The text with every reference decoded by the HTML tokeniser's rules. */
export function decodeHtmlText(text: string): string {
  let decoded = "";
  let index = 0;
  for (;;) {
    const ampersand = text.indexOf("&", index);
    if (ampersand === -1) break;
    const reference = htmlReferenceAt(text, ampersand);
    if (reference === null) {
      decoded += text.slice(index, ampersand + 1);
      index = ampersand + 1;
      continue;
    }
    decoded += text.slice(index, ampersand) + reference.decoded;
    index = ampersand + reference.length;
  }
  return decoded + text.slice(index);
}
