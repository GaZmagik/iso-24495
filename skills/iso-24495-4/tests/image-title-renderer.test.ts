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
// decorative. Twice it read text inside a destination as that title, and took
// findings away from images that have no title. So the rule must never honour
// a title on an image that either renderer shows with no title, and must only
// honour one that at least one renderer shows.
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

// Auditing every document twice takes longer than one test is given.
const BUILD_TIME_MS = 60_000;

/** A cell as one line, for a failure message. */
function named(cell: Cell): string {
  return `${JSON.stringify(cell.text)} (CommonMark ${cell.commonmark}, Bun ${cell.bun})`;
}

describe("the image-alt rule honours a decorative title only where a renderer shows one", () => {
  beforeAll(() => {
    cells();
  }, BUILD_TIME_MS);

  test("the recorded renderings are of these documents", () => {
    const documents = imageTitleDocuments();
    expect(COMMONMARK_RENDERINGS).toHaveLength(documents.length);
    expect(documentsDigest(documents)).toBe(IMAGE_TITLE_DOCUMENTS_DIGEST);
  });

  test("never on an image either renderer shows with no title", () => {
    const wrong = cells().filter((cell) => cell.honoured && (cell.commonmark === "u" || cell.bun === "u"));
    expect(wrong.map(named)).toEqual([]);
  });

  test("never where neither renderer shows the title decorative", () => {
    const wrong = cells().filter((cell) => cell.honoured && cell.commonmark !== "d" && cell.bun !== "d");
    expect(wrong.map(named)).toEqual([]);
  });

  test("wherever both renderers show it, except after a plain destination holding parentheses", () => {
    // The rule does not follow parentheses in a plain destination, and the
    // checklist's limits say so.
    const shown = cells().filter((cell) => !cell.honoured && cell.commonmark === "d" && cell.bun === "d");
    const missed = shown.filter((cell) => cell.reported);
    expect(missed.filter((cell) => cell.destination !== "plain with parentheses").map(named)).toEqual([]);
    expect(missed).toHaveLength(31);
    // The rest the rule's scan does not take for an image even with the word
    // changed, so there is no finding to remove. All of them sit in a link.
    const unseen = shown.filter((cell) => !cell.reported);
    expect(unseen.filter((cell) => !cell.place.startsWith("a link's")).map(named)).toEqual([]);
    expect(unseen).toHaveLength(28);
  });

  test("sees every kind of cell it is meant to tell apart", () => {
    // A test that finds nothing wrong in nothing proves nothing, so count what
    // it saw. These are the counts when the recording was made, so a change to
    // the documents, the rule or Bun's renderer shows here rather than passing
    // quietly.
    const all = cells();
    expect(all).toHaveLength(5280);
    expect(all.filter((cell) => cell.honoured)).toHaveLength(338);
    expect(all.filter((cell) => cell.commonmark === "u" || cell.bun === "u")).toHaveLength(2202);
    expect(all.filter((cell) => cell.commonmark === "n" && cell.bun === "n")).toHaveLength(2481);
    expect(all.filter((cell) => cell.commonmark !== cell.bun)).toHaveLength(573);
    // Text in an earlier link the scan takes for an image, though neither renderer shows one.
    expect(all.filter((cell) => cell.place.startsWith("a link's") && cell.reported
      && cell.commonmark === "n" && cell.bun === "n")).toHaveLength(652);
  });
});
