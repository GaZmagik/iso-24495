import { markdownLinks, normaliseReference, structure, toLines, type Heading, type Reading } from "./parse.ts";
import type { Violation } from "./types.ts";
import { renderInline } from "./inline-wording.ts";
import { adjacentAlertViolations } from "./alerts.ts";
import { bulletParagraphViolations } from "./bullets.ts";

const SECTION_LIMIT = 6;
const CONTENTS_LABEL = /^(?:contents|table of contents|toc|key sections)$/i;
const OVERVIEW_LABEL = /^(?:overview|summary)$/i;
const VERSION = /^(?:Version|Revision)\s*:?\s*v?\d+(?:\.\d+)+(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/i;
const DATE_FIELD = /^(?:Date|Updated|Last updated|Reviewed)\s*:?\s*(.+)$/i;
/**
 * The wordings of a heading that promises to send the reader elsewhere, after
 * `signpostWording`. Part 5 names related documents, other language versions
 * and a person to ask. "References" lists sources, and "Next steps" carries on
 * with this document, so neither is here.
 */
const SIGNPOST_LABELS: ReadonlySet<string> = new Set([
  "related", "related documents", "related links", "related pages", "related reading", "related resources", "related topics",
  "see also", "resources", "additional resources", "further reading", "other languages", "external links", "useful links", "links",
]);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/**
 * What `layoutViolations` may be told besides the text. `fileName` exempts
 * a file such as a README from the edition advisory.
 */
export interface LayoutOptions extends Reading { fileName?: string }

/**
 * The layout findings for one Markdown text: `opening-version-date`,
 * `bullet-depth`, `bullet-paragraphs`, `empty-signpost`, `adjacent-alerts`,
 * `contents-list` and `overview-label`.
 *
 * The contents and overview rules apply only to a document with six or more
 * level-2 headings outside any list or quotation. The edition advisory
 * applies only to a document with a level-1 title.
 *
 * @param text The whole document. It is read as Markdown whatever it holds,
 *     so the caller decides whether a file is Markdown.
 * @param reading `fileName` exempts README, CONTRIBUTING, SECURITY and
 *     PULL_REQUEST_TEMPLATE files from the edition advisory, by the last part
 *     of the path and in any letter case. `frontMatter` set to false switches
 *     that advisory off and reads a leading "---" block as text.
 * @returns The findings, with each `line` counted from 1. They are not sorted
 *     by line. Empty when no rule fires, as for empty text.
 */
export function layoutViolations(text: string, reading: LayoutOptions = {}): Violation[] {
  const parsed = structure(text, reading);
  const findings: Violation[] = [];
  const title = parsed.headings.find(heading => heading.level === 1);
  const next = parsed.headings.find(heading => title === undefined || heading.line > title.line);
  const end = title === undefined ? next?.line ?? parsed.lines.length + 1 : next?.line ?? parsed.lines.length + 1;
  const start = title?.line ?? 1;
  const opening = parsed.lines.slice(start - 1, end - 1);
  const titleSuffix = title === undefined ? undefined : /\(([^()]*)\)\s*$/.exec(normaliseWording(title.text))?.[1];
  const fields = opening.flatMap((line, offset) => {
    const normal = normaliseWording(line);
    const [field, value] = parsed.tableRows.get(start - 1 + offset)?.map(normaliseWording) ?? [];
    return [normal, ...(field !== undefined && value !== undefined ? [`${field.replace(/:$/, "")} ${value}`] : []), ...markdownLinks(line).filter(link => link.image).map(link => normaliseWording(link.label))];
  });
  const fileName = reading.fileName?.split(/[\\/]/).at(-1) ?? "";
  const exempt = /^(?:README|CONTRIBUTING|SECURITY|PULL_REQUEST_TEMPLATE)(?:\..*)?$/i.test(fileName);
  if (title !== undefined && !exempt && reading.frontMatter !== false && !recognisedFrontMatter(text)
    && !fields.some(isDocumentField) && !isDocumentField(titleSuffix ?? "")) {
    findings.push({ rule: "opening-version-date", line: start, detail: "No version or date was recognised in the opening. Would readers need one to identify the edition or judge how current it is?" });
  }
  for (const item of parsed.items) {
    if (item.depth > 2) findings.push({ rule: "bullet-depth", line: item.line, detail: `Unordered bullet depth ${item.depth} (limit 2). Flatten this item.` });
  }
  // Before the section count below, which returns early for a short document.
  for (const finding of emptySignpostViolations(text, parsed)) {
    findings.push(finding);
  }
  for (const finding of adjacentAlertViolations(text, parsed)) {
    findings.push(finding);
  }
  for (const finding of bulletParagraphViolations(text, parsed)) {
    findings.push(finding);
  }
  const sections = parsed.headings.filter(heading => heading.level === 2);
  if (sections.length < SECTION_LIMIT) return findings;
  // One finding for each contents link, too many to spread into one call.
  for (const finding of contentsFindings(parsed, sections, end)) {
    findings.push(finding);
  }
  const firstContent = sections.find(heading => !CONTENTS_LABEL.test(label(heading.text)) && !OVERVIEW_LABEL.test(label(heading.text)));
  const overview = parsed.headings.some(heading => OVERVIEW_LABEL.test(label(heading.text)) && (firstContent === undefined || heading.line < firstContent.line));
  if (!overview) findings.push({ rule: "overview-label", line: start, detail: "Add an Overview or Summary heading before the first content section." });
  return findings;
}

/**
 * The `empty-signpost` findings: each heading that promises a referral and
 * has nothing beneath it.
 *
 * A heading is read when it sits outside every list and quotation and its
 * whole wording, after `signpostWording`, is one of the signpost labels, such
 * as "See also", "Related" or "Resources". Its section runs to the next such
 * heading at its level or above, or to the end of the text.
 *
 * It reports a section only when it can tell that nothing in it shows, and
 * counts every other form as content. So a form it does not know can cost a
 * finding but never gives a false one. The section is empty when each
 * stretch in it passes `stretchShowsNothing` and no deeper heading in it
 * holds a link or an image.
 *
 * @param text The whole document, as `layoutViolations` was given it.
 * @param parsed The structural reading of that text, as `structure` gives it.
 * @returns One finding for each empty signpost, on the line its heading
 *     starts, in document order. Empty when there is none.
 */
export function emptySignpostViolations(text: string, parsed: Pick<ReturnType<typeof structure>, "headings" | "markupLines" | "code">): Violation[] {
  const { headings } = parsed;
  const lines = toLines(text);
  const codeStarts = new Set(parsed.code.map(block => block.line));
  // Each stretch between one heading and the next is read at most once, and
  // only when a signpost's section reaches it: 0 not yet read, 1 shows
  // something, 2 shows nothing.
  const read = new Int8Array(headings.length);
  // Where each heading's section ends: the position of the next heading at
  // its level or above. Each heading enters and leaves the stack once.
  const sectionEnd = new Int32Array(headings.length).fill(headings.length);
  const open: number[] = [];
  headings.forEach((heading, position) => {
    while (open.length > 0 && (headings[open[open.length - 1] ?? 0]?.level ?? 0) >= heading.level) {
      sectionEnd[open.pop() ?? 0] = position;
    }
    open.push(position);
  });
  const findings: Violation[] = [];
  headings.forEach((heading, position) => {
    if (!SIGNPOST_LABELS.has(signpostWording(heading.text))) return;
    // A stretch sits in the sections of at most six headings, one at each
    // level, so no stretch or heading is read more than six times.
    for (let stretch = position; stretch < (sectionEnd[position] ?? headings.length); stretch++) {
      if (stretch > position && headingNamesDestination(lines, headings[stretch])) return;
      if (read[stretch] === 0) read[stretch] = stretchShowsNothing(lines, parsed.markupLines, codeStarts, headings, stretch) ? 2 : 1;
      if (read[stretch] === 1) return;
    }
    findings.push({
      rule: "empty-signpost", line: heading.line,
      detail: `The "${normaliseWording(heading.text)}" heading has nothing beneath it. List where else to go beneath it, or remove the heading when nothing else exists.`,
    });
  });
  return findings;
}

/**
 * Text a deeper heading's own lines hold when it may link somewhere: a
 * bracket for a link, an image or a footnote, an angle bracket for HTML or
 * an autolink, an address, or a web address with no brackets around it.
 */
const DESTINATION_MARK = /[[\]<>@]|:\/\/|www\./i;

/**
 * Whether a heading's own lines may hold a link or an image, which names
 * somewhere to go. The structural reading's wording has lost link syntax, so
 * the source lines are read instead, without a setext heading's underline.
 */
function headingNamesDestination(lines: readonly string[], heading: Heading | undefined): boolean {
  if (heading === undefined) return true;
  return lines.slice(heading.line - 1, heading.line - 1 + heading.lines).some(line => DESTINATION_MARK.test(line));
}

/** A line the parser reads as blank: spaces and tabs only. */
const BLANK = /^[ \t]*$/;
/** The start of an HTML comment block, as CommonMark has it. */
const COMMENT_OPEN = /^ {0,3}<!--/;
/** A thematic break, which a reader sees as a rule and nothing more. The parser's own pattern is not exported. */
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** The quotation markers at the start of a line, each with its optional space. */
const QUOTE_MARKERS = /^(?: {0,3}> ?)+/;
/**
 * A character a reader can see: anything but white space, a control or format
 * character, a character Unicode says to show as nothing, such as a zero-width
 * space or a Hangul filler, or the blank braille pattern.
 */
const VISIBLE = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u;

/**
 * Whether the lines between one heading and the next show a reader nothing.
 * A setext heading's underline is part of the heading, not of the stretch.
 *
 * Each line must be one of these, and the structural reading must agree:
 *
 * - blank, with spaces and tabs only;
 * - an HTML comment block, as `commentLine` reads it, which the structural
 *   reading has blanked;
 * - a link definition, which the structural reading has blanked and which
 *   starts with a bracket;
 * - a thematic break, after any quotation markers, which the structural
 *   reading has left as written, unless a link definition is straight above;
 * - text with no `VISIBLE` character and no NUL, left as written. A renderer
 *   shows NUL as a replacement character.
 *
 * Any code block counts, so does a comment still open at the next heading,
 * because then the structural reading and this one disagree. One still open
 * at the end of the text runs to its end, as CommonMark has it.
 *
 * @param position Which heading the stretch follows, counted from 0.
 */
function stretchShowsNothing(
  lines: readonly string[], markupLines: readonly string[], codeStarts: ReadonlySet<number>, headings: readonly Heading[], position: number,
): boolean {
  const heading = headings[position];
  if (heading === undefined) return false;
  const next = headings[position + 1];
  const start = heading.line - 1 + heading.lines + (heading.setext ? 1 : 0);
  const end = next === undefined ? lines.length : next.line - 1;
  let inComment = false;
  // Whether the line above was a link definition. A renderer can read dashes
  // straight below one as text, so they count.
  let belowDefinition = false;
  for (let index = start; index < end; index++) {
    if (codeStarts.has(index + 1)) return false;
    const source = lines[index] ?? "";
    const markup = markupLines[index] ?? "";
    const definitionAbove = belowDefinition;
    belowDefinition = false;
    if (inComment || COMMENT_OPEN.test(source)) {
      const after = commentLine(source, inComment);
      if (after === null || !BLANK.test(markup)) return false;
      inComment = after.open;
      continue;
    }
    if (BLANK.test(source)) continue;
    if (BLANK.test(markup) && /^ {0,3}\[/.test(source)) {
      belowDefinition = true;
      continue;
    }
    if (markup !== source) return false;
    if (!definitionAbove && THEMATIC_BREAK.test(source.replace(QUOTE_MARKERS, ""))) continue;
    if (!VISIBLE.test(source) && !source.includes("\u0000")) continue;
    return false;
  }
  return !inComment || next === undefined;
}

/**
 * How one line of an HTML comment block reads. A comment ends at the first
 * `-->`, and the line it ends on must hold nothing after it.
 *
 * @param open Whether a comment is open where the line starts. When it is
 *     not, the line starts one.
 * @returns Whether a comment is still open where the line ends. Null when
 *     anything on the line could show: text or a second comment after the
 *     end, or a comment a browser ends early, at `--!>` or at `<!-->`.
 */
function commentLine(source: string, open: boolean): { open: boolean } | null {
  let from = 0;
  if (!open) {
    from = COMMENT_OPEN.exec(source)?.[0].length ?? 0;
    if (source.startsWith(">", from) || source.startsWith("->", from)) return null;
  }
  const close = source.indexOf("-->", from);
  if (source.slice(from, close === -1 ? source.length : close).includes("--!>")) return null;
  if (close === -1) return { open: true };
  return BLANK.test(source.slice(close + 3)) ? { open: false } : null;
}

/**
 * A heading's wording in the form the signpost labels are written in.
 *
 * @returns The wording as `label` gives it, with any run of characters that
 *     are neither letters nor numbers removed from each end, each run of
 *     white space made one space, and every letter in lower case.
 */
function signpostWording(text: string): string {
  return label(text).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/\s+/g, " ").toLowerCase();
}

/**
 * Render inline wording for comparison while retaining case, punctuation and numbering.
 *
 * @returns The wording as `renderInline` gives it, with each run of white
 *     space made one space and none at either end. Empty for blank text.
 */
export function normaliseWording(text: string): string {
  return renderInline(text).replace(/\s+/g, " ").trim();
}

/**
 * The fragment identifier that a link uses to reach each heading.
 *
 * @param wordings The text of every heading in the document, in document
 *     order. An identifier that was already given takes the suffix -1, then
 *     -2, so a list that leaves headings out gives the later repeats the
 *     wrong identifier.
 * @returns One identifier for each wording, in the same order. The wording
 *     is rendered as `normaliseWording` renders it and put in lower case.
 *     Every character is then removed unless it is a letter, a number, a
 *     combining mark, a space, a hyphen or an underscore, and each space
 *     that is left becomes a hyphen. A wording of hyphens or underscores
 *     alone is therefore kept whole: "---" gives "---". Only a wording that
 *     holds none of the kept characters, such as "!!!", gives an empty
 *     identifier, and a second such wording gives "-1". Empty for an empty
 *     list.
 */
export function headingIds(wordings: readonly string[]): string[] {
  const used = new Set<string>();
  return wordings.map(wording => {
    const base = normaliseWording(wording).toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, "").replace(/ /g, "-");
    let id = base;
    let suffix = 0;
    while (used.has(id)) {
      suffix++;
      id = `${base}-${suffix}`;
    }
    used.add(id);
    return id;
  });
}

