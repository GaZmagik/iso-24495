import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");

/** The compiler options of this repository, as its tsconfig.json states them. */
const COMPILER_OPTIONS = ts.parseJsonConfigFileContent(
  ts.readConfigFile(join(REPOSITORY_ROOT, "tsconfig.json"), ts.sys.readFile).config,
  ts.sys,
  REPOSITORY_ROOT,
).options;

/**
 * Every source file the compiler has read from disk for a type check here,
 * by its name. The libraries are read once and shared by every check.
 */
const SHARED_SOURCES = new Map<string, ts.SourceFile>();

/** The program of every TypeScript file in the repository, once a test has made it. */
const REPOSITORY_PROGRAMS: ts.Program[] = [];

const BACKSLASH = String.fromCharCode(92);

/** How the name of a command shim ends. A shim runs one function of the module named without it. */
const SHIM_ENDING = "-cli.ts";

/**
 * Shipped modules that are not held to the entry-point rule, each with the
 * reason. A test below fails when a module listed here no longer needs it.
 */
const NO_SINGLE_ENTRY_POINT: Readonly<Record<string, string>> = {
  "skills/iso-24495-4/scripts/lib/jev/decimal.ts":
    "An arithmetic library: its exported operations are peers, and none is the entry point. "
    + "It leads with the two private helpers that most of them share.",
};

/** The one file allowed to throw a value typed unknown, as RULE_EXCEPTIONS says. */
const FOREIGN_THROWS_FILE = "scripts/tests/traffic-snapshot.test.ts";

/**
 * The throws of a value typed unknown that FOREIGN_THROWS_FILE may hold, each
 * as the declaration of the value and the throw statement. Two tests there
 * stand in for code outside this project, which may throw anything.
 */
const APPROVED_UNKNOWN_THROWS = [
  "foreign: unknown = \"a bare string\" / throw foreign;",
  "foreign: unknown = \"ENOENT\" / throw foreign;",
];

/**
 * The rethrows of a caught value typed unknown that this repository holds, by
 * the owner's ruling, each as "file / function / throw" with the reason it
 * stays. Each passes on what other code threw, so it cannot know the value is
 * an Error, and wrapping it would change what its caller receives.
 */
const APPROVED_RETHROWS: Readonly<Record<string, string>> = {
  "scripts/audit-pull-request-text.ts / openUnlessLink / throw error;":
    "Passes on any failure to open but a refused link, as the open call threw it, which a test holds.",
  "scripts/traffic-snapshot.ts / textIfPresent / throw error;":
    "Passes on any read failure but a missing file, as it was thrown; a test throws a string through it and holds it unchanged.",
  "skills/iso-24495-4/scripts/audit-corpus.ts / walk / throw error;":
    "Passes on the failure to list the corpus root unchanged, in a calibrated file whose behaviour must not move.",
};

/**
 * The kinds of node the compiler counts as function-like that make a function
 * with a body, each with how the placement check names one. It follows each
 * such function to its place. A test fails when the installed compiler counts
 * a kind as function-like that neither this nor TYPE_KINDS names.
 */
const FOLLOWED_KINDS: Readonly<Record<string, string>> = {
  ArrowFunction: "an arrow function",
  FunctionExpression: "a function expression",
  FunctionDeclaration: "a function declaration",
  MethodDeclaration: "a method",
  Constructor: "a constructor",
  GetAccessor: "a get accessor",
  SetAccessor: "a set accessor",
};

/** The kinds of node the compiler counts as function-like that make no function, each with why the placement check passes over it. */
const TYPE_KINDS: Readonly<Record<string, string>> = {
  MethodSignature: "A method signature in a type describes a method and makes none.",
  CallSignature: "A call signature in a type describes a call and makes no function.",
  ConstructSignature: "A construct signature in a type describes new and makes no function.",
  IndexSignature: "An index signature in a type describes keys and makes no function.",
  FunctionType: "A function type describes a function and makes none.",
  ConstructorType: "A constructor type describes a constructor and makes none.",
  JSDocFunctionType: "A function type in a JSDoc comment describes a function and makes none.",
  JSDocSignature: "A signature in a JSDoc comment describes a function and makes none.",
};

/**
 * The places a function written in this repository may end in without a
 * name of its own, each with the reason it is safe. The placement check
 * follows every function written here to its place, and one that ends
 * anywhere else, or in a place whose reason is missing, fails the test,
 * naming it, until its place is added here with a reason.
 */
const ALLOWED_POSITIONS: Readonly<Record<string, string>> = {
  "a function declaration": "It has a name of its own, where rule 1 orders it, and the lint selector refuses one inside a function.",
  "a class member": "A method, constructor, accessor or field of a class is a member, which the skill allows.",
  "an argument to a call that does not give it back": "The call is handed the function as a value; by its declared types, and by its body where it is declared here, the call's value is not that function.",
  "returned from a function": "It is the value the function's caller receives: handed on, not kept under a name where it is written.",
  "held in a value bound to a name": "The name binds the object or array that holds the function, not the function, which is a value handed on, most often a stand-in for a dependency.",
  "a part of a literal no name takes": "A destructuring binds no name to it, so nothing keeps it.",
  "stored on a property": "An assignment to a property, as a statement of its own, hands it on as a property that holds it does.",
};

