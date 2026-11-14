// Rebuild `../fixtures/image-title-renderings.ts` from the CommonMark reference.
//
// The reference is not a dependency of this project, so it is installed
// outside the repository, as for `build-fixture.ts`:
//
//   cd <a directory outside this repository>
//   bun add commonmark@0.31.2
//   NODE_PATH="$PWD/node_modules" bun <repo>/skills/iso-24495-4/tests/reference/build-image-titles.ts
//
// Bun looks for a package beside the script, not in the current directory,
// so NODE_PATH tells it where the reference was installed.
//
// It records, for each document of `../fixtures/image-title-documents.ts`,
// whether the reference shows an image and what title it gives it. The test
// in `../image-title-renderer.test.ts` reads that record beside what Bun's
// renderer shows, which needs nothing installed.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Parser } from "commonmark";
import { documentsDigest, imageTitleDocuments, renderingOf } from "../fixtures/image-title-documents.ts";

const parser = new Parser();
const documents = imageTitleDocuments();
let letters = "";
for (const { text } of documents) {
  const walker = parser.parse(text).walker();
  const titles: Array<string | null> = [];
  for (let event = walker.next(); event !== null; event = walker.next()) {
    if (event.entering && event.node.type === "image") titles.push(event.node.title);
  }
  letters += renderingOf(titles);
}

const rows: string[] = [];
for (let at = 0; at < letters.length; at += 80) {
  rows.push(`  "${letters.slice(at, at + 80)}",`);
}
const counts = ["n", "u", "d", "o"].map((letter) => letters.split(letter).length - 1);
const fixture = [
  "// How the CommonMark reference, commonmark.js 0.31.2, shows the image in each",
  "// document of `image-title-documents.ts`, one letter per document in order:",
  "// \"n\" no image, \"u\" an image with no title, \"d\" the title decorative, \"o\"",
  "// another title.",
  "//",
  "// Rebuild this file with `../reference/build-image-titles.ts`. Never edit it by hand.",
  `// ${documents.length} documents: ${counts.join(", ")} of n, u, d and o.`,
  "",
  "/** The digest of the documents these renderings are of, from `documentsDigest`. */",
  `export const IMAGE_TITLE_DOCUMENTS_DIGEST = "${documentsDigest(documents)}";`,
  "",
  "/** One letter for each document, in the order `imageTitleDocuments` gives them. */",
  "export const COMMONMARK_RENDERINGS = [",
  ...rows,
  "].join(\"\");",
  "",
].join("\n");
writeFileSync(join(import.meta.dir, "..", "fixtures", "image-title-renderings.ts"), fixture);
console.log(`${documents.length} documents: ${counts.join(", ")} of n, u, d and o.`);
