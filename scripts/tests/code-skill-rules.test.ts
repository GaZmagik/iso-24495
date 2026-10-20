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
//    it throws, tested here.
// 3. Helpers at top level. A reader cannot reach a closure without reading
//    its container first. A function declaration, a variable holding a
//    function, or an object method or accessor inside a function is refused
//    by the "code skill" syntax selector in eslint.config.mjs, probed in
//    lint-rules.test.ts. A variable holding a function through
//    Object.freeze counts. A selector cannot tell which key of a literal a
//    name is bound to, so a test here finds every name bound to a function
//    inside a function by destructuring, at any depth, or by a default, and
//    every parameter whose default is a function. It reads every value an
//    expression may be: each branch of a conditional, either side of ?? and
//    ||, and the right of &&. A name a spread of unknown extent may give its
//    value cannot be read, so it fails the test, naming the name and the
//    spread; the same holds for the other two tests. A parameter its function's
//    @param tag documents is part of the interface, not a helper, by the
//    owner's ruling of 2026-10-20, so its default is not reported. Otherwise
//    a property holding an arrow is left alone: it is a value handed on, most
//    often a stand-in for a dependency.
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
//    each with its reason, in APPROVED_RETHROWS. A rethrow is known by the
//    name it throws, through parentheses, so `throw (failure);` is found and
//    a change of layout does not move an approved one.
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
// - A nested helper whose arrow sits under a type wrapper inside
//   Object.freeze, as in `Object.freeze(((n: number): number => n + 1)
//   satisfies (n: number) => number)`: the lint selector reads only an arrow
//   given to Object.freeze directly, and stacking a wrapper inside the call
//   is a choice, not a slip. The throws check does read through it.
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
      const found = undocumentedThrows(file, readFileSync(join(REPOSITORY_ROOT, file), "utf8"));
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
      found.push(...boundHelpers(file, readFileSync(join(REPOSITORY_ROOT, file), "utf8")));
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
  /** The spread of unknown extent that may give a destructured name its value, so it may be the first function; or null. */
  unknownAfter: ts.SpreadElement | ts.SpreadAssignment | null;
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
      const written = new Set(helperNames(declaration.name, declaration.initializer));
      const unknown = unknownPositions(declaration.name, declaration.initializer);
      for (const name of boundNames(declaration.name)) {
        if (written.has(name) || checker.getTypeAtLocation(name).getCallSignatures().length > 0) {
          return { name: name.text, exported, statement, unknownAfter: null };
        }
        const position = unknown.find((found) => found.name === name);
        if (position !== undefined) return { name: name.text, exported, statement, unknownAfter: position.spread };
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
 * that is an arrow function or a function expression. Any call with a
 * callback but `Object.freeze` runs it to build a value, so it holds none.
 *
 * @returns Each arrow function or function expression, none when the
 *     expression holds neither or is undefined.
 */
function functionValues(expression: ts.Expression | undefined): Array<ts.ArrowFunction | ts.FunctionExpression> {
  return possibleValues(expression).filter(isFunctionValue);
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

/**
 * Each value an expression may be, read through the wrappers `heldValue`
 * looks through. A conditional may be either branch. `??` and `||` may be
 * either side. `&&` may be its right side, or its left side when that is
 * falsy, which a function, an object literal or an array literal never is.
 * A comma list, or an assignment, is the value on its right.
 *
 * @returns Each value, in the order it is written; none when given undefined.
 */
function possibleValues(expression: ts.Expression | undefined): ts.Expression[] {
  const inner = heldValue(expression);
  if (inner === undefined) return [];
  if (ts.isConditionalExpression(inner)) return [...possibleValues(inner.whenTrue), ...possibleValues(inner.whenFalse)];
  if (!ts.isBinaryExpression(inner)) return [inner];
  const operator = inner.operatorToken.kind;
  if (EITHER_SIDE.has(operator)) return [...possibleValues(inner.left), ...possibleValues(inner.right)];
  if (RIGHT_UNLESS_FALSY.has(operator)) return [...possibleValues(inner.left).filter((value) => !isAlwaysTruthy(value)), ...possibleValues(inner.right)];
  if (operator === ts.SyntaxKind.CommaToken || operator === ts.SyntaxKind.EqualsToken) return possibleValues(inner.right);
  return [inner];
}

/** Whether an expression is a function, an object literal or an array literal, none of which is ever falsy. */
function isAlwaysTruthy(expression: ts.Expression): boolean {
  return isFunctionValue(expression) || ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression);
}

/**
 * The value an expression holds, looking through parentheses, a type
 * assertion, `satisfies` and a call of `Object.freeze` on one value.
 *
 * @returns The innermost expression, or undefined when given undefined.
 */
function heldValue(expression: ts.Expression | undefined): ts.Expression | undefined {
  let inner = expression;
  while (inner !== undefined) {
    if (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)
      || ts.isTypeAssertionExpression(inner) || ts.isNonNullExpression(inner)) {
      inner = inner.expression;
    } else if (isFreezeCall(inner)) {
      inner = inner.arguments[0];
    } else {
      break;
    }
  }
  return inner;
}

