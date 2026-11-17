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
// lists each kept unit outside it once, for a person to check: a step of an
// ordered list out of order against the other steps of its list as a step
// out of order, and any other unit as moved. A step out of order against
// its list is listed even where it stands inside that longest order.
//
// Units left over on both sides are then read again, as `rewording.ts`
// describes: a pair that shares half the longer one's words or more is
// rewritten, units of the original that share most of their words with a new
// table are read with it, and each number and code span of a unit not kept is
// looked for in the whole new version.
//
// It reads wording, not meaning. A sentence reworded further than that reads
// as dropped and added, and a sentence kept word for word whose meaning
// changed in its new place reads as kept.

import { renderInline } from "./inline-wording.ts";
import { figureFound, figureValues, foundIn, pairReworded, PIPE_ESCAPE, tablesFrom, WEIGHING_BUDGET, type FigureValue, type Found, type Meter, type ReworkedPair } from "./rewording.ts";
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

/** Any letter, in any script. A heading's unit with none, such as the number of `## 4. Remove`, is not read for order. */
const LETTER = /\p{L}/u;

/**
 * How many ordered lists around a unit, innermost first, its order is read
 * against. Reading every list around every unit takes their product in time,
 * which a long run of nested markers on one line makes large.
 */
const STEP_DEPTH = 10;

/** The kinds of unit that are prose, so a word opening one can point back. */
const PROSE_KINDS: ReadonlySet<UnitKind> = new Set(["sentence", "item", "cell"]);

/** The kinds of unit that can pair as rewritten, be read with a new table, or hold a value that is looked for. */
const REWORDED_KINDS: ReadonlySet<UnitKind> = new Set(["sentence", "item", "cell", "alternative"]);

/** What the printed comparison says it pairs and reads as values, when it weighed them. */
const WEIGHED_LINE = "It pairs a reworded unit only where the two share half the longer one's words or more, and reads only figures and code spans as values.";

/** What the printed comparison says when its searches passed `WEIGHING_BUDGET`. */
const NOT_WEIGHED_LINE = "It found too many shared words to weigh, so it paired no reworded unit, read no new table and traced no value.";

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
  return compareUnits(documentUnits(before, reading), documentUnits(after, reading), authorText === null ? [] : documentUnits(authorText, reading), after);
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
 * the label is counted. This second match pairs only what the first leaves,
 * so `Purpose: Fix the pump.` written as plain text still matches itself.
 *
 * Which copies the first match leaves decides whether the second match's
 * pairs keep their order. So the first match is made twice: by whole
 * wording alone, and with pairs by label weighed in the same search, as
 * `pairKeepingOrder` describes. Both pair whole wording as often, but they
 * can pair different copies by label. The one that keeps more units is
 * used, then the one that keeps more of them in order, and the one by whole
 * wording alone on a tie. No comparison keeps fewer units than whole wording
 * alone would, nor fewer in order when it keeps as many. Neither match is
 * searched again after `pairKeepingOrder` leaves out pairs by label, so when
 * repeated wording and labels both change, a unit that another pairing
 * would keep in place can read as moved or as a step out of order. Which unit reads as dropped, and which labels
 * are counted, can differ from whole wording alone.
 *
 * An after unit still left over is sorted in this order:
 *
 * 1. A unit that, after any label, is one slot such as
 *    `[Author needed: reader]` and nothing else is a marked gap.
 * 2. A heading is a new heading. Part 5 lets a restructure change headings,
 *    so it is counted and not listed. A before heading left over is counted
 *    as gone in the same way, and is not dropped. A heading is counted once,
 *    however many of its sentences are left over.
 * 3. A unit that matches a unit of the author's wording, whole or after its
 *    label, comes from the author. Each unit of the author's wording accounts
 *    for one after unit.
 * 4. Any other unit is added.
 *
 * The kept units are then read in order, as `keptOrder` describes, and the
 * units dropped and added are read again, as `readRewording` describes.
 *
 * @param afterSource The new version's whole text, which values are looked
 *     for in as well as its units. Empty when only units are given.
 * @returns The pairs kept, in before order, the kept pairs moved and those
 *     out of step order, and every other unit in the order of its own version.
 */
