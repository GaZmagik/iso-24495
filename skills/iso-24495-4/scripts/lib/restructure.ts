// The two-version comparison: a document before and after a restructure,
// read as units of wording and matched by that wording alone.
//
// Part 5 lets a restructure change headings, list types, table structure and
// visual formatting, and move a whole sentence or block unchanged. It does
// not let one drop, rewrite or invent wording. So the comparison reads each
// version as units, renders the inline markup of each, and matches the two
// sets of units by their text. A line wrap, emphasis, a list marker or a
// table border is gone from the text it matches by, so changing one keeps the
// unit. Case, punctuation, numbers, negation and the contents of code blocks
// are never changed, so changing one of them drops the unit and adds another.
//
// A move is allowed only where a unit's dependencies, its order against
// neighbouring steps and the claim it qualifies survive. So the comparison
// also finds the longest order the kept units share with the original, and
// lists each kept unit outside it: a step of an ordered list as a step out
// of order, and any other unit as moved, for a person to check.
//
// It reads wording, not meaning. A sentence reworded without any change of
// meaning reads as dropped and added, and a sentence kept word for word whose
// meaning changed in its new place reads as kept.

import { renderInline } from "./inline-wording.ts";
import { inlineText, locateSentences, markdownLinks, normaliseReference, structure, tableCells, type ListStep, type LocatedSentence, type MarkdownLink, type Reading } from "./parse.ts";
import { safeCell, safePathCode } from "./safe-text.ts";

/** A unit that is one slot Part 5 tells a restructure to leave where nothing serves, and nothing else. */
const ONE_SLOT = /^\[Author needed:[^\]]*\]$/;

/** What every slot opens with. */
const SLOT_OPENING = "[Author needed:";

/**
 * Struck words are still on the page, and a screen reader says them with no
 * sign of the strike, so the comparison reads them as wording.
 */
const STRIKE = { strike: true };

/**
 * A bold label at the start of prose, ending in a colon inside the marks or
 * just after them, followed by white space: `**Purpose:** ` or `__Date__: `,
 * or a label on a line of its own above the words it labels.
 */
const BOLD_LABEL = /^(\*\*|__)(?=\S)(.*?\S)\1(:?)\s+(?=\S)/;

/**
 * A word that points back to what stood before it, when it opens a unit:
 * `This`, `It` or `These`, as a whole word. `It's` opens with `It`, and
 * `Its` and `Thistle` open with none.
 */
const REFERENT = /^(This|It|These)(?![\p{L}\p{N}_])/u;

/** The kinds of unit that are prose, so a word opening one can point back. */
const PROSE_KINDS: ReadonlySet<UnitKind> = new Set(["sentence", "item", "cell"]);

/**
 * How many pairings of repeated texts the comparison weighs, at most, when
 * it pairs their copies. Weighing every pairing of a text with `b` copies
 * before and `a` after takes `b` times `a` steps, so the texts with the
 * fewest pairings are weighed first, and those past this count pair their
 * copies in document order.
 */
const PAIRING_BUDGET = 1_000_000;

/** How many characters of a unit a report quotes. */
const EXCERPT_LENGTH = 60;

/**
 * Reads both versions, and the author's wording when given, and matches them.
 *
 * @param before The document as it was.
 * @param after The document as it is now.
 * @param authorText Wording the author gave for the restructure, or null.
 *     An added unit that matches it comes from the author.
 * @param reading How every text is read. Front matter is not compared unless
 *     `frontMatter` is false, which reads it as text.
 * @returns What `compareUnits` returns for the units of each text.
 */
export function compareVersions(before: string, after: string, authorText: string | null, reading: Reading = {}): Comparison {
  return compareUnits(documentUnits(before, reading), documentUnits(after, reading), authorText === null ? [] : documentUnits(authorText, reading));
}

/**
 * Matches the units of two versions by their text, sorts each unit left
 * over by what it is, and finds the kept units that changed order.
 *
 * A text counts as many times as it occurs, so a passage that stood twice
 * must stand twice afterwards. The copies of one text are paired so that the
 * most units keep their order: of `A. B. A.` becoming `B. A.`, the second A
 * is kept and the first is dropped. Copies left over after that pair in
 * document order. A text whose copies would take the pairings past
 * `PAIRING_BUDGET` pairs all its copies in document order.
 *
 * Units left over on both sides are then matched again, where one opens with
 * a bold label ending in a colon, such as `**Purpose:**`, by the text after
 * its label. So a sentence that gained, lost or changed a label is kept, and
 * the label is counted. This second match runs only on what the first left,
 * so `Purpose: Fix the pump.` written as plain text still matches itself.
 *
 * An after unit still left over is sorted in this order:
 *
 * 1. A unit that, after any label, is one slot such as
 *    `[Author needed: reader]` and nothing else is a marked gap.
 * 2. A heading is a new heading. Part 5 lets a restructure change headings,
 *    so it is counted and not listed. A before heading left over is counted
 *    as gone in the same way, and is not dropped.
 * 3. A unit that matches a unit of the author's wording, whole or after its
 *    label, comes from the author. Each unit of the author's wording accounts
 *    for one after unit.
 * 4. Any other unit is added.
 *
 * The kept units are then read in order, as `keptOrder` describes.
 *
 * @returns The pairs kept, in before order, the kept pairs moved and those
 *     out of step order, and every other unit in the order of its own version.
 */
