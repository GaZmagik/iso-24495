export function evaluate(expression: string): number {
  let pos = 0;
  const len = expression.length;

  function skipWhitespace(): void {
    while (pos < len && /\s/.test(expression[pos])) {
      pos++;
    }
  }

  function error(message: string = "Unexpected token"): never {
    skipWhitespace();
    const p = pos < len ? pos : len;
    throw new SyntaxError(`${message} at position ${p}`);
  }

  function parsePrimary(): number {
    skipWhitespace();
    if (pos >= len) {
      error("Unexpected end of input");
    }

    const ch = expression[pos];

    if (ch === '(') {
      pos++;
      const val = parseAdditive();
      skipWhitespace();
      if (pos >= len || expression[pos] !== ')') {
        error("Expected ')'");
      }
      pos++;
      return val;
    }

    const isDigit = ch >= '0' && ch <= '9';
    const isDotWithDigit =
      ch === '.' && pos + 1 < len && expression[pos + 1] >= '0' && expression[pos + 1] <= '9';

    if (isDigit || isDotWithDigit) {
      const startPos = pos;
      let hasDot = false;
      while (pos < len) {
        const c = expression[pos];
        if (c >= '0' && c <= '9') {
          pos++;
        } else if (c === '.' && !hasDot) {
          hasDot = true;
          pos++;
        } else {
          break;
        }
      }
      return Number(expression.slice(startPos, pos));
    }

    error(`Unexpected character '${ch}'`);
  }

  function parsePower(): number {
    const base = parsePrimary();
    skipWhitespace();
    if (pos < len && expression[pos] === '^') {
      pos++;
      const exponent = parseUnary();
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parseUnary(): number {
    skipWhitespace();
    if (pos < len) {
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

  function parseMultiplicative(): number {
    let left = parseUnary();
    while (true) {
      skipWhitespace();
      if (pos >= len) break;
      const op = expression[pos];
      if (op === '*' || op === '/' || op === '%') {
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
      if (pos >= len) break;
      const op = expression[pos];
      if (op === '+' || op === '-') {
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

  const result = parseAdditive();
  skipWhitespace();
  if (pos < len) {
    error(`Unexpected character '${expression[pos]}'`);
  }

  return result;
}
