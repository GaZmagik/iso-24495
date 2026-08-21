export function evaluate(expression: string): number {
  let position = 0;

  function skipWhitespace(): void {
    while (position < expression.length && /\s/.test(expression[position])) {
      position++;
    }
  }

  function syntaxError(at: number): never {
    throw new SyntaxError(`Invalid expression at position ${at}`);
  }

  function parseExpression(): number {
    return parseAdditive();
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

  function parsePower(): number {
    const base = parsePrimary();

    skipWhitespace();
    if (expression[position] !== "^") {
      return base;
    }

    position++;
    const exponent = parseUnary();
    return Math.pow(base, exponent);
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
        syntaxError(position);
      }

      position++;
      return value;
    }

    return parseNumber();
  }

  function parseNumber(): number {
    skipWhitespace();
    const start = position;
    let digitsBeforeDecimal = 0;
    let digitsAfterDecimal = 0;

    while (isDigit(expression[position])) {
      position++;
      digitsBeforeDecimal++;
    }

    if (expression[position] === ".") {
      position++;

      while (isDigit(expression[position])) {
        position++;
        digitsAfterDecimal++;
      }
    }

    if (digitsBeforeDecimal === 0 && digitsAfterDecimal === 0) {
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
    syntaxError(position);
  }

  return result;
}
