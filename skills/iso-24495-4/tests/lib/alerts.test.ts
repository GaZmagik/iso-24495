import { describe, expect, test } from "bun:test";
import { adjacentAlertViolations } from "../../scripts/lib/alerts.ts";
import { layoutViolations } from "../../scripts/lib/layout.ts";
import { structure, toLines } from "../../scripts/lib/parse.ts";
import { auditText } from "../../scripts/audit-corpus.ts";

const KINDS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);
const NBSP = String.fromCharCode(0xa0);
const ZERO_WIDTH = String.fromCharCode(0x200b);

/** Every text a test below gave the rule, so the oracle can check each finding it made. */
const SPECIMENS = new Set<string>();

/** The adjacent-alerts findings for a text, as the rule gives them. */
function alerts(text: string): Array<{ line: number; detail: string }> {
  SPECIMENS.add(text);
  return adjacentAlertViolations(text, structure(text)).map(finding => ({ line: finding.line, detail: finding.detail }));
}

/** The finding for an alert of this kind on this line that follows one on the first line given. */
function adjacent(kind: string, first: number, line: number): { line: number; detail: string } {
  return { line, detail: `This ${kind} alert follows the ${kind} alert on line ${first} with only blank lines between. If the two serve one purpose, merge them into one alert.` };
}

/** Two alerts of the given kinds, the first on line 1 and the second on line 4. */
function pair(first: string, second: string): string {
  return `> [!${first}]\n> One.\n\n> [!${second}]\n> Two.\n`;
}

describe("the structural reading lists each quotation outside every container", () => {
  test("a quotation gives the line it opens on, the line it ends on, and its alert kind", () => {
    expect(structure("> [!NOTE]\n> One.\n\n> [!TIP]\n> Two.\n> More.\n").quotations).toEqual([
      { line: 1, end: 2, alert: "NOTE" },
      { line: 4, end: 6, alert: "TIP" },
    ]);
    expect(structure("> A plain quotation.\n").quotations).toEqual([{ line: 1, end: 1, alert: null }]);
    expect(structure("").quotations).toEqual([]);
    expect(structure("Text.\n").quotations).toEqual([]);
  });

  test("a lazy line, a marker-only line and a table row are part of the quotation", () => {
    expect(structure("> [!NOTE]\n> One\ncarried on.\n\nAfter.\n").quotations).toEqual([{ line: 1, end: 3, alert: "NOTE" }]);
    expect(structure("> One\ncarried on.\n\nAfter.\n").quotations).toEqual([{ line: 1, end: 2, alert: null }]);
    expect(structure("> [!NOTE]\n> One.\n>\n\nAfter.\n").quotations).toEqual([{ line: 1, end: 3, alert: "NOTE" }]);
    expect(structure("> | A | B |\n> |---|---|\n> | 1 | 2 |\n\nAfter.\n").quotations).toEqual([{ line: 1, end: 3, alert: null }]);
    expect(structure("> ```\n> code\n> ```\n").quotations).toEqual([{ line: 1, end: 3, alert: null }]);
  });

  test("the kind is read in any letter case and given in capitals; a marker with other text is no alert", () => {
    expect(structure("> [!note]\n> One.\n").quotations).toEqual([{ line: 1, end: 2, alert: "NOTE" }]);
    expect(structure("> [!Caution]\n> One.\n").quotations).toEqual([{ line: 1, end: 2, alert: "CAUTION" }]);
    expect(structure("> [!NOTE] Read this.\n> One.\n").quotations).toEqual([{ line: 1, end: 2, alert: null }]);
    expect(structure("> [!DANGER]\n> One.\n").quotations).toEqual([{ line: 1, end: 2, alert: null }]);
    expect(structure("> Lead.\n> [!NOTE]\n> One.\n").quotations).toEqual([{ line: 1, end: 3, alert: null }]);
  });

  test("a marker indented four columns past the quotation's marker is code, not an alert", () => {
    expect(structure(">     [!NOTE]\n> One.\n").quotations).toEqual([{ line: 1, end: 2, alert: null }]);
    expect(structure(">    [!NOTE]\n> One.\n").quotations).toEqual([{ line: 1, end: 2, alert: "NOTE" }]);
    expect(structure(`>${TAB}[!NOTE]\n> One.\n`).quotations).toEqual([{ line: 1, end: 2, alert: "NOTE" }]);
  });

  test("a quotation on the last line of a text without a final line break ends there", () => {
    expect(structure("> [!NOTE]\n> One.").quotations).toEqual([{ line: 1, end: 2, alert: "NOTE" }]);
    expect(structure("Text.\n\n> One.\nTwo.").quotations).toEqual([{ line: 3, end: 4, alert: null }]);
  });

  test("a quotation inside a list item or another quotation is not listed on its own", () => {
    expect(structure("- > [!NOTE]\n  > One.\n").quotations).toEqual([]);
    expect(structure("> > [!NOTE]\n> > One.\n").quotations).toEqual([{ line: 1, end: 2, alert: null }]);
    expect(structure("```\n> [!NOTE]\n> One.\n```\n").quotations).toEqual([]);
  });
});

