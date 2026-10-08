import { describe, expect, test } from "bun:test";
import { drawsNothing, safeCell, safePath, safePathCell, safePathCode, safeText, skippedEntryWarning } from "../../scripts/lib/safe-text.ts";

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

describe("a character that draws nothing is shown as its code", () => {
  /** The printed form of one code point: four digits in the basic plane, and braces past it. */
  const shown = (point: number): string =>
    point > 0xffff ? `${BACKSLASH}u{${point.toString(16)}}` : code(point);
  const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]|(?! )\p{Zs}/u;
  const PRINTABLE = /^[ -~]*$/;

  // A combining grapheme joiner and a variation selector draw nothing, and both went
  // through as they were. "ab.md" and the same name with one of them between the
  // letters printed alike, in a code span as well, since there is nothing to see.
  test("a combining grapheme joiner and a variation selector no longer hide in a name", () => {
    const plain = safePath("ab.md", false);
    for (const point of [0x34f, 0xfe0f, 0xfe00, 0x180b, 0x115f, 0x1160, 0x3164, 0xffa0, 0x17b4, 0x2065, 0xfff0]) {
      const printed = safePath(`a${String.fromCodePoint(point)}b.md`, false);
      expect(printed, `U+${point.toString(16)}`).toBe(`a${shown(point)}b.md`);
      expect(printed).not.toBe(plain);
      expect(PRINTABLE.test(printed), printed).toBe(true);
    }
    // An interlinear annotation anchor draws nothing and is not in that Unicode property.
    // It is a format character, which is why that class is read as well.
    const anchor = String.fromCodePoint(0xfff9);
    expect(/\p{Default_Ignorable_Code_Point}/u.test(anchor)).toBe(false);
    expect(safePath(`a${anchor}b.md`, false)).toBe(`a${code(0xfff9)}b.md`);
    // Past the basic plane: a variation selector of the second block, and a tag that is not assigned.
    expect(safePath(`a${String.fromCodePoint(0xe0100)}b.md`, false)).toBe(`a${BACKSLASH}u{e0100}b.md`);
    expect(safePath(`a${String.fromCodePoint(0xe0080)}b.md`, false)).toBe(`a${BACKSLASH}u{e0080}b.md`);
    expect(safePathCell(`a${String.fromCodePoint(0x34f)}b.md`, false)).toBe(`${String.fromCharCode(96)}a${code(0x34f)}b.md${String.fromCharCode(96)}`);
  });

  test("every code point that Unicode says to leave undrawn is shown as its code", () => {
    let checked = 0;
    for (let point = 0; point <= 0x10ffff; point++) {
      // Half a surrogate pair is no code point, and is tested where it stands alone.
      if (point >= 0xd800 && point <= 0xdfff) continue;
      const character = String.fromCodePoint(point);
      if (!/\p{Default_Ignorable_Code_Point}/u.test(character)) continue;
      checked++;
      if (safePath(character, false) !== shown(point)) expect(safePath(character, false), `U+${point.toString(16)}`).toBe(shown(point));
    }
    // The count is that of the Unicode version this runtime carries, pinned so that
    // the loop cannot quietly check nothing.
    expect(checked).toBe(4_174);
  });

  test("in generated names, one unseen character more gives a printed form of its own, in visible characters", () => {
    const unseen: number[] = [];
    for (let point = 0; point <= 0x10ffff; point++) {
      if (point >= 0xd800 && point <= 0xdfff) continue;
      if (UNSEEN.test(String.fromCodePoint(point))) unseen.push(point);
    }
    expect(unseen.length).toBeGreaterThan(4_000);
    const base = "ab.md";
    const random = sequence(24495);
    const names = new Set<string>();
    while (names.size < 3_000) {
      const point = unseen[Math.floor(random() * unseen.length)] as number;
      const at = Math.floor(random() * (base.length + 1));
      names.add(base.slice(0, at) + String.fromCodePoint(point) + base.slice(at));
    }
    const printed = [...names].map((name) => safePath(name, false));
    for (const form of printed) {
      if (!PRINTABLE.test(form) || form === base) expect(form).toBe("a form in visible characters that is not the base name");
    }
    expect(new Set(printed).size).toBe(names.size);
  });

  test("a name a reader can read is left as it is written", () => {
    const acute = String.fromCodePoint(0x301);
    const names = [
      // "cafe" with a combining acute accent: the mark draws, on the letter before it.
      `cafe${acute}.md`,
      // The same word with the one-character letter. The two print alike, as the owner accepted.
      `caf${String.fromCodePoint(0xe9)}.md`,
      // Devanagari, with a vowel sign and a virama, which are combining marks that draw.
      `${String.fromCodePoint(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947)}.md`,
      // Arabic, Thai with a tone mark, Hangul syllables, Han.
      `${String.fromCodePoint(0x645, 0x644, 0x641)}.md`,
      `${String.fromCodePoint(0xe19, 0xe49, 0xe33)}.md`,
      `${String.fromCodePoint(0xd55c, 0xae00)}.md`,
      `${String.fromCodePoint(0x6587, 0x4ef6)}.md`,
      // An emoji that needs no selector, and a letter with two combining marks.
      `${String.fromCodePoint(0x1f4c4)}.md`,
      `a${String.fromCodePoint(0x308, 0x304)}.md`,
    ];
    for (const name of names) {
      expect(safePath(name, false), name).toBe(name);
      expect(safePath(name, true), name).toBe(name);
    }
  });

  test("an emoji keeps its picture, and the selector or joiner beside it is shown", () => {
    const heart = String.fromCodePoint(0x2764);
    // A heart asked for in colour: the heart stays, and the selector is shown after it.
    expect(safePath(`${heart}${String.fromCodePoint(0xfe0f)}.md`, false)).toBe(`${heart}${code(0xfe0f)}.md`);
    expect(safePath(`${heart}.md`, false)).toBe(`${heart}.md`);
    // A keycap: digit, selector, enclosing mark. The mark draws, so it stays.
    expect(safePath(`1${String.fromCodePoint(0xfe0f, 0x20e3)}.md`, false)).toBe(`1${code(0xfe0f)}${String.fromCodePoint(0x20e3)}.md`);
    // Two people joined into one picture: each stays, and the joiner between them is shown.
    const [man, woman] = [String.fromCodePoint(0x1f468), String.fromCodePoint(0x1f469)];
    expect(safePath(`${man}${String.fromCodePoint(0x200d)}${woman}.md`, false)).toBe(`${man}${code(0x200d)}${woman}.md`);
  });

  // The object replacement character stands for something that is not there. Unicode
  // classes it as a symbol, so no property finds it, and a review drew "ab.md" and the
  // same name with it between the letters to the same pixels in three fonts.
  test("the object replacement character is shown as its code, though it is a symbol", () => {
    const object = String.fromCharCode(0xfffc);
    expect(/[\p{C}\p{Z}\p{Default_Ignorable_Code_Point}]/u.test(object)).toBe(false);
    expect(safePath(`a${object}b.md`, false)).toBe(`a${code(0xfffc)}b.md`);
    expect(safePath(`a${object}b.md`, true)).toBe(`a${code(0xfffc)}b.md`);
    expect(safePath(`a${object}b.md`, false)).not.toBe(safePath("ab.md", false));
    expect(safePath(object + object, false)).toBe(code(0xfffc) + code(0xfffc));
    // Its neighbours are a format character and the replacement character, which draws.
    expect(safePath(String.fromCharCode(0xfffb), false)).toBe(code(0xfffb));
    expect(safePath(String.fromCharCode(0xfffd), false)).toBe(String.fromCharCode(0xfffd));
    expect(safePathCell(`a${object}b.md`, false)).toBe(`${String.fromCharCode(96)}a${code(0xfffc)}b.md${String.fromCharCode(96)}`);
  });

  test("what is left alone: a mark that draws, a blank that is a symbol, and private use", () => {
    // A combining mark with no letter before it still draws. The braille blank is a
    // symbol to Unicode, though it looks like a space. A private use character draws
    // whatever a font gives it. None is in a class the formatter reads, so each stays.
    for (const point of [0x301, 0x2800, 0xe000, 0x10ffff]) {
      const name = `a${String.fromCodePoint(point)}b.md`;
      expect(safePath(name, false), `U+${point.toString(16)}`).toBe(name);
    }
  });
});

