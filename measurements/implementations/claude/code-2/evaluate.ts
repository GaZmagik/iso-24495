/**
 * Evaluates arithmetic expressions of the form `1 + 2 * (3 ^ -2)`.
 *
 * Precedence, loosest first: `+ -`, then `* / %`, then unary `+ -`,
 * then right-associative `^`.
 */
export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

class Parser {
  private position = 0;

  constructor(private readonly text: string) {}

  parse(): number {
    const value = this.readSum();
    this.skipWhitespace();
    if (this.position < this.text.length) {
      throw this.syntaxError();
    }
    return value;
  }

  private readSum(): number {
    let value = this.readProduct();
    for (let operator = this.takeOperator('+-'); operator; operator = this.takeOperator('+-')) {
      const right = this.readProduct();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  private readProduct(): number {
    let value = this.readUnary();
    for (let operator = this.takeOperator('*/%'); operator; operator = this.takeOperator('*/%')) {
      const right = this.readUnary();
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
    return value;
  }

  private readUnary(): number {
    const sign = this.takeOperator('+-');
    if (sign === undefined) {
      return this.readPower();
    }
    const value = this.readUnary();
    return sign === '-' ? -value : value;
  }

  private readPower(): number {
    const base = this.readPrimary();
    if (this.takeOperator('^') === undefined) {
      return base;
    }
    // The exponent is a unary expression, so `^` is right associative
    // and binds tighter than a leading minus: `-2^2` is -4.
    return base ** this.readUnary();
  }

  private readPrimary(): number {
    this.skipWhitespace();
    const character = this.text[this.position];
    if (character === '(') {
      this.position += 1;
      const value = this.readSum();
      this.skipWhitespace();
      if (this.text[this.position] !== ')') {
        throw this.syntaxError("')'");
      }
      this.position += 1;
      return value;
    }
    if (isDigit(character) || character === '.') {
      return this.readNumber();
    }
    throw this.syntaxError();
  }

  private readNumber(): number {
    const start = this.position;
    while (isDigit(this.text[this.position])) {
      this.position += 1;
    }
    if (this.text[this.position] === '.') {
      this.position += 1;
      while (isDigit(this.text[this.position])) {
        this.position += 1;
      }
    }
    const digits = this.text.slice(start, this.position);
    if (digits === '.') {
      this.position = start;
      throw this.syntaxError();
    }
    return Number(digits);
  }

  private takeOperator(operators: string): string | undefined {
    this.skipWhitespace();
    const character = this.text[this.position];
    if (character === undefined || !operators.includes(character)) {
      return undefined;
    }
    this.position += 1;
    return character;
  }

  private skipWhitespace(): void {
    while (isWhitespace(this.text[this.position])) {
      this.position += 1;
    }
  }

  private syntaxError(expected?: string): SyntaxError {
    const found =
      this.position < this.text.length
        ? `'${this.text[this.position]}'`
        : 'end of expression';
    const problem = expected === undefined
      ? `Unexpected ${found}`
      : `Expected ${expected} but found ${found}`;
    return new SyntaxError(`${problem} at position ${this.position}`);
  }
}
