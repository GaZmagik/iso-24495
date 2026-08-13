import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmdirSync, rmSync, symlinkSync, writeFileSync, type FSWatcher } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDelta, loadMonitorConfig, startMonitor, type Monitor } from "../scripts/watch-corpus.ts";

class FakeWatcher extends EventEmitter {
  close(): void {}
}

function fakeWatchFactory() {
  const watchers: Array<{ path: string; watcher: FakeWatcher }> = [];
  const watchFn = (path: string, arg2?: unknown, arg3?: unknown): FSWatcher => {
    const watcher = new FakeWatcher();
    const listener = typeof arg2 === "function" ? arg2 : arg3;
    if (typeof listener === "function") watcher.on("change", listener as (...args: unknown[]) => void);
    watchers.push({ path, watcher });
    return watcher as unknown as FSWatcher;
  };
  return { watchers, watchFn };
}

const FIXTURES = join(import.meta.dir, "fixtures");

describe("loadMonitorConfig", () => {
  test("returns null when no engagement config exists", () => {
    expect(loadMonitorConfig(join(FIXTURES, "repo-level0"))).toBeNull();
  });

  test("reads the corpus directory from .iso-24495-4/monitor.json", () => {
    const config = loadMonitorConfig(join(FIXTURES, "monitored"));
    expect(config).not.toBeNull();
    expect(config!.corpusDir).toBe("docs");
  });

  test("returns null when the config file is not valid JSON", () => {
    expect(loadMonitorConfig(join(FIXTURES, "invalid-config"))).toBeNull();
  });
});

describe("formatDelta", () => {
  test("emits a single line naming the file and each changed rule count", () => {
    const line = formatDelta("docs/a.md", { legalese: 0 }, { legalese: 2 });
    expect(line).toBe("iso-24495-4 corpus change: docs/a.md legalese 0 -> 2");
    expect(line).not.toContain("\n");
  });

  test("returns null when nothing changed", () => {
    expect(formatDelta("docs/a.md", { legalese: 1 }, { legalese: 1 })).toBeNull();
  });
});

