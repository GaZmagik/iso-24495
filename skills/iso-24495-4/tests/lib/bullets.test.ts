import { describe, expect, test } from "bun:test";
import { bulletParagraphViolations } from "../../scripts/lib/bullets.ts";
import { layoutViolations } from "../../scripts/lib/layout.ts";
import { structure, toLines } from "../../scripts/lib/parse.ts";
import { auditText } from "../../scripts/audit-corpus.ts";

const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);
const NBSP = String.fromCharCode(0xa0);
const ZERO_WIDTH = String.fromCharCode(0x200b);

/** Every text a test below gave the rule, so the oracle can check each finding it made. */
const SPECIMENS = new Set<string>();

/** The bullet-paragraphs findings for a text, as the rule gives them. */
function bullets(text: string): Array<{ line: number; detail: string }> {
  SPECIMENS.add(text);
  return bulletParagraphViolations(text, structure(text)).map(finding => ({ line: finding.line, detail: finding.detail }));
}

/** The finding for an item on this line that holds this many paragraphs. */
function held(line: number, paragraphs: number): { line: number; detail: string } {
  return { line, detail: `This bulleted item holds ${paragraphs} paragraphs. Make it one paragraph on one idea, or promote it to a subsection.` };
}

/** An item of two paragraphs on lines 1 and 3, with the body at column 2. */
const TWO = "- First paragraph.\n\n  Second paragraph.\n";

describe("bullet-paragraphs: an unordered item that directly holds two or more paragraphs", () => {
  test("an item of two paragraphs gives one finding on its marker line, and three give a count of 3", () => {
    expect(bullets(TWO)).toEqual([held(1, 2)]);
    expect(bullets("- One.\n\n  Two.\n\n  Three.\n")).toEqual([held(1, 3)]);
    expect(bullets("Intro.\n\n- One.\n\n  Two.\n")).toEqual([held(3, 2)]);
  });

  test("each bullet marker, one to four spaces after it and up to three before it are read", () => {
    for (const marker of ["-", "*", "+"]) {
      for (let gap = 1; gap <= 4; gap++) {
        for (let indent = 0; indent <= 3; indent++) {
          const column = " ".repeat(indent + 1 + gap);
          const text = `${" ".repeat(indent)}${marker}${" ".repeat(gap)}One.\n\n${column}Two.\n`;
          expect(bullets(text), JSON.stringify(text)).toEqual([held(1, 2)]);
        }
      }
    }
  });

  test("a body less indented than the item's text is not in the item, so nothing is reported", () => {
    expect(bullets("-  One.\n\n  Two.\n")).toEqual([]);
    expect(bullets("- One.\n\n Two.\n")).toEqual([]);
    expect(bullets("- One.\n\nTwo.\n")).toEqual([]);
  });

  test("a body up to three columns past the item's text is a paragraph of it", () => {
    expect(bullets("- One.\n\n     Two.\n")).toEqual([held(1, 2)]);
    expect(bullets("- One.\n\n   Two.\n")).toEqual([held(1, 2)]);
  });

  test("a paragraph wrapped over lines at or past the column is one paragraph", () => {
    expect(bullets("- One\n  carried on.\n\n  Two\n  carried on\n    and on.\n")).toEqual([held(1, 2)]);
    expect(bullets("- One\n  carried on.\n  Still one.\n")).toEqual([]);
  });

  test("blank lines of spaces or tabs, and several of them, separate paragraphs", () => {
    expect(bullets("- One.\n   \n  Two.\n")).toEqual([held(1, 2)]);
    expect(bullets(`- One.\n${TAB}\n  Two.\n`)).toEqual([held(1, 2)]);
    expect(bullets("- One.\n\n\n\n  Two.\n")).toEqual([held(1, 2)]);
  });

  test("line endings of every kind give the same finding, with or without one at the end", () => {
    for (const ending of ["\n", "\r\n", CR]) {
      expect(bullets(TWO.replaceAll("\n", ending))).toEqual([held(1, 2)]);
      expect(bullets("- One.\n\n  Two.".replaceAll("\n", ending))).toEqual([held(1, 2)]);
    }
  });

  test("an item in another bulleted or ordered item is read at its own column", () => {
    expect(bullets("- Outer.\n  - Inner one.\n\n    Inner two.\n")).toEqual([held(2, 2)]);
    expect(bullets("1. Step.\n   - Inner one.\n\n     Inner two.\n")).toEqual([held(2, 2)]);
    expect(bullets("- Outer.\n\n  Outer two.\n\n  - Inner.\n")).toEqual([]);
  });

  test("a label paragraph above a body paragraph, and a task item, are reported", () => {
    expect(bullets("* **Windows:**\n\n  Download the installer.\n")).toEqual([held(1, 2)]);
    expect(bullets("- [ ] Check the valve.\n\n  Then the vent.\n")).toEqual([held(1, 2)]);
  });

  test("a paragraph of any script, or of invisible text, counts", () => {
    expect(bullets("- Un.\n\n  Deux.\n")).toEqual([held(1, 2)]);
    expect(bullets("- Один.\n\n  Два.\n")).toEqual([held(1, 2)]);
    expect(bullets(`- One.\n\n  ${ZERO_WIDTH}\n`)).toEqual([held(1, 2)]);
    expect(bullets(`- One.\n\n  ${NBSP}Two.\n`)).toEqual([held(1, 2)]);
  });

  test("each item of a list is read alone, so two items of two paragraphs give two findings", () => {
    expect(bullets(`${TWO}- Third.\n\n  Fourth.\n`)).toEqual([held(1, 2), held(4, 2)]);
    expect(bullets(`${TWO}\n- Third.\n\n  Fourth.\n`)).toEqual([held(1, 2), held(5, 2)]);
  });
});