/** Whether an expression calls `Object.freeze` on one value. */
function isFreezeCall(expression: ts.Expression): expression is ts.CallExpression {
  return ts.isCallExpression(expression) && expression.arguments.length === 1
    && ts.isPropertyAccessExpression(expression.expression) && ts.isIdentifier(expression.expression.expression)
    && expression.expression.expression.text === "Object" && expression.expression.name.text === "freeze";
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
  const fileName = join(REPOSITORY_ROOT, file).split(BACKSLASH).join("/");
  const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
  host.getSourceFile = sourceReader(host.getSourceFile, fileName, text);
  const program = ts.createProgram([fileName], COMPILER_OPTIONS, host);
  const source = program.getSourceFile(fileName);
  if (source === undefined) throw new Error(`The compiler did not read ${file}.`);
  return { source, checker: program.getTypeChecker() };
}

/**
 * A compiler host's reader that gives one file the text given, and reads
 * every other file from disk once, through SHARED_SOURCES.
 *
 * @returns The reader.
 */
function sourceReader(read: ts.CompilerHost["getSourceFile"], fileName: string, text: string): ts.CompilerHost["getSourceFile"] {
  return (name, version, onError) => {
    if (name === fileName) return ts.createSourceFile(name, text, version, true);
    const kept = SHARED_SOURCES.get(name);
    if (kept !== undefined) return kept;
    const made = read(name, version, onError);
    if (made !== undefined) SHARED_SOURCES.set(name, made);
    return made;
  };
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
 * the name a `catch` clause binds, or the parameter of a function handed to a
 * promise's `catch` or `then`. A value narrowed to an Error is not one.
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
 * Whether a declaration binds a caught value: a `catch` clause's name, or a
 * rejection handler's parameter, with the handler in parentheses or not.
 */
function isCaughtBinding(declaration: ts.Declaration): boolean {
  if (ts.isVariableDeclaration(declaration)) return ts.isCatchClause(declaration.parent);
  if (!ts.isParameter(declaration)) return false;
  const handler = declaration.parent;
  let call = handler.parent;
  while (ts.isParenthesizedExpression(call)) {
    call = call.parent;
  }
  return (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) && ts.isCallExpression(call)
    && ts.isPropertyAccessExpression(call.expression) && ["catch", "then"].includes(call.expression.name.text);
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
 * Every name a file binds to a function inside a function by destructuring
 * or by a default, and every parameter whose default is a function: rule 3's
 * nested helpers that a lint selector cannot see, since a selector cannot
 * tell which key of a literal a name is bound to.
 *
 * A name bound by destructuring reads the value or method its key, or its
 * position, holds in the literal destructured, at any depth, through the
 * wrappers a function value is read through. A name whose default is a
 * function is bound to one too. A rest element binds an object, not a
 * function, and a destructuring at the top level of a module binds no nested
 * helper. A parameter that an `@param` tag of its function's comment, or of
 * one of its overload signatures, names is part of the interface, so its own
 * default is not read; a default inside a destructured parameter is still
 * read. A name that a spread of unknown extent may give its value cannot be
 * read, so it is reported as such, naming the spread.
 *
 * @returns One "file / function / name" entry for each, in the order they
 *     appear, then, for each declaration, one entry for each name it
 *     cannot read, which says why.
 */
function boundHelpers(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const pending: ts.Node[] = [source];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    pending.push(...[...node.getChildren(source)].reverse());
    const declaration = helperDeclaration(node);
    if (declaration === null) continue;
    for (const name of new Set(helperNames(declaration.name, declaration.initializer))) {
      found.push(`${file} / ${enclosingFunctionName(name, source)} / ${name.text}`);
    }
    for (const { name, spread } of unknownPositions(declaration.name, declaration.initializer)) {
      found.push(`${file} / ${enclosingFunctionName(name, source)} / ${name.text}: ${unknownReason(spread, source)}, so what it holds cannot be read`);
    }
  }
  return found;
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

/**
 * Each name a binding gives a function, reading each literal the value
 * given may be, as `possibleValues` reads it, and, below it, each default.
 * A default is read whether or not the value given means it never runs,
 * since a function written there is bound to the name.
 */
function helperNames(binding: ts.BindingName, value: ts.Expression | undefined): ts.Identifier[] {
  if (ts.isIdentifier(binding)) return functionValues(value).length === 0 ? [] : [binding];
  const literals = possibleValues(value);
  const names: ts.Identifier[] = [];
  for (const [at, element] of binding.elements.entries()) {
    if (ts.isOmittedExpression(element) || element.dotDotDotToken !== undefined) continue;
    for (const literal of literals) {
      for (const held of elementSource(binding, element, at, literal).holders.map(heldBy)) {
        if (!ts.isMethodDeclaration(held)) names.push(...helperNames(element.name, held));
        else if (ts.isIdentifier(element.name)) names.push(element.name);
      }
    }
    names.push(...helperNames(element.name, element.initializer));
  }
  return names;
}

/**
 * A name whose value a spread of unknown extent may give, with that spread:
 * a position of an array literal after a spread of anything but an array or
 * string literal, or a key of an object literal that a spread of anything
 * but an object literal may give.
 */
interface UnknownPosition {
  name: ts.Identifier;
  spread: ts.SpreadElement | ts.SpreadAssignment;
}

/**
 * Each name a binding takes from a spread of unknown extent, at any depth,
 * reading each literal the value may be, as `possibleValues` reads it, and
 * each default. What such a name holds cannot be known without running the
 * code, so no rule can read it, and it is reported instead. A rest element
 * binds what is left over, not one item or key, so it is not one.
 */
function unknownPositions(binding: ts.BindingName, value: ts.Expression | undefined): UnknownPosition[] {
  if (ts.isIdentifier(binding)) return [];
  const literals = possibleValues(value);
  const found: UnknownPosition[] = [];
  for (const [at, element] of binding.elements.entries()) {
    if (ts.isOmittedExpression(element) || element.dotDotDotToken !== undefined) continue;
    for (const literal of literals) {
      const { holders, unknownAfter } = elementSource(binding, element, at, literal);
      if (unknownAfter !== null) found.push(...boundNames(element.name).map((name) => ({ name, spread: unknownAfter })));
      for (const held of holders.map(heldBy)) {
        if (!ts.isMethodDeclaration(held)) found.push(...unknownPositions(element.name, held));
      }
    }
    found.push(...unknownPositions(element.name, element.initializer));
  }
  return found;
}

/**
 * Why the rules cannot read a name that a spread of unknown extent may give
 * its value, as a clause about the name.
 */
function unknownReason(spread: ts.SpreadElement | ts.SpreadAssignment, source: ts.SourceFile): string {
  if (ts.isSpreadElement(spread)) return `its position follows ${spread.getText(source)}, whose length is not known`;
  return `its key may be given by ${spread.getText(source)}, whose keys are not known`;
}

/** Where one binding element of a pattern takes its value from, in one literal. */
interface ElementSource {
  /**
   * Each property or method of an object literal that gives the element's
   * key, or the item of an array literal at its position: every one that may
   * give its value, a later one as well as one it overrides.
   */
  holders: Array<ts.PropertyAssignment | ts.MethodDeclaration | ts.Expression>;
  /** The spread of unknown extent that may give the element its value instead, or null. */
  unknownAfter: ts.SpreadElement | ts.SpreadAssignment | null;
}

/**
 * Where a binding element takes its value from in one literal: by key from an
 * object literal, through each spread of an object literal, or by position
 * from an array literal, through each spread of an array or string literal.
 *
 * @returns No holder and no spread when the literal is not the kind the
 *     pattern reads.
 */
function elementSource(pattern: ts.BindingPattern, element: ts.BindingElement, at: number, literal: ts.Expression): ElementSource {
  if (ts.isObjectBindingPattern(pattern)) return keyedProperties(literal, boundKey(element));
  const item = literalItem(literal, at);
  return { holders: item === undefined ? [] : [item], unknownAfter: unknownSpread(literal, at) };
}

/** The value a property gives, or the method or array item itself. */
function heldBy(holder: ts.PropertyAssignment | ts.MethodDeclaration | ts.Expression): ts.Expression | ts.MethodDeclaration {
  return ts.isPropertyAssignment(holder) ? holder.initializer : holder;
}

/**
 * Each property or method of an object literal that gives one key, read
 * through each spread of another object literal, with the spread of anything
 * else that may give it a value after the last of them.
 *
 * @returns No holder and no spread when the literal is not an object
 *     literal or the key cannot be known.
 */
function keyedProperties(literal: ts.Expression, key: string | undefined): ElementSource {
  const found: ElementSource = { holders: [], unknownAfter: null };
  if (key === undefined || !ts.isObjectLiteralExpression(literal)) return found;
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = heldValue(property.expression);
      if (spread === undefined || !ts.isObjectLiteralExpression(spread)) {
        found.unknownAfter = property;
        continue;
      }
      const inner = keyedProperties(spread, key);
      found.holders.push(...inner.holders);
      // A key the inner literal gives is settled there, unless a spread inside it comes later.
      if (inner.holders.length > 0 || inner.unknownAfter !== null) found.unknownAfter = inner.unknownAfter;
      continue;
    }
    if ((ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) && keyText(property.name) === key) {
      found.holders.push(property);
      found.unknownAfter = null;
    }
  }
  return found;
}

