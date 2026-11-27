import { toLines, type Heading, type structure } from "./parse.ts";
import { renderInline } from "./inline-wording.ts";
import type { Violation } from "./types.ts";

/**
 * What an author can declare about a document's heading numbers in
 * `.iso-24495-4/document-facts.json`: that readers cite the headings by
 * their numbers, or that they do not.
 */
export type HeadingNumbers = "cited" | "not-cited";

/**
 * A numeric identifier at the start of a heading's wording, then white space
 * and more text: digits with optional dotted parts and a closing `.`, `)` or
 * `:`, as in `1.`, `2)`, `3:` or `2.1.`, or a dotted number with no closing
 * mark, as in `2.1`. A bare number such as `100 days` is not one.
 */
const IDENTIFIER = /^(?:(\d{1,3}(?:\.\d{1,3})*)[.):]|(\d{1,3}(?:\.\d{1,3})+))\s+\S/;
/** A heading that is a version and an optional date and nothing else, such as `1.2.0 (2020-01-01)`. */
const VERSION_ONLY = /^\[?v?\d+(?:\.\d+){1,3}\]?(?:\s*[-:(]?\s*\[?\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?\]?\)?)?\s*$/i;
/** The headings of a contents section, after any number. Copied from `layout.ts`, which does not export it. */
const CONTENTS_LABEL = /^(?:contents|table of contents|toc|key sections)$/i;
/**
 * File names this rule does not read, by the last part of the path in any
 * letter case: a change log, whose numbered headings are versions, and a
 * licence, whose wording the author may not change.
 */
const EXEMPT_FILE = /^(?:changelog|changes|history|news|releases|license|licence|copying)(?:[._-].*)?$/i;

/**
 * Nouns that name a part of a document, so that a number beside one may cite
 * a heading: `step 3`, `rules 1 and 2`, `the second rule`.
 */
const CITING_NOUNS = [
  "sections?", "sect", "sec", "chapters?", "ch", "parts?", "clauses?", "steps?", "stages?", "phases?",
  "items?", "points?", "rules?", "principles?", "criterion", "criteria", "guidelines?", "requirements?",
  "appendix", "appendices", "annex(?:es)?", "articles?", "paragraphs?", "para", "headings?", "questions?",
  "tasks?", "lessons?", "modules?", "units?", "exercises?", "tips?", "options?", "methods?", "approach(?:es)?",
  "levels?", "tiers?", "category", "categories", "topics?",
].join("|");
/**
 * Every word that may stand straight before a number that cites a heading:
 * the nouns, and words that point, as in `see 2`, `in 3` or `§ 4`.
 */
const CITING_WORDS = `${CITING_NOUNS}|§|numbers?|no|nr|num|cf|see|in|under|at|from|to|per`;
/** A number this rule reads: up to three digits, with optional dotted parts. */
const NUMBER = String.raw`\d{1,3}(?:\.\d{1,3})*`;
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);
/** What may join the numbers of a list or a range: `1, 2 and 3`, `1-3`, `2 to 4`. */
const JOINER = String.raw`\s*(?:,|&|/|\+|-|${EN_DASH}|${EM_DASH}|\band\b|\bor\b|\bto\b|\bthrough\b|\bthru\b)\s*`;
/**
 * A citing word, then any `#`, `§`, `no.` or `number`, then one number or a
 * list or range of them.
 */
const AFTER_WORD = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${CITING_WORDS})\.?\s*(?:#|§|no\.?\s*|number\s*)?(${NUMBER}\.?(?:${JOINER}${NUMBER}\.?)*)`,
  "giu",
);
/** One number of such a list. */
const LISTED_NUMBER = new RegExp(NUMBER, "g");
/** Number words, so that `step two` or `the second rule` count as citing 2. */
const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6], ["seven", 7], ["eight", 8],
  ["nine", 9], ["ten", 10], ["eleven", 11], ["twelve", 12],
  ["first", 1], ["second", 2], ["third", 3], ["fourth", 4], ["fifth", 5], ["sixth", 6], ["seventh", 7],
  ["eighth", 8], ["ninth", 9], ["tenth", 10], ["eleventh", 11], ["twelfth", 12],
]);
const NUMBER_WORD = [...NUMBER_WORDS.keys()].join("|");
/** A citing noun then a number word, or a number word then a citing noun. */
const WORD_NUMBER = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:(?:${CITING_NOUNS})\.?\s+(${NUMBER_WORD})|(${NUMBER_WORD})\s+(?:${CITING_NOUNS}))(?![\p{L}\p{N}])`,
  "giu",
);
/**
 * A dotted number standing alone, such as `2.1`, not part of a longer number,
 * though a full stop may end the sentence after it, as in `see 2.1.`.
 */
const DOTTED = /(?<![\d.])\d{1,3}(?:\.\d{1,3})+(?!\.?\d)/g;
/**
 * A number that opens a part of a path, a link target, a fragment or a
 * bracket, alone or after a citing noun and an optional `-` or `_`, and is
 * followed by no letter or digit: the `01` of `categories/01-core/`, the `2`
 * of `#2-install`, `(2)`, `[2]` or `#step-2-setup`, and the `02` of
 * `(02-setup.md)`. The part must start just after one of `/ \ # ( [ <`, a
 * quotation mark or an apostrophe, so the `3` of `python-3.8` and the `1` of
 * `?v=1` do not count. Any number of digits is read, as a fragment drops
 * the dots of `10.12`, giving `#1012-b`.
 */
