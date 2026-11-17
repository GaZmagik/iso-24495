// What a restructure reworded, and the values it may have cut: the parts of
// the two-version comparison that read the units left over once matching by
// wording is done.
//
// Part 5 lets a restructure move wording but not reword it, and lets nothing
// be cut or distorted to fit a layout. So a unit of the original left over
// is paired with a unit of the new version left over when the two share half
// the longer one's words or more, for a person to check the rewording. A
// unit of the original that shares most of its words with a new table is read
// with that table, because Part 5's own example turns a sentence into one.
// And each number and code span of a unit not kept is looked for in the
// whole new version.
//
// Every search here counts its steps on one meter. Past the meter's limit the
// comparison uses none of what was found, so a finding never rests on a
// search that stopped partway.

import type { CodeSpan, Unit } from "./restructure.ts";

/**
 * How many steps the searches of one comparison may take: each word read,
 * each entry of an index visited and each word compared counts one.
 */
export const WEIGHING_BUDGET = 20_000_000;

/** The steps a comparison's searches have taken, and how many they may take. */
export interface Meter {
  spent: number;
  readonly limit: number;
}

/** A unit of the original paired with the unit of the new version that rewords it. */
export interface ReworkedPair {
  readonly before: Unit;
  readonly after: Unit;
  /** How many words the two share, each counted as often as it stands in both. */
  readonly shared: number;
  /** How many words the longer of the two holds. */
  readonly longer: number;
}

/** A number in figures in a text, with the values it can be read as. */
export interface FigureValue {
  /** The figure as it is written. */
  readonly text: string;
  /** Where it starts in the text. */
  readonly start: number;
  /** Each value it can be read as, written as `canonical` writes one. */
  readonly readings: ReadonlySet<string>;
  /** For a figure grouped by spaces, such as `1 000`, the readings of each group; empty otherwise. */
  readonly groups: ReadonlyArray<ReadonlySet<string>>;
}

/** What the new version holds, to look a value up in. */
export interface Found {
  /** Whether the new version holds a number with one of these readings, in figures or in words. */
  number(readings: ReadonlySet<string>): boolean;
  /** Whether the new version holds this text anywhere, or null when the meter passed its limit while looking. */
  code(text: string): boolean | null;
}

/**
 * Pairs units of the original with units of the new version that reword
 * them. Two units qualify when they share at least two words and at least
 * half the words of the longer, each word counted as often as it stands in
 * both, in any letter case, and with any bold label set aside. Of the pairs
 * that qualify, the one sharing the largest part of the longer one's words
 * is taken first, then the one sharing more words, then the one earliest in
 * the original, then the one earliest in the new version, and each unit
 * pairs once. So the pairs are not always the most that could be made.
 *
 * The search indexes each unit of the original by its rarest words, as many
 * as a unit that qualifies must share at least one of, so a pair that
 * qualifies is always found.
 *
 * @param before Units of the original left over, in document order.
 * @param after Units of the new version left over, in document order.
 * @returns The pairs in before order, or null when the meter passed its limit.
 */
