import { describe, expect, test } from "bun:test";
import { hasVisibleText } from "../visible-text.ts";

describe("hasVisibleText", () => {
  test("prose is visible, and markup around it does not hide it", () => {
    for (const text of [
      "This description reads plainly.\n",
      "Hello **there**",
      "<!-- Context for authors. -->\nThis description reads plainly.\n",
      "[g]: /uri\n\nSee [the guide][g].\n",
      "\uFEFFThis description reads plainly.\n",
      // A label with no destination is not a definition, so it renders.
      "[label]:\n",
      // A comment opener inside prose is not a comment, so a reader sees it.
      "Hello <!-- not a comment",
      // CommonMark renders a NUL byte as the replacement character, which shows.
      "\u0000",
    ]) {
      expect(hasVisibleText(text), JSON.stringify(text)).toBe(true);
    }
  });

  test("whitespace of every kind is not visible", () => {
    for (const text of ["", " \t\r\n  \n", "\u00A0", "\u2003\u2009\n\u3000", "&nbsp;"]) {
      expect(hasVisibleText(text), JSON.stringify(text)).toBe(false);
    }
  });

  test("zero-width and control characters are not visible", () => {
    for (const text of ["\u200B", "\u200C\u200D", "\u2060", "\uFEFF", "\u0001", "&#8203;"]) {
      expect(hasVisibleText(text), JSON.stringify(text)).toBe(false);
    }
  });

  test("one letter, number, punctuation mark or symbol is visible", () => {
    for (const text of ["a", "7", ".", "\u20AC"]) {
      expect(hasVisibleText(text), JSON.stringify(text)).toBe(true);
    }
  });

  // Unicode classes each of these outside the letter, number, punctuation and
  // symbol categories, so none produces a mark of its own. The combining
  // grapheme joiner is a nonspacing mark rather than a format character, which
  // is why a test that excluded format characters passed it.
  test("a mark with no base, a private use or an unassigned character is not visible", () => {
    for (const text of ["\u034F", "\u0301", "\uE000", "\u0378"]) {
      expect(hasVisibleText(text), JSON.stringify(text)).toBe(false);
    }
    // The base letter is what a reader sees, so the same mark on one counts.
    expect(hasVisibleText("e\u0301")).toBe(true);
  });

  test("HTML character references in raw blocks count as their rendered characters", () => {
    for (const text of [
      "<div>&nbsp;</div>",
      "<div>&nbsp</div>",
      "<div>&#160;</div>",
      "<div>&#xA0;</div>",
      "<div>&#160</div>",
      "<div>&#xA0</div>",
      "<div>&#8203;</div>",
      "<div>&#8203</div>",
      "<div>&#32</div>",
      "<div>&ZeroWidthSpace;</div>",
    ]) {
      expect(hasVisibleText(text), JSON.stringify(text)).toBe(false);
    }
    for (const text of ["<div>&amp;nbsp;</div>", "<div>&lt;div&gt;</div>", "<div>&ZeroWidthSpace</div>"]) {
      expect(hasVisibleText(text), JSON.stringify(text)).toBe(true);
    }
    for (const text of ["<div>&#133;</div>", "<div>&#x85;</div>"]) {
      expect(hasVisibleText(text), JSON.stringify(text)).toBe(true);
    }
    expect(hasVisibleText("<div>&#129;</div>")).toBe(false);
  });

  // Each of these renders as nothing. The last is a definition spread over two
  // lines, which the pattern this replaced did not recognise.
  test("markup that renders nothing is not visible", () => {
    for (const text of [
      "<!-- Describe your change here. -->\n",
      "<!-- a > b -->\n",
      "<!-- Describe your change here.\n",
      "[invisible]: https://example.invalid\n",
      "  [refunds]: /refunds\n",
      "[diagram]: diagram.png",
      "---",
      "<div></div>",
      "![](x.png)",
      // An image is not text, so its alternative text does not count.
      "![A diagram of the audit](x.png)",
      "[x]:\n  https://example.invalid\n",
      // A pattern that stripped tags ended this one at the quoted ">".
      '<div title=">"></div>',
    ]) {
      expect(hasVisibleText(text), JSON.stringify(text)).toBe(false);
    }
  });

  // A raw HTML block can hold text outside any element, and a reader sees it.
  test("text beside an element in a raw HTML block is visible", () => {
    expect(hasVisibleText("<div></div>Visible")).toBe(true);
    expect(hasVisibleText('<div title=">"></div>Visible')).toBe(true);
  });
});
