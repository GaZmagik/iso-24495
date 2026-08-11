import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adviseOnFile } from "../audit-markdown.ts";

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "iso-24495-hook-"));
}

describe("adviseOnFile", () => {
  test("returns one terse line with per-rule counts for a violating markdown file", () => {
    const cwd = makeProject();
    try {
      const file = join(cwd, "policy.md");
      writeFileSync(file, "The supplier shall hereby comply, and shall do so promptly.\n");
      const advice = adviseOnFile(file, cwd);
      expect(advice).not.toBeNull();
      expect(advice).toContain("policy.md");
      expect(advice).toContain("legalese 3");
      expect(advice).not.toContain("\n");
      expect(advice).toContain("advisory");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("stays quiet for a compliant file", () => {
    const cwd = makeProject();
    try {
      const file = join(cwd, "notes.md");
      writeFileSync(file, "A short, clear sentence.\n");
      expect(adviseOnFile(file, cwd)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("ignores files that are not markdown", () => {
    const cwd = makeProject();
    try {
      const file = join(cwd, "script.ts");
      writeFileSync(file, "// The supplier shall hereby comply.\n");
      expect(adviseOnFile(file, cwd)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("respects the per-project off switch", () => {
    const cwd = makeProject();
    try {
      mkdirSync(join(cwd, ".iso-24495-4"));
      writeFileSync(
        join(cwd, ".iso-24495-4", "hooks.json"),
        JSON.stringify({ markdownAudit: false }),
      );
      const file = join(cwd, "policy.md");
      writeFileSync(file, "The supplier shall hereby comply.\n");
      expect(adviseOnFile(file, cwd)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("an invalid off-switch file leaves the hook enabled", () => {
    const cwd = makeProject();
    try {
      mkdirSync(join(cwd, ".iso-24495-4"));
      writeFileSync(join(cwd, ".iso-24495-4", "hooks.json"), "{not json");
      const file = join(cwd, "policy.md");
      writeFileSync(file, "The supplier shall hereby comply.\n");
      expect(adviseOnFile(file, cwd)).not.toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("returns null rather than throwing when the file cannot be read", () => {
    const cwd = makeProject();
    try {
      expect(adviseOnFile(join(cwd, "missing.md"), cwd)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("hook entry point", () => {
  const script = join(import.meta.dir, "..", "audit-markdown.ts");

  async function runHook(input: unknown): Promise<{ stdout: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", script], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { stdout, exitCode };
  }

  test("emits additionalContext JSON for a violating markdown write", async () => {
    const cwd = makeProject();
    try {
      const file = join(cwd, "policy.md");
      writeFileSync(file, "The supplier shall hereby comply.\n");
      const { stdout, exitCode } = await runHook({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        cwd,
        tool_input: { file_path: file, content: "" },
      });
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
      expect(parsed.hookSpecificOutput.additionalContext).toContain("legalese 2");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("stays silent (no stdout, exit 0) for a clean file", async () => {
    const cwd = makeProject();
    try {
      const file = join(cwd, "notes.md");
      writeFileSync(file, "A short, clear sentence.\n");
      const { stdout, exitCode } = await runHook({
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        cwd,
        tool_input: { file_path: file, old_string: "a", new_string: "b" },
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("exits 0 silently on malformed stdin", async () => {
    const proc = Bun.spawn(["bun", script], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    proc.stdin.write("{not json");
    proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
