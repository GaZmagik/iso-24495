const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

/**
 * Evaluates an arithmetic expression.
 *
 * Grammar, lowest precedence first:
 *   additive       := multiplicative (('+' | '-') multiplicative)*
 *   multiplicative := unary (('*' | '/' | '%') unary)*
 *   unary          := ('+' | '-') unary | power
 *   power          := primary ('^' unary)?
 *   primary        := number | '(' additive ')'
 *
 * `power` recurses into `unary` on its right-hand side, which makes `^` right
 * associative and lets it bind tighter than a leading sign: `-2^2` is -4.
 */
export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}

class Parser {
  private readonly source: string;
  private position = 0;

  constructor(source: string) {
    this.source = source;
  }

  parse(): number {
    const value = this.parseAdditive();
    this.skipWhitespace();
    if (this.position < this.source.length) {
      throw this.syntaxError();
    }
    return value;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    for (;;) {
      this.skipWhitespace();
      const operator = this.source[this.position];
      if (operator !== '+' && operator !== '-') {
        return value;
      }
      this.position++;
      const right = this.parseMultiplicative();
      value = operator === '+' ? value + right : value - right;
    }
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();
    for (;;) {
      this.skipWhitespace();
      const operator = this.source[this.position];
      if (operator !== '*' && operator !== '/' && operator !== '%') {
        return value;
      }
      this.position++;
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
    const operator = this.source[this.position];
    if (operator === '-' || operator === '+') {
      this.position++;
      const operand = this.parseUnary();
      return operator === '-' ? -operand : operand;
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();
    if (this.source[this.position] !== '^') {
      return base;
    }
    this.position++;
    return Math.pow(base, this.parseUnary());
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    const character = this.source[this.position];
    if (character === '(') {
      this.position++;
      const value = this.parseAdditive();
      this.skipWhitespace();
      if (this.source[this.position] !== ')') {
        throw this.syntaxError();
      }
      this.position++;
      return value;
    }
    if (character !== undefined && (DIGIT.test(character) || character === '.')) {
      return this.parseNumber();
    }
    throw this.syntaxError();
  }

  private parseNumber(): number {
    const start = this.position;
    this.skipDigits();
    if (this.source[this.position] === '.') {
      this.position++;
      this.skipDigits();
    }
    // A lone '.' matched the start of a number but carries no digits.
    if (this.position - start === 1 && this.source[start] === '.') {
      throw this.syntaxError(start);
    }
    return Number(this.source.slice(start, this.position));
  }

  private skipDigits(): void {
    while (this.position < this.source.length && DIGIT.test(this.source[this.position])) {
      this.position++;
    }
  }

  private skipWhitespace(): void {
    while (this.position < this.source.length && WHITESPACE.test(this.source[this.position])) {
      this.position++;
    }
  }

  private syntaxError(position: number = this.position): SyntaxError {
    if (position >= this.source.length) {
      return new SyntaxError(`Unexpected end of input at position ${this.source.length}`);
    }
    return new SyntaxError(
      `Unexpected character '${this.source[position]}' at position ${position}`,
    );
  }
}
