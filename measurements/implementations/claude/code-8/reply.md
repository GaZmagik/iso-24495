Here is `evaluate.ts`.

```typescript
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
```

**How it works.** A recursive descent parser walks the string with a single cursor, `position`. Each level of the grammar gets one function: `parseSum` for `+` and `-`, `parseProduct` for `*`, `/` and `%`, `parseUnary` for the signs, `parsePower` for `^`, and `parseAtom` for numbers and parentheses.

Two details carry the awkward precedence rules:

- `parseUnary` sits **above** `parsePower`, so `-2^2` negates the result of `2^2` and gives -4.
- `parsePower` recurses into `parseUnary` for its exponent, which makes `^` right associative (`2^3^2` is 512) and lets the exponent take a sign (`2^-3`).

**Error positions.** `peek` skips whitespace before reporting, so `position` always names the first meaningful character. When the string runs out, `peek` returns `""` and `position` equals the input length, which is what the spec asks for on `2 +` and `(1 + 2`.

**Verification status: not run.** You asked for output only, so I wrote no files and executed no tests. I traced the five error cases and the precedence examples from the spec by hand, and each matches. Compiling the file and running the cases is still open.
