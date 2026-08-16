import { Parser } from "commonmark";
import { writeFileSync } from "node:fs";
import { headings, proseBlocks } from "../../scripts/lib/parse.ts";

const B = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const parser = new Parser();

// A seeded generator, so the corpus is the same every time it is built.
let seed = 20260816;
function next(limit: number): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % limit;
}
function pick<T>(items: T[]): T {
  return items[next(items.length)];
}

const PREFIXES = ["", "- ", "1. ", "> ", "  ", "    ", TAB, ">", "* ", "2) ", "  - ", "> > ", "- > ", "> - "];
const BODIES = [
  "One sentence here.",
  "Two words.",
  "The supplier shall comply.",
  "# Heading",
  "### Deeper heading",
  "===",
  "---",
  "***",
  "```",
  "~~~",
  "```text",
  "| A | B |",
  "|---|---|",
  "A | B",
  "---|---",
  "",
  "[link](https://example.com)",
  "![](image.png)",
  "<p>Inline html.</p>",
  "Text with `code` inside.",
  "Text with **bold** inside.",
  "[!WARNING]",
  "- [ ] Task item",
  "10. Ordered ten",
  "\\- Escaped marker",
  "Trailing spaces here  ",
];

function reference(markdown: string) {
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

// The reference renders inline markup; this engine keeps the source, because
// its rules read link syntax and code spans. Compare the block structure by
// flattening ours the same way.
function flatten(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(?<!`)`([^`]+)`(?!`)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function ours(markdown: string) {
  return {
    paragraphs: proseBlocks(markdown).map((b) => flatten(b.lines.join(" "))),
    headings: headings(markdown).map((h) => [h.level, flatten(h.text)] as [number, string]),
  };
}

function classify(lines: string[]): string | null {
  const joined = lines.join(B);
  if (/^\|?[\s:|-]*-[\s:|-]*\|?$/m.test(joined) && /\|/.test(joined)) {
    return "GitHub renders a table; the reference implements CommonMark core, which has no table extension.";
  }
  if (/<[a-zA-Z/!?]/.test(joined)) {
    return "HTML carries prose a reader reads, so its text is measured rather than skipped as a block.";
  }
  if (lines[0]?.trim() === "---") {
    return "Front matter is metadata on GitHub and in Jekyll; CommonMark has no such concept.";
  }
  if (/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(joined)) {
    return "A GitHub alert label is a label, not a sentence.";
  }
  if (/\[[ xX]\]/.test(joined)) {
    return "A task marker is a control, not words a reader hears.";
  }
  return null;
}

const seen = new Set<string>();
const agreeing: Array<{ name: string; lines: string[]; paragraphs: string[]; headings: Array<[number, string]> }> = [];
const undocumented: Array<{ lines: string[]; theirs: unknown; mine: unknown }> = [];
let documented = 0;

for (let n = 0; n < 500; n++) {
  const count = 2 + next(4);
  const lines: string[] = [];
  for (let i = 0; i < count; i++) lines.push(pick(PREFIXES) + pick(BODIES));
  const key = lines.join(B);
  if (seen.has(key)) continue;
  seen.add(key);
  const markdown = key + B;
  const theirs = reference(markdown);
  const mine = ours(markdown);
  if (JSON.stringify(theirs) === JSON.stringify(mine)) {
    // Record what the engine actually produces, not the flattened form the
    // comparison uses: the rules read link syntax and code spans.
    const raw = {
      paragraphs: proseBlocks(markdown).map((b) => b.lines.join(" ").replace(/\s+/g, " ").trim()),
      headings: headings(markdown).map((h) => [h.level, h.text.replace(/\s+/g, " ").trim()] as [number, string]),
    };
    agreeing.push({ name: `generated ${n}`, lines, paragraphs: raw.paragraphs, headings: raw.headings });
    continue;
  }
  if (classify(lines) !== null) {
    documented++;
    continue;
  }
  undocumented.push({ lines, theirs, mine });
}

console.log("documents:", seen.size);
console.log("agree:", agreeing.length);
console.log("documented divergences:", documented);
console.log("undocumented differences:", undocumented.length);
for (const row of undocumented.slice(0, 12)) {
  console.log("---");
  console.log("  markdown :", JSON.stringify(row.lines));
  console.log("  reference:", JSON.stringify(row.theirs));
  console.log("  ours     :", JSON.stringify(row.mine));
}
writeFileSync("./fuzz.json", JSON.stringify(agreeing, null, 2));
