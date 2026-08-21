type TokenType = 'NUMBER' | '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' | 'EOF';

interface Token {
  type: TokenType;
  value?: number;
  pos: number;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

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
      while (i < src.length && src[i] >= '0' && src[i] <= '9') {
        i++;
      }
      if (i < src.length && src[i] === '.') {
        i++;
        while (i < src.length && src[i] >= '0' && src[i] <= '9') {
          i++;
        }
      }
      const numStr = src.slice(start, i);
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr), pos: start });
      continue;
    }

    if (ch === '.') {
      const start = i;
      if (i + 1 < src.length && src[i + 1] >= '0' && src[i + 1] <= '9') {
        i++;
        while (i < src.length && src[i] >= '0' && src[i] <= '9') {
          i++;
        }
        const numStr = src.slice(start, i);
        tokens.push({ type: 'NUMBER', value: parseFloat(numStr), pos: start });
        continue;
      }
      throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
    }

    throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', pos: src.length });
  return tokens;
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  let currentIndex = 0;

  function peek(): Token {
    return tokens[currentIndex];
  }

  function consume(): Token {
    return tokens[currentIndex++];
  }

  function parsePrimary(): number {
    const token = peek();

    if (token.type === 'NUMBER') {
      consume();
      return token.value!;
    }

    if (token.type === '(') {
      consume();
      const val = parseAddSub();
      const closeToken = peek();
      if (closeToken.type !== ')') {
        throw new SyntaxError(`Expected ')' at position ${closeToken.pos}`);
      }
      consume();
      return val;
    }

    if (token.type === 'EOF') {
      throw new SyntaxError(`Unexpected end of input at position ${token.pos}`);
    }

    throw new SyntaxError(`Unexpected token '${token.type}' at position ${token.pos}`);
  }

  function parsePower(): number {
    const left = parsePrimary();
    if (peek().type === '^') {
      consume();
      const right = parseUnary();
      return Math.pow(left, right);
    }
    return left;
  }

  function parseUnary(): number {
    if (peek().type === '+') {
      consume();
      return +parseUnary();
    }
    if (peek().type === '-') {
      consume();
      return -parseUnary();
    }
    return parsePower();
  }

  function parseMulDiv(): number {
    let left = parseUnary();
    while (peek().type === '*' || peek().type === '/' || peek().type === '%') {
      const op = consume().type;
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

  function parseAddSub(): number {
    let left = parseMulDiv();
    while (peek().type === '+' || peek().type === '-') {
      const op = consume().type;
      const right = parseMulDiv();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }
    return left;
  }

  const result = parseAddSub();
  const endToken = peek();
  if (endToken.type !== 'EOF') {
    throw new SyntaxError(`Unexpected token '${endToken.type}' at position ${endToken.pos}`);
  }

  return result;
}
