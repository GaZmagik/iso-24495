Here is the complete implementation of `evaluate.ts`.

```typescript
type TokenType = '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' | 'NUMBER' | 'EOF';

interface Token {
  type: TokenType;
  value?: number;
  pos: number;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const len = expression.length;
  let i = 0;

  while (i < len) {
    const ch = expression[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '+') {
      tokens.push({ type: '+', pos: i });
      i++;
    } else if (ch === '-') {
      tokens.push({ type: '-', pos: i });
      i++;
    } else if (ch === '*') {
      tokens.push({ type: '*', pos: i });
      i++;
    } else if (ch === '/') {
      tokens.push({ type: '/', pos: i });
      i++;
    } else if (ch === '%') {
      tokens.push({ type: '%', pos: i });
      i++;
    } else if (ch === '^') {
      tokens.push({ type: '^', pos: i });
      i++;
    } else if (ch === '(') {
      tokens.push({ type: '(', pos: i });
      i++;
    } else if (ch === ')') {
      tokens.push({ type: ')', pos: i });
      i++;
    } else if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < len && expression[i] >= '0' && expression[i] <= '9') {
        i++;
      }
      if (i < len && expression[i] === '.') {
        i++;
        while (i < len && expression[i] >= '0' && expression[i] <= '9') {
          i++;
        }
      }
      const numStr = expression.slice(start, i);
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr), pos: start });
    } else if (ch === '.') {
      const start = i;
      if (i + 1 < len && expression[i + 1] >= '0' && expression[i + 1] <= '9') {
        i++;
        while (i < len && expression[i] >= '0' && expression[i] <= '9') {
          i++;
        }
        const numStr = expression.slice(start, i);
        tokens.push({ type: 'NUMBER', value: parseFloat(numStr), pos: start });
      } else {
        throw new SyntaxError(`Unexpected character '${ch}' at position ${start}`);
      }
    } else {
      throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
    }
  }

  tokens.push({ type: 'EOF', pos: len });
  return tokens;
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  let current = 0;

  function peek(): Token {
    return tokens[current];
  }

  function previous(): Token {
    return tokens[current - 1];
  }

  function isAtEnd(): boolean {
    return peek().type === 'EOF';
  }

  function check(type: TokenType): boolean {
    if (isAtEnd()) {
      return type === 'EOF';
    }
    return peek().type === type;
  }

  function match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (check(type)) {
        current++;
        return true;
      }
    }
    return false;
  }

  function consume(type: TokenType, message: string): Token {
    if (check(type)) {
      current++;
      return previous();
    }
    const token = peek();
    throw new SyntaxError(`${message} at position ${token.pos}`);
  }

  function parseAdditive(): number {
    let left = parseMultiplicative();

    while (match('+', '-')) {
      const operator = previous().type;
      const right = parseMultiplicative();
      if (operator === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  function parseMultiplicative(): number {
    let left = parseUnary();

    while (match('*', '/', '%')) {
      const operator = previous().type;
      const right = parseUnary();

      if (operator === '*') {
        left = left * right;
      } else if (operator === '/') {
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
    if (match('+')) {
      return parseUnary();
    }
    if (match('-')) {
      return -parseUnary();
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();

    if (match('^')) {
      const exponent = parseUnary();
      return Math.pow(base, exponent);
    }

    return base;
  }

  function parsePrimary(): number {
    if (match('NUMBER')) {
      return previous().value!;
    }

    if (match('(')) {
      const expr = parseAdditive();
      consume(')', "Expected ')'");
      return expr;
    }

    const token = peek();
    if (token.type === 'EOF') {
      throw new SyntaxError(`Unexpected end of input at position ${token.pos}`);
    }

    throw new SyntaxError(`Unexpected token '${token.type}' at position ${token.pos}`);
  }

  const result = parseAdditive();

  if (!isAtEnd()) {
    const token = peek();
    throw new SyntaxError(`Unexpected token '${token.type}' at position ${token.pos}`);
  }

  return result;
}
```
