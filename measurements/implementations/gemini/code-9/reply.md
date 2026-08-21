Here is the complete implementation of `evaluate.ts`.

```typescript
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
  text: string;
  pos: number;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const length = expression.length;
  let index = 0;

  while (index < length) {
    const char = expression[index];

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (
      char === '+' ||
      char === '-' ||
      char === '*' ||
      char === '/' ||
      char === '%' ||
      char === '^' ||
      char === '(' ||
      char === ')'
    ) {
      tokens.push({
        type: char,
        text: char,
        pos: index,
      });
      index++;
      continue;
    }

    const isDigit = char >= '0' && char <= '9';
    const isDotWithDigit =
      char === '.' &&
      index + 1 < length &&
      expression[index + 1] >= '0' &&
      expression[index + 1] <= '9';

    if (isDigit || isDotWithDigit) {
      const start = index;
      let hasDot = false;

      while (index < length) {
        const currentChar = expression[index];
        if (currentChar >= '0' && currentChar <= '9') {
          index++;
        } else if (currentChar === '.' && !hasDot) {
          hasDot = true;
          index++;
        } else {
          break;
        }
      }

      const text = expression.slice(start, index);
      tokens.push({
        type: 'NUMBER',
        value: Number(text),
        text,
        pos: start,
      });
      continue;
    }

    throw new SyntaxError(`Unexpected character '${char}' at position ${index}`);
  }

  tokens.push({
    type: 'EOF',
    text: 'EOF',
    pos: length,
  });

  return tokens;
}

class ExpressionParser {
  private readonly tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): number {
    const result = this.parseAdditive();
    const token = this.peek();

    if (token.type !== 'EOF') {
      throw new SyntaxError(
        `Unexpected token '${token.text}' at position ${token.pos}`
      );
    }

    return result;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private advance(): Token {
    const token = this.tokens[this.current];
    this.current++;
    return token;
  }

  private match(...types: TokenType[]): Token | null {
    const token = this.peek();
    if (types.includes(token.type)) {
      return this.advance();
    }
    return null;
  }

  private parseAdditive(): number {
    let left = this.parseMultiplicative();

    while (true) {
      const operator = this.match('+', '-');
      if (!operator) {
        break;
      }

      const right = this.parseMultiplicative();
      if (operator.type === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  private parseMultiplicative(): number {
    let left = this.parseUnary();

    while (true) {
      const operator = this.match('*', '/', '%');
      if (!operator) {
        break;
      }

      const right = this.parseUnary();
      if (operator.type === '*') {
        left = left * right;
      } else if (operator.type === '/') {
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

  private parseUnary(): number {
    if (this.match('+')) {
      return +this.parseUnary();
    }
    if (this.match('-')) {
      return -this.parseUnary();
    }
    return this.parseExponentiation();
  }

  private parseExponentiation(): number {
    const base = this.parsePrimary();

    if (this.match('^')) {
      const exponent = this.parseUnary();
      return Math.pow(base, exponent);
    }

    return base;
  }

  private parsePrimary(): number {
    if (this.match('(')) {
      const value = this.parseAdditive();
      const closingParen = this.match(')');
      if (!closingParen) {
        const token = this.peek();
        throw new SyntaxError(`Expected ')' at position ${token.pos}`);
      }
      return value;
    }

    const numberToken = this.match('NUMBER');
    if (numberToken && numberToken.value !== undefined) {
      return numberToken.value;
    }

    const token = this.peek();
    if (token.type === 'EOF') {
      throw new SyntaxError(
        `Unexpected end of expression at position ${token.pos}`
      );
    }

    throw new SyntaxError(
      `Unexpected token '${token.text}' at position ${token.pos}`
    );
  }
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  const parser = new ExpressionParser(tokens);
  return parser.parse();
}
```