describe("loose lists and items of one paragraph are not reported", () => {
  test("a tight list and a loose list, each item one paragraph, give nothing", () => {
    expect(bullets("- One.\n- Two.\n- Three.\n")).toEqual([]);
    expect(bullets("- One.\n\n- Two.\n\n- Three.\n")).toEqual([]);
    expect(bullets("- One.\n\n\n- Two.\n")).toEqual([]);
  });

  test("the item ends at the next item at its own indent, or at a line less indented after a blank line", () => {
    expect(bullets("- One.\n- Two.\n\n  More of two.\n")).toEqual([held(2, 2)]);
    expect(bullets("- One.\n\nAfter.\n\n  Indented after.\n")).toEqual([]);
    expect(bullets(`${TWO}\nAfter the list.\n`)).toEqual([held(1, 2)]);
    expect(bullets(`${TWO}- Next.\n`)).toEqual([held(1, 2)]);
    expect(bullets(`${TWO}* Next, in another list.\n`)).toEqual([held(1, 2)]);
  });

  test("an ordered item is not in scope", () => {
    expect(bullets("1. One.\n\n   Two.\n")).toEqual([]);
    expect(bullets("1) One.\n\n   Two.\n")).toEqual([]);
  });
});

describe("an item that holds anything but paragraphs is not read", () => {
  const blocks: Array<[string, string]> = [
    ["a fence of backticks", "```\n  code\n  ```"],
    ["a fence of tildes", "~~~\n  code\n  ~~~"],
    ["indented code", "    code"],
    ["a quotation", "> Quoted."],
    ["a bulleted list", "- Nested."],
    ["an ordered list", "1. Nested."],
    ["a table", "| A | B |\n  |---|---|\n  | 1 | 2 |"],
    ["a heading", "## Heading"],
    ["an underlined heading", "Heading\n  ==="],
    ["an underline of dashes", "Heading\n  ---"],
    ["a thematic break of stars", "***"],
    ["a thematic break of underscores", "_ _ _"],
    ["HTML", "<div>Box</div>"],
    ["a link definition", "[guide]: https://example.org"],
    ["a footnote", "[^1]: A note."],
    ["mathematics", "$$\n  x\n  $$"],
    ["one code span", "`comfy model list`"],
    ["one code span over two lines", "`comfy model\n  list`"],
  ];

  test("an item of two paragraphs and one other block gives nothing, and without it gives a finding", () => {
    for (const [name, block] of blocks) {
      expect(bullets(`- One.\n\n  Two.\n\n  ${block}\n`), name).toEqual([]);
      expect(bullets(`- One.\n\n  ${block}\n\n  Two.\n`), name).toEqual([]);
    }
    expect(bullets("- One.\n\n  Two.\n\n  Three.\n")).toEqual([held(1, 3)]);
  });

  test("a block on the marker line itself leaves the item unread", () => {
    for (const first of ["> Quoted.", "- Nested.", "1. Nested.", "## Heading", "```", "<div>", "[guide]: https://example.org", "$$", "***", "---", "`code`"]) {
      expect(bullets(`- ${first}\n\n  Two.\n\n  Three.\n`), first).toEqual([]);
    }
  });

  test("a paragraph with code spans and text, or two code spans, counts as a paragraph", () => {
    expect(bullets("- Run it:\n\n  `make` and then `make test`.\n")).toEqual([held(1, 2)]);
    expect(bullets("- Run it:\n\n  `make` `test`\n")).toEqual([held(1, 2)]);
    expect(bullets("- Run it:\n\n  \\`make`\n")).toEqual([held(1, 2)]);
  });

  test("a table row with no delimiter row, a pipe or a hash inside text, and a mid-line < are text", () => {
    expect(bullets("- One.\n\n  | not a table |\n")).toEqual([held(1, 2)]);
    expect(bullets("- One.\n\n  Use #tags and a | b.\n")).toEqual([held(1, 2)]);
    expect(bullets("- One <b>bold</b>.\n\n  Two <br> lines.\n")).toEqual([held(1, 2)]);
  });
});

