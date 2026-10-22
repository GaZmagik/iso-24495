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


/**
 * The files written here of each program a check here made, by the
 * program's checker: every file but a declaration file and a library's.
 */
const PROGRAM_SOURCES = new WeakMap<ts.TypeChecker, readonly ts.SourceFile[]>();

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
  "a member of a value that holds it, which by its declared type is not the function":
    "The member's declared type uses neither the receiver nor a type parameter that carries the function, and its type has no place that may be or hold a function, so its value is neither the function nor a value holding it, as expect(check).toThrow() returns nothing.",
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
//    wherever rule 3's test below would find one, or when its value,
//    followed through each function written here that gives it, is one,
//    whether a destructuring takes it from that value or from a literal
//    that holds the call that gives it.
//    A value no rule can follow is read by its declared type: a part of
//    it that can be called, as in `(() => number) | undefined`, makes it
//    a function. Tested here.
// 2. Interface comment present. A caller learns what a function does without
//    reading its body. Every top-level export has a JSDoc comment, tested in
//    source-comments.test.ts. A comment on a function that throws says what
//    it throws, tested here. A function written as a value is read with the
//    nearest comment of its own: on it, on a wrapper around it, or on the
//    property or array item that holds it; failing that, with the comment on
//    the class field that holds it, on the parameter whose default it is,
//    or on the statement that binds it to a name or assigns it. A JSDoc
//    comment written just before an array item, a property, a class
//    member or a statement is its own, as the scanner finds it, whether or
//    not the compiler attaches it, as it does not to one written on the
//    line of the brace or comma before it. Of two or more written one
//    after another, each is its own, the earlier as well as the later.
//    A rest element with a name binds an array, not a function.
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
//    declared here that returns it. A function declared with overloads is
//    read through its implementation's body, and a function whose type an
//    annotation declares through the function the annotated name, field,
//    property, item read by index, getter or call's value holds, or the
//    constructor of the class it holds. `call`, `apply`, `bind`,
//    `Reflect.apply` and `Reflect.construct` are read as the call they make,
//    and a value one hands on where no parameter takes it, such as `this`,
//    cannot be read. A wrapper is followed to where its value is written:
//    through a name destructured from the literal a call of a function
//    written here returns, a for-of over an array literal, a parameter's
//    default, and the argument at a parameter's position in every call of
//    its function in the program. A parameter whose calls cannot all be
//    found, as for a function no code here calls, one handed on as a
//    value, a method, or a callback given to a library, may be given any
//    value its type allows, so it cannot be followed. A name written under
//    `declare` is read by its declared type, as a library's is. A variable, class
//    field or property is followed to its initializer and to every
//    assignment written to it in the program, in a constructor or
//    anywhere else, and a call of such a name runs each function it may
//    hold, whatever type the compiler took from its first value. One that
//    a destructuring, a for-in or a for-of assigns, or that is declared
//    with no value that an assignment gives it, cannot be followed. A
//    for-of reads the items of the array literal a collection is made
//    from, as `new Set([...])` holds them, and a name whose array, set or
//    map code may change through a member, as `push`, `add` and
//    `list[0] =` do, cannot be followed; a method the library's
//    ReadonlyArray, ReadonlySet or ReadonlyMap declares only reads. A function
//    written here that cannot be followed may give back or hold any
//    argument. A body that passes an argument on, by any use but
//    calling it, or a constructor whose parameter is written as a property,
//    may give it back when the declared result fits it, unless
//    each value it returns is a function or literal it writes new, or hold
//    it, in a literal, a name or a typed return,
//    when the declared result has a place that may hold a function. A key is
//    read whatever its spelling: against an array literal, an index key
//    reads the item there. A name a spread of unknown extent, a key not
//    known, or a call that may hold a function written in its arguments, or
//    a member of such a call, may give its value cannot be read, so it fails the test, naming the name and
//    why; the same holds for the other two tests. A name whose type cannot
//    be a function, such as a number, a string, an array, or an object that
//    asks for a property a function lacks, binds no function, so the
//    nested-helper, throws and entry-point tests pass it, whatever made its
//    value unknown. A parameter its function's @param tag
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
// may give it back and each literal that holds it, to where it ends. A call
// whose value may hold what it is given, as Array.of's array does, is
// followed as a literal is. A function handed to a call where no parameter
// takes it, as `this` is by `call`, fails. A member of a value that holds the function
// is read by its declared type: one that may be the function fails, and one
// that may hold it is followed on. It ends at a name the rules read, or at
// one of the places in ALLOWED_POSITIONS, each with the reason it is safe.
// A function that ends anywhere else fails the test, naming the function,
// its file and its line, and so does a place whose reason is missing, and a
// function-like kind of node that neither FOLLOWED_KINDS nor TYPE_KINDS
// names.
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

  test("a @param tag documents a parameter wherever the function's own comment is written, the compiler attaches it or not", () => {
    const reader = "read: () => number = (): number => 1";
    // Each form, with TAG where its comment names a parameter, and the function the nested-helper check names.
    const forms: Array<[form: string, owner: string]> = [
      [`export const bag = { /** Reads a size. TAG */\n  read(${reader}): number {\n    return read();\n  },\n};\n`, "read"],
      [`export class Bag { /** Reads a size. TAG */\n  read(${reader}): number {\n    return read();\n  }\n}\n`, "read"],
      [`/** TAG */\n/** Reads a size. */\nexport function main(${reader}): number {\n  return read();\n}\n`, "main"],
      [`const size = 1; /** Reads a size. TAG */\nexport const main = (${reader}): number => read() + size;\n`, "main"],
      [`export class Bag { /** Reads a size. TAG */\n  read(read?: () => number): number;\n  read(${reader}): number {\n    return read();\n  }\n}\n`, "read"],
    ];
    for (const [form, owner] of forms) {
      expect(boundHelpers("probe.ts", form.replace("TAG", "@param read The reader.")), form).toEqual([]);
      // A tag that names another parameter documents nothing here.
      expect(boundHelpers("probe.ts", form.replace("TAG", "@param other Not this one.")), form).toEqual([`probe.ts / ${owner} / read`]);
    }
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

  test("a shim's exit call and the member it runs are read through any wrapper, by name or by a key written as a literal", () => {
    const shim = "import * as cli from \"./probe.ts\";\n";
    for (const call of [
      "(process.exit)(cli.runCli());", "process.exit(cli[\"runCli\"]());", "process[\"exit\"](cli.runCli());", "((process)).exit(cli.runCli());",
      "(process.exit as (code: number) => never)(cli.runCli());", "process.exit((cli[\"runCli\"])());", "process.exit(cli[`runCli`]());",
    ]) {
      expect(shimEntryPoint("probe-cli.ts", shim + call), call).toBe("runCli");
    }
    // Anything but process.exit is no exit call, and a key that is not a literal names no member.
    for (const call of ["process.kill(cli.runCli());", "other.exit(cli.runCli());", "process[key](cli.runCli());", "process.exit(cli[key]());", "exit(cli.runCli());"]) {
      expect(shimEntryPoint("probe-cli.ts", shim + call), call).toBeNull();
    }
    const module = "export function runCli(): number { return 0; }\nexport function auditText(): number { return 1; }\n";
    expect(shimProblem("probe-cli.ts", `${shim}(process.exit)(cli.runCli());`, "probe.ts", module)).toBeNull();
    expect(shimProblem("probe-cli.ts", `${shim}process.exit(cli["auditText"]());`, "probe.ts", module))
      .toBe("probe-cli.ts runs auditText, but probe.ts leads with runCli");
  });

  test("a shim's exit call is read through a wrapper around the statement, the argument or a literal key", () => {
    const shim = "import * as cli from \"./probe.ts\";\n";
    for (const call of [
      "(process.exit(cli.runCli()));", "((process.exit(cli.runCli())));", "process.exit(cli.runCli() satisfies number);",
      "process.exit((await cli.runCli()) satisfies number);", "process.exit(await (cli.runCli() as Promise<number>));",
      "process.exit(cli[(\"runCli\")]());", "process[(\"exit\")](cli.runCli());", "process.exit(cli[\"runCli\" as \"runCli\"]());",
    ]) {
      expect(shimEntryPoint("probe-cli.ts", shim + call), call).toBe("runCli");
    }
    // A wrapper changes nothing else: another call is still no exit call, and another function is still a mismatch.
    for (const call of ["(process.kill(cli.runCli()));", "process[(key)](cli.runCli());", "(runCli(process.argv));"]) {
      expect(shimEntryPoint("probe-cli.ts", shim + call), call).toBeNull();
    }
    const module = "export function runCli(): number { return 0; }\nexport function auditText(): number { return 1; }\n";
    expect(shimProblem("probe-cli.ts", `${shim}(process.exit(cli.runCli()));`, "probe.ts", module)).toBeNull();
    expect(shimProblem("probe-cli.ts", `${shim}(process.exit(cli.auditText() satisfies number));`, "probe.ts", module))
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

  test("a parameter's own comment documents the function it is given by default, and must say what it throws", () => {
    const thrower = "(): never => {\n    throw new RangeError(\"size\");\n  }";
    const comments: Array<[comment: string, problems: string[]]> = [
      ["/** Reads the default size. */", ["probe.ts:7: the comment on read does not say what it throws"]],
      ["/**\n   * Reads the default size.\n   * @throws A `RangeError` always.\n   */", []],
    ];
    const documented = "/**\n * Reads a size.\n * @param read The reader.\n */\n";
    for (const [comment, problems] of comments) {
      const lines = comment.split("\n").length - 1;
      const texts: Array<[text: string, line: number]> = [
        [`${documented}export function main(\n  ${comment}\n  read: () => number = ${thrower},\n): number {\n  return read();\n}`, 7],
        [`${documented}export function main(\n  ${comment}\n  { read = ${thrower} }: { read?: () => number },\n): number {\n  return read();\n}`, 7],
        [`/** Holds a reader. */\nexport class Box {\n  ${documented.replace(/\n/g, "\n  ")}constructor(\n    ${comment.replace(/\n/g, "\n  ")}\n`
          + `    readonly read: () => number = ${thrower.replace(/\n/g, "\n  ")},\n  ) {}\n}`, 9],
      ];
      for (const [text, line] of texts) {
        expect(undocumentedThrows("probe.ts", text), text).toEqual({ read: 1, problems: problems.map((problem) => problem.replace(":7:", `:${line + lines}:`)) });
      }
    }
  });

  test("a statement that assigns a function documents it, and must say what it throws", () => {
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    const holder = "const holder: { read?: () => number; [key: string]: unknown } = {};\n";
    const said = "/**\n * Reads a size.\n * @throws A `RangeError` always.\n */\n";
    for (const target of ["holder.read", "holder[\"read\"]", "holder.read!"]) {
      expect(undocumentedThrows("probe.ts", `${holder}/** Reads a size. */\n${target} = ${thrower};`), target)
        .toEqual({ read: 1, problems: ["probe.ts:3: the comment on read does not say what it throws"] });
      expect(undocumentedThrows("probe.ts", `${holder}${said}${target} = ${thrower};`), target).toEqual({ read: 1, problems: [] });
    }
    // A key that is not a literal names the function as written.
    expect(undocumentedThrows("probe.ts", `${holder}const key = "read" as string;\n/** Reads a size. */\nholder[key] = ${thrower};`))
      .toEqual({ read: 1, problems: ["probe.ts:4: the comment on key does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", `export function main(): void {\n  let read: () => number;\n  /** Reads a size. */\n  read = ${thrower};\n  read();\n}`))
      .toEqual({ read: 1, problems: ["probe.ts:4: the comment on read does not say what it throws"] });
  });

  test("an assignment in parentheses, or under a type wrapper, that is a statement of its own is read as the bare statement is", () => {
    const thrower = "(): never => {\n    throw new RangeError(\"size\");\n  }";
    const said = "/** Reads a size. @throws A `RangeError` always. */";
    for (const wrapped of [`(box.read = ${thrower});`, `((box.read = ${thrower}));`, `(box["read"] = ${thrower});`, `(box.read = ${thrower}) satisfies unknown;`]) {
      const text = `export function main(): void {\n  const box: { read?: () => number } = {};\n  COMMENT\n  ${wrapped}\n}\n`;
      expect(unplacedFunctions("probe.ts", text.replace("COMMENT", said)).problems, wrapped).toEqual([]);
      expect(undocumentedThrows("probe.ts", text.replace("COMMENT", said)), wrapped).toEqual({ read: 1, problems: [] });
      expect(undocumentedThrows("probe.ts", text.replace("COMMENT", "/** Reads a size. */")), wrapped)
        .toEqual({ read: 1, problems: ["probe.ts:4: the comment on read does not say what it throws"] });
      expect(boundHelpers("probe.ts", text.replace("COMMENT", said)), wrapped).toEqual([]);
    }
    // A name assigned inside a function is a nested helper however the statement is wrapped.
    expect(boundHelpers("probe.ts", "export function main(): number {\n  let helper: () => number;\n  (helper = (): number => 1);\n  return helper();\n}\n"))
      .toEqual(["probe.ts / main / helper"]);
    // An assignment whose value is used as well is still not a statement of its own.
    for (const used of ["const kept = (box.read = (): number => 1);", "consume((box.read = (): number => 1));"]) {
      const text = `export function main(): void {\n  const box: { read?: () => number } = {};\n  ${used}\n}\ndeclare function consume(value: unknown): void;\n`;
      expect(unplacedFunctions("probe.ts", text).problems, used)
        .toEqual(["probe.ts:3: an arrow function cannot be placed: it is assigned by a destructuring, or by an assignment whose value is used as well, a place the allowed list does not name"]);
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

  test("each of two JSDoc comments written one after the other before a function is its own, the earlier as well as the later", () => {
    const said = "/** @throws A `RangeError` always. */";
    const unsaid = "/** Holds no tag. */";
    // Each form, with where its comments go, the statement that may stand before them on their line, and the line it is reported at.
    const forms: Array<[form: string, before: string, line: number]> = [
      ["COMMENTS\nexport function read(): never {\n  throw new RangeError(\"size\");\n}\n", "const size = 1;", 3],
      ["COMMENTS\nexport function read(size: string): number;\nexport function read(size: number): number;\n"
        + "export function read(size: string | number): number {\n  throw new RangeError(String(size));\n}\n", "const size = 1;", 3],
      ["COMMENTS\nexport const read = (): never => {\n  throw new RangeError(\"size\");\n};\n", "const size = 1;", 3],
      ["export class Box {\n  COMMENTS\n  read(): never {\n    throw new RangeError(\"size\");\n  }\n}\n", "size = 1;", 4],
    ];
    for (const [form, before, line] of forms) {
      for (const comments of [`${said}\n${unsaid}`, `${unsaid}\n${said}`, `${before} ${said}\n${unsaid}`]) {
        expect(undocumentedThrows("probe.ts", form.replace("COMMENTS", comments)), comments + form).toEqual({ read: 1, problems: [] });
      }
      expect(undocumentedThrows("probe.ts", form.replace("COMMENTS", `${unsaid}\n/** Reads a size. */`)), form)
        .toEqual({ read: 1, problems: [`probe.ts:${line}: the comment on read does not say what it throws`] });
    }
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
    const tail = "\nexport function main(): number { return 1; }\ndeclare function made(): { helper: unknown };\n";
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
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const read = Object.freeze((${thrower}) satisfies () => never);`).problems)
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
      // A method whose value may hold what its receiver holds, as map gives an array, is followed on as the holder; here a name binds it.
      ["export const listed = [(): number => 1].map((check) => check());\n", []],
      // A function read back out of a value that holds it, or a function made from it, is read by no rule.
      ["export const helper = Array.of((n: number): number => n).pop();\n",
        ["probe.ts:1: an arrow function cannot be placed: it is read back out of a value that holds it, which no rule reads"]],
      ["export const helper = Array.of((n: number): number => n)[0];\n",
        ["probe.ts:1: an arrow function cannot be placed: it is read back out of a value that holds it, which no rule reads"]],
      ["export const helper = [(n: number): number => n][0];\n",
        ["probe.ts:1: an arrow function cannot be placed: it is read back out of a value that holds it, which no rule reads"]],
      ["export const helper = ((n: number): number => n).bind(null);\n",
        ["probe.ts:1: an arrow function cannot be placed: it is read back out of a value that holds it, which no rule reads"]],
      // A destructuring of a call that holds a function cannot be read, nor of what a method returns as its receiver.
      ["export function main(): number {\n  const [helper] = Array.of((n: number): number => n + 1);\n  return helper(1);\n}\n",
        ["probe.ts:2: an arrow function cannot be placed: its destructuring reads it from a value that is not a literal, such as a call that holds it, which no rule can read"]],
      ["export function main(): number {\n  const [helper] = Array.of((n: number): number => n + 1).fill(1 as never);\n  return helper(1);\n}\n",
        ["probe.ts:2: an arrow function cannot be placed: its destructuring reads it from a value that is not a literal, such as a call that holds it, which no rule can read"]],
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
      "a member of a value that holds it, which by its declared type is not the function":
        "import { expect } from \"bun:test\";\nexport function main(): void {\n  expect((): number => 1).not.toThrow();\n}\n",
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

  test("a call of an overloaded function gives back what its implementation returns, and its signatures carry the comment", () => {
    const keep = "\nfunction keep(reader: (n: number) => number): (n: number) => number;\nfunction keep(reader: (n: number) => number): (n: number) => number {\n  return reader;\n}\n";
    const helper = "(n: number): number => n + 1";
    expect(boundHelpers("probe.ts", `export function main(): number {\n  const helper = keep(${helper});\n  return helper(1);\n}\n${keep}`)).toEqual(["probe.ts / main / helper"]);
    // The implementation's parameters, not the signature's, say which argument it returns.
    const renamed = "\nfunction pick(reader: (n: number) => number): (n: number) => number;\nfunction pick(first: ((n: number) => number) | number, ...rest: number[]): ((n: number) => number) | number {\n  return rest.length > 0 ? 0 : first;\n}\n";
    expect(boundHelpers("probe.ts", `export function main(): number {\n  const helper = pick(${helper});\n  return helper(1);\n}\n${renamed}`)).toEqual(["probe.ts / main / helper"]);
    // A method declared with overloads reads the same way.
    const keeper = "\nclass Keeper {\n  keep(reader: (n: number) => number): (n: number) => number;\n  keep(reader: (n: number) => number): (n: number) => number {\n    return reader;\n  }\n}\n";
    expect(boundHelpers("probe.ts", `export function main(keeper: Keeper): number {\n  const helper = keeper.keep(${helper});\n  return helper(1);\n}\n${keeper}`)).toEqual(["probe.ts / main / helper"]);
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const read = keep(${thrower});${keep}`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", `/**\n * Reads a size.\n * @throws A \`RangeError\` always.\n */\nexport const read = keep(${thrower});${keep}`))
      .toEqual({ read: 1, problems: [] });
    // An exported overloaded function is still read with the comments of its signatures.
    const documented = "/**\n * Keeps a reader.\n * @throws A `RangeError` when no reader is given.\n */\nexport function keep(reader?: () => number): () => number;\n"
      + "export function keep(reader?: () => number): () => number {\n  if (reader === undefined) throw new RangeError(\"reader\");\n  return reader;\n}\n";
    expect(undocumentedThrows("probe.ts", documented)).toEqual({ read: 1, problems: [] });
    expect(unplacedFunctions("probe.ts", documented).problems).toEqual([]);
  });

  test("a function a call's value may hold, through a literal or a typed return, is followed, and a name destructured from it is reported", () => {
    const helper = "(): number => 1";
    const boxes = "\nfunction box(reader: () => number): [() => number] {\n  return [reader];\n}\n"
      + "function wrap(reader: () => number): { reader: () => number } {\n  return { reader };\n}\n"
      + "function hold(reader: () => number): [() => number] {\n  const held: [() => number] = [reader];\n  return held;\n}\n"
      + "function freeze(reader: () => number): readonly [() => number] {\n  return Object.freeze([reader] as const);\n}\n"
      + "function measure(reader: () => number): number[] {\n  return [reader()];\n}\n"
      + "function pick(reader: () => number): () => number {\n  const held: [() => number] = [reader];\n  return held[0];\n}\n";
    const unread = "probe.ts:2: an arrow function cannot be placed: its destructuring reads it from a value that is not a literal, such as a call that holds it, which no rule can read";
    const cases: Array<[body: string, found: string[], problems: string[]]> = [
      [`const [helper] = box(${helper});`, [`probe.ts / main / helper: it is read from box(${helper}), a call whose value may hold a function, so what it holds cannot be read`], [unread]],
      [`const { reader: helper } = wrap(${helper});`, [`probe.ts / main / helper: it is read from wrap(${helper}), a call whose value may hold a function, so what it holds cannot be read`], [unread]],
      [`const [helper] = hold(${helper});`, [`probe.ts / main / helper: it is read from hold(${helper}), a call whose value may hold a function, so what it holds cannot be read`], [unread]],
      [`const [helper] = freeze(${helper});`, [`probe.ts / main / helper: it is read from freeze(${helper}), a call whose value may hold a function, so what it holds cannot be read`], [unread]],
      [`const helper = box(${helper})[0];`, [], ["probe.ts:2: an arrow function cannot be placed: it is read back out of a value that holds it, which no rule reads"]],
      // A call whose declared result the function fits may give back the function itself, however its body reaches it.
      [`const helper = pick(${helper});`, ["probe.ts / main / helper"], []],
      // A name bound to the value that holds the function binds no function, and a call that only calls what it is given holds none.
      [`const boxed = box(${helper});`, [], []],
      [`const [size] = measure(${helper});`, [], []],
    ];
    for (const [body, found, problems] of cases) {
      const text = `export function main(): number {\n  ${body}\n  return 0;\n}\n${boxes}`;
      expect(boundHelpers("probe.ts", text), body).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, body).toEqual(problems);
    }
    // A name a destructuring takes from such a call is no helper when its type cannot be a function, and neither is a name passed through.
    const harness = "\ninterface Deps {\n  fetch: () => number;\n  today: () => string;\n}\n"
      + "function harness(overrides: Partial<Deps> = {}): { deps: Deps; files: Map<string, string> } {\n"
      + "  const deps: Deps = { fetch: () => 1, today: () => \"day\", ...overrides };\n  return { deps, files: new Map() };\n}\n"
      + "async function settle(reader: () => number): Promise<number> {\n  return Promise.resolve(reader).then((given) => given());\n}\n"
      + "function ask(options: { sleep: () => number }): (size: number) => number {\n  return (size) => size + options.sleep();\n}\n";
    const valid: Array<[body: string, found: string[], problems: string[]]> = [
      [`const { deps, files } = harness({ fetch: ${helper} });`, [], []],
      [`const { files } = harness({ fetch: ${helper} });`, [], []],
      [`const { deps: { fetch: helper } } = harness({ fetch: ${helper} });`,
        [`probe.ts / main / helper: it is read from harness({ fetch: ${helper} }), a call whose value may hold a function, so what it holds cannot be read`], [unread]],
      [`const size = await settle(${helper});`, [], []],
      [`const size = ask({ sleep: ${helper} })(2);`, [], []],
      ["const { deps } = harness(given);", [], []],
    ];
    for (const [body, found, problems] of valid) {
      const text = `export async function main(given: Partial<Deps>): Promise<number> {\n  ${body}\n  return 0;\n}\n${harness}`;
      expect(boundHelpers("probe.ts", text), body).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, body).toEqual(problems);
    }
  });

  test("a JSDoc comment written before an array item that no compiler attaches is the item's own", () => {
    const thrower = "Object.freeze((): never => {\n    throw new Error(\"bad\");\n  })";
    expect(undocumentedThrows("probe.ts", `/** Holds readers. */\nexport const readers = [\n  /** Throws. */ ${thrower},\n];`))
      .toEqual({ read: 1, problems: ["probe.ts:3: the comment on an array item does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", `export const readers = [\n  1,\n  /** Throws. */\n  ${thrower},\n];`))
      .toEqual({ read: 1, problems: ["probe.ts:4: the comment on an array item does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", `export const readers = [/** Throws. */ ${thrower}];`))
      .toEqual({ read: 1, problems: ["probe.ts:1: the comment on an array item does not say what it throws"] });
    expect(undocumentedThrows("probe.ts", `/** Holds readers. */\nexport const readers = [\n  /**\n   * Throws.\n   * @throws An \`Error\` always.\n   */ ${thrower},\n];`))
      .toEqual({ read: 1, problems: [] });
    expect(undocumentedThrows("probe.ts", `export const [read] = [\n  /** Throws. */ ${thrower},\n];`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on an array item does not say what it throws"] });
    // A comment that is not JSDoc documents nothing.
    expect(undocumentedThrows("probe.ts", `export const readers = [\n  /* Throws. */ ${thrower},\n];`)).toEqual({ read: 0, problems: [] });
  });

  test("a JSDoc comment on the line of the brace or comma before a property, a class member or a statement is its own", () => {
    const thrower = "(): never => {\n    throw new RangeError(\"size\");\n  }";
    const body = "(): never {\n    throw new RangeError(\"size\");\n  }";
    for (const [comment, problems] of [
      ["/** Reads a size. */", ["probe.ts:2: the comment on read does not say what it throws"]],
      ["/** Reads a size. @throws A `RangeError` always. */", []],
    ] as Array<[comment: string, problems: string[]]>) {
      for (const text of [
        `export const value = { ${comment}\n  read: ${thrower},\n};`,
        `export const value = { size: 1, ${comment}\n  read: ${thrower},\n};`,
        `export class Box { ${comment}\n  read = ${thrower};\n}`,
        `export class Box { ${comment}\n  read${body}\n}`,
        `export const value = { ${comment}\n  read${body},\n};`,
        `export const size = 1; ${comment}\nexport const read = ${thrower};`,
        `export const holder: { read?: () => never } = {}; ${comment}\n(holder.read) = ${thrower};`,
      ]) {
        expect(undocumentedThrows("probe.ts", text), text).toEqual({ read: 1, problems });
      }
    }
  });

  test("a name whose type cannot be a function is not a possible helper, wherever its position is unknown", () => {
    // A name bound to an array, or to an object a function could not be, binds no function, whatever the value holds.
    for (const parameter of ["values: number[]", "values: string[]", "values: boolean[]", "values: number[][]", "values: Array<{ size: number }>",
      "values: Array<{ run: () => number }>", "values: Array<Array<() => number>>"]) {
      expect(boundHelpers("probe.ts", `export function main(${parameter}): number {\n  const [first] = [...values];\n  return 0;\n}\n`), parameter).toEqual([]);
    }
    for (const parameter of ["values: Array<() => number>", "values: any[]", "values: unknown[]", "values: Array<number | (() => number)>", "values: object[]",
      "values: Array<{}>", "values: Array<{ name: string }>", "values: Array<{ size?: number }>", "values: Array<{ run: () => number } & (() => number)>"]) {
      expect(boundHelpers("probe.ts", `export function main(${parameter}): number {\n  const [first] = [...values];\n  return 0;\n}\n`), parameter)
        .toEqual([positionNotKnown("first", "...values")]);
    }
    expect(boundHelpers("probe.ts", "export function main<T>(values: T[]): number {\n  const [first] = [...values];\n  return 0;\n}\n")).toEqual([positionNotKnown("first", "...values")]);
    expect(boundHelpers("probe.ts", "export function main(fns: (() => number)[]): number {\n  const [first] = [...fns];\n  return first();\n}\n"))
      .toEqual([positionNotKnown("first", "...fns")]);
    // The throws check reads the same way.
    expect(undocumentedThrows("probe.ts", "declare const sizes: number[];\n/** The first size. */\nexport const [first] = [...sizes];\n")).toEqual({ read: 0, problems: [] });
    expect(undocumentedThrows("probe.ts", "declare const readers: Array<() => number>;\n/** The first reader. */\nexport const [first] = [...readers];\n"))
      .toEqual({ read: 0, problems: ["probe.ts:3: what first binds cannot be read, as its position follows ...readers, whose length is not known"] });
  });

  test("a first function is not found in a name a top-level destructuring takes from a call, unless its type may be a function", () => {
    const declared = "\nexport function main(): number { return 1; }\ninterface Deps {\n  fetch: () => number;\n}\n"
      + "function harness(overrides: Partial<Deps> = {}): { deps: Deps; files: Map<string, string> } {\n  return { deps: { fetch: () => 1, ...overrides }, files: new Map() };\n}\n"
      + "function box(reader: () => number): [unknown] {\n  return [reader];\n}\n";
    const helper = "(): number => 1";
    expect(entryPointProblem("probe.ts", `const { deps, files } = harness({ fetch: ${helper} });${declared}`)).toEqual({ checked: true, problem: null });
    expect(entryPointProblem("probe.ts", `const [first] = box(${helper});${declared}`)).toEqual({
      checked: true,
      problem: `probe.ts:1: what first holds cannot be read, as it is read from box(${helper}), a call whose value may hold a function, so the first function cannot be found`,
    });
  });

  test("a call whose body returns only values it writes new gives back none of what it passes on", () => {
    const helper = "(): void => undefined";
    // Each passes its callback to a timer, which is a use other than calling it.
    const clocks = "\nconst clock = {\n  schedule: (callback: () => void, ms: number): (() => void) => {\n"
      + "    const timer = setTimeout(callback, ms);\n    return () => clearTimeout(timer);\n  },\n};\n"
      + "function later(callback: () => void): () => void {\n  setTimeout(callback, 1);\n  return remembered(callback);\n}\n"
      + "function relay(callback: () => void, depth: number): () => void {\n  setTimeout(callback, 1);\n"
      + "  return depth > 0 ? relay(callback, depth - 1) : remembered(callback);\n}\n"
      + "declare function remembered(callback: () => void): () => void;\n";
    const cases: Array<[body: string, found: string[]]> = [
      // The function it returns is written in its body, so it is never the callback.
      [`const cancel = clock.schedule(${helper}, 1);`, []],
      // A value returned from elsewhere may be the callback, since its type fits.
      [`const helper = later(${helper});`, ["probe.ts / main / helper"]],
      [`const helper = relay(${helper}, 2);`, ["probe.ts / main / helper"]],
    ];
    for (const [body, found] of cases) {
      const text = `export function main(): void {\n  ${body}\n}\n${clocks}`;
      expect(boundHelpers("probe.ts", text), body).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, body).toEqual([]);
    }
  });

  test("a call of a function written under a type annotation reads the function the annotation describes", () => {
    const helper = "(): number => 1";
    // Each wrapper's type is declared apart from the function, so a call of it resolves to the type, which has no body.
    const boxes = "\ntype Boxer = (reader: () => number) => [() => number];\n"
      + "const box: (reader: () => number) => [() => number] = (reader) => [reader];\n"
      + "const aliased: Boxer = (reader) => [reader];\n"
      + "function boxing(reader: () => number): [() => number] {\n  return [reader];\n}\n"
      + "const renamed: Boxer = boxing;\n"
      + "const chosen: Boxer = Math.random() > 0.5 ? box : aliased;\n"
      + "var first: Boxer = Math.random() > 0.5 ? box : second;\nvar second: Boxer = first;\n"
      + "var again: Boxer = again(one) && box;\ndeclare const one: () => number;\n"
      + "class Boxes {\n  box: Boxer = (reader) => [reader];\n}\n"
      + "interface Holders {\n  box: Boxer;\n  hold(reader: () => number): [() => number];\n}\n"
      + "const holders: Holders = {\n  box: (reader) => [reader],\n  hold(reader) {\n    return [reader];\n  },\n};\n"
      + "const shared = { box };\nconst { box: unpacked } = { box };\n"
      + "namespace Boxing {\n  export const box: Boxer = (reader) => [reader];\n}\nimport imported = Boxing.box;\n"
      + "const keep: (reader: () => number) => () => number = (reader) => reader;\n"
      + "const measure: (reader: () => number) => number[] = (reader) => [reader()];\n"
      + "declare const declared: Boxer;\ndeclare function stated(reader: () => number): [() => number];\n";
    const unread = "probe.ts:2: an arrow function cannot be placed: its destructuring reads it from a value that is not a literal, such as a call that holds it, which no rule can read";
    const cases: Array<[body: string, found: string[], problems: string[]]> = [];
    for (const callee of ["box", "aliased", "renamed", "chosen", "second", "again", "new Boxes().box", "holders.box", "holders.hold", "shared.box", "unpacked", "imported", "Boxing.box"]) {
      cases.push([`const [helper] = ${callee}(${helper});`, [heldByCall("helper", `${callee}(${helper})`)], [unread]]);
    }
    cases.push(
      // A function the annotation describes that gives back what it is given gives back the function.
      [`const helper = keep(${helper});`, ["probe.ts / main / helper"], []],
      // One that only calls what it is given holds nothing, and a name bound to the value that holds the function binds no function.
      [`const [size] = measure(${helper});`, [], []],
      [`const boxed = box(${helper});`, [], []],
      // A function whose body is not written here is read by its declared types alone, as before.
      [`const [helper] = declared(${helper});`, [], []],
      [`const [helper] = stated(${helper});`, [], []],
    );
    for (const [body, found, problems] of cases) {
      const text = `export function main(): number {\n  ${body}\n  return 0;\n}\n${boxes}`;
      expect(boundHelpers("probe.ts", text), body).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, body).toEqual(problems);
    }
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const [read] = box(${thrower});${boxes}`))
      .toEqual({ read: 0, problems: [`probe.ts:2: what read binds cannot be read, as it is read from box(${thrower}), a call whose value may hold a function`] });
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const read = keep(${thrower});${boxes}`))
      .toEqual({ read: 1, problems: ["probe.ts:2: the comment on read does not say what it throws"] });
  });

  test("a constructor parameter written as a property holds what it is given in the instance", () => {
    const helper = "(): number => 1";
    const classes = "\nclass Box {\n  constructor(public reader: () => number) {}\n}\n"
      + "class Kept {\n  constructor(readonly reader: () => number) {}\n}\n"
      + "class Sub extends Box {}\n"
      + "class Counter {\n  size: number;\n  constructor(reader: () => number) {\n    this.size = reader();\n  }\n}\n";
    const unread = "probe.ts:2: an arrow function cannot be placed: its destructuring reads it from a value that is not a literal, such as a call that holds it, which no rule can read";
    const cases: Array<[body: string, found: string[], problems: string[]]> = [];
    for (const made of ["Box", "Kept", "Sub"]) {
      cases.push([`const { reader: helper } = new ${made}(${helper});`, [heldByCall("helper", `new ${made}(${helper})`)], [unread]]);
    }
    cases.push(
      [`const helper = new Box(${helper}).reader;`, [], ["probe.ts:2: an arrow function cannot be placed: it is read back out of a value that holds it, which no rule reads"]],
      // A name bound to the instance binds no function, and a constructor that only calls what it is given holds nothing.
      [`const box = new Box(${helper});`, [], []],
      [`const { size } = new Counter(${helper});`, [], []],
    );
    for (const [body, found, problems] of cases) {
      const text = `export function main(): number {\n  ${body}\n  return 0;\n}\n${classes}`;
      expect(boundHelpers("probe.ts", text), body).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, body).toEqual(problems);
    }
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const { reader: read } = new Box(${thrower});${classes}`))
      .toEqual({ read: 0, problems: [`probe.ts:2: what read binds cannot be read, as it is read from new Box(${thrower}), a call whose value may hold a function`] });
  });

  test("a member of a call that holds a function is followed when its type may hold one, and a name destructured from it is reported", () => {
    const helper = "(): number => 1";
    // Each member's type is written out with no type parameter, so only what the type may hold says whether the member holds the function.
    const wrapped = "\ninterface Wrapped {\n  value: { reader: () => number };\n  items: [() => number];\n  get(): { reader: () => number };\n  size: number;\n}\n"
      + "function wrap(reader: () => number): Wrapped {\n  return { value: { reader }, items: [reader], get: () => ({ reader }), size: 1 };\n}\n";
    const unread = "probe.ts:2: an arrow function cannot be placed: its destructuring reads it from a value that is not a literal, such as a call that holds it, which no rule can read";
    const cases: Array<[body: string, found: string[], problems: string[]]> = [
      [`const { reader: helper } = wrap(${helper}).value;`, [memberOfCall("helper", `wrap(${helper}).value`)], [unread]],
      [`const [helper] = wrap(${helper}).items;`, [memberOfCall("helper", `wrap(${helper}).items`)], [unread]],
      [`const { reader: helper } = wrap(${helper})["value"];`, [memberOfCall("helper", `wrap(${helper})["value"]`)], [unread]],
      [`const { reader: helper } = wrap(${helper}).value!;`, [memberOfCall("helper", `wrap(${helper}).value`)], [unread]],
      [`const { reader: helper } = wrap(${helper}).get();`, [heldByCall("helper", `wrap(${helper}).get()`)], [unread]],
      // A member whose type has no place for a function holds none, and a name bound to a member that holds one binds no function.
      [`const size = wrap(${helper}).size;`, [], []],
      [`const value = wrap(${helper}).value;`, [], []],
    ];
    for (const [body, found, problems] of cases) {
      const text = `export function main(): number {\n  ${body}\n  return 0;\n}\n${wrapped}`;
      expect(boundHelpers("probe.ts", text), body).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, body).toEqual(problems);
    }
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const { reader: read } = wrap(${thrower}).value;${wrapped}`)).toEqual({
      read: 0,
      problems: [`probe.ts:2: what read binds cannot be read, as it is read from wrap(${thrower}).value, a member of a call whose value may hold a function`],
    });
  });

  test("a function that runs is followed through an index, a call's value, a getter, a class or call, apply and bind", () => {
    const helper = "(): number => 1";
    // Each wrapper's type is declared apart from the function, so a call of it resolves to the type, which has no body.
    // Each `box` gives back what it is given, and each `read` gives back a function of its own.
    const wrappers = "\ntype Boxer = (reader: () => number) => [() => number];\n"
      + "type Made = new (reader: () => number) => { reader: () => number };\n"
      + "declare const anything: any;\n"
      + "function box(reader: () => number): [() => number] {\n  return [reader];\n}\n"
      + "function read(reader: () => number): [() => number] {\n  const size = reader();\n  return [(): number => size];\n}\n"
      + "function overloaded(reader: () => number): [() => number];\nfunction overloaded(reader: () => number, size: number): [() => number];\n"
      + "function overloaded(reader: () => number): [() => number] {\n  return [reader];\n}\n"
      + "const boxes: [Boxer, Boxer] = [box, read];\nconst spread: Boxer[] = [...anything, box];\nconst pair: [Boxer] = anything();\n"
      + "const keyed: Record<\"box\" | \"read\" | \"got\", Boxer> = {\n  box,\n  read,\n  get got(): Boxer {\n    return box;\n  },\n};\n"
      + "const loose: Record<\"box\", Boxer> = { ...anything };\n"
      + "const holder = {\n  get box(): Boxer {\n    return box;\n  },\n  get read(): Boxer {\n    return read;\n  },\n};\n"
      + "interface Holds {\n  box: Boxer;\n}\nconst holds: Holds = anything();\n"
      + "function make(): Boxer {\n  return box;\n}\nfunction made(): Boxer {\n  return read;\n}\ndeclare function stated(): Boxer;\n"
      + "const kept: Boxer = make();\nconst bound: Boxer = box.bind(undefined);\nconst untyped: Boxer = anything();\n"
      + "class Base {\n  constructor(public reader: () => number) {}\n}\n"
      + "const Kept: Made = class {\n  constructor(public reader: () => number) {}\n};\n"
      + "const Sub: Made = class extends Base {};\nconst Named: Made = Base;\n"
      + "const Fresh: Made = class {\n  reader: () => number;\n  constructor(given: () => number) {\n    const size = given();\n    this.reader = (): number => size;\n  }\n};\n"
      + "const Empty: new (reader: () => number) => { reader?: () => number } = class {};\n";
    const unread = "probe.ts:2: an arrow function cannot be placed: its destructuring reads it from a value that is not a literal, such as a call that holds it, which no rule can read";
    const cases: Array<[body: string, found: string[], problems: string[]]> = [];
    for (const call of [
      `boxes[0](${helper})`, `keyed["box"](${helper})`, `keyed["got"](${helper})`, `holder.box(${helper})`, `make()(${helper})`, `kept(${helper})`,
      `box.call(undefined, ${helper})`, `box.apply(undefined, [${helper}])`, `box.apply(undefined, ([${helper}]))`, `box.bind(undefined)(${helper})`,
      `bound(${helper})`, `Reflect.apply(box, undefined, [${helper}])`, `overloaded.call(undefined, ${helper})`,
      // A function written here that cannot be followed may give back what it is given.
      `boxes[Number("1")](${helper})`, `spread[1]!(${helper})`, `pair[0](${helper})`, `loose["box"](${helper})`, `holds.box(${helper})`, `untyped(${helper})`,
    ]) {
      cases.push([`const [helper] = ${call};`, [heldByCall("helper", call)], [unread]]);
    }
    for (const made of ["new Kept", "new Sub", "new Named", "Reflect.construct(Kept, ["]) {
      const call = made.endsWith("[") ? `${made}${helper}])` : `${made}(${helper})`;
      cases.push([`const { reader: helper } = ${call} as { reader: () => number };`, [heldByCall("helper", call)], [unread]]);
    }
    for (const call of [
      `boxes[1](${helper})`, `keyed["read"](${helper})`, `holder.read(${helper})`, `made()(${helper})`, `stated()(${helper})`,
      `read.call(undefined, ${helper})`, `read.apply(undefined, [${helper}])`, `read.bind(undefined)(${helper})`, `Reflect.apply(read, undefined, [${helper}])`,
    ]) {
      cases.push([`const [helper] = ${call};`, [], []]);
    }
    cases.push(
      [`const { reader: helper } = new Fresh(${helper});`, [], []],
      [`const { reader: helper } = new Empty(${helper});`, [], []],
      // An argument a parameter takes, through call, apply or bind, is given back as one passed directly is.
      [`const helper = ((value: () => number) => value).call(undefined, ${helper});`, ["probe.ts / main / helper"], []],
      // A value handed on where no parameter takes it, or where a spread hides which one does, cannot be read.
      [`const reads = read.bind(undefined, ${helper});`, [],
        ["probe.ts:2: an arrow function cannot be placed: it is handed to a call where no parameter takes it, as the this of call, apply or bind, or a value bind keeps, so what is done with it cannot be read"]],
      [`const [helper] = box.bind(...[undefined])(${helper});`, [heldByCall("helper", `box.bind(...[undefined])(${helper})`)], [unread]],
      [`const [helper] = box.call(...[undefined], ${helper});`, [heldByCall("helper", `box.call(...[undefined], ${helper})`)], [unread]],
      [`const [helper] = Reflect.apply(...[box, undefined, [${helper}]]);`, [], ["probe.ts:2: an arrow function cannot be placed: it sits in a SpreadElement, a place the allowed list does not name"]],
      [`const [helper] = box.apply(undefined, anything as [() => number]);`, [], []],
      [`const sizes = read(...[], ${helper});`, [],
        ["probe.ts:2: an arrow function cannot be placed: it is handed to a call after a spread, or past its last parameter, so what the call does with it cannot be read"]],
    );
    for (const [body, found, problems] of cases) {
      const text = `export function main(): number {\n  ${body}\n  return 0;\n}\n${wrappers}`;
      expect(boundHelpers("probe.ts", text), body).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, body).toEqual(problems);
    }
    const thrower = "(): never => {\n  throw new RangeError(\"size\");\n}";
    for (const call of [`boxes[0](${thrower})`, `box.call(undefined, ${thrower})`]) {
      expect(undocumentedThrows("probe.ts", `/** Reads a size. */\nexport const [read] = ${call};${wrappers.replace(/\bread\b/g, "reads")}`), call)
        .toEqual({ read: 0, problems: [`probe.ts:2: what read binds cannot be read, as it is read from ${call}, a call whose value may hold a function`] });
    }
  });

  test("a wrapper whose value is given elsewhere is followed where it is written, or may give back what it is given", () => {
    const helper = "(): number => 1";
    // Each `box` gives back what it is given. Each `measure` calls it, and its result cannot hold a function.
    const wrappers = "\ntype Boxer = (reader: () => number) => object;\n"
      + "function boxing(reader: () => number): object {\n  return reader;\n}\n"
      + "function measuring(reader: () => number): number {\n  return reader();\n}\n"
      + "function makeBox(): { box: Boxer } {\n  return { box: (reader: () => number): object => reader };\n}\n"
      + "const { box: made } = makeBox();\n"
      + "const factory = {\n  get box(): Boxer {\n    return boxing;\n  },\n};\nconst { box: got } = factory;\n"
      + "class Box {\n  box: Boxer;\n  constructor() {\n    this.box = (reader: () => number): object => reader;\n  }\n}\n"
      + "declare const declared: Boxer;\n";
    const documented = "/**\n * Runs.\n * @param box The wrapper.\n * @param boxes The wrappers.\n */\n";
    const cases: Array<[signature: string, body: string, found: string[]]> = [
      ["", `const helper = made(${helper});`, ["probe.ts / main / helper"]],
      ["", `const helper = got(${helper});`, ["probe.ts / main / helper"]],
      ["", `const helper = new Box().box(${helper});`, ["probe.ts / main / helper"]],
      ["box: Boxer = boxing", `const helper = box(${helper});`, ["probe.ts / main / helper"]],
      ["{ box = boxing }: { box?: Boxer } = {}", `const helper = box(${helper});`, ["probe.ts / main / helper"]],
      ["", `for (const box of [boxing]) {\n    const helper = box(${helper});\n    void helper;\n  }`, ["probe.ts / main / helper"]],
      ["", `for (const box of new Set([boxing])) {\n    const helper = box(${helper});\n    void helper;\n  }`, ["probe.ts / main / helper"]],
      ["", `let box: Boxer;\n  box = boxing;\n  const helper = box(${helper});`, ["probe.ts / main / helper"]],
      // A wrapper whose result cannot hold a function gives back none of what it is given.
      ["box: (reader: () => number) => number = measuring", `const size = box(${helper});`, []],
      // No code here calls main, so a caller may give a parameter any wrapper its type allows, which may give back what it is given.
      ["box: Boxer", `const helper = box(${helper});`, ["probe.ts / main / helper"]],
      ["{ box }: { box: Boxer }", `const helper = box(${helper});`, ["probe.ts / main / helper"]],
      ["boxes: Boxer[]", `for (const box of boxes) {\n    const helper = box(${helper});\n    void helper;\n  }`, ["probe.ts / main / helper"]],
      // A declared name is written outside the program, so its declared type alone describes it, as a library's does, which gives back nothing here.
      ["", `const helper = declared(${helper});`, []],
    ];
    for (const [signature, body, found] of cases) {
      const text = `${documented}export function main(${signature}): number {\n  ${body}\n  return 0;\n}\n${wrappers}`;
      expect(boundHelpers("probe.ts", text), signature + body).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, signature + body).toEqual([]);
    }
    // The throws check reads a function such a wrapper gives back with the comment on the name it is bound to.
    const thrower = "(): never => {\n    throw new RangeError(\"size\");\n  }";
    for (const [signature, call] of [["box: Boxer = boxing", "box"], ["", "made"], ["", "new Box().box"]] as Array<[signature: string, call: string]>) {
      const text = `${documented}export function main(${signature}): object {\n  /** Reads a size. */\n  const helper = ${call}(${thrower});\n  return helper;\n}\n${wrappers}`;
      expect(undocumentedThrows("probe.ts", text).problems, call).toEqual(["probe.ts:8: the comment on helper does not say what it throws"]);
    }
  });

  test("a parameter is followed to the argument every call of its function gives it, and is unread where a call cannot be found", () => {
    const helper = "(): number => 1";
    // `boxing` gives back what it is given. `consuming` calls it, and returns a new object holding a number.
    const wrappers = "\ntype Boxer = (reader: () => number) => object;\n"
      + "function boxing(reader: () => number): object {\n  return reader;\n}\n"
      + "function consuming(reader: () => number): object {\n  return { value: reader() };\n}\n";
    const relay = "function relay(box: Boxer): number {\n  return run(box);\n}\n";
    const called = `const helper = box(${helper});\n  void helper;`;
    const iterated = `for (const box of boxes) {\n    const helper = box(${helper});\n    void helper;\n  }`;
    // Each pair is a parameter one caller gives an identity wrapper, then the same parameter whose every caller gives a consumer.
    const cases: Array<[signature: string, body: string, callers: string, found: string[]]> = [
      ["box: Boxer", called, "run(boxing);", ["probe.ts / run / helper"]],
      ["box: Boxer", called, "run(consuming);", []],
      ["box: Boxer", called, "run(consuming);\n  run(boxing);", ["probe.ts / run / helper"]],
      ["box: Boxer", called, "run(consuming);\n  run(consuming);", []],
      // A default is read beside what each caller gives.
      ["box: Boxer = consuming", called, "run();\n  run(boxing);", ["probe.ts / run / helper"]],
      ["box: Boxer = consuming", called, "run();", []],
      ["box: Boxer = boxing", called, "run(consuming);", ["probe.ts / run / helper"]],
      // A destructured parameter and a for-of over one read what each caller gives.
      ["{ box }: { box: Boxer }", called, "run({ box: boxing });", ["probe.ts / run / helper"]],
      ["{ box }: { box: Boxer }", called, "run({ box: consuming });", []],
      ["boxes: Boxer[]", iterated, "run([boxing]);", ["probe.ts / run / helper"]],
      ["boxes: Boxer[]", iterated, "run([consuming]);", []],
      // Where a call cannot be found, or a spread hides the argument, a caller may give any wrapper the type allows.
      ["box: Boxer", called, "run(...[consuming]);", ["probe.ts / run / helper"]],
      ["box: Boxer", called, "run(consuming);\n  void [run];", ["probe.ts / run / helper"]],
      ["box: Boxer", called, "run.call(undefined, consuming);", ["probe.ts / run / helper"]],
      ["...boxes: Boxer[]", iterated, "run(consuming);", ["probe.ts / run / helper"]],
    ];
    for (const [signature, body, callers, found] of cases) {
      const text = `export function main(): number {\n  ${callers}\n  return 0;\n}\nfunction run(${signature}): number {\n  ${body}\n  return 0;\n}\n${wrappers}`;
      expect(boundHelpers("probe.ts", text), signature + callers).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, signature + callers).toEqual([]);
    }
    // A caller that is itself handed a parameter is followed to its own callers, and is unread where it has none.
    for (const [callers, found] of [
      ["relay(boxing);", ["probe.ts / run / helper"]],
      ["relay(consuming);", []],
      ["", ["probe.ts / run / helper"]],
    ] as Array<[callers: string, found: string[]]>) {
      const text = `export function main(): number {\n  ${callers}\n  return 0;\n}\nfunction run(box: Boxer): number {\n  ${called}\n  return 0;\n}\n${wrappers}${relay}`;
      expect(boundHelpers("probe.ts", text), callers).toEqual(found);
    }
    // An arrow is called by the name of the variable it is the value of.
    for (const [callers, found] of [["run(boxing);", ["probe.ts / run / helper"]], ["run(consuming);", []]] as Array<[callers: string, found: string[]]>) {
      const text = `export function main(): number {\n  ${callers}\n  return 0;\n}\nconst run = (box: Boxer): number => {\n  ${called}\n  return 0;\n};\n${wrappers}`;
      expect(boundHelpers("probe.ts", text), callers).toEqual(found);
    }
    // A timer whose every clock returns a canceller it writes new hands back none of the callbacks it is given.
    const clocks = "\ninterface Clock {\n  schedule: (callback: () => void, ms: number) => () => void;\n}\n"
      + "function transport(clock: Clock): void {\n  let cancel: (() => void) | undefined;\n  cancel = clock.schedule((): void => undefined, 1);\n  cancel();\n}\n";
    for (const [clock, found] of [
      ["{ schedule: (callback, ms) => {\n    const timer = setTimeout(callback, ms);\n    return () => clearTimeout(timer);\n  } }", []],
      ["{ schedule: (callback) => callback }", ["probe.ts / transport / cancel"]],
    ] as Array<[clock: string, found: string[]]>) {
      const text = `export function main(): void {\n  transport(${clock});\n}\n${clocks}`;
      expect(boundHelpers("probe.ts", text), clock).toEqual(found);
    }
    // The throws check reads a function such a parameter gives back with the comment on the name it is bound to.
    const thrower = "(): never => {\n    throw new RangeError(\"size\");\n  }";
    for (const [signature, callers, problems] of [
      ["box: Boxer", "", ["probe.ts:7: the comment on helper does not say what it throws"]],
      ["box: Boxer = consuming", "", ["probe.ts:7: the comment on helper does not say what it throws"]],
      ["box: Boxer", "run(boxing);", ["probe.ts:7: the comment on helper does not say what it throws"]],
      ["box: Boxer", "run(consuming);", []],
    ] as Array<[signature: string, callers: string, problems: string[]]>) {
      const text = `export function main(): number {\n  ${callers}\n  return 0;\n}\nfunction run(${signature}): object {\n  /** Reads a size. */\n  const helper = box(${thrower});\n  return helper;\n}\n${wrappers}`;
      expect(undocumentedThrows("probe.ts", text).problems, signature + callers).toEqual(problems);
    }
  });

  test("a wrapper is followed to every assignment that gives it a value, wherever it is written", () => {
    const helper = "(): number => 1";
    // `boxing` gives back what it is given. Each `consuming` calls it, and returns a new object holding a number.
    const wrappers = "\ntype Boxer = (reader: () => number) => object;\n"
      + "function boxing(reader: () => number): object {\n  return reader;\n}\n"
      + "function consuming(reader: () => number): object {\n  return { value: reader() };\n}\n"
      + "function consumingNext(reader: () => number): object {\n  return { value: reader() + 1 };\n}\n";
    const chosen = "Math.random() > 0.5";
    // Each pair is a wrapper that one assignment makes an identity, then the same wrapper whose every value is a consumer.
    const cases: Array<[before: string, call: string, after: string, found: string[]]> = [
      [`let box: Boxer = consuming;\n  if (${chosen}) box = boxing;`, "box", "", ["probe.ts / main / helper"]],
      [`let box: Boxer = consuming;\n  if (${chosen}) box = consumingNext;`, "box", "", []],
      // A name whose type the compiler takes from its first function runs each function assigned to it as well.
      ["let box = consuming;\n  box = boxing;", "box", "", ["probe.ts / main / helper"]],
      ["let box = consuming;\n  box = consumingNext;", "box", "", []],
      [`let box: Boxer;\n  if (${chosen}) {\n    box = consuming;\n  } else {\n    box = boxing;\n  }`, "box", "", ["probe.ts / main / helper"]],
      [`let box: Boxer;\n  if (${chosen}) {\n    box = consuming;\n  } else {\n    box = consumingNext;\n  }`, "box", "", []],
      ["let box: Boxer | undefined;\n  box ??= boxing;", "box", "", ["probe.ts / main / helper"]],
      ["let box: Boxer | undefined;\n  box ??= consuming;", "box", "", []],
      // A field is followed to what its initializer and each assignment give it, in the constructor or anywhere else.
      ["", "new Field().box", "class Field {\n  box: Boxer = consuming;\n  constructor() {\n    this.box = boxing;\n  }\n}\n", ["probe.ts / main / helper"]],
      ["", "new Field().box", "class Field {\n  box: Boxer;\n  constructor() {\n    this.box = consuming;\n  }\n}\n", []],
      ["const made = new Field();\n  made.box = boxing;", "made.box", "class Field {\n  box: Boxer = consuming;\n}\n", ["probe.ts / main / helper"]],
      ["const made = new Field();\n  made.box = consumingNext;", "made.box", "class Field {\n  box: Boxer = consuming;\n}\n", []],
      // A property of an object literal is followed to each assignment, by name or by a key written as a literal.
      ["const holder = { box: consuming as Boxer };\n  holder.box = boxing;", "holder.box", "", ["probe.ts / main / helper"]],
      ["const holder = { box: consuming as Boxer };\n  holder[\"box\"] = boxing;", "holder.box", "", ["probe.ts / main / helper"]],
      ["const holder = { box: consuming as Boxer };\n  holder.box = consumingNext;", "holder.box", "", []],
      // An assignment a destructuring or a for-of makes cannot be read, so the wrapper may give back what it is given.
      ["let box: Boxer = consuming;\n  [box] = [consumingNext];", "box", "", ["probe.ts / main / helper"]],
      ["let box: Boxer = consuming;\n  ({ box } = { box: consumingNext });", "box", "", ["probe.ts / main / helper"]],
      ["let box: Boxer = consuming;\n  for (box of [consumingNext]) void box;", "box", "", ["probe.ts / main / helper"]],
    ];
    for (const [before, call, after, found] of cases) {
      const text = `export function main(): number {\n  ${before}\n  const helper = ${call}(${helper});\n  void helper;\n  return 0;\n}\n${wrappers}${after}`;
      expect(boundHelpers("probe.ts", text), before + call + after).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, before + call + after).toEqual([]);
    }
    // A private field is followed to each assignment in the same way.
    for (const [assigned, found] of [["boxing", ["probe.ts / run / helper"]], ["consumingNext", []]] as Array<[assigned: string, found: string[]]>) {
      const text = `export function main(): number {\n  return new Field().run();\n}\n${wrappers}class Field {\n  #box: Boxer = consuming;\n`
        + `  constructor() {\n    this.#box = ${assigned};\n  }\n  run(): number {\n    const helper = this.#box(${helper});\n    void helper;\n    return 0;\n  }\n}\n`;
      expect(boundHelpers("probe.ts", text), assigned).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, assigned).toEqual([]);
    }
    // The throws check reads a function a reassigned wrapper gives back with the comment on the name it is bound to.
    const thrower = "(): never => {\n    throw new RangeError(\"size\");\n  }";
    for (const [before, call, after] of [
      [`let box: Boxer = consuming;\n  if (${chosen}) box = boxing;`, "box", ""],
      ["", "new Field().box", "class Field {\n  box: Boxer = consuming;\n  constructor() {\n    this.box = boxing;\n  }\n}\n"],
    ] as Array<[before: string, call: string, after: string]>) {
      const text = `export function main(): object {\n  ${before}\n  /** Reads a size. */\n  const helper = ${call}(${thrower});\n  return helper;\n}\n${wrappers}${after}`;
      const line = before.split("\n").length + 3;
      expect(undocumentedThrows("probe.ts", text).problems, call).toEqual([`probe.ts:${line}: the comment on helper does not say what it throws`]);
    }
  });

  test("a collection is read through the array it is made from, and is unread where code may change it through a member", () => {
    const helper = "(): number => 1";
    // `boxing` gives back what it is given. `consuming` calls it, and returns a new object holding a number.
    const wrappers = "\ntype Boxer = (reader: () => number) => object;\n"
      + "function boxing(reader: () => number): object {\n  return reader;\n}\n"
      + "function consuming(reader: () => number): object {\n  return { value: reader() };\n}\n";
    const making = "function make(): Set<Boxer> {\n  return new Set([consuming]);\n}\n";
    // Each pair is a collection holding an identity wrapper, or changed to hold one, then the same collection holding consumers alone.
    const cases: Array<[before: string, iterated: string, found: string[]]> = [
      ["", "new Set([consuming, boxing])", ["probe.ts / main / helper"]],
      ["", "new Set([consuming])", []],
      ["const made = new Set([consuming]);\n  made.add(boxing);", "made", ["probe.ts / main / helper"]],
      ["const made = new Set([consuming]);\n  void made.has(consuming);", "made", []],
      ["const list = [consuming];\n  list.push(boxing);", "list", ["probe.ts / main / helper"]],
      ["const list = [consuming];\n  list[0] = boxing;", "list", ["probe.ts / main / helper"]],
      ["const list = [consuming];\n  void list.map((each) => each);", "list", []],
      ["const list = [consuming];\n  list[\"push\"](boxing);", "list", ["probe.ts / main / helper"]],
      ["", "make()", []],
    ];
    for (const [before, iterated, found] of cases) {
      const text = `export function main(): number {\n  ${before}\n  for (const box of ${iterated}) {\n    const helper = box(${helper});\n    void helper;\n  }\n  return 0;\n}\n${wrappers}${making}`;
      expect(boundHelpers("probe.ts", text), before + iterated).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, before + iterated).toEqual([]);
    }
    // The throws check reads a function a changed collection gives back with the comment on the name it is bound to.
    const thrower = "(): never => {\n      throw new RangeError(\"size\");\n    }";
    for (const [before, problems] of [
      ["const list = [consuming];\n  list.push(boxing);", ["probe.ts:6: the comment on helper does not say what it throws"]],
      ["const list = [consuming];\n  void list.length;", []],
    ] as Array<[before: string, problems: string[]]>) {
      const text = `export function main(): object {\n  ${before}\n  for (const box of list) {\n    /** Reads a size. */\n    const helper = box(${thrower});\n    return helper;\n  }\n  return {};\n}\n${wrappers}`;
      expect(undocumentedThrows("probe.ts", text).problems, before).toEqual(problems);
    }
  });

  test("a place that may hold a function is read through every route that changes it, by whatever name or function it is reached", () => {
    const helper = "(): number => 1";
    // `boxing` gives back what it is given. Each `consuming` calls it, and returns a new object holding a number.
    const wrappers = "\ntype Boxer = (reader: () => number) => object;\n"
      + "function boxing(reader: () => number): object {\n  return reader;\n}\n"
      + "function consuming(reader: () => number): object {\n  return { value: reader() };\n}\n"
      + "function consumingNext(reader: () => number): object {\n  return { value: reader() + 1 };\n}\n";
    const holder = "const holder = { box: consuming as Boxer };";
    const list = "const list = [consuming];";
    const reported = ["probe.ts / main / helper"];
    // Each pair is a place changed to hold an identity wrapper, then the same place changed to hold a consumer, or changed in no way that holds one.
    const called: Array<[before: string, call: string, after: string, found: string[]]> = [
      [`${holder}\n  Object.assign(holder, { box: boxing });`, "holder.box", "", reported],
      [`${holder}\n  Object.assign(holder, { box: consumingNext });`, "holder.box", "", []],
      [`${holder}\n  Object.assign(holder, { size: 1 });`, "holder.box", "", []],
      [`${holder}\n  holder[key] = boxing;`, "holder.box", "", reported],
      [`${holder}\n  holder[key] = consumingNext;`, "holder.box", "", []],
      ["const holder: Record<string, Boxer> = { box: consuming };\n  holder[name] = boxing;", "holder.box!", "", reported],
      ["const holder: Record<string, Boxer> = { box: consuming };\n  holder[name] = consumingNext;", "holder.box!", "", []],
      ["const holder: Record<string, Boxer> = { box: boxing };", "holder.box!", "", reported],
      ["const holder: Record<string, Boxer> = { box: consuming };", "holder.box!", "", []],
      [`${holder}\n  Reflect.set(holder, "box", boxing);`, "holder.box", "", reported],
      [`${holder}\n  Reflect.set(holder, "box", consumingNext);`, "holder.box", "", []],
      [`${holder}\n  Object.defineProperty(holder, "box", { value: boxing });`, "holder.box", "", reported],
      [`${holder}\n  Object.defineProperty(holder, "box", { value: consumingNext });`, "holder.box", "", []],
      [`${holder}\n  const alias: { box: Boxer } = holder;\n  alias.box = boxing;`, "holder.box", "", reported],
      [`${holder}\n  const alias: { box: Boxer } = holder;\n  alias.box = consumingNext;`, "holder.box", "", []],
      [`${holder}\n  give(holder);`, "holder.box", "function give(target: { box: Boxer }): void {\n  target.box = boxing;\n}\n", reported],
      [`${holder}\n  give(holder);`, "holder.box", "function give(target: { box: Boxer }): void {\n  target.box = consumingNext;\n}\n", []],
      // A function whose every call cannot be found changes each place its parameter's type allows.
      [`${holder}\n  give(holder);`, "holder.box", "export function give(target: { box: Boxer }): void {\n  target.box = boxing;\n}\n", reported],
      [`${holder}\n  give(holder);`, "holder.box", "export function give(target: { box: Boxer }): void {\n  target.box = consumingNext;\n}\n", []],
      ["const made = new Holder();\n  made.set(key);", "made.box", "class Holder {\n  box: Boxer = consuming;\n  set(key: \"box\"): void {\n    this[key] = boxing;\n  }\n}\n", reported],
      ["const made = new Holder();\n  made.set(key);", "made.box", "class Holder {\n  box: Boxer = consuming;\n  set(key: \"box\"): void {\n    this[key] = consumingNext;\n  }\n}\n", []],
      ["", "new Holder().box", "class Holder {\n  box: Boxer = consuming;\n  constructor() {\n    Object.assign(this, { box: boxing });\n  }\n}\n", reported],
      ["", "new Holder().box", "class Holder {\n  box: Boxer = consuming;\n  constructor() {\n    Object.assign(this, { box: consumingNext });\n  }\n}\n", []],
      ["shared.box = boxing;", "shared.box", "const shared = {\n  box(reader: () => number): object {\n    return { value: reader() };\n  },\n};\n", reported],
      ["shared.box = consumingNext;", "shared.box", "const shared = {\n  box(reader: () => number): object {\n    return { value: reader() };\n  },\n};\n", []],
      ["const map = new Map<string, Boxer>([[\"k\", consuming]]);\n  map.set(\"k\", boxing);", "map.get(\"k\")!", "", reported],
      ["const map = new Map<string, Boxer>([[\"k\", consuming]]);\n  map.set(\"k\", consumingNext);", "map.get(\"k\")!", "", []],
      ["const map = new Map<string, Boxer>([[\"k\", boxing]]);", "map.get(\"k\")!", "", reported],
      ["const map = new Map<string, Boxer>([[\"k\", consuming]]);", "map.get(\"k\")!", "", []],
      ["const boxes: Boxer[] = [boxing];", "boxes.at(0)!", "", reported],
      ["const boxes: Boxer[] = [consuming];", "boxes.at(0)!", "", []],
      ["const holder = { box: boxing };", "(Reflect.get(holder, \"box\") as Boxer)", "", reported],
      ["const holder = { box: consuming };", "(Reflect.get(holder, \"box\") as Boxer)", "", []],
    ];
    for (const [before, call, after, found] of called) {
      const text = `export function main(key: "box", name: string): number {\n  ${before}\n  const helper = ${call}(${helper});\n  void helper;\n  return 0;\n}\n${wrappers}${after}`;
      expect(boundHelpers("probe.ts", text), before + call + after).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, before + call + after).toEqual([]);
    }
    const iterated: Array<[before: string, iterated: string, after: string, found: string[]]> = [
      [`${list}\n  const alias = list;\n  alias.push(boxing);`, "list", "", reported],
      [`${list}\n  const alias = list;\n  alias.push(consumingNext);`, "list", "", []],
      [`${list}\n  const alias = list;\n  void alias.length;`, "list", "", []],
      ["const made = new Set([consuming]);\n  const alias = made;\n  alias.add(boxing);", "made", "", reported],
      ["const made = new Set([consuming]);\n  const alias = made;\n  alias.add(consumingNext);", "made", "", []],
      [`${list}\n  addTo(list);`, "list", "function addTo(list: Boxer[]): void {\n  list.push(boxing);\n}\n", reported],
      [`${list}\n  addTo(list);`, "list", "function addTo(list: Boxer[]): void {\n  list.push(consumingNext);\n}\n", []],
      [`${list}\n  void count(list);`, "list", "function count(list: Boxer[]): number {\n  return list.length;\n}\n", []],
      [`${list}\n  addTo(list);`, "list", "export function addTo(list: Boxer[]): void {\n  list.push(boxing);\n}\n", reported],
      [`${list}\n  addTo(list);`, "list", "export function addTo(list: Boxer[]): void {\n  list.push(consumingNext);\n}\n", []],
      [`${list}\n  Array.prototype.push.call(list, boxing);`, "list", "", reported],
      [`${list}\n  Array.prototype.push.call(list, consumingNext);`, "list", "", []],
      [`${list}\n  const lists = [list];\n  for (const inner of lists) inner.push(boxing);`, "list", "", reported],
      [`${list}\n  const lists = [list];\n  for (const inner of lists) inner.push(consumingNext);`, "list", "", []],
      [`${list}\n  grow(hand(list));`, "list", "function hand(list: Boxer[]): Boxer[] {\n  return list;\n}\nfunction grow(list: Boxer[]): void {\n  list.push(boxing);\n}\n", reported],
      [`${list}\n  grow(hand(list));`, "list", "function hand(list: Boxer[]): Boxer[] {\n  return list;\n}\nfunction grow(list: Boxer[]): void {\n  list.push(consumingNext);\n}\n", []],
      [`${holder}\n  holder[key] = boxing;`, "Object.values(holder)", "", reported],
      [`${holder}\n  holder[key] = consumingNext;`, "Object.values(holder)", "", []],
      // A collection a member call changes holds what the call adds, and nothing else.
      [`${list}\n  list.push(consumingNext);`, "list", "", []],
      ["const made = new Set([consuming]);\n  made.add(consumingNext);", "made", "", []],
      ["", "[boxing].slice()", "", reported],
      ["", "[consuming].slice()", "", []],
      ["const map = new Map<string, Boxer>([[\"k\", consuming]]);\n  map.set(\"k\", boxing);", "map.values()", "", reported],
      ["const map = new Map<string, Boxer>([[\"k\", consuming]]);\n  map.set(\"k\", consumingNext);", "map.values()", "", []],
    ];
    for (const [before, collection, after, found] of iterated) {
      const text = `export function main(key: "box", name: string): number {\n  ${before}\n  for (const box of ${collection}) {\n    const helper = box(${helper});\n    void helper;\n  }\n  return 0;\n}\n${wrappers}${after}`;
      expect(boundHelpers("probe.ts", text), before + collection + after).toEqual(found);
      expect(unplacedFunctions("probe.ts", text).problems, before + collection + after).toEqual([]);
    }
    // The throws check reads a function such a route gives back with the comment on the name it is bound to.
    const thrower = "(): never => {\n    throw new RangeError(\"size\");\n  }";
    for (const [before, problems] of [
      [`${holder}\n  holder[key] = boxing;`, ["probe.ts:5: the comment on helper does not say what it throws"]],
      [`${holder}\n  holder[key] = consumingNext;`, []],
      [`${holder}\n  Object.assign(holder, { box: boxing });`, ["probe.ts:5: the comment on helper does not say what it throws"]],
      [`${holder}\n  Object.assign(holder, { box: consumingNext });`, []],
    ] as Array<[before: string, problems: string[]]>) {
      const text = `export function main(key: "box"): object {\n  ${before}\n  /** Reads a size. */\n  const helper = holder.box(${thrower});\n  return helper;\n}\n${wrappers}`;
      expect(undocumentedThrows("probe.ts", text).problems, before).toEqual(problems);
    }
  });

  test("a top-level name whose type cannot be a function is not the first function, whatever made its value unknown", () => {
    const main = "\n/** Reads the size. */\nexport function main(): number {\n  return 1;\n}\n";
    for (const statement of [
      "const values = [1, 2];\nconst [size] = [...values];",
      "const key = Math.random() > 0.5 ? \"left\" : \"right\";\nconst { [key]: size } = { left: 1, right: 2 };",
      "declare const sized: { size: number };\nconst { size } = { ...sized };",
      "declare const names: string[];\nconst [name] = [...names];",
      "declare const rows: Array<{ size: number }>;\nconst [row] = [...rows];",
    ]) {
      expect(entryPointProblem("probe.ts", statement + main), statement).toEqual({ checked: true, problem: null });
    }
    // A name whose type may be a function, or cannot be told, still fails, saying why.
    const failing: Array<[statement: string, why: string]> = [
      ["declare const readers: Array<() => number>;\nconst [first] = [...readers];", "its position follows ...readers, whose length is not known"],
      ["declare const anything: any[];\nconst [first] = [...anything];", "its position follows ...anything, whose length is not known"],
      ["const key = Math.random() > 0.5 ? \"left\" : \"right\";\nconst { [key]: first } = { left: (): number => 1, right: 2 };", "its key, [key], is not known"],
      ["declare const made: { first: unknown };\nconst { first } = { ...made };", "its key may be given by ...made, whose keys are not known"],
    ];
    for (const [statement, why] of failing) {
      expect(entryPointProblem("probe.ts", statement + main), statement)
        .toEqual({ checked: true, problem: `probe.ts:2: what first holds cannot be read, as ${why}, so the first function cannot be found` });
    }
  });

  test("a first name is a function when a part of its type can be called, or its value is a function written here", () => {
    const main = "\n/** Reads the size. */\nexport function main(): number {\n  return 1;\n}\n";
    const reported = { checked: true, problem: "probe.ts:1: the first function, helper, is not exported" };
    for (const [statement, after] of [
      ["const helper = maybe();", "function maybe(): (() => number) | undefined {\n  return (): number => 1;\n}\n"],
      ["const helper = maybe();", "function maybe(): (() => number) | false {\n  return (): number => 1;\n}\n"],
      ["let helper: (() => number) | undefined;", ""],
      ["const { helper } = made();", "declare function made(): { helper?: () => number };\n"],
      ["const { helper } = made();", "function made(): { helper: unknown } {\n  return { helper: (): number => 1 };\n}\n"],
      // A value typed so that it says nothing of being a function is read through the function that makes it.
      ["const helper = make();", "function make(): unknown {\n  return (): number => 1;\n}\n"],
      ["const helper = make();", "function make(): object {\n  return Object.freeze((): number => 1);\n}\n"],
      ["const helper = anything();", "declare const anything: any;\n"],
    ] as Array<[statement: string, after: string]>) {
      expect(entryPointProblem("probe.ts", `${statement}${main}${after}`), statement + after).toEqual(reported);
    }
    // A value that cannot be called, and is read as none, is not a function, whatever its type allows.
    for (const [statement, after] of [
      ["const helper = make();", "function make(): unknown {\n  return 1;\n}\n"],
      ["const helper = make();", "function make(): { name: string } {\n  return { name: \"size\" };\n}\n"],
      ["const helper: unknown = { size: 1 };", ""],
      ["const helper = JSON.parse(\"1\") as unknown;", ""],
      ["const helper: (() => number) | null = null;", ""],
      ["const helper: (() => number) | undefined = undefined;", ""],
      ["const [, helper] = [...\"ab\", (): number => 1] as const;", ""],
    ] as Array<[statement: string, after: string]>) {
      expect(entryPointProblem("probe.ts", `${statement}${main}${after}`), statement + after).toEqual({ checked: true, problem: null });
    }
    // The shim check reads the module's first function the same way.
    const module = `const helper = maybe();${main}function maybe(): (() => number) | undefined {\n  return (): number => 1;\n}\n`;
    expect(shimProblem("probe-cli.ts", "import { main } from \"./probe.ts\";\nprocess.exit(main());", "probe.ts", module))
      .toBe("probe-cli.ts runs main, but probe.ts leads with helper");
  });

  test("a first name a destructuring takes from a literal is read through each call the literal holds", () => {
    const main = "\n/** Reads the size. */\nexport function main(): number {\n  return 1;\n}\n";
    const reported = { checked: true, problem: "probe.ts:1: the first function, helper, is not exported" };
    // `make` returns a function written in it; `size` returns a number, though its declared type says no more than `measure`'s.
    const makers = "function make(): (() => number) | undefined {\n  return (): number => 1;\n}\n"
      + "function size(): number | undefined {\n  return 1;\n}\n"
      + "function pair(): { helper: (() => number) | undefined } {\n  return { helper: make() };\n}\n"
      + "function sizes(): { helper: number | undefined } {\n  return { helper: size() };\n}\n";
    // Each pair is a name taken from a literal holding a call that returns a function, then the same name taken from one that returns a number.
    for (const [statement, problem] of [
      ["const { helper } = { helper: make() };", reported],
      ["const { helper } = { helper: size() };", { checked: true, problem: null }],
      ["const [helper] = [make()];", reported],
      ["const [helper] = [size()];", { checked: true, problem: null }],
      ["const { inner: { helper } } = { inner: { helper: make() } };", reported],
      ["const { inner: { helper } } = { inner: { helper: size() } };", { checked: true, problem: null }],
      ["const { helper = make() } = {};", reported],
      ["const { helper = size() } = {};", { checked: true, problem: null }],
      ["const { helper } = pair();", reported],
      ["const { helper } = sizes();", { checked: true, problem: null }],
    ] as Array<[statement: string, problem: EntryPoint]>) {
      expect(entryPointProblem("probe.ts", `${statement}${main}${makers}`), statement).toEqual(problem);
    }
    // The shim check reads the module's first function the same way.
    const module = `const { helper } = { helper: make() };${main}${makers}`;
    expect(shimProblem("probe-cli.ts", "import { main } from \"./probe.ts\";\nprocess.exit(main());", "probe.ts", module))
      .toBe("probe-cli.ts runs main, but probe.ts leads with helper");
  });

  // Each valid form here was once failed by a reader that fell back to "unread" where it could follow the value. Each sits beside its breach.
  describe("the valid forms reviews and rounds found falsely failed, each beside its breach", () => {
    // `boxing` gives back what it is given. Each `consuming` calls it, and returns a new object holding a number.
    const wrappers = "\ntype Boxer = (reader: () => number) => object;\n"
      + "function boxing(reader: () => number): object {\n  return reader;\n}\n"
      + "function consuming(reader: () => number): object {\n  return { value: reader() };\n}\n";
    const reported = ["probe.ts / main / helper"];

    test("a library call is read through each value it is handed and each value its callbacks return", () => {
      const iterated: Array<[before: string, collection: string, found: string[]]> = [
        ["const boxes: Boxer[] = [];", "boxes.concat(boxing)", reported],
        ["const boxes: Boxer[] = [];", "boxes.concat(consuming)", []],
        ["", "[consuming].concat(boxing)", reported],
        ["", "[consuming].concat(consuming)", []],
        ["", "[boxing].concat([consuming])", reported],
        ["", "[consuming].concat([consuming])", []],
        ["const boxes: Boxer[] = [];", "boxes.toSpliced(0, 0, boxing)", reported],
        ["const boxes: Boxer[] = [];", "boxes.toSpliced(0, 0, consuming)", []],
        ["const boxes: Boxer[] = [consuming];", "boxes.with(0, boxing)", reported],
        ["const boxes: Boxer[] = [consuming];", "boxes.with(0, consuming)", []],
        ["", "Array.of<Boxer>(boxing)", reported],
        ["", "Array.of<Boxer>(consuming)", []],
        ["", "[1].flatMap((): Boxer[] => [boxing])", reported],
        ["", "[1].flatMap((): Boxer[] => [consuming])", []],
        ["", "[1].map((): Boxer => boxing)", reported],
        ["", "[1].map((): Boxer => consuming)", []],
        // A callback's parameter is given what the library is handed, so a callback that hands it back gives back that.
        ["", "[boxing].map((each) => each)", reported],
        ["", "[consuming].map((each) => each)", []],
        ["", "Array.from([boxing], (each) => each)", reported],
        ["", "Array.from([consuming], (each) => each)", []],
        ["", "[boxing].reduce((all: Boxer[], each) => [...all, each], [])", reported],
        ["", "[consuming].reduce((all: Boxer[], each) => [...all, each], [])", []],
        ["const holder = { box: boxing };", "Object.entries(holder).map(([, each]) => each)", reported],
        ["const holder = { box: consuming };", "Object.entries(holder).map(([, each]) => each)", []],
      ];
      for (const [before, collection, found] of iterated) {
        const text = `export function main(): number {\n  ${before}\n  for (const box of ${collection}) {\n    const helper = box((): number => 1);\n    void helper;\n  }\n  return 0;\n}\n${wrappers}`;
        expect(boundHelpers("probe.ts", text), before + collection).toEqual(found);
        expect(unplacedFunctions("probe.ts", text).problems, before + collection).toEqual([]);
      }
      // A callback that a library calls is given each value the library is handed.
      for (const [list, found] of [["[boxing]", ["probe.ts / (an unnamed function) / helper"]], ["[consuming]", []]] as Array<[list: string, found: string[]]>) {
        const text = `export function main(): number {\n  ${list}.forEach((box) => {\n    const helper = box((): number => 1);\n    void helper;\n  });\n  return 0;\n}\n${wrappers}`;
        expect(boundHelpers("probe.ts", text), list).toEqual(found);
      }
      // The throws check reads a function such a call gives back with the comment on the name it is bound to.
      const thrower = "(): never => {\n      throw new RangeError(\"size\");\n    }";
      for (const [wrapper, problems] of [
        ["boxing", ["probe.ts:5: the comment on helper does not say what it throws"]],
        ["consuming", []],
      ] as Array<[wrapper: string, problems: string[]]>) {
        const text = `export function main(): object {\n  const boxes: Boxer[] = [];\n  for (const box of boxes.concat(${wrapper})) {\n    /** Reads a size. */\n    const helper = box(${thrower});\n    return helper;\n  }\n  return {};\n}\n${wrappers}`;
        expect(undocumentedThrows("probe.ts", text).problems, wrapper).toEqual(problems);
      }
    });

    test("a callee is read through each value it may be, whatever key or expression gives it", () => {
      const called: Array<[call: string, found: string[]]> = [
        ["[consuming].concat(boxing)[1]!", reported],
        ["[consuming].concat(consuming)[1]!", []],
        ["[consuming, boxing][1]!", reported],
        ["[consuming, consuming][1]!", []],
        ["(ready ? consuming : boxing)", reported],
        ["(ready ? consuming : consuming)", []],
      ];
      for (const [call, found] of called) {
        const text = `export function main(ready: boolean): number {\n  const helper = ${call}((): number => 1);\n  void helper;\n  return 0;\n}\n${wrappers}`;
        expect(boundHelpers("probe.ts", text), call).toEqual(found);
        expect(unplacedFunctions("probe.ts", text).problems, call).toEqual([]);
      }
    });

    test("a spread is read through what the value spread holds, wherever its items can be read", () => {
      const iterated: Array<[before: string, collection: string, found: string[]]> = [
        ["const list: Boxer[] = [boxing];", "[...list]", reported],
        ["const list: Boxer[] = [consuming];", "[...list]", []],
        ["const list: Boxer[] = [consuming];\n  list.push(boxing);", "[...list]", reported],
        ["const list: Boxer[] = [consuming];\n  list.push(consuming);", "[...list]", []],
        ["const list: Boxer[] = [boxing];", "new Set([...list])", reported],
        ["const list: Boxer[] = [consuming];", "new Set([...list])", []],
        ["const map = new Map<string, Boxer>([[\"k\", boxing]]);", "[...map.values()]", reported],
        ["const map = new Map<string, Boxer>([[\"k\", consuming]]);", "[...map.values()]", []],
        ["const base = { box: boxing };\n  const holder = { ...base };", "Object.values(holder)", reported],
        ["const base = { box: consuming };\n  const holder = { ...base };", "Object.values(holder)", []],
        ["const holder = { get box(): Boxer {\n    return boxing;\n  } };", "Object.values(holder)", reported],
        ["const holder = { get box(): Boxer {\n    return consuming;\n  } };", "Object.values(holder)", []],
      ];
      for (const [before, collection, found] of iterated) {
        const text = `export function main(): number {\n  ${before}\n  for (const box of ${collection}) {\n    const helper = box((): number => 1);\n    void helper;\n  }\n  return 0;\n}\n${wrappers}`;
        expect(boundHelpers("probe.ts", text), before + collection).toEqual(found);
        expect(unplacedFunctions("probe.ts", text).problems, before + collection).toEqual([]);
      }
      // A position after a spread may hold any item the spread gives, or any item written after it.
      const called: Array<[before: string, call: string, found: string[]]> = [
        ["const list: Boxer[] = [boxing];", "[...list][0]!", reported],
        ["const list: Boxer[] = [consuming];", "[...list][0]!", []],
        ["const list: Boxer[] = [boxing];\n  const [box] = [...list];", "box!", reported],
        ["const list: Boxer[] = [consuming];\n  const [box] = [...list];", "box!", []],
        ["const list: Boxer[] = [consuming];\n  const [, box] = [...list, boxing];", "box!", reported],
        ["const list: Boxer[] = [consuming];\n  const [, box] = [...list, consuming];", "box!", []],
        ["const base = { box: boxing };\n  const holder = { ...base };", "holder.box", reported],
        ["const base = { box: consuming };\n  const holder = { ...base, box: boxing };", "holder.box", reported],
        ["const base = { box: consuming };\n  const holder = { ...base, box: consuming };", "holder.box", []],
        ["const base = { box: boxing };\n  const { box } = { ...base };", "box", reported],
        ["const base = { box: consuming };\n  const { box } = { ...base };", "box", []],
      ];
      for (const [before, call, found] of called) {
        const text = `export function main(): number {\n  ${before}\n  const helper = ${call}((): number => 1);\n  void helper;\n  return 0;\n}\n${wrappers}`;
        expect(boundHelpers("probe.ts", text), before + call).toEqual(found);
      }
      // A spread of a parameter is read through what every call gives it.
      for (const [list, found] of [["[boxing]", ["probe.ts / use / helper"]], ["[consuming]", []]] as Array<[list: string, found: string[]]>) {
        const text = `export function main(): number {\n  return use(${list});\n}\nfunction use(list: Boxer[]): number {\n  for (const box of [...list]) {\n    const helper = box((): number => 1);\n    void helper;\n  }\n  return 0;\n}\n${wrappers}`;
        expect(boundHelpers("probe.ts", text), list).toEqual(found);
      }
      // A spread of a value not written here still leaves a later position unknown, naming the spread.
      const declared = `export function main(): number {\n  const [box] = [...outside];\n  const helper = box!((): number => 1);\n  void helper;\n  return 0;\n}\ndeclare const outside: Boxer[];\n${wrappers}`;
      expect(boundHelpers("probe.ts", declared)).toEqual([positionNotKnown("box", "...outside"), "probe.ts / main / helper"]);
    });

    test("a map is read under the key it is read by, wherever that key and each entry's key are known", () => {
      const map = "const map = new Map<string, Boxer>([[\"wanted\", consuming], [\"other\", boxing]]);";
      const called: Array<[before: string, call: string, found: string[]]> = [
        [map, "map.get(\"other\")!", reported],
        [map, "map.get(\"wanted\")!", []],
        [`${map}\n  const box = map.get("wanted");\n  if (box === undefined) return 0;`, "box", []],
        ["const map = new Map<string, Boxer>([[\"wanted\", consuming]]);\n  map.set(\"wanted\", boxing);", "map.get(\"wanted\")!", reported],
        ["const map = new Map<string, Boxer>([[\"wanted\", consuming]]);\n  map.set(\"other\", boxing);", "map.get(\"wanted\")!", []],
        ["const map = new Map<string, Boxer>([[\"a\", consuming], [\"b\", boxing], [\"c\", consuming]]);", "map.get(either)!", reported],
        ["const map = new Map<string, Boxer>([[\"a\", consuming], [\"b\", consuming], [\"c\", boxing]]);", "map.get(either)!", []],
        ["const map = new Map<number, Boxer>([[1, consuming], [2, boxing]]);", "map.get(2)!", reported],
        ["const map = new Map<number, Boxer>([[1, consuming], [2, boxing]]);", "map.get(1)!", []],
        ["const inner = new Map<string, Boxer>([[\"a\", boxing], [\"b\", consuming]]);\n  const map = new Map(inner);", "map.get(\"a\")!", reported],
        ["const inner = new Map<string, Boxer>([[\"a\", consuming], [\"b\", boxing]]);\n  const map = new Map(inner);", "map.get(\"a\")!", []],
        // A key not written so that it is known may be any key, whether it is read or written.
        ["const map = new Map<string, Boxer>([[\"a\", consuming], [\"c\", boxing]]);", "map.get(name)!", reported],
        ["const map = new Map<string, Boxer>([[\"a\", consuming]]);\n  map.set(name, boxing);", "map.get(\"a\")!", reported],
        // An entry a name holds may be given another key later, which no rule reads, so it may be under any key.
        ["const entry: [string, Boxer] = [\"a\", boxing];\n  const map = new Map<string, Boxer>([entry]);", "map.get(\"a\")!", reported],
        ["const entry: [string, Boxer] = [\"other\", boxing];\n  entry[0] = \"a\";\n  const map = new Map<string, Boxer>([entry]);", "map.get(\"a\")!", reported],
        ["const entry: [string, Boxer] = [\"a\", consuming];\n  const map = new Map<string, Boxer>([entry]);", "map.get(\"a\")!", []],
        ["const entries: Array<[string, Boxer]> = [[\"other\", boxing]];\n  entries[0]![0] = \"a\";\n  const map = new Map<string, Boxer>(entries);", "map.get(\"a\")!", reported],
        ["const entries: Array<[string, Boxer]> = [[\"a\", consuming]];\n  const map = new Map<string, Boxer>(entries);", "map.get(\"a\")!", []],
      ];
      for (const [before, call, found] of called) {
        const text = `export function main(either: "a" | "b", name: string): number {\n  ${before}\n  const helper = ${call}((): number => 1);\n  void helper;\n  return 0;\n}\n${wrappers}`;
        expect(boundHelpers("probe.ts", text), before + call).toEqual(found);
        expect(unplacedFunctions("probe.ts", text).problems, before + call).toEqual([]);
      }
      // A container a name holds is read through what it holds, wherever a library call is handed it.
      const iterated: Array<[before: string, collection: string, found: string[]]> = [
        ["const entries: Array<[string, Boxer]> = [[\"a\", boxing]];", "new Map(entries).values()", reported],
        ["const entries: Array<[string, Boxer]> = [[\"a\", consuming]];", "new Map(entries).values()", []],
        ["const pair: Boxer[] = [boxing];", "[pair].flat()", reported],
        ["const pair: Boxer[] = [consuming];", "[pair].flat()", []],
        ["", "[make([boxing])].flat()", reported],
        ["", "[make([consuming])].flat()", []],
        ["const left: Boxer[] = [boxing];\n  const right: Boxer[] = [consuming];", "[ready ? left : right].flat()", reported],
        ["const left: Boxer[] = [consuming];\n  const right: Boxer[] = [consuming];", "[ready ? left : right].flat()", []],
        ["", "new Map<string, Boxer>([entry(boxing)]).values()", reported],
        ["", "new Map<string, Boxer>([entry(consuming)]).values()", []],
      ];
      const makers = "function make(list: Boxer[]): Boxer[] {\n  return list;\n}\nfunction entry(box: Boxer): [string, Boxer] {\n  return [\"a\", box];\n}\n";
      for (const [before, collection, found] of iterated) {
        const text = `export function main(ready: boolean): number {\n  ${before}\n  for (const box of ${collection}) {\n    const helper = box((): number => 1);\n    void helper;\n  }\n  return 0;\n}\n${wrappers}${makers}`;
        expect(boundHelpers("probe.ts", text), before + collection).toEqual(found);
      }
    });

    test("a class's static members and its instances' members are each read through the changes made to that side alone", () => {
      const statically = "  static change(): void {\n    this.box = boxing;\n  }\n";
      const instance = "  change(): void {\n    this.box = boxing;\n  }\n";
      const block = "  static {\n    this.box = boxing;\n  }\n";
      const called: Array<[before: string, call: string, after: string, found: string[]]> = [
        ["Holder.box = boxing;", "Holder.box", holderClass(""), reported],
        ["Holder.box = boxing;", "new Holder().box", holderClass(""), []],
        ["const made = new Holder();\n  made.box = boxing;", "made.box", holderClass(""), reported],
        ["const made = new Holder();\n  made.box = boxing;", "Holder.box", holderClass(""), []],
        ["Holder.change();", "Holder.box", holderClass(statically), reported],
        ["Holder.change();", "new Holder().box", holderClass(statically), []],
        ["const made = new Holder();\n  made.change();", "made.box", holderClass(instance), reported],
        ["const made = new Holder();\n  made.change();", "Holder.box", holderClass(instance), []],
        ["", "Holder.box", holderClass(block), reported],
        ["", "new Holder().box", holderClass(block), []],
        ["Reflect.set(Holder, \"box\", boxing);", "Holder.box", holderClass(""), reported],
        ["Reflect.set(Holder, \"box\", boxing);", "new Holder().box", holderClass(""), []],
        ["Object.assign(Holder, { box: boxing });", "Holder.box", holderClass(""), reported],
        ["Object.assign(Holder, { box: boxing });", "new Holder().box", holderClass(""), []],
        // A change through a value whose type either side fits may reach either side.
        ["give(Holder);", "Holder.box", `${holderClass("")}function give(target: { box: Boxer }): void {\n  target.box = boxing;\n}\n`, reported],
        ["give(new Holder());", "new Holder().box", `${holderClass("")}function give(target: { box: Boxer }): void {\n  target.box = boxing;\n}\n`, reported],
        ["Sub.box = boxing;", "Sub.box", `${holderClass("")}class Sub extends Holder {}\n`, reported],
      ];
      for (const [before, call, after, found] of called) {
        const text = `export function main(): number {\n  ${before}\n  const helper = ${call}((): number => 1);\n  void helper;\n  return 0;\n}\n${wrappers}${after}`;
        expect(boundHelpers("probe.ts", text), before + call + after).toEqual(found);
        expect(unplacedFunctions("probe.ts", text).problems, before + call + after).toEqual([]);
      }
    });
  });
});

