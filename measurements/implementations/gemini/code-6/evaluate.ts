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

    if (char === '+') {
      tokens.push({ type: 'PLUS', value: 0, pos: index });
      index++;
    } else if (char === '-') {
      tokens.push({ type: 'MINUS', value: 0, pos: index });
      index++;
    } else if (char === '*') {
      tokens.push({ type: 'STAR', value: 0, pos: index });
      index++;
    } else if (char === '/') {
      tokens.push({ type: 'SLASH', value: 0, pos: index });
      index++;
    } else if (char === '%') {
      tokens.push({ type: 'PERCENT', value: 0, pos: index });
      index++;
    } else if (char === '^') {
      tokens.push({ type: 'CARET', value: 0, pos: index });
      index++;
    } else if (char === '(') {
      tokens.push({ type: 'LPAREN', value: 0, pos: index });
      index++;
    } else if (char === ')') {
      tokens.push({ type: 'RPAREN', value: 0, pos: index });
      index++;
    } else if ((char >= '0' && char <= '9') || char === '.') {
      const startPos = index;
      let numString = '';
      let hasDot = false;

      while (index < length) {
        const currentChar = input[index];
        if (currentChar >= '0' && currentChar <= '9') {
          numString += currentChar;
          index++;
        } else if (currentChar === '.' && !hasDot) {
          hasDot = true;
          numString += currentChar;
          index++;
        } else {
          break;
        }
      }

      if (numString === '.') {
        throw new SyntaxError(`Unexpected character '.' at position ${startPos}`);
      }

      tokens.push({
        type: 'NUMBER',
        value: Number(numString),
        pos: startPos,
      });
    } else {
      throw new SyntaxError(`Unexpected character '${char}' at position ${index}`);
    }
  }

  tokens.push({ type: 'EOF', value: 0, pos: length });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private currentIndex = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.currentIndex];
  }

  private consume(): Token {
    const token = this.tokens[this.currentIndex];
    this.currentIndex++;
    return token;
  }

  public parse(): number {
    const result = this.parseAdd();
    const token = this.peek();

    if (token.type !== 'EOF') {
      throw new SyntaxError(`Unexpected token at position ${token.pos}`);
    }

    return result;
  }

  private parseAdd(): number {
    let left = this.parseMul();

    while (this.peek().type === 'PLUS' || this.peek().type === 'MINUS') {
      const operator = this.consume().type;
      const right = this.parseMul();

      if (operator === 'PLUS') {
        left += right;
      } else {
        left -= right;
      }
    }

    return left;
  }

  private parseMul(): number {
    let left = this.parseUnary();

    while (
      this.peek().type === 'STAR' ||
      this.peek().type === 'SLASH' ||
      this.peek().type === 'PERCENT'
    ) {
      const operator = this.consume().type;
      const right = this.parseUnary();

      if (operator === 'STAR') {
        left *= right;
      } else if (operator === 'SLASH') {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left /= right;
      } else {
        if (right === 0) {
          throw new RangeError('Division by zero');
        }
        left %= right;
      }
    }

    return left;
  }

  private parseUnary(): number {
    const token = this.peek();

    if (token.type === 'PLUS') {
      this.consume();
      return +this.parseUnary();
    }

    if (token.type === 'MINUS') {
      this.consume();
      return -this.parseUnary();
    }

    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();

    if (this.peek().type === 'CARET') {
      this.consume();
      const exponent = this.parseUnary();
      return Math.pow(base, exponent);
    }

    return base;
  }

  private parsePrimary(): number {
    const token = this.peek();

    if (token.type === 'NUMBER') {
      this.consume();
      return token.value;
    }

    if (token.type === 'LPAREN') {
      this.consume();
      const value = this.parseAdd();
      const nextToken = this.peek();

      if (nextToken.type !== 'RPAREN') {
        throw new SyntaxError(`Expected ')' at position ${nextToken.pos}`);
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
