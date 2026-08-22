/**
 * Score one implementation from a TypeScript syntax tree rather than from line patterns.
 *
 * Three rounds of review found constructs the line-anchored patterns could not see: an arrow
 * whose body is an expression, a declaration whose parameters wrap, and a method with type
 * parameters. Each was repaired individually and the next round found another, which is the
 * argument for parsing instead of matching.
 *
 * ## Two counts, because the preregistration asks for two
 *
 * It defines a named unit in the primary-outcome section as "a function declaration, a class
 * method, or a const arrow function", with no restriction on where it sits. It has to be broad
 * there, because a file is wrapper-style when three or more of its named units are declared
 * inside another function.
 *
 * Its secondary outcome then names what its own count includes: "Top-level functions, top-level
 * arrow constants, and class methods". That is narrower, and it is the registered count.
 *
 * So `units` counts everything, which is what `wrapper` needs, and `registeredUnits` counts what
 * the secondary outcome names: top-level functions and arrow constants, plus class methods.
 *
 * Reporting only the first, under the label of the second, is the defect a reviewer found here. I
 * had read the two definitions as contradicting each other; they do not, they scope differently.
 */
import * as ts from "typescript";

export interface Score {
  wrapper: boolean;
  units: number;
  registeredUnits: number;
  longest_own: number;
  entry: number | null;
  length: number;
  comments: number;
  unparsed: boolean;
}

interface Unit {
  first: number;
  last: number;
  closure: boolean;
}

const COMMENT = /^\s*(\/\/|\/\*|\*)/;

/**
 * Is this node one of the three things the preregistration calls a named unit?
 *
 * A declaration without a body is an overload signature, not an implementation, so it is not a
 * unit. A `let` arrow is not one either: the wording says const.
 */
function namedUnit(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node)) return node.body !== undefined && node.name !== undefined;
  // A class member, which includes the constructor. Object-literal methods are not class
  // members, and the definition names class methods, so they do not count.
  if ((ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
       ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
      node.parent && ts.isClassLike(node.parent)) return node.body !== undefined;
  if (ts.isVariableDeclaration(node) && node.initializer &&
      ts.isArrowFunction(node.initializer)) {
    const list = node.parent;
    return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
  }
  return false;
}

/** Is this node a class member, which the secondary outcome counts wherever the class sits?
 *
 * The wording says "top-level" of functions and arrow constants and does not repeat it for class
 * methods. Counting them wherever the class is declared is the better reading: the primary
 * section separates class members from closures, and one published file declares a twelve-member
 * class inside `evaluate`. Excluding those would put that arm's median at 1.
 */
function classMember(node: ts.Node): boolean {
  return (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
    node.parent !== undefined && ts.isClassLike(node.parent);
}

/** Is this declaration written directly in the file, rather than in a block, namespace or class?
 *
 * "Not inside a function" is not the same as top-level. A function declared in an `if` block or a
 * namespace is neither. No such declaration occurs in the ninety published files, so this changes
 * no figure; it makes the contract mean what it says.
 */
function atFileLevel(node: ts.Node): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isSourceFile(parent)) return true;
  // A const arrow reaches the file through its declaration list and statement.
  if (ts.isVariableDeclarationList(parent) && parent.parent && ts.isVariableStatement(parent.parent)) {
    return parent.parent.parent !== undefined && ts.isSourceFile(parent.parent.parent);
  }
  return false;
}

/** Does this node introduce a function body, for the purpose of "inside another function"? */
function functionScope(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) || ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node);
}

export function score(path: string, text: string): Score {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const lines = text.split("\n");
  const units: Unit[] = [];
  let registered = 0;

  const walk = (node: ts.Node, insideFunction: boolean): void => {
    if (namedUnit(node)) {
      units.push({
        first: source.getLineAndCharacterOfPosition(node.getStart(source)).line,
        last: source.getLineAndCharacterOfPosition(node.getEnd()).line,
        closure: insideFunction,
      });
      // The secondary outcome counts top-level functions and arrow constants, plus class
      // methods wherever their class is declared.
      if (classMember(node) || atFileLevel(node)) registered += 1;
    }
    // A class body is not a function body, so its methods are members rather than closures.
    const deeper = functionScope(node) ? true : (ts.isClassLike(node) ? false : insideFunction);
    ts.forEachChild(node, (child) => walk(child, deeper));
  };
  ts.forEachChild(source, (child) => walk(child, false));

  // Own lines: a unit's span, less the spans of the units nested within it.
  const ownLines = units.map((unit) => {
    const span = unit.last - unit.first + 1;
    const inside = units.filter((other) =>
      other !== unit && other.first > unit.first && other.last <= unit.last);
    // Only the outermost nested units are subtracted, so a doubly nested one is not counted twice.
    const outermost = inside.filter((candidate) =>
      !inside.some((other) => other !== candidate &&
        candidate.first > other.first && candidate.last <= other.last));
    const nestedLines = outermost.reduce((sum, other) => sum + (other.last - other.first + 1), 0);
    return Math.max(1, span - nestedLines);
  });

  // The entry position keeps the published denominator, which counts the empty element a
  // trailing newline produces. Correcting it would move every published position by a hundredth.
  const entryLine = lines.findIndex((line) => /^export function evaluate/.test(line));

  // The preregistration says a file that fails to parse is recorded and reported, never dropped
  // silently, so a caller can see the difference between a zero and an unreadable file.
  const diagnostics = (source as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;

  return {
    wrapper: units.filter((unit) => unit.closure).length >= 3,
    units: units.length,
    registeredUnits: registered,
    longest_own: ownLines.length > 0 ? Math.max(...ownLines) : 0,
    entry: entryLine === -1 ? null : entryLine / Math.max(1, lines.length),
    length: lines.length - (lines.length > 0 && lines[lines.length - 1] === "" ? 1 : 0),
    comments: lines.filter((line) => COMMENT.test(line)).length,
    unparsed: Array.isArray(diagnostics) && diagnostics.length > 0,
  };
}