/** A class Holder whose static box and instance box both hold `consuming`, with the members given written after them. */
function holderClass(members: string): string {
  return `class Holder {\n  static box: Boxer = consuming;\n  box: Boxer = consuming;\n${members}}\n`;
}

/** The entry the nested-helper check gives a name of main in probe.ts whose position follows a spread of unknown length. */
function positionNotKnown(name: string, spread: string): string {
  return `probe.ts / main / ${name}: its position follows ${spread}, whose length is not known, so what it holds cannot be read`;
}

/** The entry the nested-helper check gives a name of main in probe.ts that a destructuring takes from a call whose value may hold a function. */
function heldByCall(name: string, call: string): string {
  return `probe.ts / main / ${name}: it is read from ${call}, a call whose value may hold a function, so what it holds cannot be read`;
}

/** The entry the nested-helper check gives a name of main in probe.ts that a destructuring takes from a member of a call whose value may hold a function. */
function memberOfCall(name: string, member: string): string {
  return `probe.ts / main / ${name}: it is read from ${member}, a member of a call whose value may hold a function, so what it holds cannot be read`;
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
 * it may be and each default, whatever its type says, and wherever
 * `givesFunction` finds its value may be one. A name that a spread of
 * unknown extent, a key not known, or a call that may hold a function, may
 * give its value may be one, so the first function cannot be found past
 * it, and that is the problem, unless its type cannot be a function.
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
        const type = checker.getTypeAtLocation(name);
        if (written.has(name) || type.getCallSignatures().length > 0) return { name: name.text, exported, statement, unknownAfter: null };
        const position = reading.unknown.find((found) => found.name === name);
        // A name whose type cannot be a function is none, whatever made its value unknown.
        if (position !== undefined && mayBeFunction(type, checker, name)) return { name: name.text, exported, statement, unknownAfter: position.cause };
        if (givesFunction(name, declaration, type, checker)) return { name: name.text, exported, statement, unknownAfter: null };
      }
    }
  }
  return null;
}

