/**
 * Hold the scorer to the preregistration's definitions, on hand-counted fixtures.
 *
 * The scorer produced every implementation figure in the article, and for a long time nothing
 * checked it. That was not an oversight of attention but of language: the gate runs `bun test`,
 * and the scorer was the only measurement written in Python, so it sat outside the gate by
 * construction.
 *
 * It then failed three reviews in a row, each finding another construct its line-anchored regular
 * expressions could not see: an arrow whose body is an expression, a declaration whose parameters
 * wrap, and a method with type parameters. Every case below is one of those, or a case a reviewer
 * used to show the repair had over-matched. The scorer now reads a TypeScript syntax tree, which
 * is why patching the next construct is not the plan.
 *
 * The counts are worked out by hand from the preregistration's wording, not read off the scorer,
 * which is the only way a test like this says anything the implementation does not already say
 * about itself.
 *
 * What this cannot do: prove the hand counts match what the preregistration meant. That gap is
 * unreachable by any test. It is narrowed by the decision recorded in the README, which names
 * each judgement the wording leaves open, starting with the constructor.
 */
import { describe, expect, test } from "bun:test";
import { score } from "../score";

const scoreOf = (source: string) => score("case.ts", source);

describe("the scorer against the preregistered definitions", () => {
  test("a top-level function and each class member is one named unit", () => {
    // One function, plus a constructor and two methods. The constructor counts as a class
    // method: a judgement the wording leaves open, recorded in the README.
    expect(scoreOf(`export function evaluate(text: string): number {
  return new Parser(text).parse();
}

class Parser {
  constructor(private readonly text: string) {}

  parse(): number {
    return this.read();
  }

  private read(): number {
    return 0;
  }
}
`).units).toBe(4);
  });

  test("an arrow constant counts whether its body is a block or an expression", () => {
    // Requiring a block body hid seven units in the published corpus.
    expect(scoreOf(`const withBlock = (value: number): number => {
  return value + 1;
};

const withExpression = (value: number): number => value + 1;
`).units).toBe(2);
  });

  test("a one-line arrow occupies one line", () => {
    // Measuring a unit's span by brace depth gave a one-line arrow the following line as well,
    // which moved a published figure. The parse knows where the node ends.
    expect(scoreOf(`const peek = (): string => text.charAt(at);

const other = (): string => text.charAt(at);
`).longest_own).toBe(1);
  });

  test("a declaration whose parameters wrap is still one named unit", () => {
    expect(scoreOf(`export function evaluate(
  text: string,
  strict: boolean,
): number {
  return 0;
}
`).units).toBe(1);
  });

  test("a method with type parameters is a named unit", () => {
    // Two class methods in the published corpus were invisible for this reason alone.
    expect(scoreOf(`class Parser {
  read<T>(value: T): T {
    return value;
  }
}
`).units).toBe(1);
  });

  test("a call whose arguments wrap is not a declaration", () => {
    // The mirror of the wrapped declaration, and one published file does exactly this.
    expect(scoreOf(`export function evaluate(text: string): number {
  fail(
    text.length,
  );
  return 0;
}

function fail(at: number): void {
  throw new SyntaxError(String(at));
}
`).units).toBe(2);
  });

  test("an object-literal method is not a class method", () => {
    // The definition names class methods. An object literal is not a class.
    expect(scoreOf(`const parser = {
  read() {
    return 1;
  },
};
`).units).toBe(0);
  });

  test("control-flow keywords are never named units", () => {
    expect(scoreOf(`export function evaluate(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "1") {
      total += 1;
    }
  }
  while (total > 10) {
    total -= 1;
  }
  return total;
}
`).units).toBe(1);
  });

  test("wrapper style means three or more units declared inside a function body", () => {
    // The preregistered primary outcome. Two nested units is not wrapper style; three is.
    const two = `export function evaluate(text: string): number {
  function first(): number {
    return 1;
  }
  function second(): number {
    return 2;
  }
  return first() + second();
}
`;
    const three = `export function evaluate(text: string): number {
  function first(): number {
    return 1;
  }
  function second(): number {
    return 2;
  }
  function third(): number {
    return 3;
  }
  return first() + second() + third();
}
`;
    expect(scoreOf(two).wrapper).toBe(false);
    expect(scoreOf(three).wrapper).toBe(true);
  });

  test("a unit declared as a class member is not nested for the wrapper test", () => {
    // Members of a class are not closures, which is the distinction wrapper style draws.
    expect(scoreOf(`export function evaluate(text: string): number {
  return new Parser(text).parse();
}

class Parser {
  constructor(private readonly text: string) {}
  parse(): number {
    return 0;
  }
  private read(): number {
    return 0;
  }
  private peek(): number {
    return 0;
  }
}
`).wrapper).toBe(false);
  });

  test("longest own unit excludes the lines of the units nested inside it", () => {
    // `evaluate` spans 8 lines and encloses a 3-line function, so its own lines are 5.
    expect(scoreOf(`export function evaluate(text: string): number {
  function inner(): number {
    return 1;
  }
  const a = 1;
  const b = 2;
  return inner() + a + b;
}
`).longest_own).toBe(5);
  });

  test("a doubly nested unit is subtracted once, not twice", () => {
    // Only the outermost nested units are taken off, or the enclosing span goes negative.
    const source = `export function outer(): number {
  function middle(): number {
    function inner(): number {
      return 1;
    }
    return inner();
  }
  return middle();
}
`;
    // outer spans 9 lines and encloses middle, which spans 6. Its own lines are 3.
    expect(scoreOf(source).longest_own).toBe(3);
  });

  test("the registered count excludes units nested inside a function", () => {
    // The reviewer's reproducer. The primary definition sees four units and calls the file
    // wrapper style; the secondary outcome names top-level functions, so it counts one.
    const source = `export function evaluate(): number {
  const read = (): number => 1;
  const parse = (): number => 2;
  const write = (): number => 3;
  return read() + parse() + write();
}
`;
    expect(scoreOf(source).units).toBe(4);
    expect(scoreOf(source).topLevelUnits).toBe(1);
    expect(scoreOf(source).wrapper).toBe(true);
  });

  test("a class method counts in the registered count wherever its class sits", () => {
    // A class is not a function body, so its members are top-level for this purpose.
    expect(scoreOf(`class Parser {
  parse(): number {
    return 0;
  }
  private read(): number {
    return 0;
  }
}
`).topLevelUnits).toBe(2);
  });

  test("an overload signature is not a named unit", () => {
    // A declaration without a body declares nothing that runs.
    expect(scoreOf(`export function evaluate(text: string): number;
export function evaluate(text: string, strict: boolean): number;
export function evaluate(text: string, strict?: boolean): number {
  return 0;
}
`).units).toBe(1);
  });

  test("a let-bound arrow is not a const arrow constant", () => {
    // The wording says const. None exist in the corpus, so this holds the contract, not a figure.
    expect(scoreOf(`const kept = (): number => 1;
let other = (): number => 2;
`).units).toBe(1);
  });

  test("a file that does not parse is reported rather than scored quietly", () => {
    // The preregistration says an unparsable file is recorded and reported, never dropped.
    expect(scoreOf("export function evaluate( {\n").unparsed).toBe(true);
    expect(scoreOf("export function evaluate(): number {\n  return 0;\n}\n").unparsed).toBe(false);
  });

  test("comment lines count every line that opens or continues a comment", () => {
    expect(scoreOf(`/**
 * A description.
 */
// A single line.
export function evaluate(text: string): number {
  return 0;
}
`).comments).toBe(4);
  });
});
