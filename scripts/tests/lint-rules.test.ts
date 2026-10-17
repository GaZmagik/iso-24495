import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { ENFORCED_RULES, GUIDE_SYNTAX, type RuleSetting } from "../../eslint.config.mjs";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");
const LINTER = join(REPOSITORY_ROOT, "node_modules", "eslint", "bin", "eslint.js");

// The gate's lint passes when it finds nothing, and a rule that is switched
// off, weakened to a warning, or overridden for some files also finds nothing
// that fails it. Three checks answer that, and none reads the configuration
// as text. The rules this project enforces are one value,
// ENFORCED_RULES, which the configuration is built from and these tests
// import.
//
// 1. Every setting in that value is an error.
// 2. ESLint is asked for the configuration that applies to each TypeScript
//    file, after every block and override. Each rule's entry there, severity
//    and options, must equal the entry ESLint resolves from that value alone.
// 3. The linter is given one breach of each rule and must report each as an
//    error. That proves the rule fires, which a setting alone does not.
//
// The breaches are text in this file, never a file of their own: the gate
// lints and type checks every TypeScript file in the repository.
//
// The scope, in the words the README uses:
//
// These guards catch accidents. The gate catches a package import written by
// name in shipped code. It also catches any shipped command that fails to load
// or run with nothing installed, in its documented offline modes.
//
// It does not defend against a deliberate evasion, of which there are three
// kinds. A name can be computed while the code runs. A failure can be caught
// and hidden by the code. An edit to the lint configuration can change what a
// rule does without changing its entry, through inline configuration or a
// processor.
//
// The person who reviews the diff covers those, because each is visible in the
// change that introduces it.
//
// So the second check compares rule entries and nothing else. A block that
// switches inline configuration back on for some files, or adds a processor,
// leaves every entry equal and passes it.
describe("the lint rules the gate relies on", () => {
  test("every enforced rule is set to an error", () => {
    const settings = Object.entries(ENFORCED_RULES);
    expect(settings.length).toBeGreaterThanOrEqual(20);
    expect(settings.filter(([, setting]) => !isError(setting)).map(([rule]) => rule)).toEqual([]);
  });

  test("every enforced rule is set as stated in every TypeScript file, as ESLint resolves it", async () => {
    expect(existsSync(LINTER), "the linter is not installed: run bun install first").toBe(true);
    const files = scriptFiles();
    const typescript = files.filter((file) => file.endsWith(".ts"));
    // The rules apply to TypeScript. Any other script is named here, so that a
    // new one cannot arrive unenforced without this line changing. The first
    // only declares types for the second, and ESLint requires the second to
    // have a default export, which the rules forbid.
    expect(files.filter((file) => !file.endsWith(".ts"))).toEqual(["eslint.config.d.mts", "eslint.config.mjs"]);
    expect(typescript).toContain("skills/iso-24495-4/scripts/audit-corpus.ts");
    expect(typescript).toContain("scripts/tests/lint-rules.test.ts");

    // ESLint rewrites an entry as it resolves it: the severity becomes a
    // number, and a rule may fill in the options it was not given. So the
    // stated side is resolved by ESLint as well, from a configuration that
    // holds ENFORCED_RULES and nothing else. It never reads
    // eslint.config.mjs, so no block or override there can move both sides
    // together, and the test above ties its severities to errors.
    const stated: unknown = await new ESLint({
      cwd: REPOSITORY_ROOT,
      overrideConfigFile: true,
      overrideConfig: [{ files: ["**/*.ts"], plugins: { "@typescript-eslint": tseslint.plugin }, rules: ENFORCED_RULES }],
    }).calculateConfigForFile("any-name.ts");
    for (const rule of Object.keys(ENFORCED_RULES)) {
      expect(resolvedSeverity(stated, rule), `${rule} as stated`).toBe(ERROR);
    }

    const eslint = new ESLint({ cwd: REPOSITORY_ROOT });
    const weak: string[] = [];
    const changed: string[] = [];
    const ignored: string[] = [];
    let checked = 0;
    for (const file of typescript) {
      // A file ESLint passes over has no configuration to read, and must not
      // pass by its absence.
      if (await eslint.isPathIgnored(file)) {
        ignored.push(file);
        continue;
      }
      const resolved: unknown = await eslint.calculateConfigForFile(file);
      for (const rule of Object.keys(ENFORCED_RULES)) {
        if (resolvedSeverity(resolved, rule) !== ERROR) weak.push(`${file}: ${rule}`);
        else if (!Bun.deepEquals(resolvedEntry(resolved, rule), resolvedEntry(stated, rule), true)) {
          changed.push(`${file}: ${rule}`);
        }
      }
      checked += 1;
    }
    expect(ignored).toEqual([]);
    expect(weak, "rules that are not an error").toEqual([]);
    expect(changed, "rules whose options are not the ones stated").toEqual([]);
    expect(checked).toBeGreaterThan(0);
    expect(checked).toBe(typescript.length);
  });

  test("each rule reports its breach as an error, and nothing else is reported", () => {
    expect(existsSync(LINTER), "the linter is not installed: run bun install first").toBe(true);

    const expected = PROBE.flatMap(([rules], index) => rules.map((rule) => `${index + 1}: ${rule}`));
    expect(reportsFor(PROBE.map(([, line]) => line).join("\n"))).toEqual(expected.sort());

    // The probe holds a breach of every enforced rule and of no other, so a
    // rule cannot join or leave the set without its breach. Each syntax
    // selector is a rule of its own here, named by its message, so a selector
    // cannot join the set without its breach either.
    const probed = new Set(PROBE.flatMap(([rules]) => rules));
    probed.delete(INERT_COMMENT);
    const selectors = GUIDE_SYNTAX.map(({ message }) => restricted(message));
    expect(new Set(selectors).size, "two selectors share a message").toBe(selectors.length);
    const rules = Object.keys(ENFORCED_RULES).filter((rule) => rule !== "no-restricted-syntax");
    expect([...probed].sort()).toEqual([...rules, ...selectors].sort());
  });
});

