import { describe, expect, test } from "bun:test";
import { auditText } from "../scripts/audit-corpus.ts";
import {
  isFilteredTag,
  renderedText,
  textOfHtml,
  withTagFilter,
} from "../scripts/lib/rendered-text.ts";
import { hasVisibleText } from "../../../scripts/visible-text.ts";

const AUDIT = { altText: true, codeDelimiters: true };

function rulesFor(text: string): string[] {
  return auditText(text).map((violation) => violation.rule);
}

describe("rendered text", () => {
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

  test("video, audio and rp content is hidden, and rp ends where its end tag may be left out", () => {
    expect(renderedText("<video>Plain words.</video>")).toBe("");
    expect(hasVisibleText("<video>Plain words.</video>")).toBe(false);
    expect(hasVisibleText("<audio><p>Plain words.</p></audio>")).toBe(false);
    expect(renderedText("<ruby><rp>(<rt>This change works.</rt></ruby>")).toBe("This change works.");
    expect(hasVisibleText("<ruby><rp>(<rt>This change works.</rt></ruby>")).toBe(true);
    expect(renderedText("<ruby>a<rp>(</rp><rt>b</rt><rp>)</rp></ruby> c")).toBe("ab c");
    expect(renderedText("<ruby>a<rp>(</ruby> c")).toBe("a c");
    expect(renderedText("<ruby>a<rp>(<rp>)</ruby> c")).toBe("a c");
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
