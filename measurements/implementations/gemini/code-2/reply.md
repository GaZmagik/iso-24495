Here is the complete implementation of `evaluate.ts` for arithmetic expression evaluation.

```typescript
interface Token {
  type: "number" | "operator" | "paren" | "eof";
  value?: number;
  text: string;
  position: number;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const length = expression.length;

  while (index < length) {
    const char = expression[index];

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (char >= "0" && char <= "9") {
      const start = index;
      while (index < length && expression[index] >= "0" && expression[index] <= "9") {
        index++;
      }
      if (index < length && expression[index] === ".") {
        index++;
        while (index < length && expression[index] >= "0" && expression[index] <= "9") {
          index++;
        }
      }
      const raw = expression.slice(start, index);
      tokens.push({
        type: "number",
        value: Number(raw),
        text: raw,
        position: start,
      });
      continue;
    }

    if (char === ".") {
      const nextChar = expression[index + 1];
      if (nextChar !== undefined && nextChar >= "0" && nextChar <= "9") {
        const start = index;
        index++;
        while (index < length && expression[index] >= "0" && expression[index] <= "9") {
          index++;
        }
        const raw = expression.slice(start, index);
        tokens.push({
          type: "number",
          value: Number(raw),
          text: raw,
          position: start,
        });
        continue;
      }
      throw new SyntaxError(`Unexpected character '.' at position ${index}`);
    }

    if (char === "(" || char === ")") {
      tokens.push({
        type: "paren",
        text: char,
        position: index,
      });
      index++;
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "%" || char === "^") {
      tokens.push({
        type: "operator",
        text: char,
        position: index,
      });
      index++;
      continue;
    }

    throw new SyntaxError(`Unexpected character '${char}' at position ${index}`);
  }

  tokens.push({
    type: "eof",
    text: "",
    position: length,
  });

  return tokens;
}

class Parser {
  private tokens: Token[];
  private cursor = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.cursor];
  }

  private consume(): Token {
    const token = this.tokens[this.cursor];
    this.cursor++;
    return token;
  }

  parse(): number {
    const result = this.parseAdditive();
    const current = this.peek();
    if (current.type !== "eof") {
      throw new SyntaxError(`Unexpected token '${current.text}' at position ${current.position}`);
    }
    return result;
  }

  private parseAdditive(): number {
    let left = this.parseMultiplicative();

    while (true) {
      const token = this.peek();
      if (token.type === "operator" && (token.text === "+" || token.text === "-")) {
        this.consume();
        const right = this.parseMultiplicative();
        left = token.text === "+" ? left + right : left - right;
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
      if (token.type === "operator" && (token.text === "*" || token.text === "/" || token.text === "%")) {
        this.consume();
        const right = this.parseUnary();

        if (token.text === "/" || token.text === "%") {
          if (right === 0) {
            throw new RangeError("Division by zero");
          }
          left = token.text === "/" ? left / right : left % right;
        } else {
          left = left * right;
        }
      } else {
        break;
      }
    }

    return left;
  }

  private parseUnary(): number {
    const token = this.peek();
    if (token.type === "operator" && (token.text === "+" || token.text === "-")) {
      this.consume();
      const operand = this.parseUnary();
      return token.text === "+" ? operand : -operand;
    }

    return this.parsePower();
  }

  private parsePower(): number {
    const left = this.parsePrimary();
    const token = this.peek();

    if (token.type === "operator" && token.text === "^") {
      this.consume();
      // Exponentiation is right-associative and binds tighter than unary operators
      const right = this.parseUnary();
      return Math.pow(left, right);
    }

    return left;
  }

  private parsePrimary(): number {
    const token = this.peek();

    if (token.type === "number") {
      this.consume();
      return token.value!;
    }

    if (token.type === "paren" && token.text === "(") {
      this.consume();
      const value = this.parseAdditive();
      const closing = this.peek();
      if (closing.type !== "paren" || closing.text !== ")") {
        throw new SyntaxError(`Expected ')' at position ${closing.position}`);
      }
      this.consume();
      return value;
    }

    if (token.type === "eof") {
      throw new SyntaxError(`Unexpected end of expression at position ${token.position}`);
    }

    throw new SyntaxError(`Unexpected token '${token.text}' at position ${token.position}`);
  }
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  return parser.parse();
}
```
