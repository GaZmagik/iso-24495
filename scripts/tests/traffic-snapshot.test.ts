import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EndpointFailure,
  mergeDaily,
  mergeReferrers,
  mergeWindows,
  parseSnapshot,
  runCli,
  textIfPresent,
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

/** An error as the file system throws one, with a code and a message that quotes the path. */
function fileSystemError(code: string): Error {
  return Object.assign(new Error(`${code}: hunter2, open 'data/daily.csv'`), { code });
}

describe("a table that exists and cannot be read", () => {
  const HISTORY = "date,clones,unique_cloners,views,unique_visitors\n2026-01-01,1,1,1,1\n";

  // The command read every failure as "no such file" and built a fresh history from
  // nothing. A review held daily.csv open so that nobody else could read it: the
  // command exited 0, replaced the table, and a row from January was gone. A daily job
  // runs this, and a missed day can be fetched again where a lost history cannot.
  test.each(["daily.csv", "windows.csv", "referrers.csv"])("%s stops the run before anything is written", async (table) => {
    for (const mode of [[], ["--dry-run"]]) {
      const written: string[] = [];
      const read: string[] = [];
      const { deps, stdout, stderr } = harness({
        readText: (path) => {
          read.push(path);
          if (path === join("data", table)) throw fileSystemError("EBUSY");
          return HISTORY;
        },
        writeText: (path) => {
          written.push(path);
        },
      });
      const code = await runCli(["bun", "cli", "data", ...mode], (t) => stdout.push(t), (t) => stderr.push(t), deps);
      expect(code).toBe(1);
      expect(written).toEqual([]);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([
        `Could not read ${table}: <data-directory> names a path of 4 characters that cannot be read: `
          + "in use by another program. No table was written, so the history is as it was.",
      ]);
      expect(read.at(-1)).toBe(join("data", table));
    }
  });

  test("a failure nothing expected is reported by its kind, and stops the run as well", async () => {
    const written: string[] = [];
    const { deps, stdout, stderr } = harness({
      readText: () => {
        throw new RangeError("hunter2");
      },
      writeText: (path) => {
        written.push(path);
      },
    });
    expect(await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps)).toBe(1);
    expect(written).toEqual([]);
    expect(stderr).toEqual([
      "Could not read daily.csv: stopped by an unexpected RangeError. No table was written, so the history is as it was.",
    ]);
  });

  test("a table that can be read keeps every row it held", async () => {
    const { deps, files, stdout, stderr } = harness();
    // One run makes the three tables, with their own headers. An old row is then put
    // in each, and the next day's run must leave it there.
    expect(await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps)).toBe(0);
    const old: Record<string, string> = {
      "daily.csv": "2026-01-01,7,7,7,7",
      "windows.csv": rowsOf(files.get(join("data", "windows.csv")) as string)[1]?.replace("2026-08-22", "2026-01-01") as string,
      "referrers.csv": "2026-01-01,old.example,7,7",
    };
    for (const [name, row] of Object.entries(old)) {
      const path = join("data", name);
      const [header, ...rows] = rowsOf(files.get(path) as string);
      files.set(path, [header, row, ...rows].join("\n") + "\n");
    }
    deps.today = () => "2026-08-23";
    expect(await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps)).toBe(0);
    expect(stderr).toEqual([]);
    for (const [name, row] of Object.entries(old)) {
      expect(rowsOf(files.get(join("data", name)) as string), name).toContain(row);
    }
  });

  test("a table that is not there is still a first snapshot", async () => {
    const { deps, files, stdout, stderr } = harness();
    expect(await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps)).toBe(0);
    expect(stderr).toEqual([]);
    expect([...files.keys()]).toEqual([join("data", "daily.csv"), join("data", "windows.csv"), join("data", "referrers.csv")]);
  });

  test("a fixture that cannot be read is reported as before", async () => {
    const { deps, stdout, stderr } = harness({
      readText: () => {
        throw fileSystemError("EACCES");
      },
    });
    expect(await runCli(["bun", "cli", "data", "--from-file", "fixture.json"], (t) => stdout.push(t), (t) => stderr.push(t), deps)).toBe(1);
    expect(stderr).toEqual(["Could not read the fixture: --from-file names a path of 12 characters that is missing or unreadable"]);
  });
});

