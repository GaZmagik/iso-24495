// The documents the reading of HTML text is held to, beside the CommonMark
// reference's rendering of each in `html-text-renderings.ts`.
//
// Each document is the new version of a file holding one value of the
// original, such as the code span `npm test`, cut into pieces with markup
// between them. The families are built from every ordered pair of fragments
// in the lists below, not sampled, with one seeded family of random
// compositions beside them. `../reference/build-html-text.ts` records
// whether the reference shows each value whole.

import { itemAt } from "../../scripts/lib/item-at.ts";

/** One document: its family, the value, and the new version's text. */
export interface HtmlTextDocument {
  readonly family: string;
  readonly value: string;
  readonly text: string;
}

/** Markup to cut a value with: tags, comments, declarations and raw text elements, well formed or not. */
export const SPLITTERS: readonly string[] = [
  "", "<b>", "</b>", "<span>", "</span>", "<span title=\">\">", "<span title='>'>", "<span title=\"<\">", "<span title=\"&gt;\">",
  "<span title=\">\" data-a='<'>", "<span title=a>", "<br/>", "<br>", "<img alt=\">\" src=\"x\">", "<b \"c>", "<b c=\"d\"e>",
  "<a\ntitle=\">\">", "</span x=\">\">", "<b/>", "<b =x>", "<b a=>", "<x-y>", "<o:p>", "<my_tag>", "<b\tc='>'>",
  "<!-- x -->", "<!-- > -->", "<!-->", "<!--->", "<!-- -- -->", "<!-- --!>", "<!---->", "<!-- <b> -->", "<!--x--->", "<!-- \" -->",
  "<?x>", "<?x > ?>", "<!DOCTYPE x>", "<![CDATA[x]]>", "<!x>", "</ x>", "</1>", "</>",
  "<script>x</script>", "<script>\"</script>", "<script><!--</script>", "<script><!--<script></script>x</script>", "<SCRIPT>x</SCRIPT>",
  "<script>x</script >", "<style>a>b</style>", "<title>x</title>", "<textarea></textarea>", "<xmp></xmp>", "<noscript>x</noscript>",
  "<iframe>x</iframe>", "<noembed>x</noembed>", "<noframes>x</noframes>", "<style>\"</style>",
];

/** Markup that runs over a line ending or a blank line. */
export const MULTILINE: readonly string[] = [
  "<span\ntitle=\">\"\n>", "<!--\n-->", "<!--\n\n-->", "<span title=\"a\n>b\">", "<script>\nx\n</script>", "<script>\n\nx\n\n</script>",
  "<style>\n\n</style>", "<b\n>", "</b\n>", "<!-- a\n> b -->",
];

/** Markdown before the value that holds the opening of markup: code, an escape, an autolink, a link destination. */
export const CONTEXTS: readonly string[] = [
  "", "Use `<!--` here.", "Use `<script>` here.", "Use `<a title=\"` here.", "Use `<style>` here.", "Use `<title>` here.",
  "```\n<!--\n```", "```\n<a title=\"\n```", "    <script>", "\\<b>", "<https://x.y>", "[a](<b>)", "*em*", "Use `\"` here.",
  "Use `<b` here.", "Use `<!` here.",
];

/** Markdown after the value that holds the closing of markup. */
export const SUFFIXES: readonly string[] = ["", "And `-->` after.", "And `\">` after.", "And `</script>` after.", "And `</style>` after.", "And `>` after.", "And `</title>` after."];

/** Tag-like text CommonMark shows as text in prose, which the HTML tokenizer reads as a tag running to a later closer. */
export const DOUBT_OPENERS: readonly string[] = ["<b c=\"x\"d=\"> ", "<script \"x> ", "<b c='> ", "<a b=c\"d=\"> ", "<b =\"> ", "<b c=\"x\"/d=\"> ", "</script x> ", "<style \"x> ", "<b\nc=\"\n\"d=\"> ", "<b c=`\"> "];

/** What may close a doubtful opener. */
export const DOUBT_CLOSERS: readonly string[] = ["\">", "'>", "</script>", ">", "\"> more", "</style>"];

/** The blocks a value's markup stands in. */
const WRAPPERS: ReadonlyArray<readonly [string, (body: string) => string]> = [
  ["paragraph", body => `${body}\n`],
  ["sentence", body => `Text ${body} more.\n`],
  ["item", body => `- ${body}\n`],
  ["quote", body => `> ${body}\n`],
  ["pre", body => `<pre>${body}</pre>\n`],
  ["div-line", body => `<div>${body}</div>\n`],
  ["div-block", body => `<div>\n${body}\n</div>\n`],
];

