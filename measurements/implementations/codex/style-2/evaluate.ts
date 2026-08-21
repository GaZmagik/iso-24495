type Node =
  | { kind: "number"; value: number }
  | { kind: "unary"; operator: "+" | "-"; operand: Node }
  | {
      kind: "binary";
      operator: "+" | "-" | "*" | "/" | "%" | "^";
      left: Node;
      right: Node;
    };

class Parser {
  private position = 0;

  constructor(private readonly input: string) {}

  parse(): Node {
    const expression = this.parseAddition();
    this.skipWhitespace();

    if (this.position < this.input.length) {
      this.fail("Unexpected character", this.position);
    }

    return expression;
  }

  private parseAddition(): Node {
    let left = this.parseMultiplication();

    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.position];

      if (operator !== "+" && operator !== "-") {
        return left;
      }

      this.position++;
      const right = this.parseMultiplication();
      left = { kind: "binary", operator, left, right };
    }
  }

  private parseMultiplication(): Node {
    let left = this.parseUnary();

    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.position];

      if (operator !== "*" && operator !== "/" && operator !== "%") {
        return left;
      }

      this.position++;
      const right = this.parseUnary();
      left = { kind: "binary", operator, left, right };
    }
  }

  private parseUnary(): Node {
    this.skipWhitespace();
    const operator = this.input[this.position];

    if (operator === "+" || operator === "-") {
      this.position++;
      return {
        kind: "unary",
        operator,
        operand: this.parseUnary(),
      };
    }

    return this.parsePower();
  }

  private parsePower(): Node {
    const left = this.parsePrimary();

    this.skipWhitespace();
    if (this.input[this.position] !== "^") {
      return left;
    }

    this.position++;
    const right = this.parseUnary();
    return { kind: "binary", operator: "^", left, right };
  }

  private parsePrimary(): Node {
    this.skipWhitespace();

    if (this.position >= this.input.length) {
      this.fail("Expected expression", this.input.length);
    }

    if (this.input[this.position] === "(") {
      this.position++;
      const expression = this.parseAddition();
      this.skipWhitespace();

      if (this.input[this.position] !== ")") {
        this.fail("Expected ')'", this.position);
      }

      this.position++;
      return expression;
    }

    return this.parseNumber();
  }

  private parseNumber(): Node {
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
      this.fail("Expected number", start);
    }

    return {
      kind: "number",
      value: Number(this.input.slice(start, this.position)),
    };
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.position] ?? "")) {
      this.position++;
    }
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  private fail(message: string, position: number): never {
    throw new SyntaxError(`${message} at position ${position}`);
  }
}

function calculate(node: Node): number {
  if (node.kind === "number") {
    return node.value;
  }

  if (node.kind === "unary") {
    const value = calculate(node.operand);
    return node.operator === "-" ? -value : value;
  }

  const left = calculate(node.left);
  const right = calculate(node.right);

  switch (node.operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      if (right === 0) {
        throw new RangeError("Division by zero");
      }
      return left / right;
    case "%":
      if (right === 0) {
        throw new RangeError("Division by zero");
      }
      return left % right;
    case "^":
      return Math.pow(left, right);
  }
}

export function evaluate(expression: string): number {
  return calculate(new Parser(expression).parse());
}