export function pairReworded(before: readonly Unit[], after: readonly Unit[], meter: Meter): ReworkedPair[] | null {
  const tokens = new Map<string, number>();
  const frequency: number[] = [];
  const beforeTokens = before.map(unit => tokensOf(unit, tokens, frequency, meter));
  const afterTokens = after.map(unit => tokensOf(unit, tokens, frequency, meter));
  if (meter.spent > meter.limit) return null;
  // Rarest first, so the words indexed are those fewest units hold.
  const rarity = (first: number, second: number): number => (frequency[first] ?? 0) - (frequency[second] ?? 0) || first - second;
  const index = new Map<number, number[]>();
  for (const [position, held] of beforeTokens.entries()) {
    for (const token of [...held].sort(rarity).slice(0, prefixLength(held.length))) {
      const units = index.get(token);
      if (units === undefined) {
        index.set(token, [position]);
      } else {
        units.push(position);
      }
    }
  }
  const candidates: Array<{ before: number; after: number; shared: number; longer: number }> = [];
  const seen = new Int32Array(before.length).fill(-1);
  for (const [position, held] of afterTokens.entries()) {
    for (const token of [...held].sort(rarity).slice(0, prefixLength(held.length))) {
      const units = index.get(token) ?? [];
      meter.spent += units.length;
      if (meter.spent > meter.limit) return null;
      for (const other of units) {
        if (seen[other] === position) continue;
        seen[other] = position;
        const otherHeld = beforeTokens[other] ?? [];
        meter.spent += otherHeld.length + held.length;
        const shared = sharedCount(otherHeld, held);
        const longer = Math.max(otherHeld.length, held.length);
        if (shared >= 2 && 2 * shared >= longer) candidates.push({ before: other, after: position, shared, longer });
      }
    }
  }
  if (meter.spent > meter.limit) return null;
  candidates.sort((first, second) => second.shared * first.longer - first.shared * second.longer || second.shared - first.shared || first.before - second.before || first.after - second.after);
  const takenBefore = new Uint8Array(before.length);
  const takenAfter = new Uint8Array(after.length);
  const pairs: ReworkedPair[] = [];
  for (const candidate of candidates) {
    if (takenBefore[candidate.before] === 1 || takenAfter[candidate.after] === 1) continue;
    takenBefore[candidate.before] = 1;
    takenAfter[candidate.after] = 1;
    const pair = { before: before[candidate.before], after: after[candidate.after] };
    if (pair.before !== undefined && pair.after !== undefined) pairs.push({ before: pair.before, after: pair.after, shared: candidate.shared, longer: candidate.longer });
  }
  const order = new Map(before.map((unit, position) => [unit, position]));
  return pairs.sort((first, second) => (order.get(first.before) ?? 0) - (order.get(second.before) ?? 0));
}

/**
 * The tables of the new version that units of the original were turned
 * into. A unit is read with the table holding the largest part of its
 * different words, when that is at least half of them and at least two, and
 * the earliest such table on a tie. A table is kept only when the units read
 * with it hold at least half its different words, so a table made mostly of
 * other wording is not read with a sentence that shares a few of its words.
 *
 * @param units Units of the original left over.
 * @param tables The units of each new table, in document order.
 * @returns For each table kept, the units read with it in before order, and
 *     its units. Null when the meter passed its limit.
 */
export function tablesFrom(units: readonly Unit[], tables: readonly Unit[][], meter: Meter): Array<{ sources: Unit[]; cells: Unit[] }> | null {
  const tableWords = tables.map(cells => new Set(cells.flatMap(cell => wordsOf(withoutLabel(cell)))));
  const tablesWith = new Map<string, number[]>();
  for (const [position, words] of tableWords.entries()) {
    meter.spent += words.size;
    for (const word of words) {
      appendTo(tablesWith, word, position);
    }
  }
  const sources = tables.map((): Unit[] => []);
  const counts = new Int32Array(tables.length);
  for (const unit of units) {
    const words = new Set(wordsOf(withoutLabel(unit)));
    const touched: number[] = [];
    for (const word of words) {
      const holding = tablesWith.get(word) ?? [];
      meter.spent += 1 + holding.length;
      for (const position of holding) {
        if (counts[position] === 0) touched.push(position);
        counts[position] = (counts[position] ?? 0) + 1;
      }
    }
    if (meter.spent > meter.limit) return null;
    let best = -1;
    for (const position of touched) {
      const held = counts[position] ?? 0;
      const bestHeld = best === -1 ? 0 : counts[best] ?? 0;
      if (held >= 2 && 2 * held >= words.size && (best === -1 || held > bestHeld || held === bestHeld && position < best)) best = position;
    }
    for (const position of touched) {
      counts[position] = 0;
    }
    if (best !== -1) sources[best]?.push(unit);
  }
  const found: Array<{ sources: Unit[]; cells: Unit[] }> = [];
  for (const [position, read] of sources.entries()) {
    const words = tableWords[position] ?? new Set<string>();
    if (read.length === 0) continue;
    const from = new Set(read.flatMap(unit => wordsOf(withoutLabel(unit))));
    meter.spent += from.size + words.size;
    const held = [...words].filter(word => from.has(word)).length;
    if (2 * held >= words.size) found.push({ sources: read, cells: tables[position] ?? [] });
  }
  return meter.spent > meter.limit ? null : found;
}

