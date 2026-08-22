/**
 * Hold the rerun manifest, and its reader, to what the article's test row depends on.
 *
 * That row said "10 of 10" because two scripts parsed a saved console log for `N pass`. A reviewer
 * defeated that twice, then defeated its replacement: the manifest recorded a verdict and a run
 * name, so replacing an implementation after the rerun left a valid PASS behind.
 *
 * Every line now carries the SHA-256 of the file the verdict was reached against, and the reader
 * refuses a verdict whose file no longer hashes to it. These tests hold both ends of that.
 */
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRerunResults } from "../rerun-results";

const MEASUREMENTS = join(import.meta.dir, "..");
const MANIFEST = join(MEASUREMENTS, "rerun-results.txt");
const IMPLEMENTATIONS = join(MEASUREMENTS, "implementations");
const REAL = join(IMPLEMENTATIONS, "claude", "control-1", "evaluate.ts");

const sha256 = (path: string): string =>
  new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

/**
 * Build a manifest and a matching tree in a temporary place, so no fixture touches the published
 * evidence. Returns a reader over them.
 */
function withFixture(lines: string, source: string = REAL, expected = 1) {
  const directory = mkdtempSync(join(tmpdir(), "iso-manifest-"));
  try {
    const runDirectory = join(directory, "impl", "claude", "control-1");
    mkdirSync(runDirectory, { recursive: true });
    copyFileSync(source, join(runDirectory, "evaluate.ts"));
    const manifest = join(directory, "rerun-results.txt");
    writeFileSync(manifest, lines);
    return readRerunResults(manifest, join(directory, "impl"), expected);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("the committed rerun manifest", () => {
  test("covers all ninety published runs and records each as passing", () => {
    const results = readRerunResults();
    expect(results.size).toBe(90);
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

  test("every recorded digest matches the file it stands for", () => {
    // The whole point of the digest column. readRerunResults throws otherwise, so this asserts
    // the same property a second way, against the published tree rather than a fixture.
    for (const line of readFileSync(MANIFEST, "utf8").split("\n")) {
      const parts = line.trim().split(" ");
      if (parts.length !== 3) continue;
      const [, run, digest] = parts as [string, string, string];
      expect(sha256(join(IMPLEMENTATIONS, ...run.split("/"), "evaluate.ts")), run).toBe(digest);
    }
  });
});

describe("reading a manifest", () => {
  test("a verdict stands only for the bytes it was reached against", () => {
    // The reviewer's attack: replace the implementation, leave the manifest alone.
    const wrong = "0".repeat(64);
    expect(() => withFixture(`PASS claude/control-1 ${wrong}\n`))
      .toThrow(/has changed since it was tested/);
  });

  test("a matching digest is accepted", () => {
    const results = withFixture(`PASS claude/control-1 ${sha256(REAL)}\n`);
    expect(results.passed("claude/control-1")).toBe(true);
  });

  test("a run recorded as failing is not a passing run", () => {
    // A FAIL carries a digest too, and is not checked against the file: it failed either way.
    const results = withFixture(`FAIL claude/control-1 ${"0".repeat(64)}\n`);
    expect(results.passed("claude/control-1")).toBe(false);
    expect(results.known("claude/control-1")).toBe(true);
  });

  test("an incomplete manifest is refused, not quietly used", () => {
    // This was the third finding: one consumer checked the size and the other did not, so the
    // same manifest gave "exit 1, INCOMPLETE" in one report and "9/10" in the other.
    expect(() => withFixture(`PASS claude/control-1 ${sha256(REAL)}\n`, REAL, 2))
      .toThrow(/holds 1 runs, expected 2/);
  });

  test("a repeated run is refused rather than overwritten", () => {
    const digest = sha256(REAL);
    expect(() => withFixture(`PASS claude/control-1 ${digest}\nFAIL claude/control-1 ${digest}\n`, REAL, 2))
      .toThrow(/appears twice/);
  });

  test("a malformed line is refused rather than skipped", () => {
    expect(() => withFixture("PASS claude/control-1\n")).toThrow(/malformed line/);
    expect(() => withFixture("pass claude/control-1 abc\n")).toThrow(/malformed line/);
  });

  test("a passing run whose file has gone is refused", () => {
    expect(() => withFixture(`PASS claude/control-9 ${sha256(REAL)}\n`))
      .toThrow(/its file is missing/);
  });
});
