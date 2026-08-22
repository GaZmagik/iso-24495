// Daily capture of this repository's GitHub traffic. GitHub keeps only the
// last fourteen days and then discards them, so a figure this file does not
// write down is gone for good.
//
// Two facts drive the design. First, the rolling window uniques cannot be
// rebuilt from the daily rows: on 2026-08-21 the daily uniques summed to 686
// while GitHub reported 587, because it de-duplicates a cloner who returns on
// another day. So the window figures are stored in their own file. Second, a
// partial write poisons the series invisibly, so a malformed payload stops the
// run instead of reaching disk.
//
// Every decision lives here, where the tests reach it. The CLI shim beside
// this file holds the network call and nothing else.

import { join } from "node:path";

export interface DailyPoint {
  timestamp: string;
  count: number;
  uniques: number;
}

export interface Series {
  count: number;
  uniques: number;
  days: DailyPoint[];
}

export interface Referrer {
  referrer: string;
  count: number;
  uniques: number;
}

export interface RepoCounts {
  stars: number;
  forks: number;
  watchers: number;
}

export interface Snapshot {
  clones: Series;
  views: Series;
  referrers: Referrer[];
  repo: RepoCounts;
}

export type ParseResult = { ok: true; snapshot: Snapshot } | { ok: false; problem: string };

export interface Deps {
  readText(path: string): string | null;
  writeText(path: string, text: string): void;
  fetchSnapshot(): Promise<unknown>;
  today(): string;
}

const DAILY_HEADER = ["date", "clones", "clone_uniques", "views", "view_uniques"];
const WINDOW_HEADER = [
  "snapshot_date",
  "window_days",
  "clones",
  "clone_uniques",
  "views",
  "view_uniques",
  "stars",
  "forks",
  "watchers",
];
const REFERRER_HEADER = ["snapshot_date", "referrer", "views", "uniques"];

const USAGE = [
  "Usage: bun scripts/traffic-snapshot-cli.ts <data-directory> [--dry-run] [--from-file <path>]",
  "",
  "Reads this repository's GitHub traffic and merges it into daily.csv,",
  "windows.csv and referrers.csv inside the data directory.",
].join("\n");

function asRecord(value: unknown): Record<string, unknown> | null {
  const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);
  return isRecord ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readSeries(raw: unknown, listKey: string): Series | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const count = asNumber(record.count);
  const uniques = asNumber(record.uniques);
  const list = record[listKey];
  if (count === null || uniques === null || !Array.isArray(list)) return null;
  const days: DailyPoint[] = [];
  for (const entry of list) {
    const point = asRecord(entry);
    if (point === null) return null;
    const stamp = typeof point.timestamp === "string" ? point.timestamp.slice(0, 10) : "";
    const dayCount = asNumber(point.count);
    const dayUniques = asNumber(point.uniques);
    if (stamp === "" || dayCount === null || dayUniques === null) return null;
    days.push({ timestamp: stamp, count: dayCount, uniques: dayUniques });
  }
  return { count, uniques, days };
}

function readReferrers(raw: unknown): Referrer[] | null {
  if (!Array.isArray(raw)) return null;
  const referrers: Referrer[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (record === null) return null;
    const count = asNumber(record.count);
    const uniques = asNumber(record.uniques);
    if (typeof record.referrer !== "string" || count === null || uniques === null) return null;
    referrers.push({ referrer: record.referrer, count, uniques });
  }
  return referrers;
}

function readRepo(raw: unknown): RepoCounts | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const stars = asNumber(record.stargazers_count);
  const forks = asNumber(record.forks_count);
  const watchers = asNumber(record.subscribers_count);
  if (stars === null || forks === null || watchers === null) return null;
  return { stars, forks, watchers };
}

// Turns the four raw API responses into one snapshot, or says why it will not.
export function parseSnapshot(raw: unknown): ParseResult {
  const record = asRecord(raw);
  if (record === null) return { ok: false, problem: "the traffic payload is not an object" };
  const clones = readSeries(record.clones, "clones");
  if (clones === null) {
    return { ok: false, problem: "the clones response is missing a count, a uniques figure or its daily list" };
  }
  const views = readSeries(record.views, "views");
  if (views === null) {
    return { ok: false, problem: "the views response is missing a count, a uniques figure or its daily list" };
  }
  const referrers = readReferrers(record.referrers);
  if (referrers === null) {
    return { ok: false, problem: "the referrers response is not a list of name, count and uniques records" };
  }
  const repo = readRepo(record.repo);
  if (repo === null) {
    return { ok: false, problem: "the repository response is missing its star, fork or watcher counts" };
  }
  return { ok: true, snapshot: { clones, views, referrers, repo } };
}

