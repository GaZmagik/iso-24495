// The class of new versions that clause 23a's guarantee covers: where no
// value a reader sees is listed. It is read from the text alone, and reads
// nothing of `html-text.ts`, so a fault in that module's reading of blocks
// cannot widen the class it is tested against.
//
// A new version is in the class when no line opens with `<` once the spaces,
// tabs, quotation markers and list markers that open it are taken off, and no
// quotation marker stands straight after a list marker. CommonMark opens an
// HTML block only on a line that opens with `<` once those are taken off, so
// no version in the class holds one.

/** A list marker: `-`, `+` or `*`, or one to nine digits and `.` or `)`. */
const LIST_MARKER = String.raw`(?:[-+*]|\d{1,9}[.)])`;

/** The spaces, tabs, quotation markers and list markers that open a line. */
const LEADING_MARKS = new RegExp(String.raw`^(?:[ \t]|>|${LIST_MARKER}(?=[ \t]|$))*`);

/** A quotation marker straight after a list marker, with only spaces or tabs between, among the marks that open a line. */
const QUOTE_AFTER_LIST = new RegExp(String.raw`^(?:[ \t]|>|${LIST_MARKER}(?=[ \t]))*${LIST_MARKER}[ \t]+>`, "m");

/**
 * Whether a new version is in the class that clause 23a's guarantee covers.
 *
 * @param text The new version's whole text.
 */
export function inValueGuarantee(text: string): boolean {
  if (QUOTE_AFTER_LIST.test(text)) return false;
  return !text.split(/\r\n|\r|\n/).some(line => line.replace(LEADING_MARKS, "").startsWith("<"));
}
