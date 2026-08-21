/**
 * Evaluates an arithmetic expression and returns its value.
 *
 * Supports `+`, `-`, `*`, `/`, `%` and `^`, unary `+` and `-`, parentheses,
 * and decimal numbers such as `3`, `2.5`, `.5` and `10.`. Whitespace is ignored.
 *
 * @throws SyntaxError if the expression is malformed. The message ends with
 *   ` at position N`, the zero-based index of the offending character, or the
 *   input length when the expression ends too early.
 * @throws RangeError if `/` or `%` is applied to a zero divisor.
 */
export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseSum();
  parser.expectEnd();
  return value;
}

/**
 * A recursive descent parser over the expression grammar, lowest precedence first:
 *
 *   sum     := product (("+" | "-") product)*
 *   product := unary (("*" | "/" | "%") unary)*
 *   unary   := ("-" | "+") unary | power
 *   power   := atom ("^" unary)?          // right associative, and its exponent
 *                                         // may itself be signed, as in 2^-1
 *   atom    := number | "(" sum ")"
 *
 * `power` calls `unary` for its exponent rather than the reverse, which is what
 * makes `^` bind tighter than a leading sign: `-2^2` is -4.
 */
class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parseSum(): number {
    let value = this.parseProduct();
    for (;;) {
      if (this.take("+")) value += this.parseProduct();
      else if (this.take("-")) value -= this.parseProduct();
      else return value;
    }
  }

  /** Throws unless the whole input has been consumed. */
  expectEnd(): void {
    this.skipWhitespace();
    if (this.pos < this.text.length) this.fail("end of input");
  }

  private parseProduct(): number {
    let value = this.parseUnary();
    for (;;) {
      if (this.take("*")) value *= this.parseUnary();
      else if (this.take("/")) value = divide(value, this.parseUnary());
      else if (this.take("%")) value = remainder(value, this.parseUnary());
      else return value;
    }
  }

  private parseUnary(): number {
    if (this.take("-")) return -this.parseUnary();
    if (this.take("+")) return this.parseUnary();
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parseAtom();
    if (this.take("^")) return base ** this.parseUnary();
    return base;
  }

  private parseAtom(): number {
    if (this.take("(")) {
      const value = this.parseSum();
      if (!this.take(")")) this.fail('")"');
      return value;
    }
    this.skipWhitespace();
    const char = this.text[this.pos];
    if (isDigit(char) || char === ".") return this.readNumber();
    this.fail('a number or "("');
  }

  private readNumber(): number {
    const start = this.pos;
    while (isDigit(this.text[this.pos])) this.pos++;
    if (this.text[this.pos] === ".") this.pos++;
    while (isDigit(this.text[this.pos])) this.pos++;

    const digits = this.text.slice(start, this.pos);
    // A bare "." is the one shape that reaches here without any digit.
    if (digits === ".") {
      this.pos = start;
      this.fail("a number");
    }
    return Number(digits);
  }

  /** Consumes `symbol` if it is next, and reports whether it was. */
  private take(symbol: string): boolean {
    // Whitespace is ignored everywhere, so every read steps over it first.
    this.skipWhitespace();
    if (this.text[this.pos] !== symbol) return false;
    this.pos++;
    return true;
  }

  private skipWhitespace(): void {
    while (isWhitespace(this.text[this.pos])) this.pos++;
  }

  private fail(expected: string): never {
    const found =
      this.pos < this.text.length
        ? JSON.stringify(this.text[this.pos])
        : "end of input";
    throw new SyntaxError(
      `Expected ${expected} but found ${found} at position ${this.pos}`,
    );
  }
}

function divide(dividend: number, divisor: number): number {
  if (divisor === 0) throw new RangeError("Division by zero");
  return dividend / divisor;
}

function remainder(dividend: number, divisor: number): number {
  if (divisor === 0) throw new RangeError("Division by zero");
  return dividend % divisor;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}