// This file is the record of the four rules this plugin's own TypeScript is
// held to, taken from its code skill, `iso-24495-code`, by the owner's
// ruling. The skill states the first three in words. It states the fourth
// only by example: every error it shows is an Error, and the Google guide
// makes that a rule. Each rule is checked by the tool that states it most
// simply.
//
// 1. Entry point first. A reader opening a module meets what it does before
//    the detail. The first function of each shipped module is exported, and
//    a command shim's module leads with the function the shim runs. Tests are
//    not held to it, by the owner's ruling. decimal.ts is listed below with
//    its reason. A name is a function when its type can be called, or
//    wherever rule 3's test below would find one. Tested here.
// 2. Interface comment present. A caller learns what a function does without
//    reading its body. Every top-level export has a JSDoc comment, tested in
//    source-comments.test.ts. A comment on a function that throws says what
//    it throws, tested here. A function written as a value is read with the
//    nearest comment of its own: on it, on a wrapper around it, or on the
//    property or array item that holds it; failing that, with the comment on
//    the class field that holds it, or on the statement that binds it to a
//    name. A rest element with a name binds an array, not a function.
// 3. Helpers at top level. A reader cannot reach a closure without reading
//    its container first. A function declaration, a variable holding a
//    function, or an object method or accessor inside a function is refused
//    by the "code skill" syntax selector in eslint.config.mjs, probed in
//    lint-rules.test.ts. A variable holding a function through
//    Object.freeze counts. A selector cannot tell which key of a literal a
//    name is bound to, so a test here finds every name bound to a function
//    inside a function by destructuring, at any depth, by a rest element's
//    pattern, by a default or by an assignment, and every parameter whose
//    default is a function. It reads every value an expression may be: each
//    branch of a conditional, either side of ?? and ||, the right of &&, and
//    each argument a call may give back by its declared types, as
//    Object.freeze, Object.assign and an identity function do, or by a body
//    declared here that returns it. A key is read whatever its spelling:
//    against an array literal, an index key reads the item there. A name a
//    spread of unknown extent, or a key not known, may give its value cannot
//    be read, so it fails the test, naming the name and why; the same holds
//    for the other two tests. A parameter its function's @param tag
//    documents is part of the interface, not a helper, by the owner's ruling
//    of 2026-10-20, so its default is not reported. Otherwise a property
//    holding an arrow is left alone: it is a value handed on, most often a
//    stand-in for a dependency.
// 4. Throw only Error. A value that is not an Error carries no message and no
//    stack to the person who meets it. The lint rule
//    "@typescript-eslint/only-throw-error" refuses a thrown value typed any or
//    unknown, and a caught value may still be thrown on. RULE_EXCEPTIONS in
//    eslint.config.mjs names the one file that may throw a value typed
//    unknown: scripts/tests/traffic-snapshot.test.ts, whose tests stand in
//    for code outside this project. Probed in lint-rules.test.ts. A linter
//    cannot tell two statements of a file apart, so a test here holds that
//    file to its two approved throws, by their text. In the same way, a test
//    here holds the rethrows of a caught value to the three approved sites,
//    each with its reason, in APPROVED_RETHROWS. A caught value is a catch
//    clause's name or any parameter, so no way of writing the call that takes
//    a rejection handler hides one. A rethrow is known by the name it
//    throws, through parentheses, so `throw (failure);` is found and a change
//    of layout does not move an approved one.
//
// The tests for rules 1 to 3 read a function by where it is written. A
// placement check makes sure that no function is written where they cannot
// see it. It follows every function written with a body, of each kind the
// compiler counts as function-like, out through each wrapper, each call that
// may give it back and each literal that holds it, to where it ends. That is
// a name the rules read, or one of the places in ALLOWED_POSITIONS, each
// with the reason it is safe. A function that ends anywhere else fails the
// test, naming the function, its file and its line, and so does a place
// whose reason is missing, and a function-like kind of node that neither
// FOLLOWED_KINDS nor TYPE_KINDS names.
//
// eslint.config.mjs also records the eight lint rules that ESLint 11.0.0
// removes, beside the rules themselves.
//
// As with the lint rules, these checks catch accidents, by the owner's ruling
// of 2026-10-09. These deliberate forms are left to review, each with why:
// - A comment that names what a function throws and is wrong: no check can
//   tell what a sentence claims.
// - A caught value narrowed by a type check and then thrown, as in
//   `if (typeof failure === "string") throw failure;`: the check narrows it
//   to a string first, so it is no longer typed unknown, and no one writes
//   the check by accident.
//
// The lint selector reads only an arrow given to Object.freeze directly, so
// it misses one under a type wrapper inside the call, as in
// `Object.freeze(((n: number): number => n + 1) satisfies (n: number) =>
// number)`. The nested-helper test and the throws test both read through it.
describe("the code skill's rules for this repository's own code", () => {
  // The first type check reads the libraries, which takes seconds. The later
  // ones share them.
  beforeAll(() => {
    typedSource("probe.ts", "");
  }, 60_000);

  test("every shipped module leads with an exported function", () => {
    let checked = 0;
    const problems: string[] = [];
    for (const file of shippedModules()) {
      const found = entryPointProblem(file, readFileSync(join(REPOSITORY_ROOT, file), "utf8"));
      if (found.checked) checked += 1;
      if (found.problem !== null && !(file in NO_SINGLE_ENTRY_POINT)) problems.push(found.problem);
    }
    expect(problems).toEqual([]);
    // A walk that read nothing would find nothing wrong, so the count must be
    // the size a walk of this repository gives.
    expect(checked).toBeGreaterThanOrEqual(25);
  });

  test("each module that has no single entry point is still listed for a reason", () => {
    for (const file of Object.keys(NO_SINGLE_ENTRY_POINT)) {
      const found = entryPointProblem(file, readFileSync(join(REPOSITORY_ROOT, file), "utf8"));
      expect(found.problem, `${file} now leads with an exported function: remove it from the list`).not.toBeNull();
    }
  });

  test("every command shim runs the first function of its module", () => {
    const shims = typescriptFiles().filter((file) => !isTestFile(file) && file.endsWith(SHIM_ENDING));
    const problems: string[] = [];
    for (const shim of shims) {
      const module = shim.slice(0, -SHIM_ENDING.length) + ".ts";
      const found = shimProblem(shim, readFileSync(join(REPOSITORY_ROOT, shim), "utf8"), module, readFileSync(join(REPOSITORY_ROOT, module), "utf8"));
      if (found !== null) problems.push(found);
    }
    expect(problems).toEqual([]);
    expect(shims.length).toBeGreaterThanOrEqual(10);
  });

  test("every documented function that throws says what it throws", () => {
    let read = 0;
    const problems: string[] = [];
    for (const file of typescriptFiles()) {
      const { source, checker } = repositorySource(file);
      const found = undocumentedThrowsIn(file, source, checker);
      read += found.read;
      problems.push(...found.problems);
    }
    expect(problems).toEqual([]);
    expect(read).toBeGreaterThanOrEqual(16);
  });

  test("a module that leads with a function it does not export is reported", () => {
    expect(entryPointProblem("probe.ts", "function helper(): number { return 1; }\nexport function main(): number { return helper(); }"))
      .toEqual({ checked: true, problem: "probe.ts:1: the first function, helper, is not exported" });
    expect(entryPointProblem("probe.ts", "const helper = (): number => 1;\nexport function main(): number { return helper(); }"))
      .toEqual({ checked: true, problem: "probe.ts:1: the first function, helper, is not exported" });
    expect(entryPointProblem("probe.ts", "export function main(): number { return helper(); }\nfunction helper(): number { return 1; }"))
      .toEqual({ checked: true, problem: null });
    // A name exported by a list counts as exported.
    expect(entryPointProblem("probe.ts", "function main(): number { return 1; }\nexport { main };"))
      .toEqual({ checked: true, problem: null });
    // Constants, types and classes may come first. Only functions are ordered.
    expect(entryPointProblem("probe.ts", "const LIMIT = 1;\nclass Fault extends Error {}\nexport function main(): number { return LIMIT; }"))
      .toEqual({ checked: true, problem: null });
    expect(entryPointProblem("probe.ts", "export const LIMIT = 1;")).toEqual({ checked: false, problem: null });
  });

  test("a first function in parentheses, or under a type assertion, is read as the bare one is", () => {
    const reported = { checked: true, problem: "probe.ts:1: the first function, helper, is not exported" };
    const caller = "\nexport function main(): number { return helper(1); }";
    for (const value of [
      "((x: number): number => x)",
      "(function (x: number): number { return x; })",
      "(((x: number): number => x))",
      "((x: number): number => x) satisfies (x: number) => number",
      "((x: number): number => x) as (x: number) => number",
    ]) {
      expect(entryPointProblem("probe.ts", `const helper = ${value};${caller}`), value).toEqual(reported);
    }
    expect(entryPointProblem("probe.ts", `export const helper = ((x: number): number => x);${caller}`))
      .toEqual({ checked: true, problem: null });
  });

  test("a first function that a call wraps or returns is read as the function it is", () => {
    const reported = { checked: true, problem: "probe.ts:1: the first function, helper, is not exported" };
    const caller = "\nexport function main(): number { return helper(1); }";
    for (const value of [
      "Object.freeze<(x: number) => number>((x) => x)",
      "((): ((x: number) => number) => (x) => x)()",
    ]) {
      expect(entryPointProblem("probe.ts", `const helper = ${value};${caller}`), value).toEqual(reported);
    }
    // A value that a call builds with a callback is not a function.
    expect(entryPointProblem("probe.ts", "const NAMES = [\"a\"].map((name) => name.toUpperCase());\nexport function main(): string[] { return NAMES; }"))
      .toEqual({ checked: true, problem: null });
  });

  test("a first function bound by destructuring is read as a declared one is", () => {
    const caller = "\nexport function main(): number { return helper(1); }";
    for (const binding of [
      "const [helper] = [(x: number): number => x] as const;",
      "const [, helper] = [1, (x: number): number => x] as const;",
      "const { helper } = { helper: (x: number): number => x };",
      "const { inner: [helper] } = { inner: [(x: number): number => x] as const };",
    ]) {
      expect(entryPointProblem("probe.ts", binding + caller), binding)
        .toEqual({ checked: true, problem: "probe.ts:1: the first function, helper, is not exported" });
    }
    expect(entryPointProblem("probe.ts", `export const [helper] = [(x: number): number => x] as const;${caller}`))
      .toEqual({ checked: true, problem: null });
    // A destructured value that cannot be called is not a function.
    expect(entryPointProblem("probe.ts", `const [LIMIT] = [1] as const;\nexport function main(): number { return LIMIT; }`))
      .toEqual({ checked: true, problem: null });
  });

  test("a shim's entry point is the function whose result it exits with", () => {
    expect(shimEntryPoint("probe-cli.ts", "import { runCli } from \"./probe.ts\";\nprocess.exit(runCli(process.argv));")).toBe("runCli");
    expect(shimEntryPoint("probe-cli.ts", "process.exit(await runCli(process.argv));")).toBe("runCli");
    expect(shimEntryPoint("probe-cli.ts", "runCli(process.argv);")).toBeNull();
  });

  test("the file allowed to throw a value typed unknown holds the two approved throws and no others", () => {
    expect(unknownThrows(FOREIGN_THROWS_FILE, readFileSync(join(REPOSITORY_ROOT, FOREIGN_THROWS_FILE), "utf8")))
      .toEqual(APPROVED_UNKNOWN_THROWS);
  });

  test("a third throw of a value typed unknown, or of one typed any, is found beside the two", () => {
    const text = readFileSync(join(REPOSITORY_ROOT, FOREIGN_THROWS_FILE), "utf8");
    const third = "\nexport function third(value: unknown): never {\n  throw value;\n}\n";
    expect(unknownThrows(FOREIGN_THROWS_FILE, text + third)).toEqual([...APPROVED_UNKNOWN_THROWS, "value: unknown / throw value;"]);
    const parsed = "\nexport function parsed(): never {\n  throw JSON.parse(\"1\");\n}\n";
    expect(unknownThrows(FOREIGN_THROWS_FILE, text + parsed)).toEqual([...APPROVED_UNKNOWN_THROWS, "(no declaration) / throw JSON.parse(\"1\");"]);
    // A value typed as an Error is not one of them.
    expect(unknownThrows("probe.ts", "export function fail(): never {\n  throw new Error(\"x\");\n}\n")).toEqual([]);
  });

  test("the only rethrows of a caught value typed unknown are the three approved ones", () => {
    const found: string[] = [];
    for (const file of typescriptFiles()) {
      const text = readFileSync(join(REPOSITORY_ROOT, file), "utf8");
      if (throwsSomeName(text)) found.push(...rethrows(file, text));
    }
    expect(found.sort()).toEqual(Object.keys(APPROVED_RETHROWS).sort());
    // Each reason is one line.
    expect(Object.values(APPROVED_RETHROWS).filter((reason) => reason.includes("\n") || reason.trim() === "")).toEqual([]);
  });

  test("a fourth rethrow of a caught value is found beside the approved one, and a narrowed one is not", () => {
    const file = "scripts/audit-pull-request-text.ts";
    const text = readFileSync(join(REPOSITORY_ROOT, file), "utf8");
    const fourth = "\nexport function fourth(read: () => string): string {\n  try {\n    return read();\n  } catch (failure) {\n"
      + "    if (failure instanceof RangeError) return \"\";\n    throw failure;\n  }\n}\n";
    expect(throwsSomeName(text + fourth)).toBe(true);
    expect(rethrows(file, text + fourth)).toEqual([`${file} / openUnlessLink / throw error;`, `${file} / fourth / throw failure;`]);
    // A value passed on from a promise's rejection is a rethrow too.
    const rejected = "export function passOn(read: () => Promise<string>): Promise<string> {\n"
      + "  return read().catch((failure: unknown) => {\n    throw failure;\n  });\n}\n";
    expect(rethrows("probe.ts", rejected)).toEqual(["probe.ts / (an unnamed function) / throw failure;"]);
    // A caught value narrowed to an Error is an Error.
    const narrowed = "export function narrowed(read: () => string): string {\n  try {\n    return read();\n  } catch (failure) {\n"
      + "    if (failure instanceof Error) throw failure;\n    return \"\";\n  }\n}\n";
    expect(rethrows("probe.ts", narrowed)).toEqual([]);
  });

  test("an approved rethrow is known by its name whatever its spacing, and a parenthesised rethrow is one too", () => {
    // The approved site, standing alone, so that the probe holds whatever the real file's layout is.
    const file = "scripts/audit-pull-request-text.ts";
    const approved = `${file} / openUnlessLink / throw error;`;
    expect(approved in APPROVED_RETHROWS).toBe(true);
    const site = "export function openUnlessLink(open: () => number): number | null {\n  try {\n    return open();\n  } catch (error) {\n"
      + "    if (error instanceof RangeError) return null;\n    THROWN\n  }\n}\n";
    // A line break may not follow the word throw, so a broken line sits inside parentheses.
    for (const spaced of ["throw error;", "throw  error;", "throw\terror;", "throw /* as thrown */ error;", "throw (\n      error\n    );", "throw (error);", "throw error"]) {
      expect(rethrows(file, site.replace("THROWN", spaced)), spaced).toEqual([approved]);
    }
    const parenthesised = "export function passOn(read: () => string): string {\n  try {\n    return read();\n  } catch (failure) {\n"
      + "    throw ((failure));\n  }\n}\n";
    expect(throwsSomeName(parenthesised)).toBe(true);
    expect(rethrows("probe.ts", parenthesised)).toEqual(["probe.ts / passOn / throw failure;"]);
  });

  test("a rethrow from a rejection handler in parentheses is a rethrow", () => {
    for (const handler of ["((failure: unknown) => {\n    throw failure;\n  })", "(((failure: unknown) => {\n    throw failure;\n  }))"]) {
      const text = `export function passOn(read: () => Promise<string>): Promise<string> {\n  return read().catch(${handler});\n}\n`;
      expect(throwsSomeName(text)).toBe(true);
      expect(rethrows("probe.ts", text), handler).toEqual(["probe.ts / (an unnamed function) / throw failure;"]);
    }
  });

  test("a shim runs its module's first function when the module exports that function under another name", () => {
    const shim = "import { runCli } from \"./probe.ts\";\nprocess.exit(runCli(process.argv));";
    const aliased = "function entry(args: string[]): number { return args.length; }\nexport { entry as runCli };\n";
    expect(shimProblem("probe-cli.ts", shim, "probe.ts", aliased)).toBeNull();
    // The name the function is exported under is what counts, so a shim that runs its local name does not match.
    expect(shimProblem("probe-cli.ts", "import { entry } from \"./probe.ts\";\nprocess.exit(entry(process.argv));", "probe.ts", aliased))
      .toBe("probe-cli.ts runs entry, but probe.ts leads with entry, exported as runCli");
    // A module whose first function is another one is still a mismatch.
    const other = "export function auditText(): number { return 1; }\nexport function runCli(): number { return 0; }\n";
    expect(shimProblem("probe-cli.ts", shim, "probe.ts", other)).toBe("probe-cli.ts runs runCli, but probe.ts leads with auditText");
  });

  test("a shim's entry point is read through a namespace import, await and parentheses", () => {
    expect(shimEntryPoint("probe-cli.ts", "import * as cli from \"./probe.ts\";\nprocess.exit(cli.runCli());")).toBe("runCli");
    expect(shimEntryPoint("probe-cli.ts", "import { runCli } from \"./probe.ts\";\nprocess.exit(await (runCli()));")).toBe("runCli");
    expect(shimEntryPoint("probe-cli.ts", "import * as cli from \"./probe.ts\";\nprocess.exit((await ((cli.runCli()))));")).toBe("runCli");
    // A call through the namespace to another function still names that function, so a mismatch still shows.
    const module = "export function runCli(): number { return 0; }\nexport function auditText(): number { return 1; }\n";
    expect(shimProblem("probe-cli.ts", "import * as cli from \"./probe.ts\";\nprocess.exit(cli.runCli());", "probe.ts", module)).toBeNull();
    expect(shimProblem("probe-cli.ts", "import * as cli from \"./probe.ts\";\nprocess.exit(cli.auditText());", "probe.ts", module))
      .toBe("probe-cli.ts runs auditText, but probe.ts leads with runCli");
    // A method of anything but a namespace import is not a function of the module.
    expect(shimEntryPoint("probe-cli.ts", "const cli = { runCli: (): number => 0 };\nprocess.exit(cli.runCli());")).toBeNull();
  });

  test("no function is bound inside a function by destructuring or a default", () => {
    const found: string[] = [];
    let files = 0;
    for (const file of typescriptFiles()) {
      const { source, checker } = repositorySource(file);
      found.push(...boundHelpersIn(file, source, checker));
      files += 1;
    }
    expect(found).toEqual([]);
    // A walk that read nothing would find nothing, so the count must be the size a walk of this repository gives.
    expect(files).toBeGreaterThan(50);
  });

  test("a function bound by destructuring at any depth, by a default, or by a parameter default is a nested helper", () => {
    const bound: Array<[form: string, body: string]> = [
      ["a nested binding", "const { inner: { helper } } = { inner: { helper: (n: number): number => n + 1 } };"],
      ["a nested default", "const { inner: { helper = (n: number): number => n + 1 } } = { inner: {} };"],
      ["a default beside a function value", "const { helper = (n: number): number => n } = { helper: (n: number): number => n + 1 };"],
      ["a method", "const { helper } = { helper(n: number): number { return n + 1; } };"],
      ["a quoted key", "const { \"helper\": helper } = { helper: (n: number): number => n + 1 };"],
      ["a nested array", "const [[helper]] = [[(n: number): number => n + 1]] as const;"],
      ["a frozen literal", "const { helper } = Object.freeze({ cover: 1, helper: (n: number): number => n + 1 });"],
      ["a default from a default literal", "const { inner: { helper } = { helper: (n: number): number => n + 1 } } = {};"],
    ];
    for (const [form, body] of bound) {
      expect(boundHelpers("probe.ts", `export function main(): number {\n  ${body}\n  return helper(1);\n}\n`), form).toEqual(["probe.ts / main / helper"]);
    }
    expect(boundHelpers("probe.ts", "export function main(helper: (n: number) => number = (n: number): number => n + 1): number {\n  return helper(1);\n}\n"))
      .toEqual(["probe.ts / main / helper"]);
    expect(boundHelpers("probe.ts", "export function main({ helper }: { helper: (n: number) => number } = { helper: (n: number): number => n + 1 }): number {\n  return helper(1);\n}\n"))
      .toEqual(["probe.ts / main / helper"]);
  });

  test("a function default on a parameter its function's @param tag documents is interface, not a nested helper", () => {
    const signature = "export function main(helper: (n: number) => number = (n: number): number => n + 1): number {\n  return helper(1);\n}\n";
    const documented = "/**\n * Runs.\n *\n * @param helper Adds one. The default adds one to its argument.\n */\n";
    expect(boundHelpers("probe.ts", documented + signature)).toEqual([]);
    expect(boundHelpers("probe.ts", "/** Runs. */\n" + signature)).toEqual(["probe.ts / main / helper"]);
    expect(boundHelpers("probe.ts", "/**\n * Runs.\n *\n * @param other Not this parameter.\n */\n" + signature)).toEqual(["probe.ts / main / helper"]);
    expect(boundHelpers("probe.ts", signature)).toEqual(["probe.ts / main / helper"]);
    // A tag documents the parameter, not a helper declared in the body.
    const body = "export function main(size = 1): number {\n  const { helper } = { helper: (n: number): number => n + 1 };\n  return helper(size);\n}\n";
    expect(boundHelpers("probe.ts", "/**\n * Runs.\n *\n * @param size The size.\n * @param helper Adds one.\n */\n" + body)).toEqual(["probe.ts / main / helper"]);
    // A default inside a destructured parameter is a default of the name it binds, not of the parameter.
    const destructured = "export function main({ helper = (n: number): number => n + 1 }: { helper?: (n: number) => number } = {}): number {\n  return helper(1);\n}\n";
    expect(boundHelpers("probe.ts", "/**\n * Runs.\n *\n * @param options What to run with.\n */\n" + destructured)).toEqual(["probe.ts / main / helper"]);
  });

  test("a parameter an overload signature's @param tag documents is interface in the implementation too", () => {
    const implementation = "export function main(size: number, helper: (n: number) => number = (n: number): number => n + 1): number {\n  return helper(size);\n}\n";
    const documented = "/**\n * Runs.\n *\n * @param size The size.\n * @param helper Adds one.\n */\nexport function main(size: number, helper?: (n: number) => number): number;\n";
    expect(boundHelpers("probe.ts", documented + implementation)).toEqual([]);
    const undocumented = "/**\n * Runs.\n *\n * @param size The size.\n */\nexport function main(size: number, helper?: (n: number) => number): number;\n";
    expect(boundHelpers("probe.ts", undocumented + implementation)).toEqual(["probe.ts / main / helper"]);
    // A signature of another function does not document this one.
    const other = "/**\n * Runs another.\n *\n * @param helper Adds one.\n */\nexport function other(helper?: (n: number) => number): number;\nexport function other(): number {\n  return 0;\n}\n";
    expect(boundHelpers("probe.ts", other + implementation)).toEqual(["probe.ts / main / helper"]);
  });

  test("a function a destructuring does not bind to a name, or binds at the top level, is not a nested helper", () => {
    for (const body of [
      "const { helper }: { unused: () => number; helper: number } = { unused: (): number => 1, helper: 2 };",
      "const [helper] = [2, (n: number): number => n + 1] as const;",
      "const { helper, ...rest } = { helper: 2, other: (n: number): number => n + 1 };",
      "const { helper } = made({ helper: 2 });",
      "const { helper = 2 } = {};",
    ]) {
      expect(boundHelpers("probe.ts", `export function main(): number {\n  ${body}\n  return helper;\n}\n`), body).toEqual([]);
    }
    expect(boundHelpers("probe.ts", "const { helper } = { helper: (n: number): number => n + 1 };\nexport function main(size = 1): number {\n  return helper(size);\n}\n"))
      .toEqual([]);
  });

  test("a shim's entry point is read through parentheses around the function called", () => {
    expect(shimEntryPoint("probe-cli.ts", "import * as cli from \"./probe.ts\";\nprocess.exit(await (cli.runCli)());")).toBe("runCli");
    expect(shimEntryPoint("probe-cli.ts", "import { runCli } from \"./probe.ts\";\nprocess.exit(((runCli))());")).toBe("runCli");
    const module = "export function runCli(): number { return 0; }\nexport function auditText(): number { return 1; }\n";
    expect(shimProblem("probe-cli.ts", "import * as cli from \"./probe.ts\";\nprocess.exit(await (cli.runCli)());", "probe.ts", module)).toBeNull();
    expect(shimProblem("probe-cli.ts", "import * as cli from \"./probe.ts\";\nprocess.exit(await (cli.auditText)());", "probe.ts", module))
      .toBe("probe-cli.ts runs auditText, but probe.ts leads with runCli");
  });

  test("a shim's entry point is read through parentheses around the namespace", () => {
    const module = "export function runCli(): number { return 0; }\nexport function auditText(): number { return 1; }\n";
    expect(shimProblem("probe-cli.ts", "import * as cli from \"./probe.ts\";\nprocess.exit((cli).runCli());", "probe.ts", module)).toBeNull();
    expect(shimProblem("probe-cli.ts", "import * as cli from \"./probe.ts\";\nprocess.exit(((cli)).runCli());", "probe.ts", module)).toBeNull();
    expect(shimProblem("probe-cli.ts", "import * as cli from \"./probe.ts\";\nprocess.exit((cli).auditText());", "probe.ts", module))
      .toBe("probe-cli.ts runs auditText, but probe.ts leads with runCli");
  });

  test("a shim's entry point is named as its module exports it, through an import alias", () => {
    expect(shimEntryPoint("probe-cli.ts", "import { runCli as main } from \"./probe.ts\";\nprocess.exit(main(process.argv));"))
      .toBe("runCli");
    // An alias of another function still names that function, so a mismatch still shows.
    expect(shimEntryPoint("probe-cli.ts", "import { auditText as main, runCli } from \"./probe.ts\";\nprocess.exit(main(process.argv));"))
      .toBe("auditText");
  });

  test("a documented function that throws and does not say so is reported", () => {
    const missing = ["probe.ts:2: the comment on f does not say what it throws"];
    expect(undocumentedThrows("probe.ts", "/** Reads a size. */\nfunction f(): number { throw new Error(\"no size\"); }"))
      .toEqual({ read: 1, problems: missing });
    expect(undocumentedThrows("probe.ts", "/** Reads a size. */\nconst f = (): number => { throw new Error(\"no size\"); };"))
      .toEqual({ read: 1, problems: missing });
    expect(undocumentedThrows("probe.ts", "export class C {\n  /** Reads a size. */\n  f(): number { throw new Error(\"no size\"); }\n}").problems)
      .toEqual(["probe.ts:3: the comment on f does not say what it throws"]);
    expect(undocumentedThrows("probe.ts", "/**\n * Reads a size.\n * @throws An `Error` when there is none.\n */\nfunction f(): number { throw new Error(\"no size\"); }"))
      .toEqual({ read: 1, problems: [] });
  });

  test("a documented arrow held by an object property or a class field, that throws and does not say so, is reported", () => {
    const thrower = "(): number => {\n    throw new RangeError(\"x\");\n  }";
    const forms: Array<[form: string, text: string]> = [
      ["an object property", `export const reader = {\n  /** Reads a size. */\n  read: ${thrower},\n};`],
      ["an object property in parentheses", `export const reader = {\n  /** Reads a size. */\n  read: (${thrower}),\n};`],
      ["an object property holding a function expression", "export const reader = {\n  /** Reads a size. */\n  read: function (): number {\n    throw new RangeError(\"x\");\n  },\n};"],
      ["a class field", `export class Reader {\n  /** Reads a size. */\n  read = ${thrower};\n}`],
    ];
    for (const [form, text] of forms) {
      expect(undocumentedThrows("probe.ts", text), form)
        .toEqual({ read: 1, problems: ["probe.ts:3: the comment on read does not say what it throws"] });
    }
  });

  test("a documented arrow held by an object property or a class field, that says what it throws, is accepted", () => {
    const comment = "  /**\n   * Reads a size.\n   * @throws A `RangeError` always.\n   */";
    const thrower = "(): number => {\n    throw new RangeError(\"x\");\n  }";
    for (const text of [`export const reader = {\n${comment}\n  read: ${thrower},\n};`, `export class Reader {\n${comment}\n  read = ${thrower};\n}`]) {
      expect(undocumentedThrows("probe.ts", text), text).toEqual({ read: 1, problems: [] });
    }
  });

  test("a documented function held in an array, that throws and does not say so, is reported, and one that says so is accepted", () => {
    const missing = ["probe.ts:3: the comment on an array item does not say what it throws"];
    for (const item of ["(): never => {", "((): never => {", "function (): never {"]) {
      const close = item.startsWith("((") ? "})," : "},";
      const text = `export const readers = [\n  /** Reads size. */\n  ${item}\n    throw new Error("size");\n  ${close}\n];`;
      expect(undocumentedThrows("probe.ts", text), item).toEqual({ read: 1, problems: missing });
    }
    const said = "export const readers = [\n  /**\n   * Reads size.\n   * @throws An `Error` always.\n   */\n  (): never => {\n    throw new Error(\"size\");\n  },\n];";
    expect(undocumentedThrows("probe.ts", said)).toEqual({ read: 1, problems: [] });
  });

  test("a documented function that Object.freeze wraps is read as the function it holds", () => {
    const thrower = "Object.freeze<() => number>((): number => {\n  throw new RangeError(\"x\");\n})";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const read = ${thrower};`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const read = (${thrower}) as () => number;`).problems)
      .toEqual(["probe.ts:2: the comment on read does not say what it throws"]);
    expect(undocumentedThrows("probe.ts", `/**\n * Reads a size.\n * @throws A \`RangeError\` always.\n */\nexport const read = ${thrower};`))
      .toEqual({ read: 1, problems: [] });
    // Another call with one callback runs it to build a value, so its throw is not the value's.
    expect(undocumentedThrows("probe.ts", "/** The sizes. */\nexport const sizes = [1].map((size): number => {\n  throw new RangeError(String(size));\n});"))
      .toEqual({ read: 0, problems: [] });
  });

  test("the comment on an overload signature counts for the implementation that follows it", () => {
    const signatures = "function f(size: string): number;\nfunction f(size: number): number;\n";
    const implementation = "function f(size: string | number): number {\n  throw new RangeError(String(size));\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\n${signatures}${implementation}`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on f does not say what it throws"] });
    // The comment may sit on either signature, and one that says what the function throws covers it.
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nfunction f(size: string): number;\n/**\n * Reads a size.\n * @throws A \`RangeError\` always.\n */\nfunction f(size: number): number;\n${implementation}`))
      .toEqual({ read: 1, problems: [] });
    // The implementation's own comment still counts.
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\n${signatures}/**\n * Reads a size.\n * @throws A \`RangeError\` always.\n */\n${implementation}`))
      .toEqual({ read: 1, problems: [] });
    // A class method reads the same way.
    const method = "export class Reader {\n  /** Reads a size. */\n  read(size: string): number;\n  read(size: number): number;\n"
      + "  read(size: string | number): number {\n    throw new RangeError(String(size));\n  }\n}";
    expect(undocumentedThrows("probe.ts", method)).toEqual({ read: 1, problems: ["probe.ts:3: the comment on read does not say what it throws"] });
    // A signature of another function is not an overload of this one.
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nfunction g(size: string): number;\nfunction g(size: string): number { return size.length; }\n${implementation}`))
      .toEqual({ read: 0, problems: [] });
  });

  test("a @throws tag on an overload signature counts when the implementation has a comment of its own", () => {
    const implementation = "/** Reads a size from either form. */\nfunction f(size: string | number): number {\n  throw new RangeError(String(size));\n}";
    const said = "/**\n * Reads a size.\n * @throws A `RangeError` always.\n */\nfunction f(size: string): number;\nfunction f(size: number): number;\n";
    expect(undocumentedThrows("probe.ts", said + implementation)).toEqual({ read: 1, problems: [] });
    // With no @throws tag anywhere in the group, the report is at the implementation's own comment.
    const unsaid = "/** Reads a size. */\nfunction f(size: string): number;\nfunction f(size: number): number;\n";
    expect(undocumentedThrows("probe.ts", unsaid + implementation))
      .toEqual({ read: 1, problems: ["probe.ts:5: the comment on f does not say what it throws"] });
    // A documented signature without the tag, above an undocumented implementation that throws, is still reported.
    expect(undocumentedThrows("probe.ts", unsaid + "function f(size: string | number): number {\n  throw new RangeError(String(size));\n}"))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on f does not say what it throws"] });
  });

  test("a documented function bound by destructuring a literal is read as the function it binds", () => {
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    for (const statement of [
      `export const { read } = { read: ${thrower} };`,
      `export const { size: read } = { size: ${thrower} };`,
      `export const { read } = Object.freeze({ read: ${thrower} });`,
      `export const [read] = [${thrower}] as const;`,
    ]) {
      expect(undocumentedThrows("probe.ts", `/** Reads a size. */\n${statement}`), statement)
        .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
      expect(undocumentedThrows("probe.ts", `/**\n * Reads a size.\n * @throws A \`RangeError\` always.\n */\n${statement}`), statement)
        .toEqual({ read: 1, problems: [] });
    }
    // The one comment covers each function the statement binds.
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const { read, write } = { read: ${thrower}, write: ${thrower} };`).problems)
      .toEqual(["probe.ts:2: the comment on read does not say what it throws", "probe.ts:2: the comment on write does not say what it throws"]);
    // A key that is not bound, and a bound value that is not a function, are not read.
    expect(undocumentedThrows("probe.ts", `/** The size. */\nexport const { size } = { size: 1, read: ${thrower} };`)).toEqual({ read: 0, problems: [] });
  });

  test("a documented destructured method, quoted key, nested binding or default is read as the function it binds", () => {
    const body = "{\n  throw new RangeError(\"size\");\n}";
    for (const statement of [
      `export const { read } = { read(): never ${body} };`,
      `export const { read } = { "read": (): never => ${body} };`,
      `export const { "read": read } = { read: (): never => ${body} };`,
      `export const { 0: read } = { 0: (): never => ${body} };`,
      `export const { inner: { read } } = { inner: { read: (): never => ${body} } };`,
      `export const [[read]] = [[(): never => ${body}]] as const;`,
      `export const { read = (): never => ${body} } = {};`,
    ]) {
      expect(undocumentedThrows("probe.ts", `/** Reads a size. */\n${statement}`), statement)
        .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
      expect(undocumentedThrows("probe.ts", `/**\n * Reads a size.\n * @throws A \`RangeError\` always.\n */\n${statement}`), statement)
        .toEqual({ read: 1, problems: [] });
    }
    // A property with a comment of its own is read with that comment alone.
    const own = `/** Readers. */\nexport const { read } = {\n  /**\n   * Reads a size.\n   * @throws A \`RangeError\` always.\n   */\n  read: (): never => ${body},\n};`;
    expect(undocumentedThrows("probe.ts", own)).toEqual({ read: 1, problems: [] });
  });

  test("a documented destructuring reads a nested default as well as the value it would replace", () => {
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    for (const statement of [
      `export const { inner: { read } = { read: ${thrower} } } = { inner: undefined };`,
      `export const [[read] = [${thrower}]] = [undefined];`,
      `export const { inner: { read } = { read: ${thrower} } } = { inner: made() };`,
    ]) {
      expect(undocumentedThrows("probe.ts", `/** Reads a size. */\n${statement}`), statement)
        .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
      expect(undocumentedThrows("probe.ts", `/**\n * Reads a size.\n * @throws A \`RangeError\` always.\n */\n${statement}`), statement)
        .toEqual({ read: 1, problems: [] });
    }
    // A default the literal's own value replaces never runs, but the function written there is bound to the name, so it is read.
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const { inner: { read } = { read: ${thrower} } } = { inner: { read: (): number => 1 } };`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
  });

  test("a name bound from an array with a spread reads the position the spread gives it", () => {
    const bound: Array<[pattern: string, literal: string, found: string[]]> = [
      ["[, size]", "[...[1, 2] as const, (n: number): number => n + 3] as const", []],
      ["[, , helper]", "[...[1, 2] as const, (n: number): number => n + 3] as const", ["probe.ts / main / helper"]],
      ["[, , helper]", "[...[...[1] as const, 2] as const, (n: number): number => n + 3] as const", ["probe.ts / main / helper"]],
      ["[, helper]", "[...Object.freeze([1] as const), (n: number): number => n + 3] as const", ["probe.ts / main / helper"]],
      // After a spread whose length is not written there, a position is not known, so it is reported as one that cannot be read.
      ["[, helper]", "[...made(), (n: number): number => n + 3]", [positionNotKnown("helper", "...made()")]],
      ["[helper]", "[(n: number): number => n + 3, ...made()]", ["probe.ts / main / helper"]],
    ];
    for (const [pattern, literal, found] of bound) {
      expect(boundHelpers("probe.ts", `export function main(): number {\n  const ${pattern} = ${literal};\n  return 0;\n}\n`), `${pattern} = ${literal}`).toEqual(found);
    }
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const [, read] = [...[1] as const, ${thrower}] as const;`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", `/** The size. */\nexport const [, size] = [...[1, 2] as const, ${thrower}] as const;`)).toEqual({ read: 0, problems: [] });
  });

  test("a function a conditional chooses is read as the function it may be", () => {
    for (const value of [
      "flag ? (n: number): number => n + 1 : (n: number): number => n + 2",
      "flag ? 1 : (n: number): number => n + 2",
      "flag ? (other ? (n: number): number => n : 1) : 2",
      "(flag ? (n: number): number => n + 1 : (n: number): number => n) as (n: number) => number",
    ]) {
      expect(boundHelpers("probe.ts", `export function main(flag: boolean, other: boolean): number {\n  const helper = ${value};\n  return 0;\n}\n`), value)
        .toEqual(["probe.ts / main / helper"]);
    }
    expect(boundHelpers("probe.ts", "export function main(flag: boolean): number {\n  const size = flag ? 1 : 2;\n  return size;\n}\n")).toEqual([]);
    const thrower = "flag ? (): never => {\n  throw new RangeError(\"size\");\n} : (): number => 1";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const read = ${thrower};`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", `/**\n * Reads a size.\n * @throws A \`RangeError\` when the flag is set.\n */\nexport const read = ${thrower};`))
      .toEqual({ read: 1, problems: [] });
    expect(undocumentedThrows("probe.ts", `export const readers = {\n  /** Reads a size. */\n  read: ${thrower},\n};`))
      .toEqual({ read: 1, problems: ["probe.ts:3: the comment on read does not say what it throws"] });
  });

  test("a destructured array item with a comment of its own is read with that comment alone", () => {
    const item = "  (): number => {\n    throw new RangeError(\"size\");\n  },\n] as const;";
    const said = "  /**\n   * Reads a size.\n   * @throws A `RangeError` always.\n   */\n";
    expect(undocumentedThrows("probe.ts", `/** Readers. */\nexport const [read] = [\n${said}${item}`)).toEqual({ read: 1, problems: [] });
    expect(undocumentedThrows("probe.ts", `/** Readers. */\nexport const [read] = [\n  /** Reads a size. */\n${item}`))
      .toEqual({ read: 1, problems: ["probe.ts:4: the comment on an array item does not say what it throws"] });
  });

  test("a constructor declared with overloads is read with the comments of its signatures", () => {
    const head = "export class Size {\nCOMMENT\n  constructor(size: string);\n  constructor(size: number);\n";
    const implementation = "  constructor(size: string | number) {\n    throw new RangeError(String(size));\n  }\n}";
    const said = "  /**\n   * Reads a size.\n   * @throws A `RangeError` always.\n   */";
    const brief = "  /** Reads either form. */\n";
    expect(undocumentedThrows("probe.ts", head.replace("COMMENT", said) + brief + implementation)).toEqual({ read: 1, problems: [] });
    expect(undocumentedThrows("probe.ts", head.replace("COMMENT", said) + implementation)).toEqual({ read: 1, problems: [] });
    // With no @throws tag anywhere in the group, the report is at the implementation's comment, or else the signature's.
    expect(undocumentedThrows("probe.ts", head.replace("COMMENT", "  /** Reads a size. */") + brief + implementation))
      .toEqual({ read: 1, problems: ["probe.ts:6: the comment on constructor does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", head.replace("COMMENT", "  /** Reads a size. */") + implementation))
      .toEqual({ read: 1, problems: ["probe.ts:3: the comment on constructor does not say what it throws"] });
  });

  test("a throw that the function itself catches, or that sits in a nested function, is not the function's own", () => {
    expect(undocumentedThrows("probe.ts", "/** Reads a size. */\nfunction f(): number { try { throw new Error(\"no size\"); } catch { return 0; } }"))
      .toEqual({ read: 0, problems: [] });
    expect(undocumentedThrows("probe.ts", "/** Makes a thrower. */\nfunction f(): () => never { return () => { throw new Error(\"no size\"); }; }"))
      .toEqual({ read: 0, problems: [] });
    // A throw in a finally block, or in a try with no catch, leaves the function.
    expect(undocumentedThrows("probe.ts", "/** Reads a size. */\nfunction f(): number { try { return 1; } finally { throw new Error(\"no size\"); } }").read).toBe(1);
    expect(undocumentedThrows("probe.ts", "/** Reads a size. */\nfunction f(): number { try { throw new Error(\"no size\"); } finally { void 0; } }").read).toBe(1);
    // A function with no comment is not held to it: the skill requires no comment.
    expect(undocumentedThrows("probe.ts", "function f(): number { throw new Error(\"no size\"); }")).toEqual({ read: 0, problems: [] });
  });

  test("a function either side of ??, || or && is read as the function it may be", () => {
    for (const value of [
      "other ?? ((n: number): number => n + 1)",
      "other || ((n: number): number => n + 1)",
      "other && ((n: number): number => n + 1)",
      "((n: number): number => n + 1) ?? other",
      "((n: number): number => n + 1) || other",
      "other ?? (other || ((n: number): number => n + 1))",
    ]) {
      expect(boundHelpers("probe.ts", `export function main(other: number | undefined): number {\n  const helper = ${value};\n  return 0;\n}\n`), value)
        .toEqual(["probe.ts / main / helper"]);
    }
    expect(boundHelpers("probe.ts", "export function main(other: number | undefined): number {\n  const size = other ?? 1;\n  return size;\n}\n")).toEqual([]);
    for (const operator of ["??", "||", "&&"]) {
      expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const read = other ${operator} ((): never => {\n  throw new RangeError("size");\n});`), operator)
        .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    }
    // A function on the left of && is never falsy, so it is never the value, and nor is an object or array literal there.
    expect(boundHelpers("probe.ts", "export function main(other: number): number {\n  const size = ((n: number): number => n) && other;\n  return size;\n}\n")).toEqual([]);
    for (const body of ["const { helper } = { helper: (n: number): number => n } && other;", "const [helper] = [(n: number): number => n] && other;"]) {
      expect(boundHelpers("probe.ts", `export function main(other: { helper: number } & number[]): number {\n  ${body}\n  return 0;\n}\n`), body).toEqual([]);
    }
    expect(boundHelpers("probe.ts", "export function main(other: { helper: number } | undefined): number {\n  const { helper } = other && { helper: (n: number): number => n };\n  return 0;\n}\n"))
      .toEqual(["probe.ts / main / helper"]);
    // A comma list, or an assignment, is the value on its right.
    expect(boundHelpers("probe.ts", "export function main(other: number): number {\n  const helper = (other, (n: number): number => n);\n  return 0;\n}\n"))
      .toEqual(["probe.ts / main / helper"]);
  });

  test("a function default is read even where the literal's own value means it never runs", () => {
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    for (const statement of [
      `export const { inner: { read } = { read: ${thrower} } } = { inner: { read: (): number => 1 } };`,
      `export const { read = ${thrower} } = { read: (): number => 1 };`,
      `export const [read = ${thrower}] = [(): number => 1] as const;`,
      `export const [[read] = [${thrower}]] = [[1]] as const;`,
      `export const { a: { b: { read = ${thrower} } = { read: 1 } } } = { a: { b: { read: (): number => 1 } } };`,
    ]) {
      expect(undocumentedThrows("probe.ts", `/** Reads a size. */\n${statement}`), statement)
        .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
      expect(undocumentedThrows("probe.ts", `/**\n * Reads a size.\n * @throws A \`RangeError\` always.\n */\n${statement}`), statement)
        .toEqual({ read: 1, problems: [] });
    }
    // A name read from both its value and its default is one function to the check, reported once.
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const { read = ${thrower} } = { read: ${thrower} };`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    for (const body of [
      "const { inner: { helper } = { helper: (n: number): number => n + 1 } } = { inner: { helper: 1 } };",
      "const { helper = (n: number): number => n + 1 } = { helper: (n: number): number => n };",
      "const [helper = (n: number): number => n + 1] = [(n: number): number => n] as const;",
      "const [[helper] = [(n: number): number => n + 1]] = [[1]] as const;",
    ]) {
      expect(boundHelpers("probe.ts", `export function main(): number {\n  ${body}\n  return 0;\n}\n`), body).toEqual(["probe.ts / main / helper"]);
    }
  });

  test("a function default is read when the value given is a literal that is not a function, at every depth", () => {
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    const forms: Array<[pattern: string, literal: string]> = [
      ["{ NAME = DEFAULT }", "{ NAME: 1 }"],
      ["[NAME = DEFAULT]", "[1] as const"],
      ["{ inner: { NAME = DEFAULT } }", "{ inner: { NAME: 1 } }"],
      ["{ a: { b: { NAME = DEFAULT } } }", "{ a: { b: { NAME: 1 } } }"],
      ["[[[NAME = DEFAULT]]]", "[[[1]]] as const"],
    ];
    for (const [pattern, literal] of forms) {
      const helper = `const ${pattern.replace("NAME", "helper").replace("DEFAULT", "(n: number): number => n + 1")} = ${literal.replace("NAME", "helper")};`;
      expect(boundHelpers("probe.ts", `export function main(): number {\n  ${helper}\n  return 0;\n}\n`), helper).toEqual(["probe.ts / main / helper"]);
      const read = `export const ${pattern.replace("NAME", "read").replace("DEFAULT", thrower)} = ${literal.replace("NAME", "read")};`;
      expect(undocumentedThrows("probe.ts", `/** Reads a size. */\n${read}`), read)
        .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    }
    expect(boundHelpers("probe.ts", "export function main({ helper = (n: number): number => n + 1 }: { helper: number | ((n: number) => number) } = { helper: 1 }): number {\n  return 0;\n}\n"))
      .toEqual(["probe.ts / main / helper"]);
  });

  test("a destructuring reads each literal a conditional or a ?? or || may give it", () => {
    for (const body of [
      "const { helper } = flag ? { helper: (n: number): number => n + 1 } : { helper: 1 };",
      "const { helper } = flag ? { helper: 1 } : { helper: (n: number): number => n + 1 };",
      "const [helper] = flag ? [1] : [(n: number): number => n + 1];",
      "const { inner: { helper } } = { inner: flag ? { helper: 1 } : { helper: (n: number): number => n + 1 } };",
      "const { helper } = other ?? { helper: (n: number): number => n + 1 };",
      "const { helper } = (flag ? { helper: 1 } : other || { helper: (n: number): number => n + 1 }) as { helper: unknown };",
      "const { helper } = flag ? { helper(n: number): number { return n + 1; } } : { helper: 1 };",
    ]) {
      expect(boundHelpers("probe.ts", `export function main(flag: boolean, other: { helper: number } | undefined): number {\n  ${body}\n  return 0;\n}\n`), body)
        .toEqual(["probe.ts / main / helper"]);
    }
    expect(boundHelpers("probe.ts", "export function main(flag: boolean): number {\n  const { size } = flag ? { size: 1 } : { size: 2 };\n  return size;\n}\n")).toEqual([]);
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    for (const statement of [
      `export const { read } = flag ? { read: ${thrower} } : { read: (): number => 1 };`,
      `export const [read] = flag ? [1] : [${thrower}];`,
      `export const { inner: { read } } = { inner: flag ? { read: 1 } : { read: ${thrower} } };`,
      `export const { read } = other ?? { read: ${thrower} };`,
      // A function on both sides is one function to the check, reported once.
      `export const { read } = flag ? { read: ${thrower} } : { read: ${thrower} };`,
    ]) {
      expect(undocumentedThrows("probe.ts", `/** Reads a size. */\n${statement}`), statement)
        .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
      expect(undocumentedThrows("probe.ts", `/**\n * Reads a size.\n * @throws A \`RangeError\` when the flag is set.\n */\n${statement}`), statement)
        .toEqual({ read: 1, problems: [] });
    }
  });

  test("a spread of a string literal gives one position for each character, as a spread of a string does when it runs", () => {
    // A character outside the basic plane is two UTF-16 units but one position, so it tells the two ways of counting apart.
    const text = `a${String.fromCodePoint(0x1f600)}`;
    const helper = "(n: number): number => n + 1";
    const bound: Array<[pattern: string, literal: string, found: string[]]> = [
      ["[, , helper]", `[..."${text}", ${helper}] as const`, ["probe.ts / main / helper"]],
      ["[, helper]", `[..."${text}", ${helper}] as const`, []],
      ["[, , , helper]", `[..."${text}", ${helper}] as const`, []],
      ["[, , helper]", `[...\`ab\`, ${helper}] as const`, ["probe.ts / main / helper"]],
      ["[, , helper]", `[...[..."${text}"], ${helper}] as const`, ["probe.ts / main / helper"]],
      ["[helper]", `[..."", ${helper}] as const`, ["probe.ts / main / helper"]],
    ];
    for (const [pattern, literal, found] of bound) {
      expect(boundHelpers("probe.ts", `export function main(): number {\n  const ${pattern} = ${literal};\n  return 0;\n}\n`), `${pattern} = ${literal}`).toEqual(found);
    }
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const [, , read] = [..."${text}", ${thrower}] as const;`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", `/** The size. */\nexport const [, size] = [..."${text}", ${thrower}] as const;`)).toEqual({ read: 0, problems: [] });
  });

  test("a name whose position follows a spread of unknown length is reported, naming the name and the spread", () => {
    const helper = "(n: number): number => n + 1";
    const bound: Array<[pattern: string, literal: string, found: string[]]> = [
      ["[, helper]", `[...made(), ${helper}]`, [positionNotKnown("helper", "...made()")]],
      ["[first, , third]", "[1, ...made()]", [positionNotKnown("third", "...made()")]],
      ["[, , helper]", `[...[1, ...made()], ${helper}]`, [positionNotKnown("helper", "...made()")]],
      ["[, [inner]]", "[...made(), [1]]", [positionNotKnown("inner", "...made()")]],
      ["[, , helper]", `[...\`a\${other}\`, ${helper}]`, [positionNotKnown("helper", "...`a${other}`")]],
      ["[, helper]", `flag ? [1, ${helper}] : [...made(), 1]`, ["probe.ts / main / helper", positionNotKnown("helper", "...made()")]],
      ["{ inner: [, helper] }", `{ inner: [...made(), ${helper}] }`, [positionNotKnown("helper", "...made()")]],
      ["[, helper = 2]", `[...made(), ${helper}]`, [positionNotKnown("helper", "...made()")]],
      // A position before the spread is known, and a rest element binds an array, not an item.
      ["[helper, ...rest]", `[${helper}, ...made()]`, ["probe.ts / main / helper"]],
    ];
    for (const [pattern, literal, found] of bound) {
      expect(boundHelpers("probe.ts", `export function main(flag: boolean, other: string): number {\n  const ${pattern} = ${literal};\n  return 0;\n}\n`), `${pattern} = ${literal}`).toEqual(found);
    }
    expect(boundHelpers("probe.ts", `export function main([, helper] = [...made(), ${helper}]): number {\n  return 0;\n}\n`))
      .toEqual([positionNotKnown("helper", "...made()")]);
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const [, read] = [...made(), ${thrower}];`))
      .toEqual({ read: 0, problems: ["probe.ts:2: what read binds cannot be read, as its position follows ...made(), whose length is not known"] });
    expect(undocumentedThrows("probe.ts", `/**\n * Reads a size.\n * @throws A \`RangeError\` always.\n */\nexport const [, read] = [...made(), ${thrower}];`).problems)
      .toEqual(["probe.ts:5: what read binds cannot be read, as its position follows ...made(), whose length is not known"]);
  });

  test("a first function is read wherever the nested-helper check would find one, whatever its type says", () => {
    const fn = "(x: number): number => x";
    const text = `a${String.fromCodePoint(0x1f600)}`;
    // The declarations follow main, so that none of them is the first function.
    const tail = "\nexport function main(): number { return 1; }\ndeclare const other: number | undefined;\ndeclare const flag: boolean;\ndeclare function made(): number[];\n";
    for (const statement of [
      `const helper = other ?? (${fn});`,
      `const helper = other || (${fn});`,
      `const helper = other && (${fn});`,
      `const { helper } = flag ? { helper: ${fn} } : { helper: 1 };`,
      `const [helper] = flag ? [1] as const : [${fn}] as const;`,
      `const [, , helper] = [..."${text}", ${fn}] as const;`,
      `const { inner: { helper } = { helper: ${fn} } } = { inner: { helper: 1 } };`,
      `const { helper = ${fn} } = { helper: 1 };`,
      `const [helper = ${fn}] = [1] as const;`,
      `const { inner: { helper = ${fn} } } = { inner: { helper: 1 } };`,
      `const { a: { b: { helper = ${fn} } } } = { a: { b: { helper: 1 } } };`,
    ]) {
      expect(entryPointProblem("probe.ts", statement + tail), statement)
        .toEqual({ checked: true, problem: "probe.ts:1: the first function, helper, is not exported" });
      expect(entryPointProblem("probe.ts", `export ${statement}${tail}`), statement).toEqual({ checked: true, problem: null });
    }
    // A name whose position follows a spread of unknown length may be a function, so the first function cannot be found.
    expect(entryPointProblem("probe.ts", `const [, helper] = [...made(), ${fn}];${tail}`)).toEqual({
      checked: true,
      problem: "probe.ts:1: what helper holds cannot be read, as its position follows ...made(), whose length is not known, so the first function cannot be found",
    });
    // A name the literal gives no function, and whose type cannot be called, is not one.
    for (const statement of [`const [, size] = [..."${text}", ${fn}] as const;`, "const { size } = flag ? { size: 1 } : { size: 2 };", "const size = other ?? 1;"]) {
      expect(entryPointProblem("probe.ts", statement + tail), statement).toEqual({ checked: true, problem: null });
    }
    const module = `const [, helper] = [...made(), ${fn}];\nexport function runCli(): number { return 0; }\ndeclare function made(): number[];\n`;
    expect(shimProblem("probe-cli.ts", "import { runCli } from \"./probe.ts\";\nprocess.exit(runCli());", "probe.ts", module))
      .toBe("probe-cli.ts runs runCli, but probe.ts leads with helper, which cannot be read, as its position follows ...made(), whose length is not known");
  });

  test("a documented statement is read for every name it declares, not only the first", () => {
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    for (const statement of [
      `export const size = 1, read = ${thrower};`,
      `export const size = 1, { read } = { read: ${thrower} };`,
      `export const read = ${thrower}, size = 1;`,
    ]) {
      expect(undocumentedThrows("probe.ts", `/** Reads a size. */\n${statement}`), statement)
        .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    }
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const read = ${thrower}, write = ${thrower};`).problems)
      .toEqual(["probe.ts:2: the comment on read does not say what it throws", "probe.ts:2: the comment on write does not say what it throws"]);
  });

  test("a spread of an object literal gives its keys, and a key a spread of anything else may give is reported", () => {
    const helper = "(n: number): number => n + 1";
    const bound: Array<[body: string, found: string[]]> = [
      [`const { helper } = { ...{ helper: ${helper} } };`, ["probe.ts / main / helper"]],
      [`const { helper } = { ...Object.freeze({ helper: ${helper} }) };`, ["probe.ts / main / helper"]],
      [`const { helper } = { ...{ ...{ helper: ${helper} } } };`, ["probe.ts / main / helper"]],
      [`const { inner: { helper } } = { ...made(), inner: { helper: ${helper} } };`, ["probe.ts / main / helper"]],
      ["const { size } = { ...{ size: 1 } };", []],
      // A key given after the spread is settled there, whatever the spread holds.
      ["const { size } = { ...made(), size: 1 };", []],
      ["const { size } = { ...made(), ...{ size: 1 } };", []],
      ["const { size } = { ...made() };", [keyNotKnown("size", "...made()")]],
      ["const { size } = { ...{ ...made() } };", [keyNotKnown("size", "...made()")]],
      ["const { inner: { size } } = { inner: { ...made() } };", [keyNotKnown("size", "...made()")]],
      [`const { helper } = { helper: ${helper}, ...made() };`, ["probe.ts / main / helper", keyNotKnown("helper", "...made()")]],
    ];
    for (const [body, found] of bound) {
      expect(boundHelpers("probe.ts", `export function main(): number {\n  ${body}\n  return 0;\n}\n`), body).toEqual(found);
    }
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const { read } = { ...{ read: ${thrower} } };`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const { read } = { ...made() };`))
      .toEqual({ read: 0, problems: ["probe.ts:2: what read binds cannot be read, as its key may be given by ...made(), whose keys are not known"] });
    const tail = "\nexport function main(): number { return 1; }\ndeclare function made(): { helper: number };\n";
    expect(entryPointProblem("probe.ts", `const { helper } = { ...{ helper: ${helper} } };${tail}`))
      .toEqual({ checked: true, problem: "probe.ts:1: the first function, helper, is not exported" });
    expect(entryPointProblem("probe.ts", `const { helper } = { ...made() };${tail}`)).toEqual({
      checked: true,
      problem: "probe.ts:1: what helper holds cannot be read, as its key may be given by ...made(), whose keys are not known, so the first function cannot be found",
    });
  });

  test("a rest element with a pattern reads the items left over, and one with a name binds an array", () => {
    const helper = "(n: number): number => n + 1";
    const bound: Array<[body: string, found: string[]]> = [
      [`const [...[helper]] = [${helper}] as const;`, ["probe.ts / main / helper"]],
      [`const [...[helper = ${helper}]] = [0];`, ["probe.ts / main / helper"]],
      [`const [, ...[helper]] = [1, ${helper}] as const;`, ["probe.ts / main / helper"]],
      [`const [, ...[, helper]] = [1, 2, ${helper}] as const;`, ["probe.ts / main / helper"]],
      [`const [...{ 0: helper }] = [${helper}] as const;`, ["probe.ts / main / helper"]],
      [`const [, ...[helper]] = [${helper}, 1] as const;`, []],
      [`const [...rest] = [${helper}] as const;`, []],
      [`const [, ...[helper]] = [...made(), ${helper}];`, [positionNotKnown("helper", "...made()")]],
    ];
    for (const [body, found] of bound) {
      expect(boundHelpers("probe.ts", `export function main(): number {\n  ${body}\n  return 0;\n}\n`), body).toEqual(found);
    }
    const tail = "\nexport function main(): number { return 1; }\n";
    expect(entryPointProblem("probe.ts", `const [...[helper]] = [${helper}];${tail}`))
      .toEqual({ checked: true, problem: "probe.ts:1: the first function, helper, is not exported" });
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const [...[read]] = [${thrower}] as const;`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    // A rest element with a name binds the array of what is left, which is not a function.
    expect(undocumentedThrows("probe.ts", `/** Holds readers. */\nexport const [...readers] = [${thrower}];`)).toEqual({ read: 0, problems: [] });
    expect(undocumentedThrows("probe.ts", `/** Holds readers. */\nexport const [first, ...readers] = [1, ${thrower}];`)).toEqual({ read: 0, problems: [] });
  });

  test("an object pattern read against an array literal takes each index key from the items", () => {
    const helper = "(n: number): number => n + 1";
    const bound: Array<[body: string, found: string[]]> = [
      [`const { 0: helper } = [${helper}] as const;`, ["probe.ts / main / helper"]],
      [`const { "0": helper } = [${helper}] as const;`, ["probe.ts / main / helper"]],
      [`const { 1: helper } = [1, ${helper}] as const;`, ["probe.ts / main / helper"]],
      [`const { 1: helper } = [...[1] as const, ${helper}] as const;`, ["probe.ts / main / helper"]],
      [`const { 0: helper } = [1, ${helper}] as const;`, []],
      // A key that is not an index names no item.
      [`const { length } = [${helper}] as const;`, []],
      [`const { "00": helper } = [${helper}];`, []],
      [`const { 1: helper } = [...made(), ${helper}];`, [positionNotKnown("helper", "...made()")]],
    ];
    for (const [body, found] of bound) {
      expect(boundHelpers("probe.ts", `export function main(): number {\n  ${body}\n  return 0;\n}\n`), body).toEqual(found);
    }
    const tail = "\nexport function main(): number { return 1; }\n";
    expect(entryPointProblem("probe.ts", `const { 0: helper } = [${helper}];${tail}`))
      .toEqual({ checked: true, problem: "probe.ts:1: the first function, helper, is not exported" });
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const { 0: read } = [${thrower}] as const;`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
  });

  test("a function a call may give back is read as the value of the call", () => {
    const helper = "(n: number): number => n + 1";
    const declared = "\nfunction identity<T>(value: T): T {\n  return value;\n}\nfunction wrap(given: (n: number) => number): (n: number) => number {\n  return given;\n}\n"
      + "declare function schedule(callback: () => void): () => void;\n";
    const bound: Array<[body: string, found: string[]]> = [
      [`const helper = identity<(n: number) => number>(${helper});`, ["probe.ts / main / helper"]],
      [`const helper = identity(identity(${helper}));`, ["probe.ts / main / helper"]],
      [`const helper = Object.assign<(n: number) => number, { unit: string }>(${helper}, { unit: "items" });`, ["probe.ts / main / helper"]],
      [`const helper = Object.freeze(${helper});`, ["probe.ts / main / helper"]],
      [`const helper = Object.freeze((${helper}) satisfies (n: number) => number);`, ["probe.ts / main / helper"]],
      [`const { helper } = identity({ helper: ${helper} });`, ["probe.ts / main / helper"]],
      // A function declared here that returns its parameter gives back what it is given, generic or not.
      [`const helper = wrap(${helper});`, ["probe.ts / main / helper"]],
      // A call whose declared result is not what it is given hands the function on.
      ["const cancel = schedule((): void => undefined);", []],
      [`const sizes = [1].map(${helper});`, []],
    ];
    for (const [body, found] of bound) {
      expect(boundHelpers("probe.ts", `export function main(): number {\n  ${body}\n  return 0;\n}\n${declared}`), body).toEqual(found);
    }
    // A call whose function cannot be found may give back what it is given.
    expect(boundHelpers("probe.ts", `export function main(untyped: any): number {\n  const helper = untyped.wrap(${helper});\n  return 0;\n}\n`)).toEqual(["probe.ts / main / helper"]);
    const tail = `\nexport function main(): number { return 1; }${declared}`;
    expect(entryPointProblem("probe.ts", `const helper = identity<((n: number) => number) | undefined>(${helper});${tail}`))
      .toEqual({ checked: true, problem: "probe.ts:1: the first function, helper, is not exported" });
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const read = identity(${thrower});${declared}`).problems)
      .toEqual(["probe.ts:2: the comment on read does not say what it throws"]);
  });

  test("a rethrow from a rejection handler is found however the method it is handed to is written", () => {
    for (const call of ["(read().catch)(HANDLER)", "((read()).catch)(HANDLER)", "(read().then)(undefined, HANDLER)", "read()[\"catch\"](HANDLER)", "read().catch(function (failure: unknown): never {\n    throw failure;\n  })"]) {
      const text = `export function passOn(read: () => Promise<string>): Promise<string> {\n  return ${call.replace("HANDLER", "(failure: unknown) => {\n    throw failure;\n  }")};\n}\n`;
      expect(throwsSomeName(text), call).toBe(true);
      expect(rethrows("probe.ts", text), call).toEqual(["probe.ts / (an unnamed function) / throw failure;"]);
    }
  });

  test("a computed key written as a literal is read as the key it gives, and one that is not known is reported", () => {
    const helper = "(n: number): number => n + 1";
    const bound: Array<[body: string, found: string[]]> = [
      [`const { [\`helper\`]: helper } = { helper: ${helper} };`, ["probe.ts / main / helper"]],
      [`const { helper } = { [\`helper\`]: ${helper} };`, ["probe.ts / main / helper"]],
      [`const { [0]: helper } = { 0: ${helper} };`, ["probe.ts / main / helper"]],
      [`const { [KEY]: helper } = { helper: ${helper} };`, ["probe.ts / main / helper"]],
      [`const { helper } = { [KEY]: ${helper} };`, ["probe.ts / main / helper"]],
      [`const { [name]: helper } = { helper: ${helper} };`, ["probe.ts / main / helper: its key, [name], is not known, so what it holds cannot be read"]],
      [`const { helper } = { [name]: ${helper} };`, ["probe.ts / main / helper: its key may be given by [name], whose value is not known, so what it holds cannot be read"]],
      [`const { helper } = { [name]: ${helper}, helper: 1 };`, []],
    ];
    for (const [body, found] of bound) {
      expect(boundHelpers("probe.ts", `const KEY = "helper";\nexport function main(name: string): number {\n  ${body}\n  return 0;\n}\n`), body).toEqual(found);
    }
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const { [\`read\`]: read } = { read: ${thrower} };`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
  });

  test("a comment on a function inside a wrapper is the function's own, wherever the function sits", () => {
    const thrower = "((): never => {\n    throw new RangeError(\"size\");\n  })";
    const said = "/**\n   * Reads a size.\n   * @throws A `RangeError` always.\n   */";
    for (const wrapped of [`${thrower} satisfies () => never`, `${thrower} as () => never`, `${thrower}!`]) {
      expect(undocumentedThrows("probe.ts", `/** Holds readers. */\nexport const readers = [\n  /** Reads a size. */\n  ${wrapped},\n] as const;`), wrapped)
        .toEqual({ read: 1, problems: ["probe.ts:4: the comment on an array item does not say what it throws"] });
      expect(undocumentedThrows("probe.ts", `/** Holds readers. */\nexport const readers = [\n  ${said}\n  ${wrapped},\n] as const;`), wrapped).toEqual({ read: 1, problems: [] });
      // With destructuring, the item's own comment is read, not the statement's.
      expect(undocumentedThrows("probe.ts", `/** Holds readers. */\nexport const [read] = [\n  ${said}\n  ${wrapped},\n] as const;`), wrapped).toEqual({ read: 1, problems: [] });
      expect(undocumentedThrows("probe.ts", `/**\n * Holds readers.\n * @throws A \`RangeError\` always.\n */\nexport const [read] = [\n  /** Reads a size. */\n  ${wrapped},\n] as const;`), wrapped)
        .toEqual({ read: 1, problems: ["probe.ts:7: the comment on an array item does not say what it throws"] });
    }
    // A comment after a property's colon, or on a function handed to a call, is the function's own too.
    expect(undocumentedThrows("probe.ts", `export const reader = {\n  read: /** Reads a size. */ ${thrower},\n};`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", `export function main(): void {\n  run(/** Reads a size. */ ${thrower});\n}\ndeclare function run(read: () => never): void;\n`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on an unnamed function does not say what it throws"] });
  });

  test("every function written in the repository ends in a place the rules read", () => {
    let placed = 0;
    const problems: string[] = [];
    for (const file of typescriptFiles()) {
      const { source, checker } = repositorySource(file);
      const found = placementsIn(file, source, checker, ALLOWED_POSITIONS);
      placed += found.placed;
      problems.push(...found.problems);
    }
    expect(problems).toEqual([]);
    // A walk that placed nothing would find nothing wrong, so the count must be the size a walk of this repository gives.
    expect(placed).toBeGreaterThan(2000);
  });

  test("the kinds the placement check names are the kinds the installed compiler counts as function-like", () => {
    const counted = new Set(Object.values(ts.SyntaxKind).filter((kind): kind is ts.SyntaxKind => typeof kind === "number" && ts.isFunctionLike({ kind } as unknown as ts.Node)));
    const named = new Set([...Object.keys(FOLLOWED_KINDS), ...Object.keys(TYPE_KINDS)].map((name) => ts.SyntaxKind[name as keyof typeof ts.SyntaxKind]));
    expect([...named].sort()).toEqual([...counted].sort());
    expect(Object.keys(FOLLOWED_KINDS).filter((name) => name in TYPE_KINDS)).toEqual([]);
    // Each reason is one line.
    for (const reason of [...Object.values(TYPE_KINDS), ...Object.values(ALLOWED_POSITIONS)]) {
      expect(reason.trim() !== "" && !reason.includes("\n"), reason).toBe(true);
    }
  });

  test("a function that ends in a place the allowed list does not name fails, naming the function and its line", () => {
    const cases: Array<[text: string, problems: string[]]> = [
      ["(() => 1)();\n", ["probe.ts:1: an arrow function cannot be placed: it is called where it is written, a place the allowed list does not name"]],
      ["export function main(): number {\n  for (const check of [(): number => 1]) check();\n  return 0;\n}\n",
        ["probe.ts:2: an arrow function cannot be placed: it sits in a ForOfStatement, a place the allowed list does not name"]],
      ["export const tested = ((): number => 1) && 2;\n", ["probe.ts:1: an arrow function cannot be placed: it sits in a BinaryExpression, a place the allowed list does not name"]],
      ["export const listed = [(): number => 1].map((check) => check());\n",
        ["probe.ts:1: an arrow function cannot be placed: it sits in a PropertyAccessExpression, a place the allowed list does not name"]],
      ["export const text = `${String((): number => 1)}`;\n", []],
      ["let later: (() => number) | undefined;\nlater = (): number => 1;\nexport const used = later;\n",
        ["probe.ts:2: an arrow function cannot be placed: it is assigned to later at the top level of the module, which the entry-point rule does not read"]],
      ["run(...[(): number => 1]);\ndeclare function run(...checks: Array<() => number>): void;\n",
        ["probe.ts:1: an arrow function cannot be placed: it sits in a SpreadElement, a place the allowed list does not name"]],
      // A call whose function cannot be found may give back what it is given, so its value is followed on, here to a statement that drops it.
      ["made((): number => 1);\n", ["probe.ts:1: an arrow function cannot be placed: it sits in an ExpressionStatement, a place the allowed list does not name"]],
      ["export function main(untyped: any): number {\n  const helper = untyped.wrap((n: number): number => n);\n  return helper(1);\n}\n", []],
      ["export const { length } = (): number => 1;\n",
        ["probe.ts:1: an arrow function cannot be placed: a name may take it, but which one cannot be read, as it is read from a function as though the function were a literal"]],
      ["export function main(): number {\n  const [, helper] = [...made(), (n: number): number => n];\n  return 0;\n}\n",
        ["probe.ts:2: an arrow function cannot be placed: a name may take it, but which one cannot be read, as its position follows ...made(), whose length is not known"]],
      ["export const helper = ((): (() => number) => (): number => 1)();\n", [
        "probe.ts:1: an arrow function cannot be placed: it is called where it is written, a place the allowed list does not name",
        "probe.ts:1: an arrow function cannot be placed: it is returned by a function called where it is written, a place the allowed list does not name",
      ]],
    ];
    for (const [text, problems] of cases) {
      expect(unplacedFunctions("probe.ts", text).problems, text).toEqual(problems);
    }
  });

  test("each allowed position places a function, and a position whose reason is missing places none", () => {
    const reached: Readonly<Record<string, string>> = {
      "a function declaration": "export function main(): number {\n  return 1;\n}\n",
      "a class member": "export class Reader {\n  read = (): number => 1;\n}\n",
      "an argument to a call that does not give it back": "export const sizes = [1].map((size) => size + 1);\n",
      "returned from a function": "export function make(): () => number {\n  return (): number => 1;\n}\n",
      "held in a value bound to a name": "export const reader = { read: (): number => 1 };\n",
      "a part of a literal no name takes": "export const { size } = { size: 1, read: (): number => 1 };\n",
      "stored on a property": "export function main(reader: { read: () => number }): void {\n  reader.read = (): number => 2;\n}\n",
    };
    expect(Object.keys(reached).sort()).toEqual(Object.keys(ALLOWED_POSITIONS).sort());
    for (const [position, text] of Object.entries(reached)) {
      const found = unplacedFunctions("probe.ts", text);
      expect(found.problems, position).toEqual([]);
      expect(found.placed, position).toBeGreaterThan(0);
      const emptied = unplacedFunctions("probe.ts", text, { ...ALLOWED_POSITIONS, [position]: "" }).problems;
      expect(emptied.some((problem) => problem.endsWith(`is ${position}, which has no reason on the allowed list`)), position).toBe(true);
      const removed = Object.fromEntries(Object.entries(ALLOWED_POSITIONS).filter(([name]) => name !== position));
      expect(unplacedFunctions("probe.ts", text, removed).problems.length, position).toBeGreaterThan(0);
    }
    // A function bound to a name is placed by the rules that read the name, not by the list.
    expect(unplacedFunctions("probe.ts", "export const read = (): number => 1;\n")).toEqual({ placed: 1, problems: [] });
  });

  test("a function assigned to a name inside a function is a nested helper", () => {
    for (const assignment of ["helper = (n: number): number => n + 1;", "helper ??= (n: number): number => n + 1;", "(helper) = (n: number): number => n + 1;"]) {
      const text = `export function main(): number {\n  let helper: ((n: number) => number) | undefined;\n  ${assignment}\n  return helper(1);\n}\n`;
      expect(boundHelpers("probe.ts", text), assignment).toEqual(["probe.ts / main / helper"]);
      expect(unplacedFunctions("probe.ts", text).problems, assignment).toEqual([]);
    }
    // A function stored on a property is handed on.
    expect(boundHelpers("probe.ts", "export function main(reader: { read: () => number }): void {\n  reader.read = (): number => 2;\n}\n")).toEqual([]);
  });
});

