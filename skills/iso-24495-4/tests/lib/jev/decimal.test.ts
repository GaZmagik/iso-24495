import { describe, expect, test } from "bun:test";
import {
  add, ceilToPlaces, compare, decimalText, maximum, minimum, ONE, parseDecimal, subtract, toNumber, ZERO, type Decimal,
} from "../../../scripts/lib/jev/decimal.ts";

const show = (value: Decimal) => `${value.units}e-${value.scale}`;

describe("reading a number token exactly as it is written", () => {
  test("keeps every digit, beyond what a double holds", () => {
    expect(show(parseDecimal("0.90000000000000001"))).toBe("90000000000000001e-17");
    expect(show(parseDecimal("0.1"))).toBe("1e-1");
    expect(show(parseDecimal("12"))).toBe("12e-0");
  });

  test("reads exponent notation in either case, and a sign", () => {
    expect(show(parseDecimal("1e-7"))).toBe("1e-7");
    expect(show(parseDecimal("1.5E-7"))).toBe("15e-8");
    expect(show(parseDecimal("2e+3"))).toBe("2000e-0");
    expect(show(parseDecimal("-0.25"))).toBe("-25e-2");
  });

  test("refuses anything that is not a JSON number", () => {
    // The token has just failed the check, so the message gives the form
    // expected and the length of what arrived, never the token.
    for (const token of ["", "0.", ".5", "1e", "01", "+1", "NaN", "0x10", "1 "]) {
      let message = "";
      try {
        parseDecimal(token);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, JSON.stringify(token)).toBe(
        `Expected a JSON number such as 0.25 or -1e3; got ${token.length} characters that are not one.`,
      );
    }
  });
});

/** How long one call takes, in milliseconds. */
function elapsed(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

/** What the call throws, or no text when it returns. */
function refusal(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

describe("refusing a number too large to hold cheaply", () => {
  // One call per size against a fixed budget. Before the bound, ten million as
  // an exponent cost about 600 ms: inside parseDecimal when positive, and in
  // the first comparison when negative. A refusal costs microseconds.
  const BUDGET_MS = 100;
  const TEST_TIMEOUT_MS = 60_000;

  test("refuses an exponent outside the bound before any arithmetic, whatever its sign", () => {
    for (const [token, digits] of [["1e1000000", 7], ["1e10000000", 8], ["1e-10000000", 8], ["-2.5E+10000000", 8]] as const) {
      let message = "";
      const took = elapsed(() => {
        message = refusal(() => parseDecimal(token));
      });
      expect(message, token).toBe(
        `Expected a JSON number with an exponent from -2000 to 2000; got an exponent of ${digits} digits.`,
      );
      expect(took, token).toBeLessThan(BUDGET_MS);
    }
  }, TEST_TIMEOUT_MS);

  test("refuses an exponent one past the bound and one too long to be a double", () => {
    for (const [token, digits] of [["1e2001", 4], ["1e-2001", 4], ["1e+02001", 5], [`1e${"9".repeat(400)}`, 400]] as const) {
      expect(refusal(() => parseDecimal(token)), `${token.length} characters`).toBe(
        `Expected a JSON number with an exponent from -2000 to 2000; got an exponent of ${digits} digits.`,
      );
    }
  });

  test("refuses a token longer than the bound, by its length alone", () => {
    const longest = `0.${"7".repeat(1_998)}`;
    expect(longest).toHaveLength(2_000);
    expect(parseDecimal(longest)).toEqual({ units: BigInt("7".repeat(1_998)), scale: 1_998 });
    for (const token of [`${longest}7`, `0.${"7".repeat(1_000_000)}`, `1e${"0".repeat(1_999)}`]) {
      let message = "";
      const took = elapsed(() => {
        message = refusal(() => parseDecimal(token));
      });
      expect(message, `${token.length} characters`).toBe(
        `Expected a JSON number of at most 2000 characters; got ${token.length}.`,
      );
      expect(took, `${token.length} characters`).toBeLessThan(BUDGET_MS);
    }
  }, TEST_TIMEOUT_MS);

  test("still reads a number at the bound, and arithmetic on it stays cheap", () => {
    expect(parseDecimal("1e2000")).toEqual({ units: 10n ** 2_000n, scale: 0 });
    expect(parseDecimal("1e-2000")).toEqual({ units: 1n, scale: 2_000 });
    expect(parseDecimal("1e400").units.toString()).toHaveLength(401);
    // The largest scale the bound admits: a fraction that fills the token, moved down again.
    const smallest = parseDecimal(`0.${"7".repeat(1_992)}e-2000`);
    expect(smallest.scale).toBe(3_992);
    const took = elapsed(() => {
      expect(compare(smallest, ZERO)).toBe(1);
      expect(compare(smallest, ONE)).toBe(-1);
      expect(compare(add(smallest, parseDecimal("9e2000")), ONE)).toBe(1);
      expect(decimalText(ceilToPlaces(smallest, 2))).toBe("0.01");
    });
    expect(took).toBeLessThan(BUDGET_MS);
  }, TEST_TIMEOUT_MS);
});

describe("exact arithmetic", () => {
  const d = parseDecimal;

  test("adds and subtracts without binary error", () => {
    expect(decimalText(subtract(d("0.6"), d("0.5")))).toBe("0.1");
    expect(decimalText(subtract(ONE, d("0.7")))).toBe("0.3");
    expect(decimalText(add(d("0.8"), d("0.09999999999999998")))).toBe("0.89999999999999998");
  });

  test("compares values of any scale", () => {
    expect(compare(d("0.5"), d("0.50"))).toBe(0);
    expect(compare(d("0.90000000000000001"), d("0.9"))).toBe(1);
    expect(compare(d("0.12"), d("0.2"))).toBe(-1);
    expect(decimalText(maximum([d("0.3"), d("0.7"), d("0.5")]))).toBe("0.7");
    expect(decimalText(minimum([d("0.3"), d("0.7"), d("0.5")]))).toBe("0.3");
    expect(compare(ZERO, d("0"))).toBe(0);
  });

  test("rounds up to a number of places, leaving an exact value alone", () => {
    expect(decimalText(ceilToPlaces(d("0.90000000000000001"), 2))).toBe("0.91");
    expect(decimalText(ceilToPlaces(d("0.07"), 2))).toBe("0.07");
    expect(decimalText(ceilToPlaces(d("0.811"), 2))).toBe("0.82");
    expect(decimalText(ceilToPlaces(d("-0.011"), 2))).toBe("-0.01");
    expect(decimalText(ceilToPlaces(d("1"), 2))).toBe("1");
  });

  test("writes a value as plain decimal text, and as a number only for display", () => {
    expect(decimalText(d("1.5e-7"))).toBe("0.00000015");
    expect(decimalText(d("-0.05"))).toBe("-0.05");
    expect(decimalText(d("2.50"))).toBe("2.5");
    expect(decimalText(d("0"))).toBe("0");
    expect(toNumber(d("0.91"))).toBe(0.91);
  });
});
