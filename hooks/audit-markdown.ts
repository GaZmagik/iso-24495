// Advisory plain-language hook. After Claude writes or edits a supported
// text file, this audits it with the Part 4 rule engine and feeds one terse line
// back as context. It never blocks a write: plain-language pressure belongs
// in the agent's next edit, not in a refusal. Per-project off switch:
// .iso-24495-4/hooks.json with {"markdownAudit": false}.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { auditText, TEXT_EXTENSIONS } from "../skills/iso-24495-4/scripts/audit-corpus.ts";

interface HookInput {
  cwd?: string;
  tool_input?: { file_path?: string };
}

export function hookEnabled(cwd: string): boolean {
  const path = join(cwd, ".iso-24495-4", "hooks.json");
  if (!existsSync(path)) return true;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed?.markdownAudit !== false;
  } catch {
    // An unreadable switch leaves the hook on; advisory noise is the safer
    // failure than silently losing the check.
    return true;
  }
}

export function adviseOnFile(filePath: string, cwd: string): string | null {
  // Derived from the engine's own list, never restated here: a second copy is
  // a second thing to forget when a format is added.
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (!TEXT_EXTENSIONS.includes(extension)) return null;
  if (/[\\/](node_modules|\.git)[\\/]/.test(filePath)) return null;
  if (!hookEnabled(cwd)) return null;
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const totals: Record<string, number> = {};
  for (const violation of auditText(text)) {
    totals[violation.rule] = (totals[violation.rule] ?? 0) + 1;
  }
  const parts = Object.entries(totals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, count]) => `${rule} ${count}`);
  if (parts.length === 0) return null;
  return (
    `iso-24495 plain-language advisory for ${basename(filePath)}: ` +
    `${parts.join(", ")} (whole-file counts). This is advisory only.`
  );
}

export function handlePayload(raw: string): string | null {
  try {
    const input = JSON.parse(raw) as HookInput;
    const filePath = input?.tool_input?.file_path;
    if (!filePath) return null;
    // The off switch anchors to the stable project root, not the session's
    // mutable cwd: `cd src` must not disable a project's configuration.
    // Writes outside the project consult the session project's switch.
    const cwd = process.env.CLAUDE_PROJECT_DIR ?? input?.cwd ?? process.cwd();
    const advice = adviseOnFile(filePath, cwd);
    return advice
      ? JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: advice },
      })
      : null;
  } catch {
    // Malformed stdin or an unreadable file: stay silent.
    return null;
  }
}

export function runHook(raw: string, stdout: (text: string) => void): void {
  const output = handlePayload(raw);
  if (output) stdout(output);
}
