export function evaluate(expression: string): number {
  let position = 0;

  const isDigit = (character: string): boolean =>
    character >= "0" && character <= "9";

  const skipWhitespace = (): void => {
    while (position < expression.length && /\s/u.test(expression[position])) {
      position++;
    }
  };

  const syntaxError = (): never => {
    skipWhitespace();
    throw new SyntaxError(`Unexpected token at position ${position}`);
  };

  const parseNumber = (): number => {
    skipWhitespace();

    const start = position;
    let hasDigit = false;

    while (position < expression.length && isDigit(expression[position])) {
      hasDigit = true;
      position++;
    }

    if (expression[position] === ".") {
      position++;

      while (position < expression.length && isDigit(expression[position])) {
        hasDigit = true;
        position++;
      }
    }

    if (!hasDigit) {
      position = start;
      return syntaxError();
    }

    return Number(expression.slice(start, position));
  };

  const parsePrimary = (): number => {
    skipWhitespace();

    if (position >= expression.length) {
      return syntaxError();
    }

    if (expression[position] === "(") {
      position++;
      const value = parseAddition();
      skipWhitespace();

      if (expression[position] !== ")") {
        return syntaxError();
      }

      position++;
      return value;
    }

    if (isDigit(expression[position]) || expression[position] === ".") {
      return parseNumber();
    }

    return syntaxError();
  };

  const parsePower = (): number => {
    const base = parsePrimary();
    skipWhitespace();

    if (expression[position] === "^") {
      position++;
      const exponent = parseUnary();
      return Math.pow(base, exponent);
    }

    return base;
  };

  const parseUnary = (): number => {
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
  };

  const parseMultiplication = (): number => {
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
  };

  const parseAddition = (): number => {
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
  };

  const result = parseAddition();
  skipWhitespace();

  if (position !== expression.length) {
    return syntaxError();
  }

  return result;
}
