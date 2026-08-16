import { Parser } from "commonmark";
import { writeFileSync } from "node:fs";
import { headings, proseBlocks } from "../../scripts/lib/parse.ts";

const B = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const parser = new Parser();

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

function ours(markdown: string) {
  return {
    paragraphs: proseBlocks(markdown).map((b) => b.lines.join(" ").replace(/\s+/g, " ").trim()),
    headings: headings(markdown).map((h) => [h.level, h.text.replace(/\s+/g, " ").trim()] as [number, string]),
  };
}

// Every container prefix the engine claims to understand, applied to every
// leaf block it claims to find, plus the transitions between them.
const containers: Array<[string, string[]]> = [
  ["margin", []],
  ["bullet", ["- "]],
  ["ordered", ["1. "]],
  ["quote", ["> "]],
  ["quote in bullet", ["- ", "> "]],
  ["bullet in quote", ["> ", "- "]],
  ["nested bullets", ["- ", "- "]],
  ["deep quote", ["> ", "> "]],
  ["quote bullet quote", ["> ", "- ", "> "]],
];

const leaves: Array<[string, string[]]> = [
  ["paragraph", ["One sentence here."]],
  ["two sentences", ["One. Two."]],
  ["wrapped", ["One line", "second line."]],
  ["atx", ["# Heading"]],
  ["atx deep", ["#### Heading"]],
  ["setext", ["Heading text", "==="]],
  ["setext dash", ["Heading text", "---"]],
  ["fence", ["```", "code", "```"]],
  ["fence tilde", ["~~~", "code", "~~~"]],
  ["unclosed fence", ["```", "code"]],
  ["break", ["***"]],
  ["table", ["| A | B |", "|---|---|", "| x | y |"]],
  ["pipeless table", ["A | B", "---|---", "x | y"]],
  ["two paragraphs", ["One.", "", "Two."]],
  ["after break", ["One.", "", "***", "", "Two."]],
];

function indentFor(prefixes: string[]): string {
  return prefixes.map((prefix) => " ".repeat(prefix.length)).join("");
}

const shapes: Array<{ name: string; lines: string[] }> = [];

for (const [containerName, prefixes] of containers) {
  for (const [leafName, body] of leaves) {
    const lines = body.map((line, index) => {
      if (prefixes.length === 0) return line;
      const opener = prefixes.join("");
      const continuation = prefixes.map((prefix, depth) =>
        prefix.trimEnd() === ">" ? "> " : " ".repeat(prefix.length)).join("");
      return (index === 0 ? opener : continuation) + line;
    });
    shapes.push({ name: `${containerName} / ${leafName}`, lines });
  }
}

// Transitions and edge cases that no single container covers.
const extras: Array<[string, string[]]> = [
  ["lazy after bullet", ["- One.", "Two."]],
  ["lazy after quote", ["> One.", "Two."]],
  ["lazy after nested", ["- A.", "  - B.", "  C."]],
  ["outdent to sibling", ["- A.", "  - B.", "- C."]],
  ["blank then item content", ["- A.", "", "  B."]],
  ["blank then margin", ["- A.", "", "B."]],
  ["item then heading", ["- A.", "# Heading"]],
  ["quote then heading", ["> A.", "# Heading"]],
  ["heading then item", ["# Heading", "- A."]],
  ["fence then item", ["```", "code", "```", "- A."]],
  ["item holding fence", ["- A:", "", "  ```", "  code", "  ```", "", "  B."]],
  ["item holding table", ["- A:", "", "  | A | B |", "  |---|---|", "  | x | y |", "", "  B."]],
  ["quote holding table", ["> | A | B |", "> |---|---|", "> | x | y |"]],
  ["tab item", [`-${TAB}A.`]],
  ["tab code", [`${TAB}code`]],
  ["tab in quote", [`>${TAB}A.`]],
  ["five space item", ["-     A."]],
  ["four space item", ["-    A."]],
  ["ordered ten", ["10. A."]],
  ["ordered paren", ["1) A."]],
  ["marker only", ["-", "A."]],
  ["hash only", ["#", "", "A."]],
  ["setext under table", ["A | B", "---|---", "x | y", "Heading", "---"]],
  ["break in item", ["- A.", "  ***", "  B."]],
  ["quote break quote", ["> A.", "> ***", "> B."]],
  ["indented code in item", ["- A:", "", "      code", "", "  B."]],
  ["html in item", ["- <p>Text.</p>"]],
  ["front matter then item", ["---", "title: x", "---", "- A."]],
  ["crlf paragraph", ["A.", "B."]],
  ["numbered wrap", ["Text continues", "2024. and on."]],
  ["numbered one wrap", ["Text continues", "1. a list."]],
];
for (const [name, lines] of extras) shapes.push({ name, lines });

const rows: Array<{ name: string; lines: string[]; paragraphs: string[]; headings: Array<[number, string]> }> = [];
const differ: string[] = [];

for (const shape of shapes) {
  const markdown = shape.lines.join(B) + B;
  const a = reference(markdown);
  const b = ours(markdown);
  const same = JSON.stringify(a.paragraphs) === JSON.stringify(b.paragraphs)
    && JSON.stringify(a.headings) === JSON.stringify(b.headings);
  if (!same) {
    differ.push(shape.name);
    console.log("DIFFERS: " + shape.name);
    console.log("   markdown  :", JSON.stringify(shape.lines));
    console.log("   reference :", JSON.stringify(a));
    console.log("   ours      :", JSON.stringify(b));
    continue;
  }
  rows.push({ name: shape.name, lines: shape.lines, paragraphs: a.paragraphs, headings: a.headings });
}

console.log(`${rows.length} of ${shapes.length} shapes agree; ${differ.length} differ.`);
writeFileSync("./matrix.json", JSON.stringify(rows, null, 2));
