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
    const node = this.parseAdditive();
    this.skipWhitespace();

    if (this.position !== this.input.length) {
      this.fail(this.position);
    }

    return node;
  }

  private parseAdditive(): Node {
    let node = this.parseMultiplicative();

    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.position];

      if (operator !== "+" && operator !== "-") {
        return node;
      }

      this.position++;
      node = {
        kind: "binary",
        operator,
        left: node,
        right: this.parseMultiplicative(),
      };
    }
  }

  private parseMultiplicative(): Node {
    let node = this.parseUnary();

    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.position];

      if (operator !== "*" && operator !== "/" && operator !== "%") {
        return node;
      }

      this.position++;
      node = {
        kind: "binary",
        operator,
        left: node,
        right: this.parseUnary(),
      };
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
    return {
      kind: "binary",
      operator: "^",
      left,
      right: this.parseUnary(),
    };
  }

  private parsePrimary(): Node {
    this.skipWhitespace();

    if (this.position >= this.input.length) {
      this.fail(this.input.length);
    }

    if (this.input[this.position] === "(") {
      this.position++;
      const node = this.parseAdditive();
      this.skipWhitespace();

      if (this.input[this.position] !== ")") {
        this.fail(this.position);
      }

      this.position++;
      return node;
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
    throw new SyntaxError(`Invalid expression at position ${position}`);
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
      return left ** right;
  }
}

export function evaluate(expression: string): number {
  return calculate(new Parser(expression).parse());
}
