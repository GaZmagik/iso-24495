type TokenKind = "number" | "operator" | "(" | ")" | "end";

interface Token {
  kind: TokenKind;
  text: string;
  /** Zero-based index of the token's first character, or the input length at end of input. */
  pos: number;
}

const OPERATORS = new Set(["+", "-", "*", "/", "%", "^"]);

/**
 * Evaluates an arithmetic expression.
 *
 * Grammar (lowest precedence first):
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/" | "%") unary)*
 *   unary      := ("-" | "+") unary | power
 *   power      := primary ("^" unary)?
 *   primary    := number | "(" expression ")"
 *
 * `power` recurses into `unary` on its right-hand side, which makes `^` right
 * associative and lets it bind tighter than a leading sign: `-2^2` is -4.
 */
export function evaluate(expression: string): number {
  const parser = createParser(expression);
  const value = parser.parseExpression();

  const trailing = parser.peek();
  if (trailing.kind !== "end") {
    throw syntaxError(`Unexpected ${describe(trailing)}`, trailing.pos);
  }
  return value;
}

function createParser(source: string) {
  let pos = 0;
  let lookahead: Token | null = null;

  /** Reads the next token from `source`. Whitespace is skipped first. */
  function scan(): Token {
    while (pos < source.length && isWhitespace(source[pos])) pos++;
    if (pos >= source.length) {
      return { kind: "end", text: "", pos: source.length };
    }

    const start = pos;
    const ch = source[start];

    if (ch === "(" || ch === ")") {
      pos++;
      return { kind: ch, text: ch, pos: start };
    }

    if (OPERATORS.has(ch)) {
      pos++;
      return { kind: "operator", text: ch, pos: start };
    }

    if (isDigit(ch) || ch === ".") {
      while (pos < source.length && isDigit(source[pos])) pos++;
      if (source[pos] === ".") {
        pos++;
        while (pos < source.length && isDigit(source[pos])) pos++;
      }
      const text = source.slice(start, pos);
      // A lone "." matched the branch but is not a number.
      if (!/[0-9]/.test(text)) {
        throw syntaxError(`Unexpected character '${ch}'`, start);
      }
      return { kind: "number", text, pos: start };
    }

    throw syntaxError(`Unexpected character '${ch}'`, start);
  }

  /** Scanning is lazy so that the leftmost error in the input is the one reported. */
  function peek(): Token {
    if (lookahead === null) lookahead = scan();
    return lookahead;
  }

  function consume(): Token {
    const token = peek();
    lookahead = null;
    return token;
  }

  function peekOperator(operators: string): string | null {
    const token = peek();
    const isMatch =
      token.kind === "operator" && token.text.length === 1 && operators.includes(token.text);
    return isMatch ? token.text : null;
  }

  function parseExpression(): number {
    let value = parseTerm();
    for (;;) {
      const operator = peekOperator("+-");
      if (operator === null) return value;
      consume();
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
  }

  function parseTerm(): number {
    let value = parseUnary();
    for (;;) {
      const operator = peekOperator("*/%");
      if (operator === null) return value;
      consume();
      const right = parseUnary();
      if (right === 0 && operator !== "*") {
        throw new RangeError("Division by zero");
      }
      value =
        operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
  }

  function parseUnary(): number {
    const operator = peekOperator("+-");
    if (operator === null) return parsePower();
    consume();
    const operand = parseUnary();
    return operator === "-" ? -operand : operand;
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (peekOperator("^") === null) return base;
    consume();
    return base ** parseUnary();
  }

  function parsePrimary(): number {
    const token = consume();
    if (token.kind === "number") {
      return Number(token.text);
    }
    if (token.kind === "(") {
      const value = parseExpression();
      const closing = consume();
      if (closing.kind !== ")") {
        throw syntaxError(`Expected ')' but found ${describe(closing)}`, closing.pos);
      }
      return value;
    }
    throw syntaxError(`Unexpected ${describe(token)}`, token.pos);
  }

  return { parseExpression, peek };
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function describe(token: Token): string {
  return token.kind === "end" ? "end of input" : `'${token.text}'`;
}

function syntaxError(message: string, position: number): SyntaxError {
  return new SyntaxError(`${message} at position ${position}`);
}