/** Whether a type, or a part of its union, can be called, as `(() => number) | undefined` can once it is narrowed. */
function mayBeCalled(type: ts.Type): boolean {
  return (type.isUnion() ? type.types : [type]).some((part) => part.getCallSignatures().length > 0);
}

/**
 * Whether a top-level name whose type has no call signature of its own may
 * still be a function. Its value is read to what it is given where it is
 * written, as `namedValues` reads it: through each name, member and call,
 * each assignment, and, for a name a destructuring takes, each literal the
 * value destructured may be and each value its key or position holds
 * there, so that a name bound to the value of a call of a function written
 * here is a function when that function returns one, whether the call is
 * the value itself or is held in a literal destructured. Where the value is
 * not written here, as a library's call is not, or is something no rule
 * can follow whose type may be a function, the declared type decides: the
 * name is a function when a part of its type can be called, as
 * `(() => number) | undefined` can, or when its type is any, unknown or
 * object and the value cannot be followed. A class is not a function here,
 * as a class declaration is not.
 */
function givesFunction(name: ts.Identifier, declaration: ts.VariableDeclaration, type: ts.Type, checker: ts.TypeChecker): boolean {
  // A value written as one whose own type cannot be a function, such as undefined or null, decides it, whatever the declared type allows.
  if (name === declaration.name && declaration.initializer !== undefined
    && possibleValues(declaration.initializer, checker).every((one) => !mayBeFunction(checker.getTypeAtLocation(one), checker, one))) return false;
  const values = namedValues(name, checker, new Set());
  if (values.some((one) => ts.isFunctionLike(one) && bodyOf(one) !== undefined)) return true;
  // What no rule can follow may be anything its type allows.
  const unfollowed = values.some((one) => ts.isExpression(one) && !isAlwaysTruthy(one) && mayBeFunction(checker.getTypeAtLocation(one), checker, one));
  if (values.length > 0 && !unfollowed) return false;
  return mayBeCalled(type) || (unfollowed && isOpenType(type));
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

/**
 * Whether a function is written in a node: the node is an arrow function, a
 * function expression, or a method or accessor of an object literal, or one
 * is written anywhere within it. A name, or a call, writes none, since a
 * function it gives is written, and followed, elsewhere.
 */
function writesFunction(node: ts.Node): boolean {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ((ts.isMethodDeclaration(node) || ts.isAccessor(node)) && ts.isObjectLiteralExpression(node.parent))) return true;
  return ts.forEachChild(node, writesFunction) ?? false;
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
 * a value typed any, since that may give back anything it is given. A
 * function declared with overloads is read through its implementation, and
 * one whose type an annotation declares through each function the annotated
 * name holds. When the body passes the parameter on in any other way than
 * calling it, each of the argument's values whose type fits the result is
 * given back, unless every value the body returns is one it writes new.
 *
 * @returns Each value given back, in the order written.
 */
function givenBack(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker, following: ReadonlySet<ts.Node>): ts.Expression[] {
  return callValues(call, checker, following).given;
}

/** The functions that may run when a value is called, as `heldFunctions` reads them. */
interface Implementations {
  /** Each declaration with a body that may run. */
  functions: ts.SignatureDeclaration[];
  /** Whether the value may also be a function written here that no rule can follow, so that what it does cannot be read. */
  unread: boolean;
}

/** No function runs, and none is left unread. */
const NOTHING_RUNS: Implementations = { functions: [], unread: false };

/** What a call, or `new`, does with the values it is given, as `givenBack` reads it. */
interface CallValues {
  /** Each value it may give back as its own value. */
  given: ts.Expression[];
  /**
   * Each value its own value may hold instead: a value passed to a parameter
   * that shares a type parameter with the declared result, whose type does
   * not fit the result, as a function given to `Array.of` is held in the
   * array it returns; or one passed to a parameter its body passes on, whose
   * type does not fit a result that has a place that may hold a function.
   */
  held: ts.Expression[];
}

/**
 * The values a call, or `new`, may give back, and those its own value may
 * hold, as `givenBack` and CallValues say. A call of a function declared
 * with overloads runs its implementation, so the implementation's body and
 * parameters say what it returns, while the signature it resolves to gives
 * the declared types. A call of a function whose type an annotation
 * declares runs the function the annotated name holds, read in the same
 * way, each one where the name may hold more than one. An argument whose
 * parameter the body passes on, by any use but calling it, may come back
 * however the body passes it: as the value itself, which its declared
 * result says by fitting it, unless every value the body returns is a
 * function or literal it writes new; or held in a literal, a name bound to
 * one, or a value built elsewhere, which a result with a place that may
 * hold a function says. The call is read as the call `invocationOf` finds it
 * makes, so `box.call(undefined, reader)` is read as `box(reader)`. A value
 * handed on where no parameter takes it, such as the `this` that `call`
 * is given, and every argument of a call whose function is written here but
 * cannot be followed, as `heldFunctions` reports, may come back either way,
 * since what is done with it cannot be read.
 */
function callValues(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker, following: ReadonlySet<ts.Node>): CallValues {
  const invocation = invocationOf(call, checker);
  const declaration = invocation.declaration;
  const implementations = declaration === undefined ? NOTHING_RUNS : implementationsOf(call, invocation.callee, declaration, checker);
  const result = checker.getTypeAtLocation(call);
  const found: CallValues = { given: [], held: [] };
  const returned = new Map<ts.SignatureDeclaration, ts.Expression[] | undefined>();
  const unread = [...invocation.unread];
  for (const [at, argument] of invocation.args.entries()) {
    const parameter = declaration === undefined ? undefined : parameterOf(declaration, invocation.args, at);
    const runs = implementations.functions.flatMap((implementation) => {
      const run = parameterOf(implementation, invocation.args, at);
      return run === undefined ? [] : [{ run, values: returnedValues(implementation, checker, following, returned), implementation }];
    });
    if (implementations.unread) unread.push(argument);
    if (declaration === undefined || runs.some(({ run, values }) => returnsParameter(run, values, checker))) {
      found.given.push(...possibleValues(argument, checker, following));
    } else if (parameter !== undefined && sharesTypeParameter(declaration, parameter)) {
      const makesNew = makesNewCollection(call, declaration, checker);
      for (const value of possibleValues(argument, checker, following)) {
        (!makesNew && fitsResult(checker.getTypeAtLocation(value), result, checker) ? found.given : found.held).push(value);
      }
    } else if (runs.some(({ implementation, run }) => passesOn(implementation, run, checker))) {
      // A body whose every return is a value written there new never gives back what it is given, though that value may hold it.
      const mayGiveBack = runs.some(({ implementation, run, values }) => passesOn(implementation, run, checker) && !returnsOnlyNewValues(values));
      for (const value of possibleValues(argument, checker, following)) {
        if (mayGiveBack && fitsResult(checker.getTypeAtLocation(value), result, checker)) found.given.push(value);
        else if (mayHoldFunction(result, checker, call)) found.held.push(value);
      }
    }
  }
  for (const value of unread.flatMap((argument) => possibleValues(argument, checker, following))) {
    if (fitsResult(checker.getTypeAtLocation(value), result, checker)) found.given.push(value);
    else if (mayHoldFunction(result, checker, call)) found.held.push(value);
  }
  return found;
}

/**
 * Whether a call runs a method of an array, a set or a map, declared in a
 * library, whose value is an array, a set or a map too, as `concat` and
 * `toSpliced` are. Such a method makes a new collection, which may hold what
 * it is handed but is never that value itself. A method that gives back the
 * collection it is called on is declared to return `this`, which no
 * parameter's type uses.
 */
function makesNewCollection(call: ts.CallExpression | ts.NewExpression, declaration: ts.SignatureDeclaration, checker: ts.TypeChecker): boolean {
  if (!declaration.getSourceFile().isDeclarationFile || !isCollection(checker.getTypeAtLocation(call), checker)) return false;
  const receiver = ts.isCallExpression(call) ? memberReceiver(call.expression) : undefined;
  return receiver !== undefined && isCollection(checker.getTypeAtLocation(receiver), checker);
}

/** The call a call, or `new`, makes, as `invocationOf` reads it. */
interface Invocation {
  /** The expression whose value is the function that runs. */
  callee: ts.Expression;
  /** The declaration of the signature that runs, or undefined when it cannot be found. */
  declaration: ts.SignatureDeclaration | undefined;
  /** What the parameters of the function that runs take, in order, spreads included. */
  args: readonly ts.Expression[];
  /**
   * What the call is handed that no parameter takes, so that what is done
   * with it cannot be read: the `this` that `call`, `apply` or `bind` is
   * given, a list `apply` takes that is not written as an array literal, and
   * what `bind` keeps for the function it makes.
   */
  unread: readonly ts.Expression[];
  /** The array literal whose items `apply` hands on as the arguments, or undefined. */
  list: ts.ArrayLiteralExpression | undefined;
  /** Whether the call is `bind`, which runs nothing, and makes a function that runs the callee. */
  binds: boolean;
}

/** The library's interfaces whose `call`, `apply` and `bind` every function has. */
const FUNCTION_INTERFACES = new Set(["Function", "CallableFunction", "NewableFunction"]);

/** A member of the library that runs a function with other arguments, or makes a function that does. */
type Forwarding = "call" | "apply" | "bind" | "Reflect.apply" | "Reflect.construct";

/**
 * The call a call, or `new`, makes. `f.call(self, a)` and
 * `f.apply(self, [a])` run `f` with `a`, as `Reflect.apply(f, self, [a])`
 * does, and `Reflect.construct(f, [a])` makes `new f(a)`. `f.bind(self, a)(b)`
 * runs `f` with `a` and `b`; `f.bind(self, a)` alone runs nothing, and keeps
 * both for the function it makes. `self` is handed on where no parameter
 * takes it. A spread that hides which value is `self`, or which is the list,
 * leaves every argument unread. Any other call runs its callee with its own
 * arguments.
 */
function invocationOf(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker): Invocation {
  const given = call.arguments ?? [];
  const forwarding = ts.isCallExpression(call) ? forwardingMember(call, checker) : undefined;
  const [first, second, ...rest] = given;
  if (forwarding === "Reflect.apply" || forwarding === "Reflect.construct") {
    if (first === undefined || ts.isSpreadElement(first)) return unreadCall(first ?? call.expression, given);
    return forwarding === "Reflect.apply" ? listed(first, false, rest[0], [second, ...rest.slice(1)], checker)
      : listed(first, true, second, rest, checker);
  }
  const receiver = forwarding === undefined ? undefined : memberReceiver(call.expression);
  if (receiver !== undefined && (first === undefined || !ts.isSpreadElement(first))) {
    if (forwarding === "apply") return listed(receiver, false, second, [first, ...rest], checker);
    const declaration = targetDeclaration(receiver, false, checker);
    if (forwarding === "bind") return { callee: receiver, declaration, args: [], unread: given, list: undefined, binds: true };
    return { callee: receiver, declaration, args: given.slice(1), unread: given.slice(0, 1), list: undefined, binds: false };
  }
  if (receiver !== undefined) return unreadCall(receiver, given);
  const callee = heldValue(call.expression) ?? call.expression;
  if (ts.isCallExpression(callee) && forwardingMember(callee, checker) === "bind") {
    const bound = invocationOf(callee, checker);
    const kept = bound.unread.filter((argument) => !ts.isSpreadElement(argument));
    if (bound.declaration !== undefined && kept.length === bound.unread.length) {
      return { callee: bound.callee, declaration: bound.declaration, args: [...kept.slice(1), ...given], unread: kept.slice(0, 1), list: undefined, binds: false };
    }
    return unreadCall(bound.callee, [...bound.unread, ...given]);
  }
  return { callee: call.expression, declaration: calledDeclaration(call, checker), args: given, unread: [], list: undefined, binds: false };
}

/** A call that runs a function given all its arguments where no parameter can be told to take them. */
function unreadCall(callee: ts.Expression, given: readonly ts.Expression[]): Invocation {
  return { callee, declaration: undefined, args: [], unread: [...given], list: undefined, binds: false };
}

/**
 * A call that `apply` or `Reflect` makes, running a function with the items
 * of an array literal. A list that is not written as one is unread, with the
 * other values handed on, and so is a list missing or after a spread.
 *
 * @param others The values handed on besides the list, such as `this`.
 */
function listed(callee: ts.Expression, constructs: boolean, list: ts.Expression | undefined,
  others: ReadonlyArray<ts.Expression | undefined>, checker: ts.TypeChecker): Invocation {
  const unread = others.filter((other): other is ts.Expression => other !== undefined);
  const literal = heldValue(list);
  if (literal === undefined || !ts.isArrayLiteralExpression(literal) || unread.some(ts.isSpreadElement)) {
    return unreadCall(callee, list === undefined ? unread : [list, ...unread]);
  }
  return { callee, declaration: targetDeclaration(callee, constructs, checker), args: literal.elements, unread, list: literal, binds: false };
}

/**
 * Which member of the library that runs a function with other arguments a
 * call calls: `call`, `apply` or `bind` of a function, or `Reflect.apply` or
 * `Reflect.construct`; undefined for any other call.
 */
function forwardingMember(call: ts.CallExpression, checker: ts.TypeChecker): Forwarding | undefined {
  const declaration = calledDeclaration(call, checker);
  if (declaration === undefined || !declaration.getSourceFile().isDeclarationFile || declaration.name === undefined || !ts.isIdentifier(declaration.name)) return undefined;
  const name = declaration.name.text;
  const owner = declaration.parent;
  if (ts.isInterfaceDeclaration(owner) && FUNCTION_INTERFACES.has(owner.name.text)) {
    return name === "call" || name === "apply" || name === "bind" ? name : undefined;
  }
  if (!ts.isModuleBlock(owner) || !ts.isIdentifier(owner.parent.name) || owner.parent.name.text !== "Reflect") return undefined;
  if (name === "apply") return "Reflect.apply";
  return name === "construct" ? "Reflect.construct" : undefined;
}

/** The value a member is read from, through any wrapper `heldValue` looks through, or undefined when the expression reads no member. */
function memberReceiver(expression: ts.Expression): ts.Expression | undefined {
  const member = heldValue(expression);
  return member !== undefined && (ts.isPropertyAccessExpression(member) || ts.isElementAccessExpression(member)) ? member.expression : undefined;
}

/**
 * The declaration of the signature that runs when `call`, `apply`, `bind` or
 * `Reflect` runs a function: the one signature its type has, or the
 * implementation that the signatures of a function declared with overloads
 * share.
 *
 * @param constructs Whether the function is made with `new`, so that its construct signatures run.
 * @returns The declaration, or undefined when the signatures belong to more
 *     than one function, or have no declaration.
 */
function targetDeclaration(callee: ts.Expression, constructs: boolean, checker: ts.TypeChecker): ts.SignatureDeclaration | undefined {
  const type = checker.getTypeAtLocation(callee);
  // The type says a signature always has a declaration, but one the checker makes has none.
  const declarations = (constructs ? type.getConstructSignatures() : type.getCallSignatures())
    .map((signature): ts.SignatureDeclaration | ts.JSDocSignature | undefined => signature.getDeclaration());
  if (declarations.some((declaration) => declaration === undefined || ts.isJSDocSignature(declaration))) return undefined;
  const written = declarations.filter((declaration): declaration is ts.SignatureDeclaration => declaration !== undefined && !ts.isJSDocSignature(declaration));
  if (written.length === 1) return written[0];
  const runs = new Set(written.map(implementationOf));
  const [run] = runs;
  return runs.size === 1 ? run : undefined;
}

/** The declaration of the signature a call, or `new`, resolves to, or undefined when the function called cannot be found. */
function calledDeclaration(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker): ts.SignatureDeclaration | undefined {
  // The type says a signature always has a declaration, but one the checker cannot resolve has none.
  const declaration: ts.SignatureDeclaration | ts.JSDocSignature | undefined = checker.getResolvedSignature(call)?.getDeclaration();
  return declaration === undefined || ts.isJSDocSignature(declaration) ? undefined : declaration;
}

/**
 * The declaration whose body runs when a signature is called: the
 * declaration itself when it has a body, or, for an overload signature, the
 * implementation that follows its group.
 *
 * @returns The declaration with a body, or undefined when none is written,
 *     as for a declared function or a method of an interface.
 */
function implementationOf(declaration: ts.SignatureDeclaration): ts.SignatureDeclaration | undefined {
  if (bodyOf(declaration) !== undefined) return declaration;
  if (!ts.isFunctionDeclaration(declaration) && !ts.isMethodDeclaration(declaration) && !ts.isConstructorDeclaration(declaration)) return undefined;
  const siblings = siblingsOf(declaration);
  const name = declaration.name?.getText();
  for (let at = siblings.indexOf(declaration) + 1; at < siblings.length; at += 1) {
    const next = siblings[at];
    if (next === undefined || next.kind !== declaration.kind) return undefined;
    if (!ts.isFunctionDeclaration(next) && !ts.isMethodDeclaration(next) && !ts.isConstructorDeclaration(next)) return undefined;
    if (next.name?.getText() !== name) return undefined;
    if (next.body !== undefined) return next;
  }
  return undefined;
}

/** The calls whose callee `implementationsOf` is reading, so that a call met again inside that reading is not read twice. */
const CALLEES_BEING_READ = new Set<ts.Node>();

/**
 * The declarations whose bodies may run when a call resolves to a signature:
 * the one `implementationOf` finds, when the callee names that function
 * itself and it is no method, which code may replace by writing to its
 * key; or each function the callee holds, as `heldFunctions` finds it,
 * when the callee is a name, a member or a call whose value is given
 * elsewhere, as a variable, a field or a parameter is. A type annotation
 * on a function value describes the function, and a call of the annotated
 * name runs the function written there, as it would were the annotation
 * not written; and a name whose type the compiler takes from one function
 * runs each function an assignment gives it as well. Where the callee holds
 * no function written here that can be read, the signature's own
 * implementation runs.
 *
 * @param callee The expression whose value is the function that runs.
 * @returns Each declaration with a body, none when none is written here,
 *     or when the call is met again while its callee is being read, as
 *     where names are given values that call each other.
 */
function implementationsOf(call: ts.CallExpression | ts.NewExpression, callee: ts.Expression, declaration: ts.SignatureDeclaration,
  checker: ts.TypeChecker): Implementations {
  const own = implementationOf(declaration);
  const resolved: Implementations = own === undefined ? NOTHING_RUNS : { functions: [own], unread: false };
  if (own !== undefined && !ts.isMethodDeclaration(own) && namesFunction(callee, declaration, checker)) return resolved;
  if (CALLEES_BEING_READ.has(call)) return resolved;
  CALLEES_BEING_READ.add(call);
  try {
    const held = heldFunctions(callee, checker, new Set());
    return held.functions.length === 0 && !held.unread ? resolved : held;
  } finally {
    CALLEES_BEING_READ.delete(call);
  }
}

/** The name, or the key, that an expression reads: itself for a name, or a member's; undefined for any other expression. */
function nameRead(expression: ts.Expression): ts.Node | undefined {
  if (ts.isIdentifier(expression)) return expression;
  if (ts.isPropertyAccessExpression(expression)) return expression.name;
  return ts.isElementAccessExpression(expression) ? expression.argumentExpression : undefined;
}

/**
 * Whether a callee names the function a signature declares, or the class
 * whose constructor it is, so that its value is that function: a name or a
 * member whose symbol, through any import alias, has that declaration. A
 * member read by a key no declaration names, as `list[1]` reads an item,
 * names none, and neither does any other callee but `super`, as
 * `(ready ? consuming : boxing)` may be either, so that each is read
 * through what it holds. `super` is read by the signature it resolves to.
 */
function namesFunction(callee: ts.Expression, declaration: ts.SignatureDeclaration, checker: ts.TypeChecker): boolean {
  const inner = heldValue(callee) ?? callee;
  const named = nameRead(inner);
  if (named === undefined) return inner.kind === ts.SyntaxKind.SuperKeyword;
  const declarations = usedSymbol(named, checker)?.declarations;
  if (declarations === undefined) return false;
  const run = implementationOf(declaration);
  return declarations.some((one) => one === declaration || (run !== undefined && ts.isFunctionLike(one) && implementationOf(one) === run)
    || (ts.isClassLike(one) && ts.isConstructorDeclaration(declaration) && declaration.parent === one));
}

/**
 * Each function written with a body that an expression may be: each value
 * `declaredValues` finds it may be that is an arrow function, a function
 * expression, or a function or method declared with a body, and the
 * constructor that runs for each class, as `constructorsOf` reads it. A
 * value it finds that is none of these, and whose type may be a function,
 * is a function written here that no rule can follow, so it is unread.
 *
 * @param seen The declarations read already, so that names given each other are read once.
 */
function heldFunctions(expression: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Node>): Implementations {
  const found: Implementations = { functions: [], unread: false };
  for (const value of declaredValues(expression, checker, seen)) {
    if (ts.isClassLike(value)) {
      const made = constructorsOf(value, checker, seen);
      found.functions.push(...made.functions);
      found.unread ||= made.unread;
    } else if (ts.isFunctionLike(value)) {
      if (bodyOf(value) !== undefined) found.functions.push(value);
    } else if (mayBeFunction(checker.getTypeAtLocation(value), checker, value)) {
      found.unread = true;
    }
  }
  return found;
}

/**
 * The constructor that runs when a class is made with `new`: its own,
 * through its overloads, or, where it declares none, that of the class it
 * extends, as `heldFunctions` reads the class's expression. A class that
 * declares none and extends nothing takes nothing it is given.
 */
function constructorsOf(declaration: ts.ClassLikeDeclaration, checker: ts.TypeChecker, seen: Set<ts.Node>): Implementations {
  const own = declaration.members.find(ts.isConstructorDeclaration);
  if (own !== undefined) {
    const run = implementationOf(own);
    return run === undefined ? NOTHING_RUNS : { functions: [run], unread: false };
  }
  const base = declaration.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
  return base === undefined ? NOTHING_RUNS : heldFunctions(base.expression, checker, seen);
}

/** A value `declaredValues` finds: an expression, a function or method declared with a body, or a class. */
type DeclaredValue = ts.Expression | ts.SignatureDeclaration | ts.ClassLikeDeclaration;

/**
 * Each value an expression may be, as `possibleValues` reads it, with each
 * name, and each property read from a value, followed to what it is given
 * where it is declared, as `namedValues` reads it; each item read by index
 * followed as `indexedValues` reads it; and each call followed to what it
 * returns, as `calledValues` reads it.
 *
 * @param seen The declarations read already, so that names given each other are read once.
 */
function declaredValues(expression: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Node>): DeclaredValue[] {
  return possibleValues(expression, checker).flatMap((value): DeclaredValue[] => {
    if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)) return namedValues(value, checker, seen);
    if (ts.isElementAccessExpression(value)) return indexedValues(value, checker, seen);
    return ts.isCallExpression(value) ? calledValues(value, checker, seen) : [value];
  });
}

