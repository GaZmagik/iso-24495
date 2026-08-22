/**
 * Hold the saved-record reader to the forgery that defeated its predecessor.
 *
 * Each implementation directory keeps the output bun produced when the battery ran it. The
 * implementation was executing while bun wrote, so it could print bun's summary lines itself. A
 * reviewer proved that against the rerun script, and then found the same mechanism still present
 * in the two scripts that produce the article's table: both took the FIRST `N pass` they saw.
 *
 * The forged text below is the one the reviewer used, and it is preserved in
 * `rerun-predicate.test.ts` as an implementation. Here it is a saved record, which is the second
 * place it can do damage.
 */
import { describe, expect, test } from "bun:test";
import { recordShowsAllPassing } from "../tests-record";

const GENUINE = `bun test v1.3.14 (0d9b296a)

 25 pass
 0 fail
 30 expect() calls
Ran 25 tests across 1 file. [41.00ms]
`;

// What bun writes when an implementation prints the summary itself and then fails every test.
const FORGED = `bun test v1.3.14 (0d9b296a)

 25 pass
 0 fail
 0 pass
 25 fail
Ran 25 tests across 1 file. [39.00ms]
`;

describe("reading a saved test record", () => {
  test("a genuine record of 25 passing is accepted", () => {
    expect(recordShowsAllPassing(GENUINE)).toBe(true);
  });

  test("a record that also reports failures is refused", () => {
    // Taking the first match calls this a pass. Taking the last summary of each kind does not.
    expect(recordShowsAllPassing(FORGED)).toBe(false);
  });

  test("a record short of 25 passes is refused", () => {
    expect(recordShowsAllPassing(" 24 pass\n 0 fail\n")).toBe(false);
  });

  test("a record with no summary at all is refused", () => {
    // An empty file is not a pass. This is the same trap as an empty grep result.
    expect(recordShowsAllPassing("")).toBe(false);
    expect(recordShowsAllPassing("bun test v1.3.14\nsomething went wrong\n")).toBe(false);
  });

  test("a failure count is required, not merely a pass count", () => {
    expect(recordShowsAllPassing(" 25 pass\n")).toBe(false);
  });
});
