import { inlineText, markdownLinks, normaliseReference, structure, type Heading, type Reading } from "./parse.ts";
import type { Violation } from "./types.ts";
import entities from "./html-entities.json";

const SECTION_LIMIT = 6;
const CONTENTS_LABEL = /^(?:contents|table of contents|toc|key sections)$/i;
const OVERVIEW_LABEL = /^(?:overview|summary)$/i;
const VERSION = /^(?:Version|Revision)\s*:?\s*v?\d+(?:\.\d+)+(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/i;
const DATE_FIELD = /^(?:Date|Updated|Last updated|Reviewed)\s*:?\s*(.+)$/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function layoutViolations(text: string, reading: Reading = {}): Violation[] {
  const parsed = structure(text, reading);
  const findings: Violation[] = [];
  const title = parsed.headings.find(heading => heading.level === 1);
  const next = parsed.headings.find(heading => title === undefined || heading.line > title.line);
  const end = title === undefined ? next?.line ?? parsed.lines.length + 1 : next?.line ?? parsed.lines.length + 1;
  const start = title?.line ?? 1;
  const opening = parsed.lines.slice(start - 1, end - 1);
  const titleSuffix = title === undefined ? undefined : /\(([^()]*)\)\s*$/.exec(normaliseWording(title.text))?.[1];
  const fields = opening.flatMap(line => {
    const normal = normaliseWording(line);
    const cells = normal.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(cell => cell.trim());
    return [normal, ...(cells.length >= 2 ? [`${cells[0].replace(/:$/, "")} ${cells[1]}`] : []), ...markdownLinks(line).filter(link => link.image).map(link => normaliseWording(link.label))];
  });
  if (!fields.some(isDocumentField) && !isDocumentField(titleSuffix ?? "")) findings.push({ rule: "opening-version-date", line: start, detail: "Add a document-labelled version or valid date in the opening." });
  for (const item of parsed.items) if (item.depth > 2) findings.push({ rule: "bullet-depth", line: item.line, detail: `Unordered bullet depth ${item.depth} (limit 2). Flatten this item.` });
  const sections = parsed.headings.filter(heading => heading.level === 2);
  if (sections.length < SECTION_LIMIT) return findings;
  findings.push(...contentsFindings(parsed, sections, end));
  const firstContent = sections.find(heading => !CONTENTS_LABEL.test(label(heading.text)) && !OVERVIEW_LABEL.test(label(heading.text)));
  const overview = parsed.headings.some(heading => OVERVIEW_LABEL.test(label(heading.text)) && (firstContent === undefined || heading.line < firstContent.line));
  if (!overview) findings.push({ rule: "overview-label", line: start, detail: "Add an Overview or Summary heading before the first content section." });
  return findings;
}

/** Render inline wording for comparison while retaining case, punctuation and numbering. */
export function normaliseWording(text: string): string {
  const rendered = inlineText(text).replace(/(`+)(.*?)\1/g, "$2").replace(/(\*{1,3}|_{1,3})(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, "$1");
  return rendered.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (whole, name: string) => {
    if (!name.startsWith("#")) return (entities as Record<string, string>)[`${name};`] ?? whole;
    const point = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff) ? "\ufffd" : String.fromCodePoint(point);
  }).replace(/\s+/g, " ").trim();
}

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
function isDocumentField(text: string): boolean {
  if (VERSION.test(text)) return true;
  const date = DATE_FIELD.exec(text);
  return date !== null && validDate(date[1]);
}
function validDate(text: string): boolean {
  const quarter = /^Q([1-4])\s+\d{4}$/i.exec(text);
  if (quarter !== null) return true;
  const monthYear = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (monthYear !== null) return Number(monthYear[1]) >= 1 && Number(monthYear[1]) <= 12;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso !== null) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
  if (numeric !== null) return calendarDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const parts = text.toLowerCase().replace(/[,\-]/g, " ").split(/\s+/);
  const month = MONTHS.findIndex(name => parts.includes(name) || parts.includes(name.slice(0, 3)));
  if (month < 0) return false;
  if (parts.length === 2 && /^\d{4}$/.test(parts[1])) return true;
  if (parts.length !== 3 || !/^\d{4}$/.test(parts[2])) return false;
  const day = /^\d{1,2}$/.test(parts[0]) ? parts[0] : parts[1];
  return /^\d{1,2}$/.test(day) && calendarDate(Number(parts[2]), month + 1, Number(day));
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
  const openingLinks: Array<{ line: number; label: string; heading?: Heading }> = [];
  for (let index = 0; index < parsed.markupLines.length; index++) {
    const line = parsed.markupLines[index];
    if (labelled.has(index) && !parsed.allHeadings.some(heading => heading.line === index + 1) && normaliseWording(line).replace(/[|\s:-]/g, "") !== "") labelledEntries = true;
    for (const link of markdownLinks(line).filter(link => !link.image && link.rendered)) {
      const destination = link.kind === "inline" ? link.target.trim().replace(/^<|>$/g, "") : parsed.destinations.get(normaliseReference(link.target || link.label));
      if (destination === undefined || !destination.startsWith("#")) continue;
      let fragment: string;
      try { fragment = decodeURIComponent(destination.slice(1)); } catch { continue; }
      const heading = targets.get(fragment);
      if (labelled.has(index)) {
        if (heading?.level === 2 && sections.includes(heading) && normaliseWording(link.label) !== normaliseWording(heading.text)) findings.push({ rule: "contents-list", line: index + 1, detail: "Use the target section's exact wording in this contents link." });
      } else if (index < openingEnd - 1 && parsed.rootLines.has(index)) openingLinks.push({ line: index + 1, label: link.label, heading });
    }
  }
  // Unlabelled navigation needs two links in one opening block, not scattered links.
  const groups = new Map<number, typeof openingLinks>();
  for (const link of openingLinks) {
    let start = link.line - 1;
    while (start > 0 && parsed.markupLines[start - 1].trim() !== "") start--;
    groups.set(start, [...(groups.get(start) ?? []), link]);
  }
  const navigation = [...groups.values()].filter(group => group.length >= 2).flat();
  for (const link of navigation) if (link.heading?.level === 2 && sections.includes(link.heading) && normaliseWording(link.label) !== normaliseWording(link.heading.text)) findings.push({ rule: "contents-list", line: link.line, detail: "Use the target section's exact wording in this navigation link." });
  if (!labelledEntries && navigation.length === 0) findings.unshift({ rule: "contents-list", line: 1, detail: "Add contents or navigation for six or more root H2 sections." });
  return findings;
}
