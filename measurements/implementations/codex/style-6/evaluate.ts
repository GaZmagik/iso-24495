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

  function consume(expected: string): boolean {
    skipWhitespace();

    if (expression[position] !== expected) {
      return false;
    }

    position++;
    return true;
  }

  function parseNumber(): number {
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
      syntaxError("Expected a number", start);
    }

    return Number(expression.slice(start, position));
  }

  function parsePrimary(): number {
    skipWhitespace();

    if (consume("(")) {
      const value = parseAddition();

      if (!consume(")")) {
        skipWhitespace();
        syntaxError("Expected ')'");
      }

      return value;
    }

    return parseNumber();
  }

  function parsePower(): number {
    const left = parsePrimary();

    if (consume("^")) {
      const right = parseUnary();
      return left ** right;
    }

    return left;
  }

  function parseUnary(): number {
    if (consume("+")) {
      return parseUnary();
    }

    if (consume("-")) {
      return -parseUnary();
    }

    return parsePower();
  }

  function parseMultiplication(): number {
    let value = parseUnary();

    while (true) {
      if (consume("*")) {
        value *= parseUnary();
      } else if (consume("/")) {
        const divisor = parseUnary();

        if (divisor === 0) {
          throw new RangeError("Division by zero");
        }

        value /= divisor;
      } else if (consume("%")) {
        const divisor = parseUnary();

        if (divisor === 0) {
          throw new RangeError("Division by zero");
        }

        value %= divisor;
      } else {
        return value;
      }
    }
  }

  function parseAddition(): number {
    let value = parseMultiplication();

    while (true) {
      if (consume("+")) {
        value += parseMultiplication();
      } else if (consume("-")) {
        value -= parseMultiplication();
      } else {
        return value;
      }
    }
  }

  function isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  const result = parseAddition();
  skipWhitespace();

  if (position !== expression.length) {
    syntaxError("Unexpected character");
  }

  return result;
}