/** The entry the nested-helper check gives a name of main in probe.ts whose position follows a spread of unknown length. */
function positionNotKnown(name: string, spread: string): string {
  return `probe.ts / main / ${name}: its position follows ${spread}, whose length is not known, so what it holds cannot be read`;
}

/** The entry the nested-helper check gives a name of main in probe.ts whose key a spread of unknown keys may give. */
function keyNotKnown(name: string, spread: string): string {
  return `probe.ts / main / ${name}: its key may be given by ${spread}, whose keys are not known, so what it holds cannot be read`;
}

/** What the entry-point check found in one module. */
interface EntryPoint {
  /** Whether the module holds a top-level function, so that the rule applies. */
  checked: boolean;
  /** A "file:line: problem" entry when the first function is not exported, or null. */
  problem: string | null;
}

/**
 * Whether a module's first top-level function is exported.
 *
 * A function is a function declaration, or a top-level variable whose type
 * can be called: an arrow, a function expression, or a function that a call
 * wraps or returns. A name bound by destructuring counts as a variable does.
 * A value a call builds with a callback is not one. A variable is a function
 * too wherever the nested-helper check would find one, through each value
 * it may be and each default, whatever its type says. A name that a spread
 * of unknown extent may give its value may be one, so the first function
 * cannot be found past it, and that is the problem.
 */
