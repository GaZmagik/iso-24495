/**
 * Arithmetic expression evaluator.
 *
 * Grammar, lowest precedence first:
 *
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/' | '%') unary)*
 *   unary      := ('+' | '-') unary | power
 *   power      := primary ('^' unary)?        // right associative
 *   primary    := number | '(' expression ')'
 *
 * `power` recurses into `unary` on its right side, so `2^3^2` is 512 and
 * `2^-3` parses. `unary` falls through to `power`, so `-2^2` is -4.
 */

const WHITESPACE = /\s/;

export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseExpression();
  parser.expectEnd();
  return value;
}

class Parser {
  private index = 0;

  constructor(private readonly source: string) {}

  /** expression := term (('+' | '-') term)* */
  parseExpression(): number {
    let value = this.parseTerm();

    for (;;) {
      const operator = this.peek();
      if (operator !== '+' && operator !== '-') {
        return value;
      }
      this.index += 1;
      const right = this.parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
  }

  /** Throws unless every character has been consumed. */
  expectEnd(): void {
    if (this.peek() !== undefined) {
      this.fail();
    }
  }

  /** term := unary (('*' | '/' | '%') unary)* */
  private parseTerm(): number {
    let value = this.parseUnary();

    for (;;) {
      const operator = this.peek();
      if (operator !== '*' && operator !== '/' && operator !== '%') {
        return value;
      }
      this.index += 1;
      const right = this.parseUnary();

      if (right === 0 && operator !== '*') {
        throw new RangeError('Division by zero');
      }
      if (operator === '*') {
        value = value * right;
      } else if (operator === '/') {
        value = value / right;
      } else {
        value = value % right;
      }
    }
  }

  /** unary := ('+' | '-') unary | power */
  private parseUnary(): number {
    const operator = this.peek();

    if (operator === '+' || operator === '-') {
      this.index += 1;
      const operand = this.parseUnary();
      return operator === '-' ? -operand : operand;
    }
    return this.parsePower();
  }

  /** power := primary ('^' unary)? */
  private parsePower(): number {
    const base = this.parsePrimary();

    if (this.peek() !== '^') {
      return base;
    }
    this.index += 1;
    return Math.pow(base, this.parseUnary());
  }

  /** primary := number | '(' expression ')' */
  private parsePrimary(): number {
    const character = this.peek();

    if (character === '(') {
      this.index += 1;
      const value = this.parseExpression();
      if (this.peek() !== ')') {
        this.fail('")"');
      }
      this.index += 1;
      return value;
    }
    if (isDigit(character) || character === '.') {
      return this.parseNumber();
    }
    return this.fail('a number');
  }

  /** Reads an integer or decimal, such as `3`, `2.5`, `.5` or `10.`. */
  private parseNumber(): number {
    this.skipWhitespace();
    const start = this.index;
    let digits = 0;

    while (isDigit(this.source[this.index])) {
      this.index += 1;
      digits += 1;
    }
    if (this.source[this.index] === '.') {
      this.index += 1;
      while (isDigit(this.source[this.index])) {
        this.index += 1;
        digits += 1;
      }
    }
    if (digits === 0) {
      this.index = start;
      this.fail('a number');
    }
    return Number(this.source.slice(start, this.index));
  }

  /**
   * Returns the next significant character, or `undefined` at end of input.
   * Whitespace is consumed, so `this.index` afterwards is the position to
   * report in an error.
   */
  private peek(): string | undefined {
    this.skipWhitespace();
    return this.source[this.index];
  }

  private skipWhitespace(): void {
    while (
      this.index < this.source.length &&
      WHITESPACE.test(this.source[this.index])
    ) {
      this.index += 1;
    }
  }

  /**
   * Throws a `SyntaxError` naming the current position. At end of input that
   * position is the length of the expression.
   */
  private fail(expected?: string): never {
    const character = this.source[this.index];
    const found = character === undefined ? 'end of input' : `"${character}"`;
    const detail =
      expected === undefined
        ? `Unexpected ${found}`
        : `Expected ${expected} but found ${found}`;

    throw new SyntaxError(`${detail} at position ${this.index}`);
  }
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}
