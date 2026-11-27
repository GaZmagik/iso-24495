import { describe, expect, test } from "bun:test";
import { itemAt } from "../../scripts/lib/item-at.ts";

const MISSING = new RangeError("A list was read at a position it does not hold.");

describe("a read by index that the caller has made sure of", () => {
  test("gives the item of a list, a typed array or a string, unchanged", () => {
    const shared = { size: 1 };
    expect(itemAt([shared], 0)).toBe(shared);
    expect(itemAt([3, 0, 7], 1)).toBe(0);
    expect(itemAt([null], 0)).toBeNull();
    expect(itemAt(Int32Array.of(-1, 4), 0)).toBe(-1);
    expect(itemAt("ab", 1)).toBe("b");
  });

  test("refuses a position the list does not hold, in words that name neither", () => {
    const holed: number[] = [1];
    holed.length = 3;
    const missing: Array<[list: ArrayLike<number | string>, index: number]> = [
      [[1, 2], 2], [[1, 2], -1], [[1, 2], 0.5], [holed, 1], ["", 0], [Int32Array.of(5), 1],
    ];
    for (const [list, index] of missing) {
      expect(() => itemAt(list, index)).toThrow(MISSING);
    }
  });
});
