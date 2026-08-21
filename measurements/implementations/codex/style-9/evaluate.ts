export function evaluate(expression: string): number {
  return new Parser(expression).evaluate();
}

class Parser {
  private position = 0;

  constructor(private readonly input: string) {}

  evaluate(): number {
    const result = this.parseAddition();
    this.skipWhitespace();

    if (this.position !== this.input.length) {
      this.fail();
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
      this.fail();
    }

    if (this.input[this.position] === "(") {
      this.position++;
      const result = this.parseAddition();

      if (!this.consume(")")) {
        this.fail();
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

    while (this.isDigit(this.input[this.position])) {
      hasIntegerDigits = true;
      this.position++;
    }

    if (this.input[this.position] === ".") {
      this.position++;

      while (this.isDigit(this.input[this.position])) {
        hasFractionDigits = true;
        this.position++;
      }
    }

    if (!hasIntegerDigits && !hasFractionDigits) {
      this.position = start;
      this.fail();
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

  private fail(): never {
    throw new SyntaxError(`Invalid expression at position ${this.position}`);
  }
}
