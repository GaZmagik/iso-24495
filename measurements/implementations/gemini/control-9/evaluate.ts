interface Token {
  type: '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' | 'NUMBER' | 'EOF';
  value?: number;
  pos: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (
      ch === '+' ||
      ch === '-' ||
      ch === '*' ||
      ch === '/' ||
      ch === '%' ||
      ch === '^' ||
      ch === '(' ||
      ch === ')'
    ) {
      tokens.push({ type: ch, pos: i });
      i++;
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < len && input[i] >= '0' && input[i] <= '9') {
        i++;
      }
      if (i < len && input[i] === '.') {
        i++;
        while (i < len && input[i] >= '0' && input[i] <= '9') {
          i++;
        }
      }
      const numStr = input.slice(start, i);
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr), pos: start });
      continue;
    }

    if (ch === '.') {
      const start = i;
      if (i + 1 < len && input[i + 1] >= '0' && input[i + 1] <= '9') {
        i++;
        while (i < len && input[i] >= '0' && input[i] <= '9') {
          i++;
        }
        const numStr = input.slice(start, i);
        tokens.push({ type: 'NUMBER', value: parseFloat(numStr), pos: start });
        continue;
      } else {
        throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
      }
    }

    throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', pos: len });
  return tokens;
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  let current = 0;

  function peek(): Token {
    return tokens[current];
  }

  function next(): Token {
    return tokens[current++];
  }

  function parseExpr(): number {
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
      } else if (op === '%') {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left = left % right;
      }
    }
    return left;
  }

  function parseUnary(): number {
    if (peek().type === '+' || peek().type === '-') {
      const op = next().type;
      const operand = parseUnary();
      return op === '-' ? -operand : +operand;
    }
    return parsePower();
  }

  function parsePower(): number {
    let left = parsePrimary();
    if (peek().type === '^') {
      next();
      const right = parseUnary();
      left = Math.pow(left, right);
    }
    return left;
  }

  function parsePrimary(): number {
    const token = peek();
    if (token.type === 'NUMBER') {
      next();
      return token.value!;
    }
    if (token.type === '(') {
      next();
      const val = parseExpr();
      const closing = peek();
      if (closing.type !== ')') {
        throw new SyntaxError(`Expected ')' at position ${closing.pos}`);
      }
      next();
      return val;
    }
    if (token.type === 'EOF') {
      throw new SyntaxError(`Unexpected end of input at position ${token.pos}`);
    }
    throw new SyntaxError(`Unexpected token '${token.type}' at position ${token.pos}`);
  }

  const result = parseExpr();
  if (peek().type !== 'EOF') {
    const token = peek();
    throw new SyntaxError(`Unexpected token '${token.type}' at position ${token.pos}`);
  }

  return result;
}
