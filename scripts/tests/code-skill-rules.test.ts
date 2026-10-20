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
//    its reason. Tested here.
// 2. Interface comment present. A caller learns what a function does without
//    reading its body. Every top-level export has a JSDoc comment, tested in
//    source-comments.test.ts. A comment on a function that throws says what
//    it throws, tested here.
// 3. Helpers at top level. A reader cannot reach a closure without reading
//    its container first. A function declaration, a variable holding a
//    function, or an object method or accessor inside a function is refused
//    by the "code skill" syntax selector in eslint.config.mjs, probed in
//    lint-rules.test.ts. A variable holding a function through
//    Object.freeze counts, and so does a name bound by destructuring a
//    literal, frozen or not, that holds a function, or whose default is a
//    function. Otherwise a property holding an arrow is left alone: it is a
//    value handed on, most often a stand-in for a dependency.
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
});

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
 * A value a call builds with a callback is not one.
 */
function entryPointProblem(file: string, text: string): EntryPoint {
  const { source, checker } = typedSource(file, text);
  const first = firstFunction(source, checker);
  if (first === null) return { checked: false, problem: null };
  if (exportedNames(source, first).length > 0) return { checked: true, problem: null };
  const line = source.getLineAndCharacterOfPosition(first.statement.getStart(source)).line + 1;
  return { checked: true, problem: `${file}:${line}: the first function, ${first.name}, is not exported` };
}

/** The first top-level function of a module. */
interface FirstFunction {
  name: string;
  exported: boolean;
  statement: ts.Statement;
}

/** The first top-level function of a module, or null when it holds none. */
function firstFunction(source: ts.SourceFile, checker: ts.TypeChecker): FirstFunction | null {
  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement)
      && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      return { name: statement.name.text, exported, statement };
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const callable = boundNames(declaration.name).find((name) => checker.getTypeAtLocation(name).getCallSignatures().length > 0);
      if (callable !== undefined) return { name: callable.text, exported, statement };
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
 * The function an expression holds, looking through parentheses, a type
 * assertion and `satisfies`, which change nothing that runs, and through a
 * call of `Object.freeze` on one value, which returns the value it is given.
 * Any other call with a callback runs it to build a value, so it holds none.
 *
 * @returns The arrow function or function expression, or null when the
 *     expression holds neither, or is undefined.
 */
function functionValue(expression: ts.Expression | undefined): ts.ArrowFunction | ts.FunctionExpression | null {
  const inner = heldValue(expression);
  return inner !== undefined && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) ? inner : null;
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
 *     with when they differ, or null when they match.
 */
function shimProblem(shim: string, shimText: string, module: string, moduleText: string): string | null {
  const run = shimEntryPoint(shim, shimText);
  const typed = typedSource(module, moduleText);
  const first = firstFunction(typed.source, typed.checker);
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
 * `cli.runCli()`.
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
    const callee = call.expression;
    if (ts.isIdentifier(callee)) return importedNames(source).get(callee.text) ?? callee.text;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaceImports(source).has(callee.expression.text)) {
      return callee.name.text;
    }
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
 * whose `catch` takes it.
 */
function undocumentedThrows(file: string, text: string): ThrowsCount {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const problems: string[] = [];
  let read = 0;
  for (const unit of documentedFunctions(source)) {
    if (!throwsFromItsBody(unit.body)) continue;
    read += 1;
    if (ts.getJSDocTags(unit.commented).some((tag) => tag.tagName.text === "throws")) continue;
    const line = source.getLineAndCharacterOfPosition(unit.commented.getStart(source)).line + 1;
    problems.push(`${file}:${line}: the comment on ${unit.name} does not say what it throws`);
  }
  return { read, problems };
}

/** A function with a JSDoc comment, as the throws check reads it. */
interface DocumentedFunction {
  name: string;
  /** The node the comment is attached to. */
  commented: ts.Node;
  body: ts.Node;
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
 * Each function a documented variable statement binds by destructuring an
 * object or array literal, read with the statement's comment.
 */
function destructuredFunctions(node: ts.Node): DocumentedFunction[] {
  if (!ts.isVariableStatement(node) || !hasJsDoc(node)) return [];
  return node.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? []
    : boundFunctions(declaration.name, heldValue(declaration.initializer), node));
}

/**
 * Each function a binding pattern binds from a literal. A name bound to an
 * object's key reads that key's value or method, whatever the key's
 * spelling; a name bound by position reads the item there; a nested pattern
 * reads the nested literal; and a name the literal gives no function reads
 * its default. A key written as a computed name other than a string is not
 * read, nor is a property with a comment of its own, which is read with that
 * comment.
 */
