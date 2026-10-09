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

  test("refuses a number too large to hold cheaply, without building it", () => {
    // One call per size against a fixed budget. A nine-character number cost
    // about 50 ms before the bound and a ten-character one about 600 ms.
    for (const text of ['{"a":1e1000000}', "[1e10000000]", "1e-10000000"]) {
      let message = "";
      const started = performance.now();
      try {
        parseExactJson(text);
      } catch (error) {
        message = (error as Error).message;
      }
      const took = performance.now() - started;
      expect(message, text).toStartWith("Expected a JSON number with an exponent from -2000 to 2000; got an exponent of ");
      expect(took, text).toBeLessThan(100);
    }
  }, 60_000);
});

/** Fails unless the two values have the same own keys in the same order, the same prototypes and the same strings, at every depth. */
function expectSameShape(exact: unknown, plain: unknown, where: string): void {
  if (plain === null || typeof plain !== "object") {
    expect(exact, where).toBe(plain);
    return;
  }
  expect(typeof exact, where).toBe("object");
  expect(Object.getPrototypeOf(exact) === Object.getPrototypeOf(plain), `${where}: prototype`).toBe(true);
  expect(Reflect.ownKeys(exact as object), `${where}: own keys`).toEqual(Reflect.ownKeys(plain));
  for (const key of Reflect.ownKeys(plain)) {
    if (Array.isArray(plain) && key === "length") continue;
    const there = Object.getOwnPropertyDescriptor(plain, key) as PropertyDescriptor;
    const here = Object.getOwnPropertyDescriptor(exact as object, key) as PropertyDescriptor;
    const flags = (descriptor: PropertyDescriptor) => [descriptor.writable, descriptor.enumerable, descriptor.configurable];
    expect(flags(here), `${where}.${String(key)}: flags`).toEqual(flags(there));
    expectSameShape(here.value, there.value, `${where}.${String(key)}`);
  }
}

describe("every key reads as JSON.parse reads it", () => {
  // No text here holds a number, the one value the two readers give differently.
  const texts = [
    '{"__proto__": {"polluted": "yes"}, "kept": "a"}',
    '{"kept": "a", "__proto__": null}',
    '{"__proto__": "text"}',
    '{"__proto__": ["x", {"__proto__": {"deep": "y"}}]}',
    '{"constructor": "c", "toString": "t", "hasOwnProperty": "h", "valueOf": null}',
    '{"a": "first", "b": "second", "a": "third"}',
    '{"__proto__": "first", "b": "second", "__proto__": {"polluted": "yes"}}',
    '{"b": "x", "2": "y", "": "z", "1": "w"}',
  ];

  test("own keys, their order, their values and the prototype all agree", () => {
    for (const text of texts) {
      expectSameShape(parseExactJson(text), JSON.parse(text), text);
    }
  });

  test("a key named __proto__ is kept as a property and leaves the prototype alone", () => {
    const parsed = parseExactJson('{"__proto__": {"polluted": "yes"}, "kept": "a"}') as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["__proto__", "kept"]);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(parsed.polluted).toBeUndefined();
    expect("polluted" in parsed).toBe(false);
  });

  test("a number under __proto__ does not lend its units and scale to the object", () => {
    const parsed = parseExactJson('{"noul": {"__proto__": 0.9}}') as { noul: Record<string, unknown> };
    expect(parsed.noul.units).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(parsed.noul, "__proto__")?.value).toEqual({ units: 9n, scale: 1 });
  });

  test("a duplicated key keeps its first place and its last value", () => {
    const parsed = parseExactJson('{"a": 1, "b": 2, "a": 3}') as Record<string, Decimal>;
    expect(Object.keys(parsed)).toEqual(["a", "b"]);
    if (parsed.a === undefined) throw new Error("the key a is missing");
    expect(decimalText(parsed.a)).toBe("3");
  });
});
