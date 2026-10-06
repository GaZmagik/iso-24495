import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  EndpointFailure,
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
        throw new EndpointFailure("/traffic/clones", 403);
      },
    });
    const code = await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps);
    expect(code).toBe(1);
    expect(files.size).toBe(0);
    expect(stderr).toEqual(["Could not read the traffic API: the clones endpoint returned HTTP 403"]);
  });

  test("names each endpoint from a fixed list, and never repeats one it does not know", async () => {
    const said = async (endpoint: string, status: number): Promise<string[]> => {
      const { deps, stdout, stderr } = harness({
        fetchSnapshot: async () => {
          throw new EndpointFailure(endpoint, status);
        },
      });
      expect(await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps)).toBe(1);
      return stderr;
    };
    expect(await said("/traffic/views", 500)).toEqual([
      "Could not read the traffic API: the views endpoint returned HTTP 500",
    ]);
    expect(await said("/traffic/popular/referrers", 404)).toEqual([
      "Could not read the traffic API: the referrers endpoint returned HTTP 404",
    ]);
    expect(await said("", 401)).toEqual([
      "Could not read the traffic API: the repository endpoint returned HTTP 401",
    ]);
    expect(await said("/hunter2", 418)).toEqual([
      "Could not read the traffic API: an endpoint returned HTTP 418",
    ]);
  });

  // A failed request throws whatever the runtime chooses, and its message can
  // quote an address or a response body. Only the kind of failure is printed.
  test("says what kind of failure stopped a request, and never what it said", async () => {
    const { deps, files, stdout, stderr } = harness({
      fetchSnapshot: async () => {
        throw new TypeError("fetch failed for https://hunter2.invalid: Forbidden hunter2");
      },
    });
    const code = await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps);
    expect(code).toBe(1);
    expect(files.size).toBe(0);
    expect(stderr).toEqual([
      "Could not read the traffic API: the request was stopped by an unexpected TypeError",
    ]);
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
    // The path has just failed to read, so the message names the option it
    // came from and its length, never the path.
    expect(stderr).toEqual([
      "Could not read the fixture: --from-file names a path of 12 characters that is missing or unreadable",
    ]);
  });

  test("fails loudly when the fixture is not JSON", async () => {
    const { deps, files, stdout, stderr } = harness();
    files.set("broken.json", '{"clones": hunter2');
    const code = await runCli(
      ["bun", "cli", "--from-file", "broken.json", "data"],
      (t) => stdout.push(t),
      (t) => stderr.push(t),
      deps,
    );
    expect(code).toBe(1);
    // The parser's own message quotes the token it stopped on, so the message
    // gives the option the file came from and its length, never its text.
    expect(stderr).toEqual([
      "The fixture is not valid JSON: --from-file names a file of 18 characters that does not parse",
    ]);
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
    expect(stderr).toEqual([
      "Could not read the traffic API: the request was stopped by a thrown value of type string",
    ]);
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

describe("a dry run prints a referrer nobody has read", () => {
  // A referrer is whatever name GitHub or the fixture gives. A dry run prints
  // the tables to a terminal, so the name is cleaned there. The file is data
  // for the next run, so it keeps the name as it arrived.
  test.each([27, 0x9b, 0x202e])("character %i is printed as a space and written as it is", async (code) => {
    const character = String.fromCharCode(code);
    const referrer = `evil${character}[2J.example`;
    const raw = { ...RAW, referrers: [{ referrer, count: 3, uniques: 1 }] };
    const dry = harness({ fetchSnapshot: async () => raw });
    expect(await runCli(["bun", "cli", "--dry-run", "data"], (t) => dry.stdout.push(t), (t) => dry.stderr.push(t), dry.deps)).toBe(0);
    const printed = dry.stdout.join("\n");
    expect(printed).not.toContain(character);
    expect(printed).toContain("2026-08-22,evil [2J.example,3,1");
    expect(printed).toContain("--- referrers.csv ---\nsnapshot_date,referrer,views,uniques\n2026-08-22,evil [2J.example,3,1");
    expect(dry.files.size).toBe(0);

    const real = harness({ fetchSnapshot: async () => raw });
    expect(await runCli(["bun", "cli", "data"], (t) => real.stdout.push(t), (t) => real.stderr.push(t), real.deps)).toBe(0);
    expect(real.files.get(join("data", "referrers.csv"))).toContain(`2026-08-22,${referrer},3,1`);
  });
});

describe("a table that cannot be written", () => {
  // The write was not caught, so the command ended with the runtime's own
  // report, which names the whole path. The module now words the failure.
  test("a missing data directory is reported in fixed words, by the length of its path", async () => {
    const { deps, files, stdout, stderr } = harness({
      writeText: (path) => {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}' hunter2`), { code: "ENOENT" });
      },
    });
    const code = await runCli(["bun", "cli", "data/hunter2"], (t) => stdout.push(t), (t) => stderr.push(t), deps);
    expect(code).toBe(1);
    expect(files.size).toBe(0);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      "Could not write daily.csv: <data-directory> names a path of 12 characters that cannot be written to: "
        + "no such file or directory. No table was written.",
    ]);
  });

  test("a later failure says which tables were already written", async () => {
    const written: string[] = [];
    const { deps, stdout, stderr } = harness({
      writeText: (path) => {
        if (path.endsWith("referrers.csv")) throw new RangeError("hunter2");
        written.push(path);
      },
    });
    const code = await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps);
    expect(code).toBe(1);
    expect(written).toEqual([join("data", "daily.csv"), join("data", "windows.csv")]);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      "Could not write referrers.csv: stopped by an unexpected RangeError. "
        + "Already written: daily.csv, windows.csv.",
    ]);
  });

  test("the shipped command says the same, and never what the runtime said", () => {
    const root = join(import.meta.dir, "..", "..");
    const missing = join(import.meta.dir, "fixtures", "no-such-directory-hunter2", "x");
    const ran = Bun.spawnSync(
      ["bun", join(root, "scripts", "traffic-snapshot-cli.ts"), "--from-file",
        join(import.meta.dir, "fixtures", "traffic-sample.json"), missing],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    expect(ran.exitCode).toBe(1);
    expect(ran.stdout.toString()).toBe("");
    // Bun wraps what console.error prints in colour codes, so the line is
    // looked for, and the words of the runtime's own report are looked for too.
    const said = ran.stderr.toString();
    expect(said).toContain(
      `Could not write daily.csv: <data-directory> names a path of ${missing.length} characters that cannot be `
        + "written to: no such file or directory. No table was written.",
    );
    expect(said.trim().split("\n")).toHaveLength(1);
    for (const leaked of ["ENOENT", "hunter2", "syscall", "errno"]) expect(said).not.toContain(leaked);
  });
});