export function compareUnits(before: readonly Unit[], after: readonly Unit[], author: readonly Unit[]): Comparison {
  const exact = pairKeepingOrder(before, after);
  const byLabel = pairByText(exact.leftBefore, exact.leftAfter, withoutLabel);
  const beforeIndex = new Map(before.map((unit, index) => [unit, index]));
  const kept = [...exact.pairs, ...byLabel.pairs].sort((first, second) => (beforeIndex.get(first.before) ?? 0) - (beforeIndex.get(second.before) ?? 0));
  const { moved, stepOrder } = keptOrder(kept, new Map(after.map((unit, index) => [unit, index])));
  const comparison: Comparison = {
    before, after, author, kept, moved, stepOrder,
    dropped: byLabel.leftBefore.filter(unit => unit.kind !== "heading"),
    headingsGone: byLabel.leftBefore.filter(unit => unit.kind === "heading"),
    added: [], fromAuthor: [], gaps: [], newHeadings: [],
    // A pair the second match made differs in its labels, or the first would have made it.
    newLabels: byLabel.pairs.filter(pair => pair.after.label !== undefined).map(pair => pair.after),
    labelsGone: byLabel.pairs.filter(pair => pair.before.label !== undefined).map(pair => pair.before),
  };
  const takeAuthor = waitingByText(author, unit => unit.key);
  for (const unit of byLabel.leftAfter) {
    if (ONE_SLOT.test(withoutLabel(unit))) {
      comparison.gaps.push(unit);
      if (unit.label !== undefined) comparison.newLabels.push(unit);
    } else if (unit.kind === "heading") {
      comparison.newHeadings.push(unit);
    } else if (takeAuthor(unit.key) !== undefined) {
      comparison.fromAuthor.push(unit);
    } else if (unit.label !== undefined && takeAuthor(withoutLabel(unit)) !== undefined) {
      comparison.fromAuthor.push(unit);
      comparison.newLabels.push(unit);
    } else {
      comparison.added.push(unit);
    }
  }
  comparison.newLabels.sort((first, second) => first.line - second.line);
  return comparison;
}

/**
 * The units of one document, in document order.
 *
 * - Prose: each sentence of a paragraph, a list item, a quotation or a table
 *   cell, and each heading, split into sentences in the same way.
 * - Code: the contents of each fenced or indented code block, whole and
 *   unchanged, a tab included.
 * - Image alternatives: the alternative text of each Markdown image outside a
 *   heading, taken out of the sentence it stood in. It stands in the order
 *   where its image stood: after a sentence that starts before the image,
 *   and before one that starts where the image starts or later.
 *
 * The text of a prose unit is its inline markup rendered as a reader sees
 * it: a link becomes its text, a reference link too where the document
 * defines it, the marks of emphasis, a strike and a code span go, an escape
 * and a character reference become the character, a backslash that makes a
 * hard line break goes, and an HTML tag goes. Then each run of white space
 * becomes one space and the ends are trimmed. The text is split into
 * sentences only after that, so a line wrap cannot move a boundary. A
 * sentence boundary inside a slot such as `[Author needed: reader. Confirm
 * role]` is no boundary, so the slot stays one unit.
 *
 * Prose that opens with a bold label ending in a colon, such as
 * `**Purpose:** Fix the pump.`, gives its first sentence the label and the
 * text after it, for the second match `compareUnits` makes.
 *
 * A unit inside an item of an ordered list carries the items it stands in,
 * as `structure` gives them for the first line of its block.
 *
 * A unit with no text is left out, as an empty table cell is.
 *
 * @param text The document, read as Markdown whatever its file ending.
 * @param reading Front matter is set aside unless `frontMatter` is false.
 */
export function documentUnits(text: string, reading: Reading = {}): Unit[] {
  const read = structure(text, reading);
  const references = new Set<string>(read.destinations.keys());
  // Each block's units, under the line the block starts on. Blocks never share a line.
  const blocks: UnitBlock[] = [];
  for (const paragraph of read.paragraphs) {
    const block = read.blocks.get(paragraph.line - 1);
    const inList = block?.kind === "list";
    blocks.push(unitBlock(paragraph.line, proseUnits(paragraph.lines.join("\n"), paragraph.line, inList ? "item" : "sentence", block?.id ?? paragraph.line - 1, references), read.steps));
  }
  for (const [index, line] of read.lines.entries()) {
    const block = read.blocks.get(index);
    if (block?.kind !== "table") continue;
    // A table's header line is the one its block is named after. Its divider is the line below, and holds no row.
    const cells = block.id === index ? tableCells(line.trim()) : read.tableRows.get(index) ?? [];
    const units: Unit[] = [];
    for (const cell of cells) {
      for (const unit of proseUnits(cell, index + 1, "cell", block.id, references)) {
        units.push(unit);
      }
    }
    blocks.push(unitBlock(index + 1, units, read.steps));
  }
  for (const heading of read.allHeadings) {
    blocks.push(unitBlock(heading.line, sentenceUnits(renderInline(heading.text, STRIKE), heading.line, "heading", -heading.line, null).map(sentence => sentence.unit), read.steps));
  }
  for (const code of read.code) {
    if (code.text !== "") blocks.push(unitBlock(code.line, [{ kind: "code", line: code.line, key: code.text, block: -code.line }], read.steps));
  }
  blocks.sort((first, second) => first.start - second.start);
  const units: Unit[] = [];
  // One push for each unit: a spread of a long paragraph's units into one call can pass the engine's limit on arguments.
  for (const block of blocks) {
    for (const unit of block.units) {
      units.push(unit);
    }
  }
  return units;
}

