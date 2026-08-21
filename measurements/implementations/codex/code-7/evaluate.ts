class ExpressionParser {
  private position = 0;

  constructor(private readonly expression: string) {}

  parse(): number {
    const result = this.parseAddition();
    this.skipWhitespace();

    if (this.position < this.expression.length) {
      this.throwSyntaxError(this.position);
    }

    return result;
  }

  private parseAddition(): number {
    let result = this.parseMultiplication();

    while (true) {
      const operator = this.readOperator(["+", "-"]);

      if (operator === null) {
        return result;
      }

      const right = this.parseMultiplication();
      result = operator === "+" ? result + right : result - right;
    }
  }

  private parseMultiplication(): number {
    let result = this.parseUnary();

    while (true) {
      const operator = this.readOperator(["*", "/", "%"]);

      if (operator === null) {
        return result;
      }

      const right = this.parseUnary();

      if ((operator === "/" || operator === "%") && right === 0) {
        throw new RangeError("Division by zero");
      }

      if (operator === "*") {
        result *= right;
      } else if (operator === "/") {
        result /= right;
      } else {
        result %= right;
      }
    }
  }

  private parseUnary(): number {
    const operator = this.readOperator(["+", "-"]);

    if (operator === "+") {
      return this.parseUnary();
    }

    if (operator === "-") {
      return -this.parseUnary();
    }

    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    const operator = this.readOperator(["^"]);

    if (operator === null) {
      return base;
    }

    return base ** this.parseUnary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    if (this.position >= this.expression.length) {
      this.throwSyntaxError(this.expression.length);
    }

    if (this.expression[this.position] === "(") {
      this.position++;
      const result = this.parseAddition();
      this.skipWhitespace();

      if (this.expression[this.position] !== ")") {
        this.throwSyntaxError(this.position);
      }

      this.position++;
      return result;
    }

    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();

    const start = this.position;
    let digitCount = 0;

    while (this.isDigit(this.expression[this.position])) {
      this.position++;
      digitCount++;
    }

    if (this.expression[this.position] === ".") {
      this.position++;

      while (this.isDigit(this.expression[this.position])) {
        this.position++;
        digitCount++;
      }
    }

    if (digitCount === 0) {
      this.throwSyntaxError(start);
    }

    return Number(this.expression.slice(start, this.position));
  }

  private readOperator(operators: readonly string[]): string | null {
    this.skipWhitespace();

    const character = this.expression[this.position];

    if (!operators.includes(character)) {
      return null;
    }

    this.position++;
    return character;
  }

  private skipWhitespace(): void {
    while (this.position < this.expression.length) {
      if (!/\s/.test(this.expression[this.position])) {
        return;
      }

      this.position++;
    }
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  private throwSyntaxError(position: number): never {
    throw new SyntaxError(`Invalid expression at position ${position}`);
  }
}

export function evaluate(expression: string): number {
  return new ExpressionParser(expression).parse();
}
