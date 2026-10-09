import { describe, expect, test } from "bun:test";
import { withoutEmphasis } from "../scripts/lib/inline-wording.ts";
import { headings, readerProseBlocks } from "../scripts/lib/parse.ts";

// The words the audit reads, held against the words a renderer shows.
//
// The rules about words read a block with its paired emphasis marks removed, where the
// block holds no link. A renderer is the true reference for that: it is what a reader
// sees. Bun ships one, so this needs no dependency.
//
// A block that may hold a link is out of scope. The audit removes no mark from it, so
// there is nothing of the pairing to compare. The contract tests hold that reading.
//
// A bare address is out of scope as well, and this comparison cannot see that class.
// GitHub links "https://e.com/*x" with no bracket, and the asterisk is part of the
// link. Bun's renderer links bare addresses only when asked, with `autolinks`, and it
// then writes a closing tag with no opening tag for a mark inside the address. Its
// output cannot be the reference there, as the last test shows. So that class is held
// by hand-written cases alone, in the contract tests. Each of them was put to GitHub's
// renderer through its API when it was written; no test asks GitHub again.
//
// The text is generated from a fixed seed, so every run reads the same cases.

const WORDS = ["a", "b", "in", "or", "der", "to"];
const MARKS = ["*", "*", "**", "_", "__", "***"];
const CASES = 60_000;

describe("the words the audit reads are the words a renderer shows", () => {
  test("in generated text of words and emphasis marks that holds no link", () => {
    const random = generator(24495);
    let compared = 0;
    let withMarksRemoved = 0;
    let headingsCompared = 0;
    const differing: string[] = [];
    for (let made = 0; made < CASES; made++) {
      const inline = inlineText(random, 10).trim();
      // A line that opens with a mark or a space could be a list item, a rule or code.
      const opening = /^[A-Za-z]/.test(inline) ? "" : "x ";
      const heading = made % 5 === 0;
      const text = `${heading ? "# " : ""}${opening}${inline}`;
      expect(text.includes("[") || text.includes("<"), text).toBe(false);
      const shown = shownWords(text, heading ? "h1" : "p");
      const read = readWords(text, heading);
      compared++;
      if (heading) headingsCompared++;
      if (read.removed > 0) withMarksRemoved++;
      if (read.words !== shown) {
        differing.push(`${JSON.stringify(text)} is read as ${JSON.stringify(read.words)} and shown as ${JSON.stringify(shown)}`);
      }
    }
    expect(differing.slice(0, 5)).toEqual([]);
    expect(differing).toHaveLength(0);
    // The counts are pinned, so a change to the generator cannot quietly empty the
    // comparison. Nothing is set aside: every generated case is compared.
    expect({ compared, withMarksRemoved, headings: headingsCompared })
      .toEqual({ compared: 60_000, withMarksRemoved: 10_065, headings: 12_000 });
  }, 60_000);

  test("no generated case holds what the audit reads as a possible link", () => {
    // The generator makes no bracket, no colon, no slash and no "w", so nothing here
    // is an address. Were that to change, the comparison above would be reading
    // blocks the audit leaves alone.
    const random = generator(24495);
    for (let made = 0; made < CASES; made++) {
      const inline = inlineText(random, 10);
      expect(/[[<]|:[/][/]|www[.]/i.test(inline), inline).toBe(false);
    }
  });

  test("Bun's renderer cannot referee a mark inside a bare address", () => {
    const text = "https://e.com/*x in or*der to go.";
    // Without the option the address is no link, and the two asterisks pair.
    expect(Bun.markdown.html(text)).toBe("<p>https://e.com/<em>x in or</em>der to go.</p>\n");
    // With it the address is a link that holds the first asterisk, as on GitHub. The
    // second asterisk then has no partner, and GitHub shows it. Bun writes a closing
    // tag for it that nothing opened. Should this ever fail, Bun has changed, and the
    // generated comparison may be able to take addresses in.
    const linked = Bun.markdown.html(text, { autolinks: true });
    expect(linked).toBe('<p><a href="https://e.com/*x">https://e.com/*x</a> in or</em>der to go.</p>\n');
    expect(linked.split("<em>").length).toBe(1);
    expect(linked.split("</em>").length).toBe(2);
  });

  test("in the cases the reviews named, once the link is taken out of each", () => {
    for (const text of [
      "in or*der* to go.",
      "in *order* to go.",
      "*x in or*der* to go.",
      "We did this in **order** to finish.",
      "We did this in or*de*r to finish the *work*.",
      "The tenant sh**a**ll** vacate.",
      "*x y*z in or*der to go.",
    ]) {
      expect(readWords(text, false).words, text).toBe(shownWords(text, "p"));
    }
  });
});

/** The words of a document of one block as the rules about words read them, and how many marks were removed. */
function readWords(document: string, heading: boolean): { words: string; removed: number } {
  const blocks = heading
    ? headings(document).map((found) => found.text)
    : readerProseBlocks(document).map((block) => block.lines.join("\n"));
  expect(blocks, document).toHaveLength(1);
  const read = blocks[0] as string;
  const unmarked = withoutEmphasis(read);
  return { words: spaced(unmarked), removed: read.length - unmarked.length };
}

/** The words Bun's renderer shows for a document of one block. */
function shownWords(document: string, element: "p" | "h1"): string {
  const html = Bun.markdown.html(document);
  expect(html.startsWith(`<${element}>`) && html.trimEnd().endsWith(`</${element}>`), document).toBe(true);
  return spaced(html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&"));
}

function spaced(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Inline Markdown of words, spaces, punctuation and emphasis marks, and nothing else.
 *
 * The marks are placed without regard to pairing, so most of them have no partner or
 * the wrong one. No bracket is made, so no text made here holds a link.
 */
function inlineText(random: () => number, most: number): string {
  let text = "";
  const count = 1 + Math.floor(random() * most);
  for (let made = 0; made < count; made++) {
    text += inlinePiece(random);
  }
  return text;
}

/** One piece of generated text. */
function inlinePiece(random: () => number): string {
  const choice = random();
  if (choice < 0.4) return pick(random, WORDS);
  if (choice < 0.58) return " ";
  if (choice < 0.92) return pick(random, MARKS);
  return random() < 0.5 ? "." : ",";
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
