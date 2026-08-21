`SPEC.md` is a self-contained parser task — no existing code to match against. Here is `evaluate.ts`:

```typescript
/**
 * Arithmetic expression evaluator.
 *
 * expression := term (('+' | '-') term)*
 * term       := unary (('*' | '/' | '%') unary)*
 * unary      := ('+' | '-') unary | power
 * power      := primary ('^' unary)?
 * primary    := number | '(' expression ')'
 *
 * `power` takes its exponent from `unary` rather than from itself, which makes
 * `^` right associative (`2^3^2` is 512) and lets `2^-3` parse. Unary operators
 * sit below `power` in the chain, so `-2^2` is -(2^2).
 */

const WHITESPACE = /\s/;

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

class Parser {
  private pos = 0;

  constructor(private readonly source: string) {}

  parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      this.skipWhitespace();
      const op = this.source[this.pos];
      if (op !== '+' && op !== '-') return value;
      this.pos++;
      const right = this.parseTerm();
      value = op === '+' ? value + right : value - right;
    }
  }

  expectEnd(): void {
    this.skipWhitespace();
    if (this.pos < this.source.length) {
      throw this.fail(`Unexpected character '${this.source[this.pos]}'`);
    }
  }

  private parseTerm(): number {
    let value = this.parseUnary();
    for (;;) {
      this.skipWhitespace();
      const op = this.source[this.pos];
      if (op !== '*' && op !== '/' && op !== '%') return value;
      this.pos++;
      const right = this.parseUnary();
      if (op === '*') {
        value = value * right;
        continue;
      }
      if (right === 0) throw new RangeError('Division by zero');
      value = op === '/' ? value / right : value % right;
    }
  }

  private parseUnary(): number {
    this.skipWhitespace();
    const op = this.source[this.pos];
    if (op === '+' || op === '-') {
      this.pos++;
      const value = this.parseUnary();
      return op === '-' ? -value : value;
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();
    if (this.source[this.pos] !== '^') return base;
    this.pos++;
    return base ** this.parseUnary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    const char = this.source[this.pos];
    if (char === undefined) throw this.fail('Unexpected end of input');

    if (char === '(') {
      this.pos++;
      const value = this.parseExpression();
      this.skipWhitespace();
      if (this.source[this.pos] !== ')') throw this.fail("Expected ')'");
      this.pos++;
      return value;
    }

    if (isDigit(char) || char === '.') return this.parseNumber();

    throw this.fail(`Unexpected character '${char}'`);
  }

  private parseNumber(): number {
    const start = this.pos;
    while (isDigit(this.source[this.pos])) this.pos++;
    if (this.source[this.pos] === '.') {
      this.pos++;
      while (isDigit(this.source[this.pos])) this.pos++;
    }

    const text = this.source.slice(start, this.pos);
    if (text === '.') {
      // A lone dot with no digits on either side is not a number.
      this.pos = start;
      throw this.fail("Unexpected character '.'");
    }
    return Number(text);
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && WHITESPACE.test(this.source[this.pos])) {
      this.pos++;
    }
  }

  /** Builds a SyntaxError pointing at the current position. */
  private fail(message: string): SyntaxError {
    return new SyntaxError(`${message} at position ${this.pos}`);
  }
}

export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseExpression();
  parser.expectEnd();
  return value;
}
```

Notes on the error cases from the spec: positions come from the parser's cursor after whitespace is skipped, so `2 +` reports 3 (the input length, since input ended early), `(1 + 2` reports 6, `1 + )` reports 4 (index of `)`), empty input reports 0, and `1 $ 2` reports 2 — the `$` is caught by the end-of-input check after `1` parses. Division and modulo both check for a zero right operand before dividing, which also covers `-0`.
