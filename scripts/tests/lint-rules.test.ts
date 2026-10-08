import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");
const LINTER = join(REPOSITORY_ROOT, "node_modules", "eslint", "bin", "eslint.js");

// The gate's lint passes when it finds nothing, and a rule that is switched
// off, misspelt or dropped from a shared rule set also finds nothing. So this
// gives the linter one deliberate breach of each rule and requires a report
// for each, as an error: the gate lets a warning through. The breaches are
// text in this file, never a file of their own:
// the gate lints and type checks every TypeScript file in the repository.
//
// It covers every rule eslint.config.mjs names, and the rules of the
// recommended sets that have found a fault in this repository. The other
// rules of the recommended sets are not probed.
describe("the lint rules the gate relies on", () => {
  test("each rule reports its breach, and nothing else is reported", () => {
    expect(existsSync(LINTER), "the linter is not installed: run bun install first").toBe(true);

    const expected = PROBE.flatMap(([rules], index) => rules.map((rule) => `${index + 1}: ${rule}`));
    expect(reportsFor(PROBE.map(([, line]) => line).join("\n"))).toEqual(expected.sort());

    // Every rule the configuration names appears above, so adding a rule there
    // without a breach here fails.
    const probed = new Set(PROBE.flatMap(([rules]) => rules));
    expect(namedRules().filter((rule) => !probed.has(rule))).toEqual([]);
  });
});

const UNUSED_DIRECTIVE = "(unused directive)";
/** The severity the linter gives a report that makes it exit with a failure. */
const ERROR = 2;
const TRAILING_SPACE = " ";
const NO_BREAK_SPACE = String.fromCharCode(160);
const BACKSLASH = String.fromCharCode(92);

/**
 * The probe, one line of TypeScript per entry, beside the rules that must
 * report on that line. A line with no rules is one the linter must accept.
 * The last line has no line ending, which is its breach.
 */
const PROBE: ReadonlyArray<readonly [rules: readonly string[], line: string]> = [
  // A reference directive counts only above the first statement, so the three
  // forms come first.
  [["@typescript-eslint/triple-slash-reference"], "/// <reference path=\"./probe.d.ts\" />"],
  [["@typescript-eslint/triple-slash-reference"], "/// <reference lib=\"esnext\" />"],
  [["@typescript-eslint/triple-slash-reference"], "/// <reference types=\"bun\" />"],
  [["@typescript-eslint/ban-ts-comment"], "// @ts-nocheck"],
  [["@typescript-eslint/ban-ts-comment"], "// @ts-ignore"],
  [["no-var"], "export var legacy = 1;"],
  [["@typescript-eslint/ban-ts-comment"], "// @ts-expect-error with a reason given"],
  [["one-var"], "export const pair = 1, other = 2;"],
  [["prefer-const"], "let settled = 1;"],
  [[], "export const reader = settled;"],
  [["eqeqeq"], "export const loose = legacy == 2;"],
  // The guide allows a loose comparison with null, which also matches undefined.
  [[], "export const absent = legacy == null;"],
  [["@typescript-eslint/no-explicit-any"], "export const anything: any = 1;"],
  [["@typescript-eslint/no-explicit-any"], "export const listed: Array<any> = [];"],
  [["@typescript-eslint/no-namespace"], "export namespace Old { export const inside = 1; }"],
  [["no-restricted-syntax"], "export default legacy;"],
  [["no-restricted-syntax"], "export class Holder { #secret = 1; reveal(): number { return this.#secret; } }"],
  [["no-var", "block-scoped-var"], "export function scoped(flag: boolean): number { if (flag) { var inner = 1; } return inner; }"],
  [["prefer-arrow-callback"], "export const mapped = [1].map(function (value) { return value; });"],
  [["no-restricted-properties"], "describe.only(\"a group\", () => {});"],
  [["no-restricted-properties"], "it.only(\"a case\", () => {});"],
  [["no-restricted-properties"], "test.only(\"a case\", () => {});"],
  [["@typescript-eslint/no-floating-promises"], "Promise.resolve(1);"],
  [["no-trailing-spaces"], "export const trailing = 1;" + TRAILING_SPACE],
  // Switched off in the configuration, so a control character is accepted.
  [[], `export const control = /${BACKSLASH}x00/;`],
  [[UNUSED_DIRECTIVE], "// eslint-disable-next-line no-var"],
  [[], "export const clean = 1;"],
  [["no-useless-escape"], `export const escaped = /[${BACKSLASH})]/;`],
  [["@typescript-eslint/no-unused-vars"], "const unused = 1;"],
  [["preserve-caught-error"], "try { scoped(true); } catch (error) { if (error) throw new Error(\"fixed words\"); }"],
  [["no-irregular-whitespace"], `export const spaced =${NO_BREAK_SPACE}1;`],
  [["no-regex-spaces"], "export const gaps = /a  b/;"],
  [["eol-last"], "export const last = 1;"],
];

interface LintMessage {
  ruleId: string | null;
  line: number;
  /** 2 for an error, which fails the gate, and 1 for a warning, which does not. */
  severity: number;
  fatal?: boolean;
}

/**
 * What the linter reports for a text, under this repository's configuration.
 *
 * The text is linted under this file's own name. The typed rules read types
 * from a project, and the project service refuses a name it cannot find on
 * disk.
 *
 * @returns One "line: rule" entry for each line and rule reported, sorted. A
 *     report that names no rule is an unused directive. A report that is not
 *     an error has its severity after the rule, so it equals no expected
 *     entry.
 * @throws An `Error` when the linter prints anything but its JSON report, or
 *     could not parse the text, which leaves every rule unrun.
 */
function reportsFor(text: string): string[] {
  const run = Bun.spawnSync(
    ["node", LINTER, "--stdin", "--stdin-filename", import.meta.path, "--format", "json"],
    { cwd: REPOSITORY_ROOT, stdin: Buffer.from(text, "utf8") },
  );
  const printed = run.stdout.toString();
  let results: Array<{ messages: LintMessage[] }>;
  try {
    results = JSON.parse(printed);
  } catch {
    throw new Error(`The linter printed no JSON report. It exited with code ${run.exitCode}.`);
  }
  const messages = results.flatMap((result) => result.messages);
  if (messages.some((message) => message.fatal === true)) {
    throw new Error("The linter could not parse the probe, so no rule ran.");
  }
  const reports = messages.map((message) => {
    const weakened = message.severity === ERROR ? "" : ` (severity ${message.severity}, not an error)`;
    return `${message.line}: ${message.ruleId ?? UNUSED_DIRECTIVE}${weakened}`;
  });
  return [...new Set(reports)].sort();
}

/**
 * The rules eslint.config.mjs switches on by name, read from its text.
 *
 * @returns Each quoted rule name the file gives a setting, whatever the
 *     setting is, unless the setting is "off" or 0. So a rule set to a warning
 *     is returned, and so is a rule set by number or with options.
 */
function namedRules(): string[] {
  const config = readFileSync(join(REPOSITORY_ROOT, "eslint.config.mjs"), "utf8");
  return [...config.matchAll(/^ {6}"([^"]+)": (?!"off"|0,)/gm)].map((match) => match[1] ?? "");
}
