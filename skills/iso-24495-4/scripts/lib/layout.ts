import { markdownLinks, normaliseReference, structure, toLines, type Heading, type Reading } from "./parse.ts";
import type { Violation } from "./types.ts";
import { renderInline } from "./inline-wording.ts";

const SECTION_LIMIT = 6;
const YAML_REPARSE_LIMIT = 16;
const CONTENTS_LABEL = /^(?:contents|table of contents|toc|key sections)$/i;
const OVERVIEW_LABEL = /^(?:overview|summary)$/i;
const VERSION = /^(?:Version|Revision)\s*:?\s*v?\d+(?:\.\d+)+(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/i;
const DATE_FIELD = /^(?:Date|Updated|Last updated|Reviewed)\s*:?\s*(.+)$/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export interface LayoutOptions extends Reading { fileName?: string }

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
    const cells = parsed.tableRows.get(start - 1 + offset)?.map(normaliseWording) ?? [];
    return [normal, ...(cells.length >= 2 ? [`${cells[0].replace(/:$/, "")} ${cells[1]}`] : []), ...markdownLinks(line).filter(link => link.image).map(link => normaliseWording(link.label))];
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

/** Render inline wording for comparison while retaining case, punctuation and numbering. */
export function normaliseWording(text: string): string {
  return renderInline(text).replace(/\s+/g, " ").trim();
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
  const candidates = numericYamlCandidates(source);
  const budget = { remaining: YAML_REPARSE_LIMIT };
  return recognisedEditionFields(metadata, source, candidates, budget, false) || recognisedEditionFields((metadata as Record<string, unknown>).metadata, source, candidates, budget, true);
}
interface NumericYamlCandidate { key: string; spelling: string; index: number }
function recognisedEditionFields(metadata: unknown, source: string, candidates: NumericYamlCandidate[], budget: { remaining: number }, nested: boolean): boolean {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return false;
  return Object.entries(metadata).some(([key, value]) => {
    if (!/^(?:version|date|updated|last_updated)$/i.test(key) || (typeof value !== "string" && typeof value !== "number")) return false;
    if (typeof value === "number") return recognisedNumericYaml(source, key, candidates, budget, nested);
    return VERSION.test(`Version ${value}`) || validDate(value);
  });
}
function recognisedNumericYaml(source: string, key: string, candidates: NumericYamlCandidate[], budget: { remaining: number }, nested: boolean): boolean {
  // Bun exposes values, not source tokens. Probe each complete candidate with
  // a quoted marker, then let YAML prove its identity at the permitted path.
  // Separation, comments, quoting and block scalars remain the parser's job.
  // A candidate inside prose or a comment cannot become the field's marker.
  const marker = "iso-edition-source-token";
  for (const token of candidates) {
    if (token.key !== key.toLowerCase()) continue;
    if (budget.remaining === 0) return false;
    budget.remaining--;
    const probe = source.slice(0, token.index) + JSON.stringify(marker) + source.slice(token.index + token.spelling.length);
    try {
      const parsed = Bun.YAML.parse(probe) as Record<string, unknown> & { metadata: Record<string, unknown> };
      if ((nested ? parsed.metadata[key] : parsed[key]) === marker) return true;
    } catch { /* Replacing literal contents may make the probe invalid YAML. */ }
  }
  return false;
}
function numericYamlCandidates(source: string): NumericYamlCandidate[] {
  // Scan once for mapping keys and plain tokens. Strings, comments and block
  // scalars are opaque. The native parser still verifies each candidate's path.
  const lexemes = /^(?<blockIndent>[ \t]*)(?:[^\n:{}\[\],"'#]+|"(?:\\[\s\S]|[^"\\])*"|'(?:''|[^'])*')[ \t]*:[ \t]*[|>](?:[1-9][+-]?|[+-][1-9]?)?[ \t]*(?:#[^\n]*)?(?:\n(?:\k<blockIndent>[ \t]+[^\n]*|[ \t]*(?=\n|$)))*|(?<quotedKey>"(?:\\[\s\S]|[^"\\])*"|'(?:''|[^'])*')[ \t]*:|(?<![^\s\[\]{},:])"(?:\\[\s\S]|[^"\\])*"|(?<![^\s\[\]{},:])'(?:''|[^'])*'|(?<!\S)#[^\n]*|(?<=^|[,{])(?<plainKey>[^\n:{}\[\],"'#]+?)[ \t]*:(?=[\s{}\[\],]|$)|[{}\[\],:]|[^\s,{}\[\]:]+/gm;
  const candidates: NumericYamlCandidate[] = [];
  let field = "";
  let flowDepth = 0;
  let previous = "";
  let lineStart = true;
  let offset = 0;
  for (const token of source.matchAll(lexemes)) {
    const raw = token[0];
    const gap = source.slice(offset, token.index);
    const newline = gap.lastIndexOf("\n");
    if (newline !== -1) lineStart = /^[ \t\r]*$/.test(gap.slice(newline + 1));
    const key = token.groups!.quotedKey ?? token.groups!.plainKey;
    if (token.groups!.blockIndent !== undefined) field = "";
    else if (raw.startsWith("#")) { /* Comments preserve the preceding key. */ }
    else if (key !== undefined) {
      const spelling = key.trim();
      const decoded = spelling.startsWith('"') ? spelling.replace(/\\(\\|x[0-9a-f]{2}|u[0-9a-f]{4}|U[0-9a-f]{8})/g, (_token, escape: string) => escape === "\\" ? "\\" : String.fromCodePoint(parseInt(escape.slice(1), 16))) : spelling;
      const name = decoded.replace(/^(["'])(.*)\1$/s, "$2").toLowerCase();
      field = (lineStart || flowDepth > 0 && (previous === "{" || previous === ",")) && /^(?:version|date|updated|last_updated)$/.test(name) ? name : "";
    } else if (raw === "{" || raw === "[") flowDepth++;
    else if (raw === "}" || raw === "]") { flowDepth--; field = ""; }
    else if (raw === ",") field = "";
    else if (field !== "" && VERSION.test(`Version ${raw}`)) candidates.push({ key: field, spelling: raw, index: token.index });
    if (!raw.startsWith("#")) previous = raw;
    const lastNewline = raw.lastIndexOf("\n");
    lineStart = lastNewline !== -1 && /^[ \t\r]*$/.test(raw.slice(lastNewline + 1));
    offset = token.index + raw.length;
  }
  return candidates;
}
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
  if (numeric !== null) return calendarDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]))
    || calendarDate(Number(numeric[3]), Number(numeric[1]), Number(numeric[2]));
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
  const openingLinks: Array<{ line: number; label: string; heading?: Heading; block: number }> = [];
  const navigationParagraphs = new Map<number, boolean>();
  for (const [index, block] of parsed.blocks) if (block.kind === "paragraph") {
    const source = parsed.markupLines[index];
    const links = markdownLinks(source).filter(link => !link.image && link.rendered);
    let residual = source;
    for (const link of [...links].reverse()) {
      residual = residual.slice(0, link.start) + residual.slice(link.end);
    }
    const navigation = /^[\s,;|/]*$/.test(residual);
    navigationParagraphs.set(block.id, (navigationParagraphs.get(block.id) ?? true) && navigation);
  }
  for (let index = 0; index < parsed.markupLines.length; index++) {
    const line = parsed.markupLines[index];
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
