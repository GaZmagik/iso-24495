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

    if (/\d/.test(ch) || (ch === '.' && i + 1 < len && /\d/.test(input[i + 1]))) {
      const start = i;
      let hasDot = false;

      while (i < len) {
        const c = input[i];
        if (/\d/.test(c)) {
          i++;
        } else if (c === '.' && !hasDot) {
          hasDot = true;
          i++;
        } else {
          break;
        }
      }

      const numStr = input.slice(start, i);
      tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
      continue;
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

  function consume(): Token {
    const token = tokens[current];
    current++;
    return token;
  }

  function parseExpression(): number {
    let left = parseTerm();
    while (peek().type === '+' || peek().type === '-') {
      const op = consume().type;
      const right = parseTerm();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }
    return left;
  }

  function parseTerm(): number {
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
      } else {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left = left % right;
      }
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

  function parsePower(): number {
    const base = parsePrimary();
    if (peek().type === '^') {
      consume();
      const exp = parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parsePrimary(): number {
    const token = peek();
    if (token.type === 'NUMBER') {
      consume();
      return token.value!;
    }
    if (token.type === '(') {
      consume();
      const val = parseExpression();
      if (peek().type !== ')') {
        throw new SyntaxError(`Expected ')' at position ${peek().pos}`);
      }
      consume();
      return val;
    }
    throw new SyntaxError(`Unexpected token at position ${token.pos}`);
  }

  const result = parseExpression();
  if (peek().type !== 'EOF') {
    throw new SyntaxError(`Unexpected token at position ${peek().pos}`);
  }

  return result;
}
