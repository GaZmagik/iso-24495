import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");

// The guide says to end every statement with a semicolon. The lint rule
// "semi" holds that for the statements JavaScript has, and passes over the
// ones only TypeScript has: it accepts "export type Value = number" with none.
// typescript-eslint 8 has no rule for it, since it moved its formatting rules
// out, and the package that took them is not a dependency here. So this test
// holds the statements the lint rule passes over.
//
// Each is a statement the parser ends at a semicolon when one is written. The
// check is a function of one file's text, so a test can hand it a breach and
// require a report. As with the lint rules, these catch accidents.
describe("every statement that only TypeScript has ends with a semicolon", () => {
  test("in every TypeScript file", () => {
    let checked = 0;
    const missing: string[] = [];
    for (const file of typescriptFiles()) {
      const found = unendedStatements(file, readFileSync(join(REPOSITORY_ROOT, file), "utf8"));
      checked += found.checked;
      missing.push(...found.missing);
    }
    expect(missing).toEqual([]);
    // A walk that read nothing would find nothing missing, so the count must
    // be the size a walk of this repository gives.
    expect(checked).toBeGreaterThanOrEqual(14);
  });

  test("each kind with no semicolon is reported, and with one is not", () => {
    const kinds: Array<[kind: string, unended: string, ended: string]> = [
      ["a type alias", "export type Value = number", "export type Value = number;"],
      ["a type alias", "export type Shape = { size: number }", "export type Shape = { size: number };"],
      ["a class property", "export class A {\n  size = 1\n}", "export class A {\n  size = 1;\n}"],
      ["a class property", "export abstract class A {\n  abstract size: number\n}", "export abstract class A {\n  abstract size: number;\n}"],
      ["a method with no body", "export abstract class A {\n  abstract make(): number\n}", "export abstract class A {\n  abstract make(): number;\n}"],
      ["a function with no body", "export declare function made(): number", "export declare function made(): number;"],
      ["a class index signature", "export class A {\n  [key: string]: number\n}", "export class A {\n  [key: string]: number;\n}"],
      ["an export assignment", "export = value", "export = value;"],
      ["an import alias", "import fs = require(\"node:fs\")", "import fs = require(\"node:fs\");"],
    ];
    for (const [kind, unended, ended] of kinds) {
      const line = unended.startsWith("export class") || unended.startsWith("export abstract") ? 2 : 1;
      expect(unendedStatements("probe.ts", unended), unended).toEqual({ checked: 1, missing: [`probe.ts:${line}: ${kind} has no semicolon`] });
      expect(unendedStatements("probe.ts", ended), ended).toEqual({ checked: 1, missing: [] });
    }
  });

  test.each([
    ["a constructor with no body", "export declare class A {\n  constructor(size: number)\n}"],
    ["a getter with no body", "export declare class A {\n  get value(): string\n}"],
    ["a setter with no body", "export declare class A {\n  set value(text: string)\n}"],
    ["a getter with no body", "export abstract class A {\n  abstract get value(): string\n}"],
    ["a setter with no body", "export abstract class A {\n  abstract set value(text: string)\n}"],
  ])("%s, in %p, is reported with no semicolon, and not with one", (kind, unended) => {
    const ended = unended.replace("\n}", ";\n}");
    expect(unendedStatements("probe.ts", unended)).toEqual({ checked: 1, missing: [`probe.ts:2: ${kind} has no semicolon`] });
    expect(unendedStatements("probe.ts", ended)).toEqual({ checked: 1, missing: [] });
  });

  test("a constructor, getter or setter with a body needs none, and is not counted", () => {
    const withBodies = "export class A {\n  constructor() {\n    this.size = 1;\n  }\n\n  size: number;\n\n  get value(): number {\n    return this.size;\n  }\n\n  set value(size: number) {\n    this.size = size;\n  }\n}";
    // Only the property counts: it is the one member here that needs a semicolon.
    expect(unendedStatements("probe.ts", withBodies)).toEqual({ checked: 1, missing: [] });
  });

  test("a function or method with a body needs none, and is not counted", () => {
    expect(unendedStatements("probe.ts", "export function made(): number {\n  return 1;\n}")).toEqual({ checked: 0, missing: [] });
    expect(unendedStatements("probe.ts", "export class A {\n  make(): number {\n    return 1;\n  }\n}")).toEqual({ checked: 0, missing: [] });
  });
});

/** What the semicolon check found in one file. */
interface SemicolonCount {
  /** How many statements of the kinds the lint rule passes over the file holds. */
  checked: number;
  /** One "file:line: kind has no semicolon" entry for each that has none. */
  missing: string[];
}

/** The kind of statement a node is, where the lint rule passes over it, or null. */
function kindOf(node: ts.Node): string | null {
  if (ts.isTypeAliasDeclaration(node)) return "a type alias";
  if (ts.isPropertyDeclaration(node)) return "a class property";
  if (ts.isMethodDeclaration(node) && node.body === undefined) return "a method with no body";
  // A class that is declared, or an abstract member, may also leave out the
  // body of a constructor, a getter or a setter.
  if (ts.isConstructorDeclaration(node) && node.body === undefined) return "a constructor with no body";
  if (ts.isGetAccessorDeclaration(node) && node.body === undefined) return "a getter with no body";
  if (ts.isSetAccessorDeclaration(node) && node.body === undefined) return "a setter with no body";
  if (ts.isFunctionDeclaration(node) && node.body === undefined) return "a function with no body";
  if (ts.isIndexSignatureDeclaration(node) && ts.isClassLike(node.parent)) return "a class index signature";
  if (ts.isExportAssignment(node)) return "an export assignment";
  if (ts.isImportEqualsDeclaration(node)) return "an import alias";
  return null;
}

/**
 * Every statement in one file, of a kind the lint rule passes over, whose
 * last token is not a semicolon.
 */
function unendedStatements(file: string, text: string): SemicolonCount {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const missing: string[] = [];
  let checked = 0;
  const visit = (node: ts.Node): void => {
    const kind = kindOf(node);
    if (kind !== null) {
      checked += 1;
      if (node.getLastToken(source)?.kind !== ts.SyntaxKind.SemicolonToken) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        missing.push(`${file}:${line}: ${kind} has no semicolon`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { checked, missing };
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
    if (UNREAD_DIRECTORIES.has(entry)) {
      continue;
    }
    const path = directory === "" ? entry : `${directory}/${entry}`;
    if (statSync(join(REPOSITORY_ROOT, path)).isDirectory()) {
      files.push(...typescriptFiles(path));
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files.sort();
}
