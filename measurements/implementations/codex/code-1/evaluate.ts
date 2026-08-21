type UnaryOperator = "+" | "-";
type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "^";

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

  constructor(private readonly input: string) {}

  parse(): ExpressionNode {
    const expression = this.parseAddition();
    this.skipWhitespace();

    if (this.position < this.input.length) {
      this.fail("Unexpected character");
    }

    return expression;
  }

  private parseAddition(): ExpressionNode {
    let left = this.parseMultiplication();

    while (true) {
      const operator = this.readOperator(["+", "-"]);
      if (operator === undefined) {
        return left;
      }

      left = {
        kind: "binary",
        operator,
        left,
        right: this.parseMultiplication(),
      };
    }
  }

  private parseMultiplication(): ExpressionNode {
    let left = this.parseUnary();

    while (true) {
      const operator = this.readOperator(["*", "/", "%"]);
      if (operator === undefined) {
        return left;
      }

      left = {
        kind: "binary",
        operator,
        left,
        right: this.parseUnary(),
      };
    }
  }

  private parseUnary(): ExpressionNode {
    this.skipWhitespace();

    const character = this.input[this.position];
    if (character !== "+" && character !== "-") {
      return this.parsePower();
    }

    this.position++;

    return {
      kind: "unary",
      operator: character,
      operand: this.parseUnary(),
    };
  }

  private parsePower(): ExpressionNode {
    const left = this.parsePrimary();
    const operator = this.readOperator(["^"]);

    if (operator === undefined) {
      return left;
    }

    return {
      kind: "binary",
      operator,
      left,
      right: this.parseUnary(),
    };
  }

  private parsePrimary(): ExpressionNode {
    this.skipWhitespace();

    if (this.position >= this.input.length) {
      this.fail("Expected expression");
    }

    if (this.input[this.position] === "(") {
      return this.parseParenthesized();
    }

    return this.parseNumber();
  }

  private parseParenthesized(): ExpressionNode {
    this.position++;
    const expression = this.parseAddition();
    this.skipWhitespace();

    if (this.input[this.position] !== ")") {
      this.fail("Expected ')'");
    }

    this.position++;
    return expression;
  }

  private parseNumber(): ExpressionNode {
    const start = this.position;
    let digitCount = 0;

    while (this.isDigit(this.input[this.position])) {
      this.position++;
      digitCount++;
    }

    if (this.input[this.position] === ".") {
      this.position++;

      while (this.isDigit(this.input[this.position])) {
        this.position++;
        digitCount++;
      }
    }

    if (digitCount === 0) {
      this.position = start;
      this.fail("Expected number");
    }

    return {
      kind: "number",
      value: Number(this.input.slice(start, this.position)),
    };
  }

  private readOperator<T extends BinaryOperator>(
    operators: readonly T[],
  ): T | undefined {
    this.skipWhitespace();

    const character = this.input[this.position] as T;
    if (!operators.includes(character)) {
      return undefined;
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

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  private fail(message: string): never {
    throw new SyntaxError(`${message} at position ${this.position}`);
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
      ensureNonzeroDivisor(right);
      return left / right;
    case "%":
      ensureNonzeroDivisor(right);
      return left % right;
    case "^":
      return left ** right;
  }
}

function ensureNonzeroDivisor(divisor: number): void {
  if (divisor === 0) {
    throw new RangeError("Division by zero");
  }
}

export function evaluate(expression: string): number {
  return calculate(new Parser(expression).parse());
}
