import { toLines, type Quotation, type structure } from "./parse.ts";
import type { Violation } from "./types.ts";

/**
 * A link reference definition whose label is an alert marker, such as
 * `[!NOTE]: https://example.org`. It can make the marker a link, so an alert
 * of that kind is not read in a text that holds one. The label may run over
 * lines, hold quotation markers and spaces, and escape its `!`, so this
 * matches more than a renderer would take as a definition.
 */
const DEFINED_MARKER = /\[[\s>]*\\?!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)[\s>]*\]:/gi;
const QUOTE_MARKER = /^ {0,3}>[ \t]?/;
const BLANK = /^[ \t]*$/;
/**
 * The characters of a row that would make the marker line a table header,
 * when the row holds a dash. Each pattern here holds one repetition of one
 * class, so a long line is read once.
 */
const DELIMITER_ROW = /^[-:| \t]+$/;
/** A thematic break of stars or underscores, once its spaces and tabs are gone. */
const THEMATIC_BREAK = /^(?:\*{3,}|_{3,})$/;
/** A setext underline of equals signs, trimmed. */
const UNDERLINE = /^=+$/;
const SPACES = /[ \t]/g;
/**
 * The `adjacent-alerts` findings: each GitHub alert that follows an alert of
 * the same kind with only blank lines between.
 *
 * It reports only an alert it is sure of, and reads anything else as no
 * alert. An alert here is a quotation outside every list and quotation whose
 * first line is the marker alone, such as `> [!NOTE]`, in any letter case.
 * It also needs a blank line or the start of the text above it, a next line
 * in the quotation that holds text, no underline or row of dashes up to the
 * next blank line, no link definition of its marker anywhere in the text,
 * no `<` on any line above it, and no line above it that opens an empty
 * container, as `opensEmptyContainer` reads one.
 *
 * Every HTML block, element, comment and tag starts with a `<`, so with none
 * above an alert no HTML can hold it or the alert before it. A `<` counts
 * wherever it stands, in code, in a comment or in text that only looks like
 * HTML, so some alerts that render are not read.
 *
 * @param text The whole document, read as Markdown.
 * @param parsed What `structure` gave for the same text.
 * @returns One finding on the marker line of each such later alert, in
 *     document order, its detail naming the earlier alert's line. Three in a
 *     row give two. Empty when none, as for empty text.
 */
export function adjacentAlertViolations(text: string, parsed: Pick<ReturnType<typeof structure>, "quotations">): Violation[] {
  const lines = toLines(text);
  const defined = new Set<string>();
  for (const match of text.matchAll(DEFINED_MARKER)) {
    defined.add((match[1] ?? "").toUpperCase());
  }
  const reading: AlertReading = {
    lines, defined,
    firstAngle: firstLineWhere(lines, line => line.includes("<")),
    firstEmptyContainer: firstLineWhere(lines, opensEmptyContainer),
  };
  const findings: Violation[] = [];
  let previous: Quotation | null = null;
  for (const quotation of parsed.quotations) {
    const earlier = previous;
    previous = readableAlert(reading, quotation) ? quotation : null;
    if (earlier === null || previous === null || earlier.alert !== quotation.alert) continue;
    if (!onlyBlankBetween(lines, earlier.end, quotation.line)) continue;
    const kind = quotation.alert ?? "";
    findings.push({
      rule: "adjacent-alerts", line: quotation.line,
      detail: `This ${kind} alert follows the ${kind} alert on line ${earlier.line} with only blank lines between. If the two serve one purpose, merge them into one alert.`,
    });
  }
  return findings;
}

/** What the rule reads of the whole text before it reads each quotation. */
interface AlertReading {
  lines: readonly string[];
  /** The kinds whose marker the text defines as a link label. */
  defined: ReadonlySet<string>;
  /** The first line, counted from 1, that holds a `<`, or infinity when none does. */
  firstAngle: number;
  /** The first line, counted from 1, that opens an empty container, or infinity when none does. */
  firstEmptyContainer: number;
}

/** The first line, counted from 1, that the test holds for, or infinity when it holds for none. */
function firstLineWhere(lines: readonly string[], holds: (line: string) => boolean): number {
  const index = lines.findIndex(holds);
  return index === -1 ? Number.POSITIVE_INFINITY : index + 1;
}