function entryPointProblem(file: string, text: string): EntryPoint {
  const { source, checker } = typedSource(file, text);
  const first = firstFunction(source, checker);
  if (first === null) return { checked: false, problem: null };
  const line = source.getLineAndCharacterOfPosition(first.statement.getStart(source)).line + 1;
  if (first.unknownAfter !== null) {
    return { checked: true, problem: `${file}:${line}: what ${first.name} holds cannot be read, as ${unknownReason(first.unknownAfter, source)}, so the first function cannot be found` };
  }
  if (exportedNames(source, first).length > 0) return { checked: true, problem: null };
  return { checked: true, problem: `${file}:${line}: the first function, ${first.name}, is not exported` };
}

/** The first top-level function of a module. */
interface FirstFunction {
  name: string;
  exported: boolean;
  statement: ts.Statement;
  /** What makes a destructured name's value unknown, so it may be the first function; or null. */
  unknownAfter: UnknownCause | null;
}

/**
 * The first top-level function of a module, or the first name that may be
 * one but cannot be read, or null when it holds neither.
 */
function firstFunction(source: ts.SourceFile, checker: ts.TypeChecker): FirstFunction | null {
  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement)
      && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      return { name: statement.name.text, exported, statement, unknownAfter: null };
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const reading = readBinding(declaration.name, declaration.initializer, checker);
      const written = new Set(helperNames(reading, checker));
      for (const name of boundNames(declaration.name)) {
        if (written.has(name) || checker.getTypeAtLocation(name).getCallSignatures().length > 0) {
          return { name: name.text, exported, statement, unknownAfter: null };
        }
        const position = reading.unknown.find((found) => found.name === name);
        if (position !== undefined) return { name: name.text, exported, statement, unknownAfter: position.cause };
      }
    }
  }
  return null;
}