/**
 * The comparison as a table of what it found, a line of counts and two
 * closing statements. It prints only what the comparison reads.
 *
 * Each dropped unit is a row, in before order. Then come the after units
 * left over and the kept units out of order, in after order: each added
 * unit, each unit from the author, each marked gap, each run of moved units
 * and each run of units of steps out of order. A run is units next to each
 * other among the kept units in both versions, so a section moved whole is
 * one row. Its row names the lines of its first unit, says how many units
 * it stands for, and quotes the first. When that first moved unit opens with
 * `This`, `It` or `These`, the row asks what the word refers to.
 *
 * Added units of a list or a table that keeps no unit of the original share
 * one row, when there are two or more, with how many units it stands for and
 * the first unit's text. The count is of units, not of items or cells, so
 * the rows add up to the count of added units. Headings and labels are
 * counted and not listed.
 *
 * A unit is quoted by its first 60 characters, cleaned with `safeCell`, with
 * "..." where it was cut. A path is printed with `safePathCode`.
 *
 * @param comparison What `compareUnits` returned.
 * @param paths The paths to name: before, after, and the author's wording
 *     when one was given.
 */
export function formatComparison(comparison: Comparison, paths: ComparedPaths): string {
  const author = paths.authorText === null ? "" : `, author's wording ${safePathCode(paths.authorText)}`;
  const inOrder = comparison.kept.length - comparison.moved.length - comparison.stepOrder.length;
  const lines = [
    `Restructure comparison: before ${safePathCode(paths.before)}, after ${safePathCode(paths.after)}${author}`,
    "| Kind | Before | After | Finding |",
    "|------|--------|-------|---------|",
  ];
  for (const unit of comparison.dropped) {
    lines.push(`| dropped | ${unit.line} | | No unchanged copy is in the new version: ${quoted(unit.key)} |`);
  }
  for (const row of afterRows(comparison)) {
    lines.push(row);
  }
  lines.push(
    `Kept ${comparison.kept.length}: in order ${inOrder}, moved ${comparison.moved.length}, steps out of order ${comparison.stepOrder.length}. `
      + `Dropped ${comparison.dropped.length}. Added ${comparison.added.length}. `
      + `From the author ${comparison.fromAuthor.length}. Marked gaps ${comparison.gaps.length}. `
      + `New headings ${comparison.newHeadings.length}. Headings gone ${comparison.headingsGone.length}. `
      + `New labels ${comparison.newLabels.length}. Labels gone ${comparison.labelsGone.length}.`,
    "The comparison reads wording, not meaning.",
    "It does not yet pair a reworded unit with its original, or check that each number and code span is still there.",
  );
  return lines.join("\n");
}

/**
 * The comparison as the `restructure` key of a `--json` report holds it.
 * Nothing in it is cleaned for printing: a report is data for a program.
 *
 * @returns The paths, how many units each text holds, how many units were
 *     kept, a list of the kept units moved and one of those out of step
 *     order, and a list of every other unit by what it is. A moved unit's or
 *     a step's entry gives its line in each version, its kind, its first 60
 *     characters, the printed row it is in, counted from 1 among the rows of
 *     its kind, and the word the row asks about, or null. Every other entry
 *     gives the unit's line, its kind and its first 60 characters. A label's
 *     entry gives the label in place of the unit's text.
 */
export function comparisonReport(comparison: Comparison, paths: ComparedPaths): RestructureReport {
  return {
    before: paths.before,
    after: paths.after,
    authorText: paths.authorText,
    units: { before: comparison.before.length, after: comparison.after.length, authorText: comparison.author.length },
    kept: comparison.kept.length,
    moved: comparison.moved.map(orderEntry),
    stepOrder: comparison.stepOrder.map(orderEntry),
    dropped: comparison.dropped.map(unit => entry(unit, unit.key)),
    added: comparison.added.map(unit => entry(unit, unit.key)),
    fromAuthor: comparison.fromAuthor.map(unit => entry(unit, unit.key)),
    gaps: comparison.gaps.map(unit => entry(unit, unit.key)),
    newHeadings: comparison.newHeadings.map(unit => entry(unit, unit.key)),
    headingsGone: comparison.headingsGone.map(unit => entry(unit, unit.key)),
    newLabels: comparison.newLabels.map(unit => entry(unit, unit.label ?? "")),
    labelsGone: comparison.labelsGone.map(unit => entry(unit, unit.label ?? "")),
  };
}

/** One unit of wording: what holds it, the line it starts on, and its text. */
export interface Unit {
  readonly kind: UnitKind;
  /** The line the unit starts on, counted from 1. */
  readonly line: number;
  /** The text the unit is matched by. */
  readonly key: string;
  /** Units of one list or one table share this. Every other unit has its own. */
  readonly block: number;
  /** A bold label the unit opens with, such as `Purpose:`, as a reader sees it. */
  readonly label?: string;
  /** The items of ordered lists the unit stands in, outermost first. Absent outside every ordered list. */
  readonly steps?: readonly ListStep[];
}

