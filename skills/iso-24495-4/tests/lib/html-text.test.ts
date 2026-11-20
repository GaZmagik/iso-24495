import { describe, expect, test } from "bun:test";
import { readerTexts, STEPS_PER_CHARACTER } from "../../scripts/lib/html-text.ts";
import { documentsDigest, htmlTextDocuments, MULTILINE, SPLITTERS } from "../fixtures/html-text-documents.ts";
import { HTML_TEXT_DOCUMENTS_DIGEST, VALUE_SHOWN } from "../fixtures/html-text-renderings.ts";

/** Characters written by their code points, so no test line holds them as they look. */
const EN_DASH = String.fromCodePoint(0x2013);
const REPLACEMENT = String.fromCodePoint(0xFFFD);
const BACKSLASH = String.fromCharCode(92);

/** Text with each run of white space made one space. */
function single(text: string): string {
  return text.replace(/\s+/gu, " ");
}

/** Whether a reading of the file, or the file as written, holds `value` whole once white space is made single. */
function holds(text: string, value: string): boolean {
  return readerTexts(text).some(reading => single(reading).includes(value)) || single(text).includes(value);
}

/** The readings of a file, each with its white space made single and trimmed. */
function read(text: string): string[] {
  return readerTexts(text).map(reading => single(reading).trim());
}

/**
 * The text Bun's HTMLRewriter gives of HTML, outside comments and the
 * elements a browser never shows. Each chunk of text reaches the handler of
 * the element holding it before the document's, so a chunk a hidden element
 * holds is marked before it is read.
 */
function rewriterText(html: string): string {
  const reading = { text: "", hidden: false };
  new HTMLRewriter()
    .on("script, style, title, iframe, noembed, noframes, noscript", { text: () => markHidden(reading) })
    .onDocument({ text: chunk => keepUnlessHidden(reading, chunk.text) })
    .transform(new Response(html));
  return reading.text;
}

/** Marks the next chunk of text as held by a hidden element. */
function markHidden(reading: { hidden: boolean }): void {
  reading.hidden = true;
}

/** Keeps a chunk of text unless it was marked hidden, and clears the mark. */
function keepUnlessHidden(reading: { text: string; hidden: boolean }, chunk: string): void {
  if (!reading.hidden) reading.text += chunk;
  reading.hidden = false;
}

describe("a value a reader sees whole is held", () => {
  test("review R2-1: a quoted `>` inside a tag that splits a code span does not end the tag", () => {
    expect(holds("Run it first.\n\n<pre>np<span title=\">\">m</span> test</pre>\n", "npm test")).toBe(true);
    // Controls: the same markup with no angle bracket, and the value genuinely cut.
    expect(holds("Run it first.\n\n<pre>np<span title=\"plain\">m</span> test</pre>\n", "npm test")).toBe(true);
    expect(holds("Run it first.\n\n<pre>np<span title=\">\">m</span> tset</pre>\n", "npm test")).toBe(false);
  });

  test("every recorded document whose value the CommonMark reference shows whole is held by a reading", () => {
    const documents = htmlTextDocuments();
    expect(documentsDigest(documents)).toBe(HTML_TEXT_DOCUMENTS_DIGEST);
    expect(VALUE_SHOWN.length).toBe(Math.ceil(documents.length / 4));
    let shown = 0;
    let heldUnshown = 0;
    const missed: string[] = [];
    for (const [index, document] of documents.entries()) {
      const isShown = ((Number.parseInt(VALUE_SHOWN.charAt(index >> 2), 16) >> (3 - (index & 3))) & 1) === 1;
      const held = holds(document.text, document.value);
      if (isShown) shown++;
      if (isShown && !held) missed.push(`${document.family}: ${JSON.stringify(document.text)}`);
      // Where the two readings disagree a value is held, so some values the reference does not show are held too.
      if (!isShown && held) heldUnshown++;
    }
    expect(missed).toEqual([]);
    expect([documents.length, shown]).toEqual([154_906, 110_150]);
    // Not every value the reference hides is held, so the check can fail.
    expect(heldUnshown).toBeLessThan(documents.length - shown);
  }, 120_000);

  test("on raw HTML without a blank line, the HTML reading gives the text HTMLRewriter gives, for every ordered pair of fragments", () => {
    let compared = 0;
    for (const first of [...SPLITTERS, ...MULTILINE]) {
      for (const second of [...SPLITTERS, ...MULTILINE]) {
        const html = `np${first}m${second} test`;
        if (/\n[ \t]*\n/.test(html)) continue;
        compared++;
        expect(single(readerTexts(html)[0] ?? "").trim(), html).toBe(single(rewriterText(html)).trim());
      }
    }
    expect(compared).toBe(4_225);
  });

  test("markup left open where an HTML block ends is read as text, though a browser may close it in the next block", () => {
    // A browser shows 42 here: the comment runs on to the `-->` in the next paragraph's comment.
    expect(holds("Something else.\n\n<div>4<!--\n\n--><!-- x -->2</div>\n", "42")).toBe(false);
    // Control: the same comment closed inside the block.
    expect(holds("Something else.\n\n<div>4<!-- x -->2</div>\n", "42")).toBe(true);
  });
});

