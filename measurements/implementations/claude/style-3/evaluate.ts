/**
 * Arithmetic expression evaluator.
 *
 * Grammar, lowest precedence first:
 *
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/' | '%') unary)*
 *   unary      := ('+' | '-') unary | power
 *   power      := primary ('^' unary)?     // right associative
 *   primary    := number | '(' expression ')'
 *
 * Putting `power` below `unary` makes `^` bind tighter than a leading sign,
 * so `-2^2` is -4. Letting the right side of `^` be a `unary` keeps the
 * operator right associative and allows a signed exponent, as in `2^-3`.
 */

/** Matches `3`, `2.5`, `10.` and `.5`, but not a bare `.`. Sticky: anchored at `lastIndex`. */
const NUMBER = /\d+(?:\.\d*)?|\.\d+/y;

/**
 * Evaluates an arithmetic expression.
 *
 * @throws SyntaxError if the expression is malformed. The message ends with
 *   ` at position N`, where N is the zero-based index of the offending
 *   character, or the input length if the expression ends too early.
 * @throws RangeError if the expression divides by zero.
 */
export function evaluate(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseExpression();
  parser.expectEnd();
  return value;
}

/** Recursive descent parser that evaluates as it parses. */
class Parser {
  private pos = 0;

  constructor(private readonly source: string) {}

  /** Parses `+` and `-`, left associative. */
  parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      const operator = this.peek('+', '-');
      if (operator === null) return value;
      this.pos += 1;
      const right = this.parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
  }

  /** Consumes any trailing whitespace and rejects anything left over. */
  expectEnd(): void {
    this.skipWhitespace();
    if (this.pos < this.source.length) throw this.unexpectedCharacter();
  }

  /** Parses `*`, `/` and `%`, left associative. */
  private parseTerm(): number {
    let value = this.parseUnary();
    for (;;) {
      const operator = this.peek('*', '/', '%');
      if (operator === null) return value;
      this.pos += 1;
      const right = this.parseUnary();
      if (operator === '*') {
        value = value * right;
      } else {
        if (right === 0) throw new RangeError('Division by zero');
        value = operator === '/' ? value / right : value % right;
      }
    }
  }

  /** Parses a chain of unary signs, then the power below it. */
  private parseUnary(): number {
    const operator = this.peek('+', '-');
    if (operator === null) return this.parsePower();
    this.pos += 1;
    const value = this.parseUnary();
    return operator === '-' ? -value : value;
  }

  /** Parses `^`, right associative. */
  private parsePower(): number {
    const base = this.parsePrimary();
    if (this.peek('^') === null) return base;
    this.pos += 1;
    return base ** this.parseUnary();
  }

  /** Parses a number or a parenthesised expression. */
  private parsePrimary(): number {
    this.skipWhitespace();
    if (this.pos >= this.source.length) {
      throw this.syntaxError('Unexpected end of expression');
    }

    if (this.source[this.pos] === '(') {
      this.pos += 1;
      const value = this.parseExpression();
      this.skipWhitespace();
      if (this.source[this.pos] !== ')') throw this.syntaxError("Expected ')'");
      this.pos += 1;
      return value;
    }

    NUMBER.lastIndex = this.pos;
    const match = NUMBER.exec(this.source);
    if (match === null) throw this.unexpectedCharacter();
    this.pos += match[0].length;
    return Number(match[0]);
  }

  /**
   * Skips whitespace, then returns the next character if it is one of
   * `candidates`. Returns null otherwise, leaving the position on the
   * first non-whitespace character either way.
   */
  private peek(...candidates: string[]): string | null {
    this.skipWhitespace();
    const character = this.source[this.pos];
    return candidates.includes(character) ? character : null;
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
      this.pos += 1;
    }
  }

  private unexpectedCharacter(): SyntaxError {
    return this.syntaxError(`Unexpected character '${this.source[this.pos]}'`);
  }

  private syntaxError(message: string): SyntaxError {
    return new SyntaxError(`${message} at position ${this.pos}`);
  }
}