describe("textIfPresent", () => {
  test("gives the text of a file that is there, and null for one that is not", () => {
    expect(textIfPresent(() => "words")).toBe("words");
    expect(textIfPresent(() => "")).toBe("");
    expect(textIfPresent(() => {
      throw fileSystemError("ENOENT");
    })).toBeNull();
  });

  test("throws every other failure as it was thrown", () => {
    for (const code of ["EBUSY", "EACCES", "EPERM", "EISDIR", "ENOTDIR", "EIO"]) {
      const thrown = fileSystemError(code);
      expect(() => textIfPresent(() => {
        throw thrown;
      }), code).toThrow(thrown);
    }
    const odd = new RangeError("ENOENT");
    expect(() => textIfPresent(() => {
      throw odd;
    })).toThrow(odd);
    expect(() => textIfPresent(() => {
      throw "ENOENT";
    })).toThrow("ENOENT");
  });

  // The review's own case, with a real lock. Windows alone can refuse a reader this way.
  test("the shipped command leaves a table alone while another program holds it", async () => {
    if (process.platform !== "win32") return;
    const root = join(import.meta.dir, "..", "..");
    const directory = mkdtempSync(join(tmpdir(), "iso-traffic-locked-"));
    try {
      const daily = join(directory, "daily.csv");
      const history = "date,clones,unique_cloners,views,unique_visitors\n2026-01-01,1,1,1,1\n";
      writeFileSync(daily, history);
      const holder = Bun.spawn(
        ["powershell.exe", "-NoProfile", "-Command",
          "$ErrorActionPreference = 'Stop'; $h = [IO.File]::Open($env:LOCKED_FILE, 'Open', 'Read', 'None'); "
            + "Write-Output locked; Start-Sleep 60"],
        { stdout: "pipe", env: { ...process.env, LOCKED_FILE: daily } },
      );
      try {
        const { value } = await holder.stdout.getReader().read();
        expect(new TextDecoder().decode(value), "the lock must be held").toContain("locked");
        const ran = Bun.spawnSync(
          ["bun", join(root, "scripts", "traffic-snapshot-cli.ts"), "--from-file",
            join(import.meta.dir, "fixtures", "traffic-sample.json"), directory],
          { cwd: root, stdout: "pipe", stderr: "pipe" },
        );
        expect(ran.exitCode).toBe(1);
        expect(ran.stdout.toString()).toBe("");
        expect(ran.stderr.toString()).toContain(
          `Could not read daily.csv: <data-directory> names a path of ${directory.length} characters that cannot be read: `
            + "in use by another program. No table was written, so the history is as it was.",
        );
        expect(existsSync(join(directory, "windows.csv"))).toBe(false);
        expect(existsSync(join(directory, "referrers.csv"))).toBe(false);
      } finally {
        holder.kill();
        await holder.exited;
      }
      expect(readFileSync(daily, "utf8")).toBe(history);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("a table is read back as it was written", () => {
  const LINE_FEED = String.fromCharCode(10);
  const CARRIAGE_RETURN = String.fromCharCode(13);
  const QUOTE = String.fromCharCode(34);

  /** Every record of a table but its header, read by the rules the writer follows and by nothing of the module. */
  function records(table: string): string[][] {
    const rows: string[][] = [[""]];
    let quoted = false;
    for (let at = 0; at < table.length; at++) {
      const character = table[at] as string;
      const row = rows.at(-1) as string[];
      if (quoted && character === QUOTE && table[at + 1] === QUOTE) {
        row[row.length - 1] += QUOTE;
        at++;
      } else if (character === QUOTE) {
        quoted = !quoted;
      } else if (!quoted && character === ",") {
        row.push("");
      } else if (!quoted && character === LINE_FEED) {
        rows.push([""]);
      } else {
        row[row.length - 1] += character;
      }
    }
    expect(quoted, "every quote is closed").toBe(false);
    // The writer ends the table with a line break, so the last record is empty.
    expect(rows.pop()).toEqual([""]);
    return rows.slice(1);
  }

  /** A snapshot holding these referrers and nothing else worth reading. */
  function snapshotWith(referrers: string[]): Snapshot {
    return { ...snapshotOf(RAW), referrers: referrers.map((referrer, index) => ({ referrer, count: index + 7, uniques: index + 2 })) };
  }

  // The writer put a name holding a line break in quotes, as it should. The reader
  // cut the table into lines before it read the quotes, so on the next run that row
  // became two broken ones: "2000-01-01,first" and a stray "second,7,2".
  test("a referrer holding a line break is one row on the next run, and the run after", async () => {
    const name = `first${LINE_FEED}second`;
    const { deps, files, stdout, stderr } = harness({ fetchSnapshot: async () => ({ ...RAW, referrers: [{ referrer: name, count: 7, uniques: 2 }] }) });
    const table = (): string => files.get(join("data", "referrers.csv")) as string;
    deps.today = () => "2000-01-01";
    expect(await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps)).toBe(0);
    expect(records(table())).toEqual([["2000-01-01", name, "7", "2"]]);
    for (const [day, held] of [["2000-01-02", 2], ["2000-01-03", 3]] as Array<[string, number]>) {
      deps.today = () => day;
      expect(await runCli(["bun", "cli", "data"], (t) => stdout.push(t), (t) => stderr.push(t), deps)).toBe(0);
      const rows = records(table());
      expect(rows).toHaveLength(held);
      expect(rows[0]).toEqual(["2000-01-01", name, "7", "2"]);
      expect(rows.at(-1)).toEqual([day, name, "7", "2"]);
    }
    expect(stderr).toEqual([]);
  });

  test("generated names holding commas, quotes, line breaks and carriage returns come back equal across three runs", () => {
    const pieces = ["a", "b", "example.com", ",", QUOTE, QUOTE + QUOTE, LINE_FEED, CARRIAGE_RETURN, CARRIAGE_RETURN + LINE_FEED, " ",
      LINE_FEED + LINE_FEED, String.fromCharCode(9)];
    const random = sequence(24495);
    const name = (): string => {
      let made = "";
      const length = Math.floor(random() * 6);
      for (let piece = 0; piece < length; piece++) {
        made += pieces[Math.floor(random() * pieces.length)] as string;
      }
      return made;
    };
    let compared = 0;
    for (let trial = 0; trial < 300; trial++) {
      const expected: string[][] = [];
      let table: string | null = null;
      for (const date of ["2000-01-01", "2000-01-02", "2000-01-03"]) {
        const names = [...new Set(Array.from({ length: 1 + Math.floor(random() * 4) }, name))];
        table = mergeReferrers(table, date, snapshotWith(names));
        names.forEach((referrer, index) => expected.push([date, referrer, String(index + 7), String(index + 2)]));
        // Every row written so far, on this run and on each one before it.
        const read = records(table);
        const key = (row: string[]): string => JSON.stringify(row);
        if (JSON.stringify(read.map(key).sort()) !== JSON.stringify(expected.map(key).sort())) {
          expect(read.map(key).sort()).toEqual(expected.map(key).sort());
        }
        compared += expected.length;
      }
      // A run that adds nothing writes the same table again.
      expect(mergeReferrers(table, "2000-01-03", snapshotWith([]))).toBe(table as string);
    }
    expect(compared).toBeGreaterThan(3_000);
  });

  test("the other two tables keep a row whose key holds a line break", () => {
    const odd = `2000-01-01${LINE_FEED}x, ${QUOTE}y${QUOTE}${CARRIAGE_RETURN}`;
    const base = snapshotOf(RAW);
    const first: Snapshot = { ...base, clones: { ...base.clones, days: [{ timestamp: odd, count: 5, uniques: 3 }] }, views: { ...base.views, days: [] } };
    let daily = mergeDaily(null, first);
    expect(records(daily)).toEqual([[odd, "5", "3", "0", "0"]]);
    for (let run = 0; run < 2; run++) {
      daily = mergeDaily(daily, base);
    }
    expect(records(daily)).toContainEqual([odd, "5", "3", "0", "0"]);
    expect(records(daily)).toHaveLength(3);

    let windows = mergeWindows(null, odd, base);
    const held = records(windows)[0] as string[];
    expect(held[0]).toBe(odd);
    for (const date of ["2000-01-02", "2000-01-03"]) {
      windows = mergeWindows(windows, date, base);
    }
    expect(records(windows)).toContainEqual(held);
    expect(records(windows)).toHaveLength(3);
  });

  test("a value the reader would change is written in quotes", () => {
    const base = snapshotOf(RAW);
    // White space at the end of a row is dropped when the row is read, so a first or
    // last cell that opens or closes with it is quoted.
    for (const key of ["2000-01-01 ", " 2000-01-01", `2000-01-01${CARRIAGE_RETURN}`, `${String.fromCharCode(9)}2000-01-01`]) {
      let windows = mergeWindows(null, key, base);
      expect(windows.split(LINE_FEED)[1]).toStartWith(`${QUOTE}${key}${QUOTE},`);
      windows = mergeWindows(windows, "2000-01-02", base);
      expect(records(windows).map((row) => row[0])).toEqual([key, "2000-01-02"].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
    }
    // A carriage return inside a name is quoted too, as other readers of these tables expect.
    const inside = `a${CARRIAGE_RETURN}b`;
    expect(mergeReferrers(null, "2000-01-01", snapshotWith([inside])).split(LINE_FEED)[1]).toBe(`2000-01-01,${QUOTE}${inside}${QUOTE},7,2`);
    expect(mergeReferrers(null, "2000-01-01", snapshotWith(["plain.example"])).split(LINE_FEED)[1]).toBe("2000-01-01,plain.example,7,2");
  });

  test("a table with no line break after its last row keeps that row", () => {
    const kept = ["snapshot_date,referrer,views,uniques", "2000-01-01,a.example,1,1", "2000-01-01,b.example,2,2"].join(LINE_FEED);
    expect(records(mergeReferrers(kept, "2000-01-02", snapshotWith([])))).toEqual([
      ["2000-01-01", "a.example", "1", "1"],
      ["2000-01-01", "b.example", "2", "2"],
    ]);
  });

  test("a table as it is in the repository today reads as it did", () => {
    // Windows line endings, a blank line and a space after the last cell, as a hand
    // edit leaves them.
    const kept = ["snapshot_date,referrer,views,uniques", "2000-01-01,a.example,1,1 ", "", "2000-01-01,b.example,2,2", ""].join(CARRIAGE_RETURN + LINE_FEED);
    expect(records(mergeReferrers(kept, "2000-01-02", snapshotWith([])))).toEqual([
      ["2000-01-01", "a.example", "1", "1"],
      ["2000-01-01", "b.example", "2", "2"],
    ]);
  });
});

/** A fixed sequence of numbers from 0 up to 1, the same for the same seed on every run. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
