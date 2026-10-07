import { describe, expect, test } from "bun:test";
import { withLinksAsLabels } from "../scripts/audit-corpus.ts";
import { proseBlocks } from "../scripts/lib/parse.ts";
import { GITHUB_LINK_FORMS } from "./fixtures/github-link-forms.ts";

// Whether brackets form a link, held against what a renderer shows.
//
// The acronym rule reads a block with each link replaced by its label. Whether
// "[label](...)" is a link was decided three times by hand-written cases, and each
// time a case nobody wrote was wrong. Here the forms are generated from a fixed seed,
// and Bun's renderer decides: it shows a link's label and neither its destination nor
// its title, and it shows text that is no link as it is written.
//
// The comparison is of words. A link leaves the words of its label and nothing else,
// and text leaves every word. It cannot see a difference that changes no word, such
// as which of two brackets was kept.

const SLASH = String.fromCharCode(92);
const BREAK = String.fromCharCode(10);
const TICK = String.fromCharCode(96);
const FILLER = String.fromCharCode(0xffff);
const CASES = 40_000;

/** For each form set aside, the letters GitHub showed for it. */
const GITHUB_SHOWS = new Map<string, string>(GITHUB_LINK_FORMS);

/**
 * The four shapes on which Bun's renderer and GitHub's can read a form differently.
 *
 * A form of one of these shapes is still compared. It is set aside only where the audit
 * and Bun in fact differ on it, and then it must be one that `GITHUB_SHOWS` lists, with
 * the letters GitHub showed for it. GitHub was asked about every one of those through
 * its Markdown API, and the audit follows GitHub. So no form is left unheld: each either
 * agrees with Bun or agrees with what GitHub was seen to show.
 */
const RENDERERS_MAY_DIFFER: Array<[name: string, shaped: (label: string, tail: string) => boolean]> = [
  // "[m](<two three>'a title')": Bun shows a link, GitHub shows the text as written.
  ["a title straight after a destination in angle brackets, with no space between", (_label, tail) => /^\s*<[^<>]*>["'(]/.test(tail)],
  // "[m](a\ b)": a backslash escapes punctuation alone, so the destination ends at the
  // space and GitHub shows text. Bun reads the space as escaped and carries on.
  ["a backslash before white space", (_label, tail) => /\\\s/.test(tail)],
  // "[[ [one](\(three]()) ": GitHub ends the first label at its bracket and takes the rest
  // as its destination. Bun pairs the bracket inside the destination with an earlier one.
  ["a closing bracket and a parenthesis inside a destination", (_label, tail) => tail.includes("](")],
  // "[[[c](d)]](zed)": a link cannot hold a link, so GitHub shows the outer brackets as
  // text. Bun does the same one bracket deep, and makes a link of the outer pair at two.
  ["a link two brackets deep in a label", (label) => label.includes("[[c](d)]")],
];

describe("what the acronym rule takes for a link is what a renderer shows as one", () => {
  test("in generated forms of a label and what follows it", () => {
    const random = generator(24495);
    const counts = { agreeWithBun: 0, links: 0, text: 0, setAside: 0, heldByGitHub: 0 };
    const differing: string[] = [];
    const answersUsed = new Set<string>();
    for (let made = 0; made < CASES; made++) {
      const label = pieces(random, LABEL, 4);
      const tail = pieces(random, TAIL, 5);
      const document = `identity and access [${label}](${tail}) here.`;
      const html = Bun.markdown.html(document);
      // A form that ends the paragraph, as a blank line would, is no single block.
      if (!html.startsWith("<p>") || html.indexOf("<p>", 1) !== -1 || !html.trimEnd().endsWith("</p>")) continue;
      const shown = lettersShown(html);
      const read = words(readingText(document));
      if (read === shown) {
        counts.agreeWithBun++;
        if (html.includes("<a href=")) counts.links++;
        else counts.text++;
        continue;
      }
      const onGitHub = GITHUB_SHOWS.get(document);
      if (RENDERERS_MAY_DIFFER.some(([, shaped]) => shaped(label, tail)) && onGitHub !== undefined) {
        counts.setAside++;
        answersUsed.add(document);
        if (read === onGitHub) counts.heldByGitHub++;
        else differing.push(`${JSON.stringify(document)} is read as ${JSON.stringify(read)} and GitHub showed ${JSON.stringify(onGitHub)}`);
        continue;
      }
      differing.push(`${JSON.stringify(document)} is read as ${JSON.stringify(read)} and shown as ${JSON.stringify(shown)}`);
    }
    expect(differing.slice(0, 5)).toEqual([]);
    expect(differing).toHaveLength(0);
    // Pinned, so that a change to the generator cannot quietly empty either side.
    expect(counts).toEqual({ agreeWithBun: 39_267, links: 26_812, text: 12_455, setAside: 374, heldByGitHub: 374 });
    // The generator makes some forms twice, so the 374 are 355 documents, and the fixture
    // holds no answer that nothing asks for.
    expect(answersUsed.size).toBe(GITHUB_SHOWS.size);
    expect(GITHUB_SHOWS.size).toBe(GITHUB_LINK_FORMS.length);
  }, 120_000);

  test("only the lines a rule reads are changed, and only where link syntax stood", () => {
    const tick = String.fromCharCode(96);
    const document = [
      "---", "title: [a](b)", "---", "",
      "# A heading [one](two)", "",
      "| Term | Meaning |", "|---|---|", "| [three](four|five) | six |", "",
      `${tick}${tick}${tick}`, "[seven](eight)", `${tick}${tick}${tick}`, "",
      "    [nine](ten)", "",
      "A paragraph [eleven](twelve", "'thirteen') and [r].", "",
      "[r]: https://example.com", "",
    ].join(BREAK);
    const read = withLinksAsLabels(document).split(BREAK);
    const written = document.split(BREAK);
    const gone = (text: string): string => text.replaceAll(FILLER, "");
    // Front matter, fenced and indented code and the line that defines a reference are as written.
    for (const line of [0, 1, 2, 10, 11, 12, 14, 19]) {
      expect(read[line], `line ${line + 1}`).toBe(written[line] as string);
    }
    expect(gone(read[4] as string)).toBe("# A heading one");
    // A pipe in a destination is kept, so the row has the cells it had.
    expect(gone(read[8] as string)).toBe("| three| | six |");
    expect(gone(read[16] as string)).toBe("A paragraph eleven");
    expect(gone(read[17] as string)).toBe(" and r.");
    expect(read.map((line) => line.length)).toEqual(written.map((line) => line.length));
    // A heading over two lines is one block, so a link that wraps in it is one link.
    const heading = withLinksAsLabels(["A heading [fourteen", "fifteen](sixteen)", "===", ""].join(BREAK)).split(BREAK);
    expect(heading.slice(0, 2).map(gone)).toEqual(["A heading fourteen", "fifteen"]);
    // A document with no square bracket is handed back as it is.
    expect(withLinksAsLabels("No link here.")).toBe("No link here.");
  });

  test("the document keeps its shape, so every line and every block is where it was", () => {
    const random = generator(5055);
    for (let made = 0; made < 2_000; made++) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 4) }, () =>
        `${pick(random, ["", "- ", "> ", "1. ", "# ", "  "])}[${pieces(random, LABEL, 3)}](${pieces(random, TAIL, 4)}) and [r] ${pick(random, ["", "| a |"])}`);
      const document = [...lines, "", "[r]: https://example.com", ""].join(BREAK);
      const read = withLinksAsLabels(document);
      expect(read.length, document).toBe(document.length);
      expect(read.split(BREAK).map((line) => line.length)).toEqual(document.split(BREAK).map((line) => line.length));
      expect(proseBlocks(read).map((block) => [block.line, block.lines.length]), document)
        .toEqual(proseBlocks(document).map((block) => [block.line, block.lines.length]));
    }
  });
});

