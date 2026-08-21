export function evaluate(expression: string): number {
  let position = 0;

  function skipWhitespace(): void {
    while (position < expression.length && /\s/.test(expression[position])) {
      position++;
    }
  }

  function syntaxError(errorPosition = position): never {
    throw new SyntaxError(`Invalid expression at position ${errorPosition}`);
  }

  function parseExpression(): number {
    return parseAddition();
  }

  function parseAddition(): number {
    let value = parseMultiplication();

    while (true) {
      skipWhitespace();
      const operator = expression[position];

      if (operator !== "+" && operator !== "-") {
        return value;
      }

      position++;
      const right = parseMultiplication();
      value = operator === "+" ? value + right : value - right;
    }
  }

  function parseMultiplication(): number {
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

  function parseUnary(): number {
    skipWhitespace();
    const operator = expression[position];

    if (operator === "+" || operator === "-") {
      position++;
      const value = parseUnary();
      return operator === "-" ? -value : value;
    }

    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();

    skipWhitespace();
    if (expression[position] !== "^") {
      return base;
    }

    position++;
    const exponent = parseUnary();
    return base ** exponent;
  }

  function parsePrimary(): number {
    skipWhitespace();

    if (position >= expression.length) {
      syntaxError(expression.length);
    }

    if (expression[position] === "(") {
      position++;
      const value = parseExpression();
      skipWhitespace();

      if (expression[position] !== ")") {
        syntaxError();
      }

      position++;
      return value;
    }

    return parseNumber();
  }

  function parseNumber(): number {
    skipWhitespace();
    const start = position;
    let hasIntegerDigits = false;
    let hasFractionDigits = false;

    while (position < expression.length && isDigit(expression[position])) {
      hasIntegerDigits = true;
      position++;
    }

    if (expression[position] === ".") {
      position++;

      while (position < expression.length && isDigit(expression[position])) {
        hasFractionDigits = true;
        position++;
      }
    }

    if (!hasIntegerDigits && !hasFractionDigits) {
      syntaxError(start);
    }

    return Number(expression.slice(start, position));
  }

  function isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= "0" && character <= "9";
  }

  const result = parseExpression();
  skipWhitespace();

  if (position !== expression.length) {
    syntaxError();
  }

  return result;
}
