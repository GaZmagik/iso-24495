import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "scripts", "design-audit-cli.ts");
// Each case pays for a cold Bun start, which can take seconds on a busy machine.
const ENTRY_TIMEOUT_MS = 20_000;

/** The environment without a key, so no case here can reach the network. */
function keyless(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name !== "TYPESAFE_API_KEY" && value !== undefined) env[name] = value;
  }
  return env;
}

async function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", ENTRY, ...args], { stdout: "pipe", stderr: "pipe", env: keyless() });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

describe("design-audit-cli", () => {
  test("passes the exit code through for usage, a plan, and a missing key", async () => {
    const project = mkdtempSync(join(tmpdir(), "iso-design-entry-"));
    try {
      const file = join(project, "doc.md");
      writeFileSync(file, "# Title\n\nFirst sentence here. Second sentence here.\n");

      const [usage, plan, noKey] = await Promise.all([
        run([]),
        run([file, "--project-dir", project]),
        run([file, "--send", "--yes"]),
      ]);

      expect(usage.exitCode).toBe(2);
      expect(plan.exitCode).toBe(0);
      expect(plan.stdout).toContain("1 eligible openings, 1 eligible blocks, 2 requests.");
      expect(noKey.exitCode).toBe(4);
      expect(noKey.stderr).toContain("https://docs.typesafe.ai");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }, ENTRY_TIMEOUT_MS);
});
