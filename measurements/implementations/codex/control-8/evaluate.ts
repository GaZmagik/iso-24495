export function evaluate(expression: string): number {
  let position = 0;

  function skipWhitespace(): void {
    while (position < expression.length && /\s/.test(expression[position])) {
      position++;
    }
  }

  function syntaxError(at: number = position): never {
    throw new SyntaxError(`Invalid expression at position ${at}`);
  }

  function parseNumber(): number {
    skipWhitespace();

    const start = position;
    let hasDigits = false;

    while (position < expression.length && isDigit(expression[position])) {
      hasDigits = true;
      position++;
    }

    if (expression[position] === ".") {
      position++;

      while (position < expression.length && isDigit(expression[position])) {
        hasDigits = true;
        position++;
      }
    }

    if (!hasDigits) {
      syntaxError(start);
    }

    return Number(expression.slice(start, position));
  }

  function parsePrimary(): number {
    skipWhitespace();

    if (expression[position] === "(") {
      position++;
      const value = parseAdditive();
      skipWhitespace();

      if (expression[position] !== ")") {
        syntaxError();
      }

      position++;
      return value;
    }

    return parseNumber();
  }

  function parsePower(): number {
    const base = parsePrimary();
    skipWhitespace();

    if (expression[position] === "^") {
      position++;
      const exponent = parseUnary();
      return base ** exponent;
    }

    return base;
  }

  function parseUnary(): number {
    skipWhitespace();

    if (expression[position] === "+") {
      position++;
      return parseUnary();
    }

    if (expression[position] === "-") {
      position++;
      return -parseUnary();
    }

    return parsePower();
  }

  function parseMultiplicative(): number {
    let value = parseUnary();

    while (true) {
      skipWhitespace();
      const operator = expression[position];

      if (operator !== "*" && operator !== "/" && operator !== "%") {
        return value;
      }

      position++;
      const right = parseUnary();

      if ((operator === "/" || operator === "%") && right === 0) {
        throw new RangeError("Division by zero");
      }

      if (operator === "*") {
        value *= right;
      } else if (operator === "/") {
        value /= right;
      } else {
        value %= right;
      }
    }
  }

  function parseAdditive(): number {
    let value = parseMultiplicative();

    while (true) {
      skipWhitespace();
      const operator = expression[position];

      if (operator !== "+" && operator !== "-") {
        return value;
      }

      position++;
      const right = parseMultiplicative();
      value = operator === "+" ? value + right : value - right;
    }
  }

  function isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  const result = parseAdditive();
  skipWhitespace();

  if (position !== expression.length) {
    syntaxError();
  }

  return result;
}
