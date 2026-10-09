// What the three release test files share: a checkout written into a fresh
// directory, and the means to change it and to read what a command printed.
// None of it reads this repository's own release history.

import { expect } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SKILLS = ["skills/iso-24495-1", "skills/iso-24495-text-audit", "codex-skills/iso-24495-style"];

/**
 * A checkout whose every version site names `version`, written into a fresh
 * directory. None of these tests reads this repository's own release history.
 */
function makeCheckout(version: string): string {
  const root = mkdtempSync(join(tmpdir(), "iso-24495-release-"));
  const write = (path: string, text: string): void => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  };
  write(".claude-plugin/plugin.json", JSON.stringify({ name: "plugin", version }));
  write(".codex-plugin/plugin.json", JSON.stringify({ name: "plugin", version }));
  write(".claude-plugin/marketplace.json", JSON.stringify({
    plugins: [{ version, source: { source: "url", ref: `v${version}` } }],
  }));
  for (const skill of SKILLS) {
    write(`${skill}/SKILL.md`, `---\nname: x\nmetadata:\n  version: "${version}"\n---\n\n# Skill\n`);
  }
  write("CHANGELOG.md", `# Changelog\n\n## [${version}] - 2026-09-27\n\n- A change.\n`);
  return root;
}

/** Replaces text in one file of a checkout, and fails if the text is not there. */
export function edit(root: string, path: string, from: string, to: string): void {
  const text = readFileSync(join(root, path), "utf8");
  expect(text, `${path} holds ${from}`).toContain(from);
  writeFileSync(join(root, path), text.replace(from, to), "utf8");
}

/** Collects what a command prints, so a test can read it back. */
export function capture(): { out: string[]; err: string[]; stdout: (t: string) => void; stderr: (t: string) => void } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (text) => out.push(text), stderr: (text) => err.push(text) };
}

export function withCheckout(version: string, body: (root: string) => void): void {
  const root = makeCheckout(version);
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
