import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");

// Rules of the Google TypeScript Style Guide that no lint rule here can state.
// Three are about comments, and a syntax selector sees no comment: every
// top-level export of a module has a JSDoc comment, no JSDoc comment states a
// type, and no JSDoc comment carries a tag that a TypeScript keyword already
// states. The fourth is that a source file is UTF-8, and no lint rule reads
// bytes.
//
// Each check is a function of one file's text, so a test can hand it a breach
// and require a report. As with the lint rules, these catch accidents. A
// comment that is present and says nothing is left to review.
describe("the rules of the guide that a lint rule cannot state", () => {
  test("every top-level export has a JSDoc comment", () => {
    let exported = 0;
    const missing: string[] = [];
    for (const file of typescriptFiles()) {
      const found = undocumentedExports(file, readFileSync(join(REPOSITORY_ROOT, file), "utf8"));
      exported += found.exported;
      missing.push(...found.missing);
    }
    expect(missing).toEqual([]);
    // A walk that read nothing would find nothing missing, so the count must
    // be the size a walk of this repository gives.
    expect(exported).toBeGreaterThanOrEqual(190);
  });

  test("no JSDoc comment states a type or a tag that a keyword states", () => {
    let read = 0;
    const problems: string[] = [];
    for (const file of typescriptFiles()) {
      const found = jsdocProblems(file, readFileSync(join(REPOSITORY_ROOT, file), "utf8"));
      read += found.read;
      problems.push(...found.problems);
    }
    expect(problems).toEqual([]);
    expect(read).toBeGreaterThanOrEqual(450);
  });

  test("every TypeScript file is UTF-8", () => {
    const files = typescriptFiles();
    expect(files.filter((file) => !isUtf8(readFileSync(join(REPOSITORY_ROOT, file))))).toEqual([]);
    expect(files.length).toBeGreaterThan(50);
  });

  test("an export of each kind with no JSDoc comment is reported, and a documented one is not", () => {
    const undocumented: Array<[line: string, name: string]> = [
      ["export function f(): void {}", "f"],
      ["export class C {}", "C"],
      ["export interface I { size: number }", "I"],
      ["export type T = number;", "T"],
      ["export enum E { ONE = 1 }", "E"],
      ["export const VALUE = 1;", "VALUE"],
    ];
    for (const [line, name] of undocumented) {
      expect(undocumentedExports("probe.ts", line), line).toEqual({ exported: 1, missing: [`probe.ts:1: ${name} has no JSDoc comment`] });
      expect(undocumentedExports("probe.ts", `/** Says what a caller needs. */\n${line}`), line).toEqual({ exported: 1, missing: [] });
    }
  });

  test("only a JSDoc comment on the export itself counts", () => {
    const missing = ["probe.ts:2: f has no JSDoc comment"];
    expect(undocumentedExports("probe.ts", "// A line comment.\nexport function f(): void {}").missing).toEqual(missing);
    expect(undocumentedExports("probe.ts", "/* A block comment. */\nexport function f(): void {}").missing).toEqual(missing);
    expect(undocumentedExports("probe.ts", "/** On the statement above. */\nconst a = 1;\nexport function f(): number { return a; }").missing)
      .toEqual(["probe.ts:3: f has no JSDoc comment"]);
    // A name passed on from another module keeps the comment it has there.
    expect(undocumentedExports("probe.ts", "export { f } from \"./other.ts\";")).toEqual({ exported: 0, missing: [] });
    // Nor is a declaration that is not exported held to the rule.
    expect(undocumentedExports("probe.ts", "function f(): void {}")).toEqual({ exported: 0, missing: [] });
  });

  test("a JSDoc comment that states a type is reported", () => {
    for (const tag of ["@param {string} name The name.", "@returns {number} The count.", "@return {number} The count."]) {
      expect(jsdocProblems("probe.ts", `/** ${tag} */\nexport function f(name: string): number { return name.length; }`).problems, tag)
        .toEqual(["probe.ts:1: a JSDoc comment states a type"]);
    }
    expect(jsdocProblems("probe.ts", "/** @param name The name, with {braces} in its words. */\nexport function f(name: string): void {}"))
      .toEqual({ read: 1, problems: [] });
    // The guide's rule is about JSDoc. A line comment may say what it likes.
    expect(jsdocProblems("probe.ts", "// @param {string} name\nexport function f(name: string): void {}")).toEqual({ read: 0, problems: [] });
  });

  test("a JSDoc tag that a keyword states is reported, and the word in prose is not", () => {
    for (const tag of ["private", "protected", "public", "readonly", "override", "abstract", "implements", "extends", "enum", "interface", "typedef", "type"]) {
      expect(jsdocProblems("probe.ts", `export class C {\n  /**\n   * Read once.\n   * @${tag}\n   */\n  size = 1;\n}`).problems, tag)
        .toEqual([`probe.ts:2: a JSDoc comment carries @${tag}, which a keyword states`]);
    }
    expect(jsdocProblems("probe.ts", "/** The private key, read once; see {@link C}. */\nexport class C {}").problems).toEqual([]);
    // A comment inside an expression is read as well.
    expect(jsdocProblems("probe.ts", "export const a = f(/** @private */ 1);").problems)
      .toEqual(["probe.ts:1: a JSDoc comment carries @private, which a keyword states"]);
  });

  test("bytes that are not UTF-8 are reported", () => {
    expect(isUtf8(Buffer.from(`plain and caf${String.fromCharCode(233)}`, "utf8"))).toBe(true);
    expect(isUtf8(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe(false);
  });
});

/** What the export check found in one file. */
interface ExportCount {
  /** How many top-level exported declarations the file holds. */
  exported: number;
  /** One "file:line: name has no JSDoc comment" entry for each without one. */
  missing: string[];
}

/**
 * The top-level exported declarations of one file that have no JSDoc comment.
 *
 * A re-export, `export { name } from`, is not a declaration and is not
 * counted: the name keeps the comment it has where it is declared.
 */
function undocumentedExports(file: string, text: string): ExportCount {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const missing: string[] = [];
  let exported = 0;
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    exported += 1;
    if (ts.getJSDocCommentsAndTags(statement).some((comment) => ts.isJSDoc(comment))) continue;
    const line = source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;
    missing.push(`${file}:${line}: ${declaredName(statement)} has no JSDoc comment`);
  }
  return { exported, missing };
}

/** The name a top-level statement declares, for a report. */
function declaredName(statement: ts.Statement): string {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((declaration) => declaration.name.getText()).join(", ");
  }
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)
    || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
    return statement.name?.text ?? "(a declaration)";
  }
  return "(a declaration)";
}

