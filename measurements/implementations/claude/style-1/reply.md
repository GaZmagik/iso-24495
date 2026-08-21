```typescript
/**
 * Arithmetic expression evaluator.
 *
 * Grammar (lowest precedence first):
 *   expression := term (("+" | "-") term)*
 *   term       := factor (("*" | "/" | "%") factor)*
 *   factor     := ("+" | "-") factor | power
 *   power      := primary ("^" factor)?      // right associative
 *   primary    := number | "(" expression ")"
 *
 * The exponent of `^` is parsed as a factor, so `^` binds tighter than a
 * leading unary sign (`-2^2` is -4) while still allowing `2^-3`.
 */
export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseExpression();
  parser.expectEnd();
  return value;
}

class Parser {
  private readonly source: string;
  private pos = 0;

  constructor(source: string) {
    this.source = source;
  }

  parseExpression(): number {
    let value = this.parseTerm();

    for (;;) {
      const op = this.peekOperator("+-");
      if (op === null) return value;

      this.pos += 1;
      const right = this.parseTerm();
      value = op === "+" ? value + right : value - right;
    }
  }

  private parseTerm(): number {
    let value = this.parseFactor();

    for (;;) {
      const op = this.peekOperator("*/%");
      if (op === null) return value;

      this.pos += 1;
      const right = this.parseFactor();

      if (op !== "*" && right === 0) {
        throw new RangeError("Division by zero");
      }

      if (op === "*") value = value * right;
      else if (op === "/") value = value / right;
      else value = value % right;
    }
  }

  private parseFactor(): number {
    this.skipWhitespace();
    const ch = this.source[this.pos];

    if (ch === "+" || ch === "-") {
      this.pos += 1;
      const operand = this.parseFactor();
      return ch === "-" ? -operand : operand;
    }

    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();

    this.skipWhitespace();
    if (this.source[this.pos] !== "^") return base;

    this.pos += 1;
    const exponent = this.parseFactor();
    return base ** exponent;
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    if (this.pos >= this.source.length) {
      throw this.error("Unexpected end of input", this.source.length);
    }

    const ch = this.source[this.pos];

    if (ch === "(") {
      this.pos += 1;
      const value = this.parseExpression();

      this.skipWhitespace();
      if (this.source[this.pos] !== ")") {
        throw this.error('Expected ")"', this.pos);
      }

      this.pos += 1;
      return value;
    }

    if (isDigit(ch) || ch === ".") {
      return this.parseNumber();
    }

    throw this.error(`Unexpected character "${ch}"`, this.pos);
  }

  private parseNumber(): number {
    const start = this.pos;
    let digits = 0;

    while (isDigit(this.source[this.pos])) {
      this.pos += 1;
      digits += 1;
    }

    if (this.source[this.pos] === ".") {
      this.pos += 1;
      while (isDigit(this.source[this.pos])) {
        this.pos += 1;
        digits += 1;
      }
    }

    // A lone "." carries no digits, so it is not a number.
    if (digits === 0) {
      throw this.error(`Unexpected character "${this.source[start]}"`, start);
    }

    return parseFloat(this.source.slice(start, this.pos));
  }

  /** Returns the operator at the cursor if it is one of `chars`, else null. */
  private peekOperator(chars: string): string | null {
    this.skipWhitespace();
    const ch = this.source[this.pos];
    return ch !== undefined && chars.includes(ch) ? ch : null;
  }

  expectEnd(): void {
    this.skipWhitespace();
    if (this.pos < this.source.length) {
      throw this.error(
        `Unexpected character "${this.source[this.pos]}"`,
        this.pos,
      );
    }
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
      this.pos += 1;
    }
  }

  private error(message: string, position: number): SyntaxError {
    return new SyntaxError(`${message} at position ${position}`);
  }
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}
```

**Status:** written, not executed. I did not run the code, because writing files was out of scope, so treat the behaviour below as traced by hand rather than verified.

How the spec's cases trace through:

- `2^3^2` → `parsePower` sends the exponent back through `parseFactor`, giving right associativity and 512.
- `-2^2` → `parseFactor` consumes the sign, then `parsePower` evaluates `2^2` before negating, giving -4.
- `2 +`, `(1 + 2` → both fail at the input length, 3 and 6, because the cursor has run past the last character.
- `1 + )`, `1 $ 2` → fail at the offending character, positions 4 and 2. The second is caught by `expectEnd`, since `$` is no operator.
- `` (empty) → `parsePrimary` reports end of input at position 0.

One judgement call worth flagging: a lone `.` is rejected as an unexpected character at the dot's own position, since the spec gives no rule for it.
