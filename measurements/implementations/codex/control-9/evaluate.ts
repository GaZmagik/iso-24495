class Parser {
  private position = 0;

  constructor(private readonly input: string) {}

  parse(): number {
    const result = this.parseAdditive();
    this.skipWhitespace();

    if (this.position !== this.input.length) {
      this.fail(this.position);
    }

    return result;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();

    while (true) {
      if (this.consume("+")) {
        value += this.parseMultiplicative();
      } else if (this.consume("-")) {
        value -= this.parseMultiplicative();
      } else {
        return value;
      }
    }
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();

    while (true) {
      if (this.consume("*")) {
        value *= this.parseUnary();
      } else if (this.consume("/")) {
        const divisor = this.parseUnary();
        if (divisor === 0) {
          throw new RangeError("Division by zero");
        }
        value /= divisor;
      } else if (this.consume("%")) {
        const divisor = this.parseUnary();
        if (divisor === 0) {
          throw new RangeError("Division by zero");
        }
        value %= divisor;
      } else {
        return value;
      }
    }
  }

  private parseUnary(): number {
    if (this.consume("+")) {
      return +this.parseUnary();
    }

    if (this.consume("-")) {
      return -this.parseUnary();
    }

    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();

    if (this.consume("^")) {
      return base ** this.parseUnary();
    }

    return base;
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    if (this.position >= this.input.length) {
      this.fail(this.input.length);
    }

    if (this.input[this.position] === "(") {
      this.position++;
      const value = this.parseAdditive();
      this.skipWhitespace();

      if (this.input[this.position] !== ")") {
        this.fail(this.position);
      }

      this.position++;
      return value;
    }

    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();

    const start = this.position;
    let hasDigits = false;

    while (this.isDigit(this.input[this.position])) {
      hasDigits = true;
      this.position++;
    }

    if (this.input[this.position] === ".") {
      this.position++;

      while (this.isDigit(this.input[this.position])) {
        hasDigits = true;
        this.position++;
      }
    }

    if (!hasDigits) {
      this.fail(start);
    }

    return Number(this.input.slice(start, this.position));
  }

  private consume(character: string): boolean {
    this.skipWhitespace();

    if (this.input[this.position] !== character) {
      return false;
    }

    this.position++;
    return true;
  }

  private skipWhitespace(): void {
    while (
      this.position < this.input.length &&
      /\s/.test(this.input[this.position])
    ) {
      this.position++;
    }
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  private fail(position: number): never {
    throw new SyntaxError(`Malformed expression at position ${position}`);
  }
}

export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}