/** Containers and neighbours that change how CommonMark passes markup to a browser. */
const CONTAINERS: ReadonlyArray<readonly [string, (body: string) => string]> = [
  ["table", body => `| a |\n|---|\n| ${body} |\n`],
  ["quote-item", body => `> - ${body}\n`],
  ["item-quote", body => `1. > ${body}\n`],
  ["nested-item", body => `- a\n  - ${body}\n`],
  ["pre-blank", body => `<pre>\n\n${body}\n\n</pre>\n`],
  ["quote-pre", body => `> <pre>${body}</pre>\n`],
  ["div-md", body => `<div>\n\n${body}\n\n</div>\n`],
  ["heading-after", body => `${body}\n===\n`],
  ["after-fence", body => `\`\`\`\n<!--\n\`\`\`\n${body}\n`],
  ["after-indented", body => `    <!--\n${body}\n`],
];

/** Containers whose markers stand on every line of the value. */
const EVERY_LINE: ReadonlyArray<readonly [string, (body: string) => string]> = [
  ["quote-all", body => `${body.split("\n").map(line => `> ${line}`).join("\n")}\n`],
  ["quote-quote-all", body => `${body.split("\n").map(line => `> > ${line}`).join("\n")}\n`],
  ["item-indented", body => `${body.split("\n").map((line, index) => `${index === 0 ? "- " : "  "}${line}`).join("\n")}\n`],
  ["quote-pre-all", body => `${`<pre>${body}</pre>`.split("\n").map(line => `> ${line}`).join("\n")}\n`],
  ["item-pre", body => `${`<pre>${body}</pre>`.split("\n").map((line, index) => `${index === 0 ? "- " : "  "}${line}`).join("\n")}\n`],
];

/** How many random compositions the seeded family holds. */
const RANDOM_DOCUMENTS = 20_000;

/** The code value most families cut, and the opening of each new version. */
const CODE = "npm test";
const LEAD = "Run it first.\n\n";

/** Every document, in a fixed order. */
export function htmlTextDocuments(): HtmlTextDocument[] {
  const documents: HtmlTextDocument[] = [];
  for (const [wrap, wrapper] of WRAPPERS) {
    for (const first of SPLITTERS) {
      for (const second of SPLITTERS) {
        documents.push(made(`pair/${wrap}`, CODE, wrapper(`np${first}m${second} test`)));
      }
    }
    for (const first of SPLITTERS) {
      for (const second of SPLITTERS) {
        documents.push(made(`number/${wrap}`, "42", wrapper(`4${first}2${second}`)));
      }
    }
    for (const piece of ["m", "&#109;", "&#x6D;", "&#109", "&#x6d"]) {
      for (const first of SPLITTERS) {
        documents.push(made(`reference/${wrap}`, CODE, wrapper(`np${first}${piece} test`)));
      }
    }
    for (const ampersand of ["&", "&amp;", "&amp", "&#38;", "&AMP", "&ampx"]) {
      for (const first of SPLITTERS) {
        documents.push(made(`ampersand/${wrap}`, "a&b", wrapper(`a${first}${ampersand}b`)));
      }
    }
  }
  for (const [wrap, wrapper] of WRAPPERS.filter(([name]) => ["paragraph", "quote", "pre", "div-block"].includes(name))) {
    for (const context of CONTEXTS) {
      for (const suffix of SUFFIXES) {
        for (const first of SPLITTERS) {
          for (const glue of ["\n\n", "\n"]) {
            documents.push(made(`context/${wrap}`, CODE, `${context}${glue}${wrapper(`np${first}m test`)}${suffix === "" ? "" : `\n${suffix}\n`}`));
          }
        }
      }
    }
  }
  for (const [wrap, wrapper] of [...WRAPPERS, ...CONTAINERS]) {
    for (const first of [...SPLITTERS, ...MULTILINE]) {
      for (const second of MULTILINE) {
        documents.push(made(`multiline/${wrap}`, CODE, wrapper(`np${first}m${second} test`)));
      }
      const upper = first.replace(/<\/?[a-z]+/g, tag => tag.toUpperCase()).replace(/title=/g, "TITLE=");
      documents.push(made(`upper/${wrap}`, CODE, wrapper(`np${upper}m test`)));
      for (const written of ["&lt;b&gt;", "&lt;b>", "&#60;b&#62;", "&ltb&gt", "&LT;b&GT;"]) {
        documents.push(made(`literal-tag/${wrap}`, "a<b>c", wrapper(`a${written}${first}c`)));
      }
    }
    for (const opener of DOUBT_OPENERS) {
      for (const closer of DOUBT_CLOSERS) {
        for (const first of ["<b>", "<span title=\">\">", "<!-- x -->", ""]) {
          documents.push(made(`doubt/${wrap}`, CODE, wrapper(`Use ${opener}then np${first}m test ${closer} now.`)));
        }
      }
    }
  }
  for (const [wrap, wrapper] of CONTAINERS) {
    for (const first of [...SPLITTERS, ...MULTILINE]) {
      for (const second of ["", "<b>", "<span title=\">\">", "<!-- > -->", "<script>x</script>", "<b \"c>"]) {
        documents.push(made(`container/${wrap}`, CODE, wrapper(`np${first}m${second} test`)));
      }
    }
  }
  for (const [wrap, wrapper] of EVERY_LINE) {
    for (const first of [...SPLITTERS, ...MULTILINE]) {
      for (const second of [...MULTILINE, "", "<b>", "<span title=\">\">"]) {
        documents.push(made(`markers/${wrap}`, CODE, wrapper(`np${first}m${second} test`)));
      }
    }
    for (const opener of DOUBT_OPENERS) {
      for (const closer of DOUBT_CLOSERS) {
        documents.push(made(`markers-doubt/${wrap}`, CODE, wrapper(`Use ${opener}then np<b>m test ${closer} now.`)));
      }
    }
  }
  documents.push(...randomDocuments());
  return documents;
}

