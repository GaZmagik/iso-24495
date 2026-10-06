// Deterministic maturity scoring. Converts a structured answers file into
// levels so the score cannot drift between agent sessions. The agent and the
// human gather evidence; this script only applies the catalogue.

import { MATURITY_MODEL } from "./lib/types.ts";
import type { Maturity } from "./lib/types.ts";
import { readJsonFile, unexpectedKind, writeTextFile } from "./lib/failure.ts";

export interface Answers {
  organisation?: string;
  dimensions: Record<string, Record<string, boolean>>;
}

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
 * @throws A `TypeError` when `answers` is `null` or `undefined`.
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

/**
 * Scores an answers file and prints the level of each dimension.
 *
 *   bun score-maturity-cli.ts <answers.json> [--json <out-file>]
 *
 * `--json` also writes the scores to that file, replacing it.
 *
 * Exit 0 means the answers were scored. Exit 1 means the answers file could
 * not be read, is not JSON or does not hold the documented shape, or the
 * scores file could not be written. Exit 2 means the arguments were wrong.
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
  try {
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
  } catch (error) {
    // The file was read and parsed above, so what remains is answers of a
    // shape the scoring cannot use.
    stderr(
      `score-maturity: stopped by ${unexpectedKind(error)}; `
        + "check that <answers.json> holds the documented shape",
    );
    return 1;
  }
}
