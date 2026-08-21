export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}

class Parser {
  private position = 0;

  constructor(private readonly input: string) {}

  parse(): number {
    const result = this.parseAddition();
    this.skipWhitespace();

    if (this.position !== this.input.length) {
      this.fail(this.position);
    }

    return result;
  }

  private parseAddition(): number {
    let result = this.parseMultiplication();

    while (true) {
      if (this.match("+")) {
        result += this.parseMultiplication();
      } else if (this.match("-")) {
        result -= this.parseMultiplication();
      } else {
        return result;
      }
    }
  }

  private parseMultiplication(): number {
    let result = this.parseUnary();

    while (true) {
      if (this.match("*")) {
        result *= this.parseUnary();
      } else if (this.match("/")) {
        const divisor = this.parseUnary();

        if (divisor === 0) {
          throw new RangeError("Division by zero");
        }

        result /= divisor;
      } else if (this.match("%")) {
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
    if (this.match("+")) {
      return this.parseUnary();
    }

    if (this.match("-")) {
      return -this.parseUnary();
    }

    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();

    if (this.match("^")) {
      return Math.pow(base, this.parseUnary());
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
      const result = this.parseAddition();
      this.skipWhitespace();

      if (this.input[this.position] !== ")") {
        this.fail(this.position);
      }

      this.position++;
      return result;
    }

    return this.parseNumber();
  }

  private parseNumber(): number {
    const start = this.position;
    let hasDigits = false;

    while (this.isDigit(this.input[this.position])) {
      this.position++;
      hasDigits = true;
    }

    if (this.input[this.position] === ".") {
      this.position++;

      while (this.isDigit(this.input[this.position])) {
        this.position++;
        hasDigits = true;
      }
    }

    if (!hasDigits) {
      this.fail(start);
    }

    return Number(this.input.slice(start, this.position));
  }

  private match(operator: string): boolean {
    this.skipWhitespace();

    if (this.input[this.position] !== operator) {
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
