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
