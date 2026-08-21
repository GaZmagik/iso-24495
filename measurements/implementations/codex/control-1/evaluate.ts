type ExpressionNode =
  | { kind: "number"; value: number }
  | { kind: "unary"; operator: "+" | "-"; operand: ExpressionNode }
  | {
      kind: "binary";
      operator: "+" | "-" | "*" | "/" | "%" | "^";
      left: ExpressionNode;
      right: ExpressionNode;
    };

class Parser {
  private position = 0;

  constructor(private readonly input: string) {}

  parse(): ExpressionNode {
    const expression = this.parseAddition();
    this.skipWhitespace();

    if (this.position !== this.input.length) {
      this.fail(this.position);
    }

    return expression;
  }

  private parseAddition(): ExpressionNode {
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

  private parseMultiplication(): ExpressionNode {
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

  private parseUnary(): ExpressionNode {
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

  private parsePower(): ExpressionNode {
    const left = this.parsePrimary();
    this.skipWhitespace();

    if (this.input[this.position] !== "^") {
      return left;
    }

    this.position++;
    return {
      kind: "binary",
      operator: "^",
      left,
      right: this.parseUnary(),
    };
  }

  private parsePrimary(): ExpressionNode {
    this.skipWhitespace();

    if (this.position >= this.input.length) {
      this.fail(this.input.length);
    }

    if (this.input[this.position] === "(") {
      this.position++;
      const expression = this.parseAddition();
      this.skipWhitespace();

      if (this.input[this.position] !== ")") {
        this.fail(this.position);
      }

      this.position++;
      return expression;
    }

    return this.parseNumber();
  }

  private parseNumber(): ExpressionNode {
    const start = this.position;
    let digitsBeforeDecimal = 0;
    let digitsAfterDecimal = 0;

    while (this.isDigit(this.input[this.position])) {
      this.position++;
      digitsBeforeDecimal++;
    }

    if (this.input[this.position] === ".") {
      this.position++;

      while (this.isDigit(this.input[this.position])) {
        this.position++;
        digitsAfterDecimal++;
      }
    }

    if (digitsBeforeDecimal === 0 && digitsAfterDecimal === 0) {
      this.fail(start);
    }

    return {
      kind: "number",
      value: Number(this.input.slice(start, this.position)),
    };
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

function calculate(node: ExpressionNode): number {
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
