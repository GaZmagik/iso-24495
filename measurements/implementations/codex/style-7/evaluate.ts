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

  function syntaxError(message: string, errorPosition = position): never {
    throw new SyntaxError(`${message} at position ${errorPosition}`);
  }

  function parseNumber(): Node {
    skipWhitespace();

    const start = position;
    let hasDigits = false;

    while (position < expression.length && isDigit(expression[position])) {
      position++;
      hasDigits = true;
    }

    if (expression[position] === ".") {
      position++;

      while (position < expression.length && isDigit(expression[position])) {
        position++;
        hasDigits = true;
      }
    }

    if (!hasDigits) {
      if (position >= expression.length) {
        syntaxError("Unexpected end of input", expression.length);
      }

      syntaxError(`Unexpected character '${expression[position]}'`, position);
    }

    return {
      kind: "number",
      value: Number(expression.slice(start, position)),
    };
  }

  function parsePrimary(): Node {
    skipWhitespace();

    if (position >= expression.length) {
      syntaxError("Unexpected end of input", expression.length);
    }

    if (expression[position] === "(") {
      position++;
      const node = parseAdditive();
      skipWhitespace();

      if (expression[position] !== ")") {
        if (position >= expression.length) {
          syntaxError("Expected ')'", expression.length);
        }

        syntaxError("Expected ')'", position);
      }

      position++;
      return node;
    }

    return parseNumber();
  }

  function parsePower(): Node {
    const left = parsePrimary();
    skipWhitespace();

    if (expression[position] !== "^") {
      return left;
    }

    position++;

    return {
      kind: "binary",
      operator: "^",
      left,
      right: parseUnary(),
    };
  }

  function parseUnary(): Node {
    skipWhitespace();

    const operator = expression[position];
    if (operator === "+" || operator === "-") {
      position++;

      return {
        kind: "unary",
        operator,
        operand: parseUnary(),
      };
    }

    return parsePower();
  }

  function parseMultiplicative(): Node {
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

  function parseAdditive(): Node {
    let node = parseMultiplicative();

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
        right: parseMultiplicative(),
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
        return left ** right;
    }
  }

  function isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  const tree = parseAdditive();
  skipWhitespace();

  if (position < expression.length) {
    syntaxError(`Unexpected character '${expression[position]}'`, position);
  }

  return calculate(tree);
}
