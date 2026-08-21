export function evaluate(expression: string): number {
  return new ExpressionParser(expression).parse();
}

class ExpressionParser {
  private position = 0;

  constructor(private readonly expression: string) {}

  parse(): number {
    const result = this.parseAdditive();
    this.skipWhitespace();

    if (this.position < this.expression.length) {
      this.throwSyntaxError();
    }

    return result;
  }

  private parseAdditive(): number {
    let result = this.parseMultiplicative();

    while (true) {
      const operator = this.readOperator(["+", "-"]);

      if (operator === undefined) {
        return result;
      }

      const right = this.parseMultiplicative();
      result = operator === "+" ? result + right : result - right;
    }
  }

  private parseMultiplicative(): number {
    let result = this.parseUnary();

    while (true) {
      const operator = this.readOperator(["*", "/", "%"]);

      if (operator === undefined) {
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
    this.skipWhitespace();

    const operator = this.expression[this.position];

    if (operator === "+" || operator === "-") {
      this.position++;
      const value = this.parseUnary();
      return operator === "-" ? -value : value;
    }

    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    const operator = this.readOperator(["^"]);

    if (operator === undefined) {
      return base;
    }

    return base ** this.parseUnary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    if (this.expression[this.position] === "(") {
      this.position++;
      const value = this.parseAdditive();
      this.skipWhitespace();

      if (this.expression[this.position] !== ")") {
        this.throwSyntaxError('Expected ")"');
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

    while (this.isDigit(this.expression[this.position])) {
      this.position++;
      hasDigits = true;
    }

    if (this.expression[this.position] === ".") {
      this.position++;

      while (this.isDigit(this.expression[this.position])) {
        this.position++;
        hasDigits = true;
      }
    }

    if (!hasDigits) {
      this.position = start;
      this.throwSyntaxError();
    }

    return Number(this.expression.slice(start, this.position));
  }

  private readOperator(operators: readonly string[]): string | undefined {
    this.skipWhitespace();

    const operator = this.expression[this.position];

    if (!operators.includes(operator)) {
      return undefined;
    }

    this.position++;
    return operator;
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

  private throwSyntaxError(message?: string): never {
    const description =
      message ??
      (this.position >= this.expression.length
        ? "Unexpected end of expression"
        : `Unexpected character "${this.expression[this.position]}"`);

    throw new SyntaxError(`${description} at position ${this.position}`);
  }
}