/**
 * How a report from one syntax selector reads, given its message. All the
 * selectors share one rule, so the message tells them apart.
 */
function restricted(message: string): string {
  return `no-restricted-syntax (${message})`;
}

/** The severity the linter gives a report that makes it exit with a failure. */
const ERROR = 2;
/**
 * What the linter says of a comment that tries to set or switch off a rule.
 * Such a comment has no effect here, and the report is a warning that names
 * no rule. The gate fails on a warning.
 */
const INERT_COMMENT = "(no rule) (severity 1, not an error)";
const TRAILING_SPACE = " ";
const NO_BREAK_SPACE = String.fromCharCode(160);
const BACKSLASH = String.fromCharCode(92);
const TAB = String.fromCharCode(9);

/**
 * The probe, one line of TypeScript per entry, beside the rules that must
 * report on that line. A line with no rules is one the linter must accept. A
 * breach that needs a line break is two entries, and the rule is beside the
 * line it reports on. The last line has no line ending, which is its breach.
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
  [["@typescript-eslint/no-explicit-any", "@typescript-eslint/array-type"], "export const listed: Array<any> = [];"],
  [["@typescript-eslint/no-namespace"], "export namespace Old { export const inside = 1; }"],
  [[restricted("guide: no default exports")], "export default legacy;"],
  [[restricted("guide: no #private fields"), "@typescript-eslint/prefer-readonly"], "export class Holder { #secret = 1; reveal(): number { return this.#secret; } }"],
  [["no-var", "block-scoped-var"], "export function scoped(flag: boolean): number { if (flag) { var inner = 1; } return inner; }"],
  [["prefer-arrow-callback", restricted("guide: no function expressions")], "export const mapped = [1].map(function (value) { return value; });"],
  [["no-restricted-properties"], "describe.only(\"a group\", () => {});"],
  [["no-restricted-properties"], "it.only(\"a case\", () => {});"],
  [["no-restricted-properties"], "test.only(\"a case\", () => {});"],
  [["@typescript-eslint/no-floating-promises"], "Promise.resolve(1);"],
  [["no-trailing-spaces"], "export const trailing = 1;" + TRAILING_SPACE],
  // Switched off in the configuration, so a control character is accepted.
  [[], `export const control = /${BACKSLASH}x00/;`],
  // A comment cannot switch a rule off: the breach below it is still an error.
  [[INERT_COMMENT], "// eslint-disable-next-line no-var"],
  [["no-var"], "export var shielded = 1;"],
  // Nor can a comment weaken one: every no-var line here stays an error.
  [[INERT_COMMENT], "/* eslint no-var: \"warn\" */"],
  [["no-useless-escape"], `export const escaped = /[${BACKSLASH})]/;`],
  [["@typescript-eslint/no-unused-vars"], "const unused = 1;"],
  [["preserve-caught-error"], "try { scoped(true); } catch (error) { if (error) throw new Error(\"fixed words\"); }"],
  [["no-irregular-whitespace"], `export const spaced =${NO_BREAK_SPACE}1;`],
  // The guide allows no white space but the plain space, even in a string.
  [["no-irregular-whitespace"], `export const spacedWords = "a${NO_BREAK_SPACE}b";`],
  [["no-tabs"], `export const tabbed =${TAB}1;`],
  [["no-regex-spaces"], "export const gaps = /a  b/;"],

  // Names.
  [["@typescript-eslint/naming-convention"], "export function underscored(_first: number, second: number): number { return second; }"],
  [["@typescript-eslint/naming-convention"], "export function trailed(second_: number): number { return second_; }"],
  [["@typescript-eslint/naming-convention"], "export function shouted(): number { const LOUD = 1; return LOUD; }"],
  [[], "export const QUIET_LIMIT = 1;"],
  [["@typescript-eslint/naming-convention"], "export function readHTML(): number { return 1; }"],
  // The platform's own name for a terminal keeps its capitals.
  [[], "export function terminal(inputIsTTY: boolean): boolean { return inputIsTTY; }"],
  [["@typescript-eslint/naming-convention"], "export interface lowerShape { size: number }"],
  [["@typescript-eslint/naming-convention"], "export interface IShape { size: number }"],
  [["@typescript-eslint/naming-convention"], "export enum Sizes { small = 1 }"],
  [["id-match"], "export const caf" + String.fromCharCode(233) + " = 1;"],

  // Statements and blocks.
  [[], "if (reader)"],
  [["curly"], "  scoped(true);"],
  [[], "if (reader) scoped(true);"],
  [[restricted("guide: a loop body is a braced block")], "for (const value of [1]) scoped(value > 0);"],
  [[restricted("guide: an else body is a braced block")], "if (reader) { scoped(true); } else scoped(false);"],
  [["default-case"], "switch (reader) { case 1: break; }"],
  [["default-case-last"], "switch (reader) { default: break; case 1: break; }"],
  [["guard-for-in"], "for (const key in { a: 1 }) { scoped(key === \"a\"); }"],
  [[], "let changing = reader;"],
  [[], "scoped(changing === 1);"],
  [["no-cond-assign"], "if (changing = Number(reader)) { scoped(true); }"],
  [["no-fallthrough"], "switch (changing) { case 1: scoped(true); case 2: break; default: break; }"],
  [["no-empty"], "try { scoped(true); } catch { }"],
  [["no-extra-boolean-cast"], "if (!!changing) { scoped(true); }"],
  [["no-debugger"], "debugger;"],
  [["semi"], "export const unended = 1"],
  [["no-extra-semi"], "export class Ended { size = 1; };"],
  [["multiline-comment-style"], "/*"],
  [[], " * A block of implementation notes. */"],

  // Values and calls.
  [["no-new-wrappers"], "export const wrapped = new String(\"a\");"],
  [["no-object-constructor"], "export const emptyObject = new Object();"],
  [["@typescript-eslint/no-array-constructor"], "export const pairList = new Array(1, 2);"],
  [["no-multi-str"], `export const continued = "a${BACKSLASH}`],
  [[], "b\";"],
  [["no-eval"], "eval(\"1\");"],
  [["no-new-func", "@typescript-eslint/no-implied-eval"], "export const made = new Function(\"return 1\");"],
  [["@typescript-eslint/no-implied-eval"], "setTimeout(\"scoped(true)\", 1);"],
  [["no-extend-native"], "Object.prototype.extra = 1;"],
  [["no-implicit-coercion"], "export const counted = +\"1\";"],
  [["new-parens"], "export const today = new Date;"],
  [["prefer-rest-params"], "export function counter(): number { return Array.from(arguments).length; }"],
  [[], "export const flags: [boolean] = [true];"],
  [["prefer-spread"], "scoped.apply(null, flags);"],
  [["@typescript-eslint/no-require-imports"], "export const required = require(\"node:fs\");"],
  [["@typescript-eslint/only-throw-error"], "export function thrower(): never { throw \"words\"; }"],
  [["@typescript-eslint/prefer-promise-reject-errors"], "export const rejected = Promise.reject(\"words\");"],
  [[restricted("guide: create an error with new")], "export const bare = Error(\"words\");"],
  [[restricted("guide: parse a number with Number()")], "export const parsed = parseInt(\"12\", 10);"],
  [[restricted("guide: parse a number with Number()")], "export const floated = Number.parseFloat(\"1.5\");"],
  // The guide allows another base, once the digits are checked.
  [[], "export const hexadecimal = parseInt(\"ff\", 16);"],
  [[restricted("guide: a number literal has a lowercase prefix")], "export const shoutedHex = 0XFF;"],
  [[restricted("guide: a special escape is written as its letter")], `export const lineFeed = "a${BACKSLASH}x0a";`],
  [[restricted("guide: a special escape is written as its letter")], `export const lineFeedText = ${"`"}a${BACKSLASH}u000a${"`"};`],
  // An escaped backslash before the letters is no escape of a line feed.
  [[], `export const literalLetters = "a${BACKSLASH}${BACKSLASH}x0a";`],
  [[restricted("guide: no accessors through Object.defineProperty")], "Object.defineProperty({}, \"size\", { get: () => 1 });"],

  // Functions.
  [[restricted("guide: a named top-level function is a declaration")], "export const doubled = (value: number): number => value * 2;"],
  // An arrow may name a function where its type needs stating.
  [[], "export const typed: (value: number) => number = (value) => value * 2;"],
  [[restricted("guide: no function expressions")], "export const holder = { make: function () { return 1; } };"],
  [["@typescript-eslint/no-invalid-this"], "export function unbound(): unknown { return this; }"],
  [["@typescript-eslint/no-inferrable-types"], "export function from(start: number = 0): number { return start; }"],
  [[restricted("guide: a destructured parameter is one level deep")], "export function nested({ inner: { size } }: { inner: { size: number } }): number { return size; }"],
  [[restricted("guide: an optional destructured parameter defaults to an empty literal")], "export function defaulted({ size }: { size?: number } = { size: 1 }): number { return size ?? 0; }"],
  [[], "export function optional({ size = 1 }: { size?: number } = {}): number { return size; }"],
  [["@typescript-eslint/no-use-before-define"], "export const early = later; export const later = 1;"],

  // Classes.
  [["@typescript-eslint/explicit-member-accessibility"], "export class Shown { public size = 1; }"],
  [["@typescript-eslint/prefer-readonly"], "export class Kept { private size = 1; read(): number { return this.size; } }"],
  [["@typescript-eslint/no-extraneous-class"], "export class Statics { static make(): number { return 1; } }"],
  [["@typescript-eslint/no-useless-constructor"], "export class Built { size = 1; constructor() {} }"],
  [["@typescript-eslint/no-this-alias"], "export class Aliased { size = 1; read(): number { const self = this; return self.size; } }"],
  [[restricted("guide: no this in a static context")], "export class Counter { size = 1; static total = 1; static read(): number { return this.total; } }"],
  [[restricted("guide: a class member is named, or keyed by a symbol")], "export class Keyed { [\"size\"] = 1; }"],
  [[restricted("guide: no mutable exports"), "prefer-const"], "export let changeable = 1;"],
  [[restricted("guide: no const enum")], "export const enum Weights { LIGHT = 1 }"],

  // Types and assertions.
  [["@typescript-eslint/consistent-type-assertions"], "export const angled = <number>reader;"],
  [["@typescript-eslint/consistent-type-assertions"], "export const shaped = { size: 1 } as { size: number };"],
  [[restricted("guide: a double assertion goes through unknown")], "export const twice = reader as number as unknown;"],
  [[], "export const throughUnknown = reader as unknown as string;"],
  [["@typescript-eslint/consistent-type-definitions"], "export type Literal = { size: number };"],
  [[restricted("guide: a type alias holds no null or undefined")], "export type Maybe = number | undefined;"],
  [["@typescript-eslint/array-type"], "export const counts: Array<number> = [];"],
  [["@typescript-eslint/consistent-generic-constructors"], "export const names: Set<string> = new Set();"],
  [["@typescript-eslint/no-wrapper-object-types"], "export const boxed: String = \"a\";"],
  [["@typescript-eslint/no-empty-object-type"], "export const anyValue: {} = 1;"],
  [[], "export const items = [1];"],
  [["@typescript-eslint/prefer-for-of"], "for (let index = 0; index < items.length; index++) { scoped(items[index] === 1); }"],
  [["eol-last"], "export const last = 1;"],
];