/** Each name a declaration binds, in the order they appear, through any destructuring. */
function boundNames(binding: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(binding)) return [binding];
  return binding.elements.flatMap((element) => ts.isOmittedExpression(element) ? [] : boundNames(element.name));
}

/**
 * The functions an expression may hold: each value `possibleValues` gives
 * that is an arrow function or a function expression. A call that runs a
 * callback to build a value, as `map` does, gives back what the callback
 * returns, not the callback, so it holds none.
 *
 * @returns Each arrow function or function expression, none when the
 *     expression holds neither or is undefined.
 */
function functionValues(expression: ts.Expression | undefined, checker: ts.TypeChecker): Array<ts.ArrowFunction | ts.FunctionExpression> {
  return possibleValues(expression, checker).filter(isFunctionValue);
}

/** Whether an expression is an arrow function or a function expression. */
function isFunctionValue(expression: ts.Expression): expression is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
}

/** The operators whose result may be either side: `??` and `||`, and the assignments that use them. */
const EITHER_SIDE = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
]);

/** The operators whose result is the left side only when it is falsy: `&&`, and the assignment that uses it. */
const RIGHT_UNLESS_FALSY = new Set<ts.SyntaxKind>([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken]);

/** No function's body is being read, as `possibleValues` begins. */
const NOTHING_FOLLOWED: ReadonlySet<ts.Node> = new Set();

/**
 * Each value an expression may be, read through the wrappers `heldValue`
 * looks through. A conditional may be either branch. `??` and `||` may be
 * either side. `&&` may be its right side, or its left side when that is
 * falsy, which a function, an object literal or an array literal never is.
 * A comma list, or an assignment, is the value on its right. A call, or
 * `new`, may be each argument `givenBack` finds it gives back, and is
 * itself the value when it gives back none.
 *
 * @param following The functions whose bodies `givenBack` is reading
 *     already, so that a function that calls itself is read once.
 * @returns Each value, in the order it is written; none when given undefined.
 */
function possibleValues(expression: ts.Expression | undefined, checker: ts.TypeChecker, following: ReadonlySet<ts.Node> = NOTHING_FOLLOWED): ts.Expression[] {
  const inner = heldValue(expression);
  if (inner === undefined) return [];
  if (ts.isConditionalExpression(inner)) return [...possibleValues(inner.whenTrue, checker, following), ...possibleValues(inner.whenFalse, checker, following)];
  if (ts.isCallExpression(inner) || ts.isNewExpression(inner)) {
    const given = givenBack(inner, checker, following);
    return given.length === 0 ? [inner] : given;
  }
  if (!ts.isBinaryExpression(inner)) return [inner];
  const operator = inner.operatorToken.kind;
  if (EITHER_SIDE.has(operator)) return [...possibleValues(inner.left, checker, following), ...possibleValues(inner.right, checker, following)];
  if (RIGHT_UNLESS_FALSY.has(operator)) {
    return [...possibleValues(inner.left, checker, following).filter((value) => !isAlwaysTruthy(value)), ...possibleValues(inner.right, checker, following)];
  }
  if (operator === ts.SyntaxKind.CommaToken || operator === ts.SyntaxKind.EqualsToken) return possibleValues(inner.right, checker, following);
  return [inner];
}

/** Whether an expression is a function, an object literal or an array literal, none of which is ever falsy. */
function isAlwaysTruthy(expression: ts.Expression): boolean {
  return isFunctionValue(expression) || ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression);
}

/**
 * The value an expression holds, looking through parentheses, a type
 * assertion, `satisfies` and `!`, none of which changes what runs.
 *
 * @returns The innermost expression, or undefined when given undefined.
 */
function heldValue(expression: ts.Expression | undefined): ts.Expression | undefined {
  let inner = expression;
  while (inner !== undefined && (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)
    || ts.isTypeAssertionExpression(inner) || ts.isNonNullExpression(inner))) {
    inner = inner.expression;
  }
  return inner;
}

/** The one value an expression may be, as `possibleValues` reads it, or undefined when it may be more than one. */
function singleValue(expression: ts.Expression, checker: ts.TypeChecker): ts.Expression | undefined {
  const values = possibleValues(expression, checker);
  return values.length === 1 ? values[0] : undefined;
}

/**
 * The values a call, or `new`, may give back as its own value: each value,
 * as `possibleValues` reads it, of an argument the call may give back. An
 * argument may be given back when the parameter it is passed to is declared
 * with a type parameter of the call's own signature that the declared result
 * uses too, outside any function type, as with `Object.freeze`,
 * `Object.assign` and an identity function; then each of its values whose
 * type fits the result, or a type the result intersects, is given back. A
 * type parameter used only inside a function type, as `map` uses one for
 * what its callback returns, gives back what the callback returns, not the
 * callback. Every value of an argument is given back when the function
 * called is declared here with a body that returns that parameter, generic
 * or not, and when the function called cannot be found, as for a method of
 * a value typed any, since that may give back anything it is given.
 *
 * @returns Each value given back, in the order written.
 */
function givenBack(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker, following: ReadonlySet<ts.Node>): ts.Expression[] {
  const declaration = calledDeclaration(call, checker);
  const result = checker.getTypeAtLocation(call);
  const given: ts.Expression[] = [];
  for (const [at, argument] of (call.arguments ?? []).entries()) {
    const parameter = declaration === undefined ? undefined : parameterOf(declaration, call, at);
    if (declaration === undefined || (parameter !== undefined && returnsParameter(declaration, parameter, checker, following))) {
      given.push(...possibleValues(argument, checker, following));
    } else if (parameter !== undefined && sharesTypeParameter(declaration, parameter)) {
      given.push(...possibleValues(argument, checker, following).filter((value) => fitsResult(checker.getTypeAtLocation(value), result, checker)));
    }
  }
  return given;
}

/** The declaration of the signature a call, or `new`, resolves to, or undefined when the function called cannot be found. */
function calledDeclaration(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker): ts.SignatureDeclaration | undefined {
  // The type says a signature always has a declaration, but one the checker cannot resolve has none.
  const declaration: ts.SignatureDeclaration | ts.JSDocSignature | undefined = checker.getResolvedSignature(call)?.getDeclaration();
  return declaration === undefined || ts.isJSDocSignature(declaration) ? undefined : declaration;
}

/**
 * The parameter of a declaration that one argument of a call is passed to,
 * reading a rest parameter for each argument from its position on.
 *
 * @returns The parameter, or undefined when a spread at or before the
 *     argument hides which parameter it is passed to, or there is none.
 */
function parameterOf(declaration: ts.SignatureDeclaration, call: ts.CallExpression | ts.NewExpression, at: number): ts.ParameterDeclaration | undefined {
  if ((call.arguments ?? []).slice(0, at + 1).some(ts.isSpreadElement)) return undefined;
  const parameters = declaration.parameters.filter((parameter) => !ts.isIdentifier(parameter.name) || parameter.name.text !== "this");
  const last = parameters.at(-1);
  if (last?.dotDotDotToken !== undefined && at >= parameters.length - 1) return last;
  return parameters[at];
}

/**
 * Whether a parameter's declared type uses, outside any function type, a
 * type parameter of its own signature that the signature's declared result
 * uses too, outside any function type.
 */
function sharesTypeParameter(declaration: ts.SignatureDeclaration, parameter: ts.ParameterDeclaration): boolean {
  if (parameter.type === undefined || declaration.type === undefined) return false;
  const own = new Set((declaration.typeParameters ?? []).map((typeParameter) => typeParameter.name.text));
  const result = typeNamesOutsideFunctions(declaration.type);
  return [...typeNamesOutsideFunctions(parameter.type)].some((name) => own.has(name) && result.has(name));
}

/** Each name a type refers to by a type reference, outside any function type within it. */
function typeNamesOutsideFunctions(type: ts.TypeNode): Set<string> {
  const names = new Set<string>();
  const pending: ts.Node[] = [type];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (ts.isFunctionLike(node)) continue;
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) names.add(node.typeName.text);
    // A callback that returns a value stops the walk, so this one returns nothing.
    ts.forEachChild(node, (child) => {
      pending.push(child);
    });
  }
  return names;
}

/** Whether a value of one type may be a call's whole result: it fits the result, or a type the result intersects. */
function fitsResult(given: ts.Type, result: ts.Type, checker: ts.TypeChecker): boolean {
  if (checker.isTypeAssignableTo(given, result)) return true;
  return result.isIntersection() && result.types.some((part) => checker.isTypeAssignableTo(given, part));
}

/**
 * Whether a function declared here with a body may return one of its
 * parameters: whether a value that one of its return statements, or its
 * expression body, may be is that parameter's name.
 */
function returnsParameter(declaration: ts.SignatureDeclaration, parameter: ts.ParameterDeclaration, checker: ts.TypeChecker, following: ReadonlySet<ts.Node>): boolean {
  if (!ts.isIdentifier(parameter.name) || following.has(declaration)) return false;
  const symbol = checker.getSymbolAtLocation(parameter.name);
  const deeper = new Set([...following, declaration]);
  return returnedExpressions(declaration).some((returned) => possibleValues(returned, checker, deeper)
    .some((value) => ts.isIdentifier(value) && checker.getSymbolAtLocation(value) === symbol));
}

/**
 * The expressions a function may return: its expression body, or the value
 * of each return statement of its own, not of a function nested in it.
 *
 * @returns Each expression, none when the declaration has no body.
 */
