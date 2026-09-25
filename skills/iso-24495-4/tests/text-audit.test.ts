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
      expect(result.files["docs/policy.txt"].violations.map((item) => item.rule)).toEqual([
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
      expect(() => auditTarget(file, project)).toThrow("supported text file");
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
      "| docs/policy\\|draft.md | 2 | legalese | Replace shall \\| use must. |",
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
      expect(unknown.stderr[0]).toContain("unknown option");

      const extra = capture();
      expect(runCli(
        ["bun", "audit-text-cli.ts", "policy.md", "extra.md"],
        extra.writeOut,
        extra.writeErr,
      )).toBe(2);
      expect(extra.stderr[0]).toContain("unexpected argument");

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
      expect(output.stdout.join("\n")).toContain("| policy.md | 1 | legalese |");
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
