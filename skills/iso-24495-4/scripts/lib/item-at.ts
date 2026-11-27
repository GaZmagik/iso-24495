// A read by index, checked. The type check has noUncheckedIndexedAccess on, so
// it types every read by index as possibly undefined, and it cannot see a check
// made on another line. A cast told it otherwise and checked nothing.

/**
 * The item at a position of a list, a typed array or a string, where the
 * caller has already made sure there is one.
 *
 * @param list What is read. An item that is undefined counts as missing, so
 *     the item type cannot include undefined.
 * @param index The position read.
 * @returns The item, unchanged.
 * @throws A `RangeError` when there is no item at `index`: past either end,
 *     at a hole, or at a position that is not a whole number. That means the
 *     caller's own check was wrong. The message names neither the position nor
 *     the list.
 */
export function itemAt<T extends NonNullable<unknown> | null>(list: ArrayLike<T>, index: number): T {
  const item = list[index];
  if (item === undefined) {
    throw new RangeError("A list was read at a position it does not hold.");
  }
  return item;
}