describe("an item the rule cannot read with confidence is not read", () => {
  test("an item in a quotation or after another marker on its line is not read", () => {
    expect(bullets("> - One.\n>\n>   Two.\n")).toEqual([]);
    expect(bullets("- - One.\n\n    Two.\n")).toEqual([]);
    expect(bullets("1. - One.\n\n     Two.\n")).toEqual([]);
  });

  test("an empty marker line, five spaces after the marker or a tab in the indentation leaves the item unread", () => {
    expect(bullets("-\n  One.\n\n  Two.\n")).toEqual([]);
    expect(bullets("-     One.\n\n  Two.\n")).toEqual([]);
    expect(bullets(`-${TAB}One.\n\n  Two.\n`)).toEqual([]);
    expect(bullets(`- One.\n\n${TAB}Two.\n`)).toEqual([]);
    expect(bullets(`${TAB}- One.\n\n${TAB}  Two.\n`)).toEqual([]);
    expect(bullets(`- One.\n\n ${TAB}Two.\n`)).toEqual([]);
  });

  test("a line four or more columns past the item's text leaves it unread, even inside a paragraph", () => {
    expect(bullets("- One.\n\n  Two\n      carried on.\n")).toEqual([]);
    expect(bullets("- One\n      carried on.\n\n  Two.\n")).toEqual([]);
  });

  test("a less indented line straight under the item's text, other than the next item at its indent, leaves it unread", () => {
    for (const below of ["Lazy text.", "2. Two.", "1. One.", "===", "-", "# Heading", "> Quoted.", " - Sibling.", "---", "* * *", "<div>", "```"]) {
      expect(bullets(`${TWO}${below}\n`), below).toEqual([]);
    }
    expect(bullets(`- Outer.\n  ${TWO.replaceAll("\n  ", "\n    ")}  Lazy.\n`)).toEqual([]);
  });

  test("an opener of HTML that runs past a blank line, above the item or in it, leaves it unread", () => {
    const openers = ["<!-- note -->", "<?php ?>", "<!DOCTYPE html>", "<![CDATA[ x ]]>", "<pre>x</pre>", "<pre", "<PRE class=a>", "<script>", "<style >", "<textarea>", "Text <!-- inline --> text.", "`<!-- in code -->`"];
    for (const opener of openers) {
      expect(bullets(`${opener}\n\n${TWO}`), opener).toEqual([]);
      expect(bullets(`${opener}\n\nText.\n\n${TWO}`), opener).toEqual([]);
      expect(bullets(`- One ${opener} more.\n\n  Two.\n`), opener).toEqual([]);
      expect(bullets(`- One.\n\n  Two ${opener} more.\n`), opener).toEqual([]);
    }
    expect(bullets(`\`\`\`\n<!-- x -->\n\`\`\`\n\n${TWO}`)).toEqual([]);
    expect(bullets(`${TWO}\n<!-- below -->\n`)).toEqual([held(1, 2)]);
  });

  test("a tag that is not such an opener reads as text unless a < stands between the last blank line and the marker", () => {
    for (const tag of ["<b>Bold</b>", "<div>", "<prefix>", "<scripts>", "<stylesheet>", "<a href=\"x\">", "a < b"]) {
      expect(bullets(`${tag}\n\n${TWO}`), tag).toEqual([held(3, 2)]);
      expect(bullets(`${tag}\n${TWO}`), tag).toEqual([]);
      expect(bullets(`${tag}\nText.\n${TWO}`), tag).toEqual([]);
    }
    expect(bullets(`<div>\n${NBSP}\n${TWO}`)).toEqual([]);
    expect(bullets(`Text.\n${TWO}`)).toEqual([held(2, 2)]);
    expect(bullets(`- <b>x</b>\n${TWO}`)).toEqual([]);
  });

  test("an item four or more columns in is not read, whatever stands above it; one three in is", () => {
    const nested = "- Outer.\n  - Middle.\n\n    - Deep one.\n\n      Deep two.\n";
    expect(bullets(nested)).toEqual([]);
    expect(bullets(nested.replace("    - Deep", "   - Deep").replace("      Deep two", "     Deep two"))).toEqual([held(4, 2)]);
    expect(bullets(`</frameset>\n- Swallowed.\n     - Middle.\n   \n       Body.\n    - Deep one.\n\n      Deep two.\n`)).toEqual([]);
    expect(bullets(`- Mk0 only.\n  >\n${NBSP}\n    - Deep one.\n\n      Deep two.\n`)).toEqual([]);
    expect(bullets("- Outer.\n\n   - Three in.\n\n     Two.\n")).toEqual([held(3, 2)]);
  });

  test("a line shaped like a fence anywhere above the item leaves it unread, as the reading may end a fence CommonMark keeps open", () => {
    const fences = ["```\ncode\n```", "~~~\ncode\n~~~", "````", "> ```", "- ```", "1. ~~~", "    ```", "<div>\n```\n\n```", "| a |\n|---|\n```|", "Text\n```js"];
    for (const fence of fences) {
      expect(bullets(`${fence}\n\n${TWO}`), fence).toEqual([]);
      expect(bullets(`${fence}\n\nText.\n\n${TWO}`), fence).toEqual([]);
    }
    for (const near of ["``", "Use ```x``` here.", "a ~~~ b"]) {
      expect(bullets(`${near}\n\n${TWO}`), near).toEqual([held(3, 2)]);
    }
    expect(bullets(`${TWO}\n\`\`\`\ncode\n\`\`\`\n`)).toEqual([held(1, 2)]);
  });

  test("an item on the first line of a text that starts with a byte order mark is not read; one below it is", () => {
    const mark = String.fromCharCode(0xfeff);
    expect(bullets(`${mark}${TWO}`)).toEqual([]);
    expect(bullets(`${mark}Text.\n\n${TWO}`)).toEqual([held(3, 2)]);
    expect(bullets(`Text.\n\n${TWO}`)).toEqual([held(3, 2)]);
  });

  test("a line that opens an empty container above the item leaves it unread; a lone > does not", () => {
    for (const empty of ["> >", ">>", "-", `- ${TAB}`, "1.", "> -", "- - -"]) {
      expect(bullets(`${empty}\n\nText.\n\n${TWO}`), empty).toEqual([]);
    }
    expect(bullets(`>\n\n${TWO}`)).toEqual([held(3, 2)]);
    expect(bullets(`${TWO}\n> >\n`)).toEqual([held(1, 2)]);
  });

  test("an item inside code, front matter or an HTML comment is not listed, so not read", () => {
    expect(bullets(`\`\`\`\n${TWO}\`\`\`\n`)).toEqual([]);
    expect(bullets(`    - One.\n\n      Two.\n`)).toEqual([]);
    expect(bullets(`---\ntitle: x\n---\n\n${TWO}`)).toEqual([held(5, 2)]);
  });

  test("a line that may define a link anywhere in the item leaves it unread", () => {
    expect(bullets("- One.\n\n  [label\n  spread]: https://example.org\n")).toEqual([]);
    expect(bullets("- One.\n\n  See [it](x): here.\n")).toEqual([held(1, 2)]);
  });
});

