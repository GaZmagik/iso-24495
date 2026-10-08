// Checks that a parsed JSON value holds the shape a command documents.
//
// A file the user names can hold any JSON at all, and a value of the wrong
// shape does not always throw. A number where an object was expected has no
// members, so it read as an object that held nothing, and the command went on
// to report success. So a command checks the whole shape before it reads any
// of it.
//
// A problem says where the fault is and what kind of value was found there.
// The place is given in words this module was told to expect, and by position
// where the file chose the name. A name or a value from the file is never
// printed, because nobody has read it.

/** The shape a value must have. A shape is data, so a command can state one beside its types. */
export type Shape =
  | { kind: "text" }
  | { kind: "flag" }
  /** A whole number no lower than `least` and, where `most` is given, no higher than it. */
  | { kind: "whole"; least: number; most?: number }
  | { kind: "list"; item: Shape }
  /** An object whose members may have any name, each of the one shape. */
  | { kind: "map"; member: Shape }
  /**
   * An object with named members. A `required` member must be there. An
   * `optional` one is checked only when it is. Any other member is passed over
   * unless the object is `closed`, and then it is a problem.
   */
  | {
    kind: "object";
    required: Readonly<Record<string, Shape>>;
    optional?: Readonly<Record<string, Shape>>;
    closed?: boolean;
  };

/**
 * Checks one parsed JSON value against a shape.
 *
 * @param value What `JSON.parse` returned, or any part of it.
 * @param shape The shape it must have.
 * @param where The words that name the value in a problem, such as the
 *     argument that named its file. The caller chooses them, so they are
 *     printed as given.
 * @returns The first problem found, reading the value in the order the shape
 *     and the file give. It names the place, what was expected there and the
 *     kind of value found, and is safe to print. Null when the value fits.
 */
export function shapeProblem(value: unknown, shape: Shape, where: string): string | null {
  switch (shape.kind) {
    case "text":
      return typeof value === "string" ? null : mismatch(where, "a string", value);
    case "flag":
      return typeof value === "boolean" ? null : mismatch(where, "true or false", value);
    case "whole":
      return wholeProblem(value, shape.least, shape.most, where);
    case "list":
      if (!Array.isArray(value)) return mismatch(where, "an array", value);
      return firstProblem(value.map((item, index) => [item, shape.item, `${where}, entry ${index + 1}`]));
    case "map":
      if (!isObject(value)) return mismatch(where, "an object", value);
      return firstProblem(Object.values(value).map((member, index) => [member, shape.member, `${where}, entry ${index + 1}`]));
    case "object":
      if (!isObject(value)) return mismatch(where, "an object", value);
      return objectProblem(value, shape.required, shape.optional ?? {}, shape.closed ?? false, where);
  }
}

/** The problem with a value that must be a whole number in a range, or null. */
function wholeProblem(value: unknown, least: number, most: number | undefined, where: string): string | null {
  const expected = most === undefined
    ? `a whole number of ${least} or more`
    : `a whole number from ${least} to ${most}`;
  if (typeof value !== "number") return mismatch(where, expected, value);
  // Past the safe range a number no longer holds every whole value.
  if (!Number.isSafeInteger(value)) return `${where} must be ${expected}; got a number that is not whole`;
  if (value < least || value > (most ?? value)) {
    return `${where} must be ${expected}; got a whole number outside that range`;
  }
  return null;
}

/** The first problem among the members of an object with named members, or null. */
function objectProblem(
  value: Readonly<Record<string, unknown>>,
  required: Readonly<Record<string, Shape>>,
  optional: Readonly<Record<string, Shape>>,
  closed: boolean,
  where: string,
): string | null {
  const checks: Array<[unknown, Shape, string]> = [];
  for (const [name, shape] of Object.entries(required)) {
    // Only a member of its own counts: every object inherits "constructor".
    checks.push([Object.hasOwn(value, name) ? value[name] : undefined, shape, `${where}, "${name}"`]);
  }
  for (const [name, shape] of Object.entries(optional)) {
    if (Object.hasOwn(value, name)) checks.push([value[name], shape, `${where}, "${name}"`]);
  }
  const problem = firstProblem(checks);
  if (problem !== null || !closed) return problem;
  const others = Object.keys(value)
    .filter((name) => !Object.hasOwn(required, name) && !Object.hasOwn(optional, name)).length;
  return others === 0 ? null : `${where} must hold no member but those its shape names; got ${others} more`;
}

/** The first problem among the checks, in their order, or null when each value fits. */
function firstProblem(checks: ReadonlyArray<[value: unknown, shape: Shape, where: string]>): string | null {
  for (const [value, shape, where] of checks) {
    const problem = shapeProblem(value, shape, where);
    if (problem !== null) return problem;
  }
  return null;
}

/** Whether a parsed JSON value is an object with named members: not null, and not an array. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A problem that gives the kind of the value found, in this module's own words, and never the value. */
function mismatch(where: string, expected: string, value: unknown): string {
  return `${where} must be ${expected}; got ${kindOf(value)}`;
}

function kindOf(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "boolean") return "a true or false value";
  // A parsed JSON value has no other type than these three.
  return typeof value === "object" ? "an object" : typeof value === "string" ? "a string" : "a number";
}
