import { describe, expect, test } from "bun:test";
import { safeCell, safeText, skippedEntryWarning } from "../../scripts/lib/safe-text.ts";

const LINE_FEED = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const ESCAPE = String.fromCharCode(27);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);

describe("text nobody has read", () => {
  // Linux and macOS allow all three in a file name. A line break forges a
  // second line of output, and an escape character starts a terminal sequence.
  test("a skipped path holding a line break or an escape prints as one clean line", () => {
    const forged = `docs/a${LINE_FEED}warning: forged${CARRIAGE_RETURN}${ESCAPE}[2Jb.md`;
    const warning = skippedEntryWarning(forged);
    expect(warning).toBe("warning: skipped unreadable entry: docs/a warning: forged [2Jb.md");
    expect(warning.split(/\r\n|\r|\n/)).toHaveLength(1);
    for (const character of [LINE_FEED, CARRIAGE_RETURN, ESCAPE]) {
      expect(warning).not.toContain(character);
    }
  });

  test("an ordinary path is shown as it is", () => {
    expect(skippedEntryWarning("docs/guide.md")).toBe("warning: skipped unreadable entry: docs/guide.md");
    expect(skippedEntryWarning("C:\\docs\\my guide.md"))
      .toBe("warning: skipped unreadable entry: C:\\docs\\my guide.md");
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
