import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");

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
//    lint-rules.test.ts. A property holding an arrow is left alone: it is a
//    value handed on, most often a stand-in for a dependency.
// 4. Throw only Error. A value that is not an Error carries no message and no
//    stack to the person who meets it. The lint rule
//    "@typescript-eslint/only-throw-error" refuses a thrown value typed any or
//    unknown, and a caught value may still be thrown on. RULE_EXCEPTIONS in
//    eslint.config.mjs names the one file that may throw a value typed
//    unknown: scripts/tests/traffic-snapshot.test.ts, whose tests stand in
//    for code outside this project. Probed in lint-rules.test.ts.
//
// eslint.config.mjs also records the eight lint rules that ESLint 11.0.0
// removes, beside the rules themselves.
//
// As with the lint rules, these checks catch accidents. A comment that names
// what a function throws and is wrong is left to review.
describe("the code skill's rules for this repository's own code", () => {
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
      const run = shimEntryPoint(shim, readFileSync(join(REPOSITORY_ROOT, shim), "utf8"));
      const first = firstFunction(ts.createSourceFile(module, readFileSync(join(REPOSITORY_ROOT, module), "utf8"), ts.ScriptTarget.Latest, true));
      if (run === null || first === null || run !== first.name) {
        problems.push(`${shim} runs ${run ?? "(no exit call)"}, but ${module} leads with ${first?.name ?? "(no function)"}`);
      }
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

  test("a shim's entry point is the function whose result it exits with", () => {
    expect(shimEntryPoint("probe-cli.ts", "import { runCli } from \"./probe.ts\";\nprocess.exit(runCli(process.argv));")).toBe("runCli");
    expect(shimEntryPoint("probe-cli.ts", "process.exit(await runCli(process.argv));")).toBe("runCli");
    expect(shimEntryPoint("probe-cli.ts", "runCli(process.argv);")).toBeNull();
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
 * A function is a function declaration, or a constant whose value is an arrow
 * function or a function expression.
 */
function entryPointProblem(file: string, text: string): EntryPoint {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const first = firstFunction(source);
  if (first === null) return { checked: false, problem: null };
  if (first.exported || exportedByList(source).has(first.name)) return { checked: true, problem: null };
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
function firstFunction(source: ts.SourceFile): FirstFunction | null {
  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement)
      && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      return { name: statement.name.text, exported, statement };
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && functionValue(declaration.initializer) !== null) {
        return { name: declaration.name.text, exported, statement };
      }
    }
  }
  return null;
}

/**
 * The function an expression holds, looking through parentheses, a type
 * assertion and `satisfies`, which change nothing that runs.
 *
 * @returns The arrow function or function expression, or null when the
 *     expression holds neither, or is undefined.
 */
function functionValue(expression: ts.Expression | undefined): ts.ArrowFunction | ts.FunctionExpression | null {
  let inner = expression;
  while (inner !== undefined && (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner)
    || ts.isSatisfiesExpression(inner) || ts.isTypeAssertionExpression(inner) || ts.isNonNullExpression(inner))) {
    inner = inner.expression;
  }
  return inner !== undefined && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) ? inner : null;
}

/** The local names a module exports through `export { name }` lists. */
function exportedByList(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      names.add((element.propertyName ?? element.name).text);
    }
  }
  return names;
}

/**
 * The function a command shim runs: the one whose result, awaited or not, it
 * passes to `process.exit` at the top level.
 *
 * @returns The function's name, or null when no such call is found.
 */
function shimEntryPoint(file: string, text: string): string | null {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const exit = statement.expression;
    if (exit.expression.getText(source) !== "process.exit") continue;
    const argument = exit.arguments[0];
    const call = argument !== undefined && ts.isAwaitExpression(argument) ? argument.expression : argument;
    if (call !== undefined && ts.isCallExpression(call) && ts.isIdentifier(call.expression)) return call.expression.text;
  }
  return null;
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
 * accessor, or a variable, an object property or a class field whose value
 * is an arrow function or a function expression. A throw counts when it can leave the function: not inside a
 * nested function, and not inside a `try` block whose `catch` takes it.
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
  }
  return found;
}

/** The node as a documented function, or null when it is not one. */
function asDocumentedFunction(node: ts.Node, source: ts.SourceFile): DocumentedFunction | null {
  if (!ts.getJSDocCommentsAndTags(node).some((comment) => ts.isJSDoc(comment))) return null;
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body !== undefined) {
    return { name: node.name?.getText(source) ?? "constructor", commented: node, body: node.body };
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
  return null;
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
