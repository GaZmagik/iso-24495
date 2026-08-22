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
const HARNESS = join(MEASUREMENTS, "task", "hidden-tests.ts");
const RUNNER = join(MEASUREMENTS, "rerun-tests.sh");

const sha256 = (path: string): string =>
  new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

/**
 * Build a manifest and a matching tree in a temporary place, so no fixture touches the published
 * evidence. Returns a reader over them.
 */
function withFixture(lines: string, source: string = REAL, expected = 1, header?: string) {
  const directory = mkdtempSync(join(tmpdir(), "iso-manifest-"));
  try {
    const runDirectory = join(directory, "impl", "claude", "control-1");
    mkdirSync(runDirectory, { recursive: true });
    copyFileSync(source, join(runDirectory, "evaluate.ts"));
    const manifest = join(directory, "rerun-results.txt");
    writeFileSync(manifest, (header ?? realHeader()) + lines);
    return readRerunResults(manifest, join(directory, "impl"), expected, HARNESS, RUNNER);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The header a manifest generated right now would carry. */
function realHeader(): string {
  return `# harness ${sha256(HARNESS)}\n# runner ${sha256(RUNNER)}\n# bun 1.3.14\n`;
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
    const lines = readFileSync(MANIFEST, "utf8").split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("# "));
    expect(lines.filter((line) => !line.startsWith("PASS "))).toEqual([]);
  });

  test("carries a procedure header naming the harness, runner and runtime", () => {
    // A verdict is about an implementation and the tests that judged it. Without this the
    // harness could change and every verdict would still stand.
    const lines = readFileSync(MANIFEST, "utf8").split("\n");
    expect(lines.filter((line) => /^# (harness|runner|bun) \S+$/.test(line)))
      .toHaveLength(3);
  });

  test("every recorded digest matches the file it stands for", () => {
    // The whole point of the digest column. readRerunResults throws otherwise, so this asserts
    // the same property a second way, against the published tree rather than a fixture.
    for (const line of readFileSync(MANIFEST, "utf8").split("\n")) {
      if (line.startsWith("# ")) continue;
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
    const results = withFixture(`FAIL claude/control-1 ${sha256(REAL)}\n`);
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

  test("a verdict does not survive the tests that judged it changing", () => {
    // The reviewer replaced hidden-tests.ts and every verdict still stood, because the manifest
    // bound the implementations and nothing else.
    const wrong = `# harness ${"0".repeat(64)}\n# runner ${sha256(RUNNER)}\n# bun 1.3.14\n`;
    expect(() => withFixture(`PASS claude/control-1 ${sha256(REAL)}\n`, REAL, 1, wrong))
      .toThrow(/the harness has changed/);
  });

  test("a verdict does not survive the runner changing", () => {
    const wrong = `# harness ${sha256(HARNESS)}\n# runner ${"0".repeat(64)}\n# bun 1.3.14\n`;
    expect(() => withFixture(`PASS claude/control-1 ${sha256(REAL)}\n`, REAL, 1, wrong))
      .toThrow(/the runner has changed/);
  });

  test("a manifest with no procedure header is refused", () => {
    expect(() => withFixture(`PASS claude/control-1 ${sha256(REAL)}\n`, REAL, 1, ""))
      .toThrow(/no harness hash recorded/);
  });

  test("a failing verdict is bound to its bytes too", () => {
    // A FAIL attached to unknown bytes says as little as a PASS attached to them.
    expect(() => withFixture(`FAIL claude/control-1 ${"0".repeat(64)}\n`))
      .toThrow(/has changed since it was tested/);
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
