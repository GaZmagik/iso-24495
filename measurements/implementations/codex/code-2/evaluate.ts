export function evaluate(expression: string): number {
  let position = 0;

  function skipWhitespace(): void {
    while (position < expression.length && /\s/.test(expression[position])) {
      position++;
    }
  }

  function fail(message: string, errorPosition = position): never {
    throw new SyntaxError(`${message} at position ${errorPosition}`);
  }

  function consume(character: string): boolean {
    skipWhitespace();

    if (expression[position] !== character) {
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
      fail("Expected a number", start);
    }

    return Number(expression.slice(start, position));
  }

  function parsePrimary(): number {
    skipWhitespace();

    if (position >= expression.length) {
      fail("Unexpected end of expression");
    }

    if (consume("(")) {
      const value = parseAdditive();
      skipWhitespace();

      if (!consume(")")) {
        fail("Expected ')'");
      }

      return value;
    }

    const character = expression[position];

    if (isDigit(character) || character === ".") {
      return parseNumber();
    }

    fail(`Unexpected character '${character}'`);
  }

  function parsePower(): number {
    const base = parsePrimary();

    if (consume("^")) {
      return Math.pow(base, parseUnary());
    }

    return base;
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

  function parseMultiplicative(): number {
    let value = parseUnary();

    while (true) {
      if (consume("*")) {
        value *= parseUnary();
        continue;
      }

      if (consume("/")) {
        const divisorPosition = position;
        const divisor = parseUnary();

        if (divisor === 0) {
          throw new RangeError("Division by zero");
        }

        value /= divisor;
        continue;
      }

      if (consume("%")) {
        const divisorPosition = position;
        const divisor = parseUnary();

        if (divisor === 0) {
          throw new RangeError("Division by zero");
        }

        value %= divisor;
        continue;
      }

      return value;
    }
  }

  function parseAdditive(): number {
    let value = parseMultiplicative();

    while (true) {
      if (consume("+")) {
        value += parseMultiplicative();
        continue;
      }

      if (consume("-")) {
        value -= parseMultiplicative();
        continue;
      }

      return value;
    }
  }

  function isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  const result = parseAdditive();
  skipWhitespace();

  if (position !== expression.length) {
    fail(`Unexpected character '${expression[position]}'`);
  }

  return result;
}