/** Whether a rule setting, as written in a configuration, is an error. */
function isError(setting: RuleSetting): boolean {
  const severity = Array.isArray(setting) ? setting[0] : setting;
  return severity === "error" || severity === ERROR;
}

/**
 * The severity ESLint resolved for one rule in the configuration of one file.
 *
 * ESLint gives each resolved rule as a list that opens with its severity as a
 * number: 0 for off, 1 for a warning, 2 for an error.
 *
 * @param resolved What `calculateConfigForFile` returned.
 * @returns The number, or null when the configuration does not hold the rule
 *     in that form, which is the case for a rule that is not set at all.
 */
function resolvedSeverity(resolved: unknown, rule: string): number | null {
  const entry = resolvedEntry(resolved, rule);
  const severity: unknown = entry === null ? null : entry[0];
  return typeof severity === "number" ? severity : null;
}

/**
 * The whole entry ESLint resolved for one rule in the configuration of one
 * file: its severity, then its options with the rule's defaults filled in.
 *
 * @param resolved What `calculateConfigForFile` returned.
 * @returns The entry, or null when the configuration does not hold the rule
 *     as a list.
 */
function resolvedEntry(resolved: unknown, rule: string): unknown[] | null {
  if (typeof resolved !== "object" || resolved === null || !("rules" in resolved)) return null;
  const rules: unknown = resolved.rules;
  if (typeof rules !== "object" || rules === null) return null;
  const entry: unknown = new Map(Object.entries(rules)).get(rule);
  return Array.isArray(entry) ? entry : null;
}

