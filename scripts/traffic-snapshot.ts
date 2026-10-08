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
import { pathFailure, unexpectedKind } from "../skills/iso-24495-4/scripts/lib/failure.ts";
import { safeText } from "../skills/iso-24495-4/scripts/lib/safe-text.ts";

/**
 * Takes one traffic snapshot and merges it into the three CSV files.
 *
 *   bun scripts/traffic-snapshot-cli.ts <data-directory> [--dry-run] [--from-file <path>]
 *
 * `--dry-run` prints the three files and writes none. A referrer is a name
 * nobody has read, so each printed line has its control characters and marks
 * that reverse text direction made spaces. A written file keeps the name as
 * it arrived. `--from-file` reads the
 * four responses from a JSON file and leaves the network alone. Any other
 * argument is taken as the data directory, and the last one wins.
 *
 * Exit 0 means the files were written, or printed on a dry run. Exit 1 means
 * the API or the fixture could not be read, or the payload was malformed, and
 * no file was written. Exit 1 means the same where a table exists and cannot
 * be read: every table is read before any is written, so the history is left
 * as it was. A missed day can be fetched again, and a history written over
 * cannot. Exit 1 also means a file could not be written. The
 * files are written one after another, so those before it stay written, and
 * the reason names them. Exit 2 means no data directory was given.
 *
 * @param argv The whole command line, so the arguments start at index 2.
 * @param writeOut Receives the dry-run output and the closing summary line.
 * @param writeErr Receives the usage text or the reason for exit 1.
 * @param deps The network call, the file access and the clock. `readText`
 *     must return `null` for a file that does not exist, and throw for a file
 *     that exists and cannot be read, as `textIfPresent` does. Whatever `writeText`
 *     throws is caught and reported as exit 1, in this module's own words.
 */
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
      writeErr("Could not read the traffic API: " + describeApiFailure(error));
      return 1;
    }
  } else {
    let text: string | null;
    try {
      text = deps.readText(fromFile);
    } catch {
      text = null;
    }
    if (text === null) {
      writeErr(
        "Could not read the fixture: --from-file names a path of " +
          fromFile.length +
          " characters that is missing or unreadable",
      );
      return 1;
    }
    try {
      raw = JSON.parse(text);
    } catch {
      // JSON.parse throws for one reason only, and its message quotes the text.
      writeErr(
        "The fixture is not valid JSON: --from-file names a file of " +
          text.length +
          " characters that does not parse",
      );
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
  // Every table is read before any is written. A table that is not there is a first
  // snapshot. One that is there and cannot be read stops the run: built from nothing,
  // the new table would be written over the history the old one holds.
  const existing: Record<string, string | null> = {};
  for (const name of ["daily.csv", "windows.csv", "referrers.csv"]) {
    try {
      existing[name] = deps.readText(join(directory, name));
    } catch (error) {
      writeErr(
        "Could not read " +
          name +
          ": " +
          pathFailure(error, directory, "<data-directory>", "cannot be read") +
          ". No table was written, so the history is as it was.",
      );
      return 1;
    }
  }
  const files = [
    { name: "daily.csv", text: mergeDaily(existing["daily.csv"] ?? null, snapshot) },
    { name: "windows.csv", text: mergeWindows(existing["windows.csv"] ?? null, date, snapshot) },
    { name: "referrers.csv", text: mergeReferrers(existing["referrers.csv"] ?? null, date, snapshot) },
  ];
  const written: string[] = [];
  for (const file of files) {
    if (dryRun) {
      writeOut("--- " + file.name + " ---");
      writeOut(file.text.trimEnd().split("\n").map(safeText).join("\n"));
      continue;
    }
    try {
      deps.writeText(join(directory, file.name), file.text);
    } catch (error) {
      // The runtime names the whole path in its message, so the message is not
      // read. The file is named from the fixed list above.
      writeErr(
        "Could not write " +
          file.name +
          ": " +
          pathFailure(error, directory, "<data-directory>", "cannot be written to") +
          ". " +
          (written.length === 0 ? "No table was written." : "Already written: " + written.join(", ") + "."),
      );
      return 1;
    }
    written.push(file.name);
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

/**
 * The text a read gives, or null where the read found no file.
 *
 * "There is no such file" is the one failure that means a first snapshot. Every
 * other failure means a file is there and its history could not be read, and
 * the command must not then write over it.
 *
 * @param read Reads one file and throws as the file system throws.
 * @returns What `read` returned, or null when it threw an error whose code is
 *     ENOENT.
 * @throws Whatever else `read` threw, as it was thrown.
 */
export function textIfPresent(read: () => string): string | null {
  try {
    return read();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export interface Deps {
  /** The text of a file, null where there is no such file. Throws for a file that cannot be read. */
  readText(path: string): string | null;
  writeText(path: string, text: string): void;
  fetchSnapshot(): Promise<unknown>;
  today(): string;
}

/**
 * A traffic endpoint answered with a failing HTTP status. The CLI shim throws
 * it and `runCli` words it, so the wording is where the tests reach it.
 *
 * It carries the status as a number and never the status text, because the
 * text is whatever the server chose to send.
 */
export class EndpointFailure extends Error {
  constructor(
    /** The path requested, below the repository's API address. */
    readonly endpoint: string,
    readonly status: number,
  ) {
    super("A traffic endpoint returned a failing HTTP status");
    this.name = "EndpointFailure";
  }
}

const ENDPOINT_NAMES: ReadonlyMap<string, string> = new Map([
  ["/traffic/clones", "the clones endpoint"],
  ["/traffic/views", "the views endpoint"],
  ["/traffic/popular/referrers", "the referrers endpoint"],
  ["", "the repository endpoint"],
]);

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

/**
 * Turns the four raw API responses into one snapshot, or says why it will not.
 *
 * @param raw An object holding the parsed JSON of each endpoint under
 *     `clones`, `views`, `referrers` and `repo`, as `Deps.fetchSnapshot`
 *     returns it.
 * @returns The snapshot, with each daily timestamp cut to its date. A response
 *     that is missing or of the wrong shape gives `ok: false` and a problem
 *     naming the first such response; bad input is returned, never thrown.
 *     Empty daily lists and an empty referrer list are sound.
 */
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

/**
 * One value as a cell of a table, in quotes where `readRows` would otherwise read it
 * back as something else: a value holding a comma, a quote, a line break or a
 * carriage return, and one that opens or closes with white space, which the reader
 * trims from the ends of an unquoted row.
 */
function csvCell(value: string): string {
  const needsQuotes = value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")
    || value !== value.trim();
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

/**
 * The rows of a table without its header, each as its cells.
 *
 * A row ends at a line break that stands outside quotes. The table was once cut at
 * every line break before any quote was read. The writer puts a name holding a line
 * break in quotes, so on the next run that one row was read as two broken ones, and
 * the history kept them.
 *
 * White space at either end of a row is dropped, which takes the carriage return of
 * a Windows line ending, and a row left blank is passed over. `csvCell` quotes any
 * value that this would change.
 */
function readRows(existing: string | null): string[][] {
  const rows = rowTexts(existing ?? "")
    .map((row) => row.trim())
    .filter((row) => row !== "");
  return rows.slice(1).map(splitCsvLine);
}

/** The text of each row of a table, cut at each line break that is not inside quotes. */
function rowTexts(table: string): string[] {
  const rows: string[] = [];
  let quoted = false;
  let start = 0;
  for (let at = 0; at < table.length; at += 1) {
    // A quote written twice inside a quoted cell turns this off and on again.
    if (table[at] === '"') {
      quoted = !quoted;
    } else if (table[at] === "\n" && !quoted) {
      rows.push(table.slice(start, at));
      start = at + 1;
    }
  }
  rows.push(table.slice(start));
  return rows;
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

/**
 * The new text of daily.csv: the rows already kept, with one row for each day
 * the snapshot reports.
 *
 * A day in the snapshot replaces the row kept for that day, because the
 * figures for a day are still moving while it is in progress. Every other kept row
 * stays, which is how the series outlives the fourteen days GitHub holds.
 *
 * @param existing The file as it stands. `null` and an empty string both mean
 *     there is none yet. Its first line is taken to be the header and dropped
 *     unread, so text with no header loses its first row.
 * @param snapshot A day that has clones and no views gets zero views, and the
 *     reverse.
 * @returns The whole file: the header, then one row for each day in date
 *     order, ending with a line break. Only the header when there is nothing
 *     kept and the snapshot has no days. Nothing is written to disk.
 */
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

/**
 * The new text of windows.csv: the rows already kept, with one row holding the
 * rolling window totals read on `date`.
 *
 * These totals cannot be rebuilt from daily.csv, so each reading is kept. A
 * second reading on the same date replaces the first; a new date appends.
 *
 * @param existing The file as it stands. `null` and an empty string both mean
 *     there is none yet. Its first line is dropped unread, as a header.
 * @param date The day the snapshot was taken, as YYYY-MM-DD. It is the key.
 * @param snapshot The window length recorded is the number of daily clone
 *     points, whatever the views list holds.
 * @returns The whole file: the header, then one row for each date in date
 *     order, ending with a line break. Nothing is written to disk.
 */
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

/**
 * The new text of referrers.csv: the rows already kept, with one row for each
 * referrer the snapshot lists on `date`.
 *
 * The key is the date and the referrer together. A second reading on the same
 * date replaces the rows for referrers it still lists, and leaves in place a
 * referrer that the first reading listed and the second does not.
 *
 * @param existing The file as it stands. `null` and an empty string both mean
 *     there is none yet. Its first line is dropped unread, as a header.
 * @param date The day the snapshot was taken, as YYYY-MM-DD.
 * @returns The whole file: the header, then the rows ordered by date and
 *     referrer, ending with a line break. A snapshot with no referrers returns
 *     the kept rows alone. Nothing is written to disk.
 */
export function mergeReferrers(existing: string | null, date: string, snapshot: Snapshot): string {
  const rows = snapshot.referrers.map((entry) => [
    date,
    entry.referrer,
    String(entry.count),
    String(entry.uniques),
  ]);
  return writeRows(REFERRER_HEADER, [...readRows(existing), ...rows], 2);
}

// Why the traffic API could not be read, in fixed words. An endpoint is named
// from the list above, so a path this file does not know is never repeated.
function describeApiFailure(thrown: unknown): string {
  if (thrown instanceof EndpointFailure) {
    const endpoint = ENDPOINT_NAMES.get(thrown.endpoint) ?? "an endpoint";
    return endpoint + " returned HTTP " + thrown.status;
  }
  return "the request was stopped by " + unexpectedKind(thrown);
}
