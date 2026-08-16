import { Parser } from "commonmark";
import { writeFileSync } from "node:fs";
import { headings, proseBlocks } from "../../scripts/lib/parse.ts";

const B = String.fromCharCode(10);
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

function reasonFor(name: string): string | null {
  if (name.includes("table")) {
    return "GitHub renders a table; the reference implements CommonMark core, which has no table extension.";
  }
  if (name.includes("html")) {
    return "HTML carries prose a reader reads, so its text is measured rather than skipped as a block.";
  }
  if (name.includes("alert")) {
    return "A GitHub alert label is a label, not a sentence; CommonMark has no alerts and reads it as text.";
  }
  if (name.includes("task")) {
    return "A task marker is a control a reader hears as a checkbox, not two words.";
  }
  if (name.includes("link definition") || name.includes("doctype")
    || name.includes("comment") || name.includes("processing")) {
    return "A link reference definition, comment, declaration or processing instruction is invisible to a reader.";
  }
  if (name.includes("front matter")) {
    return "Front matter is metadata on GitHub and in Jekyll; CommonMark has no such concept and reads it as a heading.";
  }
  return null;
}

const source = await import("./matrix.ts").catch(() => null);
void source;

const shapes: Array<{ name: string; lines: string[] }> = JSON.parse(
  await Bun.file("./shapes.json").text(),
);

const rows = shapes.map(({ name, lines }) => {
  const markdown = lines.join(B) + B;
  const theirs = reference(markdown);
  const mine = ours(markdown);
  const agrees = JSON.stringify(theirs) === JSON.stringify(mine);
  const reason = agrees ? null : reasonFor(name);
  if (!agrees && reason === null) {
    throw new Error("undocumented difference: " + name);
  }
  return {
    name,
    lines,
    paragraphs: mine.paragraphs,
    headings: mine.headings,
    ...(reason === null ? {} : { differsFromReference: reason }),
  };
});

writeFileSync(
  "./recorded.json",
  JSON.stringify(rows, null, 2),
);
console.log("recorded", rows.length, "shapes;",
  rows.filter((r) => "differsFromReference" in r).length, "documented divergences");
