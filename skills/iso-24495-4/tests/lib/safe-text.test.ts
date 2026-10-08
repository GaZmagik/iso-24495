import { describe, expect, test } from "bun:test";
import { safeCell, safePath, safePathCell, safePathCode, safeText, skippedEntryWarning } from "../../scripts/lib/safe-text.ts";

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

  test("the warning for a skipped entry prints its path this way", () => {
    expect(skippedEntryWarning(`docs/a  ${RIGHT_TO_LEFT_OVERRIDE}b.md`, false))
      .toBe(`warning: skipped unreadable entry: docs/a  ${code(0x202e)}b.md`);
  });
});

describe("a path in Markdown that is rendered", () => {
  const TICK = String.fromCharCode(96);

  /** What Bun's renderer shows in each cell of the first column, for one row to a name. */
  function renderedCells(names: readonly string[]): string[] {
    const table = ["| File | Line |", "|------|------|", ...names.map((name) => `| ${safePathCell(name, false)} | 1 |`)];
    const html = Bun.markdown.html(table.join(LINE_FEED));
    const rows = [...html.matchAll(/<tr>([^]*?)<[/]tr>/g)].map((row) => [...(row[1] as string).matchAll(/<td>([^]*?)<[/]td>/g)]);
    // The first row is the header, whose cells are not data cells.
    const data = rows.slice(1);
    expect(data, "one row for each name").toHaveLength(names.length);
    for (const cells of data) {
      expect(cells, "the row keeps its two columns").toHaveLength(2);
      expect((cells[1] as RegExpMatchArray)[1]).toBe("1");
    }
    return data.map((cells) => (cells[0] as RegExpMatchArray)[1] as string);
  }

  /** The text of a rendered cell that holds one code span and nothing else. */
  function shown(cell: string): string {
    const code = /^<code>([^]*)<[/]code>$/.exec(cell);
    expect(code, cell).not.toBeNull();
    const text = (code as RegExpExecArray)[1] as string;
    expect(text.includes("<"), cell).toBe(false);
    return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", String.fromCharCode(34)).replaceAll("&amp;", "&");
  }

  // A cell escaped the pipe and nothing else, so the rest of a name was read as
  // Markdown. Nine names gave seven results: an entity became the character it
  // names, a tag broke the line, asterisks became emphasis and brackets a link.
  test("names that Markdown would read are shown as they are written", () => {
    const names = [
      "a b.md", "a&#32;b.md", "a<br>b.md", "a*b*.md", "[x](u).md", "a&b.md", "a&amp;b.md", "a_b_.md", "a|b.md",
      `a${BACKSLASH}|b.md`, `${TICK}a.md`, `a.md${TICK}`, `a${TICK}${TICK}b${TICK}.md`, " a.md", "a.md ", " a.md ", "  a.md",
      "<!-- a -->.md", "a~~b~~.md", "# a.md", "", " ", "  ", `a${RIGHT_TO_LEFT_OVERRIDE}b.md`, `a${BACKSLASH}u202eb.md`,
      `${BACKSLASH}`, `a${BACKSLASH}`, `${TICK}`, `${TICK}${TICK}`, ` ${TICK} `,
    ];
    const cells = renderedCells(names);
    expect(new Set(cells).size).toBe(names.length);
    names.forEach((name, index) => {
      const printed = safePath(name, false);
      // A name of spaces alone keeps the space added on each side of it.
      expect(shown(cells[index] as string), JSON.stringify(name)).toBe(printed.trim() === "" ? ` ${printed} ` : printed);
    });
  });

  test("in generated names, distinct names give distinct cells and every row keeps its columns", () => {
    const pieces = ["a", "b", "x", ".md", " ", " ", TICK, TICK, "|", BACKSLASH, "*", "_", "[", "]", "(u)", "<", ">", "<br>", "&", "&amp;",
      "&#32;", "#", "~", "!", ";", "/", RIGHT_TO_LEFT_OVERRIDE, LINE_FEED, String.fromCharCode(9), String.fromCharCode(0xa0)];
    const random = sequence(24495);
    const names = new Set<string>();
    while (names.size < 5_000) {
      let name = "";
      const length = 1 + Math.floor(random() * 8);
      for (let made = 0; made < length; made++) name += pieces[Math.floor(random() * pieces.length)] as string;
      names.add(name);
    }
    const list = [...names];
    const cells = renderedCells(list);
    expect(new Set(cells).size).toBe(list.length);
    list.forEach((name, index) => {
      const printed = safePath(name, false);
      expect(shown(cells[index] as string), JSON.stringify(name)).toBe(printed.trim() === "" ? ` ${printed} ` : printed);
    });
    // The same names on Windows, where a backslash is a separator: two names may then
    // be one path, and the cells must be as many as the paths.
    const windows = new Set(list.map((name) => safePath(name, true)));
    const windowsTable = ["| File |", "|------|", ...list.map((name) => `| ${safePathCell(name, true)} |`)].join(LINE_FEED);
    const windowsCells = [...Bun.markdown.html(windowsTable).matchAll(/<td>([^]*?)<[/]td>/g)].map((cell) => cell[1]);
    expect(windowsCells).toHaveLength(list.length);
    expect(new Set(windowsCells).size).toBe(windows.size);
  });

  test("the code span is written with the shortest fence that holds the name", () => {
    expect(safePathCell("docs/guide.md", false)).toBe(`${TICK}docs/guide.md${TICK}`);
    expect(safePathCell(`a${TICK}b.md`, false)).toBe(`${TICK}${TICK}a${TICK}b.md${TICK}${TICK}`);
    expect(safePathCell(`a${TICK}${TICK}b${TICK}.md`, false)).toBe(`${TICK}${TICK}${TICK}a${TICK}${TICK}b${TICK}.md${TICK}${TICK}${TICK}`);
    // A space each side where the name opens or closes with a backtick or a space, or is empty.
    expect(safePathCell(`${TICK}a.md`, false)).toBe(`${TICK}${TICK} ${TICK}a.md ${TICK}${TICK}`);
    expect(safePathCell("a.md ", false)).toBe(`${TICK} a.md  ${TICK}`);
    expect(safePathCell("", false)).toBe(`${TICK}  ${TICK}`);
    // The pipe is escaped inside the span, because a table is cut into cells first.
    expect(safePathCell("a|b.md", false)).toBe(`${TICK}a${BACKSLASH}|b.md${TICK}`);
    expect(safePathCell(["docs", "a|b.md"].join(BACKSLASH), true)).toBe(`${TICK}docs/a${BACKSLASH}|b.md${TICK}`);
    expect(safePathCell(`a${RIGHT_TO_LEFT_OVERRIDE}b.md`, false)).toBe(`${TICK}a${code(0x202e)}b.md${TICK}`);
    expect(safePathCell("docs/guide.md")).toBe(`${TICK}docs/guide.md${TICK}`);
  });

  test("a path in a line of a report is a code span too, with its pipe left alone", () => {
    expect(safePathCode("a|b*c*.md", false)).toBe(`${TICK}a|b*c*.md${TICK}`);
    expect(safePathCode(`${TICK}a.md`, false)).toBe(`${TICK}${TICK} ${TICK}a.md ${TICK}${TICK}`);
    expect(safePathCode(["docs", "a.md"].join(BACKSLASH), true)).toBe(`${TICK}docs/a.md${TICK}`);
    expect(safePathCode("docs/guide.md")).toBe(`${TICK}docs/guide.md${TICK}`);
    expect(Bun.markdown.html(`Not sent: ${safePathCode("a*b*<br>&amp;.md", false)}, because`))
      .toBe(`<p>Not sent: <code>a*b*&lt;br&gt;&amp;amp;.md</code>, because</p>${LINE_FEED}`);
  });
});

/** A fixed sequence of numbers from 0 up to 1, the same for the same seed on every run. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
