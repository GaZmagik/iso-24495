import { describe, expect, test } from "bun:test";
import { auditText } from "../scripts/audit-corpus.ts";
import { readerProseBlocks } from "../scripts/lib/parse.ts";
import {
  isFilteredTag,
  renderedText,
  textOfHtml,
  withTagFilter,
} from "../scripts/lib/rendered-text.ts";
import { hasVisibleText, shownText } from "../../../scripts/visible-text.ts";
import { GITHUB_RENDERINGS } from "./fixtures/github-rendered.ts";
import { githubText } from "./reference/github-text.ts";

const AUDIT = { altText: true, codeDelimiters: true };

function rulesFor(text: string): string[] {
  return auditText(text).map((violation) => violation.rule);
}

describe("rendered text", () => {
  // GitHub's own answers, recorded by reference/build-github-fixture.ts. Every
  // document the engine reads the way GitHub shows it must go on doing so, and
  // every one it reads differently carries the reason why.
  // GitHub's answer is read by its own small reader, not the engine's, so a mistake
  // in the engine cannot appear on both sides and cancel out.
  test("the text this engine reads is the text GitHub shows", () => {
    const normalised = (text: string): string => text.replace(/[\s\f]+/g, " ").trim();
    const same = GITHUB_RENDERINGS.filter((entry) => entry.differsFromGitHub === undefined);
    expect(same.length).toBeGreaterThan(280);
    for (const entry of same) {
      expect(normalised(shownText(entry.markdown)), entry.name).toBe(githubText(entry.html));
    }
    for (const entry of GITHUB_RENDERINGS.filter((each) => each.differsFromGitHub !== undefined)) {
      expect(normalised(shownText(entry.markdown)), entry.name).not.toBe(githubText(entry.html));
    }
  });

  test("GitHub's tag filter shows nine tags as text, and matches them by name exactly", () => {
    for (const name of ["title", "textarea", "style", "xmp", "iframe", "noembed", "noframes", "script", "plaintext"]) {
      expect(withTagFilter(`<${name}>x</${name}>`)).toBe(`&lt;${name}>x&lt;/${name}>`);
      expect(isFilteredTag(`<${name.toUpperCase()} a="b">`)).toBe(true);
    }
    expect(withTagFilter("<script/>")).toBe("&lt;script/>");
    // Whitespace, ">" or "/>" must follow the name, so these are tags like any other.
    for (const tag of ["<scriptx>", "<scripts>", "<script/x>"]) {
      expect(withTagFilter(tag)).toBe(tag);
      expect(isFilteredTag(tag)).toBe(false);
    }
  });

  test("the words a reader sees come through whole, whatever markup split them", () => {
    // Emphasis, a bogus comment and a tag written with a slash each show one word.
    for (const text of [
      "We sh*all* pay.",
      "<div>We sh<!x>all pay.</div>",
      "<div>We sh<em/all>all pay.</div>",
    ]) {
      expect(renderedText(text, AUDIT), text).toBe("We shall pay.");
      expect(rulesFor(text), text).toContain("legalese");
    }
    // Underscores inside a word are not emphasis, so no word is formed.
    expect(renderedText("We sh_all_ pay.")).toBe("We sh_all_ pay.");
    expect(rulesFor("We act in **order** to help.")).toContain("wordy-phrase");
  });

  test("each text node decodes alone, because a tag ends a reference", () => {
    expect(renderedText("<div>&nb<em>sp;</em></div>")).toBe("&nbsp;");
    expect(hasVisibleText("<div>&nb<em>sp;</em></div>")).toBe(true);
    // A quotation mark written as a reference names a term as a literal one does.
    expect(renderedText("Replace &quot;shall&quot; now.", AUDIT)).toBe('Replace "shall" now.');
    expect(rulesFor("Replace &quot;shall&quot; with &quot;must&quot;.")).not.toContain("legalese");
  });

  test("video and rp content is hidden, and rp ends where its end tag may be left out", () => {
    expect(renderedText("<video>Plain words.</video>")).toBe("");
    expect(hasVisibleText("<video>Plain words.</video>")).toBe(false);
    // GitHub unwraps an audio element, so its text shows.
    expect(hasVisibleText("<audio><p>Plain words.</p></audio>")).toBe(true);
    expect(renderedText("<ruby><rp>(<rt>This change works.</rt></ruby>")).toBe("This change works.");
    expect(hasVisibleText("<ruby><rp>(<rt>This change works.</rt></ruby>")).toBe(true);
    expect(renderedText("<ruby>a<rp>(</rp><rt>b</rt><rp>)</rp></ruby> c")).toBe("ab c");
    expect(renderedText("<ruby>a<rp>(</ruby> c")).toBe("a c");
    expect(renderedText("<ruby>a<rp>(<rp>)</ruby> c")).toBe("a c");
    // A ruby nested inside an rp cannot end it.
    expect(hasVisibleText("<ruby><rp><ruby></ruby>This change works.</rp></ruby>")).toBe(false);
    expect(renderedText("<ruby><rp><ruby>x</ruby>y</rp>z</ruby> w")).toBe("z w");
    // An rt in the nested ruby ends that ruby's rp only, not the outer one.
    expect(renderedText("<ruby><rp><ruby>x<rt>y</rt></ruby>z</rp></ruby> w").trim()).toBe("w");
    // An rp outside any ruby still hides its content, and one rp inside another keeps
    // the outer one hiding when it closes.
    expect(renderedText("a<rp>b</rp>c")).toBe("ac");
    expect(hasVisibleText("<rp><rp></rp>Plain words.</rp>")).toBe(false);
    expect(renderedText("<rp><rp>a</rp>b</rp>c")).toBe("c");
    // Inside a ruby, a second rp closes the first, and an rt closes it too.
    expect(renderedText("<ruby><rp>a<rp>b</rp>c</ruby>")).toBe("c");
    // Inside a select the HTML parser ignores every tag but its options, so an "</rp>"
    // there closes nothing, and a select or a control start tag ends the select.
    expect(hasVisibleText("<rp><select></rp>This change works.</select></rp>")).toBe(false);
    // GitHub renders these "<rp>abc</rp>d", "xy" and "xy&lt;textarea&gt;z": text inside
    // a select stays, and a second select ends the first, so the "</rp>" after it counts.
    expect(renderedText("<rp><select><option>a</option></rp>b<select>c</rp>d")).toBe("d");
    expect(renderedText("x<select></rp><input>y")).toBe("xy");
    // An input or keygen ends the select, so the "</rp>" after it closes the rp. A
    // textarea does not, because the tag filter has already escaped it to text.
    expect(renderedText("<rp><select><input></rp>x")).toBe("x");
    expect(renderedText("<rp><select><keygen></rp>x")).toBe("x");
    expect(renderedText("<rp><select><textarea></rp>x")).toBe("");
    expect(renderedText("x<select><span>y</span><textarea>z")).toBe("xy<textarea>z");
  });

  test("the rules keep a code span's backticks and an image's words, and the visibility check does not", () => {
    const tick = String.fromCharCode(96);
    expect(renderedText(`Use ${tick}a < b${tick} and ${tick}${tick}x${tick}y${tick}${tick}.`, AUDIT))
      .toBe(`Use ${tick}a < b${tick} and ${tick}${tick}x${tick}y${tick}${tick}.`);
    expect(renderedText(`Use ${tick}a${tick}.`)).toBe("Use a.");
    expect(hasVisibleText(`${tick} ${tick}`)).toBe(false);
    expect(renderedText("An ![alt *words*](i.png) here.", AUDIT)).toBe("An alt words here.");
    expect(hasVisibleText("![alt words](i.png)")).toBe(false);
    // A code element left open still shows its text, and nesting keeps it whole.
    expect(textOfHtml("a <code>b c", AUDIT)).toBe(`a ${tick}b c${tick}`);
    expect(textOfHtml("<code>We <code>x</code> shall</code> y", AUDIT)).toBe(`${tick}We x shall${tick} y`);
  });

  test("a backslash and a backtick the page shows are escaped, as the scanners read them", () => {
    const slash = String.fromCharCode(92);
    const tick = String.fromCharCode(96);
    expect(renderedText(`a ${slash}${tick} b ${slash}${slash} c`, AUDIT)).toBe(`a ${slash}${tick} b ${slash}${slash} c`);
  });

  test("every line keeps its number, whatever markup held a line ending", () => {
    // A comment, an inline tag and a link title owe their line endings to the next one.
    expect(renderedText("one\ntwo <!-- a\nb --> three\nfour")).toBe("one\ntwo  three\n\nfour");
    expect(renderedText('We sh<span\nclass="x">all</span> pay.\nnext')).toBe("We shall pay.\n\nnext");
    // A block element's tag separates, so the text beside it keeps its own line.
    expect(textOfHtml('<div\nclass="n">We pay.</div>')).toBe("\nWe pay.");
    // A decoded line break shows as a space, as a browser shows it.
    expect(renderedText("a&#10;b\nc")).toBe("a b\nc");
    expect(textOfHtml("<div>a&#10b</div>")).toBe("a b");
    // A "<" that opens no markup, and markup that never closes, are text.
    expect(textOfHtml("a < b")).toBe("a < b");
    expect(textOfHtml("plain")).toBe("plain");
    expect(textOfHtml('a <b c="d>')).toBe("a");
    expect(textOfHtml("a <!-- b")).toBe("a");
  });

  test("a hidden element one block leaves open hides the blocks after it", () => {
    // GitHub removes a script the tag filter misses to the end of the document.
    expect(rulesFor("<div><script/x>hidden</div>\n\nThe party shall act.")).not.toContain("legalese");
    expect(hasVisibleText("<div><script/x>hidden</div>\n\nThe party shall act.")).toBe(false);
    // A video left open across blank lines holds the paragraphs inside it.
    expect(rulesFor("<video>\n\nThe party shall act.\n\n</video>")).not.toContain("legalese");
    expect(hasVisibleText("<video>\n\nThe party shall act.\n\n</video>")).toBe(false);
    // Once it closes, what follows shows again, and so does a heading.
    const closed = auditText("<video>\n\nHidden.\n\n</video>\n\nThe party shall act.\n\n## Shall we");
    expect(closed.filter((violation) => violation.rule === "legalese").map((violation) => violation.line))
      .toEqual([7, 9]);
    // A paragraph's own end tag closes a video it opened, so the next block shows.
    expect(rulesFor("A <video> b\n\nThe party shall act.")).toContain("legalese");
    // A video left open inside a quotation or list item closes when that container ends.
    for (const container of ["> <video>", "- <video>"]) {
      expect(rulesFor(`${container}\n\nThe tenant shall pay.`), container).toContain("legalese");
    }
    // Inside the same container it still hides what follows.
    expect(rulesFor("> <video>\n>\n> The tenant shall pay.")).not.toContain("legalese");
    // An rp left open with its ruby is carried with it, so an rt in a later block closes it.
    expect(rulesFor("<div><ruby><rp>\n\n<rt>We shall pay.</rt></ruby></div>")).toContain("legalese");
    // An rp left open by a raw HTML block hides what follows, as a video does.
    expect(rulesFor("This change works.\n\n<rp>\n\nThe tenant shall pay.")).not.toContain("legalese");
    expect(rulesFor("<rp>\n\n</rp>\n\nThe tenant shall pay.")).toContain("legalese");
    // A used footnote is shown at the foot of the page, outside any open video.
    expect(rulesFor("A[^a].\n\n<video>\n\n[^a]: The tenant shall pay.")).toContain("legalese");
    // A heading inside an open video is hidden with it.
    expect(rulesFor("<video>\n\n## The party shall act\n\n</video>")).not.toContain("legalese");
  });

  test("one raw HTML block can hold several paragraphs, as the page shows them", () => {
    const six = ["One.", "Two.", "Three.", "Four.", "Five.", "Six."].map((line) => `<p>${line}</p>`).join("\n");
    expect(rulesFor(six)).not.toContain("paragraph-length");
    const blocks = readerProseBlocks(six);
    expect(blocks.map((block) => [block.line, block.lines.join("")])).toEqual([
      [1, "One."], [2, "Two."], [3, "Three."], [4, "Four."], [5, "Five."], [6, "Six."],
    ]);
    // A paragraph's end starts a new block even where the next line opens no element.
    expect(readerProseBlocks("<div><p>One.</p>\nTwo.</div>").map((block) => [block.line, block.lines.join("")]))
      .toEqual([[1, "One."], [2, "Two."]]);
    // Six sentences in one paragraph are still one paragraph.
    expect(rulesFor(`<p>${"A sentence. ".repeat(6).trim()}</p>`)).toContain("paragraph-length");
  });

  test("a word joiner, a soft hyphen or a zero-width space inside a word leaves the word whole", () => {
    for (const text of ["The tenant sh&#8288;all pay.", "The tenant sh&shy;all pay.", "The tenant sh&#8203;all pay."]) {
      expect(rulesFor(text), text).toContain("legalese");
    }
    expect(hasVisibleText("&#8203;&#8288;")).toBe(false);
    expect(renderedText("![sh&#8288;all](i.png)", AUDIT)).toBe("shall");
  });

  test("paragraphs on one line are separate blocks, as the page shows them", () => {
    const line = ["One sentence.", "Two here.", "Three here.", "Four here.", "Five here.", "Six here."]
      .map((sentence) => `<p>${sentence}</p>`).join("");
    expect(rulesFor(line)).not.toContain("paragraph-length");
    expect(readerProseBlocks(line).map((block) => [block.line, block.lines.join("")])).toEqual([
      [1, "One sentence."], [1, "Two here."], [1, "Three here."], [1, "Four here."], [1, "Five here."], [1, "Six here."],
    ]);
    // A block element inside a line starts a block of its own.
    expect(readerProseBlocks("<div>We <section>shall</section>pay.</div>").map((block) => block.lines[0]))
      .toEqual(["We", "shall", "pay."]);
    // An acronym defined in one paragraph on a line counts for the next one there.
    expect(rulesFor("<p>Identity and access management (IAM).</p><p>Use IAM.</p>")).not.toContain("acronym-undefined");
    expect(rulesFor("<p>Use IAM.</p><p>Identity and access management (IAM).</p>")).toContain("acronym-undefined");
  });

  test("a footnote shows only where something refers to it, and without its label", () => {
    // A reference inside an attribute or a code span refers to nothing on the page.
    expect(hasVisibleText("<span title=\"[^a]\"></span>\n\n[^a]: Plain words.")).toBe(false);
    expect(rulesFor("Use `[^a]` here.\n\n[^a]: The tenant shall pay.")).not.toContain("legalese");
    // A footnote's later paragraphs, indented four columns, are part of it.
    const paragraphs = "Read the note[^a].\n\n[^a]: First paragraph.\n\n    The tenant shall pay.";
    expect(auditText(paragraphs).filter((violation) => violation.rule === "legalese").map((violation) => violation.line))
      .toEqual([5]);
    expect(rulesFor("[^a]: First paragraph.\n\n    The tenant shall pay.")).not.toContain("legalese");
    // A reference is what the Markdown makes one: an escaped bracket, a bracket written
    // as a reference, a link destination and an autolink refer to nothing.
    for (const reference of ["\\[^a]", "&#91;^a]", "[x](/[^a])", "<https://e.com/[^a]>"]) {
      const text = `Read ${reference}.\n\n[^a]: The tenant shall pay.`;
      expect(rulesFor(text), text).not.toContain("legalese");
    }
    // A raw HTML block is never read as Markdown, so it refers to nothing, while
    // inline HTML inside a paragraph leaves the Markdown between its tags live.
    expect(rulesFor("<div>Read [^a].</div>\n\n[^a]: The tenant shall pay.")).not.toContain("legalese");
    expect(rulesFor("Read <div>[^a]</div>.\n\n[^a]: The tenant shall pay.")).toContain("legalese");
    // A reference inside a comment, a processing instruction or a declaration refers
    // to nothing; one after an unclosed comment is text, and live.
    for (const hidden of ["<!-- [^a] -->", "<!-->[^a]", "<? [^a] ?>", "<!X [^a]>", "<![CDATA[ [^a] ]]>"]) {
      const text = `&#32;${hidden}\n\n[^a]: The tenant shall pay.`;
      if (hidden === "<!-->[^a]") expect(rulesFor(text), text).toContain("legalese");
      else expect(rulesFor(text), text).not.toContain("legalese");
    }
    expect(hasVisibleText("&#32;<!-- [^a] -->\n\n[^a]: This change works.")).toBe(false);
    expect(rulesFor("Read <!-- [^a]\n\n[^a]: The tenant shall pay.")).toContain("legalese");
    // Labels compare case-folded, so "SS" names "ß", while a dotless "ı" stays apart from "i".
    expect(rulesFor("This change works.[^SS]\n\n[^ß]: We shall pay.")).toContain("legalese");
    expect(rulesFor("Read the note[^i].\n\n[^ı]: This change works.\n\n[^i]: The tenant shall pay.")).toContain("legalese");
    // Text that only looks like a link leaves its reference live, and a real link's
    // destination, however it nests, holds none.
    expect(rulesFor("Read [the guide](bad [^a]).\n\n[^a]: The tenant shall pay.")).toContain("legalese");
    expect(hasVisibleText("[&#8203;](https://example.com/a(b)[^x])\n\n[^x]: This change works.")).toBe(false);
    // An author cannot forge a resolved reference: a plain link to "#fn0", or the same
    // text in another attribute, refers to nothing.
    expect(hasVisibleText('<span href="#fn0" title="[^a]"></span>\n\n[^a]: This change works.')).toBe(false);
    expect(rulesFor("Read [the note](#fn0) [^b].\n\n[^a]: We shall pay.\n\n[^b]: Plain.")).not.toContain("legalese");
    // "[text][^a]" shows "[text]" and the number, so its text is read.
    expect(rulesFor("[We shall pay.][^a]\n\n[^a]: This change works.")).toContain("legalese");
    expect(readerProseBlocks("[Plain words.][^a]\n\n[^a]: Plain.")[0]?.lines[0]).toBe("[Plain words.]");
    // A reference shows its number, never its label, and "![^a]" is "!" and a reference.
    expect(rulesFor("This works.[^shall]\n\n[^shall]: This passes.")).not.toContain("legalese");
    expect(readerProseBlocks("This works.[^shall]\n\n[^shall]: This passes.")[0]?.lines[0]).toBe("This works.");
    expect(rulesFor("![^a]\n\n[^a]: We shall pay.")).toContain("legalese");
    expect(readerProseBlocks("![^a]\n\n[^a]: Plain.")[0]?.lines[0]).toBe("!");
    // A document with no footnote definition has nothing to resolve.
    expect(rulesFor("Read [^a] here.")).toEqual([]);
    // The first definition of a label is the footnote; a later one shows nothing.
    const twice = "This change works.[^a]\n\n[^a]: It works.\n\n[^a]: We shall pay.";
    expect(rulesFor(twice)).not.toContain("legalese");
    expect(rulesFor("A.[^a]\n\n[^a]: We shall pay.\n\n[^a]: It works.")).toContain("legalese");
    // Everything inside an unused footnote goes, a heading included.
    expect(hasVisibleText("[^a]: Plain words.\n\n    # Plain heading")).toBe(false);
    expect(rulesFor("Plain words.\n\n[^a]: Plain words.\n\n    # The tenant shall pay")).not.toContain("legalese");
    // A reference in a table cell refers to it too.
    expect(rulesFor("| A | B |\n| - | - |\n| x[^a] | y |\n\n[^a]: The tenant shall pay.")).toContain("legalese");
    expect(rulesFor("[^1]: The party shall act.")).not.toContain("legalese");
    expect(hasVisibleText("[^1]: Plain words.")).toBe(false);
    const used = "Text[^Note].\n\n[^note]: The party shall act.";
    expect(auditText(used).filter((violation) => violation.rule === "legalese").map((violation) => violation.line))
      .toEqual([3]);
    // The reference shows as a number on the page, so its label is not read.
    expect(readerProseBlocks(used).map((block) => block.lines.join(" "))).toEqual(["Text.", "The party shall act."]);
    // An indented line continues the footnote.
    expect(readerProseBlocks("A[^n].\n\n[^n]: First line\n    continued.")[1]?.lines).toEqual(["First line", "continued."]);
    // A footnote inside code is not a footnote, and a reference there refers to nothing.
    expect(rulesFor("```\nA[^1].\n```\n\n[^1]: The party shall act.")).not.toContain("legalese");
  });

  test("a link reference definition over several lines resolves as it does on the page", () => {
    expect(rulesFor("We sh[all][d] pay.\n\n[d]:\n  /guide")).toContain("legalese");
    expect(rulesFor("Read [plain][shall].\n\n[shall]:\n  /guide")).not.toContain("legalese");
    // The definition itself shows nothing, so it is not read as prose.
    expect(readerProseBlocks("Read [x][d].\n\n[d]:\n  /guide")).toHaveLength(1);
    // A bracket that opens no definition is prose, as before.
    expect(readerProseBlocks("[Note] The tenant shall pay.")[0]?.lines[0]).toBe("[Note] The tenant shall pay.");
  });

  test("a sentence after a reference label or code span that runs over a line keeps its line", () => {
    const long = `${Array.from({ length: 31 }, (_, index) => `w${index}`).join(" ")}.`;
    const tick = String.fromCharCode(96);
    for (const text of [
      `Read [the guide][a\nb]. Short.\n${long}\n\n[a b]: /uri`,
      `Run ${tick}a\nb${tick} now.\n${long}`,
    ]) {
      const found = auditText(text).filter((violation) => violation.rule === "sentence-length");
      expect(found.map((violation) => violation.line), text).toEqual([3]);
    }
  });
});
