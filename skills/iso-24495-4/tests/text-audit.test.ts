import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditTarget,
  formatFindings,
  runCli,
} from "../../iso-24495-text-audit/scripts/audit-text.ts";

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "iso-text-audit-"));
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

      const readText = (path: string): string => {
        if (path === blocked) throw new Error("file became unreadable");
        return readFileSync(path, "utf8");
      };
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
          + "expected --json, --project-dir or --no-front-matter",
      ]);

      const extra = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", "policy.md", "--no-front-matter", "extra.md"],
        extra.writeOut,
        extra.writeErr,
      )).toBe(2);
      expect(extra.stderr).toEqual([
        "audit-text: unexpected argument of 8 characters at argument 3; "
          + "expected --json, --project-dir or --no-front-matter",
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
      for (const character of UNREAD_CHARACTERS) expect(printed).not.toContain(character);
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
    class ReadingOptions { get frontMatter(): boolean { return false; } }
    const hidden = Object.defineProperty({}, "frontMatter", { value: false, enumerable: false });
    const project = makeProject();
    try {
      const file = join(project, "policy.md");
      writeFileSync(file, "");
      const read = (): string => "---\npolicy: We shall comply.\n---\n";
      const findings = (reading: object): string[] => Object.values(auditTarget(file, project, read, reading).files)
        .flatMap((result) => result.violations.map((violation) => `${violation.rule} at line ${violation.line}`)).sort();
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
        expect(output.stderr).toEqual(["audit-text: argument 2 is missing; expected --json, --project-dir or --no-front-matter"]);
        expect(output.stdout).toEqual([]);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
