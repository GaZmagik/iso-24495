// Text nobody has read, made fit to print on one line.
//
// A file name comes from a directory walk and an excerpt from a document, so
// neither has been checked. On Linux and macOS a file name can hold a line
// break or a terminal escape sequence. Printed as it stands, the first forges
// a line of output and the second drives the terminal that shows it.
//
// The plain audits and the Jev audit both print such text. This module imports
// nothing, so each of them can use it without depending on another.

/**
 * The warning a command prints for an entry its audit passed over.
 *
 * The path is shown, because the warning is no use without it, and it is
 * cleaned with `safeText` first.
 *
 * @param path The entry as the directory walk gave it.
 * @returns One line, whatever the path holds.
 */
export function skippedEntryWarning(path: string): string {
  return `warning: skipped unreadable entry: ${safeText(path)}`;
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