describe("adjacent-alerts: two alerts of one kind with only blank lines between", () => {
  test("two alerts of each kind with one blank line between give one finding, on the second", () => {
    for (const kind of KINDS) {
      expect(alerts(pair(kind, kind)), kind).toEqual([adjacent(kind, 1, 4)]);
    }
  });

  test("alerts of different kinds are not reported", () => {
    for (const first of KINDS) {
      for (const second of KINDS.filter(kind => kind !== first)) {
        expect(alerts(pair(first, second)), `${first} then ${second}`).toEqual([]);
      }
    }
  });

  test("the kind matches in any letter case, and the finding names it in capitals", () => {
    expect(alerts(pair("note", "Note"))).toEqual([adjacent("NOTE", 1, 4)]);
    expect(alerts(pair("WARNING", "warning"))).toEqual([adjacent("WARNING", 1, 4)]);
  });

  test("three in a row give a finding on the second and the third", () => {
    const text = "> [!TIP]\n> One.\n\n> [!TIP]\n> Two.\n\n\n> [!TIP]\n> Three.\n";
    expect(alerts(text)).toEqual([adjacent("TIP", 1, 4), adjacent("TIP", 4, 8)]);
  });

  test("blank lines of spaces or tabs, and any number of them, count as blank", () => {
    expect(alerts("> [!NOTE]\n> One.\n   \n\n\n> [!NOTE]\n> Two.\n")).toEqual([adjacent("NOTE", 1, 6)]);
    expect(alerts(`> [!NOTE]\n> One.\n${TAB}\n> [!NOTE]\n> Two.\n`)).toEqual([adjacent("NOTE", 1, 4)]);
  });

  test("an alert on the first line, after a blank line, or after front matter and a blank line is read", () => {
    expect(alerts(`# Guide\n\n${pair("NOTE", "NOTE")}`)).toEqual([adjacent("NOTE", 3, 6)]);
    expect(alerts(`---\ntitle: Guide\n---\n\n${pair("NOTE", "NOTE")}`)).toEqual([adjacent("NOTE", 5, 8)]);
  });

  test("line endings of every kind give the same lines, with or without one at the end", () => {
    const text = pair("NOTE", "NOTE");
    expect(alerts(text.slice(0, -1))).toEqual([adjacent("NOTE", 1, 4)]);
    expect(alerts(text.replaceAll("\n", `${CR}\n`))).toEqual([adjacent("NOTE", 1, 4)]);
    expect(alerts(text.replaceAll("\n", CR))).toEqual([adjacent("NOTE", 1, 4)]);
  });

  test("a body of any script or of several blocks is read", () => {
    expect(alerts("> [!NOTE]\n> Réglez la vanne.\n\n> [!NOTE]\n> 弁を閉じてください。\n")).toEqual([adjacent("NOTE", 1, 4)]);
    expect(alerts("> [!NOTE]\n> One.\n>\n> - A list.\n\n> [!NOTE]\n> ## Two\n")).toEqual([adjacent("NOTE", 1, 6)]);
    expect(alerts("> [!NOTE]\n> One\ncarried on lazily.\n\n> [!NOTE]\n> Two.\n")).toEqual([adjacent("NOTE", 1, 5)]);
  });

  test("anything but a blank line between them clears the finding", () => {
    for (const between of ["A paragraph.", "<!-- a comment -->", "[guide]: guide.md", "---", "## A heading", ZERO_WIDTH, NBSP, "- An item.", "| A |\n|---|"]) {
      expect(alerts(`> [!NOTE]\n> One.\n\n${between}\n\n> [!NOTE]\n> Two.\n`), JSON.stringify(between)).toEqual([]);
    }
  });

  test("one quotation holding a second marker is one alert, so nothing is reported", () => {
    expect(alerts("> [!NOTE]\n> One.\n>\n> [!NOTE]\n> Two.\n")).toEqual([]);
    expect(alerts("> [!NOTE]\n> One.\n> [!NOTE]\n> Two.\n")).toEqual([]);
  });

  test("alerts in a list, a quotation, a fence, an HTML block or a table are not read", () => {
    expect(alerts("- > [!NOTE]\n  > One.\n\n  > [!NOTE]\n  > Two.\n")).toEqual([]);
    expect(alerts("> > [!NOTE]\n> > One.\n>\n> > [!NOTE]\n> > Two.\n")).toEqual([]);
    expect(alerts(`\`\`\`\n${pair("NOTE", "NOTE")}\`\`\`\n`)).toEqual([]);
    expect(alerts(`<!--\n${pair("NOTE", "NOTE")}-->\n`)).toEqual([]);
    expect(alerts("| > [!NOTE] |\n|---|\n| > [!NOTE] |\n")).toEqual([]);
  });

  test("an alert straight below a line that is not blank is not read, so a <div> above cannot make one", () => {
    expect(alerts(`<div>\n${pair("NOTE", "NOTE")}`)).toEqual([]);
    expect(alerts(`Text.\n${pair("NOTE", "NOTE")}`)).toEqual([]);
    expect(alerts(`# Guide\n${pair("NOTE", "NOTE")}`)).toEqual([]);
    expect(alerts(`---\ntitle: Guide\n---\n${pair("NOTE", "NOTE")}`)).toEqual([]);
  });

  test("an alert whose next line is not text inside it is not read", () => {
    for (const body of ["", ">", "> ---", "> ===", "> ***", "> - - -", "> <!-- c -->", "> <div>", "> <b>Bold</b> text."]) {
      const first = body === "" ? "> [!NOTE]\n" : `> [!NOTE]\n${body}\n`;
      expect(alerts(`${first}\n> [!NOTE]\n> Two.\n`), JSON.stringify(body)).toEqual([]);
      expect(alerts(`> [!NOTE]\n> One.\n\n${first}`), `second ${JSON.stringify(body)}`).toEqual([]);
    }
  });

  test("an alert whose first paragraph becomes a heading or a table header is not read", () => {
    expect(alerts("> [!NOTE]\n> One.\n> ===\n\n> [!NOTE]\n> Two.\n")).toEqual([]);
    expect(alerts("> [!NOTE]\n> One.\n> More.\n> ---\n\n> [!NOTE]\n> Two.\n")).toEqual([]);
    expect(alerts("> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n> ===\n")).toEqual([]);
    expect(alerts("> [!NOTE]\n> |---|\n> | x |\n\n> [!NOTE]\n> Two.\n")).toEqual([]);
    expect(alerts("> [!NOTE]\n> :---:|\n\n> [!NOTE]\n> Two.\n")).toEqual([]);
    // An underline below a later block leaves the marker's paragraph alone.
    expect(alerts("> [!NOTE]\n> ## Head\n> More.\n> ===\n\n> [!NOTE]\n> Two.\n")).toEqual([adjacent("NOTE", 1, 6)]);
    expect(alerts("> [!NOTE]\n> One.\n> More.\n\n> [!NOTE]\n> Two.\n")).toEqual([adjacent("NOTE", 1, 5)]);
  });

  test("an alert inside an HTML block that runs over blank lines is not read", () => {
    for (const opening of ["<pre", "<PRE", "<script", "<style", "<textarea", "<pre class=\"x\"", "<![CDATA[", "<!--", "<?php", "<!DOCTYPE", "   <pre"]) {
      expect(alerts(`${opening}\n\n${pair("NOTE", "NOTE")}`), opening).toEqual([]);
    }
    // A block closed above the alerts leaves them to be read.
    expect(alerts(`<pre>\n</pre>\n\n${pair("NOTE", "NOTE")}`)).toEqual([adjacent("NOTE", 4, 7)]);
    expect(alerts(`<!-- c -->\n\n${pair("NOTE", "NOTE")}`)).toEqual([adjacent("NOTE", 3, 6)]);
    expect(alerts(`<![CDATA[ x ]]>\n\n${pair("NOTE", "NOTE")}`)).toEqual([adjacent("NOTE", 3, 6)]);
    expect(alerts(`<?php x ?>\n\n${pair("NOTE", "NOTE")}`)).toEqual([adjacent("NOTE", 3, 6)]);
    // CommonMark ends a processing instruction only at `?>`, so a `>` in a table row above the alerts does not.
    expect(alerts(`<?php\n\n| </div> |\n|---|\n\n${pair("NOTE", "NOTE")}`)).toEqual([]);
    // Four spaces in is code.
    expect(alerts(`    <pre\n\n${pair("NOTE", "NOTE")}`)).toEqual([adjacent("NOTE", 3, 6)]);
    // A tag whose end is not on its line is not read as closed: HTML reads
    // `<pre` and the next line `</pre>` as one start tag, so the pre holds the
    // alerts. Inside a list item the item may end it, but the rule is not sure.
    expect(alerts(`<pre\n</pre>\n\n${pair("NOTE", "NOTE")}`)).toEqual([]);
    expect(alerts(`- <pre\n\n${pair("NOTE", "NOTE")}`)).toEqual([]);
  });

  test("an alert inside an HTML element that an earlier line opened is not read", () => {
    const wrappers: Array<[string, string]> = [
      ["<details>\n<summary>Notes</summary>\n\n", "\n</details>\n"],
      ["<div>\n\n", "\n</div>\n"],
      ["<DIV class=\"note\">\n\n", "\n</DIV>\n"],
      ["<div\n  class=\"note\">\n\n", "\n</div>\n"],
      ["<table><tr><td>\n\n", "\n</td></tr></table>\n"],
      ["<blockquote>\n\n", "\n</blockquote>\n"],
      ["<p align=\"center\">\n<img src=\"logo.png\" alt=\"Logo\">\n\n", ""],
      ["Text <span>open.\n\n", ""],
      ["<details>\n\n", ""],
      ["<details\n\n", ""],
      ["<div>\n<details>\n</div>\n\n", ""],
      ["<div></div>\n```\n<details>\n```\n\n", ""],
      ["<script>let tag = \"<details>\";\n\n", ""],
      // GitHub shows a script, style or textarea tag as text, so a tag inside one is read.
      ["Text <script>\n<details>\n</script>\n\n", ""],
      ["<script>\n<details>\n</script>\n\n", ""],
      ["<textarea>\n<div>\n</textarea>\n\n", ""],
      ["<script>\nlet tag = \"<details>\";\n</script>\n\n", ""],
      // A raw block opened by a tag that ends on a later line, and a CDATA section, run on over blank lines.
      ["<script\n  id=\"y\">\n\n", ""],
      ["<![CDATA[\n<details>\n\n", ""],
      // An end tag of pre closes only the innermost pre.
      ["<pre>\n<pre>\n<details>\n</pre>\n\n", ""],
      // A comment Markdown does not end, or one that seems to run over a blank line, may hide a tag.
      ["Text <!-- open\n\n", ""],
      ["Text <!-- a\n\n<details>\n\n# Head -->\n\n", ""],
      ["<details\n<!-- c -->\n\n", ""],
      // HTML ignores the end tag of a `span` or `kbd` from inside a later paragraph or list item.
      ["<span>\n\nText </span>\n\n", ""],
      ["<kbd>\n\n- Item </kbd>\n\n", ""],
      ["<b>\n\nText </b>\n\n", ""],
      // HTML reads the rest of the line a raw block's end tag stands on, which the structural reading hides.
      ["<pre>\nx\n</pre><details>\n\n", ""],
      ["<pre>x</pre><details>\n\n", ""],
      // Inside an HTML block HTML reads a wider tag name than CommonMark.
      ["<div></div>\n<my_tag>\n\n", ""],
      ["<div></div>\n<o:p>\n\n", ""],
      ["<div></div>\n<a.b>\n\n", ""],
      // A start tag that holds a `<`, or runs over a blank line, may swallow a tag that HTML reads.
      ["Text <b c\n<details>\n</b>\n\n", ""],
      ["<div title=\"a\n\n<details>\n\n\" >\n\n</div>\n\n", ""],
      // An end tag of an element opened before the last one leaves the rule unsure, though here HTML closes both.
      ["<div>\n<span>\n</div>\n</span>\n</div>\n\n", ""],
      // CommonMark ends a comment only at `-->`, and a raw block at any of its end tags, even inside a comment.
      ["<!-- a --!>\n\n", ""],
      ["<pre>\n<!-- </pre> -->\n\n", ""],
      // An end tag of an element Markdown writes for a block may close Markdown's own.
      ["Text <li>\n- Item </li>\n\n", ""],
      // A label of a full reference, and a definition's title on a later line, are not HTML.
      ["<details>\n\n[x][</details>]\n\n[</details>]: /u\n\n", ""],
      ["<details>\n\n[d]:\n  /u\n  \"</details>\"\n\n", ""],
      // A complete pre holds both.
      ["<pre>\n", "</pre>\n"],
    ];
    for (const [before, after] of wrappers) {
      expect(alerts(`${before}${pair("NOTE", "NOTE")}${after}`), before).toEqual([]);
    }
    // HTML that closes between the alerts still holds the first.
    expect(alerts("<div>\n\n> [!NOTE]\n> One.\n\n</div>\n\n> [!NOTE]\n> Two.\n")).toEqual([]);
  });

  test("an end tag that may be text closes nothing, so an alert after it is not read", () => {
    const backslash = String.fromCharCode(92);
    for (const closing of ["Use `</details>` to end it.", "Use ``a `</details>` b`` to end it.", "Use `a\n</details>` to end it.", `${backslash}</details>`, "<!-- </details> -->",
      "[End](</details>)", "[End]( </details> )", "[End](url \"x </details>\")", "[End](a(b) </details>)", "[end]: </details>", "[end]:\n  </details>","</details foo=\"bar\">",
      "# Notes <!-- </details> -->", "</details\n\n", "# Use `</details>` now", "Setext `</details>`\n===", `# Head ${backslash}</details>`,
      "| Tag |\n|---|\n| `</details>` |", `| Tag |\n|---|\n| ${backslash}</details> |`, "# Run <style>`</style>` now",
      // HTML closes nothing outside a table cell from inside it, and a row needs no pipe.
      "| Notes |\n|---|\n| End </details> |", "| Notes |\n|---|\nEnd </details>",
      // An image's alternative text is not HTML.
      "![End </details>](end.png)", "![a [b] </details>](end.png)"]) {
      expect(alerts(`<details>\n\n${closing}\n\n${pair("NOTE", "NOTE")}`), closing).toEqual([]);
    }
  });

  test("HTML closed above the alerts, void or written as text leaves them to be read", () => {
    const backslash = String.fromCharCode(92);
    for (const before of ["<details>\n<summary>Notes</summary>\n\nBody.\n\n</details>", "<p align=\"center\"><a href=\"https://example.org\"><img src=\"logo.png\" alt=\"Logo\"></a></p>",
      "<p align=\"center\">\n  <img src=\"logo.png\" alt=\"Logo\" />\n</p>", "<picture>\n<source media=\"(prefers-color-scheme: dark)\" srcset=\"dark.png\" />\n<img alt=\"Chart\" src=\"light.png\">\n</picture>",
      "Press <kbd>Ctrl</kbd> and <kbd>C</kbd>.<br>Then wait.", "Use `<details>` to fold text.", `Write ${backslash}<details> to fold text.`, "See <https://example.org> or <a@example.org>.",
      "<!-- <details> -->", "<DETAILS>\n\nBody.\n\n</details >", "<div title=\"</div>\">\nBody.\n</div>",
      "# Notes <!-- <details> -->", "# Notes <!--> <!---> done", "<details>\n\nBody.\n\n# Notes </details>", "<div>\n\nText </div>", "1. Open the page at\n   <https://example.org/home> to start.", "<details>\n\n- Item </details>",
      "<span>\nText </span>", "<details>\n\n![Logo](logo.png) </details>", `${String.fromCharCode(0x130).repeat(4)} <style>x</style> after.`, "Text <style>x</style> after.", "Text <script>\n\nMore.", "Text <script>a</scripts> b</script> more."]) {
      expect(alerts(`${before}\n\n${pair("NOTE", "NOTE")}`), before).toEqual([adjacent("NOTE", before.split("\n").length + 2, before.split("\n").length + 5)]);
    }
    // HTML inside the earlier alert, closed there, leaves the later one read.
    expect(alerts("> [!NOTE]\n> Press <kbd>Ctrl</kbd>.\n\n> [!NOTE]\n> Two.\n")).toEqual([adjacent("NOTE", 1, 4)]);
    // A tag, an end tag or a link left unfinished at the end of the text holds nothing above it.
    // The tag above makes the rule read HTML at all.
    for (const tail of ["<details open", "</details   ", "[a](x"]) {
      expect(alerts(`<b>Bold</b>\n\n${pair("NOTE", "NOTE")}\n${tail}`), tail).toEqual([adjacent("NOTE", 3, 6)]);
    }
  });

  test("HTML on the marker line makes it no marker", () => {
    expect(alerts("> [!NOTE]<!-- c -->\n> One.\n\n> [!NOTE]\n> Two.\n")).toEqual([]);
    expect(alerts("> [!NOTE] <b>Read</b>\n> One.\n\n> [!NOTE]\n> Two.\n")).toEqual([]);
    expect(alerts("> <b>[!NOTE]</b>\n> One.\n\n> <b>[!NOTE]</b>\n> Two.\n")).toEqual([]);
  });

  test("a document that defines the marker as a link label is not read, as the marker may then be a link", () => {
    expect(alerts(`${pair("NOTE", "NOTE")}\n[!NOTE]: https://example.org\n`)).toEqual([]);
    expect(alerts(`${pair("NOTE", "NOTE")}\n[!note]:\n  https://example.org\n`)).toEqual([]);
    expect(alerts(`${pair("NOTE", "NOTE")}\n[ !Note ]: https://example.org\n`)).toEqual([]);
    expect(alerts(`${pair("NOTE", "NOTE")}\n[\\!NOTE]: https://example.org\n`)).toEqual([]);
    // Another kind's label leaves this kind alone.
    expect(alerts(`${pair("NOTE", "NOTE")}\n[!TIP]: https://example.org\n`)).toEqual([adjacent("NOTE", 1, 4)]);
  });

  test("a marker with text after it, an unknown kind or an escaped bracket opens no alert", () => {
    expect(alerts("> [!NOTE] Read this.\n> One.\n\n> [!NOTE]\n> Two.\n")).toEqual([]);
    expect(alerts(pair("DANGER", "DANGER"))).toEqual([]);
    expect(alerts("> \\[!NOTE]\n> One.\n\n> \\[!NOTE]\n> Two.\n")).toEqual([]);
  });
});