/**
 * What holds a unit: a sentence of a paragraph or a quotation, a sentence of
 * a list item, a sentence of a table cell, a heading's sentence, a code
 * block, or an image's alternative text.
 */
export type UnitKind = "sentence" | "item" | "cell" | "heading" | "code" | "alternative";

/** A unit of the original and the unit of the new version it was matched with. */
export interface KeptPair {
  readonly before: Unit;
  readonly after: Unit;
}

/** A kept pair outside the order the kept units share, as `keptOrder` finds it. */
export interface OrderedPair extends KeptPair {
  /** The printed row the pair is in, counted from 1 among the rows of its kind. */
  readonly run: number;
  /** `This`, `It` or `These` when the pair opens its row and its unit opens with that word, or null. */
  readonly opensWith: string | null;
}

/** Two versions matched, as `compareUnits` describes. */
export interface Comparison {
  readonly before: readonly Unit[];
  readonly after: readonly Unit[];
  readonly author: readonly Unit[];
  /** Each pair of units with the same text, in before order. */
  readonly kept: readonly KeptPair[];
  /** The kept pairs moved, in before order. */
  readonly moved: readonly OrderedPair[];
  /** The kept pairs of steps out of order, in before order. */
  readonly stepOrder: readonly OrderedPair[];
  readonly dropped: Unit[];
  readonly added: Unit[];
  readonly fromAuthor: Unit[];
  readonly gaps: Unit[];
  readonly newHeadings: Unit[];
  readonly headingsGone: Unit[];
  /** The after units kept or taken from the author by the text after a label they gained or changed, and each gap with a label. */
  readonly newLabels: Unit[];
  /** The before units kept by the text after a label they lost or changed. */
  readonly labelsGone: Unit[];
}

/** The paths a comparison names, as the report shows them. */
export interface ComparedPaths {
  readonly before: string;
  readonly after: string;
  readonly authorText: string | null;
}

/** The `restructure` key of a `--json` report. */
export interface RestructureReport {
  before: string;
  after: string;
  authorText: string | null;
  units: { before: number; after: number; authorText: number };
  kept: number;
  moved: ReportedOrder[];
  stepOrder: ReportedOrder[];
  dropped: ReportedUnit[];
  added: ReportedUnit[];
  fromAuthor: ReportedUnit[];
  gaps: ReportedUnit[];
  newHeadings: ReportedUnit[];
  headingsGone: ReportedUnit[];
  newLabels: ReportedUnit[];
  labelsGone: ReportedUnit[];
}

/** One unit in a report: its line, its kind and its first 60 characters. */
export interface ReportedUnit {
  line: number;
  kind: UnitKind;
  excerpt: string;
}

/** One kept unit out of order in a report, as `comparisonReport` describes. */
export interface ReportedOrder {
  before: number;
  after: number;
  kind: UnitKind;
  excerpt: string;
  run: number;
  opensWith: string | null;
}

/**
 * The kept pairs outside the longest order the kept units share with the
 * original: the units of steps out of order, then the units moved.
 *
 * A step is an item of an ordered list in the original. For each such list,
 * the kept units that stand in its items are read in original order, and
 * the units of each item are first put in their new order, so units that
 * change places inside one item change nothing here. Those outside the
 * longest run of them in increasing new order are steps out of order. A list
 * nested in an item is read on its own, and its units count for the item
 * that holds it too.
 *
 * Then every other kept unit is read in the same way, and those outside the
 * longest run in increasing new order are moved.
 *
 * Where two such runs are as long, the one the search meets last in the
 * original wins, so of two units that swap places, the one that stood first
 * in the original is named. Each search takes time in proportion to n log n
 * for n units.
 *
 * @param kept The kept pairs, in before order.
 * @param afterIndex Where each after unit stands in its version.
 */
function keptOrder(kept: readonly KeptPair[], afterIndex: ReadonlyMap<Unit, number>): { moved: OrderedPair[]; stepOrder: OrderedPair[] } {
  const newPlace = kept.map(pair => afterIndex.get(pair.after) ?? 0);
  const outOfStep = new Uint8Array(kept.length);
  for (const positions of stepsByList(kept).values()) {
    const ordered = positions.map(([position]) => position);
    // Units of one item stand together in the original, so each item is one run of the list to put in its new order.
    let start = 0;
    for (let end = 1; end <= positions.length; end++) {
      if (end < positions.length && positions[end]?.[1] === positions[start]?.[1]) continue;
      const item = ordered.slice(start, end).sort((first, second) => (newPlace[first] ?? 0) - (newPlace[second] ?? 0));
      for (const [offset, position] of item.entries()) {
        ordered[start + offset] = position;
      }
      start = end;
    }
    const inStep = longestIncreasing(ordered.map(position => newPlace[position] ?? 0));
    for (const [index, position] of ordered.entries()) {
      if (inStep[index] === 0) outOfStep[position] = 1;
    }
  }
  const others = kept.flatMap((pair, position) => outOfStep[position] === 1 ? [] : [position]);
  const inPlace = longestIncreasing(others.map(position => newPlace[position] ?? 0));
  const moved = new Uint8Array(kept.length);
  for (const [index, position] of others.entries()) {
    if (inPlace[index] === 0) moved[position] = 1;
  }
  const rank = new Int32Array(kept.length);
  for (const [order, position] of kept.map((pair, index) => index).sort((first, second) => (newPlace[first] ?? 0) - (newPlace[second] ?? 0)).entries()) {
    rank[position] = order;
  }
  return { moved: runs(kept, moved, rank, true), stepOrder: runs(kept, outOfStep, rank, false) };
}

