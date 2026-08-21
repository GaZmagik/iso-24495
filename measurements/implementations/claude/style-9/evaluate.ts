/**
 * Evaluates arithmetic expressions.
 *
 * Grammar, lowest precedence first:
 *
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/" | "%") unary)*
 *   unary      := ("+" | "-") unary | power
 *   power      := primary ("^" unary)?
 *   primary    := number | "(" expression ")"
 *
 * `power` takes its exponent from `unary` rather than from itself, which gives
 * `^` right associativity (`2^3^2` is 512) and lets it bind tighter than a
 * leading sign (`-2^2` is -4), while still accepting a signed exponent
 * such as `2^-3`.
 */

/** Matches `3`, `2.5`, `.5` and `10.`, but not a bare `.`. Sticky, so it only matches at `lastIndex`. */
const NUMBER = /\d+(?:\.\d*)?|\.\d+/y;

export function evaluate(expression: string): number {
  let pos = 0;

  /** Advances past any run of whitespace, so `pos` always points at meaningful input. */
  function skipWhitespace(): void {
    while (pos < expression.length && /\s/.test(expression[pos])) {
      pos += 1;
    }
  }

  /** Returns the next meaningful character, or `""` at the end of the input. */
  function peek(): string {
    skipWhitespace();
    return pos < expression.length ? expression[pos] : "";
  }

  /**
   * Reports the current position as malformed. The position is the index of the
   * offending character, or the input length if the expression ended too early.
   */
  function fail(): never {
    if (pos >= expression.length) {
      throw new SyntaxError(
        `Unexpected end of input at position ${expression.length}`,
      );
    }
    throw new SyntaxError(
      `Unexpected character "${expression[pos]}" at position ${pos}`,
    );
  }

  function parseExpression(): number {
    let value = parseTerm();

    for (;;) {
      const operator = peek();
      if (operator !== "+" && operator !== "-") {
        return value;
      }

      pos += 1;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
  }

  function parseTerm(): number {
    let value = parseUnary();

    for (;;) {
      const operator = peek();
      if (operator !== "*" && operator !== "/" && operator !== "%") {
        return value;
      }

      pos += 1;
      const right = parseUnary();

      if (operator === "*") {
        value = value * right;
        continue;
      }

      if (right === 0) {
        throw new RangeError("Division by zero");
      }
      value = operator === "/" ? value / right : value % right;
    }
  }

  function parseUnary(): number {
    const operator = peek();

    if (operator === "-") {
      pos += 1;
      return -parseUnary();
    }

    if (operator === "+") {
      pos += 1;
      return parseUnary();
    }

    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();

    if (peek() !== "^") {
      return base;
    }

    pos += 1;
    return base ** parseUnary();
  }

  function parsePrimary(): number {
    const character = peek();

    if (character === "(") {
      pos += 1;
      const value = parseExpression();

      if (peek() !== ")") {
        fail();
      }
      pos += 1;
      return value;
    }

    NUMBER.lastIndex = pos;
    const match = NUMBER.exec(expression);
    if (match === null) {
      fail();
    }

    pos = NUMBER.lastIndex;
    return Number(match[0]);
  }

  const result = parseExpression();

  skipWhitespace();
  if (pos < expression.length) {
    fail();
  }

  return result;
}
