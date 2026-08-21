Here is the complete implementation of `evaluate.ts`.

```typescript
type TokenType =
  | "NUMBER"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "^"
  | "("
  | ")"
  | "EOF";

interface Token {
  type: TokenType;
  value?: number;
  pos: number;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\v" || char === "\f";
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const length = expression.length;
  let pos = 0;

  while (pos < length) {
    const char = expression[pos];

    if (isWhitespace(char)) {
      pos++;
      continue;
    }

    if (isDigit(char)) {
      const start = pos;
      while (pos < length && isDigit(expression[pos])) {
        pos++;
      }
      if (pos < length && expression[pos] === ".") {
        pos++;
        while (pos < length && isDigit(expression[pos])) {
          pos++;
        }
      }
      tokens.push({
        type: "NUMBER",
        value: Number(expression.slice(start, pos)),
        pos: start,
      });
      continue;
    }

    if (char === ".") {
      const start = pos;
      if (pos + 1 < length && isDigit(expression[pos + 1])) {
        pos++;
        while (pos < length && isDigit(expression[pos])) {
          pos++;
        }
        tokens.push({
          type: "NUMBER",
          value: Number(expression.slice(start, pos)),
          pos: start,
        });
        continue;
      }
      throw new SyntaxError(`Unexpected character '.' at position ${pos}`);
    }

    if (
      char === "+" ||
      char === "-" ||
      char === "*" ||
      char === "/" ||
      char === "%" ||
      char === "^" ||
      char === "(" ||
      char === ")"
    ) {
      tokens.push({ type: char, pos });
      pos++;
      continue;
    }

    throw new SyntaxError(`Unexpected character '${char}' at position ${pos}`);
  }

  tokens.push({ type: "EOF", pos: length });
  return tokens;
}

function getBinaryPrecedence(type: TokenType): { lbp: number; rbp: number } | null {
  switch (type) {
    case "+":
    case "-":
      return { lbp: 10, rbp: 11 };
    case "*":
    case "/":
    case "%":
      return { lbp: 20, rbp: 21 };
    case "^":
      // Right-associative exponentiation binds tighter than unary operators.
      return { lbp: 40, rbp: 39 };
    default:
      return null;
  }
}

function applyBinary(operator: TokenType, left: number, right: number): number {
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      if (right === 0) {
        throw new RangeError("Division by zero");
      }
      return left / right;
    case "%":
      if (right === 0) {
        throw new RangeError("Division by zero");
      }
      return left % right;
    case "^":
      return Math.pow(left, right);
    default:
      throw new Error(`Unsupported operator '${operator}'`);
  }
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  let index = 0;

  function peek(): Token {
    return tokens[index];
  }

  function advance(): Token {
    const token = tokens[index];
    index++;
    return token;
  }

  function parsePrimary(): number {
    const token = peek();

    if (token.type === "NUMBER") {
      advance();
      return token.value!;
    }

    if (token.type === "+") {
      advance();
      return +parseExpression(30);
    }

    if (token.type === "-") {
      advance();
      return -parseExpression(30);
    }

    if (token.type === "(") {
      advance();
      const value = parseExpression(0);
      const next = peek();
      if (next.type !== ")") {
        throw new SyntaxError(`Expected ')' at position ${next.pos}`);
      }
      advance();
      return value;
    }

    if (token.type === "EOF") {
      throw new SyntaxError(`Unexpected end of input at position ${token.pos}`);
    }

    throw new SyntaxError(`Unexpected token '${token.type}' at position ${token.pos}`);
  }

  function parseExpression(minPrecedence: number): number {
    let left = parsePrimary();

    while (true) {
      const token = peek();
      const precedence = getBinaryPrecedence(token.type);
      if (!precedence || precedence.lbp < minPrecedence) {
        break;
      }

      advance();
      const right = parseExpression(precedence.rbp);
      left = applyBinary(token.type, left, right);
    }

    return left;
  }

  const result = parseExpression(0);
  const remaining = peek();
  if (remaining.type !== "EOF") {
    const tokenLabel = remaining.type === "NUMBER" ? remaining.value : remaining.type;
    throw new SyntaxError(`Unexpected token '${tokenLabel}' at position ${remaining.pos}`);
  }

  return result;
}
```
