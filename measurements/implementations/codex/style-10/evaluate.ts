class ExpressionParser {
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
    let value = this.parseMultiplication();

    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.position];

      if (operator !== "+" && operator !== "-") {
        return value;
      }

      this.position++;
      const right = this.parseMultiplication();
      value = operator === "+" ? value + right : value - right;
    }
  }

  private parseMultiplication(): number {
    let value = this.parseUnary();

    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.position];

      if (operator !== "*" && operator !== "/" && operator !== "%") {
        return value;
      }

      this.position++;
      const right = this.parseUnary();

      if ((operator === "/" || operator === "%") && right === 0) {
        throw new RangeError("Division by zero");
      }

      if (operator === "*") {
        value *= right;
      } else if (operator === "/") {
        value /= right;
      } else {
        value %= right;
      }
    }
  }

  private parseUnary(): number {
    this.skipWhitespace();
    const operator = this.input[this.position];

    if (operator === "+" || operator === "-") {
      this.position++;
      const value = this.parseUnary();
      return operator === "-" ? -value : value;
    }

    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();

    if (this.input[this.position] !== "^") {
      return base;
    }

    this.position++;
    const exponent = this.parseUnary();
    return base ** exponent;
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    if (this.position >= this.input.length) {
      this.fail(this.input.length);
    }

    if (this.input[this.position] === "(") {
      this.position++;
      const value = this.parseAddition();
      this.skipWhitespace();

      if (this.input[this.position] !== ")") {
        this.fail(this.position);
      }

      this.position++;
      return value;
    }

    const remainder = this.input.slice(this.position);
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(remainder);

    if (!match) {
      this.fail(this.position);
    }

    this.position += match[0].length;
    return Number(match[0]);
  }

  private skipWhitespace(): void {
    while (
      this.position < this.input.length &&
      /\s/.test(this.input[this.position])
    ) {
      this.position++;
    }
  }

  private fail(position: number): never {
    throw new SyntaxError(`Invalid expression at position ${position}`);
  }
}

export function evaluate(expression: string): number {
  return new ExpressionParser(expression).parse();
}