function returnedExpressions(declaration: ts.SignatureDeclaration): ts.Expression[] {
  const body = (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isConstructorDeclaration(declaration)
    || ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration) || ts.isFunctionExpression(declaration)
    || ts.isArrowFunction(declaration)) ? declaration.body : undefined;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return [body];
  const returned: ts.Expression[] = [];
  const pending: ts.Node[] = [body];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (ts.isReturnStatement(node) && node.expression !== undefined) returned.push(node.expression);
    ts.forEachChild(node, (child) => {
      if (!ts.isFunctionLike(child)) pending.push(child);
    });
  }
  return returned;
}

/** A source file with the type checker of the program that read it. */
interface TypedSource {
  source: ts.SourceFile;
  checker: ts.TypeChecker;
}

/**
 * A source file read by the compiler under this repository's options, so
 * that the type of what it declares can be asked. The file's text is given,
 * and anything it imports is read from disk.
 *
 * @param file The path from the repository root. The file need not exist.
 * @throws An `Error` when the compiler did not read the file.
 */
function typedSource(file: string, text: string): TypedSource {
  const fileName = compilerPath(file);
  const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
  host.getSourceFile = sourceReader(host.getSourceFile, fileName, text);
  const program = ts.createProgram([fileName], COMPILER_OPTIONS, host);
  const source = program.getSourceFile(fileName);
  if (source === undefined) throw new Error(`The compiler did not read ${file}.`);
  return { source, checker: program.getTypeChecker() };
}

/** The path the compiler gives a file of the repository: absolute, with forward slashes. */
function compilerPath(file: string): string {
  return join(REPOSITORY_ROOT, file).split(BACKSLASH).join("/");
}

/**
 * A compiler host's reader that gives one file the text given, and reads
 * every other file as `sharedReader` does.
 *
 * @returns The reader.
 */
function sourceReader(read: ts.CompilerHost["getSourceFile"], fileName: string, text: string): ts.CompilerHost["getSourceFile"] {
  const shared = sharedReader(read);
  return (name, version, onError) => name === fileName ? ts.createSourceFile(name, text, version, true) : shared(name, version, onError);
}

/**
 * A compiler host's reader that reads each file from disk once, through
 * SHARED_SOURCES.
 *
 * @returns The reader.
 */
function sharedReader(read: ts.CompilerHost["getSourceFile"]): ts.CompilerHost["getSourceFile"] {
  return (name, version, onError) => {
    const kept = SHARED_SOURCES.get(name);
    if (kept !== undefined) return kept;
    const made = read(name, version, onError);
    if (made !== undefined) SHARED_SOURCES.set(name, made);
    return made;
  };
}

/**
 * The program of every TypeScript file in the repository, read under this
 * repository's options. It is made once, by the first test that asks, and
 * the tests that read every file share it.
 */
function repositoryProgram(): ts.Program {
  const kept = REPOSITORY_PROGRAMS[0];
  if (kept !== undefined) return kept;
  const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
  host.getSourceFile = sharedReader(host.getSourceFile);
  const program = ts.createProgram(typescriptFiles().map(compilerPath), COMPILER_OPTIONS, host);
  REPOSITORY_PROGRAMS.push(program);
  return program;
}

/**
 * One file of the repository as the repository's program read it, with that
 * program's checker.
 *
 * @throws An `Error` when the program did not read the file.
 */
function repositorySource(file: string): TypedSource {
  const program = repositoryProgram();
  const source = program.getSourceFile(compilerPath(file));
  if (source === undefined) throw new Error(`The compiler did not read ${file}.`);
  return { source, checker: program.getTypeChecker() };
}

/**
 * Whether a command shim runs the first function of its module.
 *
 * @returns A sentence naming what the shim runs and what the module leads
 *     with when they differ, or why what it leads with cannot be read, or
 *     null when they match.
 */
function shimProblem(shim: string, shimText: string, module: string, moduleText: string): string | null {
  const run = shimEntryPoint(shim, shimText);
  const typed = typedSource(module, moduleText);
  const first = firstFunction(typed.source, typed.checker);
  if (first !== null && first.unknownAfter !== null) {
    return `${shim} runs ${run ?? "(no exit call)"}, but ${module} leads with ${first.name}, which cannot be read, as ${unknownReason(first.unknownAfter, typed.source)}`;
  }
  const exported = first === null ? [] : exportedNames(typed.source, first);
  if (run !== null && exported.includes(run)) return null;
  const alias = first !== null && exported.length > 0 && !exported.includes(first.name) ? `, exported as ${exported.join(" and ")}` : "";
  return `${shim} runs ${run ?? "(no exit call)"}, but ${module} leads with ${first?.name ?? "(no function)"}${alias}`;
}

/**
 * The names a module exports a top-level function under: its own name when
 * its declaration is exported, and each name an `export { local as name }`
 * list gives it.
 */
function exportedNames(source: ts.SourceFile, first: FirstFunction): string[] {
  const names = first.exported ? [first.name] : [];
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      if ((element.propertyName ?? element.name).text === first.name) names.push(element.name.text);
    }
  }
  return names;
}

/**
 * The function a command shim runs: the one whose result, awaited or not and
 * in parentheses or not, it passes to `process.exit` at the top level. The
 * function is called by its name, or through a namespace import as in
 * `cli.runCli()`, with the function or the namespace in parentheses or not.
 *
 * @returns The function's name as its module exports it, through any import
 *     alias, or null when no such call is found. A method of anything but a
 *     namespace import is not a function of the module, and gives null.
 */
function shimEntryPoint(file: string, text: string): string | null {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const exit = statement.expression;
    if (exit.expression.getText(source) !== "process.exit") continue;
    let call = exit.arguments[0];
    while (call !== undefined && (ts.isAwaitExpression(call) || ts.isParenthesizedExpression(call))) {
      call = call.expression;
    }
    if (call === undefined || !ts.isCallExpression(call)) continue;
    let callee: ts.Expression = call.expression;
    while (ts.isParenthesizedExpression(callee)) {
      callee = callee.expression;
    }
    if (ts.isIdentifier(callee)) return importedNames(source).get(callee.text) ?? callee.text;
    if (!ts.isPropertyAccessExpression(callee)) continue;
    let namespace: ts.Expression = callee.expression;
    while (ts.isParenthesizedExpression(namespace)) {
      namespace = namespace.expression;
    }
    if (ts.isIdentifier(namespace) && namespaceImports(source).has(namespace.text)) return callee.name.text;
  }
  return null;
}

/** The local names a module gives the modules it imports whole, as in `import * as cli`. */
function namespaceImports(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
  }
  return names;
}

/** Each local name a module imports by name, mapped to the name it is exported under. */
function importedNames(source: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of source.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      names.set(element.name.text, (element.propertyName ?? element.name).text);
    }
  }
  return names;
}

/**
 * Every throw in a file whose value is typed unknown or any, each as the
 * declaration of the value and the throw statement, in the order they appear.
 *
 * @returns One "declaration / statement" entry for each. A value that is not
 *     a declared name reads "(no declaration)".
 */
function unknownThrows(file: string, text: string): string[] {
  const { source, checker } = typedSource(file, text);
  const found: string[] = [];
  const pending: ts.Node[] = [source];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    pending.push(...[...node.getChildren(source)].reverse());
    if (!ts.isThrowStatement(node)) continue;
    const flags = checker.getTypeAtLocation(node.expression).flags;
    if ((flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) === 0) continue;
    const declaration = checker.getSymbolAtLocation(node.expression)?.valueDeclaration;
    found.push(`${declaration?.getText(source) ?? "(no declaration)"} / ${node.getText(source)}`);
  }
  return found;
}

/** Whether a file holds a throw of a bare name, the only form a rethrow takes. */
function throwsSomeName(text: string): boolean {
  const source = ts.createSourceFile("any-name.ts", text, ts.ScriptTarget.Latest, true);
  const pending: ts.Node[] = [source];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (ts.isThrowStatement(node) && thrownName(node) !== null) return true;
    pending.push(...node.getChildren(source));
  }
  return false;
}

/** The name a throw statement throws, looking through parentheses, or null when it throws anything else. */
function thrownName(statement: ts.ThrowStatement): ts.Identifier | null {
  let thrown = statement.expression;
  while (ts.isParenthesizedExpression(thrown)) {
    thrown = thrown.expression;
  }
  return ts.isIdentifier(thrown) ? thrown : null;
}

/**
 * Every throw in a file that passes on a caught value typed unknown or any:
 * the name a `catch` clause binds, or a parameter of any function, which is
 * how a function handed to a promise's `catch` or `then` receives one. A
 * value narrowed to an Error is not one.
 *
 * @returns One "file / function / throw" entry for each, in the order they
 *     appear. The throw reads "throw name;" however it is spaced or
 *     parenthesised, so a change of layout does not change the entry. A throw
 *     in an arrow or function expression with no name of its own reads
 *     "(an unnamed function)".
 */
function rethrows(file: string, text: string): string[] {
  const { source, checker } = typedSource(file, text);
  const found: string[] = [];
  const pending: ts.Node[] = [source];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    pending.push(...[...node.getChildren(source)].reverse());
    const name = ts.isThrowStatement(node) ? thrownName(node) : null;
    if (name === null) continue;
    if ((checker.getTypeAtLocation(name).flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) === 0) continue;
    const declaration = checker.getSymbolAtLocation(name)?.valueDeclaration;
    if (declaration === undefined || !isCaughtBinding(declaration)) continue;
    found.push(`${file} / ${enclosingFunctionName(node, source)} / throw ${name.text};`);
  }
  return found;
}

/**
 * Whether a declaration may bind a caught value: a `catch` clause's name, or
 * a parameter of any function. The lint rule lets a rejection handler's
 * parameter be thrown on however the call that takes the handler is written,
 * and refuses a throw of any other parameter typed unknown, so every
 * parameter is read here, and no form of that call can hide one.
 */
function isCaughtBinding(declaration: ts.Declaration): boolean {
  if (ts.isVariableDeclaration(declaration)) return ts.isCatchClause(declaration.parent);
  return ts.isParameter(declaration);
}

/** The name of the function a node sits in, as a reader would look it up. */
function enclosingFunctionName(node: ts.Node, source: ts.SourceFile): string {
  for (let parent = node.parent; !ts.isSourceFile(parent); parent = parent.parent) {
    if (!ts.isFunctionLike(parent)) continue;
    if ((ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name !== undefined) return parent.name.getText(source);
    if (ts.isVariableDeclaration(parent.parent)) return parent.parent.name.getText(source);
    return "(an unnamed function)";
  }
  return "(the module itself)";
}

/**
 * Every name a file binds to a function inside a function: by destructuring,
 * by a default, by a declaration or an assignment whose value may be a
 * function, and every parameter whose default is a function. These are rule
 * 3's nested helpers that a lint selector cannot see, since a selector cannot
 * tell which key of a literal a name is bound to, nor which argument a call
 * gives back.
 *
 * A name bound by destructuring reads what `readBinding` finds its key, or
 * its position, holds in each literal destructured, at any depth, through the
 * wrappers and calls a function value is read through. A name whose default
 * is a function is bound to one too. A rest element with a name binds an
 * object or array, not a function; one with a pattern reads the items left.
 * A destructuring at the top level of a module binds no nested helper. A
 * parameter that an `@param` tag of its function's comment, or of one of its
 * overload signatures, names is part of the interface, so its own default is
 * not read; a default inside a destructured parameter is still read. A name
 * whose value cannot be read is reported as such, saying why.
 *
 * @returns One "file / function / name" entry for each, in the order they
 *     appear, then, for each declaration, one entry for each name it
 *     cannot read, which says why.
 */
function boundHelpers(file: string, text: string): string[] {
  const { source, checker } = typedSource(file, text);
  return boundHelpersIn(file, source, checker);
}

/** What `boundHelpers` finds in one source file, read with the checker of the program that read it. */
function boundHelpersIn(file: string, source: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const found: string[] = [];
  const pending: ts.Node[] = [source];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    pending.push(...[...node.getChildren(source)].reverse());
    const assigned = assignedName(node);
    if (assigned !== null && ts.findAncestor(node, ts.isFunctionLike) !== undefined && functionValues(assigned.value, checker).length > 0) {
      found.push(`${file} / ${enclosingFunctionName(assigned.name, source)} / ${assigned.name.text}`);
    }
    const declaration = helperDeclaration(node);
    if (declaration === null) continue;
    const reading = readBinding(declaration.name, declaration.initializer, checker);
    for (const name of new Set(helperNames(reading, checker))) {
      found.push(`${file} / ${enclosingFunctionName(name, source)} / ${name.text}`);
    }
    for (const { name, cause } of reading.unknown) {
      found.push(`${file} / ${enclosingFunctionName(name, source)} / ${name.text}: ${unknownReason(cause, source)}, so what it holds cannot be read`);
    }
  }
  return found;
}

/** A name an assignment gives a value, with the value. */
interface AssignedName {
  name: ts.Identifier;
  value: ts.Expression;
}

/** The name a node assigns a value to, with the value, or null when it assigns nothing to a name. */
function assignedName(node: ts.Node): AssignedName | null {
  if (!ts.isBinaryExpression(node) || !isAssignmentOperator(node.operatorToken.kind)) return null;
  const target = heldValue(node.left);
  return target !== undefined && ts.isIdentifier(target) ? { name: target, value: node.right } : null;
}

/** Whether a token is an operator that assigns: `=`, or a compound form such as `??=`. */
function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/**
 * The node as a declaration the nested-helper check reads: a parameter that
 * no `@param` tag documents, or a variable declared inside a function.
 *
 * @returns The declaration, or null when the node is neither.
 */
function helperDeclaration(node: ts.Node): ts.ParameterDeclaration | ts.VariableDeclaration | null {
  if (ts.isParameter(node)) return isDocumentedParameter(node) ? null : node;
  return ts.isVariableDeclaration(node) && ts.findAncestor(node, ts.isFunctionLike) !== undefined ? node : null;
}

/**
 * Whether a parameter is named by an `@param` tag of its function's comment,
 * or of the comment on any overload signature of its function. Only a
 * parameter with a name of its own can be.
 */
function isDocumentedParameter(parameter: ts.ParameterDeclaration): boolean {
  const name = parameter.name;
  if (!ts.isIdentifier(name)) return false;
  const owner = parameter.parent;
  const signatures = ts.isFunctionDeclaration(owner) || ts.isMethodDeclaration(owner) || ts.isConstructorDeclaration(owner) ? overloadSignatures(owner) : [];
  const tags = [...ts.getJSDocParameterTags(parameter), ...signatures.flatMap((signature) => ts.getJSDocTags(signature).filter(ts.isJSDocParameterTag))];
  return tags.some((tag) => ts.isIdentifier(tag.name) && tag.name.text === name.text);
}

/** Each name a reading gives a function: a name one of whose values may be an arrow function or a function expression, or is a method. */
function helperNames(reading: Reading, checker: ts.TypeChecker): ts.Identifier[] {
  return reading.bound.filter(({ value }) => ts.isMethodDeclaration(value) || functionValues(value, checker).length > 0).map(({ name }) => name);
}

/** A name a binding gives a value, and one value it may take. */
interface Bound {
  name: ts.Identifier;
  /** What its key or position holds in a literal, a method there, or its default. */
  value: ts.Expression | ts.MethodDeclaration;
}

/**
 * What makes a name's value unknown, so that no rule can read what it holds:
 * a spread of unknown extent, a key computed from anything but a literal, or
 * a value read by a pattern that is not a literal of the kind it reads.
 */
type UnknownCause = ts.Node;

/** A name whose value cannot be read, with what makes it unknown. */
interface UnknownPosition {
  name: ts.Identifier;
  cause: UnknownCause;
}

/** A part of a literal that a name may take, where which name takes it cannot be told, with why. */
interface UnreadPart {
  node: ts.Node;
  cause: UnknownCause;
}

/** What a binding gives each name, read against the value given, and where every other part of each literal it reads goes. */
interface Reading {
  /** Each name with each value it may take, in the order the names are written. */
  bound: Bound[];
  /** Each name whose value cannot be read, with why. */
  unknown: UnknownPosition[];
  /** Each property, accessor or item of a literal read that no name takes as its value. */
  untaken: ts.Node[];
  /** Each property or item that a rest element with a name takes into the object or array it binds. */
  rested: ts.Node[];
  /** Each part of a literal read that a name may take, where which name cannot be told. */
  unread: UnreadPart[];
}

/**
 * What a binding gives each name. Each literal the value given may be, as
 * `possibleValues` reads it, is read. A name bound to an object's key reads
 * that key's value or method from an object literal, whatever the key's
 * spelling, or the item at that index from an array literal. A name bound by
 * position reads the item there. A nested pattern reads the nested literal.
 * A rest element with a pattern reads the items left after the elements
 * before it. Every name and nested pattern also reads its default, whether or
 * not the value given means the default never runs, since a function written
 * there is bound to the name. A spread of an object or array literal is read
 * through; a spread of anything else, or a key computed from anything but a
 * literal, leaves what it may give unknown.
 *
 * @param reading What has been read so far, which this adds to and returns.
 * @param offset The position in an array literal that the pattern's first
 *     element reads: past the elements before a rest element, for its pattern.
 */
function readBinding(binding: ts.BindingName, value: ts.Expression | ts.MethodDeclaration | undefined, checker: ts.TypeChecker,
  reading: Reading = { bound: [], unknown: [], untaken: [], rested: [], unread: [] }, offset = 0): Reading {
  if (ts.isIdentifier(binding)) {
    if (value !== undefined) reading.bound.push({ name: binding, value });
    return reading;
  }
  const literals = valuesOf(value, checker);
  for (const [at, element] of binding.elements.entries()) {
    if (ts.isOmittedExpression(element)) continue;
    for (const literal of literals) {
      readElement(binding, element, at, literal, checker, reading, offset);
    }
    if (element.initializer !== undefined) readBinding(element.name, element.initializer, checker, reading);
  }
  for (const literal of literals) {
    sortLiteral(binding, literal, checker, reading, offset);
  }
  return reading;
}

/** Each value a name's value may be, as `possibleValues` reads it; a method is itself. None when there is no value. */
function valuesOf(value: ts.Expression | ts.MethodDeclaration | undefined, checker: ts.TypeChecker): Array<ts.Expression | ts.MethodDeclaration> {
  if (value === undefined) return [];
  return ts.isMethodDeclaration(value) ? [value] : possibleValues(value, checker);
}