describe("bullet-paragraphs in the audits", () => {
  test("the layout rules and a Markdown audit report it; a plain text audit does not", () => {
    const text = `# Guide\n\nVersion: 1.0\n\n${TWO}`;
    expect(layoutViolations(text).filter(finding => finding.rule === "bullet-paragraphs").map(finding => finding.line)).toEqual([5]);
    expect(auditText(text, { markdown: true }).filter(finding => finding.rule === "bullet-paragraphs").map(finding => finding.line)).toEqual([5]);
    expect(auditText(text, { markdown: false }).filter(finding => finding.rule === "bullet-paragraphs")).toEqual([]);
  });
});

/** Bun's CommonMark renderer, as far as the oracle below uses it. */
interface MarkdownRenderer { render(text: string, callbacks: object): string }
/**
 * Bun's CommonMark renderer, where this Bun has one. It is a test oracle for
 * the bullet-paragraphs rule and never part of the rule: Bun 1.3.7 has none.
 */
function markdownRenderer(): MarkdownRenderer | undefined {
  return (Bun as unknown as { markdown?: MarkdownRenderer }).markdown;
}
const OPEN = String.fromCharCode(1);
const CLOSE = String.fromCharCode(2);
const SEPARATOR = String.fromCharCode(3);
/** The blocks the oracle asks Bun to name. */
const RENDERED_BLOCKS = ["blockquote", "paragraph", "heading", "list", "code", "html", "hr", "table"];

