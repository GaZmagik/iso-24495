// Background monitor entry point. Runs for the whole session and stays silent
// unless the working directory contains an engagement config
// (.iso-24495-4/monitor.json naming a corpus directory). While no config
// exists it waits for one to appear; when configured, it re-audits changed
// files and emits one line per regression or improvement, which the host
// delivers as a notification. Removing the config mid-session returns the
// monitor to the waiting state. It never exits on its own, so the host never
// reports it as an ended task.
//
// The engagement is driven by the config, not by watcher handles: the scan
// runs on every sync while a valid config and corpus exist, whether or not
// the OS watcher survives. Watchers only make reporting faster; the interval
// bounds the delay when they fail.

import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { join, relative } from "node:path";
import { auditText, listTextFiles } from "./audit-corpus.ts";

export interface MonitorConfig {
  corpusDir: string;
}

export interface MonitorOptions {
  intervalMs?: number;
  // Polling-only mode: no OS watchers, the interval does all detection.
  // Useful where fs.watch is unreliable, and for pinning the interval in tests.
  pollOnly?: boolean;
}

export interface Monitor {
  sync(): void;
  watchedCorpus(): string | null;
  stop(): void;
}

// Bounds the reporting delay when watch events are missed, errored, or
// filename-less; also keeps the event loop alive when no watcher is open.
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
  options: MonitorOptions = {},
): Monitor {
  const intervalMs = options.intervalMs ?? SYNC_INTERVAL_MS;
  const pollOnly = options.pollOnly ?? false;
  const configDir = join(cwd, ".iso-24495-4");
  const baselines = new Map<string, Record<string, number>>();
  const stamps = new Map<string, { mtimeMs: number; size: number }>();
  let cwdWatcher: FSWatcher | null = null;
  let configWatcher: FSWatcher | null = null;
  let corpusWatcher: FSWatcher | null = null;
  let engagedCorpus: string | null = null;
  let primed = false;

  function closeQuietly(watcher: FSWatcher): void {
    try {
      watcher.close();
    } catch {
      // Already-closed or vanished handles are fine to ignore.
    }
  }

  // Audits every corpus file whose mtime or size moved since the last scan,
  // and reports deletions. Returns false when enumeration itself failed, so
  // a failed priming pass is retried instead of being marked done. The first
  // scan of an engagement runs with emitDeltas false: it primes baselines so
  // pre-existing violations are not reported as changes.
  function scanCorpus(emitDeltas: boolean): boolean {
    if (!engagedCorpus) return false;
    try {
      const files = listTextFiles(engagedCorpus);
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
            const line = formatDelta(relative(engagedCorpus, full).replaceAll("\\", "/"), before, after);
            if (line) emit(line);
          }
        } catch {
          // The file vanished or was mid-write; the next scan settles it.
        }
      }
      for (const known of [...baselines.keys()]) {
        if (present.has(known)) continue;
        const line = formatDelta(relative(engagedCorpus, known).replaceAll("\\", "/"), baselines.get(known)!, {});
        baselines.delete(known);
        stamps.delete(known);
        if (emitDeltas && line) emit(line);
      }
      return true;
    } catch {
      // The corpus directory vanished mid-scan; the next sync disengages.
      return false;
    }
  }

  function sync(): void {
    if (!pollOnly && !cwdWatcher) {
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

    if (!pollOnly && existsSync(configDir)) {
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

    if (desired !== engagedCorpus) {
      if (corpusWatcher) {
        closeQuietly(corpusWatcher);
        corpusWatcher = null;
      }
      baselines.clear();
      stamps.clear();
      engagedCorpus = desired;
      primed = false;
    }

    if (engagedCorpus) {
      // Prime before installing the watcher: an edit landing between the two
      // then shows as a stamp change on the next scan instead of being
      // silently absorbed into the baseline.
      if (!primed) primed = scanCorpus(false);
      else scanCorpus(true);
      if (!pollOnly && !corpusWatcher) {
        try {
          corpusWatcher = watch(engagedCorpus, { recursive: true }, () => sync());
          corpusWatcher.on("error", () => {
            // Scanning continues without the watcher; the interval bounds the
            // reporting delay and the next sync reinstalls it.
            corpusWatcher = null;
          });
        } catch {
          corpusWatcher = null;
        }
      }
    }
  }

  const timer = setInterval(sync, intervalMs);
  sync();

  return {
    sync,
    watchedCorpus: () => engagedCorpus,
    stop() {
      clearInterval(timer);
      for (const watcher of [cwdWatcher, configWatcher, corpusWatcher]) {
        if (watcher) closeQuietly(watcher);
      }
      cwdWatcher = null;
      configWatcher = null;
      corpusWatcher = null;
      engagedCorpus = null;
      baselines.clear();
      stamps.clear();
    },
  };
}

if (import.meta.main) {
  startMonitor(process.cwd());
}
