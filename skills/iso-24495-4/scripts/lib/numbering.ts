import { toLines, type Heading, type structure } from "./parse.ts";
import { decodeEntities, renderInline } from "./inline-wording.ts";
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
/** The number words from zero to nineteen, and their ordinals, each at its value. */
const UNITS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const UNIT_ORDINALS = [
  "zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
];
/** The tens from twenty to ninety, and their ordinals. */
const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const TENS_ORDINALS = ["twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth"];
/** Each number word alone, with its value, so that `step two` or `the second rule` count as citing 2. */
const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ...UNITS.map((word, value) => [word, value] as const), ...UNIT_ORDINALS.map((word, value) => [word, value] as const),
  ...TENS.map((word, index) => [word, 20 + 10 * index] as const), ...TENS_ORDINALS.map((word, index) => [word, 20 + 10 * index] as const),
]);
/**
 * The highest number the number words spell. A document that counts a
 * heading numbered past it is not reported, as a citation in words of that
 * heading could not be read.
 */
const HIGHEST_WORD = 99;
/**
 * A number word: a ten and a unit, as in `twenty-one` or `thirty second`, or
 * one word alone, the longest first so that `seventeen` is not read as
 * `seven`.
 */
const NUMBER_WORD = String.raw`(?:${TENS.join("|")})[-\s]+(?:${[...UNITS.slice(1, 10), ...UNIT_ORDINALS.slice(1, 10)].join("|")})|${
  [...NUMBER_WORDS.keys()].sort((one, two) => two.length - one.length).join("|")}`;
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
/** An inline HTML tag, opening or closing, such as `<em>` or `</b>`. */
const INLINE_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g;
/** The target of an inline link, `](x)`, or the label of a reference link, `][x]`, so `[See section](x) 2` reads as `See section 2`. */
const LINK_TARGET = /\]\([^()]*\)|\]\[[^\]]*\]/g;
/** A backslash escape or a character reference, such as `\#` or `&#50;`. */
const ESCAPE_OR_REFERENCE = /\\([!-/:-@[-`{-~])|&(?:#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g;
/** A backslash that ends a line, a hard line break. */
const HARD_BREAK = /\\$/;
/** A line with nothing but spaces and tabs. */
const BLANK = /^[ \t]*$/;
/**
 * The markers a line may open with: quotation and list markers, `#` and the
 * `=` and `-` of an underline, and the spaces around them.
 */
const LINE_START = /^[ \t>*+#=-]*(?:\d+[.)][ \t>*+#=-]*)*/;

/**
 * The `uncited-numbering` finding: a document whose headings are numbered
 * while no reference to one by its number is found as written.
 *
 * A heading is counted when its source wording opens with a numeric
 * identifier, as `IDENTIFIER` reads one, and its rendered wording opens with
 * the same one, so no formatting, escape or character reference stands
 * before the number or inside it. A version alone is not counted. A dotted
 * identifier, such as `2.1`, is counted only below a counted heading that
 * its parent number, `2`, opens, so the file itself shows the section. Only
 * headings outside every list and quotation are counted, and the first
 * level-1 heading, the title, is not. At least two must be counted, two of
 * them neighbours, such as `1.` and `2.` or `2.` and `2.1`, and none may be
 * numbered past `HIGHEST_WORD`. Letters and Roman numerals are not read, so
 * `A. Scope` and `IV. Terms` are not counted, and nor is `Step 1: Install`.
 *
 * The rest of the text is then searched for a citation of any heading whose
 * wording opens with a number. Every line counts, code, comments and front
 * matter included, except the counted headings' own lines and the lines of a
 * contents section, which runs from a heading such as Contents to the next
 * heading at any level. A heading is cited when its identifier stands after
 * a citing word, as in `see 2` or `steps 1 to 3`, when a number word stands
 * beside a citing noun, as in `step two`, when its dotted identifier stands
 * alone, as in `2.1`, or when its number opens a part of a path, a fragment
 * or a bracket, as in `(2)`, `#2-setup` or `docs/02-setup.md`, as
 * `PATH_PART` reads one. Numbers are compared by value, so `02` cites `2.`.
 *
 * Each line is searched alone, and so is each run of lines with no blank
 * line between, with every line break as one space, both with the markers
 * each line opens with and without them. Each of those is also searched
 * with its emphasis and code marks taken out, and with its inline tags and
 * link targets taken out and its escapes and character references read. So
 * a citation that wraps, as `See section` above `2.`, cites, and so does
 * `See section &#50;.`. A number that only looks like a citation, such as
 * `in 2 minutes`, quiets the rule too.
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
  const counted = countedHeadings(parsed.headings.filter(heading => heading !== title && clear(heading)), lines);
  const first = counted[0];
  if (first === undefined || !consecutivePair(counted)) return [];
  if (counted.some(({ parts }) => (parts[0] ?? 0) > HIGHEST_WORD)) return [];
  // Every heading whose wording opens with a number, however it is written,
  // is one a citation may name, the title and any the guards set aside
  // included, and wherever it stands.
  if (cited(lines, counted, namedHeadings(parsed.allHeadings), parsed, clear, tally)) return [];
  const seen = "This heading and at least one other are numbered, and no reference to one of them by its number is found as written in this file, outside those headings and any contents section.";
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

/** The `#` marks and white space before an ATX heading's wording. */
const ATX_PREFIX = /^ {0,3}#{1,6}(?:[ \t]+|$)/;

/**
 * The headings the finding counts, in order: each whose source wording and
 * rendered wording open with the same identifier, as `identifierOf` reads
 * them, and, when the identifier is dotted, below a counted heading that its
 * parent number opens.
 *
 * @param lines The text's lines, from which each heading's source wording is read.
 */
function countedHeadings(headings: readonly Heading[], lines: readonly string[]): Numbered[] {
  const counted: Numbered[] = [];
  const shown = new Set<string>();
  for (const heading of headings) {
    const source = heading.setext
      ? lines.slice(heading.line - 1, heading.line - 1 + heading.lines).join(" ")
      : (lines[heading.line - 1] ?? "").replace(ATX_PREFIX, "");
    const identifier = identifierOf(source, heading.text);
    if (identifier === null) continue;
    const parts = identifier.split(".").map(Number);
    if (parts.length > 1 && !shown.has(parts.slice(0, -1).join("."))) continue;
    counted.push({ heading, parts });
    shown.add(parts.join("."));
  }
  return counted;
}

/**
 * Every heading whose rendered wording opens with a numeric identifier, with
 * any emphasis marks before it set aside, in order. A citation may name any
 * of them, so this reads more widely than `identifierOf`, and can only quiet
 * the rule.
 */
function namedHeadings(headings: readonly Heading[]): Numbered[] {
  const named: Numbered[] = [];
  for (const heading of headings) {
    const identifier = namedIdentifierOf(heading.text);
    if (identifier !== null) named.push({ heading, parts: identifier.split(".").map(Number) });
  }
  return named;
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
/** A table's delimiter row, such as `|---|` or `--- | :-:`, after any quotation markers. It must also hold a `|`. */
const TABLE_DELIMITER = /^[ \t>]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
/** What ends each kind of `LONG_HTML`, in the order of its groups. */
const LONG_HTML_ENDS: readonly RegExp[] = [/-->/g, /\?>/g, />/g, /\]\]>/g, /<\/(?:pre|script|style|textarea)>/gi];

/**
 * Whether a heading may be read: none of its lines, nor any line between the
 * last blank line above it and its first line, may stand in HTML.
 *
 * HTML can open a block that runs on to the next blank line, and the
 * structural reading still reads a heading inside it, such as a `##` line
 * straight below `<div>`. A table runs on to the next blank line too, and
 * Bun's renderer reads a `##` line or a fence straight below one as a row.
 * So no line from the last blank line above the heading may hold a `<` or a
 * table's delimiter row, such as `|---|`, nor may any text line of a setext
 * heading hold a `<`. And HTML of
 * the kinds `LONG_HTML` names runs on past blank lines to the line that
 * holds its end. Any start of one, anywhere and in code too, may be the one
 * CommonMark reads, so each kind is held open from its last start until a
 * later line holds that kind's own end, whatever else opens or closes in
 * between, and no line of the heading may stand while any kind is held open.
 * The structural reading can misplace either kind of HTML, as below a
 * quotation. Below a line shaped like a fence that stands in either kind of
 * HTML, no heading is read at all: CommonMark reads that line as HTML, and
 * the structural reading may pair the fences the other way. The same holds
 * below a fence-shaped line straight below a table. A setext heading must
 * also stand below a blank line or open the text.
 */
function clearOfHtml(lines: readonly string[]): (heading: Heading) => boolean {
  // 1 where the line is clear: no `<` or `|` above it since a blank line, and no long HTML open.
  const clearLine = new Uint8Array(lines.length + 2);
  // 1 where the line is blank, and for the line before the first.
  const blank = new Uint8Array(lines.length + 2);
  blank[0] = 1;
  let angle = false;
  // Whether a table's delimiter row stands above, since a blank line.
  let table = false;
  // 1 for each kind of long HTML that may be open, in the order of `LONG_HTML_ENDS`.
  const open = new Uint8Array(LONG_HTML_ENDS.length);
  let anyOpen = false;
  let fenceInHtml = false;
  for (const [index, line] of lines.entries()) {
    clearLine[index + 1] = angle || table || anyOpen || fenceInHtml ? 0 : 1;
    if ((angle || table || anyOpen) && FENCE_SHAPE.test(line)) fenceInHtml = true;
    if (BLANK.test(line)) {
      blank[index + 1] = 1;
      angle = false;
      table = false;
    } else {
      if (line.includes("<")) angle = true;
      if (line.includes("|") && TABLE_DELIMITER.test(line)) table = true;
    }
    anyOpen = longHtmlAfter(line, open);
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
 * Updates which kinds of long HTML may be open after one line, and says
 * whether any may. A kind that starts on the line stays open unless its own
 * end follows its last start there. A kind already open closes at its own
 * end anywhere on the line, unless it starts again after it.
 *
 * Each search starts where the last match ended and nothing is copied, so a
 * line of many comments, such as `<!---->` repeated, is read once for each
 * kind.
 *
 * @param open One entry for each kind, in the order of `LONG_HTML_ENDS`: 1
 *     where it may be open. Changed in place.
 */
function longHtmlAfter(line: string, open: Uint8Array): boolean {
  // For each kind, the offset just past its last start on this line, or -1.
  const afterStart = new Int32Array(open.length).fill(-1);
  LONG_HTML.lastIndex = 0;
  // Each match takes at least two characters, so the loop ends.
  for (let start = LONG_HTML.exec(line); start !== null; start = LONG_HTML.exec(line)) {
    const kind = start.slice(1).findIndex(group => group !== undefined);
    afterStart[kind] = start.index + start[0].length;
  }
  let anyOpen = false;
  for (const [kind, end] of LONG_HTML_ENDS.entries()) {
    const from = afterStart[kind] ?? -1;
    if (from >= 0 || open[kind] === 1) {
      end.lastIndex = Math.max(from, 0);
      open[kind] = end.test(line) ? 0 : 1;
    }
    if (open[kind] === 1) anyOpen = true;
  }
  return anyOpen;
}

/**
 * Whether two counted headings are neighbours in one numbering: the same
 * parts but the last, which differ by one, as `1.` and `2.` or `2.1` and
 * `2.2`, or a heading and its first child, as `2.` and `2.1`. So `1.`
 * beside `3.` alone is not read as a numbering.
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
 * The identifier a heading opens with, without its closing mark, when its
 * source wording and its rendered wording both open with it, or null. So
 * `*1. A`, `**1.** A`, `1\. A` and `&#49;. A` give null, and so does a
 * version alone, such as `1.2.0`.
 *
 * @param source The heading's wording as the file holds it, after any `#`
 *     marks.
 * @param wording The same wording as the structural reading gives it, which
 *     is rendered. The source by default.
 */
export function identifierOf(source: string, wording: string = source): string | null {
  const written = source.replace(/\s+/g, " ").trim();
  const shown = renderInline(wording).replace(/\s+/g, " ").trim();
  if (VERSION_ONLY.test(written) || VERSION_ONLY.test(shown)) return null;
  const asWritten = IDENTIFIER.exec(written);
  const asShown = IDENTIFIER.exec(shown);
  if (asWritten === null || asShown === null) return null;
  const identifier = asWritten[1] ?? asWritten[2] ?? null;
  return identifier === (asShown[1] ?? asShown[2] ?? null) ? identifier : null;
}

/**
 * The identifier a heading's rendered wording opens with once any emphasis
 * marks before it are set aside, without its closing mark, or null when it
 * opens with none or is a version alone. It reads what a citation may name,
 * so it reads more widely than `identifierOf`.
 */
function namedIdentifierOf(text: string): string | null {
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
  // For each index, the first line of the run of lines with no blank line
  // between that holds it. A setext heading's text may start there, above
  // the line its underline marks.
  const runStart = new Int32Array(lines.length);
  for (const [index, line] of lines.entries()) {
    runStart[index] = index > 0 && !BLANK.test(line) && !BLANK.test(lines[index - 1] ?? "") ? runStart[index - 1] ?? index : index;
  }
  let after = 0;
  for (const heading of parsed.headings) {
    if (!CONTENTS_LABEL.test(label(heading.text)) || !clear(heading)) continue;
    while (after < parsed.allHeadings.length && (parsed.allHeadings[after]?.line ?? 0) <= heading.line) {
      after++;
    }
    const own = heading.line - 1 + heading.lines + (heading.setext ? 1 : 0);
    // A line above an underline ends the section where its run starts, so
    // every line of a setext heading's text stays outside it.
    let stop = shaped[own] ?? lines.length;
    if (stop < lines.length && !HEADING_SHAPE.test(lines[stop] ?? "")) stop = Math.max(own, runStart[stop] ?? stop);
    const end = Math.min((parsed.allHeadings[after]?.line ?? lines.length + 1) - 1, stop);
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
      const identifier = namedIdentifierOf(wording);
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
  // The lines since the last blank or skipped line, so a citation that
  // wraps is read whole.
  let paragraph: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (skipped[index] === 1 || BLANK.test(line)) {
      if (citesInParagraph(paragraph, targets)) return true;
      paragraph = [];
      if (skipped[index] === 1) continue;
    } else {
      paragraph.push(line);
    }
    if (tally !== undefined) tally.lines++;
    // Read again without its marks, so `step **2**` cites as `step 2` does.
    const unmarked = line.replace(INLINE_MARKS, "");
    if (citesInLine(line, targets) || (unmarked !== line && citesInLine(unmarked, targets))) return true;
  }
  return citesInParagraph(paragraph, targets);
}

/**
 * Whether a run of lines with no blank line between holds a citation once
 * joined, each line break read as one space. The run is read with the
 * markers each line opens with, with its quotation markers taken off, and
 * with every marker `LINE_START` names taken off, as a line that opens with
 * `2.` may go on a paragraph or open a list item. Each of the three is read
 * as it stands, without its emphasis and code marks, and as `spelt` gives it.
 */
function citesInParagraph(paragraph: readonly string[], targets: Targets): boolean {
  if (paragraph.length === 0) return false;
  const readings = [
    paragraph.map(line => line.replace(HARD_BREAK, "")).join(" "),
    paragraph.map(line => line.replace(QUOTE_MARKERS, "").replace(HARD_BREAK, "")).join(" "),
    paragraph.map(line => line.replace(LINE_START, "").replace(HARD_BREAK, "")).join(" "),
  ];
  return readings.some(reading => citesInLine(reading, targets) || citesInLine(reading.replace(INLINE_MARKS, ""), targets) || citesInLine(spelt(reading), targets));
}

/**
 * Text with its inline tags and link targets taken out, its escapes and
 * character references read, and then its emphasis and code marks taken
 * out, so `<em>2</em>`, `[See section](x) 2` and `&#50;` give `2`,
 * `See section 2` and `2`.
 */
function spelt(text: string): string {
  return text.replace(INLINE_TAG, "").replace(LINK_TARGET, "")
    .replace(ESCAPE_OR_REFERENCE, (whole, escaped?: string) => escaped ?? decodeEntities(whole))
    .replace(INLINE_MARKS, "");
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
    // A ten and a unit add up, so `twenty-first` gives 21.
    const words = (match[1] ?? match[2] ?? "").toLowerCase().split(/[-\s]+/);
    const value = words.reduce((sum, word) => sum + (NUMBER_WORDS.get(word) ?? 0), 0);
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
