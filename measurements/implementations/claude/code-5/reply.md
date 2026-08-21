`SPEC.md` asks for a single-file arithmetic evaluator. Here is `evaluate.ts`.

Design notes, so the grammar mapping is visible: one method per precedence level, `parsePower` recursing into `parseUnary` for right associativity and for `2^-3`, and `parseUnary` recursing into `parsePower` so `-2^2` is `-4`. Positions come from a single index that whitespace-skipping advances, so the reported index is always the first non-space character at fault, or the input length at end of input.

```ts
/**
 * Evaluates an arithmetic expression over the grammar in SPEC.md.
 *
 * Precedence, loosest first: `+` `-`, then `*` `/` `%`, then `^` (right
 * associative). Unary `+` and `-` bind tighter than every binary operator
 * except `^`, so `-2^2` is -4. Parentheses override precedence and
 * whitespace separates tokens without otherwise contributing.
 *
 * @throws SyntaxError for malformed input, with a message ending in
 *   ` at position N`, where N is the zero-based index of the offending
 *   character or the input length when the expression ends too early.
 * @throws RangeError with the message `Division by zero` when `/` or `%`
 *   has a zero divisor.
 */
export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseSum();
  parser.expectEnd();
  return value;
}

const WHITESPACE = /\s/;
const DIGIT = /[0-9]/;

class Parser {
  private readonly source: string;
  private index = 0;

  constructor(source: string) {
    this.source = source;
  }

  /** sum := product (("+" | "-") product)* */
  parseSum(): number {
    let value = this.parseProduct();

    for (let operator = this.peek(); operator === '+' || operator === '-'; operator = this.peek()) {
      this.index += 1;
      const right = this.parseProduct();
      value = operator === '+' ? value + right : value - right;
    }

    return value;
  }

  expectEnd(): void {
    const character = this.peek();
    if (character !== null) {
      throw this.unexpectedCharacter(character);
    }
  }

  /** product := unary (("*" | "/" | "%") unary)* */
  private parseProduct(): number {
    let value = this.parseUnary();

    for (
      let operator = this.peek();
      operator === '*' || operator === '/' || operator === '%';
      operator = this.peek()
    ) {
      this.index += 1;
      const right = this.parseUnary();
      value = applyProduct(operator, value, right);
    }

    return value;
  }

  /** unary := ("+" | "-") unary | power */
  private parseUnary(): number {
    const operator = this.peek();

    if (operator === '+' || operator === '-') {
      this.index += 1;
      const operand = this.parseUnary();
      return operator === '-' ? -operand : operand;
    }

    return this.parsePower();
  }

  /**
   * power := primary ("^" unary)?
   *
   * The exponent recurses into `parseUnary`, which gives both right
   * associativity (`2^3^2` is 512) and a signed exponent (`2^-3`).
   */
  private parsePower(): number {
    const base = this.parsePrimary();

    if (this.peek() !== '^') {
      return base;
    }

    this.index += 1;
    return base ** this.parseUnary();
  }

  /** primary := number | "(" sum ")" */
  private parsePrimary(): number {
    const character = this.peek();

    if (character === null) {
      throw this.unexpectedEnd();
    }

    if (character === '(') {
      this.index += 1;
      const value = this.parseSum();

      if (this.peek() !== ')') {
        throw this.expected(')');
      }

      this.index += 1;
      return value;
    }

    if (DIGIT.test(character) || character === '.') {
      return this.parseNumber();
    }

    throw this.unexpectedCharacter(character);
  }

  /** number := digit* ("." digit*)?, with at least one digit overall */
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
      throw new SyntaxError(`Malformed number "." at position ${start}`);
    }

    return Number(text);
  }

  private skipDigits(): void {
    while (DIGIT.test(this.source.charAt(this.index))) {
      this.index += 1;
    }
  }

  private skipWhitespace(): void {
    while (WHITESPACE.test(this.source.charAt(this.index)) && this.index < this.source.length) {
      this.index += 1;
    }
  }

  /**
   * Returns the next significant character without consuming it, having
   * moved past any whitespace so that `index` points at the character a
   * caller would report as offending.
   */
  private peek(): string | null {
    this.skipWhitespace();
    return this.index < this.source.length ? this.source.charAt(this.index) : null;
  }

  private unexpectedCharacter(character: string): SyntaxError {
    return new SyntaxError(`Unexpected character "${character}" at position ${this.index}`);
  }

  private unexpectedEnd(): SyntaxError {
    return new SyntaxError(`Unexpected end of input at position ${this.source.length}`);
  }

  private expected(character: string): SyntaxError {
    const found =
      this.index < this.source.length ? `"${this.source.charAt(this.index)}"` : 'end of input';
    return new SyntaxError(`Expected "${character}" but found ${found} at position ${this.index}`);
  }
}

function applyProduct(operator: '*' | '/' | '%', left: number, right: number): number {
  if (operator === '*') {
    return left * right;
  }

  if (right === 0) {
    throw new RangeError('Division by zero');
  }

  return operator === '/' ? left / right : left % right;
}
```

Two things I decided that the spec leaves open, both flagged rather than hidden:

- **Whitespace separates tokens.** "Whitespace anywhere is ignored" read literally would make `1 2` evaluate to 12, so I treat spaces as separators: `1 2` is a `SyntaxError` at position 2. Every stated example still holds.
- **A bare `.` is a malformed number,** reported at its own index, since the grammar requires at least one digit.

Not verified: I did not run the code or any tests, because the task was output only. The five error positions in the spec I traced by hand through the parser (3, 6, 4, 0, 2) and each matches.
