import { describe, expect, test } from "bun:test";
import { readerTexts, STEPS_PER_CHARACTER, valueReading } from "../../scripts/lib/html-text.ts";
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

/**
 * Whether the value search holds `value` in a file: the file is in doubt, or
 * a text it reads, or the file as written, holds the value whole once white
 * space is made single.
 */
function holds(text: string, value: string): boolean {
  const reading = valueReading(text);
  return reading.inDoubt || reading.texts.some(texts => single(texts).includes(value)) || single(text).includes(value);
}

/** The texts the value search reads of a file, each with its white space made single and trimmed. */
function valueTexts(text: string): string[] {
  return valueReading(text).texts.map(reading => single(reading).trim());
}

/** Whether the value search reads a file as in doubt. */
function inDoubt(text: string): boolean {
  return valueReading(text).inDoubt;
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
      // Where the readings disagree, or the file is in doubt, a value is held, so some values the reference does not show are held too.
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

  test("a comment an HTML block leaves open runs on to the next `-->`, or to the end of the file, as a browser reads it on", () => {
    expect(holds("Something else.\n\n<div>4<!--\n\n--><!-- x -->2</div>\n", "42")).toBe(true);
    expect(read("<div>4<!--\n\n2\n\n3")).toEqual(["4<!-- 2 3", "4"]);
    // Control: in prose CommonMark shows a comment left open as text, so it runs on nowhere.
    expect(read("4<!--\n\n--><!-- x -->2")).toEqual(["4<!-- -->2"]);
  });

});

// Each specimen below shows its value to a reader, as commonmark.js and parse5
// render it, and each control does not. Without the doubt, every specimen of
// the first test was a value listed though a reader sees it.
describe("markup left open across the end of a block puts the file in doubt, and every value is then held", () => {
  test("a browser reads it on into what CommonMark writes next, which no reading here follows", () => {
    // A browser ends the comment only at a `-->` CommonMark passes as HTML, so it hides the x.
    expect(holds("Something else.\n\n<div>4<!--\n\n-->x<!-- x -->2</div>\n", "42")).toBe(true);
    // In a tight list CommonMark writes no paragraph tag, so a browser reads the open tag on to the next `>`.
    expect(holds("Something else.\n\n- <pre></pre>4<b\n  c=\"x <i>2</i>\n", "42")).toBe(true);
    // The open tag takes the paragraph tag CommonMark writes next, so the text joins with no space.
    expect(holds("Run it first.\n\n> <style></style>npm tes<b\n>t\n", "npm test")).toBe(true);
    // The script CommonMark leaves open at the end of the list item hides the paragraph after the list.
    expect(holds("Run it first.\n\n- <script>\n\nx\n\n</script>npm test\n", "npm test")).toBe(true);
    // Controls: the same blocks with their markup closed leave no doubt, so a value they cut is listed.
    expect(holds("Something else.\n\n<div>4<!-- x -->x2</div>\n", "42")).toBe(false);
    expect(holds("Something else.\n\n- <pre></pre>4<b>\n  c=\"x <i>3</i>\n", "42")).toBe(false);
    expect(holds("Run it first.\n\n> <style></style>npm tes<b>\n>x\n", "npm test")).toBe(false);
    expect(holds("Run it first.\n\n- <script>x</script>npm tset\n", "npm test")).toBe(false);
  });

  test("a tag an HTML block leaves open puts the file in doubt, whether the block's end closes it or it stands in a quoted value", () => {
    expect(inDoubt("<div>a<b\n\nc")).toBe(true);
    expect(holds("Run it first.\n\n<div>np<span title=\"x\n\n<b c=\"y\">m test</b></div>\n", "npm test")).toBe(true);
    expect(inDoubt("<div>a</b\n\nc")).toBe(true);
    // The end tag of an element read to its end tag is a tag too.
    expect(holds("Something else.\n\n- <pre></pre>4<style></style\n  c=\"x <i>2</i>\n", "42")).toBe(true);
    expect(holds("Something else.\n\n- <pre></pre>4<style></style>\n  c=\"x <i>3</i>\n", "42")).toBe(false);
    // A browser ends the processing instruction CommonMark passes whole at its first `>`, so the tag after it runs on.
    expect(holds("Run it first.\n\nnp<?x >m<b c=\"?> z\n\n<p title=\"\"> test</p>\n", "npm test")).toBe(true);
    expect(holds("Run it first.\n\nnp<?x >m<b c=\"\"?> z\n\n<p title=\"\"> test</p>\n", "npm test")).toBe(false);
    // Controls: a tag closed at the block's last character, and a tag left open in prose, which CommonMark shows as text.
    expect(inDoubt("<div>a<b>")).toBe(false);
    expect(inDoubt("<div>a<b>\n\nc")).toBe(false);
    expect(inDoubt("a<b\n\nc")).toBe(false);
    expect(holds("Run it first.\n\n<div>np<span title=\"x\">\n\n<b c=\"y\">m tset</b></div>\n", "npm test")).toBe(false);
  });

  test("a comment, declaration or processing instruction an HTML block leaves open puts the file in doubt", () => {
    expect(inDoubt("<div>a<!--\n\n-->b")).toBe(true);
    expect(inDoubt("<div>a<!x\n\nb")).toBe(true);
    expect(inDoubt("<div>a<?x\n\nb")).toBe(true);
    // Controls: closed inside the block, and left open in prose.
    expect(inDoubt("<div>a<!-- x --><!x><?x?>\n\nb")).toBe(false);
    expect(inDoubt("a<!--\n\n-->b")).toBe(false);
  });

  test("content a browser reads to its end tag puts the file in doubt when that tag is not in the block, and so does plaintext", () => {
    expect(inDoubt("np<script>\n\nx\n\n</script>m test")).toBe(true);
    expect(inDoubt("a<style>\n\nx</style>")).toBe(true);
    expect(inDoubt("<div>a<textarea>x\n\ny</textarea>b")).toBe(true);
    expect(inDoubt("np<xmp>m\n\ntest</xmp>")).toBe(true);
    expect(inDoubt("a<plaintext>b")).toBe(true);
    // Hidden content that runs to the end of the file hides the rest from a browser too, so it leaves no doubt.
    expect(inDoubt("a<script>x")).toBe(false);
    // Controls: each closed inside its block.
    expect(inDoubt("a<script>x</script><style>y</style><textarea>z</textarea><xmp>w</xmp>b")).toBe(false);
  });

  test("an HTML block or fence opened in a list item or quotation puts the file in doubt when a line falls out of the container before the block ends", () => {
    // The pre's line after the marker is not indented to the item's content, so the item ends there and the HTML block with it.
    expect(holds("Run it first.\n\n- <pre>\nnpm test</pre>\n", "npm test")).toBe(true);
    // The fence's next line is indented two columns where the item's content starts at three.
    expect(holds("Something else.\n\n-  ```\n  <a title=\"\n  ``` 4<span title=\"<\">2`\n", "42")).toBe(true);
    // A closing fence that falls out of the item does not close the item's fence.
    expect(inDoubt("- ```\n  x\n```\nnpm test\n")).toBe(true);
    // A line without the quotation's marker ends the quotation and the fence in it, and a blank line without one does too.
    expect(inDoubt("> ```\n> x\nnpm test\n> ```\n")).toBe(true);
    expect(inDoubt("> ```\n\n> x\n> ```\n")).toBe(true);
    expect(inDoubt("1. <div>\nx\n")).toBe(true);
    // Controls: every line indented to the item's content or held in the quotation, and a fence outside any container.
    expect(holds("Run it first.\n\n- <pre>\n  npm tset</pre>\n", "npm test")).toBe(false);
    expect(holds("Something else.\n\n-  ```\n   <a title=\"\n   ```\n  4<span title=\"<\">3`\n", "42")).toBe(false);
    expect(inDoubt("- ```\n\n  x\n  ```\n> ```\n>\n> x\n> ```\n```\nx\n```\n- a\n\n  ```\n  b\n  ```\n")).toBe(false);
  });

  test("an HTML block or fence that opens indented at the top level, with a later line indented less, is in doubt too, though CommonMark leaves nothing open", () => {
    // The comparison reads the line as falling out of a list item, which this file does not have.
    expect(inDoubt("Run it first.\n\n  <div>\nnpm test\n</div>\n")).toBe(true);
    expect(inDoubt("Run it.\n\n  ```\nx\n  ```\n")).toBe(true);
    // Controls: the same blocks not indented.
    expect(inDoubt("Run it first.\n\n<div>\nnpm test\n</div>\n")).toBe(false);
    expect(inDoubt("Run it.\n\n```\nx\n```\n")).toBe(false);
  });

  test("a code span inside an HTML block's comment or attribute puts the file in doubt, though CommonMark reads no code span there and leaves nothing open", () => {
    // A code span is read before HTML blocks are found, as nvm's README line 11 and llama.cpp's README show.
    expect(inDoubt("Text.\n\n<!-- run `a` then `b` -->\n\nMore.\n")).toBe(true);
    expect(inDoubt("<table>\n<tr><td><img alt=\"a `b` c\" src=\"x\"></td></tr>\n</table>\n\nMore.\n")).toBe(true);
    // Controls: the same markup without the code span.
    expect(inDoubt("Text.\n\n<!-- run a then b -->\n\nMore.\n")).toBe(false);
    expect(inDoubt("<table>\n<tr><td><img alt=\"a b c\" src=\"x\"></td></tr>\n</table>\n\nMore.\n")).toBe(false);
  });
});

