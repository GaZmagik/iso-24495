/**
 * Hold the rerun manifest and its reader to what the article's test row depends on.
 *
 * The row said "10 of 10" because two scripts parsed a saved console log for `N pass`. A reviewer
 * defeated that twice: once with an implementation that prints bun's summary itself, and again by
 * showing that reading the last summary does not help, because an implementation that exits during
 * import stops bun printing one at all.
 *
 * The manifest carries the verdict `rerun-tests.sh` reached from bun's exit status and its junit
 * report, neither of which the code under test can write. These tests hold the reader to it, and
 * hold the committed manifest to covering every published run.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRerunResults } from "../rerun-results";

const MANIFEST = join(import.meta.dir, "..", "rerun-results.txt");

/** Read a manifest written for one test, so the fixtures do not touch the published one. */
function readFixture(contents: string) {
  const directory = mkdtempSync(join(tmpdir(), "iso-manifest-"));
  try {
    const path = join(directory, "rerun-results.txt");
    writeFileSync(path, contents);
    return readRerunResults(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("the committed rerun manifest", () => {
  test("covers all ninety published runs", () => {
    const results = readRerunResults(MANIFEST);
    expect(results.size).toBe(90);
  });

  test("records every one of them as passing", () => {
    const results = readRerunResults(MANIFEST);
    for (const tool of ["claude", "codex", "gemini"]) {
      for (const arm of ["control", "style", "code"]) {
        for (let n = 1; n <= 10; n += 1) {
          expect(results.passed(`${tool}/${arm}-${n}`), `${tool}/${arm}-${n}`).toBe(true);
        }
      }
    }
  });

  test("holds nothing but PASS lines, so a failure cannot hide in it", () => {
    const lines = readFileSync(MANIFEST, "utf8").split("\n").filter((line) => line.trim() !== "");
    expect(lines.filter((line) => !line.startsWith("PASS "))).toEqual([]);
  });
});

describe("reading a manifest", () => {
  test("a run recorded as failing is not a passing run", () => {
    const results = readFixture("PASS claude/control-1\nFAIL claude/control-2\n");
    expect(results.passed("claude/control-1")).toBe(true);
    expect(results.passed("claude/control-2")).toBe(false);
  });

  test("a run missing from the manifest has not been shown to pass", () => {
    // The trap this whole file exists for: absence is not a pass.
    const results = readFixture("PASS claude/control-1\n");
    expect(results.known("claude/control-2")).toBe(false);
    expect(results.passed("claude/control-2")).toBe(false);
  });

  test("a run the rerun could not find is recorded rather than omitted", () => {
    const results = readFixture("MISSING claude/control-1\n");
    expect(results.known("claude/control-1")).toBe(true);
    expect(results.passed("claude/control-1")).toBe(false);
  });

  test("a malformed line is not read as a verdict", () => {
    const results = readFixture("PASS\nPASSED claude/control-1\npass claude/control-2\n");
    expect(results.size).toBe(0);
  });
});
