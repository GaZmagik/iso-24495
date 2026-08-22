/**
 * Print every figure the article quotes about the implementations, from the published data.
 *
 * Run it from the repository root:
 *
 *     bun install
 *     bun measurements/article-figures.ts
 *
 * The prose counts come from count-review-replies.ts, which pins the parser and the replies by
 * content. This script prints everything else: the entry positions, the preregistered outcomes,
 * the cross-tool aggregates, and the files the article names.
 *
 * It scores each run with `score` from score.ts rather than measuring anything itself. A second
 * definition of "named unit" would disagree with the article by a little, which is worse than not
 * publishing a script at all: it reads as a check while quietly contradicting the thing it checks.
 *
 * This replaced a pair of Python scripts that matched declarations with line-anchored regular
 * expressions. Three rounds of review each found another construct they could not see, so the
 * measurement now comes from a real parse.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { score, type Score } from "./score";
import { readRerunResults } from "./rerun-results";

const MEASUREMENTS = import.meta.dir;
const IMPLEMENTATIONS = join(MEASUREMENTS, "implementations");
const TOOLS = ["claude", "codex", "gemini"] as const;
const ARMS: Array<[string, string]> = [
  ["no rules", "control"], ["prose style", "style"], ["style + code", "code"],
];

interface Run {
  name: string;
  directory: string;
  result: Score;
}

function scored(tool: string, arm: string): Run[] {
  // Every published arm holds ten runs. A short arm means a file went missing, which is reported
  // rather than divided away.
  const runs: Run[] = [];
  for (let n = 1; n <= 10; n += 1) {
    const directory = join(IMPLEMENTATIONS, tool, `${arm}-${n}`);
    const file = join(directory, "evaluate.ts");
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      // Every one of the thirty files is counted. A run this script cannot read is a failure to
      // report, not a row to leave out of a denominator that still says ten.
      console.error(`MISSING: ${tool}/${arm}-${n} has no evaluate.ts`);
      process.exit(1);
    }
    const result = score(file, text);
    if (result.unparsed) {
      console.error(`UNPARSED: ${tool}/${arm}-${n} did not parse cleanly`);
      process.exit(1);
    }
    runs.push({ name: `${arm}-${n}`, directory, result });
  }
  return runs;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
};

/** A median with its range beside it, which the preregistration requires.
 *
 * The parentheses match the table the article prints, so a reader comparing the two sees the
 * same string rather than the same number in a different dress. */
const summarise = (values: number[]): string =>
  `${median(values)} (${Math.min(...values)} to ${Math.max(...values)})`;

// The rerun's own verdicts, read once. A run absent from the manifest has not been shown to
// pass, and a manifest short of ninety runs means the battery did not finish.
const rerun = readRerunResults();
if (rerun.size !== 90) {
  console.error(`INCOMPLETE: rerun-results.txt holds ${rerun.size} runs, expected 90`);
  process.exit(1);
}

const passed = (tool: string, runs: Run[]): number =>
  runs.filter((run) => rerun.passed(`${tool}/${run.name}`)).length;

function reportPositions(): void {
  console.log("\nENTRY POSITION, EVERY RUN SORTED (0.00 is the top of the file)");
  for (const tool of TOOLS) {
    for (const [label, arm] of ARMS) {
      const values = scored(tool, arm)
        .map((run) => run.result.entry)
        .filter((value): value is number => value !== null);
      if (values.length === 0) continue;
      const shown = [...values].sort((a, b) => a - b).map((v) => v.toFixed(2)).join(", ");
      console.log(`  ${tool.padEnd(7)} ${label.padEnd(13)} median ${median(values).toFixed(2)}  ${shown}`);
    }
  }
}

function reportPositionsByRun(): void {
  // The report above sorts the values and drops the run names, so it can show that a 0.21 and a
  // 0.11 exist without showing which runs produced them. The article names both: code-8 as the
  // run nearest the boundary, and control-7 as the earliest control. Three decimals, because
  // control-7 and control-3 both read 0.11 at two and the claim is that control-7 is earliest.
  console.log("\nCLAUDE ENTRY POSITION, EVERY RUN NAMED AND SORTED");
  for (const [label, arm] of ARMS) {
    const runs = scored("claude", arm)
      .filter((run) => run.result.entry !== null)
      .sort((a, b) => (a.result.entry as number) - (b.result.entry as number));
    if (runs.length === 0) continue;
    const shown = runs.map((run) => `${run.name} ${(run.result.entry as number).toFixed(3)}`).join(", ");
    console.log(`  ${label.padEnd(13)} ${shown}`);
  }
}

