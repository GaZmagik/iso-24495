/**
 * Recursive-descent evaluator for arithmetic expressions.
 *
 * Grammar, lowest precedence first:
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/" | "%") unary)*
 *   unary      := ("+" | "-") unary | power
 *   power      := atom ("^" unary)?
 *   atom       := "(" expression ")" | number
 *
 * Putting "power" below "unary", with a unary right-hand side, gives "^" a
 * tighter binding than unary minus (-2^2 is -4) and makes it right
 * associative (2^3^2 is 512).
 */

const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

export function evaluate(expression: string): number {
  let pos = 0;

  function fail(index: number): never {
    if (index >= expression.length) {
      throw new SyntaxError(`Unexpected end of input at position ${expression.length}`);
    }
    throw new SyntaxError(`Unexpected character '${expression.charAt(index)}' at position ${index}`);
  }

  function skipWhitespace(): void {
    while (WHITESPACE.test(expression.charAt(pos))) {
      pos++;
    }
  }

  /** Next significant character, or "" at end of input. Whitespace is consumed. */
  function peek(): string {
    skipWhitespace();
    return expression.charAt(pos);
  }

  function parseExpression(): number {
    let value = parseTerm();
    for (;;) {
      const op = peek();
      if (op !== '+' && op !== '-') {
        return value;
      }
      pos++;
      const right = parseTerm();
      value = op === '+' ? value + right : value - right;
    }
  }

  function parseTerm(): number {
    let value = parseUnary();
    for (;;) {
      const op = peek();
      if (op !== '*' && op !== '/' && op !== '%') {
        return value;
      }
      pos++;
      const right = parseUnary();
      if (op === '*') {
        value = value * right;
        continue;
      }
      if (right === 0) {
        throw new RangeError('Division by zero');
      }
      value = op === '/' ? value / right : value % right;
    }
  }

  function parseUnary(): number {
    const op = peek();
    if (op === '+' || op === '-') {
      pos++;
      const operand = parseUnary();
      return op === '-' ? -operand : operand;
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parseAtom();
    if (peek() !== '^') {
      return base;
    }
    pos++;
    return base ** parseUnary();
  }

  function parseAtom(): number {
    const char = peek();
    if (char === '(') {
      pos++;
      const value = parseExpression();
      if (peek() !== ')') {
        fail(pos);
      }
      pos++;
      return value;
    }
    if (DIGIT.test(char) || char === '.') {
      return parseNumber();
    }
    fail(pos);
  }

  /** Accepts 3, 2.5, .5 and 10., but not a lone dot. */
  function parseNumber(): number {
    skipWhitespace();
    const start = pos;
    while (DIGIT.test(expression.charAt(pos))) {
      pos++;
    }
    if (expression.charAt(pos) === '.') {
      pos++;
      while (DIGIT.test(expression.charAt(pos))) {
        pos++;
      }
    }
    const text = expression.slice(start, pos);
    if (text === '.') {
      fail(start);
    }
    return Number(text);
  }

  const result = parseExpression();
  skipWhitespace();
  if (pos < expression.length) {
    fail(pos);
  }
  return result;
}