/**
 * For each ordered list of the original, the positions of the kept pairs
 * whose before unit stands in one of its items, in before order, each with
 * the item it stands in.
 */
function stepsByList(kept: readonly KeptPair[]): Map<number, Array<[number, number]>> {
  const lists = new Map<number, Array<[number, number]>>();
  for (const [position, pair] of kept.entries()) {
    for (const step of pair.before.steps ?? []) {
      const list = lists.get(step.list);
      if (list === undefined) {
        lists.set(step.list, [[position, step.item]]);
      } else {
        list.push([position, step.item]);
      }
    }
  }
  return lists;
}

/**
 * The flagged kept pairs, grouped into runs: a pair continues the run of the
 * pair before it in before order when that pair is flagged too and stands
 * just before it among the kept units of the new version.
 *
 * @param rank Where each kept pair stands among the kept units of the new version.
 * @param askReferent Whether a run whose first unit is prose opening with
 *     `This`, `It` or `These` names that word.
 */
function runs(kept: readonly KeptPair[], flagged: Uint8Array, rank: Int32Array, askReferent: boolean): OrderedPair[] {
  const found: OrderedPair[] = [];
  let run = 0;
  for (const [position, pair] of kept.entries()) {
    if (flagged[position] === 0) continue;
    const continues = position > 0 && flagged[position - 1] === 1 && rank[position] === (rank[position - 1] ?? 0) + 1;
    if (!continues) run++;
    const word = !continues && askReferent && PROSE_KINDS.has(pair.after.kind) ? REFERENT.exec(withoutLabel(pair.after))?.[1] ?? null : null;
    found.push({ before: pair.before, after: pair.after, run, opensWith: word });
  }
  return found;
}

/**
 * Which values belong to one longest strictly increasing run of them, read
 * in order, by patience sorting: time in proportion to n log n.
 *
 * @returns One flag for each value, 1 where it belongs to the run.
 */
function longestIncreasing(values: readonly number[]): Uint8Array {
  // The last index of the run with the smallest last value, for each length, and the index before each in its run.
  const tails: number[] = [];
  const previous = new Int32Array(values.length);
  for (const [index, value] of values.entries()) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((values[tails[middle] ?? 0] ?? 0) < value) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    previous[index] = low > 0 ? tails[low - 1] ?? -1 : -1;
    tails[low] = index;
  }
  const chosen = new Uint8Array(values.length);
  for (let index = tails.at(-1) ?? -1; index !== -1; index = previous[index] ?? -1) {
    chosen[index] = 1;
  }
  return chosen;
}

/**
 * Pairs the after units with before units of the same text, so that the
 * most pairs keep their order, and returns what is left of each side.
 *
 * Each after unit is offered every copy of its text in the original, last
 * copy first, and the longest run of offers in increasing original order is
 * the largest set of pairs that keep their order. A text past
 * `PAIRING_BUDGET` offers each after copy only the original copy at the same
 * place in document order. Copies left over pair in document order.
 */
function pairKeepingOrder(before: readonly Unit[], after: readonly Unit[]): { pairs: KeptPair[]; leftBefore: Unit[]; leftAfter: Unit[] } {
  const copiesBefore = positionsByKey(before);
  const weighed = weighedTexts(copiesBefore, positionsByKey(after));
  const offeredBefore: number[] = [];
  const offeredAfter: number[] = [];
  const copiesSeen = new Map<string, number>();
  for (const [index, unit] of after.entries()) {
    const copies = copiesBefore.get(unit.key);
    if (copies === undefined) continue;
    if (weighed.has(unit.key)) {
      for (let copy = copies.length - 1; copy >= 0; copy--) {
        offeredBefore.push(copies[copy] ?? 0);
        offeredAfter.push(index);
      }
    } else {
      const copy = copiesSeen.get(unit.key) ?? 0;
      copiesSeen.set(unit.key, copy + 1);
      if (copy < copies.length) {
        offeredBefore.push(copies[copy] ?? 0);
        offeredAfter.push(index);
      }
    }
  }
  const chosen = longestIncreasing(offeredBefore);
  const takenBefore = new Uint8Array(before.length);
  const takenAfter = new Uint8Array(after.length);
  const pairs: KeptPair[] = [];
  for (const [offer, beforeAt] of offeredBefore.entries()) {
    if (chosen[offer] === 0) continue;
    const afterAt = offeredAfter[offer] ?? 0;
    takenBefore[beforeAt] = 1;
    takenAfter[afterAt] = 1;
    const pair = { before: before[beforeAt], after: after[afterAt] };
    if (pair.before !== undefined && pair.after !== undefined) pairs.push({ before: pair.before, after: pair.after });
  }
  const rest = pairByText(before.filter((unit, index) => takenBefore[index] === 0), after.filter((unit, index) => takenAfter[index] === 0), unit => unit.key);
  for (const pair of rest.pairs) {
    pairs.push(pair);
  }
  return { pairs, leftBefore: rest.leftBefore, leftAfter: rest.leftAfter };
}

