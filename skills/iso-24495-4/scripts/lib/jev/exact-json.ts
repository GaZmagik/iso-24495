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
  return new ExactJsonReader(text).document();
}

/** One reading of a JSON text, holding the place it has reached. */
class ExactJsonReader {
  private at = 0;

  constructor(private readonly text: string) {}

  /** The value the whole text states, refusing anything after it but white space. */
  document(): unknown {
    const parsed = this.value();
    this.skip();
    if (this.at !== this.text.length) this.fail();
    return parsed;
  }

  private fail(): never {
    throw new Error(`The text is not JSON, at character ${this.at}.`);
  }

  private skip(): void {
    SPACE.lastIndex = this.at;
    SPACE.exec(this.text);
    this.at = SPACE.lastIndex;
  }

  private take(pattern: RegExp): string {
    pattern.lastIndex = this.at;
    const match = pattern.exec(this.text);
    if (match === null) return this.fail();
    this.at = pattern.lastIndex;
    return match[0];
  }

  private expect(character: string): void {
    this.skip();
    if (this.text[this.at] !== character) this.fail();
    this.at += 1;
  }

  private value(): unknown {
    this.skip();
    const next = this.text[this.at];
    if (next === "{") {
      this.at += 1;
      const object: Record<string, unknown> = {};
      this.skip();
      let more = this.text[this.at] !== "}";
      while (more) {
        this.skip();
        const key = JSON.parse(this.take(STRING)) as string;
        this.expect(":");
        object[key] = this.value();
        this.skip();
        more = this.text[this.at] === ",";
        if (more) this.at += 1;
      }
      this.expect("}");
      return object;
    }
    if (next === "[") {
      this.at += 1;
      const array: unknown[] = [];
      this.skip();
      let more = this.text[this.at] !== "]";
      while (more) {
        array.push(this.value());
        this.skip();
        more = this.text[this.at] === ",";
        if (more) this.at += 1;
      }
      this.expect("]");
      return array;
    }
    if (next === "\"") return JSON.parse(this.take(STRING)) as string;
    for (const [word, literal] of [["true", true], ["false", false], ["null", null]] as const) {
      if (this.text.startsWith(word, this.at)) {
        this.at += word.length;
        return literal;
      }
    }
    return parseDecimal(this.take(NUMBER));
  }
}
