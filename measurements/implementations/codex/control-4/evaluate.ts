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
    const expression = this.parseAdditive();
    this.skipWhitespace();

    if (this.position !== this.input.length) {
      this.fail(this.position);
    }

    return expression;
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();

    while (true) {
      const operator = this.match("+") ? "+" : this.match("-") ? "-" : null;
      if (operator === null) {
        return left;
      }

      left = {
        kind: "binary",
        operator,
        left,
        right: this.parseMultiplicative(),
      };
    }
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();

    while (true) {
      let operator: "*" | "/" | "%" | null = null;

      if (this.match("*")) {
        operator = "*";
      } else if (this.match("/")) {
        operator = "/";
      } else if (this.match("%")) {
        operator = "%";
      }

      if (operator === null) {
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

  private parseUnary(): Node {
    if (this.match("+")) {
      return {
        kind: "unary",
        operator: "+",
        operand: this.parseUnary(),
      };
    }

    if (this.match("-")) {
      return {
        kind: "unary",
        operator: "-",
        operand: this.parseUnary(),
      };
    }

    return this.parsePower();
  }

  private parsePower(): Node {
    const left = this.parsePrimary();

    if (!this.match("^")) {
      return left;
    }

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
      const expression = this.parseAdditive();
      this.skipWhitespace();

      if (this.input[this.position] !== ")") {
        this.fail(this.position);
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
      this.position++;
      hasDigits = true;
    }

    if (this.input[this.position] === ".") {
      this.position++;

      while (this.isDigit(this.input[this.position])) {
        this.position++;
        hasDigits = true;
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

  private match(character: string): boolean {
    this.skipWhitespace();

    if (this.input[this.position] !== character) {
      return false;
    }

    this.position++;
    return true;
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

function evaluateNode(node: Node): number {
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
