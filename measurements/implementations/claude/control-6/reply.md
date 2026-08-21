`SPEC.md` is a self-contained parser task, so here is the implementation. Design notes:

- **Recursive descent** with the precedence chain `expression → term → unary → power → primary`. Putting `unary` above `power` and letting `power`'s right operand recurse back into `unary` gives both required behaviours: `-2^2` is `-4` and `2^3^2` is `512`, while `2^-3` still parses.
- **Position tracking** works on raw character indices, and every error is raised after skipping whitespace, so the reported index is the offending character rather than the space before it. When the input runs out, the index is the input length.
- **Division by zero** is checked on the evaluated right operand, which also catches `-0`.

Exponent notation (`1e5`) is not in the grammar, so `1e5` is rejected at position 1.

```typescript
/**
 * Arithmetic expression evaluator.
 *
 * Grammar, lowest precedence first:
 *
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/' | '%') unary)*
 *   unary      := ('+' | '-') unary | power
 *   power      := primary ('^' unary)?
 *   primary    := number | '(' expression ')'
 *
 * `power` takes a `unary` on its right, which makes `^` right associative and
 * lets it bind tighter than unary minus, so `-2^2` is -4 and `2^3^2` is 512.
 */

const WHITESPACE = /\s/;

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

class Parser {
  private position = 0;

  constructor(private readonly source: string) {}

  /** Parses the whole input and rejects anything left over. */
  parse(): number {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.position < this.source.length) {
      throw this.unexpected();
    }
    return value;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator !== '+' && operator !== '-') {
        return value;
      }
      this.position += 1;
      const right = this.parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
  }

  private parseTerm(): number {
    let value = this.parseUnary();
    for (;;) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator !== '*' && operator !== '/' && operator !== '%') {
        return value;
      }
      this.position += 1;
      const right = this.parseUnary();
      if (operator === '*') {
        value = value * right;
        continue;
      }
      // Catches -0 as well as 0, both of which are division by zero.
      if (right === 0) {
        throw new RangeError('Division by zero');
      }
      value = operator === '/' ? value / right : value % right;
    }
  }

  private parseUnary(): number {
    this.skipWhitespace();
    const sign = this.peek();
    if (sign === '-') {
      this.position += 1;
      return -this.parseUnary();
    }
    if (sign === '+') {
      this.position += 1;
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    this.skipWhitespace();
    if (this.peek() !== '^') {
      return base;
    }
    this.position += 1;
    // Recursing into `unary` keeps `^` right associative and allows `2^-3`.
    return base ** this.parseUnary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    const character = this.peek();

    if (character === '(') {
      this.position += 1;
      const value = this.parseExpression();
      this.skipWhitespace();
      if (this.peek() !== ')') {
        throw this.expected("')'");
      }
      this.position += 1;
      return value;
    }

    if (isDigit(character) || character === '.') {
      return this.parseNumber();
    }

    throw this.unexpected();
  }

  /** Reads an integer or decimal, including the `.5` and `10.` forms. */
  private parseNumber(): number {
    const start = this.position;

    while (isDigit(this.peek())) {
      this.position += 1;
    }
    if (this.peek() === '.') {
      this.position += 1;
      while (isDigit(this.peek())) {
        this.position += 1;
      }
    }

    const text = this.source.slice(start, this.position);
    if (text === '.') {
      // A lone dot is not a number, so report the dot itself.
      this.position = start;
      throw this.unexpected();
    }
    return Number(text);
  }

  private skipWhitespace(): void {
    while (this.position < this.source.length && WHITESPACE.test(this.source[this.position])) {
      this.position += 1;
    }
  }

  /** The current character, or the empty string once the input is exhausted. */
  private peek(): string {
    return this.position < this.source.length ? this.source[this.position] : '';
  }

  private unexpected(): SyntaxError {
    const character = this.peek();
    if (character === '') {
      return new SyntaxError(`Unexpected end of input at position ${this.source.length}`);
    }
    return new SyntaxError(`Unexpected character '${character}' at position ${this.position}`);
  }

  private expected(what: string): SyntaxError {
    const character = this.peek();
    if (character === '') {
      return new SyntaxError(`Expected ${what} but reached the end at position ${this.source.length}`);
    }
    return new SyntaxError(`Expected ${what} but found '${character}' at position ${this.position}`);
  }
}

export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}
```

Walking the specified error cases through this: `2 +` consumes the operator, then `parseTerm` skips the trailing space and hits the end at index 3; `(1 + 2` reaches the end looking for `)` and reports the input length, 6; `1 + )` fails in `parsePrimary` on `)` at index 4; empty input fails immediately at 0; and `1 $ 2` parses `1`, finds `$` is no operator, returns to `parse`, and the leftover check reports index 2.

I have not executed these, since the task asked for output only rather than files on disk.
