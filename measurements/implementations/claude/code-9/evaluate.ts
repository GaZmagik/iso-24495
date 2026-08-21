/**
 * Evaluates an arithmetic expression and returns its value.
 *
 * Grammar, lowest precedence first:
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/' | '%') unary)*
 *   unary      := ('+' | '-') unary | power
 *   power      := primary ('^' unary)?      // right associative
 *   primary    := number | '(' expression ')'
 *
 * @throws {SyntaxError} when the input is malformed. The message ends with
 *   ` at position N`, the zero-based index of the offending character, or the
 *   input length when the expression ends too early.
 * @throws {RangeError} with the message `Division by zero` for `/` or `%` by zero.
 */
export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseExpression();
  parser.expectEnd();
  return value;
}

class Parser {
  private readonly source: string;
  private index = 0;

  constructor(source: string) {
    this.source = source;
  }

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

  /** Fails unless every character has been consumed. */
  expectEnd(): void {
    if (this.peek() !== '') {
      throw this.error(`Unexpected ${this.describeCurrent()}`);
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
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right;
    }
  }

  /** unary := ('+' | '-') unary | power */
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

  /**
   * power := primary ('^' unary)?
   *
   * The right side is a unary rather than a power, so `2^-3` parses and `^`
   * still binds tighter than a leading minus, making `-2^2` equal -4.
   */
  private parsePower(): number {
    const base = this.parsePrimary();
    if (this.peek() !== '^') {
      return base;
    }
    this.index += 1;
    return base ** this.parseUnary();
  }

  /** primary := number | '(' expression ')' */
  private parsePrimary(): number {
    const character = this.peek();
    if (character === '(') {
      this.index += 1;
      const value = this.parseExpression();
      if (this.peek() !== ')') {
        throw this.error(`Expected ")" but found ${this.describeCurrent()}`);
      }
      this.index += 1;
      return value;
    }
    if (isDigit(character) || character === '.') {
      return this.parseNumber();
    }
    throw this.error(`Expected a number or "(" but found ${this.describeCurrent()}`);
  }

  /** Reads an integer or decimal, such as `3`, `2.5`, `.5` or `10.` */
  private parseNumber(): number {
    this.skipWhitespace();
    const start = this.index;
    this.skipDigits();
    if (this.source.charAt(this.index) === '.') {
      this.index += 1;
      this.skipDigits();
    }
    const text = this.source.slice(start, this.index);
    if (text === '.') {
      throw this.error(`Expected a digit but found ${this.describeCurrent()}`);
    }
    return Number(text);
  }

  /** Returns the next meaningful character, or `''` at the end of the input. */
  private peek(): string {
    this.skipWhitespace();
    return this.source.charAt(this.index);
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source.charAt(this.index))) {
      this.index += 1;
    }
  }

  private skipDigits(): void {
    while (isDigit(this.source.charAt(this.index))) {
      this.index += 1;
    }
  }

  private describeCurrent(): string {
    const character = this.source.charAt(this.index);
    return character === '' ? 'end of input' : `"${character}"`;
  }

  private error(problem: string): SyntaxError {
    return new SyntaxError(`${problem} at position ${this.index}`);
  }
}

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}
