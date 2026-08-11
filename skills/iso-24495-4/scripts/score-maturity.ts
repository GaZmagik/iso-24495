// Deterministic maturity scoring. Converts a structured answers file into
// levels so the score cannot drift between agent sessions. The agent and the
// human gather evidence; this script only applies the catalogue.

import { MATURITY_MODEL } from "./lib/types.ts";
import type { Maturity } from "./lib/types.ts";

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

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: bun score-maturity.ts <answers.json> [--json <out-file>]");
    process.exit(2);
  }
  const maturity = scoreMaturity(await Bun.file(path).json());
  const jsonFlag = process.argv.indexOf("--json");
  if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
    await Bun.write(process.argv[jsonFlag + 1], JSON.stringify(maturity, null, 2));
  }
  console.log("| Dimension | Level | Blocking criteria |");
  console.log("|-----------|-------|-------------------|");
  for (const [dimension, result] of Object.entries(maturity.dimensions)) {
    console.log(`| ${dimension} | ${result.level} | ${result.missing.join(", ") || "-"} |`);
  }
  console.log(`\nOverall (weakest dimension): ${maturity.overall}`);
}