describe("adjacent-alerts in the audits", () => {
  test("the layout rules and a Markdown audit report it; a plain text audit does not", () => {
    const text = `# Guide\n\nVersion: 1.0\n\n${pair("NOTE", "NOTE")}`;
    expect(layoutViolations(text).filter(finding => finding.rule === "adjacent-alerts").map(finding => finding.line)).toEqual([8]);
    expect(auditText(text, { markdown: true }).filter(finding => finding.rule === "adjacent-alerts").map(finding => finding.line)).toEqual([8]);
    expect(auditText(text, { markdown: false }).filter(finding => finding.rule === "adjacent-alerts")).toEqual([]);
  });
});

/** Bun's CommonMark renderer, as far as the oracle below uses it. */
interface MarkdownRenderer { render(text: string, callbacks: object): string; html(text: string): string }
/**
 * Bun's CommonMark renderer, where this Bun has one. It is a test oracle for
 * the adjacent-alerts rule and never part of the rule: Bun 1.3.7 has none.
 */
function markdownRenderer(): MarkdownRenderer | undefined {
  return (Bun as unknown as { markdown?: MarkdownRenderer }).markdown;
}
const OPEN = String.fromCharCode(1);
const CLOSE = String.fromCharCode(2);
/** The blocks, and the inline marks that can hide a marker, the oracle asks Bun to name. */
const RENDERED_NODES = ["blockquote", "paragraph", "heading", "list", "listItem", "code", "html", "hr", "table", "thead", "tbody", "tr", "th", "td", "br", "link", "image"];
const RENDERED_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(\n|$)/i;

