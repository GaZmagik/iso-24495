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
// It reads wording, not meaning. A sentence reworded without any change of
// meaning reads as dropped and added, and a sentence kept word for word whose
// meaning changed in its new place reads as kept.

import { renderInline } from "./inline-wording.ts";
import { inlineText, locateSentences, markdownLinks, normaliseReference, structure, tableCells, type LocatedSentence, type MarkdownLink, type Reading } from "./parse.ts";
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
 * Matches the units of two versions by their text, and sorts each unit left
 * over by what it is.
 *
 * A text counts as many times as it occurs, so a passage that stood twice
 * must stand twice afterwards. The occurrences of one text are paired in
 * document order: the first before with the first after, and so on.
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
 *    as gone in the same way, and is not dropped. A heading is counted once,
 *    however many of its sentences are left over.
 * 3. A unit that matches a unit of the author's wording, whole or after its
 *    label, comes from the author. Each unit of the author's wording accounts
 *    for one after unit.
 * 4. Any other unit is added.
 *
 * @returns The pairs kept, in before order, and every other unit in the
 *     order of its own version.
 */
export function compareUnits(before: readonly Unit[], after: readonly Unit[], author: readonly Unit[]): Comparison {
  const exact = pairByText(before, after, unit => unit.key);
  const byLabel = pairByText(exact.leftBefore, exact.leftAfter, withoutLabel);
  const order = new Map(before.map((unit, index) => [unit, index]));
  const kept = [...exact.pairs, ...byLabel.pairs].sort((first, second) => (order.get(first.before) ?? 0) - (order.get(second.before) ?? 0));
  const comparison: Comparison = {
    before, after, author, kept,
    dropped: byLabel.leftBefore.filter(unit => unit.kind !== "heading"),
    headingsGone: byHeading(byLabel.leftBefore.filter(unit => unit.kind === "heading")),
    added: [], fromAuthor: [], gaps: [], newHeadings: [],
    // A pair the second match made differs in its labels, or the first would have made it.
    newLabels: byLabel.pairs.filter(pair => pair.after.label !== undefined).map(pair => pair.after),
    labelsGone: byLabel.pairs.filter(pair => pair.before.label !== undefined).map(pair => pair.before),
  };
  const takeAuthor = waitingByText(author, unit => unit.key);
  const headingUnits: Unit[] = [];
  for (const unit of byLabel.leftAfter) {
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
 *   heading, taken out of the sentence it stood in.
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
 * A unit with no text is left out, as an empty table cell is.
 *
 * @param text The document, read as Markdown whatever its file ending.
 * @param reading Front matter is set aside unless `frontMatter` is false.
 */
export function documentUnits(text: string, reading: Reading = {}): Unit[] {
  const read = structure(text, reading);
  const references = new Set<string>(read.destinations.keys());
  const units: Unit[] = [];
  for (const paragraph of read.paragraphs) {
    const block = read.blocks.get(paragraph.line - 1);
    const inList = block?.kind === "list";
    units.push(...proseUnits(paragraph.lines.join("\n"), paragraph.line, inList ? "item" : "sentence", block?.id ?? paragraph.line - 1, references));
  }
  for (const [index, line] of read.lines.entries()) {
    const block = read.blocks.get(index);
    if (block?.kind !== "table") continue;
    // A table's header line is the one its block is named after. Its divider is the line below, and holds no row.
    const cells = block.id === index ? tableCells(line.trim()) : read.tableRows.get(index) ?? [];
    for (const cell of cells) {
      units.push(...proseUnits(cell, index + 1, "cell", block.id, references));
    }
  }
  for (const heading of read.allHeadings) {
    units.push(...sentenceUnits(renderInline(heading.text, STRIKE), heading.line, "heading", -heading.line, null));
  }
  for (const code of read.code) {
    if (code.text !== "") units.push({ kind: "code", line: code.line, key: code.text, block: -code.line });
  }
  return units.sort((first, second) => first.line - second.line);
}

/**
 * The comparison as a table of what it found, a line of counts and a closing
 * statement. It prints only what the comparison reads.
 *
 * Each dropped unit is a row, in before order. Then come the after units
 * left over, in after order: each added unit, each unit from the author and
 * each marked gap. Added units of a list or a table that keeps no unit of
 * the original share one row, when there are two or more, with how many units
 * it stands for and the first unit's text. The count is of units, not of
 * items or cells, so the rows add up to the count of added units. Headings and labels are counted and not listed.
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
    ...comparison.dropped.map(unit => `| dropped | ${unit.line} | | No unchanged copy is in the new version: ${quoted(unit.key)} |`),
    ...afterRows(comparison),
    `Kept ${comparison.kept.length}. Dropped ${comparison.dropped.length}. Added ${comparison.added.length}. `
      + `From the author ${comparison.fromAuthor.length}. Marked gaps ${comparison.gaps.length}. `
      + `New headings ${comparison.newHeadings.length}. Headings gone ${comparison.headingsGone.length}. `
      + `New labels ${comparison.newLabels.length}. Labels gone ${comparison.labelsGone.length}.`,
    "The comparison reads wording, not meaning.",
  ];
  return lines.join("\n");
}

/**
 * The comparison as the `restructure` key of a `--json` report holds it.
 * Nothing in it is cleaned for printing: a report is data for a program.
 *
 * @returns The paths, how many units each text holds, how many units were
 *     kept, and a list of every other unit by what it is. Each entry gives
 *     the unit's line, its kind and its first 60 characters. A label's entry
 *     gives the label in place of the unit's text. A heading's entry is one
 *     for the heading, and holds its sentences left over, joined by a space.
 */
export function comparisonReport(comparison: Comparison, paths: ComparedPaths): RestructureReport {
  return {
    before: paths.before,
    after: paths.after,
    authorText: paths.authorText,
    units: { before: comparison.before.length, after: comparison.after.length, authorText: comparison.author.length },
    kept: comparison.kept.length,
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
  /** The units of one list, one table or one heading share this, as do the sentences of one paragraph. Each heading's is its own. */
  readonly block: number;
  /** A bold label the unit opens with, such as `Purpose:`, as a reader sees it. */
  readonly label?: string;
}

/**
 * What holds a unit: a sentence of a paragraph or a quotation, a sentence of
 * a list item, a sentence of a table cell, a heading's sentence, a code
 * block, or an image's alternative text.
 */
export type UnitKind = "sentence" | "item" | "cell" | "heading" | "code" | "alternative";

/** Two versions matched, as `compareUnits` describes. */
export interface Comparison {
  readonly before: readonly Unit[];
  readonly after: readonly Unit[];
  readonly author: readonly Unit[];
  /** Each pair of units with the same text, in before order. */
  readonly kept: ReadonlyArray<{ readonly before: Unit; readonly after: Unit }>;
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

/**
 * The units of one piece of prose: the alternative text of each image in it,
 * then each sentence of what is left.
 *
 * @param source The prose with its inline markup, which may run over lines.
 * @param firstLine The line its first character stands on.
 * @param references The labels the document defines, as `normaliseReference` gives them.
 */
function proseUnits(source: string, firstLine: number, kind: UnitKind, block: number, references: ReadonlySet<string>): Unit[] {
  const units: Unit[] = [];
  let prose = "";
  let from = 0;
  for (const image of markdownLinks(source)) {
    // An image inside another's text is not rendered on its own, and goes with that text.
    if (!image.image || !image.rendered || !isShown(image, references)) continue;
    const line = firstLine + lineBreaks(source.slice(0, image.start));
    units.push(...sentenceUnits(renderInline(inlineText(image.label, references), STRIKE), line, "alternative", block, null));
    prose += source.slice(from, image.start) + "\n".repeat(lineBreaks(source.slice(image.start, image.end)));
    from = image.end;
  }
  prose += source.slice(from);
  return [...units, ...sentenceUnits(renderInline(inlineText(prose, references), STRIKE), firstLine, kind, block, boldLabel(prose, references))];
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
 * on. The white space is made single first, and the text split after.
 *
 * @param rendered Text a reader sees, which may run over lines.
 * @param firstLine The line its first character stands on.
 * @param label The label the text opens with, given to the first sentence
 *     when that sentence holds more than the label. Null for none.
 */
function sentenceUnits(rendered: string, firstLine: number, kind: UnitKind, block: number, label: string | null): Unit[] {
  const { text, lines } = singleSpaced(rendered);
  return wholeSlots(text, locateSentences(text)).map((sentence, index) => {
    const unit = { kind, line: firstLine + (lines[sentence.start] ?? 0), key: sentence.text, block };
    return index === 0 && label !== null && sentence.text.startsWith(`${label} `) ? { ...unit, label } : unit;
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
  pairs: Array<{ before: Unit; after: Unit }>; leftBefore: Unit[]; leftAfter: Unit[];
} {
  const take = waitingByText(before, text);
  const pairs: Array<{ before: Unit; after: Unit }> = [];
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
 * The rows for the after units left over, in after order. A list or table
 * that keeps no unit of the original gives one row for its added units when
 * it holds two or more.
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
  return rows.sort((first, second) => first.line - second.line).map(row => row.text);
}

/** The first characters of a text in double quotes, cleaned for a table cell. */
function quoted(text: string): string {
  const characters = Array.from(text);
  const cut = characters.length > EXCERPT_LENGTH;
  return `"${safeCell(characters.slice(0, EXCERPT_LENGTH).join(""))}${cut ? "..." : ""}"`;
}

/** A unit as a report lists it, quoting the text given. */
function entry(unit: Unit, text: string): ReportedUnit {
  return { line: unit.line, kind: unit.kind, excerpt: Array.from(text).slice(0, EXCERPT_LENGTH).join("") };
}
