import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  auditTarget,
  formatFindings,
  runCli,
} from "../../iso-24495-text-audit/scripts/audit-text.ts";

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "iso-text-audit-"));
}

/** What the comparison prints when the path an argument names runs through a linked directory. */
function linkedDirectoryRefusal(source: string, path: string): string {
  return `audit-text: ${source} names a path of ${path.length} characters that runs through a symbolic link, which the comparison does not follow; name the file by a path with no link in it`;
}

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writeOut: (text: string) => stdout.push(text),
    writeErr: (text: string) => stderr.push(text),
  };
}

describe("auditTarget", () => {
  test("audits one selected file and applies the project's acronym list", () => {
    const project = makeProject();
    try {
      mkdirSync(join(project, ".iso-24495-4"));
      writeFileSync(join(project, ".iso-24495-4", "acronyms.json"), '["NHS"]');
      mkdirSync(join(project, "docs"));
      const file = join(project, "docs", "policy.txt");
      writeFileSync(file, "The NHS shall act.\n");

      const result = auditTarget(file, project);

      expect(Object.keys(result.files)).toEqual(["docs/policy.txt"]);
      expect(result.files["docs/policy.txt"]?.violations.map((item) => item.rule)).toEqual([
        "legalese",
      ]);
      expect(result.skipped).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("audits a selected directory and reports unreadable entries", () => {
    const project = makeProject();
    try {
      const docs = join(project, "docs");
      mkdirSync(docs);
      writeFileSync(join(docs, "clean.md"), "A short sentence.\n");
      const blocked = join(docs, "blocked.md");
      writeFileSync(blocked, "This file becomes unreadable.\n");
      writeFileSync(join(docs, "ignored.ts"), "const shall = true;\n");
      const target = join(docs, "target");
      mkdirSync(target);
      symlinkSync(target, join(docs, "dangling"), "junction");
      rmSync(target, { recursive: true, force: true });

      const readText = readerFailingOn(blocked);
      const result = auditTarget(docs, project, readText);

      expect(Object.keys(result.files)).toEqual(["docs/clean.md"]);
      expect([...result.skipped].sort()).toEqual([blocked, join(docs, "dangling")].sort());
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("does not follow directory links beyond the selected path or through cycles", () => {
    const project = makeProject();
    try {
      const docs = join(project, "docs");
      const privateDirectory = join(project, "private");
      mkdirSync(docs);
      mkdirSync(privateDirectory);
      writeFileSync(join(docs, "clean.md"), "A short sentence.\n");
      writeFileSync(join(privateDirectory, "private.md"), "The supplier shall act.\n");
      const externalLink = join(docs, "external");
      const cycleLink = join(docs, "cycle");
      const selectedLink = join(project, "selected-link");
      symlinkSync(privateDirectory, externalLink, "junction");
      symlinkSync(docs, cycleLink, "junction");
      symlinkSync(privateDirectory, selectedLink, "junction");

      const result = auditTarget(docs, project);

      expect(Object.keys(result.files)).toEqual(["docs/clean.md"]);
      expect([...result.skipped].sort()).toEqual([cycleLink, externalLink].sort());

      const selectedResult = auditTarget(selectedLink, project);
      expect(selectedResult.files).toEqual({});
      expect(selectedResult.totals).toEqual({});
      expect(selectedResult.skipped).toEqual([selectedLink]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("rejects an unsupported selected file", () => {
    const project = makeProject();
    try {
      const file = join(project, "notes.rst");
      writeFileSync(file, "Some prose.\n");
      // The path has just failed the check, so the message gives the endings
      // the audit reads and the length of what arrived, never the path.
      let message = "";
      try {
        auditTarget(file, project);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(
        `Select a file ending in .md, .markdown or .txt; got a path of ${file.length} characters with another ending`,
      );
      expect(message).not.toContain("notes.rst");

      const refused = capture();
      expect(runCli(["bun", "audit-text-cli.ts", file], refused.writeOut, refused.writeErr)).toBe(1);
      expect(refused.stderr).toEqual([`audit-text: ${message}`]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("formatFindings", () => {
  test("reports located findings as proxies and leaves validity to the user", () => {
    const output = formatFindings({
      configHash: "abcd1234",
      files: {
        "docs/policy|draft.md": {
          violations: [{ rule: "legalese", line: 2, detail: "Replace shall | use must." }],
        },
      },
      totals: { legalese: 1 },
      skipped: [],
    });

    expect(output).toContain(
      "| `docs/policy\\|draft.md` | 2 | legalese | Replace shall \\| use must. |",
    );
    expect(output).toContain("Finding count: 1. Files read: 1. Skipped entries: 0.");
    expect(output).toContain("The user decides whether the text suits its readers and purpose.");
    expect(output).not.toMatch(/\b(?:valid|invalid|pass|fail|compliant|non-compliant)\b/i);
  });

  test("reports a clean mechanical result without a verdict", () => {
    const output = formatFindings({
      configHash: "abcd1234",
      files: { "notes|draft.md": { violations: [] } },
      totals: {},
      skipped: [],
    });

    expect(output).toContain("Finding count: 0. Files read: 1. Skipped entries: 0.");
    expect(output).toContain("Mechanical findings are proxies, not an ISO judgement.");
  });
});

describe("runCli", () => {
  test("prints usage errors", () => {
    const missing = capture();
    expect(runCli(["bun", "audit-text-cli.ts"], missing.writeOut, missing.writeErr)).toBe(2);
    expect(missing.stderr[0]).toStartWith("Usage:");

    const missingJson = capture();
    expect(runCli(
      ["bun", "audit-text-cli.ts", "docs", "--json"],
      missingJson.writeOut,
      missingJson.writeErr,
    )).toBe(2);
    expect(missingJson.stderr[0]).toContain("--json requires");

    const missingProject = capture();
    expect(runCli(
      ["bun", "audit-text-cli.ts", "docs", "--project-dir"],
      missingProject.writeOut,
      missingProject.writeErr,
    )).toBe(2);
    expect(missingProject.stderr[0]).toContain("--project-dir requires");
  });

  // A pull request description has no front matter, so GitHub shows a leading
  // "---" block as a rule and a heading. A file in a repository may carry
  // metadata, so the block is hidden unless the caller says there is none.
  test("--no-front-matter reads a leading block as text", () => {
    const project = makeProject();
    try {
      const file = join(project, "description.md");
      writeFileSync(file, "---\nnote: The tenant shall pay.\n---\n");
      const metadata = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", file, "--project-dir", project],
        metadata.writeOut,
        metadata.writeErr,
      )).toBe(0);
      expect(metadata.stdout.join("\n")).not.toContain("heading-style");

      const text = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", file, "--no-front-matter", "--project-dir", project],
        text.writeOut,
        text.writeErr,
      )).toBe(0);
      expect(text.stdout.join("\n")).toContain("heading-style");
      expect(auditTarget(file, project, readFileSync, { frontMatter: false })
        .totals["heading-style"]).toBe(1);
      expect(auditTarget(file, project).totals["heading-style"]).toBeUndefined();

      const twice = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", file, "--no-front-matter", "--no-front-matter"],
        twice.writeOut,
        twice.writeErr,
      )).toBe(2);
      expect(twice.stderr[0]).toContain("--no-front-matter appears more than once");
      const usage = capture();
      expect(runCli(["bun", "audit-text-cli.ts"], usage.writeOut, usage.writeErr)).toBe(2);
      expect(usage.stderr[0]).toContain("[--no-front-matter]");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("rejects malformed options before writing any output", () => {
    const project = makeProject();
    const originalDirectory = process.cwd();
    try {
      process.chdir(project);
      writeFileSync("policy.md", "The supplier shall act.\n");
      writeFileSync("--project-dir", "keep this content");

      const collision = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", "policy.md", "--json", "--project-dir", project],
        collision.writeOut,
        collision.writeErr,
      )).toBe(2);
      expect(collision.stderr[0]).toContain("--json requires");
      expect(readFileSync("--project-dir", "utf8")).toBe("keep this content");

      const unknown = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", "policy.md", "--unknown"],
        unknown.writeOut,
        unknown.writeErr,
      )).toBe(2);
      // The argument has just failed the check, so the message gives its place
      // and its length, and never the text the caller typed.
      expect(unknown.stderr).toEqual([
        "audit-text: unknown option of 9 characters at argument 2; "
          + "expected --json, --project-dir, --no-front-matter, --before or --author-text",
      ]);

      const extra = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", "policy.md", "--no-front-matter", "extra.md"],
        extra.writeOut,
        extra.writeErr,
      )).toBe(2);
      expect(extra.stderr).toEqual([
        "audit-text: unexpected argument of 8 characters at argument 3; "
          + "expected --json, --project-dir, --no-front-matter, --before or --author-text",
      ]);

      const duplicate = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", "policy.md", "--json", "one.json", "--json", "two.json"],
        duplicate.writeOut,
        duplicate.writeErr,
      )).toBe(2);
      expect(duplicate.stderr[0]).toContain("--json appears more than once");
    } finally {
      process.chdir(originalDirectory);
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("prints findings and writes the complete JSON result", () => {
    const project = makeProject();
    try {
      const file = join(project, "policy.md");
      const json = join(project, "findings.json");
      writeFileSync(file, "The supplier shall comply.\n");
      const output = capture();

      expect(runCli(
        ["bun", "audit-text-cli.ts", file, "--project-dir", project, "--json", json],
        output.writeOut,
        output.writeErr,
      )).toBe(0);
      expect(output.stdout.join("\n")).toContain("| `policy.md` | 1 | legalese |");
      expect(output.stderr).toEqual([]);
      expect(JSON.parse(readFileSync(json, "utf8")).totals).toEqual({ legalese: 1 });
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("reports skipped entries and filesystem errors", () => {
    const project = makeProject();
    try {
      const docs = join(project, "docs");
      mkdirSync(docs);
      const target = join(docs, "target");
      mkdirSync(target);
      symlinkSync(target, join(docs, "dangling"), "junction");
      rmSync(target, { recursive: true, force: true });
      const skipped = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", docs, "--project-dir", project],
        skipped.writeOut,
        skipped.writeErr,
      )).toBe(0);
      expect(skipped.stderr[0]).toContain("skipped unreadable entry");

      const absent = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", join(project, "missing.md")],
        absent.writeOut,
        absent.writeErr,
      )).toBe(1);
      expect(absent.stderr[0]).toStartWith("audit-text:");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

// An escape character, the C1 control that opens the same terminal sequences
// in one character, and a right-to-left override. A document or a file name
// can hold any of them, and a finding quotes both.
const UNREAD_CHARACTERS = [27, 0x9b, 0x202e].map((code) => String.fromCharCode(code));

describe("text nobody has read, in the printed findings", () => {
  test("formatFindings prints a file name, a rule and a detail without control characters", () => {
    for (const character of UNREAD_CHARACTERS) {
      const output = formatFindings({
        configHash: "abcd1234",
        files: {
          [`docs/a${character}[2Jb.md`]: {
            violations: [{
              rule: `link${character}text`,
              line: 1,
              detail: `link text "here" describes no destination (https://x.invalid/${character}[2J)`,
            }],
          },
        },
        totals: { "link-text": 1 },
        skipped: [],
      });
      expect(output).not.toContain(character);
      // The file name is a path, so the character is shown as its code. The rule and
      // the detail are quoted wording, where it becomes a space.
      const shown = `${String.fromCharCode(92)}u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
      expect(output).toContain(
        "| " + String.fromCharCode(96) + `docs/a${shown}[2Jb.md` + String.fromCharCode(96)
          + ' | 1 | link text | link text "here" describes no destination (https://x.invalid/ [2J) |',
      );
    }
  });

  // A file name was cleaned like a quoted detail: a control character became a space
  // and each run of spaces became one. Three files then shared one printed name, and
  // nobody could tell which of them a finding was in.
  test("three file names that printed alike are told apart", () => {
    const override = String.fromCharCode(0x202e);
    const names = ["a b.md", "a  b.md", `a${override}b.md`];
    const output = formatFindings({
      configHash: "abcd1234",
      files: Object.fromEntries(names.map((name) =>
        [name, { violations: [{ rule: "legalese", line: 1, detail: "banned  term" }] }])),
      totals: { legalese: 3 },
      skipped: [],
    });
    const rows = output.split("\n").slice(2, 5);
    expect(new Set(rows).size).toBe(3);
    expect(rows).toEqual([
      "| `a b.md` | 1 | legalese | banned term |",
      "| `a  b.md` | 1 | legalese | banned term |",
      "| " + String.fromCharCode(96) + `a${String.fromCharCode(92)}u202eb.md` + String.fromCharCode(96) + " | 1 | legalese | banned term |",
    ]);
    expect(output).not.toContain(override);
  });

  test("a finding stays on one line whatever line ending it holds", () => {
    const output = formatFindings({
      configHash: "abcd1234",
      files: { "a.md": { violations: [{ rule: "legalese", line: 1, detail: "one\r\ntwo\rthree\nfour | five" }] } },
      totals: { legalese: 1 },
      skipped: [],
    });
    expect(output.split("\n")[2]).toBe("| `a.md` | 1 | legalese | one two three four \\| five |");
  });

  test("the command prints a link destination and a file name without them, and the report keeps them", () => {
    const project = makeProject();
    try {
      const [escape, control, override] = UNREAD_CHARACTERS as [string, string, string];
      // Windows refuses an escape character in a file name and allows the other two.
      const name = `gu${override}ide${control}.md`;
      writeFileSync(join(project, name), `Use [here](https://x.invalid/${escape}[2J${control}).\n`);
      const report = join(project, "report.json");
      const output = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", project, "--project-dir", project, "--json", report],
        output.writeOut,
        output.writeErr,
      )).toBe(0);
      const printed = output.stdout.join("\n");
      for (const character of UNREAD_CHARACTERS) {
        expect(printed).not.toContain(character);
      }
      const slash = String.fromCharCode(92);
      expect(printed).toContain(
        "| " + String.fromCharCode(96) + `gu${slash}u202eide${slash}u009b.md` + String.fromCharCode(96)
          + ' | 1 | link-text | link text "here" describes no destination (https://x.invalid/ [2J ) |',
      );
      // The JSON report is data for another program, so it holds what was found.
      const saved = JSON.parse(readFileSync(report, "utf8")) as { files: Record<string, { violations: Array<{ detail: string }> }> };
      expect(Object.keys(saved.files)).toEqual([name]);
      expect(saved.files[name]?.violations[0]?.detail).toContain(`${escape}[2J${control}`);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("options and arguments that are not plain", () => {
  // A spread copies only an object's own enumerable properties, so reading the
  // option that way lost one that was inherited or not enumerable.
  test("frontMatter set to false is read however the object carries it", () => {
    class ReadingOptions {
      get frontMatter(): boolean {
        return false;
      }
    }
    const hidden = Object.defineProperty({}, "frontMatter", { value: false, enumerable: false });
    const project = makeProject();
    try {
      const file = join(project, "policy.md");
      writeFileSync(file, "");
      const findings = findingsWithOptions(file, project);
      const asText = ["heading-style at line 2", "legalese at line 2"];
      expect(findings({ frontMatter: false })).toEqual(asText);
      expect(findings(new ReadingOptions()), "a getter on a class").toEqual(asText);
      expect(findings(Object.create({ frontMatter: false })), "an inherited property").toEqual(asText);
      expect(findings(hidden), "a property that is not enumerable").toEqual(asText);
      expect(findings({})).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // Stopping at a hole ended the options early, so the command ran and exited 0
  // with an option it would have refused still unread.
  test("a hole in the argument list is refused, and so is what follows it", () => {
    const project = makeProject();
    try {
      const file = join(project, "note.md");
      writeFileSync(file, "Plain words.\n");
      const holed: string[] = ["bun", "audit-text-cli.ts", file];
      holed.length = 4;
      const trailing = [...holed];
      trailing.length = 4;
      holed.push("--unknown");
      for (const argv of [holed, trailing]) {
        const output = capture();
        expect(runCli(argv, output.writeOut, output.writeErr)).toBe(2);
        expect(output.stderr).toEqual(["audit-text: argument 2 is missing; expected --json, --project-dir, --no-front-matter, --before or --author-text"]);
        expect(output.stdout).toEqual([]);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

/**
 * A reader of files that fails on one of them, as a file does that becomes
 * unreadable after the walk has listed it.
 *
 * @returns The reader. It throws an `Error` for the blocked path, and gives
 *     the text of any other.
 */
function readerFailingOn(blocked: string): (path: string) => string {
  return (path: string): string => {
    if (path === blocked) throw new Error("file became unreadable");
    return readFileSync(path, "utf8");
  };
}

/** The text of a file whose front matter holds a legal sentence. */
function readLegalFrontMatter(): string {
  return "---\npolicy: We shall comply.\n---\n";
}

/**
 * An audit of one file under the reading options it is given.
 *
 * @returns A function that gives each finding as "rule at line n", sorted.
 */
function findingsWithOptions(file: string, project: string): (reading: object) => string[] {
  return (reading: object): string[] => Object.values(auditTarget(file, project, readLegalFrontMatter, reading).files)
    .flatMap((result) => result.violations.map((violation) => `${violation.rule} at line ${violation.line}`)).sort();
}

describe("the two-version comparison, given --before", () => {
  test("prints the comparison after the findings and before the reading, and the report holds it before the reading", () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, "old.md"), "# Guide\n\nClose the valve. Open the vent.\n");
      writeFileSync(join(project, "new.md"), "# Guide\n\n- Close the valve.\n- Check the gauge.\n");
      const json = join(project, "report.json");
      const output = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", join(project, "new.md"), "--before", join(project, "old.md"), "--project-dir", project, "--json", json],
        output.writeOut,
        output.writeErr,
      )).toBe(0);
      expect(output.stderr).toEqual([]);
      expect(output.stdout).toHaveLength(3);
      expect(output.stdout[0]).toStartWith("| File | Line | Rule | Finding |");
      expect(output.stdout[1]?.split("\n")).toEqual([
        "Restructure comparison: before `old.md`, after `new.md`",
        "| Kind | Before | After | Finding |",
        "|------|--------|-------|---------|",
        "| dropped | 3 | | No unchanged copy is in the new version: \"Open the vent.\" |",
        "| added | | 4 | Not in the original or the author's wording. Confirm its source: \"Check the gauge.\" |",
        "Kept 2: moved 0, steps out of order 0. Dropped 1. Added 1. From the author 0. Marked gaps 0. New headings 0. Headings gone 0. New labels 0. Labels gone 0.",
        "The comparison reads wording, not meaning.",
        "It does not yet pair a reworded unit with its original, or check that each number and code span is still there.",
      ]);
      expect(output.stdout[2]).toStartWith("Part 5 checklist reading: ");
      const report = JSON.parse(readFileSync(json, "utf8")) as Record<string, unknown>;
      expect(Object.keys(report).slice(-2)).toEqual(["restructure", "checklist"]);
      expect(report.restructure).toEqual({
        before: "old.md", after: "new.md", authorText: null,
        units: { before: 3, after: 3, authorText: 0 }, kept: 2, moved: [], stepOrder: [],
        dropped: [{ line: 3, kind: "sentence", excerpt: "Open the vent." }],
        added: [{ line: 4, kind: "item", excerpt: "Check the gauge." }],
        fromAuthor: [], gaps: [], newHeadings: [], headingsGone: [], newLabels: [], labelsGone: [],
      });
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("counts a new heading of two sentences once, in the printed line and the report", () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, "old.md"), "# Old\n\nKeep this text.\n");
      writeFileSync(join(project, "new.md"), "# Old\n\n# One. Two.\n\nKeep this text.\n");
      const json = join(project, "report.json");
      const output = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", join(project, "new.md"), "--before", join(project, "old.md"), "--project-dir", project, "--json", json],
        output.writeOut,
        output.writeErr,
      )).toBe(0);
      expect(output.stdout.join("\n")).toContain("Kept 2: moved 0, steps out of order 0. Dropped 0. Added 0. From the author 0. Marked gaps 0. New headings 1. Headings gone 0.");
      const report = JSON.parse(readFileSync(json, "utf8")) as { restructure: { newHeadings: unknown[] } };
      expect(report.restructure.newHeadings).toEqual([{ line: 3, kind: "heading", excerpt: "One. Two." }]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("names the author's wording and counts what came from it", () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, "old.md"), "Close the valve.\n");
      writeFileSync(join(project, "new.md"), "Close the valve.\n\nReaders are fitters.\n");
      writeFileSync(join(project, "notes.txt"), "Readers are fitters.\n");
      const output = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", join(project, "new.md"), "--author-text", join(project, "notes.txt"), "--before", join(project, "old.md"), "--project-dir", project],
        output.writeOut,
        output.writeErr,
      )).toBe(0);
      const lines = output.stdout[1]?.split("\n") ?? [];
      expect([lines[0], lines[3], lines[4]]).toEqual([
        "Restructure comparison: before `old.md`, after `new.md`, author's wording `notes.txt`",
        "| from the author | | 3 | Matches the author's wording: \"Readers are fitters.\" |",
        "Kept 1: moved 0, steps out of order 0. Dropped 0. Added 0. From the author 1. Marked gaps 0. New headings 0. Headings gone 0. New labels 0. Labels gone 0.",
      ]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("reads front matter as text in every version with --no-front-matter", () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, "old.md"), "---\ntitle: Old title.\n---\n\nBody.\n");
      writeFileSync(join(project, "new.md"), "---\ntitle: New title.\n---\n\nBody.\n");
      const set = capture();
      expect(runCli(["bun", "audit-text-cli.ts", join(project, "new.md"), "--before", join(project, "old.md")], set.writeOut, set.writeErr)).toBe(0);
      expect(set.stdout[1]).toContain("Kept 1: moved 0, steps out of order 0. Dropped 0. Added 0.");
      const text = capture();
      expect(runCli(["bun", "audit-text-cli.ts", join(project, "new.md"), "--before", join(project, "old.md"), "--no-front-matter"], text.writeOut, text.writeErr)).toBe(0);
      // Read as text, the block's line above its closing "---" is a heading, so the change is counted.
      expect(text.stdout[1]).toContain("Kept 1: moved 0, steps out of order 0. Dropped 0. Added 0. From the author 0. Marked gaps 0. New headings 1. Headings gone 1.");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("prints and reports a kept unit moved and a step out of order", () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, "old.md"), "1. Close the valve.\n2. Open the vent.\n\nFit the seal. Check the lip. This keeps water out.\n");
      writeFileSync(join(project, "new.md"), "1. Open the vent.\n2. Close the valve.\n\nThis keeps water out. Fit the seal. Check the lip.\n");
      const json = join(project, "report.json");
      const output = capture();
      expect(runCli(["bun", "audit-text-cli.ts", join(project, "new.md"), "--before", join(project, "old.md"), "--json", json], output.writeOut, output.writeErr)).toBe(0);
      expect(output.stdout[1]?.split("\n").slice(3, 6)).toEqual([
        "| step order | 1 | 2 | A step of an ordered list now stands in another order against its neighbouring steps, so it is listed here and not as moved. Put it back, or confirm the steps can happen in this order: \"Close the valve.\" |",
        "| moved | 4 | 4 | Kept, but moved out of its original order. Check that it keeps what it depends on and the claim it qualifies: \"This keeps water out.\" It opens with \"This\". Check what \"This\" refers to in its new place. |",
        "Kept 5: moved 1, steps out of order 1. Dropped 0. Added 0. From the author 0. Marked gaps 0. New headings 0. Headings gone 0. New labels 0. Labels gone 0.",
      ]);
      const report = JSON.parse(readFileSync(json, "utf8")) as { restructure: { moved: unknown; stepOrder: unknown } };
      expect(report.restructure.moved).toEqual([{ before: 4, after: 4, kind: "sentence", excerpt: "This keeps water out.", run: 1, opensWith: "This" }]);
      expect(report.restructure.stepOrder).toEqual([{ before: 1, after: 2, kind: "item", excerpt: "Close the valve.", run: 1, opensWith: null }]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("a directory target, --author-text alone and a missing file name are refused with exit 2, before anything is printed", () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, "old.md"), "Text.\n");
      writeFileSync(join(project, "new.md"), "Text.\n");
      const refusals: Array<[string[], string]> = [
        [[project, "--before", join(project, "old.md")], "audit-text: --before compares one file, and the selected path is a directory"],
        [[join(project, "new.md"), "--author-text", join(project, "old.md")], "audit-text: --author-text needs --before"],
        [[join(project, "new.md"), "--before"], "audit-text: --before requires a file"],
        [[join(project, "new.md"), "--before", "--json", "x.json"], "audit-text: --before requires a file"],
        [[join(project, "new.md"), "--before", join(project, "old.md"), "--author-text"], "audit-text: --author-text requires a file"],
        [[join(project, "new.md"), "--before", "a.md", "--before", "b.md"], "audit-text: --before appears more than once"],
      ];
      for (const [args, message] of refusals) {
        const output = capture();
        expect(runCli(["bun", "audit-text-cli.ts", ...args], output.writeOut, output.writeErr), message).toBe(2);
        expect(output.stderr).toEqual([message]);
        expect(output.stdout).toEqual([]);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("a symbolic link is refused for the selected file, --before and --author-text, with the path given by its length", () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, "old.md"), "Text.\n");
      writeFileSync(join(project, "new.md"), "Text.\n");
      mkdirSync(join(project, "real"));
      // A junction needs no privilege on Windows, and is a symbolic link elsewhere.
      const link = join(project, "link.md");
      symlinkSync(join(project, "real"), link, "junction");
      const cases: Array<[string[], string]> = [
        [[link, "--before", join(project, "old.md")], `audit-text: <file-or-directory> names a path of ${link.length} characters that is a symbolic link, which the comparison does not follow`],
        [[join(project, "new.md"), "--before", link], `audit-text: --before names a path of ${link.length} characters that is a symbolic link, which the comparison does not follow`],
        [[join(project, "new.md"), "--before", join(project, "old.md"), "--author-text", link], `audit-text: --author-text names a path of ${link.length} characters that is a symbolic link, which the comparison does not follow`],
      ];
      for (const [args, message] of cases) {
        const output = capture();
        expect(runCli(["bun", "audit-text-cli.ts", ...args], output.writeOut, output.writeErr), message).toBe(1);
        expect(output.stderr).toEqual([message]);
        expect(output.stdout).toEqual([]);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("a path that runs through a linked directory is refused in every position, and nothing is printed or written", () => {
    const project = makeProject();
    try {
      const outside = join(project, "outside");
      mkdirSync(outside);
      writeFileSync(join(outside, "secret.md"), "Secret outside selected tree.\n");
      mkdirSync(join(project, "selected"));
      // A junction needs no privilege on Windows, and is a symbolic link elsewhere.
      symlinkSync(outside, join(project, "selected", "linked"), "junction");
      const through = join(project, "selected", "linked", "secret.md");
      writeFileSync(join(project, "old.md"), "Text.\n");
      writeFileSync(join(project, "new.md"), "Text.\n");
      const cases: Array<[string[], string]> = [
        [[through, "--before", join(project, "old.md")], linkedDirectoryRefusal("<file-or-directory>", through)],
        [[join(project, "new.md"), "--before", through], linkedDirectoryRefusal("--before", through)],
        [[join(project, "new.md"), "--before", join(project, "old.md"), "--author-text", through], linkedDirectoryRefusal("--author-text", through)],
        // A relative path is resolved first, so its link is found the same way.
        [[join(project, "new.md"), "--before", join("selected", "linked", "..", "linked", "secret.md")], ""],
      ];
      const previous = process.cwd();
      process.chdir(project);
      try {
        for (const [index, [args, message]] of cases.entries()) {
          const json = join(project, `report-${index}.json`);
          const output = capture();
          expect(runCli(["bun", "audit-text-cli.ts", ...args, "--project-dir", project, "--json", json], output.writeOut, output.writeErr), args.join(" ")).toBe(1);
          if (message !== "") expect(output.stderr).toEqual([message]);
          expect(output.stderr.join("\n")).toContain("runs through a symbolic link");
          expect(output.stdout).toEqual([]);
          expect(existsSync(json)).toBe(false);
          expect(output.stderr.join("\n")).not.toContain("Secret");
        }
      } finally {
        process.chdir(previous);
      }
      // The same file by its real path is read, so the refusal is the link's doing.
      const control = capture();
      expect(runCli(["bun", "audit-text-cli.ts", join(project, "new.md"), "--before", join(outside, "secret.md"), "--project-dir", project], control.writeOut, control.writeErr)).toBe(0);
      expect(control.stdout.join("\n")).toContain("Secret outside selected tree.");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("the file read is the file whose path was checked, even when a link and a parent step meet on the path", () => {
    const project = makeProject();
    try {
      mkdirSync(join(project, "outside"));
      mkdirSync(join(project, "selected"));
      symlinkSync(join(project, "outside"), join(project, "selected", "linked"), "junction");
      writeFileSync(join(project, "selected", "x.md"), "Inside the selected tree.\n");
      writeFileSync(join(project, "x.md"), "At the project root.\n");
      writeFileSync(join(project, "new.md"), "Text.\n");
      // The path is typed with the link and the step up kept in it: `join` would take them out,
      // and the audit would never see them. Made absolute, the path is selected/x.md, which holds
      // no link. On Linux the system would follow the link and then step up, reaching the root's
      // x.md, a file the check never saw. Windows takes the step up before the link, so this
      // tells the two apart only on Linux.
      const typed = [project, "selected", "linked", "..", "x.md"].join(sep);
      expect(typed).toContain(`${sep}linked${sep}..${sep}x.md`);
      const output = capture();
      expect(runCli(["bun", "audit-text-cli.ts", join(project, "new.md"), "--before", typed, "--project-dir", project], output.writeOut, output.writeErr)).toBe(0);
      const printed = output.stdout.join("\n");
      expect(printed).toContain("Inside the selected tree.");
      expect(printed).not.toContain("At the project root.");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("a missing or unsupported --before or --author-text file is refused with exit 1", () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, "new.md"), "Text.\n");
      writeFileSync(join(project, "old.rst"), "Text.\n");
      const missing = join(project, "missing.md");
      const unsupported = join(project, "old.rst");
      const cases: Array<[string[], string]> = [
        [["--before", missing], `audit-text: --before names a path of ${missing.length} characters that cannot be read: no such file or directory`],
        [["--before", unsupported], `audit-text: --before names a path of ${unsupported.length} characters with another ending; select a file ending in .md, .markdown or .txt`],
        [["--before", join(project, "new.md"), "--author-text", missing], `audit-text: --author-text names a path of ${missing.length} characters that cannot be read: no such file or directory`],
        [["--before", join(project, "new.md"), "--author-text", project], `audit-text: --author-text names a path of ${project.length} characters with another ending; select a file ending in .md, .markdown or .txt`],
      ];
      for (const [args, message] of cases) {
        const output = capture();
        expect(runCli(["bun", "audit-text-cli.ts", join(project, "new.md"), ...args], output.writeOut, output.writeErr), message).toBe(1);
        expect(output.stderr).toEqual([message]);
        expect(output.stdout).toEqual([]);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("an unsupported selected file is still refused as one", () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, "new.rst"), "Text.\n");
      writeFileSync(join(project, "old.md"), "Text.\n");
      const output = capture();
      expect(runCli(["bun", "audit-text-cli.ts", join(project, "new.rst"), "--before", join(project, "old.md")], output.writeOut, output.writeErr)).toBe(1);
      expect(output.stderr[0]).toStartWith("audit-text: Select a file ending in .md, .markdown or .txt");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("every Jev option beside --before or --author-text exits 2 and sends nothing", async () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, "old.md"), "# Guide\n\nText.\n");
      writeFileSync(join(project, "new.md"), "# Guide\n\nText.\n");
      const jevOptions = [["--jev"], ["--jev-preview"], ["--send"], ["--yes"], ["--include-judged-text"], ["--jev", "--send", "--yes"]];
      for (const comparisonOption of ["--before", "--author-text"]) {
        for (const options of jevOptions) {
          const requests: string[] = [];
          const output = capture();
          const exit = await runCli(
            ["bun", "audit-text-cli.ts", join(project, "new.md"), ...options, comparisonOption, join(project, "old.md")],
            output.writeOut,
            output.writeErr,
            { env: { TYPESAFE_API_KEY: "stand-in-key" }, client: { fetch: recordingFetch(requests) } },
          );
          expect(exit, `${options.join(" ")} ${comparisonOption}`).toBe(2);
          expect(requests).toEqual([]);
        }
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

/** A stand-in for the transport that records each address asked for, and answers nothing useful. */
function recordingFetch(requests: string[]): (url: string) => Promise<Response> {
  return async (url: string): Promise<Response> => {
    requests.push(url);
    return Response.json({});
  };
}
