// Rebuild `../fixtures/reference-blocks.ts` from the CommonMark reference.
//
// One command does the whole job, because the last version needed three
// undocumented steps and a file no checked-in script produced. A reviewer
// tried to reproduce the fixture, could not, and was right to say the claim
// was unsupported.
//
//   cd <a directory outside this repository>
//   bun add commonmark
//   bun <repo>/skills/iso-24495-4/tests/reference/build-fixture.ts
//
// It prints the counts and rewrites the fixture in place. A difference the
// engine cannot explain stops the run: an expectation without a reason is
// either a defect or a decision nobody has made.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Parser } from "commonmark";
import { headings, proseBlocks } from "../../scripts/lib/parse.ts";
import { GENERATED_SHAPES, MATRIX_SHAPES, type Shape } from "./shapes.ts";

const BREAK = String.fromCharCode(10);
const parser = new Parser();

interface Blocks {
  paragraphs: string[];
  headings: Array<[number, string]>;
}

function reference(markdown: string): Blocks {
  const walker = parser.parse(markdown).walker();
  const paragraphs: string[] = [];
  const found: Array<[number, string]> = [];
  let event = walker.next();
  let text: string | null = null;
  let level = 0;
  let kind: "paragraph" | "heading" | null = null;
  while (event) {
    const { node, entering } = event;
    if (node.type === "paragraph" || node.type === "heading") {
      if (entering) {
        text = "";
        kind = node.type;
        level = node.type === "heading" ? node.level : 0;
      } else {
        const value = (text ?? "").replace(/\s+/g, " ").trim();
        if (kind === "paragraph") paragraphs.push(value);
        else found.push([level, value]);
        text = null;
        kind = null;
      }
    }
    if (text !== null && (node.type === "text" || node.type === "code")) text += node.literal ?? "";
    if (text !== null && (node.type === "softbreak" || node.type === "linebreak")) text += " ";
    event = walker.next();
  }
  return { paragraphs, headings: found };
}

/**
 * The reference renders inline markup; this engine keeps the source, because
 * its rules read link syntax and code spans. Flatten ours before comparing.
 * Without this, 153 documents looked like disagreements and every one was the
 * comparison's fault.
 */
function flatten(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(?<!`)`([^`]+)`(?!`)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\\(.)/g, "$1")
    .replace(/<([a-z]+:[^>]*)>/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function ours(markdown: string): { raw: Blocks; flat: Blocks } {
  const blocks = proseBlocks(markdown);
  const found = headings(markdown);
  return {
    raw: {
      paragraphs: blocks.map((b) => b.lines.join(" ").replace(/\s+/g, " ").trim()),
      headings: found.map((h) => [h.level, h.text.replace(/\s+/g, " ").trim()]),
    },
    flat: {
      paragraphs: blocks.map((b) => flatten(b.lines.join(" "))),
      headings: found.map((h) => [h.level, flatten(h.text)]),
    },
  };
}

/**
 * Why this engine reads a document differently from CommonMark core.
 *
 * Each reason is a decision about a reader. The test is what the document
 * actually contains, not a word in its name, because classifying by name once
 * let an unrelated defect wear an unrelated excuse.
 */
function reasonFor(lines: string[]): string | null {
  // A container can hold any of these, so the markers come off first.
  // Tabs are four columns here as well, or a tab-indented marker hides the
  // construct from this classifier while the engine sees it.
  const bare = lines.map((line) => {
    let rest = line.replace(/	/g, "    ");
    for (;;) {
      const stripped = rest
        .replace(/^(?: {0,3}>[ 	]?)+/, "")
        .replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)])[ 	]+/, "");
      if (stripped === rest) return rest;
      rest = stripped;
    }
  });
  const joined = bare.join(BREAK);

  const hasTable = bare.some((line, index) => {
    const next = bare[index + 1] ?? "";
    return line.includes("|")
      && /^ {0,3}\|?[\s:|-]*-[\s:|-]*\|?$/.test(next.trim())
      && next.includes("-");
  });
  if (hasTable) {
    return "GitHub renders a table; the reference implements CommonMark core, which has no table extension.";
  }
  if (/^ {0,3}(?:<!--|<!|<\?)/m.test(joined)
    || /^ {0,3}\[[^\]^][^\]]*\]:[ 	]/m.test(joined)) {
    return "A comment, declaration, processing instruction or link definition is invisible to a reader.";
  }
  if (/<\/?[a-z][^>]*>/i.test(joined)) {
    return "HTML carries prose a reader reads; its tags are markup and its text is measured.";
  }
  if (/^ {0,3}>[ ]?\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/im.test(lines.join(BREAK))) {
    return "A GitHub alert label opens an alert; CommonMark has no alerts and reads it as text.";
  }
  if (/(?:^|\n)[ \t]*(?:[-*+]|\d{1,9}[.)])?[ \t]*\[[ xX]\][ \t]/.test(joined)) {
    return "A task marker is a control a reader hears as a checkbox, not two words.";
  }
  if (lines[0]?.trim() === "---") {
    return "Front matter is metadata on GitHub and in Jekyll; CommonMark has no such concept.";
  }
  return null;
}

interface Row extends Shape {
  paragraphs: string[];
  headings: Array<[number, string]>;
  differsFromReference?: string;
}

const shapes: Shape[] = [...MATRIX_SHAPES, ...GENERATED_SHAPES];
const rows: Row[] = [];
const unexplained: Shape[] = [];
let agreed = 0;

for (const shape of shapes) {
  const markdown = shape.lines.join(BREAK) + BREAK;
  const theirs = reference(markdown);
  const mine = ours(markdown);
  const same = JSON.stringify(theirs) === JSON.stringify(mine.flat);
  const reason = same ? null : reasonFor(shape.lines);
  if (same) agreed++;
  else if (reason === null) {
    unexplained.push(shape);
    continue;
  }
  rows.push({
    ...shape,
    paragraphs: mine.raw.paragraphs,
    headings: mine.raw.headings,
    ...(reason === null ? {} : { differsFromReference: reason }),
  });
}

const divergences = rows.filter((row) => row.differsFromReference !== undefined);
const reasons = new Set(divergences.map((row) => row.differsFromReference));

console.log(`${shapes.length} documents: ${agreed} agree, ${divergences.length} diverge for ${reasons.size} reasons.`);
if (unexplained.length > 0) {
  console.error(`${unexplained.length} differ for no stated reason. The first is:`);
  console.error(JSON.stringify(unexplained[0], null, 2));
  console.error("Either the engine is wrong, or the divergence needs a reason in reasonFor.");
  process.exit(1);
}

const header = `// Block structure for ${rows.length} documents, checked against the CommonMark
// reference implementation.
//
// Rebuild this file with \`build-fixture.ts\` beside it, which reads the corpus
// from \`shapes.ts\`, asks the reference, and refuses to write a difference it
// cannot explain. See the README for the two commands.
//
// ${agreed} documents are read identically. ${divergences.length} differ, for ${reasons.size} reasons, and every
// reason is a decision about a reader rather than about Markdown.
//
// Never edit an expectation by hand to make a test pass.

export interface ReferenceShape {
  name: string;
  lines: string[];
  paragraphs: string[];
  headings: Array<[number, string]>;
  /** Why this engine reads the document differently from CommonMark core. */
  differsFromReference?: string;
}

export const REFERENCE_SHAPES: ReferenceShape[] = `;

const target = join(import.meta.dir, "..", "fixtures", "reference-blocks.ts");
writeFileSync(target, header + JSON.stringify(rows, null, 2) + ";\n");
console.log("wrote", target);
