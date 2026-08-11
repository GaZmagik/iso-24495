// Advisory plain-language hook. After Claude writes or edits a markdown
// file, this audits it with the Part 4 rule engine and feeds one terse line
// back as context. It never blocks a write: plain-language pressure belongs
// in the agent's next edit, not in a refusal. Per-project off switch:
// .iso-24495-4/hooks.json with {"markdownAudit": false}.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { auditText } from "../skills/iso-24495-4/scripts/audit-corpus.ts";

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
  if (!/\.md$/i.test(filePath)) return null;
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

if (import.meta.main) {
  // Advisory contract: once the module has loaded, the script always exits 0
  // and prints only when there is something to say. (Environmental failures —
  // bun missing, the command not starting, an import failing to parse — are
  // outside this block's control and surface as a hook-error notice, which is
  // accepted.)
  try {
    const input = JSON.parse(readFileSync(0, "utf8")) as HookInput;
    const filePath = input?.tool_input?.file_path;
    // The off switch anchors to the stable project root, not the session's
    // mutable cwd — `cd src` must not disable a project's configuration.
    // Writes outside the project consult the session project's switch.
    const cwd = process.env.CLAUDE_PROJECT_DIR ?? input?.cwd ?? process.cwd();
    const advice = filePath ? adviseOnFile(filePath, cwd) : null;
    if (advice) {
      console.log(JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: advice },
      }));
    }
  } catch {
    // Malformed stdin or an unreadable file: stay silent.
  }
  process.exit(0);
}
