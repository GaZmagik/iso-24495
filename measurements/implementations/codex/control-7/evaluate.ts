class Parser {
  private position = 0;

  constructor(private readonly input: string) {}

  parse(): number {
    const result = this.parseAdditive();
    this.skipWhitespace();

    if (this.position !== this.input.length) {
      this.fail("Unexpected character");
    }

    return result;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();

    while (true) {
      const operator = this.consumeOperator(["+", "-"]);
      if (operator === null) {
        return value;
      }

      const right = this.parseMultiplicative();
      value = operator === "+" ? value + right : value - right;
    }
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();

    while (true) {
      const operator = this.consumeOperator(["*", "/", "%"]);
      if (operator === null) {
        return value;
      }

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

    if (this.input[this.position] === "+") {
      this.position++;
      return this.parseUnary();
    }

    if (this.input[this.position] === "-") {
      this.position++;
      return -this.parseUnary();
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
    return Math.pow(base, exponent);
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    if (this.position >= this.input.length) {
      this.fail("Unexpected end of expression");
    }

    if (this.input[this.position] === "(") {
      this.position++;
      const value = this.parseAdditive();
      this.skipWhitespace();

      if (this.input[this.position] !== ")") {
        this.fail("Expected closing parenthesis");
      }

      this.position++;
      return value;
    }

    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();

    const remaining = this.input.slice(this.position);
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(remaining);

    if (match === null) {
      this.fail("Expected a number");
    }

    this.position += match[0].length;
    return Number(match[0]);
  }

  private consumeOperator(operators: readonly string[]): string | null {
    this.skipWhitespace();

    const character = this.input[this.position];
    if (!operators.includes(character)) {
      return null;
    }

    this.position++;
    return character;
  }

  private skipWhitespace(): void {
    while (
      this.position < this.input.length &&
      /\s/.test(this.input[this.position])
    ) {
      this.position++;
    }
  }

  private fail(message: string): never {
    throw new SyntaxError(`${message} at position ${this.position}`);
  }
}

export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}
