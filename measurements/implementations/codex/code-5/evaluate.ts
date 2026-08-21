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
      this.throwSyntaxError(this.position);
    }

    return result;
  }

  private parseAdditive(): number {
    let result = this.parseMultiplicative();

    while (true) {
      this.skipWhitespace();
      const operator = this.expression[this.position];

      if (operator !== "+" && operator !== "-") {
        return result;
      }

      this.position++;
      const right = this.parseMultiplicative();
      result = operator === "+" ? result + right : result - right;
    }
  }

  private parseMultiplicative(): number {
    let result = this.parseUnary();

    while (true) {
      this.skipWhitespace();
      const operator = this.expression[this.position];

      if (operator !== "*" && operator !== "/" && operator !== "%") {
        return result;
      }

      this.position++;
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

    this.skipWhitespace();
    if (this.expression[this.position] !== "^") {
      return base;
    }

    this.position++;
    const exponent = this.parseUnary();
    return base ** exponent;
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    if (this.position >= this.expression.length) {
      this.throwSyntaxError(this.position);
    }

    if (this.expression[this.position] === "(") {
      this.position++;
      const value = this.parseAdditive();
      this.skipWhitespace();

      if (this.expression[this.position] !== ")") {
        this.throwSyntaxError(this.position);
      }

      this.position++;
      return value;
    }

    return this.parseNumber();
  }

  private parseNumber(): number {
    const start = this.position;
    let hasDigits = false;

    while (this.isDigit(this.expression[this.position])) {
      hasDigits = true;
      this.position++;
    }

    if (this.expression[this.position] === ".") {
      this.position++;

      while (this.isDigit(this.expression[this.position])) {
        hasDigits = true;
        this.position++;
      }
    }

    if (!hasDigits) {
      this.throwSyntaxError(start);
    }

    return Number(this.expression.slice(start, this.position));
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.expression[this.position] ?? "")) {
      this.position++;
    }
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  private throwSyntaxError(position: number): never {
    throw new SyntaxError(`Malformed expression at position ${position}`);
  }
}
