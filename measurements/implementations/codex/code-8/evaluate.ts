type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "^";
type UnaryOperator = "+" | "-";

type ExpressionNode =
  | { kind: "number"; value: number }
  | { kind: "unary"; operator: UnaryOperator; operand: ExpressionNode }
  | {
      kind: "binary";
      operator: BinaryOperator;
      left: ExpressionNode;
      right: ExpressionNode;
    };

class Parser {
  private position = 0;

  constructor(private readonly expression: string) {}

  parse(): ExpressionNode {
    const result = this.parseAdditive();
    this.skipWhitespace();

    if (this.position < this.expression.length) {
      this.fail("Unexpected character");
    }

    return result;
  }

  private parseAdditive(): ExpressionNode {
    let left = this.parseMultiplicative();

    while (true) {
      if (this.consume("+")) {
        left = this.binary("+", left, this.parseMultiplicative());
      } else if (this.consume("-")) {
        left = this.binary("-", left, this.parseMultiplicative());
      } else {
        return left;
      }
    }
  }

  private parseMultiplicative(): ExpressionNode {
    let left = this.parseUnary();

    while (true) {
      if (this.consume("*")) {
        left = this.binary("*", left, this.parseUnary());
      } else if (this.consume("/")) {
        left = this.binary("/", left, this.parseUnary());
      } else if (this.consume("%")) {
        left = this.binary("%", left, this.parseUnary());
      } else {
        return left;
      }
    }
  }

  private parseUnary(): ExpressionNode {
    if (this.consume("+")) {
      return {
        kind: "unary",
        operator: "+",
        operand: this.parseUnary(),
      };
    }

    if (this.consume("-")) {
      return {
        kind: "unary",
        operator: "-",
        operand: this.parseUnary(),
      };
    }

    return this.parsePower();
  }

  private parsePower(): ExpressionNode {
    const left = this.parsePrimary();

    if (this.consume("^")) {
      return this.binary("^", left, this.parseUnary());
    }

    return left;
  }

  private parsePrimary(): ExpressionNode {
    this.skipWhitespace();

    if (this.consume("(")) {
      const inner = this.parseAdditive();

      if (!this.consume(")")) {
        this.fail("Expected ')'");
      }

      return inner;
    }

    const character = this.expression[this.position];

    if (this.isDigit(character) || character === ".") {
      return this.parseNumber();
    }

    this.fail("Expected a number or '('");
  }

  private parseNumber(): ExpressionNode {
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
      this.position = start;
      this.fail("Invalid number");
    }

    return {
      kind: "number",
      value: Number(this.expression.slice(start, this.position)),
    };
  }

  private binary(
    operator: BinaryOperator,
    left: ExpressionNode,
    right: ExpressionNode,
  ): ExpressionNode {
    return { kind: "binary", operator, left, right };
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
    return (
      character !== undefined && character >= "0" && character <= "9"
    );
  }

  private fail(message: string): never {
    throw new SyntaxError(`${message} at position ${this.position}`);
  }
}

function evaluateNode(node: ExpressionNode): number {
  if (node.kind === "number") {
    return node.value;
  }

  if (node.kind === "unary") {
    const value = evaluateNode(node.operand);
    return node.operator === "-" ? -value : value;
  }

  const left = evaluateNode(node.left);
  const right = evaluateNode(node.right);

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
      return left ** right;
  }
}

export function evaluate(expression: string): number {
  return evaluateNode(new Parser(expression).parse());
}
