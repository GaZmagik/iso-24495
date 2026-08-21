I have implemented `evaluate.ts` to parse and evaluate arithmetic expressions according to your specification.

```typescript
export function evaluate(expression: string): number {
  interface Token {
    type: 'NUMBER' | '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' | 'EOF';
    value?: number;
    pos: number;
  }

  const tokens: Token[] = [];
  let i = 0;
  const len = expression.length;

  while (i < len) {
    const ch = expression[i];
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

    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < len && /[0-9]/.test(expression[i])) {
        i++;
      }
      if (i < len && expression[i] === '.') {
        i++;
        while (i < len && /[0-9]/.test(expression[i])) {
          i++;
        }
      }
      const numStr = expression.slice(start, i);
      tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
      continue;
    }

    if (ch === '.' && i + 1 < len && /[0-9]/.test(expression[i + 1])) {
      const start = i;
      i++;
      while (i < len && /[0-9]/.test(expression[i])) {
        i++;
      }
      const numStr = expression.slice(start, i);
      tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
      continue;
    }

    throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', pos: len });

  let current = 0;

  function peek(): Token {
    return tokens[current];
  }

  function consume(expectedType?: Token['type']): Token {
    const tok = tokens[current];
    if (expectedType && tok.type !== expectedType) {
      throw new SyntaxError(`Unexpected token '${tok.type}' at position ${tok.pos}`);
    }
    current++;
    return tok;
  }

  function parseExpression(): number {
    return parseAdditive();
  }

  function parseAdditive(): number {
    let left = parseMultiplicative();
    while (peek().type === '+' || peek().type === '-') {
      const op = consume().type;
      const right = parseMultiplicative();
      if (op === '+') {
        left += right;
      } else {
        left -= right;
      }
    }
    return left;
  }

  function parseMultiplicative(): number {
    let left = parseUnary();
    while (peek().type === '*' || peek().type === '/' || peek().type === '%') {
      const op = consume().type;
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
    const tok = peek();
    if (tok.type === '+') {
      consume('+');
      return parseUnary();
    }
    if (tok.type === '-') {
      consume('-');
      return -parseUnary();
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (peek().type === '^') {
      consume('^');
      const exp = parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parsePrimary(): number {
    const tok = peek();
    if (tok.type === 'NUMBER') {
      consume('NUMBER');
      return tok.value!;
    }
    if (tok.type === '(') {
      consume('(');
      const val = parseExpression();
      if (peek().type !== ')') {
        throw new SyntaxError(`Expected ')' at position ${peek().pos}`);
      }
      consume(')');
      return val;
    }
    throw new SyntaxError(`Unexpected token '${tok.type}' at position ${tok.pos}`);
  }

  const result = parseExpression();
  if (peek().type !== 'EOF') {
    throw new SyntaxError(`Unexpected token '${peek().type}' at position ${peek().pos}`);
  }
  return result;
}
```
