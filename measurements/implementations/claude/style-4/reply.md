I read the spec. Here is `evaluate.ts`.

```typescript
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
```

**Status: written and hand-traced, not executed.** You asked me not to write files, so I ran no compiler and no tests. The checks below come from reading the code, and each still needs a real run to close.

Traces against the spec's examples:

- `2^3^2` → `power` recurses right, giving `2^(3^2)` = 512.
- `-2^2` → `unary` consumes `-`, then `power` binds `2^2` first, giving -4.
- `2 +` → the operand parse skips whitespace to index 3, the input length, then fails there.
- `(1 + 2` → the `)` check fails at index 6.
- `1 + )` → `primary` rejects `)` at index 4.
- `1 $ 2` → `expectEnd` rejects `$` at index 2.
- Empty input → `primary` sees end of input at index 0.

Two decisions the spec left open:

1. **Exponent notation is not supported.** `1e5` throws at position 1, because the grammar lists only integers and decimals.
2. **`%` by zero throws `RangeError`,** matching `/`, since the spec groups both operators under that rule.

One detail worth your eye: `Math.pow` returns `NaN` for a negative base with a fractional exponent, so `(-8)^(1/3)` yields `NaN` rather than an error. The spec says nothing about it, so I left the JavaScript behaviour in place.
