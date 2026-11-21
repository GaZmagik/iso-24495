import { codeSpanEnds, toLines, type structure } from "./parse.ts";
import { opensEmptyContainer } from "./alerts.ts";
import type { Violation } from "./types.ts";

const BLANK = /^[ \t]*$/;
/** The marker line of an item this rule reads: up to three spaces, a bullet, one or more spaces, then text that does not start with a space or a tab. */
const MARKER_LINE = /^( {0,3})([-*+])( +)([^ \t].*)$/;
/** The byte order mark, which the structural reading drops from the start of a text. */
const BYTE_ORDER_MARK = 0xfeff;
/** The spaces and tabs a line starts with. */
const LEADING = /^[ \t]*/;
/**
 * The start of HTML that runs past a blank line: a comment, a processing
 * instruction, a declaration, CDATA, or a `pre`, `script`, `style` or
 * `textarea` element, in any letter case. A `/` after the name counts too,
 * as some renderers read `<style/>` as such an element.
 */
const LONG_HTML = /<(?:!|\?|(?:pre|script|style|textarea)(?=[\s/>]|$))/i;
/**
 * The start of a line of an item's text, past up to three spaces, that may
 * open a block other than a paragraph: a quotation, a list item, a fence, a
 * heading, HTML or mathematics.
 */
const BLOCK_START = /^(?:>|(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)|`{3}|~{3}|#{1,6}(?:[ \t]|$)|<|\$\$)/;
/** A line of dashes, colons, pipes, spaces and tabs: an underline, a thematic break or a table's delimiter row, when it holds a dash. */
const DASH_ROW = /^[-:| \t]+$/;
/** An underline of equals signs. */
const EQUALS_ROW = /^=+[ \t]*$/;
/** A thematic break of stars or underscores. */
const STAR_OR_UNDERSCORE_BREAK = /^(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * The `bullet-paragraphs` findings: each unordered list item that directly
 * holds two or more paragraphs and nothing else.
 *
 * It reports only an item it is sure of, and reads any other as no finding.
 * An item is read when its marker line is up to three spaces, a `-`, `*` or
 * `+`, one to four spaces and text, so items in quotations, on another item's
 * line or four or more columns in are not read. A bullet with text up to
 * three columns in is an item in CommonMark wherever it stands, unless HTML
 * or a fence holds it; one further in is an item only because of the lists
 * above it, which the structural reading can misplace. Each line of the item must be blank or plain text at its text's
 * column, up to three columns past it. A line that may start any other
 * block, such as code, a quotation, a list, a table, a heading, HTML or a
 * link definition, leaves the whole item unread. So does a paragraph that is
 * one code span and nothing else, which reads as code.
 *
 * The item ends at a less indented line after a blank line, at a bullet
 * with text at the marker's own indent, or at the end of the text. Any other
 * less indented line straight below its text may carry a paragraph on, so it
 * leaves the item unread.
 *
 * Four guards cover what the structural reading may misread above an item.
 * No line above it or in it may start HTML that runs past a blank line, such
 * as `<!--` or `<pre`, wherever it stands. No line from the last blank line
 * above the marker may hold a `<`, as HTML there runs on to the next blank
 * line. No line above it may open an empty container, as
 * `opensEmptyContainer` reads one. And no line above it may be shaped like a
 * fence, wherever it stands, as the structural reading can end a fence where
 * CommonMark keeps it open. An item on the first line of a text that starts
 * with a byte order mark is not read either: CommonMark reads the mark as
 * text there.
 *
 * Each line after a marker is read by one item at most, so the time taken
 * grows with the text, not with the number of items.
 *
 * @param text The whole document, read as Markdown.
 * @param parsed What `structure` gave for the same text.
 * @param tally When given, its `lines` grows by one for each line read after
 *     a marker line, so a test can count the work.
 * @returns One finding on the marker line of each such item, in document
 *     order, naming how many paragraphs it holds. Empty when none.
 */
export function bulletParagraphViolations(text: string, parsed: Pick<ReturnType<typeof structure>, "items">, tally?: { lines: number }): Violation[] {
  const lines = toLines(text);
  const guards = readGuards(text, lines);
  const findings: Violation[] = [];
  let previous = -1;
  for (const item of parsed.items) {
    const index = item.line - 1;
    // Items nested on one line share it; the line is read once.
    if (index === previous) continue;
    previous = index;
    if (!guards.clearAbove(index)) continue;
    const paragraphs = paragraphsOf(lines, index, tally);
    if (paragraphs >= 2) {
      findings.push({
        rule: "bullet-paragraphs", line: item.line,
        detail: `This bulleted item holds ${paragraphs} paragraphs. Make it one paragraph on one idea, or promote it to a subsection.`,
      });
    }
  }
  return findings;
}

/** What the guards need to know of the whole text, read in one pass. */
interface Guards {
  /** Whether no guard stops the item whose marker stands at this index. */
  clearAbove(index: number): boolean;
}

/**
 * Reads the text once for the guards. An item at index `m` is clear when the
 * first line that starts HTML running past a blank line, the first line that
 * opens an empty container and the first line shaped like a fence each stand
 * at or below `m`, and no line holds a `<` between the last blank line above
 * `m` and `m`. An item at index 0 is not clear when the text starts with a
 * byte order mark.
 */
function readGuards(text: string, lines: readonly string[]): Guards {
  let firstLongHtml = Number.POSITIVE_INFINITY;
  let firstEmpty = Number.POSITIVE_INFINITY;
  let firstFence = Number.POSITIVE_INFINITY;
  // For each index, whether a `<` stands on a line after the last blank line
  // at or above it.
  const angleSinceBlank = new Uint8Array(lines.length);
  let angle = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (firstLongHtml === Number.POSITIVE_INFINITY && LONG_HTML.test(line)) firstLongHtml = index;
    if (firstEmpty === Number.POSITIVE_INFINITY && opensEmptyContainer(line)) firstEmpty = index;
    if (firstFence === Number.POSITIVE_INFINITY && shapedLikeFence(line)) firstFence = index;
    if (BLANK.test(line)) {
      angle = false;
    } else if (line.includes("<")) {
      angle = true;
    }
    angleSinceBlank[index] = angle ? 1 : 0;
  }
  const markedFirst = text.charCodeAt(0) === BYTE_ORDER_MARK;
  return {
    clearAbove: (index: number) => index <= firstLongHtml && index <= firstEmpty && index <= firstFence
      && (index === 0 ? !markedFirst : angleSinceBlank[index - 1] === 0),
  };
}

/**
 * Whether a line may open a fence: three backticks or tildes after any
 * spaces, tabs, `>`, `-`, `*`, `+` and digits followed by `.` or `)`, in any
 * order. A loop rather than a pattern, so a long line of markers is read
 * once, quickly.
 */
function shapedLikeFence(line: string): boolean {
  let index = 0;
  while (index < line.length) {
    const character = line.charAt(index);
    if (" \t>-*+".includes(character)) {
      index++;
    } else if (character >= "0" && character <= "9") {
      let end = index;
      while (end < line.length && line.charAt(end) >= "0" && line.charAt(end) <= "9") {
        end++;
      }
      if (line.charAt(end) !== "." && line.charAt(end) !== ")") return false;
      index = end + 1;
    } else {
      break;
    }
  }
  return line.startsWith("```", index) || line.startsWith("~~~", index);
}