/**
 * Looks up values in what a version holds: its units and its whole text,
 * front matter, HTML and link destinations included.
 *
 * A number is found when one of its readings is the reading of a figure the
 * text holds, or the value of English number words it holds. A code span is
 * found when its text stands in a unit or a line of the text, and not inside
 * a longer word, so `pre` is not found in `prefix`. One holding no letter or
 * digit counts as found, because such text stands almost anywhere and the
 * search for it reads too much.
 *
 * @param keys The text of each unit of the version.
 * @param source The version's whole text.
 */
export function foundIn(keys: readonly string[], source: string, meter: Meter): Found {
  const numbers = new Set<string>();
  const lines = [...keys, ...source.split(/\r\n|\r|\n/).map(line => line.trim().replace(/\s+/gu, " "))];
  // A table shows an escaped pipe as a pipe, inside a code span too, so each text is also read that way.
  const texts = [...lines, ...lines.filter(line => line.includes(PIPE_ESCAPE)).map(line => line.replaceAll(PIPE_ESCAPE, "|"))];
  for (const text of [...keys, source]) {
    meter.spent += text.length;
    for (const figure of figureValues(text, [])) {
      for (const reading of [...figure.readings, ...figure.groups.flatMap(group => [...group])]) {
        numbers.add(reading);
      }
    }
    for (const value of numberWords(text)) {
      numbers.add(value);
    }
  }
  // Each text, by the words it holds, so a code span is looked for only where its rarest word stands.
  const holding = new Map<string, number[]>();
  for (const [position, text] of texts.entries()) {
    meter.spent += text.length;
    for (const word of new Set(wordsOf(text))) {
      appendTo(holding, word, position);
    }
  }
  const answers = new Map<string, boolean | null>();
  return {
    number: readings => [...readings].some(reading => numbers.has(reading)),
    code: text => {
      const known = answers.get(text);
      if (known !== undefined) return known;
      const words = wordsOf(text);
      let answer: boolean | null = true;
      if (words.length > 0) {
        const rarest = words.reduce((first, second) => (holding.get(second)?.length ?? 0) < (holding.get(first)?.length ?? 0) ? second : first);
        answer = false;
        for (const position of holding.get(rarest) ?? []) {
          const candidate = texts[position] ?? "";
          meter.spent += candidate.length;
          if (meter.spent > meter.limit) {
            answer = null;
            break;
          }
          if (standsIn(candidate, text)) {
            answer = true;
            break;
          }
        }
      }
      answers.set(text, answer);
      return answer;
    },
  };
}

/** Whether a figure is found by its readings or, when it is grouped by spaces, by each of its groups. */
export function figureFound(figure: FigureValue, found: Found): boolean {
  return found.number(figure.readings) || figure.groups.length > 0 && figure.groups.every(group => found.number(group));
}

/**
 * The numbers written in figures in a text, outside its code spans. A
 * figure is a run of digits, with any full stops or commas between digits,
 * or groups of three digits after the first, joined by single spaces, such
 * as `1 000`. Only the digits 0 to 9 are read.
 *
 * A figure is read as a value with a full stop as the decimal point and
 * commas grouping its digits in threes, and again with the marks the other
 * way round, wherever the grouping holds, so `1,000` reads as 1000 or as 1.
 * A figure that holds neither way, such as `0.7.0`, reads only as itself.
 *
 * @param spans Where the code spans stand in the text.
 */