/** What the JSDoc check found in one file. */
interface JsdocCount {
  /** How many JSDoc comments the file holds. */
  read: number;
  /** One "file:line: problem" entry for each problem. */
  problems: string[];
}

// A type in braces straight after the tag, as in "@param {string} name".
const TYPED_TAG = /@(?:param|returns?)\s*\{/;
// A tag at the start of a comment line whose meaning a TypeScript keyword
// already carries. The guide names @implements, @enum, @private and @override,
// "etc.": these are the rest of that set.
const KEYWORD_TAG = /^\s*(?:\/\*\*|\*)?\s*@(private|protected|public|readonly|override|abstract|implements|extends|enum|interface|typedef|type)\b/m;

/**
 * Every JSDoc comment in one file that states a type, or carries a tag that
 * a TypeScript keyword already states.
 *
 * Every comment the parser keeps is read, wherever it sits: before a
 * declaration, inside an expression or before a closing brace.
 */
function jsdocProblems(file: string, text: string): JsdocCount {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const starts = new Set<number>();
  const visit = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) {
      starts.add(range.pos);
    }
    for (const range of ts.getTrailingCommentRanges(text, node.getEnd()) ?? []) {
      starts.add(range.pos);
    }
    for (const child of node.getChildren(source)) {
      visit(child);
    }
  };
  visit(source);
  const problems: string[] = [];
  let read = 0;
  for (const start of [...starts].sort((a, b) => a - b)) {
    if (!text.startsWith("/**", start) || text.startsWith("/**/", start)) continue;
    read += 1;
    const comment = text.slice(start, text.indexOf("*/", start + 3) + 2);
    const line = source.getLineAndCharacterOfPosition(start).line + 1;
    if (TYPED_TAG.test(comment)) problems.push(`${file}:${line}: a JSDoc comment states a type`);
    const keyword = KEYWORD_TAG.exec(comment);
    if (keyword !== null) problems.push(`${file}:${line}: a JSDoc comment carries @${keyword[1]}, which a keyword states`);
  }
  return { read, problems };
}

/** Whether bytes read as UTF-8 without a malformed sequence. */
function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    // The decoder throws a TypeError on the first malformed sequence.
    return false;
  }
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
