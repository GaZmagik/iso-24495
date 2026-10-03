// A JSON reader that keeps every number exactly as written.
//
// JSON.parse turns each number into a double, and a double cannot hold every
// decimal a service may write: 0.90000000000000001 becomes 0.9. Scores are
// read here instead, so each number arrives as the Decimal its token states.
// Everything else reads as JSON.parse reads it.

import { parseDecimal } from "./decimal.ts";

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const SPACE = /[ \t\n\r]*/y;

/** The JSON value in the text, with every number a Decimal. */
export function parseExactJson(text: string): unknown {
  let at = 0;
  const fail = (): never => {
    throw new Error(`The text is not JSON, at character ${at}.`);
  };
  const skip = (): void => {
    SPACE.lastIndex = at;
    SPACE.exec(text);
    at = SPACE.lastIndex;
  };
  const take = (pattern: RegExp): string => {
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (match === null) return fail();
    at = pattern.lastIndex;
    return match[0];
  };
  const expect = (character: string): void => {
    skip();
    if (text[at] !== character) fail();
    at += 1;
  };
  const value = (): unknown => {
    skip();
    const next = text[at];
    if (next === "{") {
      at += 1;
      const object: Record<string, unknown> = {};
      skip();
      let more = text[at] !== "}";
      while (more) {
        skip();
        const key = JSON.parse(take(STRING)) as string;
        expect(":");
        object[key] = value();
        skip();
        more = text[at] === ",";
        if (more) at += 1;
      }
      expect("}");
      return object;
    }
    if (next === "[") {
      at += 1;
      const array: unknown[] = [];
      skip();
      let more = text[at] !== "]";
      while (more) {
        array.push(value());
        skip();
        more = text[at] === ",";
        if (more) at += 1;
      }
      expect("]");
      return array;
    }
    if (next === "\"") return JSON.parse(take(STRING)) as string;
    for (const [word, literal] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, at)) {
        at += word.length;
        return literal;
      }
    }
    return parseDecimal(take(NUMBER));
  };
  const parsed = value();
  skip();
  if (at !== text.length) fail();
  return parsed;
}
