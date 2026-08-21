/**
 * Hold the published evidence to the properties the article depends on.
 *
 * These properties were each established by hand, broken by a later change, and found by a
 * reviewer rather than by this repository. That happened three rounds running, which is a
 * gap in the gate rather than bad luck: nothing here was checked automatically. The pins, the
 * manifest and the inertness of the runner records are now checked on every run.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MEASUREMENTS = join(import.meta.dir, "..");
const RUNNERS = join(MEASUREMENTS, "runners");
const MANIFEST = join(MEASUREMENTS, "instructions", "per-run.txt");

const sha256 = (path: string): string =>
  new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

describe("published evidence", () => {
  test("the runner records cannot execute", () => {
    const records = readdirSync(RUNNERS);
    expect(records.length).toBe(3);

    for (const name of records) {
      const lines = readFileSync(join(RUNNERS, name), "utf8").split("\n");
      // A comment is the only form no alias, shell or sourcing trick can reactivate. A
      // here-document fed to `:` was defeated by aliasing `:` before sourcing the file.
      const executable = lines.filter((line) => line.trim() !== "" && !line.startsWith("#"));
      expect(executable, `${name} holds a line that is not a comment`).toEqual([]);
      // The bodies carry a delete. It must stay commented, whatever else changes here.
      expect(lines.some((line) => line.includes("rm -rf")), `${name} lost its record`).toBe(true);
    }
  });

  test("the instruction manifest covers every run in a clean three-way split", () => {
    const rows = readFileSync(MANIFEST, "utf8")
      .split("\n")
      .filter((line) => /^(none|[0-9a-f]{64})\s+\w+\/(control|style|code)-\d+$/.test(line));
    expect(rows).toHaveLength(90);
    expect(new Set(rows.map((row) => row.split(/\s+/)[1])).size).toBe(90);

    const byDigest = new Map<string, number>();
    for (const row of rows) {
      const digest = row.split(/\s+/)[0] as string;
      byDigest.set(digest, (byDigest.get(digest) ?? 0) + 1);
    }
    expect([...byDigest.values()].sort()).toEqual([30, 30, 30]);
    expect(byDigest.get("none")).toBe(30);

    // The two treated arms must name the files this directory actually publishes.
    for (const name of ["style.md", "style-and-code.md"]) {
      const digest = sha256(join(MEASUREMENTS, "instructions", name));
      expect(byDigest.get(digest), `${name} is not the file the manifest records`).toBe(30);
    }
  });

  test("the counting script pins every input it reads", () => {
    const script = readFileSync(join(MEASUREMENTS, "count-review-replies.ts"), "utf8");
    const recorded = new Set(script.match(/[0-9a-f]{64}/g) ?? []);

    // Three engine files, six replies and the two openings the article prints.
    expect(recorded.size).toBe(11);

    const engine = join(MEASUREMENTS, "..", "skills", "iso-24495-4", "scripts", "lib");
    for (const name of ["parse.ts", "lexicon.ts", "types.ts"]) {
      expect(recorded.has(sha256(join(engine, name))), `${name} is not pinned`).toBe(true);
    }
    for (const arm of ["control", "style"]) {
      for (const run of [1, 2, 3]) {
        const reply = join(MEASUREMENTS, "review-replies", `${arm}-${run}`, "reply.md");
        expect(recorded.has(sha256(reply)), `${arm}-${run} is not pinned`).toBe(true);
      }
    }
    for (const [arm, run] of [["control", 7], ["code", 2]] as const) {
      const opening = join(MEASUREMENTS, "implementations", "claude", `${arm}-${run}`, "reply.md");
      expect(recorded.has(sha256(opening)), `the ${arm}-${run} opening is not pinned`).toBe(true);
    }
  });
});