/** One node of Bun's rendering: its name and what it holds, text or nodes. */
interface RenderedNode { name: string; children: Array<RenderedNode | string> }

/** The tree Bun renders a text as, with every node the oracle reads named. */
function renderedTree(renderer: MarkdownRenderer, text: string): RenderedNode {
  const callbacks: Record<string, (children: string) => string> = {};
  for (const name of RENDERED_NODES) {
    callbacks[name] = (children: string) => `${OPEN}${name}:${children ?? ""}${CLOSE}`;
  }
  const shown = renderer.render(text, callbacks);
  const root: RenderedNode = { name: "root", children: [] };
  const stack: RenderedNode[] = [root];
  let index = 0;
  while (index < shown.length) {
    const top = stack[stack.length - 1] ?? root;
    if (shown[index] === OPEN) {
      const colon = shown.indexOf(":", index);
      const node: RenderedNode = { name: shown.slice(index + 1, colon), children: [] };
      top.children.push(node);
      stack.push(node);
      index = colon + 1;
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

/** The text a node holds, with each image and code block standing as a visible mark and comments and rules left out. */
function visibleText(node: RenderedNode | string): string {
  if (typeof node === "string") return node;
  if (node.name === "html" || node.name === "hr") return "";
  const inner = node.children.map(visibleText).join("");
  return node.name === "image" || node.name === "code" ? `[${node.name}]${inner}` : inner;
}

/** The nodes a node holds, without text of only white space between them. */
function blocksOf(node: RenderedNode): Array<RenderedNode | string> {
  return node.children.filter(child => typeof child !== "string" || child.trim() !== "");
}

/**
 * The alert kind of a node of Bun's rendering, or null when it is no alert:
 * a quotation whose first block is a paragraph opening with the marker alone
 * on its line, with something visible after the marker.
 */
function renderedAlert(node: RenderedNode | string): string | null {
  if (typeof node === "string" || node.name !== "blockquote") return null;
  const [first, ...rest] = blocksOf(node);
  if (first === undefined || typeof first === "string" || first.name !== "paragraph") return null;
  const [lead, ...after] = first.children;
  if (typeof lead !== "string") return null;
  const marker = RENDERED_MARKER.exec(lead);
  if (marker === null) return null;
  if (marker[2] === "" && after.length > 0 && (typeof after[0] === "string" || after[0]?.name !== "br")) return null;
  const body = lead.slice(marker[0].length) + after.map(visibleText).join("") + rest.map(visibleText).join("");
  return body.trim() === "" ? null : (marker[1] ?? "").toUpperCase();
}

/**
 * Each pair of alerts of one kind that Bun's rendering shows side by side at
 * the top level of the text, nothing between them: the kind, and the visible
 * text of the second.
 */
function renderedPairs(renderer: MarkdownRenderer, text: string): Array<{ kind: string; text: string }> {
  const blocks = blocksOf(renderedTree(renderer, text));
  const pairs: Array<{ kind: string; text: string }> = [];
  for (let index = 1; index < blocks.length; index++) {
    const before = blocks[index - 1];
    const block = blocks[index];
    const kind = block === undefined ? null : renderedAlert(block);
    if (kind !== null && before !== undefined && renderedAlert(before) === kind && block !== undefined) pairs.push({ kind, text: visibleText(block) });
  }
  return pairs;
}

/**
 * The findings of the rule on a text that Bun's rendering does not show as
 * adjacent alerts of one kind. Each finding is matched to a pair of the same
 * kind whose second alert shows the longest word of the line after its
 * marker, and each pair matches one finding at most.
 *
 * @returns A description of each finding the rendering does not confirm.
 */
function unconfirmed(renderer: MarkdownRenderer, text: string): string[] {
  const lines = toLines(text);
  const pairs = renderedPairs(renderer, text);
  const used = new Set<number>();
  const missing: string[] = [];
  for (const finding of adjacentAlertViolations(text, structure(text))) {
    const kind = /This (\w+) alert/.exec(finding.detail)?.[1] ?? "";
    const words = (lines[finding.line] ?? "").match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    let word = "";
    for (const candidate of words) {
      if (candidate.length > word.length) word = candidate;
    }
    const match = pairs.findIndex((found, index) => !used.has(index) && found.kind === kind && found.text.includes(word));
    if (match === -1) {
      missing.push(`${JSON.stringify(text)} line ${finding.line}`);
    } else {
      used.add(match);
    }
  }
  return missing;
}


/**
 * The tags GitHub's Markdown specification filters, by replacing their `<`
 * with `&lt;`. Bun does not, so the oracle does it to Bun's HTML.
 */
const GITHUB_TAG_FILTER = /<(\/?)(title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?=[\s/>]|$)/gi;

/**
 * For each quotation `structure` lists, in order, whether the HTML Bun
 * renders the text as, with GitHub's tag filter applied, holds it inside no
 * element at all. Bun's callback tree
 * shows raw HTML as nodes beside a quotation, never around it, so this reads
 * the rendered HTML instead, with Bun's HTMLRewriter. The quotations are
 * matched in order to the rendered quotations that no list item or other
 * quotation holds.
 *
 * @returns One entry for each quotation, or null when the two counts differ
 *     and the quotations cannot be matched.
 */
async function topLevelQuotations(renderer: MarkdownRenderer, text: string): Promise<boolean[] | null> {
  const rendered: RenderedQuotation[] = [];
  await new HTMLRewriter()
    .on("blockquote", {
      element: () => {
        rendered.push({ inContainer: false, inElement: false });
      },
    })
    .on("li blockquote", markLast(rendered, "inContainer"))
    .on("blockquote blockquote", markLast(rendered, "inContainer"))
    .on("* blockquote", markLast(rendered, "inElement"))
    .transform(new Response(renderer.html(text).replace(GITHUB_TAG_FILTER, "&lt;$1$2"))).text();
  const outside = rendered.filter(quotation => !quotation.inContainer);
  if (outside.length !== structure(text).quotations.length) return null;
  return outside.map(quotation => !quotation.inElement);
}

/** A quotation in Bun's rendered HTML: whether a list item or another quotation holds it, and whether any element does. */
interface RenderedQuotation { inContainer: boolean; inElement: boolean }

/** An HTMLRewriter handler that marks the quotation last met as held in one of the two ways. */
function markLast(rendered: RenderedQuotation[], field: keyof RenderedQuotation): { element: () => void } {
  return {
    element: () => {
      const last = rendered[rendered.length - 1];
      if (last !== undefined) last[field] = true;
    },
  };
}

/**
 * The findings of the rule on a text whose alerts, the later or the earlier,
 * Bun's rendered HTML puts inside an element, or whose quotations it cannot
 * match.
 */
async function nestedFindings(renderer: MarkdownRenderer, text: string): Promise<string[]> {
  const findings = adjacentAlertViolations(text, structure(text));
  if (findings.length === 0) return [];
  const top = await topLevelQuotations(renderer, text);
  const lines = structure(text).quotations.map(quotation => quotation.line);
  const nested: string[] = [];
  for (const finding of findings) {
    const earlier = Number(/on line (\d+)/.exec(finding.detail)?.[1]);
    for (const line of [earlier, finding.line]) {
      if (top === null || top[lines.indexOf(line)] !== true) nested.push(`${JSON.stringify(text)} line ${line}`);
    }
  }
  return nested;
}

describe("adjacent-alerts checked against Bun's renderer, a test oracle", () => {
  // Bun before 1.3.8 has no renderer, so these tests are skipped there. The
  // skip shows in the test count; it is not a pass. The rule never calls it.
  // Bun renders no GitHub alert, so the oracle checks the CommonMark blocks
  // a GitHub alert is made from: two quotations side by side at the top of
  // the text, each a paragraph that opens with the marker on its own line.
  const renderer = markdownRenderer();

  test.skipIf(renderer === undefined)("the oracle sees a pair where one is, and none where the blocks differ", () => {
    if (renderer === undefined) return;
    expect(renderedPairs(renderer, pair("NOTE", "NOTE"))).toEqual([{ kind: "NOTE", text: "[!NOTE]\nTwo." }]);
    expect(renderedPairs(renderer, pair("NOTE", "TIP"))).toEqual([]);
    expect(renderedPairs(renderer, `<div>\n${pair("NOTE", "NOTE")}`)).toEqual([]);
    expect(renderedPairs(renderer, "> [!NOTE]\n> ---\n\n> [!NOTE]\n> Two.\n")).toEqual([]);
    expect(renderedPairs(renderer, `${pair("NOTE", "NOTE")}\n[!NOTE]: https://example.org\n`)).toEqual([]);
    expect(renderedPairs(renderer, ">     [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n")).toEqual([]);
    expect(renderedPairs(renderer, "> [!NOTE]\n\n> [!NOTE]\n> Two.\n")).toEqual([]);
  });

  test.skipIf(renderer === undefined)("each specimen above that the rule reports shows as adjacent alerts of one kind in Bun's rendering", () => {
    if (renderer === undefined) return;
    const shown: string[] = [];
    let checked = 0;
    for (const text of SPECIMENS) {
      checked += adjacentAlertViolations(text, structure(text)).length;
      for (const missing of unconfirmed(renderer, text)) {
        shown.push(missing);
      }
    }
    expect(shown).toEqual([]);
    // The specimens above held 19 findings when this was written.
    expect(checked).toBeGreaterThanOrEqual(19);
  });

  test.skipIf(renderer === undefined)("every finding in the seeded documents below shows as adjacent alerts of one kind in Bun's rendering", () => {
    if (renderer === undefined) return;
    const shown: string[] = [];
    let checked = 0;
    for (const generated of seededDocuments()) {
      checked += generated.expected.length;
      for (const missing of unconfirmed(renderer, generated.text)) {
        shown.push(missing);
      }
    }
    expect(shown).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(1_000);
  }, 120_000);

  test.skipIf(renderer === undefined)("the HTML oracle shows a quotation inside an element as held, and one after the element closes as not", async () => {
    if (renderer === undefined) return;
    const twice = pair("NOTE", "NOTE");
    expect(await topLevelQuotations(renderer, `<details>\n<summary>Notes</summary>\n\n${twice}\n</details>\n`)).toEqual([false, false]);
    expect(await topLevelQuotations(renderer, `<div>\n\n${twice}\n</div>\n`)).toEqual([false, false]);
    expect(await topLevelQuotations(renderer, `<table><tr><td>\n\n${twice}\n</td></tr></table>\n`)).toEqual([false, false]);
    expect(await topLevelQuotations(renderer, `<pre\n</pre>\n\n${twice}`)).toEqual([false, false]);
    expect(await topLevelQuotations(renderer, `<div>\n\n> [!NOTE]\n> One.\n\n</div>\n\n> [!NOTE]\n> Two.\n`)).toEqual([false, true]);
    expect(await topLevelQuotations(renderer, `<details>\n\nBody.\n\n</details>\n\n${twice}`)).toEqual([true, true]);
    expect(await topLevelQuotations(renderer, `- > [!NOTE]\n  > One.\n\n${twice}`)).toEqual([true, true]);
  });

  test.skipIf(renderer === undefined)("no finding on a specimen above or a seeded document stands inside an element in Bun's rendered HTML", async () => {
    if (renderer === undefined) return;
    const nested: string[] = [];
    let checked = 0;
    for (const text of [...SPECIMENS, ...seededDocuments().map(generated => generated.text)]) {
      checked += adjacentAlertViolations(text, structure(text)).length;
      for (const finding of await nestedFindings(renderer, text)) {
        nested.push(finding);
      }
    }
    expect(nested.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(1_000);
  }, 120_000);
});

/**
 * The ways each seeded document varies, each with its values. The first
 * value of each is the one a reported pair holds when that axis is not
 * varied. Every distinction the rule keys on has an axis here.
 */
const AXES = {
  firstKind: ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION", "DANGER"],
  secondKind: ["same", "NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION", "DANGER"],
  firstCase: ["upper", "lower", "title"],
  secondCase: ["upper", "lower", "title"],
  indent: ["", " ", "  ", "   ", "    "],
  afterMarker: [" ", "", TAB, "  ", "    ", "     "],
  markerEnd: ["", "  ", " Read this.", "escaped", "tab", "no-break", "no-break-before"],
  markerEndOn: ["first", "second"],
  firstBody: ["text", "list", "heading", "fence", "none", "marker", "dashes", "equals", "stars", "html", "lazy", "divider"],
  secondBody: ["text", "list", "heading", "fence", "none", "marker", "dashes", "equals", "stars", "html", "lazy", "divider"],
  extra: ["", "more", "spaced", "lazy", "underline", "dashes-below"],
  gap: ["one", "two", "spaces", "tab", "none", "paragraph", "comment", "definition", "rule", "zero-width", "no-break", "quote-line", "heading"],
  above: ["blank", "start", "front-matter-blank", "pre-closed", "paragraph", "heading", "div", "front-matter", "pre-open", "cdata-open", "comment-open"],
  container: ["none", "list", "quotation", "fence", "comment"],
  ending: ["\n", `${CR}\n`, CR],
  definition: ["none", "other", "same"],
  after: ["", "paragraph", "lazy"],
  html: ["none", "closed-above", "badge", "code-span", "details", "div", "table-cell", "blockquote", "span-open", "unclosed-tag"],
} as const;
type Axis = keyof typeof AXES;
type Choice = { [axis in Axis]: (typeof AXES)[axis][number]; };

/** A seeded document, the lines the rule should report on it, and the value it took on each axis. */
interface SeededDocument { text: string; expected: number[]; choice: Choice }

/** A seeded generator of numbers from 0 up to but not including 1, the same for the same seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A kind written in the given letter case. */
function cased(kind: string, letters: string): string {
  if (letters === "lower") return kind.toLowerCase();
  if (letters === "title") return kind.charAt(0) + kind.slice(1).toLowerCase();
  return kind;
}

/** The lines of an alert's body after its marker line, from the form chosen and a word that names it. */
function bodyLines(form: string, word: string, extra: string): string[] {
  const forms: Record<string, string[]> = {
    text: [`> Body ${word}.`], list: [`> - Item ${word}.`], heading: [`> ## Head ${word}`],
    fence: ["> ```", `> code ${word}`, "> ```"], none: [], marker: [">", `> Body ${word}.`], dashes: ["> ---", `> Body ${word}.`], divider: ["> |---|", `> | ${word} |`],
    equals: ["> ===", `> Body ${word}.`], stars: ["> ***", `> Body ${word}.`], html: [`> <b>${word}</b> said.`], lazy: [`Lazy ${word}.`],
  };
  const extras: Record<string, string[]> = {
    "": [], more: [`> More ${word}.`], spaced: [">", `> More ${word}.`], lazy: [`lazy more ${word}.`], underline: [`> More ${word}.`, "> ==="], "dashes-below": [`> More ${word}.`, "> ---"],
  };
  return [...(forms[form] ?? []), ...(form === "none" ? [] : extras[extra] ?? [])];
}

/** The marker line of an alert. */
function markerLine(choice: Choice, kind: string, letters: string, which: string): string {
  const end = choice.markerEndOn === which ? choice.markerEnd : "";
  const name = `[!${cased(kind, letters)}]`;
  const ends: Record<string, string> = { escaped: `\\${name}`, tab: `${name}${TAB}`, "no-break": `${name}${NBSP}`, "no-break-before": `${NBSP}${name}` };
  const marker = ends[end] ?? `${name}${end}`;
  return `${choice.indent}>${choice.afterMarker}${marker}`;
}

/** The lines between the two alerts. */
function gapLines(gap: string): string[] {
  const between: Record<string, string[]> = {
    one: [""], two: ["", ""], spaces: ["   "], tab: [TAB], none: [], paragraph: ["", "A paragraph.", ""], comment: ["", "<!-- c -->", ""],
    definition: ["", "[guide]: guide.md", ""], rule: ["", "---", ""], "zero-width": [ZERO_WIDTH], "no-break": [NBSP], "quote-line": [">"], heading: ["", "## A heading", ""],
  };
  return between[gap] ?? [];
}

/**
 * Whether the rule should report the second alert of a document made from
 * this choice. It is written from the choice, not from the text, so it is a
 * second reading of what the rule's limits say.
 */
function shouldReport(choice: Choice): boolean {
  const second = choice.secondKind === "same" ? choice.firstKind : choice.secondKind;
  const known = choice.firstKind !== "DANGER" && second === choice.firstKind;
  const markers = choice.indent !== "    " && choice.afterMarker !== "     " && ["", "  ", "tab"].includes(choice.markerEnd);
  const text = ["text", "list", "heading", "fence"];
  const bodies = text.includes(choice.firstBody) && text.includes(choice.secondBody);
  const gap = ["one", "two", "spaces", "tab"].includes(choice.gap);
  const above = ["blank", "start", "front-matter-blank"].includes(choice.above);
  const html = ["none", "closed-above", "badge", "code-span"].includes(choice.html);
  // A line without a marker carries on a paragraph, but not a closed fence
  // or a heading, so after those it is a paragraph between the two alerts.
  const lazyBetween = choice.extra === "lazy" && (choice.firstBody === "fence" || choice.firstBody === "heading");
  // An underline below the text that follows a marker makes the marker part of a heading.
  const underlined = (choice.extra === "underline" || choice.extra === "dashes-below") && (choice.firstBody === "text" || choice.secondBody === "text");
  return known && markers && bodies && gap && above && html && !lazyBetween && !underlined && choice.container === "none" && choice.definition !== "same";
}

/** One seeded document from a choice of a value on every axis. */
function seededDocument(choice: Choice, index: number): SeededDocument {
  const secondKind = choice.secondKind === "same" ? choice.firstKind : choice.secondKind;
  const block = [
    markerLine(choice, choice.firstKind, choice.firstCase, "first"),
    ...bodyLines(choice.firstBody, `a${index}x`, choice.extra),
    ...gapLines(choice.gap),
    markerLine(choice, secondKind, choice.secondCase, "second"),
    ...bodyLines(choice.secondBody, `b${index}x`, choice.extra),
  ];
  const secondOffset = 1 + bodyLines(choice.firstBody, "", choice.extra).length + gapLines(choice.gap).length;
  const aboves: Record<string, string[]> = {
    blank: ["# Guide", ""], start: [], "front-matter-blank": ["---", "title: Guide", "---", ""], paragraph: ["Text."], heading: ["# Guide"], div: ["<div>"], "front-matter": ["---", "title: Guide", "---"],
    "pre-closed": ["<pre", "</pre>", ""], "pre-open": ["<pre", ""], "cdata-open": ["<![CDATA[", ""], "comment-open": ["<!--", ""],
  };
  const above = aboves[choice.above] ?? [];
  // HTML around the whole document: lines before it and lines after it.
  const wrappers: Record<string, [string[], string[]]> = {
    none: [[], []], "closed-above": [["<details>", "<summary>Notes</summary>", "", "Body.", "", "</details>", ""], []],
    badge: [["<p align=\"center\"><a href=\"https://example.org\"><img src=\"logo.png\" alt=\"Logo\"></a></p>", ""], []], "code-span": [["Use `<details>` here.", ""], []],
    details: [["<details>", "<summary>Notes</summary>", ""], ["", "</details>"]], div: [["<div>", ""], ["", "</div>"]],
    "table-cell": [["<table><tr><td>", ""], ["", "</td></tr></table>"]], blockquote: [["<blockquote>", ""], ["", "</blockquote>"]],
    "span-open": [["Text <span>open.", ""], []], "unclosed-tag": [["<details", ""], []],
  };
  const [htmlBefore, htmlAfter] = wrappers[choice.html] ?? [[], []];
  let wrapped = block;
  let shift = 0;
  if (choice.container === "list") wrapped = block.map((line, offset) => (offset === 0 ? `- ${line}` : line === "" ? line : `  ${line}`));
  if (choice.container === "quotation") wrapped = block.map(line => `> ${line}`);
  if (choice.container === "fence") [wrapped, shift] = [["```", ...block, "```"], 1];
  if (choice.container === "comment") [wrapped, shift] = [["<!--", ...block, "-->"], 1];
  const definitionKind = choice.definition === "same" ? cased(choice.firstKind, choice.firstCase) : choice.firstKind === "TIP" ? "NOTE" : "TIP";
  const after: Record<string, string[]> = { "": [], paragraph: ["", "After."], lazy: ["After, lazily."] };
  const lines = [...htmlBefore, ...above, ...wrapped, ...(after[choice.after] ?? []), ...htmlAfter, ...(choice.definition === "none" ? [] : ["", `[!${definitionKind}]: https://example.org`])];
  const firstLine = htmlBefore.length + above.length + shift + 1;
  const report = shouldReport(choice);
  return { text: lines.join(choice.ending) + choice.ending, expected: report ? [firstLine + secondOffset] : [], choice };
}

/**
 * 7,000 documents from a fixed seed. Each axis keeps its first value unless
 * the generator varies it, which it does for one axis in four, so about one
 * document in six holds a reported pair, 1,175 in all, and every value of
 * every axis is met.
 */
function seededDocuments(): SeededDocument[] {
  const random = seededRandom(24_495);
  const documents: SeededDocument[] = [];
  for (let index = 0; index < 7_000; index++) {
    const choice: Record<string, string> = {};
    for (const [axis, values] of Object.entries(AXES)) {
      const vary = random() < 0.25;
      choice[axis] = vary ? values[Math.floor(random() * values.length)] ?? values[0] : values[0];
    }
    documents.push(seededDocument(choice as Choice, index));
  }
  return documents;
}

describe("adjacent-alerts on seeded documents that vary every distinction it keys on", () => {
  test("each document gives exactly the lines its choice should, and every value of every axis is met where it can change the result", () => {
    const documents = seededDocuments();
    const wrong: string[] = [];
    const seen = new Map<string, number>();
    const seenReported = new Map<string, number>();
    for (const generated of documents) {
      const found = adjacentAlertViolations(generated.text, structure(generated.text)).map(finding => finding.line);
      if (JSON.stringify(found) !== JSON.stringify(generated.expected)) wrong.push(`${JSON.stringify(generated.text)} gave ${JSON.stringify(found)}, not ${JSON.stringify(generated.expected)}`);
      for (const [axis, value] of Object.entries(generated.choice)) {
        const key = `${axis}=${JSON.stringify(value)}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (generated.expected.length > 0) seenReported.set(key, (seenReported.get(key) ?? 0) + 1);
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    const reported = documents.filter(generated => generated.expected.length > 0).length;
    expect(reported).toBeGreaterThanOrEqual(1_000);
    expect(documents.length - reported).toBeGreaterThanOrEqual(1_000);
    const unseen: string[] = [];
    for (const [axis, values] of Object.entries(AXES)) {
      for (const value of values) {
        if (!seen.has(`${axis}=${JSON.stringify(value)}`)) unseen.push(`${axis}=${JSON.stringify(value)}`);
      }
    }
    expect(unseen).toEqual([]);
    // Each value a reported pair may hold is met in one, so each is shown to keep the finding.
    const reportable: Array<[Axis, readonly string[]]> = [
      ["firstKind", ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]], ["secondKind", ["same", "NOTE"]], ["firstCase", AXES.firstCase], ["secondCase", AXES.secondCase],
      ["indent", ["", " ", "  ", "   "]], ["afterMarker", [" ", "", TAB, "  ", "    "]], ["markerEnd", ["", "  ", "tab"]], ["markerEndOn", AXES.markerEndOn],
      ["firstBody", ["text", "list", "heading", "fence"]], ["secondBody", ["text", "list", "heading", "fence"]], ["extra", ["", "more", "spaced", "lazy"]], ["gap", ["one", "two", "spaces", "tab"]],
      ["above", ["blank", "start", "front-matter-blank"]], ["container", ["none"]], ["ending", AXES.ending], ["definition", ["none", "other"]], ["after", AXES.after],
      ["html", ["none", "closed-above", "badge", "code-span"]],
    ];
    const neverReported: string[] = [];
    for (const [axis, values] of reportable) {
      for (const value of values) {
        if (!seenReported.has(`${axis}=${JSON.stringify(value)}`)) neverReported.push(`${axis}=${JSON.stringify(value)}`);
      }
    }
    expect(neverReported).toEqual([]);
  }, 60_000);
});

describe("adjacent-alerts takes time in proportion to the text", () => {
  // The parse of the same text is the baseline, so a slower or busier
  // machine slows both. The fastest of three scans is timed, because one scan
  // alone can run slower than the parse under load.
  test("100,000 alerts in a row take no more than three times the parse they read, and give 99,999 findings", () => {
    const text = "> [!NOTE]\n> Body.\n\n".repeat(100_000);
    expect(fastestScan(text, 99_999)).toBeLessThan(3 * parseTime(text));
  }, 120_000);

  test("a million blank lines between two alerts give one finding, as fast", () => {
    const text = `> [!NOTE]\n> One.\n${"\n".repeat(1_000_000)}> [!NOTE]\n> Two.\n`;
    expect(alerts(text)).toEqual([adjacent("NOTE", 1, 1_000_003)]);
    expect(fastestScan(text, 1)).toBeLessThan(3 * parseTime(text));
    // A tag above them makes the rule read HTML on every line.
    const tagged = `<b>Bold</b>\n\n${text}`;
    expect(fastestScan(tagged, 1)).toBeLessThan(3 * parseTime(tagged));
  }, 120_000);

  test("a million characters of unclosed labels and long body lines scan as fast", () => {
    for (const tail of [`[${" ".repeat(1_000_000)}`, `[!NOTE${" >".repeat(500_000)}`, "[".repeat(1_000_000)]) {
      const text = `${pair("NOTE", "NOTE")}\n${tail}\n`;
      expect(fastestScan(text, 1)).toBeLessThan(3 * parseTime(text));
    }
    const long = `> [!NOTE]\n> ${"word ".repeat(200_000)}\n\n> [!NOTE]\n> Two.\n`;
    expect(fastestScan(long, 1)).toBeLessThan(3 * parseTime(long));
  }, 120_000);

  // Each body line here looks like the line below a marker that the rule
  // tests for an underline, a rule or a table delimiter, until its last
  // character. The 100,000 case runs first, so code that rescans the line
  // from each position fails at its assertion rather than at the time limit.
  // A rule of stars is left out: the parse reads `* * *` with text after as
  // lists nested one in another, and takes time in the square of their
  // number before the rule runs.
  test("a body line of 100,000 and 300,000 characters that is almost a delimiter, a rule or an underline scans as fast", () => {
    for (const size of [100_000, 300_000]) {
      for (const body of ["-".repeat(size), "-:| ".repeat(size / 4), "_ ".repeat(size / 2), "=".repeat(size), ">".repeat(size), "[!".repeat(size / 2), "[!NOTE".repeat(size / 6)]) {
        const text = `> [!NOTE]\n> ${body}x\n\n> [!NOTE]\n> Two.\n`;
        expect(fastestScan(text, 1), `${body.slice(0, 6)} ${size}`).toBeLessThan(3 * parseTime(text));
      }
    }
  }, 120_000);

  // Each tail is HTML the rule reads for elements left open: runs of
  // openings, of end tags, of comments and quotes never closed, and of code
  // spans and link tails, each of which could send a search to the end of
  // the text from every place it starts. The larger size runs first, where
  // such a search costs nine times what it does at the smaller one.
  test("100,000 and 300,000 characters of tags, comments, quotes, code spans and link tails above the alerts scan as fast", () => {
    for (const size of [300_000, 100_000]) {
      const tails = [
        "<details>".repeat(size / 9), "</details>".repeat(size / 10), "<!--".repeat(size / 4), "<a ".repeat(size / 3), "<a x=\"".repeat(size / 6), "</".repeat(size / 2),
        "<kbd>x</kbd>".repeat(size / 12), "<script>".repeat(size / 8), "`".repeat(size), "` <b>".repeat(size / 5), "](".repeat(size / 2), "[x]: ".repeat(size / 5),
        ">".repeat(size), "[!".repeat(size / 2), `<a title="${"x".repeat(size)}`, "<a\n".repeat(size / 3),
        // The structural reading keeps comments and raw text in a heading, so these reach the rule.
        // Its own reading of comments there takes more than linear time, so they come last.
        `# Head ${"<?>".repeat(size / 3)}`, `# Head ${"<!x>".repeat(size / 4)}`, `# Head ${"<style>x</style>".repeat(size / 16)}`, `# Head ${"<!-- x -->".repeat(size / 10)}`,
        // End tags of no open element, below many open ones.
        `${"<details>".repeat(size / 18)}\n${"</b>".repeat(size / 8)}`, `![${"[".repeat(size)}`,
      ];
      for (const tail of tails) {
        // A tag first makes the rule read HTML at all.
        const text = `<b>Bold</b>\n\n${tail}\n\n${pair("NOTE", "NOTE")}`;
        const found = adjacentAlertViolations(text, structure(text)).length;
        expect(fastestScan(text, found), `${tail.slice(0, 8)} ${size}`).toBeLessThan(3 * parseTime(text));
        const balanced = `<kbd>x</kbd>`.repeat(size / 12);
        if (tail === balanced) expect(found).toBe(1);
      }
    }
  }, 120_000);

  test("100,000 HTML blocks and elements opened and closed, and one left open, scan as fast", () => {
    const closed = `${"<div>\n</div>\n".repeat(100_000)}\n${pair("NOTE", "NOTE")}`;
    expect(fastestScan(closed, 1)).toBeLessThan(3 * parseTime(closed));
    // HTML reads `<pre` and `</pre>` on the next line as one start tag, so these hold the alerts.
    const unended = `${"<pre\n</pre>\n".repeat(100_000)}\n${pair("NOTE", "NOTE")}`;
    expect(fastestScan(unended, 0)).toBeLessThan(3 * parseTime(unended));
    const open = `<!--\n\n${pair("NOTE", "NOTE").repeat(50_000)}`;
    expect(fastestScan(open, 0)).toBeLessThan(3 * parseTime(open));
  }, 120_000);
});

/** How long `structure` takes to read this text, in milliseconds. */
function parseTime(text: string): number {
  const started = performance.now();
  structure(text);
  return performance.now() - started;
}

/**
 * The fastest of three adjacent-alerts scans of this text, in milliseconds.
 * The parse the scan reads is not timed. Each scan must find this many.
 */
function fastestScan(text: string, found: number): number {
  const parsed = structure(text);
  let fastest = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    const findings = adjacentAlertViolations(text, parsed);
    fastest = Math.min(fastest, performance.now() - started);
    expect(findings).toHaveLength(found);
  }
  return fastest;
}