/**
 * What a call's own value is given where it is written, when
 * `possibleValues` found the call gives back none of its arguments: each
 * value, as `declaredValues` reads it, that a function that runs returns,
 * as `make()` is the function `make` returns. `f.bind(self)` is what `f` is.
 *
 * @returns The values; for a library function, what `libraryValues` finds
 *     it gives back of what it is handed; none when the function that runs
 *     is declared with no body here, whose declared type alone describes
 *     its value; and the call itself as well when a function
 *     that runs is written here but cannot be followed, or `bind` keeps
 *     arguments for the function it makes.
 */
function calledValues(call: ts.CallExpression, checker: ts.TypeChecker, seen: Set<ts.Node>): DeclaredValue[] {
  const invocation = invocationOf(call, checker);
  if (invocation.binds) return invocation.unread.length > 1 ? [call] : declaredValues(invocation.callee, checker, seen);
  if (invocation.declaration === undefined) return [call];
  const implementations = implementationsOf(call, invocation.callee, invocation.declaration, checker);
  if (implementations.functions.length === 0 && !implementations.unread && invocation.declaration.getSourceFile().isDeclarationFile) return libraryValues(call, checker, seen);
  const values = implementations.functions.flatMap((run) => {
    const body = bodyOf(run);
    if (body === undefined || seen.has(body)) return [];
    seen.add(body);
    return returnedExpressions(run).flatMap((returned) => declaredValues(returned, checker, seen));
  });
  return implementations.unread ? [...values, call] : values;
}

