/**
 * Count the prose in the six saved code-review replies.
 *
 * Run it from the repository root:
 *   bun measurements/count-review-replies.ts
 *
 * Every review count quoted in the article comes from this script's output. It exists because
 * an earlier version of that article published counts no script could reproduce.
 *
 * The method is the engine's own model of what a reader reads. `readerProseBlocks` returns the
 * blocks a person reads as prose. It drops fenced code, and it drops list and heading markers
 * rather than counting `-` and `##` as words, which a raw whitespace split does.
 *
 * Two earlier pins were defeated by review, so it is worth saying what this one does. The first
 * named a version rather than a file, and silently used an older checkout whose splitter this
 * release fixed. The second hashed one path and imported another, so altering the imported copy
 * left the hash passing. This version resolves one directory, hashes the engine files and the
 * replies, and only then imports from that same directory.
 *
 * It does not hash itself, and it cannot usefully: anybody who can edit this file can edit the
 * expected hashes beside it. Read it, or check it against the copy in the published history.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The engine that produced these figures, at tag v0.6.0. */
const ENGINE: Record<string, string> = {
  "parse.ts": "e33664bb35ba6f2822733fb7fcfaf331161820210f9a108fb7f121ae5b2a4903",
  "lexicon.ts": "775387bc90d83f37d8e32a1f6c37d335be894d60c4816ae16a315c2f5337a2a9",
  "types.ts": "dfe2787ff18237d92796b6e24d9b4677388160dfb5f7bcf3db1ae5233886098a",
};

/** The saved replies, so a changed input cannot pass as the measured one either. */
const REPLIES: Record<string, string> = {
  "control-1": "57702a99b9eb9c95707e61a83d8ffd2397096277c1f50be6bee1b5335541c8b2",
  "control-2": "3e5eb346892f8bdb878595c43f54547b66f2154b073eea26f36c9cf1eaff234c",
  "control-3": "5619b180d9e218cff1d117af4ca9492952c9d0b21d4b8b2c43d9c6f907570961",
  "style-1": "7476030bc76e66a7649a0f9818dcbdd2809b8c1cebc3a8e3c23f6cf6e3a95a2a",
  "style-2": "404e41f5b5e5fc9609317f1e15e1d668e7e4fb4ef305a0674d688d0f468f1438",
  "style-3": "eafa45f7dcc6b0fd17d6229fbbffa32957997cff67bd4ba2f88e5a0ed20a01b4",
};

const ARMS = ["control", "style"] as const;
const RUNS = [1, 2, 3];

const engineDirectory = new URL("../skills/iso-24495-4/scripts/lib/", import.meta.url);
const replyDirectory = new URL("./review-replies/", import.meta.url);

function sha256(path: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
}

function refuse(what: string, path: string, expected: string, found: string): never {
  throw new Error([
    `The ${what} is not the one these figures were measured with.`,
    `  file     ${path}`,
    `  expected ${expected}`,
    `  found    ${found}`,
    "Check out tag v0.6.0 and run this again.",
  ].join("\n"));
}

// Check the directory, then import the very files that were checked.
for (const [name, expected] of Object.entries(ENGINE)) {
  const path = fileURLToPath(new URL(name, engineDirectory));
  const found = sha256(path);
  if (found !== expected) refuse("engine", path, expected, found);
}

const { readerProseBlocks, splitSentences, wordCount } =
  await import(new URL("parse.ts", engineDirectory).href);

interface Counted {
  run: number;
  words: number;
  sentences: number;
  longest: number;
}

function countReply(text: string): Omit<Counted, "run"> {
  const lengths: number[] = [];
  for (const block of readerProseBlocks(text)) {
    for (const sentence of splitSentences(block.lines.join("\n"))) {
      const words = wordCount(sentence);
      if (words > 0) lengths.push(words);
    }
  }
  return {
    words: lengths.reduce((total, words) => total + words, 0),
    sentences: lengths.length,
    longest: Math.max(0, ...lengths),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2 === 1
    ? (sorted[Math.floor(middle)] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

const range = (values: number[]): string => `${Math.min(...values)} to ${Math.max(...values)}`;
const fall = (before: number, after: number): string =>
  `${Math.round(((before - after) / before) * 100)}%`;

const counted = new Map<string, Counted[]>();
for (const arm of ARMS) {
  counted.set(arm, RUNS.map((run) => {
    const name = `${arm}-${run}`;
    const path = fileURLToPath(new URL(`${name}/reply.md`, replyDirectory));
    const expected = REPLIES[name] as string;
    const found = sha256(path);
    if (expected === "PENDING") console.log(`  record this reply hash: ${name} ${found}`);
    else if (found !== expected) refuse("reply", path, expected, found);
    return { run, ...countReply(readFileSync(path, "utf8")) };
  }));
}

for (const arm of ARMS) {
  const rows = counted.get(arm) as Counted[];
  console.log(`\n${arm === "control" ? "STYLE OFF" : "STYLE ON"} (${arm})`);
  for (const row of rows) {
    console.log(`  run ${row.run}: ${row.words} words, ${row.sentences} sentences, longest ${row.longest}`);
  }
  for (const measure of ["words", "sentences"] as const) {
    const values = rows.map((row) => row[measure]);
    console.log(`  ${measure}: median ${median(values)}, range ${range(values)}`);
  }
}

const off = counted.get("control") as Counted[];
const on = counted.get("style") as Counted[];
console.log("\nFALL, MEDIAN TO MEDIAN");
for (const measure of ["words", "sentences"] as const) {
  const before = median(off.map((row) => row[measure]));
  const after = median(on.map((row) => row[measure]));
  console.log(`  ${measure}: ${before} to ${after}, a fall of ${fall(before, after)}`);
}
