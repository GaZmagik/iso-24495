I've read the spec. Here is the implementation.

```typescript
/**
 * Arithmetic expression evaluator.
 *
 * Grammar, lowest precedence first:
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/" | "%") unary)*
 *   unary      := ("+" | "-") unary | power
 *   power      := primary ("^" unary)?
 *   primary    := number | "(" expression ")"
 *
 * `power` takes its right operand from `unary`, which makes `^` right
 * associative and binds it tighter than a leading sign, so `-2^2` is -4.
 */

/** Sticky so a number is matched at the cursor rather than searched for. */
const NUMBER_AT_CURSOR = /\d+(?:\.\d*)?|\.\d+/y;

export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseExpression();
  parser.expectEndOfInput();
  return value;
}

class Parser {
  private position = 0;

  constructor(private readonly source: string) {}

  parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      const operator = this.take("+-");
      if (operator === null) return value;
      const right = this.parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
  }

  parseTerm(): number {
    let value = this.parseUnary();
    for (;;) {
      const operator = this.take("*/%");
      if (operator === null) return value;
      value = applyTermOperator(operator, value, this.parseUnary());
    }
  }

  parseUnary(): number {
    const sign = this.take("+-");
    if (sign === null) return this.parsePower();
    const value = this.parseUnary();
    return sign === "-" ? -value : value;
  }

  parsePower(): number {
    const base = this.parsePrimary();
    if (this.take("^") === null) return base;
    return base ** this.parseUnary();
  }

  parsePrimary(): number {
    const number = this.takeNumber();
    if (number !== null) return number;

    if (this.take("(") !== null) {
      const value = this.parseExpression();
      if (this.take(")") === null) {
        throw this.errorHere(`Expected ")" but found ${this.describeHere()}`);
      }
      return value;
    }

    throw this.errorHere(
      `Expected a number or "(" but found ${this.describeHere()}`,
    );
  }

  expectEndOfInput(): void {
    this.skipWhitespace();
    if (this.position < this.source.length) {
      throw this.errorHere(
        `Unexpected ${this.describeHere()} after the expression`,
      );
    }
  }

  /** Consumes the next character when it is one of `characters`. */
  private take(characters: string): string | null {
    this.skipWhitespace();
    const character = this.source[this.position];
    if (character === undefined || !characters.includes(character)) return null;
    this.position += 1;
    return character;
  }

  private takeNumber(): number | null {
    this.skipWhitespace();
    NUMBER_AT_CURSOR.lastIndex = this.position;
    const match = NUMBER_AT_CURSOR.exec(this.source);
    if (match === null) return null;
    this.position = NUMBER_AT_CURSOR.lastIndex;
    return Number(match[0]);
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.position] ?? "")) this.position += 1;
  }

  private describeHere(): string {
    if (this.position >= this.source.length) return "the end of the expression";
    return `"${this.source[this.position]}"`;
  }

  private errorHere(message: string): SyntaxError {
    return new SyntaxError(`${message} at position ${this.position}`);
  }
}

function applyTermOperator(
  operator: string,
  left: number,
  right: number,
): number {
  if (operator === "*") return left * right;
  if (right === 0) throw new RangeError("Division by zero");
  return operator === "/" ? left / right : left % right;
}
```

**How the error positions come out.** Every `take` skips whitespace before testing the character, so the cursor already sits on the offending character (or at the input length) when an error is raised. That gives position 3 for `2 +`, 6 for `(1 + 2`, 4 for `1 + )`, 0 for the empty string and 2 for `1 $ 2`.

**One reading I had to settle.** The spec says whitespace anywhere is ignored, which taken literally would make `1 2` the number 12 and `2 . 5` the number 2.5. I read it as whitespace between tokens, so a number may not contain spaces and `1 2` fails at position 2. Tell me if you want the literal reading instead.

**Not verified.** I have not run this code or any tests, because you asked for output only and no file writes. The behaviour above is derived from reading the grammar, not from execution.
