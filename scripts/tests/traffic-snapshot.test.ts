import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  mergeDaily,
  mergeReferrers,
  mergeWindows,
  parseSnapshot,
  runCli,
  type Deps,
  type Snapshot,
} from "../traffic-snapshot.ts";

const RAW = {
  clones: {
    count: 30,
    uniques: 12,
    clones: [
      { timestamp: "2026-08-20T00:00:00Z", count: 10, uniques: 4 },
      { timestamp: "2026-08-21T00:00:00Z", count: 20, uniques: 8 },
    ],
  },
  views: {
    count: 90,
    uniques: 40,
    views: [{ timestamp: "2026-08-21T00:00:00Z", count: 90, uniques: 40 }],
  },
  referrers: [
    { referrer: "reddit.com", count: 733, uniques: 180 },
    { referrer: "an,awkward.host", count: 2, uniques: 1 },
  ],
  repo: { stargazers_count: 102, forks_count: 5, subscribers_count: 0 },
};

function snapshotOf(raw: unknown): Snapshot {
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.snapshot;
}

function rowsOf(csv: string): string[] {
  return csv.trimEnd().split("\n");
}

interface Harness {
  deps: Deps;
  files: Map<string, string>;
  stdout: string[];
  stderr: string[];
}

function harness(overrides: Partial<Deps> = {}): Harness {
  const files = new Map<string, string>();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: Deps = {
    readText: (path) => files.get(path) ?? null,
    writeText: (path, text) => {
      files.set(path, text);
    },
    fetchSnapshot: async () => RAW,
    today: () => "2026-08-22",
    ...overrides,
  };
  return { deps, files, stdout, stderr };
}

