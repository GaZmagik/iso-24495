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

// The elements whose tag separates the text on either side of it, and every other
// tag joins that text. The Rendering section of the HTML Standard (15.3) gives
// these a box of their own: "display: block" for the flow, sectioning, list and
// form elements, "display: table" and its parts, "display: list-item" for li, and a
// line break for br. Every other element renders inline, so "sh<em>all</em>" shows
// one word.
export const SEPARATING_ELEMENTS: ReadonlySet<string> = new Set([
  "html", "body", "address", "blockquote", "center", "dialog", "div", "figure", "figcaption",
  "footer", "form", "header", "hr", "legend", "listing", "main", "p", "plaintext", "pre",
  "search", "xmp", "article", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "hgroup", "nav",
  "section", "dir", "dd", "dl", "dt", "menu", "ol", "ul", "li", "fieldset", "details",
  "summary", "option", "optgroup", "table", "caption", "colgroup", "col", "thead", "tbody",
  "tfoot", "tr", "td", "th", "br",
]);

// The elements GitHub keeps whose content a browser does not show. A video or an
// audio element shows its controls, and its fallback text only where the browser
// cannot play media at all. The HTML Standard's Rendering section gives rp
// "display: none". An rp element's end tag may be left out when an rt or rp element
// follows it or its ruby element ends, which the rules below follow.
const HIDDEN_ELEMENTS = "video, audio";

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
  let text = "";
  let raw = "";
  let hiddenDepth = 0;
  let inFallback = false;
  let codeDepth = 0;
  let code = "";
  let owedLineEndings = 0;

  const hidden = (): boolean => hiddenDepth > 0 || inFallback;
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

  new HTMLRewriter()
    .on(HIDDEN_ELEMENTS, {
      element(element) {
        hiddenDepth += 1;
        element.onEndTag(() => { hiddenDepth -= 1; });
      },
    })
    .on("rp", {
      element(element) {
        inFallback = true;
        element.onEndTag(() => { inFallback = false; });
      },
    })
    .on("rt", { element() { inFallback = false; } })
    .on("ruby", { element(element) { element.onEndTag(() => { inFallback = false; }); } })
    .on("code", {
      element(element) {
        codeDepth += 1;
        element.onEndTag(closeCode);
      },
    })
    .on("img", {
      element(element) {
        const alt = element.getAttribute("alt");
        if (!reading.altText || alt === null || hidden()) return;
        write(escapedText(decodeHtmlText(alt).replace(/[\r\n]/g, " ")));
      },
    })
    .on([...SEPARATING_ELEMENTS].join(", "), {
      element(element) {
        separate();
        if (element.canHaveContent) element.onEndTag(separate);
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
    .transform(lineEndingsOutsideMarkup(html));

  // A code element left open still shows its text, as the page shows it.
  if (codeDepth > 0) {
    codeDepth = 1;
    closeCode();
  }
  return text.replace(/\s+$/, "");
}

/** The text a Markdown fragment shows on GitHub. */
export function renderedText(markdown: string, reading: RenderedReading = {}): string {
  const html = Bun.markdown.html(markdown.replace(NEWLINE_REFERENCE, "&#32;"));
  return textOfHtml(withTagFilter(html), reading);
}
