import { describe, expect, test } from "bun:test";
import { shapeProblem, type Shape } from "../../scripts/lib/json-shape.ts";

// Every refused value below carries this word. No problem may repeat it.
const MARKER = "hunter2";

const ENTRY: Shape = {
  kind: "object",
  required: { name: { kind: "text" }, level: { kind: "whole", least: 0, most: 4 } },
  optional: { done: { kind: "flag" } },
};
const SHAPE: Shape = {
  kind: "object",
  required: {
    entries: { kind: "list", item: ENTRY },
    totals: { kind: "map", member: { kind: "whole", least: 0 } },
  },
};

describe("a parsed value checked against a documented shape", () => {
  test("a value of the shape has no problem", () => {
    expect(shapeProblem({ entries: [], totals: {} }, SHAPE, "<file>")).toBeNull();
    expect(shapeProblem(
      { entries: [{ name: "a", level: 0 }, { name: "b", level: 4, done: true }], totals: { x: 0, y: 12 }, more: 1 },
      SHAPE,
      "<file>",
    )).toBeNull();
  });

  test("a problem names the place in fixed words and the kind of value found", () => {
    const refused: Array<[value: unknown, problem: string]> = [
      [42, "<file> must be an object; got a number"],
      [null, "<file> must be an object; got null"],
      [[MARKER], "<file> must be an object; got an array"],
      [MARKER, "<file> must be an object; got a string"],
      [true, "<file> must be an object; got a true or false value"],
      [{ totals: {} }, '<file>, "entries" must be an array; got nothing'],
      [{ entries: {}, totals: {} }, '<file>, "entries" must be an array; got an object'],
      [{ entries: [], totals: [] }, '<file>, "totals" must be an object; got an array'],
      [{ entries: [{ name: "a", level: 0 }, MARKER], totals: {} },
        '<file>, "entries", entry 2 must be an object; got a string'],
      [{ entries: [{ name: 7, level: 0 }], totals: {} },
        '<file>, "entries", entry 1, "name" must be a string; got a number'],
      [{ entries: [{ name: "a", level: 0, done: MARKER }], totals: {} },
        '<file>, "entries", entry 1, "done" must be true or false; got a string'],
      [{ entries: [], totals: { a: 1, [MARKER]: MARKER } },
        '<file>, "totals", entry 2 must be a whole number of 0 or more; got a string'],
    ];
    for (const [value, problem] of refused) {
      const found = shapeProblem(value, SHAPE, "<file>");
      expect(found, JSON.stringify(value)).toBe(problem);
      expect(found).not.toContain(MARKER);
    }
  });

  test("a number must be whole and inside its range", () => {
    const level = (value: unknown) => shapeProblem(value, { kind: "whole", least: 0, most: 4 }, "level");
    for (const fits of [0, 1, 4]) expect(level(fits)).toBeNull();
    expect(level(99)).toBe("level must be a whole number from 0 to 4; got a whole number outside that range");
    expect(level(-1)).toBe("level must be a whole number from 0 to 4; got a whole number outside that range");
    expect(level(1.5)).toBe("level must be a whole number from 0 to 4; got a number that is not whole");
    expect(level("3")).toBe("level must be a whole number from 0 to 4; got a string");
    const count = (value: unknown) => shapeProblem(value, { kind: "whole", least: 0 }, "count");
    expect(count(Number.MAX_SAFE_INTEGER)).toBeNull();
    // Past this a number no longer holds every whole value, so it is not a count.
    expect(count(2 ** 60)).toBe("count must be a whole number of 0 or more; got a number that is not whole");
    expect(count(-1)).toBe("count must be a whole number of 0 or more; got a whole number outside that range");
  });

  test("a closed object refuses a member its shape does not name, by count alone", () => {
    const closed: Shape = {
      kind: "object",
      required: { a: { kind: "flag" } },
      optional: { b: { kind: "flag" } },
      closed: true,
    };
    expect(shapeProblem({ a: true, b: false }, closed, "<file>")).toBeNull();
    expect(shapeProblem({ a: true, [MARKER]: 1, other: 2 }, closed, "<file>"))
      .toBe("<file> must hold no member but those its shape names; got 2 more");
  });

  test("a member is read only where the value holds it as its own", () => {
    // "toString" is on every object, and is not a member of this one.
    // Named apart from the shapes that hold it. Written in place, under a name
    // every object inherits, the compiler reads "text" as any string.
    const text: Shape = { kind: "text" };
    const shape: Shape = { kind: "object", required: {}, optional: { toString: text } };
    expect(shapeProblem({}, shape, "<file>")).toBeNull();
    const required: Shape = { kind: "object", required: { constructor: text } };
    expect(shapeProblem({}, required, "<file>")).toBe('<file>, "constructor" must be a string; got nothing');
  });
});