/** One node of Bun's rendering: its name and what it holds, text or nodes. */
interface RenderedNode { name: string; children: Array<RenderedNode | string> }

/** The tree Bun renders a text as, with each block and each list item named, and an item named `bullet` when its list is unordered. */
function renderedTree(renderer: MarkdownRenderer, text: string): RenderedNode {
  const callbacks: Record<string, (children: string, meta?: { ordered?: boolean }) => string> = {};
  for (const name of RENDERED_BLOCKS) {
    callbacks[name] = (children: string) => `${OPEN}${name}${SEPARATOR}${children ?? ""}${CLOSE}`;
  }
  callbacks["listItem"] = (children: string, meta?: { ordered?: boolean }) => `${OPEN}${meta?.ordered === false ? "bullet" : "step"}${SEPARATOR}${children ?? ""}${CLOSE}`;
  const shown = renderer.render(text, callbacks);
  const root: RenderedNode = { name: "root", children: [] };
  const stack: RenderedNode[] = [root];
  let index = 0;
  while (index < shown.length) {
    const top = stack[stack.length - 1] ?? root;
    if (shown[index] === OPEN) {
      const separator = shown.indexOf(SEPARATOR, index);
      const node: RenderedNode = { name: shown.slice(index + 1, separator), children: [] };
      top.children.push(node);
      stack.push(node);
      index = separator + 1;
    } else if (shown[index] === CLOSE) {
      stack.pop();
      index++;
    } else {
      let next = index;
      while (next < shown.length && shown[next] !== OPEN && shown[next] !== CLOSE) {
        next++;
      }
      top.children.push(shown.slice(index, next));
      index = next;
    }
  }
  return root;
}

/** The text a node holds. */
function textOf(node: RenderedNode | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

/** Each unordered item in Bun's rendering: the text of its first paragraph and how many paragraphs it holds directly. */
function renderedBullets(renderer: MarkdownRenderer, text: string): Array<{ first: string; paragraphs: number }> {
  const found: Array<{ first: string; paragraphs: number }> = [];
  const pending: RenderedNode[] = [renderedTree(renderer, text)];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (node.name === "bullet") {
      const paragraphs = node.children.filter((child): child is RenderedNode => typeof child !== "string" && child.name === "paragraph");
      found.push({ first: paragraphs[0] === undefined ? "" : textOf(paragraphs[0]), paragraphs: paragraphs.length });
    }
    for (const child of node.children) {
      if (typeof child !== "string") pending.push(child);
    }
  }
  return found;
}

/**
 * The findings of the rule on a text that Bun's rendering does not show as an
 * unordered item holding that many paragraphs. Each finding is matched to an
 * unordered item whose first paragraph shows the longest word of the marker
 * line, and each item matches one finding at most.
 *
 * @returns A description of each finding the rendering does not confirm.
 */
function unconfirmed(renderer: MarkdownRenderer, text: string): string[] {
  const lines = toLines(text);
  const items = renderedBullets(renderer, text);
  const used = new Set<number>();
  const missing: string[] = [];
  for (const finding of bulletParagraphViolations(text, structure(text))) {
    const count = Number(/holds (\d+) paragraphs/.exec(finding.detail)?.[1] ?? "0");
    const words = (lines[finding.line - 1] ?? "").match(/[\p{L}\p{N}]{2,}/gu) ?? [];
    let word = "";
    for (const candidate of words) {
      if (candidate.length > word.length) word = candidate;
    }
    const match = items.findIndex((item, index) => !used.has(index) && item.paragraphs === count && item.first.includes(word));
    if (match === -1) {
      missing.push(`${JSON.stringify(text)} line ${finding.line}`);
    } else {
      used.add(match);
    }
  }
  return missing;
}

