import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { itemAt } from "../../skills/iso-24495-4/scripts/lib/item-at.ts";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");

/** Every kind of statement or member the check reads, as its reports name it. */
const KINDS = [
  "a type alias",
  "a class property",
  "a method with no body",
  "a constructor with no body",
  "a getter with no body",
  "a setter with no body",
  "a function with no body",
  "a class index signature",
  "an export assignment",
  "a global export of a module",
  "a module with no body",
  "an import alias",
  "a property signature",
  "a method signature",
  "a call signature",
  "a construct signature",
  "an index signature",
  "a mapped type",
];

/**
 * A pinned text that leaves out the semicolon of each kind in `KINDS` once.
 * The repository holds no example of some kinds, so the walk of its files
 * alone would pass with their detectors broken.
 */
const SWEEP_BREACHES = [
  "type Alias = number",
  "declare class Declared {",
  "  size: number",
  "  [key: string]: unknown",
  "  constructor(size: number)",
  "  get value(): string",
  "  set value(text: string)",
  "  make(): number",
  "}",
  "declare function made(): number",
  "interface Members {",
  "  x: number",
  "  f(): void",
  "  (): void",
  "  new(): object",
  "  [key: string]: unknown",
  "}",
  "type Mapped = {",
  "  [K in \"x\"]: number",
  "};",
  "declare module \"example\"",
  "import fs = require(\"node:fs\")",
  "export as namespace Library",
  "export = fs",
].join("\n");

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

    // The same reading of a pinned text must report every kind, so a detector
    // that stops working fails this walk and names its kind.
    const reported = unendedStatements("breaches.ts", SWEEP_BREACHES).missing
      .map((entry) => entry.replace(/^breaches\.ts:\d+: (.+) has no semicolon$/, "$1"));
    expect([...new Set(reported)].sort()).toEqual([...KINDS].sort());
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

  test.each([
    ["a global export of a module", "export as namespace Library"],
    ["a module with no body", "declare module \"example\""],
  ])("%s, in %p, is reported with no semicolon, and not with one", (kind, unended) => {
    const ended = `${unended};`;
    expect(unendedStatements("probe.ts", unended)).toEqual({ checked: 1, missing: [`probe.ts:1: ${kind} has no semicolon`] });
    expect(unendedStatements("probe.ts", ended)).toEqual({ checked: 1, missing: [] });
  });

  // A type alias here ends in its own semicolon, so it is counted and passes.
  test.each([
    ["a method signature", "export interface I {\n  f(): void\n}", 1],
    ["a method signature", "export type T = {\n  f(): void\n};", 2],
    ["a method signature", "export declare interface I {\n  f(): void\n}", 1],
    ["a call signature", "export interface I {\n  (): void\n}", 1],
    ["a call signature", "export type T = {\n  (): void\n};", 2],
    ["a construct signature", "export interface I {\n  new(): object\n}", 1],
    ["a construct signature", "export type T = {\n  new(): object\n};", 2],
    ["an index signature", "export interface I {\n  [key: string]: number\n}", 1],
    ["an index signature", "export type T = {\n  [key: string]: number\n};", 2],
    ["an index signature", "export declare interface I {\n  [key: string]: number\n}", 1],
  ])("%s, in %p, is reported with no semicolon, and not with one", (kind, unended, checked) => {
    const ended = unended.replace("\n}", ";\n}");
    expect(unendedStatements("probe.ts", unended)).toEqual({ checked, missing: [`probe.ts:2: ${kind} has no semicolon`] });
    expect(unendedStatements("probe.ts", ended)).toEqual({ checked, missing: [] });
  });

  // A property signature in a multi-line interface, type literal or ambient
  // interface, the optional form among them.
  test.each([
    ["a property signature", "export interface I {\n  x: number\n}", 1],
    ["a property signature", "export interface I {\n  x?: number\n}", 1],
    ["a property signature", "export type T = {\n  x: number\n};", 2],
    ["a property signature", "export declare interface I {\n  x: number\n}", 1],
    ["a property signature", "export function f(shape: {\n  x: number\n}): number {\n  return shape.x;\n}", 1],
  ])("%s, in %p, is reported with no semicolon, and not with one", (kind, unended, checked) => {
    const ended = unended.replace("number\n}", "number;\n}");
    expect(unendedStatements("probe.ts", unended)).toEqual({ checked, missing: [`probe.ts:2: ${kind} has no semicolon`] });
    expect(unendedStatements("probe.ts", ended)).toEqual({ checked, missing: [] });
  });

  test("in a multi-line interface or type literal, every member needs its semicolon, the last included", () => {
    expect(unendedStatements("probe.ts", "export interface I {\n  host: string;\n  port: number;\n}")).toEqual({ checked: 2, missing: [] });
    expect(unendedStatements("probe.ts", "export interface I {\n  host: string;\n  port: number\n}"))
      .toEqual({ checked: 2, missing: ["probe.ts:3: a property signature has no semicolon"] });
    // Braces on different lines make the body multi-line, even with a member beside the first.
    expect(unendedStatements("probe.ts", "export interface I { host: string\n}"))
      .toEqual({ checked: 1, missing: ["probe.ts:1: a property signature has no semicolon"] });
  });

  test("a comma between members of a multi-line type literal is reported", () => {
    expect(unendedStatements("probe.ts", "export type T = {\n  host: string,\n  port: number;\n};"))
      .toEqual({ checked: 3, missing: ["probe.ts:2: a property signature has no semicolon"] });
  });

  test("an inline literal is not reported, whatever separates its members, and the alias around it still needs its semicolon", () => {
    const inline = [
      "export interface I { host: string, port: number }",
      "export interface I { host: string; port: number }",
      "export interface I { host: string, port: number, }",
      "export interface I { host: string; port: number; }",
      "export declare interface I { x?: number }",
      "export interface I { f(): void, (): void, new(): object, [key: string]: unknown }",
      "export function f(address: string): { host: string, port: number } {\n  return { host: address, port: 1 };\n}",
    ];
    for (const text of inline) {
      expect(unendedStatements("probe.ts", text), text).toEqual({ checked: 0, missing: [] });
    }
    // The alias around an inline literal still needs its own semicolon.
    expect(unendedStatements("probe.ts", "export type T = { host: string, port: number };")).toEqual({ checked: 1, missing: [] });
    expect(unendedStatements("probe.ts", "export type T = { host: string, port: number }"))
      .toEqual({ checked: 1, missing: ["probe.ts:1: a type alias has no semicolon"] });
  });

  test("an inline literal inside a multi-line one is read by its own braces", () => {
    expect(unendedStatements("probe.ts", "export interface I {\n  address: { host: string, port: number };\n}")).toEqual({ checked: 1, missing: [] });
    expect(unendedStatements("probe.ts", "export interface I {\n  address: { host: string, port: number }\n}"))
      .toEqual({ checked: 1, missing: ["probe.ts:2: a property signature has no semicolon"] });
  });

  test("a mapped type with no semicolon before its closing brace is reported, and with one is not", () => {
    const unended = "export type T = {\n  [K in \"x\"]: number\n};";
    expect(unendedStatements("probe.ts", unended)).toEqual({ checked: 2, missing: ["probe.ts:1: a mapped type has no semicolon"] });
    expect(unendedStatements("probe.ts", unended.replace("number\n", "number;\n"))).toEqual({ checked: 2, missing: [] });
  });

  // By the owner's ruling, a comma is reported only in a multi-line interface
  // or type literal. This test once said a comma was always reported.
  test("a member of a multi-line interface that ends in a comma is reported", () => {
    const comma = "export interface I {\n  f(): void,\n  g(): void;\n}";
    expect(unendedStatements("probe.ts", comma)).toEqual({ checked: 2, missing: ["probe.ts:2: a method signature has no semicolon"] });
  });

  test("an interface, a type literal or a mapped type ends in a brace, and needs no semicolon itself", () => {
    expect(unendedStatements("probe.ts", "export interface I {\n  f(): void;\n}")).toEqual({ checked: 1, missing: [] });
    expect(unendedStatements("probe.ts", "export declare interface I {\n  (): void;\n  new(): object;\n}")).toEqual({ checked: 2, missing: [] });
    expect(unendedStatements("probe.ts", "export function f(shape: {\n  g(): void;\n}): void {\n  shape.g();\n}")).toEqual({ checked: 1, missing: [] });
  });

  test("a module with a body needs no semicolon, and is not counted", () => {
    expect(unendedStatements("probe.ts", "declare module \"example\" {\n  export const value: number;\n}")).toEqual({ checked: 0, missing: [] });
    expect(unendedStatements("probe.ts", "declare namespace Space {\n  const value: number;\n}")).toEqual({ checked: 0, missing: [] });
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
  if (ts.isNamespaceExportDeclaration(node)) return "a global export of a module";
  // The short form of an ambient module, declare module "name", has no body.
  if (ts.isModuleDeclaration(node) && node.body === undefined) return "a module with no body";
  if (ts.isImportEqualsDeclaration(node)) return "an import alias";
  // Members of an interface or a type literal. The compiler takes a comma
  // after one as well as a semicolon. By the owner's ruling, a member of a
  // multi-line interface or type literal ends in a semicolon, and a comma
  // there is reported, while an inline literal is not read: see
  // inInlineLiteral.
  if (ts.isPropertySignature(node)) return "a property signature";
  if (ts.isMethodSignature(node)) return "a method signature";
  if (ts.isCallSignatureDeclaration(node)) return "a call signature";
  if (ts.isConstructSignatureDeclaration(node)) return "a construct signature";
  if (ts.isIndexSignatureDeclaration(node)) return "an index signature";
  // The one member of a mapped type ends before its closing brace.
  if (ts.isMappedTypeNode(node)) return "a mapped type";
  return null;
}

/**
 * Whether a node is a member of an inline literal: an interface or type
 * literal whose opening and closing braces are on one line, as in
 * `{host: string, port: number}`. The guide writes such members with commas,
 * and with nothing after the last, so by the owner's ruling none needs a
 * semicolon and the check passes them over.
 */
function inInlineLiteral(node: ts.Node, source: ts.SourceFile): boolean {
  const container = node.parent;
  if (!ts.isTypeElement(node) || !(ts.isInterfaceDeclaration(container) || ts.isTypeLiteralNode(container))) {
    return false;
  }
  const braces = container.getChildren(source).filter((child) => child.kind === ts.SyntaxKind.OpenBraceToken || child.kind === ts.SyntaxKind.CloseBraceToken);
  // A type literal is its braces; an interface holds them as two of its tokens.
  const open = ts.isTypeLiteralNode(container) ? container.getStart(source) : itemAt(braces, 0).getStart(source);
  const close = ts.isTypeLiteralNode(container) ? container.getEnd() - 1 : itemAt(braces, braces.length - 1).getStart(source);
  return source.getLineAndCharacterOfPosition(open).line === source.getLineAndCharacterOfPosition(close).line;
}

/**
 * Whether a node of a kind the check reads ends in a semicolon. A mapped type
 * ends in its closing brace, so its semicolon is the one inside the braces.
 */
function endsInSemicolon(node: ts.Node, source: ts.SourceFile): boolean {
  if (ts.isMappedTypeNode(node)) {
    return node.getChildren(source).some((child) => child.kind === ts.SyntaxKind.SemicolonToken);
  }
  return node.getLastToken(source)?.kind === ts.SyntaxKind.SemicolonToken;
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
    if (kind !== null && !inInlineLiteral(node, source)) {
      checked += 1;
      if (!endsInSemicolon(node, source)) {
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