/** Where each text stands in a list of units, its copies in document order. */
function positionsByKey(units: readonly Unit[]): Map<string, number[]> {
  const positions = new Map<string, number[]>();
  for (const [index, unit] of units.entries()) {
    const copies = positions.get(unit.key);
    if (copies === undefined) {
      positions.set(unit.key, [index]);
    } else {
      copies.push(index);
    }
  }
  return positions;
}

/**
 * The texts in both versions whose every pairing of copies is weighed: those
 * with the fewest pairings first, until the next would pass `PAIRING_BUDGET`.
 */
function weighedTexts(before: ReadonlyMap<string, readonly number[]>, after: ReadonlyMap<string, readonly number[]>): Set<string> {
  const pairings: Array<[string, number]> = [];
  for (const [key, copies] of after) {
    const original = before.get(key);
    if (original !== undefined) pairings.push([key, original.length * copies.length]);
  }
  pairings.sort((first, second) => first[1] - second[1]);
  const weighed = new Set<string>();
  let spent = 0;
  for (const [key, count] of pairings) {
    if (spent + count > PAIRING_BUDGET) break;
    spent += count;
    weighed.add(key);
  }
  return weighed;
}

/** One block's units, under the line the block starts on. */
interface UnitBlock {
  readonly start: number;
  readonly units: readonly Unit[];
}

/** A block's units, each given the ordered steps the block's first line stands in, if any. */
function unitBlock(start: number, units: readonly Unit[], steps: ReadonlyMap<number, readonly ListStep[]>): UnitBlock {
  const chain = steps.get(start - 1);
  return { start, units: chain === undefined ? units : units.map(unit => ({ ...unit, steps: chain })) };
}

/**
 * The units of one piece of prose, in the order a reader meets them: each
 * sentence, and the alternative text of each image in it, placed where the
 * image stands, as `documentUnits` describes.
 *
 * @param source The prose with its inline markup, which may run over lines.
 * @param firstLine The line its first character stands on.
 * @param references The labels the document defines, as `normaliseReference` gives them.
 */
function proseUnits(source: string, firstLine: number, kind: UnitKind, block: number, references: ReadonlySet<string>): Unit[] {
  const alternatives: Unit[][] = [];
  // The prose without its images, and the same prose with a mark where each image stood.
  let prose = "";
  let marked = "";
  const mark = absentMark(source);
  let from = 0;
  for (const image of markdownLinks(source)) {
    // An image inside another's text is not rendered on its own, and goes with that text.
    if (!image.image || !image.rendered || !isShown(image, references)) continue;
    const line = firstLine + lineBreaks(source.slice(0, image.start));
    alternatives.push(sentenceUnits(renderInline(inlineText(image.label, references), STRIKE), line, "alternative", block, null).map(sentence => sentence.unit));
    const breaks = "\n".repeat(lineBreaks(source.slice(image.start, image.end)));
    prose += source.slice(from, image.start) + breaks;
    marked += source.slice(from, image.start) + mark + breaks;
    from = image.end;
  }
  prose += source.slice(from);
  const sentences = sentenceUnits(renderInline(inlineText(prose, references), STRIKE), firstLine, kind, block, boldLabel(prose, references));
  if (alternatives.length === 0) return sentences.map(sentence => sentence.unit);
  marked += source.slice(from);
  const places = markPlaces(renderInline(inlineText(marked, references), STRIKE), mark);
  const units: Unit[] = [];
  // A mark that rendering dropped leaves no place to read, so every alternative then comes first, as all did before.
  const placed = places.length === alternatives.length;
  let next = 0;
  for (const sentence of sentences) {
    while (next < alternatives.length && (!placed || (places[next] ?? 0) <= sentence.start)) {
      for (const unit of alternatives[next] ?? []) {
        units.push(unit);
      }
      next++;
    }
    units.push(sentence.unit);
  }
  for (; next < alternatives.length; next++) {
    for (const unit of alternatives[next] ?? []) {
      units.push(unit);
    }
  }
  return units;
}

/**
 * A character from the private use area that a text does not hold, to mark
 * a place in it, or an empty string when it holds every one.
 */
function absentMark(text: string): string {
  const present = new Set<number>();
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0xE000 && code <= 0xF8FF) present.add(code);
  }
  for (let code = 0xE000; code <= 0xF8FF; code++) {
    if (!present.has(code)) return String.fromCharCode(code);
  }
  return "";
}

/**
 * Where each mark stands in rendered text once the marks are taken out, each
 * run of white space is made one space and the ends are trimmed, as
 * `singleSpaced` makes them. A mark after white space stands after that
 * space, where the next word starts.
 */
function markPlaces(rendered: string, mark: string): number[] {
  const places: number[] = [];
  if (mark === "") return places;
  let length = 0;
  let space = false;
  for (const character of rendered) {
    if (character === mark) {
      places.push(length + (space && length > 0 ? 1 : 0));
    } else if (/\s/u.test(character)) {
      space = true;
    } else {
      if (space && length > 0) length++;
      space = false;
      length += character.length;
    }
  }
  return places;
}

