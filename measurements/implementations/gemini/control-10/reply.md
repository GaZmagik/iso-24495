```typescript
export function evaluate(expression: string): number {
  interface Token {
    type: string;
    value?: number;
    raw: string;
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
        const raw = input.slice(start, i);
        tokens.push({ type: 'NUMBER', value: Number(raw), raw, pos: start });
        continue;
      }

      if (ch === '.') {
        const start = i;
        if (i + 1 < len && input[i + 1] >= '0' && input[i + 1] <= '9') {
          i++;
          while (i < len && input[i] >= '0' && input[i] <= '9') {
            i++;
          }
          const raw = input.slice(start, i);
          tokens.push({ type: 'NUMBER', value: Number(raw), raw, pos: start });
          continue;
        } else {
          throw new SyntaxError(`Unexpected character '.' at position ${start}`);
        }
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
        tokens.push({ type: ch, raw: ch, pos: i });
        i++;
        continue;
      }

      throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
    }

    tokens.push({ type: 'EOF', raw: '', pos: len });
    return tokens;
  }

  const tokens = tokenize(expression);
  let current = 0;

  function peek(): Token {
    return tokens[current];
  }

  function consume(expectedType?: string): Token {
    const token = tokens[current];
    if (expectedType !== undefined && token.type !== expectedType) {
      if (token.type === 'EOF') {
        throw new SyntaxError(`Expected '${expectedType}' at position ${token.pos}`);
      }
      throw new SyntaxError(`Unexpected token '${token.raw}' at position ${token.pos}`);
    }
    current++;
    return token;
  }

  function parsePrimary(): number {
    const token = peek();
    if (token.type === 'NUMBER') {
      consume('NUMBER');
      return token.value!;
    }
    if (token.type === '(') {
      consume('(');
      const val = parseAdditive();
      const next = peek();
      if (next.type !== ')') {
        if (next.type === 'EOF') {
          throw new SyntaxError(`Expected ')' at position ${next.pos}`);
        }
        throw new SyntaxError(`Unexpected token '${next.raw}' at position ${next.pos}`);
      }
      consume(')');
      return val;
    }
    if (token.type === 'EOF') {
      throw new SyntaxError(`Unexpected end of input at position ${token.pos}`);
    }
    throw new SyntaxError(`Unexpected token '${token.raw}' at position ${token.pos}`);
  }

  function parsePower(): number {
    let left = parsePrimary();
    if (peek().type === '^') {
      consume('^');
      const right = parseUnary();
      left = Math.pow(left, right);
    }
    return left;
  }

  function parseUnary(): number {
    const token = peek();
    if (token.type === '+') {
      consume('+');
      return +parseUnary();
    }
    if (token.type === '-') {
      consume('-');
      return -parseUnary();
    }
    return parsePower();
  }

  function parseMultiplicative(): number {
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

  function parseAdditive(): number {
    let left = parseMultiplicative();
    while (peek().type === '+' || peek().type === '-') {
      const op = consume().type;
      const right = parseMultiplicative();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }
    return left;
  }

  const result = parseAdditive();
  const next = peek();
  if (next.type !== 'EOF') {
    throw new SyntaxError(`Unexpected token '${next.raw}' at position ${next.pos}`);
  }

  return result;
}
```