/**
 * The item an array literal holds at one position, counting each item a
 * spread of another array literal, or of a string literal, gives it.
 *
 * @returns The item, or undefined when the literal is not an array literal,
 *     holds a hole or nothing there, or when the position falls after a
 *     spread of anything else, whose length is not written there. Such a
 *     position is not known, and `unknownSpread` names the spread.
 */
function literalItem(literal: ts.Expression | undefined, at: number): ts.Expression | undefined {
  return literal !== undefined && ts.isArrayLiteralExpression(literal) ? spreadItems(literal).items[at] : undefined;
}

/**
 * The spread a position of an array literal follows when that spread ends
 * the positions known, so the item there cannot be read.
 *
 * @returns The spread, or null when the position is known or the literal is
 *     not an array literal.
 */
function unknownSpread(literal: ts.Expression, at: number): ts.SpreadElement | null {
  if (!ts.isArrayLiteralExpression(literal)) return null;
  const { items, unknownAfter } = spreadItems(literal);
  return at < items.length ? null : unknownAfter;
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
}

/** The items an array literal holds, as far as its spreads let them be known. */
function spreadItems(literal: ts.ArrayLiteralExpression): SpreadItems {
  const items: Array<ts.Expression | undefined> = [];
  for (const element of literal.elements) {
    if (ts.isOmittedExpression(element)) {
      items.push(undefined);
      continue;
    }
    if (!ts.isSpreadElement(element)) {
      items.push(element);
      continue;
    }
    const spread = heldValue(element.expression);
    // A spread of a string gives one item for each character, as its iterator counts them: by code point, not by UTF-16 unit.
    if (spread !== undefined && (ts.isStringLiteral(spread) || ts.isNoSubstitutionTemplateLiteral(spread))) {
      items.push(...Array.from(spread.text, () => spread));
      continue;
    }
    if (spread === undefined || !ts.isArrayLiteralExpression(spread)) return { items, unknownAfter: element };
    const inner = spreadItems(spread);
    items.push(...inner.items);
    if (inner.unknownAfter !== null) return { items, unknownAfter: inner.unknownAfter };
  }
  return { items, unknownAfter: null };
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
 * A function here is a function declaration, a method, a constructor, an
 * accessor, a variable, an object property or a class field whose value
 * is an arrow function or a function expression, also through
 * `Object.freeze`, or such a function held directly in an array, or bound
 * by destructuring an object or array literal. A function declared with
 * overloads is read with the comments of its signatures as well as its own,
 * so a `@throws` tag on any of them counts. A throw counts when it can leave
 * the function: not inside a nested function, and not inside a `try` block
 * whose `catch` takes it. A name a documented statement binds that a spread
 * of unknown extent may give its value cannot be read, so it is reported as
 * such, after the others.
 */
function undocumentedThrows(file: string, text: string): ThrowsCount {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const problems: string[] = [];
  let read = 0;
  for (const unit of documentedFunctions(source)) {
    if (!unit.bodies.some(throwsFromItsBody)) continue;
    read += 1;
    if (ts.getJSDocTags(unit.commented).some((tag) => tag.tagName.text === "throws")) continue;
    const line = source.getLineAndCharacterOfPosition(unit.commented.getStart(source)).line + 1;
    problems.push(`${file}:${line}: the comment on ${unit.name} does not say what it throws`);
  }
  for (const { name, spread, commented } of documentedUnknownPositions(source)) {
    const line = source.getLineAndCharacterOfPosition(commented.getStart(source)).line + 1;
    problems.push(`${file}:${line}: what ${name.text} binds cannot be read, as ${unknownReason(spread, source)}`);
  }
  return { read, problems };
}

/** A name a documented statement binds that a spread of unknown extent may give its value. */
interface DocumentedUnknownPosition extends UnknownPosition {
  /** The statement that carries the comment. */
  commented: ts.VariableStatement;
}

/**
 * Each name a documented variable statement binds that a spread of unknown
 * extent may give its value, so that the throws check cannot read what it
 * binds.
 */
function documentedUnknownPositions(source: ts.SourceFile): DocumentedUnknownPosition[] {
  const found: DocumentedUnknownPosition[] = [];
  const pending: ts.Node[] = [source];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    pending.push(...[...node.getChildren(source)].reverse());
    if (!ts.isVariableStatement(node) || !hasJsDoc(node)) continue;
    for (const declaration of node.declarationList.declarations) {
      found.push(...unknownPositions(declaration.name, declaration.initializer).map((position) => ({ ...position, commented: node })));
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
  bodies: readonly ts.Node[];
}

/** Every function in a file that has a JSDoc comment and a body. */
function documentedFunctions(source: ts.SourceFile): DocumentedFunction[] {
  const found: DocumentedFunction[] = [];
  const pending: ts.Node[] = [source];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    pending.push(...node.getChildren(source));
    const unit = asDocumentedFunction(node, source);
    if (unit !== null) found.push(unit);
    found.push(...destructuredFunctions(node));
  }
  return found;
}

/**
 * Each function a documented variable statement binds, read with the
 * statement's comment: each name it declares whose value may be a function,
 * and each function it binds by destructuring an object or array literal.
 */
function destructuredFunctions(node: ts.Node): DocumentedFunction[] {
  if (!ts.isVariableStatement(node) || !hasJsDoc(node)) return [];
  const bodies = new Map<string, ts.Node[]>();
  for (const declaration of node.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) {
      boundFunctions(declaration.name, declaration.initializer, bodies);
      continue;
    }
    const held = functionBodies(declaration.initializer);
    if (held.length > 0) bodies.set(declaration.name.text, [...bodies.get(declaration.name.text) ?? [], ...held]);
  }
  // A name read from more than one place, such as its value and its default, is one function to the reader.
  return [...bodies].map(([name, held]) => ({ name, commented: node, bodies: held }));
}

