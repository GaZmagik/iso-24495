import { codeSpanEnds, inlineText, type LabelledLink } from "./parse.ts";
import entities from "./html-entities.json";

/** A run of one mark, and the part of it that no pair has taken yet. */
interface Run {
  marker: string;
  /**
   * The first mark still unpaired, and the offset just past the last. A pair takes the
   * marks nearest the words it wraps: the end of its opener and the start of its closer.
   */
  start: number;
  end: number;
  original: number;
  open: boolean;
  close: boolean;
  /**
   * The link label the run sits in, or `OUTSIDE` for text in no label. A mark
   * pairs only with a mark in the same one.
   */
  scope: number;
}

/**
 * From this offset to the next stretch, the text is in the label of link `scope`. It
 * is `OUTSIDE` for text in no label, and `SYNTAX` for the characters of a link that are
 * not its label: its brackets and its destination.
 */
interface Stretch {
  from: number;
  scope: number;
}
const OUTSIDE = -1;
const SYNTAX = -2;
const NO_LABELS: readonly Stretch[] = [{ from: 0, scope: OUTSIDE }];
const ESCAPABLE = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const EMPHASIS = "*_";
const STRIKE = "~";

/**
 * The wording a reader sees for a piece of inline Markdown.
 *
 * An inline link or image becomes its label, a code span becomes its
 * contents, paired emphasis markers are removed, and character references are
 * decoded. An escaped character and the contents of a code span are kept
 * literally, so neither is read as emphasis or as a character reference.
 *
 * @param source One heading, label or line. Block structure is not read. A
 *     reference link stays as written, because no definitions are passed.
 * @returns The rendered wording. An emphasis marker with no partner stays in
 *     the text. Empty for empty source.
 */
