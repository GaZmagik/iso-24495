```typescript
export function evaluate(expression: string): number {
  interface Token {
    type: 'NUM' | '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' | 'EOF';
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

    const numMatch = expression.slice(i).match(/^(\d+(\.\d*)?|\.\d+)/);
    if (numMatch) {
      const numStr = numMatch[0];
      tokens.push({ type: 'NUM', value: Number(numStr), pos: i });
      i += numStr.length;
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

    throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', pos: len });

  let cur = 0;
  function peek(): Token {
    return tokens[cur];
  }
  function next(): Token {
    return tokens[cur++];
  }

  function parseExpression(): number {
    return parseAdditive();
  }

  function parseAdditive(): number {
    let left = parseMultiplicative();
    while (peek().type === '+' || peek().type === '-') {
      const op = next();
      const right = parseMultiplicative();
      if (op.type === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }
    return left;
  }

  function parseMultiplicative(): number {
    let left = parseUnary();
    while (peek().type === '*' || peek().type === '/' || peek().type === '%') {
      const op = next();
      const right = parseUnary();
      if (op.type === '*') {
        left = left * right;
      } else if (op.type === '/') {
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
      next();
      return +parseUnary();
    }
    if (peek().type === '-') {
      next();
      return -parseUnary();
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (peek().type === '^') {
      next();
      const exponent = parseUnary();
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parsePrimary(): number {
    const token = peek();
    if (token.type === 'NUM') {
      next();
      return token.value!;
    }
    if (token.type === '(') {
      next();
      const val = parseExpression();
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

  const result = parseExpression();
  if (peek().type !== 'EOF') {
    throw new SyntaxError(`Unexpected token '${peek().type}' at position ${peek().pos}`);
  }

  return result;
}
```
