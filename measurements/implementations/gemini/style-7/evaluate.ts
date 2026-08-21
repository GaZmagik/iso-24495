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

type ASTNode =
  | { type: 'Number'; value: number }
  | { type: 'Unary'; op: '+' | '-'; expr: ASTNode }
  | { type: 'Binary'; op: '+' | '-' | '*' | '/' | '%' | '^'; left: ASTNode; right: ASTNode };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const ch = expr[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (
      ch === '+' ||
      ch === '-' ||
      ch === '*' ||
      ch === '/' ||
      ch === '%' ||
      ch === '^' ||
      ch === '(' ||
      ch === ')'
    ) {
      tokens.push({ type: ch, pos: i });
      i++;
      continue;
    }

    if (/\d/.test(ch) || (ch === '.' && i + 1 < len && /\d/.test(expr[i + 1]))) {
      const start = i;
      let hasDot = false;

      while (i < len) {
        const char = expr[i];
        if (/\d/.test(char)) {
          i++;
        } else if (char === '.' && !hasDot) {
          hasDot = true;
          i++;
        } else {
          break;
        }
      }

      const numStr = expr.slice(start, i);
      tokens.push({ type: 'NUMBER', value: Number(numStr), pos: start });
      continue;
    }

    throw new SyntaxError(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', pos: len });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  private advance(): Token {
    const token = this.peek();
    if (!this.isAtEnd()) {
      this.current++;
    }
    return token;
  }

  public parse(): ASTNode {
    if (this.peek().type === 'EOF') {
      throw new SyntaxError(`Unexpected end of input at position ${this.peek().pos}`);
    }

    const expr = this.parseAdditive();

    if (!this.isAtEnd()) {
      const token = this.peek();
      throw new SyntaxError(`Unexpected token '${token.type}' at position ${token.pos}`);
    }

    return expr;
  }

  private parseAdditive(): ASTNode {
    let expr = this.parseMultiplicative();

    while (this.peek().type === '+' || this.peek().type === '-') {
      const op = this.advance().type as '+' | '-';
      const right = this.parseMultiplicative();
      expr = { type: 'Binary', op, left: expr, right };
    }

    return expr;
  }

  private parseMultiplicative(): ASTNode {
    let expr = this.parseUnary();

    while (
      this.peek().type === '*' ||
      this.peek().type === '/' ||
      this.peek().type === '%'
    ) {
      const op = this.advance().type as '*' | '/' | '%';
      const right = this.parseUnary();
      expr = { type: 'Binary', op, left: expr, right };
    }

    return expr;
  }

  private parseUnary(): ASTNode {
    if (this.peek().type === '+' || this.peek().type === '-') {
      const op = this.advance().type as '+' | '-';
      const expr = this.parseUnary();
      return { type: 'Unary', op, expr };
    }

    return this.parsePower();
  }

  private parsePower(): ASTNode {
    const left = this.parsePrimary();

    if (this.peek().type === '^') {
      this.advance();
      const right = this.parseUnary();
      return { type: 'Binary', op: '^', left, right };
    }

    return left;
  }

  private parsePrimary(): ASTNode {
    const token = this.peek();

    if (token.type === 'NUMBER') {
      this.advance();
      return { type: 'Number', value: token.value! };
    }

    if (token.type === '(') {
      this.advance();
      const expr = this.parseAdditive();

      if (this.peek().type !== ')') {
        throw new SyntaxError(`Expected ')' at position ${this.peek().pos}`);
      }

      this.advance();
      return expr;
    }

    const label = token.type === 'EOF' ? 'end of input' : token.type;
    throw new SyntaxError(`Unexpected token '${label}' at position ${token.pos}`);
  }
}

function evaluateAST(node: ASTNode): number {
  switch (node.type) {
    case 'Number':
      return node.value;
    case 'Unary': {
      const val = evaluateAST(node.expr);
      return node.op === '-' ? -val : +val;
    }
    case 'Binary': {
      const left = evaluateAST(node.left);
      const right = evaluateAST(node.right);

      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          if (right === 0) {
            throw new RangeError('Division by zero');
          }
          return left / right;
        case '%':
          if (right === 0) {
            throw new RangeError('Division by zero');
          }
          return left % right;
        case '^':
          return Math.pow(left, right);
      }
    }
  }
}

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  return evaluateAST(ast);
}
