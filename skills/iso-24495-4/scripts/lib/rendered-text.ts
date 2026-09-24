// The text a reader sees on the page, for the rules about words and sentences and
// for the check that a pull request description shows anything at all.
//
// Two readers used to do this job: a hand-written inline reader in parse.ts, and
// the renderer route the visibility check took. Every review round found another
// place where the hand-written one disagreed with the page: emphasis inside a word,
// a bogus comment, a tag written with a slash, a quotation mark written as a
// reference. So the Markdown renderer now reads the Markdown, GitHub's tag filter is
// applied to what it writes, and HTMLRewriter, which tokenises as a browser does,
// reads the text. Both callers share this one route, so they cannot disagree.

import { decodeHtmlText } from "./character-references.ts";

/** What the reader keeps beyond the characters the page shows. */
export interface RenderedReading {
  /**
   * Keep an image's alternative text as words. A screen reader speaks it, so the
   * rules about words read it. The visibility check does not, because an image is
   * not text.
   */
  altText?: boolean;
  /**
   * Keep a code span's backticks. The rules need them to tell a term being named
   * from a term being used. The visibility check must not count them as text.
   */
  codeDelimiters?: boolean;
}

// GitHub's tagfilter extension (cmark-gfm, extensions/tagfilter.c) writes the "<"
// of these nine tags as "&lt;", so the page shows the tag and its content as text.
// A name matches only when whitespace, ">" or "/>" follows it, so "<scriptx>" is a
// tag like any other. Bun's renderer does not apply the filter, so it is applied
// here, to the HTML the renderer wrote.
const FILTERED_TAG_NAMES =
  "title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext";
const FILTERED_TAG = new RegExp(`<(\\/?(?:${FILTERED_TAG_NAMES})(?=[ \\t\\n\\v\\f\\r>]|\\/>))`, "gi");
const FILTERED_TAG_AT_START = new RegExp(`^<\\/?(?:${FILTERED_TAG_NAMES})(?=[ \\t\\n\\v\\f\\r>]|\\/>)`, "i");

/** The HTML as GitHub's tag filter leaves it. */
export function withTagFilter(html: string): string {
  return html.replace(FILTERED_TAG, "&lt;$1");
}

/** True when GitHub's tag filter shows this tag as text rather than as a tag. */
export function isFilteredTag(tag: string): boolean {
  return FILTERED_TAG_AT_START.test(tag);
}

// The renderer decodes "&#10;" into a line break, which would move every later
// sentence in the block down a line. A browser shows it as a space, so it goes in
// as one. A code span shows a reference as written, and there it now reads "&#32;".
// No term a rule names is a line break, so no finding changes.
const NEWLINE_REFERENCE = /&(?:#0*1[03]|#[xX]0*[aAdD]|NewLine);/g;

// GitHub sanitises what its renderer writes: an element on its allowlist is kept,
// and any other element is unwrapped, its tags removed and its text left in place.
// Only a kept element can give text a box of its own, so these are the elements
// that are both kept and rendered as a block, a table part or a line break. An
// unwrapped one joins the text either side of it, as "sh<form></form>all" shows
// "shall". Each name was put to GitHub's Markdown API, and the answers are recorded
// in tests/fixtures/github-rendered.ts.
export const SEPARATING_ELEMENTS: ReadonlySet<string> = new Set([
  "blockquote", "div", "hr", "p", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "section",
  "dd", "dl", "dt", "ol", "ul", "li", "details", "summary", "table", "thead", "tbody",
  "tfoot", "tr", "td", "th", "br",
]);

// The elements whose content never reaches a reader. GitHub keeps a video element,
// and a browser shows its controls rather than its fallback text, while an audio
// element is unwrapped and its text shows. A browser gives rp "display: none". A
// script element that gets past the tag filter, such as "<script/x>", is removed
// by the sanitiser with everything in it, up to the end of the document if it
// never closes. An rp element's end tag may be left out when an rt or rp element
// follows it or its ruby element ends, which the rules below follow.
const HIDDEN_ELEMENTS: ReadonlySet<string> = new Set(["video", "script"]);

// Where a block element starts or ends, the text either side belongs to separate
// blocks, even inside one raw HTML block. This mark records that for the parser,
// and reads as whitespace to everything else.
export const BLOCK_BOUNDARY = "\f";

const TABLE_PARTS: ReadonlySet<string> = new Set(["thead", "tbody", "tfoot", "tr", "td", "th"]);

// The start tags that close an open p element, from the "in body" insertion mode of
// the HTML parser GitHub runs. The sanitiser may then unwrap the element, but the
// paragraph has already ended, so "A sh<address>y</address>all" shows "A sh" and
// "yall" as two blocks. Outside a paragraph the same tag closes nothing. GitHub's
// parser predates dialog and search joining this list, and GitHub's answers show it.
const CLOSES_PARAGRAPH: ReadonlySet<string> = new Set([
  "address", "article", "aside", "blockquote", "center", "details", "dir", "div", "dl",
  "fieldset", "figcaption", "figure", "footer", "header", "hgroup", "main", "menu", "nav",
  "ol", "p", "section", "summary", "ul", "h1", "h2", "h3", "h4", "h5", "h6", "pre",
  "listing", "form", "table", "hr", "li", "dd", "dt",
]);

/** The longest run of backticks in the text. */
function longestTickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/** How many line endings the text holds. */
function lineEndings(text: string): number {
  return text.split("\n").length - 1;
}

const TAG_NAME = /^<\/?([A-Za-z][A-Za-z0-9-]*)/;

/**
 * Where the markup opening at the index ends, or null where the "<" is text.
 *
 * A comment runs to "-->", and anything else opened by "<" and a letter, "/", "!" or
 * "?" runs to the first ">" outside a quoted attribute value. That is the HTML
 * tokeniser's reading, reduced to the question of where the markup stops.
 */
function markupEnd(html: string, index: number): number | null {
  if (!/[A-Za-z/!?]/.test(html[index + 1] ?? "")) return null;
  if (html.startsWith("<!--", index)) {
    const close = html.indexOf("-->", index + 4);
    return close === -1 ? null : close + 3;
  }
  let quote: string | null = null;
  let afterEquals = false;
  for (let at = index + 1; at < html.length; at++) {
    const character = html[at] as string;
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === ">") {
      return at + 1;
    } else if (afterEquals && (character === "\"" || character === "'")) {
      quote = character;
    }
    afterEquals = character === "=" || (afterEquals && /[ \t\n]/.test(character));
  }
  return null;
}

