/**
 * Score one implementation from a TypeScript syntax tree rather than from line patterns.
 *
 * Three rounds of review found constructs the line-anchored patterns could not see: an arrow
 * whose body is an expression, a declaration whose parameters wrap, and a method with type
 * parameters. Each was repaired individually and the next round found another, which is the
 * argument for parsing instead of matching.
 *
 * The definitions come from the preregistration's primary-outcome section, which is the only
 * place it defines the term: "A named unit is a function declaration, a class method, or a const
 * arrow function", and a file is wrapper-style when three or more are declared inside the body of
 * another function rather than at the top level or as members of a class.
 */
import * as ts from "typescript";

export interface Score {
  wrapper: boolean;
  units: number;
  longest_own: number;
  entry: number | null;
  length: number;
  comments: number;
}

interface Unit {
  first: number;
  last: number;
  closure: boolean;
}

const COMMENT = /^\s*(\/\/|\/\*|\*)/;

/** Is this node one of the three things the preregistration calls a named unit? */
function namedUnit(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node)) return true;
  // A class member, which includes the constructor. Object-literal methods are not class
  // members, and the definition names class methods, so they do not count.
  if ((ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
       ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
      node.parent && ts.isClassLike(node.parent)) return true;
  // A const or let bound directly to an arrow function.
  if (ts.isVariableDeclaration(node) && node.initializer &&
      ts.isArrowFunction(node.initializer)) return true;
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

  const walk = (node: ts.Node, insideFunction: boolean): void => {
    const isUnit = namedUnit(node);
    if (isUnit) {
      units.push({
        first: source.getLineAndCharacterOfPosition(node.getStart(source)).line,
        last: source.getLineAndCharacterOfPosition(node.getEnd()).line,
        closure: insideFunction,
      });
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

  return {
    wrapper: units.filter((unit) => unit.closure).length >= 3,
    units: units.length,
    longest_own: ownLines.length > 0 ? Math.max(...ownLines) : 0,
    entry: entryLine === -1 ? null : entryLine / Math.max(1, lines.length),
    length: lines.length - (lines.length > 0 && lines[lines.length - 1] === "" ? 1 : 0),
    comments: lines.filter((line) => COMMENT.test(line)).length,
  };
}
