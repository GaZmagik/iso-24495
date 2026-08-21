export function evaluate(expression: string): number {
  let position = 0;
  let divisionByZero = false;

  function skipWhitespace(): void {
    while (position < expression.length && /\s/.test(expression[position])) {
      position++;
    }
  }

  function syntaxError(): never {
    skipWhitespace();
    throw new SyntaxError(`Unexpected token at position ${position}`);
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
        divisionByZero = true;
      }

      switch (operator) {
        case "*":
          value *= right;
          break;
        case "/":
          value /= right;
          break;
        case "%":
          value %= right;
          break;
      }
    }
  }

  function parseUnary(): number {
    skipWhitespace();

    if (expression[position] === "+") {
      position++;
      return +parseUnary();
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
    if (expression[position] === "^") {
      position++;
      return Math.pow(base, parseUnary());
    }

    return base;
  }

  function parsePrimary(): number {
    skipWhitespace();

    if (position >= expression.length) {
      return syntaxError();
    }

    if (expression[position] === "(") {
      position++;
      const value = parseExpression();
      skipWhitespace();

      if (expression[position] !== ")") {
        return syntaxError();
      }

      position++;
      return value;
    }

    return parseNumber();
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
      position = start;
      return syntaxError();
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

  if (divisionByZero) {
    throw new RangeError("Division by zero");
  }

  return result;
}
