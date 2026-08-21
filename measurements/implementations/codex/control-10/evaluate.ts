type Node =
  | { kind: "number"; value: number }
  | { kind: "unary"; operator: "+" | "-"; operand: Node }
  | {
      kind: "binary";
      operator: "+" | "-" | "*" | "/" | "%" | "^";
      left: Node;
      right: Node;
    };

export function evaluate(expression: string): number {
  let position = 0;

  function skipWhitespace(): void {
    while (position < expression.length && /\s/.test(expression[position])) {
      position++;
    }
  }

  function syntaxError(message: string): never {
    throw new SyntaxError(`${message} at position ${position}`);
  }

  function consume(character: string): boolean {
    skipWhitespace();

    if (expression[position] === character) {
      position++;
      return true;
    }

    return false;
  }

  function parseNumber(): Node {
    skipWhitespace();

    const start = position;
    let digitsBeforeDecimal = 0;
    let digitsAfterDecimal = 0;

    while (position < expression.length && /[0-9]/.test(expression[position])) {
      position++;
      digitsBeforeDecimal++;
    }

    if (expression[position] === ".") {
      position++;

      while (position < expression.length && /[0-9]/.test(expression[position])) {
        position++;
        digitsAfterDecimal++;
      }
    }

    if (digitsBeforeDecimal === 0 && digitsAfterDecimal === 0) {
      position = start;
      syntaxError("Expected a number");
    }

    return {
      kind: "number",
      value: Number(expression.slice(start, position)),
    };
  }

  function parsePrimary(): Node {
    skipWhitespace();

    if (consume("(")) {
      const node = parseAddition();

      if (!consume(")")) {
        skipWhitespace();
        syntaxError("Expected ')'");
      }

      return node;
    }

    return parseNumber();
  }

  function parsePower(): Node {
    const left = parsePrimary();

    if (consume("^")) {
      return {
        kind: "binary",
        operator: "^",
        left,
        right: parseUnary(),
      };
    }

    return left;
  }

  function parseUnary(): Node {
    if (consume("+")) {
      return {
        kind: "unary",
        operator: "+",
        operand: parseUnary(),
      };
    }

    if (consume("-")) {
      return {
        kind: "unary",
        operator: "-",
        operand: parseUnary(),
      };
    }

    return parsePower();
  }

  function parseMultiplication(): Node {
    let node = parseUnary();

    while (true) {
      skipWhitespace();
      const operator = expression[position];

      if (operator !== "*" && operator !== "/" && operator !== "%") {
        return node;
      }

      position++;
      node = {
        kind: "binary",
        operator,
        left: node,
        right: parseUnary(),
      };
    }
  }

  function parseAddition(): Node {
    let node = parseMultiplication();

    while (true) {
      skipWhitespace();
      const operator = expression[position];

      if (operator !== "+" && operator !== "-") {
        return node;
      }

      position++;
      node = {
        kind: "binary",
        operator,
        left: node,
        right: parseMultiplication(),
      };
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

  const root = parseAddition();
  skipWhitespace();

  if (position !== expression.length) {
    syntaxError("Unexpected character");
  }

  return calculate(root);
}
