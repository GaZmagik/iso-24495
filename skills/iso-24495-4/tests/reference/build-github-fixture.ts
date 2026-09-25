// Asks GitHub's Markdown API how it renders each document below, and records the
// answers in ../fixtures/github-rendered.ts, so the test beside it can compare what
// this engine reads with what GitHub shows without a network or a token.
//
// Run it from the repository root with the GitHub CLI signed in:
//
//   bun skills/iso-24495-4/tests/reference/build-github-fixture.ts
//
// A difference it cannot explain stops the run. A reason is decided from what the
// document contains, never from its name, so a new defect cannot wear an old excuse.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { shownText } from "../../../../scripts/visible-text.ts";
import { githubText } from "./github-text.ts";

// Every element name the reader treats specially, and the ones it might meet, each
// asked about in a div, where the sanitiser either keeps, unwraps or removes it.
const ELEMENT_NAMES = [
  "html", "body", "address", "blockquote", "center", "dialog", "div", "figure", "figcaption",
  "footer", "form", "header", "hr", "legend", "listing", "main", "p", "plaintext", "pre",
  "search", "xmp", "article", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "hgroup", "nav",
  "section", "dir", "dd", "dl", "dt", "menu", "ol", "ul", "li", "fieldset", "details",
  "summary", "option", "optgroup", "table", "caption", "colgroup", "col", "thead", "tbody",
  "tfoot", "tr", "td", "th", "br", "video", "audio", "rp", "rt", "ruby", "template", "input",
  "button", "select", "object", "math", "svg", "noscript", "span", "em", "strong", "a", "img",
  "code", "kbd", "sup", "sub", "ins", "del", "s", "q", "abbr", "mark", "small", "picture",
  "source", "track", "label", "textarea", "canvas", "map", "area", "embed", "font", "b", "i",
  "u", "tt", "var", "samp", "cite", "dfn", "time", "wbr", "bdo", "bdi", "meter", "progress",
  "output", "datalist", "slot", "frame", "frameset", "applet", "marquee", "blink", "nobr",
  "strike", "big", "acronym", "script", "style", "title", "iframe", "noembed", "noframes",
];

