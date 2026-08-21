```typescript
export function evaluate(expression: string): number {
  interface Token {
    type: 'NUMBER' | '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' | 'EOF';
    value?: number;
    pos: number;
  }

  const tokens: Token[] = [];
  const len = expression.length;
  let i = 0;

  while (i < len) {
    const ch = expression[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (
      /[0-9]/.test(ch) ||
      (ch === '.' && i + 1 < len && /[0-9]/.test(expression[i + 1]))
    ) {
      const start = i;
      let hasDot = false;
      while (i < len) {
        const c = expression[i];
        if (/[0-9]/.test(c)) {
          i++;
        } else if (c === '.' && !hasDot) {
          hasDot = true;
          i++;
        } else {
          break;
        }
      }
      const numStr = expression.slice(start, i);
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr), pos: start });
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

  let current = 0;

  function peek(): Token {
    return tokens[current];
  }

  function consume(): Token {
    return tokens[current++];
  }

  function parseExpression(): number {
    return parseAddSub();
  }

  function parseAddSub(): number {
    let left = parseMulDivMod();

    while (peek().type === '+' || peek().type === '-') {
      const op = consume();
      const right = parseMulDivMod();
      if (op.type === '+') {
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
      peek().type === '*' ||
      peek().type === '/' ||
      peek().type === '%'
    ) {
      const op = consume();
      const right = parseUnary();

      if (op.type === '/') {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left = left / right;
      } else if (op.type === '%') {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left = left % right;
      } else {
        left = left * right;
      }
    }

    return left;
  }

  function parseUnary(): number {
    if (peek().type === '+' || peek().type === '-') {
      const op = consume();
      const val = parseUnary();
      return op.type === '-' ? -val : val;
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
```