/**
 * What an item read by index is given where it is written: the item at that
 * position of each array literal, as `itemSource` reads it, what the key
 * gives in each object literal, as `keyedValues` reads it, or each value
 * `libraryContents` finds that a call of a library function holds, whose
 * type fits the item's, that the value read from may be.
 *
 * @returns The values; none when the value read from is not written here;
 *     and the access itself as well when the key cannot be known, or a value
 *     it is read from is not a literal of the kind the key reads, or a
 *     spread may give the item.
 */
function indexedValues(access: ts.ElementAccessExpression, checker: ts.TypeChecker, seen: Set<ts.Node>): DeclaredValue[] {
  const type = checker.getTypeAtLocation(access.argumentExpression);
  const key = type.isStringLiteral() || type.isNumberLiteral() ? String(type.value) : undefined;
  if (key === undefined) return [access];
  let unread = false;
  const found = declaredValues(access.expression, checker, seen).flatMap((literal): DeclaredValue[] => {
    if (ts.isObjectLiteralExpression(literal)) return keyedValues(literal, key, access, checker, seen);
    if (isLibraryCall(literal, checker)) {
      const held = libraryContents(literal, checker.getTypeAtLocation(access), checker, seen);
      if (held.unread !== null) unread = true;
      return readContents({ values: held.values, unread: null }, access, checker, seen);
    }
    if (!ts.isArrayLiteralExpression(literal) || !isIndexKey(key)) {
      unread = true;
      return [];
    }
    const source = itemSource(literal, Number(key), checker);
    if (source.unknownAfter !== null) unread = true;
    return source.holders.flatMap((item) => ts.isExpression(item) ? declaredValues(item, checker, seen) : []);
  });
  return unread ? [...found, access] : found;
}

/**
 * What one key of an object literal is given, as `declaredValues` reads it:
 * the value or method of each property that `keyedProperties` finds gives
 * the key, and what each get accessor of the key written in the literal
 * returns.
 *
 * @param read The expression that reads the key, given back as well when a
 *     spread or a computed key may give the key instead.
 */
function keyedValues(literal: ts.ObjectLiteralExpression, key: string, read: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Node>): DeclaredValue[] {
  const source = keyedProperties(literal, key, checker);
  const held = source.holders.map(heldBy).flatMap((value) => ts.isMethodDeclaration(value) ? [value] : declaredValues(value, checker, seen));
  const returned = literal.properties.filter(ts.isGetAccessorDeclaration).filter((accessor) => propertyKey(accessor.name, checker) === key)
    .flatMap((accessor) => returnedExpressions(accessor).flatMap((value) => declaredValues(value, checker, seen)));
  return [...held, ...returned, ...(source.unknownAfter === null ? [] : [read])];
}

/**
 * What a name, or a property read from a value, is given where it is
 * declared, through an import alias: a function or method declared with a
 * body is itself; a class is itself; a get accessor gives each value it
 * returns; a variable, class field or property gives each value its
 * initializer may be, as `declaredValues` reads it; a shorthand property
 * gives what its name does; a parameter gives what `passedValues` finds its
 * default and each of its callers give it; a function expression's own name gives the function;
 * and a name bound by destructuring gives what `destructuredValues` finds. A
 * property a type declares, as an interface does, gives what its key holds
 * in each object literal the value it is read from may be, as `keyedValues`
 * reads it, and the property read as well, as unread, for each value it is
 * read from that is not one. Each of these that can be assigned gives as
 * well what every assignment to it gives, as `assignedValues` reads them,
 * and a member of an object literal or a class, a method included, what
 * code writes to its key, as `memberWrites` reads it. A member no
 * declaration names, as one an index signature gives, is read as
 * `unnamedMemberValues` reads it. Where no rule can read all a name declared here may be given, the name
 * read is given back as well, as unread: for a variable or class field
 * declared with no value that no assignment gives one, where
 * `isGivenLater` finds code here may give it one, as Object.assign does;
 * and for any other declaration written here that none of these reads.
 *
 * @returns Each value; none for a name declared with `declare`, or every
 *     declaration of which is in a declaration file, as the library's are,
 *     whose declared type alone describes it, nor for a function declared
 *     with no body.
 */
function namedValues(value: ts.Identifier | ts.PropertyAccessExpression, checker: ts.TypeChecker, seen: Set<ts.Node>): DeclaredValue[] {
  const found = ts.isIdentifier(value) ? referencedSymbol(value, checker) : checker.getSymbolAtLocation(value.name);
  const symbol = found !== undefined && (found.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(found) : found;
  const declarations = symbol?.declarations ?? [];
  if (declarations.length === 0 && ts.isPropertyAccessExpression(value)) return unnamedMemberValues(value, checker, seen);
  if (declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile)) return [];
  return declarations.flatMap((declaration): DeclaredValue[] => {
    if (seen.has(declaration)) return [];
    seen.add(declaration);
    if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) {
      const run = implementationOf(declaration);
      return [...run === undefined ? [] : [run], ...memberWrites(value, declaration, checker, seen)];
    }
    if (ts.isClassLike(declaration)) return [declaration];
    if (ts.isGetAccessorDeclaration(declaration)) return returnedExpressions(declaration).flatMap((returned) => declaredValues(returned, checker, seen));
    // A function expression's own name gives the function.
    if (ts.isFunctionExpression(declaration)) return [declaration];
    const assigned = assignedValues(value, declaration, checker, seen);
    const written = memberWrites(value, declaration, checker, seen);
    if (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertyAssignment(declaration)) {
      if (declaration.initializer !== undefined) return [...declaredValues(declaration.initializer, checker, seen), ...assigned.values, ...written];
      const loop = declaration.parent.parent;
      if (ts.isVariableDeclaration(declaration) && ts.isForOfStatement(loop)) return [...iteratedValues(value, loop.expression, checker, seen), ...assigned.values];
      if (assigned.found) return [...assigned.values, ...written];
      // A name declared here with no value that no assignment gives one, as a class field set by Object.assign, is given one no rule reads.
      return isGivenLater(declaration) ? [value, ...written] : written;
    }
    if (ts.isShorthandPropertyAssignment(declaration)) return [...declaredValues(declaration.name, checker, seen), ...assigned.values, ...written];
    if (ts.isParameter(declaration)) {
      const passed = passedValues(declaration, checker, seen);
      return [...passed.values, ...passed.unread ? [value] : [], ...assigned.values, ...written];
    }
    if (ts.isBindingElement(declaration)) return [...destructuredValues(value, declaration, checker, seen), ...assigned.values];
    if (!ts.isPropertyAccessExpression(value) || !ts.isTypeElement(declaration)) return isAmbient(declaration) ? [] : [value];
    const key = value.name.text;
    return [...declaredValues(value.expression, checker, seen)
      .flatMap((literal) => ts.isObjectLiteralExpression(literal) ? keyedValues(literal, key, value, checker, seen) : [value]), ...assigned.values];
  });
}

/** What the assignments to a name give it, as `assignedValues` reads them. */
interface Assigned {
  /** Each value an assignment may give, and the name read as well, as unread, when one gives a value no rule reads. */
  values: DeclaredValue[];
  /** Whether any assignment gives the name a value. */
  found: boolean;
}

/**
 * What every assignment written in the program gives a variable, a class
 * field, a property or a parameter, wherever it is written, as
 * `assignmentsOf` finds them: each value, as `declaredValues` reads the
 * assignment, so that `box = boxing` gives `boxing`, `box ??= boxing` gives
 * `boxing` too, and `size += 1` gives a number. An assignment that a
 * destructuring, or a for-in or for-of, makes cannot be read, so the name
 * read is given back as well, as unread.
 */
function assignedValues(value: ts.Identifier | ts.PropertyAccessExpression, declaration: ts.Declaration, checker: ts.TypeChecker, seen: Set<ts.Node>): Assigned {
  const written = assignmentsOf(declaration, checker);
  const values = written.assignments.flatMap((assignment) => declaredValues(assignment, checker, seen));
  return { values: written.unread ? [...values, value] : values, found: written.assignments.length > 0 || written.unread };
}

/** The assignments to one declaration, as `assignmentsOf` finds them. */
interface Assignments {
  /** Each assignment written as `name = value`, or with a compound operator, whose target is the declaration. */
  assignments: ts.BinaryExpression[];
  /**
   * Whether a destructuring, a for-in or a for-of assigns it as well, or
   * code may change what it holds through a member, as `list.push(boxing)`
   * and `list[0] = boxing` do, where what it holds is not a place whose
   * changes `writtenTo` reads.
   */
  unread: boolean;
}

/** The assignments found to each declaration, for each checker, so that each is searched for once. */
const ASSIGNMENTS = new WeakMap<ts.TypeChecker, Map<ts.Node, Assignments>>();

/**
 * Every assignment, in each file of the program, whose target is a
 * declaration: a name, or a property read by name or by a key written as a
 * literal, as `this.box = boxing` and `holder["box"] = boxing` are, through
 * any wrapper `heldValue` looks through, that `usesOf` finds refers to it.
 * One that a destructuring or a for-in or for-of makes is noted as unread,
 * and so is a use that may change what the declaration holds through a
 * member, as `changesThrough` reads it, unless every value the declaration
 * may hold is a container, as `reachesOnlyContainers` says, whose every
 * change `writtenTo` reads. `++` and `--` give a number, so they are not read.
 */
function assignmentsOf(declaration: ts.Declaration, checker: ts.TypeChecker): Assignments {
  const known = ASSIGNMENTS.get(checker) ?? new Map<ts.Node, Assignments>();
  ASSIGNMENTS.set(checker, known);
  const kept = known.get(declaration);
  if (kept !== undefined) return kept;
  const found: Assignments = { assignments: [], unread: false };
  known.set(declaration, found);
  for (const use of usesOf(declaration, checker)) {
    const target = outerValue(memberRead(use));
    const parent = target.parent;
    if (ts.isBinaryExpression(parent) && isAssignmentOperator(parent.operatorToken.kind) && parent.left === target) {
      if (isDestructuringTarget(parent)) {
        found.unread = true;
      } else {
        found.assignments.push(parent);
      }
    } else if (isDestructuringTarget(target)) {
      found.unread = true;
    } else if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === target && changesThrough(parent, checker)
      && !reachesOnlyContainers(parent.expression, checker)) {
      found.unread = true;
    }
  }
  return found;
}

/**
 * Whether a member of a collection a rule reads through, an array, a set or
 * a map, may change what the collection holds: it is assigned, deleted,
 * counted up or down, or destructured into, or it is a method called that
 * `isReadingMember` does not find only reads. Any other value's properties
 * change only by being assigned, which `assignmentsOf` reads for each
 * property.
 */
function changesThrough(member: ts.PropertyAccessExpression | ts.ElementAccessExpression, checker: ts.TypeChecker): boolean {
  const receiver = checker.getNonNullableType(checker.getTypeAtLocation(member.expression));
  if (!(receiver.isUnion() ? receiver.types : [receiver]).some((part) => part.flags & ts.TypeFlags.Object && readOnlyForm(part, checker) !== undefined)) return false;
  const outer = outerValue(member);
  const above = outer.parent;
  if (ts.isBinaryExpression(above) && isAssignmentOperator(above.operatorToken.kind) && above.left === outer) return true;
  if (ts.isDeleteExpression(above) || isDestructuringTarget(outer)) return true;
  if ((ts.isPrefixUnaryExpression(above) || ts.isPostfixUnaryExpression(above))
    && (above.operator === ts.SyntaxKind.PlusPlusToken || above.operator === ts.SyntaxKind.MinusMinusToken)) return true;
  return ts.isCallExpression(above) && above.expression === outer && !isReadingMember(member, checker);
}

/**
 * Whether a member called on a value only reads the value, by its declared
 * type. The collections a rule reads through are arrays, sets and maps: a
 * method of one reads it when the library's read-only form of the
 * collection, ReadonlyArray, ReadonlySet or ReadonlyMap, declares a member
 * of that name, as it declares `map` and not `push`, and an item of an array
 * read by a number, as `list[0]` is, is a value it holds, not a method. A
 * method named by any other key not written as a literal may be any method,
 * so it may change the collection. Any other value's properties change only
 * by being assigned, which `assignmentsOf` reads, and a primitive cannot
 * change.
 */
function isReadingMember(member: ts.PropertyAccessExpression | ts.ElementAccessExpression, checker: ts.TypeChecker): boolean {
  const key = ts.isPropertyAccessExpression(member) ? member.name : member.argumentExpression;
  const receiver = checker.getNonNullableType(checker.getTypeAtLocation(member.expression));
  return (receiver.isUnion() ? receiver.types : [receiver]).every((part) => {
    const counterpart = part.flags & ts.TypeFlags.Object ? readOnlyForm(part, checker) : undefined;
    if (counterpart === undefined) return true;
    if (ts.isIdentifier(key) || ts.isPrivateIdentifier(key) || ts.isStringLiteralLike(key)) return readOnlyMembers(counterpart, checker, member).has(key.text);
    return counterpart === "ReadonlyArray" && (checker.getTypeAtLocation(key).flags & ts.TypeFlags.NumberLike) !== 0;
  });
}

/** The name of the library's read-only form of a collection type: ReadonlyArray for an array or tuple, ReadonlySet for a set, ReadonlyMap for a map; undefined for any other type. */
function readOnlyForm(type: ts.Type, checker: ts.TypeChecker): string | undefined {
  if (checker.isArrayType(type) || checker.isTupleType(type)) return "ReadonlyArray";
  const name = type.getSymbol()?.name;
  if (name === "Set" || name === "ReadonlySet") return "ReadonlySet";
  return name === "Map" || name === "ReadonlyMap" ? "ReadonlyMap" : undefined;
}

/** The members of each of the library's read-only collection interfaces, by name, read once for each checker. */
const READ_ONLY_MEMBERS = new WeakMap<ts.TypeChecker, Map<string, ReadonlySet<string>>>();

/**
 * The names of the members one of the library's interfaces declares, as the
 * checker's own libraries declare it, or none when they do not declare it,
 * so that every method of the collection may change it.
 *
 * @param location A node of a file the checker read, where the global interfaces are in scope.
 */
function readOnlyMembers(name: string, checker: ts.TypeChecker, location: ts.Node): ReadonlySet<string> {
  const known = READ_ONLY_MEMBERS.get(checker) ?? new Map<string, ReadonlySet<string>>();
  READ_ONLY_MEMBERS.set(checker, known);
  const kept = known.get(name);
  if (kept !== undefined) return kept;
  const declared = checker.getSymbolsInScope(location, ts.SymbolFlags.Interface).find((symbol) => symbol.name === name);
  const members = new Set(declared === undefined ? [] : checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(declared)).map((property) => property.name));
  known.set(name, members);
  return members;
}

/** The property access, or element access, that reads a name or key, or the name itself when it reads no member. */
function memberRead(use: ts.Node): ts.Node {
  const parent = use.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === use) return parent;
  return ts.isElementAccessExpression(parent) && parent.argumentExpression === use ? parent : use;
}

/** The outermost of the wrappers `heldValue` looks through that hold a node, or the node itself. */
function outerValue(node: ts.Node): ts.Node {
  let outer = node;
  while (ts.isParenthesizedExpression(outer.parent) || ts.isAsExpression(outer.parent) || ts.isSatisfiesExpression(outer.parent)
    || ts.isTypeAssertionExpression(outer.parent) || ts.isNonNullExpression(outer.parent)) {
    outer = outer.parent;
  }
  return outer;
}

/**
 * Whether a node is a target that a destructuring assignment, or a for-in or
 * for-of, gives a value: it sits, through items, properties, spreads,
 * parentheses and defaults, in an object or array literal on the left of
 * `=`, or is, or sits in, what a for-in or for-of assigns.
 */
function isDestructuringTarget(node: ts.Node): boolean {
  let literal = false;
  for (let inner = node, outer = node.parent; ; inner = outer, outer = outer.parent) {
    if (ts.isForInStatement(outer) || ts.isForOfStatement(outer)) return outer.initializer === inner;
    const assigns = ts.isBinaryExpression(outer) && outer.operatorToken.kind === ts.SyntaxKind.EqualsToken && outer.left === inner;
    // `target = fallback` as an item or a property's value is a default, read through as the target is.
    const isDefault = assigns && (ts.isArrayLiteralExpression(outer.parent) || (ts.isPropertyAssignment(outer.parent) && outer.parent.initializer === outer));
    if (assigns && !isDefault) return literal;
    if (ts.isArrayLiteralExpression(outer) || ts.isObjectLiteralExpression(outer)) {
      literal = true;
    } else if (!isDefault && !ts.isSpreadElement(outer) && !ts.isSpreadAssignment(outer) && !ts.isShorthandPropertyAssignment(outer)
      && !(ts.isPropertyAssignment(outer) && outer.initializer === inner) && !ts.isParenthesizedExpression(outer)) {
      return false;
    }
  }
}

/** Each name written in one file, read once for each file. */
interface WrittenNames {
  /** Each name, private name, and key written as a literal that an element access reads, by its text. */
  byText: ReadonlyMap<string, readonly ts.Node[]>;
  /** Each name a default import binds, whatever its text. */
  defaults: readonly ts.Identifier[];
}

/** The names written in each file, as `writtenNames` reads them. */
const WRITTEN_NAMES = new WeakMap<ts.SourceFile, WrittenNames>();

/** The names written in one file, as WrittenNames says, read once. */
function writtenNames(file: ts.SourceFile): WrittenNames {
  const kept = WRITTEN_NAMES.get(file);
  if (kept !== undefined) return kept;
  const byText = new Map<string, ts.Node[]>();
  const defaults: ts.Identifier[] = [];
  const pending: ts.Node[] = [file];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)
      || (ts.isStringLiteralLike(node) && ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node)) {
      const same = byText.get(node.text);
      if (same === undefined) {
        byText.set(node.text, [node]);
      } else {
        same.push(node);
      }
    }
    if (ts.isImportClause(node) && node.name !== undefined) defaults.push(node.name);
    ts.forEachChild(node, (child) => {
      pending.push(child);
    });
  }
  const names = { byText, defaults };
  WRITTEN_NAMES.set(file, names);
  return names;
}

/**
 * Each node in the files of a declaration's program that refers to it: a
 * name, a private name, or a key written as a literal that an element
 * access reads, whose symbol, through any import alias, the declaration
 * declares. An import or export under another name, a default import
 * included, is followed by that name too. The declaration's own name is one.
 * A program no check here made is searched in the declaration's own file.
 */
function usesOf(declaration: ts.Declaration, checker: ts.TypeChecker): ts.Node[] {
  const name = ts.getNameOfDeclaration(declaration);
  if (name === undefined || !(ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name))) return [];
  const files = PROGRAM_SOURCES.get(checker) ?? [declaration.getSourceFile()];
  const texts = [name.text];
  for (const file of files) {
    for (const imported of writtenNames(file).defaults) {
      if (!texts.includes(imported.text) && refersTo(imported, declaration, checker)) texts.push(imported.text);
    }
  }
  const found: ts.Node[] = [];
  // A name pushed while this runs is read too, as an array's iterator reads items added after it starts.
  for (const text of texts) {
    for (const file of files) {
      for (const node of writtenNames(file).byText.get(text) ?? []) {
        if (!refersTo(node, declaration, checker)) continue;
        found.push(node);
        const parent = node.parent;
        if ((ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && !texts.includes(parent.name.text)) texts.push(parent.name.text);
      }
    }
  }
  return found;
}

/** Whether a name, a private name, or a key written as a literal refers to a declaration where it is used, as `usedSymbol` reads it. */
function refersTo(node: ts.Node, declaration: ts.Declaration, checker: ts.TypeChecker): boolean {
  return (usedSymbol(node, checker)?.declarations ?? []).includes(declaration);
}