const DOCUMENTS: Array<[string, string]> = [
  ...ELEMENT_NAMES.map((name): [string, string] => [`element ${name} in a div`, `<div>x<${name}>y</${name}>z</div>`]),
  ...ELEMENT_NAMES.map((name): [string, string] => [`element ${name} in a paragraph`, `A sh<${name}>y</${name}>all b.`]),
  ["emphasis inside a word", "We sh*all* pay."],
  ["strong emphasis around a word", "We act in **order** to help."],
  ["underscores inside a word", "We sh_all_ pay."],
  ["strikethrough", "We ~~shall~~ pay."],
  ["bogus comment in a raw HTML block", "<div>We sh<!x>all pay.</div>"],
  ["tag written with a slash", "<div>We sh<em/all>all pay.</div>"],
  ["script after a paragraph", "A plain paragraph.\n\n<script>We shall pay.</script>"],
  ["script tag the filter does not name", "<div><script/x>Plain words.</script></div>"],
  ["script left open across blocks", "<div><script/x>hidden</div>\n\nAfter."],
  ["style tag the filter does not name", "<div>a<style/x>b</style>c</div>"],
  ["video fallback alone", "<video>Plain words.</video>"],
  ["video around blank lines", "<video>\n\nHidden words.\n\n</video>"],
  ["video opened inside a paragraph", "A <video> b\n\nC visible."],
  ["audio around blank lines", "<audio>\n\nAudio words.\n\n</audio>"],
  ["ruby with an omitted rp end tag", "<ruby><rp>(<rt>This change works.</rt></ruby>"],
  ["ruby with rp around rt", "<ruby>a<rp>(</rp><rt>b</rt><rp>)</rp></ruby>"],
  ["reference split by a tag", "<div>&nb<em>sp;</em></div>"],
  ["quotation marks written as references", "Replace &quot;shall&quot; with &quot;must&quot;."],
  ["numeric reference without a semicolon in HTML", "<div>We sh&#97ll pay.</div>"],
  ["numeric reference without a semicolon in text", "We sh&#97ll pay."],
  ["zero-padded space in HTML", "<div>&#00000032;</div>"],
  ["leading rule block", "---\nnote: The tenant shall pay.\n---"],
  ["comment inside a word", "We sh<!-- x -->all pay."],
  ["six paragraphs in one HTML block", "<p>One.</p>\n<p>Two.</p>\n<p>Three.</p>\n<p>Four.</p>\n<p>Five.</p>\n<p>Six.</p>"],
  ["table with a caption", "<table><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>c1</td><td>c2</td></tr></tbody><caption>cap</caption></table>"],
  ["unused footnote", "[^1]: Plain words."],
  ["used footnote", "Text[^1].\n\n[^1]: Plain words."],
  ["footnote reference with no definition", "A[^x] b."],
  ["heading holding a banned word", "## The tenant shall pay"],
  ["code span holding a tag", "Run `sh<script>x</script>all` now."],
  ["image with alternative text", "![alt words](i.png)"],
  ["link with a title", "Read [the guide](/uri \"a title\") now."],
  ["block tag after a closed paragraph", "<p>A.</p>\n<div>We sh<address></address>all pay.</div>"],
  ["table cell after a closed table", "<table><tr><td>a</td></tr></table>\n<div>We sh<td></td>all pay.</div>"],
  ["block tag inside an open paragraph", "<p>We sh<address></address>all pay.</p>"],
  ["block tag after a paragraph's end tag", "<p>A.</p>\nWe sh<address></address>all pay."],
  ["footnote referred to only in an attribute", "<span title=\"[^a]\"></span>\n\n[^a]: Plain words."],
  ["footnote referred to only in code", "Use `[^a]` here.\n\n[^a]: The tenant shall pay."],
  ["footnote with a second paragraph", "Read the note[^a].\n\n[^a]: First paragraph.\n\n    The tenant shall pay."],
  ["six paragraphs on one line", "<p>One sentence here.</p><p>Two here.</p><p>Three here.</p><p>Four here.</p><p>Five here.</p><p>Six here.</p>"],
  ["word joiner inside a word", "The tenant sh&#8288;all pay."],
  ["soft hyphen inside a word", "The tenant sh&shy;all pay."],
  ["zero-width space inside a word", "The tenant sh&#8203;all pay."],
  ["section inside a div", "<div>We <section>shall</section>pay.</div>"],
  ["video left open in a quotation", "> <video>\n\nThe tenant shall pay."],
  ["video left open in a list item", "- <video>\n\nThe tenant shall pay."],
  ["unused footnote holding a heading", "[^a]: Plain words.\n\n    # Plain heading"],
  ["escaped footnote reference", "Read \\[^a].\n\n[^a]: The tenant shall pay."],
  ["footnote reference written as a character reference", "Read &#91;^a].\n\n[^a]: The tenant shall pay."],
  ["footnote reference in a raw HTML block", "<div>Read [^a].</div>\n\n[^a]: The tenant shall pay."],
  ["footnote reference in a link destination", "Read [x](/[^a]).\n\n[^a]: The tenant shall pay."],
  ["footnote reference inside a comment", "&#32;<!-- [^a] -->\n\n[^a]: This change works."],
  ["footnote label that case-folds", "This change works.[^SS]\n\n[^ß]: We shall pay."],
  ["footnote defined twice", "This change works.[^a]\n\n[^a]: It works.\n\n[^a]: We shall pay."],
  ["ruby nested inside rp", "<ruby><rp><ruby></ruby>This change works.</rp></ruby>"],
  ["footnote reference after an abrupt comment", "&#32;<!-->[^a]\n\n[^a]: The tenant shall pay."],
  ["footnote reference inside a processing instruction", "&#32;<? [^a] ?>\n\n[^a]: The tenant shall pay."],
  ["footnote reference inside a declaration", "&#32;<!X [^a]>\n\n[^a]: The tenant shall pay."],
  ["footnote reference inside CDATA", "&#32;<![CDATA[ [^a] ]]>\n\n[^a]: The tenant shall pay."],
  ["footnote reference after an unclosed comment", "Read <!-- [^a]\n\n[^a]: The tenant shall pay."],
  ["footnote reference in text that only looks like a link", "Read [the guide](bad [^a]).\n\n[^a]: The tenant shall pay."],
  ["footnote reference in a destination with nested parentheses", "[&#8203;](https://example.com/a(b)[^x])\n\n[^x]: This change works."],
  ["dotless i kept apart from i", "Read the note[^i].\n\n[^ı]: This change works.\n\n[^i]: The tenant shall pay."],
  ["rp left open by a raw HTML block", "This change works.\n\n<rp>\n\nThe tenant shall pay."],
];

