// The three commands that read a project's documents honour
// `.iso-24495-4/document-facts.json`, and each echoes every declaration it
// honoured with what it changed. Nothing of the file reaches a Jev request.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli as runCorpusCli } from "../scripts/audit-corpus.ts";
import { runCli as runTextCli } from "../../iso-24495-text-audit/scripts/audit-text.ts";
import { runCli as runDesignCli } from "../../iso-24495-design-audit/scripts/design-audit.ts";
import { selectDocuments, formatPlan } from "../scripts/lib/jev/audit.ts";
import { readDocumentFacts } from "../scripts/lib/document-facts.ts";

/** Two numbered sections that nothing cites, so the numbering rule asks its question. */
const UNCITED = "# Guide\n\nIntro.\n\n## 1. Install\n\nText.\n\n## 2. Run\n\nText.\n";

/** The echo a project gives when it declares a.md cited and b.md not cited, and reads c.md too. */
const ECHO = [
  "Declared facts (.iso-24495-4/document-facts.json)",
  "| File | Fact | Value | Effect |",
  "|------|------|-------|--------|",
  "| `a.md` | headingNumbers | cited | 1 uncited-numbering question was not raised. |",
  "| `b.md` | headingNumbers | not-cited | 1 uncited-numbering question was reported as a finding. |",
  "Not declared: headingNumbers for 1 of 3 Markdown files read.",
  "Problem: The key `readerKnows` for `a.md` is not understood and is not honoured.",
  "Problem: 1 declaration names a file this run did not read, so it changed nothing.",
].join("\n");

/** A project of three uncited documents and a facts file that declares two of them. */
function project(): string {
  const directory = mkdtempSync(join(tmpdir(), "iso-declared-"));
  for (const name of ["a.md", "b.md", "c.md"]) {
    writeFileSync(join(directory, name), UNCITED);
  }
  mkdirSync(join(directory, ".iso-24495-4"));
  writeFileSync(join(directory, ".iso-24495-4", "document-facts.json"), JSON.stringify({
    version: 1,
    documents: { "a.md": { headingNumbers: "cited", readerKnows: ["SLA"] }, "b.md": { headingNumbers: "not-cited" }, "gone.md": { headingNumbers: "cited" } },
  }));
  return directory;
}

/** The uncited-numbering findings of each file in a report's findings, by file. */
function numbering(files: Record<string, { violations: Array<{ rule: string; detail: string }> }>): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const [file, result] of Object.entries(files)) {
    found[file] = result.violations.filter(violation => violation.rule === "uncited-numbering").map(violation => violation.detail.split(" ").slice(-3).join(" "));
  }
  return found;
}

/** What each declaration leaves: a.md quiet, b.md a finding, c.md the question. */
const HONOURED = { "a.md": [], "b.md": ["Remove the numbers."], "c.md": ["headingNumbers in .iso-24495-4/document-facts.json."] };

/** Every finding but uncited-numbering, by file, as JSON. */
function others(files: Record<string, { violations: Array<{ rule: string }> }>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(files).map(([file, result]) => [file, result.violations.filter(violation => violation.rule !== "uncited-numbering")])));
}

describe("each command honours the facts file and echoes what it changed", () => {
  test("the text audit prints the echo after the findings and before the reading, and writes it under declared", () => {
    const directory = project();
    try {
      const out: string[] = [];
      const json = join(directory, "report.json");
      expect(runTextCli(["bun", "cli", directory, "--project-dir", directory, "--json", json], line => out.push(line), () => {})).toBe(0);
      expect(out).toHaveLength(3);
      expect(out[1]).toBe(ECHO);
      expect(out[2]).toStartWith("Part 5 checklist reading:");
      const report = JSON.parse(readFileSync(json, "utf8"));
      expect(Object.keys(report).slice(-2)).toEqual(["declared", "checklist"]);
      expect(numbering(report.files)).toEqual(HONOURED);
      expect(report.declared.source).toBe(".iso-24495-4/document-facts.json");
      expect(report.declared.files).toEqual([{ file: "a.md", headingNumbers: "cited" }, { file: "b.md", headingNumbers: "not-cited" }]);
      expect(report.declared.problems).toHaveLength(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the corpus audit prints the echo after the total, and writes it under declared", () => {
    const directory = project();
    try {
      const out: string[] = [];
      const json = join(directory, "..", `${directory.split(/[\\/]/).at(-1)}-corpus.json`);
      expect(runCorpusCli(["bun", "cli", directory, "--json", json], line => out.push(line), () => {})).toBe(0);
      expect(out.at(-1)).toBe(ECHO);
      expect(out.at(-2)).toStartWith("\nTotal: ");
      const report = JSON.parse(readFileSync(json, "utf8"));
      rmSync(json, { force: true });
      expect(numbering(report.files)).toEqual(HONOURED);
      expect(Object.keys(report).at(-1)).toBe("declared");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the design audit prints the echo after the mechanical findings and before the reading, and writes it under declared", async () => {
    const directory = project();
    try {
      const out: string[] = [];
      const json = join(directory, "report.json");
      expect(await runDesignCli(["bun", "cli", directory, "--project-dir", directory, "--json", json], line => out.push(line), () => {}, { env: {} })).toBe(0);
      expect(out[0]).toStartWith("Mechanical findings");
      expect(out[1]).toBe(ECHO);
      expect(out[2]).toStartWith("Part 5 checklist reading:");
      const report = JSON.parse(readFileSync(json, "utf8"));
      expect(numbering(report.mechanical.files)).toEqual(HONOURED);
      expect(Object.keys(report).slice(-2)).toEqual(["declared", "checklist"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("no other finding changes, and the plan and its disclosure are the same, with the file or without it", () => {
    const directory = project();
    try {
      const facts = readDocumentFacts(directory);
      const withFacts = selectDocuments(directory, directory, "design", undefined, true, facts);
      const without = selectDocuments(directory, directory);
      expect(others(withFacts.mechanical.files)).toBe(others(without.mechanical.files));
      expect(formatPlan(withFacts)).toBe(formatPlan(without));
      expect(JSON.stringify(withFacts.documents)).toBe(JSON.stringify(without.documents));
      expect(numbering(without.mechanical.files)).toEqual({ "a.md": ["headingNumbers in .iso-24495-4/document-facts.json."], "b.md": ["headingNumbers in .iso-24495-4/document-facts.json."], "c.md": ["headingNumbers in .iso-24495-4/document-facts.json."] });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("without a facts file no command prints anything about one", () => {
    const directory = mkdtempSync(join(tmpdir(), "iso-declared-"));
    try {
      writeFileSync(join(directory, "a.md"), UNCITED);
      const out: string[] = [];
      expect(runTextCli(["bun", "cli", directory, "--project-dir", directory], line => out.push(line), () => {})).toBe(0);
      expect(out).toHaveLength(2);
      expect(out.join("\n")).not.toContain("Declared facts");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