describe("markup is read as the HTML tokenizer reads it", () => {
  test("a quoted attribute value runs to its closing quote, and an unquoted one to white space or `>`", () => {
    expect(read("a<b title=\">\" c='<'>b")).toEqual(["ab"]);
    expect(read("a<b c=x>b")).toEqual(["ab"]);
    expect(read("a<b c=\"x\"d='y'/>b")).toEqual(["ab", "a<b c=\"x\"d='y'/>b"]);
    expect(read("a<b / c>b")).toEqual(["ab", "a<b / c>b"]);
  });

  test("an end tag, `</>`, a bogus comment, a declaration and a processing instruction are removed", () => {
    expect(read("a</b x=\">\">b")).toEqual(["ab", "a</b x=\">\">b"]);
    expect(read("a</>b")).toEqual(["ab", "a</>b"]);
    expect(read("a</1>b")).toEqual(["ab", "a</1>b"]);
    expect(read("a<!DOCTYPE x>b")).toEqual(["ab"]);
    expect(read("a<?x>b")).toEqual(["ab", "a<?x>b"]);
  });

  test("a comment runs to `-->` or `--!>`, and `<!-->` and `<!--->` are whole comments", () => {
    expect(read("a<!-- > -->b")).toEqual(["ab"]);
    expect(read("a<!-- --!>b")).toEqual(["ab", "a<!-- --!>b"]);
    expect(read("a<!-- --!> -->b")).toEqual(["a -->b"]);
    expect(read("a<!-->b")).toEqual(["ab"]);
    expect(read("a<!--->b")).toEqual(["ab"]);
    expect(read("a<!--->")).toEqual(["a"]);
    expect(read("a<!--> x")).toEqual(["a x"]);
  });

  test("a `<` that opens no markup, or markup that does not end in its block, is text", () => {
    expect(read("a < b")).toEqual(["a < b"]);
    expect(read("a<3")).toEqual(["a<3"]);
    expect(read("a</")).toEqual(["a</"]);
    expect(read("a<b c=\"x\n\ny\">z")).toEqual(["a<b c=\"x y\">z"]);
    expect(read("a<!-- x\n\ny -->z")).toEqual(["a<!-- x y -->z"]);
    expect(read("a<!x\n\ny>z")).toEqual(["a<!x y>z"]);
  });

  test("a raw HTML block of CommonMark's kinds 1 to 5 holds blank lines, so markup inside it may span them", () => {
    expect(read("<pre>np<b title=\"x\n\ny\">m</b> test</pre>")).toEqual(["npm test"]);
    expect(read("<!--\n\n-->a")).toEqual(["a"]);
    expect(read("<?x\n\n?>a")).toEqual(["a"]);
    expect(read("<![CDATA[\n\n]]>a")).toEqual(["a"]);
    expect(read("<!X\n\nx>a")).toEqual(["a"]);
    // A block whose end never comes runs to the end of the file.
    expect(read("<pre>a<b c=\"\n\n\">b")).toEqual(["ab"]);
    // Control: with no block opening at a line's start, a blank line ends the markup.
    expect(read("x <!--\n\n-->a")).toEqual(["x <!-- -->a"]);
  });
});

