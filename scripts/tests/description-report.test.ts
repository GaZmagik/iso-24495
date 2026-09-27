import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReport, runCli } from "../description-report.ts";

// The audit runs from the repository root, and names each file it read by its
// path from there. These tests use a made-up root, so no file needs to exist.
const ROOT = join(tmpdir(), "iso-24495-root");
const DESCRIPTION = join(ROOT, "tmp", "description.md");

/** A report as the audit writes it, with the description's entry and nothing skipped. */
function report(files: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ configHash: "x", files, totals: {}, skipped: [], ...extra }, null, 2);
}

describe("checkReport", () => {
  test("a report naming the description, and nothing else, is sound", () => {
    expect(checkReport(report({ "tmp/description.md": { violations: [] } }), DESCRIPTION, ROOT))
      .toEqual({ ok: true, findings: 0 });
    const two = [{ rule: "legalese", line: 1, detail: "x" }, { rule: "doublet", line: 2, detail: "y" }];
    expect(checkReport(report({ "tmp/description.md": { violations: two } }), DESCRIPTION, ROOT))
      .toEqual({ ok: true, findings: 2 });
  });

  // A search for the text "violations": failed this JSON and passed the
  // invalid report below it, so the report is parsed rather than searched.
  test("the report's spacing does not matter, because it is parsed", () => {
    const spaced = "{ \"files\" : { \"tmp/description.md\" : { \"violations\" : [] } }, \"skipped\" : [] }";
    expect(checkReport(spaced, DESCRIPTION, ROOT)).toEqual({ ok: true, findings: 0 });
  });

  test("a report that is not valid JSON, or not an object, is refused", () => {
    expect(checkReport("\"violations\":", DESCRIPTION, ROOT))
      .toEqual({ ok: false, reason: "the report is not valid JSON" });
    expect(checkReport("", DESCRIPTION, ROOT))
      .toEqual({ ok: false, reason: "the report is not valid JSON" });
    for (const value of ["null", "[]", "3", "\"text\""]) {
      expect(checkReport(value, DESCRIPTION, ROOT), value)
        .toEqual({ ok: false, reason: "the report is not a JSON object" });
    }
  });

  test("a report that names another file, or more than one, is refused", () => {
    expect(checkReport(report({ "tmp/other.md": { violations: [] } }), DESCRIPTION, ROOT))
      .toEqual({ ok: false, reason: "the report names tmp/other.md, not the description" });
    const both = report({
      "tmp/description.md": { violations: [] },
      "tmp/other.md": { violations: [] },
    });
    expect(checkReport(both, DESCRIPTION, ROOT))
      .toEqual({ ok: false, reason: "the report names 2 files, not the description alone" });
  });

  // The audit skips a symbolic link rather than following it. A report could
  // then hold no file entry, and a violations list at the top level, which the
  // text search took for a file that had been read.
  test("a report that read nothing, or skipped anything, is refused", () => {
    const skippedOnly = report({}, { skipped: [DESCRIPTION], violations: [] });
    expect(checkReport(skippedOnly, DESCRIPTION, ROOT))
      .toEqual({ ok: false, reason: "the report names 0 files, not the description alone" });
    const readAndSkipped = report({ "tmp/description.md": { violations: [] } }, { skipped: ["x"] });
    expect(checkReport(readAndSkipped, DESCRIPTION, ROOT))
      .toEqual({ ok: false, reason: "the report skipped 1 entry" });
    const noSkippedList = JSON.stringify({ files: { "tmp/description.md": { violations: [] } } });
    expect(checkReport(noSkippedList, DESCRIPTION, ROOT))
      .toEqual({ ok: false, reason: "the report has no list of skipped entries" });
  });

  test("a report without a files object, or without a violations list, is refused", () => {
    for (const files of [undefined, null, [], "tmp/description.md"]) {
      expect(checkReport(JSON.stringify({ files, skipped: [] }), DESCRIPTION, ROOT), String(files))
        .toEqual({ ok: false, reason: "the report has no files object" });
    }
    for (const entry of [{}, { violations: {} }, null, "x"]) {
      expect(checkReport(report({ "tmp/description.md": entry }), DESCRIPTION, ROOT),
        JSON.stringify(entry))
        .toEqual({ ok: false, reason: "the description's entry has no violations list" });
    }
  });
});

describe("runCli", () => {
  /** Runs the command over one report, and returns its exit code and output. */
  function run(text: string | null): { status: number; out: string[]; err: string[] } {
    const directory = mkdtempSync(join(tmpdir(), "iso-24495-report-"));
    try {
      const path = join(directory, "report.json");
      if (text !== null) writeFileSync(path, text, "utf8");
      const out: string[] = [];
      const err: string[] = [];
      const status = runCli(["bun", "description-report-cli.ts", path, DESCRIPTION], ROOT,
        (line) => out.push(line), (line) => err.push(line));
      return { status, out, err };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  test("a sound report prints its finding count and exits 0", () => {
    const one = report({ "tmp/description.md": { violations: [{ rule: "legalese" }] } });
    expect(run(one)).toEqual({ status: 0, out: ["1"], err: [] });
  });

  test("a refused or unreadable report says why and exits 1", () => {
    expect(run("{")).toEqual({
      status: 1,
      out: [],
      err: ["description report: the report is not valid JSON."],
    });
    expect(run(null)).toEqual({
      status: 1,
      out: [],
      err: ["description report: the report cannot be read."],
    });
  });

  test("missing arguments are a usage error", () => {
    const err: string[] = [];
    expect(runCli(["bun", "description-report-cli.ts", "report.json"], ROOT, () => {},
      (line) => err.push(line))).toBe(2);
    expect(err[0]).toStartWith("Usage:");
  });
});
