I could not execute the code: the shell guard blocked two attempts and the third needs an approval I do not have. The logic below is hand-traced against every example in the spec, but it has not been run.

```typescript
/**
 * Evaluates arithmetic expressions.
 *
 * The grammar, lowest precedence first:
 *
 *   sum     := product (("+" | "-") product)*
 *   product := unary (("*" | "/" | "%") unary)*
 *   unary   := ("+" | "-") unary | power
 *   power   := atom ("^" unary)?
 *   atom    := number | "(" sum ")"
 *
 * Two details of that shape are deliberate. `power` parses its base as an
 * `atom` rather than a `unary`, so `^` binds tighter than a leading sign and
 * `-2^2` is -4. Its exponent is a `unary`, which makes `^` right associative
 * and also admits a signed exponent such as `2^-3`.
 */

type TokenKind = "number" | "operator" | "lparen" | "rparen" | "end";

interface Token {
  readonly kind: TokenKind;
  /** The source text, used in error messages. Empty for the end token. */
  readonly text: string;
  /** The numeric value. Meaningful only when kind is "number". */
  readonly value: number;
  /** Zero-based index of the first character, or the input length for "end". */
  readonly position: number;
}

const OPERATOR_CHARACTERS = "+-*/%^";

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isWhitespace(character: string): boolean {
  return /\s/.test(character);
}

function syntaxErrorAt(message: string, position: number): SyntaxError {
  return new SyntaxError(message + " at position " + position);
}

function describe(token: Token): string {
  if (token.kind === "end") {
    return "Unexpected end of expression";
  }
  return 'Unexpected token "' + token.text + '"';
}

/**
 * Splits the expression into tokens, skipping whitespace.
 *
 * The returned array always ends with an "end" token positioned at the input
 * length, so the parser can report an expression that stops too early without
 * a separate bounds check.
 *
 * @throws {SyntaxError} If a character cannot start any token, or a lone `.`
 *   appears where a number is expected.
 */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const character = expression[index];

    if (isWhitespace(character)) {
      index += 1;
      continue;
    }

    if (isDigit(character) || character === ".") {
      const start = index;
      // Count digits on both sides of the point, because `3`, `2.5`, `.5` and
      // `10.` are all valid, while a bare `.` is not.
      let digits = 0;

      while (index < expression.length && isDigit(expression[index])) {
        index += 1;
        digits += 1;
      }

      if (expression[index] === ".") {
        index += 1;
        while (index < expression.length && isDigit(expression[index])) {
          index += 1;
          digits += 1;
        }
      }

      if (digits === 0) {
        throw syntaxErrorAt('Unexpected token "."', start);
      }

      const text = expression.slice(start, index);
      tokens.push({ kind: "number", text, value: Number(text), position: start });
      continue;
    }

    if (OPERATOR_CHARACTERS.includes(character)) {
      tokens.push({ kind: "operator", text: character, value: NaN, position: index });
      index += 1;
      continue;
    }

    if (character === "(") {
      tokens.push({ kind: "lparen", text: character, value: NaN, position: index });
      index += 1;
      continue;
    }

    if (character === ")") {
      tokens.push({ kind: "rparen", text: character, value: NaN, position: index });
      index += 1;
      continue;
    }

    throw syntaxErrorAt('Unexpected token "' + character + '"', index);
  }

  tokens.push({ kind: "end", text: "", value: NaN, position: expression.length });
  return tokens;
}

/**
 * Evaluates an arithmetic expression and returns its value.
 *
 * @param expression The expression, for example `-2 ^ 2 + (1.5 % .5)`.
 * @returns The computed value.
 * @throws {SyntaxError} For malformed input. The message ends with
 *   ` at position N`, where N is the index of the offending character, or the
 *   input length when the expression ends too early.
 * @throws {RangeError} With the message `Division by zero` when `/` or `%` has
 *   a zero right operand.
 */
export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  let index = 0;

  function peek(): Token {
    return tokens[index];
  }

  function take(): Token {
    return tokens[index++];
  }

  function atOperator(...candidates: string[]): boolean {
    const token = peek();
    return token.kind === "operator" && candidates.includes(token.text);
  }

  function parseSum(): number {
    let left = parseProduct();
    while (atOperator("+", "-")) {
      const operator = take().text;
      const right = parseProduct();
      left = operator === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseProduct(): number {
    let left = parseUnary();
    while (atOperator("*", "/", "%")) {
      const operator = take().text;
      const right = parseUnary();

      if (operator === "*") {
        left = left * right;
        continue;
      }

      // Catches -0 as well, because -0 === 0.
      if (right === 0) {
        throw new RangeError("Division by zero");
      }

      left = operator === "/" ? left / right : left % right;
    }
    return left;
  }

  function parseUnary(): number {
    if (atOperator("+", "-")) {
      const operator = take().text;
      const operand = parseUnary();
      return operator === "-" ? -operand : operand;
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parseAtom();
    if (atOperator("^")) {
      take();
      return Math.pow(base, parseUnary());
    }
    return base;
  }

  function parseAtom(): number {
    const token = peek();

    if (token.kind === "number") {
      take();
      return token.value;
    }

    if (token.kind === "lparen") {
      take();
      const inner = parseSum();
      const closing = peek();
      if (closing.kind !== "rparen") {
        throw syntaxErrorAt(describe(closing), closing.position);
      }
      take();
      return inner;
    }

    throw syntaxErrorAt(describe(token), token.position);
  }

  const result = parseSum();

  // A complete parse must consume everything, so `1 + 2)` fails at the `)`.
  const trailing = peek();
  if (trailing.kind !== "end") {
    throw syntaxErrorAt(describe(trailing), trailing.position);
  }

  return result;
}
```

Status of the spec's five error cases, traced by hand through the code above:

| Input | Offending token | Reported position |
| --- | --- | --- |
| `2 +` | end token | 3 |
| `(1 + 2` | end token | 6 |
| `1 + )` | `)` | 4 |
| (empty) | end token | 0 |
| `1 $ 2` | `$` | 2 |

Three points worth knowing before you use this:

- **Not executed.** The Bash tool rejected my two test harnesses under an "expansion obfuscation" rule, and the third form needed a permission I could not obtain. Please run your test suite against it.
- **Trailing input is a syntax error.** `1 + 2)` fails at position 5, which the spec implies through `1 + )` but does not state.
- **Recursion depth follows nesting depth.** A deeply nested expression, thousands of parentheses, would overflow the stack. The spec sets no limit, so I left the recursive descent as is.