/** The words the acronym rule reads in a document of one block. */
function readingText(document: string): string {
  return proseBlocks(withLinksAsLabels(document)).map((block) => block.lines.join(" ")).join(" ").replaceAll(FILLER, "");
}

/** The letters a page shows for rendered HTML, an image as its alternative text, which is what a screen reader says. */
function lettersShown(html: string): string {
  return words(html.replace(/<img [^>]*?alt="([^"]*)"[^>]*>/g, "$1").replace(/<!--[^]*?-->/g, "").replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "").replaceAll("&amp;", "&"));
}

/** Every letter of a text, in order, with nothing between. A link inside a word joins its halves, so word breaks are not compared. */
function words(text: string): string {
  return text.replace(/[^A-Za-z]/g, "");
}

const LABEL = ["management", "one", " ", " ", "[b]", "[", "]", `${SLASH}[`, `${SLASH}]`, BREAK, "[c](d)", "![e](f)", "*", `${TICK}g${TICK}`,
  // A bracket inside a code span, a tag, an autolink and a comment, and a code span that ends in a backslash.
  `${TICK}[${TICK}`, `${TICK}]${TICK}`, `${TICK}${SLASH}${TICK}`, '<i title="[">', '<i title="]">', "<https://e.com/[>", "<https://e.com/]>", "<!-- ] -->"];
const TAIL = ["two", "three", "x", " ", " ", BREAK, "<", ">", "<two three>", "<four>", '"a title"', "'a title'", "(a title)", "(", ")", "()",
  `${SLASH}(`, `${SLASH})`, `${SLASH}_`, `${SLASH}<`, `${SLASH}>`, `${SLASH}"`, `${SLASH} `, '"', "'", "", "", "[", "]", TICK];

/** A few pieces of generated text, joined with nothing between them. */
function pieces(random: () => number, from: readonly string[], most: number): string {
  let text = "";
  const count = Math.floor(random() * (most + 1));
  for (let made = 0; made < count; made++) {
    text += pick(random, from);
  }
  return text;
}

function pick(random: () => number, choices: readonly string[]): string {
  return choices[Math.floor(random() * choices.length)] as string;
}

/** A fixed sequence of numbers from 0 up to 1, the same for the same seed on every run. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
