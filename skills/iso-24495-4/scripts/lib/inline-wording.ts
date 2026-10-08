import { codeSpanEnds, inlineText } from "./parse.ts";
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
}
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
 * Markdown source with the marks of paired emphasis and strikethrough removed,
 * so a rule about words can read "in **order** to" as the phrase a reader sees.
 *
 * Nothing else changes. A link, a code span, a backslash escape and a
 * character reference stay as written, and no line ending is added or
 * removed, so a line of the result is the same line of the source.
 *
 * @param source Inline Markdown, which may run over several lines. Pass a
 *     whole paragraph, because emphasis can open on one line and close on a
 *     later one.
 * @returns The source without the marks `emphasisMarkOffsets` names. The
 *     source itself where it holds no paired mark, as for empty source.
 */
export function withoutEmphasis(source: string): string {
  const kept: string[] = [];
  let from = 0;
  for (const mark of emphasisMarkOffsets(source)) {
    kept.push(source.slice(from, mark));
    from = mark + 1;
  }
  kept.push(source.slice(from));
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
 * A link is not read as one, and nor is a bare address. Its brackets, its
 * destination and its address are ordinary characters here, so a mark in them
 * can pair with a mark outside, which a browser never does. The audit
 * therefore passes only text that holds no link and no bare address.
 *
 * @param source Inline Markdown, which may run over several lines.
 * @returns The offset of every `*`, `_` and `~` that belongs to a pair, in
 *     ascending order, one entry for each character. A mark with no partner,
 *     an escaped mark and a mark inside a code span are not listed. Empty
 *     when nothing is paired, as for empty source.
 */
export function emphasisMarkOffsets(source: string): number[] {
  return pairedMarks(delimiterRuns(source, EMPHASIS + STRIKE)).sort((a, b) => a - b);
}

/** Every run of the given marks that stands outside a code span and is not escaped. */
function delimiterRuns(text: string, markers: string): Run[] {
  const spans = codeSpanEnds(text);
  const runs: Run[] = [];
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
    const run = runAt(text, index);
    // One tilde is a subscript to some renderers and three open a code fence.
    if (run.marker !== STRIKE || run.original === 2) runs.push(run);
    index = run.end;
  }
  return runs;
}

/** The run of one mark that starts here, and whether CommonMark lets it open or close. */
function runAt(text: string, start: number): Run {
  const marker = text[start];
  let end = start + 1;
  while (text[end] === marker) end++;
  const before = characterBefore(text, start);
  const after = end < text.length ? asShown(String.fromCodePoint(text.codePointAt(end) as number)) : " ";
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
  };
}

/**
 * The character before an offset as `asShown` gives it, or a space at the start of the text.
 *
 * Only the two units before the offset are read. Reading the text from its start for
 * every run grew with the square of the text.
 */
function characterBefore(text: string, offset: number): string {
  if (offset === 0) return " ";
  return asShown([...text.slice(Math.max(0, offset - 2), offset)].at(-1) as string);
}

/**
 * One character as a page shows it. Half a surrogate pair is no character, and a
 * renderer shows the replacement character, U+FFFD, in its place. That is a symbol,
 * so a mark beside it opens and closes as beside any other symbol.
 */
function asShown(character: string): string {
  const unit = character.charCodeAt(0);
  return character.length === 1 && unit >= 0xd800 && unit <= 0xdfff ? String.fromCharCode(0xfffd) : character;
}

/**
 * The offset of every mark that belongs to a pair, in no order.
 *
 * Each closer takes the nearest earlier opener of its own mark, as CommonMark
 * describes. The runs are changed as their marks are taken.
 */
function pairedMarks(runs: Run[]): number[] {
  const marks: number[] = [];
  // For each run, the nearest earlier run still in play. A run leaves play when a pair
  // closes around it, or takes its last mark.
  const earlier: number[] = new Array(runs.length);
  // For each kind of closer, the run at or before which it has no opener. Without this
  // a text of closers alone would search back to its start from every one of them.
  const searched = new Map<string, number>();
  let last = -1;
  for (let closing = 0; closing < runs.length; closing++) {
    const closer = runs[closing] as Run;
    earlier[closing] = last;
    if (closer.close) pairCloser(runs, closing, earlier, searched, marks);
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
): void {
  const closer = runs[closing] as Run;
  const kind = `${closer.marker}${closer.open}${closer.original % 3}`;
  const floor = searched.get(kind) ?? -1;
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
  if (!opener.open || opener.marker !== closer.marker) return false;
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
