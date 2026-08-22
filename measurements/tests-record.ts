/**
 * Read a saved `tests.txt` without letting the code under test decide the answer.
 *
 * Each implementation directory holds the output bun produced when the battery ran it. That
 * output is not trustworthy on its face: the implementation is model-generated code that was
 * executing while bun wrote, so it could print bun's own summary lines itself. A reviewer
 * demonstrated exactly that against the rerun script, with a file that printed ` 25 pass` and
 * ` 0 fail` while failing all 25 tests. The forged output is preserved in
 * `tests/rerun-predicate.test.ts`:
 *
 *     25 pass
 *     0 fail
 *     0 pass
 *     25 fail
 *
 * Taking the first match calls that a pass. This takes the LAST summary of each kind, which is
 * bun's own, because bun writes its summary after the tests finish. It also requires the failure
 * count to be zero rather than only checking the passes, so a run that reports both is refused.
 *
 * This reports what the record says. The authoritative check is `rerun-tests.sh`, which executes
 * the tests again and reads bun's exit status and its junit report rather than any console text.
 */

const PASSES = /^\s*(\d+) pass\b/gm;
const FAILURES = /^\s*(\d+) fail\b/gm;

/** The last number matched by a global pattern, or null when it never matches. */
function lastCount(text: string, pattern: RegExp): number | null {
  const matches = [...text.matchAll(pattern)];
  const last = matches[matches.length - 1];
  return last === undefined ? null : Number(last[1]);
}

/** Did this saved record report all 25 tests passing and none failing? */
export function recordShowsAllPassing(text: string, expected = 25): boolean {
  const passed = lastCount(text, PASSES);
  const failed = lastCount(text, FAILURES);
  return passed === expected && failed === 0;
}