describe("text that holds nothing a reader can see", () => {
  test("is spaces and the characters a printed path shows as their codes, and nothing else", () => {
    for (const point of [0x20, 0x9, 0xa, 0xd, 0xa0, 0x2002, 0x3000, 0x200b, 0x2060, 0xfeff, 0xad, 0x200d, 0x202e, 0xfe0f, 0x34f, 0xfffc, 0xe0041, 0x2028]) {
      const character = String.fromCodePoint(point);
      expect(drawsNothing(character), point.toString(16)).toBe(true);
      expect(drawsNothing(` ${character}${character} `), point.toString(16)).toBe(true);
      expect(drawsNothing(`${character}a${character}`), point.toString(16)).toBe(false);
      // One definition: but for the plain space, it is what a printed path shows as a code.
      if (point !== 0x20) {
        expect(safePath(character, false), point.toString(16)).not.toBe(character);
      }
    }
    expect(drawsNothing("")).toBe(true);
    // A character that draws is seen, whatever it is: a letter, a mark, an emoji, the braille blank.
    for (const point of [0x61, 0x2d, 0x301, 0x1f600, 0x2800, 0xfffd, 0xe000]) {
      expect(drawsNothing(String.fromCodePoint(point)), point.toString(16)).toBe(false);
      expect(safePath(String.fromCodePoint(point), false), point.toString(16)).toBe(String.fromCodePoint(point));
    }
    // Asked twice, it answers twice the same: the pattern keeps no place between calls.
    expect([drawsNothing("a b"), drawsNothing("a b"), drawsNothing("  "), drawsNothing("  ")]).toEqual([false, false, true, true]);
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