export function figureValues(text: string, spans: readonly CodeSpan[]): FigureValue[] {
  let masked = text;
  for (const span of spans) {
    masked = masked.slice(0, span.start) + " ".repeat(span.end - span.start) + masked.slice(span.end);
  }
  const figures: FigureValue[] = [];
  for (const match of masked.matchAll(FIGURE)) {
    const written = match[0];
    const groups = written.split(SPACE_GROUP);
    figures.push({
      text: written,
      start: match.index,
      readings: groups.length > 1 ? new Set([canonical(groups.join(""), "")]) : readingsOf(written),
      groups: groups.length > 1 ? groups.map(readingsOf) : [],
    });
  }
  return figures;
}

/**
 * The values English number words in a text give: each word's own, and the
 * value of each run of them so far, so `twenty-five` gives 20, 5 and 25,
 * and `one hundred and five` gives 1, 100, 5 and 105. Ordinals count, so
 * `third` gives 3. Letter case is ignored.
 */
export function numberWords(text: string): Set<string> {
  const values = new Set<string>();
  let total = 0;
  let current = 0;
  let inRun = false;
  for (const match of text.toLowerCase().matchAll(/[a-z]+|[^a-z]+/g)) {
    const word = match[0];
    if (!/^[a-z]/.test(word)) {
      // A space or a hyphen continues a run; anything else ends it.
      if (!/^[\s-]+$/.test(word)) inRun = false;
      continue;
    }
    // "and" continues a run, as in "one hundred and five".
    if (word === "and" && inRun) continue;
    const small = SMALL_NUMBERS.get(word);
    const scale = SCALES.get(word);
    if (small === undefined && scale === undefined) {
      inRun = false;
      continue;
    }
    if (!inRun) {
      total = 0;
      current = 0;
    }
    inRun = true;
    if (small !== undefined) {
      values.add(String(small));
      current += small;
    } else if (scale === 100) {
      values.add("100");
      current = (current === 0 ? 1 : current) * 100;
    } else if (scale !== undefined) {
      values.add(String(scale));
      total += (current === 0 ? 1 : current) * scale;
      current = 0;
    }
    values.add(String(total + current));
  }
  return values;
}

/** The words of a text: each run of letters, marks and digits, in lower case. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

/** A figure, as `figureValues` reads one. */
const FIGURE = /\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?!\d|[.,]\d)|\d+(?:[.,]\d+)*/g;

/** The space that joins the groups of a figure such as `1 000`. */
const SPACE_GROUP = /[ \u00A0\u202F]/;

