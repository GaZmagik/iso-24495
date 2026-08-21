/**
 * Evaluates an arithmetic expression and returns its numeric result.
 *
 * Grammar, lowest precedence first:
 *   additive       := multiplicative (('+' | '-') multiplicative)*     left associative
 *   multiplicative := unary (('*' | '/' | '%') unary)*                 left associative
 *   unary          := ('+' | '-') unary | power
 *   power          := primary ('^' unary)?                             right associative
 *   primary        := number | '(' additive ')'
 *
 * `unary` sits above `power` so that `-2^2` is -4: the exponent binds to the
 * bare number, and the negation applies to the result. Because `power` takes a
 * `unary` on its right, `2^-3` also parses.
 *
 * @throws {SyntaxError} for malformed input. The message ends with
 *   ` at position N`, where N is the zero-based index of the offending
 *   character, or the input length when the expression ends too early.
 * @throws {RangeError} with the message `Division by zero` when `/` or `%`
 *   has a zero right operand.
 */
export function evaluate(expression: string): number {
  let position = 0;

  const atEnd = (): boolean => position >= expression.length;

  // charAt returns '' past the end, so every character test below is false
  // there and the end of input falls through to an error rather than a match.
  const peek = (): string => expression.charAt(position);

  const isDigit = (character: string): boolean =>
    character >= '0' && character <= '9';

  const isWhitespace = (character: string): boolean =>
    character !== '' && /\s/.test(character);

  function skipWhitespace(): void {
    while (isWhitespace(peek())) {
      position++;
    }
  }

  function errorAt(message: string, at: number): SyntaxError {
    return new SyntaxError(`${message} at position ${at}`);
  }

  /** The error for whatever sits at the cursor, or for input that ran out. */
  function unexpected(): SyntaxError {
    if (atEnd()) {
      return errorAt('Unexpected end of input', expression.length);
    }
    return errorAt(`Unexpected character '${peek()}'`, position);
  }

  /** Reads digits, an optional point, then more digits: `3`, `2.5`, `.5`, `10.` */
  function parseNumber(): number {
    const start = position;
    while (isDigit(peek())) {
      position++;
    }
    if (peek() === '.') {
      position++;
      while (isDigit(peek())) {
        position++;
      }
    }
    return Number(expression.slice(start, position));
  }

  function parsePrimary(): number {
    skipWhitespace();
    const character = peek();

    if (character === '(') {
      position++;
      const value = parseAdditive();
      skipWhitespace();
      if (peek() !== ')') {
        const at = atEnd() ? expression.length : position;
        throw errorAt("Expected a closing ')'", at);
      }
      position++;
      return value;
    }

    // A leading point starts a number only if a digit follows it, so a lone
    // '.' is reported as an unexpected character rather than consumed.
    const startsNumber =
      isDigit(character) ||
      (character === '.' && isDigit(expression.charAt(position + 1)));
    if (startsNumber) {
      return parseNumber();
    }

    throw unexpected();
  }

  function parsePower(): number {
    const base = parsePrimary();
    skipWhitespace();
    if (peek() !== '^') {
      return base;
    }
    position++;
    // Recursing into parseUnary makes '^' right associative and lets the
    // exponent carry its own sign.
    return Math.pow(base, parseUnary());
  }

  function parseUnary(): number {
    skipWhitespace();
    const operator = peek();
    if (operator === '-') {
      position++;
      return -parseUnary();
    }
    if (operator === '+') {
      position++;
      return parseUnary();
    }
    return parsePower();
  }

  function parseMultiplicative(): number {
    let value = parseUnary();
    for (;;) {
      skipWhitespace();
      const operator = peek();
      if (operator !== '*' && operator !== '/' && operator !== '%') {
        return value;
      }
      position++;
      const right = parseUnary();

      if (operator === '*') {
        value = value * right;
        continue;
      }
      // This also catches -0, which would otherwise divide to -Infinity.
      if (right === 0) {
        throw new RangeError('Division by zero');
      }
      value = operator === '/' ? value / right : value % right;
    }
  }

  function parseAdditive(): number {
    let value = parseMultiplicative();
    for (;;) {
      skipWhitespace();
      const operator = peek();
      if (operator !== '+' && operator !== '-') {
        return value;
      }
      position++;
      const right = parseMultiplicative();
      value = operator === '+' ? value + right : value - right;
    }
  }

  const result = parseAdditive();
  skipWhitespace();
  if (!atEnd()) {
    // Trailing input the grammar cannot absorb, such as the '$' in '1 $ 2'.
    throw unexpected();
  }
  return result;
}
