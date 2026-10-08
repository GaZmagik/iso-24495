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
// alike. `safeText` makes wording fit one line, and a finding that quotes it
// is placed by its line number.
//
// A report written with --json is not printed and is not cleaned. It is data
// for another program, which needs the path and the wording as they were found.

const BACKSLASH = "\\";

// What a path may hold that a reader cannot see for what it is: a control
// character, a character that prints as nothing, such as a mark that changes
// text direction or a zero-width space, half a surrogate pair, a line or
// paragraph separator, and every space but the plain one.
const UNSEEN_IN_A_PATH = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]|(?! )\p{Zs}/gu;

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
 * A path made fit to print as one cell of a Markdown table.
 *
 * @param windows Whether a backslash separates directories, as for `safePath`.
 * @returns The path as `safePath` prints it, with a backslash before each
 *     pipe so that it cannot end the cell. Empty for an empty path.
 */
export function safePathCell(path: string, windows: boolean = onWindows()): string {
  return safePath(path, windows).replaceAll("|", `${BACKSLASH}|`);
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
 *   characters that print as nothing, the marks that change text direction
 *   among them, and all white space but the plain space.
 * - A plain space is kept wherever it stands, and nothing is trimmed.
 *
 * A backslash that opens a code stands alone and a backslash from a name is
 * doubled, so the printed form reads back in one way only. Two letters that
 * look alike, or one letter written in two ways, still print alike.
 *
 * @param path A path as a directory walk or an input file gave it.
 * @param windows Whether a backslash separates directories. Left out, it is
 *     true where the command runs on Windows.
 * @returns The printed form, which is empty for an empty path. A pipe is
 *     left alone, so a table cell needs `safePathCell`.
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
