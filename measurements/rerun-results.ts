/**
 * Read the verdicts `rerun-tests.sh` reached, bound to the bytes they were reached against.
 *
 * Each implementation directory holds a `tests.txt` recording what bun printed when the battery
 * ran it. Reviews established twice over that this text cannot be trusted, because the code under
 * test is executing while bun writes:
 *
 *   An implementation can print bun's summary lines itself. Taking the first match then calls a
 *   failing run a pass.
 *
 *   Reading the last summary instead does not help. An implementation that calls `process.exit(0)`
 *   during import stops bun printing one at all, so the forged summary is the only one there.
 *
 * So the reporting scripts stopped reading it, and read this manifest instead. That was not enough
 * on its own: a reviewer replaced an implementation after the rerun and the manifest still said
 * PASS, because it recorded a verdict and a run name and nothing about the file. Every line now
 * carries the SHA-256 of the implementation the verdict was reached against, and this reader
 * refuses a verdict whose file no longer hashes to it.
 *
 * ## What this does not do
 *
 * It does not make the evidence self-authenticating. A publisher can forge a committed manifest,
 * and a tag freezes bytes without proving anything about what was executed. The guarantee here is
 * reproducibility plus binding: the manifest says which bytes were tested, and `rerun-tests.sh`
 * re-derives the verdict for anyone who would rather not take it on trust.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MEASUREMENTS = import.meta.dir;
const MANIFEST = join(MEASUREMENTS, "rerun-results.txt");
const EXPECTED_RUNS = 90;
const LINE = /^(PASS|FAIL|MISSING) (\S+) (\S+)$/;
// The header binds the rest of the procedure: the tests that judged, and the script that ran
// them. The bun version is recorded there too and deliberately not enforced, because a reader
// on a later bun should be able to reproduce this rather than be refused by it.
const HEADER = /^# (harness|runner|bun) (\S+)$/;

export interface RerunResults {
  /** Did this run pass all 25 hidden tests, by the rerun's own verdict, against today's bytes? */
  passed(run: string): boolean;
  /** Is this run recorded at all? An unrecorded run is not a passing one. */
  known(run: string): boolean;
  /** How many runs the manifest holds. */
  size: number;
}

const sha256 = (path: string): string =>
  new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

/**
 * Read the manifest, refusing anything that would let a verdict stand for the wrong file.
 *
 * A malformed line is refused rather than skipped, and a repeated run is refused rather than
 * overwritten, because both are ways a manifest could disagree with itself unnoticed.
 */
export function readRerunResults(
  path: string = MANIFEST,
  implementations: string = join(MEASUREMENTS, "implementations"),
  expected: number = EXPECTED_RUNS,
  harness: string = join(MEASUREMENTS, "task", "hidden-tests.ts"),
  runner: string = join(MEASUREMENTS, "rerun-tests.sh"),
): RerunResults {
  const verdicts = new Map<string, string>();
  const digests = new Map<string, string>();
  const header = new Map<string, string>();

  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "");
  for (const line of lines) {
    const note = HEADER.exec(line.trim());
    if (note !== null) {
      header.set(note[1] as string, note[2] as string);
      continue;
    }
    const found = LINE.exec(line.trim());
    if (found === null) throw new Error(`rerun manifest: malformed line: ${line.trim()}`);
    const run = found[2] as string;
    if (verdicts.has(run)) throw new Error(`rerun manifest: ${run} appears twice`);
    verdicts.set(run, found[1] as string);
    digests.set(run, found[3] as string);
  }

  // A verdict is about an implementation AND the tests that judged it. Binding only the first
  // let a reviewer replace the harness and leave every verdict standing.
  for (const [name, file] of [["harness", harness], ["runner", runner]] as const) {
    const recorded = header.get(name);
    if (recorded === undefined) {
      throw new Error(`rerun manifest: no ${name} hash recorded`);
    }
    if (sha256(file) !== recorded) {
      throw new Error(`rerun manifest: the ${name} has changed since these verdicts were reached`);
    }
  }

  if (expected > 0 && verdicts.size !== expected) {
    throw new Error(`rerun manifest: holds ${verdicts.size} runs, expected ${expected}`);
  }

  // A verdict stands only for the bytes it was reached against, whichever way it went. A FAIL
  // attached to unknown bytes is as meaningless as a PASS.
  for (const [run, verdict] of verdicts) {
    if (verdict === "MISSING") continue;
    const file = join(implementations, ...run.split("/"), "evaluate.ts");
    let actual: string;
    try {
      actual = sha256(file);
    } catch {
      throw new Error(`rerun manifest: ${run} is recorded as ${verdict} but its file is missing`);
    }
    if (actual !== digests.get(run)) {
      throw new Error(`rerun manifest: ${run} has changed since it was tested`);
    }
  }

  return {
    passed: (run) => verdicts.get(run) === "PASS",
    known: (run) => verdicts.has(run),
    size: verdicts.size,
  };
}