/** Reads what one element of a pattern takes from one literal, adding it to the reading. */
function readElement(pattern: ts.BindingPattern, element: ts.BindingElement, at: number, literal: ts.Expression | ts.MethodDeclaration,
  checker: ts.TypeChecker, reading: Reading, offset: number): void {
  if (element.dotDotDotToken !== undefined) {
    // A rest element with a name binds what is left as an object or array; one with a pattern reads the items left.
    if (!ts.isIdentifier(element.name) && ts.isArrayLiteralExpression(literal)) readBinding(element.name, literal, checker, reading, offset + at);
    return;
  }
  const source = elementSource(pattern, element, at, literal, checker, offset);
  const cause = source.unknownAfter;
  if (cause !== null) reading.unknown.push(...boundNames(element.name).map((name) => ({ name, cause })));
  for (const holder of source.holders) {
    readBinding(element.name, heldBy(holder), checker, reading);
  }
}

/** A property, method or array item of a literal that gives a name its value. */
type Holder = ts.PropertyAssignment | ts.ShorthandPropertyAssignment | ts.MethodDeclaration | ts.Expression;

/** Where one element of a pattern takes its value from, in one literal. */
interface ElementSource {
  /** Each property, method or array item that may give the element its value: a later one as well as one it overrides. */
  holders: Holder[];
  /** What may give the element its value instead, so that it cannot be read, or null. */
  unknownAfter: UnknownCause | null;
}

/**
 * Where a binding element takes its value from in one literal: by key from an
 * object literal, through each spread of an object literal; or by position,
 * or by an index key, from an array literal, through each spread of an array
 * or string literal.
 *
 * @returns No holder and nothing unknown when the literal is not an object
 *     or array literal, or the key is not an index of an array literal.
 */
function elementSource(pattern: ts.BindingPattern, element: ts.BindingElement, at: number, literal: ts.Expression | ts.MethodDeclaration,
  checker: ts.TypeChecker, offset: number): ElementSource {
  if (!ts.isArrayLiteralExpression(literal) && !ts.isObjectLiteralExpression(literal)) return { holders: [], unknownAfter: null };
  if (ts.isArrayBindingPattern(pattern)) return itemSource(literal, offset + at, checker);
  const key = boundKey(element, checker);
  // A key computed from anything but a literal may be any key.
  if (key === undefined) return { holders: [], unknownAfter: element.propertyName ?? element };
  if (ts.isObjectLiteralExpression(literal)) return keyedProperties(literal, key, checker);
  return isIndexKey(key) ? itemSource(literal, offset + Number(key), checker) : { holders: [], unknownAfter: null };
}

/** Whether a key names an item of an array: a whole number of zero or more, written as a number writes itself. */
function isIndexKey(key: string): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && String(index) === key;
}

/**
 * The item an array literal holds at one position, counting each item a
 * spread of another array literal, or of a string literal, gives it.
 *
 * @returns The item as the one holder, none for a hole or nothing there or a
 *     literal that is not an array literal, and the spread whose length is
 *     not written there when the position falls after it.
 */
function itemSource(literal: ts.Expression, at: number, checker: ts.TypeChecker): ElementSource {
  if (!ts.isArrayLiteralExpression(literal)) return { holders: [], unknownAfter: null };
  const { items, unknownAfter } = spreadItems(literal, checker);
  const item = items[at];
  return { holders: item === undefined ? [] : [item], unknownAfter: at < items.length ? null : unknownAfter };
}

/** The value a property gives, or the method or array item itself. */
function heldBy(holder: Holder): ts.Expression | ts.MethodDeclaration {
  if (ts.isPropertyAssignment(holder)) return holder.initializer;
  return ts.isShorthandPropertyAssignment(holder) ? holder.name : holder;
}

/**
 * Each property or method of an object literal that gives one key, read
 * through each spread of another object literal, with what may give the key
 * a value after the last of them instead: a spread of anything else, or a
 * key computed from anything but a literal. An accessor gives the key, but
 * no value a pattern can read, so it settles the key and holds nothing.
 */
function keyedProperties(literal: ts.ObjectLiteralExpression, key: string, checker: ts.TypeChecker): ElementSource {
  const found: ElementSource = { holders: [], unknownAfter: null };
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = singleValue(property.expression, checker);
      if (spread === undefined || !ts.isObjectLiteralExpression(spread)) {
        found.unknownAfter = property;
        continue;
      }
      const inner = keyedProperties(spread, key, checker);
      found.holders.push(...inner.holders);
      // A key the inner literal gives is settled there, unless something inside it that may give any key comes later.
      if (inner.holders.length > 0 || inner.unknownAfter !== null) found.unknownAfter = inner.unknownAfter;
      continue;
    }
    const given = propertyKey(property.name, checker);
    if (given === undefined) {
      found.unknownAfter = property.name;
      continue;
    }
    if (given !== key) continue;
    if (!ts.isGetAccessorDeclaration(property) && !ts.isSetAccessorDeclaration(property)) found.holders.push(property);
    found.unknownAfter = null;
  }
  return found;
}

/** The key a binding element reads from an object, or undefined when it cannot be known without running the code. */
function boundKey(element: ts.BindingElement, checker: ts.TypeChecker): string | undefined {
  if (element.propertyName !== undefined) return propertyKey(element.propertyName, checker);
  return ts.isIdentifier(element.name) ? element.name.text : undefined;
}

/**
 * The key a property name gives, as a string: a name, a string or number
 * literal, or a key computed from an expression whose type is one string or
 * number literal, such as a template literal without substitutions or a
 * constant.
 *
 * @returns The key, or undefined when it cannot be known without running the code.
 */
function propertyKey(name: ts.PropertyName, checker: ts.TypeChecker): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return String(Number(name.text));
  if (!ts.isComputedPropertyName(name)) return undefined;
  const type = checker.getTypeAtLocation(name.expression);
  if (type.isStringLiteral()) return type.value;
  return type.isNumberLiteral() ? String(type.value) : undefined;
}

/** The items of an array literal, position by position, as far as they are known. */
interface SpreadItems {
  /**
   * Each item, a hole as undefined, with each spread of an array literal expanded
   * in place, and each character of a spread string literal held as that literal.
   */
  items: Array<ts.Expression | undefined>;
  /** The spread of anything but an array or string literal that ends the list, so no later position is known, or null. */
  unknownAfter: ts.SpreadElement | null;
  /** That spread, and each element written after it at any depth, whose position is not known. */
  after: ts.Node[];
}

/** The items an array literal holds, as far as its spreads let them be known. */
function spreadItems(literal: ts.ArrayLiteralExpression, checker: ts.TypeChecker): SpreadItems {
  const items: Array<ts.Expression | undefined> = [];
  for (const [index, element] of literal.elements.entries()) {
    if (ts.isOmittedExpression(element)) {
      items.push(undefined);
      continue;
    }
    if (!ts.isSpreadElement(element)) {
      items.push(element);
      continue;
    }
    const spread = singleValue(element.expression, checker);
    // A spread of a string gives one item for each character, as its iterator counts them: by code point, not by UTF-16 unit.
    if (spread !== undefined && (ts.isStringLiteral(spread) || ts.isNoSubstitutionTemplateLiteral(spread))) {
      items.push(...Array.from(spread.text, () => spread));
      continue;
    }
    if (spread === undefined || !ts.isArrayLiteralExpression(spread)) return { items, unknownAfter: element, after: literal.elements.slice(index) };
    const inner = spreadItems(spread, checker);
    items.push(...inner.items);
    if (inner.unknownAfter !== null) return { items, unknownAfter: inner.unknownAfter, after: [...inner.after, ...literal.elements.slice(index + 1)] };
  }
  return { items, unknownAfter: null, after: [] };
}

/**
 * Records where each part of one literal a pattern reads goes, other than a
 * part a name takes, which is recorded as that name's value: each part no
 * name takes, each a rest element with a name takes, and each a name may
 * take where which name cannot be told. An object literal read by position,
 * or a function or method read as though it were a literal, cannot be read.
 */
function sortLiteral(pattern: ts.BindingPattern, literal: ts.Expression | ts.MethodDeclaration, checker: ts.TypeChecker, reading: Reading, offset: number): void {
  if (ts.isArrayLiteralExpression(literal)) {
    sortItems(pattern, literal, checker, reading, offset);
  } else if (ts.isObjectLiteralExpression(literal) && ts.isObjectBindingPattern(pattern)) {
    sortProperties(pattern, literal, checker, reading);
  } else if (ts.isObjectLiteralExpression(literal) || ts.isMethodDeclaration(literal) || isFunctionValue(literal)) {
    reading.unread.push({ node: literal, cause: literal });
  }
}

/**
 * Where one part of a literal goes in the pattern that reads it: taken as a
 * name's value, taken into what a rest element's name binds, read again by
 * a rest element's own pattern, taken by no name, or not known.
 */
type Destination = "taken" | "rested" | "read by a rest pattern" | "untaken" | "unread";

/** Sorts the items of an array literal that a pattern reads by position, or by index keys, as `sortLiteral` says. */
function sortItems(pattern: ts.BindingPattern, literal: ts.ArrayLiteralExpression, checker: ts.TypeChecker, reading: Reading, offset: number): void {
  const { items, unknownAfter, after } = spreadItems(literal, checker);
  for (const [position, item] of items.entries()) {
    if (position >= offset && item !== undefined) sortPart(item, itemDestination(pattern, position - offset, checker), reading, item);
  }
  if (unknownAfter === null) return;
  const known = Math.max(0, items.length - offset);
  for (const node of after) {
    sortPart(node, laterDestination(pattern, known, checker), reading, unknownAfter);
  }
}

/** Where the item at one position of an array literal goes in a pattern that reads it. */
function itemDestination(pattern: ts.BindingPattern, at: number, checker: ts.TypeChecker): Destination {
  if (ts.isArrayBindingPattern(pattern)) {
    const rest = pattern.elements.findIndex(isRestElement);
    if (rest !== -1 && at >= rest) return restDestination(pattern.elements[rest]);
    const element = pattern.elements[at];
    return element !== undefined && ts.isBindingElement(element) ? "taken" : "untaken";
  }
  const keys = pattern.elements.filter((element) => !isRestElement(element)).map((element) => boundKey(element, checker));
  if (keys.includes(undefined)) return "unread";
  if (keys.includes(String(at))) return "taken";
  return pattern.elements.some(isRestElement) ? "rested" : "untaken";
}

/**
 * Where an item of an array literal goes in a pattern that reads it, when the
 * item follows a spread whose length is not known, so that it may sit at any
 * position from the last one known.
 */
function laterDestination(pattern: ts.BindingPattern, known: number, checker: ts.TypeChecker): Destination {
  if (ts.isArrayBindingPattern(pattern)) {
    const rest = pattern.elements.findIndex(isRestElement);
    const before = pattern.elements.slice(known, rest === -1 ? undefined : rest);
    if (before.some(ts.isBindingElement)) return "unread";
    return rest === -1 ? "untaken" : restDestination(pattern.elements[rest]);
  }
  const keys = pattern.elements.filter((element) => !isRestElement(element)).map((element) => boundKey(element, checker));
  if (keys.some((key) => key === undefined || (isIndexKey(key) && Number(key) >= known))) return "unread";
  return pattern.elements.some(isRestElement) ? "rested" : "untaken";
}

/** Whether an element of a pattern is a rest element. */
function isRestElement(element: ts.ArrayBindingElement): boolean {
  return ts.isBindingElement(element) && element.dotDotDotToken !== undefined;
}

/** Where an item that a rest element takes goes: into the array its name binds, or to its own pattern, which reads it again. */
function restDestination(rest: ts.ArrayBindingElement | undefined): Destination {
  return rest !== undefined && ts.isBindingElement(rest) && ts.isIdentifier(rest.name) ? "rested" : "read by a rest pattern";
}

/** Records one part of a literal where its destination says, as `sortLiteral` describes. */
function sortPart(node: ts.Node, destination: Destination, reading: Reading, cause: UnknownCause): void {
  if (destination === "untaken") reading.untaken.push(node);
  else if (destination === "rested") reading.rested.push(node);
  else if (destination === "unread") reading.unread.push({ node, cause });
}

/** Sorts the properties of an object literal that an object pattern reads, as `sortLiteral` says, through each spread of an object literal. */
function sortProperties(pattern: ts.ObjectBindingPattern, literal: ts.ObjectLiteralExpression, checker: ts.TypeChecker, reading: Reading): void {
  const named = pattern.elements.filter((element) => element.dotDotDotToken === undefined);
  const unknownKey = named.find((element) => boundKey(element, checker) === undefined);
  const keys = new Set(named.map((element) => boundKey(element, checker)));
  const rested = pattern.elements.some((element) => element.dotDotDotToken !== undefined);
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = singleValue(property.expression, checker);
      if (spread !== undefined && ts.isObjectLiteralExpression(spread)) {
        sortProperties(pattern, spread, checker, reading);
      } else {
        reading.unread.push({ node: property, cause: property });
      }
      continue;
    }
    // An accessor is never a name's value: a name takes what the getter returns.
    if (ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) {
      reading.untaken.push(property);
      continue;
    }
    const key = propertyKey(property.name, checker);
    if (key === undefined || unknownKey !== undefined) {
      reading.unread.push({ node: property, cause: key === undefined ? property.name : unknownKey?.propertyName ?? property });
    } else if (!keys.has(key)) {
      (rested ? reading.rested : reading.untaken).push(property);
    }
  }
}

/**
 * Why the rules cannot read a name whose value something of unknown extent
 * may give, or a part of a literal a name may take, as a clause about it.
 */
function unknownReason(cause: UnknownCause, source: ts.SourceFile): string {
  const text = cause.getText(source);
  if (ts.isSpreadElement(cause)) return `its position follows ${text}, whose length is not known`;
  if (ts.isSpreadAssignment(cause)) return `its key may be given by ${text}, whose keys are not known`;
  if (ts.isComputedPropertyName(cause) && ts.isBindingElement(cause.parent)) return `its key, ${text}, is not known`;
  if (ts.isComputedPropertyName(cause)) return `its key may be given by ${text}, whose value is not known`;
  if (ts.isObjectLiteralExpression(cause)) return "it is read by position from an object literal";
  return "it is read from a function as though the function were a literal";
}

/** What the throws check found in one file. */
interface ThrowsCount {
  /** How many documented functions throw from their own body. */
  read: number;
  /** One "file:line: problem" entry for each whose comment has no `@throws` tag. */
  problems: string[];
}

/**
 * Every function with a JSDoc comment that throws from its own body, and whose
 * comment carries no `@throws` tag.
 *
 * A function here is a function declaration, a class method, a constructor or
 * an accessor, read with its own comment, or a function written as a value,
 * or a method of an object literal, read with the comment `documentedValues`
 * finds for it. A function declared with overloads is read with the comments
 * of its signatures as well as its own, so a `@throws` tag on any of them
 * counts. A throw counts when it can leave the function: not inside a nested
 * function, and not inside a `try` block whose `catch` takes it. A name a
 * documented statement binds whose value cannot be read is reported as such,
 * after the others.
 */
function undocumentedThrows(file: string, text: string): ThrowsCount {
  const { source, checker } = typedSource(file, text);
  return undocumentedThrowsIn(file, source, checker);
}

/** What `undocumentedThrows` finds in one source file, read with the checker of the program that read it. */
function undocumentedThrowsIn(file: string, source: ts.SourceFile, checker: ts.TypeChecker): ThrowsCount {
  const problems: string[] = [];
  let read = 0;
  for (const unit of documentedFunctions(source, checker)) {
    if (!unit.bodies.some(throwsFromItsBody)) continue;
    read += 1;
    if (saysWhatItThrows(unit.commented)) continue;
    const line = source.getLineAndCharacterOfPosition(unit.commented.getStart(source)).line + 1;
    problems.push(`${file}:${line}: the comment on ${unit.name} does not say what it throws`);
  }
  for (const { name, cause, commented } of documentedUnknownPositions(source, checker)) {
    const line = source.getLineAndCharacterOfPosition(commented.getStart(source)).line + 1;
    problems.push(`${file}:${line}: what ${name.text} binds cannot be read, as ${unknownReason(cause, source)}`);
  }
  return { read, problems };
}

/** A name a documented statement binds whose value cannot be read. */
interface DocumentedUnknownPosition extends UnknownPosition {
  /** The statement that carries the comment. */
  commented: ts.VariableStatement;
}

/**
 * Each name a documented variable statement binds whose value cannot be
 * read, so that the throws check cannot read what it binds.
 */
function documentedUnknownPositions(source: ts.SourceFile, checker: ts.TypeChecker): DocumentedUnknownPosition[] {
  const found: DocumentedUnknownPosition[] = [];
  const pending: ts.Node[] = [source];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    pending.push(...[...node.getChildren(source)].reverse());
    if (!ts.isVariableStatement(node) || !hasJsDoc(node)) continue;
    for (const declaration of node.declarationList.declarations) {
      found.push(...readBinding(declaration.name, declaration.initializer, checker).unknown.map((position) => ({ ...position, commented: node })));
    }
  }
  return found;
}

/** A function with a JSDoc comment, as the throws check reads it. */
interface DocumentedFunction {
  name: string;
  /** The node the comment is attached to. */
  commented: ts.Node;
  /** The body of each function it may be: more than one where a conditional chooses. */
  bodies: ts.Node[];
}

/**
 * Every documented function in a file that has a body: each declaration
 * `asDocumentedFunction` reads, and each value `documentedValues` reads, in
 * the order their comments appear.
 */
function documentedFunctions(source: ts.SourceFile, checker: ts.TypeChecker): DocumentedFunction[] {
  const declared: DocumentedFunction[] = [];
  for (const node of functionLikes(source)) {
    const unit = asDocumentedFunction(node, source);
    if (unit !== null) declared.push(unit);
  }
  return [...declared, ...documentedValues(source, checker)].sort((one, other) => one.commented.getStart(source) - other.commented.getStart(source));
}

/**
 * The node as a documented declaration: a function declaration, a class
 * method or a constructor with a body and a comment, or an accessor with a
 * body and a comment of its own.
 *
 * @returns The function, or null when the node is none of them.
 */
