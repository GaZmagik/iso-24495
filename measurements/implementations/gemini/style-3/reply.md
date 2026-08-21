Here is the complete implementation of `evaluate.ts`.

```typescript
export function evaluate(expression: string): number {
  type TokenType =
    | 'NUMBER'
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '^'
    | '('
    | ')'
    | 'EOF';

  interface Token {
    type: TokenType;
    value?: number;
    pos: number;
  }

  const tokens: Token[] = [];
  let i = 0;
  const n = expression.length;

  while (i < n) {
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

    if ((ch >= '0' && ch <= '9') || ch === '.') {
      const start = i;
      let hasDot = false;

      if (ch === '.') {
        if (i + 1 < n && expression[i + 1] >= '0' && expression[i + 1] <= '9') {
          hasDot = true;
          i++;
        } else {
          throw new SyntaxError(`Unexpected character '.' at position ${i}`);
        }
      }

      while (i < n && expression[i] >= '0' && expression[i] <= '9') {
        i++;
      }

      if (!hasDot && i < n && expression[i] === '.') {
        hasDot = true;
        i++;
        while (i < n && expression[i] >= '0' && expression[i] <= '9') {
          i++;
        }
      }

      const numStr = expression.slice(start, i);
      tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
      continue;
    }

    throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', pos: n });

  let current = 0;

  function peek(): Token {
    return tokens[current];
  }

  function advance(): Token {
    const token = tokens[current];
    current++;
    return token;
  }

  function getBinaryPrecedence(type: TokenType): number {
    switch (type) {
      case '+':
      case '-':
        return 1;
      case '*':
      case '/':
      case '%':
        return 2;
      case '^':
        return 4;
      default:
        return 0;
    }
  }

  function parseExpression(minPrecedence: number): number {
    const token = peek();
    let left: number;

    if (token.type === '+') {
      advance();
      left = +parseExpression(3);
    } else if (token.type === '-') {
      advance();
      left = -parseExpression(3);
    } else if (token.type === 'NUMBER') {
      advance();
      left = token.value!;
    } else if (token.type === '(') {
      advance();
      left = parseExpression(0);
      const closeToken = peek();
      if (closeToken.type !== ')') {
        throw new SyntaxError(`Expected ')' at position ${closeToken.pos}`);
      }
      advance();
    } else if (token.type === 'EOF') {
      throw new SyntaxError(`Unexpected end of input at position ${token.pos}`);
    } else {
      throw new SyntaxError(`Unexpected token '${token.type}' at position ${token.pos}`);
    }

    while (true) {
      const nextToken = peek();
      const prec = getBinaryPrecedence(nextToken.type);
      if (prec === 0 || prec < minPrecedence) {
        break;
      }

      advance();
      const nextMinPrec = nextToken.type === '^' ? prec : prec + 1;
      const right = parseExpression(nextMinPrec);

      switch (nextToken.type) {
        case '+':
          left = left + right;
          break;
        case '-':
          left = left - right;
          break;
        case '*':
          left = left * right;
          break;
        case '/':
          if (right === 0) {
            throw new RangeError('Division by zero');
          }
          left = left / right;
          break;
        case '%':
          if (right === 0) {
            throw new RangeError('Division by zero');
          }
          left = left % right;
          break;
        case '^':
          left = Math.pow(left, right);
          break;
      }
    }

    return left;
  }

  const result = parseExpression(0);
  const remaining = peek();
  if (remaining.type !== 'EOF') {
    throw new SyntaxError(`Unexpected token '${remaining.type}' at position ${remaining.pos}`);
  }

  return result;
}
```
