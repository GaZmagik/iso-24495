Here is the complete implementation of `evaluate.ts`.

```typescript
type TokenType = 'NUMBER' | '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')';

interface Token {
  type: TokenType;
  value?: number;
  pos: number;
}

export function evaluate(expression: string): number {
  const tokens: Token[] = [];
  let pos = 0;
  const len = expression.length;

  while (pos < len) {
    const ch = expression[pos];

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

    if (ch >= '0' && ch <= '9') {
      const start = pos;
      while (pos < len && expression[pos] >= '0' && expression[pos] <= '9') {
        pos++;
      }
      if (pos < len && expression[pos] === '.') {
        pos++;
        while (pos < len && expression[pos] >= '0' && expression[pos] <= '9') {
          pos++;
        }
      }
      const numStr = expression.slice(start, pos);
      tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
      continue;
    }

    if (ch === '.') {
      const start = pos;
      pos++;
      if (pos < len && expression[pos] >= '0' && expression[pos] <= '9') {
        while (pos < len && expression[pos] >= '0' && expression[pos] <= '9') {
          pos++;
        }
        const numStr = expression.slice(start, pos);
        tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
        continue;
      }
      throw new SyntaxError(`Unexpected character '.' at position ${start}`);
    }

    throw new SyntaxError(`Unexpected character '${ch}' at position ${pos}`);
  }

  let tokenIndex = 0;

  function peek(): Token | undefined {
    return tokens[tokenIndex];
  }

  function consume(): Token {
    const token = tokens[tokenIndex];
    tokenIndex++;
    return token;
  }

  function parsePrimary(): number {
    const token = peek();
    if (!token) {
      throw new SyntaxError(`Unexpected end of input at position ${expression.length}`);
    }
    if (token.type === 'NUMBER') {
      consume();
      return token.value!;
    }
    if (token.type === '(') {
      consume();
      const val = parseExpression();
      const next = peek();
      if (!next || next.type !== ')') {
        const errPos = next ? next.pos : expression.length;
        throw new SyntaxError(`Expected ')' at position ${errPos}`);
      }
      consume();
      return val;
    }
    throw new SyntaxError(`Unexpected token '${token.type}' at position ${token.pos}`);
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (peek()?.type === '^') {
      consume();
      const exponent = parseUnary();
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parseUnary(): number {
    if (peek()?.type === '+') {
      consume();
      return +parseUnary();
    }
    if (peek()?.type === '-') {
      consume();
      return -parseUnary();
    }
    return parsePower();
  }

  function parseTerm(): number {
    let left = parseUnary();
    while (peek()?.type === '*' || peek()?.type === '/' || peek()?.type === '%') {
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

  function parseExpression(): number {
    let left = parseTerm();
    while (peek()?.type === '+' || peek()?.type === '-') {
      const op = consume().type;
      const right = parseTerm();
      if (op === '+') {
        left = left + right;
      } else if (op === '-') {
        left = left - right;
      }
    }
    return left;
  }

  const result = parseExpression();

  if (tokenIndex < tokens.length) {
    const extra = tokens[tokenIndex];
    throw new SyntaxError(`Unexpected token '${extra.type}' at position ${extra.pos}`);
  }

  return result;
}
```
