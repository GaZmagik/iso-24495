// Deterministic maturity scoring. Converts a structured answers file into
// levels so the score cannot drift between agent sessions. The agent and the
// human gather evidence; this script only applies the catalogue.

import { MATURITY_MODEL } from "./lib/types.ts";
import type { Maturity } from "./lib/types.ts";
import { readJsonFile, writeTextFile } from "./lib/failure.ts";
import { shapeProblem, type Shape } from "./lib/json-shape.ts";

/**
 * Scores an answers file and prints the level of each dimension.
 *
 *   bun score-maturity-cli.ts <answers.json> [--json <out-file>]
 *
 * `--json` also writes the scores to that file, replacing it.
 *
 * Exit 0 means the answers were scored. Exit 1 means the answers file could
 * not be read, is not JSON or does not hold the shape `ANSWERS_SHAPE` states,
 * or the scores file could not be written. Exit 2 means the arguments were
 * wrong.
 *
 * The shape is checked before anything is scored, so answers of the wrong
 * shape print no table and write no scores file.
 *
 * @param argv The whole command line, so the answers file is at index 2.
 * @param stdout Receives the table and the overall level, one line at a time.
 * @param stderr Receives the usage line or the reason for exit 1 or 2.
 */
export function runCli(
  argv: string[],
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): number {
  const path = argv[2];
  if (!path) {
    stderr("Usage: bun score-maturity-cli.ts <answers.json> [--json <out-file>]");
    return 2;
  }
  const jsonFlag = argv.indexOf("--json");
  if (jsonFlag !== -1 && !argv[jsonFlag + 1]) {
    stderr("score-maturity: --json requires an output file");
    return 2;
  }
  const answers = readJsonFile(path, "<answers.json>");
  if (!answers.ok) {
    stderr(`score-maturity: ${answers.problem}`);
    return 1;
  }
  const shape = shapeProblem(answers.value, ANSWERS_SHAPE, "<answers.json>");
  if (shape !== null) {
    stderr(`score-maturity: ${shape}`);
    return 1;
  }
  // The value was checked against the shape of the type on the line above.
  const maturity = scoreMaturity(answers.value as Answers);
  if (jsonFlag !== -1) {
    const problem = writeTextFile(argv[jsonFlag + 1], JSON.stringify(maturity, null, 2), "--json");
    if (problem !== null) {
      stderr(`score-maturity: ${problem}`);
      return 1;
    }
  }
  stdout("| Dimension | Level | Blocking criteria |");
  stdout("|-----------|-------|-------------------|");
  for (const [dimension, result] of Object.entries(maturity.dimensions)) {
    stdout(`| ${dimension} | ${result.level} | ${result.missing.join(", ") || "-"} |`);
  }
  stdout(`\nOverall (weakest dimension): ${maturity.overall}`);
  return 0;
}

export interface Answers {
  organisation?: string;
  dimensions: Record<string, Record<string, boolean>>;
}

/**
 * The shape of an answers file. A dimension may be left out, and one the
 * catalogue does not list is passed over, as `scoreMaturity` describes. Each
 * dimension that is there must hold true or false for every criterion it
 * names.
 */
export const ANSWERS_SHAPE: Shape = {
  kind: "object",
  required: { dimensions: { kind: "map", member: { kind: "map", member: { kind: "flag" } } } },
  optional: { organisation: { kind: "text" } },
};

/**
 * Scores an organisation against the maturity catalogue.
 *
 * A dimension holds a level only when every criterion at that level and each
 * level below it is answered `true`. Any other answer, a missing one included,
 * counts as not met.
 *
 * @param answers The criteria met, by dimension. A dimension the answers
 *     leave out scores 0, and one the catalogue does not list is ignored.
 * @returns Each catalogue dimension with its level, from 0 to the number of
 *     levels it has, and the unmet criteria of the next level, which is empty
 *     at the top. `overall` is the lowest level of any dimension. Answers
 *     with no `dimensions` score 0 throughout.
 * @throws A `TypeError` when `answers` is `null` or `undefined`. No other
 *     value throws: one that is not an object scores 0 throughout, which is
 *     why `runCli` checks the shape of a file before it calls this.
 */
export function scoreMaturity(answers: Answers): Maturity {
  const maturity: Maturity = { dimensions: {}, overall: 0 };
  let overall = Number.POSITIVE_INFINITY;
  for (const [dimension, levels] of Object.entries(MATURITY_MODEL)) {
    const given = answers.dimensions?.[dimension] ?? {};
    let level = 0;
    while (level < levels.length && levels[level].every((c) => given[c] === true)) {
      level++;
    }
    const missing = level < levels.length
      ? levels[level].filter((c) => given[c] !== true)
      : [];
    maturity.dimensions[dimension] = { level, missing };
    overall = Math.min(overall, level);
  }
  maturity.overall = Number.isFinite(overall) ? overall : 0;
  return maturity;
}
