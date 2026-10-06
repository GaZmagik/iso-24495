// What a command may say about a failure it caught.
//
// A runtime error's own message quotes whatever it choked on. Bun's JSON parser
// names the offending token, and a missing file's error names its whole path.
// A command that prints that message prints text nobody has read. So nothing
// here reads an error's message or its name. Each function chooses its words
// from a fixed list, and gives a path or a file by its length.

import { readFileSync, writeFileSync } from "node:fs";

/** The outcome of reading a JSON file: what it holds, or why it could not be read. */
export type JsonFile = { ok: true; value: unknown } | { ok: false; problem: string };

const FILE_FAULTS: ReadonlyMap<string, string> = new Map([
  ["ENOENT", "no such file or directory"],
  ["EACCES", "permission refused"],
  ["EPERM", "permission refused"],
  ["EISDIR", "a directory where a file was expected"],
  ["ENOTDIR", "a file where a directory was expected"],
]);

// `Error` itself is the fallback, so it is not listed.
const BUILT_IN_ERRORS = [
  { name: "TypeError", type: TypeError },
  { name: "RangeError", type: RangeError },
  { name: "SyntaxError", type: SyntaxError },
  { name: "ReferenceError", type: ReferenceError },
  { name: "URIError", type: URIError },
  { name: "EvalError", type: EvalError },
];

/**
 * Reads `path` and parses it as JSON. `source` is the argument that named the
 * path, as the usage line writes it, so the problem tells the user which
 * argument to correct. Never throws.
 */
export function readJsonFile(path: string, source: string): JsonFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, problem: pathProblem(error, path, source, "cannot be read") };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // JSON.parse throws for one reason only, and its message quotes the text.
    return { ok: false, problem: `${source} names a file of ${text.length} characters that is not valid JSON` };
  }
}

/**
 * Writes `text` to `path`. `source` is the option that named the path. Returns
 * the problem, or null once the text is written. Never throws.
 */
export function writeTextFile(path: string, text: string, source: string): string | null {
  try {
    writeFileSync(path, text);
    return null;
  } catch (error) {
    return pathProblem(error, path, source, "cannot be written");
  }
}

/**
 * Words for a failure caught around work whose only file access is under `path`.
 *
 * A file fault is then a fault with that path, and is reported against `source`,
 * the argument that named it; `attempt` says what could not be done, such as
 * "cannot be listed". Anything else was not expected, and is reported as that.
 */
export function pathFailure(thrown: unknown, path: string, source: string, attempt: string): string {
  return fileFault(thrown) === null
    ? `stopped by ${unexpectedKind(thrown)}`
    : pathProblem(thrown, path, source, attempt);
}

/**
 * A file-system failure in fixed words, or null when `thrown` is not one this
 * module knows. The code is looked up and never printed, so the list decides
 * what can appear.
 */
export function fileFault(thrown: unknown): string | null {
  if (!(thrown instanceof Error) || !("code" in thrown) || typeof thrown.code !== "string") {
    return null;
  }
  return FILE_FAULTS.get(thrown.code) ?? null;
}

/**
 * What kind of thing was thrown, for a failure nothing expected.
 *
 * The type is found with `instanceof` against the built-in error types, and the
 * word printed is this module's own. An error's `name` is never read: whoever
 * throws an error can set it to anything. A thrown value that is not an error
 * is given by its `typeof`, which has a fixed set of answers.
 */
export function unexpectedKind(thrown: unknown): string {
  if (!(thrown instanceof Error)) {
    return `a thrown value of type ${typeof thrown}`;
  }
  const builtIn = BUILT_IN_ERRORS.find((candidate) => thrown instanceof candidate.type);
  return builtIn === undefined ? "an unexpected error" : `an unexpected ${builtIn.name}`;
}

function pathProblem(thrown: unknown, path: string, source: string, attempt: string): string {
  const reason = fileFault(thrown) ?? unexpectedKind(thrown);
  return `${source} names a path of ${path.length} characters that ${attempt}: ${reason}`;
}
