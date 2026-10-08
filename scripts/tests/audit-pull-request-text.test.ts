import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realDependencies, runCli, type Dependencies } from "../audit-pull-request-text.ts";

const ROOT = join(import.meta.dir, "..", "..");
const PASS_MEANING = "A pass means the audit ran on a description that is not empty.";
const FILE = { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };

/** What one run printed, and what it asked of the file system. */
interface Run {
  exit: number;
  stdout: string[];
  stderr: string[];
  inspected: string[];
  read: string[];
  summary: string[];
}

/** Runs the check over a file that exists only in the test, and counts every read. */
function run(path: string, contents: string[], replace: Partial<Dependencies> = {}): Run {
  const result: Run = { exit: -1, stdout: [], stderr: [], inspected: [], read: [], summary: [] };
  const real = realDependencies(ROOT, undefined);
  const dependencies: Dependencies = {
    inspect: (asked) => {
      result.inspected.push(asked);
      return FILE;
    },
    // Each read gives the next of the contents, so a second read would see a changed file.
    readText: (asked) => {
      result.read.push(asked);
      return contents[result.read.length - 1] as string;
    },
    audit: real.audit,
    appendText: (_path, text) => {
      result.summary.push(text);
    },
    summaryPath: undefined,
    ...replace,
  };
  result.exit = runCli(["bun", "cli", path], (text) => result.stdout.push(text), (text) => result.stderr.push(text), dependencies);
  return result;
}

