import { describe, expect, test } from "bun:test";
import { decimalText, type Decimal } from "../../../scripts/lib/jev/decimal.ts";
import { parseExactJson } from "../../../scripts/lib/jev/exact-json.ts";

describe("parseExactJson", () => {
  test("keeps every number token exactly as written", () => {
    const parsed = parseExactJson('{"answers":{"reader":{"type":"noul","noul":0.90000000000000001}}}') as {
      answers: { reader: { type: string; noul: Decimal } };
    };
    expect(parsed.answers.reader.type).toBe("noul");
    expect(decimalText(parsed.answers.reader.noul)).toBe("0.90000000000000001");
  });

  test("reads every JSON value: objects, arrays, strings with escapes, literals and numbers", () => {
    const parsed = parseExactJson(' { "a" : [ 1 , -2.5e-3 , true , false , null , "x\\"y\\u00e9\\n" ] , "b" : { } , "c" : [ ] } ') as {
      a: [Decimal, Decimal, boolean, boolean, null, string];
      b: object;
      c: unknown[];
    };
    expect(decimalText(parsed.a[0])).toBe("1");
    expect(decimalText(parsed.a[1])).toBe("-0.0025");
    expect(parsed.a.slice(2)).toEqual([true, false, null, "x\"yé\n"]);
    expect(parsed.b).toEqual({});
    expect(parsed.c).toEqual([]);
  });

  test("refuses text that is not JSON, naming where", () => {
    for (const text of ["", "{", "[1,]", '{"a" 1}', '{"a":1,}', "tru", "01", '"open', "1 2", "{1:2}", "[1 2]"]) {
      expect(() => parseExactJson(text)).toThrow("is not JSON");
    }
  });
});
