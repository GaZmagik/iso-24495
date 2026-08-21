type TokenType = 'NUMBER' | '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' | 'EOF';

interface Token {
  type: TokenType;
  value?: number;
  pos: number;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const ch = expression[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < expression.length && expression[i] >= '0' && expression[i] <= '9') {
        i++;
      }
      if (i < expression.length && expression[i] === '.') {
        i++;
        while (i < expression.length && expression[i] >= '0' && expression[i] <= '9') {
          i++;
        }
      }
      const numStr = expression.slice(start, i);
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr), pos: start });
      continue;
    }

    if (ch === '.') {
      const start = i;
      if (i + 1 < expression.length && expression[i + 1] >= '0' && expression[i + 1] <= '9') {
        i++;
        while (i < expression.length && expression[i] >= '0' && expression[i] <= '9') {
          i++;
        }
        const numStr = expression.slice(start, i);
        tokens.push({ type: 'NUMBER', value: parseFloat(numStr), pos: start });
        continue;
      }
      throw new SyntaxError(`Unexpected character '.' at position ${start}`);
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

    throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', pos: expression.length });
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
    return parseAdditive();
  }

  function parseAdditive(): number {
    let left = parseMultiplicative();

    while (true) {
      const token = peek();
      if (token.type === '+' || token.type === '-') {
        consume();
        const right = parseMultiplicative();
        left = token.type === '+' ? left + right : left - right;
      } else {
        break;
      }
    }

    return left;
  }

  function parseMultiplicative(): number {
    let left = parseUnary();

    while (true) {
      const token = peek();
      if (token.type === '*' || token.type === '/' || token.type === '%') {
        consume();
        const right = parseUnary();
        if (token.type === '*') {
          left = left * right;
        } else if (token.type === '/') {
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
      } else {
        break;
      }
    }

    return left;
  }

  function parseUnary(): number {
    const token = peek();
    if (token.type === '+') {
      consume();
      return parseUnary();
    }
    if (token.type === '-') {
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
      const value = parseExpression();
      const closing = peek();
      if (closing.type !== ')') {
        throw new SyntaxError(`Expected ')' at position ${closing.pos}`);
      }
      consume();
      return value;
    }

    throw new SyntaxError(`Unexpected token at position ${token.pos}`);
  }

  const result = parseExpression();
  const trailing = peek();
  if (trailing.type !== 'EOF') {
    throw new SyntaxError(`Unexpected token at position ${trailing.pos}`);
  }

  return result;
}