/** A document of a family, its new version opening with `LEAD`. */
function made(family: string, value: string, body: string): HtmlTextDocument {
  return { family, value, text: `${LEAD}${body}` };
}

/**
 * Seeded random compositions: a value cut at one to three places by one or
 * two fragments from every list above, with a fragment before and after,
 * in a random block.
 */
function randomDocuments(): HtmlTextDocument[] {
  const random = seeded(24495);
  const pool = [...SPLITTERS, ...MULTILINE, ...DOUBT_OPENERS, ...DOUBT_CLOSERS, ...CONTEXTS.map(context => ` ${context} `), "\n", "\n\n", "\n> ", "\n- ", "`", "\\", "&", "&amp;", "<", ">", "\"", "'"];
  const wrappers = [...WRAPPERS, ...CONTAINERS, ...EVERY_LINE];
  const documents: HtmlTextDocument[] = [];
  for (let trial = 0; trial < RANDOM_DOCUMENTS; trial++) {
    const value = pick([CODE, "a&b", "a<b>c", "42"], random);
    const characters = [...value];
    const cuts = new Set(Array.from({ length: 1 + Math.floor(random() * 3) }, () => 1 + Math.floor(random() * (characters.length - 1))));
    const opening = pick(pool, random);
    let body = pick(["", opening], random);
    for (const [index, character] of characters.entries()) {
      if (cuts.has(index)) body += Array.from({ length: 1 + Math.floor(random() * 2) }, () => pick(pool, random)).join("");
      body += character === "&" ? pick(["&", "&amp;", "&amp", "&#38;"], random) : character === "<" ? pick(["&lt;", "&#60;", "\\<"], random) : character === ">" ? pick([">", "&gt;"], random) : character;
    }
    const fromPool = pick(pool, random);
    const closer = pick(DOUBT_CLOSERS, random);
    body += pick(["", fromPool, closer], random);
    const [wrap, wrapper] = pick(wrappers, random);
    documents.push({ family: `random/${wrap}`, value, text: `${LEAD}${wrapper(body)}` });
  }
  return documents;
}

/** A source of numbers from 0 to 1 that gives the same run for the same seed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** One of the items, drawn from `random`. */
function pick<T extends NonNullable<unknown>>(items: readonly T[], random: () => number): T {
  return itemAt(items, Math.floor(random() * items.length));
}

/** A digest of every document's value and text, so a recording can show which documents it is of. */
export function documentsDigest(documents: readonly HtmlTextDocument[]): string {
  const hash = new Bun.CryptoHasher("sha256");
  const separator = String.fromCharCode(0);
  for (const document of documents) {
    hash.update(document.value);
    hash.update(separator);
    hash.update(document.text);
    hash.update(separator);
  }
  return hash.digest("hex");
}