/**
 * Whether a line is made only of container markers, spaces and tabs, and
 * holds a list marker or two or more `>`, such as `> >`, `>>`, `-`, `- \t`,
 * `1.` or `> -`. Such a line opens a quotation or a list item with nothing in
 * it. The structural reading then takes an unmarked line below for a lazy
 * line of that quotation, or loses the list the item opens, where CommonMark
 * makes a paragraph or keeps the list. So the rule reads no alert below one.
 *
 * A lone `>` does not count: inside a quotation it is a blank line of it.
 * The line counts wherever it stands, in code too, and also as a thematic
 * break such as `- - -`, so some alerts that render are not read.
 */
export function opensEmptyContainer(line: string): boolean {
  let quotes = 0;
  let lists = 0;
  let index = 0;
  while (index < line.length) {
    const character = line.charAt(index);
    if (character === " " || character === "\t") {
      index++;
    } else if (character === ">") {
      quotes++;
      index++;
    } else {
      const end = listMarkerEnd(line, index);
      if (end === -1) return false;
      lists++;
      index = end;
    }
  }
  return lists > 0 || quotes >= 2;
}

/**
 * Where a list marker starting at this index ends: a `-`, `*` or `+`, or
 * digits and a `.` or `)`, followed by a space, a tab or the end of the
 * line. -1 when none starts there.
 */
function listMarkerEnd(line: string, start: number): number {
  let index = start;
  const character = line.charAt(index);
  if (character === "-" || character === "*" || character === "+") {
    index++;
  } else {
    while (index < line.length && line.charAt(index) >= "0" && line.charAt(index) <= "9") {
      index++;
    }
    if (index === start || (line.charAt(index) !== "." && line.charAt(index) !== ")")) return -1;
    index++;
  }
  const after = line.charAt(index);
  return after === "" || after === " " || after === "\t" ? index : -1;
}

/**
 * Whether a quotation is an alert this rule is sure of: it names a kind, the
 * text defines no link label of that marker, no line above it holds a `<` or
 * opens an empty container, a blank line or the start of the text stands
 * above it, its next line is in the quotation and holds text, and no line up
 * to the next blank line is an underline or a row of dashes.
 */
function readableAlert(reading: AlertReading, quotation: Quotation): boolean {
  if (quotation.alert === null || reading.defined.has(quotation.alert)) return false;
  if (quotation.line > reading.firstAngle || quotation.line > reading.firstEmptyContainer) return false;
  const above = reading.lines[quotation.line - 2];
  if (above !== undefined && !BLANK.test(above)) return false;
  const next = reading.lines[quotation.line] ?? "";
  const marker = QUOTE_MARKER.exec(next);
  if (marker === null) return false;
  const rest = next.slice(marker[0].length).trim();
  return rest !== "" && isText(rest) && !underlinedRun(reading.lines, quotation.line);
}

/**
 * Whether a line after an alert's marker line, up to the next line of only
 * spaces or tabs, is an underline of equals signs or a row of dashes, colons
 * and pipes, with or without a quotation marker. Each may make the marker's paragraph a heading
 * or a table header, and the structural reading can take the line above one
 * for a table row where CommonMark makes a heading. So the rule reads no
 * alert with one, though some such alerts render.
 *
 * @param markerLine The marker's line, counted from 1, which is also the
 *     index of the line after it.
 */
function underlinedRun(lines: readonly string[], markerLine: number): boolean {
  for (let index = markerLine; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const marker = QUOTE_MARKER.exec(line);
    const after = marker === null ? line : line.slice(marker[0].length);
    // CommonMark ends a paragraph only at a line of spaces or tabs, so a
    // no-break space alone carries it on, though `trim` removes one.
    if (BLANK.test(after)) return false;
    const rest = after.trim();
    if (UNDERLINE.test(rest) || (rest.includes("-") && DELIMITER_ROW.test(rest))) return true;
  }
  return false;
}

/**
 * Whether the line after an alert's marker, trimmed, stays plain text in the
 * alert. It does not when it is a thematic break of stars or underscores, or
 * HTML, which may show nothing. `underlinedRun` reads the same line for an
 * underline and a row of dashes.
 */
function isText(rest: string): boolean {
  return !rest.startsWith("<") && !THEMATIC_BREAK.test(rest.replace(SPACES, ""));
}

/**
 * Whether each line between two lines, counted from 1, is blank. The later
 * alert has a blank line above it, so at least one stands between.
 */
function onlyBlankBetween(lines: readonly string[], end: number, line: number): boolean {
  for (let index = end; index < line - 1; index++) {
    if (!BLANK.test(lines[index] ?? "")) return false;
  }
  return true;
}
