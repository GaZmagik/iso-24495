// Text nobody has read, made fit to print on one line.
//
// A file name comes from a directory walk and an excerpt from a document, so
// neither has been checked. On Linux and macOS a file name can hold a line
// break or a terminal escape sequence. Printed as it stands, the first forges
// a line of output and the second drives the terminal that shows it.
//
// Every command that prints such text prints it through this module. It imports
// nothing, so each of them can use it without depending on another.
//
// A path and quoted wording are printed in two ways. `safePath` keeps every
// character of a path or shows it as its code, so that two paths never print
// alike. That is plain text for a terminal. Where the output is Markdown that
// will be rendered, `safePathCell` and `safePathCode` put the same text in a
// code span, so that a renderer reads none of it as Markdown. `safeText` makes wording fit one line, and a finding that quotes it
// is placed by its line number.
//
// A report written with --json is not printed and is not cleaned. It is data
// for another program, which needs the path and the wording as they were found.

const BACKSLASH = "\\";

// What a path may hold that a reader cannot see for what it is. Each part is
// a class that Unicode defines, so no list here can fall behind:
//
// - a control character, and a format character such as a mark that changes
//   text direction or a zero-width space;
// - half a surrogate pair;
// - a line or paragraph separator, and every space but the plain one;
// - every character Unicode says to leave undrawn where a font has no shape
//   for it, its "default ignorable" property. That adds the variation
//   selectors, the combining grapheme joiner, the Hangul fillers, the tag
//   characters and the places kept empty for more of the kind.
//
// A combining mark that draws, such as an accent, is in none of these and is
// kept, so a name written with one stays readable. Three things that can
// still pass unseen are also in none: a symbol that is drawn blank, as the
// braille blank is; a private use character; and a code point not yet given a
// character.
const UNSEEN_IN_A_PATH = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]|(?! )\p{Zs}/gu;

/**
 * The warning a command prints for an entry its audit passed over.
 *
 * The path is shown, because the warning is no use without it, and it is
 * printed as `safePath` prints it.
 *
 * @param path The entry as the directory walk gave it.
 * @param windows Whether a backslash separates directories, as for `safePath`.
 * @returns One line, whatever the path holds.
 */
export function skippedEntryWarning(path: string, windows: boolean = onWindows()): string {
  return `warning: skipped unreadable entry: ${safePath(path, windows)}`;
}

/**
 * A path made fit to print as one cell of a Markdown table that will be
 * rendered.
 *
 * A table is printed to be rendered, and a renderer reads a name as Markdown:
 * "a&#32;b.md" showed as "a b.md", "a<br>b.md" broke the line, asterisks
 * became emphasis and brackets a link. So the path is written as a code span,
 * where every character is shown as it is written.
 *
 * @param windows Whether a backslash separates directories, as for `safePath`.
 * @returns The path as `safePathCode` writes it, with a backslash before each
 *     pipe. A table is cut into cells before a code span is read, so a pipe
 *     must be escaped inside one as well, and the renderer takes that
 *     backslash out again. An empty path gives a span of two spaces.
 */
export function safePathCell(path: string, windows: boolean = onWindows()): string {
  return codeSpan(safePath(path, windows).replaceAll("|", `${BACKSLASH}|`));
}

/**
 * A path made fit to print in a line of Markdown that will be rendered, such
 * as a sentence of a report.
 *
 * @param windows Whether a backslash separates directories, as for `safePath`.
 * @returns A code span that shows the path as `safePath` prints it, codes and
 *     doubled backslashes included: a backslash is an ordinary character in a
 *     code span, so what a reader sees is that printed form and reads back in
 *     one way. The fence is one backtick longer than the longest run of
 *     backticks in the path. A path that is empty, or that opens or closes
 *     with a space or a backtick, has one space added each side, which a
 *     renderer takes off again. For a path of spaces alone it does not, and
 *     that path is shown with the two spaces added. A pipe is left alone, so
 *     a table cell needs `safePathCell`.
 */
export function safePathCode(path: string, windows: boolean = onWindows()): string {
  return codeSpan(safePath(path, windows));
}

/** Text of one line as a Markdown code span, as `safePathCode` describes. */
function codeSpan(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  const fence = "`".repeat(longest + 1);
  const padding = text === "" || /^[ `]|[ `]$/.test(text) ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
}

/**
 * A path made fit to print on one line, in a form no other path prints as.
 *
 * `safeText` cannot do this, because it is made for quoted wording. It turns
 * a control character into a space and each run of spaces into one, so
 * "a b.md", the same name with two spaces and the same name with a mark that
 * reverses direction all printed as "a b.md". A reader could not tell which
 * file a finding was in. Here every character is kept or shown:
 *
 * - On Windows a backslash separates directories, and prints as a forward
 *   slash.
 * - Elsewhere a backslash is part of a name, and prints twice.
 * - A character a reader cannot see for what it is prints as its code: a
 *   backslash, "u" and four hexadecimal digits, or the digits in braces for a
 *   character past the basic plane. Those are the control characters, the
 *   characters that draw nothing, and all white space but the plain space.
 *   A variation selector, a zero-width joiner and a mark that changes text
 *   direction draw nothing, so an emoji that needs one keeps its picture and
 *   has the code beside it. A combining mark that draws, such as an accent,
 *   is kept.
 * - A plain space is kept wherever it stands, and nothing is trimmed.
 *
 * A backslash that opens a code stands alone and a backslash from a name is
 * doubled, so the printed form reads back in one way only. Two letters that
 * look alike, or one letter written in two ways, still print alike.
 *
 * @param path A path as a directory walk or an input file gave it.
 * @param windows Whether a backslash separates directories. Left out, it is
 *     true where the command runs on Windows.
 * @returns The printed form, which is empty for an empty path. It is plain
 *     text for a terminal. Markdown that will be rendered needs
 *     `safePathCode`, or `safePathCell` in a table.
 */
export function safePath(path: string, windows: boolean = onWindows()): string {
  return path
    .replaceAll(BACKSLASH, windows ? "/" : BACKSLASH + BACKSLASH)
    .replace(UNSEEN_IN_A_PATH, visibleCode);
}

/** The code of one character, written out so that it can be read on the page. */
function visibleCode(character: string): string {
  const point = character.codePointAt(0) as number;
  const digits = point.toString(16);
  return point > 0xffff ? `${BACKSLASH}u{${digits}}` : `${BACKSLASH}u${digits.padStart(4, "0")}`;
}

function onWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Text nobody has read, made safe to print as one cell of a Markdown table.
 *
 * @returns The text as `safeText` cleans it, with a backslash before each
 *     pipe so that it cannot end the cell. Empty when nothing else was in it.
 */
export function safeCell(text: string): string {
  return safeText(text).replaceAll("|", "\\|");
}

/**
 * Text made safe to print on one line, for a path or an excerpt nobody has
 * read. Control characters and the marks that reverse text direction become
 * spaces, each run of white space becomes one space, and the ends are trimmed.
 *
 * @returns The cleaned text, which is empty when nothing else was in it. A
 *     pipe is left alone, so a table cell needs it escaped as well.
 */
export function safeText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
