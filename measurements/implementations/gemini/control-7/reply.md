```typescript
interface Token {
  type: 'NUMBER' | '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' | 'EOF';
  value?: number;
  pos: number;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = expression.length;

  while (i < n) {
    const ch = expression[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < n && expression[i] >= '0' && expression[i] <= '9') {
        i++;
      }
      if (i < n && expression[i] === '.') {
        i++;
        while (i < n && expression[i] >= '0' && expression[i] <= '9') {
          i++;
        }
      }
      const raw = expression.slice(start, i);
      tokens.push({ type: 'NUMBER', value: Number(raw), pos: start });
      continue;
    }

    if (ch === '.') {
      const start = i;
      if (i + 1 < n && expression[i + 1] >= '0' && expression[i + 1] <= '9') {
        i++;
        while (i < n && expression[i] >= '0' && expression[i] <= '9') {
          i++;
        }
        const raw = expression.slice(start, i);
        tokens.push({ type: 'NUMBER', value: Number(raw), pos: start });
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
      tokens.push({ type: ch, pos: i });
      i++;
      continue;
    }

    throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', pos: n });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private consume(): Token {
    const token = this.tokens[this.index];
    this.index++;
    return token;
  }

  public parse(): number {
    const result = this.parseAdditive();
    const next = this.peek();
    if (next.type !== 'EOF') {
      throw new SyntaxError(`Unexpected token '${next.type}' at position ${next.pos}`);
    }
    return result;
  }

  private parseAdditive(): number {
    let left = this.parseMultiplicative();

    while (true) {
      const token = this.peek();
      if (token.type === '+') {
        this.consume();
        const right = this.parseMultiplicative();
        left = left + right;
      } else if (token.type === '-') {
        this.consume();
        const right = this.parseMultiplicative();
        left = left - right;
      } else {
        break;
      }
    }

    return left;
  }

  private parseMultiplicative(): number {
    let left = this.parseUnary();

    while (true) {
      const token = this.peek();
      if (token.type === '*') {
        this.consume();
        const right = this.parseUnary();
        left = left * right;
      } else if (token.type === '/') {
        this.consume();
        const right = this.parseUnary();
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left = left / right;
      } else if (token.type === '%') {
        this.consume();
        const right = this.parseUnary();
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left = left % right;
      } else {
        break;
      }
    }

    return left;
  }

  private parseUnary(): number {
    const token = this.peek();
    if (token.type === '+') {
      this.consume();
      return +this.parseUnary();
    }
    if (token.type === '-') {
      this.consume();
      return -this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    let left = this.parsePrimary();

    const token = this.peek();
    if (token.type === '^') {
      this.consume();
      const right = this.parseUnary();
      left = Math.pow(left, right);
    }

    return left;
  }

  private parsePrimary(): number {
    const token = this.peek();

    if (token.type === 'NUMBER') {
      this.consume();
      return token.value!;
    }

    if (token.type === '(') {
      this.consume();
      const value = this.parseAdditive();
      const next = this.peek();
      if (next.type !== ')') {
        throw new SyntaxError(`Expected ')' at position ${next.pos}`);
      }
      this.consume();
      return value;
    }

    throw new SyntaxError(`Unexpected token at position ${token.pos}`);
  }
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  return parser.parse();
}
```
