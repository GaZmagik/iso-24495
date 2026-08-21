I have implemented `evaluate.ts` to parse and evaluate arithmetic expressions according to your specification.

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
  value: number;
  pos: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const length = input.length;
  let index = 0;

  while (index < length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    const start = index;

    if (char === '+') {
      tokens.push({ type: 'PLUS', value: 0, pos: start });
      index++;
    } else if (char === '-') {
      tokens.push({ type: 'MINUS', value: 0, pos: start });
      index++;
    } else if (char === '*') {
      tokens.push({ type: 'STAR', value: 0, pos: start });
      index++;
    } else if (char === '/') {
      tokens.push({ type: 'SLASH', value: 0, pos: start });
      index++;
    } else if (char === '%') {
      tokens.push({ type: 'PERCENT', value: 0, pos: start });
      index++;
    } else if (char === '^') {
      tokens.push({ type: 'CARET', value: 0, pos: start });
      index++;
    } else if (char === '(') {
      tokens.push({ type: 'LPAREN', value: 0, pos: start });
      index++;
    } else if (char === ')') {
      tokens.push({ type: 'RPAREN', value: 0, pos: start });
      index++;
    } else if (char >= '0' && char <= '9') {
      let numStr = '';
      while (index < length && input[index] >= '0' && input[index] <= '9') {
        numStr += input[index];
        index++;
      }
      if (index < length && input[index] === '.') {
        numStr += '.';
        index++;
        while (index < length && input[index] >= '0' && input[index] <= '9') {
          numStr += input[index];
          index++;
        }
      }
      tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
    } else if (char === '.') {
      if (index + 1 < length && input[index + 1] >= '0' && input[index + 1] <= '9') {
        let numStr = '.';
        index++;
        while (index < length && input[index] >= '0' && input[index] <= '9') {
          numStr += input[index];
          index++;
        }
        tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
      } else {
        throw new SyntaxError(`Unexpected character '.' at position ${start}`);
      }
    } else {
      throw new SyntaxError(`Unexpected character '${char}' at position ${start}`);
    }
  }

  tokens.push({ type: 'EOF', value: 0, pos: length });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private advance(): Token {
    const token = this.tokens[this.current];
    this.current++;
    return token;
  }

  public parse(): number {
    if (this.peek().type === 'EOF') {
      throw new SyntaxError(`Unexpected end of input at position ${this.peek().pos}`);
    }

    const result = this.parseAddition();

    if (this.peek().type !== 'EOF') {
      throw new SyntaxError(`Unexpected token at position ${this.peek().pos}`);
    }

    return result;
  }

  private parseAddition(): number {
    let left = this.parseMultiplication();

    while (this.peek().type === 'PLUS' || this.peek().type === 'MINUS') {
      const operator = this.advance();
      const right = this.parseMultiplication();
      if (operator.type === 'PLUS') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  private parseMultiplication(): number {
    let left = this.parseUnary();

    while (
      this.peek().type === 'STAR' ||
      this.peek().type === 'SLASH' ||
      this.peek().type === 'PERCENT'
    ) {
      const operator = this.advance();
      const right = this.parseUnary();

      if (operator.type === 'STAR') {
        left = left * right;
      } else if (operator.type === 'SLASH') {
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
    if (this.peek().type === 'PLUS') {
      this.advance();
      return this.parseUnary();
    }
    if (this.peek().type === 'MINUS') {
      this.advance();
      return -this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    let left = this.parsePrimary();

    if (this.peek().type === 'CARET') {
      this.advance();
      const right = this.parseUnary();
      left = Math.pow(left, right);
    }

    return left;
  }

  private parsePrimary(): number {
    const token = this.peek();

    if (token.type === 'NUMBER') {
      this.advance();
      return token.value;
    }

    if (token.type === 'LPAREN') {
      this.advance();
      const expression = this.parseAddition();
      if (this.peek().type !== 'RPAREN') {
        throw new SyntaxError(`Expected ')' at position ${this.peek().pos}`);
      }
      this.advance();
      return expression;
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
