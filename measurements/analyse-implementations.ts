/**
 * Summarise one battery, arm by arm: wrapper, units, longest own lines, entry position, tests.
 *
 *     bun measurements/analyse-implementations.ts measurements/implementations/claude Claude
 *
 * This prints one arm at a time. Use
 * article-figures.ts for anything the article quotes; the two share one scorer, so they cannot
 * disagree about what a named unit is.
 *
 * A fourth arm added a draft ISO 5055 skill. It is not published and no figure comes from it,
 * but it is listed here because the batteries ran it and a summary that hid an arm would be the
 * kind of quiet exclusion this directory exists to prevent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { score } from "./score";

const ARMS: Array<[string, string]> = [
  ["A control", "control"], ["B style", "style"],
  ["C code rules", "code"], ["D + iso-5055", "skills"],
];
const PASSES = /(\d+) pass/;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
};

const base = process.argv[2];
const label = process.argv[3];
if (base === undefined || label === undefined) {
  console.error("usage: bun measurements/analyse-implementations.ts <directory> <label>");
  process.exit(2);
}

console.log(`\n===== ${label} =====`);
console.log("arm".padEnd(14) + "n".padStart(4) + "wrapper".padStart(9) + "units".padStart(13) +
  "longest own".padStart(14) + "entry pos".padStart(13) + "comments".padStart(10) +
  "25/25".padStart(8));

for (const [name, key] of ARMS) {
  const results = [];
  let passed = 0;
  for (let n = 1; n <= 10; n += 1) {
    const directory = join(base, `${key}-${n}`);
    const file = join(directory, "evaluate.ts");
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const result = score(file, text);
    if (result.unparsed) {
      // A file that does not parse is reported, never scored as though it held nothing.
      console.error(`UNPARSED: ${key}-${n} did not parse cleanly`);
      process.exit(1);
    }
    results.push(result);
    try {
      const found = PASSES.exec(readFileSync(join(directory, "tests.txt"), "utf8"));
      if (found !== null && found[1] === "25") passed += 1;
    } catch {
      // A run without a saved test output counts as not passing, never as absent.
    }
  }
  if (results.length === 0) {
    console.log(name.padEnd(14) + "0".padStart(4) + "   (no files)");
    continue;
  }
  const units = results.map((r) => r.units);
  const longest = results.map((r) => r.longest_own);
  const entries = results.map((r) => r.entry).filter((value): value is number => value !== null);
  console.log(
    name.padEnd(14) +
    String(results.length).padStart(4) +
    `${results.filter((r) => r.wrapper).length}/${results.length}`.padStart(9) +
    `${median(units)} [${Math.min(...units)}-${Math.max(...units)}]`.padStart(13) +
    `${median(longest)} [${Math.min(...longest)}-${Math.max(...longest)}]`.padStart(14) +
    (entries.length > 0 ? median(entries).toFixed(2) : "n/a").padStart(13) +
    String(median(results.map((r) => r.comments))).padStart(10) +
    `${passed}/${results.length}`.padStart(8),
  );
}
