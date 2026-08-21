type TokenType =
  | 'NUMBER'
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '('
  | ')'
  | 'EOF';

interface Token {
  type: TokenType;
  value?: number;
  pos: number;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const length = expression.length;
  let index = 0;

  while (index < length) {
    const char = expression[index];

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (
      char === '+' ||
      char === '-' ||
      char === '*' ||
      char === '/' ||
      char === '%' ||
      char === '^' ||
      char === '(' ||
      char === ')'
    ) {
      tokens.push({ type: char, pos: index });
      index++;
      continue;
    }

    if (char >= '0' && char <= '9') {
      const start = index;
      while (index < length && expression[index] >= '0' && expression[index] <= '9') {
        index++;
      }
      if (index < length && expression[index] === '.') {
        index++;
        while (index < length && expression[index] >= '0' && expression[index] <= '9') {
          index++;
        }
      }
      const rawNumber = expression.slice(start, index);
      tokens.push({ type: 'NUMBER', value: parseFloat(rawNumber), pos: start });
      continue;
    }

    if (char === '.') {
      const start = index;
      if (index + 1 < length && expression[index + 1] >= '0' && expression[index + 1] <= '9') {
        index++;
        while (index < length && expression[index] >= '0' && expression[index] <= '9') {
          index++;
        }
        const rawNumber = expression.slice(start, index);
        tokens.push({ type: 'NUMBER', value: parseFloat(rawNumber), pos: start });
        continue;
      }
      throw new SyntaxError(`Unexpected character '${char}' at position ${index}`);
    }

    throw new SyntaxError(`Unexpected character '${char}' at position ${index}`);
  }

  tokens.push({ type: 'EOF', pos: length });
  return tokens;
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  let cursor = 0;

  function peek(): Token {
    return tokens[cursor];
  }

  function consume(): Token {
    const token = tokens[cursor];
    cursor++;
    return token;
  }

  function parsePrimary(): number {
    const token = peek();

    if (token.type === 'NUMBER') {
      consume();
      return token.value!;
    }

    if (token.type === '(') {
      consume();
      const value = parseAddSub();
      const closingToken = peek();
      if (closingToken.type !== ')') {
        throw new SyntaxError(`Expected ')' at position ${closingToken.pos}`);
      }
      consume();
      return value;
    }

    throw new SyntaxError(`Unexpected token at position ${token.pos}`);
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (peek().type === '^') {
      consume();
      const exponent = parseUnary();
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parseUnary(): number {
    const token = peek();
    if (token.type === '+') {
      consume();
      return parseUnary();
    }
    if (token.type === '-') {
      consume();
      return -parseUnary();
    }
    return parsePower();
  }

  function parseMulDiv(): number {
    let result = parseUnary();

    while (true) {
      const operator = peek().type;
      if (operator === '*' || operator === '/' || operator === '%') {
        consume();
        const right = parseUnary();
        if (operator === '*') {
          result = result * right;
        } else if (operator === '/') {
          if (right === 0) {
            throw new RangeError('Division by zero');
          }
          result = result / right;
        } else {
          if (right === 0) {
            throw new RangeError('Division by zero');
          }
          result = result % right;
        }
      } else {
        break;
      }
    }

    return result;
  }

  function parseAddSub(): number {
    let result = parseMulDiv();

    while (true) {
      const operator = peek().type;
      if (operator === '+' || operator === '-') {
        consume();
        const right = parseMulDiv();
        if (operator === '+') {
          result = result + right;
        } else {
          result = result - right;
        }
      } else {
        break;
      }
    }

    return result;
  }

  const result = parseAddSub();
  const finalToken = peek();
  if (finalToken.type !== 'EOF') {
    throw new SyntaxError(`Unexpected token at position ${finalToken.pos}`);
  }

  return result;
}