export function compareUnits(before: readonly Unit[], after: readonly Unit[], author: readonly Unit[], afterSource = ""): Comparison {
  const beforeIndex = new Map(before.map((unit, index) => [unit, index]));
  const afterIndex = new Map(after.map((unit, index) => [unit, index]));
  let match = matched(before, after, true, beforeIndex);
  if (match.offeredByLabel) {
    const wholeFirst = matched(before, after, false, beforeIndex);
    // More units kept wins, then more kept in order, and whole wording alone on a tie.
    const keepsMore = wholeFirst.kept.length - match.kept.length;
    if (keepsMore > 0 || keepsMore === 0 && inOrder(wholeFirst.kept, afterIndex) >= inOrder(match.kept, afterIndex)) match = wholeFirst;
  }
  const { kept, leftBefore, leftAfter } = match;
  const { moved, stepOrder } = keptOrder(kept, afterIndex);
  // A pair whose texts differ was paired by the text after a label, so it differs in its labels.
  const byItsLabel = kept.filter(pair => pair.before.key !== pair.after.key);
  const comparison: Comparison = {
    before, after, author, kept, moved, stepOrder,
    dropped: leftBefore.filter(unit => unit.kind !== "heading"),
    headingsGone: byHeading(leftBefore.filter(unit => unit.kind === "heading")),
    added: [], fromAuthor: [], gaps: [], newHeadings: [],
    newLabels: byItsLabel.filter(pair => pair.after.label !== undefined).map(pair => pair.after),
    labelsGone: byItsLabel.filter(pair => pair.before.label !== undefined).map(pair => pair.before),
    rewritten: [], tables: [], values: [], weighed: true,
  };
  const takeAuthor = waitingByText(author, unit => unit.key);
  const headingUnits: Unit[] = [];
  for (const unit of leftAfter) {
    if (ONE_SLOT.test(withoutLabel(unit))) {
      comparison.gaps.push(unit);
      if (unit.label !== undefined) comparison.newLabels.push(unit);
    } else if (unit.kind === "heading") {
      headingUnits.push(unit);
    } else if (takeAuthor(unit.key) !== undefined) {
      comparison.fromAuthor.push(unit);
    } else if (unit.label !== undefined && takeAuthor(withoutLabel(unit)) !== undefined) {
      comparison.fromAuthor.push(unit);
      comparison.newLabels.push(unit);
    } else {
      comparison.added.push(unit);
    }
  }
  // One at a time: spreading a long list into push overflows the stack.
  for (const heading of byHeading(headingUnits)) {
    comparison.newHeadings.push(heading);
  }
  comparison.newLabels.sort((first, second) => first.line - second.line);
  return readRewording(comparison, afterSource);
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
 * Each dropped unit is a row, in before order, then each value not found,
 * in before order. Then come the after units left over and the kept units
 * out of order, in after order: each rewritten pair, each new table read
 * with units of the original, each added unit, each unit from the author,
 * each marked gap, each run of moved units and each run of units of steps
 * out of order. A run is units next to each
 * other among the kept units in both versions, so a section moved whole is
 * one row. Its row names the lines of its first unit, says how many units
 * it stands for, and quotes the first. When that first moved unit opens with
 * `This`, `It` or `These`, the row asks what the word refers to.
 *
 * Added units of a list or a table that keeps no unit of the original, and
 * rewords none, share one row, when there are two or more, with how many
 * units it stands for and the first unit's text. The count is of units, not
 * of items or cells, so the rows add up to the count of added units.
 * Headings and labels are counted and not listed.
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
  const lines = [
    `Restructure comparison: before ${safePathCode(paths.before)}, after ${safePathCode(paths.after)}${author}`,
    "| Kind | Before | After | Finding |",
    "|------|--------|-------|---------|",
  ];
  for (const unit of comparison.dropped) {
    lines.push(`| dropped | ${unit.line} | | No unchanged copy is in the new version: ${quoted(unit.key)} |`);
  }
  for (const value of comparison.values) {
    const finding = value.kind === "number"
      ? "A number of the original is found in the new version neither in figures nor in words."
      : "A code span of the original is not found in the new version.";
    lines.push(`| value | ${value.unit.line} | ${value.after === null ? "" : `${value.after} `}| ${finding} Check that it was not cut or changed: ${quoted(value.value)} in ${quoted(value.unit.key)} |`);
  }
  for (const row of afterRows(comparison)) {
    lines.push(row);
  }
  lines.push(
    `Kept ${comparison.kept.length}: moved ${comparison.moved.length}, steps out of order ${comparison.stepOrder.length}. `
      + `Rewritten ${comparison.rewritten.length}. Into new tables ${comparison.tables.reduce((sum, table) => sum + table.sources.length, 0)}. `
      + `Dropped ${comparison.dropped.length}. Added ${comparison.added.length}. Values not found ${comparison.values.length}. `
      + `From the author ${comparison.fromAuthor.length}. Marked gaps ${comparison.gaps.length}. `
      + `New headings ${comparison.newHeadings.length}. Headings gone ${comparison.headingsGone.length}. `
      + `New labels ${comparison.newLabels.length}. Labels gone ${comparison.labelsGone.length}.`,
    "The comparison reads wording, not meaning.",
    comparison.weighed ? WEIGHED_LINE : NOT_WEIGHED_LINE,
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
 *     entry gives the label in place of the unit's text. A heading's entry is
 *     one for the heading, and holds its sentences left over, joined by a
 *     space. A rewritten pair's entry gives both lines, the new unit's kind,
 *     the first 60 characters of each unit, the words shared and the words
 *     of the longer. A table's entry gives the lines of the units read with
 *     it, its first line, how many units it holds, the first 60 characters
 *     of the first unit read with it, and how many of their values are in
 *     the table, elsewhere and not found. A value's entry gives its unit's
 *     line, the line of the unit or table it went to or null, its kind, and
 *     the first 60 characters of the value and of its unit. `weighed` is
 *     false when the searches passed their limit and none of these was read.
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
    rewritten: comparison.rewritten.map(pair => ({
      before: pair.before.line, after: pair.after.line, kind: pair.after.kind, excerpt: excerpt(pair.after.key), original: excerpt(pair.before.key), shared: pair.shared, words: pair.longer,
    })),
    tables: comparison.tables.map(table => ({
      before: table.sources.map(unit => unit.line), after: table.cells[0]?.line ?? 0, units: table.cells.length, excerpt: excerpt(table.sources[0]?.key ?? ""),
      values: { inTable: table.inTable, elsewhere: table.elsewhere, notFound: table.notFound },
    })),
    values: comparison.values.map(value => ({ before: value.unit.line, after: value.after, kind: value.kind, value: excerpt(value.value), excerpt: excerpt(value.unit.key) })),
    weighed: comparison.weighed,
  };
}