/**
 * The HTML with every line ending inside markup moved out of it.
 *
 * A tag, a comment or a link's title can hold a line ending, and the page shows none
 * of them. Dropped, they moved every later sentence in the block up a line. A block
 * element's tag separates the text either side of it, so its line endings go straight
 * after it and the text beside it keeps its line. Any other markup joins the text
 * either side, as "sh<span\nclass>all" shows one word, so its line endings are written
 * at the next line ending the text reaches instead.
 */
function lineEndingsOutsideMarkup(html: string): string {
  let out = "";
  let owed = 0;
  let index = 0;
  const special = /[<\n]/g;
  while (index < html.length) {
    special.lastIndex = index;
    const found = special.exec(html);
    if (found === null) {
      out += html.slice(index);
      break;
    }
    out += html.slice(index, found.index);
    index = found.index;
    if (html[index] === "\n") {
      out += "\n".repeat(owed + 1);
      owed = 0;
      index += 1;
      continue;
    }
    const end = markupEnd(html, index);
    if (end === null) {
      out += "<";
      index += 1;
      continue;
    }
    const markup = html.slice(index, end);
    const endings = lineEndings(markup);
    const name = TAG_NAME.exec(markup)?.[1]?.toLowerCase();
    out += markup.replace(/\n/g, " ");
    if (name !== undefined && SEPARATING_ELEMENTS.has(name)) out += "\n".repeat(endings);
    else owed += endings;
    index = end;
  }
  return out + "\n".repeat(owed);
}

/**
 * A text node's characters, decoded as the browser decodes them.
 *
 * Each node is decoded alone, because a tag ends a reference: "&nb<em>sp;</em>"
 * shows "&nbsp;" as written, and joining the chunks first invented a space. A
 * decoded line break shows as a space, so it is written as one and every later line
 * keeps its number. A reference never spans a line, so the node is decoded a line
 * at a time.
 */
function decodedNode(raw: string): string {
  return raw.split("\n").map((line) => decodeHtmlText(line).replace(/[\r\n]/g, " ")).join("\n");
}

/**
 * Plain text as the rules read it, where a backslash and a backtick are syntax.
 *
 * The page shows these as characters, so they are escaped here, and the sentence and
 * code span scanners read them back as the characters they are.
 */