/** Whether a reader sees an image `markdownLinks` found: an inline one, or a reference one the document defines. */
function isShown(image: MarkdownLink, references: ReadonlySet<string>): boolean {
  if (image.kind === "inline") return true;
  return references.has(normaliseReference(image.kind === "reference" && image.target !== "" ? image.target : image.label));
}

/**
 * The label prose opens with, as a reader sees it and with its colon, or
 * null when it opens with none.
 */
function boldLabel(prose: string, references: ReadonlySet<string>): string | null {
  const match = BOLD_LABEL.exec(prose);
  if (match === null) return null;
  const label = singleSpaced(renderInline(inlineText(match[2] ?? "", references), STRIKE)).text + (match[3] ?? "");
  return label.endsWith(":") ? label : null;
}

/**
 * The sentences of rendered text as units, each placed on the line it starts
 * on, with where it starts in the text made single-spaced. The white space
 * is made single first, and the text split after.
 *
 * @param rendered Text a reader sees, which may run over lines.
 * @param firstLine The line its first character stands on.
 * @param label The label the text opens with, given to the first sentence
 *     when that sentence holds more than the label. Null for none.
 */
function sentenceUnits(rendered: string, firstLine: number, kind: UnitKind, block: number, label: string | null): Array<{ unit: Unit; start: number }> {
  const { text, lines } = singleSpaced(rendered);
  return wholeSlots(text, locateSentences(text)).map((sentence, index) => {
    const unit = { kind, line: firstLine + (lines[sentence.start] ?? 0), key: sentence.text, block };
    return { unit: index === 0 && label !== null && sentence.text.startsWith(`${label} `) ? { ...unit, label } : unit, start: sentence.start };
  });
}

/**
 * The sentences of a text, with any that a slot such as
 * `[Author needed: reader. Confirm role]` runs across joined into one. A full
 * stop inside a slot is part of its instructions, and ends no sentence.
 *
 * @param text The text the sentences were found in.
 * @param sentences Its sentences, as `locateSentences` gives them.
 */
function wholeSlots(text: string, sentences: readonly LocatedSentence[]): LocatedSentence[] {
  // Slots and sentences both run in text order, so one pass over each finds every slot a sentence starts inside.
  const slots = slotSpans(text);
  let next = 0;
  let slot = slots[next];
  const joined: LocatedSentence[] = [];
  for (const sentence of sentences) {
    while (slot !== undefined && slot.end <= sentence.start) {
      next++;
      slot = slots[next];
    }
    const previous = joined.at(-1);
    if (previous !== undefined && slot !== undefined && slot.start < sentence.start) {
      joined[joined.length - 1] = { text: text.slice(previous.start, sentence.start + sentence.text.length), start: previous.start };
    } else {
      joined.push(sentence);
    }
  }
  return joined;
}

/**
 * Where each slot in a text starts and ends, in text order. A slot runs from
 * its opening to the first closing bracket after it. The text is read once:
 * the search for an opening starts after the last slot, and when no closing
 * bracket is left, no later opening can close either, so the search stops.
 */
function slotSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let from = 0;
  let start = text.indexOf(SLOT_OPENING, from);
  while (start !== -1) {
    const close = text.indexOf("]", start + SLOT_OPENING.length);
    if (close === -1) break;
    spans.push({ start, end: close + 1 });
    from = close + 1;
    start = text.indexOf(SLOT_OPENING, from);
  }
  return spans;
}

/**
 * Text with each run of white space made one space and the ends trimmed, and
 * for each code unit kept, how many line breaks stood before it.
 */
function singleSpaced(rendered: string): { text: string; lines: number[] } {
  let text = "";
  const lines: number[] = [];
  let breaks = 0;
  let space = false;
  for (const character of rendered) {
    if (/\s/u.test(character)) {
      if (character === "\n") breaks++;
      space = text !== "";
      continue;
    }
    if (space) {
      text += " ";
      lines.push(breaks);
      space = false;
    }
    text += character;
    // A character past the basic plane takes two code units, and each needs its entry.
    lines.push(breaks);
    if (character.length > 1) lines.push(breaks);
  }
  return { text, lines };
}

/** How many line breaks a text holds. */
function lineBreaks(text: string): number {
  return text.split("\n").length - 1;
}

/** A unit's text after its label, or its whole text when it has none. */
function withoutLabel(unit: Unit): string {
  return unit.label === undefined ? unit.key : unit.key.slice(unit.label.length + 1);
}

/**
 * Pairs the after units with before units by one reading of their text, in
 * document order on both sides, and returns what is left of each side.
 */
function pairByText(before: readonly Unit[], after: readonly Unit[], text: (unit: Unit) => string): {
  pairs: KeptPair[]; leftBefore: Unit[]; leftAfter: Unit[];
} {
  const take = waitingByText(before, text);
  const pairs: KeptPair[] = [];
  const leftAfter: Unit[] = [];
  for (const unit of after) {
    const match = take(text(unit));
    if (match === undefined) {
      leftAfter.push(unit);
    } else {
      pairs.push({ before: match, after: unit });
    }
  }
  const paired = new Set(pairs.map(pair => pair.before));
  return { pairs, leftBefore: before.filter(unit => !paired.has(unit)), leftAfter };
}

