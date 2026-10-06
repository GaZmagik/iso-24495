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
