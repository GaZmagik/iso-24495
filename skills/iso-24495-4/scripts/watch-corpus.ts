// Background monitor entry point. Stays silent unless the working directory
// contains an engagement config (.iso-24495-4/monitor.json naming a corpus
// directory). When configured, it re-audits changed files and emits one line
// per regression or improvement, which the host delivers as a notification.

import { existsSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";
import { auditText } from "./audit-corpus.ts";

export interface MonitorConfig {
  corpusDir: string;
}

export function loadMonitorConfig(cwd: string): MonitorConfig | null {
  const path = join(cwd, ".iso-24495-4", "monitor.json");
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed?.corpusDir !== "string") return null;
  return { corpusDir: parsed.corpusDir };
}

export function formatDelta(
  file: string,
  before: Record<string, number>,
  after: Record<string, number>,
): string | null {
  const rules = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes = rules
    .filter((rule) => (before[rule] ?? 0) !== (after[rule] ?? 0))
    .map((rule) => `${rule} ${before[rule] ?? 0} -> ${after[rule] ?? 0}`);
  if (changes.length === 0) return null;
  return `iso-24495-4 corpus change: ${file} ${changes.join(", ")}`;
}

function totalsFor(path: string): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const violation of auditText(readFileSync(path, "utf8"))) {
    totals[violation.rule] = (totals[violation.rule] ?? 0) + 1;
  }
  return totals;
}

if (import.meta.main) {
  const config = loadMonitorConfig(process.cwd());
  if (!config) process.exit(0);
  const corpus = join(process.cwd(), config.corpusDir);
  if (!existsSync(corpus)) process.exit(0);
  const baselines = new Map<string, Record<string, number>>();
  watch(corpus, { recursive: true }, (_event, filename) => {
    if (!filename || !/\.(md|txt)$/i.test(filename)) return;
    const full = join(corpus, filename.toString());
    if (!existsSync(full)) return;
    const before = baselines.get(full) ?? {};
    const after = totalsFor(full);
    baselines.set(full, after);
    const line = formatDelta(filename.toString().replaceAll("\\", "/"), before, after);
    if (line) console.log(line);
  });
}
