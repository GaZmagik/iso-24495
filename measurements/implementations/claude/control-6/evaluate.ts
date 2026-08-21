/**
 * Arithmetic expression evaluator.
 *
 * Grammar, lowest precedence first:
 *
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/' | '%') unary)*
 *   unary      := ('+' | '-') unary | power
 *   power      := primary ('^' unary)?
 *   primary    := number | '(' expression ')'
 *
 * `power` takes a `unary` on its right, which makes `^` right associative and
 * lets it bind tighter than unary minus, so `-2^2` is -4 and `2^3^2` is 512.
 */

const WHITESPACE = /\s/;

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

class Parser {
  private position = 0;

  constructor(private readonly source: string) {}

  /** Parses the whole input and rejects anything left over. */
  parse(): number {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.position < this.source.length) {
      throw this.unexpected();
    }
    return value;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator !== '+' && operator !== '-') {
        return value;
      }
      this.position += 1;
      const right = this.parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
  }

  private parseTerm(): number {
    let value = this.parseUnary();
    for (;;) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator !== '*' && operator !== '/' && operator !== '%') {
        return value;
      }
      this.position += 1;
      const right = this.parseUnary();
      if (operator === '*') {
        value = value * right;
        continue;
      }
      // Catches -0 as well as 0, both of which are division by zero.
      if (right === 0) {
        throw new RangeError('Division by zero');
      }
      value = operator === '/' ? value / right : value % right;
    }
  }

  private parseUnary(): number {
    this.skipWhitespace();
    const sign = this.peek();
    if (sign === '-') {
      this.position += 1;
      return -this.parseUnary();
    }
    if (sign === '+') {
      this.position += 1;
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();
    if (this.peek() !== '^') {
      return base;
    }
    this.position += 1;
    // Recursing into `unary` keeps `^` right associative and allows `2^-3`.
    return base ** this.parseUnary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    const character = this.peek();

    if (character === '(') {
      this.position += 1;
      const value = this.parseExpression();
      this.skipWhitespace();
      if (this.peek() !== ')') {
        throw this.expected("')'");
      }
      this.position += 1;
      return value;
    }

    if (isDigit(character) || character === '.') {
      return this.parseNumber();
    }

    throw this.unexpected();
  }

  /** Reads an integer or decimal, including the `.5` and `10.` forms. */
  private parseNumber(): number {
    const start = this.position;

    while (isDigit(this.peek())) {
      this.position += 1;
    }
    if (this.peek() === '.') {
      this.position += 1;
      while (isDigit(this.peek())) {
        this.position += 1;
      }
    }

    const text = this.source.slice(start, this.position);
    if (text === '.') {
      // A lone dot is not a number, so report the dot itself.
      this.position = start;
      throw this.unexpected();
    }
    return Number(text);
  }

  private skipWhitespace(): void {
    while (this.position < this.source.length && WHITESPACE.test(this.source[this.position])) {
      this.position += 1;
    }
  }

  /** The current character, or the empty string once the input is exhausted. */
  private peek(): string {
    return this.position < this.source.length ? this.source[this.position] : '';
  }

  private unexpected(): SyntaxError {
    const character = this.peek();
    if (character === '') {
      return new SyntaxError(`Unexpected end of input at position ${this.source.length}`);
    }
    return new SyntaxError(`Unexpected character '${character}' at position ${this.position}`);
  }

  private expected(what: string): SyntaxError {
    const character = this.peek();
    if (character === '') {
      return new SyntaxError(`Expected ${what} but reached the end at position ${this.source.length}`);
    }
    return new SyntaxError(`Expected ${what} but found '${character}' at position ${this.position}`);
  }
}

export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}
