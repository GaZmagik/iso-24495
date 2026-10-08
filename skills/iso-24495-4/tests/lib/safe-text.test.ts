import { describe, expect, test } from "bun:test";
import { safeCell, safePath, safePathCell, safeText, skippedEntryWarning } from "../../scripts/lib/safe-text.ts";

const LINE_FEED = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const ESCAPE = String.fromCharCode(27);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
// A backslash is built here and never written in an expectation, so no tool that
// rewrites an escape in this file can change what a test expects.
const BACKSLASH = String.fromCharCode(92);
/** The six characters a character in the basic plane prints as: a backslash, "u" and four digits. */
const code = (point: number): string => `${BACKSLASH}u${point.toString(16).padStart(4, "0")}`;

describe("text nobody has read", () => {
  // Linux and macOS allow all three in a file name. A line break forges a
  // second line of output, and an escape character starts a terminal sequence.
  test("a skipped path holding a line break or an escape prints as one clean line", () => {
    const forged = `docs/a${LINE_FEED}warning: forged${CARRIAGE_RETURN}${ESCAPE}[2Jb.md`;
    const warning = skippedEntryWarning(forged);
    expect(warning)
      .toBe(`warning: skipped unreadable entry: docs/a${code(10)}warning: forged${code(13)}${code(27)}[2Jb.md`);
    expect(warning.split(/\r\n|\r|\n/)).toHaveLength(1);
    for (const character of [LINE_FEED, CARRIAGE_RETURN, ESCAPE]) {
      expect(warning).not.toContain(character);
    }
  });

  test("an ordinary path is shown as it is, and a Windows path with forward slashes", () => {
    expect(skippedEntryWarning("docs/guide.md")).toBe("warning: skipped unreadable entry: docs/guide.md");
    expect(skippedEntryWarning(["C:", "docs", "my guide.md"].join(BACKSLASH), true))
      .toBe("warning: skipped unreadable entry: C:/docs/my guide.md");
  });

  test("control characters and direction marks become one space, and a pipe stays", () => {
    expect(safeText(`ab${ESCAPE}${RIGHT_TO_LEFT_OVERRIDE}cd${LINE_FEED}`)).toBe("ab cd");
    expect(safeText("  a  \t b | c  ")).toBe("a b | c");
    expect(safeText(`${LINE_FEED}${ESCAPE}`)).toBe("");
    expect(safeText("")).toBe("");
  });
});

describe("a table cell nobody has read", () => {
  test("a cell is cleaned as safeText cleans it, and its pipes are escaped", () => {
    const control = String.fromCharCode(0x9b);
    expect(safeCell(`a${ESCAPE}[2J | b${control}${RIGHT_TO_LEFT_OVERRIDE}c${LINE_FEED}d`)).toBe("a [2J \\| b c d");
    expect(safeCell("docs/guide.md")).toBe("docs/guide.md");
    expect(safeCell(`${LINE_FEED}`)).toBe("");
    expect(safeCell("")).toBe("");
  });
});

describe("every range of characters safeText removes", () => {
  // The pattern holds five ranges. Each has its own row, with its first and
  // last character, so a range that is dropped or shortened fails a test.
  test.each([
    ["C0 controls", 0x00, 0x1f],
    ["DEL and the C1 controls", 0x7f, 0x9f],
    ["the left-to-right and right-to-left marks", 0x200e, 0x200f],
    ["the directional embeddings and overrides", 0x202a, 0x202e],
    ["the directional isolates", 0x2066, 0x2069],
  ])("%s become a space", (_name, first, last) => {
    for (let code = first; code <= last; code++) {
      const character = String.fromCharCode(code);
      expect(safeText(`a${character}b`), `U+${code.toString(16)}`).toBe("a b");
      expect(safeCell(`a${character}b`), `U+${code.toString(16)}`).toBe("a b");
    }
  });

  // The neighbours of each range are ordinary characters and are kept. The
  // tilde, the inverted exclamation mark, the zero-width joiner and the hyphen
  // sit just outside a range, as do U+2065 and U+206A.
  test("the character either side of a range is kept", () => {
    for (const code of [0x7e, 0xa1, 0x200d, 0x2010, 0x2065, 0x206a]) {
      const character = String.fromCharCode(code);
      expect(safeText(`a${character}b`), `U+${code.toString(16)}`).toBe(`a${character}b`);
    }
  });
});