describe("raw text elements", () => {
  test("the content of script, style, title, iframe, noembed, noframes and noscript is not text", () => {
    for (const name of ["script", "style", "title", "iframe", "noembed", "noframes", "noscript"]) {
      expect(read(`a<${name}>x<b>y</${name}>b`), name).toEqual(["ab"]);
    }
    expect(read("a<SCRIPT>x</script >b")).toEqual(["ab"]);
    // Control: a longer name is an ordinary tag.
    expect(read("a<scripts>x</scripts>b")).toEqual(["axb"]);
  });

  test("hidden content runs past blank lines to its end tag, or to the end of the file, as a browser hides it", () => {
    expect(read("np<script>\n\nx\n\n</script>m test")).toEqual(["npm test"]);
    expect(read("a<style>\n\nx")).toEqual(["a"]);
    expect(read("a<script>x</script")).toEqual(["a"]);
  });

  test("a script's escaped stretches are read as the tokenizer reads them", () => {
    // In prose, CommonMark shows a `<!--` that no `-->` closes as text, so the Markdown reading ends the script sooner.
    expect(read("a<script><!--<script></script>x</script>b")).toEqual(["ab", "axb"]);
    expect(read("a<script><!--</script>b")).toEqual(["ab"]);
    expect(read("a<script><!--x-->x</script>b")).toEqual(["ab"]);
    expect(read("a<script><!-->x</script>b")).toEqual(["ab"]);
    // A script with no end tag hides the rest of the file, and the scripts inside it add nothing to read.
    expect(read("a<script><!--<script>x\n\ny<script>z")).toEqual(["a"]);
  });

  test("textarea shows its content decoded, xmp as written and plaintext the rest of its block", () => {
    expect(read("a<textarea>&lt;x</textarea>b")).toEqual(["a<xb"]);
    expect(read("a<xmp>&lt;<b></xmp>b")).toEqual(["a&lt;<b>b"]);
    expect(read("a<plaintext><b>x")).toEqual(["a<b>x"]);
    // Control: one whose end tag is not in its block is an ordinary tag.
    expect(read("a<textarea>x\n\ny</textarea>b")).toEqual(["ax yb"]);
  });
});

describe("character references", () => {
  test("are decoded as HTML decodes them in text, legacy names and numbers without a semicolon included", () => {
    expect(read("<p>a&amp;b &ampx &notin; &notit; &#38 &#x26; &#150; &#0; &#xD800; &#1114112; &bogus; &#;</p>"))
      .toEqual([`a&b &x ∉ ¬it; & & ${EN_DASH} ${REPLACEMENT} ${REPLACEMENT} ${REPLACEMENT} &bogus; &#;`]);
  });

  test("in prose, the Markdown reading decodes only those CommonMark decodes", () => {
    expect(read("`a` &ampx &amp;")).toEqual(["`a` &x &", "a &ampx &"]);
  });
});

