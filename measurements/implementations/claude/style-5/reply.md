```typescript
/**
 * Arithmetic expression evaluator.
 *
 * Grammar, lowest precedence first:
 *   additive       := multiplicative (("+" | "-") multiplicative)*
 *   multiplicative := unary (("*" | "/" | "%") unary)*
 *   unary          := ("+" | "-") unary | power
 *   power          := primary ("^" unary)?
 *   primary        := number | "(" additive ")"
 *
 * `power` recurses into `unary` for its exponent, which makes `^` right
 * associative and lets it bind tighter than a leading sign, so `-2^2` is -4.
 */

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

class Parser {
  private readonly source: string;
  private position = 0;

  constructor(source: string) {
    this.source = source;
  }

  parse(): number {
    const value = this.parseAdditive();
    this.skipWhitespace();
    if (this.position < this.source.length) {
      throw this.error(`Unexpected character "${this.source[this.position]}"`);
    }
    return value;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    for (;;) {
      this.skipWhitespace();
      const operator = this.source[this.position];
      if (operator !== "+" && operator !== "-") {
        return value;
      }
      this.position++;
      const right = this.parseMultiplicative();
      value = operator === "+" ? value + right : value - right;
    }
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();
    for (;;) {
      this.skipWhitespace();
      const operator = this.source[this.position];
      if (operator !== "*" && operator !== "/" && operator !== "%") {
        return value;
      }
      this.position++;
      const right = this.parseUnary();
      if ((operator === "/" || operator === "%") && right === 0) {
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
    this.skipWhitespace();
    const operator = this.source[this.position];
    if (operator === "+" || operator === "-") {
      this.position++;
      const operand = this.parseUnary();
      return operator === "-" ? -operand : operand;
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();
    if (this.source[this.position] !== "^") {
      return base;
    }
    this.position++;
    return Math.pow(base, this.parseUnary());
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    if (this.position >= this.source.length) {
      throw this.error("Unexpected end of input");
    }

    const character = this.source[this.position];

    if (character === "(") {
      this.position++;
      const value = this.parseAdditive();
      this.skipWhitespace();
      if (this.position >= this.source.length) {
        throw this.error("Unexpected end of input");
      }
      if (this.source[this.position] !== ")") {
        throw this.error(`Expected ")"`);
      }
      this.position++;
      return value;
    }

    if (isDigit(character) || character === ".") {
      return this.parseNumber();
    }

    throw this.error(`Unexpected character "${character}"`);
  }

  private parseNumber(): number {
    const start = this.position;

    while (isDigit(this.source[this.position])) {
      this.position++;
    }
    if (this.source[this.position] === ".") {
      this.position++;
      while (isDigit(this.source[this.position])) {
        this.position++;
      }
    }

    const text = this.source.slice(start, this.position);
    if (text === ".") {
      throw this.error("Invalid number", start);
    }
    return Number(text);
  }

  private skipWhitespace(): void {
    while (this.position < this.source.length && /\s/.test(this.source[this.position])) {
      this.position++;
    }
  }

  private error(message: string, position: number = this.position): SyntaxError {
    return new SyntaxError(`${message} at position ${position}`);
  }
}

export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}
```

**What it does:** a recursive descent parser over the raw string, so the cursor index is the error position with no token layer in between.

Two design points worth naming:

- **`^` and unary sign.** `parsePower` takes its exponent from `parseUnary`, which gives right associativity (`2^3^2` is 512) and lets `^` bind tighter than a leading minus (`-2^2` is -4). It also accepts `2^-3`.
- **Number scanning.** Digits, then an optional `.` with optional trailing digits. That accepts `3`, `2.5`, `.5` and `10.`, and rejects a bare `.` with a `SyntaxError`.

**Status: written, not executed.** I traced the five spec error cases by hand and each lands on the stated index: `2 +` at 3, `(1 + 2` at 6, `1 + )` at 4, empty at 0, `1 $ 2` at 2. Trailing junk such as `1 2` fails at position 2, from the end-of-input check in `parse`. The open check is running it against a real test suite, which I have not done because you asked me not to write files.
