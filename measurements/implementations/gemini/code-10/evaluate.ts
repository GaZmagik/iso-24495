type TokenType = 'NUMBER' | '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' | 'EOF';

interface Token {
  type: TokenType;
  value?: number;
  pos: number;
}

/**
 * Evaluates an arithmetic expression and returns the numeric result.
 */
export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  let current = 0;

  function peek(): Token {
    return tokens[current];
  }

  function advance(): Token {
    const token = tokens[current];
    current++;
    return token;
  }

  function match(type: TokenType): boolean {
    if (peek().type === type) {
      advance();
      return true;
    }
    return false;
  }

  function parseExpression(): number {
    return parseAddSub();
  }

  function parseAddSub(): number {
    let left = parseMulDiv();
    while (peek().type === '+' || peek().type === '-') {
      const op = advance().type;
      const right = parseMulDiv();
      if (op === '+') {
        left += right;
      } else {
        left -= right;
      }
    }
    return left;
  }

  function parseMulDiv(): number {
    let left = parseUnary();
    while (peek().type === '*' || peek().type === '/' || peek().type === '%') {
      const op = advance().type;
      const right = parseUnary();
      if (op === '*') {
        left *= right;
      } else if (op === '/') {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left /= right;
      } else if (op === '%') {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left %= right;
      }
    }
    return left;
  }

  function parseUnary(): number {
    if (match('+')) {
      return parseUnary();
    }
    if (match('-')) {
      return -parseUnary();
    }
    return parsePower();
  }

  function parsePower(): number {
    const left = parsePrimary();
    if (match('^')) {
      const right = parseUnary();
      return Math.pow(left, right);
    }
    return left;
  }

  function parsePrimary(): number {
    const token = peek();
    if (token.type === 'NUMBER') {
      advance();
      return token.value!;
    }
    if (match('(')) {
      const value = parseExpression();
      if (!match(')')) {
        throw new SyntaxError(`Expected ')' at position ${peek().pos}`);
      }
      return value;
    }
    throw new SyntaxError(`Unexpected token at position ${token.pos}`);
  }

  const result = parseExpression();
  if (peek().type !== 'EOF') {
    throw new SyntaxError(`Unexpected token at position ${peek().pos}`);
  }
  return result;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const length = expression.length;

  while (pos < length) {
    const char = expression[pos];

    if (/\s/.test(char)) {
      pos++;
      continue;
    }

    if (char >= '0' && char <= '9') {
      const start = pos;
      while (pos < length && expression[pos] >= '0' && expression[pos] <= '9') {
        pos++;
      }
      if (pos < length && expression[pos] === '.') {
        pos++;
        while (pos < length && expression[pos] >= '0' && expression[pos] <= '9') {
          pos++;
        }
      }
      const raw = expression.slice(start, pos);
      tokens.push({ type: 'NUMBER', value: Number(raw), pos: start });
      continue;
    }

    if (char === '.') {
      if (pos + 1 < length && expression[pos + 1] >= '0' && expression[pos + 1] <= '9') {
        const start = pos;
        pos++;
        while (pos < length && expression[pos] >= '0' && expression[pos] <= '9') {
          pos++;
        }
        const raw = expression.slice(start, pos);
        tokens.push({ type: 'NUMBER', value: Number(raw), pos: start });
        continue;
      }
      throw new SyntaxError(`Unexpected character '.' at position ${pos}`);
    }

    if (
      char === '+' ||
      char === '-' ||
      char === '*' ||
      char === '/' ||
      char === '%' ||
      char === '^' ||
      char === '(' ||
      char === ')'
    ) {
      tokens.push({ type: char, pos });
      pos++;
      continue;
    }

    throw new SyntaxError(`Unexpected character '${char}' at position ${pos}`);
  }

  tokens.push({ type: 'EOF', pos: length });
  return tokens;
}