function boundFunctions(pattern: ts.BindingPattern, literal: ts.Expression | undefined, commented: ts.Node): DocumentedFunction[] {
  const found: DocumentedFunction[] = [];
  for (const [at, element] of pattern.elements.entries()) {
    if (ts.isOmittedExpression(element)) continue;
    const value = ts.isObjectBindingPattern(pattern) ? keyValue(literal, boundKey(element)) : itemValue(literal, at);
    if (!ts.isIdentifier(element.name)) {
      const nested = value === undefined || ts.isMethodDeclaration(value) ? undefined : value;
      found.push(...boundFunctions(element.name, heldValue(nested ?? element.initializer), commented));
      continue;
    }
    const body = functionBody(value) ?? functionBody(element.initializer);
    if (body !== null) found.push({ name: element.name.text, commented, body });
  }
  return found;
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

/**
 * The value or method an object literal gives one key.
 *
 * @returns It, or undefined when the literal is not an object literal, has no
 *     such key, or documents that property with a comment of its own.
 */
function keyValue(literal: ts.Expression | undefined, key: string | undefined): ts.Expression | ts.MethodDeclaration | undefined {
  if (literal === undefined || key === undefined || !ts.isObjectLiteralExpression(literal)) return undefined;
  for (const property of literal.properties) {
    if ((!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property)) || keyText(property.name) !== key) continue;
    if (hasJsDoc(property)) return undefined;
    return ts.isPropertyAssignment(property) ? property.initializer : property;
  }
  return undefined;
}

/** The item an array literal holds at one position, or undefined when it is not an array literal or holds none there. */
function itemValue(literal: ts.Expression | undefined, at: number): ts.Expression | undefined {
  return literal !== undefined && ts.isArrayLiteralExpression(literal) ? literal.elements[at] : undefined;
}

/** The body of the function a value holds, or of a method, or null when it holds no function. */
function functionBody(value: ts.Expression | ts.MethodDeclaration | undefined): ts.Node | null {
  if (value !== undefined && ts.isMethodDeclaration(value)) return value.body ?? null;
  return functionValue(value)?.body ?? null;
}

/** The node as a documented function, or null when it is not one. */
function asDocumentedFunction(node: ts.Node, source: ts.SourceFile): DocumentedFunction | null {
  // A function, method or constructor is read with the comments of its overload signatures as well as its own.
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) && node.body !== undefined) {
    const commented = commentRead(node);
    return commented === null ? null : { name: node.name?.getText(source) ?? "constructor", commented, body: node.body };
  }
  if (!hasJsDoc(node)) return null;
  if ((ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body !== undefined) {
    return { name: node.name.getText(source), commented: node, body: node.body };
  }
  if (ts.isVariableStatement(node)) {
    const declaration = node.declarationList.declarations[0];
    const value = functionValue(declaration?.initializer);
    if (declaration !== undefined && value !== null) {
      return { name: declaration.name.getText(source), commented: node, body: value.body };
    }
  }
  // An object property or a class field whose value is a function.
  if (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) {
    const value = functionValue(node.initializer);
    if (value !== null) return { name: node.name.getText(source), commented: node, body: value.body };
  }
  // A function held directly in an array, whose comment sits on the item.
  if (ts.isArrayLiteralExpression(node.parent) && ts.isExpression(node)) {
    const value = functionValue(node);
    if (value !== null) return { name: "an array item", commented: node, body: value.body };
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
function commentRead(implementation: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration): ts.Node | null {
  const parent = implementation.parent;
  let siblings: readonly ts.Node[] = [];
  if (ts.isClassLike(parent)) siblings = parent.members;
  else if (ts.isSourceFile(parent) || ts.isBlock(parent) || ts.isModuleBlock(parent)) siblings = parent.statements;
  const name = implementation.name?.getText();
  const documented: ts.Node[] = hasJsDoc(implementation) ? [implementation] : [];
  for (let at = siblings.indexOf(implementation) - 1; at >= 0; at -= 1) {
    const signature = siblings[at];
    if (signature === undefined || signature.kind !== implementation.kind) break;
    if (!ts.isFunctionDeclaration(signature) && !ts.isMethodDeclaration(signature) && !ts.isConstructorDeclaration(signature)) break;
    if (signature.body !== undefined || signature.name?.getText() !== name) break;
    if (hasJsDoc(signature)) documented.unshift(signature);
  }
  const said = documented.find((commented) => ts.getJSDocTags(commented).some((tag) => tag.tagName.text === "throws"));
  return said ?? (hasJsDoc(implementation) ? implementation : documented[0] ?? null);
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
