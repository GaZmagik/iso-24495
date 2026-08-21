Here is `evaluate.ts`, a recursive-descent parser matching the grammar and error rules in `SPEC.md`.

```typescript
/**
 * Evaluates arithmetic expressions built from numbers, the binary operators
 * `+ - * / % ^`, unary `+`/`-`, and parentheses.
 */

/** Grammar rule: additive < multiplicative < unary < power < primary. */
class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  /** additive := multiplicative (('+' | '-') multiplicative)* */
  parseExpression(): number {
    let left = this.parseTerm();
    for (;;) {
      const op = this.peekOperator('+-');
      if (op === '') return left;
      this.pos++;
      const right = this.parseTerm();
      left = op === '+' ? left + right : left - right;
    }
  }

  /** Fails unless every remaining character is whitespace. */
  expectEnd(): void {
    this.skipWhitespace();
    if (this.pos < this.src.length) {
      throw this.error(`Unexpected character '${this.src.charAt(this.pos)}'`);
    }
  }

  /** multiplicative := unary (('*' | '/' | '%') unary)* */
  private parseTerm(): number {
    let left = this.parseUnary();
    for (;;) {
      const op = this.peekOperator('*/%');
      if (op === '') return left;
      this.pos++;
      const right = this.parseUnary();
      if (right === 0 && op !== '*') throw new RangeError('Division by zero');
      left = op === '*' ? left * right : op === '/' ? left / right : left % right;
    }
  }

  /**
   * unary := ('+' | '-') unary | power
   *
   * `^` binds tighter than unary minus, so `-2^2` is -4: the sign applies to
   * the whole power, which parseUnary reaches through parsePower.
   */
  private parseUnary(): number {
    this.skipWhitespace();
    const ch = this.src.charAt(this.pos);
    if (ch === '+' || ch === '-') {
      this.pos++;
      const value = this.parseUnary();
      return ch === '-' ? -value : value;
    }
    return this.parsePower();
  }

  /**
   * power := primary ('^' unary)?
   *
   * The right operand recurses through unary, which makes `^` right
   * associative (`2^3^2` is 512) and allows a signed exponent (`2^-3`).
   */
  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();
    if (this.src.charAt(this.pos) !== '^') return base;
    this.pos++;
    return base ** this.parseUnary();
  }

  /** primary := '(' additive ')' | number */
  private parsePrimary(): number {
    this.skipWhitespace();
    if (this.pos >= this.src.length) throw this.error('Unexpected end of input');

    const ch = this.src.charAt(this.pos);
    if (ch === '(') {
      this.pos++;
      const value = this.parseExpression();
      this.skipWhitespace();
      if (this.src.charAt(this.pos) !== ')') throw this.error("Expected ')'");
      this.pos++;
      return value;
    }
    if (isDigit(ch) || ch === '.') return this.parseNumber();
    throw this.error(`Unexpected character '${ch}'`);
  }

  /** number := digit* ('.' digit*)?, with at least one digit overall. */
  private parseNumber(): number {
    const start = this.pos;
    while (isDigit(this.src.charAt(this.pos))) this.pos++;
    if (this.src.charAt(this.pos) === '.') {
      this.pos++;
      while (isDigit(this.src.charAt(this.pos))) this.pos++;
    }

    const text = this.src.slice(start, this.pos);
    if (text === '.') throw this.error("Unexpected character '.'", start);
    return Number(text);
  }

  /**
   * Returns the next non-whitespace character if it is one of `ops`, or the
   * empty string otherwise. Whitespace is consumed either way, which is safe
   * because trailing whitespace is ignored and errors report the position
   * after it.
   */
  private peekOperator(ops: string): string {
    this.skipWhitespace();
    const ch = this.src.charAt(this.pos);
    return ch !== '' && ops.includes(ch) ? ch : '';
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.src.charAt(this.pos))) this.pos++;
  }

  private error(message: string, position: number = this.pos): SyntaxError {
    return new SyntaxError(`${message} at position ${position}`);
  }
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9' && ch !== '';
}

/**
 * Evaluates an arithmetic expression.
 *
 * @throws {SyntaxError} If the expression is malformed. The message ends with
 * ` at position N`, where N is the index of the offending character, or the
 * input length when the expression ends too early.
 * @throws {RangeError} `Division by zero` if `/` or `%` has a zero divisor.
 */
export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseExpression();
  parser.expectEnd();
  return value;
}
```

Two notes on choices the spec left open:

- **Number text is converted with `Number`,** so `10.` gives 10 and `.5` gives 0.5, while a bare `.` raises a `SyntaxError` at the dot's own index.
- **Exponent notation is not part of the grammar,** so `1e5` fails at position 1 as an unexpected character.

I ran no tests, because you asked for output only and no file writes. The error positions in the spec's five examples are satisfied by construction, not by execution: `2 +` and `(1 + 2` report the input length from the end-of-input and missing-`)` paths, and `1 + )`, empty input and `1 $ 2` report the offending index.
