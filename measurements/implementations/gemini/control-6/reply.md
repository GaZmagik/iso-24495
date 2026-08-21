```typescript
type TokenType =
  | 'NUMBER'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'PERCENT'
  | 'CARET'
  | 'LPAREN'
  | 'RPAREN'
  | 'EOF';

interface Token {
  type: TokenType;
  value?: number;
  pos: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (
      (ch >= '0' && ch <= '9') ||
      (ch === '.' && i + 1 < n && input[i + 1] >= '0' && input[i + 1] <= '9')
    ) {
      const start = i;

      if (input[i] === '.') {
        i++;
        while (i < n && input[i] >= '0' && input[i] <= '9') {
          i++;
        }
      } else {
        while (i < n && input[i] >= '0' && input[i] <= '9') {
          i++;
        }
        if (i < n && input[i] === '.') {
          i++;
          while (i < n && input[i] >= '0' && input[i] <= '9') {
            i++;
          }
        }
      }

      const numStr = input.slice(start, i);
      tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
      continue;
    }

    switch (ch) {
      case '+':
        tokens.push({ type: 'PLUS', pos: i });
        i++;
        break;
      case '-':
        tokens.push({ type: 'MINUS', pos: i });
        i++;
        break;
      case '*':
        tokens.push({ type: 'STAR', pos: i });
        i++;
        break;
      case '/':
        tokens.push({ type: 'SLASH', pos: i });
        i++;
        break;
      case '%':
        tokens.push({ type: 'PERCENT', pos: i });
        i++;
        break;
      case '^':
        tokens.push({ type: 'CARET', pos: i });
        i++;
        break;
      case '(':
        tokens.push({ type: 'LPAREN', pos: i });
        i++;
        break;
      case ')':
        tokens.push({ type: 'RPAREN', pos: i });
        i++;
        break;
      default:
        throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
    }
  }

  tokens.push({ type: 'EOF', pos: n });
  return tokens;
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  let current = 0;

  function peek(): Token {
    return tokens[current];
  }

  function consume(): Token {
    const tok = tokens[current];
    current++;
    return tok;
  }

  function parseExpression(): number {
    return parseAddSub();
  }

  function parseAddSub(): number {
    let left = parseMulDivMod();

    while (peek().type === 'PLUS' || peek().type === 'MINUS') {
      const op = consume();
      const right = parseMulDivMod();
      if (op.type === 'PLUS') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  function parseMulDivMod(): number {
    let left = parseUnary();

    while (
      peek().type === 'STAR' ||
      peek().type === 'SLASH' ||
      peek().type === 'PERCENT'
    ) {
      const op = consume();
      const right = parseUnary();
      if (op.type === 'STAR') {
        left = left * right;
      } else if (op.type === 'SLASH') {
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
    const tok = peek();
    if (tok.type === 'PLUS') {
      consume();
      return +parseUnary();
    }
    if (tok.type === 'MINUS') {
      consume();
      return -parseUnary();
    }
    return parsePower();
  }

  function parsePower(): number {
    const left = parsePrimary();

    if (peek().type === 'CARET') {
      consume();
      const right = parseUnary();
      return Math.pow(left, right);
    }

    return left;
  }

  function parsePrimary(): number {
    const tok = peek();

    if (tok.type === 'NUMBER') {
      consume();
      return tok.value!;
    }

    if (tok.type === 'LPAREN') {
      consume();
      const val = parseExpression();
      const closeTok = peek();
      if (closeTok.type !== 'RPAREN') {
        throw new SyntaxError(`Expected ')' at position ${closeTok.pos}`);
      }
      consume();
      return val;
    }

    if (tok.type === 'EOF') {
      throw new SyntaxError(`Unexpected end of expression at position ${tok.pos}`);
    }

    throw new SyntaxError(`Unexpected token at position ${tok.pos}`);
  }

  const result = parseExpression();

  const remaining = peek();
  if (remaining.type !== 'EOF') {
    throw new SyntaxError(`Unexpected token at position ${remaining.pos}`);
  }

  return result;
}
```