/**
 * Each function a binding pattern binds from a value, added to the bodies
 * held for each name. Each literal the value may be, as `possibleValues`
 * reads it, is read. A name bound to an object's key reads that key's value
 * or method, whatever the key's spelling; a name bound by position reads the
 * item there; a nested pattern reads the nested literal; and every name and
 * nested pattern also reads its default, whether or not the value given
 * means the default never runs, since a function written there is bound to
 * the name. A key written as a computed name other than a string is not
 * read, nor is a property or an array item with a comment of its own, which
 * is read with that comment.
 */
function boundFunctions(pattern: ts.BindingPattern, value: ts.Expression | undefined, bodies: Map<string, ts.Node[]>): void {
  const literals = possibleValues(value);
  for (const [at, element] of pattern.elements.entries()) {
    if (ts.isOmittedExpression(element)) continue;
    const name = element.name;
    // A property or an array item with a comment of its own is read with that comment.
    const given = literals.flatMap((literal) => elementSource(pattern, element, at, literal).holders).filter((holder) => !hasJsDoc(holder)).map(heldBy);
    if (!ts.isIdentifier(name)) {
      for (const held of given) {
        if (!ts.isMethodDeclaration(held)) boundFunctions(name, held, bodies);
      }
      boundFunctions(name, element.initializer, bodies);
      continue;
    }
    const held = [...given.flatMap(functionBodies), ...functionBodies(element.initializer)];
    if (held.length > 0) bodies.set(name.text, [...bodies.get(name.text) ?? [], ...held]);
  }
}