function escapedText(text: string): string {
  return text.replace(/[\\`]/g, "\\$&");
}

/**
 * The text an HTML fragment shows, with one line of output for each line of it.
 *
 * Where markup or hidden content held a line ending, that ending is written at the
 * next line ending the text reaches, so a word the markup split still reads as one
 * and the lines after it keep their numbers. Text after hidden content on its closing
 * line is the exception: it reads on the line the content opened on.
 */
export function textOfHtml(html: string, reading: RenderedReading = {}): string {
  return readHtml(html, reading, []).text;
}

/** What a fragment shows, and the hidden elements it leaves open for what follows. */
export interface ReadFragment {
  text: string;
  /** Hidden elements opened and not closed, innermost last. */
  open: string[];
}

/**
 * Read a fragment that may sit inside hidden elements an earlier fragment opened.
 *
 * A raw HTML block can open a video element and leave it open across a blank line,
 * and the paragraphs after it then sit inside the video, hidden, until it closes.
 * Each block is rendered alone, so the elements still open are carried to the next.
 */
export function readHtml(html: string, reading: RenderedReading, carried: readonly string[]): ReadFragment {
  let text = "";
  let raw = "";
  // The carried elements are opened again by the tags written in front of the
  // fragment, so the list starts empty and the handlers fill it.
  const open: string[] = [];
  let tables = 0;
  let paragraphOpen = false;
  let inFallback = false;
  let codeDepth = 0;
  let code = "";
  let owedLineEndings = 0;

  const hidden = (): boolean => open.length > 0 || inFallback;
  const write = (fragment: string): void => {
    if (codeDepth > 0) {
      code += fragment;
      return;
    }
    if (owedLineEndings > 0 && fragment.includes("\n")) {
      text += fragment.replace("\n", "\n".repeat(owedLineEndings + 1));
      owedLineEndings = 0;
      return;
    }
    text += fragment;
  };
  const separate = (): void => {
    if (text !== "") write(BLOCK_BOUNDARY);
  };
  const breakLine = (): void => {
    if (text !== "" && !/\s$/.test(text)) write(" ");
  };
  const closeCode = (): void => {
    codeDepth -= 1;
    if (codeDepth > 0) return;
    const content = code;
    code = "";
    const fence = reading.codeDelimiters ? "`".repeat(longestTickRun(content) + 1) : "";
    write(fence + content + fence);
  };

  // One handler reads every element. HTMLRewriter keeps a single end tag handler per
  // element, so separate handlers for p, table and the separating elements replaced
  // one another, and a paragraph and a table never closed.
  const start = (name: string, element: HTMLRewriterTypes.Element): (() => void)[] => {
    const atEnd: (() => void)[] = [];
    if (CLOSES_PARAGRAPH.has(name)) {
      if (paragraphOpen) separate();
      paragraphOpen = false;
    }
    if (name === "p") {
      paragraphOpen = true;
      atEnd.push(() => { paragraphOpen = false; });
    } else if (name === "table") {
      tables += 1;
      atEnd.push(() => { tables -= 1; });
    } else if (HIDDEN_ELEMENTS.has(name)) {
      open.push(name);
      atEnd.push(() => { open.splice(open.lastIndexOf(name), 1); });
    } else if (name === "rp") {
      inFallback = true;
      atEnd.push(() => { inFallback = false; });
    } else if (name === "rt") {
      inFallback = false;
    } else if (name === "ruby") {
      atEnd.push(() => { inFallback = false; });
    } else if (name === "code") {
      codeDepth += 1;
      atEnd.push(closeCode);
    } else if (name === "img") {
      const alt = element.getAttribute("alt");
      if (reading.altText && alt !== null && !hidden()) {
        write(escapedText(decodeHtmlText(alt).replace(/[\r\n]/g, " ")));
      }
    } else if (name === "br") {
      breakLine();
    }
    // The HTML parser ignores a table part outside a table, so its text joins.
    if (name !== "br" && SEPARATING_ELEMENTS.has(name) && !(TABLE_PARTS.has(name) && tables === 0)) {
      separate();
      atEnd.push(separate);
    }
    return atEnd;
  };

  new HTMLRewriter()
    .on("*", {
      element(element) {
        const atEnd = start(element.tagName, element);
        if (atEnd.length > 0 && element.canHaveContent) {
          element.onEndTag(() => { for (const action of atEnd) action(); });
        }
      },
    })
    .onDocument({
      text(chunk) {
        raw += chunk.text;
        if (!chunk.lastInTextNode) return;
        const node = raw;
        raw = "";
        if (hidden()) {
          owedLineEndings += lineEndings(node);
          return;
        }
        const decoded = decodedNode(node);
        write(codeDepth > 0 ? decoded : escapedText(decoded));
      },
    })
    // The HTML parser reads a "</br>" end tag as a line break, as the standard says it must.
    .transform(carried.map((name) => `<${name}>`).join("")
      + lineEndingsOutsideMarkup(html).replace(/<\/br[ \t\n]*>/gi, "<br>"));

  // A code element left open still shows its text, as the page shows it.
  if (codeDepth > 0) {
    codeDepth = 1;
    closeCode();
  }
  return { text: text.replace(/\s+$/, ""), open };
}

/** The text a Markdown fragment shows on GitHub. */
export function renderedText(markdown: string, reading: RenderedReading = {}): string {
  return readMarkdown(markdown, reading, []).text;
}

/** Read a Markdown fragment inside the hidden elements an earlier one left open. */
export function readMarkdown(markdown: string, reading: RenderedReading, carried: readonly string[]): ReadFragment {
  const html = Bun.markdown.html(markdown.replace(NEWLINE_REFERENCE, "&#32;"));
  return readHtml(withTagFilter(html), reading, carried);
}
