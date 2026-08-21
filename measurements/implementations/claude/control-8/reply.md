`SPEC.md` is a single self-contained task, so here is the implementation.

Design notes worth stating:

- Two stages: a tokeniser that records each token's start index, then a recursive-descent parser. Every token carries its position, so errors report the offending character directly, and a synthetic `end` token at `source.length` gives the "ends too early" positions.
- The `^` right operand is parsed as a *unary* expression rather than a *power*. That gets right associativity (`2^3^2` = 512) and admits a signed exponent (`2^-3`), while unary minus outside stays looser than `^` (`-2^2` = -4).

```typescript
/**
 * Evaluates arithmetic expressions of the form `1 + 2 * (3 ^ -0.5)`.
 *
 * The expression is tokenised first, then parsed by recursive descent. Each
 * token carries the index it started at so that a syntax error can name the
 * offending character; a synthetic `end` token sits at the input length so an
 * expression that stops early reports that length.
 */

type TokenKind = 'number' | 'operator' | 'open' | 'close' | 'end';

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly position: number;
}

const OPERATORS = new Set(['+', '-', '*', '/', '%', '^']);

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function syntaxError(message: string, position: number): SyntaxError {
  return new SyntaxError(`${message} at position ${position}`);
}

function describe(token: Token): string {
  return token.kind === 'end' ? 'end of input' : `'${token.text}'`;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    // A number is digits, an optional point, and more digits. At least one
    // digit must appear, so `3`, `2.5`, `.5` and `10.` are all accepted but a
    // lone `.` is not.
    if (isDigit(char) || char === '.') {
      const start = index;
      while (index < source.length && isDigit(source[index])) {
        index += 1;
      }
      if (source[index] === '.') {
        index += 1;
        while (index < source.length && isDigit(source[index])) {
          index += 1;
        }
      }
      const text = source.slice(start, index);
      if (text === '.') {
        throw syntaxError("Expected a digit next to '.'", start);
      }
      tokens.push({ kind: 'number', text, position: start });
      continue;
    }

    if (OPERATORS.has(char)) {
      tokens.push({ kind: 'operator', text: char, position: index });
    } else if (char === '(') {
      tokens.push({ kind: 'open', text: char, position: index });
    } else if (char === ')') {
      tokens.push({ kind: 'close', text: char, position: index });
    } else {
      throw syntaxError(`Unexpected character '${char}'`, index);
    }
    index += 1;
  }

  tokens.push({ kind: 'end', text: '', position: source.length });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number {
    const value = this.sum();
    const token = this.peek();
    if (token.kind !== 'end') {
      throw syntaxError(`Unexpected ${describe(token)}`, token.position);
    }
    return value;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  /** Consumes and returns the next token if it is one of the given operators. */
  private matchOperator(...texts: readonly string[]): Token | undefined {
    const token = this.peek();
    if (token.kind === 'operator' && texts.includes(token.text)) {
      this.index += 1;
      return token;
    }
    return undefined;
  }

  /** `+` and `-`, left associative. */
  private sum(): number {
    let value = this.product();
    while (true) {
      const operator = this.matchOperator('+', '-');
      if (!operator) {
        return value;
      }
      const right = this.product();
      value = operator.text === '+' ? value + right : value - right;
    }
  }

  /** `*`, `/` and `%`, left associative. */
  private product(): number {
    let value = this.unary();
    while (true) {
      const operator = this.matchOperator('*', '/', '%');
      if (!operator) {
        return value;
      }
      const right = this.unary();
      if (right === 0 && (operator.text === '/' || operator.text === '%')) {
        throw new RangeError('Division by zero');
      }
      switch (operator.text) {
        case '*':
          value *= right;
          break;
        case '/':
          value /= right;
          break;
        default:
          value %= right;
          break;
      }
    }
  }

  /** Unary `+` and `-`, binding tighter than any binary operator except `^`. */
  private unary(): number {
    const operator = this.matchOperator('+', '-');
    if (!operator) {
      return this.power();
    }
    const value = this.unary();
    return operator.text === '-' ? -value : value;
  }

  /**
   * `^`, right associative. The right operand is a unary expression, which
   * both allows a signed exponent (`2^-3`) and folds the rest of a chain to
   * the right (`2^3^2` is 512).
   */
  private power(): number {
    const base = this.primary();
    if (!this.matchOperator('^')) {
      return base;
    }
    return Math.pow(base, this.unary());
  }

  private primary(): number {
    const token = this.peek();

    if (token.kind === 'number') {
      this.index += 1;
      return Number(token.text);
    }

    if (token.kind === 'open') {
      this.index += 1;
      const value = this.sum();
      const closing = this.peek();
      if (closing.kind !== 'close') {
        throw syntaxError(`Expected ')' but found ${describe(closing)}`, closing.position);
      }
      this.index += 1;
      return value;
    }

    throw syntaxError(`Expected a number or '(' but found ${describe(token)}`, token.position);
  }
}

export function evaluate(expression: string): number {
  return new Parser(tokenize(expression)).parse();
}
```

Traced against every example in the spec: `2 +` → position 3, `(1 + 2` → 6, `1 + )` → 4, `` → 0, `1 $ 2` → 2 (raised by the tokeniser, same index either way). `-2^2` → -4 and `2^3^2` → 512.

Two things I have *not* done, since I traced the code by hand rather than running it: no compiler or test run against the file, and no decision recorded for cases the spec leaves open. The main open case is `1.2.3`, which lexes as `1.2` then `.3` and so fails at position 3 as trailing input; if you would rather it were a malformed-number error, that is a change in the tokeniser.
