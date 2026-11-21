// Rebuild `../fixtures/html-text-renderings.ts` from the CommonMark reference
// and an HTML tree builder.
//
// Neither is a dependency of this project, so both are installed outside the
// repository:
//
//   cd <a directory outside this repository>
//   bun add commonmark@0.31.2 parse5@7.3.0
//   NODE_PATH="$PWD/node_modules" bun <repo>/skills/iso-24495-4/tests/reference/build-html-text.ts
//
// For each document of `../fixtures/html-text-documents.ts`, commonmark.js
// renders the text and parse5 builds the page a browser would. The page's
// text is every text node outside comments and outside the elements a
// browser that runs scripts never shows. The record holds one bit for each
// document: whether that text, or the file as written, holds the value
// whole once white space is made single. The test in
// `../lib/html-text.test.ts` holds the reading of HTML text to that record.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { HtmlRenderer, Parser } from "commonmark";
import { parse, type Parse5Node } from "parse5";
import { documentsDigest, htmlTextDocuments } from "../fixtures/html-text-documents.ts";

/** The elements whose content a browser that runs scripts never shows. */
const HIDDEN = new Set(["script", "style", "title", "iframe", "noembed", "noframes", "noscript", "template"]);

const parser = new Parser();
const renderer = new HtmlRenderer();

/** The text of a page built from rendered Markdown, outside comments and hidden elements. */
function pageText(markdown: string): string {
  let text = "";
  const pending: Parse5Node[] = [parse(renderer.render(parser.parse(markdown)))];
  // Depth first, in document order: children are pushed last first.
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (node.nodeName === "#text") {
      text += node.value ?? "";
    } else if (node.nodeName !== "#comment" && !(node.tagName !== undefined && HIDDEN.has(node.tagName))) {
      for (const child of (node.childNodes ?? []).slice().reverse()) {
        pending.push(child);
      }
    }
  }
  return text;
}

/** Text with each run of white space made one space. */
function singleSpace(text: string): string {
  return text.replace(/\s+/gu, " ");
}

const documents = htmlTextDocuments();
let bits = "";
let shown = 0;
for (const { value, text } of documents) {
  const held = singleSpace(pageText(text)).includes(value) || singleSpace(text).includes(value);
  if (held) shown++;
  bits += held ? "1" : "0";
}
// Four bits to a hexadecimal digit, the last padded with zeros.
let hex = "";
for (let at = 0; at < bits.length; at += 4) {
  hex += Number.parseInt(bits.slice(at, at + 4).padEnd(4, "0"), 2).toString(16);
}
const rows: string[] = [];
for (let at = 0; at < hex.length; at += 96) {
  rows.push(`  "${hex.slice(at, at + 96)}",`);
}
const fixture = [
  "// Whether the CommonMark reference, commonmark.js 0.31.2, with the page parse5",
  "// 7.3.0 builds from its HTML, shows each document's value of",
  "// `html-text-documents.ts` whole, or the file as written holds it: one bit for",
  "// each document in order, four to a hexadecimal digit, the first bit highest.",
  "//",
  "// Rebuild this file with `../reference/build-html-text.ts`. Never edit it by hand.",
  `// ${documents.length} documents, ${shown} of them showing their value.`,
  "",
  "/** The digest of the documents these renderings are of, from `documentsDigest`. */",
  `export const HTML_TEXT_DOCUMENTS_DIGEST = "${documentsDigest(documents)}";`,
  "",
  "/** The bits, as hexadecimal digits. */",
  "export const VALUE_SHOWN = [",
  ...rows,
  "].join(\"\");",
  "",
].join("\n");
writeFileSync(join(import.meta.dir, "..", "fixtures", "html-text-renderings.ts"), fixture);
console.log(`${documents.length} documents, ${shown} of them showing their value.`);