function csvCell(value: string): string {
  const needsQuotes = value.includes(",") || value.includes('"') || value.includes("\n");
  return needsQuotes ? '"' + value.replace(/"/g, '""') + '"' : value;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] as string;
    if (quoted && character === '"' && line[index + 1] === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell);
  return cells;
}

function readRows(existing: string | null): string[][] {
  const lines = (existing ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.slice(1).map(splitCsvLine);
}

// Writes the rows back with the newest reading for each key winning, because a
// day's figures are still moving while that day is in progress.
function writeRows(header: string[], rows: string[][], keyWidth: number): string {
  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    byKey.set(JSON.stringify(row.slice(0, keyWidth)), row);
  }
  const ordered = [...byKey.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map((entry) => entry[1]);
  return [header, ...ordered].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function mergeDaily(existing: string | null, snapshot: Snapshot): string {
  const byDate = new Map<string, string[]>();
  for (const point of snapshot.clones.days) {
    byDate.set(point.timestamp, [point.timestamp, String(point.count), String(point.uniques), "0", "0"]);
  }
  for (const point of snapshot.views.days) {
    const row = byDate.get(point.timestamp) ?? [point.timestamp, "0", "0", "0", "0"];
    row[3] = String(point.count);
    row[4] = String(point.uniques);
    byDate.set(point.timestamp, row);
  }
  return writeRows(DAILY_HEADER, [...readRows(existing), ...byDate.values()], 1);
}

export function mergeWindows(existing: string | null, date: string, snapshot: Snapshot): string {
  const row = [
    date,
    String(snapshot.clones.days.length),
    String(snapshot.clones.count),
    String(snapshot.clones.uniques),
    String(snapshot.views.count),
    String(snapshot.views.uniques),
    String(snapshot.repo.stars),
    String(snapshot.repo.forks),
    String(snapshot.repo.watchers),
  ];
  return writeRows(WINDOW_HEADER, [...readRows(existing), row], 1);
}

export function mergeReferrers(existing: string | null, date: string, snapshot: Snapshot): string {
  const rows = snapshot.referrers.map((entry) => [
    date,
    entry.referrer,
    String(entry.count),
    String(entry.uniques),
  ]);
  return writeRows(REFERRER_HEADER, [...readRows(existing), ...rows], 2);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCli(
  argv: string[],
  writeOut: (text: string) => void,
  writeErr: (text: string) => void,
  deps: Deps,
): Promise<number> {
  const args = argv.slice(2);
  let directory = "";
  let fromFile = "";
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--from-file") {
      fromFile = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    directory = arg;
  }
  if (directory === "") {
    writeErr(USAGE);
    return 2;
  }

  let raw: unknown;
  if (fromFile === "") {
    try {
      raw = await deps.fetchSnapshot();
    } catch (error) {
      writeErr("Could not read the traffic API: " + describe(error));
      return 1;
    }
  } else {
    const text = deps.readText(fromFile);
    if (text === null) {
      writeErr("Could not read the fixture at " + fromFile);
      return 1;
    }
    try {
      raw = JSON.parse(text);
    } catch (error) {
      writeErr("The fixture is not valid JSON: " + describe(error));
      return 1;
    }
  }

  const parsed = parseSnapshot(raw);
  if (!parsed.ok) {
    writeErr("Refusing to write: " + parsed.problem);
    return 1;
  }

  const snapshot = parsed.snapshot;
  const date = deps.today();
  const files = [
    { name: "daily.csv", text: mergeDaily(deps.readText(join(directory, "daily.csv")), snapshot) },
    { name: "windows.csv", text: mergeWindows(deps.readText(join(directory, "windows.csv")), date, snapshot) },
    {
      name: "referrers.csv",
      text: mergeReferrers(deps.readText(join(directory, "referrers.csv")), date, snapshot),
    },
  ];
  for (const file of files) {
    if (dryRun) {
      writeOut("--- " + file.name + " ---");
      writeOut(file.text.trimEnd());
      continue;
    }
    deps.writeText(join(directory, file.name), file.text);
  }
  writeOut(
    date +
      ": " +
      snapshot.clones.uniques +
      " unique cloners and " +
      snapshot.views.uniques +
      " unique visitors across the last " +
      snapshot.clones.days.length +
      " days",
  );
  return 0;
}
