export function evaluate(expression: string): number {
  type TokenType = 'NUMBER' | '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' | 'EOF';

  interface Token {
    type: TokenType;
    value?: number;
    pos: number;
  }

  function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const len = input.length;

    while (i < len) {
      const c = input[i];

      if (/\s/.test(c)) {
        i++;
        continue;
      }

      if (
        c === '+' ||
        c === '-' ||
        c === '*' ||
        c === '/' ||
        c === '%' ||
        c === '^' ||
        c === '(' ||
        c === ')'
      ) {
        tokens.push({ type: c, pos: i });
        i++;
        continue;
      }

      if (/[0-9]/.test(c)) {
        const start = i;
        while (i < len && /[0-9]/.test(input[i])) {
          i++;
        }
        if (i < len && input[i] === '.') {
          i++;
          while (i < len && /[0-9]/.test(input[i])) {
            i++;
          }
        }
        const numStr = input.slice(start, i);
        tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
        continue;
      }

      if (c === '.') {
        const start = i;
        if (i + 1 < len && /[0-9]/.test(input[i + 1])) {
          i++;
          while (i < len && /[0-9]/.test(input[i])) {
            i++;
          }
          const numStr = input.slice(start, i);
          tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
          continue;
        }
        throw new SyntaxError(`Unexpected character '.' at position ${i}`);
      }

      throw new SyntaxError(`Unexpected character '${c}' at position ${i}`);
    }

    tokens.push({ type: 'EOF', pos: len });
    return tokens;
  }

  const tokens = tokenize(expression);
  let current = 0;

  function peek(): Token {
    return tokens[current];
  }

  function next(): Token {
    const token = tokens[current];
    current++;
    return token;
  }

  function parsePrimary(): number {
    const token = peek();
    if (token.type === 'NUMBER') {
      next();
      return token.value!;
    }
    if (token.type === '(') {
      next();
      const val = parseAddSub();
      const closing = peek();
      if (closing.type !== ')') {
        throw new SyntaxError(`Expected ')' at position ${closing.pos}`);
      }
      next();
      return val;
    }
    throw new SyntaxError(`Unexpected token '${token.type}' at position ${token.pos}`);
  }

  function parsePower(): number {
    const left = parsePrimary();
    if (peek().type === '^') {
      next();
      const right = parseUnary();
      return Math.pow(left, right);
    }
    return left;
  }

  function parseUnary(): number {
    if (peek().type === '+') {
      next();
      return +parseUnary();
    }
    if (peek().type === '-') {
      next();
      return -parseUnary();
    }
    return parsePower();
  }

  function parseMulDivMod(): number {
    let left = parseUnary();
    while (peek().type === '*' || peek().type === '/' || peek().type === '%') {
      const op = next().type;
      const right = parseUnary();
      if (op === '*') {
        left = left * right;
      } else if (op === '/') {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left = left / right;
      } else {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left = left % right;
      }
    }
    return left;
  }

  function parseAddSub(): number {
    let left = parseMulDivMod();
    while (peek().type === '+' || peek().type === '-') {
      const op = next().type;
      const right = parseMulDivMod();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }
    return left;
  }

  const result = parseAddSub();
  const remaining = peek();
  if (remaining.type !== 'EOF') {
    throw new SyntaxError(`Unexpected token '${remaining.type}' at position ${remaining.pos}`);
  }

  return result;
}