/** The key a binding element reads from an object, or undefined when it cannot be known without running the code. */
function boundKey(element: ts.BindingElement): string | undefined {
  if (element.propertyName !== undefined) return keyText(element.propertyName);
  return ts.isIdentifier(element.name) ? element.name.text : undefined;
}

/** The text of a property's key, or undefined when it is computed from anything but a string or number literal. */
function keyText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && (ts.isStringLiteral(name.expression) || ts.isNumericLiteral(name.expression))) return name.expression.text;
  return undefined;
}

/** The body of each function a value may hold, or of a method, none when it holds no function. */
function functionBodies(value: ts.Expression | ts.MethodDeclaration | undefined): ts.Node[] {
  if (value !== undefined && ts.isMethodDeclaration(value)) return value.body === undefined ? [] : [value.body];
  return functionValues(value).map((held) => held.body);
}

/** The node as a documented function, or null when it is not one. */
function asDocumentedFunction(node: ts.Node, source: ts.SourceFile): DocumentedFunction | null {
  // A function, method or constructor is read with the comments of its overload signatures as well as its own.
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) && node.body !== undefined) {
    const commented = commentRead(node);
    return commented === null ? null : { name: node.name?.getText(source) ?? "constructor", commented, bodies: [node.body] };
  }
  if (!hasJsDoc(node)) return null;
  if ((ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body !== undefined) {
    return { name: node.name.getText(source), commented: node, bodies: [node.body] };
  }
  // An object property or a class field whose value is a function.
  if (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) {
    const bodies = functionBodies(node.initializer);
    if (bodies.length > 0) return { name: node.name.getText(source), commented: node, bodies };
  }
  // A function held directly in an array, whose comment sits on the item.
  if (ts.isArrayLiteralExpression(node.parent) && ts.isExpression(node)) {
    const bodies = functionBodies(node);
    if (bodies.length > 0) return { name: "an array item", commented: node, bodies };
  }
  return null;
}

/** Whether a node carries a JSDoc comment. */
function hasJsDoc(node: ts.Node): boolean {
  return ts.getJSDocCommentsAndTags(node).some((comment) => ts.isJSDoc(comment));
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
  const said = documented.find((commented) => ts.getJSDocTags(commented).some((tag) => tag.tagName.text === "throws"));
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
