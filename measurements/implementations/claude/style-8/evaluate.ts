/**
 * Arithmetic expression evaluator.
 *
 * Grammar, lowest precedence first:
 *   sum     := product (('+' | '-') product)*
 *   product := unary (('*' | '/' | '%') unary)*
 *   unary   := ('+' | '-') unary | power
 *   power   := primary ('^' unary)?      right associative
 *   primary := number | '(' sum ')'
 *
 * `unary` sits above `power` on the left of '^' but is reachable again on its
 * right, so unary minus binds looser than '^' (-2^2 is -4) while 2^-3 parses.
 */

const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

class Parser {
  private readonly source: string;
  private index = 0;

  constructor(source: string) {
    this.source = source;
  }

  parse(): number {
    const value = this.parseSum();
    this.skipWhitespace();
    if (this.index < this.source.length) {
      throw this.unexpected();
    }
    return value;
  }

  private parseSum(): number {
    let value = this.parseProduct();
    for (;;) {
      this.skipWhitespace();
      const operator = this.source[this.index];
      if (operator !== '+' && operator !== '-') {
        return value;
      }
      this.index++;
      const right = this.parseProduct();
      value = operator === '+' ? value + right : value - right;
    }
  }

  private parseProduct(): number {
    let value = this.parseUnary();
    for (;;) {
      this.skipWhitespace();
      const operator = this.source[this.index];
      if (operator !== '*' && operator !== '/' && operator !== '%') {
        return value;
      }
      this.index++;
      const right = this.parseUnary();
      if (operator === '*') {
        value = value * right;
        continue;
      }
      if (right === 0) {
        throw new RangeError('Division by zero');
      }
      value = operator === '/' ? value / right : value % right;
    }
  }

  private parseUnary(): number {
    this.skipWhitespace();
    const operator = this.source[this.index];
    if (operator === '-' || operator === '+') {
      this.index++;
      const value = this.parseUnary();
      return operator === '-' ? -value : value;
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();
    if (this.source[this.index] !== '^') {
      return base;
    }
    this.index++;
    return base ** this.parseUnary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    if (this.index >= this.source.length) {
      throw this.unexpected();
    }
    const character = this.source[this.index];
    if (character === '(') {
      this.index++;
      const value = this.parseSum();
      this.skipWhitespace();
      if (this.source[this.index] !== ')') {
        throw new SyntaxError(`Expected ')' at position ${this.index}`);
      }
      this.index++;
      return value;
    }
    if (DIGIT.test(character) || character === '.') {
      return this.parseNumber();
    }
    throw this.unexpected();
  }

  private parseNumber(): number {
    const start = this.index;
    let digits = this.consumeDigits();
    if (this.source[this.index] === '.') {
      this.index++;
      digits += this.consumeDigits();
    }
    if (digits === 0) {
      throw this.unexpected();
    }
    return Number(this.source.slice(start, this.index));
  }

  private consumeDigits(): number {
    const start = this.index;
    while (this.index < this.source.length && DIGIT.test(this.source[this.index])) {
      this.index++;
    }
    return this.index - start;
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length && WHITESPACE.test(this.source[this.index])) {
      this.index++;
    }
  }

  /**
   * At the end of the input the reported position is the input length, which is
   * what the specification asks for when an expression stops too early.
   */
  private unexpected(): SyntaxError {
    if (this.index >= this.source.length) {
      return new SyntaxError(`Unexpected end of input at position ${this.source.length}`);
    }
    return new SyntaxError(
      `Unexpected character '${this.source[this.index]}' at position ${this.index}`,
    );
  }
}

export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}
