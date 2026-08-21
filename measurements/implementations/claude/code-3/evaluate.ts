/**
 * Recursive-descent evaluator for arithmetic expressions.
 *
 * The grammar, loosest binding first:
 *   sum     := product (("+" | "-") product)*
 *   product := unary (("*" | "/" | "%") unary)*
 *   unary   := ("+" | "-") unary | power
 *   power   := primary ("^" unary)?
 *   primary := number | "(" sum ")"
 *
 * `power` takes a `unary` on its right. That is what makes `^` right
 * associative and what lets it bind tighter than a leading sign, so
 * `2^3^2` is 512 and `-2^2` is -4.
 */
export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseSum();
  parser.expectEnd();
  return value;
}

class Parser {
  private readonly text: string;
  private index = 0;

  constructor(text: string) {
    this.text = text;
  }

  parseSum(): number {
    let value = this.parseProduct();
    for (;;) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator === "+") {
        this.index++;
        value += this.parseProduct();
      } else if (operator === "-") {
        this.index++;
        value -= this.parseProduct();
      } else {
        return value;
      }
    }
  }

  expectEnd(): void {
    this.skipWhitespace();
    if (this.index < this.text.length) {
      throw new SyntaxError(
        `Unexpected "${this.peek()}" at position ${this.index}`,
      );
    }
  }

  private parseProduct(): number {
    let value = this.parseUnary();
    for (;;) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator === "*") {
        this.index++;
        value *= this.parseUnary();
      } else if (operator === "/") {
        this.index++;
        value /= this.requireNonZero(this.parseUnary());
      } else if (operator === "%") {
        this.index++;
        value %= this.requireNonZero(this.parseUnary());
      } else {
        return value;
      }
    }
  }

  private parseUnary(): number {
    this.skipWhitespace();
    const operator = this.peek();
    if (operator === "-") {
      this.index++;
      return -this.parseUnary();
    }
    if (operator === "+") {
      this.index++;
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();
    if (this.peek() !== "^") {
      return base;
    }
    this.index++;
    return base ** this.parseUnary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    const character = this.peek();
    if (character === "(") {
      this.index++;
      const value = this.parseSum();
      this.skipWhitespace();
      if (this.peek() !== ")") {
        this.fail(`Expected ")"`);
      }
      this.index++;
      return value;
    }
    if (isDigit(character) || character === ".") {
      return this.readNumber();
    }
    this.fail(`Expected a number or "("`);
  }

  private readNumber(): number {
    const start = this.index;
    this.skipDigits();
    if (this.peek() === ".") {
      this.index++;
      this.skipDigits();
    }
    const digits = this.text.slice(start, this.index);
    if (digits === ".") {
      this.fail("Expected a digit");
    }
    return Number(digits);
  }

  private requireNonZero(divisor: number): number {
    if (divisor === 0) {
      throw new RangeError("Division by zero");
    }
    return divisor;
  }

  private skipDigits(): void {
    while (isDigit(this.peek())) {
      this.index++;
    }
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length && /\s/.test(this.text[this.index])) {
      this.index++;
    }
  }

  private peek(): string | undefined {
    return this.text[this.index];
  }

  /**
   * The position is the index of the offending character, or the input
   * length when the expression ran out, so both cases just report `index`.
   */
  private fail(expectation: string): never {
    const character = this.peek();
    const found =
      character === undefined
        ? "the expression ended"
        : `found "${character}"`;
    throw new SyntaxError(
      `${expectation} but ${found} at position ${this.index}`,
    );
  }
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}