function asDocumentedFunction(node: ts.Node, source: ts.SourceFile): DocumentedFunction | null {
  // A function, a class method or a constructor is read with the comments of its overload signatures as well as its own.
  if ((ts.isFunctionDeclaration(node) || (ts.isMethodDeclaration(node) && ts.isClassLike(node.parent)) || ts.isConstructorDeclaration(node)) && node.body !== undefined) {
    const commented = commentRead(node);
    return commented === null ? null : { name: node.name?.getText(source) ?? "constructor", commented, bodies: [node.body] };
  }
  if ((ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body !== undefined && hasJsDoc(node)) {
    return { name: node.name.getText(source), commented: node, bodies: [node.body] };
  }
  return null;
}

/**
 * Every function written as a value, and every method of an object literal,
 * that a comment documents, each read with that comment. The comment is the
 * nearest of the function's own: on the function, on a wrapper around it, or
 * on the property, method or array item that holds it. Failing that, it is
 * the comment on the class field that holds the function, or on the
 * statement that binds the function to a name. One comment and one name make
 * one function to the check, whatever number of values it may be.
 */
function documentedValues(source: ts.SourceFile, checker: ts.TypeChecker): DocumentedFunction[] {
  const found: DocumentedFunction[] = [];
  for (const node of functionLikes(source)) {
    const isValue = ts.isArrowFunction(node) || ts.isFunctionExpression(node) || (ts.isMethodDeclaration(node) && ts.isObjectLiteralExpression(node.parent));
    if (!isValue || node.body === undefined) continue;
    const documented = documentationOf(climb(node, checker), source);
    if (documented === null) continue;
    const same = found.find((unit) => unit.commented === documented.commented && unit.name === documented.name);
    if (same === undefined) {
      found.push({ ...documented, bodies: [node.body] });
    } else {
      same.bodies.push(node.body);
    }
  }
  return found;
}

/** The comment that documents a function, as `documentedValues` finds it, with the name the check gives the function. */
interface Documentation {
  commented: ts.Node;
  name: string;
}

/** The comment that documents a function, from where its value goes, as `documentedValues` reads it, or null when none does. */
function documentationOf(climbed: Climb, source: ts.SourceFile): Documentation | null {
  const name = valueName(climbed, source);
  for (const node of climbed.path) {
    if (hasJsDoc(node)) return { commented: node, name };
    if (node === climbed.holder) break;
  }
  if (climbed.holder === undefined && ts.isPropertyDeclaration(climbed.sink) && hasJsDoc(climbed.sink)) return { commented: climbed.sink, name };
  const place = climbed.place;
  if (place.kind !== "bound" || !ts.isVariableDeclaration(place.declaration)) return null;
  const statement = place.declaration.parent.parent;
  return ts.isVariableStatement(statement) && hasJsDoc(statement) ? { commented: statement, name: place.name.text } : null;
}

/**
 * The name the throws check gives a function value: the key of the property
 * or method that holds it, "an array item" for an item of an array, the name
 * it is bound to, or the class field that holds it; else "an unnamed function".
 */
function valueName(climbed: Climb, source: ts.SourceFile): string {
  const holder = climbed.holder;
  if (holder !== undefined) return ts.isPropertyAssignment(holder) || ts.isMethodDeclaration(holder) ? holder.name.getText(source) : "an array item";
  if (climbed.place.kind === "bound") return climbed.place.name.text;
  return ts.isPropertyDeclaration(climbed.sink) ? climbed.sink.name.getText(source) : "an unnamed function";
}

/** The JSDoc comments attached to a node itself, not those it would inherit from a statement around it. */
function ownJsDocs(node: ts.Node): ts.JSDoc[] {
  return ts.getJSDocCommentsAndTags(node).filter((comment): comment is ts.JSDoc => ts.isJSDoc(comment) && comment.parent === node);
}

/** Whether a node carries a JSDoc comment of its own. */
function hasJsDoc(node: ts.Node): boolean {
  return ownJsDocs(node).length > 0;
}

/** Whether a comment of a node's own has a `@throws` tag. */
function saysWhatItThrows(node: ts.Node): boolean {
  return ownJsDocs(node).some((comment) => (comment.tags ?? []).some((tag) => tag.tagName.text === "throws"));
}

/** Every node in a file of a kind the compiler counts as function-like, in the order written. */
function functionLikes(source: ts.SourceFile): ts.SignatureDeclaration[] {
  const found: ts.SignatureDeclaration[] = [];
  const pending: ts.Node[] = [source];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (ts.isFunctionLike(node)) found.push(node);
    pending.push(...[...node.getChildren(source)].reverse());
  }
  return found;
}

/** What the placement check found in one file. */
interface Placements {
  /** How many functions written there it placed. */
  placed: number;
  /** One "file:line: problem" entry for each function it could not place, naming the function and why. */
  problems: string[];
}

/**
 * Every function written with a body in a file that the placement check
 * cannot place, with how many it placed. Each node of a kind the compiler
 * counts as function-like is looked up in FOLLOWED_KINDS and TYPE_KINDS, and
 * a kind in neither fails. A function written with a body is followed to its
 * place, as `climb` reads it. Its place is one of the allowed positions,
 * which must have a reason, or a name it is bound to, which the rules read.
 * Anything else fails, saying why.
 *
 * @param allowed The allowed positions with their reasons: ALLOWED_POSITIONS,
 *     unless a test gives another list.
 */
function unplacedFunctions(file: string, text: string, allowed: Readonly<Record<string, string>> = ALLOWED_POSITIONS): Placements {
  const { source, checker } = typedSource(file, text);
  return placementsIn(file, source, checker, allowed);
}

/** What `unplacedFunctions` finds in one source file, read with the checker of the program that read it. */
function placementsIn(file: string, source: ts.SourceFile, checker: ts.TypeChecker, allowed: Readonly<Record<string, string>>): Placements {
  const problems: string[] = [];
  let placed = 0;
  for (const node of functionLikes(source)) {
    const kind = syntaxName(node.kind);
    if (kind in TYPE_KINDS) continue;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const called = FOLLOWED_KINDS[kind];
    if (called === undefined) {
      problems.push(`${file}:${line}: a ${kind} is a kind of function the placement check does not name`);
      continue;
    }
    // A signature with no body, such as an overload, makes no function.
    if (!isWrittenFunction(node)) continue;
    const place = climb(node, checker).place;
    if (place.kind === "unplaced") {
      problems.push(`${file}:${line}: ${called} cannot be placed: ${place.why}`);
    } else if (place.kind === "position" && (allowed[place.position] ?? "").trim() === "") {
      problems.push(`${file}:${line}: ${called} is ${place.position}, which has no reason on the allowed list`);
    } else {
      placed += 1;
    }
  }
  return { placed, problems };
}

/** Whether a function-like node is written with a body, so that it makes a function. */
function isWrittenFunction(node: ts.SignatureDeclaration): node is ts.FunctionLikeDeclaration {
  return (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.body !== undefined;
}

/** The compiler's name for a syntax kind, passing over the markers, such as FirstStatement, that share a kind's number. */
function syntaxName(kind: ts.SyntaxKind): string {
  return Object.keys(ts.SyntaxKind).find((name) => ts.SyntaxKind[name as keyof typeof ts.SyntaxKind] === kind && !/^(First|Last)/.test(name)) ?? String(kind);
}

/** Where a function written here goes, as the placement check reads it. */
interface Climb {
  /** The function, then each node its value passes through, the innermost first. */
  path: ts.Node[];
  /** The property, method or array item of a literal that first holds it, or undefined when nothing holds it. */
  holder: ts.Node | undefined;
  /** The node its value ends in: where it is bound, handed on, or left. */
  sink: ts.Node;
  place: Place;
}

/** Where a function's value ends: in a position on the allowed list, bound to a name the rules read, or in neither. */
type Place =
  | { kind: "position"; position: string }
  | { kind: "bound"; name: ts.Identifier; declaration: ts.Node }
  | { kind: "unplaced"; why: string };

/**
 * Where a function written here goes. A function declaration and a class
 * member stay where they are written. Any other function's value is followed
 * out through each wrapper and each call that may give it back, as
 * `possibleValues` reads them, and through each object or array literal
 * that holds it, to the first node that does something else with it. That
 * node decides its place.
 */
function climb(written: ts.FunctionLikeDeclaration, checker: ts.TypeChecker): Climb {
  const path: ts.Node[] = [written];
  if (ts.isFunctionDeclaration(written)) return { path, holder: undefined, sink: written.parent, place: { kind: "position", position: "a function declaration" } };
  if (ts.isClassLike(written.parent)) return { path, holder: undefined, sink: written.parent, place: { kind: "position", position: "a class member" } };
  let holder: ts.Node | undefined;
  let value: ts.Node = written;
  let top: ts.Node = written;
  for (;;) {
    const parent = top.parent;
    if (ts.isBinaryExpression(parent) && isAssignmentOperator(parent.operatorToken.kind) && parent.right === top) {
      return { path, holder, sink: parent, place: assignedPlace(parent, value === written) };
    }
    if (ts.isExpression(parent) && possibleValues(parent, checker).some((one) => one === value)) {
      path.push(parent);
      top = parent;
      continue;
    }
    const holding = holdingLiteral(parent, top);
    if (holding === undefined) return { path, holder, sink: parent, place: sinkPlace(parent, top, written, value === written, checker) };
    holder ??= holding.holder;
    path.push(...holding.steps);
    value = holding.literal;
    top = holding.literal;
  }
}

/** A literal that holds a value, with the nodes the value passes through to reach it, and the property, method or item that holds it. */
interface HoldingLiteral {
  literal: ts.ArrayLiteralExpression | ts.ObjectLiteralExpression;
  holder: ts.Node | undefined;
  steps: ts.Node[];
}

/**
 * The object or array literal that holds a value, when the node above the
 * value is one: as an item, a spread, a property's value, or a method or
 * accessor.
 *
 * @returns The literal, or undefined when the node above holds no value in a literal.
 */
function holdingLiteral(parent: ts.Node, top: ts.Node): HoldingLiteral | undefined {
  if (ts.isArrayLiteralExpression(parent)) return { literal: parent, holder: top, steps: [parent] };
  if (ts.isSpreadElement(parent) && ts.isArrayLiteralExpression(parent.parent)) return { literal: parent.parent, holder: undefined, steps: [parent, parent.parent] };
  if (ts.isPropertyAssignment(parent) && parent.initializer === top) return { literal: parent.parent, holder: parent, steps: [parent, parent.parent] };
  if (ts.isSpreadAssignment(parent)) return { literal: parent.parent, holder: undefined, steps: [parent, parent.parent] };
  if (ts.isObjectLiteralExpression(parent)) return { literal: parent, holder: top, steps: [parent] };
  return undefined;
}

/** A place on the allowed list. */
function position(name: string): Place {
  return { kind: "position", position: name };
}

/** No place: a function whose value ends somewhere the rules cannot read, saying why. */
function unplaced(why: string): Place {
  return { kind: "unplaced", why };
}

/**
 * The place a function's value ends in, from the node that takes it.
 *
 * @param direct Whether the value that node takes is the function itself, not a literal that holds it.
 */
function sinkPlace(parent: ts.Node, top: ts.Node, written: ts.FunctionLikeDeclaration, direct: boolean, checker: ts.TypeChecker): Place {
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression !== top) {
    // A call whose function cannot be found gives back every argument, so its value is followed past it.
    const declaration = calledDeclaration(parent, checker);
    const at = (parent.arguments ?? []).findIndex((argument) => argument === top);
    if (declaration === undefined || parameterOf(declaration, parent, at) === undefined) {
      return unplaced("it is handed to a call after a spread, or past its last parameter, so what the call does with it cannot be read");
    }
    return position("an argument to a call that does not give it back");
  }
  if ((ts.isReturnStatement(parent) && parent.expression === top) || (ts.isArrowFunction(parent) && parent.body === top)) {
    const owner = ts.isArrowFunction(parent) ? parent : ts.findAncestor(parent, ts.isFunctionLike);
    if (owner !== undefined && isCalledWhereWritten(owner)) return unplaced("it is returned by a function called where it is written, a place the allowed list does not name");
    return position("returned from a function");
  }
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.initializer === top) return declaredPlace(parent, written, direct, checker);
  if (ts.isBindingElement(parent) && parent.initializer === top) {
    const root = ts.findAncestor(parent, (node) => ts.isVariableDeclaration(node) || ts.isParameter(node));
    if (root !== undefined && (ts.isVariableDeclaration(root) || ts.isParameter(root))) return declaredPlace(root, written, false, checker);
  }
  if (ts.isPropertyDeclaration(parent) && parent.initializer === top) return position("a class member");
  if (ts.isCallExpression(parent)) return unplaced("it is called where it is written, a place the allowed list does not name");
  const kind = syntaxName(parent.kind);
  return unplaced(`it sits in ${/^[AEIOU]/.test(kind) ? "an" : "a"} ${kind}, a place the allowed list does not name`);
}

/** Whether a function is called where it is written, through any wrapper `heldValue` looks through. */
function isCalledWhereWritten(written: ts.Node): boolean {
  let outer = written;
  while (ts.isParenthesizedExpression(outer.parent) || ts.isAsExpression(outer.parent) || ts.isSatisfiesExpression(outer.parent)
    || ts.isTypeAssertionExpression(outer.parent) || ts.isNonNullExpression(outer.parent)) {
    outer = outer.parent;
  }
  return ts.isCallExpression(outer.parent) && outer.parent.expression === outer;
}

/**
 * The place of a function whose value a declaration or a parameter takes: the
 * name it binds, or the object or array a name binds that holds it, or what
 * `readBinding` finds of the part of a literal a pattern reads that holds it.
 */
function declaredPlace(declaration: ts.VariableDeclaration | ts.ParameterDeclaration, written: ts.FunctionLikeDeclaration, direct: boolean, checker: ts.TypeChecker): Place {
  if (ts.isIdentifier(declaration.name)) return direct ? { kind: "bound", name: declaration.name, declaration } : position("held in a value bound to a name");
  const reading = readBinding(declaration.name, declaration.initializer, checker);
  const bound = reading.bound.find(({ value }) => valuesOf(value, checker).some((one) => one === written));
  if (bound !== undefined) return { kind: "bound", name: bound.name, declaration };
  for (let node: ts.Node = written; node !== declaration; node = node.parent) {
    const part = node;
    if (reading.rested.includes(part) || reading.bound.some(({ value }) => valuesOf(value, checker).some((one) => one === part))) return position("held in a value bound to a name");
    if (reading.untaken.includes(part)) return position("a part of a literal no name takes");
    const unread = reading.unread.find((entry) => entry.node === part);
    if (unread !== undefined) return unplaced(`a name may take it, but which one cannot be read, as ${unknownReason(unread.cause, part.getSourceFile())}`);
  }
  return unplaced("it sits in a literal that its destructuring does not account for");
}

/**
 * The place of a function whose value an assignment takes: a property it is
 * stored on, or the object or array a name holds, or the name, inside a
 * function, as a nested helper the rules read.
 */
function assignedPlace(assignment: ts.BinaryExpression, direct: boolean): Place {
  const target = heldValue(assignment.left);
  const alone = ts.isExpressionStatement(assignment.parent);
  if (alone && target !== undefined && (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))) return position("stored on a property");
  if (alone && target !== undefined && ts.isIdentifier(target)) {
    if (!direct) return position("held in a value bound to a name");
    if (ts.findAncestor(assignment, ts.isFunctionLike) !== undefined) return { kind: "bound", name: target, declaration: assignment };
    return unplaced(`it is assigned to ${target.text} at the top level of the module, which the entry-point rule does not read`);
  }
  return unplaced("it is assigned by a destructuring, or by an assignment whose value is used as well, a place the allowed list does not name");
}

/**
 * The comment the throws check reads for a function, method or constructor
 * with a body. One declared with overloads has a comment on each signature
 * directly above it that has one, and on itself if it has one. Of those, the
 * first that says what it throws is read; or else its own; or else the first
 * signature's.
 *
 * @returns The node carrying the comment, or null when none of them has one.
 */
function commentRead(implementation: OverloadableFunction): ts.Node | null {
  const documented: ts.Node[] = [...overloadSignatures(implementation), implementation].filter(hasJsDoc);
  const said = documented.find(saysWhatItThrows);
  return said ?? (hasJsDoc(implementation) ? implementation : documented[0] ?? null);
}

/** A declaration that may follow overload signatures of its own. */
type OverloadableFunction = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration;

/** The overload signatures of the same name directly above an implementation, in the order they appear. */
function overloadSignatures(implementation: OverloadableFunction): OverloadableFunction[] {
  const parent = implementation.parent;
  let siblings: readonly ts.Node[] = [];
  if (ts.isClassLike(parent)) siblings = parent.members;
  else if (ts.isSourceFile(parent) || ts.isBlock(parent) || ts.isModuleBlock(parent)) siblings = parent.statements;
  const name = implementation.name?.getText();
  const signatures: OverloadableFunction[] = [];
  for (let at = siblings.indexOf(implementation) - 1; at >= 0; at -= 1) {
    const signature = siblings[at];
    if (signature === undefined || signature.kind !== implementation.kind) break;
    if (!ts.isFunctionDeclaration(signature) && !ts.isMethodDeclaration(signature) && !ts.isConstructorDeclaration(signature)) break;
    if (signature.body !== undefined || signature.name?.getText() !== name) break;
    signatures.unshift(signature);
  }
  return signatures;
}

/** Whether a throw statement in a body can leave the function that owns the body. */
function throwsFromItsBody(body: ts.Node): boolean {
  const pending: ts.Node[] = [body];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (ts.isThrowStatement(node) && !isCaughtWithin(node, body)) return true;
    for (const child of node.getChildren()) {
      if (!ts.isFunctionLike(child)) pending.push(child);
    }
  }
  return false;
}

/** Whether a throw sits in the `try` block of a statement inside the body that has a `catch`. */
function isCaughtWithin(thrown: ts.Node, body: ts.Node): boolean {
  for (let node: ts.Node = thrown; node !== body; node = node.parent) {
    const parent = node.parent;
    if (ts.isTryStatement(parent) && parent.tryBlock === node && parent.catchClause !== undefined) return true;
  }
  return false;
}

/** Whether a path from the repository root lies in a directory of tests. */
function isTestFile(file: string): boolean {
  return file.split("/").includes("tests");
}

/** Every TypeScript module that ships, less the command shims. */
function shippedModules(): string[] {
  return typescriptFiles().filter((file) => !isTestFile(file) && !file.endsWith(SHIM_ENDING));
}

const UNREAD_DIRECTORIES = new Set([".git", "node_modules"]);

/**
 * Every TypeScript file in the repository, outside `.git` and `node_modules`.
 *
 * @returns The paths from the repository root, with forward slashes, sorted.
 * @throws The file system error when a directory cannot be listed.
 */
function typescriptFiles(directory = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(REPOSITORY_ROOT, directory))) {
    if (UNREAD_DIRECTORIES.has(entry)) continue;
    const path = directory === "" ? entry : `${directory}/${entry}`;
    if (statSync(join(REPOSITORY_ROOT, path)).isDirectory()) files.push(...typescriptFiles(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files.sort();
}
