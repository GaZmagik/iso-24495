export function evaluate(expression: string): number {
  let pos = 0;

  function skipWhitespace(): void {
    while (pos < expression.length && /\s/.test(expression[pos])) {
      pos++;
    }
  }

  function error(message: string, position: number = pos): never {
    throw new SyntaxError(`${message} at position ${position}`);
  }

  function parsePrimary(): number {
    skipWhitespace();
    if (pos >= expression.length) {
      error("Unexpected end of input", pos);
    }

    if (expression[pos] === "(") {
      pos++;
      const val = parseAdditive();
      skipWhitespace();
      if (pos >= expression.length || expression[pos] !== ")") {
        error("Expected ')'", pos);
      }
      pos++;
      return val;
    }

    const start = pos;
    let hasDigits = false;

    while (pos < expression.length && expression[pos] >= "0" && expression[pos] <= "9") {
      hasDigits = true;
      pos++;
    }

    if (pos < expression.length && expression[pos] === ".") {
      pos++;
      while (pos < expression.length && expression[pos] >= "0" && expression[pos] <= "9") {
        hasDigits = true;
        pos++;
      }
    }

    if (!hasDigits) {
      error(`Unexpected token '${expression[start]}'`, start);
    }

    return Number(expression.slice(start, pos));
  }

  function parsePower(): number {
    const left = parsePrimary();
    skipWhitespace();
    if (pos < expression.length && expression[pos] === "^") {
      pos++;
      const right = parseUnary();
      return Math.pow(left, right);
    }
    return left;
  }

  function parseUnary(): number {
    skipWhitespace();
    if (pos >= expression.length) {
      error("Unexpected end of input", pos);
    }

    if (expression[pos] === "+") {
      pos++;
      return +parseUnary();
    }
    if (expression[pos] === "-") {
      pos++;
      return -parseUnary();
    }

    return parsePower();
  }

  function parseMultiplicative(): number {
    let left = parseUnary();
    while (true) {
      skipWhitespace();
      if (pos < expression.length && (expression[pos] === "*" || expression[pos] === "/" || expression[pos] === "%")) {
        const op = expression[pos];
        pos++;
        const right = parseUnary();
        if (op === "*") {
          left = left * right;
        } else if (op === "/") {
          if (right === 0) {
            throw new RangeError("Division by zero");
          }
          left = left / right;
        } else {
          if (right === 0) {
            throw new RangeError("Division by zero");
          }
          left = left % right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parseAdditive(): number {
    let left = parseMultiplicative();
    while (true) {
      skipWhitespace();
      if (pos < expression.length && (expression[pos] === "+" || expression[pos] === "-")) {
        const op = expression[pos];
        pos++;
        const right = parseMultiplicative();
        if (op === "+") {
          left = left + right;
        } else {
          left = left - right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  const result = parseAdditive();
  skipWhitespace();
  if (pos < expression.length) {
    error(`Unexpected token '${expression[pos]}'`, pos);
  }

  return result;
}
