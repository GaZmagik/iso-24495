import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { formatDelta, loadMonitorConfig } from "../scripts/watch-corpus.ts";

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
