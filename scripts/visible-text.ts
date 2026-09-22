// Decides whether a Markdown document shows a reader any text.
//
// An earlier check stripped invisible constructs one pattern at a time, and each
// review found a construct the list had missed. So the Markdown renderer now
// decides what a reader sees, and this reads what it rendered.

const windows1252 = new TextDecoder("windows-1252");

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
 * Whitespace, control and format characters are not visible. The format
 * category covers the zero-width characters and the byte order mark, so no
 * list of them is kept here.
 *
 * An image is not text, so a description holding only an image fails, whatever
 * its alternative text says.
 *
 * Decode character references once after removing markup. Raw HTML blocks
 * leave their references encoded in the rendered string, while ordinary
 * Markdown text does not. Decoding each reference on its own preserves text
 * that would become Markdown syntax if the whole string were rendered again.
 */
export function hasVisibleText(markdown: string): boolean {
  let rendered = "";
  new HTMLRewriter()
    .onDocument({ text(chunk) { rendered += chunk.text; } })
    .transform(Bun.markdown.html(markdown));
  const text = rendered.replace(
    /&(?:#[xX][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]+);?/g,
    (reference) => {
      // Raw HTML accepts this whitespace name without a semicolon.
      if (reference === "&nbsp") return "\u00A0";
      const numeric = /^&#([xX]?)([0-9A-Fa-f]+);?$/.exec(reference);
      if (numeric) {
        const codePoint = Number.parseInt(numeric[2], numeric[1] ? 16 : 10);
        if (codePoint >= 0x80 && codePoint <= 0x9f) {
          // HTML maps legacy numeric references here as Windows-1252 bytes.
          return windows1252.decode(Uint8Array.of(codePoint));
        }
      }
      // HTML also accepts numeric references without the semicolon that the
      // Markdown renderer requires when it reads standalone text.
      const paragraph = Bun.markdown.html(numeric && !reference.endsWith(";")
        ? `${reference};`
        : reference);
      return paragraph.slice(3, -5);
    },
  );
  return /[^\s\p{Cc}\p{Cf}]/u.test(text);
}