export function renderInline(source: string): string {
  const text = inlineText(source);
  const spans = codeSpanEnds(text);
  const paired = new Set(pairedMarks(delimiterRuns(text, EMPHASIS)));
  let rendered = "";
  // Text since the last escape, code span or marker. Only this is decoded, so a
  // character reference cannot be made from the pieces either side of one.
  let plain = "";
  for (let index = 0; index < text.length;) {
    if (text[index] === "\\" && ESCAPABLE.test(text[index + 1] ?? "")) {
      rendered += decodeEntities(plain) + text[index + 1];
      plain = "";
      index += 2;
      continue;
    }
    const span = spans.get(index);
    if (span !== undefined) {
      const ticks = /^`+/.exec(text.slice(index))[0].length;
      let content = text.slice(index + ticks, span - ticks).replace(/\r\n|\r|\n/g, " ");
      if (content.startsWith(" ") && content.endsWith(" ") && /\S/.test(content)) content = content.slice(1, -1);
      rendered += decodeEntities(plain) + content;
      plain = "";
      index = span;
      continue;
    }
    if (EMPHASIS.includes(text[index])) {
      rendered += decodeEntities(plain) + (paired.has(index) ? "" : text[index]);
      plain = "";
      index++;
      continue;
    }
    plain += text[index];
    index++;
  }
  return rendered + decodeEntities(plain);
}

/**
 * Text with the marks of paired emphasis and strikethrough removed, so a rule
 * about words can read "in **order** to" as the phrase a reader sees.
 *
 * Nothing else changes. A code span, a backslash escape and a character
 * reference stay as written, and no line ending is added or removed, so a
 * line of the result is the same line of the text.
 *
 * @param text Inline Markdown, which may run over several lines. Pass a
 *     whole paragraph, because emphasis can open on one line and close on a
 *     later one.
 * @param marks The offset of each mark to remove, ascending. Left out, the
 *     marks are paired in `text` as it stands, which is right for text that
 *     holds no link. Where links were replaced by their labels, the marks
 *     must be paired before that, with `emphasisMarkOffsets`, and their
 *     places in `text` passed here.
 * @returns The text without those characters. The text itself where there is
 *     none to remove, as for empty text.
 */
export function withoutEmphasis(text: string, marks: readonly number[] = emphasisMarkOffsets(text)): string {
  const kept: string[] = [];
  let from = 0;
  for (const mark of marks) {
    kept.push(text.slice(from, mark));
    from = mark + 1;
  }
  kept.push(text.slice(from));
  return kept.join("");
}

/**
 * Where each mark of paired emphasis or strikethrough sits in Markdown source.
 *
 * Emphasis is paired as CommonMark pairs it. So an asterisk inside a word is
 * emphasis, and an underscore inside a word is not, which leaves
 * `snake_case_name` alone. A strike is two tildes on each side, paired the
 * same way. It is counted because the struck words are still on the page: a
 * reader sees them, and a screen reader says them with no sign of the strike.
 *
 * The marks are paired in the source with its links as written, and a link is
 * a boundary. A mark inside a label pairs only with another in the same
 * label, and a mark outside every label only with another outside. So
 * emphasis can still wrap a whole link, and can sit inside a label, and the
 * two asterisks of "*or[der*](u)" are left alone, as a browser leaves them.
 *
 * Whether a mark may open or close is judged from the characters beside it in
 * that source, a bracket of the link included. The mark in "or*[der](u)" stands
 * before a bracket, so it cannot open, though it would between the letters of
 * "or*der". A mark in a destination or a title is part of the link and is
 * never paired.
 *
 * @param source Inline Markdown with its links as written, which may run over
 *     several lines.
 * @param links Each link in the source that a reader sees as its label, as a
 *     `LabelledBlock` gives them: in the order they start, one inside the
 *     label of another or wholly apart. With none, every bracket is read as
 *     an ordinary character and the whole source is one text.
 * @returns The offset in `source` of every `*`, `_` and `~` that belongs to a
 *     pair, in ascending order, one entry for each character. A mark with no
 *     partner, an escaped mark and a mark inside a code span are not listed.
 *     Empty when nothing is paired, as for empty source.
 */
export function emphasisMarkOffsets(source: string, links: readonly LabelledLink[] = []): number[] {
  return pairedMarks(delimiterRuns(source, EMPHASIS + STRIKE, linkStretches(links))).sort((a, b) => a - b);
}

/**
 * The text cut into stretches at the start of each link, at each end of its label and
 * at its end. The first stretch starts at offset 0, and no two start at one offset.
 */
function linkStretches(links: readonly LabelledLink[]): readonly Stretch[] {
  if (links.length === 0) return NO_LABELS;
  const stretches: Stretch[] = [{ from: 0, scope: OUTSIDE }];
  // The links whose label holds the place reached, outermost first, each by its index.
  const open: number[] = [];
  for (let id = 0; id <= links.length; id++) {
    // Every link that ends before this one starts is closed first, innermost first.
    // After the last link, all that are still open are closed.
    const reached = links[id]?.start ?? Infinity;
    while (open.length > 0 && (links[open.at(-1) as number] as LabelledLink).labelEnd <= reached) {
      const closed = links[open.pop() as number] as LabelledLink;
      startStretch(stretches, closed.labelEnd, SYNTAX);
      startStretch(stretches, closed.end, open.at(-1) ?? OUTSIDE);
    }
    const link = links[id];
    if (link === undefined) break;
    startStretch(stretches, link.start, SYNTAX);
    startStretch(stretches, link.labelStart, id);
    open.push(id);
  }
  return stretches;
}

/**
 * Starts a stretch at an offset. One that would hold no character is replaced: an empty
 * label, or the text between two links that touch.
 */
function startStretch(stretches: Stretch[], from: number, scope: number): void {
  const last = stretches.at(-1) as Stretch;
  if (last.from === from) last.scope = scope;
  else stretches.push({ from, scope });
}

/**
 * Every run of the given marks that stands outside a code span and is not escaped.
 *
 * @param stretches Where the links sit. A run ends at the edge of a stretch, and a
 *     mark in the syntax of a link is not a run.
 */
function delimiterRuns(text: string, markers: string, stretches: readonly Stretch[] = NO_LABELS): Run[] {
  const spans = codeSpanEnds(text);
  const runs: Run[] = [];
  let stretch = 0;
  for (let index = 0; index < text.length;) {
    if (text[index] === "\\" && ESCAPABLE.test(text[index + 1] ?? "")) {
      index += 2;
      continue;
    }
    const span = spans.get(index);
    if (span !== undefined) {
      index = span;
      continue;
    }
    if (!markers.includes(text[index])) {
      index++;
      continue;
    }
    while (((stretches[stretch + 1] as Stretch | undefined)?.from ?? Infinity) <= index) stretch++;
    const limit = (stretches[stretch + 1] as Stretch | undefined)?.from ?? text.length;
    const scope = (stretches[stretch] as Stretch).scope;
    if (scope === SYNTAX) {
      index = limit;
      continue;
    }
    const run = runAt(text, index, limit, scope);
    // One tilde is a subscript to some renderers and three open a code fence.
    if (run.marker !== STRIKE || run.original === 2) runs.push(run);
    index = run.end;
  }
  return runs;
}

/**
 * The run of one mark that starts here and ends before `limit`, and whether CommonMark
 * lets it open or close.
 */
function runAt(text: string, start: number, limit: number, scope: number): Run {
  const marker = text[start];
  let end = start + 1;
  while (end < limit && text[end] === marker) end++;
  const before = characterBefore(text, start);
  const after = end < text.length ? String.fromCodePoint(text.codePointAt(end) as number) : " ";
  const left = !/\s/.test(after) && (!PUNCTUATION.test(after) || /\s/.test(before) || PUNCTUATION.test(before));
  const right = !/\s/.test(before) && (!PUNCTUATION.test(before) || /\s/.test(after) || PUNCTUATION.test(after));
  // An underscore between two letters is part of a word, so only it is held to the
  // stricter test.
  const anywhere = marker !== "_";
  return {
    marker,
    start,
    end,
    original: end - start,
    open: left && (anywhere || !right || PUNCTUATION.test(before)),
    close: right && (anywhere || !left || PUNCTUATION.test(after)),
    scope,
  };
}

/**
 * The character before an offset, or a space at the start of the text.
 *
 * Only the two units before the offset are read. Reading the text from its start for
 * every run grew with the square of the text.
 */
function characterBefore(text: string, offset: number): string {
  if (offset === 0) return " ";
  return [...text.slice(Math.max(0, offset - 2), offset)].at(-1) as string;
}

/**
 * The offset of every mark that belongs to a pair, in no order.
 *
 * Each closer takes the nearest earlier opener of its own mark, as CommonMark
 * describes, from the runs in its own link label. The runs are changed as
 * their marks are taken.
 */
function pairedMarks(runs: Run[]): number[] {
  const marks: number[] = [];
  // For each run, the nearest earlier run still in play. A run leaves play when a pair
  // closes around it, or takes its last mark.
  const earlier: number[] = new Array(runs.length);
  // For each kind of closer, the run at or before which it has no opener. Without this
  // a text of closers alone would search back to its start from every one of them.
  const searched = new Map<string, number>();
  // The first run in each link label. No run before it is in that label, so a closer
  // there need look no further back. Without this, a closer in each of many labels
  // would search back over every unpaired opener outside them.
  const first = new Map<number, number>();
  let last = -1;
  for (let closing = 0; closing < runs.length; closing++) {
    const closer = runs[closing] as Run;
    earlier[closing] = last;
    if (!first.has(closer.scope)) first.set(closer.scope, closing);
    if (closer.close) {
      pairCloser(runs, closing, earlier, searched, marks, (first.get(closer.scope) as number) - 1);
    }
    last = closer.start < closer.end ? closing : earlier[closing] as number;
  }
  return marks;
}

/** Pairs one closer with earlier openers until its marks are used or no opener is left. */
function pairCloser(
  runs: Run[],
  closing: number,
  earlier: number[],
  searched: Map<string, number>,
  marks: number[],
  beforeScope: number,
): void {
  const closer = runs[closing] as Run;
  const kind = `${closer.marker}${closer.open}${closer.original % 3} ${closer.scope}`;
  const floor = Math.max(searched.get(kind) ?? -1, beforeScope);
  while (closer.start < closer.end) {
    let opening = earlier[closing] as number;
    while (opening > floor && !canPair(runs[opening] as Run, closer)) {
      opening = earlier[opening] as number;
    }
    if (opening <= floor) {
      searched.set(kind, earlier[closing] as number);
      return;
    }
    const opener = runs[opening] as Run;
    const strong = opener.end - opener.start >= 2 && closer.end - closer.start >= 2;
    for (let taken = 0; taken < (strong ? 2 : 1); taken++) {
      opener.end--;
      marks.push(opener.end, closer.start);
      closer.start++;
    }
    earlier[closing] = opener.start < opener.end ? opening : earlier[opening] as number;
  }
}

/** Whether a closer may take this earlier run as its opener. */
function canPair(opener: Run, closer: Run): boolean {
  if (!opener.open || opener.marker !== closer.marker || opener.scope !== closer.scope) return false;
  if (!opener.close && !closer.open) return true;
  // CommonMark's rule of three keeps ambiguous intraword runs literal.
  return (opener.original + closer.original) % 3 !== 0
    || (opener.original % 3 === 0 && closer.original % 3 === 0);
}

function decodeEntities(text: string): string {
  return text.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (whole, name: string) => {
    if (!name.startsWith("#")) return (entities as Record<string, string>)[`${name};`] ?? whole;
    const point = name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff) ? "\ufffd" : String.fromCodePoint(point);
  });
}
