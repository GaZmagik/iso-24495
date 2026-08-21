Here is the complete implementation of `evaluate.ts`.

```typescript
export function evaluate(expression: string): number {
  let pos = 0;

  function skipWhitespace(): void {
    while (pos < expression.length && /\s/.test(expression[pos])) {
      pos++;
    }
  }

  function error(message: string): never {
    throw new SyntaxError(`${message} at position ${pos}`);
  }

  function parseExpression(): number {
    return parseAddition();
  }

  function parseAddition(): number {
    let left = parseMultiplication();

    while (true) {
      skipWhitespace();
      if (pos >= expression.length) {
        break;
      }

      const op = expression[pos];
      if (op !== '+' && op !== '-') {
        break;
      }

      pos++;
      const right = parseMultiplication();
      left = op === '+' ? left + right : left - right;
    }

    return left;
  }

  function parseMultiplication(): number {
    let left = parseUnary();

    while (true) {
      skipWhitespace();
      if (pos >= expression.length) {
        break;
      }

      const op = expression[pos];
      if (op !== '*' && op !== '/' && op !== '%') {
        break;
      }

      pos++;
      const right = parseUnary();
      if (op === '*') {
        left *= right;
      } else if (op === '/') {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left /= right;
      } else {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left %= right;
      }
    }

    return left;
  }

  function parseUnary(): number {
    skipWhitespace();
    if (pos >= expression.length) {
      error('Unexpected end of input');
    }

    const op = expression[pos];
    if (op === '+' || op === '-') {
      pos++;
      const operand = parseUnary();
      return op === '+' ? operand : -operand;
    }

    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    skipWhitespace();

    if (pos < expression.length && expression[pos] === '^') {
      pos++;
      const exponent = parseUnary();
      return base ** exponent;
    }

    return base;
  }

  function parsePrimary(): number {
    skipWhitespace();
    if (pos >= expression.length) {
      error('Unexpected end of input');
    }

    if (expression[pos] === '(') {
      pos++;
      const value = parseExpression();
      skipWhitespace();
      if (pos >= expression.length || expression[pos] !== ')') {
        error("Expected ')'");
      }
      pos++;
      return value;
    }

    return parseNumber();
  }

  function parseNumber(): number {
    skipWhitespace();
    const start = pos;
    let hasDigits = false;

    while (pos < expression.length && expression[pos] >= '0' && expression[pos] <= '9') {
      hasDigits = true;
      pos++;
    }

    if (pos < expression.length && expression[pos] === '.') {
      pos++;
      while (pos < expression.length && expression[pos] >= '0' && expression[pos] <= '9') {
        hasDigits = true;
        pos++;
      }
    }

    if (!hasDigits) {
      error('Unexpected token');
    }

    return Number(expression.slice(start, pos));
  }

  skipWhitespace();
  if (pos >= expression.length) {
    error('Unexpected end of input');
  }

  const result = parseExpression();
  skipWhitespace();
  if (pos < expression.length) {
    error('Unexpected token');
  }

  return result;
}
```
