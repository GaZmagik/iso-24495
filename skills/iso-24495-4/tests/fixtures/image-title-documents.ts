// Documents that each hold one image with no alternative text, built to test
// where the image-alt rule reads a title.
//
// Every document crosses four things: how the destination is written, what
// title follows it, what stands between the two, and where the image stands.
// The rule once read text inside a destination as a title, so destinations
// that hold spaces, parentheses, quotes and escapes are here, and so is text
// the reader rewrites before the rule sees it: an escape, a tag, a comment
// and a code span.
//
// `../reference/build-image-titles.ts` records how the CommonMark reference
// renders each one, in `image-title-renderings.ts`.

const SLASH = String.fromCharCode(92);
const TICK = String.fromCharCode(96);

/** How a destination is written. "{in}" marks where a title written inside it goes. */
const DESTINATIONS: ReadonlyArray<[name: string, written: string]> = [
  ["plain", "x.png{in}"],
  ["plain with parentheses", "x(1).png{in}"],
  ["plain with an escaped parenthesis", `x${SLASH}).png{in}`],
  ["angle brackets with a space", "<x y.png{in}>"],
  ["angle brackets with parentheses", "<x(1).png{in}>"],
  ["angle brackets with a quote", "<x\".png{in}>"],
  ["angle brackets with an escaped bracket", `<x${SLASH}>.png{in}>`],
  ["empty angle brackets", "<{in}>"],
];

/**
 * What title follows the destination. A title written inside the destination
 * closes with an extra ")" or quote, so the text looks like a title to a
 * reader that ends the destination at the first ")".
 */
const TITLES: ReadonlyArray<[name: string, after: string, inside: string]> = [
  ["none", "", ""],
  ["double quotes", "\"decorative\"", ""],
  ["single quotes", "'decorative'", ""],
  ["parentheses", "(decorative)", ""],
  ["parentheses inside the destination", "", "(decorative))"],
  ["double quotes inside the destination", "", "\"decorative\")"],
];

/** What stands between the destination and the title. */
const BETWEEN: ReadonlyArray<[name: string, text: string]> = [
  ["a space", " "],
  ["a tab", "\t"],
  ["a no-break space", String.fromCharCode(0xa0)],
  ["nothing", ""],
  ["an escaped backslash", SLASH + SLASH],
  // A backslash escapes punctuation alone, so CommonMark ends a destination at
  // the space after one. Bun's renderer carries the destination on.
  ["a backslash and a space", `${SLASH} `],
  ["a backslash and a tab", `${SLASH}\t`],
  ["an HTML tag", "<b>"],
  ["an HTML comment", "<!--c-->"],
  ["a code span", `${TICK}a${TICK}`],
];

/** Where the image stands. A definition context names the image by reference. */
const PLACES: ReadonlyArray<[name: string, place: (parts: { image: string; tail: string }) => string]> = [
  ["a paragraph", ({ image }) => `${image}\n`],
  ["a heading", ({ image }) => `# ${image}\n`],
  ["a list item", ({ image }) => `- ${image}\n`],
  ["a quotation", ({ image }) => `> ${image}\n`],
  ["a link", ({ image }) => `[${image}](page.md)\n`],
  ["a reference definition", ({ tail }) => `![][dec]\n\n[dec]: ${tail}\n`],
];

/** One generated document, with what it was built from. */
export interface ImageTitleDocument {
  text: string;
  destination: string;
  title: string;
  between: string;
  place: string;
}

/** Every document, in a fixed order. */
export function imageTitleDocuments(): ImageTitleDocument[] {
  const documents: ImageTitleDocument[] = [];
  for (const [destination, written] of DESTINATIONS) {
    for (const [title, after, inside] of TITLES) {
      for (const [between, text] of BETWEEN) {
        const insideText = inside === "" ? "" : text + inside;
        const afterText = after === "" ? "" : text + after;
        const tail = written.replace("{in}", insideText) + afterText;
        for (const [place, placed] of PLACES) {
          documents.push({ text: placed({ image: `![](${tail})`, tail }), destination, title, between, place });
        }
      }
    }
  }
  return documents;
}

/** The same document with the title's word changed, so that no rule could honour it. */
export function withOtherWord(text: string): string {
  return text.replaceAll("decorative", "ornamental");
}

/**
 * How a renderer shows one document's image, as one letter: "n" for no image,
 * "u" for an image with no title, "d" for the title decorative in any case,
 * and "o" for any other title.
 *
 * @param titles The title of each image the renderer shows, null or empty
 *     where it shows none.
 * @throws When there is more than one image, since every document is built to
 *     hold one and a second would hide behind the first.
 */
export function renderingOf(titles: ReadonlyArray<string | null>): string {
  if (titles.length > 1) throw new Error(`expected one image, found ${titles.length}`);
  const [title] = titles;
  if (title === undefined) return "n";
  if (title === null || title === "") return "u";
  return /^decorative$/i.test(title) ? "d" : "o";
}

/** A digest of every document's text, so a recording can show which documents it is of. */
export function documentsDigest(documents: readonly ImageTitleDocument[]): string {
  const hash = new Bun.CryptoHasher("sha256");
  for (const document of documents) {
    hash.update(document.text);
    hash.update("\u0000");
  }
  return hash.digest("hex");
}
