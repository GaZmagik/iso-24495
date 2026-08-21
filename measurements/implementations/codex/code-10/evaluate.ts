class Parser {
  private position = 0;

  constructor(private readonly expression: string) {}

  parse(): number {
    this.skipWhitespace();

    if (this.position === this.expression.length) {
      this.fail(this.position);
    }

    const result = this.parseAddition();
    this.skipWhitespace();

    if (this.position !== this.expression.length) {
      this.fail(this.position);
    }

    return result;
  }

  private parseAddition(): number {
    let result = this.parseMultiplication();

    while (true) {
      if (this.consume("+")) {
        result += this.parseMultiplication();
      } else if (this.consume("-")) {
        result -= this.parseMultiplication();
      } else {
        return result;
      }
    }
  }

  private parseMultiplication(): number {
    let result = this.parseUnary();

    while (true) {
      if (this.consume("*")) {
        result *= this.parseUnary();
      } else if (this.consume("/")) {
        const divisor = this.parseUnary();

        if (divisor === 0) {
          throw new RangeError("Division by zero");
        }

        result /= divisor;
      } else if (this.consume("%")) {
        const divisor = this.parseUnary();

        if (divisor === 0) {
          throw new RangeError("Division by zero");
        }

        result %= divisor;
      } else {
        return result;
      }
    }
  }

  private parseUnary(): number {
    if (this.consume("+")) {
      return this.parseUnary();
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

    if (this.consume("(")) {
      const result = this.parseAddition();

      if (!this.consume(")")) {
        this.fail(this.position);
      }

      return result;
    }

    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();

    const start = this.position;
    let hasIntegerDigits = false;
    let hasFractionDigits = false;

    while (this.isDigit(this.currentCharacter())) {
      hasIntegerDigits = true;
      this.position++;
    }

    if (this.currentCharacter() === ".") {
      this.position++;

      while (this.isDigit(this.currentCharacter())) {
        hasFractionDigits = true;
        this.position++;
      }
    }

    if (!hasIntegerDigits && !hasFractionDigits) {
      this.fail(start);
    }

    return Number(this.expression.slice(start, this.position));
  }

  private consume(expected: string): boolean {
    this.skipWhitespace();

    if (this.currentCharacter() !== expected) {
      return false;
    }

    this.position++;
    return true;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.currentCharacter())) {
      this.position++;
    }
  }

  private currentCharacter(): string {
    return this.expression[this.position] ?? "";
  }

  private isDigit(character: string): boolean {
    return character >= "0" && character <= "9";
  }

  private fail(position: number): never {
    throw new SyntaxError(`Invalid expression at position ${position}`);
  }
}

export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}
