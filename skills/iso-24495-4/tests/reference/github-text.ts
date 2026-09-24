// The text a browser shows for the HTML GitHub returned, read without the engine's
// own reader.
//
// The fixture test compares the engine's reading of each document with GitHub's
// answer. Reading GitHub's answer with the engine's reader too made the comparison
// agree with any mistake in that reader: a separator removed from its list vanished
// from both sides at once. So this reads GitHub's HTML on its own terms. GitHub has
// already sanitised it, so every element in it is one GitHub keeps, and a browser
// gives each block-level element in the HTML Standard's Rendering section a box.

// Every element the HTML Standard's Rendering section renders as a block, a list
// item, a table part or a line break. This list is deliberately wider than the
// engine's: it does not know which of them GitHub keeps.
const BOXED = new Set([
  "address", "article", "aside", "blockquote", "center", "details", "dialog", "dir", "div",
  "dl", "dd", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hgroup", "hr", "li", "listing", "main", "menu", "nav", "ol",
  "p", "plaintext", "pre", "search", "section", "summary", "table", "caption", "colgroup",
  "col", "thead", "tbody", "tfoot", "tr", "td", "th", "ul", "xmp", "br",
]);

// The two elements GitHub keeps whose content a browser does not show.
const HIDDEN = new Set(["video", "rp"]);

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'", nbsp: " " };

/** GitHub serialises its HTML with a handful of references, decoded here. */
function decoded(text: string): string {
  return text.replace(/&(?:[#](\d+)|[#]x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal, hex, name) => {
    if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
    return NAMED[(name as string).toLowerCase()] ?? whole;
  });
}

/** The text the page shows, with every run of whitespace read as one space. */
export function githubText(html: string): string {
  let text = "";
  let node = "";
  let hidden = 0;
  new HTMLRewriter()
    .on("*", {
      element(element) {
        const name = element.tagName;
        if (HIDDEN.has(name)) {
          hidden += 1;
          element.onEndTag(() => { hidden -= 1; });
        } else if (BOXED.has(name)) {
          text += " ";
          if (element.canHaveContent) element.onEndTag(() => { text += " "; });
        }
      },
    })
    .onDocument({
      text(chunk) {
        node += chunk.text;
        if (!chunk.lastInTextNode) return;
        if (hidden === 0) text += decoded(node);
        node = "";
      },
    })
    .transform(html);
  return text.replace(/\p{Default_Ignorable_Code_Point}/gu, "").replace(/\s+/g, " ").trim();
}
