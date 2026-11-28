import { describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FACTS_FILE, factsFor, finishDeclared, formatDeclared, readDocumentFacts, recordDeclared, startDeclared, type DocumentFacts,
} from "../../scripts/lib/document-facts.ts";

/** A numbered document that nothing in it cites, so the numbering rule asks its question. */
const UNCITED = "# Guide\n\n## 1. Install\n\nText.\n\n## 2. Run\n\nText.\n";
/** The same document with a citation, so the rule asks nothing. */
const CITED = `${UNCITED}\nSee step 2.\n`;

/** A project directory holding the facts file with this text, or no file when the text is null. */
function project(text: string | null): string {
  const directory = mkdtempSync(join(tmpdir(), "iso-facts-"));
  if (text !== null) {
    mkdirSync(join(directory, ".iso-24495-4"));
    writeFileSync(join(directory, ".iso-24495-4", "document-facts.json"), text);
  }
  return directory;
}

/** What the facts file with this text declares, read from a fresh project that is then removed. */
function read(text: string | null): DocumentFacts {
  const directory = project(text);
  try {
    return readDocumentFacts(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The problem line for a file that declares nothing for this reason. */
function nothing(reason: string): string {
  return `${FACTS_FILE} ${reason}, so nothing in it is honoured.`;
}

/** A stand-in for `lstatSync` that reports this one path as a symbolic link. */
function linkAt(target: string): (path: string) => Stats {
  return path => {
    const stats = lstatSync(path);
    return path === target ? Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, { isSymbolicLink: () => true }) : stats;
  };
}

/** Facts as `readDocumentFacts` would give them, for these documents and problems. */
function facts(documents: Record<string, unknown>, problems: string[] = []): DocumentFacts {
  return { source: FACTS_FILE, documents: new Map(Object.entries(documents)) as DocumentFacts["documents"], problems };
}

describe("readDocumentFacts reads .iso-24495-4/document-facts.json", () => {
  test("a missing file or folder declares nothing and is no problem", () => {
    expect(read(null)).toEqual({ source: null, documents: new Map(), problems: [] });
  });

  test("version 1 with exact paths declares headingNumbers for each", () => {
    const facts = read(JSON.stringify({ version: 1, documents: { "docs/a.md": { headingNumbers: "cited" }, "b.md": { headingNumbers: "not-cited" } } }));
    expect(facts.source).toBe(FACTS_FILE);
    expect([...facts.documents]).toEqual([["docs/a.md", { headingNumbers: "cited" }], ["b.md", { headingNumbers: "not-cited" }]]);
    expect(facts.problems).toEqual([]);
    expect(factsFor(facts, "docs/a.md")).toEqual({ headingNumbers: "cited" });
    expect(factsFor(facts, "docs/*.md")).toEqual({});
    expect(factsFor(facts, "a.md")).toEqual({});
  });

  test("a version 1 file with no documents declares nothing and is no problem", () => {
    expect(read("{\"version\": 1}")).toEqual({ source: FACTS_FILE, documents: new Map(), problems: [] });
  });

  test("a file that is not JSON, not an object or not version 1 declares nothing, with one problem", () => {
    expect(read("{ not json").problems).toEqual([nothing("is not valid JSON")]);
    for (const text of ["[1]", "null", "1", "{}", "{\"version\": 2}", "{\"version\": \"1\"}"]) {
      const facts = read(text);
      expect(facts.documents.size, text).toBe(0);
      expect(facts.problems, text).toEqual([nothing("is not an object with \"version\": 1")]);
    }
    expect(read("{\"version\": 1, \"documents\": [\"a.md\"]}").problems).toEqual([nothing("has a \"documents\" that is not an object")]);
  });

  test("an unknown key at either level is not understood and never honoured; the keys beside it still are", () => {
    const facts = read(JSON.stringify({ version: 1, extra: true, documents: { "a.md": { headingNumbers: "cited", readerKnows: ["SLA"] }, "b.md": "cited", "c.md": { headingNumbers: "yes" } } }));
    expect([...facts.documents]).toEqual([["a.md", { headingNumbers: "cited" }]]);
    expect(facts.problems).toEqual([
      "The key `extra` is not understood and is not honoured.",
      "The key `readerKnows` for `a.md` is not understood and is not honoured.",
      "The entry for `b.md` is not an object and is not honoured.",
      "headingNumbers for `c.md` must be \"cited\" or \"not-cited\", so it is not honoured.",
    ]);
  });

  test("keys named like inherited properties are own keys, and a path not in the file names nothing", () => {
    const facts = read("{\"version\": 1, \"documents\": {\"__proto__\": {\"headingNumbers\": \"cited\"}}}");
    expect(factsFor(facts, "__proto__")).toEqual({ headingNumbers: "cited" });
    expect(factsFor(facts, "constructor")).toEqual({});
    expect(factsFor(facts, "toString")).toEqual({});
  });

  test("a rejected key or path is quoted only when it holds letters, digits and . _ / - alone; otherwise its length is printed", () => {
    const bell = `a${"`"}b${String.fromCharCode(7)}`;
    const injected = "|<img src=x onerror=alert(1)>";
    const path = "x|<img src=x>.md";
    const facts = read(JSON.stringify({ version: 1, [bell]: 1, [injected]: 0, documents: { [path]: "cited", "docs/ok-file_1.md": { "bad key!": 1, headingNumbers: "maybe" } } }));
    expect(facts.problems).toEqual([
      "A key of 4 characters (not shown) is not understood and is not honoured.",
      `A key of ${injected.length} characters (not shown) is not understood and is not honoured.`,
      `The entry for a path of ${path.length} characters (not shown) is not an object and is not honoured.`,
      "A key of 8 characters (not shown) for `docs/ok-file_1.md` is not understood and is not honoured.",
      "headingNumbers for `docs/ok-file_1.md` must be \"cited\" or \"not-cited\", so it is not honoured.",
    ]);
    expect(read(JSON.stringify({ version: 1, documents: { [path]: { headingNumbers: "x" } } })).problems).toEqual([
      `headingNumbers for a path of ${path.length} characters (not shown) must be "cited" or "not-cited", so it is not honoured.`,
    ]);
    expect(read(JSON.stringify({ version: 1, ["k".repeat(101)]: 1 })).problems).toEqual(["A key of 101 characters (not shown) is not understood and is not honoured."]);
    expect(read(JSON.stringify({ version: 1, "|": 1 })).problems).toEqual(["A key of 1 character (not shown) is not understood and is not honoured."]);
  });

  test("a facts file or folder that is a symbolic link declares nothing, with one problem", () => {
    const directory = project("{\"version\": 1}");
    try {
      const folder = join(directory, ".iso-24495-4");
      expect(readDocumentFacts(directory, linkAt(folder)).problems).toEqual([nothing("is in a folder that is a symbolic link")]);
      expect(readDocumentFacts(directory, linkAt(join(folder, "document-facts.json"))).problems).toEqual([nothing("is a symbolic link")]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a file that cannot be read, or looked at, declares nothing, with one problem", () => {
    const directory = project("{\"version\": 1}");
    try {
      const unreadable = readDocumentFacts(directory, lstatSync, () => {
        throw new Error("denied");
      });
      expect(unreadable.problems).toEqual([nothing("could not be read")]);
      const denied = readDocumentFacts(directory, () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      });
      expect(denied).toEqual({ source: FACTS_FILE, documents: new Map(), problems: [nothing("could not be read")] });
      const absent = readDocumentFacts(directory, () => {
        throw Object.assign(new Error("absent"), { code: "ENOTDIR" });
      });
      expect(absent.source).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("the run's record and the echo", () => {
  test("each honoured declaration is echoed with what it changed, counted by running the rule without it", () => {
    const run = startDeclared(facts({ "a.md": { headingNumbers: "cited" }, "b.md": { headingNumbers: "not-cited" }, "c.md": { headingNumbers: "cited" } }));
    recordDeclared(run, "a.md", UNCITED, { fileName: "a.md", markdown: true });
    recordDeclared(run, "b.md", UNCITED, { fileName: "b.md", markdown: true });
    recordDeclared(run, "c.md", CITED, { fileName: "c.md", markdown: true });
    recordDeclared(run, "d.md", UNCITED, { fileName: "d.md", markdown: true });
    const report = finishDeclared(run);
    expect(report.files).toEqual([{ file: "a.md", headingNumbers: "cited" }, { file: "b.md", headingNumbers: "not-cited" }, { file: "c.md", headingNumbers: "cited" }]);
    expect(report.effects.map(effect => [effect.file, effect.questionsNotRaised, effect.questionsMadeFindings])).toEqual([["a.md", 1, 0], ["b.md", 0, 1], ["c.md", 0, 0]]);
    expect([report.problems, report.unread]).toEqual([[], 0]);
    expect(formatDeclared(report, run)).toBe([
      `Declared facts (${FACTS_FILE})`,
      "| File | Fact | Value | Effect |",
      "|------|------|-------|--------|",
      "| `a.md` | headingNumbers | cited | 1 uncited-numbering question was not raised. |",
      "| `b.md` | headingNumbers | not-cited | 1 uncited-numbering question was reported as a finding. |",
      "| `c.md` | headingNumbers | cited | No finding changed. |",
      "",
      "Not declared: headingNumbers for 1 of 4 Markdown files read.",
    ].join("\n"));
  });

  test("a file that is not Markdown changes nothing and is not counted as Markdown", () => {
    const run = startDeclared(facts({ "a.txt": { headingNumbers: "cited" } }));
    recordDeclared(run, "a.txt", UNCITED, { fileName: "a.txt", markdown: false });
    const report = finishDeclared(run);
    expect(report.effects.map(effect => effect.questionsNotRaised)).toEqual([0]);
    expect(formatDeclared(report, run)?.split("\n").slice(-1)).toEqual(["Not declared: headingNumbers for 0 of 0 Markdown files read."]);
  });

  test("the effect follows the front matter setting and the file name the audit used", () => {
    const run = startDeclared(facts({ "CHANGELOG.md": { headingNumbers: "cited" }, "f.md": { headingNumbers: "cited" } }));
    recordDeclared(run, "CHANGELOG.md", UNCITED, { fileName: "CHANGELOG.md", markdown: true });
    recordDeclared(run, "f.md", `---\nnote: see 1\n---\n${UNCITED}`, { fileName: "f.md", markdown: true, frontMatter: false });
    expect(finishDeclared(run).effects.map(effect => effect.questionsNotRaised)).toEqual([0, 0]);
  });

  test("declarations for files the run did not read are counted apart from the problems", () => {
    const one = startDeclared(facts({ "gone.md": { headingNumbers: "cited" } }));
    const report = finishDeclared(one);
    expect([report.unread, report.problems]).toEqual([1, []]);
    expect(formatDeclared(report, one)?.split("\n").at(-1)).toBe("Not read: 1 declaration names a file this run did not read, so it changed nothing.");
    const two = startDeclared(facts({ "a.md": { headingNumbers: "cited" }, "b.md": { headingNumbers: "cited" } }, ["Earlier."]));
    const both = finishDeclared(two);
    expect([both.unread, both.problems]).toEqual([2, ["Earlier."]]);
    expect(formatDeclared(both, two)?.split("\n").slice(-2)).toEqual(["Not read: 2 declarations name files this run did not read, so they changed nothing.", "Problem: Earlier."]);
  });

  test("with no facts file nothing is printed; with one, its problems are listed up to 20 and the rest counted", () => {
    expect(formatDeclared(finishDeclared(startDeclared({ source: null, documents: new Map(), problems: [] })), { markdownFiles: 3, declaredMarkdownFiles: 0 })).toBeNull();
    const problems = Array.from({ length: 23 }, (unused, index) => `Problem ${index}.`);
    const run = startDeclared(facts({}, problems));
    recordDeclared(run, "a.md", UNCITED, { fileName: "a.md", markdown: true });
    const lines = (formatDeclared(finishDeclared(run), run) ?? "").split("\n");
    expect(lines.slice(3, 6)).toEqual(["", "Not declared: headingNumbers for 1 of 1 Markdown file read.", "Problem: Problem 0."]);
    expect(lines.filter(line => line.startsWith("Problem: "))).toHaveLength(20);
    expect(lines.at(-1)).toBe("Problems not listed: 3.");
  });

  test("a path and a value are printed as code and as a safe cell", () => {
    const run = startDeclared(facts({ "a|b`c.md": { headingNumbers: "cited" } }));
    recordDeclared(run, "a|b`c.md", UNCITED, { fileName: "a|b`c.md", markdown: true });
    expect(formatDeclared(finishDeclared(run), run)?.split("\n")[3]).toBe("| ``a\\|b`c.md`` | headingNumbers | cited | 1 uncited-numbering question was not raised. |");
  });

  test("the table ends before the lines after it, so a renderer reads each of them as text, not as a row", () => {
    const run = startDeclared(facts({ "a.md": { headingNumbers: "cited" } }, ["The key `x` is not understood and is not honoured.", "A key of 29 characters (not shown) is not understood and is not honoured."]));
    recordDeclared(run, "a.md", UNCITED, { fileName: "a.md", markdown: true });
    const shown = Bun.markdown.html(formatDeclared(finishDeclared(run), run) ?? "");
    const table = shown.slice(shown.indexOf("<table>"), shown.indexOf("</table>"));
    expect([...table.matchAll(/<tr>/g)]).toHaveLength(2);
    expect(shown.slice(shown.indexOf("</table>"))).toContain("Problem: A key of 29 characters (not shown)");
  });

  test("an honoured declaration whose path holds a pipe and a tag renders as one cell of code", () => {
    // Windows cannot hold such a file name, so the record is made directly.
    const path = "x|<img src=x onerror=alert(1)>.md";
    const run = startDeclared(facts({ [path]: { headingNumbers: "cited" } }));
    recordDeclared(run, path, UNCITED, { fileName: path, markdown: true });
    const shown = Bun.markdown.html(formatDeclared(finishDeclared(run), run) ?? "");
    expect(shown).not.toContain("<img");
    const rows = [...shown.matchAll(/<tr>([^]*?)<\/tr>/g)].map(row => [...(row[1] ?? "").matchAll(/<td>/g)].length);
    expect(rows).toEqual([0, 4]);
    expect(shown).toContain("<code>x|&lt;img src=x onerror=alert(1)&gt;.md</code>");
  });

  test("several questions and findings are counted in the plural", () => {
    const report = { source: FACTS_FILE, files: [], problems: [], unread: 0, effects: [
      { file: "a.md", fact: "headingNumbers" as const, value: "cited" as const, rule: "uncited-numbering" as const, questionsNotRaised: 2, questionsMadeFindings: 0 },
      { file: "b.md", fact: "headingNumbers" as const, value: "not-cited" as const, rule: "uncited-numbering" as const, questionsNotRaised: 0, questionsMadeFindings: 2 },
    ] };
    const lines = (formatDeclared(report, { markdownFiles: 2, declaredMarkdownFiles: 2 }) ?? "").split("\n");
    expect(lines[3]).toContain("2 uncited-numbering questions were not raised.");
    expect(lines[4]).toContain("2 uncited-numbering questions were reported as a finding.");
  });
});
