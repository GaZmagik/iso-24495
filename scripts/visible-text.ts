// Decides whether a Markdown document shows a reader any text.
//
// An earlier check stripped invisible constructs one pattern at a time, and each
// review found a construct the list had missed. So the Markdown renderer now
// decides what a reader sees, and this reads what it rendered.

import { withoutUnreferencedFootnotes } from "../skills/iso-24495-4/scripts/lib/parse.ts";
import { renderedText } from "../skills/iso-24495-4/scripts/lib/rendered-text.ts";

/**
 * Whether the rendered document holds one character a reader can see.
 *
 * An HTML parser reads the rendered document, for the same reason the renderer
 * reads the Markdown: a pattern that stripped tags took the ">" inside a quoted
 * attribute as the end of the tag. The parser drops comments, including one
 * that never closes and so hides the rest of the document, as in a browser.
 * The text is collected from the whole document rather than from its elements,
 * because a raw HTML block can hold text outside any element.
 *
 * A character is visible when Unicode classes it as a letter, number,
 * punctuation mark or symbol. Everything else produces no mark of its own:
 * whitespace, control and format characters, a combining mark with no base,
 * and private use and unassigned code points. An earlier test excluded the
 * invisible categories one at a time, and passed the combining grapheme
 * joiner because it is a mark rather than a format character. So the question
 * is now asked the other way round, and no list of characters is kept here.
 *
 * A few letters and symbols are blank by design, such as the Hangul fillers
 * and the empty Braille pattern, and they still pass. That is the limit of a
 * category test.
 *
 * An image is not text, so a description holding only an image fails, whatever
 * its alternative text says.
 *
 * The text comes from the same reader the audit engine reads, rendered-text.ts,
 * so the two cannot disagree about what the page shows: which tags GitHub's tag
 * filter shows as text, which elements hide their content, and what a reference
 * decodes to. A footnote nothing refers to shows nothing on GitHub, so it is
 * removed first. A description has no front matter, so a leading "---" block is
 * read as the text GitHub shows.
 */
export function hasVisibleText(markdown: string): boolean {
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(shownText(markdown));
}

/** The text a description shows on GitHub, as this check reads it. */
export function shownText(markdown: string): string {
  return renderedText(withoutUnreferencedFootnotes(markdown, { frontMatter: false }));
}
