// Markdown text extraction shared by the audit scripts. Regex heuristics
// only. Anything smarter belongs to the agent, not to deterministic tooling.

export interface ProseBlock {
  /** 1-indexed line number of the block's first line. */
  line: number;
  /** The block's lines, in order. */
  lines: string[];
}

export interface Heading {
  level: number;
  line: number;
  text: string;
}

const NON_PROSE_PREFIX = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>)/;

/** Collect prose paragraphs, skipping headings, lists, tables, quotes, and fenced code. */
export function proseBlocks(text: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let current: ProseBlock | null = null;
  let inFence = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
      current = null;
      continue;
    }
    // Test the trimmed line: list markers and quotes are structure at ANY
    // indentation. Testing the raw line made nested bullets count as prose,
    // which merged them into giant fake sentences and biased the average.
    if (inFence || line.trim() === "" || NON_PROSE_PREFIX.test(line.trimStart())) {
      current = null;
      continue;
    }
    if (current === null) {
      current = { line: i + 1, lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  }
  return blocks;
}

/** Heading levels with their 1-indexed line numbers, ignoring fenced code. */
export function headings(text: string): Heading[] {
  const found: Heading[] = [];
  let inFence = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^(```|~~~)/.test(lines[i].trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (match) {
      found.push({
        level: match[1].length,
        line: i + 1,
        text: match[2].replace(/\s+#+\s*$/, "").trim(),
      });
    }
  }
  return found;
}

// A full stop ends a sentence far less often than it ends an abbreviation.
// Treating every one as a boundary counted "Dr. Smith" as two sentences, which
// inflated the sentence count, deflated the average, and made ordinary titles
// look malformed. Anything that ends in a dotted form or a known short form
// therefore joins the fragment that follows it.
// A title is always followed by a name, so it never ends a sentence. Every
// other short form can: "in the U.S. The weather" is two sentences, while
// "U.S. policy" is one. What follows decides, so the capital after the stop is
// the evidence.
const TITLES = new Set(["dr", "mr", "mrs", "ms", "messrs", "prof", "rev", "fr", "sr", "jr", "st"]);
const ABBREVIATIONS = new Set([
  "inc", "ltd", "co", "vs", "etc", "fig", "no", "al", "approx", "cf", "dept",
  "est", "vol", "ed", "eds", "pp", "ca", "min", "max", "ext", "ref",
]);

function abbreviationKind(fragment: string): "title" | "short" | null {
  const token = fragment.trimEnd().split(/\s+/).at(-1) ?? "";
  if (!token.endsWith(".")) return null;
  const word = token.slice(0, -1).replace(/^[^A-Za-z]+/, "").toLowerCase();
  if (TITLES.has(word)) return "title";
  // "U.S.", "e.g." and a lone initial such as "J." are dotted forms.
  if (/^[^A-Za-z]*(?:[A-Za-z]\.)+$/.test(token)) return "short";
  return ABBREVIATIONS.has(word) ? "short" : null;
}

/** Split a paragraph into sentences on terminal punctuation. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const fragment of text.split(/(?<=[.!?])\s+/)) {
    const previous = sentences.at(-1);
    const kind = previous === undefined ? null : abbreviationKind(previous);
    const startsNewSentence = /^[^A-Za-z]*[A-Z]/.test(fragment);
    if (kind === "title" || (kind === "short" && !startsNewSentence)) {
      sentences[sentences.length - 1] = `${previous} ${fragment}`;
      continue;
    }
    sentences.push(fragment);
  }
  return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter(Boolean).length;
}
