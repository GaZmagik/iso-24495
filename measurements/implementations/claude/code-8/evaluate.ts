const WHITESPACE = /\s/;

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function syntaxError(problem: string, index: number): SyntaxError {
  return new SyntaxError(`${problem} at position ${index}`);
}

function applyProduct(operator: string, left: number, right: number): number {
  if (operator === "*") {
    return left * right;
  }
  if (right === 0) {
    throw new RangeError("Division by zero");
  }
  return operator === "/" ? left / right : left % right;
}

/**
 * Evaluates an arithmetic expression built from numbers, `+`, `-`, `*`, `/`,
 * `%`, `^` and parentheses.
 *
 * Throws a `SyntaxError` for malformed input and a `RangeError` for division
 * or remainder by zero.
 */
export function evaluate(expression: string): number {
  let position = 0;

  const result = parseSum();
  const trailing = peek();
  if (trailing !== "") {
    throw syntaxError(`Unexpected character "${trailing}"`, position);
  }
  return result;

  // Whitespace is ignored anywhere, so every read steps over it first.
  function peek(): string {
    while (WHITESPACE.test(expression.charAt(position))) {
      position += 1;
    }
    return expression.charAt(position);
  }

  function parseSum(): number {
    let value = parseProduct();
    let operator = peek();
    while (operator === "+" || operator === "-") {
      position += 1;
      const right = parseProduct();
      value = operator === "+" ? value + right : value - right;
      operator = peek();
    }
    return value;
  }

  function parseProduct(): number {
    let value = parseUnary();
    let operator = peek();
    while (operator === "*" || operator === "/" || operator === "%") {
      position += 1;
      value = applyProduct(operator, value, parseUnary());
      operator = peek();
    }
    return value;
  }

  function parseUnary(): number {
    const operator = peek();
    if (operator === "-" || operator === "+") {
      position += 1;
      const value = parseUnary();
      return operator === "-" ? -value : value;
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parseAtom();
    if (peek() !== "^") {
      return base;
    }
    position += 1;
    // Right associative, and the exponent carries any sign of its own: 2^-3.
    return base ** parseUnary();
  }

  function parseAtom(): number {
    const char = peek();
    if (char === "(") {
      position += 1;
      const value = parseSum();
      if (peek() !== ")") {
        throw syntaxError('Expected ")"', position);
      }
      position += 1;
      return value;
    }
    if (isDigit(char) || char === ".") {
      return parseNumber();
    }
    if (char === "") {
      throw syntaxError("Unexpected end of input", position);
    }
    throw syntaxError(`Unexpected character "${char}"`, position);
  }

  function parseNumber(): number {
    const start = position;
    while (isDigit(expression.charAt(position))) {
      position += 1;
    }
    if (expression.charAt(position) === ".") {
      position += 1;
      while (isDigit(expression.charAt(position))) {
        position += 1;
      }
    }
    const text = expression.slice(start, position);
    if (text === ".") {
      throw syntaxError('Unexpected character "."', start);
    }
    return Number(text);
  }
}
