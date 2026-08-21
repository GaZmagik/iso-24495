type TokenType = 'NUMBER' | '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' | 'EOF';

interface Token {
  type: TokenType;
  value?: number;
  pos: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const len = input.length;

  while (pos < len) {
    const ch = input[pos];

    if (/\s/.test(ch)) {
      pos++;
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
      tokens.push({ type: ch, pos });
      pos++;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && pos + 1 < len && /[0-9]/.test(input[pos + 1]))) {
      const start = pos;
      let hasDot = false;

      while (pos < len) {
        const c = input[pos];
        if (/[0-9]/.test(c)) {
          pos++;
        } else if (c === '.' && !hasDot) {
          hasDot = true;
          pos++;
        } else {
          break;
        }
      }

      const raw = input.slice(start, pos);
      tokens.push({ type: 'NUMBER', value: Number(raw), pos: start });
      continue;
    }

    throw new SyntaxError(`Invalid character '${ch}' at position ${pos}`);
  }

  tokens.push({ type: 'EOF', pos: len });
  return tokens;
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  let cursor = 0;

  function peek(): Token {
    return tokens[cursor];
  }

  function consume(): Token {
    return tokens[cursor++];
  }

  function parseExpression(): number {
    return parseAddition();
  }

  function parseAddition(): number {
    let left = parseMultiplication();

    while (peek().type === '+' || peek().type === '-') {
      const op = consume().type;
      const right = parseMultiplication();
      left = op === '+' ? left + right : left - right;
    }

    return left;
  }

  function parseMultiplication(): number {
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
      return parseUnary();
    }
    if (peek().type === '-') {
      consume();
      return -parseUnary();
    }
    return parsePower();
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

  function parsePrimary(): number {
    const token = peek();

    if (token.type === 'NUMBER') {
      consume();
      return token.value!;
    }

    if (token.type === '(') {
      consume();
      const expr = parseExpression();

      if (peek().type !== ')') {
        throw new SyntaxError(`Expected ')' at position ${peek().pos}`);
      }

      consume();
      return expr;
    }

    throw new SyntaxError(`Unexpected token at position ${token.pos}`);
  }

  const result = parseExpression();

  if (peek().type !== 'EOF') {
    throw new SyntaxError(`Unexpected token at position ${peek().pos}`);
  }

  return result;
}