/** One unit of wording: what holds it, the line it starts on, and its text. */
export interface Unit {
  readonly kind: UnitKind;
  /** The line the unit starts on, counted from 1. */
  readonly line: number;
  /** The text the unit is matched by. */
  readonly key: string;
  /** The units of one list, one table or one heading share this, as do the sentences of one paragraph. Each heading's is its own. */
  readonly block: number;
  /** A bold label the unit opens with, such as `Purpose:`, as a reader sees it. */
  readonly label?: string;
  /** The items of ordered lists the unit stands in, outermost first. Absent outside every ordered list. */
  readonly steps?: readonly ListStep[];
  /** Where the contents of each code span stand in `key`, in order. Absent when the unit holds none. */
  readonly spans?: readonly CodeSpan[];
}

/** Where a piece of a unit's text starts, and where it ends, just past its last character. */
export interface CodeSpan {
  readonly start: number;
  readonly end: number;
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
  /** One unit for each heading with a sentence left over, holding those sentences, as `byHeading` gives them. */
  readonly newHeadings: Unit[];
  /** The same for the before version. */
  readonly headingsGone: Unit[];
  /** The after units kept or taken from the author by the text after a label they gained or changed, and each gap with a label. */
  readonly newLabels: Unit[];
  /** The before units kept by the text after a label they lost or changed. */
  readonly labelsGone: Unit[];
  /** Each unit of the original paired with the unit that rewords it, in before order. */
  readonly rewritten: readonly ReworkedPair[];
  /** Each new table read with units of the original, in after order. */
  readonly tables: readonly TableRead[];
  /** Each value of a unit not kept that the new version does not hold, in before order. */
  readonly values: readonly MissingValue[];
  /** False when the searches for rewording, tables and values passed their limit, so none of them was read. */
  readonly weighed: boolean;
}

/** A new table and the units of the original read with it, as `readRewording` describes. */
export interface TableRead {
  /** The units of the original read with the table, in before order. */
  readonly sources: readonly Unit[];
  /** The table's units, in after order. */
  readonly cells: readonly Unit[];
  /** How many of the values of the units read with it the table holds. */
  readonly inTable: number;
  /** How many the new version holds outside the table. */
  readonly elsewhere: number;
  /** How many it does not hold. */
  readonly notFound: number;
}

