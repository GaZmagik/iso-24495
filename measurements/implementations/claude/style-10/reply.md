The spec is a small recursive-descent parser with a right-associative `^` that binds tighter than unary minus. Here is `evaluate.ts`:

```typescript
/**
 * Arithmetic expression evaluator.
 *
 * Precedence, loosest first:
 *   1. `+` `-`        left associative
 *   2. `*` `/` `%`    left associative
 *   3. unary `+` `-`
 *   4. `^`            right associative, binds tighter than unary minus
 */

type Token =
  | { readonly kind: "number"; readonly value: number; readonly pos: number }
  | { readonly kind: "punctuator"; readonly text: string; readonly pos: number }
  | { readonly kind: "end"; readonly pos: number };

const PUNCTUATORS: ReadonlySet<string> = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "(",
  ")",
]);

function fail(message: string, pos: number): never {
  throw new SyntaxError(`${message} at position ${pos}`);
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isSpace(character: string): boolean {
  return /\s/.test(character);
}

/**
 * Splits the input into tokens. Whitespace is dropped. A number is a run of
 * digits with an optional decimal point, so `3`, `2.5`, `.5` and `10.` are all
 * accepted, but a bare `.` is not.
 */
function tokenise(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const character = input[i];

    if (isSpace(character)) {
      i += 1;
      continue;
    }

    if (isDigit(character) || character === ".") {
      const start = i;
      let digits = 0;

      while (i < input.length && isDigit(input[i])) {
        i += 1;
        digits += 1;
      }
      if (i < input.length && input[i] === ".") {
        i += 1;
        while (i < input.length && isDigit(input[i])) {
          i += 1;
          digits += 1;
        }
      }
      if (digits === 0) {
        fail("Invalid number", start);
      }

      tokens.push({
        kind: "number",
        value: Number(input.slice(start, i)),
        pos: start,
      });
      continue;
    }

    if (PUNCTUATORS.has(character)) {
      tokens.push({ kind: "punctuator", text: character, pos: i });
      i += 1;
      continue;
    }

    fail(`Unexpected character "${character}"`, i);
  }

  tokens.push({ kind: "end", pos: input.length });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  /** Parses a whole expression and checks that nothing is left over. */
  parse(): number {
    const value = this.parseSum();
    const token = this.peek();
    if (token.kind !== "end") {
      this.reject(token);
    }
    return value;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  /** Consumes the next token if it is one of `texts`, and returns its text. */
  private match(...texts: readonly string[]): string | null {
    const token = this.peek();
    if (token.kind === "punctuator" && texts.includes(token.text)) {
      this.index += 1;
      return token.text;
    }
    return null;
  }

  private reject(token: Token): never {
    if (token.kind === "end") {
      fail("Unexpected end of input", token.pos);
    }
    const text = token.kind === "number" ? String(token.value) : token.text;
    fail(`Unexpected token "${text}"`, token.pos);
  }

  private parseSum(): number {
    let value = this.parseProduct();
    for (;;) {
      const operator = this.match("+", "-");
      if (operator === null) {
        return value;
      }
      const right = this.parseProduct();
      value = operator === "+" ? value + right : value - right;
    }
  }

  private parseProduct(): number {
    let value = this.parseUnary();
    for (;;) {
      const operator = this.match("*", "/", "%");
      if (operator === null) {
        return value;
      }
      const right = this.parseUnary();
      if (operator !== "*" && right === 0) {
        throw new RangeError("Division by zero");
      }
      if (operator === "*") {
        value = value * right;
      } else if (operator === "/") {
        value = value / right;
      } else {
        value = value % right;
      }
    }
  }

  private parseUnary(): number {
    const operator = this.match("+", "-");
    if (operator === null) {
      return this.parsePower();
    }
    const operand = this.parseUnary();
    return operator === "-" ? -operand : operand;
  }

  /**
   * `^` is right associative and its right operand may itself carry a unary
   * sign, so `2^3^2` is 512 and `2^-1` is 0.5. Because the caller applies any
   * unary sign after this returns, `-2^2` is -4.
   */
  private parsePower(): number {
    const base = this.parsePrimary();
    if (this.match("^") === null) {
      return base;
    }
    return base ** this.parseUnary();
  }

  private parsePrimary(): number {
    const token = this.peek();

    if (token.kind === "number") {
      this.index += 1;
      return token.value;
    }

    if (token.kind === "punctuator" && token.text === "(") {
      this.index += 1;
      const value = this.parseSum();
      const closing = this.peek();
      if (closing.kind !== "punctuator" || closing.text !== ")") {
        this.reject(closing);
      }
      this.index += 1;
      return value;
    }

    this.reject(token);
  }
}

export function evaluate(expression: string): number {
  return new Parser(tokenise(expression)).parse();
}
```

Notes on the parts of the spec that shaped the design:

- **`^` versus unary minus.** `parseUnary` reads the sign, then calls `parsePower` for the operand, so the sign lands on the finished power. `-2^2` gives -4, and `2^3^2` gives 512 through `parsePower` recursing into `parseUnary`.
- **Error positions.** Every token carries its start index, and the synthetic `end` token carries the input length. That covers `2 +` at 3, `(1 + 2` at 6, `1 + )` at 4, and the empty string at 0, all through the same `fail` helper, so each message ends with ` at position N`.
- **Unknown characters.** The tokeniser scans the whole input before parsing, so `1 $ 2` reports position 2 rather than stopping at the trailing-token check.
- **Division by zero.** `/` and `%` both check the right operand and throw `RangeError("Division by zero")` with no position suffix, as specified.

I have not run this against a test suite, since you asked for output only and no file writes. The behaviour above is traced by hand from the grammar, not executed.
