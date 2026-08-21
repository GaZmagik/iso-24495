/**
 * Arithmetic expression evaluator.
 *
 * expression := term (("+" | "-") term)*
 * term       := unary (("*" | "/" | "%") unary)*
 * unary      := ("+" | "-") unary | power
 * power      := primary ("^" unary)?      // right associative; RHS may be unary
 * primary    := number | "(" expression ")"
 */

const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= '0' && char <= '9';

const isWhitespace = (char: string | undefined): boolean =>
  char !== undefined && /\s/.test(char);

export function evaluate(expression: string): number {
  let pos = 0;

  /** Skips whitespace and returns the next significant character, if any. */
  function peek(): string | undefined {
    while (isWhitespace(expression[pos])) pos++;
    return expression[pos];
  }

  /** Reports a syntax error at the current position. */
  function fail(): never {
    const char = expression[pos];
    const where = `at position ${pos}`;
    throw new SyntaxError(
      char === undefined
        ? `Unexpected end of input ${where}`
        : `Unexpected token "${char}" ${where}`,
    );
  }

  function parseExpression(): number {
    let value = parseTerm();
    for (let op = peek(); op === '+' || op === '-'; op = peek()) {
      pos++;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseUnary();
    for (let op = peek(); op === '*' || op === '/' || op === '%'; op = peek()) {
      pos++;
      const rhs = parseUnary();
      if (op !== '*' && rhs === 0) throw new RangeError('Division by zero');
      value = op === '*' ? value * rhs : op === '/' ? value / rhs : value % rhs;
    }
    return value;
  }

  function parseUnary(): number {
    const op = peek();
    if (op === '-' || op === '+') {
      pos++;
      const value = parseUnary();
      return op === '-' ? -value : value;
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (peek() !== '^') return base;
    pos++;
    // The exponent is a unary, which makes "^" right associative and admits "2^-3".
    return base ** parseUnary();
  }

  function parsePrimary(): number {
    const char = peek();
    if (char === '(') {
      pos++;
      const value = parseExpression();
      if (peek() !== ')') fail();
      pos++;
      return value;
    }
    if (isDigit(char) || char === '.') return parseNumber();
    fail();
  }

  function parseNumber(): number {
    const start = pos;
    let digits = 0;
    while (isDigit(expression[pos])) {
      pos++;
      digits++;
    }
    if (expression[pos] === '.') {
      pos++;
      while (isDigit(expression[pos])) {
        pos++;
        digits++;
      }
    }
    if (digits === 0) {
      pos = start; // a bare "." is not a number
      fail();
    }
    return parseFloat(expression.slice(start, pos));
  }

  const result = parseExpression();
  if (peek() !== undefined) fail();
  return result;
}
