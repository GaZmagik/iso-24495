Read the spec. Here's the implementation — a recursive-descent parser over the raw string, with `pos` always parked on the offending character when an error is raised so the reported index falls out naturally.

```typescript
/**
 * Arithmetic expression evaluator.
 *
 * expression := term (("+" | "-") term)*
 * term       := unary (("*" | "/" | "%") unary)*
 * unary      := ("+" | "-") unary | power
 * power      := primary ("^" unary)?      // right associative; RHS may be unary
 * primary    := number | "(" expression ")"
 */

const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= '0' && char <= '9';

const isWhitespace = (char: string | undefined): boolean =>
  char !== undefined && /\s/.test(char);

export function evaluate(expression: string): number {
  let pos = 0;

  /** Skips whitespace and returns the next significant character, if any. */
  function peek(): string | undefined {
    while (isWhitespace(expression[pos])) pos++;
    return expression[pos];
  }

  /** Reports a syntax error at the current position. */
  function fail(): never {
    const char = expression[pos];
    const where = `at position ${pos}`;
    throw new SyntaxError(
      char === undefined
        ? `Unexpected end of input ${where}`
        : `Unexpected token "${char}" ${where}`,
    );
  }

  function parseExpression(): number {
    let value = parseTerm();
    for (let op = peek(); op === '+' || op === '-'; op = peek()) {
      pos++;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseUnary();
    for (let op = peek(); op === '*' || op === '/' || op === '%'; op = peek()) {
      pos++;
      const rhs = parseUnary();
      if (op !== '*' && rhs === 0) throw new RangeError('Division by zero');
      value = op === '*' ? value * rhs : op === '/' ? value / rhs : value % rhs;
    }
    return value;
  }

  function parseUnary(): number {
    const op = peek();
    if (op === '-' || op === '+') {
      pos++;
      const value = parseUnary();
      return op === '-' ? -value : value;
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (peek() !== '^') return base;
    pos++;
    // The exponent is a unary, which makes "^" right associative and admits "2^-3".
    return base ** parseUnary();
  }

  function parsePrimary(): number {
    const char = peek();
    if (char === '(') {
      pos++;
      const value = parseExpression();
      if (peek() !== ')') fail();
      pos++;
      return value;
    }
    if (isDigit(char) || char === '.') return parseNumber();
    fail();
  }

  function parseNumber(): number {
    const start = pos;
    let digits = 0;
    while (isDigit(expression[pos])) {
      pos++;
      digits++;
    }
    if (expression[pos] === '.') {
      pos++;
      while (isDigit(expression[pos])) {
        pos++;
        digits++;
      }
    }
    if (digits === 0) {
      pos = start; // a bare "." is not a number
      fail();
    }
    return parseFloat(expression.slice(start, pos));
  }

  const result = parseExpression();
  if (peek() !== undefined) fail();
  return result;
}
```

Notes on the tricky parts:

- **`^` right associativity and unary interaction.** `power` recurses into `unary` for its exponent rather than into itself, which gives `2^3^2 = 512` and also lets `2^-3` parse. Because unary minus sits *above* `power` in the chain, `-2^2` parses as `-(2^2) = -4` as specified.
- **Error positions.** `peek()` consumes whitespace before returning, so `pos` is left on the first significant character. `fail()` then reports that index, or `expression.length` when input ran out. This yields position 3 for `2 +`, 6 for `(1 + 2`, 4 for `1 + )`, 0 for `""`, and 2 for `1 $ 2`.
- **Numbers.** Digits are counted across both sides of the decimal point, so `3`, `2.5`, `.5`, and `10.` all parse while a lone `.` fails at its own index.
- **Division by zero** is checked before the operation for `/` and `%` only; note `-0 === 0` in JS, so `1 / -0` throws rather than returning `-Infinity`.
