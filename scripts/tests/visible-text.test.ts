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
    ]) {
      expect(hasVisibleText(text), JSON.stringify(text)).toBe(false);
    }
  });
});
