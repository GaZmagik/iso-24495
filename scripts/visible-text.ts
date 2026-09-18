// Decides whether a Markdown document shows a reader any text.
//
// An earlier check stripped invisible constructs one pattern at a time, and each
// review found a construct the list had missed. So the Markdown renderer now
// decides what a reader sees, and this reads what it rendered.

/**
 * Whether the rendered document holds one character a reader can see.
 *
 * The renderer passes HTML comments through untouched, so they are removed
 * before the tags. A comment that never closes hides the rest of the document,
 * as it does in a browser.
 *
 * Whitespace, control and format characters are not visible. The format
 * category covers the zero-width characters and the byte order mark, so no
 * list of them is kept here.
 *
 * An image is not text, so a description holding only an image fails, whatever
 * its alternative text says.
 *
 * Entities inside a raw HTML block stay as written, so `<div>&nbsp;</div>`
 * counts as text. That is accepted: the check exists to catch a description
 * nobody wrote, not one written to evade it.
 */
export function hasVisibleText(markdown: string): boolean {
  const rendered = Bun.markdown.html(markdown)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!--[\s\S]*/, "")
    .replace(/<[^>]*>/g, "");
  return /[^\s\p{Cc}\p{Cf}]/u.test(rendered);
}
