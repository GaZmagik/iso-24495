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

/** Split a paragraph into sentences on terminal punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter(Boolean).length;
}