describe("the Markdown reading", () => {
  test("code spans and code blocks show their text as written", () => {
    expect(read("Use `<!--` then np<b>m</b> test and `-->`.")).toEqual(["Use ``.", "Use <!-- then npm test and -->."]);
    expect(read("Use ` <b> ` and `  `.")).toEqual(["Use ` ` and ` `.", "Use <b> and ."]);
    expect(read("```\n<!--\n```\nnp<b>m</b> test")).toEqual(["``` <!-- ``` npm test", "<!-- npm test"]);
    expect(read("x\n\n    <script>\nnp<script>x</script>m test")).toEqual(["x m test", "x <script> npm test"]);
    expect(read("```\n<a title=\"")).toEqual(["``` <a title=\"", "<a title=\""]);
  });

  test("a `<` that a backslash escapes is text, and the escape is read", () => {
    expect(read(`a${BACKSLASH}<b>c`)).toEqual([`a${BACKSLASH}c`, "a<b>c"]);
    expect(read(`a${BACKSLASH}${BACKSLASH}<b>c`)).toEqual([`a${BACKSLASH}${BACKSLASH}c`, `a${BACKSLASH}c`]);
  });

  test("in prose, only markup of CommonMark's form is markup", () => {
    expect(read("Use <b c=\"x\"d=\"> then np<b>m test \"> now.")).toEqual(["Use now.", "Use <b c=\"x\"d=\"> then npm test \"> now."]);
    expect(read("Use <b c=`x> np<b>m test")).toEqual(["Use npm test", "Use <b c=`x> npm test"]);
    for (const tagLike of ["<b =x>", "<b c=d=e>", "</b x>", "<?x>", "<!1>", "<b/c>"]) {
      expect(read(`a ${tagLike} b`), tagLike).toEqual(["a b", `a ${tagLike} b`]);
    }
    // Control: every form CommonMark allows is removed in both readings.
    expect(read("a <b c d=e f='g' h=\"i\" /> <!-- x --> <?x?> <!X y> <![CDATA[z]]> </b > b")).toEqual(["a b"]);
  });

  test("a comment, processing instruction or CDATA section CommonMark passes whole shows what a browser shows of it", () => {
    expect(read("np<!-- --!>m<!-- x --> test")).toEqual(["npm test"]);
    expect(read("a <?x > y?> b")).toEqual(["a y?> b"]);
    expect(read("a <![CDATA[x>y]]> b")).toEqual(["a y]]> b"]);
  });

  test("a script in prose runs to a closing tag of CommonMark's form, through an escaped stretch CommonMark passes", () => {
    expect(read("a<script>x</script y>z</script>b")).toEqual(["azb", "ab"]);
    // The rest of a comment CommonMark passed whole, after the script ends inside it, is HTML.
    expect(read("a<script><!--</script><?x>&<!---->b")).toEqual(["a&b"]);
    // Control: a `<!--` that no `-->` closes before a blank line is text to CommonMark, so it starts no escaped stretch.
    expect(read("a<script><!--<script></script>x\n\n</script>b")).toEqual(["ab", "ax b"]);
  });

  test("an HTML block is read as HTML, from the line that opens it", () => {
    expect(read("Text\n<div>a<b \"c>b</div>")).toEqual(["Text ab"]);
    expect(read("<b>\nnp<b \"c>m test")).toEqual(["npm test"]);
    expect(read("- <div>\n  np<b \"c>m test")).toEqual(["- npm test", "npm test"]);
    // Kind 7 does not interrupt a paragraph.
    expect(read("Text\n<b>\nnp<b \"c>m test")).toEqual(["Text npm test", "Text np<b \"c>m test"]);
    // An HTML block's end closes a tag it leaves open, as the markup CommonMark writes after it does.
    expect(read("<pre>a<script>\nx\n</script>b<c\nd\n")).toEqual(["ab<c d", "abd"]);
  });

  test("quotation markers are taken off as CommonMark takes them, and a quotation's end ends a block", () => {
    // Inside an HTML block a line loses only its quotation's markers, and a further `>` is HTML.
    expect(read("> <pre>np<span title=\"a\n> >b\">m</span> test</pre>")).toEqual(["> npm test", "npm test"]);
    expect(read("> <pre>np<b\n> > m test</pre>")).toEqual(["> np > m test", "np m test"]);
    // A lazy line goes on with a paragraph.
    expect(read("> np<a\ntitle=\">\">m test")).toEqual(["> npm test", "npm test"]);
    // A line with fewer markers ends an HTML block and its quotation, and the markup written there closes the tag.
    expect(read("> <pre>Use <b\nc=\"\n\"d=\"> then np<b>m test \"> now.</pre>")).toEqual(["> Use now.", "Use c=\" \"d=\"> then npm test \"> now."]);
    // A deeper quotation after a paragraph ends the block, and CommonMark shows the tag it cuts short as text.
    expect(read("> np<b\n> > c=\"x\"> m")).toEqual(["> np > c=\"x\"> m", "np<b c=\"x\"> m"]);
  });
});

describe("the work grows in proportion to the file", () => {
  test("on inputs built to make a scanner read back, each character is looked at no more than the bound allows, at any size", () => {
    const shapes: Record<string, (count: number) => string> = {
      openTags: count => "<a ".repeat(count),
      openQuotes: count => "<a b=\"<a c='".repeat(count),
      comments: count => "<!--".repeat(count),
      bangs: count => "<!".repeat(count),
      scripts: count => "<script><!--<script>".repeat(count),
      styles: count => "<style>".repeat(count),
      ticks: count => "`<a b=\"".repeat(count),
      quotes: count => Array.from({ length: count }, (unused, index) => `${"> ".repeat(index % 20)}<pre>x<b`).join("\n"),
      blocks: count => "<pre>\n\n".repeat(count),
      lists: count => "- > <div>\n  > x<b\n".repeat(count),
    };
    for (const [name, make] of Object.entries(shapes)) {
      const perCharacter = [1_000, 8_000].map(count => {
        const text = make(count);
        const steps = { count: 0 };
        readerTexts(text, steps);
        return steps.count / text.length;
      });
      expect(Math.max(...perCharacter), name).toBeLessThanOrEqual(STEPS_PER_CHARACTER);
      // Eight times the text takes no more steps for each character.
      expect(perCharacter[1] ?? 0, name).toBeLessThanOrEqual((perCharacter[0] ?? 0) * 1.01);
    }
  });
});
