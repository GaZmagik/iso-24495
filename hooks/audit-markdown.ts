// Advisory plain-language hook. After Claude writes or edits a supported
// text file, this audits it with the Part 4 rule engine and feeds one terse line
// back as context. It never blocks a write: plain-language pressure belongs
// in the agent's next edit, not in a refusal. Per-project off switch:
// .iso-24495-4/hooks.json with {"markdownAudit": false}.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  auditText,
  isAuditedDocument,
  projectAcronyms,
} from "../skills/iso-24495-4/scripts/audit-corpus.ts";
import type { Violation } from "../skills/iso-24495-4/scripts/lib/types.ts";

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

function joined(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

export function formatAdvice(fileName: string, violations: readonly Violation[]): string | null {
  if (violations.length === 0) return null;
  const ruleCount = new Set(violations.map((violation) => violation.rule)).size;
  const local = violations
    .filter((violation) => violation.rule !== "sentence-average")
    .sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  const grouped = new Map<string, { line: number; rule: string; count: number }>();
  for (const violation of local) {
    const key = `${violation.line}\0${violation.rule}`;
    const point = grouped.get(key);
    if (point) point.count += 1;
    else grouped.set(key, { line: violation.line, rule: violation.rule, count: 1 });
  }
  const startingPoints = [...grouped.values()].slice(0, 3);
  const shownFindings = startingPoints.reduce((total, point) => total + point.count, 0);
  const remaining = local.length - shownFindings;
  const findingLabel = violations.length === 1 ? "finding" : "findings";
  const ruleLabel = ruleCount === 1 ? "rule" : "rules";
  const sentences = [
    `iso-24495 advisory for ${fileName}: ${violations.length} ${findingLabel} across ${ruleCount} ${ruleLabel}.`,
  ];
  if (startingPoints.length > 0) {
    const points = startingPoints.map((point) =>
      `line ${point.line} (${point.rule.replaceAll("-", " ")})`
    );
    sentences.push(`Start at ${joined(points)}.`);
  }
  if (violations.some((violation) => violation.rule === "sentence-average")) {
    sentences.push("Document average is high.");
  }
  if (remaining > 0) {
    const otherLabel = remaining === 1 ? "finding remains" : "findings remain";
    sentences.push(`${remaining} other ${otherLabel}.`);
  }
  sentences.push("Advisory only.");
  return sentences.join(" ");
}

export function adviseOnFile(filePath: string, cwd: string): string | null {
  // The engine decides what it audits. A second copy of the rule here is a
  // second thing to forget, and the copies disagreed on letter case.
  if (!isAuditedDocument(filePath)) return null;
  if (/[\\/](node_modules|\.git)[\\/]/.test(filePath)) return null;
  if (!hookEnabled(cwd)) return null;
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  // The project's own acronyms come from the same directory as the off
  // switch, so a writer configures the plugin in one place.
  const violations = auditText(text, { knownAcronyms: projectAcronyms(cwd) });
  return formatAdvice(basename(filePath), violations);
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
