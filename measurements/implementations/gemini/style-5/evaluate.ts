export function evaluate(expression: string): number {
  let pos = 0;
  const len = expression.length;

  function skipWhitespace(): void {
    while (pos < len && /\s/.test(expression[pos])) {
      pos++;
    }
  }

  function syntaxError(atPos: number = pos): never {
    throw new SyntaxError(`Invalid syntax at position ${atPos}`);
  }

  function parsePrimary(): number {
    skipWhitespace();
    if (pos >= len) {
      syntaxError(pos);
    }

    if (expression[pos] === '(') {
      pos++;
      const val = parseExpression();
      skipWhitespace();
      if (pos >= len || expression[pos] !== ')') {
        syntaxError(pos);
      }
      pos++;
      return val;
    }

    const start = pos;
    let hasDigits = false;

    while (pos < len && expression[pos] >= '0' && expression[pos] <= '9') {
      hasDigits = true;
      pos++;
    }

    if (pos < len && expression[pos] === '.') {
      pos++;
      while (pos < len && expression[pos] >= '0' && expression[pos] <= '9') {
        hasDigits = true;
        pos++;
      }
    }

    if (!hasDigits) {
      syntaxError(start);
    }

    return Number(expression.slice(start, pos));
  }

  function parsePower(): number {
    const left = parsePrimary();
    skipWhitespace();
    if (pos < len && expression[pos] === '^') {
      pos++;
      const right = parseUnary();
      return left ** right;
    }
    return left;
  }

  function parseUnary(): number {
    skipWhitespace();
    if (pos >= len) {
      syntaxError(pos);
    }
    if (expression[pos] === '+') {
      pos++;
      return parseUnary();
    }
    if (expression[pos] === '-') {
      pos++;
      return -parseUnary();
    }
    return parsePower();
  }

  function parseMultiplicative(): number {
    let left = parseUnary();
    while (true) {
      skipWhitespace();
      if (pos < len && (expression[pos] === '*' || expression[pos] === '/' || expression[pos] === '%')) {
        const op = expression[pos];
        pos++;
        const right = parseUnary();
        if (op === '*') {
          left = left * right;
        } else if (op === '/') {
          if (right === 0) {
            throw new RangeError("Division by zero");
          }
          left = left / right;
        } else {
          if (right === 0) {
            throw new RangeError("Division by zero");
          }
          left = left % right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parseAdditive(): number {
    let left = parseMultiplicative();
    while (true) {
      skipWhitespace();
      if (pos < len && (expression[pos] === '+' || expression[pos] === '-')) {
        const op = expression[pos];
        pos++;
        const right = parseMultiplicative();
        if (op === '+') {
          left = left + right;
        } else {
          left = left - right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parseExpression(): number {
    return parseAdditive();
  }

  const result = parseExpression();
  skipWhitespace();
  if (pos < len) {
    syntaxError(pos);
  }
  return result;
}
