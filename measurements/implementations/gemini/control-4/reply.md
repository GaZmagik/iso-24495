```typescript
export function evaluate(expression: string): number {
  let pos = 0;

  function skipWhitespace(): void {
    while (pos < expression.length && /\s/.test(expression[pos])) {
      pos++;
    }
  }

  function parseNumber(): number {
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
      pos = start;
      if (pos >= expression.length) {
        throw new SyntaxError(`Unexpected end of input at position ${pos}`);
      }
      throw new SyntaxError(`Unexpected character '${expression[pos]}' at position ${pos}`);
    }

    return Number(expression.slice(start, pos));
  }

  function parsePrimary(): number {
    skipWhitespace();
    if (pos >= expression.length) {
      throw new SyntaxError(`Unexpected end of input at position ${pos}`);
    }

    if (expression[pos] === '(') {
      pos++;
      const value = parseAdd();
      skipWhitespace();
      if (pos >= expression.length || expression[pos] !== ')') {
        throw new SyntaxError(`Expected ')' at position ${pos}`);
      }
      pos++;
      return value;
    }

    const ch = expression[pos];
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      return parseNumber();
    }

    throw new SyntaxError(`Unexpected character '${ch}' at position ${pos}`);
  }

  function parsePower(): number {
    const left = parsePrimary();
    skipWhitespace();
    if (pos < expression.length && expression[pos] === '^') {
      pos++;
      const right = parseUnary();
      return Math.pow(left, right);
    }
    return left;
  }

  function parseUnary(): number {
    skipWhitespace();
    if (pos < expression.length) {
      if (expression[pos] === '+') {
        pos++;
        return parseUnary();
      }
      if (expression[pos] === '-') {
        pos++;
        return -parseUnary();
      }
    }
    return parsePower();
  }

  function parseMul(): number {
    let left = parseUnary();
    while (true) {
      skipWhitespace();
      if (
        pos < expression.length &&
        (expression[pos] === '*' || expression[pos] === '/' || expression[pos] === '%')
      ) {
        const op = expression[pos];
        pos++;
        const right = parseUnary();
        if (op === '/') {
          if (right === 0) {
            throw new RangeError('Division by zero');
          }
          left = left / right;
        } else if (op === '%') {
          if (right === 0) {
            throw new RangeError('Division by zero');
          }
          left = left % right;
        } else {
          left = left * right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parseAdd(): number {
    let left = parseMul();
    while (true) {
      skipWhitespace();
      if (pos < expression.length && (expression[pos] === '+' || expression[pos] === '-')) {
        const op = expression[pos];
        pos++;
        const right = parseMul();
        left = op === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  }

  const result = parseAdd();
  skipWhitespace();
  if (pos < expression.length) {
    throw new SyntaxError(`Unexpected character '${expression[pos]}' at position ${pos}`);
  }

  return result;
}
```
