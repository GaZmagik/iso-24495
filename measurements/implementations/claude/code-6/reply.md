I read the spec. Here is the implementation.

```ts
const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

/**
 * Evaluates an arithmetic expression and returns its value.
 *
 * Throws a SyntaxError for malformed input and a RangeError for division by zero.
 */
export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseSum();
  parser.expectEnd();
  return value;
}

/** A recursive descent parser, one method per precedence level. */
class Parser {
  private position = 0;

  constructor(private readonly source: string) {}

  /** Sums and differences: the lowest precedence, left associative. */
  parseSum(): number {
    let value = this.parseProduct();
    for (;;) {
      const operator = this.peek('+-');
      if (operator === null) return value;
      this.position += 1;
      const right = this.parseProduct();
      value = operator === '+' ? value + right : value - right;
    }
  }

  /** Products, quotients and remainders, left associative. */
  private parseProduct(): number {
    let value = this.parseUnary();
    for (;;) {
      const operator = this.peek('*/%');
      if (operator === null) return value;
      this.position += 1;
      const right = this.parseUnary();
      value = this.applyProduct(operator, value, right);
    }
  }

  /** A run of unary signs, which bind looser than `^` so that `-2^2` is -4. */
  private parseUnary(): number {
    const sign = this.peek('+-');
    if (sign === null) return this.parsePower();
    this.position += 1;
    const operand = this.parseUnary();
    return sign === '-' ? -operand : operand;
  }

  /** Exponentiation, right associative. The exponent may carry its own sign. */
  private parsePower(): number {
    const base = this.parseAtom();
    if (this.peek('^') === null) return base;
    this.position += 1;
    return base ** this.parseUnary();
  }

  /** A number or a parenthesised expression. */
  private parseAtom(): number {
    this.skipWhitespace();
    const character = this.source[this.position];
    if (character === '(') {
      this.position += 1;
      const value = this.parseSum();
      this.expectClosingParenthesis();
      return value;
    }
    if (character !== undefined && (DIGIT.test(character) || character === '.')) {
      return this.parseNumber();
    }
    throw this.errorAt(this.position);
  }

  /** An integer or decimal, with the digits optional on either side of the point. */
  private parseNumber(): number {
    const start = this.position;
    let digitCount = 0;
    while (this.atDigit()) {
      this.position += 1;
      digitCount += 1;
    }
    if (this.source[this.position] === '.') {
      this.position += 1;
      while (this.atDigit()) {
        this.position += 1;
        digitCount += 1;
      }
    }
    if (digitCount === 0) throw this.errorAt(start);
    return Number(this.source.slice(start, this.position));
  }

  /** Confirms the whole expression was consumed. */
  expectEnd(): void {
    this.skipWhitespace();
    if (this.position < this.source.length) throw this.errorAt(this.position);
  }

  private expectClosingParenthesis(): void {
    this.skipWhitespace();
    if (this.source[this.position] !== ')') {
      throw new SyntaxError(
        `Expected ")" but found ${this.describe(this.position)} at position ${this.position}`,
      );
    }
    this.position += 1;
  }

  private applyProduct(operator: string, left: number, right: number): number {
    if (operator === '*') return left * right;
    if (right === 0) throw new RangeError('Division by zero');
    return operator === '/' ? left / right : left % right;
  }

  /**
   * Returns the operator at the current position if it is one of `operators`,
   * otherwise null. Whitespace before it is consumed either way.
   */
  private peek(operators: string): string | null {
    this.skipWhitespace();
    const character = this.source[this.position];
    if (character === undefined || !operators.includes(character)) return null;
    return character;
  }

  private atDigit(): boolean {
    const character = this.source[this.position];
    return character !== undefined && DIGIT.test(character);
  }

  private skipWhitespace(): void {
    while (this.position < this.source.length && WHITESPACE.test(this.source[this.position])) {
      this.position += 1;
    }
  }

  private errorAt(index: number): SyntaxError {
    return new SyntaxError(`Unexpected ${this.describe(index)} at position ${index}`);
  }

  private describe(index: number): string {
    const character = this.source[index];
    return character === undefined ? 'end of expression' : `character "${character}"`;
  }
}
```

Notes on the parts of the spec that drove the design:

- **`-2^2` is -4** because `parseUnary` wraps `parsePower`, so the sign applies to the finished power. `parsePower` recurses into `parseUnary` for its exponent, which gives both right associativity (`2^3^2` is 512) and signed exponents such as `2^-3`.
- **Error positions** come from the parser's index after whitespace is skipped, so `2 +` reports 3 (the input length), `(1 + 2` reports 6, `1 + )` reports 4, empty input reports 0, and `1 $ 2` reports 2 from the trailing-input check in `expectEnd`.
- **Not verified:** I did not run this, because you asked for output only and no file writes. The behaviour above is traced by hand against each spec example, not executed.
