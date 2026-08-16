// The corpus the reference comparison runs over.
//
// Two parts. A matrix of every container prefix the engine claims to
// understand, applied to every leaf block it claims to find, and the
// transitions between them. Then documents built from a grammar of lines by a
// seeded generator, so the corpus holds shapes nobody thought to choose.
//
// The seed is fixed, so the same corpus is produced every time.

export interface Shape {
  name: string;
  lines: string[];
}

const TAB = String.fromCharCode(9);
const BREAK = String.fromCharCode(10);

export const MATRIX_SHAPES: Shape[] = [];

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



for (const [containerName, prefixes] of containers) {
  for (const [leafName, body] of leaves) {
    const lines = body.map((line, index) => {
      if (prefixes.length === 0) return line;
      const opener = prefixes.join("");
      const continuation = prefixes.map((prefix, depth) =>
        prefix.trimEnd() === ">" ? "> " : " ".repeat(prefix.length)).join("");
      return (index === 0 ? opener : continuation) + line;
    });
    MATRIX_SHAPES.push({ name: `${containerName} / ${leafName}`, lines });
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
for (const [name, lines] of extras) MATRIX_SHAPES.push({ name, lines });


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


export const GENERATED_SHAPES: Shape[] = [];
const seen = new Set<string>();
for (let n = 0; n < 500 && GENERATED_SHAPES.length < 120; n++) {
  const count = 2 + next(4);
  const lines: string[] = [];
  for (let i = 0; i < count; i++) lines.push(pick(PREFIXES) + pick(BODIES));
  const key = lines.join(BREAK);
  if (seen.has(key)) continue;
  seen.add(key);
  GENERATED_SHAPES.push({ name: `generated: ${lines.join(" / ").slice(0, 60)}`, lines });
}