/** A number or code span of a unit not kept, found nowhere in the new version. */
export interface MissingValue {
  /** The unit of the original it stands in. */
  readonly unit: Unit;
  /** The line of the unit that rewords that unit, or of the table it was read with, or null. */
  readonly after: number | null;
  readonly kind: "number" | "code";
  /** The value as the original writes it. */
  readonly value: string;
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
  rewritten: Array<{ before: number; after: number; kind: UnitKind; excerpt: string; original: string; shared: number; words: number }>;
  tables: Array<{ before: number[]; after: number; units: number; excerpt: string; values: { inTable: number; elsewhere: number; notFound: number } }>;
  values: Array<{ before: number; after: number | null; kind: "number" | "code"; value: string; excerpt: string }>;
  weighed: boolean;
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
 * First, all the kept units read for order are read in original order, and
 * the longest run of them in increasing new order is found.
 *
 * A step is an item of an ordered list in the original. For each such list,
 * the kept units that stand in its items are read in original order, and
 * the units of each item are first put in their new order, so units that
 * change places inside one item change nothing here. Those outside the
 * longest run of them in increasing new order are steps out of order. Of
 * runs as long, the one holding the most units of the first run is chosen.
 * A list nested in an item is read on its own, and its units count for the
 * item that holds it too.
 *
 * Then the longest run of all the kept units read for order is found again,
 * holding as few steps out of order as a run that long can. Each unit
 * outside it that is not a step out of order is moved. So every unit
 * outside it is listed once, as a step out of order or as moved, and no
 * unit is moved that a longest order could keep.
 *
 * A heading's unit with no letter is not read for order at all, though it
 * is kept. Headings split into sentences, so `## 4. Remove` gives the units
 * `4.` and `Remove`, and when a section is added above it, its number pairs
 * with the number of the heading below and would read as moved. Part 5 lets
 * a restructure renumber headings, as it lets one change them. A unit counts
 * for the `STEP_DEPTH` innermost ordered lists around it, and no more.
 *
 * Where two such runs tie on all these counts, the one the search meets
 * last in the original wins, so of two units that swap places, the one that
 * stood first in the original is named. Each search takes time in
 * proportion to n log n for n units.
 *
 * @param kept The kept pairs, in before order.
 * @param afterIndex Where each after unit stands in its version.
 */
function keptOrder(kept: readonly KeptPair[], afterIndex: ReadonlyMap<Unit, number>): { moved: OrderedPair[]; stepOrder: OrderedPair[] } {
  const newPlace = kept.map(pair => afterIndex.get(pair.after) ?? 0);
  const unread = kept.map(pair => pair.before.kind === "heading" && !LETTER.test(pair.before.key));
  const read = kept.flatMap((pair, position) => unread[position] === true ? [] : [position]);
  const inRead = longestIncreasing(read.map(position => newPlace[position] ?? 0));
  const inPlace = new Uint8Array(kept.length);
  for (const [index, position] of read.entries()) {
    inPlace[position] = inRead[index] ?? 0;
  }
  const outOfStep = new Uint8Array(kept.length);
  for (const positions of stepsByList(kept, unread).values()) {
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
    const inStep = longestIncreasingFavouring(ordered.map(position => newPlace[position] ?? 0), ordered.map(position => inPlace[position] ?? 0));
    for (const [index, position] of ordered.entries()) {
      if (inStep[index] === 0) outOfStep[position] = 1;
    }
  }
  // Of the longest orders, the one holding the fewest steps out of order, so a step is not listed twice over.
  const settled = longestIncreasingFavouring(read.map(position => newPlace[position] ?? 0), read.map(position => 1 - (outOfStep[position] ?? 0)));
  const moved = new Uint8Array(kept.length);
  for (const [index, position] of read.entries()) {
    if (settled[index] === 0 && outOfStep[position] === 0) moved[position] = 1;
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
 * the item it stands in. A pair is read only against the `STEP_DEPTH`
 * innermost lists around it, and not at all when it is unread.
 */
function stepsByList(kept: readonly KeptPair[], unread: readonly boolean[]): Map<string, Array<[number, number]>> {
  const lists = new Map<string, Array<[number, number]>>();
  for (const [position, pair] of kept.entries()) {
    if (unread[position] === true) continue;
    const chain = pair.before.steps ?? [];
    for (const step of chain.slice(Math.max(0, chain.length - STEP_DEPTH))) {
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
 * The comparison with the units dropped and added read again.
 *
 * 1. A unit dropped and a unit added that share half the longer one's words
 *    or more pair as rewritten, as `pairReworded` describes. Only sentences,
 *    list items, table cells and image alternatives pair, and never a unit
 *    that is one slot. A pair is not read for order.
 * 2. A new table is one whose units are all added and number two or more.
 *    Units still dropped are read with such a table as `tablesFrom`
 *    describes, and neither they nor the table's units are then listed.
 * 3. Each number and code span of a unit dropped, rewritten or read with a
 *    table is looked for in the whole new version, as `foundIn` describes,
 *    and each not found is listed. One of a unit read with a table is
 *    counted as in the table, elsewhere or not found.
 *
 * When the searches pass `WEIGHING_BUDGET` steps, none of this is used: the
 * comparison keeps its units dropped and added, and says it weighed nothing.
 */
function readRewording(comparison: Comparison, afterSource: string): Comparison {
  const meter: Meter = { spent: 0, limit: WEIGHING_BUDGET };
  const unweighed = { ...comparison, weighed: false };
  const pairs = pairReworded(comparison.dropped.filter(isReworded), comparison.added.filter(isReworded), meter);
  if (pairs === null) return unweighed;
  const pairedBefore = new Set(pairs.map(pair => pair.before));
  const pairedAfter = new Set(pairs.map(pair => pair.after));
  const stillDropped = comparison.dropped.filter(unit => !pairedBefore.has(unit));
  const stillAdded = comparison.added.filter(unit => !pairedAfter.has(unit));
  const read = tablesFrom(stillDropped.filter(isReworded), newTables(comparison.after, stillAdded), meter);
  if (read === null) return unweighed;
  const sources = new Set(read.flatMap(table => table.sources));
  const cells = new Set(read.flatMap(table => table.cells));
  const dropped = stillDropped.filter(unit => !sources.has(unit));
  const found = foundIn(comparison.after.map(unit => unit.key), afterSource, meter);
  const checked: Array<{ unit: Unit; after: number | null; table: number }> = [
    ...dropped.filter(isReworded).map(unit => ({ unit, after: null, table: -1 })),
    ...pairs.map(pair => ({ unit: pair.before, after: pair.after.line, table: -1 })),
    ...read.flatMap((table, position) => table.sources.map(unit => ({ unit, after: table.cells[0]?.line ?? null, table: position }))),
  ];
  const beforeIndex = new Map(comparison.before.map((unit, index) => [unit, index]));
  checked.sort((first, second) => (beforeIndex.get(first.unit) ?? 0) - (beforeIndex.get(second.unit) ?? 0));
  const inTables = read.map(table => foundIn(table.cells.map(cell => cell.key), "", meter));
  const tallies = read.map(() => ({ inTable: 0, elsewhere: 0, notFound: 0 }));
  const values: MissingValue[] = [];
  for (const { unit, after, table } of checked) {
    for (const value of valuesOf(unit)) {
      const isFound = (where: Found): boolean | null => value.figure === undefined ? where.code(value.text) : figureFound(value.figure, where);
      const anywhere = isFound(found);
      const inTable = table === -1 ? false : isFound(inTables[table] ?? found);
      if (anywhere === null || inTable === null) return unweighed;
      const tally = tallies[table];
      if (tally !== undefined) {
        if (inTable) {
          tally.inTable++;
        } else if (anywhere) {
          tally.elsewhere++;
        } else {
          tally.notFound++;
        }
      }
      if (!anywhere) values.push({ unit, after, kind: value.figure === undefined ? "code" : "number", value: value.text });
    }
  }
  if (meter.spent > meter.limit) return unweighed;
  return {
    ...comparison,
    dropped,
    added: stillAdded.filter(unit => !cells.has(unit)),
    rewritten: pairs,
    tables: read.map((table, position) => ({ sources: table.sources, cells: table.cells, ...(tallies[position] ?? { inTable: 0, elsewhere: 0, notFound: 0 }) })),
    values,
  };
}

/** Whether a unit can pair as rewritten, be read with a table, or hold a value looked for: prose, and not one slot. */
function isReworded(unit: Unit): boolean {
  return REWORDED_KINDS.has(unit.kind) && !ONE_SLOT.test(withoutLabel(unit));
}

/**
 * The tables of the new version whose units are all among those given and
 * number two or more, each as its units in document order.
 *
 * @param after Every unit of the new version.
 * @param added The units of it left over.
 */
function newTables(after: readonly Unit[], added: readonly Unit[]): Unit[][] {
  const held = new Map<number, number>();
  for (const unit of after) {
    if (unit.kind === "cell") held.set(unit.block, (held.get(unit.block) ?? 0) + 1);
  }
  const tables = new Map<number, Unit[]>();
  for (const unit of added) {
    if (unit.kind !== "cell") continue;
    const cells = tables.get(unit.block);
    if (cells === undefined) {
      tables.set(unit.block, [unit]);
    } else {
      cells.push(unit);
    }
  }
  return [...tables.entries()].filter(([block, cells]) => cells.length >= 2 && cells.length === held.get(block)).map(([, cells]) => cells);
}

/**
 * The numbers in figures and the code spans of a unit, in the order they
 * stand in it. A code span's text is as the unit holds it, its white space
 * made single, and a number inside one is not read on its own. In a table
 * cell, an escaped pipe in a code span is read as the pipe a table shows.
 */
function valuesOf(unit: Unit): Array<{ text: string; start: number; figure?: FigureValue }> {
  const spans = unit.spans ?? [];
  const shown = (text: string): string => unit.kind === "cell" ? text.replaceAll(PIPE_ESCAPE, "|") : text;
  const values: Array<{ text: string; start: number; figure?: FigureValue }> = spans.map(span => ({ text: shown(unit.key.slice(span.start, span.end)), start: span.start }));
  for (const figure of figureValues(unit.key, spans)) {
    values.push({ text: figure.text, start: figure.start, figure });
  }
  return values.sort((first, second) => first.start - second.start);
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
 * Which values belong to one longest strictly increasing run of them, read
 * in order, holding as many favoured values as a run that long can. Where
 * runs tie on both counts, the run
 * chosen is the one `longestIncreasing` chooses when no value is favoured,
 * or when every value is: the run that ends last, each value in it preceded
 * by the last that can precede it. A tree of best runs over the values in
 * sorted order finds each value's best run in time in proportion to log n,
 * so the whole takes time in proportion to n log n.
 *
 * @param favoured One flag for each value, 1 where it is favoured.
 * @returns One flag for each value, 1 where it belongs to the run.
 */
function longestIncreasingFavouring(values: readonly number[], favoured: readonly number[]): Uint8Array {
  const count = values.length;
  // A run's score is its length, and then its favoured values: a longer run wins whatever it favours.
  const lengthWeight = count + 1;
  // Equal values share a rank, so a run that repeats a value does not rise, and is not strictly increasing.
  const rank = new Int32Array(count);
  let ranked = 0;
  let previousValue = Number.NaN;
  for (const index of values.map((value, position) => position).sort((first, second) => (values[first] ?? 0) - (values[second] ?? 0))) {
    if (values[index] !== previousValue) ranked++;
    previousValue = values[index] ?? 0;
    rank[index] = ranked;
  }
  // For each range of ranks the tree covers, the best score of a run ending in it, and the last index ending such a run.
  const bestScore = new Float64Array(count + 1);
  const bestIndex = new Int32Array(count + 1).fill(-1);
  const score = new Float64Array(count);
  const previous = new Int32Array(count);
  let end = -1;
  for (let index = 0; index < count; index++) {
    let before = -1;
    let beforeScore = 0;
    for (let node = (rank[index] ?? 1) - 1; node > 0; node -= node & -node) {
      if (bestIndex[node] !== -1 && ((bestScore[node] ?? 0) > beforeScore || (bestScore[node] ?? 0) === beforeScore && (bestIndex[node] ?? -1) > before)) {
        beforeScore = bestScore[node] ?? 0;
        before = bestIndex[node] ?? -1;
      }
    }
    previous[index] = before;
    score[index] = beforeScore + lengthWeight + (favoured[index] ?? 0);
    for (let node = rank[index] ?? 1; node <= count; node += node & -node) {
      if ((score[index] ?? 0) >= (bestScore[node] ?? 0)) {
        bestScore[node] = score[index] ?? 0;
        bestIndex[node] = index;
      }
    }
    if (end === -1 || (score[index] ?? 0) >= (score[end] ?? 0)) end = index;
  }
  const chosen = new Uint8Array(count);
  for (let index = end; index !== -1; index = previous[index] ?? -1) {
    chosen[index] = 1;
  }
  return chosen;
}

/**
 * Both matches `compareUnits` describes, the first as `pairKeepingOrder`
 * makes it, with the kept pairs in before order.
 *
 * @param byLabel Whether the first match weighs pairs by label too.
 */
function matched(before: readonly Unit[], after: readonly Unit[], byLabel: boolean, beforeIndex: ReadonlyMap<Unit, number>): {
  kept: KeptPair[]; leftBefore: Unit[]; leftAfter: Unit[]; offeredByLabel: boolean;
} {
  const first = pairKeepingOrder(before, after, byLabel);
  const second = pairByText(first.leftBefore, first.leftAfter, withoutLabel);
  const kept = [...first.pairs, ...second.pairs].sort((one, other) => (beforeIndex.get(one.before) ?? 0) - (beforeIndex.get(other.before) ?? 0));
  return { kept, leftBefore: second.leftBefore, leftAfter: second.leftAfter, offeredByLabel: first.offeredByLabel };
}

/** How many kept pairs, in before order, keep their order: the length of the longest order they share. */
function inOrder(kept: readonly KeptPair[], afterIndex: ReadonlyMap<Unit, number>): number {
  let count = 0;
  for (const flag of longestIncreasing(kept.map(pair => afterIndex.get(pair.after) ?? 0))) {
    count += flag;
  }
  return count;
}

/**
 * Pairs the after units with before units of the same text, or of the same
 * text after a label, by one search for the longest run of pairs that keep
 * their order, and returns what is left of each side.
 *
 * Each after unit is offered every copy of its text in the original, last
 * copy first, and the longest run of offers in increasing original order is
 * the largest set of offers that keep their order. A text past
 * `PAIRING_BUDGET` offers each after copy only the original copy at the same
 * place in document order. Copies left over pair in document order.
 *
 * A text one version holds more copies of than the other has copies to
 * spare, and only those can pair by the text after a label, as
 * `compareUnits` describes. So an after unit of a text with copies to spare
 * is also offered, in the same search, every unit of the original whose
 * text has copies to spare and reads the same after its label. A text can
 * pair by label no more times than it has copies to spare, and a pair past
 * that is left out of the run. So whole wording pairs as often as it would
 * without labels. The run is not searched again after that, so the pairs
 * kept can cross where another choice of offers would keep them in order.
 * Units with the same text after a label, past
 * `PAIRING_BUDGET` together, are not offered by label, and are left for
 * `compareUnits` to pair in document order.
 */
function pairKeepingOrder(before: readonly Unit[], after: readonly Unit[], byLabel: boolean): { pairs: KeptPair[]; leftBefore: Unit[]; leftAfter: Unit[]; offeredByLabel: boolean } {
  const copiesBefore = positionsByKey(before);
  const copiesAfter = positionsByKey(after);
  const spareBefore = spareCopies(copiesBefore, copiesAfter);
  const spareAfter = spareCopies(copiesAfter, copiesBefore);
  // The original units that can pair by label, by their text after it, in document order.
  const byLabelBefore = new Map<string, number[]>();
  for (const [index, unit] of before.entries()) {
    if (!byLabel || !spareBefore.has(unit.key)) continue;
    const units = byLabelBefore.get(withoutLabel(unit));
    if (units === undefined) {
      byLabelBefore.set(withoutLabel(unit), [index]);
    } else {
      units.push(index);
    }
  }
  const byLabelAfter = new Map<string, number>();
  for (const unit of after) {
    if (spareAfter.has(unit.key)) byLabelAfter.set(withoutLabel(unit), (byLabelAfter.get(withoutLabel(unit)) ?? 0) + 1);
  }
  const pairings: Array<[string, number]> = [];
  for (const [key, copies] of copiesAfter) {
    const original = copiesBefore.get(key);
    if (original !== undefined) pairings.push([`whole ${key}`, original.length * copies.length]);
  }
  for (const [text, count] of byLabelAfter) {
    const original = byLabelBefore.get(text);
    if (original !== undefined) pairings.push([`label ${text}`, original.length * count]);
  }
  const weighed = withinBudget(pairings);
  const offeredBefore: number[] = [];
  const offeredAfter: number[] = [];
  const copiesSeen = new Map<string, number>();
  let offeredByLabel = false;
  for (const [index, unit] of after.entries()) {
    const offers: number[] = [];
    const copies = copiesBefore.get(unit.key);
    if (copies !== undefined && weighed.has(`whole ${unit.key}`)) {
      for (let copy = copies.length - 1; copy >= 0; copy--) {
        offers.push(copies[copy] ?? 0);
      }
    } else if (copies !== undefined) {
      const copy = copiesSeen.get(unit.key) ?? 0;
      copiesSeen.set(unit.key, copy + 1);
      if (copy < copies.length) offers.push(copies[copy] ?? 0);
    }
    const labelled = spareAfter.has(unit.key) && weighed.has(`label ${withoutLabel(unit)}`) ? byLabelBefore.get(withoutLabel(unit)) ?? [] : [];
    for (let offer = labelled.length - 1; offer >= 0; offer--) {
      offers.push(labelled[offer] ?? 0);
    }
    if (labelled.length > 0) offeredByLabel = true;
    // Last copy first across both kinds of offer, so no after unit pairs twice.
    if (labelled.length > 0 && copies !== undefined) offers.sort((first, second) => second - first);
    for (const offer of offers) {
      offeredBefore.push(offer);
      offeredAfter.push(index);
    }
  }
  const chosen = longestIncreasing(offeredBefore);
  const takenBefore = new Uint8Array(before.length);
  const takenAfter = new Uint8Array(after.length);
  const labelledBefore = new Map<string, number>();
  const labelledAfter = new Map<string, number>();
  const pairs: KeptPair[] = [];
  for (const [offer, beforeAt] of offeredBefore.entries()) {
    const pair = { before: before[beforeAt], after: after[offeredAfter[offer] ?? 0] };
    if (chosen[offer] === 0 || pair.before === undefined || pair.after === undefined) continue;
    if (pair.before.key !== pair.after.key) {
      const fromBefore = labelledBefore.get(pair.before.key) ?? 0;
      const fromAfter = labelledAfter.get(pair.after.key) ?? 0;
      if (fromBefore >= (spareBefore.get(pair.before.key) ?? 0) || fromAfter >= (spareAfter.get(pair.after.key) ?? 0)) continue;
      labelledBefore.set(pair.before.key, fromBefore + 1);
      labelledAfter.set(pair.after.key, fromAfter + 1);
    }
    takenBefore[beforeAt] = 1;
    takenAfter[offeredAfter[offer] ?? 0] = 1;
    pairs.push({ before: pair.before, after: pair.after });
  }
  const rest = pairByText(before.filter((unit, index) => takenBefore[index] === 0), after.filter((unit, index) => takenAfter[index] === 0), unit => unit.key);
  for (const pair of rest.pairs) {
    pairs.push(pair);
  }
  return { pairs, leftBefore: rest.leftBefore, leftAfter: rest.leftAfter, offeredByLabel };
}

/** How many copies of each text one side holds past the other's, for each text it holds more of. */
function spareCopies(side: ReadonlyMap<string, readonly number[]>, other: ReadonlyMap<string, readonly number[]>): Map<string, number> {
  const spare = new Map<string, number>();
  for (const [key, copies] of side) {
    const past = copies.length - (other.get(key)?.length ?? 0);
    if (past > 0) spare.set(key, past);
  }
  return spare;
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
 * The names whose pairings are weighed: those with the fewest pairings
 * first, until the next would pass `PAIRING_BUDGET`.
 *
 * @param pairings Each name, with how many pairings weighing it takes.
 */
function withinBudget(pairings: Array<[string, number]>): Set<string> {
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
  const sentences = sentenceUnits(renderInline(inlineText(prose, references), STRIKE), firstLine, kind, block, boldLabel(prose, references), codeSpans(prose, references));
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
 * Where the contents of each code span of prose stand in its rendered text,
 * once white space is made single as `singleSpaced` makes it. A code span's
 * contents begin at their first character that is not white space, and end
 * just past their last. Prose with no backtick holds none, and nor does
 * prose that holds every character `absentMark` could mark with.
 */
function codeSpans(prose: string, references: ReadonlySet<string>): CodeSpan[] {
  if (!prose.includes("`")) return [];
  const open = absentMark(prose);
  const close = absentMark(prose + open);
  if (open === "" || close === "") return [];
  const marked = renderInline(inlineText(prose, references), { strike: true, code: [open, close] });
  const spans: CodeSpan[] = [];
  let length = 0;
  let space = false;
  // -1 outside a span, -2 inside one before its first character, and otherwise where it starts.
  let start = -1;
  for (const character of marked) {
    if (character === open) {
      start = -2;
    } else if (character === close) {
      if (start >= 0) spans.push({ start, end: length });
      start = -1;
    } else if (/\s/u.test(character)) {
      space = length > 0;
    } else {
      if (space) length++;
      space = false;
      if (start === -2) start = length;
      length += character.length;
    }
  }
  return spans;
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
 * How many characters stand before each mark in rendered text, once the
 * marks are taken out, each run of white space is made one space and the
 * ends are trimmed, as `singleSpaced` makes them. A space just before a mark
 * is not counted until a word follows it, so a mark between two sentences
 * stands at the end of the first, before the second starts.
 */
function markPlaces(rendered: string, mark: string): number[] {
  const places: number[] = [];
  if (mark === "") return places;
  let length = 0;
  let space = false;
  for (const character of rendered) {
    if (character === mark) {
      places.push(length);
    } else if (/\s/u.test(character)) {
      space = length > 0;
    } else {
      if (space) length++;
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
 * @param spans Where the code spans stand in the single-spaced text, in
 *     order. Each unit holds the part of each that falls inside it.
 */
function sentenceUnits(rendered: string, firstLine: number, kind: UnitKind, block: number, label: string | null, spans: readonly CodeSpan[] = []): Array<{ unit: Unit; start: number }> {
  const { text, lines } = singleSpaced(rendered);
  let next = 0;
  return wholeSlots(text, locateSentences(text)).map((sentence, index) => {
    const end = sentence.start + sentence.text.length;
    while (next < spans.length && (spans[next]?.end ?? 0) <= sentence.start) next++;
    const held: CodeSpan[] = [];
    for (let span = next; span < spans.length && (spans[span]?.start ?? end) < end; span++) {
      const from = Math.max(spans[span]?.start ?? 0, sentence.start);
      const to = Math.min(spans[span]?.end ?? 0, end);
      if (from < to) held.push({ start: from - sentence.start, end: to - sentence.start });
    }
    const unit = { kind, line: firstLine + (lines[sentence.start] ?? 0), key: sentence.text, block, ...(held.length > 0 ? { spans: held } : {}) };
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

/**
 * Heading units left over, as one unit for each heading. A heading is split
 * into sentences so that each can be matched alone, but it is counted once.
 *
 * @param units Heading units in document order. The units of one heading
 *     share its `block`.
 * @returns One unit for each heading among them, in the order of its first
 *     unit, on that unit's line. Its text is the text of each of its units,
 *     joined by a space.
 */
function byHeading(units: readonly Unit[]): Unit[] {
  const headings = new Map<number, Unit>();
  for (const unit of units) {
    const heading = headings.get(unit.block);
    headings.set(unit.block, heading === undefined ? unit : { ...heading, key: `${heading.key} ${unit.key}` });
  }
  return [...headings.values()];
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
  const keptBlocks = new Set([...comparison.kept, ...comparison.rewritten].map(pair => pair.after.block));
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
  for (const pair of comparison.rewritten) {
    const finding = `Reworded, keeping ${pair.shared} of ${pair.longer} words. Check that it still says what the original said: ${quoted(pair.after.key)}, from ${quoted(pair.before.key)}`;
    rows.push({ line: pair.after.line, text: `| rewritten | ${pair.before.line} | ${pair.after.line} | ${finding} |` });
  }
  for (const table of comparison.tables) {
    const first = table.sources[0];
    const line = table.cells[0]?.line ?? 0;
    if (first === undefined) continue;
    const who = table.sources.length === 1 ? "A unit of the original shares most of its words" : `${table.sources.length} units of the original share most of their words`;
    const whose = table.sources.length === 1 ? "Its" : "Their";
    const traced = `${whose} numbers and code spans: ${table.inTable} in the table, ${table.elsewhere} elsewhere in the new version, ${table.notFound} not found:`;
    rows.push({ line, text: `| restructured or rewritten | ${first.line} | ${line} | ${who} with a new table of ${table.cells.length} units, which are not listed one by one. Check that nothing was cut or reworded. ${traced} ${quoted(first.key)} |` });
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
      ? "A step of an ordered list now stands in another order against its neighbouring steps, so it is listed here and not as moved. Put it back, or confirm the steps can happen in this order:"
      : `${run.length} units of ordered-list steps now stand together in another order against their neighbouring steps, so they are listed here and not as moved. Put them back, or confirm the steps can happen in this order:`;
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