describe("startMonitor", () => {
  let cwd: string;
  let monitor: Monitor | null = null;

  function makeCwd(): string {
    cwd = mkdtempSync(join(tmpdir(), "iso-24495-4-monitor-"));
    return cwd;
  }

  function writeConfig(corpusDir: string): void {
    mkdirSync(join(cwd, ".iso-24495-4"), { recursive: true });
    writeFileSync(
      join(cwd, ".iso-24495-4", "monitor.json"),
      JSON.stringify({ corpusDir }),
    );
  }

  afterEach(() => {
    monitor?.stop();
    monitor = null;
    rmSync(cwd, { recursive: true, force: true });
  });

  test("watches nothing while no engagement config exists", () => {
    monitor = startMonitor(makeCwd(), () => {});
    expect(monitor.watchedCorpus()).toBeNull();
  });

  test("starts watching the corpus when the config and corpus directory exist", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    monitor = startMonitor(cwd, () => {});
    expect(monitor.watchedCorpus()).toBe(join(cwd, "docs"));
  });

  test("picks up a config that appears after start, on the next sync", () => {
    monitor = startMonitor(makeCwd(), () => {});
    expect(monitor.watchedCorpus()).toBeNull();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    monitor.sync();
    expect(monitor.watchedCorpus()).toBe(join(cwd, "docs"));
  });

  test("stops watching the corpus when the config is removed", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    monitor = startMonitor(cwd, () => {});
    expect(monitor.watchedCorpus()).toBe(join(cwd, "docs"));
    rmSync(join(cwd, ".iso-24495-4"), { recursive: true, force: true });
    monitor.sync();
    expect(monitor.watchedCorpus()).toBeNull();
  });

  test("does not watch a corpus whose directory is missing, and does not throw on invalid JSON", () => {
    makeCwd();
    writeConfig("docs");
    monitor = startMonitor(cwd, () => {});
    expect(monitor.watchedCorpus()).toBeNull();
    writeFileSync(join(cwd, ".iso-24495-4", "monitor.json"), "{not valid json");
    expect(() => monitor!.sync()).not.toThrow();
    expect(monitor.watchedCorpus()).toBeNull();
  });

  test("emits a delta line when a nested corpus file appears", async () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs", "sub"), { recursive: true });
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line));
    writeFileSync(
      join(cwd, "docs", "sub", "policy.md"),
      "The party of the first part shall hereinafter effectuate the aforementioned provisions notwithstanding anything herein.\n",
    );
    const deadline = Date.now() + 5000;
    while (lines.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toStartWith("iso-24495-4 corpus change: sub/policy.md");
  });

  test("does not report pre-existing violations when the watch starts", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line));
    monitor.sync();
    expect(lines).toHaveLength(0);
  });

  test("reports a delta against the primed baseline when a file changes", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line));
    writeFileSync(join(cwd, "docs", "policy.md"), "You must comply with this policy.\n");
    monitor.sync();
    expect(lines).toContain("iso-24495-4 corpus change: policy.md legalese 2 -> 0");
  });

  test("does not re-report an unchanged file on later syncs", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line));
    monitor.sync();
    monitor.sync();
    expect(lines).toHaveLength(0);
  });

  test("reports decreases and prunes state when a corpus file is deleted", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line));
    rmSync(join(cwd, "docs", "policy.md"));
    monitor.sync();
    expect(lines).toContain("iso-24495-4 corpus change: policy.md legalese 2 -> 0");
    monitor.sync();
    expect(lines).toHaveLength(1);
  });

  test("keeps the engagement and keeps detecting when the corpus watcher errors", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    const { watchers, watchFn } = fakeWatchFactory();
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line), { watchFn });
    const corpusWatcher = watchers.find((w) => w.path === join(cwd, "docs"));
    expect(corpusWatcher).toBeDefined();
    corpusWatcher!.watcher.emit("error", new Error("EPERM"));
    writeFileSync(join(cwd, "docs", "policy.md"), "You must comply with this policy.\n");
    monitor.sync();
    expect(monitor.watchedCorpus()).toBe(join(cwd, "docs"));
    expect(lines).toEqual(["iso-24495-4 corpus change: policy.md legalese 2 -> 0"]);
  });

  test("recovers when directory watchers emit errors or change events", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall comply.\n");
    const { watchers, watchFn } = fakeWatchFactory();
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line), { watchFn });
    const cwdWatcher = watchers.find((entry) => entry.path === cwd)!.watcher;
    const configWatcher = watchers.find((entry) => entry.path === join(cwd, ".iso-24495-4"))!.watcher;
    const corpusWatcher = watchers.find((entry) => entry.path === join(cwd, "docs"))!.watcher;

    cwdWatcher.emit("change", "unrelated.txt");
    cwdWatcher.emit("change", null);
    configWatcher.emit("change", "monitor.json");
    writeFileSync(join(cwd, "docs", "policy.md"), "You must comply.\n");
    corpusWatcher.emit("change", "policy.md");
    expect(lines).toEqual(["iso-24495-4 corpus change: policy.md legalese 1 -> 0"]);
    cwdWatcher.emit("error", new Error("cwd unavailable"));
    configWatcher.emit("error", new Error("config unavailable"));
    corpusWatcher.emit("error", new Error("corpus unavailable"));
    expect(() => monitor!.sync()).not.toThrow();
    expect(monitor.watchedCorpus()).toBe(join(cwd, "docs"));
    expect(watchers).toHaveLength(6);
  });

  test("continues by polling when every watcher installation throws", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    const throwingWatch = (): FSWatcher => {
      throw new Error("watch unavailable");
    };
    expect(() => {
      monitor = startMonitor(cwd, () => {}, { watchFn: throwingWatch });
    }).not.toThrow();
    expect(monitor!.watchedCorpus()).toBe(join(cwd, "docs"));
    expect(() => monitor!.sync()).not.toThrow();
  });

  test("uses console output when no emitter is supplied", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall comply.\n");
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (line?: unknown) => lines.push(String(line));
    try {
      monitor = startMonitor(cwd, undefined, { pollOnly: true });
      writeFileSync(join(cwd, "docs", "policy.md"), "You must comply.\n");
      monitor.sync();
      expect(lines).toEqual(["iso-24495-4 corpus change: policy.md legalese 1 -> 0"]);
    } finally {
      console.log = originalLog;
    }
  });

  test("reports an edit that lands between priming and watcher installation", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    const { watchFn } = fakeWatchFactory();
    const racingWatchFn = (path: string, ...rest: unknown[]) => {
      if (path === join(cwd, "docs")) {
        writeFileSync(join(cwd, "docs", "policy.md"), "You must comply with this policy.\n");
      }
      return (watchFn as (...args: unknown[]) => ReturnType<typeof watchFn>)(path, ...rest);
    };
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line), { watchFn: racingWatchFn });
    monitor.sync();
    expect(lines).toEqual(["iso-24495-4 corpus change: policy.md legalese 2 -> 0"]);
  });

  test("retries priming until the corpus is enumerable", () => {
    makeCwd();
    writeConfig("docs");
    writeFileSync(join(cwd, "docs"), "a file where the corpus directory should be");
    const { watchFn } = fakeWatchFactory();
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line), { watchFn });
    expect(lines).toHaveLength(0);
    rmSync(join(cwd, "docs"));
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    monitor.sync();
    expect(lines).toHaveLength(0);
    writeFileSync(join(cwd, "docs", "policy.md"), "You must comply with this policy.\n");
    monitor.sync();
    expect(lines).toEqual(["iso-24495-4 corpus change: policy.md legalese 2 -> 0"]);
  });

  test("suppresses deletion reports while part of the corpus is unreadable", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs", "sub"), { recursive: true });
    writeFileSync(join(cwd, "docs", "sub", "policy.md"), "The supplier shall hereby comply.\n");
    const { watchFn } = fakeWatchFactory();
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line), { watchFn });
    rmSync(join(cwd, "docs", "sub"), { recursive: true, force: true });
    symlinkSync(join(cwd, "missing-target"), join(cwd, "docs", "sub"), "junction");
    monitor.sync();
    expect(lines).toHaveLength(0);
    rmdirSync(join(cwd, "docs", "sub"));
    monitor.sync();
    expect(lines).toEqual(["iso-24495-4 corpus change: sub/policy.md legalese 2 -> 0"]);
  });

  test("reports changes to readable files even while part of the corpus is unreadable", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    symlinkSync(join(cwd, "missing-target"), join(cwd, "docs", "broken"), "junction");
    const { watchFn } = fakeWatchFactory();
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line), { watchFn });
    expect(lines).toHaveLength(0);
    writeFileSync(join(cwd, "docs", "policy.md"), "You must comply with this policy.\n");
    monitor.sync();
    expect(lines).toEqual(["iso-24495-4 corpus change: policy.md legalese 2 -> 0"]);
  });

  test("reports an unrelated deletion while a skip persists elsewhere", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    writeFileSync(join(cwd, "docs", "other.md"), "The vendor shall comply.\n");
    symlinkSync(join(cwd, "missing-target"), join(cwd, "docs", "broken"), "junction");
    const { watchFn } = fakeWatchFactory();
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line), { watchFn });
    rmSync(join(cwd, "docs", "other.md"));
    monitor.sync();
    expect(lines).toEqual(["iso-24495-4 corpus change: other.md legalese 1 -> 0"]);
  });

  test("primes silently when a subtree skipped at engagement start becomes readable", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "A short sentence.\n");
    symlinkSync(join(cwd, "missing-target"), join(cwd, "docs", "sub"), "junction");
    const { watchFn } = fakeWatchFactory();
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line), { watchFn });
    rmdirSync(join(cwd, "docs", "sub"));
    mkdirSync(join(cwd, "docs", "sub"));
    writeFileSync(join(cwd, "docs", "sub", "old.md"), "The supplier shall hereby comply.\n");
    monitor.sync();
    expect(lines).toHaveLength(0);
    writeFileSync(join(cwd, "docs", "sub", "old.md"), "You must comply with this policy.\n");
    monitor.sync();
    expect(lines).toEqual(["iso-24495-4 corpus change: sub/old.md legalese 2 -> 0"]);
  });

  test("reports additions in a restored subtree once it has been scanned", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "A short sentence.\n");
    symlinkSync(join(cwd, "missing-target"), join(cwd, "docs", "sub"), "junction");
    const { watchFn } = fakeWatchFactory();
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line), { watchFn });
    rmdirSync(join(cwd, "docs", "sub"));
    mkdirSync(join(cwd, "docs", "sub"));
    writeFileSync(join(cwd, "docs", "sub", "old.md"), "A compliant sentence.\n");
    monitor.sync();
    expect(lines).toHaveLength(0);
    writeFileSync(join(cwd, "docs", "sub", "new.md"), "The supplier shall hereby comply.\n");
    monitor.sync();
    expect(lines).toEqual(["iso-24495-4 corpus change: sub/new.md legalese 0 -> 2"]);
  });

  test("holds an active engagement while the config file is momentarily invalid", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    const { watchFn } = fakeWatchFactory();
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line), { watchFn });
    writeFileSync(join(cwd, ".iso-24495-4", "monitor.json"), "{half-written");
    writeFileSync(join(cwd, "docs", "policy.md"), "You must comply with this policy.\n");
    monitor.sync();
    expect(monitor.watchedCorpus()).toBe(join(cwd, "docs"));
    expect(lines).toEqual(["iso-24495-4 corpus change: policy.md legalese 2 -> 0"]);
  });

  test("does not re-report an already reported change on later syncs", () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line));
    writeFileSync(join(cwd, "docs", "policy.md"), "You must comply with this policy.\n");
    monitor.sync();
    monitor.sync();
    expect(lines).toEqual(["iso-24495-4 corpus change: policy.md legalese 2 -> 0"]);
  });

  test("the interval alone detects changes when no watcher can (pollOnly)", async () => {
    makeCwd();
    writeConfig("docs");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "policy.md"), "The supplier shall hereby comply.\n");
    const lines: string[] = [];
    monitor = startMonitor(cwd, (line) => lines.push(line), { intervalMs: 100, pollOnly: true });
    expect(monitor.watchedCorpus()).toBe(join(cwd, "docs"));
    expect(lines).toHaveLength(0);
    writeFileSync(join(cwd, "docs", "policy.md"), "You must comply with this policy.\n");
    const deadline = Date.now() + 5000;
    while (lines.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(lines).toEqual(["iso-24495-4 corpus change: policy.md legalese 2 -> 0"]);
  });

  test("the entry point process stays alive when no config exists", async () => {
    const script = join(import.meta.dir, "..", "scripts", "watch-corpus.ts");
    const proc = Bun.spawn(["bun", script], {
      cwd: makeCwd(),
      stdout: "ignore",
      stderr: "ignore",
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(proc.exitCode).toBeNull();
    proc.kill();
    await proc.exited;
  });
});