/** The symbol a name, a private name, or a key written as a literal refers to where it is used, through any import alias. */
function usedSymbol(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  const found = ts.isIdentifier(node) ? referencedSymbol(node, checker) : checker.getSymbolAtLocation(node);
  return found !== undefined && (found.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(found) : found;
}

/**
 * What a for-of name is given: each item `iteratedContents` finds the value
 * iterated gives, as `declaredValues` reads it, with the name read given
 * back as well, as unread, where it may give what no rule reads.
 */
function iteratedValues(value: ts.Identifier | ts.PropertyAccessExpression, iterated: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Node>): DeclaredValue[] {
  return readContents(iteratedContents(iterated, checker.getTypeAtLocation(value), checker, seen), value, checker, seen);
}

/**
 * Each item iterating a value gives, as a for-of or a spread in an array
 * iterates it: each item each value it may be holds, as `declaredValues`
 * reads that value. An array literal gives its items and each item code adds
 * to it, as `placeContents` finds them. A call or `new` of a library
 * function gives each value `libraryContents` finds that the values it is
 * handed hold, whose type fits the type wanted, as `new Set(list)`,
 * `list.slice()` and `map.values()` give those of `list` and `map`. Any
 * other call or `new` is read through each array literal `callValues` finds
 * it holds. A value not written here is read by its declared type alone. A
 * container changed in a way no rule reads, a call that holds anything but
 * array literals, or any other value that is not an array literal, gives
 * what no rule reads.
 *
 * @param wanted The type of each item read.
 */
function iteratedContents(iterated: ts.Expression, wanted: ts.Type, checker: ts.TypeChecker, seen: Set<ts.Node>): ReachedContents {
  const found: ReachedContents = { values: [], unread: null, reached: false };
  for (const one of declaredValues(iterated, checker, seen)) {
    found.reached = true;
    const lists: ts.ArrayLiteralExpression[] = [];
    if (ts.isArrayLiteralExpression(one)) {
      lists.push(one);
    } else if (isLibraryCall(one, checker)) {
      const held = libraryContents(one, wanted, checker, seen);
      found.values.push(...held.values);
      found.unread ??= held.unread;
      continue;
    } else {
      const held = ts.isCallExpression(one) || ts.isNewExpression(one) ? callValues(one, checker, NOTHING_FOLLOWED).held.flatMap((each) => declaredValues(each, checker, seen)) : [];
      lists.push(...held.filter(ts.isArrayLiteralExpression));
      if (lists.length === 0 || lists.length < held.length) found.unread ??= iterated;
    }
    for (const list of lists) {
      const held = placeContents(list, checker, seen);
      found.values.push(...held.values);
      found.unread ??= held.unread;
    }
  }
  return found;
}

/** The type of each item an array literal holds, or the literal's own type where it declares none. */
function itemType(literal: ts.ArrayLiteralExpression, checker: ts.TypeChecker): ts.Type {
  const type = checker.getTypeAtLocation(literal);
  return type.getNumberIndexType() ?? type;
}

/** A value whose contents the rules read where it is written: an object or array literal, a collection a library call makes, or a class, whose instances share each member the class declares. */
type Container = ts.ArrayLiteralExpression | ts.ObjectLiteralExpression | ts.CallExpression | ts.NewExpression | ts.ClassLikeDeclaration;

/** A value a container is given: an expression, or a method an object literal writes. */
type WrittenValue = ts.Expression | ts.MethodDeclaration;

/** What a container holds, as `placeContents` finds it. */
interface Contents {
  /** Each item, property value or method it holds, written where it is made or given to it later. */
  values: WrittenValue[];
  /** What makes it hold what no rule reads, or null. */
  unread: ts.Node | null;
}

/** What the values a library call is handed hold, as `libraryContents` finds it. */
interface ReachedContents extends Contents {
  /** Whether any value it is handed is written here, or is a value no rule reads, so that its declared type alone does not describe what it gives. */
  reached: boolean;
}

/**
 * Each value a container holds, read as `declaredValues` reads it, with the
 * name read given back as well, as unread, where it may hold what no rule
 * reads.
 */
function readContents(contents: Contents, value: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Node>): DeclaredValue[] {
  const values = contents.values.flatMap((one): DeclaredValue[] => ts.isMethodDeclaration(one) ? [one] : declaredValues(one, checker, seen));
  return contents.unread === null ? values : [...values, value];
}

/**
 * What a container holds: each item of an array literal, each value or
 * method of an object literal, each initializer of a property a class
 * declares, and, for a collection a library call makes, what each value the
 * call is handed holds, as `reachedContents` finds it, so that
 * `new Set(list)` holds what `list` holds, and what each callback it is
 * handed returns, as `callbackResults` reads it; and each value code gives the
 * container after it is made, as `writtenTo` finds it. A spread in an array
 * literal gives what `iteratedContents` finds iterating it gives, and one in
 * an object literal what `reachedContents` finds the value spread holds. A
 * get accessor gives each value it returns; a set accessor holds nothing,
 * since what it is given goes where its body writes it.
 */
function placeContents(container: Container, checker: ts.TypeChecker, seen: Set<ts.Node>, mapKeys?: readonly string[]): Contents {
  const found: Contents = { values: [], unread: null };
  if (seen.has(container)) return found;
  seen.add(container);
  const keys = isMapContainer(container, checker) ? mapKeys : undefined;
  if (ts.isArrayLiteralExpression(container)) {
    for (const item of container.elements) {
      if (ts.isSpreadElement(item)) {
        const spread = iteratedContents(item.expression, itemType(container, checker), checker, seen);
        found.values.push(...spread.values);
        found.unread ??= spread.unread;
      } else if (!ts.isOmittedExpression(item)) {
        found.values.push(item);
      }
    }
  } else if (ts.isObjectLiteralExpression(container)) {
    for (const property of container.properties) {
      if (ts.isPropertyAssignment(property)) {
        found.values.push(property.initializer);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        found.values.push(property.name);
      } else if (ts.isMethodDeclaration(property)) {
        found.values.push(property);
      } else if (ts.isGetAccessorDeclaration(property)) {
        found.values.push(...returnedExpressions(property));
      } else if (ts.isSpreadAssignment(property)) {
        const spread = reachedContents(property.expression, checker, seen);
        found.values.push(...spread.values);
        found.unread ??= spread.unread;
      }
    }
  } else if (ts.isClassLike(container)) {
    found.values.push(...container.members.filter(ts.isPropertyDeclaration).flatMap((member) => member.initializer === undefined ? [] : [member.initializer]));
  } else {
    for (const source of librarySources(container, checker)) {
      const reached = reachedContents(source, checker, seen, keys);
      found.values.push(...reached.values.filter((value) => keys === undefined || mayHaveKey(value, keys, container, checker)));
      found.unread ??= reached.unread;
    }
    const returned = callbackResults(container, checker, seen);
    found.values.push(...returned.values);
    found.unread ??= returned.unread;
  }
  const written = keys === undefined ? writtenTo(container, undefined, checker) : writtenToKeys(container, keys, checker);
  found.values.push(...written.values);
  found.unread ??= written.unread;
  return found;
}

/** Whether a container is a map a library call makes, whose read-only form is ReadonlyMap. */
function isMapContainer(container: Container, checker: ts.TypeChecker): boolean {
  if (!ts.isCallExpression(container) && !ts.isNewExpression(container)) return false;
  const type = checker.getNonNullableType(checker.getTypeAtLocation(container));
  return (type.isUnion() ? type.types : [type]).some((part) => (part.flags & ts.TypeFlags.Object) !== 0 && readOnlyForm(part, checker) === "ReadonlyMap");
}

/**
 * Whether a value a map is made from may be an entry under one of some
 * keys. An entry written as an array literal, in a list of entries written
 * as an array literal that the map is made from where it is written, is one
 * no code can reach to change, so its first item says its key: it is under
 * none of those keys when `keysOf` finds every key that item may be, and
 * none is one of them. Any other value may be under any key, since a key
 * code writes later, as `entry[0] = "wanted"` writes one, is read by no
 * rule. A value `set` gives a map is read under its key where it is written.
 */
function mayHaveKey(value: WrittenValue, keys: readonly string[], map: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker): boolean {
  if (!ts.isArrayLiteralExpression(value)) return true;
  const list = value.parent;
  if (!ts.isArrayLiteralExpression(list) || !(map.arguments ?? []).some((argument) => heldValue(argument) === list)) return true;
  const [first] = value.elements;
  const given = first === undefined || ts.isOmittedExpression(first) ? undefined : keysOf(first, checker);
  return given === undefined || given.some((key) => keys.includes(key));
}

/** What code gives a container under any of some keys, as `writtenTo` finds it for each. */
function writtenToKeys(container: Container, keys: readonly string[], checker: ts.TypeChecker): Written {
  const found: Written = { values: [], unread: null, moved: false };
  for (const key of keys) {
    const written = writtenTo(container, key, checker);
    found.values.push(...written.values.filter((value) => !found.values.includes(value)));
    found.unread ??= written.unread;
    found.moved ||= written.moved;
  }
  return found;
}

/**
 * The keys a call reads from a map: the keys `keysOf` finds the key handed
 * to `get` of the library's Map or ReadonlyMap may be.
 *
 * @returns The keys, or undefined for any other call, or a key not written so that its keys are known.
 */
function mapReadKeys(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker): readonly string[] | undefined {
  const invocation = invocationOf(call, checker);
  const declaration = invocation.declaration;
  if (declaration === undefined || !declaration.getSourceFile().isDeclarationFile || declaration.name === undefined || !ts.isIdentifier(declaration.name)) return undefined;
  const owner = declaration.parent;
  if (declaration.name.text !== "get" || !ts.isInterfaceDeclaration(owner) || (owner.name.text !== "Map" && owner.name.text !== "ReadonlyMap")) return undefined;
  return keysOf(invocation.args[0], checker);
}

/**
 * What the containers an expression may be hold, as `placeContents` finds
 * them, for each value `declaredValues` finds it may be. A function, a
 * method or a class that is no container is held itself, since what is
 * handed one may keep it. Any other value that may be or hold a function and
 * is no container, as a parameter whose callers cannot all be found is not,
 * holds what no rule reads.
 */
function reachedContents(expression: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Node>, mapKeys?: readonly string[]): ReachedContents {
  const found: ReachedContents = { values: [], unread: null, reached: false };
  // A function found here is read again where its holder is read, so the declarations read to find it are not marked as read for that.
  for (const value of declaredValues(expression, checker, new Set(seen))) {
    found.reached = true;
    const containers = containersOfValue(value, checker);
    if (containers === undefined) {
      // A function or method written here is held as itself; a function declared here, or a class, is held as the expression that names it, as `list.concat(boxing)` holds `boxing`.
      if (ts.isMethodDeclaration(value) || (ts.isExpression(value) && isFunctionValue(value))) {
        found.values.push(value);
      } else if (!ts.isExpression(value)) {
        if (!found.values.includes(expression)) found.values.push(expression);
      } else if (mayCarryFunction(value, checker)) {
        found.unread ??= expression;
      }
      continue;
    }
    for (const container of containers) {
      const held = placeContents(container, checker, seen, mapKeys);
      found.values.push(...held.values);
      found.unread ??= held.unread;
    }
  }
  return found;
}

/**
 * Each value a call of a library function may give back from the values it
 * is handed, as `librarySources` lists them, from what the callbacks it is
 * handed return, as `callbackResults` reads them, and from what code gives
 * the collection the call makes, as `writtenTo` finds it: each value they hold,
 * as `placeContents` finds it, whose type fits the type wanted, or, for an
 * array literal that does not, each of its items that does, as `map.get(key)`
 * gives the value of each entry. A value held that fits nothing and may be
 * or hold a function makes what is given unread when the type wanted may
 * hold one, since the call may build what it gives from that value, as
 * `Object.entries` does.
 *
 * @param wanted The type of what is read: the call's own, an item's, or a member's.
 */
function libraryContents(call: ts.CallExpression | ts.NewExpression, wanted: ts.Type, checker: ts.TypeChecker, seen: Set<ts.Node>): ReachedContents {
  const found: ReachedContents = { values: [], unread: null, reached: false };
  const held: Contents[] = [];
  const keys = mapReadKeys(call, checker);
  for (const source of librarySources(call, checker)) {
    const reached = reachedContents(source, checker, seen, keys);
    found.reached ||= reached.reached;
    held.push(reached);
  }
  if (isCollection(checker.getTypeAtLocation(call), checker)) held.push(writtenTo(call, undefined, checker));
  held.push(callbackResults(call, checker, seen));
  for (const contents of held) {
    found.unread ??= contents.unread;
    for (const value of contents.values) {
      const fitting = fittingValues(value, wanted, checker);
      found.values.push(...fitting);
      if (fitting.length > 0 || !mayCarryFunction(value, checker)) continue;
      const parts = fittingParts(value, wanted, checker, seen);
      found.values.push(...parts.values);
      found.unread ??= parts.unread;
      if (parts.values.length === 0 && mayHoldFunction(wanted, checker, call)) found.unread ??= call;
    }
  }
  found.reached ||= found.values.length > 0 || found.unread !== null;
  return found;
}

/**
 * The parts of a value held that fits nothing that may fit the type wanted,
 * where the value's type is an array, a set or a map and it is not written
 * in place as an array literal, as an entry `[key, boxing]` named by `entry`
 * holds `boxing`, or `make()` holds what `make` returns: each value each
 * container it may be holds, as `declaredValues`, `containersOfValue` and
 * `placeContents` find them, that `fittingValues` finds fits. A value it may
 * be that is no container, or a part that fits nothing, that may be or hold
 * a function and cannot be called, gives what no rule reads. Any other value
 * has no parts besides those `fittingValues` reads.
 *
 * @param seen The declarations read already, which this adds to, so that a value is read once however many times it is held.
 */
function fittingParts(value: WrittenValue, wanted: ts.Type, checker: ts.TypeChecker, seen: Set<ts.Node>): Contents {
  const found: Contents = { values: [], unread: null };
  if (!ts.isExpression(value) || ts.isArrayLiteralExpression(value) || !isCollection(checker.getTypeAtLocation(value), checker)) return found;
  for (const one of declaredValues(value, checker, seen)) {
    const containers = containersOfValue(one, checker);
    if (containers === undefined) {
      if (ts.isExpression(one) && !mayBeCalled(checker.getTypeAtLocation(one)) && mayCarryFunction(one, checker)) found.unread ??= value;
      continue;
    }
    for (const container of containers) {
      const held = placeContents(container, checker, seen);
      found.unread ??= held.unread;
      for (const part of held.values) {
        const fitting = fittingValues(part, wanted, checker);
        found.values.push(...fitting);
        if (fitting.length === 0 && !mayBeCalled(checker.getTypeAtLocation(part)) && mayCarryFunction(part, checker)) found.unread ??= value;
      }
    }
  }
  return found;
}

/** The value itself when its type fits the type wanted, or, for an array literal that does not, each of its items that does. */
function fittingValues(value: WrittenValue, wanted: ts.Type, checker: ts.TypeChecker): WrittenValue[] {
  if (fitsResult(checker.getTypeAtLocation(value), wanted, checker)) return [value];
  if (!ts.isArrayLiteralExpression(value)) return [];
  return value.elements.filter((item) => !ts.isSpreadElement(item) && !ts.isOmittedExpression(item) && fitsResult(checker.getTypeAtLocation(item), wanted, checker));
}

/**
 * The values a call of a library function is handed that it may keep: the
 * value a method is read from, as `list` is in `list.at(0)`, or the `this`
 * that `call` or `apply` hands it, when that may hold a function; and each
 * argument that may be or hold one, as `boxing` is in `list.concat(boxing)`.
 * A callback, an argument at a parameter `isCallbackParameter` finds the
 * library calls, is not kept by being handed: what it returns is read as
 * `callbackResults` reads it.
 */
function librarySources(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker): ts.Expression[] {
  const invocation = invocationOf(call, checker);
  const receiver = ts.isCallExpression(call) && invocation.callee === call.expression ? memberReceiver(call.expression) : undefined;
  const receivers = [...receiver === undefined ? [] : [receiver], ...invocation.unread].filter((source) => mayHoldFunction(checker.getTypeAtLocation(source), checker, source));
  const declaration = invocation.declaration;
  const kept = invocation.args.filter((argument, at) => {
    const parameter = declaration === undefined ? undefined : parameterOf(declaration, invocation.args, at);
    return (parameter === undefined || !isCallbackParameter(parameter, checker)) && mayBeOrHoldFunction(checker.getTypeAtLocation(argument), checker, argument);
  });
  return [...receivers, ...kept];
}

/**
 * Whether a library calls what a parameter is handed, by the parameter's
 * declared type: each part of the type, besides null and undefined, and of
 * the type of each item a rest parameter takes, can be called, and none is a
 * type parameter or a type the checker cannot narrow, either of which a
 * value of any kind may be given as. `map` declares its callback so; `concat`
 * declares its items with a type parameter, and keeps them.
 */
function isCallbackParameter(parameter: ts.ParameterDeclaration, checker: ts.TypeChecker): boolean {
  const declared = checker.getTypeAtLocation(parameter);
  const taken = parameter.dotDotDotToken === undefined ? declared : declared.getNumberIndexType();
  if (taken === undefined) return false;
  const type = checker.getNonNullableType(taken);
  const parts = type.isUnion() ? type.types : [type];
  return parts.every((part) => part.getCallSignatures().length > 0 && !isOpenType(part) && !isConstrainedType(part));
}

/**
 * What the callbacks a call of a library function is handed return, where
 * the call's declared result may hold it: each value each function the
 * callback may be, as `heldFunctions` finds them, returns, for a callback
 * whose declared type returns a type parameter the declared result uses
 * too, as `flatMap` and `map` declare theirs. A callback whose functions
 * cannot all be followed returns what no rule reads.
 *
 * @param seen The declarations read already, which this reads from but does not add to.
 */
function callbackResults(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker, seen: ReadonlySet<ts.Node>): Contents {
  const found: Contents = { values: [], unread: null };
  const invocation = invocationOf(call, checker);
  const declaration = invocation.declaration;
  if (declaration === undefined) return found;
  const result = checker.getSignatureFromDeclaration(declaration)?.getReturnType();
  const resultParts = result === undefined ? new Set<ts.Type>() : typeParametersIn(result, checker);
  for (const [at, argument] of invocation.args.entries()) {
    const parameter = parameterOf(declaration, invocation.args, at);
    if (parameter === undefined || !isCallbackParameter(parameter, checker) || !returnsResultPart(parameter, resultParts, checker)) continue;
    const held = heldFunctions(argument, checker, new Set(seen));
    if (held.unread) found.unread ??= argument;
    found.values.push(...held.functions.flatMap(returnedExpressions));
  }
  return found;
}

/** Whether a callback parameter's declared type returns, in any of its call signatures, a type parameter that is one of those given. */
function returnsResultPart(parameter: ts.ParameterDeclaration, resultParts: ReadonlySet<ts.Type>, checker: ts.TypeChecker): boolean {
  const declared = checker.getTypeAtLocation(parameter);
  const taken = parameter.dotDotDotToken === undefined ? declared : declared.getNumberIndexType() ?? declared;
  const type = checker.getNonNullableType(taken);
  return (type.isUnion() ? type.types : [type]).some((part) => part.getCallSignatures()
    .some((signature) => [...typeParametersIn(signature.getReturnType(), checker)].some((each) => resultParts.has(each))));
}

/**
 * Each type parameter a type uses outside any function type: itself, each
 * part of a union or intersection, and each type argument of a generic type
 * it names, as `U[]` names `Array<U>`.
 *
 * @param found The type parameters found so far, which this adds to and returns.
 * @param read The types read already, so that a type that names itself is read once.
 */
function typeParametersIn(type: ts.Type, checker: ts.TypeChecker, found = new Set<ts.Type>(), read = new Set<ts.Type>()): Set<ts.Type> {
  if (read.has(type)) return found;
  read.add(type);
  if (type.flags & ts.TypeFlags.TypeParameter) found.add(type);
  const parts = type.isUnionOrIntersection() ? type.types
    : type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference ? checker.getTypeArguments(type as ts.TypeReference) : [];
  for (const part of parts) {
    typeParametersIn(part, checker, found, read);
  }
  return found;
}

/** Whether a call, or `new`, runs a function declared in a library, as `invocationOf` finds it, so that no body written here says what it gives. */
function isLibraryCall(node: ts.Node, checker: ts.TypeChecker): node is ts.CallExpression | ts.NewExpression {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return false;
  const invocation = invocationOf(node, checker);
  return !invocation.binds && invocation.declaration !== undefined && invocation.declaration.getSourceFile().isDeclarationFile;
}

/**
 * What a call of a library function gives back, when no function written
 * here runs: each value `libraryContents` finds whose type fits the call's
 * own, when its type may be a function, as `map.get(key)` gives a function
 * the map holds; the call itself, when its type may hold a function, so
 * that what reads it, as a loop or an index does, reads what it holds; and
 * the call as well, as unread, where what it is handed holds what no rule
 * reads. A call handed no value written here is read by its declared type
 * alone, and gives none.
 */
function libraryValues(call: ts.CallExpression, checker: ts.TypeChecker, seen: Set<ts.Node>): DeclaredValue[] {
  const result = checker.getTypeAtLocation(call);
  if (!mayBeOrHoldFunction(result, checker, call)) return [];
  // The declarations read to find what the call is handed are read again by whatever reads the call itself, as a loop over it does.
  const contents = libraryContents(call, result, checker, new Set(seen));
  if (!contents.reached) return [];
  if (!mayBeFunction(result, checker, call)) return [call];
  return readContents(contents, call, checker, seen);
}

/** Whether a type, or a part of its union, is an array, a set or a map, whose read-only form `readOnlyForm` names. */
function isCollection(type: ts.Type, checker: ts.TypeChecker): boolean {
  const part = checker.getNonNullableType(type);
  return (part.isUnion() ? part.types : [part]).some((each) => (each.flags & ts.TypeFlags.Object) !== 0 && readOnlyForm(each, checker) !== undefined);
}

/** Whether a value a container may be given may be a function or hold one, by its type; a method, a function or a class always is one. */
function mayCarryFunction(value: DeclaredValue, checker: ts.TypeChecker): boolean {
  return !ts.isExpression(value) || mayBeOrHoldFunction(checker.getTypeAtLocation(value), checker, value);
}

/** The side of a class a value is: the class itself, whose static members it holds, or an instance, which holds the others. */
type ClassSide = "static" | "instance";

/** The containers an expression may be, as `placesOf` finds them. */
interface Reach {
  /** Each container one of its values is. */
  containers: Container[];
  /** For each container, at the same position, the side of it the value is, as `classSide` reads it, or undefined for one that is no class. */
  sides: Array<ClassSide | undefined>;
  /** Whether a value it may be is written here, or is no rule's to read, and is no container, so that what it reaches cannot be told. */
  unknown: boolean;
  /** Whether it has no value written here, as a library's value has none, so that it reaches no container written here, though what it holds cannot be read. */
  empty: boolean;
}

/**
 * The containers each value an expression may be is, as `declaredValues`
 * finds the values and `containersOfValue` reads each, with the side of a
 * class each is, as `classSide` reads it.
 */
function placesOf(expression: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Node>): Reach {
  const values = declaredValues(expression, checker, seen);
  const found: Reach = { containers: [], sides: [], unknown: false, empty: values.length === 0 };
  for (const value of values) {
    const containers = containersOfValue(value, checker);
    if (containers === undefined) {
      found.unknown = true;
    } else {
      found.containers.push(...containers);
      found.sides.push(...containers.map(() => classSide(value)));
    }
  }
  return found;
}

/**
 * The side of a class a value is: the class itself, read by its name; an
 * instance, which `new` makes; or, for `this`, the class itself where a
 * static member or a static block holds it, and an instance anywhere else
 * in the class.
 *
 * @returns The side, or undefined for a value that is neither.
 */
function classSide(value: DeclaredValue): ClassSide | undefined {
  if (ts.isClassLike(value)) return "static";
  if (ts.isNewExpression(value)) return "instance";
  if (value.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
  const holder = thisHolder(value);
  if (holder === undefined || !ts.isClassLike(holder.parent)) return undefined;
  return ts.isClassStaticBlockDeclaration(holder) || isStatic(holder) ? "static" : "instance";
}

/** Whether a declaration is written with `static`. */
function isStatic(declaration: ts.Node): boolean {
  return ts.canHaveModifiers(declaration) && (ts.getModifiers(declaration) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
}

/** Whether every value an expression may be is a container `placesOf` finds, and it has one. */
function reachesOnlyContainers(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const reach = placesOf(expression, checker, new Set());
  return !reach.unknown && !reach.empty;
}

/**
 * The containers one value is: itself for an object or array literal, or for
 * a class; each class a `new` makes an instance of; the class, or the object
 * literal, whose method `this` is read in; and itself for a call or `new` of
 * a library function whose value is an array, a set or a map.
 *
 * @returns The containers, or undefined when the value is none of these.
 */
function containersOfValue(value: DeclaredValue, checker: ts.TypeChecker): Container[] | undefined {
  if (ts.isArrayLiteralExpression(value) || ts.isObjectLiteralExpression(value) || ts.isClassLike(value)) return [value];
  if (value.kind === ts.SyntaxKind.ThisKeyword) {
    const owner = thisOwner(value);
    return owner === undefined ? undefined : [owner];
  }
  if (ts.isNewExpression(value)) {
    const made = declaredValues(value.expression, checker, new Set());
    if (made.length > 0 && made.every(ts.isClassLike)) return made.filter(ts.isClassLike);
  }
  return isLibraryCall(value, checker) && isCollection(checker.getTypeAtLocation(value), checker) ? [value] : undefined;
}

/**
 * The container `this` is read in: the class whose method, constructor,
 * accessor, property or static block holds it, or the object literal whose
 * method or accessor holds it, through any arrow function between.
 *
 * @returns The container, or undefined when `this` is read anywhere else, as in a function declaration.
 */
function thisOwner(node: ts.Node): Container | undefined {
  const holder = thisHolder(node);
  const owner = holder?.parent;
  if (owner !== undefined && ts.isClassLike(owner)) return owner;
  return owner !== undefined && ts.isObjectLiteralExpression(owner) && holder !== undefined && (ts.isMethodDeclaration(holder) || ts.isAccessor(holder)) ? owner : undefined;
}

/** The function, property or static block whose `this` a node reads, through any arrow function between, or undefined where there is none. */
function thisHolder(node: ts.Node): ts.Node | undefined {
  return ts.findAncestor(node.parent, (each) => (ts.isFunctionLike(each) && !ts.isArrowFunction(each)) || ts.isPropertyDeclaration(each) || ts.isClassStaticBlockDeclaration(each));
}

/**
 * One change code makes to what a value holds, as `changesAt` finds it. A
 * "value" write gives a value each key named, or, with no keys, any key or
 * a new item, as `list.push(boxing)` adds one; a "copy" gives each key of
 * another value, as `Object.assign(holder, source)` gives those of
 * `source`; "moved" moves items to other positions, as `sort` does; and
 * "unread" is a change no rule reads.
 */
type Write =
  | { kind: "value"; keys: readonly string[] | undefined; value: WrittenValue }
  | { kind: "copy"; source: ts.Expression }
  | { kind: "moved" }
  | { kind: "unread" };

/** One change, with the value it is made through and where it is written. */
interface Change {
  receiver: ts.Expression;
  write: Write;
  at: ts.Node;
  /**
   * Set when the change counts only for the containers its receiver may
   * be, and not, where the receiver may be no container, for each container
   * the receiver's type takes, as `mayReach` would say.
   */
  containersOnly?: true;
  /**
   * Set when the change is placed on a class, for the side of it its
   * receiver is: the class itself, whose static members it changes, or an
   * instance, whose other members it changes.
   */
  side?: ClassSide;
}

/** The changes each container is given, for one checker, once every change is placed. */
interface WriteTable {
  /** Each change whose receiver may be a container, by the container. */
  placed: Map<ts.Node, Change[]>;
  /** Each change whose receiver may be a value that is no container, with the receiver's type, which says what containers it may be. */
  unplaced: Array<{ change: Change; type: ts.Type }>;
}

/** The finished table of changes for each checker. */
const WRITE_TABLES = new WeakMap<ts.TypeChecker, WriteTable>();

/** The table of changes placed so far, for each checker whose table is being made, which a reading made meanwhile reads. */
const TABLES_BEING_MADE = new WeakMap<ts.TypeChecker, WriteTable>();

/** Each change no rule reads, so that a name it leaves unknown says why. */
const UNREAD_CHANGES = new WeakSet<ts.Node>();

/**
 * Every change `changesAt` finds in the files of a program, each placed on
 * each container its receiver may be, as `placesOf` finds them, and on each
 * class that container extends, or kept with its receiver's type where the
 * receiver may be a value written here that is no container. A receiver
 * with no value written here reaches no container written here. A receiver may reach a container only
 * through what another change gives, as `lists.push(list)` makes `list` an
 * item of `lists`, so every change is placed again, reading what was placed
 * before, until no change reaches more. The assignments found meanwhile are
 * found again afterwards, since they were read from a table not finished.
 *
 * @param location A node of a file the checker read, whose file is searched when the program's files are not known.
 */
function writeTable(checker: ts.TypeChecker, location: ts.Node): WriteTable {
  const made = WRITE_TABLES.get(checker) ?? TABLES_BEING_MADE.get(checker);
  if (made !== undefined) return made;
  const changes = (PROGRAM_SOURCES.get(checker) ?? [location.getSourceFile()]).flatMap((file) => changesIn(file, checker));
  let table: WriteTable = { placed: new Map(), unplaced: [] };
  for (let before = -1; before < placedCount(table);) {
    before = placedCount(table);
    TABLES_BEING_MADE.set(checker, table);
    ASSIGNMENTS.delete(checker);
    table = placeChanges(changes, checker);
  }
  TABLES_BEING_MADE.delete(checker);
  ASSIGNMENTS.delete(checker);
  WRITE_TABLES.set(checker, table);
  return table;
}

/** How many times a table places a change, counting each container a change is placed on and each change kept unplaced. */
function placedCount(table: WriteTable): number {
  return [...table.placed.values()].reduce((count, changes) => count + changes.length, table.unplaced.length);
}

/**
 * Each change placed on each container its receiver may be, and on each
 * class that container extends, for each side of a class the receiver is
 * there, or kept with its receiver's type.
 */
function placeChanges(changes: readonly Change[], checker: ts.TypeChecker): WriteTable {
  const table: WriteTable = { placed: new Map(), unplaced: [] };
  for (const change of changes) {
    const reach = placesOf(change.receiver, checker, new Set());
    const sides = new Map<Container, Set<ClassSide | undefined>>();
    for (const [at, each] of reach.containers.entries()) {
      for (const container of [each, ...extendedClasses(each, checker)]) {
        const kept = sides.get(container) ?? new Set<ClassSide | undefined>();
        kept.add(reach.sides[at]);
        sides.set(container, kept);
      }
    }
    for (const [container, each] of sides) {
      const placed = [...each].map((side): Change => side === undefined ? change : { ...change, side });
      table.placed.set(container, [...table.placed.get(container) ?? [], ...placed]);
    }
    if (reach.unknown && change.containersOnly === undefined) table.unplaced.push({ change, type: receiverType(change.receiver, checker) });
  }
  return table;
}

/** Each class written here that a class extends, through each class those extend; none for any other container. */
function extendedClasses(container: Container, checker: ts.TypeChecker, seen = new Set<ts.Node>()): ts.ClassLikeDeclaration[] {
  if (!ts.isClassLike(container) || seen.has(container)) return [];
  seen.add(container);
  const base = container.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
  if (base === undefined) return [];
  return declaredValues(base.expression, checker, new Set()).filter(ts.isClassLike).flatMap((each) => [each, ...extendedClasses(each, checker, seen)]);
}

/** The type a change's receiver has, without null or undefined, and, for a type parameter, its constraint. */
function receiverType(receiver: ts.Expression, checker: ts.TypeChecker): ts.Type {
  const type = checker.getNonNullableType(checker.getTypeAtLocation(receiver));
  return isConstrainedType(type) ? checker.getBaseConstraintOfType(type) ?? type : type;
}

/** Each change `changesAt` finds at each node of a file. */
function changesIn(file: ts.SourceFile, checker: ts.TypeChecker): Change[] {
  const found: Change[] = [];
  const pending: ts.Node[] = [file];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    ts.forEachChild(node, (child) => {
      pending.push(child);
    });
    found.push(...changesAt(node, checker));
  }
  return found;
}

/**
 * The changes one node makes to what a value holds that may give it a
 * function, besides an assignment to a name, which `assignmentsOf` reads:
 * an assignment to a member, read by its key, as `holder[key] = boxing`
 * gives each key the key's type allows, or any key when its type is no
 * literal; a member a destructuring, a for-in or a for-of assigns, which no
 * rule reads; and each change a call makes, as `callChanges` finds them. A
 * change that gives no value that may be or hold a function, or that moves
 * or changes what a value that holds none holds, is left out, since no rule
 * reads it.
 */
function changesAt(node: ts.Node, checker: ts.TypeChecker): Change[] {
  let changes: Change[] = [];
  if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind) && !isDestructuringTarget(node)) {
    const target = heldValue(node.left);
    if (target !== undefined && (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))) {
      changes = [{ receiver: target.expression, write: { kind: "value", keys: memberKeys(target, checker), value: node.right }, at: node }];
    }
  } else if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isDestructuringTarget(node)) {
    changes = [{ receiver: node.expression, write: { kind: "unread" }, at: node }];
  } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    changes = callChanges(node, checker);
  }
  const carried = changes.filter((change) => carriesFunction(change, checker));
  for (const change of carried) {
    if (change.write.kind === "unread") UNREAD_CHANGES.add(change.at);
  }
  return carried;
}

/** Whether a change may give a value a function: a value or a copy that may be or hold one, or a move or an unread change to a value that may hold one. */
function carriesFunction(change: Change, checker: ts.TypeChecker): boolean {
  const write = change.write;
  if (write.kind === "value") return mayCarryFunction(write.value, checker);
  if (write.kind === "copy") return mayBeOrHoldFunction(checker.getTypeAtLocation(write.source), checker, write.source);
  return mayBeOrHoldFunction(receiverType(change.receiver, checker), checker, change.receiver);
}

/** The keys a member access reads: its name, or the keys `keysOf` finds its key gives. */
function memberKeys(member: ts.PropertyAccessExpression | ts.ElementAccessExpression, checker: ts.TypeChecker): readonly string[] | undefined {
  return ts.isPropertyAccessExpression(member) ? [member.name.text] : keysOf(member.argumentExpression, checker);
}

/**
 * The keys an expression may give: its text, written as a string or number
 * literal, or each string or number literal its type allows.
 *
 * @returns The keys, or undefined when its type allows a key that is no literal.
 */
function keysOf(key: ts.Expression | undefined, checker: ts.TypeChecker): readonly string[] | undefined {
  if (key === undefined || ts.isSpreadElement(key)) return undefined;
  if (ts.isStringLiteralLike(key)) return [key.text];
  if (ts.isNumericLiteral(key)) return [String(Number(key.text))];
  const type = checker.getTypeAtLocation(key);
  const keys: string[] = [];
  for (const part of type.isUnion() ? type.types : [type]) {
    if (!part.isStringLiteral() && !part.isNumberLiteral()) return undefined;
    keys.push(String(part.value));
  }
  return keys;
}

/** The methods of an array, a set or a map that add each value they are given, by name, with the position of the first value each adds. */
const ADDING_METHODS: ReadonlyMap<string, number> = new Map([["push", 0], ["unshift", 0], ["add", 0], ["splice", 2], ["fill", 0], ["set", 1]]);

/** The methods of an array that may move items to other positions. */
const MOVING_METHODS: ReadonlySet<string> = new Set(["unshift", "splice", "fill", "copyWithin", "sort", "reverse", "pop", "shift"]);

/** The methods of an array, a set or a map whose change the two lists above say, or that only remove items. */
const KNOWN_CHANGES: ReadonlySet<string> = new Set([...ADDING_METHODS.keys(), ...MOVING_METHODS, "delete", "clear"]);

/**
 * The changes a call makes. A method of an array, a set or a map that
 * `isReadingMember` does not find only reads changes the collection it is
 * called on, or the one `call` or `apply` hands it as `this`, as
 * `collectionChanges` reads it. A library function changes what it is
 * handed as `libraryChanges` reads it. A function written here makes the
 * changes written in its body, which are found where they are written.
 */
function callChanges(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker): Change[] {
  const invocation = invocationOf(call, checker);
  if (invocation.binds) return [];
  const callee = heldValue(invocation.callee);
  const forwarded = ts.isCallExpression(call) && invocation.callee !== call.expression;
  if (callee !== undefined && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
    && isCollection(checker.getTypeAtLocation(callee.expression), checker)) {
    if (isReadingMember(callee, checker)) return [];
    const self = call.arguments?.[0];
    // `apply` handed a list not written as an array literal hands on values no rule reads.
    if (forwarded && invocation.declaration === undefined) return self === undefined || ts.isSpreadElement(self) ? [] : [{ receiver: self, write: { kind: "unread" }, at: call }];
    const receiver = forwarded ? invocation.unread[0] : callee.expression;
    const keys = memberKeys(callee, checker);
    return receiver === undefined ? [] : collectionChanges(receiver, keys?.length === 1 ? keys[0] : undefined, invocation.args, call, checker);
  }
  const declaration = invocation.declaration;
  return declaration === undefined || !declaration.getSourceFile().isDeclarationFile ? [] : libraryChanges(call, declaration, invocation, checker);
}

/**
 * The changes one method of an array, a set or a map makes: each value an
 * adding method adds, under the keys `keysOf` finds the key a map's `set`
 * is given may be, or under any key; a move for a method that may move
 * items; and an unread change for a spread among the values added, or a
 * method that KNOWN_CHANGES does not name, or one whose name is not known.
 */
function collectionChanges(receiver: ts.Expression, method: string | undefined, args: readonly ts.Expression[], at: ts.Node, checker: ts.TypeChecker): Change[] {
  const changes: Change[] = [];
  const first = method === undefined ? undefined : ADDING_METHODS.get(method);
  const added = first === undefined ? [] : args.slice(first, method === "fill" || method === "set" ? first + 1 : undefined);
  const keys = method === "set" ? keysOf(args[0], checker) : undefined;
  for (const value of added) {
    changes.push({ receiver, write: ts.isSpreadElement(value) ? { kind: "unread" } : { kind: "value", keys, value }, at });
  }
  if (method !== undefined && MOVING_METHODS.has(method)) changes.push({ receiver, write: { kind: "moved" }, at });
  if (method === undefined || !KNOWN_CHANGES.has(method)) changes.push({ receiver, write: { kind: "unread" }, at });
  return changes;
}

/**
 * The changes a library function makes to a value it is handed:
 * `Object.assign` gives its target each key of each source, as
 * `copiedChanges` reads them; `Object.defineProperty` and
 * `Reflect.defineProperty` give the key the value a descriptor names, as
 * `describedChanges` reads it, and `Object.defineProperties` gives each key
 * its descriptor names; `Reflect.set` gives the key the value; and
 * `Object.setPrototypeOf` and `Reflect.setPrototypeOf` give each key of the
 * prototype. Any other library function handed two values that may be or
 * hold a function may give one to the other, so each container that a
 * value it is handed may be, at a parameter whose declared type takes any
 * value, as `mayChangeArgument` says, is changed in a way no rule reads.
 */