describe("bullet-paragraphs checked against Bun's renderer, a test oracle", () => {
  // Bun before 1.3.8 has no renderer, so these tests are skipped there. The
  // skip shows in the test count; it is not a pass. The rule never calls it.
  const renderer = markdownRenderer();

  test.skipIf(renderer === undefined)("the oracle sees an item's paragraphs where they are, and none where the blocks differ", () => {
    if (renderer === undefined) return;
    expect(renderedBullets(renderer, TWO)).toEqual([{ first: "First paragraph.", paragraphs: 2 }]);
    expect(renderedBullets(renderer, "1. One.\n\n   Two.\n")).toEqual([]);
    expect(renderedBullets(renderer, "- One.\n- Two.\n")).toEqual([{ first: "", paragraphs: 0 }, { first: "", paragraphs: 0 }]);
    expect(renderedBullets(renderer, "- One.\n\n  | A |\n  |---|\n  | 1 |\n")).toEqual([{ first: "One.", paragraphs: 1 }]);
    expect(unconfirmed(renderer, "<div>\n- One.\n\n  Two.\n")).toEqual([]);
  });

  test.skipIf(renderer === undefined)("each specimen above that the rule reports shows as an unordered item of that many paragraphs in Bun's rendering", () => {
    if (renderer === undefined) return;
    const shown: string[] = [];
    let checked = 0;
    for (const text of SPECIMENS) {
      checked += bulletParagraphViolations(text, structure(text)).length;
      for (const missing of unconfirmed(renderer, text)) {
        shown.push(missing);
      }
    }
    expect(shown).toEqual([]);
    // The specimens above held 97 findings when this was written.
    expect(checked).toBeGreaterThanOrEqual(97);
  });

  test.skipIf(renderer === undefined)("every finding in the seeded documents below shows as an unordered item of that many paragraphs in Bun's rendering", () => {
    if (renderer === undefined) return;
    const shown: string[] = [];
    let checked = 0;
    for (const generated of seededDocuments()) {
      checked += generated.expected.length;
      for (const missing of unconfirmed(renderer, generated.text)) {
        shown.push(missing);
      }
    }
    expect(shown.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(1_000);
  }, 120_000);
});

/**
 * The ways each seeded document varies, each with its values. The first
 * value of each is the one a reported item holds when that axis is not
 * varied. Every distinction the rule keys on has an axis here.
 */
const AXES = {
  marker: ["-", "*", "+"],
  gap: ["1", "2", "3", "4", "5"],
  indent: ["0", "1", "2", "3"],
  paragraphs: ["2", "3", "1"],
  blank: ["empty", "spaces", "tab", "two"],
  wrap: ["none", "column", "deeper", "deep4"],
  extra: ["none", "fence", "tildes", "indented", "quote", "bullet", "ordered", "table", "heading", "underline", "rule", "html", "definition", "math", "span"],
  ending: ["eof", "sibling", "after-blank", "lazy", "sibling-elsewhere", "heading"],
  lineEnding: ["lf", "crlf", "cr"],
  container: ["top", "bullet", "ordered", "quote"],
  above: ["none", "text", "angle-run", "angle-blank", "comment", "pre", "empty-container", "lone-quote", "fence", "near-fence"],
} as const;
type Choice = { [Axis in keyof typeof AXES]: (typeof AXES)[Axis][number] };

/** Each value that leaves the item unread. Any other value keeps it read. */
const CLEARS: Readonly<Record<keyof typeof AXES, readonly string[]>> = {
  marker: [], gap: ["5"], indent: [], paragraphs: ["1"], blank: [], wrap: ["deep4"],
  extra: ["fence", "tildes", "indented", "quote", "bullet", "ordered", "table", "heading", "underline", "rule", "html", "definition", "math", "span"],
  ending: ["lazy", "sibling-elsewhere", "heading"], lineEnding: [], container: ["quote"],
  above: ["angle-run", "comment", "pre", "empty-container", "fence"],
};

/** The names of the axes, in order. */
const AXIS_NAMES = Object.keys(AXES) as Array<keyof typeof AXES>;

/** The block the `extra` axis puts after the paragraphs, a line for each entry. */
const EXTRA_BLOCK: Record<Choice["extra"], readonly string[]> = {
  none: [], fence: ["```", "code", "```"], tildes: ["~~~", "code", "~~~"], indented: ["    code"], quote: ["> Quoted."],
  bullet: ["- Nested."], ordered: ["1. Nested."], table: ["| A | B |", "|---|---|", "| 1 | 2 |"], heading: ["## Heading"],
  underline: ["Heading", "==="], rule: ["***"], html: ["<div>Box</div>"], definition: ["[guide]: https://example.org"],
  math: ["$$", "x", "$$"], span: ["`make test`"],
};

/** The lines the `above` axis puts above the item, the last of them straight above its marker. */
const ABOVE_LINES: Record<Choice["above"], readonly string[]> = {
  "none": [], "text": ["Lead text."], "angle-run": ["<b>Bold</b> lead."], "angle-blank": ["<b>Bold</b> lead.", ""],
  "comment": ["<!-- note -->", ""], "pre": ["<pre>x</pre>", ""], "empty-container": ["> >", "", "Lead text.", ""], "lone-quote": [">", ""],
  "fence": ["~~~", "code", "~~~", ""], "near-fence": ["Use ``x`` here.", ""],
};

/** A seeded document, the choice it was made from, and the lines the rule should report with their counts. */
interface SeededDocument { text: string; choice: Choice; expected: Array<{ line: number; paragraphs: number }> }

/** A seeded document for a choice, its words unique to its index. */
function seededDocument(choice: Choice, index: number): SeededDocument {
  const indent = " ".repeat(Number(choice.indent));
  const gap = " ".repeat(Number(choice.gap));
  const column = " ".repeat(Number(choice.indent) + 1 + Number(choice.gap));
  const blank = { empty: [""], spaces: ["   "], tab: [TAB], two: ["", ""] }[choice.blank];
  const count = Number(choice.paragraphs);
  const item: string[] = [`${indent}${choice.marker}${gap}Marker${index} first.`];
  for (let paragraph = 2; paragraph <= count; paragraph++) {
    item.push(...blank, `${column}Paragraph${paragraph} text.`);
    if (paragraph === count && choice.wrap !== "none") {
      const deeper = { column: "", deeper: "  ", deep4: "    " }[choice.wrap];
      item.push(`${column}${deeper}carried on.`);
    }
  }
  if (count === 1 && choice.wrap !== "none") {
    const deeper = { column: "", deeper: "  ", deep4: "    " }[choice.wrap];
    item.push(`${column}${deeper}carried on.`);
  }
  if (choice.extra !== "none") item.push("", ...EXTRA_BLOCK[choice.extra].map(line => `${column}${line}`));
  const after = {
    "eof": [], "sibling": [`${indent}${choice.marker} Sibling item.`], "after-blank": ["", "After the list."],
    "lazy": ["Lazy line."], "sibling-elsewhere": [`${choice.indent === "0" ? " " : ""}${choice.marker} Elsewhere item.`], "heading": ["# Heading"],
  }[choice.ending];
  const body = [...ABOVE_LINES[choice.above], ...item, ...after];
  const prefixed = {
    top: { lead: [], prefix: "" }, bullet: { lead: ["- Parent item."], prefix: "  " },
    ordered: { lead: ["1. Parent step."], prefix: "   " }, quote: { lead: [], prefix: "> " },
  }[choice.container];
  const lines = ["# Seeded", "", ...prefixed.lead, ...body.map(line => line === "" && choice.container !== "quote" ? "" : `${prefixed.prefix}${line}`)];
  const markerLine = 3 + prefixed.lead.length + ABOVE_LINES[choice.above].length;
  const ending = { lf: "\n", crlf: "\r\n", cr: CR }[choice.lineEnding];
  // A marker four or more spaces in is not read, which the container and
  // indent axes decide together.
  const deep = prefixed.prefix.length + Number(choice.indent) >= 4;
  const reported = !deep && AXIS_NAMES.every(axis => !CLEARS[axis].includes(choice[axis]));
  return { text: lines.join(ending) + ending, choice, expected: reported ? [{ line: markerLine, paragraphs: count }] : [] };
}

/** A small seeded random number generator, so every run makes the same documents. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 9,000 seeded documents, each axis varied in about a quarter of them. */
function seededDocuments(): SeededDocument[] {
  const random = seededRandom(24_495);
  const documents: SeededDocument[] = [];
  for (let index = 0; index < 9_000; index++) {
    const choice: Record<string, string> = {};
    for (const [axis, values] of Object.entries(AXES)) {
      const vary = random() < 0.25;
      choice[axis] = vary ? values[Math.floor(random() * values.length)] ?? values[0] : values[0];
    }
    documents.push(seededDocument(choice as Choice, index));
  }
  return documents;
}

describe("bullet-paragraphs on seeded documents that vary every distinction it keys on", () => {
  test("each document gives exactly the lines and counts its choice should, and every value of every axis is met where it can change the result", () => {
    const documents = seededDocuments();
    const wrong: string[] = [];
    const seen = new Set<string>();
    const seenReported = new Set<string>();
    for (const generated of documents) {
      const found = bulletParagraphViolations(generated.text, structure(generated.text))
        .map(finding => ({ line: finding.line, paragraphs: Number(/holds (\d+)/.exec(finding.detail)?.[1]) }));
      if (JSON.stringify(found) !== JSON.stringify(generated.expected)) wrong.push(`${JSON.stringify(generated.text)} gave ${JSON.stringify(found)}, not ${JSON.stringify(generated.expected)}`);
      for (const [axis, value] of Object.entries(generated.choice)) {
        seen.add(`${axis}=${value}`);
        if (generated.expected.length > 0) seenReported.add(`${axis}=${value}`);
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    const neverSeen: string[] = [];
    const neverReported: string[] = [];
    for (const axis of AXIS_NAMES) {
      for (const value of AXES[axis]) {
        if (!seen.has(`${axis}=${value}`)) neverSeen.push(`${axis}=${value}`);
        const clears = CLEARS[axis].includes(value);
        if (!clears && !seenReported.has(`${axis}=${value}`)) neverReported.push(`${axis}=${value}`);
      }
    }
    expect(neverSeen).toEqual([]);
    expect(neverReported).toEqual([]);
    expect(documents.filter(generated => generated.expected.length > 0).length).toBeGreaterThanOrEqual(1_000);
  }, 60_000);
});

/** The fastest of three runs of the rule's guards over a text, given no items, in milliseconds. */
function fastestGuards(text: string): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    bulletParagraphViolations(text, { items: [] });
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

/** The findings and the count of lines the rule read for a text. */
function counted(text: string): { findings: number; read: number; lines: number } {
  const tally = { lines: 0 };
  const findings = bulletParagraphViolations(text, structure(text), tally).length;
  return { findings, read: tally.lines, lines: toLines(text).length };
}

describe("bullet-paragraphs reads each line at most once, in time in proportion to the text", () => {
  test("100,000 items of two paragraphs read no line twice and give 100,000 findings", () => {
    const result = counted("- One.\n\n  Two.\n".repeat(100_000));
    expect(result.findings).toBe(100_000);
    expect(result.read).toBeLessThanOrEqual(result.lines);
    expect(result.read).toBeGreaterThan(0);
  }, 120_000);

  test("100,000 items in a tight list, with no blank line above any of them, read no line twice", () => {
    const result = counted("- Item <b>x</b>.\n".repeat(100_000));
    expect(result.findings).toBe(0);
    expect(result.read).toBeLessThanOrEqual(result.lines);
  }, 120_000);

  test("items nested 300 deep, and an item of a million blank lines, read no line twice", () => {
    let nested = "";
    for (let depth = 0; depth < 300; depth++) {
      nested += `${" ".repeat(depth * 2)}- Level.\n`;
    }
    const deep = counted(nested);
    expect(deep.read).toBeLessThanOrEqual(deep.lines);
    const wide = counted(`- One.\n${"\n".repeat(1_000_000)}  Two.\n`);
    expect(wide.findings).toBe(1);
    expect(wide.read).toBeLessThanOrEqual(wide.lines);
  }, 120_000);

  test("a paragraph of 100,000 backtick runs, and lines of a million characters, scan as fast as the parse", () => {
    for (const body of ["` ``".repeat(100_000), "-:| ".repeat(250_000), "]".repeat(1_000_000), "<".repeat(1_000_000), "`".repeat(1_000_000)]) {
      const text = `- One.\n\n  ${body}x\n`;
      const parsed = structure(text);
      const started = performance.now();
      bulletParagraphViolations(text, parsed);
      const scan = performance.now() - started;
      const parseStarted = performance.now();
      structure(text);
      expect(scan, body.slice(0, 6)).toBeLessThan(3 * (performance.now() - parseStarted) + 50);
    }
  }, 120_000);

  // Each line here is almost the start of a fence, a container or HTML until
  // its last character, so a guard that rescans it from each position fails.
  // The guards read every line whatever the items, so no items are passed:
  // the parse of lines of nested markers takes time in the square of their
  // number, before the rule runs. The baseline is the same guards over a
  // line of plain letters of the same length.
  test("lines of a million characters that almost open a fence, a container or HTML take the guards as long as plain text", () => {
    for (const line of ["> ".repeat(500_000), "- ".repeat(500_000), "1. ".repeat(300_000), "1".repeat(1_000_000), `${" ".repeat(999_999)}\t`, "<!".repeat(500_000), ">".repeat(1_000_000)]) {
      const plain = "x".repeat(line.length);
      expect(fastestGuards(`${line}x\n`), line.slice(0, 6)).toBeLessThan(3 * fastestGuards(`${plain}x\n`) + 50);
    }
  }, 120_000);
});