describe("the value search reads the file a third time", () => {
  test("as HTML with each line's quotation and list markers, and a backslash that ends a line, taken off", () => {
    // CommonMark reads no code span inside an HTML block.
    expect(holds("Run it first.\n\n<pre> Use `\"` here. npm t<b\n><o:p>est</pre>\n", "npm test")).toBe(true);
    // A quotation's marker after a list item's.
    expect(holds("Run it first.\n\nnpm\n- > te<b>st\n", "npm test")).toBe(true);
    // A backslash before a line break is a hard line break, not text.
    expect(holds(`Run it first.\n\nnp<b>m${BACKSLASH}\ntest\n`, "npm test")).toBe(true);
    // Controls: the same files with the value cut.
    expect(holds("Run it first.\n\n<pre> Use `\"` here. npm t<b\n><o:p>sst</pre>\n", "npm test")).toBe(false);
    expect(holds("Run it first.\n\nnpm\n- > tx<b>st\n", "npm test")).toBe(false);
    expect(holds(`Run it first.\n\nnp<b>m${BACKSLASH}\ntset\n`, "npm test")).toBe(false);
  });

  test("and gives it only when it differs from both readings", () => {
    expect(valueTexts("np<b>m test")).toEqual(["npm test"]);
    expect(valueTexts(`a${BACKSLASH}\nb`)).toEqual([`a${BACKSLASH} b`, "a b"]);
    expect(valueTexts("> `<b>`")).toEqual(["> ``", "<b>", "``"]);
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
        valueReading(text, steps);
        return steps.count / text.length;
      });
      expect(Math.max(...perCharacter), name).toBeLessThanOrEqual(STEPS_PER_CHARACTER);
      // Eight times the text takes no more steps for each character.
      expect(perCharacter[1] ?? 0, name).toBeLessThanOrEqual((perCharacter[0] ?? 0) * 1.01);
    }
  });
});