/** Why the engine reads the document differently from GitHub, or null where that is unexplained. */
function reasonFor(markdown: string): string | null {
  if (/\[\^[^\]\s]+\]/.test(markdown) && /^\s*\[\^[^\]\s]+\]:/m.test(markdown)) {
    return "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written.";
  }
  if (/<details[\s>]/i.test(markdown) && !/<summary[\s>]/i.test(markdown)) {
    return "GitHub adds a summary reading \"Details\" to a details element that has none.";
  }
  if (/<table[^>]*>[^<]*[^<\s]/i.test(markdown) || /<caption[\s>]/i.test(markdown)) {
    return "Text written inside a table but outside any cell, or in a caption, is moved in front of the table by the HTML parser. This engine reads it where it is written.";
  }
  if (/<style\/[^>]*>/i.test(markdown)) {
    return "A style element the tag filter does not name runs to the end of the document, and GitHub shows its text undecoded.";
  }
  return null;
}

/** Text with every run of whitespace, including a block mark, read as one space. */
function normalised(text: string): string {
  return text.replace(/[\s\f]+/g, " ").trim();
}

const token = Bun.spawnSync(["gh", "auth", "token"]).stdout.toString().trim();
const entries: Array<{ name: string; markdown: string; html: string; differsFromGitHub?: string }> = [];
let differing = 0;
for (const [name, markdown] of DOCUMENTS) {
  const response = await fetch("https://api.github.com/markdown", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ text: markdown, mode: "gfm" }),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for "${name}"`);
  const html = (await response.text()).trim();
  const same = normalised(shownText(markdown)) === githubText(html);
  if (same) {
    entries.push({ name, markdown, html });
    continue;
  }
  const reason = reasonFor(markdown);
  if (reason === null) {
    throw new Error(`Unexplained difference for "${name}": ours ${JSON.stringify(shownText(markdown))}, GitHub ${JSON.stringify(githubText(html))}`);
  }
  differing += 1;
  entries.push({ name, markdown, html, differsFromGitHub: reason });
}

const header = `// What GitHub's Markdown API rendered for ${entries.length} documents, recorded by
// \`reference/build-github-fixture.ts\`, which asked GitHub once and kept the answers.
//
// ${entries.length - differing} are read the same way by this engine, and ${differing} differ, each for the reason it
// carries. Never edit an answer by hand to make a test pass: ask GitHub again.

export interface GitHubRendering {
  name: string;
  markdown: string;
  html: string;
  /** Why this engine reads the document differently from GitHub. */
  differsFromGitHub?: string;
}

export const GITHUB_RENDERINGS: GitHubRendering[] = `;
writeFileSync(
  join(import.meta.dir, "..", "fixtures", "github-rendered.ts"),
  `${header}${JSON.stringify(entries, null, 2)};\n`,
);
console.log(JSON.stringify({ documents: entries.length, same: entries.length - differing, differing }));
