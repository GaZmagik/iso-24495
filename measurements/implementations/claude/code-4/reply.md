Read the spec. Here is `evaluate.ts`.

```typescript
const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

/**
 * Evaluates an arithmetic expression and returns its value.
 *
 * Throws a SyntaxError for malformed input and a RangeError for division by zero.
 */
export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseSum();
  parser.expectEnd();
  return value;
}

/**
 * A recursive descent parser over the expression grammar.
 *
 * Each parse method handles one precedence level and calls the next tighter
 * level, so the call order below reads lowest precedence first.
 */
class Parser {
  private readonly source: string;
  private position = 0;

  constructor(source: string) {
    this.source = source;
  }

  /** `+` and `-`, left associative. */
  parseSum(): number {
    let value = this.parseProduct();
    for (let operator = this.take('+-'); operator !== ''; operator = this.take('+-')) {
      const right = this.parseProduct();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  /** `*`, `/` and `%`, left associative. */
  private parseProduct(): number {
    let value = this.parseUnary();
    for (let operator = this.take('*/%'); operator !== ''; operator = this.take('*/%')) {
      const right = this.parseUnary();
      if (operator !== '*' && right === 0) {
        throw new RangeError('Division by zero');
      }
      if (operator === '*') {
        value = value * right;
      } else if (operator === '/') {
        value = value / right;
      } else {
        value = value % right;
      }
    }
    return value;
  }

  /** Unary `-` and `+`, which bind looser than `^` so that `-2^2` is -4. */
  private parseUnary(): number {
    const operator = this.take('+-');
    if (operator === '') {
      return this.parsePower();
    }
    const operand = this.parseUnary();
    return operator === '-' ? -operand : operand;
  }

  /**
   * `^`, right associative.
   *
   * The exponent is parsed as a unary expression so that `2^-3` is accepted and
   * so that a chain such as `2^3^2` nests to the right.
   */
  private parsePower(): number {
    const base = this.parseAtom();
    if (this.take('^') === '') {
      return base;
    }
    return base ** this.parseUnary();
  }

  /** A number or a parenthesised expression. */
  private parseAtom(): number {
    this.skipWhitespace();
    const character = this.peek();

    if (DIGIT.test(character) || character === '.') {
      return this.readNumber();
    }

    if (character === '(') {
      this.position += 1;
      const value = this.parseSum();
      this.skipWhitespace();
      if (this.peek() !== ')') {
        throw this.error('Expected ")"', this.position);
      }
      this.position += 1;
      return value;
    }

    throw this.unexpected(this.position);
  }

  /** Reports trailing input that no rule consumed, such as the `$` in `1 $ 2`. */
  expectEnd(): void {
    this.skipWhitespace();
    if (this.position < this.source.length) {
      throw this.unexpected(this.position);
    }
  }

  /** Accepts `3`, `2.5`, `.5` and `10.`, but rejects a lone `.`. */
  private readNumber(): number {
    const start = this.position;
    let digits = this.readDigits();

    if (this.peek() === '.') {
      this.position += 1;
      digits += this.readDigits();
    }

    if (digits === 0) {
      throw this.unexpected(start);
    }
    return Number(this.source.slice(start, this.position));
  }

  private readDigits(): number {
    let count = 0;
    while (DIGIT.test(this.peek())) {
      this.position += 1;
      count += 1;
    }
    return count;
  }

  /**
   * Consumes the next character if it is one of `characters` and returns it,
   * or returns an empty string without consuming anything.
   */
  private take(characters: string): string {
    this.skipWhitespace();
    const character = this.peek();
    if (character === '' || !characters.includes(character)) {
      return '';
    }
    this.position += 1;
    return character;
  }

  private skipWhitespace(): void {
    while (WHITESPACE.test(this.peek())) {
      this.position += 1;
    }
  }

  /** Returns an empty string at the end of the input, which no rule matches. */
  private peek(): string {
    return this.position < this.source.length ? this.source[this.position] : '';
  }

  private unexpected(position: number): SyntaxError {
    if (position >= this.source.length) {
      return this.error('Unexpected end of input', this.source.length);
    }
    return this.error(`Unexpected character "${this.source[position]}"`, position);
  }

  private error(problem: string, position: number): SyntaxError {
    return new SyntaxError(`${problem} at position ${position}`);
  }
}
```

Notes on the choices the spec left open:

- **Whitespace separates tokens rather than vanishing inside them.** So `1 + 2` is 3, but `1 2` fails at position 2 and `1 . 5` fails at position 2. Reading "whitespace anywhere is ignored" literally would make `1 2` mean 12, which no arithmetic reader expects.
- **`%` by zero throws the same `RangeError`** as `/`, as the spec groups them.
- **Exponent notation is not in the grammar**, so `1e5` fails at position 1.
- **`-0` counts as zero**, because `-0 === 0`, so `1 / -0` throws rather than returning `-Infinity`.

I have not run this against a test suite; no test file was in the directory and you asked for output only, so it is written but unverified.
