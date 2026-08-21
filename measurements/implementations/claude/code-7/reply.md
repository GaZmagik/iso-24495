I read `SPEC.md`. Here is the implementation.

```typescript
type Token =
  | { readonly kind: "number"; readonly text: string; readonly value: number; readonly position: number }
  | { readonly kind: "symbol"; readonly text: string; readonly position: number };

const SYMBOLS = "+-*/%^()";

export function evaluate(expression: string): number {
  const parser = new Parser(tokenize(expression), expression.length);
  return parser.parse();
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const character = expression[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (isDigit(character) || character === ".") {
      const start = index;
      while (isDigit(expression[index])) index += 1;
      if (expression[index] === ".") {
        index += 1;
        while (isDigit(expression[index])) index += 1;
      }
      const text = expression.slice(start, index);
      if (text === ".") throw fail('Expected a digit next to "."', start);
      tokens.push({ kind: "number", text, value: Number(text), position: start });
      continue;
    }

    if (SYMBOLS.includes(character)) {
      tokens.push({ kind: "symbol", text: character, position: index });
      index += 1;
      continue;
    }

    throw fail(`Unexpected character "${character}"`, index);
  }

  return tokens;
}

class Parser {
  private next = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly endPosition: number,
  ) {}

  parse(): number {
    const value = this.readSum();
    const leftover = this.peek();
    if (leftover) throw fail(`Unexpected "${leftover.text}"`, leftover.position);
    return value;
  }

  private readSum(): number {
    let total = this.readProduct();
    while (true) {
      const operator = this.takeSymbol("+", "-");
      if (!operator) return total;
      const right = this.readProduct();
      total = operator === "+" ? total + right : total - right;
    }
  }

  private readProduct(): number {
    let total = this.readUnary();
    while (true) {
      const operator = this.takeSymbol("*", "/", "%");
      if (!operator) return total;
      total = applyMultiplicative(operator, total, this.readUnary());
    }
  }

  private readUnary(): number {
    const sign = this.takeSymbol("+", "-");
    if (!sign) return this.readPower();
    const value = this.readUnary();
    return sign === "-" ? -value : value;
  }

  private readPower(): number {
    const base = this.readAtom();
    if (!this.takeSymbol("^")) return base;
    // The exponent goes back through readUnary, which gives "^" both its right
    // associativity and a tighter grip than the unary sign to its left.
    return base ** this.readUnary();
  }

  private readAtom(): number {
    const token = this.peek();
    if (!token) throw fail("Expected a number, but the expression ended", this.endPosition);

    if (token.kind === "number") {
      this.next += 1;
      return token.value;
    }

    if (token.text === "(") {
      this.next += 1;
      const value = this.readSum();
      this.expect(")");
      return value;
    }

    throw fail(`Expected a number, but found "${token.text}"`, token.position);
  }

  private expect(text: string): void {
    const token = this.peek();
    if (!token) throw fail(`Expected "${text}", but the expression ended`, this.endPosition);
    if (token.text !== text) throw fail(`Expected "${text}", but found "${token.text}"`, token.position);
    this.next += 1;
  }

  private takeSymbol(...candidates: string[]): string | undefined {
    const token = this.peek();
    if (!token || token.kind !== "symbol") return undefined;
    if (!candidates.includes(token.text)) return undefined;
    this.next += 1;
    return token.text;
  }

  private peek(): Token | undefined {
    return this.next < this.tokens.length ? this.tokens[this.next] : undefined;
  }
}

function applyMultiplicative(operator: string, left: number, right: number): number {
  if (operator === "*") return left * right;
  if (right === 0) throw new RangeError("Division by zero");
  return operator === "/" ? left / right : left % right;
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function fail(problem: string, position: number): SyntaxError {
  return new SyntaxError(`${problem} at position ${position}`);
}
```

How it meets the spec:

- **Precedence** comes from the descent chain `readSum` → `readProduct` → `readUnary` → `readPower` → `readAtom`. Because `readPower` takes its exponent from `readUnary`, `2^3^2` is 512 and `-2^2` is -4.
- **Error positions** use the token's own index, or `endPosition` (the input length) when the expression runs out. That gives 3 for `2 +`, 6 for `(1 + 2`, 4 for `1 + )`, 0 for the empty string, and 2 for `1 $ 2`.
- **Division by zero** is checked in `applyMultiplicative`, covering both `/` and `%`.

Status: written and reasoned through against every example in the spec, but not executed. I did not run a compiler or any tests, because you asked for output only, so the type-checking and the numeric results are unverified.
