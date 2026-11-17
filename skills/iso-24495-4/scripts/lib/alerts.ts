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
 * break, or HTML, which may show nothing.
 */
const NOT_TEXT = /^(?:=+|-+|([-*_])(?:[ \t]*\1){2,})[ \t]*$|^</;

/**
 * The `adjacent-alerts` findings: each GitHub alert that follows an alert of
 * the same kind with only blank lines between.
 *
 * It reports only an alert it is sure of, and reads anything else as no
 * alert. An alert here is a quotation outside every list and quotation whose
 * first line is the marker alone, such as `> [!NOTE]`, in any letter case.
 * It also needs a blank line or the start of the text above it, a next line
 * in the quotation that holds text, and no link definition of its marker
 * anywhere in the text.
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
  const findings: Violation[] = [];
  let previous: Quotation | null = null;
  for (const quotation of parsed.quotations) {
    const earlier = previous;
    previous = readableAlert(lines, quotation, defined) ? quotation : null;
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

/**
 * Whether a quotation is an alert this rule is sure of: it names a kind, the
 * text defines no link label of that marker, a blank line or the start of
 * the text stands above it, and its next line is in the quotation and holds
 * text.
 */
function readableAlert(lines: readonly string[], quotation: Quotation, defined: ReadonlySet<string>): boolean {
  if (quotation.alert === null || defined.has(quotation.alert)) return false;
  const above = lines[quotation.line - 2];
  if (above !== undefined && !BLANK.test(above)) return false;
  const next = lines[quotation.line] ?? "";
  const marker = QUOTE_MARKER.exec(next);
  if (marker === null) return false;
  const rest = next.slice(marker[0].length).trim();
  return rest !== "" && !NOT_TEXT.test(rest);
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
