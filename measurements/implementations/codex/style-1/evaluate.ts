export function evaluate(expression: string): number {
  return new Parser(expression).evaluate();
}

class Parser {
  private position = 0;

  constructor(private readonly expression: string) {}

  evaluate(): number {
    this.skipWhitespace();

    if (this.position === this.expression.length) {
      this.fail();
    }

    const result = this.parseAddition();
    this.skipWhitespace();

    if (this.position !== this.expression.length) {
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
      const value = this.parseAddition();

      if (!this.consume(")")) {
        this.fail();
      }

      return value;
    }

    const character = this.expression[this.position];

    if (this.isDigit(character) || character === ".") {
      return this.parseNumber();
    }

    this.fail();
  }

  private parseNumber(): number {
    const start = this.position;
    let hasDigit = false;

    while (this.isDigit(this.expression[this.position])) {
      hasDigit = true;
      this.position++;
    }

    if (this.expression[this.position] === ".") {
      this.position++;

      while (this.isDigit(this.expression[this.position])) {
        hasDigit = true;
        this.position++;
      }
    }

    if (!hasDigit) {
      this.fail(start);
    }

    return Number(this.expression.slice(start, this.position));
  }

  private consume(expected: string): boolean {
    this.skipWhitespace();

    if (this.expression[this.position] !== expected) {
      return false;
    }

    this.position++;
    return true;
  }

  private skipWhitespace(): void {
    while (
      this.position < this.expression.length &&
      /\s/.test(this.expression[this.position])
    ) {
      this.position++;
    }
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  private fail(position = this.position): never {
    throw new SyntaxError(`Invalid expression at position ${position}`);
  }
}
