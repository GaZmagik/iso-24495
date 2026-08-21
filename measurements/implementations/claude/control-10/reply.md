I've read the spec. Here is `evaluate.ts`, a recursive descent parser matching the grammar and error rules.

```typescript
/**
 * Arithmetic expression evaluator.
 *
 * Grammar, loosest binding first:
 *
 *   expression  := term (('+' | '-') term)*
 *   term        := factor (('*' | '/' | '%') factor)*
 *   factor      := ('+' | '-') factor | power
 *   power       := primary ('^' factor)?
 *   primary     := number | '(' expression ')'
 *
 * Putting `power` below `factor` is what makes `^` bind tighter than a unary
 * sign, so `-2^2` is -4. Recursing back into `factor` on the right of `^`
 * makes it right associative and lets the exponent carry its own sign, so
 * `2^3^2` is 512 and `2^-1` is 0.5.
 */

const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parse(): number {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      throw this.error(`Unexpected character '${this.text[this.pos]}'`);
    }
    return value;
  }

  /** `+` and `-`, left associative. */
  private parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      this.skipWhitespace();
      const operator = this.text[this.pos];
      if (operator !== '+' && operator !== '-') {
        return value;
      }
      this.pos += 1;
      const right = this.parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
  }

  /** `*`, `/` and `%`, left associative. */
  private parseTerm(): number {
    let value = this.parseFactor();
    for (;;) {
      this.skipWhitespace();
      const operator = this.text[this.pos];
      if (operator !== '*' && operator !== '/' && operator !== '%') {
        return value;
      }
      const operatorPos = this.pos;
      this.pos += 1;
      const right = this.parseFactor();
      if (right === 0 && operator !== '*') {
        // operatorPos is kept only so this stays easy to extend with a
        // position later; the spec fixes the message exactly as below.
        void operatorPos;
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
  }

  /** Unary `+` and `-`, which may be stacked. */
  private parseFactor(): number {
    this.skipWhitespace();
    const sign = this.text[this.pos];
    if (sign === '+' || sign === '-') {
      this.pos += 1;
      const operand = this.parseFactor();
      return sign === '-' ? -operand : operand;
    }
    return this.parsePower();
  }

  /** `^`, right associative, with a signed exponent allowed. */
  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();
    if (this.text[this.pos] !== '^') {
      return base;
    }
    this.pos += 1;
    return Math.pow(base, this.parseFactor());
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    if (this.pos >= this.text.length) {
      throw this.error('Unexpected end of input');
    }

    const char = this.text[this.pos];

    if (char === '(') {
      this.pos += 1;
      const value = this.parseExpression();
      this.skipWhitespace();
      if (this.pos >= this.text.length) {
        throw this.error("Expected ')'");
      }
      if (this.text[this.pos] !== ')') {
        throw this.error(`Expected ')' but found '${this.text[this.pos]}'`);
      }
      this.pos += 1;
      return value;
    }

    if (DIGIT.test(char) || char === '.') {
      return this.parseNumber();
    }

    throw this.error(`Unexpected character '${char}'`);
  }

  /** Integers and decimals, including the forms `.5` and `10.`. */
  private parseNumber(): number {
    const start = this.pos;
    let sawDigit = false;

    while (this.pos < this.text.length && DIGIT.test(this.text[this.pos])) {
      this.pos += 1;
      sawDigit = true;
    }

    if (this.text[this.pos] === '.') {
      this.pos += 1;
      while (this.pos < this.text.length && DIGIT.test(this.text[this.pos])) {
        this.pos += 1;
        sawDigit = true;
      }
    }

    if (!sawDigit) {
      // A lone '.' reached parsePrimary as if it began a number.
      this.pos = start;
      throw this.error('Expected a number');
    }

    return Number(this.text.slice(start, this.pos));
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && WHITESPACE.test(this.text[this.pos])) {
      this.pos += 1;
    }
  }

  /**
   * The position is always the current cursor, which whitespace skipping has
   * already advanced to the offending character, or to the input length when
   * the expression ended too early.
   */
  private error(message: string): SyntaxError {
    return new SyntaxError(`${message} at position ${this.pos}`);
  }
}

export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}
```

A few notes on the choices, and on what I have not checked:

- The `%` operator throws `RangeError('Division by zero')` alongside `/`, since the spec names both.
- Exponent notation such as `1e5` is not in the grammar, so `1e5` fails at position 1 with an unexpected character. Say if you want it supported.
- I traced the five error cases by hand and they land on positions 3, 6, 4, 0 and 2 as specified, but I was told not to write files, so nothing here has actually been compiled or run.