function label(text: string): string {
  return normaliseWording(text).replace(/^\d+(?:\.\d+)*\.?\s+/, "");
}
function recognisedFrontMatter(text: string): boolean {
  const lines = toLines(text);
  // This rule validates YAML itself. Keep the calibrated extraction guard
  // separate: its conservative line shapes exclude valid tabs and flow maps.
  if (!/^---[ \t]*$/.test(lines[0] ?? "")) return false;
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line));
  if (end === -1) return false;
  const source = lines.slice(1, end).join("\n");
  let metadata: unknown;
  try {
    metadata = Bun.YAML.parse(source);
  } catch {
    return false;
  }
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return false;
  return declaredEditionFields(metadata) || declaredEditionFields((metadata as Record<string, unknown>).metadata);
}
function declaredEditionFields(metadata: unknown): boolean {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return false;
  return Object.entries(metadata).some(([key, value]) => {
    if (!/^(?:version|date|updated|last_updated)$/i.test(key)) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (typeof value === "number") return Number.isFinite(value);
    return value instanceof Date;
  });
}
function isDocumentField(text: string): boolean {
  if (VERSION.test(text)) return true;
  const [, date] = DATE_FIELD.exec(text) ?? [];
  return date !== undefined && validDate(date);
}
function validDate(text: string): boolean {
  const quarter = /^Q([1-4])\s+\d{4}$/i.exec(text);
  if (quarter !== null) return true;
  const monthYear = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (monthYear !== null) return Number(monthYear[1]) >= 1 && Number(monthYear[1]) <= 12;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso !== null) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (numeric !== null) {
    return calendarDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]))
      || calendarDate(Number(numeric[3]), Number(numeric[1]), Number(numeric[2]));
  }
  const parts = text.toLowerCase().replace(/[,-]/g, " ").split(/\s+/);
  const month = MONTHS.findIndex(name => parts.includes(name) || parts.includes(name.slice(0, 3)));
  if (month < 0) return false;
  const [first, second, third] = parts;
  if (first === undefined || second === undefined) return false;
  if (third === undefined) return /^\d{4}$/.test(second);
  if (parts.length !== 3 || !/^\d{4}$/.test(third)) return false;
  const day = /^\d{1,2}$/.test(first) ? first : second;
  return /^\d{1,2}$/.test(day) && calendarDate(Number(third), month + 1, Number(day));
}
function calendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function contentsFindings(parsed: ReturnType<typeof structure>, sections: readonly Heading[], openingEnd: number): Violation[] {
  const ids = headingIds(parsed.allHeadings.map(heading => heading.text));
  const targets = new Map(parsed.allHeadings.map((heading, index) => [ids[index], heading]));
  const labelled = new Set<number>();
  for (const heading of parsed.headings.filter(heading => CONTENTS_LABEL.test(label(heading.text)))) {
    const next = parsed.headings.find(candidate => candidate.line > heading.line && candidate.level <= heading.level);
    for (let index = heading.line - 1 + heading.lines + (heading.setext ? 1 : 0); index < (next?.line ?? parsed.lines.length + 1) - 1; index++) {
      labelled.add(index);
    }
  }
  const findings: Violation[] = [];
  let labelledEntries = false;
  const openingLinks: Array<{ line: number; label: string; heading: Heading | undefined; block: number }> = [];
  const navigationParagraphs = new Map<number, boolean>();
  for (const [index, source] of parsed.markupLines.entries()) {
    const block = parsed.blocks.get(index);
    if (block?.kind !== "paragraph") continue;
    const links = markdownLinks(source).filter(link => !link.image && link.rendered);
    let residual = source;
    for (const link of [...links].reverse()) {
      residual = residual.slice(0, link.start) + residual.slice(link.end);
    }
    const navigation = /^[\s,;|/]*$/.test(residual);
    navigationParagraphs.set(block.id, (navigationParagraphs.get(block.id) ?? true) && navigation);
  }
  for (const [index, line] of parsed.markupLines.entries()) {
    const block = parsed.blocks.get(index);
    if (block === undefined || !block.data || !parsed.navigationLines.has(index)) continue;
    if (block.kind === "paragraph" && !navigationParagraphs.get(block.id)) continue;
    if (labelled.has(index) && block.kind !== "paragraph" && normaliseWording(line).replace(/[|\s:-]/g, "") !== "") labelledEntries = true;
    for (const link of markdownLinks(line).filter(link => !link.image && link.rendered)) {
      const destination = link.kind === "inline" ? link.target.trim().replace(/^<|>$/g, "") : parsed.destinations.get(normaliseReference(link.target || link.label));
      if (destination === undefined || !destination.startsWith("#")) continue;
      let fragment: string;
      try {
        fragment = decodeURIComponent(destination.slice(1));
      } catch {
        continue;
      }
      const heading = targets.get(fragment);
      if (labelled.has(index)) {
        labelledEntries = true;
        if (heading?.level === 2 && sections.includes(heading) && normaliseWording(link.label) !== normaliseWording(heading.text)) findings.push({ rule: "contents-list", line: index + 1, detail: "Use the target section's exact wording in this contents link." });
      } else if (index < openingEnd - 1) openingLinks.push({ line: index + 1, label: link.label, heading, block: block.id });
    }
  }
  // Loose list items share a parser block even where blank lines separate them.
  const groups = new Map<number, typeof openingLinks>();
  for (const link of openingLinks) {
    groups.set(link.block, [...(groups.get(link.block) ?? []), link]);
  }
  const navigation = [...groups.values()].filter(group => group.length >= 2).flat();
  for (const link of navigation) {
    if (link.heading?.level === 2 && sections.includes(link.heading) && normaliseWording(link.label) !== normaliseWording(link.heading.text)) findings.push({ rule: "contents-list", line: link.line, detail: "Use the target section's exact wording in this navigation link." });
  }
  if (!labelledEntries && navigation.length === 0) findings.unshift({ rule: "contents-list", line: 1, detail: "Add contents or navigation for six or more root H2 sections." });
  return findings;
}
