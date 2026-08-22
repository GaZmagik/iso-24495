/**
 * Attack the rerun script's verdict, using the script itself.
 *
 * The published implementations are model-generated code that `rerun-tests.sh` executes, so its
 * verdict must not rest on anything that code controls. Two false passes were demonstrated in
 * review, each against a version I had already published:
 *
 *   1. An implementation that prints bun's own summary lines while failing every test. The check
 *      read the printed text, and the exit status had been thrown away by piping bun into sed,
 *      because a pipeline reports its last command.
 *   2. An implementation that calls `process.exit(0)` while being imported. bun then exits 0
 *      before a single test runs, so the status check alone accepted it.
 *
 * Both were found by a reviewer and fixed by hand. Nothing in this repository stopped either from
 * returning, which is the gap this file closes. It drives `rerun-tests.sh --check-one` rather
 * than repeating its logic, because a test that reimplements the check proves only that the copy
 * agrees with itself.
 *
 * The third case matters as much as the two attacks. An earlier repair required an `errors="0"`
 * attribute that bun does not write, so it rejected every implementation including the real ones.
 * A predicate that fails everything catches every forgery and is useless.
 *
 * WHAT THESE TESTS CATCH, established by breaking the script and watching rather than by reading
 * it. Removing the junit checks fails them. Requiring an attribute bun never writes fails them,
 * which matters because a predicate that rejects everything catches every forgery and is useless.
 * Removing the exit-status check fails them too, which was NOT true of an earlier version: that
 * limit was recorded here and rechecked after the predicate changed, rather than left to rot.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MEASUREMENTS = join(import.meta.dir, "..");
const SCRIPT = join(MEASUREMENTS, "rerun-tests.sh");
const HARNESS = join(MEASUREMENTS, "task", "hidden-tests.ts");
const GENUINE = join(MEASUREMENTS, "implementations", "claude", "control-7", "evaluate.ts");

const PRINTS_ITS_OWN_SUMMARY = `console.log(" 25 pass");
console.log(" 0 fail");
export function evaluate(_expression: string): number {
  return -999;
}
`;

const EXITS_BEFORE_TESTING = `console.log(" 25 pass");
console.log(" 0 fail");
process.exit(0);
export function evaluate(_expression: string): number {
  return 0;
}
`;

/** Prepare one directory and ask the published script what it makes of it. */
function verdictFor(implementation: string | null): string {
  const directory = mkdtempSync(join(tmpdir(), "iso-rerun-"));
  try {
    if (implementation === null) {
      copyFileSync(GENUINE, join(directory, "evaluate.ts"));
    } else {
      writeFileSync(join(directory, "evaluate.ts"), implementation);
    }
    copyFileSync(HARNESS, join(directory, "hidden.test.ts"));
    const run = spawnSync("bash", [SCRIPT, "--check-one", directory], { encoding: "utf8" });
    return `${run.stdout ?? ""}`.trim().split("\n")[0] ?? "";
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const WRITES_ITS_OWN_REPORT = `import { writeFileSync } from "node:fs";

writeFileSync(
  "result.xml",
  '<testsuites tests="25" failures="0" skipped="0"></testsuites>',
);
process.exit(0);

export function evaluate(): number {
  return -999;
}
`;

describe("the rerun script's verdict", () => {
  test("a genuine implementation passes", () => {
    // Named first because a predicate that rejects everything would pass both attacks below.
    expect(verdictFor(null)).toBe("PASS");
  });

  test("an implementation that prints bun's summary does not pass", () => {
    expect(verdictFor(PRINTS_ITS_OWN_SUMMARY)).toStartWith("FAIL");
  });

  test("an implementation that writes the report itself does not pass", () => {
    // A reviewer's third forgery, and the one that broke the witness. The report used to be
    // written beside the implementation, so the implementation could write it and exit before
    // any test ran. It is now written outside that directory, removed first, and required to
    // hold 25 test cases rather than a summary claiming 25.
    expect(verdictFor(WRITES_ITS_OWN_REPORT)).toStartWith("FAIL");
  });

  test("an implementation that exits before the tests run does not pass", () => {
    expect(verdictFor(EXITS_BEFORE_TESTING)).toStartWith("FAIL");
  });

  test("no published implementation can reach the verdict this way", () => {
    // The attacks above are constructed. This asserts the published ninety carry nothing of the
    // kind, so the script's own statement about its trust boundary stays true.
    const hunt = spawnSync("git", [
      "grep", "-l", "-E", "process\\.(exit|abort)|exitCode|console\\.|Bun\\.(spawn|write)",
      "--", "measurements/implementations/*/*/evaluate.ts",
    ], { cwd: join(MEASUREMENTS, ".."), encoding: "utf8" });
    expect(`${hunt.stdout ?? ""}`.trim()).toBe("");
  });
});
