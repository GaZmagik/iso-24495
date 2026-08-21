type Operator = "+" | "-" | "*" | "/" | "%" | "^";

type Expression =
  | { kind: "number"; value: number }
  | { kind: "unary"; operator: "+" | "-"; operand: Expression }
  | {
      kind: "binary";
      operator: Operator;
      left: Expression;
      right: Expression;
    };

class Parser {
  private position = 0;

  constructor(private readonly input: string) {}

  parse(): Expression {
    const expression = this.parseAddition();
    this.skipWhitespace();

    if (this.position < this.input.length) {
      this.fail();
    }

    return expression;
  }

  private parseAddition(): Expression {
    let expression = this.parseMultiplication();

    while (true) {
      const operator = this.consumeOperator("+", "-");

      if (operator === undefined) {
        return expression;
      }

      expression = {
        kind: "binary",
        operator,
        left: expression,
        right: this.parseMultiplication(),
      };
    }
  }

  private parseMultiplication(): Expression {
    let expression = this.parseUnary();

    while (true) {
      const operator = this.consumeOperator("*", "/", "%");

      if (operator === undefined) {
        return expression;
      }

      expression = {
        kind: "binary",
        operator,
        left: expression,
        right: this.parseUnary(),
      };
    }
  }

  private parseUnary(): Expression {
    const operator = this.consumeOperator("+", "-");

    if (operator === undefined) {
      return this.parsePower();
    }

    return {
      kind: "unary",
      operator,
      operand: this.parseUnary(),
    };
  }

  private parsePower(): Expression {
    const left = this.parsePrimary();
    const operator = this.consumeOperator("^");

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

  private parsePrimary(): Expression {
    this.skipWhitespace();

    if (this.input[this.position] === "(") {
      this.position++;
      const expression = this.parseAddition();
      this.skipWhitespace();

      if (this.input[this.position] !== ")") {
        this.fail();
      }

      this.position++;
      return expression;
    }

    return this.parseNumber();
  }

  private parseNumber(): Expression {
    this.skipWhitespace();

    const start = this.position;
    let hasIntegerDigits = false;
    let hasFractionDigits = false;

    while (this.isDigit(this.input[this.position])) {
      hasIntegerDigits = true;
      this.position++;
    }

    if (this.input[this.position] === ".") {
      this.position++;

      while (this.isDigit(this.input[this.position])) {
        hasFractionDigits = true;
        this.position++;
      }
    }

    if (!hasIntegerDigits && !hasFractionDigits) {
      this.position = start;
      this.fail();
    }

    return {
      kind: "number",
      value: Number(this.input.slice(start, this.position)),
    };
  }

  private consumeOperator<T extends Operator>(
    ...operators: T[]
  ): T | undefined {
    this.skipWhitespace();

    const candidate = this.input[this.position] as T;

    if (!operators.includes(candidate)) {
      return undefined;
    }

    this.position++;
    return candidate;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.position] ?? "")) {
      this.position++;
    }
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  private fail(): never {
    throw new SyntaxError(`Invalid expression at position ${this.position}`);
  }
}

function calculate(expression: Expression): number {
  if (expression.kind === "number") {
    return expression.value;
  }

  if (expression.kind === "unary") {
    const value = calculate(expression.operand);
    return expression.operator === "-" ? -value : value;
  }

  const left = calculate(expression.left);
  const right = calculate(expression.right);

  switch (expression.operator) {
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
  return calculate(new Parser(expression).parse());
}
