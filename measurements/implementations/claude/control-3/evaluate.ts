/**
 * Arithmetic expression evaluator.
 *
 * Grammar (lowest precedence first):
 *   sum     := product (('+' | '-') product)*
 *   product := unary (('*' | '/' | '%') unary)*
 *   unary   := ('+' | '-') unary | power
 *   power   := atom ('^' unary)?          // right associative
 *   atom    := '(' sum ')' | number
 *
 * `power` recurses into `unary` for its exponent, which gives both right
 * associativity (`2^3^2` is 512) and unary operators that bind looser than
 * `^` on the left (`-2^2` is -4) but tighter on the right (`2^-3` is 0.125).
 */
export function evaluate(expression: string): number {
  return new Parser(expression).parse();
}

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parse(): number {
    const value = this.parseSum();
    this.skipSpaces();
    if (this.pos < this.src.length) this.fail('end of input');
    return value;
  }

  private parseSum(): number {
    let value = this.parseProduct();
    let op: string | null;
    while ((op = this.eat('+-')) !== null) {
      const right = this.parseProduct();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  private parseProduct(): number {
    let value = this.parseUnary();
    let op: string | null;
    while ((op = this.eat('*/%')) !== null) {
      const right = this.parseUnary();
      if (op === '*') {
        value *= right;
      } else {
        if (right === 0) throw new RangeError('Division by zero');
        value = op === '/' ? value / right : value % right;
      }
    }
    return value;
  }

  private parseUnary(): number {
    const op = this.eat('+-');
    if (op === null) return this.parsePower();
    const operand = this.parseUnary();
    return op === '-' ? -operand : operand;
  }

  private parsePower(): number {
    const base = this.parseAtom();
    if (this.eat('^') === null) return base;
    return base ** this.parseUnary();
  }

  private parseAtom(): number {
    if (this.eat('(') !== null) {
      const value = this.parseSum();
      if (this.eat(')') === null) this.fail('")"');
      return value;
    }
    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipSpaces();
    const start = this.pos;
    while (isDigit(this.src[this.pos])) this.pos++;
    if (this.src[this.pos] === '.') {
      this.pos++;
      while (isDigit(this.src[this.pos])) this.pos++;
    }
    const text = this.src.slice(start, this.pos);
    // A lone "." matched the shape of a number but carries no digits.
    if (text === '' || text === '.') {
      this.pos = start;
      this.fail('a number');
    }
    return Number(text);
  }

  private skipSpaces(): void {
    while (this.pos < this.src.length && isSpace(this.src[this.pos])) this.pos++;
  }

  /** Consume the next non-space character if it is one of `chars`. */
  private eat(chars: string): string | null {
    this.skipSpaces();
    const ch = this.src[this.pos];
    if (ch === undefined || !chars.includes(ch)) return null;
    this.pos++;
    return ch;
  }

  private fail(expected: string): never {
    const found =
      this.pos < this.src.length ? `"${this.src[this.pos]}"` : 'end of input';
    throw new SyntaxError(
      `Expected ${expected} but found ${found} at position ${this.pos}`,
    );
  }
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}
