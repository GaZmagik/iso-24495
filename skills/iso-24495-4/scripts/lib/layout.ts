import { markdownLinks, normaliseReference, structure, toLines, type Heading, type Reading } from "./parse.ts";
import type { Violation } from "./types.ts";
import { renderInline } from "./inline-wording.ts";

const SECTION_LIMIT = 6;
const CONTENTS_LABEL = /^(?:contents|table of contents|toc|key sections)$/i;
const OVERVIEW_LABEL = /^(?:overview|summary)$/i;
const VERSION = /^(?:Version|Revision)\s*:?\s*v?\d+(?:\.\d+)+(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/i;
const DATE_FIELD = /^(?:Date|Updated|Last updated|Reviewed)\s*:?\s*(.+)$/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export interface LayoutOptions extends Reading { fileName?: string }

/**
 * The layout findings for one Markdown text: `opening-version-date`,
 * `bullet-depth`, `contents-list` and `overview-label`.
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
  for (const item of parsed.items) if (item.depth > 2) findings.push({ rule: "bullet-depth", line: item.line, detail: `Unordered bullet depth ${item.depth} (limit 2). Flatten this item.` });
  const sections = parsed.headings.filter(heading => heading.level === 2);
  if (sections.length < SECTION_LIMIT) return findings;
  findings.push(...contentsFindings(parsed, sections, end));
  const firstContent = sections.find(heading => !CONTENTS_LABEL.test(label(heading.text)) && !OVERVIEW_LABEL.test(label(heading.text)));
  const overview = parsed.headings.some(heading => OVERVIEW_LABEL.test(label(heading.text)) && (firstContent === undefined || heading.line < firstContent.line));
  if (!overview) findings.push({ rule: "overview-label", line: start, detail: "Add an Overview or Summary heading before the first content section." });
  return findings;
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
    while (used.has(id)) { suffix++; id = `${base}-${suffix}`; }
    used.add(id);
    return id;
  });
}

function label(text: string): string { return normaliseWording(text).replace(/^\d+(?:\.\d+)*\.?\s+/, ""); }
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
  } catch { return false; }
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
  if (numeric !== null) return calendarDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]))
    || calendarDate(Number(numeric[3]), Number(numeric[1]), Number(numeric[2]));
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
    for (let index = heading.line - 1 + heading.lines + (heading.setext ? 1 : 0); index < (next?.line ?? parsed.lines.length + 1) - 1; index++) labelled.add(index);
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
      try { fragment = decodeURIComponent(destination.slice(1)); } catch { continue; }
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
  for (const link of navigation) if (link.heading?.level === 2 && sections.includes(link.heading) && normaliseWording(link.label) !== normaliseWording(link.heading.text)) findings.push({ rule: "contents-list", line: link.line, detail: "Use the target section's exact wording in this navigation link." });
  if (!labelledEntries && navigation.length === 0) findings.unshift({ rule: "contents-list", line: 1, detail: "Add contents or navigation for six or more root H2 sections." });
  return findings;
}
