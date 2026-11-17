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
 * What can follow an alert's marker line and stop it being plain text in the
 * alert: an underline that would make the marker a heading, a thematic
 * break, a row of dashes, colons and pipes that would make it a table
 * header, or HTML, which may show nothing.
 */
const NOT_TEXT = /^(?:[-:| \t]*-[-:| \t]*|([*_])(?:[ \t]*\1){2,}|=+[ \t]*)$|^</;
/**
 * The HTML blocks that run on over blank lines, as CommonMark has them, that
 * the structural reading can leave unread, each with what ends it. One is
 * opened by `<pre`, `<script`, `<style` or `<textarea`, which the reading
 * misses when the tag name ends its line. The other is a CDATA section. The
 * reading hides comments, processing instructions and declarations itself.
 */
const RAW_HTML: ReadonlyArray<{ open: RegExp; close: RegExp }> = [
  { open: /^ {0,3}<(?:pre|script|style|textarea)(?:[ \t>]|$)/i, close: /<\/(?:pre|script|style|textarea)>/i },
  { open: /^ {0,3}<!\[CDATA\[/, close: /\]\]>/ },
];

/**
 * The `adjacent-alerts` findings: each GitHub alert that follows an alert of
 * the same kind with only blank lines between.
 *
 * It reports only an alert it is sure of, and reads anything else as no
 * alert. An alert here is a quotation outside every list and quotation whose
 * first line is the marker alone, such as `> [!NOTE]`, in any letter case.
 * It also needs a blank line or the start of the text above it, a next line
 * in the quotation that holds text, a first paragraph that is no heading,
 * no link definition of its marker anywhere in the text, and no HTML block
 * from an earlier line still open around it.
 *
 * @param text The whole document, read as Markdown.
 * @param parsed What `structure` gave for the same text.
 * @returns One finding on the marker line of each such later alert, in
 *     document order, its detail naming the earlier alert's line. Three in a
 *     row give two. Empty when none, as for empty text.
 */
export function adjacentAlertViolations(text: string, parsed: Pick<ReturnType<typeof structure>, "quotations" | "allHeadings">): Violation[] {
  const lines = toLines(text);
  const defined = new Set<string>();
  for (const match of text.matchAll(DEFINED_MARKER)) {
    defined.add((match[1] ?? "").toUpperCase());
  }
  const underlined = new Set<number>();
  for (const heading of parsed.allHeadings) {
    if (heading.setext) underlined.add(heading.line);
  }
  const reading: AlertReading = { lines, defined, underlined, insideHtml: linesInsideHtml(lines) };
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
  /** The first line, counted from 1, of each heading underlined on the line below it. */
  underlined: ReadonlySet<number>;
  /** For each line, counted from 0, whether an HTML block opened on an earlier line holds it. */
  insideHtml: Uint8Array;
}

/**
 * Whether a quotation is an alert this rule is sure of: it names a kind, the
 * text defines no link label of that marker, no HTML block from an earlier
 * line holds it, a blank line or the start of the text stands above it, its
 * next line is in the quotation and holds text, and that text does not
 * become a heading.
 */
function readableAlert(reading: AlertReading, quotation: Quotation): boolean {
  if (quotation.alert === null || reading.defined.has(quotation.alert) || reading.insideHtml[quotation.line - 1] === 1) return false;
  const above = reading.lines[quotation.line - 2];
  if (above !== undefined && !BLANK.test(above)) return false;
  const next = reading.lines[quotation.line] ?? "";
  const marker = QUOTE_MARKER.exec(next);
  if (marker === null) return false;
  const rest = next.slice(marker[0].length).trim();
  return rest !== "" && !NOT_TEXT.test(rest) && !reading.underlined.has(quotation.line + 1);
}

/**
 * Which lines an HTML block that runs over blank lines holds, after the line
 * it opens on. A block opens on a line that starts with one, up to three
 * spaces in, and ends on the first line, its own included, that holds what
 * ends it, or at the end of the text. It reads every line as it stands, so
 * an opening in code or a quotation counts too, and some alerts that render
 * are not read.
 *
 * @returns One entry for each line, 1 where such a block holds it.
 */
function linesInsideHtml(lines: readonly string[]): Uint8Array {
  const inside = new Uint8Array(lines.length);
  let close: RegExp | null = null;
  for (const [index, line] of lines.entries()) {
    if (close !== null) {
      inside[index] = 1;
      if (close.test(line)) close = null;
      continue;
    }
    const block = RAW_HTML.find(candidate => candidate.open.test(line));
    if (block !== undefined && !block.close.test(line.replace(block.open, ""))) close = block.close;
  }
  return inside;
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
