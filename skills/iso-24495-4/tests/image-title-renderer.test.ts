import { beforeAll, describe, expect, test } from "bun:test";
import { auditText } from "../scripts/audit-corpus.ts";
import {
  documentsDigest,
  imageTitleDocuments,
  renderingOf,
  withOtherWord,
  type ImageTitleDocument,
} from "./fixtures/image-title-documents.ts";
import { COMMONMARK_RENDERINGS, IMAGE_TITLE_DOCUMENTS_DIGEST } from "./fixtures/image-title-renderings.ts";

// Where the image-alt rule honours the title decorative, held against what two
// renderers show.
//
// The rule reports an image with no alternative text unless its title reads
// decorative. Three times it took a title from text that renders an image with
// no title. So it honours the title only in one closed form, and this holds it
// to three statements:
//
// - Where either renderer shows an image with no title, the rule honours nothing.
// - Where a renderer shows the title decorative and neither shows an image
//   without one, the rule honours the title if the image is in the closed form,
//   and reports it otherwise. Those reports are misses, but safe ones, and they
//   are counted.
// - Where neither renderer shows an image, nothing is asserted: the rule cannot
//   tell, and a removed finding there is on text alone.
//
// The rule honours a title in a document when it reports fewer findings there
// than in the same document with the word changed. Each document holds one
// image, so one finding cannot hide behind another.
//
// The two renderers are the CommonMark reference, commonmark.js 0.31.2, and
// Bun's own. The reference is not installed here, so what it shows was
// recorded by `reference/build-image-titles.ts`. Bun's is asked each time.

/** One document, what each renderer shows, and whether the rule honoured its title. */
interface Cell extends ImageTitleDocument {
  commonmark: string;
  bun: string;
  honoured: boolean;
  /** Whether the rule reports the document with the word changed, so has a title to honour. */
  reported: boolean;
}

/** The number of image-alt findings in a text. */
function imageFindings(text: string): number {
  return auditText(text).filter((finding) => finding.rule === "image-alt").length;
}

/** What Bun's renderer shows of a document's image, as `renderingOf` names it. */
function bunRendering(text: string): string {
  const titles = [...Bun.markdown.html(text).matchAll(/<img\b[^>]*>/g)]
    .map(([tag]) => / title="([^"]*)"/.exec(tag)?.[1] ?? null);
  return renderingOf(titles);
}

// Places where another definition, or an enclosing image, decides what renders,
// so the image is not in the closed form however it is written.
const OPEN_PLACES = new Set([
  "a definition before another of its label",
  "a definition after another of its label",
  "a definition after a label that folds to it",
  "a definition after its label over two lines",
  "an earlier image's text, by reference",
  "an earlier image's destination, by reference",
]);

/**
 * Whether a document's image is in the closed form: a plain destination, then
 * one space, then the word in double or single quotes. A tab counts as the
 * space only in a heading, the one place the reader keeps it as written.
 */
function closedForm(cell: Cell): boolean {
  const quoted = ["double quotes", "single quotes", "double quotes inside the destination"].includes(cell.title);
  const spaced = cell.between === "a space" || (cell.between === "a tab" && cell.place === "a heading");
  return cell.destination === "plain" && quoted && spaced && !OPEN_PLACES.has(cell.place);
}

let built: Cell[] | null = null;

/** Every cell, worked out once and shared by the tests. */
function cells(): Cell[] {
  built ??= imageTitleDocuments().map((document, index) => {
    const other = imageFindings(withOtherWord(document.text));
    return {
      ...document,
      commonmark: COMMONMARK_RENDERINGS.charAt(index),
      bun: bunRendering(document.text),
      honoured: imageFindings(document.text) < other,
      reported: other > 0,
    };
  });
  return built;
}

/** Whether either renderer shows an image with no title. */
function untitled(cell: Cell): boolean {
  return cell.commonmark === "u" || cell.bun === "u";
}

/** Whether a renderer shows the title decorative and neither shows an image without one. */
function decorative(cell: Cell): boolean {
  return !untitled(cell) && (cell.commonmark === "d" || cell.bun === "d");
}

// Auditing every document twice takes longer than one test is given.
const BUILD_TIME_MS = 60_000;

/** A cell as one line, for a failure message. */
function named(cell: Cell): string {
  return `${JSON.stringify(cell.text)} (CommonMark ${cell.commonmark}, Bun ${cell.bun})`;
}

describe("the image-alt rule honours a decorative title only in the closed form", () => {
  beforeAll(() => {
    cells();
  }, BUILD_TIME_MS);

  test("the recorded renderings are of these documents", () => {
    const documents = imageTitleDocuments();
    expect(COMMONMARK_RENDERINGS).toHaveLength(documents.length);
    expect(documentsDigest(documents)).toBe(IMAGE_TITLE_DOCUMENTS_DIGEST);
  });

  test("never on an image either renderer shows with no title", () => {
    expect(cells().filter((cell) => cell.honoured && untitled(cell)).map(named)).toEqual([]);
  });

  test("wherever a renderer shows the title and the image is in the closed form", () => {
    const shown = cells().filter((cell) => decorative(cell) && cell.reported);
    expect(shown.filter((cell) => closedForm(cell) && !cell.honoured).map(named)).toEqual([]);
    expect(shown.filter((cell) => !closedForm(cell) && cell.honoured).map(named)).toEqual([]);
    // The rest are reported though a renderer shows the title: safe misses,
    // which the checklist's limits name.
    expect(shown.filter((cell) => cell.honoured)).toHaveLength(24);
    expect(shown.filter((cell) => !cell.honoured)).toHaveLength(495);
  });

  test("sees every kind of cell it is meant to tell apart", () => {
    // A test that finds nothing wrong in nothing proves nothing, so count what
    // it saw. These are the counts when the recording was made, so a change to
    // the documents, the rule or Bun's renderer shows here rather than passing
    // quietly.
    const all = cells();
    expect(all).toHaveLength(9120);
    expect(all.filter((cell) => cell.honoured)).toHaveLength(33);
    expect(all.filter(untitled)).toHaveLength(4834);
    expect(all.filter((cell) => untitled(cell) && cell.reported)).toHaveLength(3438);
    expect(all.filter(decorative)).toHaveLength(645);
    expect(all.filter((cell) => cell.commonmark === "n" && cell.bun === "n")).toHaveLength(3641);
    expect(all.filter((cell) => cell.commonmark !== cell.bun)).toHaveLength(615);
    // Honoured with no image under either renderer: text in a raw HTML block or an earlier link.
    expect(all.filter((cell) => cell.honoured && cell.commonmark === "n" && cell.bun === "n")).toHaveLength(9);
  });
});