const PATH_PART = new RegExp(String.raw`(?<=[/\\#([<"'])(?:(?:${CITING_NOUNS})[-_]?)?(\d+(?:\.\d+)*)(?![\p{L}\p{N}])`, "giu");
/** Emphasis, code and strike marks, which may stand between a citing word and its number, as in `step **2**`. */
const INLINE_MARKS = /[*_`~]/g;

/**
 * The `uncited-numbering` finding: a document whose headings are numbered
 * while nothing in it cites one by its number.
 *
 * A heading is numbered when its wording opens with a numeric identifier, as
 * `IDENTIFIER` reads one, and is not a version alone. Only headings outside
 * every list and quotation are counted, the first level-1 heading, the
 * title, is not, and at least two must be numbered. Letters and Roman
 * numerals are not read, so `A. Scope` and `IV. Terms` count as unnumbered,
 * and so does `Step 1: Install`.
 *
 * The rest of the text is then searched for a citation of any of them. Every
 * line counts, code, comments and front matter included, except the
 * numbered headings' own lines and the lines of a contents section, which
 * runs from a heading such as Contents to the next heading at any level. A
 * heading is cited when its identifier stands after a citing word, as in
 * `see 2` or `steps 1 to 3`, when a number word stands beside a citing noun,
 * as in `step two`, when its dotted identifier stands alone, as in `2.1`, or
 * when its number opens a part of a path, a fragment or a bracket, as in
 * `(2)`, `#2-setup` or `docs/02-setup.md`, as `PATH_PART` reads one.
 * Numbers are compared by value, so `02` cites `2.`.
 * So a number that only looks like a citation, such as `in 2 minutes`,
 * quiets the rule: it reports only what it is sure of.
 *
 * A change log or a licence, by its file name, is not read.
 *
 * @param text The whole document, read as Markdown.
 * @param parsed What `structure` gave for the same text.
 * @param options `fileName` exempts a change log or a licence.
 *     `headingNumbers` is what the author declared: `cited` gives no
 *     finding, and `not-cited` gives the finding as a fault rather than a
 *     question.
 * @param tally When given, its `lines` grows by one for each line searched
 *     for a citation, so a test can count the work.
 * @returns One finding, on the first numbered heading, or none.
 */
export function uncitedNumberingViolations(
  text: string,
  parsed: Pick<ReturnType<typeof structure>, "headings" | "allHeadings">,
  options: { fileName?: string; headingNumbers?: HeadingNumbers } = {},
  tally?: { lines: number },
): Violation[] {
  if (options.headingNumbers === "cited") return [];
  if (EXEMPT_FILE.test(options.fileName?.split(/[\\/]/).at(-1) ?? "")) return [];
  const lines = toLines(text);
  const clear = clearOfHtml(lines);
  const title = parsed.headings.find(heading => heading.level === 1);
  const numbered = numberedHeadings(parsed.headings.filter(heading => heading !== title && clear(heading)));
  const first = numbered[0];
  if (first === undefined || !consecutivePair(numbered)) return [];
  // Every heading that opens with a number is one a citation may name, the
  // title and any the guards set aside included, and wherever it stands.
  if (cited(lines, numbered, numberedHeadings(parsed.allHeadings), parsed, clear, tally)) return [];
  const seen = "This heading and at least one other are numbered, and nothing in this file outside its headings and any contents section cites one by its number.";
  return [{
    rule: "uncited-numbering", line: first.heading.line,
    detail: options.headingNumbers === "not-cited"
      ? `${seen} .iso-24495-4/document-facts.json declares that readers do not cite these headings by number. Remove the numbers.`
      : `${seen} Must a reader cite these headings by their numbers? A project can declare the answer as headingNumbers in .iso-24495-4/document-facts.json.`,
  }];
}

/** A heading that opens with a numeric identifier, with the identifier's parts as numbers. */
interface Numbered {
  heading: Heading;
  parts: number[];
}

/** The headings whose wording opens with a numeric identifier, in order. */
function numberedHeadings(headings: readonly Heading[]): Numbered[] {
  const numbered: Numbered[] = [];
  for (const heading of headings) {
    const identifier = identifierOf(heading.text);
    if (identifier !== null) numbered.push({ heading, parts: identifier.split(".").map(Number) });
  }
  return numbered;
}

/**
 * The start of HTML that CommonMark runs past a blank line, to the line that
 * holds its end: a comment, a processing instruction, a declaration, CDATA,
 * or a `pre`, `script`, `style` or `textarea` element, in any letter case.
 */
const LONG_HTML = /<(?:(!--)|(\?)|(![A-Za-z])|(!\[CDATA\[)|(pre|script|style|textarea)(?=[\s/>]|$))/gi;
/** The start of a heading line outside any container: up to three spaces, one to six `#` and white space or the end. */
const ATX_START = /^ {0,3}#{1,6}(?:[ \t]|$)/;
/** A line that may be a heading in some container: quotation and list markers, then `#` and white space or the end. */
const HEADING_SHAPE = /^[ \t>*+-]*(?:\d+[.)][ \t>*+-]*)*#{1,6}(?:[ \t]|$)/;
/** The quotation markers and spaces a line may open with. */
const QUOTE_MARKERS = /^[ \t>]*/;
/** The quotation and list markers a line may open with. */
const CONTAINER_MARKERS = /^[ \t>*+-]*(?:\d+[.)][ \t>*+-]*)*/;
/**
 * A line that may underline a setext heading in some container: container
 * markers, `=` and `-` alone, ending with `=` or `-` and any spaces or tabs.
 * It is wider than an underline, so it can only quiet the rule, and a run of
 * dashes is read once, not once for each place a marker might end.
 */
const UNDERLINE_SHAPE = /^[ \t>*+=\d.)-]*[=-][ \t]*$/;
/** A line shaped like a fence, after any container markers: three backticks or tildes. */
const FENCE_SHAPE = /^[ \t>*+-]*(?:\d+[.)][ \t>*+-]*)*(?:`{3}|~{3})/;
/** What ends each kind of `LONG_HTML`, in the order of its groups. */
const LONG_HTML_ENDS: readonly RegExp[] = [/-->/g, /\?>/g, />/g, /\]\]>/g, /<\/(?:pre|script|style|textarea)>/gi];

/**
 * Whether a heading may be read: none of its lines, nor any line between the
 * last blank line above it and its first line, may stand in HTML.
 *
 * HTML can open a block that runs on to the next blank line, and the
 * structural reading still reads a heading inside it, such as a `##` line
 * straight below `<div>`. So no line from the last blank line above the
 * heading may hold a `<`, nor any text line of a setext heading. And HTML of
 * the kinds `LONG_HTML` names runs on past blank lines to the line that
 * holds its end, so no line of the heading may stand after a line holding
 * such a start, anywhere and in code too, and before the next line holding
 * its end. The structural reading can misplace either, as below a quotation.
 * Below a line shaped like a fence that stands in either kind of HTML, no
 * heading is read at all: CommonMark reads that line as HTML, and the
 * structural reading may pair the fences the other way. A setext heading
 * must also stand below a blank line or open the text.
 */
function clearOfHtml(lines: readonly string[]): (heading: Heading) => boolean {
  // 1 where the line is clear: no `<` above it since a blank line, and no long HTML open.
  const clearLine = new Uint8Array(lines.length + 2);
  // 1 where the line is blank, and for the line before the first.
  const blank = new Uint8Array(lines.length + 2);
  blank[0] = 1;
  let angle = false;
  let end: RegExp | null = null;
  let fenceInHtml = false;
  for (const [index, line] of lines.entries()) {
    clearLine[index + 1] = angle || end !== null || fenceInHtml ? 0 : 1;
    if ((angle || end !== null) && FENCE_SHAPE.test(line)) fenceInHtml = true;
    if (/^[ \t]*$/.test(line)) {
      blank[index + 1] = 1;
      angle = false;
    } else if (line.includes("<")) angle = true;
    end = longHtmlAfter(line, end);
  }
  return heading => {
    // A setext heading's text is the whole paragraph above its underline, so
    // a line of text above it would join it, as a table row does in a
    // renderer without tables.
    if (heading.setext && blank[heading.line - 1] !== 1) return false;
    // The structural reading blanks a comment and can find a heading behind
    // it, as in `<!-- c -->## 2. Two`, which CommonMark reads as HTML.
    if (!heading.setext && !ATX_START.test(lines[heading.line - 1] ?? "")) return false;
    const last = heading.line + heading.lines - 1 + (heading.setext ? 1 : 0);
    for (let line = heading.line; line <= last; line++) {
      if (clearLine[line] !== 1) return false;
    }
    return true;
  };
}

/**
 * Whether long HTML is open after one line: what ends it, or null when none
 * is open. A start and its end on one line close it again, and a start after
 * an end opens a new one.
 *
 * Each search starts where the last match ended and nothing is copied, so a
 * line of many comments, such as `<!---->` repeated, is read once.
 */
function longHtmlAfter(line: string, open: RegExp | null): RegExp | null {
  let end = open;
  let position = 0;
  // Each pass moves the position past at least one character, so the loop ends.
  for (;;) {
    if (end !== null) {
      end.lastIndex = position;
      const close = end.exec(line);
      if (close === null) break;
      position = close.index + close[0].length;
      end = null;
    }
    LONG_HTML.lastIndex = position;
    const start = LONG_HTML.exec(line);
    if (start === null) break;
    const kind = start.slice(1).findIndex(group => group !== undefined);
    end = LONG_HTML_ENDS[kind] ?? null;
    position = start.index + start[0].length;
  }
  return end;
}

/**
 * Whether two numbered headings are neighbours in one numbering: the same
 * parts but the last, which differ by one, as `1.` and `2.` or `2.1` and
 * `2.2`, or a heading and its first child, as `2.` and `2.1`. So `2.0
 * Migration` beside `1.5 Notes` is not read as a numbering.
 */
function consecutivePair(numbered: readonly Numbered[]): boolean {
  const written = new Set(numbered.map(({ parts }) => parts.join(".")));
  for (const { parts } of numbered) {
    const last = parts.length - 1;
    const next = [...parts.slice(0, last), (parts[last] ?? 0) + 1].join(".");
    if (written.has(next) || written.has([...parts, 1].join("."))) return true;
  }
  return false;
}

/**
 * The identifier a heading's wording opens with, without its closing mark,
 * or null when it opens with none or is a version alone.
 */
export function identifierOf(text: string): string | null {
  const wording = renderInline(text).replace(/\s+/g, " ").trim().replace(/^[*_]+/, "");
  if (VERSION_ONLY.test(wording)) return null;
  const match = IDENTIFIER.exec(wording);
  return match === null ? null : match[1] ?? match[2] ?? null;
}

/** What the citation search compares a number against. */
interface Targets {
  /** Each numbered heading's identifier with its parts compared by value, dotted and with the dots dropped. */
  identifiers: ReadonlySet<string>;
  /** The first part of each identifier, in ascending order. */
  integers: readonly number[];
}

/**
 * Whether any line outside the counted headings and any contents section
 * cites a heading that opens with a number. Each line is searched once, and
 * each number found is looked up in a set or by halving a sorted list, so
 * the time grows with the text and not with the number of headings.
 *
 * @param counted The headings the finding counts, whose lines are not searched.
 * @param named Every heading a citation may name.
 */
function cited(
  lines: readonly string[], counted: readonly Numbered[], named: readonly Numbered[],
  parsed: Pick<ReturnType<typeof structure>, "headings" | "allHeadings">, clear: (heading: Heading) => boolean,
  tally?: { lines: number },
): boolean {
  const skipped = new Uint8Array(lines.length);
  for (const { heading } of counted) {
    skipped.fill(1, heading.line - 1, heading.line - 1 + heading.lines + (heading.setext ? 1 : 0));
  }
  // Both lists are in document order, so one pointer finds each contents
  // section's end, the next heading at any level. A setext heading's text can
  // start lines above the line its underline marks.
  // A contents section also ends at the first line that may start a heading
  // in any container, or that stands above an underline, so a heading the
  // structural reading misses still ends it. For each index, the first such
  // index at or after it.
  const shaped = new Int32Array(lines.length + 1).fill(lines.length);
  for (let index = lines.length - 1; index >= 0; index--) {
    const mayStart = HEADING_SHAPE.test(lines[index] ?? "") || UNDERLINE_SHAPE.test(lines[index + 1] ?? "");
    shaped[index] = mayStart ? index : shaped[index + 1] ?? lines.length;
  }
  let after = 0;
  for (const heading of parsed.headings) {
    if (!CONTENTS_LABEL.test(label(heading.text)) || !clear(heading)) continue;
    while (after < parsed.allHeadings.length && (parsed.allHeadings[after]?.line ?? 0) <= heading.line) {
      after++;
    }
    const own = heading.line - 1 + heading.lines + (heading.setext ? 1 : 0);
    const end = Math.min((parsed.allHeadings[after]?.line ?? lines.length + 1) - 1, shaped[own] ?? lines.length);
    skipped.fill(1, heading.line - 1, Math.max(end, own));
  }
  const identifiers = new Set<string>();
  const integers = new Set<number>();
  // A line that may be a heading in some reading names a target too, so a
  // heading the structural reading misses, as inside a fence it pairs
  // differently, can still be cited.
  // A line above an underline is read both with its quotation markers taken
  // off and with every container marker taken off, as `2.1 Scope` would lose
  // its `2.` to the second.
  const shapedParts: number[][] = [];
  for (const [index, line] of lines.entries()) {
    const wordings = HEADING_SHAPE.test(line) ? [line.replace(HEADING_SHAPE, "")]
      : UNDERLINE_SHAPE.test(lines[index + 1] ?? "") ? [line.replace(QUOTE_MARKERS, ""), line.replace(CONTAINER_MARKERS, "")] : [];
    for (const wording of wordings) {
      const identifier = identifierOf(wording);
      if (identifier !== null) shapedParts.push(identifier.split(".").map(Number));
    }
  }
  for (const parts of [...named.map(heading => heading.parts), ...shapedParts]) {
    identifiers.add(parts.join("."));
    // A fragment drops the dots of `2.1 Scope`, giving `#21-scope`.
    identifiers.add(String(Number(parts.join(""))));
    integers.add(parts[0] ?? 0);
  }
  const targets: Targets = { identifiers, integers: [...integers].sort((one, two) => one - two) };
  for (const [index, line] of lines.entries()) {
    if (skipped[index] === 1) continue;
    if (tally !== undefined) tally.lines++;
    // Read again without its marks, so `step **2**` cites as `step 2` does.
    const unmarked = line.replace(INLINE_MARKS, "");
    if (citesInLine(line, targets) || (unmarked !== line && citesInLine(unmarked, targets))) return true;
  }
  return false;
}

/** Whether a written number, such as `02` or `2.1.`, is a numbered heading's identifier. */
function names(written: string, targets: Targets): boolean {
  return targets.identifiers.has(written.replace(/\.$/, "").split(".").map(Number).join("."));
}

/** Whether one line holds a citation of a numbered heading, in any of the forms `uncitedNumberingViolations` reads. */
function citesInLine(line: string, targets: Targets): boolean {
  for (const match of line.matchAll(AFTER_WORD)) {
    if (listCites(match[1] ?? "", targets)) return true;
  }
  for (const match of line.matchAll(WORD_NUMBER)) {
    const value = NUMBER_WORDS.get((match[1] ?? match[2] ?? "").toLowerCase()) ?? 0;
    if (holdsBetween(targets.integers, value, value)) return true;
  }
  for (const match of line.matchAll(DOTTED)) {
    if (names(match[0], targets)) return true;
  }
  for (const match of line.matchAll(PATH_PART)) {
    if (names(match[1] ?? "", targets)) return true;
  }
  return false;
}

/**
 * Whether a number, or a list or range of numbers, names a numbered heading.
 * Two neighbouring numbers are also read as a range, such as `1-4`, which
 * names every whole number from the one to the other.
 */
function listCites(list: string, targets: Targets): boolean {
  const numbers = [...list.matchAll(LISTED_NUMBER)].map(match => match[0]);
  if (numbers.some(number => names(number, targets))) return true;
  const values = numbers.map(number => Number(number.split(".")[0]));
  for (let index = 0; index + 1 < values.length; index++) {
    const one = values[index] ?? 0;
    const two = values[index + 1] ?? 0;
    if (holdsBetween(targets.integers, Math.min(one, two), Math.max(one, two))) return true;
  }
  return false;
}

/** Whether a list in ascending order holds a value from `low` to `high`, found by halving the list. */
function holdsBetween(sorted: readonly number[], low: number, high: number): boolean {
  let start = 0;
  let end = sorted.length;
  while (start < end) {
    const middle = (start + end) >> 1;
    if ((sorted[middle] ?? 0) < low) {
      start = middle + 1;
    } else {
      end = middle;
    }
  }
  return start < sorted.length && (sorted[start] ?? 0) <= high;
}

/** A heading's wording with any leading number removed, as the contents rule reads a label. */
function label(text: string): string {
  return renderInline(text).replace(/\s+/g, " ").trim().replace(/^\d+(?:\.\d+)*\.?\s+/, "");
}
