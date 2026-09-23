import { describe, expect, test } from "bun:test";
import {
  decodeHtmlText,
  htmlReferenceAt,
  LEGACY_NAMES,
  markdownReferenceAt,
} from "../scripts/lib/character-references.ts";

const REPLACEMENT = "�";

describe("character references", () => {
  test("Markdown text decodes a reference only as CommonMark bounds it", () => {
    for (const [text, decoded, length] of [
      ["&#97;", "a", 5],
      ["&#x61;", "a", 6],
      ["&amp;", "&", 5],
      ["&NewLine;", "\n", 9],
    ] as const) {
      expect(markdownReferenceAt(text, 0), text).toEqual({ decoded, length });
    }
    // A missing semicolon, an eighth digit, an unknown name and a bare ampersand
    // are text on the page, so the reader hands them back as text.
    for (const text of ["&#97", "&#00000032;", "&foo;", "&", "&;", "&amp", "&#x;", "& amp;"]) {
      expect(markdownReferenceAt(text, 0), text).toBeNull();
    }
    expect(markdownReferenceAt("x&#97;", 1)).toEqual({ decoded: "a", length: 5 });
  });

  test("raw HTML decodes a numeric reference as the tokeniser does", () => {
    for (const [text, decoded, length] of [
      ["&#97ll", "a", 4],
      ["&#97;", "a", 5],
      ["&#x61", "a", 5],
      ["&#X61;", "a", 6],
      // Any number of leading zeros, and no cap on the digits.
      ["&#00000032;", " ", 11],
      ["&#x000000000061;", "a", 16],
      // A null, a surrogate, and a value past the last code point become U+FFFD.
      ["&#0;", REPLACEMENT, 4],
      ["&#xD800;", REPLACEMENT, 8],
      ["&#xDFFF;", REPLACEMENT, 8],
      ["&#x110000;", REPLACEMENT, 10],
      ["&#99999999999999999999999;", REPLACEMENT, 26],
      // 0x80 to 0x9F are read as Windows-1252 bytes, and the five that table leaves
      // undefined stay as the control characters they name.
      ["&#x80;", "€", 6],
      ["&#128", "€", 5],
      ["&#x9F;", "Ÿ", 6],
      ["&#x81;", "\u0081", 6],
      ["&#x9D;", "\u009D", 6],
      // The neighbours of that range are ordinary code points.
      ["&#x7F;", "\u007F", 6],
      ["&#xA0;", " ", 6],
      ["&#x10FFFF;", "\u{10FFFF}", 10],
    ] as const) {
      expect(htmlReferenceAt(text, 0), text).toEqual({ decoded, length });
    }
    // No digits means no reference: the ampersand and what follows are text.
    for (const text of ["&#", "&#;", "&#x", "&#x;", "&#X;", "&# 97;", "&#-1;"]) {
      expect(htmlReferenceAt(text, 0), text).toBeNull();
    }
  });

  test("raw HTML decodes a named reference by longest match", () => {
    for (const [text, decoded, length] of [
      ["&amp;", "&", 5],
      ["&amp", "&", 4],
      ["&ampfoo", "&", 4],
      ["&AMP;", "&", 5],
      ["&nbsp", " ", 5],
      ["&nbspx", " ", 5],
      ["&copy", "©", 5],
      ["&not", "¬", 4],
      // "notit;" names nothing, so the longest name that does, "not", is taken and
      // "it;" stays as text. "notin;" is a name of its own.
      ["&notit;", "¬", 4],
      ["&notin;", "∉", 7],
      ["&notin", "¬", 4],
      ["&CounterClockwiseContourIntegral;", "∳", 33],
    ] as const) {
      expect(htmlReferenceAt(text, 0), text).toEqual({ decoded, length });
    }
    // A name the table lacks, a legacy name in the wrong case, a name needing its
    // semicolon and not given one, and a bare ampersand are all text.
    for (const text of ["&foo;", "&Amp;", "&zwj", "&ZeroWidthSpace", "&", "&;", "& amp;", "&1;"]) {
      expect(htmlReferenceAt(text, 0), text).toBeNull();
    }
  });

  // The names come from the HTML Standard's table at
  // https://html.spec.whatwg.org/entities.json, which lists 2,231 references, of
  // which these 106 appear without a trailing semicolon. Their characters come
  // from the renderer's table, so a name here that the renderer lacked would be
  // a defect in this list, and this test would report it.
  test("every legacy name decodes with or without its semicolon", () => {
    expect(LEGACY_NAMES.size).toBe(106);
    for (const name of LEGACY_NAMES) {
      const withSemicolon = htmlReferenceAt(`&${name};`, 0);
      expect(withSemicolon, name).not.toBeNull();
      expect(withSemicolon?.length, name).toBe(name.length + 2);
      expect(withSemicolon?.decoded, name).toBe(markdownReferenceAt(`&${name};`, 0)?.decoded);
      expect(htmlReferenceAt(`&${name} tail`, 0), name)
        .toEqual({ decoded: withSemicolon?.decoded, length: name.length + 1 });
    }
  });

  test("a whole text decodes every reference and keeps the rest", () => {
    for (const [text, decoded] of [
      ["We sh&#97ll pay.", "We shall pay."],
      ["a &amp; b &amp c &ampd", "a & b & c &d"],
      ["&notit; and &notin;", "¬it; and ∉"],
      ["&#00000032;", " "],
      ["no reference here", "no reference here"],
      ["trailing &", "trailing &"],
      ["&foo; stays, &#x; stays, &#97 goes", "&foo; stays, &#x; stays, a goes"],
      ["", ""],
    ]) {
      expect(decodeHtmlText(text), text).toBe(decoded);
    }
  });
});
