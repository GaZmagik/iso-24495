import { describe, expect, test } from "bun:test";
import { readDocument } from "../../scripts/lib/parse.ts";

/** The titles a document's reference definitions carry, as label and title pairs. */
function titlesOf(text: string): Array<[string, string]> {
  return [...readDocument(text).titles];
}

describe("readDocument titles", () => {
  test("holds each definition's title as written, in all three quoting styles", () => {
    expect(titlesOf('[a]: /u "double"\n')).toEqual([["a", "double"]]);
    expect(titlesOf("[a]: /u 'single'\n")).toEqual([["a", "single"]]);
    expect(titlesOf("[a]: /u (parenthesis)\n")).toEqual([["a", "parenthesis"]]);
    expect(titlesOf('[a]: <x y> "angle"\n')).toEqual([["a", "angle"]]);
    expect(titlesOf('[a]: /u "with space"   \n')).toEqual([["a", "with space"]]);
  });

  test("keeps the title's text unchanged, without reading entities or escapes", () => {
    expect(titlesOf('[a]: /u "&#100;ecorative"\n')).toEqual([["a", "&#100;ecorative"]]);
    expect(titlesOf('[a]: /u " padded "\n')).toEqual([["a", " padded "]]);
    expect(titlesOf('[a]: /u ""\n')).toEqual([["a", ""]]);
  });

  test("has no entry for a definition without a title", () => {
    expect(titlesOf("[a]: /u\n")).toEqual([]);
    expect(readDocument("[a]: /u\n").references.has("a")).toBe(true);
  });

  test("is keyed by the label in the form references are", () => {
    expect(titlesOf('[The  Label]: /u "t"\n')).toEqual([["the label", "t"]]);
    expect(titlesOf('[a\\]:b]: /u "t"\n')).toEqual([["a]:b", "t"]]);
  });

  test("takes the title from the first definition of a label only", () => {
    expect(titlesOf('[a]: /first "one"\n[a]: /second "two"\n')).toEqual([["a", "one"]]);
    expect(titlesOf('[a]: /first\n[a]: /second "two"\n')).toEqual([]);
  });

  test("reads no title where it reads no definition", () => {
    // A tab anywhere on the line keeps the definition visible text.
    expect(titlesOf('[a]:\t/u "t"\n')).toEqual([]);
    // Text after the title means the line is not a definition.
    expect(titlesOf('[a]: /u "t" x\n')).toEqual([]);
    // A definition cannot interrupt a paragraph.
    expect(titlesOf('Text.\n[a]: /u "t"\n')).toEqual([]);
    // A title on the next line is not read, though CommonMark accepts it.
    expect(titlesOf('[a]: /u\n"t"\n')).toEqual([]);
    expect(titlesOf('[a]: /u "t\nu"\n')).toEqual([]);
  });

  test("reads Unicode whitespace after the destination as part of it, as CommonMark does", () => {
    const codes = [
      0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009,
      0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff, 0x0085, 0x180e, 0x200b, 0x200c, 0x200d,
      0x2060,
    ];
    for (const code of codes) {
      const space = String.fromCharCode(code);
      for (const title of ['"t"', "'t'", "(t)"]) {
        const text = `[a]: /u${space}${title}\n`;
        expect(titlesOf(text), code.toString(16)).toEqual([]);
        expect(readDocument(text).references.has("a"), code.toString(16)).toBe(true);
      }
    }
  });

  test("reads a definition inside a quotation or list item the way references are read", () => {
    expect(titlesOf('> [a]: /u "t"\n')).toEqual([["a", "t"]]);
    expect(titlesOf('- [a]: /u "t"\n')).toEqual([["a", "t"]]);
  });
});
