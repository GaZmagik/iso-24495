import { frontMatterRange, toLines, type Reading } from "./parse.ts";

/**
 * The end of a comment, then a fence run. `parse.ts` also ends a comment at
 * `--!>`, and `?>` is the end CommonMark gives a processing instruction.
 */
const FENCE_AFTER_CLOSE = /(?:-->|--!>|\?>)[ \t]*(?:`{3,}|~{3,})/;
/**
 * Any `>`, then a fence run. `parse.ts` ends a declaration and a processing
 * instruction at the first `>`, so this is read once either has opened.
 */
const FENCE_AFTER_ANGLE = />[ \t]*(?:`{3,}|~{3,})/;
/** The start of a declaration, such as `<!DOCTYPE` in either letter case, or of a processing instruction. */
const ANGLE_CLOSED_OPEN = /<![A-Za-z]|<\?/;
/** A line shaped like a fence, however far it stands in. */
const FENCE_SHAPED = /^[ \t]*(?:`{3,}|~{3,})/;

/**
 * Whether `parse.ts` and CommonMark may disagree about where this
 * document's fenced code blocks are, for one of two known reasons.
 *
 * - A fence run follows the end of a comment, a processing instruction or a
 *   declaration on the same line, such as `<!-- c -->~~~`. `parse.ts` sets
 *   the comment aside and reads a fence. CommonMark keeps the whole line in
 *   the HTML block, so the fences after it pair the other way round.
 * - Front matter is read and holds a line shaped like a fence. CommonMark
 *   has no front matter, so it reads that line as a fence that runs on into
 *   the document.
 *
 * It matches more than these two forms, so it can cost findings, but it
 * never decides that a document is safe when one of the forms is present.
 * A fence after `-->`, `--!>` or `?>` counts anywhere, even in code. A fence
 * after `>` counts once any declaration or processing instruction has
 * opened earlier in the text, which includes a quoted fence below one, even
 * in code. A fence-shaped line counts
 * anywhere in the front matter, even where CommonMark would read it as
 * text or pair it inside the block.
 *
 * Each line is read once, so the time grows with the length of the text.
 *
 * @param text The whole document.
 * @param reading `frontMatter` set to false means a leading "---" block is
 *     text, as the rules then read it, so its lines are not front matter.
 * @returns True when either form is present.
 */
export function blocksInDoubt(text: string, reading: Reading = {}): boolean {
  const lines = toLines(text);
  if (reading.frontMatter !== false) {
    const range = frontMatterRange(lines);
    if (range !== null && lines.slice(range.start + 1, range.end).some(line => FENCE_SHAPED.test(line))) return true;
  }
  let angleClosed = false;
  for (const line of lines) {
    if (FENCE_AFTER_CLOSE.test(line)) return true;
    const opened = angleClosed ? 0 : line.search(ANGLE_CLOSED_OPEN);
    if (opened !== -1) {
      angleClosed = true;
      if (FENCE_AFTER_ANGLE.test(line.slice(opened))) return true;
    }
  }
  return false;
}