/**
 * Units waiting to be matched, by their text, each text's units taken in
 * document order.
 *
 * @returns A function that takes the first unit with a text not yet taken,
 *     or gives undefined when none is left.
 */
function waitingByText(units: readonly Unit[], text: (unit: Unit) => string): (wanted: string) => Unit | undefined {
  const groups = new Map<string, { units: Unit[]; next: number }>();
  for (const unit of units) {
    const group = groups.get(text(unit));
    if (group === undefined) {
      groups.set(text(unit), { units: [unit], next: 0 });
    } else {
      group.units.push(unit);
    }
  }
  return wanted => {
    const group = groups.get(wanted);
    if (group === undefined || group.next === group.units.length) return undefined;
    group.next++;
    return group.units[group.next - 1];
  };
}

/**
 * The rows for the after units left over and the kept units out of order,
 * in after order. A list or table that keeps no unit of the original gives
 * one row for its added units when it holds two or more. A run of units
 * moved, or of units of steps out of order, gives one row.
 */
function afterRows(comparison: Comparison): string[] {
  const keptBlocks = new Set(comparison.kept.map(pair => pair.after.block));
  const groups = new Map<number, Unit[]>();
  for (const unit of comparison.added) {
    if ((unit.kind === "item" || unit.kind === "cell") && !keptBlocks.has(unit.block)) {
      const group = groups.get(unit.block);
      if (group === undefined) {
        groups.set(unit.block, [unit]);
      } else {
        group.push(unit);
      }
    }
  }
  const rows: Array<{ line: number; text: string }> = [];
  for (const unit of comparison.added) {
    const group = groups.get(unit.block);
    if (group === undefined || group.length < 2) {
      rows.push({ line: unit.line, text: `| added | | ${unit.line} | Not in the original or the author's wording. Confirm its source: ${quoted(unit.key)} |` });
    } else if (group[0] === unit) {
      // A unit is a sentence or a cell, so the count is of units and not of items or cells.
      const what = unit.kind === "cell" ? "units in one new table" : "units in one new list";
      rows.push({ line: unit.line, text: `| added | | ${unit.line} | ${group.length} ${what} are not in the original or the author's wording. Confirm their source: ${quoted(unit.key)} |` });
    }
  }
  for (const unit of comparison.fromAuthor) {
    rows.push({ line: unit.line, text: `| from the author | | ${unit.line} | Matches the author's wording: ${quoted(unit.key)} |` });
  }
  for (const unit of comparison.gaps) {
    rows.push({ line: unit.line, text: `| marked gap | | ${unit.line} | A slot left for the author: ${quoted(unit.key)} |` });
  }
  for (const run of grouped(comparison.moved)) {
    const first = run[0];
    if (first === undefined) continue;
    const finding = run.length === 1
      ? "Kept, but moved out of its original order. Check that it keeps what it depends on and the claim it qualifies:"
      : `${run.length} units kept, but moved together out of their original order. Check that they keep what they depend on and the claims they qualify:`;
    const word = first.opensWith;
    const question = word === null ? "" : ` ${run.length === 1 ? "It" : "The first"} opens with "${word}". Check what "${word}" refers to in its new place.`;
    rows.push({ line: first.after.line, text: `| moved | ${first.before.line} | ${first.after.line} | ${finding} ${quoted(first.after.key)}${question} |` });
  }
  for (const run of grouped(comparison.stepOrder)) {
    const first = run[0];
    if (first === undefined) continue;
    const finding = run.length === 1
      ? "A step of an ordered list now stands in another order against its neighbouring steps. Put it back, or confirm the steps can happen in this order:"
      : `${run.length} units of ordered-list steps now stand together in another order against their neighbouring steps. Put them back, or confirm the steps can happen in this order:`;
    rows.push({ line: first.after.line, text: `| step order | ${first.before.line} | ${first.after.line} | ${finding} ${quoted(first.after.key)} |` });
  }
  return rows.sort((first, second) => first.line - second.line).map(row => row.text);
}

/** Ordered pairs grouped by the run each is in, in run order. */
function grouped(pairs: readonly OrderedPair[]): OrderedPair[][] {
  const found: OrderedPair[][] = [];
  for (const pair of pairs) {
    const last = found.at(-1);
    if (last !== undefined && last[0]?.run === pair.run) {
      last.push(pair);
    } else {
      found.push([pair]);
    }
  }
  return found;
}

/** The first characters of a text in double quotes, cleaned for a table cell. */
function quoted(text: string): string {
  const characters = Array.from(text);
  const cut = characters.length > EXCERPT_LENGTH;
  return `"${safeCell(characters.slice(0, EXCERPT_LENGTH).join(""))}${cut ? "..." : ""}"`;
}

/** The first 60 characters of a text. */
function excerpt(text: string): string {
  return Array.from(text).slice(0, EXCERPT_LENGTH).join("");
}

/** A unit as a report lists it, quoting the text given. */
function entry(unit: Unit, text: string): ReportedUnit {
  return { line: unit.line, kind: unit.kind, excerpt: excerpt(text) };
}

/** A kept unit out of order as a report lists it. */
function orderEntry(pair: OrderedPair): ReportedOrder {
  return { before: pair.before.line, after: pair.after.line, kind: pair.after.kind, excerpt: excerpt(pair.after.key), run: pair.run, opensWith: pair.opensWith };
}
