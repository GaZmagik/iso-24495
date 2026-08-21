const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

/**
 * Recursive descent parser for the arithmetic grammar.
 *
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/' | '%') unary)*
 *   unary      := ('+' | '-') unary | power
 *   power      := primary ('^' unary)?
 *   primary    := number | '(' expression ')'
 *
 * Putting `unary` on the right of `^` gives right associativity and lets the
 * exponent carry its own sign, while `-2^2` still parses as -(2^2).
 */
class Parser {
  private readonly source: string;
  private index = 0;

  constructor(source: string) {
    this.source = source;
  }

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

  expectEnd(): void {
    const char = this.peek();
    if (char !== null) {
      throw this.syntaxError(`Unexpected token "${char}"`);
    }
  }

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

  private parseUnary(): number {
    const operator = this.peek();

    if (operator === '-') {
      this.index += 1;
      return -this.parseUnary();
    }
    if (operator === '+') {
      this.index += 1;
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();

    if (this.peek() !== '^') {
      return base;
    }
    this.index += 1;
    return base ** this.parseUnary();
  }

  private parsePrimary(): number {
    const char = this.peek();

    if (char === null) {
      throw this.syntaxError('Unexpected end of input');
    }

    if (char === '(') {
      this.index += 1;
      const value = this.parseExpression();

      if (this.peek() !== ')') {
        throw this.syntaxError('Expected ")"');
      }
      this.index += 1;
      return value;
    }

    if (DIGIT.test(char) || char === '.') {
      return this.parseNumber();
    }

    throw this.syntaxError(`Unexpected token "${char}"`);
  }

  private parseNumber(): number {
    const start = this.index;

    while (this.index < this.source.length && DIGIT.test(this.source[this.index])) {
      this.index += 1;
    }

    if (this.source[this.index] === '.') {
      this.index += 1;
      while (this.index < this.source.length && DIGIT.test(this.source[this.index])) {
        this.index += 1;
      }
    }

    const text = this.source.slice(start, this.index);

    // A lone "." matched the leading-dot case in parsePrimary but is not a number.
    if (text === '.') {
      throw this.syntaxError('Invalid number', start);
    }

    return Number(text);
  }

  /** Returns the next significant character, skipping whitespace, or null at end of input. */
  private peek(): string | null {
    while (this.index < this.source.length && WHITESPACE.test(this.source[this.index])) {
      this.index += 1;
    }
    return this.index < this.source.length ? this.source[this.index] : null;
  }

  private syntaxError(message: string, position: number = this.index): SyntaxError {
    return new SyntaxError(`${message} at position ${position}`);
  }
}

export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseExpression();
  parser.expectEnd();
  return value;
}
