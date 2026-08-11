// Background monitor entry point. Runs for the whole session and stays silent
// unless the working directory contains an engagement config
// (.iso-24495-4/monitor.json naming a corpus directory). While no config
// exists it waits for one to appear; when configured, it re-audits changed
// files and emits one line per regression or improvement, which the host
// delivers as a notification. Removing the config mid-session returns the
// monitor to the waiting state. It never exits on its own, so the host never
// reports it as an ended task.

import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { join, relative } from "node:path";
import { auditText, listTextFiles } from "./audit-corpus.ts";

export interface MonitorConfig {
  corpusDir: string;
}

export interface Monitor {
  sync(): void;
  watchedCorpus(): string | null;
  stop(): void;
}

// Safety net for missed or errored watch events; also keeps the event loop
// alive even if every watcher has been torn down.
const SYNC_INTERVAL_MS = 30_000;

export function loadMonitorConfig(cwd: string): MonitorConfig | null {
  const path = join(cwd, ".iso-24495-4", "monitor.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed?.corpusDir !== "string") return null;
    return { corpusDir: parsed.corpusDir };
  } catch {
    // A half-written or invalid config must not kill the monitor; the next
    // watch event or interval tick re-reads it.
    return null;
  }
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

export function startMonitor(
  cwd: string,
  emit: (line: string) => void = console.log,
): Monitor {
  const configDir = join(cwd, ".iso-24495-4");
  const baselines = new Map<string, Record<string, number>>();
  const stamps = new Map<string, { mtimeMs: number; size: number }>();
  let cwdWatcher: FSWatcher | null = null;
  let configWatcher: FSWatcher | null = null;
  let corpusWatcher: FSWatcher | null = null;
  let corpusPath: string | null = null;

  function closeQuietly(watcher: FSWatcher): void {
    try {
      watcher.close();
    } catch {
      // Already-closed or vanished handles are fine to ignore.
    }
  }

  // Audits every corpus file whose mtime or size moved since the last scan,
  // and reports deletions. Watch events and the interval both funnel here, so
  // a missed or filename-less event only delays a report, never loses it.
  // The first scan after a corpus watch starts runs with emitDeltas false: it
  // primes baselines so pre-existing violations are not reported as changes.
  function scanCorpus(emitDeltas: boolean): void {
    if (!corpusPath) return;
    try {
      const files = listTextFiles(corpusPath);
      const present = new Set(files);
      for (const full of files) {
        try {
          const stat = statSync(full);
          const prev = stamps.get(full);
          if (prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) continue;
          const before = baselines.get(full) ?? {};
          const after = totalsFor(full);
          stamps.set(full, { mtimeMs: stat.mtimeMs, size: stat.size });
          baselines.set(full, after);
          if (emitDeltas) {
            const line = formatDelta(relative(corpusPath, full).replaceAll("\\", "/"), before, after);
            if (line) emit(line);
          }
        } catch {
          // The file vanished or was mid-write; the next scan settles it.
        }
      }
      for (const known of [...baselines.keys()]) {
        if (present.has(known)) continue;
        const line = formatDelta(relative(corpusPath, known).replaceAll("\\", "/"), baselines.get(known)!, {});
        baselines.delete(known);
        stamps.delete(known);
        if (emitDeltas && line) emit(line);
      }
    } catch {
      // The corpus directory vanished mid-scan; the next sync tears the
      // watcher down and returns to waiting.
    }
  }

  function sync(): void {
    if (!cwdWatcher) {
      try {
        cwdWatcher = watch(cwd, (_event, filename) => {
          if (!filename || filename.toString() === ".iso-24495-4") sync();
        });
        cwdWatcher.on("error", () => {
          cwdWatcher = null;
        });
      } catch {
        cwdWatcher = null;
      }
    }

    if (existsSync(configDir)) {
      if (!configWatcher) {
        try {
          configWatcher = watch(configDir, () => sync());
          configWatcher.on("error", () => {
            configWatcher = null;
          });
        } catch {
          configWatcher = null;
        }
      }
    } else if (configWatcher) {
      closeQuietly(configWatcher);
      configWatcher = null;
    }

    const config = loadMonitorConfig(cwd);
    let desired = config ? join(cwd, config.corpusDir) : null;
    if (desired && !existsSync(desired)) desired = null;

    if (corpusWatcher && corpusPath !== desired) {
      closeQuietly(corpusWatcher);
      corpusWatcher = null;
      corpusPath = null;
      baselines.clear();
      stamps.clear();
    }
    let primed = false;
    if (desired && !corpusWatcher) {
      try {
        corpusWatcher = watch(desired, { recursive: true }, () => sync());
        corpusWatcher.on("error", () => {
          corpusWatcher = null;
          corpusPath = null;
        });
        corpusPath = desired;
        scanCorpus(false);
        primed = true;
      } catch {
        corpusWatcher = null;
        corpusPath = null;
      }
    }
    if (!primed) scanCorpus(true);
  }

  const timer = setInterval(sync, SYNC_INTERVAL_MS);
  sync();

  return {
    sync,
    watchedCorpus: () => corpusPath,
    stop() {
      clearInterval(timer);
      for (const watcher of [cwdWatcher, configWatcher, corpusWatcher]) {
        if (watcher) closeQuietly(watcher);
      }
      cwdWatcher = null;
      configWatcher = null;
      corpusWatcher = null;
      corpusPath = null;
      baselines.clear();
      stamps.clear();
    },
  };
}

if (import.meta.main) {
  startMonitor(process.cwd());
}