/** English number words below a hundred, with ordinals, and their values. */
const SMALL_NUMBERS: ReadonlyMap<string, number> = new Map([
  ...["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
    .map((word, value): [string, number] => [word, value]),
  ...["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth"]
    .map((word, value): [string, number] => [word, value]),
  ...["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"].map((word, index): [string, number] => [word, 20 + 10 * index]),
  ...["twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth"].map((word, index): [string, number] => [word, 20 + 10 * index]),
]);

/** English words for a hundred and more, with ordinals, and their values. */
const SCALES: ReadonlyMap<string, number> = new Map([
  ["hundred", 100], ["hundredth", 100], ["thousand", 1_000], ["thousandth", 1_000],
  ["million", 1_000_000], ["millionth", 1_000_000], ["billion", 1_000_000_000], ["billionth", 1_000_000_000],
]);

/**
 * How many of a unit's rarest words to index, or to look up, so that any
 * unit sharing enough words with it shares one of them: a unit of `count`
 * words that pairs shares at least `need` of them, so it shares one of any
 * `count - need + 1`.
 */
function prefixLength(count: number): number {
  const need = Math.max(2, Math.ceil(count / 2));
  return count < 2 ? 0 : count - need + 1;
}

/**
 * A unit's words after any label, each numbered by how often it has stood
 * so far, so `the the` is two different tokens and words count as often as
 * they stand. Each token is an index into `tokens`, and `frequency` counts
 * the units that hold it.
 *
 * @returns The unit's tokens in ascending order.
 */
function tokensOf(unit: Unit, tokens: Map<string, number>, frequency: number[], meter: Meter): number[] {
  const seen = new Map<string, number>();
  const held: number[] = [];
  for (const word of wordsOf(withoutLabel(unit))) {
    const copy = seen.get(word) ?? 0;
    seen.set(word, copy + 1);
    const name = `${copy} ${word}`;
    let token = tokens.get(name);
    if (token === undefined) {
      token = tokens.size;
      tokens.set(name, token);
    }
    frequency[token] = (frequency[token] ?? 0) + 1;
    held.push(token);
  }
  meter.spent += held.length;
  return held.sort((first, second) => first - second);
}

/** How many tokens two ascending lists of them share. */
function sharedCount(first: readonly number[], second: readonly number[]): number {
  let shared = 0;
  let one = 0;
  let other = 0;
  while (one < first.length && other < second.length) {
    const left = first[one] ?? 0;
    const right = second[other] ?? 0;
    if (left === right) {
      shared++;
      one++;
      other++;
    } else if (left < right) {
      one++;
    } else {
      other++;
    }
  }
  return shared;
}

/** The readings of a figure with no space in it, as `figureValues` describes. */
function readingsOf(figure: string): Set<string> {
  const readings = new Set<string>();
  for (const [decimal, group] of [[".", ","], [",", "."]] as const) {
    const parts = figure.split(decimal);
    if (parts.length > 2) continue;
    const whole = parts[0] ?? "";
    const fraction = parts[1] ?? "";
    if (fraction.includes(group)) continue;
    const groups = whole.split(group);
    if (groups.length > 1 && ((groups[0]?.length ?? 0) > 3 || groups.slice(1).some(part => part.length !== 3))) continue;
    readings.add(canonical(groups.join(""), fraction));
  }
  if (readings.size === 0) readings.add(figure);
  return readings;
}

/** Adds a value to the list a map holds under a key, starting the list when there is none. */
function appendTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
}

/**
 * Whether a text holds another, with no letter, mark or digit just before or
 * after it where it starts or ends with one, so the match is not part of a
 * longer word.
 */
function standsIn(text: string, wanted: string): boolean {
  const opens = WORD_CHARACTER.test(wanted.charAt(0));
  const closes = WORD_CHARACTER.test(Array.from(wanted).at(-1) ?? "");
  for (let at = text.indexOf(wanted); at !== -1; at = text.indexOf(wanted, at + 1)) {
    const before = Array.from(text.slice(Math.max(0, at - 2), at)).at(-1) ?? "";
    const after = Array.from(text.slice(at + wanted.length, at + wanted.length + 2))[0] ?? "";
    if ((!opens || !WORD_CHARACTER.test(before)) && (!closes || !WORD_CHARACTER.test(after))) return true;
  }
  return false;
}

/** An escaped pipe, which a table shows as a pipe. */
export const PIPE_ESCAPE = "\\|";

/** A letter, a mark or a digit: a character a word is made of. */
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;

/** A value written with no leading zero before its digits and no trailing zero after its decimal point. */
function canonical(whole: string, fraction: string): string {
  const integer = whole.replace(/^0+(?=\d)/, "");
  const decimals = fraction.replace(/0+$/, "");
  return decimals === "" ? integer : `${integer}.${decimals}`;
}

/** A unit's text after its label, or its whole text when it has none. */
function withoutLabel(unit: Unit): string {
  return unit.label === undefined ? unit.key : unit.key.slice(unit.label.length + 1);
}
