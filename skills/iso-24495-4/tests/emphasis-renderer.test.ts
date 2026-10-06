import { describe, expect, test } from "bun:test";
import { emphasisMarkOffsets, withoutEmphasis } from "../scripts/lib/inline-wording.ts";
import { flattenedOffsets, labelledHeadings, labelledProseBlocks, type LabelledBlock } from "../scripts/lib/parse.ts";

// The words the audit reads, held against the words a renderer shows.
//
// The rules about words read a block with its links replaced by their labels and
// its paired emphasis marks removed. Whether that is right was checked for two
// rounds against the code before it with the marks taken out by hand, which is
// the code's own idea of right. A renderer is the true reference: it is what a
// reader sees. Bun ships one, so this needs no dependency.
//
// The text is generated from a fixed seed, so every run reads the same cases.

const DEFINITION = "[r]: https://example.com";
const WORDS = ["a", "b", "in", "or", "der", "to"];
const MARKS = ["*", "*", "**", "_", "__", "***"];
const CASES = 60_000;

/**
 * Where Bun's renderer and the CommonMark reference implementation part.
 *
 * A mark that touches the inside of a label's bracket, with punctuation on its
 * other side, can both open and close by the CommonMark rules, because a bracket
 * is punctuation. Two such runs whose lengths add up to a multiple of three then
 * do not pair. Bun's renderer reads the bracket there as the edge of the text, so
 * the mark can only open, or only close, and the pair is made: it shows
 * "![**,*](u)" with the alternative text "*,", where the reference keeps "**,*".
 * The audit follows the reference. The class is set aside here and counted.
 */
const RENDERER_DEPARTS = /\[[*_]+(?=[\p{P}\p{S}])|(?<=[\p{P}\p{S}])[*_]+\]/u;

describe("the words the audit reads are the words a renderer shows", () => {
  test("in generated text of emphasis marks, links, images and reference links", () => {
    const random = generator(24495);
    let compared = 0;
    let setAside = 0;
    let withMarksRemoved = 0;
    let headings = 0;
    const differing: string[] = [];
    for (let made = 0; made < CASES; made++) {
      const inline = inlineText(random, 10, false).trim();
      if (RENDERER_DEPARTS.test(inline)) {
        setAside++;
        continue;
      }
      // A line that opens with a mark or a space could be a list item, a rule or code.
      const opening = /^[A-Za-z![]/.test(inline) ? "" : "x ";
      const heading = made % 5 === 0;
      const text = `${heading ? "# " : ""}${opening}${inline}`;
      const document = [text, "", DEFINITION, ""].join("\n");
      const shown = shownWords(document, heading ? "h1" : "p");
      const blocks = heading ? labelledHeadings(document) : labelledProseBlocks(document);
      expect(blocks, text).toHaveLength(1);
      const read = readWords(blocks[0] as LabelledBlock);
      compared++;
      if (heading) headings++;
      if (read.removed > 0) withMarksRemoved++;
      if (read.words !== shown) differing.push(`${JSON.stringify(text)} is read as ${JSON.stringify(read.words)} and shown as ${JSON.stringify(shown)}`);
    }
    expect(differing.slice(0, 5)).toEqual([]);
    expect(differing).toHaveLength(0);
    // The counts are pinned, so a change to the generator or to what is set aside
    // cannot quietly empty the comparison.
    expect({ compared, setAside, withMarksRemoved, headings })
      .toEqual({ compared: 44_303, setAside: 15_697, withMarksRemoved: 6_311, headings: 8_842 });
  }, 60_000);

  test("in the cases the reviewer and the tests name", () => {
    for (const text of [
      "in or*[der](u)* to go.",
      "in *or[der*](u) to go.",
      "*x in [or*](u)der* to go.",
      "We did this in **[order](u)** to finish.",
      "We did this in [or*de*r](u) to finish the ![*work*](chart.png).",
      "The tenant sh**a*[*ll**](u) vacate.",
      "*x [y*z](u) in or*der to go.",
      "See [x](a*b*c) in *order* to go.",
    ]) {
      const document = [text, "", DEFINITION, ""].join("\n");
      expect(readWords(labelledProseBlocks(document)[0] as LabelledBlock).words, text).toBe(shownWords(document, "p"));
    }
  });
});

/** The words of a block as the rules about words read them, and how many marks were removed. */
function readWords(block: LabelledBlock): { words: string; removed: number } {
  const marks = flattenedOffsets(emphasisMarkOffsets(block.source, block.links), block.source, block.links);
  return { words: spaced(withoutEmphasis(block.lines.join("\n"), marks)), removed: marks.length };
}

/** The words Bun's renderer shows for a document of one block, an image as its alternative text. */
function shownWords(document: string, element: "p" | "h1"): string {
  const html = Bun.markdown.html(document);
  expect(html.startsWith(`<${element}>`) && html.trimEnd().endsWith(`</${element}>`), document).toBe(true);
  return spaced(html
    .replace(/<img [^>]*?alt="([^"]*)"[^>]*>/g, "$1")
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
 * Inline Markdown of words, spaces, punctuation and emphasis marks, with links, images
 * and reference links whose labels are made the same way.
 *
 * The marks are placed without regard to pairing, so most of them have no partner or
 * the wrong one. Two things are never made, because the audit states them as limits:
 * a link inside the label of a link, at any depth, which CommonMark reads as the inner
 * link alone; and two bracketed things that touch where the second could be read as
 * the reference of the first.
 */
function inlineText(random: () => number, most: number, insideLink: boolean): string {
  let text = "";
  let bareBrackets = false;
  const count = 1 + Math.floor(random() * most);
  for (let made = 0; made < count; made++) {
    const piece = inlinePiece(random, insideLink, bareBrackets);
    text += piece;
    bareBrackets = piece === "[n]" || piece === "[r]" || piece === "[r][]";
  }
  return text;
}

/** One piece of generated text. After brackets with no destination, no further bracket is made. */
function inlinePiece(random: () => number, insideLink: boolean, afterBareBrackets: boolean): string {
  const choice = random();
  if (choice < 0.3) return pick(random, WORDS);
  if (choice < 0.45) return " ";
  if (choice < 0.75) return pick(random, MARKS);
  if (choice < 0.8) return random() < 0.5 ? "." : ",";
  if (choice < 0.88) {
    if (insideLink || afterBareBrackets) return "a";
    return `[${inlineText(random, 4, true)}]${random() < 0.7 ? "(u)" : "[r]"}`;
  }
  if (choice < 0.94) {
    return afterBareBrackets ? "b" : `![${inlineText(random, 4, insideLink)}](u)`;
  }
  if (afterBareBrackets) return " ";
  // A reference with no definition, which stays as written, and the two short forms
  // of one that has a definition.
  const kind = random();
  if (kind < 0.4 || insideLink) return "[n]";
  return kind < 0.7 ? "[r]" : "[r][]";
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
