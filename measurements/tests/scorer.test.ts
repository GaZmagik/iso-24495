/**
 * Hold `score()` to the preregistration's written definitions, on hand-counted fixtures.
 *
 * The scorer produced every implementation figure in the article, and until now nothing checked
 * it. That was not an oversight of attention but of language: the gate runs `bun test`, and the
 * scorer is the only measurement written in Python, so it sat outside the gate by construction.
 *
 * A reviewer then found that its line-anchored patterns could not see two constructs, and ten
 * genuine units across the ninety published files went uncounted. Each fixture below is a
 * construct that was, or could be, missed. The counts are worked out by hand from the
 * preregistration's wording, not read off the scorer, which is the only way a test like this
 * says anything the implementation does not already say about itself.
 *
 * What this cannot do: prove the hand counts match the preregistration's intent. That gap is
 * unreachable by any test. What narrows it is the decision recorded in the README, naming each
 * judgement the wording leaves open, with the constructor first among them.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MEASUREMENTS = join(import.meta.dir, "..");
const SCORER = join(MEASUREMENTS, "analyse-implementations.py");

/** Score one snippet by importing the published scorer, exactly as the figure scripts do. */
function score(source: string): Record<string, number | boolean> {
  const directory = mkdtempSync(join(tmpdir(), "iso-scorer-"));
  try {
    const file = join(directory, "evaluate.ts");
    writeFileSync(file, source);
    const program = [
      "import importlib.util, json, sys",
      `spec = importlib.util.spec_from_file_location('s', r'${SCORER}')`,
      "m = importlib.util.module_from_spec(spec)",
      "sys.argv = ['s', '', '']",
      "spec.loader.exec_module(m)",
      `print(json.dumps(m.score(r'${file}')))`,
    ].join("\n");
    const run = spawnSync("py", ["-3", "-c", program], { encoding: "utf8" });
    return JSON.parse(`${run.stdout}`.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("the scorer against the preregistered definitions", () => {
  test("a top-level function and each class method is one named unit", () => {
    // One function, plus a constructor and two methods. The constructor counts as a class
    // method: a judgement the wording leaves open, recorded in the README.
    const source = `export function evaluate(text: string): number {
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
`;
    expect(score(source).units).toBe(4);
  });

  test("an arrow constant counts whether its body is a block or an expression", () => {
    // Requiring a block body hid two units in the published corpus.
    const source = `const withBlock = (value: number): number => {
  return value + 1;
};

const withExpression = (value: number): number => value + 1;
`;
    expect(score(source).units).toBe(2);
  });

  test("a declaration whose parameters wrap is still one named unit", () => {
    // `[^)]*` cannot cross a line ending, which hid three declarations in the corpus.
    const source = `export function evaluate(
  text: string,
  strict: boolean,
): number {
  return 0;
}
`;
    expect(score(source).units).toBe(1);
  });

  test("a call whose arguments wrap is not a declaration", () => {
    // The mirror of the case above, and the reason the repair checks for a following brace.
    // One published file calls `syntaxError(` across two lines; counting it would be wrong.
    const source = `export function evaluate(text: string): number {
  if (text === "") {
    fail(
      text.length,
    );
  }
  return 0;
}

function fail(at: number): void {
  throw new SyntaxError(String(at));
}
`;
    expect(score(source).units).toBe(2);
  });

  test("control-flow keywords are never named units", () => {
    const source = `export function evaluate(text: string): number {
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
`;
    expect(score(source).units).toBe(1);
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
    expect(score(two).wrapper).toBe(false);
    expect(score(three).wrapper).toBe(true);
  });

  test("a unit declared as a class member is not nested for the wrapper test", () => {
    // Members of a class are not closures, which is the distinction wrapper style draws.
    const source = `export function evaluate(text: string): number {
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
`;
    expect(score(source).wrapper).toBe(false);
  });

  test("longest own unit excludes the lines of the units nested inside it", () => {
    // `evaluate` spans 8 lines and encloses a 3-line function, so its own lines are 5.
    const source = `export function evaluate(text: string): number {
  function inner(): number {
    return 1;
  }
  const a = 1;
  const b = 2;
  return inner() + a + b;
}
`;
    expect(score(source).longest_own).toBe(5);
  });

  test("comment lines count every line that opens or continues a comment", () => {
    const source = `/**
 * A description.
 */
// A single line.
export function evaluate(text: string): number {
  return 0;
}
`;
    expect(score(source).comments).toBe(4);
  });
});
