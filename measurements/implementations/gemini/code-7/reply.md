Here is the complete implementation of `evaluate.ts`.

```typescript
/**
 * Evaluates an arithmetic expression and returns the numeric result.
 *
 * @param expression The mathematical expression to evaluate.
 * @returns The calculated result.
 * @throws {SyntaxError} If the expression is malformed.
 * @throws {RangeError} If the expression divides or modulos by zero.
 */
export function evaluate(expression: string): number {
  let position = 0;
  const length = expression.length;

  function skipWhitespace(): void {
    while (position < length && /\s/.test(expression[position])) {
      position++;
    }
  }

  function isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  function parsePrimary(): number {
    skipWhitespace();
    if (position >= length) {
      throw new SyntaxError(`Unexpected end of expression at position ${position}`);
    }

    const char = expression[position];

    if (char === '(') {
      position++;
      const result = parseAdditive();
      skipWhitespace();
      if (position >= length || expression[position] !== ')') {
        throw new SyntaxError(`Expected ')' at position ${position}`);
      }
      position++;
      return result;
    }

    if (isDigit(char) || (char === '.' && position + 1 < length && isDigit(expression[position + 1]))) {
      const start = position;
      let seenDecimal = false;

      while (position < length) {
        const currentChar = expression[position];
        if (isDigit(currentChar)) {
          position++;
        } else if (currentChar === '.' && !seenDecimal) {
          seenDecimal = true;
          position++;
        } else {
          break;
        }
      }

      return Number(expression.slice(start, position));
    }

    throw new SyntaxError(`Unexpected token '${char}' at position ${position}`);
  }

  function parsePower(): number {
    const base = parsePrimary();
    skipWhitespace();

    if (position < length && expression[position] === '^') {
      position++;
      const exponent = parseUnary();
      return Math.pow(base, exponent);
    }

    return base;
  }

  function parseUnary(): number {
    skipWhitespace();
    if (position < length) {
      const char = expression[position];
      if (char === '+') {
        position++;
        return parseUnary();
      }
      if (char === '-') {
        position++;
        return -parseUnary();
      }
    }

    return parsePower();
  }

  function parseMultiplicative(): number {
    let result = parseUnary();

    while (true) {
      skipWhitespace();
      if (position >= length) {
        break;
      }

      const operator = expression[position];
      if (operator !== '*' && operator !== '/' && operator !== '%') {
        break;
      }

      position++;
      const right = parseUnary();

      if (operator === '*') {
        result = result * right;
      } else if (operator === '/') {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        result = result / right;
      } else {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        result = result % right;
      }
    }

    return result;
  }

  function parseAdditive(): number {
    let result = parseMultiplicative();

    while (true) {
      skipWhitespace();
      if (position >= length) {
        break;
      }

      const operator = expression[position];
      if (operator !== '+' && operator !== '-') {
        break;
      }

      position++;
      const right = parseMultiplicative();

      if (operator === '+') {
        result = result + right;
      } else {
        result = result - right;
      }
    }

    return result;
  }

  skipWhitespace();
  if (position >= length) {
    throw new SyntaxError(`Unexpected end of expression at position ${position}`);
  }

  const result = parseAdditive();
  skipWhitespace();

  if (position < length) {
    throw new SyntaxError(`Unexpected character '${expression[position]}' at position ${position}`);
  }

  return result;
}
```
