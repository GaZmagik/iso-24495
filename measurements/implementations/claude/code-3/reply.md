I couldn't execute a test harness — the sandbox rejected every attempt to pipe JavaScript into `node` (brace-plus-quote heuristic on Bash, a 1015-byte limit on PowerShell), and I wasn't allowed to write a file. So the code below is hand-traced against the spec's examples, not machine-verified.

```typescript
/**
 * Recursive-descent evaluator for arithmetic expressions.
 *
 * The grammar, loosest binding first:
 *   sum     := product (("+" | "-") product)*
 *   product := unary (("*" | "/" | "%") unary)*
 *   unary   := ("+" | "-") unary | power
 *   power   := primary ("^" unary)?
 *   primary := number | "(" sum ")"
 *
 * `power` takes a `unary` on its right. That is what makes `^` right
 * associative and what lets it bind tighter than a leading sign, so
 * `2^3^2` is 512 and `-2^2` is -4.
 */
export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseSum();
  parser.expectEnd();
  return value;
}

class Parser {
  private readonly text: string;
  private index = 0;

  constructor(text: string) {
    this.text = text;
  }

  parseSum(): number {
    let value = this.parseProduct();
    for (;;) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator === "+") {
        this.index++;
        value += this.parseProduct();
      } else if (operator === "-") {
        this.index++;
        value -= this.parseProduct();
      } else {
        return value;
      }
    }
  }

  expectEnd(): void {
    this.skipWhitespace();
    if (this.index < this.text.length) {
      throw new SyntaxError(
        `Unexpected "${this.peek()}" at position ${this.index}`,
      );
    }
  }

  private parseProduct(): number {
    let value = this.parseUnary();
    for (;;) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator === "*") {
        this.index++;
        value *= this.parseUnary();
      } else if (operator === "/") {
        this.index++;
        value /= this.requireNonZero(this.parseUnary());
      } else if (operator === "%") {
        this.index++;
        value %= this.requireNonZero(this.parseUnary());
      } else {
        return value;
      }
    }
  }

  private parseUnary(): number {
    this.skipWhitespace();
    const operator = this.peek();
    if (operator === "-") {
      this.index++;
      return -this.parseUnary();
    }
    if (operator === "+") {
      this.index++;
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();
    if (this.peek() !== "^") {
      return base;
    }
    this.index++;
    return base ** this.parseUnary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    const character = this.peek();
    if (character === "(") {
      this.index++;
      const value = this.parseSum();
      this.skipWhitespace();
      if (this.peek() !== ")") {
        this.fail(`Expected ")"`);
      }
      this.index++;
      return value;
    }
    if (isDigit(character) || character === ".") {
      return this.readNumber();
    }
    this.fail(`Expected a number or "("`);
  }

  private readNumber(): number {
    const start = this.index;
    this.skipDigits();
    if (this.peek() === ".") {
      this.index++;
      this.skipDigits();
    }
    const digits = this.text.slice(start, this.index);
    if (digits === ".") {
      this.fail("Expected a digit");
    }
    return Number(digits);
  }

  private requireNonZero(divisor: number): number {
    if (divisor === 0) {
      throw new RangeError("Division by zero");
    }
    return divisor;
  }

  private skipDigits(): void {
    while (isDigit(this.peek())) {
      this.index++;
    }
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length && /\s/.test(this.text[this.index])) {
      this.index++;
    }
  }

  private peek(): string | undefined {
    return this.text[this.index];
  }

  /**
   * The position is the index of the offending character, or the input
   * length when the expression ran out, so both cases just report `index`.
   */
  private fail(expectation: string): never {
    const character = this.peek();
    const found =
      character === undefined
        ? "the expression ended"
        : `found "${character}"`;
    throw new SyntaxError(
      `${expectation} but ${found} at position ${this.index}`,
    );
  }
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}
```

**How the spec's error cases land**

- `2 +` — `parsePrimary` runs out of input at index 3, the input length.
- `(1 + 2` — the closing-paren check fails at index 6, the input length.
- `1 + )` — `parsePrimary` finds `)` at index 4.
- `` (empty) — `parsePrimary` runs out at index 0.
- `1 $ 2` — `parseSum` stops at `$`, so `expectEnd` reports index 2.

**One assumption you should check.** I read "whitespace anywhere is ignored" as whitespace *between* tokens, the usual tokenizer meaning. Under that reading `1 2` is an error at position 2 rather than the number 12, and `1 . 5` is an error rather than 1.5. The literal reading — strip whitespace before parsing — would make error positions refer to the stripped string, which contradicts the position examples, so I ruled it out.