function libraryChanges(call: ts.CallExpression | ts.NewExpression, declaration: ts.SignatureDeclaration, invocation: Invocation, checker: ts.TypeChecker): Change[] {
  const [target, second, third] = invocation.args;
  const name = libraryMemberName(declaration);
  if (target !== undefined && !ts.isSpreadElement(target)) {
    if (name === "Object.assign") return invocation.args.slice(1).flatMap((source) => copiedChanges(target, source, call, checker));
    if (name === "Object.defineProperty" || name === "Reflect.defineProperty") return describedChanges(target, keysOf(second, checker), third, call);
    if (name === "Object.defineProperties") return definedChanges(target, second, call, checker);
    if (name === "Reflect.set") return third === undefined ? [] : [{ receiver: target, write: { kind: "value", keys: keysOf(second, checker), value: third }, at: call }];
    if (name === "Object.setPrototypeOf" || name === "Reflect.setPrototypeOf") return second === undefined ? [] : [{ receiver: target, write: { kind: "copy", source: second }, at: call }];
  }
  const handed = [...invocation.args, ...invocation.unread].filter((each) => !ts.isSpreadElement(each) && mayBeOrHoldFunction(checker.getTypeAtLocation(each), checker, each));
  if (handed.length < 2) return [];
  return handed.filter((each) => mayHoldFunction(checker.getTypeAtLocation(each), checker, each) && mayChangeArgument(each, declaration, invocation, checker))
    .map((each): Change => ({ receiver: each, write: { kind: "unread" }, at: call, containersOnly: true }));
}

/**
 * The changes `Object.defineProperties` makes: each key of an object literal
 * written in place is given what its descriptor names, as
 * `describedChanges` reads it. Anything else gives what no rule reads.
 */
function definedChanges(target: ts.Expression, descriptors: ts.Expression | undefined, at: ts.Node, checker: ts.TypeChecker): Change[] {
  const literal = heldValue(descriptors);
  if (literal === undefined || !ts.isObjectLiteralExpression(literal)) return [{ receiver: target, write: { kind: "unread" }, at }];
  return literal.properties.flatMap((property): Change[] => {
    const key = property.name === undefined ? undefined : propertyKey(property.name, checker);
    return ts.isPropertyAssignment(property) ? describedChanges(target, key === undefined ? undefined : [key], property.initializer, at) : [{ receiver: target, write: { kind: "unread" }, at }];
  });
}

/**
 * Whether a library function may change an argument in a way its declared
 * types do not say: the parameter it is handed to is declared with a type
 * that takes any value, as any, unknown, object or a type parameter do, or
 * with an array, a set or a map that is not read-only. `this`, handed by
 * `call`, has no parameter, so it may be changed. A parameter declared with
 * any other type, as `ts.forEachChild` declares a node, is changed only as
 * that type's own members allow, which put nothing written here into it.
 */
function mayChangeArgument(argument: ts.Expression, declaration: ts.SignatureDeclaration, invocation: Invocation, checker: ts.TypeChecker): boolean {
  const at = invocation.args.indexOf(argument);
  const parameter = at < 0 ? undefined : parameterOf(declaration, invocation.args, at);
  if (parameter === undefined) return true;
  const type = checker.getTypeAtLocation(parameter);
  return (type.isUnion() ? type.types : [type]).some((part) => isOpenType(part) || isConstrainedType(part)
    || (isCollection(part, checker) && !isReadOnlyForm(part)));
}

/** Whether a type is the library's read-only form of an array, a set or a map, whose members give no way to change what it holds. */
function isReadOnlyForm(type: ts.Type): boolean {
  const name = type.getSymbol()?.name;
  return name === "ReadonlyArray" || name === "ReadonlySet" || name === "ReadonlyMap";
}

/** The name of a function a library declares on Object or Reflect, as "Object.assign" or "Reflect.set", or undefined for any other. */
function libraryMemberName(declaration: ts.SignatureDeclaration): string | undefined {
  const name = declaration.name;
  if (name === undefined || !ts.isIdentifier(name)) return undefined;
  const owner = declaration.parent;
  if (ts.isInterfaceDeclaration(owner) && owner.name.text === "ObjectConstructor") return `Object.${name.text}`;
  return ts.isModuleBlock(owner) && ts.isIdentifier(owner.parent.name) && owner.parent.name.text === "Reflect" ? `Reflect.${name.text}` : undefined;
}

/**
 * The changes copying one source into a target makes. Each property of an
 * object literal written in place gives its key its value, or its method,
 * and a spread in it gives each key of what it spreads; an accessor gives
 * what no rule reads. Any other source gives each of its keys, as a "copy"
 * write. A spread of sources hides which is which, so it is unread.
 */
function copiedChanges(target: ts.Expression, source: ts.Expression, at: ts.Node, checker: ts.TypeChecker): Change[] {
  if (ts.isSpreadElement(source)) return [{ receiver: target, write: { kind: "unread" }, at }];
  const literal = heldValue(source);
  if (literal === undefined || !ts.isObjectLiteralExpression(literal)) return [{ receiver: target, write: { kind: "copy", source }, at }];
  return literal.properties.map((property): Change => {
    if (ts.isSpreadAssignment(property)) return { receiver: target, write: { kind: "copy", source: property.expression }, at };
    if (ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) return { receiver: target, write: { kind: "unread" }, at };
    const value = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : property;
    const key = propertyKey(property.name, checker);
    return { receiver: target, write: { kind: "value", keys: key === undefined ? undefined : [key], value }, at };
  });
}

/**
 * The changes a property descriptor makes to a key: the value its `value`
 * property names, written in an object literal in place. A getter, a
 * setter, a key not known, or a descriptor not written so gives what no
 * rule reads.
 */
function describedChanges(target: ts.Expression, keys: readonly string[] | undefined, descriptor: ts.Expression | undefined, at: ts.Node): Change[] {
  const literal = heldValue(descriptor);
  if (literal === undefined || !ts.isObjectLiteralExpression(literal)) return [{ receiver: target, write: { kind: "unread" }, at }];
  return literal.properties.flatMap((property): Change[] => {
    const name = property.name !== undefined && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ? property.name.text : undefined;
    if (name === "value" && ts.isPropertyAssignment(property)) return [{ receiver: target, write: { kind: "value", keys, value: property.initializer }, at }];
    if (name === "value" && ts.isShorthandPropertyAssignment(property)) return [{ receiver: target, write: { kind: "value", keys, value: property.name }, at }];
    if (name === "value" && ts.isMethodDeclaration(property)) return [{ receiver: target, write: { kind: "value", keys, value: property }, at }];
    return name === "get" || name === "set" || name === undefined ? [{ receiver: target, write: { kind: "unread" }, at }] : [];
  });
}

/** What code gives a container after it is made, as `writtenTo` finds it. */
interface Written extends Contents {
  /** Whether items may have moved to other positions, so that a position read may hold any item. */
  moved: boolean;
}

/** The containers whose copied keys are being read, so that two containers copied into each other are read once. */
const COPIES_BEING_READ = new Set<ts.Node>();

/**
 * What code written in the program gives a container after it is made, for
 * one key, or for every key and item when no key is given: each value a
 * change placed on the container gives that key, any key or a new item;
 * each value a copied value holds under that key, as `copiedValues` reads
 * it; whether a change may move its items; and the first change no rule
 * reads, if any. A change kept unplaced counts for the container when the
 * container's type fits its receiver's, as `mayReach` says. For one side of
 * a class, only a change made through that side counts, or one whose side
 * is not known.
 *
 * @param side The side of a class read, or undefined for every side.
 */
function writtenTo(container: Container, key: string | undefined, checker: ts.TypeChecker, side?: ClassSide): Written {
  const table = writeTable(checker, container);
  const placed = (table.placed.get(container) ?? []).filter((change) => side === undefined || change.side === undefined || change.side === side);
  const changes = [...placed, ...table.unplaced.filter(({ type }) => mayReach(type, container, checker, side)).map(({ change }) => change)];
  const found: Written = { values: [], unread: null, moved: false };
  for (const { write, at } of changes) {
    if (write.kind === "value") {
      if (key === undefined || write.keys === undefined || write.keys.includes(key)) found.values.push(write.value);
    } else if (write.kind === "copy") {
      const copied = copiedValues(write.source, key, checker);
      found.values.push(...copied.values);
      found.unread ??= copied.unread;
    } else if (write.kind === "moved") {
      found.moved = true;
    } else {
      found.unread ??= at;
    }
  }
  return found;
}

/**
 * What each container a copied value may be holds under one key, or under
 * every key: the properties an object literal gives it, as
 * `keyedProperties` reads them, and what any other container holds, as
 * `placeContents` finds it. A copied value that may hold a function and is
 * no container gives what no rule reads.
 */
function copiedValues(source: ts.Expression, key: string | undefined, checker: ts.TypeChecker): Contents {
  const found: Contents = { values: [], unread: null };
  const reach = placesOf(source, checker, new Set());
  if ((reach.unknown || reach.empty) && mayHoldFunction(checker.getTypeAtLocation(source), checker, source)) found.unread = source;
  for (const container of reach.containers) {
    if (COPIES_BEING_READ.has(container)) continue;
    COPIES_BEING_READ.add(container);
    try {
      if (key !== undefined && ts.isObjectLiteralExpression(container)) {
        const keyed = keyedProperties(container, key, checker);
        found.values.push(...keyed.holders.map(heldBy));
        found.unread ??= keyed.unknownAfter;
      } else {
        const held = placeContents(container, checker, new Set());
        found.values.push(...held.values);
        found.unread ??= held.unread;
      }
    } finally {
      COPIES_BEING_READ.delete(container);
    }
  }
  return found;
}

/**
 * Whether a change whose receiver may be no container may reach one: its
 * receiver's type takes the container's type, widened as a name declared
 * with it would be, so that a parameter typed `Boxer[]` may be any array of
 * such functions. A class is read by the type of its instances, by the type
 * of the class itself, or by either when no side is given.
 *
 * @param side The side of a class read, or undefined for every side.
 */
function mayReach(type: ts.Type, container: Container, checker: ts.TypeChecker, side?: ClassSide): boolean {
  if (!ts.isClassLike(container)) return checker.isTypeAssignableTo(checker.getWidenedType(checker.getTypeAtLocation(container)), type);
  const symbol = container.name === undefined ? undefined : checker.getSymbolAtLocation(container.name);
  if (symbol === undefined) return false;
  const instance = side !== "static" && checker.isTypeAssignableTo(checker.getDeclaredTypeOfSymbol(symbol), type);
  return instance || (side !== "instance" && checker.isTypeAssignableTo(checker.getTypeOfSymbol(symbol), type));
}

/**
 * What code gives a member of an object literal or a class besides what its
 * declaration and each assignment to its name give it: each value
 * `writtenTo` finds given its key, as `declaredValues` reads it, and the
 * member read as well, as unread, where a change no rule reads may reach
 * it. A member of a class is given what changes made through its own side
 * give: a static member those made through the class, and any other member
 * those made through an instance. A member of anything else, or with a key
 * not known, is given nothing more here.
 */
function memberWrites(value: ts.Identifier | ts.PropertyAccessExpression, declaration: ts.Declaration, checker: ts.TypeChecker, seen: Set<ts.Node>): DeclaredValue[] {
  const owner = ts.isParameter(declaration) ? declaration.parent.parent : declaration.parent;
  const name = ts.getNameOfDeclaration(declaration);
  if (name === undefined || owner === undefined || !(ts.isObjectLiteralExpression(owner) || ts.isClassLike(owner))) return [];
  const key = ts.isPrivateIdentifier(name) ? name.text : ts.isPropertyName(name) ? propertyKey(name, checker) : undefined;
  const side: ClassSide | undefined = ts.isClassLike(owner) ? isStatic(declaration) ? "static" : "instance" : undefined;
  return key === undefined ? [] : readContents(writtenTo(owner, key, checker, side), value, checker, seen);
}

/**
 * What a member that no declaration names is given, as one an index
 * signature gives is: what its key gives in each object literal the value
 * it is read from may be, as `keyedValues` reads it, and the member read as
 * well, as unread, for each value it is read from that is not one.
 */
function unnamedMemberValues(value: ts.PropertyAccessExpression, checker: ts.TypeChecker, seen: Set<ts.Node>): DeclaredValue[] {
  return declaredValues(value.expression, checker, seen)
    .flatMap((literal) => ts.isObjectLiteralExpression(literal) ? keyedValues(literal, value.name.text, value, checker, seen) : [value]);
}

/**
 * Whether a variable or class field declared with no value is given one by
 * code written here, as an assignment or a for-of gives it, which no rule
 * reads. A name written under `declare` is given none here, and a `catch`
 * clause's name is given what was thrown, which its declared type describes.
 */
function isGivenLater(declaration: ts.VariableDeclaration | ts.PropertyDeclaration | ts.PropertyAssignment | ts.BindingElement): boolean {
  const root = ts.isBindingElement(declaration) ? ts.walkUpBindingElementsAndPatterns(declaration) : declaration;
  return !isAmbient(root) && !ts.isParameter(root) && !ts.isCatchClause(root.parent);
}

/** Whether a declaration is written under `declare`, its own or that of a statement or namespace around it, or in a declaration file. */
function isAmbient(declaration: ts.Node): boolean {
  if (declaration.getSourceFile().isDeclarationFile) return true;
  return ts.findAncestor(declaration, (node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) !== undefined;
}

/**
 * What a name bound by destructuring is given where it is written: what
 * `readBinding` finds it takes in each literal the value destructured is
 * given, as `declaredValues` reads that value, so that a pattern that
 * reads the value of a call of a function written here reads the literal
 * the function returns, and each default. The name read is given back as
 * well, as unread, when no rule can read all it may take: when what is
 * destructured has no initializer and `isGivenLater` finds code here gives
 * it a value, as a for-of does; or when the name may take its value from
 * something not written as a literal, from a part of a literal whose key or
 * position is not known, or from a literal that gives it no value a pattern
 * reads, as a get accessor does, or when what a parameter is destructured
 * from is unread, as `passedValues` reads it. A value not written here, as
 * a library's call is not, is read by its declared type alone, as
 * `namedValues` reads it. A callback's parameter that a library gives a
 * value, as `handingCall` finds, is given what the library builds from what
 * it is handed, as `Object.entries` builds pairs: each object or array
 * literal it is handed is read as any other, and each value handed that is
 * no such literal may be the name's value wherever its type fits the name's.
 */
function destructuredValues(value: ts.Identifier | ts.PropertyAccessExpression, declaration: ts.BindingElement, checker: ts.TypeChecker,
  seen: Set<ts.Node>): DeclaredValue[] {
  const name = declaration.name;
  if (!ts.isIdentifier(name)) return [value];
  const root = ts.walkUpBindingElementsAndPatterns(declaration);
  const passed = ts.isParameter(root) ? passedValues(root, checker, seen)
    : { values: root.initializer === undefined ? [] : declaredValues(root.initializer, checker, seen), unread: false };
  const given = passed.values;
  const handed = ts.isParameter(root) && handingCall(root.parent, checker) !== undefined;
  const literals = given.filter((one): one is ts.Expression => ts.isExpression(one) && (!handed || isLiteralContainer(one)));
  // Each default is read once, whatever the value destructured is.
  const readings = literals.length === 0 ? [readBinding(root.name, undefined, checker)] : literals.map((literal) => readBinding(root.name, literal, checker));
  const taken = readings.flatMap((reading) => reading.bound).filter((each) => each.name === name)
    .flatMap(({ value: one }) => ts.isMethodDeclaration(one) ? [one] : declaredValues(one, checker, seen));
  const built = handed ? given.filter((one) => !isLiteralContainer(one) && fitsResult(checker.getTypeAtLocation(one), checker.getTypeAtLocation(name), checker)) : [];
  const unknown = readings.some((reading) => [...reading.opaque, ...reading.unknown.map((position) => position.name)].includes(name));
  const untaken = taken.length === 0 && built.length === 0 && literals.some(isLiteralContainer);
  const later = root.initializer === undefined && isGivenLater(declaration);
  const unread = passed.unread || later || unknown || untaken || (!handed && given.some((one) => !ts.isExpression(one)));
  return unread ? [...taken, ...built, value] : [...taken, ...built];
}

/** Whether a value is an object literal or an array literal. */
function isLiteralContainer(value: DeclaredValue): boolean {
  return ts.isObjectLiteralExpression(value) || ts.isArrayLiteralExpression(value);
}

/** What a parameter is given, as `passedValues` reads it. */
interface Passed {
  /** Each value its default, or an argument a call passes it, may be. */
  values: DeclaredValue[];
  /** Whether a caller may give it a value no rule reads. */
  unread: boolean;
}

/**
 * What a parameter is given: each value its default may be, and each value
 * of the argument at its position in every call of its function that
 * `callsOf` finds, as `declaredValues` reads them. What a caller gives is
 * read where the caller writes it, so a wrapper handed to a function is
 * read as the wrapper it is. A callback a library calls, as `handingCall`
 * finds it, is given what `handedValues` finds the library is handed. Where
 * no rule can find every call, as for a function that no code here calls,
 * one handed on as a value, or a method, or where a spread at or before its
 * position hides which argument it takes, or where it is a rest parameter
 * or `this`, a caller may give it anything its type allows, so it is unread.
 */
function passedValues(parameter: ts.ParameterDeclaration, checker: ts.TypeChecker, seen: Set<ts.Node>): Passed {
  const values = parameter.initializer === undefined ? [] : declaredValues(parameter.initializer, checker, seen);
  const owner = parameter.parent;
  const handing = handingCall(owner, checker);
  if (handing !== undefined) {
    const handed = handedValues(handing, checker, seen);
    return { values: [...values, ...handed.values], unread: handed.unread };
  }
  const at = owner.parameters.filter((each) => !ts.isIdentifier(each.name) || each.name.text !== "this").indexOf(parameter);
  const calls = at < 0 || parameter.dotDotDotToken !== undefined ? undefined : callsOf(owner, checker);
  if (calls === undefined) return { values, unread: true };
  let unread = false;
  for (const call of calls) {
    const given = call.arguments ?? [];
    const argument = given[at];
    if (given.slice(0, at + 1).some(ts.isSpreadElement)) {
      unread = true;
    } else if (argument !== undefined) {
      values.push(...declaredValues(argument, checker, seen));
    }
  }
  return { values, unread };
}

/**
 * The call of a library function that a function is handed to as a
 * callback: written in place as an argument, through any wrapper
 * `heldValue` looks through, at a parameter `isCallbackParameter` finds the
 * library calls.
 *
 * @returns The call, or undefined when the function is none such.
 */
function handingCall(owner: ts.SignatureDeclaration, checker: ts.TypeChecker): ts.CallExpression | ts.NewExpression | undefined {
  if (!ts.isArrowFunction(owner) && !ts.isFunctionExpression(owner)) return undefined;
  const outer = outerValue(owner);
  const call = outer.parent;
  if ((!ts.isCallExpression(call) && !ts.isNewExpression(call)) || !isLibraryCall(call, checker)) return undefined;
  const invocation = invocationOf(call, checker);
  const at = invocation.args.findIndex((argument) => argument === outer);
  const parameter = at < 0 || invocation.declaration === undefined ? undefined : parameterOf(invocation.declaration, invocation.args, at);
  return parameter !== undefined && isCallbackParameter(parameter, checker) ? call : undefined;
}

/**
 * What a library function may give a callback it calls. It has nothing to
 * give but what it is handed and what it makes itself, which its declared
 * types describe: each value each of the values `librarySources` lists
 * holds, as `reachedContents` finds it, and each value its callbacks
 * return, as `callbackResults` reads them, which a callback such as the one
 * `reduce` takes is given back. What no rule reads in either leaves the
 * parameter unread.
 */
function handedValues(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker, seen: Set<ts.Node>): Passed {
  const handed: Passed = { values: [], unread: false };
  for (const source of librarySources(call, checker)) {
    const reached = reachedContents(source, checker, seen);
    handed.values.push(...readContents({ values: reached.values, unread: null }, source, checker, seen));
    handed.unread ||= reached.unread !== null;
  }
  const returned = callbackResults(call, checker, seen);
  handed.values.push(...readContents({ values: returned.values, unread: null }, call, checker, seen));
  handed.unread ||= returned.unread !== null;
  return handed;
}

/** The calls found of each function, for each checker, or undefined where they cannot all be found. */
const CALLS = new WeakMap<ts.TypeChecker, Map<ts.Node, ReadonlyArray<ts.CallExpression | ts.NewExpression> | undefined>>();

/**
 * Every call of a function, in each file of its program, when every one can
 * be found: each use of the name it is called by, as `usesOf` finds them,
 * through an import alias, is a call or `new` of it, through any wrapper
 * `heldValue` looks through, or an import, an export, or a `typeof`, none of
 * which calls it. The name is that of a function declaration, of the class
 * whose constructor it is, or of the variable an arrow or function
 * expression is the value of.
 *
 * @returns The calls; undefined when the function has no such name, as a
 *     method or a callback has not, or a use of it hands it on as a value,
 *     as `f.call` or `[f]` does, or nothing here calls it, so that what a
 *     caller gives cannot be read.
 */
function callsOf(owner: ts.SignatureDeclaration, checker: ts.TypeChecker): ReadonlyArray<ts.CallExpression | ts.NewExpression> | undefined {
  const known = CALLS.get(checker) ?? new Map<ts.Node, ReadonlyArray<ts.CallExpression | ts.NewExpression> | undefined>();
  CALLS.set(checker, known);
  if (known.has(owner)) return known.get(owner);
  const named = calledByName(owner);
  const calls: Array<ts.CallExpression | ts.NewExpression> = [];
  let readable = named !== undefined;
  for (const use of named === undefined ? [] : usesOf(named, checker)) {
    if (use === ts.getNameOfDeclaration(named) || isAliasOrType(use)) continue;
    const call = calledAt(use);
    if (call === undefined) {
      readable = false;
    } else {
      calls.push(call);
    }
  }
  const found = readable && calls.length > 0 ? calls : undefined;
  known.set(owner, found);
  return found;
}

/**
 * The declaration whose name a function is called by: a function
 * declaration itself, the class declaration whose constructor it is, or the
 * variable an arrow or function expression is the value of, through any
 * wrapper `heldValue` looks through.
 *
 * @returns The declaration, or undefined for any other function, such as a
 *     method or a callback handed to a call.
 */
function calledByName(owner: ts.SignatureDeclaration): ts.FunctionDeclaration | ts.ClassDeclaration | ts.VariableDeclaration | undefined {
  if (ts.isFunctionDeclaration(owner)) return owner.name === undefined ? undefined : owner;
  if (ts.isConstructorDeclaration(owner)) return ts.isClassDeclaration(owner.parent) && owner.parent.name !== undefined ? owner.parent : undefined;
  if (!ts.isArrowFunction(owner) && !ts.isFunctionExpression(owner)) return undefined;
  const outer = outerValue(owner);
  const holder = outer.parent;
  return ts.isVariableDeclaration(holder) && holder.initializer === outer && ts.isIdentifier(holder.name) ? holder : undefined;
}

/** Whether a use of a name imports it, exports it, or reads its type with `typeof`, none of which calls it or hands it on. */
function isAliasOrType(use: ts.Node): boolean {
  const parent = use.parent;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)
    || ts.isImportEqualsDeclaration(parent) || ts.isExportAssignment(parent)) return true;
  let named: ts.Node = use;
  while (ts.isQualifiedName(named.parent)) {
    named = named.parent;
  }
  return ts.isTypeQueryNode(named.parent);
}

/** The call, or `new`, a use of a name is the function of, through a namespace and any wrapper `heldValue` looks through, or undefined when it is not one. */
function calledAt(use: ts.Node): ts.CallExpression | ts.NewExpression | undefined {
  const outer = outerValue(memberRead(use));
  const parent = outer.parent;
  return (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === outer ? parent : undefined;
}

/**
 * Whether a function's body, or the default of one of its parameters,
 * passes on the value of one of its parameters: uses a name the parameter
 * binds anywhere but as the function a call calls. A use inside a function
 * nested in the body counts, since that function may pass it on. A
 * constructor's parameter written as a property, with an accessibility
 * modifier or `readonly`, passes its value on to the instance, which holds
 * it as that property, though the body never names it.
 */
function passesOn(declaration: ts.SignatureDeclaration, parameter: ts.ParameterDeclaration, checker: ts.TypeChecker): boolean {
  if (ts.isParameterPropertyDeclaration(parameter, parameter.parent)) return true;
  const symbols = new Set(boundNames(parameter.name).map((name) => checker.getSymbolAtLocation(name)));
  const body = bodyOf(declaration);
  const pending: ts.Node[] = declaration.parameters.flatMap((each) => each.initializer ?? []);
  if (body !== undefined) pending.push(body);
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (ts.isIdentifier(node) && symbols.has(referencedSymbol(node, checker)) && !isCalledWhereWritten(node)) return true;
    ts.forEachChild(node, (child) => {
      pending.push(child);
    });
  }
  return false;
}

/**
 * The symbol a name refers to where it is used. The name of a shorthand
 * property, as in `{ reader }`, refers to the variable whose value it takes,
 * not to the property it makes.
 */
function referencedSymbol(name: ts.Identifier, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (ts.isShorthandPropertyAssignment(name.parent) && name.parent.name === name) return checker.getShorthandAssignmentValueSymbol(name.parent);
  return checker.getSymbolAtLocation(name);
}

/** The types the checker cannot narrow, so that a value of one may be anything: any, unknown and object. */
const OPEN_TYPES = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.NonPrimitive;

/** Whether a type is one the checker cannot narrow, as OPEN_TYPES names them. */
function isOpenType(type: ts.Type): boolean {
  return (type.flags & OPEN_TYPES) !== 0;
}

/** The types whose values are those of their constraint: a type parameter, and a type built from one. */
const CONSTRAINED_TYPES = ts.TypeFlags.TypeParameter | ts.TypeFlags.IndexedAccess | ts.TypeFlags.Conditional | ts.TypeFlags.Substitution;

/** Whether a type is one whose values are those of its constraint, as CONSTRAINED_TYPES names them. */
function isConstrainedType(type: ts.Type): boolean {
  return (type.flags & CONSTRAINED_TYPES) !== 0;
}

/**
 * Whether a value of a type may be a function: the type can be called or
 * constructed, or a function may be given where it is declared, as for any,
 * unknown, object, a type parameter with no narrower constraint, or an
 * object type that asks for nothing a function lacks, such as `{}`. A
 * union may be one when any of its parts may; an intersection when it can
 * be called, or each of its parts may. A string, a number, an array, or an
 * object that asks for a property a function lacks cannot be.
 */
function mayBeFunction(type: ts.Type, checker: ts.TypeChecker, location: ts.Node): boolean {
  if (type.flags & OPEN_TYPES) return true;
  if (type.flags & CONSTRAINED_TYPES) {
    const constraint = checker.getBaseConstraintOfType(type);
    return constraint === undefined || constraint === type || mayBeFunction(constraint, checker, location);
  }
  if (type.isUnion()) return type.types.some((part) => mayBeFunction(part, checker, location));
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return true;
  if (type.isIntersection()) return type.types.every((part) => mayBeFunction(part, checker, location));
  if (!(type.flags & ts.TypeFlags.Object) || checker.isArrayType(type) || checker.isTupleType(type)) return false;
  // A function has no index signature, so it is given where one is declared only when that signature takes anything.
  if (checker.getIndexInfosOfType(type).some((index) => !(index.type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)))) return false;
  const members = functionMembers(checker, location);
  return checker.getPropertiesOfType(type).every((property) => (property.flags & ts.SymbolFlags.Optional) !== 0 || members.has(property.name));
}

/** The names of the members every function has, from the global Function and Object interfaces, read once for each checker. */
const FUNCTION_MEMBERS = new WeakMap<ts.TypeChecker, ReadonlySet<string>>();

/**
 * The names of the members every function has, as the checker's own
 * libraries declare them on the Function and Object interfaces.
 *
 * @param location A node of a file the checker read, where the global interfaces are in scope.
 * @throws An `Error` when the checker's libraries do not declare both
 *     interfaces, since no type could then be read as a function.
 */
function functionMembers(checker: ts.TypeChecker, location: ts.Node): ReadonlySet<string> {
  const known = FUNCTION_MEMBERS.get(checker);
  if (known !== undefined) return known;
  const interfaces = checker.getSymbolsInScope(location, ts.SymbolFlags.Interface).filter((symbol) => symbol.name === "Function" || symbol.name === "Object");
  if (interfaces.length !== 2) throw new Error(`the libraries declare ${interfaces.length} of the Function and Object interfaces, not both`);
  const members = new Set(interfaces.flatMap((symbol) => checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol)).map((property) => property.name)));
  FUNCTION_MEMBERS.set(checker, members);
  return members;
}

/**
 * Whether a value of a type may hold a function where a destructuring, a
 * member or `await` can reach it: a property, an index signature or an item
 * whose value may be a function or hold one, or what a promise gives. A
 * call signature makes no such place, so a function holds nothing. A type
 * the checker cannot narrow may hold anything, so it may; a part of a union
 * or intersection that may is enough.
 *
 * @param seen The types read already, so that a type that holds itself is read once.
 */
function mayHoldFunction(type: ts.Type, checker: ts.TypeChecker, location: ts.Node, seen = new Set<ts.Type>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (type.flags & OPEN_TYPES) return true;
  if (type.flags & CONSTRAINED_TYPES) {
    const constraint = checker.getBaseConstraintOfType(type);
    return constraint === undefined || constraint === type || mayHoldFunction(constraint, checker, location, seen);
  }
  if (type.isUnionOrIntersection()) return type.types.some((part) => mayHoldFunction(part, checker, location, seen));
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  // A promise's methods belong to every promise; what it gives is what it holds.
  const awaited = checker.getAwaitedType(type);
  if (awaited !== undefined && awaited !== type) return mayBeOrHoldFunction(awaited, checker, location, seen);
  const indexed = checker.getIndexInfosOfType(type).some((index) => mayBeOrHoldFunction(index.type, checker, location, seen));
  // An array's methods belong to every array; only its items, which its index gives, are what it holds.
  if (checker.isArrayType(type) || checker.isTupleType(type)) return indexed;
  return indexed || checker.getPropertiesOfType(type).some((property) => mayBeOrHoldFunction(checker.getTypeOfSymbol(property), checker, location, seen));
}

