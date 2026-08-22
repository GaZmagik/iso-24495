/**
 * Read the verdicts `rerun-tests.sh` reached, rather than the ones a saved console log claims.
 *
 * Each implementation directory holds a `tests.txt` recording what bun printed when the battery
 * ran it. Two reviews established that this text cannot be trusted, and the second one killed the
 * careful reading that was meant to rescue it:
 *
 *   An implementation can print bun's summary lines itself, because it is executing while bun
 *   writes. Taking the first match then calls a failing run a pass.
 *
 *   Reading the LAST summary instead does not help. An implementation that calls `process.exit(0)`
 *   while being imported stops bun printing any summary of its own, so the forged one is the only
 *   one in the file. My comment claiming the last summary is "bun's own" was simply false.
 *
 * So no reading of that file settles anything. `rerun-tests.sh` reaches a verdict that does not
 * depend on it: bun's exit status, captured before any filtering, and the junit report bun writes
 * only after the run completes. It records that verdict per run in `rerun-results.txt`, and this
 * reads it back.
 *
 * The manifest is committed, so a reader checks a figure without waiting two minutes for the
 * battery, and reruns it when they want to confirm the manifest itself.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MANIFEST = join(import.meta.dir, "rerun-results.txt");
const LINE = /^(PASS|FAIL|MISSING) (\S+)$/;

export interface RerunResults {
  /** Did this run pass all 25 hidden tests, by the rerun's own trusted verdict? */
  passed(run: string): boolean;
  /** Is this run recorded at all? An unrecorded run is not a passing one. */
  known(run: string): boolean;
  /** How many runs the manifest holds, so a caller can refuse a short one. */
  size: number;
}

export function readRerunResults(path: string = MANIFEST): RerunResults {
  const verdicts = new Map<string, string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const found = LINE.exec(line.trim());
    if (found !== null) verdicts.set(found[2] as string, found[1] as string);
  }
  return {
    passed: (run) => verdicts.get(run) === "PASS",
    known: (run) => verdicts.has(run),
    size: verdicts.size,
  };
}