const SCRIPT_FILE = /\.(?:[cm]?ts|[cm]?js)$/;
const UNLINTED_DIRECTORIES = new Set([".git", "node_modules"]);

/**
 * Every script in the repository: each file ending in `.ts`, `.js`, `.mts`,
 * `.mjs`, `.cts` or `.cjs`, outside `.git` and `node_modules`.
 *
 * @returns The paths from the repository root, with forward slashes, sorted.
 * @throws The file system error when a directory cannot be listed.
 */
function scriptFiles(directory = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(REPOSITORY_ROOT, directory))) {
    if (UNLINTED_DIRECTORIES.has(entry)) continue;
    const path = directory === "" ? entry : `${directory}/${entry}`;
    if (statSync(join(REPOSITORY_ROOT, path)).isDirectory()) files.push(...scriptFiles(path));
    else if (SCRIPT_FILE.test(entry)) files.push(path);
  }
  return files.sort();
}

interface LintMessage {
  ruleId: string | null;
  message: string;
  line: number;
  /** 2 for an error, and 1 for a warning. */
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
 *     report that names no rule reads "(no rule)". A report from a syntax
 *     selector names its message too. A report that is not an
 *     error has its severity after the rule, so it equals no entry that
 *     expects an error.
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
    const rule = message.ruleId === "no-restricted-syntax" ? restricted(message.message) : message.ruleId ?? "(no rule)";
    return `${message.line}: ${rule}${weakened}`;
  });
  return [...new Set(reports)].sort();
}