/**
 * How many paragraphs the item whose marker stands at this index holds, or
 * 0 when the rule cannot read it with confidence or it holds anything but
 * paragraphs.
 */
function paragraphsOf(lines: readonly string[], index: number, tally?: { lines: number }): number {
  const [, spaces, , gap, first] = MARKER_LINE.exec(lines[index] ?? "") ?? [];
  if (spaces === undefined || gap === undefined || first === undefined || gap.length > 4) return 0;
  if (LONG_HTML.test(first) || !isPlainText(first)) return 0;
  const indent = spaces.length;
  const column = indent + 1 + gap.length;
  const paragraphs: string[][] = [[first]];
  let afterBlank = false;
  for (let row = index + 1; row < lines.length; row++) {
    if (tally !== undefined) tally.lines++;
    const line = lines[row] ?? "";
    if (BLANK.test(line)) {
      afterBlank = true;
      continue;
    }
    const leading = LEADING.exec(line)?.[0] ?? "";
    if (leading.includes("\t")) return 0;
    if (leading.length < column) {
      if (afterBlank || nextBullet(line, indent)) break;
      return 0;
    }
    const content = line.slice(column);
    if (leading.length >= column + 4 || LONG_HTML.test(line) || !isPlainText(content)) return 0;
    if (afterBlank) {
      paragraphs.push([content]);
    } else {
      paragraphs[paragraphs.length - 1]?.push(content);
    }
    afterBlank = false;
  }
  for (const paragraph of paragraphs) {
    if (isOneCodeSpan(paragraph)) return 0;
  }
  return paragraphs.length;
}

/**
 * Whether a line of an item's text, past its column, is plain text that
 * carries a paragraph: it starts no other block, is no underline, thematic
 * break or delimiter row, and holds no `]:` that may end a link definition's
 * label.
 */
function isPlainText(content: string): boolean {
  const start = content.replace(/^ {0,3}/, "");
  if (BLOCK_START.test(start) || EQUALS_ROW.test(start) || STAR_OR_UNDERSCORE_BREAK.test(start)) return false;
  if (start.includes("-") && DASH_ROW.test(start)) return false;
  return !content.includes("]:");
}

/** Whether a line is a bullet with text at this indent, which ends the item above as the next item. */
function nextBullet(line: string, indent: number): boolean {
  const [, spaces] = MARKER_LINE.exec(line) ?? [];
  return spaces !== undefined && spaces.length === indent && !STAR_OR_UNDERSCORE_BREAK.test(line.trim()) && !DASH_ROW.test(line);
}

/** Whether a paragraph's text, its lines joined and its ends trimmed, is one code span and nothing else. */
function isOneCodeSpan(paragraph: readonly string[]): boolean {
  const joined = paragraph.map(line => line.replace(/^ +/, "")).join("\n").replace(/ +$/, "");
  return joined.startsWith("`") && codeSpanEnds(joined).get(0) === joined.length;
}