/** Whether a value of a type may be a function, as `mayBeFunction` says, or hold one, as `mayHoldFunction` says. */
function mayBeOrHoldFunction(type: ts.Type, checker: ts.TypeChecker, location: ts.Node, seen = new Set<ts.Type>()): boolean {
  return mayBeFunction(type, checker, location) || mayHoldFunction(type, checker, location, seen);
}

/**
 * The parameter of a declaration that one of a call's arguments, as
 * `invocationOf` lists them, is passed to, reading a rest parameter for each
 * argument from its position on.
 *
 * @returns The parameter, or undefined when a spread at or before the
 *     argument hides which parameter it is passed to, or there is none.
 */
function parameterOf(declaration: ts.SignatureDeclaration, args: readonly ts.Expression[], at: number): ts.ParameterDeclaration | undefined {
  if (args.slice(0, at + 1).some(ts.isSpreadElement)) return undefined;
  const parameters = declaration.parameters.filter((parameter) => !ts.isIdentifier(parameter.name) || parameter.name.text !== "this");
  const last = parameters.at(-1);
  if (last?.dotDotDotToken !== undefined && at >= parameters.length - 1) return last;
  return parameters[at];
}

/**
 * Whether a parameter's declared type uses, outside any function type, a
 * type parameter its signature can use, its own or its interface's or
 * class's, that the signature's declared result uses too, outside any
 * function type.
 */
function sharesTypeParameter(declaration: ts.SignatureDeclaration, parameter: ts.ParameterDeclaration): boolean {
  if (parameter.type === undefined || declaration.type === undefined) return false;
  const usable = typeParametersInScope(declaration);
  const result = typeNamesOutsideFunctions(declaration.type);
  return [...typeNamesOutsideFunctions(parameter.type)].some((name) => usable.has(name) && result.has(name));
}

/**
 * The names of the type parameters a declaration can use: its own, and those
 * of each declaration it sits in, such as its interface or class.
 */
function typeParametersInScope(declaration: ts.Node): Set<string> {
  const names = new Set<string>();
  for (let node: ts.Node | undefined = declaration; node !== undefined; node = node.parent) {
    for (const typeParameter of declaredTypeParameters(node)) {
      names.add(typeParameter.name.text);
    }
  }
  return names;
}

/** The type parameters a node declares itself, none when it declares none. */
function declaredTypeParameters(node: ts.Node): readonly ts.TypeParameterDeclaration[] {
  if (ts.isClassLike(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return node.typeParameters ?? [];
  return ts.isFunctionLike(node) ? node.typeParameters ?? [] : [];
}

/**
 * Each name a type refers to by a type reference, outside any function type
 * within it, and "this" when it uses the polymorphic `this` type there.
 */
function typeNamesOutsideFunctions(type: ts.TypeNode): Set<string> {
  const names = new Set<string>();
  const pending: ts.Node[] = [type];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (ts.isFunctionLike(node)) continue;
    if (ts.isThisTypeNode(node)) names.add("this");
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
 * Each value a function declared here with a body may return: each value,
 * as `possibleValues` reads it, of one of its return statements or of its
 * expression body. Each function is read once for a call, however many of
 * the call's arguments ask.
 *
 * @param read The values read so far for the call, by function, which this adds to.
 * @returns The values, or undefined when the function's body is being read already, so that a function that calls itself is read once.
 */
function returnedValues(declaration: ts.SignatureDeclaration, checker: ts.TypeChecker, following: ReadonlySet<ts.Node>,
  read: Map<ts.SignatureDeclaration, ts.Expression[] | undefined>): ts.Expression[] | undefined {
  if (read.has(declaration)) return read.get(declaration);
  const deeper = new Set([...following, declaration]);
  const values = following.has(declaration) ? undefined : returnedExpressions(declaration).flatMap((returned) => possibleValues(returned, checker, deeper));
  read.set(declaration, values);
  return values;
}

/**
 * Whether a function may return one of its parameters: whether one of the
 * values `returnedValues` found it may return is that parameter's name. A
 * function whose body is being read already returns none of them.
 */
function returnsParameter(parameter: ts.ParameterDeclaration, values: readonly ts.Expression[] | undefined, checker: ts.TypeChecker): boolean {
  if (values === undefined || !ts.isIdentifier(parameter.name)) return false;
  const symbol = checker.getSymbolAtLocation(parameter.name);
  return values.some((value) => ts.isIdentifier(value) && checker.getSymbolAtLocation(value) === symbol);
}

/**
 * Whether every value `returnedValues` found a function may return is
 * written there new: a function, an object literal or an array literal,
 * none of which is a value its caller gave it. A body with no return gives
 * back nothing. A function whose body is being read already may return
 * anything.
 */
function returnsOnlyNewValues(values: readonly ts.Expression[] | undefined): boolean {
  // The values that are never falsy are the values written new.
  return values !== undefined && values.every(isAlwaysTruthy);
}

/**
 * The expressions a function may return: its expression body, or the value
 * of each return statement of its own, not of a function nested in it.
 *
 * @returns Each expression, none when the declaration has no body.
 */
function returnedExpressions(declaration: ts.SignatureDeclaration): ts.Expression[] {
  const body = bodyOf(declaration);
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

/** The body of a declaration that is written with one, or undefined for a signature, a declared function or a type. */
function bodyOf(declaration: ts.SignatureDeclaration): ts.ConciseBody | undefined {
  return (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isConstructorDeclaration(declaration)
    || ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration) || ts.isFunctionExpression(declaration)
    || ts.isArrowFunction(declaration)) ? declaration.body : undefined;
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
  return { source, checker: checkerOf(program) };
}

/**
 * The checker of a program, recorded in PROGRAM_SOURCES with the files of
 * the program written here, so that every call and assignment the program
 * holds can be found.
 */
function checkerOf(program: ts.Program): ts.TypeChecker {
  const checker = program.getTypeChecker();
  if (!PROGRAM_SOURCES.has(checker)) {
    PROGRAM_SOURCES.set(checker, program.getSourceFiles().filter((file) => !file.isDeclarationFile && !program.isSourceFileFromExternalLibrary(file)));
  }
  return checker;
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
  return { source, checker: checkerOf(program) };
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
 * The function a command shim runs: the one whose result, awaited or not, it
 * passes to `process.exit` in a statement at the top level. The function is
 * called by its name, or through a namespace import as in `cli.runCli()` or
 * `cli["runCli"]()`. The call to `process.exit`, its argument, the call in
 * it, `process.exit` itself, the function, the member, its key and the
 * namespace are each read through any wrapper `heldValue` looks through,
 * such as parentheses and `satisfies`, and a member is read by its name or
 * by a key written as a string literal.
 *
 * @returns The function's name as its module exports it, through any import
 *     alias, or null when no such call is found. A method of anything but a
 *     namespace import is not a function of the module, and gives null.
 */
function shimEntryPoint(file: string, text: string): string | null {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    const exit = ts.isExpressionStatement(statement) ? heldValue(statement.expression) : undefined;
    if (exit === undefined || !ts.isCallExpression(exit)) continue;
    const exiting = heldValue(exit.expression);
    const owner = exiting === undefined ? undefined : memberReceiver(exiting);
    if (exiting === undefined || memberName(exiting) !== "exit" || owner === undefined || !isNamed(owner, "process")) continue;
    const call = awaitedValue(exit.arguments[0]);
    if (call === undefined || !ts.isCallExpression(call)) continue;
    const callee = heldValue(call.expression);
    if (callee !== undefined && ts.isIdentifier(callee)) return importedNames(source).get(callee.text) ?? callee.text;
    const member = callee === undefined ? undefined : memberName(callee);
    const namespace = callee === undefined ? undefined : heldValue(memberReceiver(callee));
    if (member !== undefined && namespace !== undefined && ts.isIdentifier(namespace) && namespaceImports(source).has(namespace.text)) return member;
  }
  return null;
}

/** The value an expression awaits or holds, through each `await` and each wrapper `heldValue` looks through, in any order. */
function awaitedValue(expression: ts.Expression | undefined): ts.Expression | undefined {
  let inner = heldValue(expression);
  while (inner !== undefined && ts.isAwaitExpression(inner)) {
    inner = heldValue(inner.expression);
  }
  return inner;
}

/**
 * The name of the member an expression reads: a property's name, or a key
 * written as a string literal, through any wrapper `heldValue` looks through;
 * undefined for anything else.
 */
function memberName(expression: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  const key = ts.isElementAccessExpression(expression) ? heldValue(expression.argumentExpression) : undefined;
  return key !== undefined && ts.isStringLiteralLike(key) ? key.text : undefined;
}

/** Whether an expression is the given name, through any wrapper `heldValue` looks through. */
function isNamed(expression: ts.Expression, name: string): boolean {
  const inner = heldValue(expression);
  return inner !== undefined && ts.isIdentifier(inner) && inner.text === name;
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
 * whose value cannot be read is reported as such, saying why, when its type
 * may be a function, as `mayBeFunction` reads it.
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
    const declaration = helperDeclaration(node, checker);
    if (declaration === null) continue;
    const reading = readBinding(declaration.name, declaration.initializer, checker);
    for (const name of new Set(helperNames(reading, checker))) {
      found.push(`${file} / ${enclosingFunctionName(name, source)} / ${name.text}`);
    }
    for (const { name, cause } of possibleFunctions(reading.unknown, checker)) {
      found.push(`${file} / ${enclosingFunctionName(name, source)} / ${name.text}: ${unknownReason(cause, source)}, so what it holds cannot be read`);
    }
  }
  return found;
}

/**
 * The names whose value cannot be read that may still be a function, as
 * `mayBeFunction` reads their type. A name whose type cannot be one, such as
 * a number, a string, an array, or an object that asks for a property a
 * function lacks, binds no function, so it is no helper, whatever the value
 * it binds holds.
 */
function possibleFunctions(unknown: readonly UnknownPosition[], checker: ts.TypeChecker): UnknownPosition[] {
  return unknown.filter(({ name }) => mayBeFunction(checker.getTypeAtLocation(name), checker, name));
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
function helperDeclaration(node: ts.Node, checker: ts.TypeChecker): ts.ParameterDeclaration | ts.VariableDeclaration | null {
  if (ts.isParameter(node)) return isDocumentedParameter(node, checker) ? null : node;
  return ts.isVariableDeclaration(node) && ts.findAncestor(node, ts.isFunctionLike) !== undefined ? node : null;
}

/**
 * Whether a parameter is named by an `@param` tag of its function's comment,
 * or of the comment on any overload signature of its function. A comment is
 * read wherever the throws check reads it: each the compiler attaches, and
 * each `ownJsDocs` finds on the function or its signatures, or on what
 * holds or binds the function, as `documentationOf` finds it, so that one
 * on the line of the brace before a method, or before another comment,
 * counts. Only a parameter with a name of its own can be named.
 */
function isDocumentedParameter(parameter: ts.ParameterDeclaration, checker: ts.TypeChecker): boolean {
  const name = parameter.name;
  if (!ts.isIdentifier(name)) return false;
  const owner = parameter.parent;
  const signatures = ts.isFunctionDeclaration(owner) || ts.isMethodDeclaration(owner) || ts.isConstructorDeclaration(owner) ? overloadSignatures(owner) : [];
  const documentation = isWrittenFunction(owner) ? documentationOf(climb(owner, checker), owner.getSourceFile()) : null;
  const commented = documentation === null ? signatures : [...signatures, documentation.commented];
  const written = commented.flatMap(ownJsDocs).flatMap((comment) => comment.tags ?? []).filter(ts.isJSDocParameterTag);
  return [...ts.getJSDocParameterTags(parameter), ...written].some((tag) => ts.isIdentifier(tag.name) && tag.name.text === name.text);
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
  /**
   * Each name a pattern reads from a value that is not an object or array
   * literal, such as a call or a name, which a binding does not read
   * through, so that `namedValues` follows it where it is written.
   */
  opaque: ts.Identifier[];
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
  reading: Reading = { bound: [], unknown: [], untaken: [], rested: [], unread: [], opaque: [] }, offset = 0): Reading {
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
  // A call whose value may hold a function written in its arguments cannot be read as a literal can, nor can a member of it, so no name
  // either gives can be read, unless a rest element's name binds what is left.
  if (!ts.isMethodDeclaration(literal) && (element.dotDotDotToken === undefined || !ts.isIdentifier(element.name)) && isReadFromHoldingCall(literal, checker)) {
    reading.unknown.push(...boundNames(element.name).map((name) => ({ name, cause: literal })));
    return;
  }
  if (element.dotDotDotToken !== undefined) {
    // A rest element with a name binds what is left as an object or array; one with a pattern reads the items left.
    if (!ts.isIdentifier(element.name) && ts.isArrayLiteralExpression(literal)) readBinding(element.name, literal, checker, reading, offset + at);
    return;
  }
  if (!ts.isArrayLiteralExpression(literal) && !ts.isObjectLiteralExpression(literal)) reading.opaque.push(...boundNames(element.name));
  const source = elementSource(pattern, element, at, literal, checker, offset);
  const cause = source.unknownAfter;
  if (cause !== null) reading.unknown.push(...boundNames(element.name).map((name) => ({ name, cause })));
  for (const holder of source.holders) {
    readBinding(element.name, heldBy(holder), checker, reading);
  }
}

/**
 * Whether a value is a call whose value may hold a function written in its
 * arguments, as `callValues` finds, or is read from one through members, as
 * `wrap(reader).value` and `wrap(reader).get()` are read from `wrap(reader)`.
 */
function isReadFromHoldingCall(value: ts.Expression, checker: ts.TypeChecker): boolean {
  if ((ts.isCallExpression(value) || ts.isNewExpression(value)) && callValues(value, checker, NOTHING_FOLLOWED).held.some(writesFunction)) return true;
  const inner = ts.isCallExpression(value) ? heldValue(value.expression) : value;
  if (inner === undefined || (!ts.isPropertyAccessExpression(inner) && !ts.isElementAccessExpression(inner))) return false;
  const receiver = heldValue(inner.expression);
  return receiver !== undefined && isReadFromHoldingCall(receiver, checker);
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
  const { items, unknownAfter, after } = spreadItems(literal, checker);
  const placed = writtenTo(literal, String(at), checker);
  // An item code moved may now be at any position, and so may one written to a position not known.
  const written = placed.moved ? writtenTo(literal, undefined, checker) : placed;
  const known = (written.moved ? items : [items[at]]).filter((item): item is ts.Expression => item !== undefined);
  const later = at < items.length && !written.moved ? null : unknownAfter;
  const following = later === null ? undefined : followingItems(literal, after, checker);
  if (following !== undefined) return { holders: [...known, ...following, ...written.values], unknownAfter: written.unread };
  return { holders: [...known, ...written.values], unknownAfter: written.unread ?? later };
}

/**
 * Each item that may sit at a position after a spread whose length is not
 * known: each item iterating each spread among the elements after it gives,
 * as `iteratedContents` finds them, and each item written after it. Where
 * a spread's value is not written here, or gives what no rule reads, which
 * position each item sits at cannot be read.
 *
 * @param after The spread, and each element written after it at any depth, as `spreadItems` lists them.
 * @returns The items, or undefined when they cannot all be read.
 */
function followingItems(literal: ts.ArrayLiteralExpression, after: readonly ts.Node[], checker: ts.TypeChecker): WrittenValue[] | undefined {
  const items: WrittenValue[] = [];
  for (const node of after) {
    if (ts.isOmittedExpression(node) || !ts.isExpression(node)) continue;
    if (!ts.isSpreadElement(node)) {
      items.push(node);
      continue;
    }
    const spread = iteratedContents(node.expression, itemType(literal, checker), checker, new Set());
    if (!spread.reached || spread.unread !== null) return undefined;
    items.push(...spread.values);
  }
  return items;
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
      const spreads = spreadLiterals(property.expression, checker);
      if (spreads === undefined) {
        found.unknownAfter = property;
        continue;
      }
      const inner = spreads.map((spread) => keyedProperties(spread, key, checker));
      found.holders.push(...inner.flatMap((each) => each.holders));
      // A key an inner literal gives is settled there, unless something inside one that may give any key comes later.
      if (inner.some((each) => each.holders.length > 0 || each.unknownAfter !== null)) found.unknownAfter = inner.find((each) => each.unknownAfter !== null)?.unknownAfter ?? null;
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
  const written = writtenTo(literal, key, checker);
  found.holders.push(...written.values);
  if (written.unread !== null) found.unknownAfter = written.unread;
  return found;
}

/**
 * The object literals a value spread into an object literal may be: the
 * value itself when it is one, or, for a name or a member, each value
 * `declaredValues` finds it may be, when every one is an object literal.
 *
 * @returns The literals, or undefined when a value it may be is no object literal, or none is written here.
 */
function spreadLiterals(spread: ts.Expression, checker: ts.TypeChecker): ts.ObjectLiteralExpression[] | undefined {
  const single = singleValue(spread, checker);
  if (single !== undefined && ts.isObjectLiteralExpression(single)) return [single];
  const values = declaredValues(spread, checker, new Set());
  return values.length > 0 && values.every(ts.isObjectLiteralExpression) ? values.filter(ts.isObjectLiteralExpression) : undefined;
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
  if (UNREAD_CHANGES.has(cause)) return `it is read from a value that ${text} changes in a way no rule reads`;
  if (ts.isSpreadElement(cause)) return `its position follows ${text}, whose length is not known`;
  if (ts.isSpreadAssignment(cause)) return `its key may be given by ${text}, whose keys are not known`;
  if (ts.isComputedPropertyName(cause) && ts.isBindingElement(cause.parent)) return `its key, ${text}, is not known`;
  if (ts.isComputedPropertyName(cause)) return `its key may be given by ${text}, whose value is not known`;
  if (ts.isCallExpression(cause) || ts.isNewExpression(cause)) return `it is read from ${text}, a call whose value may hold a function`;
  if (ts.isPropertyAccessExpression(cause) || ts.isElementAccessExpression(cause)) return `it is read from ${text}, a member of a call whose value may hold a function`;
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
 * documented statement binds whose value cannot be read, and whose type may
 * be a function, is reported as such, after the others.
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
 * read, so that the throws check cannot read what it binds, and that by
 * its type may be a function or hold one.
 */
function documentedUnknownPositions(source: ts.SourceFile, checker: ts.TypeChecker): DocumentedUnknownPosition[] {
  const found: DocumentedUnknownPosition[] = [];
  const pending: ts.Node[] = [source];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    pending.push(...[...node.getChildren(source)].reverse());
    if (!ts.isVariableStatement(node) || !hasJsDoc(node)) continue;
    for (const declaration of node.declarationList.declarations) {
      found.push(...possibleFunctions(readBinding(declaration.name, declaration.initializer, checker).unknown, checker).map((position) => ({ ...position, commented: node })));
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
 * the comment on the class field that holds the function, on the parameter
 * whose default it is or that destructures it, or on the statement that
 * binds the function to a name or assigns it. One comment and one name make
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
  // A statement that assigns the function documents it, as the compiler reads that comment for the function, whatever wraps the assignment.
  const sink = climbed.sink;
  const assigning = ts.isBinaryExpression(sink) ? assigningStatement(sink) : undefined;
  if (climbed.holder === undefined && ts.isBinaryExpression(sink) && assigning !== undefined && hasJsDoc(assigning)) {
    return { commented: assigning, name: assignedTargetName(sink.left, source) };
  }
  const place = climbed.place;
  // A parameter's own comment documents the function it is given by default, or that a name it destructures takes.
  if (place.kind === "bound" && ts.isParameter(place.declaration) && hasJsDoc(place.declaration)) return { commented: place.declaration, name };
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

/**
 * The name the throws check gives a function an assignment stores: the key
 * of the property it is assigned to, or the name.
 */
function assignedTargetName(target: ts.Expression, source: ts.SourceFile): string {
  const inner = heldValue(target) ?? target;
  if (ts.isPropertyAccessExpression(inner)) return inner.name.text;
  if (!ts.isElementAccessExpression(inner)) return inner.getText(source);
  const key = inner.argumentExpression;
  return ts.isStringLiteralLike(key) ? key.text : key.getText(source);
}

/**
 * The JSDoc comments of a node's own, not those it would inherit from a
 * statement around it: each comment `writtenComments` finds just before it,
 * whether or not the compiler attaches it. The compiler attaches every JSDoc
 * comment written before a declaration, but its API gives only the last of
 * them, so a tag in an earlier one would be lost. It attaches none to an
 * item of an array literal but a function or parentheses, and none written
 * on the line of the token before a property, a class member or a
 * statement, such as the brace that opens the literal or class.
 */
function ownJsDocs(node: ts.Node): ts.JSDoc[] {
  return writtenComments(node);
}

/**
 * The JSDoc comments written just before a node: each comment in the form of
 * JSDoc, opening with two asterisks, that the scanner reports after the token
 * before the node, on that line or the lines after it, as the compiler finds
 * the comments of a function. These include every comment the compiler
 * attaches to the node itself, which it finds in the same place.
 */
function writtenComments(node: ts.Node): ts.JSDoc[] {
  const text = node.getSourceFile().text;
  const ranges = [...ts.getTrailingCommentRanges(text, node.pos) ?? [], ...ts.getLeadingCommentRanges(text, node.pos) ?? []];
  return ranges.filter((range) => text.startsWith("/**", range.pos) && !text.startsWith("/**/", range.pos))
    .flatMap((range) => parsedComment(text.slice(range.pos, range.end)));
}

/** A JSDoc comment's text parsed as the compiler parses one on a statement, so that its tags can be read. */
function parsedComment(comment: string): ts.JSDoc[] {
  const parsed = ts.createSourceFile("comment.ts", `${comment}\nconst documented = 0;\n`, ts.ScriptTarget.Latest, true);
  return parsed.statements.flatMap((statement) => ts.getJSDocCommentsAndTags(statement).filter(ts.isJSDoc));
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
    const taker = takingCall(top, checker);
    // `apply` gives back an item of the list it hands on as a call gives back an argument.
    if (taker !== undefined && taker !== parent && possibleValues(taker, checker).some((one) => one === value)) {
      path.push(...nodesUpTo(parent, taker));
      top = taker;
      continue;
    }
    // A call whose value may hold what it is given holds the function, or the literal that holds it, as a literal does.
    if (taker !== undefined && callValues(taker, checker, NOTHING_FOLLOWED).held.some((one) => one === value)) {
      path.push(...nodesUpTo(parent, taker));
      value = taker;
      top = taker;
      continue;
    }
    if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === top) {
      const member = memberStep(parent, written, checker);
      if (member.place !== undefined) return { path, holder, sink: parent, place: member.place };
      path.push(...member.steps);
      value = member.target;
      top = member.target;
      continue;
    }
    if (taker !== undefined) return { path, holder, sink: taker, place: argumentPlace(taker, top, checker) };
    const holding = holdingLiteral(parent, top);
    if (holding === undefined) return { path, holder, sink: parent, place: sinkPlace(parent, top, written, value === written, checker) };
    holder ??= holding.holder;
    path.push(...holding.steps);
    value = holding.literal;
    top = holding.literal;
  }
}

/**
 * The call, or `new`, that a value is handed to: the node above it, when the
 * value is not the function that node calls, or the call whose `apply`
 * hands on the items of the array literal above it, through any wrapper
 * `heldValue` looks through.
 */
function takingCall(top: ts.Node, checker: ts.TypeChecker): ts.CallExpression | ts.NewExpression | undefined {
  const parent = top.parent;
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression !== top) return parent;
  if (!ts.isArrayLiteralExpression(parent)) return undefined;
  let outer: ts.Node = parent;
  while (ts.isExpression(outer.parent) && heldValue(outer.parent) === parent) {
    outer = outer.parent;
  }
  const call = outer.parent;
  return ts.isCallExpression(call) && invocationOf(call, checker).list === parent ? call : undefined;
}

/** Each node from one node up to an ancestor of it, both included, the innermost first. */
function nodesUpTo(from: ts.Node, ancestor: ts.Node): ts.Node[] {
  const nodes = [from];
  for (let node = from; node !== ancestor; node = node.parent) {
    nodes.push(node.parent);
  }
  return nodes;
}

/**
 * The place of a function handed to a call, or `new`, that neither gives it
 * back nor holds it. One that a parameter of the function that runs takes,
 * as `invocationOf` lists the arguments, is on the allowed list. One handed
 * on where no parameter takes it, or where a spread hides which parameter
 * takes it, cannot be read.
 */
function argumentPlace(call: ts.CallExpression | ts.NewExpression, top: ts.Node, checker: ts.TypeChecker): Place {
  const invocation = invocationOf(call, checker);
  const at = invocation.args.findIndex((argument) => argument === top);
  if (at < 0) {
    return unplaced("it is handed to a call where no parameter takes it, as the this of call, apply or bind, or a value bind keeps, so what is done with it cannot be read");
  }
  if (invocation.declaration === undefined || parameterOf(invocation.declaration, invocation.args, at) === undefined) {
    return unplaced("it is handed to a call after a spread, or past its last parameter, so what the call does with it cannot be read");
  }
  return position("an argument to a call that does not give it back");
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

/** Where a member of a value that holds a function takes it: to a place, or on, held by the member or by the call of it. */
interface MemberStep {
  /** The place the function ends in, or undefined when the member, or the call of it, holds it and is followed on. */
  place: Place | undefined;
  /** The member, or the call of it, that holds the function. */
  target: ts.Expression;
  /** The nodes the value passes through to reach the target. */
  steps: ts.Node[];
}

/**
 * Where a member of a value that holds a function, or of the function
 * itself, takes the function. A member, or a call of a method, whose value
 * may be the function fails, since no rule reads a function read back out.
 * One whose declared type uses neither the receiver nor a type parameter the
 * receiver's type can use, and whose type has no place that may be or hold
 * a function, as `mayBeOrHoldFunction` reads it, is not the function and
 * holds none, as `expect(check).toThrow()` returns nothing. Any other may
 * hold the function, as `[...].map(...)` gives an array and a member typed
 * `{ reader: () => number }` may be an object holding it, and is followed on.
 */
function memberStep(access: ts.PropertyAccessExpression | ts.ElementAccessExpression, written: ts.FunctionLikeDeclaration, checker: ts.TypeChecker): MemberStep {
  const call = ts.isCallExpression(access.parent) && access.parent.expression === access ? access.parent : undefined;
  const target = call ?? access;
  const steps = call === undefined ? [access] : [access, call];
  if (fitsResult(checker.getTypeAtLocation(written), checker.getTypeAtLocation(target), checker)) {
    return { place: unplaced("it is read back out of a value that holds it, which no rule reads"), target, steps };
  }
  const declaration = call === undefined ? checker.getSymbolAtLocation(ts.isPropertyAccessExpression(access) ? access.name : access.argumentExpression)?.declarations?.[0] : calledDeclaration(call, checker);
  const type = declaration !== undefined && (ts.isFunctionLike(declaration) || ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration)) ? declaration.type : undefined;
  if (declaration === undefined || type === undefined) return { place: undefined, target, steps };
  const usable = typeParametersInScope(declaration);
  const uses = [...typeNamesOutsideFunctions(type)].some((name) => name === "this" || usable.has(name));
  const holds = mayBeOrHoldFunction(checker.getTypeAtLocation(target), checker, target);
  return { place: uses || holds ? undefined : position("a member of a value that holds it, which by its declared type is not the function"), target, steps };
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
 * A pattern that reads a value that is not a literal, such as a call that
 * holds the function, cannot tell which name takes it. It fails when a name
 * it binds may be a function by its type; otherwise the function is held in
 * a value a name binds, when a name may hold one, or taken by no name.
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
  // A value that is not a literal, such as a call that holds the function, cannot be read, so a name that may be a function may be this one.
  const names = boundNames(declaration.name);
  if (names.some((name) => mayBeFunction(checker.getTypeAtLocation(name), checker, name))) {
    return unplaced("its destructuring reads it from a value that is not a literal, such as a call that holds it, which no rule can read");
  }
  const holding = names.some((name) => mayHoldFunction(checker.getTypeAtLocation(name), checker, name));
  return position(holding ? "held in a value bound to a name" : "a part of a literal no name takes");
}

/**
 * The place of a function whose value an assignment takes: a property it is
 * stored on, or the object or array a name holds, or the name, inside a
 * function, as a nested helper the rules read.
 */
function assignedPlace(assignment: ts.BinaryExpression, direct: boolean): Place {
  const target = heldValue(assignment.left);
  const alone = assigningStatement(assignment) !== undefined;
  if (alone && target !== undefined && (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))) return position("stored on a property");
  if (alone && target !== undefined && ts.isIdentifier(target)) {
    if (!direct) return position("held in a value bound to a name");
    if (ts.findAncestor(assignment, ts.isFunctionLike) !== undefined) return { kind: "bound", name: target, declaration: assignment };
    return unplaced(`it is assigned to ${target.text} at the top level of the module, which the entry-point rule does not read`);
  }
  return unplaced("it is assigned by a destructuring, or by an assignment whose value is used as well, a place the allowed list does not name");
}

/**
 * The statement an assignment is on its own, through any wrapper `heldValue`
 * looks through, as in `(box.read = reader);`, none of which uses its value.
 *
 * @returns The statement, or undefined when the assignment's value is used.
 */
function assigningStatement(assignment: ts.BinaryExpression): ts.ExpressionStatement | undefined {
  let outer: ts.Node = assignment;
  while (ts.isExpression(outer.parent) && heldValue(outer.parent) === assignment) {
    outer = outer.parent;
  }
  return ts.isExpressionStatement(outer.parent) ? outer.parent : undefined;
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
  const siblings = siblingsOf(implementation);
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

/** The members of the class, or the statements of the block or file, that a declaration sits among; none elsewhere. */
function siblingsOf(declaration: OverloadableFunction): readonly ts.Node[] {
  const parent = declaration.parent;
  if (ts.isClassLike(parent)) return parent.members;
  return ts.isSourceFile(parent) || ts.isBlock(parent) || ts.isModuleBlock(parent) ? parent.statements : [];
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