describe("parseSnapshot", () => {
  test("maps the four API responses onto one snapshot", () => {
    const snapshot = snapshotOf(RAW);
    expect(snapshot.clones.count).toBe(30);
    expect(snapshot.clones.uniques).toBe(12);
    expect(snapshot.clones.days).toHaveLength(2);
    expect(snapshot.clones.days[0]?.timestamp).toBe("2026-08-20");
    expect(snapshot.views.uniques).toBe(40);
    expect(snapshot.referrers[0]?.referrer).toBe("reddit.com");
    expect(snapshot.repo).toEqual({ stars: 102, forks: 5, watchers: 0 });
  });

  test.each([
    ["a payload that is not an object", "not an object", "not an object"],
    ["a payload that is an array", [], "not an object"],
    ["clones without a count", { ...RAW, clones: { uniques: 1, clones: [] } }, "clones response"],
    ["clones without a daily list", { ...RAW, clones: { count: 1, uniques: 1 } }, "clones response"],
    [
      "a daily entry that is not an object",
      { ...RAW, clones: { count: 1, uniques: 1, clones: ["nope"] } },
      "clones response",
    ],
    [
      "a daily entry without a timestamp",
      { ...RAW, clones: { count: 1, uniques: 1, clones: [{ count: 1, uniques: 1 }] } },
      "clones response",
    ],
    [
      "a daily entry without counts",
      { ...RAW, clones: { count: 1, uniques: 1, clones: [{ timestamp: "2026-08-21T00:00:00Z" }] } },
      "clones response",
    ],
    ["views without a daily list", { ...RAW, views: { count: 1, uniques: 1 } }, "views response"],
    ["referrers that are not a list", { ...RAW, referrers: {} }, "referrers response"],
    ["a referrer without a name", { ...RAW, referrers: [{ count: 1, uniques: 1 }] }, "referrers response"],
    ["a referrer that is not an object", { ...RAW, referrers: [7] }, "referrers response"],
    ["a repository block that is missing", { ...RAW, repo: null }, "repository response"],
    [
      "a repository block without a star count",
      { ...RAW, repo: { forks_count: 1, subscribers_count: 1 } },
      "repository response",
    ],
  ])("refuses %s", (_label, raw, fragment) => {
    const parsed = parseSnapshot(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected a refusal");
    expect(parsed.problem).toContain(fragment);
  });
});

describe("mergeDaily", () => {
  test("writes a header and one row per date, defaulting the absent series to zero", () => {
    const rows = rowsOf(mergeDaily(null, snapshotOf(RAW)));
    expect(rows[0]).toBe("date,clones,clone_uniques,views,view_uniques");
    expect(rows[1]).toBe("2026-08-20,10,4,0,0");
    expect(rows[2]).toBe("2026-08-21,20,8,90,40");
  });

  test("a later reading supersedes an earlier one for the same date", () => {
    const first = mergeDaily(null, snapshotOf(RAW));
    const corrected = {
      ...RAW,
      clones: { count: 99, uniques: 50, clones: [{ timestamp: "2026-08-21T00:00:00Z", count: 99, uniques: 50 }] },
    };
    const rows = rowsOf(mergeDaily(first, snapshotOf(corrected)));
    expect(rows).toHaveLength(3);
    expect(rows[2]).toBe("2026-08-21,99,50,90,40");
  });

  test("a date carrying views alone still gets a row", () => {
    const viewsOnly = { ...RAW, clones: { count: 0, uniques: 0, clones: [] } };
    const rows = rowsOf(mergeDaily(null, snapshotOf(viewsOnly)));
    expect(rows[1]).toBe("2026-08-21,0,0,90,40");
  });
});

describe("mergeWindows", () => {
  test("records the window figures that the daily rows cannot reconstruct", () => {
    const rows = rowsOf(mergeWindows(null, "2026-08-22", snapshotOf(RAW)));
    expect(rows[0]).toBe(
      "snapshot_date,window_days,clones,clone_uniques,views,view_uniques,stars,forks,watchers",
    );
    expect(rows[1]).toBe("2026-08-22,2,30,12,90,40,102,5,0");
  });

  test("a second run on one day replaces that day's row rather than adding one", () => {
    const first = mergeWindows(null, "2026-08-22", snapshotOf(RAW));
    const rows = rowsOf(mergeWindows(first, "2026-08-22", snapshotOf(RAW)));
    expect(rows).toHaveLength(2);
  });

  test("a later day is appended after the earlier one", () => {
    const first = mergeWindows(null, "2026-08-22", snapshotOf(RAW));
    const rows = rowsOf(mergeWindows(first, "2026-08-23", snapshotOf(RAW)));
    expect(rows).toHaveLength(3);
    expect(rows[2]).toContain("2026-08-23");
  });
});

describe("mergeReferrers", () => {
  test("quotes a referrer holding a comma and reads it back unchanged", () => {
    const first = mergeReferrers(null, "2026-08-22", snapshotOf(RAW));
    expect(first).toContain('"an,awkward.host"');
    const rows = rowsOf(mergeReferrers(first, "2026-08-22", snapshotOf(RAW)));
    expect(rows).toHaveLength(3);
    expect(rows[1]).toBe('2026-08-22,"an,awkward.host",2,1');
    expect(rows[2]).toBe("2026-08-22,reddit.com,733,180");
  });

  test("a referrer holding a quotation mark is escaped by doubling it", () => {
    const odd = { ...RAW, referrers: [{ referrer: 'say "hi"', count: 1, uniques: 1 }] };
    const csv = mergeReferrers(null, "2026-08-22", snapshotOf(odd));
    expect(csv).toContain('"say ""hi"""');
    const rows = rowsOf(mergeReferrers(csv, "2026-08-22", snapshotOf(odd)));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe('2026-08-22,"say ""hi""",1,1');
  });
});

describe("runCli", () => {
  test("writes the three files and reports the window figures", async () => {
    const { deps, files, stdout, stderr } = harness();
    const code = await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps);
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect([...files.keys()].sort()).toEqual([
      join("data", "daily.csv"),
      join("data", "referrers.csv"),
      join("data", "windows.csv"),
    ]);
    expect(stdout.join(" ")).toContain("12 unique cloners");
  });

  test("merges into files that already hold rows", async () => {
    const { deps, files, stdout, stderr } = harness();
    const push = (t: string) => stdout.push(t);
    await runCli(["bun", "cli", "data"], push, (t) => stderr.push(t), deps);
    await runCli(["bun", "cli", "data"], push, (t) => stderr.push(t), deps);
    expect(rowsOf(files.get(join("data", "daily.csv")) ?? "")).toHaveLength(3);
  });

  test("a dry run prints every table and writes nothing", async () => {
    const { deps, files, stdout, stderr } = harness();
    const code = await runCli(
      ["bun", "cli", "--dry-run", "data"],
      (t) => stdout.push(t),
      (t) => stderr.push(t),
      deps,
    );
    expect(code).toBe(0);
    expect(files.size).toBe(0);
    expect(stdout.join("\n")).toContain("daily.csv");
    expect(stdout.join("\n")).toContain("windows.csv");
    expect(stdout.join("\n")).toContain("referrers.csv");
  });

  test("reads a fixture instead of the network when told to", async () => {
    const { deps, files, stdout, stderr } = harness();
    files.set("sample.json", JSON.stringify(RAW));
    const failing: Deps = {
      ...deps,
      fetchSnapshot: async () => {
        throw new Error("the network must not be touched");
      },
    };
    const code = await runCli(
      ["bun", "cli", "--from-file", "sample.json", "data"],
      (t) => stdout.push(t),
      (t) => stderr.push(t),
      failing,
    );
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
  });

  test("explains itself when no data directory is given", async () => {
    const { deps, stdout, stderr } = harness();
    const code = await runCli(["bun", "cli"], (t) => stdout.push(t), (t) => stderr.push(t), deps);
    expect(code).toBe(2);
    expect(stderr.join(" ")).toContain("Usage");
  });

  test("fails loudly when the API call fails", async () => {
    const { deps, files, stdout, stderr } = harness({
      fetchSnapshot: async () => {
        throw new Error("HTTP 403 Forbidden");
      },
    });
    const code = await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps);
    expect(code).toBe(1);
    expect(files.size).toBe(0);
    expect(stderr.join(" ")).toContain("403");
  });

  test("fails loudly when the fixture is absent", async () => {
    const { deps, stdout, stderr } = harness();
    const code = await runCli(
      ["bun", "cli", "--from-file", "missing.json", "data"],
      (t) => stdout.push(t),
      (t) => stderr.push(t),
      deps,
    );
    expect(code).toBe(1);
    expect(stderr.join(" ")).toContain("missing.json");
  });

  test("fails loudly when the fixture is not JSON", async () => {
    const { deps, files, stdout, stderr } = harness();
    files.set("broken.json", "{oh dear");
    const code = await runCli(
      ["bun", "cli", "--from-file", "broken.json", "data"],
      (t) => stdout.push(t),
      (t) => stderr.push(t),
      deps,
    );
    expect(code).toBe(1);
    expect(stderr.join(" ")).toContain("JSON");
  });

  test("fails loudly rather than writing a partial payload", async () => {
    const { deps, files, stdout, stderr } = harness({
      fetchSnapshot: async () => ({ ...RAW, views: { count: 1, uniques: 1 } }),
    });
    const code = await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps);
    expect(code).toBe(1);
    expect(files.size).toBe(0);
    expect(stderr.join(" ")).toContain("Refusing to write");
  });

  test("reports a thrown value that is not an Error", async () => {
    const { deps, stdout, stderr } = harness({
      fetchSnapshot: async () => {
        throw "a bare string";
      },
    });
    const code = await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps);
    expect(code).toBe(1);
    expect(stderr.join(" ")).toContain("a bare string");
  });

  test("--from-file with no path following it is treated as absent", async () => {
    const { deps, stdout, stderr } = harness();
    const code = await runCli(
      ["bun", "cli", "data", "--from-file"],
      (t) => stdout.push(t),
      (t) => stderr.push(t),
      deps,
    );
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
  });
});