describe("the file is read once, and that reading is what is judged", () => {
  // A review replaced the description with a line of white space after the script had
  // tested it for emptiness and before the audit read it. The script passed, and said
  // the description was not empty. There were three reads then. There is one now, so a
  // file that changes afterwards changes nothing.
  test("a file that turns to white space after the read is judged as it was read", () => {
    const result = run("description.md", ["We shall pay.\n", " \n", " \n"]);
    expect(result.exit).toBe(0);
    expect(result.read).toEqual(["description.md"]);
    expect(result.inspected).toEqual(["description.md"]);
    expect(result.stdout.join("\n")).toContain("| 1 | legalese | banned term \"shall\" |");
    expect(result.stdout.join("\n")).toContain("The audit reported 1 finding. It is advice");
  });

  test("a file that was white space when read is empty, whatever it holds later", () => {
    const result = run("description.md", [" \n", "We shall pay.\n"]);
    expect(result.exit).toBe(1);
    expect(result.read).toHaveLength(1);
    expect(result.stdout).toEqual([
      "The description is empty or holds only whitespace, so there is nothing to audit. Write one: a reader needs to know what the change does and why.",
    ]);
  });

  // The same review put a directory where the description had been, at the same moment.
  // The script exited 3, where its header promised 2 for a path that cannot be read.
  test("what the path names is asked once, before the read, and never again", () => {
    let asked = 0;
    const result = run("description.md", ["Plain words.\n"], {
      inspect: () => {
        asked++;
        return asked === 1 ? FILE : { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
      },
    });
    expect(asked).toBe(1);
    expect(result.exit).toBe(0);
    expect(result.stdout.join("\n")).toContain("The audit reported no findings.");
  });

  test("the text that was read is the text the audit is given", () => {
    const audited: Array<[text: string, fileName: string, markdown: boolean]> = [];
    const text = "---\nnote: words\n---\n";
    const result = run("notes.txt", [text], {
      audit: (...given) => {
        audited.push(given);
        return [];
      },
    });
    expect(result.exit).toBe(0);
    expect(audited).toEqual([[text, "notes.txt", false]]);
    expect(run("notes.MD", [text], { audit: (...given) => (audited.push(given), []) }).exit).toBe(0);
    expect(audited[1]).toEqual([text, "notes.MD", true]);
  });
});

describe("a path that is not a file to read is a wrong argument", () => {
  const kinds: Array<[name: string, kind: Partial<typeof FILE>, words: string]> = [
    ["a directory", { isFile: () => false, isDirectory: () => true }, "names a directory, where a file is needed."],
    ["a symbolic link", { isFile: () => false, isSymbolicLink: () => true }, "names a symbolic link, which this check does not follow."],
    ["a pipe or a device", { isFile: () => false }, "names something that is not a regular file."],
  ];
  test.each(kinds)("%s is refused before anything is read", (_name, kind, words) => {
    const path = "some/PRIVATE/description.md";
    const result = run(path, ["Plain words.\n"], { inspect: () => ({ ...FILE, ...kind }) });
    expect(result.exit).toBe(2);
    expect(result.read).toEqual([]);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toEqual([`The path given as the first argument, ${path.length} characters long, ${words}`]);
  });

  test("a path that names nothing, and a file that refuses to be read, say so in fixed words", () => {
    const path = "some/PRIVATE/description.md";
    const thrower = (): never => {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    };
    const missing = run(path, [], { inspect: thrower });
    expect(missing.exit).toBe(2);
    expect(missing.read).toEqual([]);
    expect(missing.stderr).toEqual([`The path given as the first argument, ${path.length} characters long, names no file to read.`]);
    const locked = run(path, [], { readText: thrower });
    expect(locked.exit).toBe(2);
    expect(locked.stdout).toEqual([]);
    expect(locked.stderr)
      .toEqual([`The path given as the first argument, ${path.length} characters long, names a file that exists but cannot be read.`]);
  });

  test("no argument is a usage error", () => {
    const stderr: string[] = [];
    expect(runCli(["bun", "cli"], () => {}, (text) => stderr.push(text), realDependencies(ROOT, undefined))).toBe(2);
    expect(stderr).toEqual(["usage: bash scripts/audit-pull-request-text.sh <file>"]);
  });
});

describe("an audit that does not run has a code of its own", () => {
  test("a file with an ending the audit does not read", () => {
    const result = run("description.rst", ["Plain words.\n"]);
    expect(result.exit).toBe(3);
    expect(result.stdout).toEqual([
      "The audit did not run, because it reads a file ending in .md, .markdown or .txt and was given another ending. The description was not checked.",
    ]);
    // An empty description is empty whatever its ending.
    expect(run("description.rst", [" \n"]).exit).toBe(1);
  });

  test("an audit that throws is reported by its kind, never in its own words", () => {
    const result = run("description.md", ["Plain words.\n"], {
      audit: () => {
        throw new TypeError("PRIVATE text from the runtime");
      },
    });
    expect(result.exit).toBe(3);
    expect(result.stdout).toEqual([
      "The audit did not run to completion: it was stopped by an unexpected TypeError. The description was not checked.",
    ]);
    expect(result.stderr).toEqual([]);
  });
});

describe("the findings are counted in words", () => {
  test.each([
    ["Plain words.\n", "The audit reported no findings."],
    ["We shall pay.\n", "The audit reported 1 finding. It is advice, and does not block this pull request. Edit the text if the finding points at a real problem for its readers."],
    ["We shall pay.\n\nWe hereby agree.\n", "The audit reported 2 findings. They are advice, and do not block this pull request. Edit the text where a finding points at a real problem for its readers."],
  ])("for %j", (text, sentence) => {
    const result = run("description.md", [text]);
    expect(result.exit).toBe(0);
    expect(result.stdout).toHaveLength(3);
    expect(result.stdout[0]).toStartWith("| File | Line | Rule | Finding |\n|------|------|------|---------|\n");
    expect(result.stdout[0]).toContain("Files read: 1. Skipped entries: 0.");
    expect(result.stdout[1]).toBe(sentence);
    expect(result.stdout[2]).toStartWith(PASS_MEANING);
  });
});

describe("the step summary", () => {
  test("holds a heading and everything the log holds, in one write", () => {
    const result = run("description.md", ["We shall pay.\n"], { summaryPath: "summary.md" });
    expect(result.exit).toBe(0);
    expect(result.summary).toEqual([`## Pull request description audit\n\n${result.stdout.join("\n\n")}\n\n`]);
    const empty = run("description.md", [" \n"], { summaryPath: "summary.md" });
    expect(empty.summary).toEqual([`## Pull request description audit\n\n${empty.stdout[0]}\n\n`]);
  });

  test("is not written where none is named, or for a path that was refused", () => {
    expect(run("description.md", ["Plain words.\n"]).summary).toEqual([]);
    expect(run("description.md", ["Plain words.\n"], { summaryPath: "" }).summary).toEqual([]);
    const refused = run("description.md", [], { summaryPath: "summary.md", inspect: () => ({ ...FILE, isFile: () => false }) });
    expect(refused.exit).toBe(2);
    expect(refused.summary).toEqual([]);
  });

  // With the summary variable naming a directory, the shell failed on its own
  // redirect: bash printed its diagnostic with the whole path, and the script left
  // with 1, the code for an empty description.
  test("that cannot be written is said in fixed words, and the verdict stands", () => {
    const workspace = mkdtempSync(join(tmpdir(), "iso-24495-PRIVATE-summary-"));
    try {
      const description = join(workspace, "description.md");
      writeFileSync(description, "We shall pay.\n");
      const readOnly = join(workspace, "read-only.md");
      writeFileSync(readOnly, "Earlier step.\n");
      chmodSync(readOnly, 0o444);
      mkdirSync(join(workspace, "a-directory"));
      const unwritable: Array<[name: string, path: string]> = [
        ["a directory", join(workspace, "a-directory")],
        ["a file in a directory that is not there", join(workspace, "missing", "summary.md")],
        ["a file that may not be written", readOnly],
      ];
      for (const [name, summary] of unwritable) {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const exit = runCli(["bun", "cli", description], (text) => stdout.push(text), (text) => stderr.push(text),
          realDependencies(ROOT, summary));
        expect(exit, name).toBe(0);
        expect(stdout.join("\n"), name).toContain("The audit reported 1 finding.");
        expect(stderr, name).toEqual([
          `The step summary named by GITHUB_STEP_SUMMARY, a path ${summary.length} characters long, could not be written. The result above is complete without it.`,
        ]);
        expect(stderr.join("").includes("PRIVATE"), name).toBe(false);
      }
      expect(readFileSync(readOnly, "utf8")).toBe("Earlier step.\n");
      chmodSync(readOnly, 0o644);

      // An empty description is still exit 1 when its summary cannot be written.
      writeFileSync(description, " \n");
      expect(runCli(["bun", "cli", description], () => {}, () => {}, realDependencies(ROOT, join(workspace, "a-directory")))).toBe(1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe("the real file system", () => {
  test("a real file is read, audited with the acronyms of this repository, and added to a real summary", () => {
    const workspace = mkdtempSync(join(tmpdir(), "iso-24495-description-"));
    try {
      const description = join(workspace, "description.md");
      writeFileSync(description, "Use the SDK here.\n\nThe tenant shall vacate.\n");
      const summary = join(workspace, "summary.md");
      writeFileSync(summary, "Earlier step.\n");
      const stdout: string[] = [];
      expect(runCli(["bun", "cli", description], (text) => stdout.push(text), () => {}, realDependencies(ROOT, summary))).toBe(0);
      const printed = stdout.join("\n");
      expect(printed).toContain("| 3 | legalese |");
      // SDK is in .iso-24495-4/acronyms.json here, so it is not reported.
      expect(printed).not.toContain("acronym-undefined");
      expect(readFileSync(summary, "utf8")).toBe(`Earlier step.\n## Pull request description audit\n\n${stdout.join("\n\n")}\n\n`);
      // A description has no front matter, so a leading block is read as the text it is.
      writeFileSync(description, "---\nnote: We shall pay.\n---\n");
      const block: string[] = [];
      expect(runCli(["bun", "cli", description], (text) => block.push(text), () => {}, realDependencies(ROOT, undefined))).toBe(0);
      expect(block.join("\n")).toContain("| legalese |");
      // A directory and a path that names nothing are refused by the real inspection.
      const stderr: string[] = [];
      expect(runCli(["bun", "cli", workspace], () => {}, (text) => stderr.push(text), realDependencies(ROOT, undefined))).toBe(2);
      expect(runCli(["bun", "cli", join(workspace, "gone.md")], () => {}, (text) => stderr.push(text), realDependencies(ROOT, undefined))).toBe(2);
      expect(stderr.map((line) => line.replace(/^.*long, /, ""))).toEqual(["names a directory, where a file is needed.", "names no file to read."]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
