type TokenType =
  | "NUMBER"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "PERCENT"
  | "CARET"
  | "LPAREN"
  | "RPAREN"
  | "EOF";

interface Token {
  type: TokenType;
  value?: number;
  pos: number;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = expression.length;

  while (i < n) {
    const ch = expression[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    if (ch === "+") {
      tokens.push({ type: "PLUS", pos: i });
      i++;
    } else if (ch === "-") {
      tokens.push({ type: "MINUS", pos: i });
      i++;
    } else if (ch === "*") {
      tokens.push({ type: "STAR", pos: i });
      i++;
    } else if (ch === "/") {
      tokens.push({ type: "SLASH", pos: i });
      i++;
    } else if (ch === "%") {
      tokens.push({ type: "PERCENT", pos: i });
      i++;
    } else if (ch === "^") {
      tokens.push({ type: "CARET", pos: i });
      i++;
    } else if (ch === "(") {
      tokens.push({ type: "LPAREN", pos: i });
      i++;
    } else if (ch === ")") {
      tokens.push({ type: "RPAREN", pos: i });
      i++;
    } else if (ch >= "0" && ch <= "9") {
      const start = i;
      while (i < n && expression[i] >= "0" && expression[i] <= "9") {
        i++;
      }
      if (i < n && expression[i] === ".") {
        i++;
        while (i < n && expression[i] >= "0" && expression[i] <= "9") {
          i++;
        }
      }
      const numStr = expression.slice(start, i);
      tokens.push({ type: "NUMBER", value: Number(numStr), pos: start });
    } else if (ch === ".") {
      const start = i;
      if (i + 1 < n && expression[i + 1] >= "0" && expression[i + 1] <= "9") {
        i++; // skip '.'
        while (i < n && expression[i] >= "0" && expression[i] <= "9") {
          i++;
        }
        const numStr = expression.slice(start, i);
        tokens.push({ type: "NUMBER", value: Number(numStr), pos: start });
      } else {
        throw new SyntaxError(`Unexpected character '.' at position ${i}`);
      }
    } else {
      throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
    }
  }

  tokens.push({ type: "EOF", pos: n });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): number {
    const result = this.parseAdd();
    if (!this.isAtEnd()) {
      const token = this.peek();
      throw new SyntaxError(`Unexpected token at position ${token.pos}`);
    }
    return result;
  }

  // Precedence 1: Binary + and - (left-associative)
  private parseAdd(): number {
    let left = this.parseMul();

    while (this.match("PLUS", "MINUS")) {
      const op = this.previous();
      const right = this.parseMul();
      if (op.type === "PLUS") {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  // Precedence 2: Binary *, /, % (left-associative)
  private parseMul(): number {
    let left = this.parseUnary();

    while (this.match("STAR", "SLASH", "PERCENT")) {
      const op = this.previous();
      const right = this.parseUnary();
      if (op.type === "STAR") {
        left = left * right;
      } else if (op.type === "SLASH") {
        if (right === 0) {
          throw new RangeError("Division by zero");
        }
        left = left / right;
      } else {
        if (right === 0) {
          throw new RangeError("Division by zero");
        }
        left = left % right;
      }
    }

    return left;
  }

  // Precedence 3: Unary + and - (prefix)
  private parseUnary(): number {
    if (this.match("PLUS")) {
      return +this.parseUnary();
    }
    if (this.match("MINUS")) {
      return -this.parseUnary();
    }
    return this.parsePower();
  }

  // Precedence 4: Binary ^ (right-associative)
  private parsePower(): number {
    const left = this.parsePrimary();

    if (this.match("CARET")) {
      const right = this.parseUnary();
      return Math.pow(left, right);
    }

    return left;
  }

  // Primary: numbers and parenthesized expressions
  private parsePrimary(): number {
    if (this.match("NUMBER")) {
      return this.previous().value!;
    }

    if (this.match("LPAREN")) {
      const expr = this.parseAdd();
      if (!this.match("RPAREN")) {
        throw new SyntaxError(`Expected ')' at position ${this.peek().pos}`);
      }
      return expr;
    }

    const token = this.peek();
    throw new SyntaxError(`Unexpected token at position ${token.pos}`);
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return type === "EOF";
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === "EOF";
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  return parser.parse();
}