describe("a path nobody has read", () => {
  // safeText made a control character a space and each run of spaces one space, so
  // these three names all printed as "a b.md" and a finding could not be traced.
  test("three names that printed alike now print as three", () => {
    const names = ["a b.md", "a  b.md", `a${RIGHT_TO_LEFT_OVERRIDE}b.md`];
    expect(names.map(safeText)).toEqual(["a b.md", "a b.md", "a b.md"]);
    const printed = names.map((name) => safePath(name, false));
    expect(printed).toEqual(["a b.md", "a  b.md", `a${code(0x202e)}b.md`]);
    expect(new Set(printed).size).toBe(3);
    expect(code(0x202e)).toHaveLength(6);
    expect(printed[2]).not.toContain(RIGHT_TO_LEFT_OVERRIDE);
    // The same three on Windows, where the answer is the same.
    expect(names.map((name) => safePath(name, true))).toEqual(printed);
  });

  test("a Windows path prints with forward slashes", () => {
    const path = ["C:", "docs", "my  guide.md"].join(BACKSLASH);
    expect(safePath(path, true)).toBe("C:/docs/my  guide.md");
    expect(safePath("C:/docs/my  guide.md", true)).toBe("C:/docs/my  guide.md");
    expect(safePath(`docs${BACKSLASH}a${RIGHT_TO_LEFT_OVERRIDE}b.md`, true)).toBe(`docs/a${code(0x202e)}b.md`);
  });

  test("a POSIX path keeps its slashes, and a backslash in a name is doubled", () => {
    expect(safePath("/home/reader/my  guide.md", false)).toBe("/home/reader/my  guide.md");
    expect(safePath(`docs/a${BACKSLASH}b.md`, false)).toBe(`docs/a${BACKSLASH}${BACKSLASH}b.md`);
    // A name that spells out a code is not the name that holds the character.
    const spelt = safePath(`a${BACKSLASH}u202eb.md`, false);
    expect(spelt).toBe(`a${BACKSLASH}${BACKSLASH}u202eb.md`);
    expect(spelt).not.toBe(safePath(`a${RIGHT_TO_LEFT_OVERRIDE}b.md`, false));
    // A backslash that is doubled is doubled once, and not again for the code after it.
    expect(safePath(`${BACKSLASH}${LINE_FEED}`, false)).toBe(`${BACKSLASH}${BACKSLASH}${code(10)}`);
  });

  test("spaces are kept as they are, and nothing is trimmed", () => {
    expect(safePath("  a   b.md  ", false)).toBe("  a   b.md  ");
    expect(safePath("", false)).toBe("");
    expect(safePath(" ", true)).toBe(" ");
  });

  test("a path prints on one line, with each character that would break it shown as its code", () => {
    const forged = `docs/a${LINE_FEED}warning: forged${CARRIAGE_RETURN}${ESCAPE}[2Jb.md`;
    const printed = safePath(forged, false);
    expect(printed).toBe(`docs/a${code(10)}warning: forged${code(13)}${code(27)}[2Jb.md`);
    expect(printed.split(/\r\n|\r|\n/)).toHaveLength(1);
    for (const character of [LINE_FEED, CARRIAGE_RETURN, ESCAPE]) {
      expect(printed).not.toContain(character);
    }
  });

  test.each([
    ["C0 controls", 0x00, 0x1f],
    ["DEL and the C1 controls", 0x7f, 0x9f],
    ["the zero-width characters and the direction marks", 0x200b, 0x200f],
    ["the line and paragraph separators, the embeddings and the overrides", 0x2028, 0x202e],
    ["the word joiner, the invisible operators and the isolates", 0x2060, 0x2064],
    ["the directional isolates", 0x2066, 0x2069],
    ["the spaces of fixed width", 0x2000, 0x200a],
  ])("%s print as their codes", (_name, first, last) => {
    for (let point = first; point <= last; point++) {
      const character = String.fromCharCode(point);
      expect(safePath(`a${character}b`, false), `U+${point.toString(16)}`).toBe(`a${code(point)}b`);
      expect(safePath(`a${character}b`, true), `U+${point.toString(16)}`).toBe(`a${code(point)}b`);
    }
  });

  test("white space that is not the plain space prints as its code, and so does what prints as nothing", () => {
    // The no-break space, the soft hyphen, the Arabic letter mark, the Ogham space,
    // the narrow no-break space, the mathematical space, the ideographic space and the
    // byte order mark.
    for (const point of [0xa0, 0xad, 0x61c, 0x1680, 0x202f, 0x205f, 0x3000, 0xfeff]) {
      expect(safePath(`a${String.fromCharCode(point)}b`, false), `U+${point.toString(16)}`).toBe(`a${code(point)}b`);
    }
    // Half of a surrogate pair standing alone.
    expect(safePath(`a${String.fromCharCode(0xd83d)}b`, false)).toBe(`a${code(0xd83d)}b`);
    // A character beyond the basic plane takes its digits in braces: here a tag character.
    expect(safePath(`a${String.fromCodePoint(0xe0001)}b`, false)).toBe(`a${BACKSLASH}u{e0001}b`);
  });

  test("letters, marks of punctuation and symbols are kept, in any script", () => {
    const pageFacingUp = String.fromCodePoint(0x1f4c4);
    const eAcute = String.fromCharCode(0xe9);
    for (const name of ["docs/guide.md", `r${eAcute}sum${eAcute}.md`, `${pageFacingUp}.md`, "a~!@#$%^&()_+-={}[];',.md", "a|b.md"]) {
      expect(safePath(name, false), name).toBe(name);
      expect(safePath(name, true), name).toBe(name);
    }
    // The neighbours of the ranges above are ordinary characters.
    for (const point of [0x7e, 0xa1, 0x2010, 0x2027, 0x2030]) {
      const character = String.fromCharCode(point);
      expect(safePath(`a${character}b`, false), `U+${point.toString(16)}`).toBe(`a${character}b`);
    }
  });

  test("the default follows the platform the command runs on", () => {
    const path = `docs${BACKSLASH}guide.md`;
    expect(safePath(path)).toBe(safePath(path, process.platform === "win32"));
  });

  test("a path in a table cell has its pipes escaped as well, and keeps its spaces", () => {
    expect(safePathCell("a|b  c.md", false)).toBe(`a${BACKSLASH}|b  c.md`);
    expect(safePathCell(`a${RIGHT_TO_LEFT_OVERRIDE}|b.md`, false)).toBe(`a${code(0x202e)}${BACKSLASH}|b.md`);
    expect(safePathCell(["docs", "a|b.md"].join(BACKSLASH), true)).toBe(`docs/a${BACKSLASH}|b.md`);
    expect(safePathCell("docs/guide.md")).toBe("docs/guide.md");
    expect(safePathCell("", false)).toBe("");
  });

  test("the warning for a skipped entry prints its path this way", () => {
    expect(skippedEntryWarning(`docs/a  ${RIGHT_TO_LEFT_OVERRIDE}b.md`, false))
      .toBe(`warning: skipped unreadable entry: docs/a  ${code(0x202e)}b.md`);
  });
});