function reportPreregistered(): void {
  // The five registered outcomes sit together. File length follows them and is marked, because a
  // table that mixes the two silently turns an exploratory measure into a confirmatory one.
  console.log("\nPREREGISTERED OUTCOMES, CLAUDE, MEDIAN (RANGE) ACROSS TEN RUNS");
  const columns: Array<[string, Record<string, string>]> = [];
  for (const [label, arm] of ARMS) {
    const runs = scored("claude", arm);
    if (runs.length === 0) continue;
    const results = runs.map((run) => run.result);
    columns.push([label, {
      "wrapper files (primary)": `${results.filter((r) => r.wrapper).length} of ${results.length}`,
      "named units (registered)": summarise(results.map((r) => r.registeredUnits)),
      "named units used by the wrapper rule (descriptive)": summarise(results.map((r) => r.units)),
      "longest own unit": summarise(results.map((r) => r.longest_own)),
      "comment lines": summarise(results.map((r) => r.comments)),
      "passed 25 of 25": `${passed("claude", runs)} of ${runs.length}`,
      "file lines (not preregistered)": summarise(results.map((r) => r.length)),
    }]);
  }
  if (columns.length === 0) return;
  const order = ["wrapper files (primary)", "named units (registered)",
    "named units used by the wrapper rule (descriptive)", "longest own unit", "comment lines",
    "passed 25 of 25", "file lines (not preregistered)"];
  console.log("  " + "outcome".padEnd(52) + columns.map(([label]) => label.padStart(20)).join(""));
  for (const name of order) {
    console.log("  " + name.padEnd(52) + columns.map(([, cells]) => (cells[name] ?? "").padStart(20)).join(""));
  }
}

function reportAcrossArms(): void {
  // Every other report here is per arm, so the aggregates the article uses when it compares one
  // tool with another could not be produced from this script at all.
  console.log("\nACROSS ALL THIRTY FILES OF EACH TOOL");
  for (const tool of TOOLS) {
    const results = ARMS.flatMap(([, arm]) => scored(tool, arm).map((run) => run.result));
    if (results.length === 0) continue;
    const comments = results.map((r) => r.comments);
    const withComments = comments.filter((count) => count > 0).length;
    console.log(`  ${tool.padEnd(7)} ${String(results.length).padStart(2)} files  ` +
      `longest own unit ${summarise(results.map((r) => r.longest_own)).padEnd(18)}  ` +
      `comment lines ${String(comments.reduce((a, b) => a + b, 0)).padStart(3)} across ` +
      `${String(withComments).padStart(2)} files, median ${median(comments)}`);
  }
}

function reportNamedFiles(): void {
  console.log("\nTHE FILES THE ARTICLE NAMES");
  // control-7 is the run the code figure shows, so its line number is printed here too.
  for (const [tool, arm, run] of [["claude", "control", 7], ["claude", "control", 8],
    ["claude", "code", 2]] as const) {
    const file = join(IMPLEMENTATIONS, tool, `${arm}-${run}`, "evaluate.ts");
    let lines: string[];
    try {
      lines = readFileSync(file, "utf8").replace(/\n+$/, "").split("\n");
    } catch {
      continue;
    }
    const at = lines.findIndex((line) => line.startsWith("export function evaluate"));
    if (at !== -1) console.log(`  ${tool} ${arm}-${run}: line ${at + 1} of ${lines.length}`);
  }
}

function reportOpenings(): void {
  console.log("\nTHE TWO OPENINGS THE ARTICLE SHOWS");
  console.log("  Measured by count-review-replies.ts, which holds the parser this project uses.");
  console.log("  Run: bun measurements/count-review-replies.ts");
}

try {
  readdirSync(IMPLEMENTATIONS);
} catch {
  console.error(`no implementations found at ${IMPLEMENTATIONS}`);
  process.exit(1);
}

reportPositions();
reportPositionsByRun();
reportPreregistered();
reportAcrossArms();
reportNamedFiles();
reportOpenings();
