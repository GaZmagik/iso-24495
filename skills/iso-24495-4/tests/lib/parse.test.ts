import { describe, expect, test } from "bun:test";
import { readDocument, readerInline } from "../../scripts/lib/parse.ts";
import { itemAt } from "../../scripts/lib/item-at.ts";

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

  test("reads no definition where a control character follows the destination", () => {
    for (const code of [0x0b, 0x0c]) {
      for (const title of ['"t"', "'t'", "(t)"]) {
        const text = `[a]: /u${String.fromCharCode(code)}${title}\n`;
        expect(titlesOf(text), code.toString(16)).toEqual([]);
        expect(readDocument(text).references.has("a"), code.toString(16)).toBe(false);
      }
    }
  });

  test("reads no title from inside a destination in angle brackets", () => {
    for (const title of ['"t"', "'t'", "(t)"]) {
      const text = `[a]: <x.png ${title}>\n`;
      expect(titlesOf(text), title).toEqual([]);
      expect(readDocument(text).references.has("a"), title).toBe(true);
    }
    // An escaped ">" does not end the destination; the title follows the real one.
    expect(titlesOf('[a]: <x\\> "t"> "u"\n')).toEqual([["a", "u"]]);
  });

  test("reads no title for a label once it could not read a line that may define it", () => {
    // CommonMark takes a label's first definition, and these first lines are
    // definitions to at least one renderer. The later title may not be the one
    // that counts, so it is not read.
    expect(titlesOf('[a]:\t/first\n\n[a]: /second "t"\n')).toEqual([]);
    expect(titlesOf('[a]:\n/first\n\n[a]: /second "t"\n')).toEqual([]);
    expect(titlesOf('[a]: /first "t\nu"\n\n[a]: /second "t"\n')).toEqual([]);
    // The label itself is still read where a later line defines it, as before.
    expect(readDocument('[a]:\n/first\n\n[a]: /second "t"\n').references.has("a")).toBe(true);
    // Another label's line changes nothing.
    expect(titlesOf('[b]:\t/first\n\n[a]: /second "t"\n')).toEqual([["a", "t"]]);
    // A line after the first definition changes nothing either.
    expect(titlesOf('[a]: /first "t"\n\n[a]:\t/second\n')).toEqual([["a", "t"]]);
  });
});

describe("readDocument sourceLines", () => {
  const slash = "\\";

  test("holds each line as the reader took it from its block, before rewriting it", () => {
    const text = `A ${slash}* b \`c\` <b>d</b>\n# H ${slash}*\n> - e ${slash}_\n`;
    const document = readDocument(text);
    expect(document.sourceLines).toEqual([`A ${slash}* b \`c\` <b>d</b>`, `# H ${slash}*`, `e ${slash}_`, ""]);
    expect(document.lines).toEqual(["A    b  c   d ", "# H   ", "e   ", ""]);
  });

  test("is blank where lines is blank, for code and front matter", () => {
    const document = readDocument("```\ncode\n```\n");
    expect(document.sourceLines).toEqual(["", "", "", ""]);
  });

  test("gives lines back through readerInline, line by line, for one-line blocks", () => {
    const text = `A ${slash}* b \`c\` <b>d</b> <!--e--> ![](x.png "t")\n\n# H ${slash}*\n\n| a ${slash}| | b |\n| - | - |\n`;
    const document = readDocument(text);
    for (const [index, line] of document.sourceLines.entries()) {
      expect(readerInline(line), line).toBe(itemAt(document.lines, index));
    }
  });
});
