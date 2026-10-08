import { describe, expect, test } from "bun:test";
import { safeText, skippedEntryWarning } from "../../scripts/lib/safe-text.ts";

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
