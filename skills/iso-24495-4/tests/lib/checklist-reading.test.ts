import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli as runDesignCli } from "../../../iso-24495-design-audit/scripts/design-audit.ts";
import { runCli as runTextCli } from "../../../iso-24495-text-audit/scripts/audit-text.ts";
import { DISCLOSURE_VERSION, formatPlan, selectDocuments, type AuditDependencies, type AuditLog } from "../../scripts/lib/jev/audit.ts";
import { MODEL } from "../../scripts/lib/jev/catalogue.ts";
import { CHECKLIST, type ChecklistItem, type Clause, type ClauseState, type Need } from "../../scripts/lib/checklist.ts";
import { checklistReading, formatChecklistReading, type ChecklistReading, type RunFacts } from "../../scripts/lib/checklist-reading.ts";

/** A plain text audit of one Markdown file: no Jev option, no send. */
const PLAIN_MARKDOWN: RunFacts = { mode: "text", files: 1, markdownFiles: 1, refused: 0, frontMatter: true, jevPreview: false, jev: false, send: false, before: false, facts: [] };

/** Every key a run fact may have. The function reads these and nothing else. */
const RUN_FACT_KEYS = ["mode", "files", "markdownFiles", "refused", "frontMatter", "jevPreview", "jev", "send", "before", "facts"];

/** The fault clauses of today's registry that need nothing, in order. */
const NEED_NOTHING = ["1a", "6a", "12a", "12b", "12c", "13b", "19b", "25a"];

/** The fault clauses of today's registry that need a Markdown file alone, in order. */
const NEED_MARKDOWN = ["3a", "3b", "4a", "8a", "8c", "9b", "15f", "17a", "19d"];

/** The fault clauses of today's registry that need the original version, each unmet as no option but --before meets it. */
const BEFORE_UNMET: Array<[string, readonly Need[]]> = [["20a", ["before"]], ["20b", ["before"]], ["21a", ["before"]], ["21b", ["before"]], ["22a", ["before"]], ["23a", ["before"]], ["23b", ["before"]]];

/** The same clauses as the --json report lists them when they are not used. */
const BEFORE_NOT_USED = [{ clause: "20a", needs: ["before"] }, { clause: "20b", needs: ["before"] }, { clause: "21a", needs: ["before"] }, { clause: "21b", needs: ["before"] }, { clause: "22a", needs: ["before"] }, { clause: "23a", needs: ["before"] }, { clause: "23b", needs: ["before"] }];

/**
 * True only when `checklistReading` takes exactly two parameters, the second
 * of them `RunFacts`. An extra parameter, optional or not, makes it false,
 * and the type check then fails the test that assigns true to it.
 */
type TakesExactlyTwo = Parameters<typeof checklistReading>["length"] extends 2
  ? [RunFacts] extends [Parameters<typeof checklistReading>[1]] ? true : false
  : false;

/** The keys of the run facts that `recordRead` has seen read. */
const KEYS_READ = new Set<string | symbol>();

/** A proxy's read of one key: it records the key in `KEYS_READ`, and reads it. */
function recordRead(target: object, key: string | symbol, receiver: unknown): unknown {
  KEYS_READ.add(key);
  return Reflect.get(target, key, receiver);
}

/**
 * A registry of one item holding the given clauses. Each clause is a demand
 * the test names, in the state and with the needs it is given.
 */
function registry(clauses: ReadonlyArray<{ state: ClauseState; needs?: readonly Need[] }>): ChecklistItem[] {
  return [{ item: 1, line: "- [ ] **Probe:** A line?", clauses: clauses.map(clauseOf) }];
}

/** One clause of `registry`, with an id from its position. */
function clauseOf(clause: { state: ClauseState; needs?: readonly Need[] }, index: number): Clause {
  return { id: `1${String.fromCharCode(97 + index)}`, demand: "A demand.", state: clause.state, checks: [], needs: clause.needs ?? [], limits: [] };
}

/** The run facts of a plain Markdown text audit, with the named facts changed. */
function run(changes: Partial<RunFacts>): RunFacts {
  return { ...PLAIN_MARKDOWN, ...changes };
}

/** The printed reading of a registry against one run's facts. */
function formatted(checklist: readonly ChecklistItem[], facts: RunFacts): string {
  return formatChecklistReading(checklistReading(checklist, facts), checklist);
}

/** The ids a reading did not use, each with the needs it names as unmet. */
function unmet(facts: RunFacts): Array<[string, readonly Need[]]> {
  return checklistReading(CHECKLIST, facts).run.notUsed.map(entry => [entry.clause, entry.needs]);
}

describe("the tool reading counts every clause of the registry", () => {
  test("today's registry has 64 clauses, 27 of them in the fault state, read as 0.42", () => {
    const reading = checklistReading(CHECKLIST, PLAIN_MARKDOWN);
    expect(reading.clauses).toBe(64);
    expect(reading.reading).toBe("0.42");
    expect(reading.tool).toEqual({ fault: 27, passOnly: 1, needsTwoVersions: 7, notCheckable: 1, notRead: 28 });
  });

  test("the tool reading is the same whatever the run", () => {
    const first = checklistReading(CHECKLIST, PLAIN_MARKDOWN);
    for (const mode of ["text", "design"] as const) {
      for (const flags of Array.from({ length: 128 }).keys()) {
        const facts: RunFacts = {
          mode, files: 2, markdownFiles: flags & 1, refused: (flags & 64) > 0 ? 1 : 0, frontMatter: (flags & 32) > 0,
          jevPreview: (flags & 2) > 0, jev: (flags & 4) > 0, send: (flags & 8) > 0, before: (flags & 16) > 0, facts: ["any"],
        };
        const reading = checklistReading(CHECKLIST, facts);
        expect([reading.clauses, reading.reading, reading.tool]).toEqual([first.clauses, first.reading, first.tool]);
        expect(reading.run.used.length + reading.run.notUsed.length).toBe(27);
      }
    }
  });

  test("the reading is rounded to two decimals, a half rounding up", () => {
    expect(checklistReading(registry([{ state: "fault" }, ...Array.from({ length: 7 }, () => ({ state: "not-read" as const }))]), PLAIN_MARKDOWN).reading).toBe("0.13");
    expect(checklistReading(registry([{ state: "fault" }, { state: "fault" }, { state: "not-read" }]), PLAIN_MARKDOWN).reading).toBe("0.67");
    expect(checklistReading(registry([{ state: "fault" }, { state: "not-read" }, { state: "not-read" }]), PLAIN_MARKDOWN).reading).toBe("0.33");
    expect(checklistReading(registry([{ state: "fault" }]), PLAIN_MARKDOWN).reading).toBe("1.00");
    expect(checklistReading(registry([{ state: "not-read" }]), PLAIN_MARKDOWN).reading).toBe("0.00");
  });

  test("each state is counted on its own", () => {
    const reading = checklistReading(registry([
      { state: "fault" }, { state: "pass-only" }, { state: "pass-only" }, { state: "needs-two-versions" },
      { state: "needs-two-versions" }, { state: "needs-two-versions" }, { state: "not-checkable" }, { state: "not-read" },
    ]), PLAIN_MARKDOWN);
    expect(reading.clauses).toBe(8);
    expect(reading.tool).toEqual({ fault: 1, passOnly: 2, needsTwoVersions: 3, notCheckable: 1, notRead: 1 });
  });

  test("a registry with no clause has no reading", () => {
    expect(() => checklistReading([], PLAIN_MARKDOWN)).toThrow(RangeError);
  });
});

describe("the this-run reading uses the fault clauses whose needs the run meets", () => {
  test("a plain text audit of a Markdown file uses 17, and leaves the title and purpose to the Jev route", () => {
    const reading = checklistReading(CHECKLIST, PLAIN_MARKDOWN);
    expect(reading.run.used).toEqual(["1a", "3a", "3b", "4a", "6a", "8a", "8c", "9b", "12a", "12b", "12c", "13b", "15f", "17a", "19b", "19d", "25a"]);
    expect(unmet(PLAIN_MARKDOWN)).toEqual([["15a", ["jev-route"]], ["15c", ["jev-route", "send"]], ["15d", ["jev-route", "send"]], ...BEFORE_UNMET]);
  });

  test("a .txt file meets no Markdown need", () => {
    const facts = run({ markdownFiles: 0 });
    expect(checklistReading(CHECKLIST, facts).run.used).toEqual(NEED_NOTHING);
    expect(unmet(facts)).toEqual([
      ["3a", ["markdown"]], ["3b", ["markdown"]], ["4a", ["markdown"]], ["8a", ["markdown"]], ["8c", ["markdown"]], ["9b", ["markdown"]], ["15a", ["markdown", "jev-route"]],
      ["15c", ["markdown", "jev-route", "send"]], ["15d", ["markdown", "jev-route", "send"]], ["15f", ["markdown"]], ["17a", ["markdown"]], ["19d", ["markdown"]], ...BEFORE_UNMET,
    ]);
  });

  test("the text audit meets the Jev route with --jev-preview, or with --jev and --send together", () => {
    expect(unmet(run({ jevPreview: true }))).toEqual([["15c", ["send"]], ["15d", ["send"]], ...BEFORE_UNMET]);
    expect(unmet(run({ jev: true, send: true }))).toEqual(BEFORE_UNMET);
    expect(unmet(run({ jev: true }))).toEqual([["15a", ["jev-route"]], ["15c", ["jev-route", "send"]], ["15d", ["jev-route", "send"]], ...BEFORE_UNMET]);
  });

  test("the text audit meets no send with --send alone, or with --send beside --jev-preview", () => {
    expect(unmet(run({ send: true }))).toEqual([["15a", ["jev-route"]], ["15c", ["jev-route", "send"]], ["15d", ["jev-route", "send"]], ...BEFORE_UNMET]);
    expect(unmet(run({ jevPreview: true, send: true }))).toEqual([["15c", ["send"]], ["15d", ["send"]], ...BEFORE_UNMET]);
  });

  test("the design audit always meets the Jev route, and meets a send with --send", () => {
    expect(unmet(run({ mode: "design" }))).toEqual([["15c", ["send"]], ["15d", ["send"]], ...BEFORE_UNMET]);
    expect(unmet(run({ mode: "design", send: true }))).toEqual(BEFORE_UNMET);
    expect(checklistReading(CHECKLIST, run({ mode: "design", send: true })).run.used)
      .toEqual(["1a", "3a", "3b", "4a", "6a", "8a", "8c", "9b", "12a", "12b", "12c", "13b", "15a", "15c", "15d", "15f", "17a", "19b", "19d", "25a"]);
  });

  test("the plain text audit given --before uses the seven clauses that need the original version", () => {
    const reading = checklistReading(CHECKLIST, run({ before: true }));
    expect(reading.run.used).toEqual(["1a", "3a", "3b", "4a", "6a", "8a", "8c", "9b", "12a", "12b", "12c", "13b", "15f", "17a", "19b", "19d", "20a", "20b", "21a", "21b", "22a", "23a", "23b", "25a"]);
    expect(unmet(run({ before: true }))).toEqual([["15a", ["jev-route"]], ["15c", ["jev-route", "send"]], ["15d", ["jev-route", "send"]]]);
    expect(formatted(CHECKLIST, run({ before: true })).split("\n")[1]).toBe("This run was set to use 24 of the 27. 1 needs the Jev route. 2 need the Jev route and --send.");
    expect(checklistReading(CHECKLIST, run({ before: true, markdownFiles: 0 })).run.used).toEqual(["1a", "6a", "12a", "12b", "12c", "13b", "19b", "20a", "20b", "21a", "21b", "22a", "23a", "23b", "25a"]);
  });

  test("a clause that needs the original version is met only by --before", () => {
    const probe = registry([{ state: "fault", needs: ["before"] }]);
    expect(checklistReading(probe, PLAIN_MARKDOWN).run).toEqual({ used: [], notUsed: [{ clause: "1a", needs: ["before"] }], filesNotReached: 0, documentsNotSent: 0 });
    expect(checklistReading(probe, run({ before: true })).run).toEqual({ used: ["1a"], notUsed: [], filesNotReached: 0, documentsNotSent: 0 });
  });

  test("a clause that needs a declared fact is met only when that fact exists", () => {
    const probe = registry([{ state: "fault", needs: ["fact:audience"] }]);
    expect(checklistReading(probe, run({ facts: ["date"] })).run).toEqual({ used: [], notUsed: [{ clause: "1a", needs: ["fact:audience"] }], filesNotReached: 0, documentsNotSent: 0 });
    expect(checklistReading(probe, run({ facts: ["date", "audience"] })).run).toEqual({ used: ["1a"], notUsed: [], filesNotReached: 0, documentsNotSent: 0 });
  });

  test("a clause in another state is neither used nor listed as not used, whatever its needs", () => {
    const probe = registry([{ state: "pass-only", needs: ["send"] }, { state: "not-read" }, { state: "fault" }]);
    expect(checklistReading(probe, PLAIN_MARKDOWN).run).toEqual({ used: ["1c"], notUsed: [], filesNotReached: 0, documentsNotSent: 0 });
  });
});

describe("front matter read as text, a mixed selection and a refused document each change line 2", () => {
  test("front matter read as text leaves the version or date clause unused", () => {
    expect(unmet(run({ frontMatter: false }))).toEqual([
      ["15a", ["jev-route"]], ["15c", ["jev-route", "send"]], ["15d", ["jev-route", "send"]], ["15f", ["front-matter"]], ...BEFORE_UNMET,
    ]);
    expect(unmet(run({ frontMatter: false, markdownFiles: 0 })).find(entry => entry[0] === "15f")).toEqual(["15f", ["markdown", "front-matter"]]);
    expect(formatted(CHECKLIST, run({ frontMatter: false })).split("\n")[1])
      .toBe("This run was set to use 16 of the 27. 1 needs the Jev route. 2 need the Jev route and --send. 1 needs front matter to be read. 7 need the original version.");
  });

  test("a selection of Markdown and other files names the files the Markdown clauses do not reach", () => {
    const mixed = checklistReading(CHECKLIST, run({ files: 3, markdownFiles: 1 }));
    expect(mixed.run.filesNotReached).toBe(2);
    expect(mixed.run.used).toEqual(checklistReading(CHECKLIST, PLAIN_MARKDOWN).run.used);
    expect(formatChecklistReading(mixed, CHECKLIST).split("\n")[1])
      .toBe("This run was set to use 17 of the 27. 1 needs the Jev route. 2 need the Jev route and --send. 7 need the original version. 2 selected files are not Markdown, so the 9 that need a Markdown file do not reach them.");
    expect(formatted(CHECKLIST, run({ mode: "design", send: true, files: 2, markdownFiles: 1 })).split("\n")[1])
      .toBe("This run was set to use 20 of the 27. 7 need the original version. 1 selected file is not Markdown, so the 12 that need a Markdown file do not reach it.");
  });

  test("a selection with no Markdown file, or no file, adds no sentence about the files not reached", () => {
    const text = checklistReading(CHECKLIST, run({ files: 2, markdownFiles: 0 }));
    expect(text.run.filesNotReached).toBe(2);
    expect(formatChecklistReading(text, CHECKLIST).split("\n")[1]).toBe(formatted(CHECKLIST, run({ markdownFiles: 0 })).split("\n")[1]);
    const empty = checklistReading(CHECKLIST, run({ files: 0, markdownFiles: 0 }));
    expect([empty.run.filesNotReached, empty.run.documentsNotSent]).toEqual([0, 0]);
    expect(formatChecklistReading(empty, CHECKLIST).split("\n")[1]).toBe(formatChecklistReading(text, CHECKLIST).split("\n")[1]);
  });

  test("a refused document names the files the Jev route clauses do not reach, and never says all", () => {
    const preview = checklistReading(CHECKLIST, run({ mode: "design", refused: 1 }));
    expect(preview.run.documentsNotSent).toBe(1);
    expect(formatChecklistReading(preview, CHECKLIST).split("\n")[1])
      .toBe("This run was set to use 18 of the 27. 2 need --send. 7 need the original version. 1 selected file is not sent because of its front matter, so the 1 that needs the Jev route does not reach it.");
    expect(formatted(CHECKLIST, run({ mode: "design", send: true, files: 2, markdownFiles: 2, refused: 2 })).split("\n")[1])
      .toBe("This run was set to use 20 of the 27. 7 need the original version. 2 selected files are not sent because of their front matter, so the 3 that need the Jev route do not reach them.");
  });

  test("a refused document beside a .txt file in a text Jev run names both", () => {
    expect(formatted(CHECKLIST, run({ jev: true, send: true, files: 3, markdownFiles: 2, refused: 1 })).split("\n")[1])
      .toBe("This run was set to use 20 of the 27. 7 need the original version. 1 selected file is not Markdown, so the 12 that need a Markdown file do not reach it. "
        + "1 selected file is not sent because of its front matter, so the 3 that need the Jev route do not reach it.");
  });

  test("no sentence names files that no used clause would reach", () => {
    const probe = registry([{ state: "fault" }, { state: "fault", needs: ["send"] }]);
    const reading = checklistReading(probe, run({ files: 3, markdownFiles: 1, refused: 1 }));
    expect([reading.run.filesNotReached, reading.run.documentsNotSent]).toEqual([2, 1]);
    expect(formatChecklistReading(reading, probe).split("\n")[1]).toBe("This run was set to use 1 of the 2. 1 needs --send.");
    expect(formatted(registry([{ state: "fault" }]), run({ files: 3, markdownFiles: 1, refused: 1 })).split("\n")[1])
      .toBe("This run was set to use all 1.");
  });
});

describe("the function reads the registry and the run facts, and nothing else", () => {
  // A report, a Jev verdict or any answer has no way in: the function takes two
  // arguments, and reads only the named keys of the second.
  test("it takes two arguments", () => {
    expect(checklistReading.length).toBe(2);
    // A third parameter with a default leaves the length at 2, so the type check holds the count too.
    const takesTwo: TakesExactlyTwo = true;
    expect(takesTwo).toBe(true);
  });

  test("it reads no key of the run facts but the ten named", () => {
    KEYS_READ.clear();
    const withVerdict = { ...PLAIN_MARKDOWN, verdict: "fail", results: [] };
    const watched = new Proxy<RunFacts>(withVerdict, { get: recordRead });
    const reading = checklistReading(CHECKLIST, watched);
    expect([...KEYS_READ].every(key => RUN_FACT_KEYS.includes(String(key)))).toBe(true);
    expect(KEYS_READ.has("markdownFiles")).toBe(true);
    expect(reading).toEqual(checklistReading(CHECKLIST, PLAIN_MARKDOWN));
  });

  test("it changes neither the registry nor the run facts", () => {
    const facts = run({ facts: ["a"] });
    const before = JSON.stringify([CHECKLIST, facts]);
    checklistReading(CHECKLIST, facts);
    expect(JSON.stringify([CHECKLIST, facts])).toBe(before);
  });
});

describe("the printed reading is four lines in plain words", () => {
  test("a plain text audit of a Markdown file", () => {
    expect(formatted(CHECKLIST, PLAIN_MARKDOWN).split("\n")).toEqual([
      "Part 5 checklist reading: checks can report a fault on 27 of 64 clauses (0.42), each within recorded limits.",
      "This run was set to use 17 of the 27. 1 needs the Jev route. 2 need the Jev route and --send. 7 need the original version.",
      "Of the other 37 clauses: 1 can only pass, 7 need the original version and have no check yet, 1 is a judgement, 28 are not read.",
      "This reading shows what the audit reads. It does not measure the document.",
    ]);
  });

  test("a run that uses every fault clause says so", () => {
    expect(formatted(CHECKLIST, run({ mode: "design", send: true })).split("\n")[1])
      .toBe("This run was set to use 20 of the 27. 7 need the original version.");
  });

  test("unused clauses are grouped by what they still need, in the order they first appear", () => {
    expect(formatted(CHECKLIST, run({ markdownFiles: 0 })).split("\n")[1])
      .toBe("This run was set to use 8 of the 27. 9 need a Markdown file. 1 needs a Markdown file and the Jev route. 2 need a Markdown file, the Jev route and --send. 7 need the original version.");
    const probe = registry([{ state: "fault", needs: ["fact:audience", "before"] }, { state: "fault", needs: ["before"] }, { state: "fault", needs: ["before"] }]);
    expect(formatted(probe, PLAIN_MARKDOWN).split("\n")[1])
      .toBe("This run was set to use 0 of the 3. 1 needs the declared fact audience and the original version. 2 need the original version.");
  });

  test("a count of one takes the singular in every phrase", () => {
    const probe = registry([{ state: "fault" }, { state: "pass-only" }, { state: "needs-two-versions" }, { state: "not-checkable" }, { state: "not-read" }]);
    const reading = checklistReading(probe, PLAIN_MARKDOWN);
    expect(formatChecklistReading(reading, probe).split("\n")).toEqual([
      "Part 5 checklist reading: checks can report a fault on 1 of 5 clauses (0.20), each within recorded limits.",
      "This run was set to use all 1.",
      "Of the other 4 clauses: 1 can only pass, 1 needs the original version and has no check yet, 1 is a judgement, 1 is not read.",
      "This reading shows what the audit reads. It does not measure the document.",
    ]);
  });

  test("a count other than one takes the plural in every phrase", () => {
    const probe = registry([
      { state: "pass-only" }, { state: "pass-only" }, { state: "needs-two-versions" }, { state: "needs-two-versions" },
      { state: "not-checkable" }, { state: "not-checkable" }, { state: "not-read" }, { state: "not-read" },
    ]);
    const reading = checklistReading(probe, PLAIN_MARKDOWN);
    expect(formatChecklistReading(reading, probe).split("\n").slice(0, 3)).toEqual([
      "Part 5 checklist reading: checks can report a fault on 0 of 8 clauses (0.00), each within recorded limits.",
      "This run was set to use all 0.",
      "Of the other 8 clauses: 2 can only pass, 2 need the original version and have no check yet, 2 are judgements, 2 are not read.",
    ]);
  });

  test("a registry of one clause is named in the singular", () => {
    expect(formatted(registry([{ state: "not-read" }]), PLAIN_MARKDOWN).split("\n").slice(0, 3)).toEqual([
      "Part 5 checklist reading: checks can report a fault on 0 of 1 clause (0.00), each within recorded limits.",
      "This run was set to use all 0.",
      "Of the other 1 clause: 0 can only pass, 0 need the original version and have no check yet, 0 are judgements, 1 is not read.",
    ]);
  });

  test("every sentence printed for today's registry is under 30 words", () => {
    for (const facts of [
      PLAIN_MARKDOWN, run({ markdownFiles: 0 }), run({ jevPreview: true }), run({ mode: "design" }), run({ mode: "design", send: true }),
      run({ frontMatter: false, markdownFiles: 0 }), run({ jev: true, send: true, files: 3, markdownFiles: 2, refused: 1 }),
      run({ mode: "design", files: 2, markdownFiles: 2, refused: 2 }),
    ]) {
      for (const sentence of formatted(CHECKLIST, facts).split(/(?<=\.)\s+|\n/)) {
        expect(sentence.split(/\s+/).filter(word => word.length > 0).length).toBeLessThan(30);
      }
    }
  });

  test("the printed reading holds no clause id", () => {
    const text = formatted(CHECKLIST, run({ markdownFiles: 0 }));
    for (const id of [...NEED_NOTHING, ...NEED_MARKDOWN, "15a", "15c", "15d"]) {
      expect(text).not.toContain(id);
    }
  });
});

// The tests below run both audits as a user would, with a stand-in for the
// transport, and pin what they print with literal lines.

const LINE_1 = "Part 5 checklist reading: checks can report a fault on 27 of 64 clauses (0.42), each within recorded limits.";
const LINE_3 = "Of the other 37 clauses: 1 can only pass, 7 need the original version and have no check yet, 1 is a judgement, 28 are not read.";
const LINE_4 = "This reading shows what the audit reads. It does not measure the document.";
const PLAIN_LINE_2 = "This run was set to use 17 of the 27. 1 needs the Jev route. 2 need the Jev route and --send. 7 need the original version.";
const PREVIEW_LINE_2 = "This run was set to use 18 of the 27. 2 need --send. 7 need the original version.";
const SEND_LINE_2 = "This run was set to use 20 of the 27. 7 need the original version.";
const TEXT_FILE_LINE_2 = "This run was set to use 8 of the 27. 9 need a Markdown file. 1 needs a Markdown file and the Jev route. 2 need a Markdown file, the Jev route and --send. 7 need the original version.";
const NO_FRONT_MATTER_LINE_2 = "This run was set to use 16 of the 27. 1 needs the Jev route. 2 need the Jev route and --send. 1 needs front matter to be read. 7 need the original version.";
const MIXED_LINE_2 = "This run was set to use 17 of the 27. 1 needs the Jev route. 2 need the Jev route and --send. 7 need the original version. 1 selected file is not Markdown, so the 9 that need a Markdown file do not reach it.";
const MIXED_PREVIEW_LINE_2 = "This run was set to use 18 of the 27. 2 need --send. 7 need the original version. 1 selected file is not Markdown, so the 10 that need a Markdown file do not reach it.";
const REFUSED_PREVIEW_LINE_2 = "This run was set to use 18 of the 27. 2 need --send. 7 need the original version. 1 selected file is not sent because of its front matter, so the 1 that needs the Jev route does not reach it.";
const REFUSED_SEND_LINE_2 = "This run was set to use 20 of the 27. 7 need the original version. 1 selected file is not sent because of its front matter, so the 3 that need the Jev route do not reach it.";
const REFUSED_MIXED_PREVIEW_LINE_2 = "This run was set to use 18 of the 27. 2 need --send. 7 need the original version. 1 selected file is not Markdown, so the 10 that need a Markdown file do not reach it. "
  + "1 selected file is not sent because of its front matter, so the 1 that needs the Jev route does not reach it.";
const TEXT_FILE_ROUTE_LINE_2 = "This run was set to use 8 of the 27. 10 need a Markdown file. 2 need a Markdown file and --send. 7 need the original version.";

/** A Markdown document with a title, an opening and one block, so a send makes three requests. */
const GUIDE = "# Guide\n\nThis guide helps you fix the pump.\n\nRed text marks the risky steps.\n";

/** A document that opens with a closed "---" block the planner does not accept, so nothing from it is sent. */
const REFUSED = "---\nversion: 1.0\napi_key:\tPRIVATE_SENTINEL\n\n---\n# Tab guide\n\nTab instructions.";

/** Jev's answer to the purpose question: neither the task nor the scope is named. */
const NEITHER = { type: "choice", choice: "neither", confidence: 0.9, probabilities: { both: 0.02, task_only: 0.04, scope_only: 0.04, neither: 0.9 } };

/** Jev's answer to the purpose question: both are named, with little confidence. */
const BOTH = { type: "choice", choice: "both", confidence: 0.8, probabilities: { both: 0.8, task_only: 0.1, scope_only: 0.05, neither: 0.05 } };

/**
 * A digest of every request body the baseline send made, and the digest its
 * send log recorded, measured on `design-audit` at c9715a3 before the reading
 * was added: the design audit sending `GUIDE` with every opening answered
 * `NEITHER` and every other question 0.5.
 */
const BASELINE_BODIES_DIGEST = "bed7672439cc3750de4ca3df7e1251d5be4fbc93c0f110a8b426cda590ca57d6";
const BASELINE_LOG_DIGEST = "40d770b730389dca851925fa9f12019d8c7ea581ed73c0bc82776b0d5556fd6c";

/**
 * A digest of the disclosure `formatPlan` printed for `GUIDE` on
 * `design-audit` at c9715a3, with the selected path given as `doc.md`.
 */
const BASELINE_PLAN_DIGEST = "001666734439ba34ee4469cfc004a22c6f4f93a09c3da8acaa0b3898a75b1993";

/** The reading a run prints, from its second line. The other three lines are the same for every run. */
function printedReading(line2: string): string {
  return [LINE_1, line2, LINE_3, LINE_4].join("\n");
}

/** What one run of an audit printed on each stream, and its exit code. */
interface Printed {
  exit: number;
  out: string[];
  err: string[];
}

/** Runs the text audit with the given arguments after the program name. */
async function textAudit(argv: readonly string[], dependencies: AuditDependencies): Promise<Printed> {
  const printed: Printed = { exit: -1, out: [], err: [] };
  printed.exit = await runTextCli(["bun", "cli", ...argv], text => printed.out.push(text), text => printed.err.push(text), dependencies);
  return printed;
}

/** Runs the design audit with the given arguments after the program name. */
async function designAudit(argv: readonly string[], dependencies: AuditDependencies): Promise<Printed> {
  const printed: Printed = { exit: -1, out: [], err: [] };
  printed.exit = await runDesignCli(["bun", "cli", ...argv], text => printed.out.push(text), text => printed.err.push(text), dependencies);
  return printed;
}

/**
 * Dependencies for a send that never leaves the machine. The transport
 * answers every opening with `purpose` and every other question 0.5, and
 * records each request body in `bodies`. The send log goes to `logs`.
 */
function stubbed(purpose: unknown, bodies: string[], logs: AuditLog[]): AuditDependencies {
  return {
    env: { TYPESAFE_API_KEY: "stand-in-key" },
    now: () => new Date("2026-11-14T00:00:00Z"),
    terminal: { inputIsTTY: false, outputIsTTY: false, prompt: async () => "no" },
    writeLog: record => logs.push(record),
    client: {
      fetch: async (url, init) => {
        bodies.push(init.body);
        const questions = Object.keys(JSON.parse(init.body).questions);
        return Response.json({ model: MODEL, answers: Object.fromEntries(questions.map(id => [id, id === "purpose" ? purpose : { type: "noul", noul: 0.5 }])) });
      },
      clock: { schedule: () => () => {} },
      sleep: async () => {},
    },
  };
}

/** Dependencies whose transport refuses every request, so a send is incomplete. */
function refusing(bodies: string[], logs: AuditLog[]): AuditDependencies {
  const dependencies = stubbed(NEITHER, bodies, logs);
  return { ...dependencies, client: { ...dependencies.client, fetch: async (url, init) => {
    bodies.push(init.body);
    return new Response("refused", { status: 400 });
  } } };
}

/**
 * Writes `files` into a new directory, runs `body` on it, and removes the
 * directory however `body` ends.
 */
async function inDirectory(files: Readonly<Record<string, string>>, body: (directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "checklist-reading-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(directory, name), text);
    }
    await body(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The SHA-256 of a text, in hexadecimal. */
function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("both audits print the reading after the mechanical findings", () => {
  test("the plain text audit prints it after its table, for a Markdown file and a .txt file", async () => {
    await inDirectory({ "doc.md": GUIDE, "doc.txt": GUIDE }, async directory => {
      const markdown = await textAudit([join(directory, "doc.md"), "--project-dir", directory], {});
      expect(markdown.exit).toBe(0);
      expect(markdown.out).toHaveLength(2);
      expect(markdown.out[0]).toStartWith("| File | Line | Rule | Finding |");
      expect(markdown.out[1]).toBe(printedReading(PLAIN_LINE_2));
      const text = await textAudit([join(directory, "doc.txt"), "--project-dir", directory], {});
      expect(text.exit).toBe(0);
      expect(text.out[1]).toBe(printedReading(TEXT_FILE_LINE_2));
    });
  });

  test("the plain text audit given --before prints it after the comparison, using the seven clauses that need the original", async () => {
    await inDirectory({ "doc.md": GUIDE, "old.md": GUIDE }, async directory => {
      const json = join(directory, "report.json");
      const compared = await textAudit([join(directory, "doc.md"), "--project-dir", directory, "--before", join(directory, "old.md"), "--json", json], {});
      expect(compared.exit).toBe(0);
      expect(compared.out).toHaveLength(3);
      expect(compared.out[1]).toStartWith("Restructure comparison: ");
      expect(compared.out[2]).toBe(printedReading("This run was set to use 24 of the 27. 1 needs the Jev route. 2 need the Jev route and --send."));
      const report = JSON.parse(readFileSync(json, "utf8"));
      expect(Object.keys(report)).toEqual(["configHash", "files", "totals", "skipped", "restructure", "declared", "checklist"]);
      expect(report.checklist.run.used).toEqual(["1a", "3a", "3b", "4a", "6a", "8a", "8c", "9b", "12a", "12b", "12c", "13b", "15f", "17a", "19b", "19d", "20a", "20b", "21a", "21b", "22a", "23a", "23b", "25a"]);
    });
  });

  test("the text audit's Jev preview prints it after the mechanical findings and before the disclosure", async () => {
    await inDirectory({ "doc.md": GUIDE, "doc.txt": GUIDE }, async directory => {
      const bodies: string[] = [];
      const markdown = await textAudit([join(directory, "doc.md"), "--project-dir", directory, "--jev-preview"], stubbed(NEITHER, bodies, []));
      expect(markdown.exit).toBe(0);
      expect(markdown.out[0]).toStartWith("Mechanical findings");
      expect(markdown.out[1]).toBe(printedReading(PREVIEW_LINE_2));
      expect(markdown.out[2]).toBe(formatPlan(selectDocuments(join(directory, "doc.md"), directory, "text")));
      const text = await textAudit([join(directory, "doc.txt"), "--project-dir", directory, "--jev-preview"], stubbed(NEITHER, bodies, []));
      expect(text.out[1]).toBe(printedReading(TEXT_FILE_ROUTE_LINE_2));
      expect(bodies).toEqual([]);
    });
  });

  test("the text audit's send prints it before the disclosure, and the Jev findings last", async () => {
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const bodies: string[] = [];
      const sent = await textAudit([join(directory, "doc.md"), "--project-dir", directory, "--jev", "--send", "--yes"], stubbed(NEITHER, bodies, []));
      expect(sent.exit).toBe(0);
      expect(sent.out[1]).toBe(printedReading(SEND_LINE_2));
      expect(sent.out.at(-1)).toStartWith("Calibrated Jev checks");
      expect(bodies).toHaveLength(3);
    });
  });

  test("the design audit prints it in a preview and in a send", async () => {
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const bodies: string[] = [];
      const preview = await designAudit([join(directory, "doc.md"), "--project-dir", directory], stubbed(NEITHER, bodies, []));
      expect(preview.exit).toBe(0);
      expect(preview.out[0]).toStartWith("Mechanical findings");
      expect(preview.out[1]).toBe(printedReading(PREVIEW_LINE_2));
      expect(preview.out[2]).toBe(formatPlan(selectDocuments(join(directory, "doc.md"), directory)));
      expect(bodies).toEqual([]);
      const sent = await designAudit([join(directory, "doc.md"), "--project-dir", directory, "--send", "--yes"], stubbed(NEITHER, bodies, []));
      expect(sent.exit).toBe(0);
      expect(sent.out[1]).toBe(printedReading(SEND_LINE_2));
      expect(sent.out.at(-1)).toStartWith("Calibrated Jev checks");
    });
  });

  test("a design audit of a folder with no Markdown file reads nothing and still prints the reading", async () => {
    await inDirectory({ "notes.txt": GUIDE }, async directory => {
      const preview = await designAudit([directory, "--project-dir", directory], {});
      expect(preview.exit).toBe(0);
      expect(preview.out[1]).toBe(printedReading(TEXT_FILE_ROUTE_LINE_2));
    });
  });

  // A refused document is still a Markdown file that the mechanical checks
  // read, but nothing from it is sent. That is decided while the files are
  // selected, before any request, so line 2 can say so.
  test("a refused document is named as one the Jev route clauses do not reach", async () => {
    await inDirectory({ "tab.md": REFUSED }, async directory => {
      const preview = await designAudit([join(directory, "tab.md"), "--project-dir", directory], {});
      expect(preview.exit).toBe(0);
      expect(preview.err).toHaveLength(1);
      expect(preview.out[1]).toBe(printedReading(REFUSED_PREVIEW_LINE_2));
    });
  });

  test("a send of only refused documents makes no request and does not say all", async () => {
    await inDirectory({ "tab.md": REFUSED }, async directory => {
      const bodies: string[] = [];
      const sent = await designAudit([join(directory, "tab.md"), "--project-dir", directory, "--send", "--yes"], stubbed(NEITHER, bodies, []));
      expect(sent.exit).toBe(0);
      expect(bodies).toEqual([]);
      expect(sent.out[1]).toBe(printedReading(REFUSED_SEND_LINE_2));
    });
  });

  test("the plain text audit with --no-front-matter says the version or date clause needs front matter to be read", async () => {
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const plain = await textAudit([join(directory, "doc.md"), "--project-dir", directory, "--no-front-matter"], {});
      expect(plain.exit).toBe(0);
      expect(plain.out[1]).toBe(printedReading(NO_FRONT_MATTER_LINE_2));
    });
  });

  test("a folder of Markdown and .txt files names the file the Markdown clauses do not reach", async () => {
    await inDirectory({ "doc.md": GUIDE, "notes.txt": GUIDE }, async directory => {
      const plain = await textAudit([directory, "--project-dir", directory], {});
      expect(plain.out[1]).toBe(printedReading(MIXED_LINE_2));
      const preview = await textAudit([directory, "--project-dir", directory, "--jev-preview"], {});
      expect(preview.out[1]).toBe(printedReading(MIXED_PREVIEW_LINE_2));
    });
  });

  test("a text Jev preview of a folder with a refused document and a .txt file names both", async () => {
    await inDirectory({ "doc.md": GUIDE, "notes.txt": GUIDE, "tab.md": REFUSED }, async directory => {
      const preview = await textAudit([directory, "--project-dir", directory, "--jev-preview"], {});
      expect(preview.exit).toBe(0);
      expect(preview.out[1]).toBe(printedReading(REFUSED_MIXED_PREVIEW_LINE_2));
    });
  });
});

describe("a run that stops before its mechanical findings print prints no reading, and keeps its exit code", () => {
  test("either audit with no argument prints its usage and no reading", async () => {
    const text = await textAudit([], {});
    expect([text.exit, text.out]).toEqual([2, []]);
    expect(text.err[0]).toStartWith("Usage:");
    const design = await designAudit([], {});
    expect([design.exit, design.out]).toEqual([2, []]);
  });

  test("the design audit refuses a .txt file with exit 1", async () => {
    await inDirectory({ "doc.txt": GUIDE }, async directory => {
      const refused = await designAudit([join(directory, "doc.txt"), "--project-dir", directory], {});
      expect([refused.exit, refused.out]).toEqual([1, []]);
    });
  });

  test("the text audit refuses --send alone with exit 2", async () => {
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const refused = await textAudit([join(directory, "doc.md"), "--project-dir", directory, "--send", "--yes"], {});
      expect([refused.exit, refused.out]).toEqual([2, []]);
    });
  });

  test("the plain text audit stops with exit 1 on a missing path or a report it cannot write", async () => {
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const missing = await textAudit([join(directory, "missing.md"), "--project-dir", directory], {});
      expect([missing.exit, missing.out]).toEqual([1, []]);
      const unwritable = await textAudit([join(directory, "doc.md"), "--project-dir", directory, "--json", join(directory, "missing", "report.json")], {});
      expect([unwritable.exit, unwritable.out]).toEqual([1, []]);
    });
  });
});

// The Jev route prints the mechanical findings and the reading before it
// writes a preview's report or asks for agreement, so these stops come after
// the reading.
describe("a Jev route run that stops after its mechanical findings print has already printed the reading", () => {
  test("a send without agreement prints the reading, sends nothing and exits 2", async () => {
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const bodies: string[] = [];
      const dependencies = stubbed(NEITHER, bodies, []);
      const refused = await designAudit([join(directory, "doc.md"), "--project-dir", directory, "--send"], { ...dependencies, terminal: { inputIsTTY: true, outputIsTTY: true, prompt: async () => "no" } });
      expect(refused.exit).toBe(2);
      expect(refused.out[1]).toBe(printedReading(SEND_LINE_2));
      expect(refused.err).toEqual(["Agreement was not yes. Nothing was sent."]);
      expect(bodies).toEqual([]);
    });
  });

  test("a preview whose report cannot be written prints the reading and exits 1", async () => {
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const preview = await textAudit([join(directory, "doc.md"), "--project-dir", directory, "--jev-preview", "--json", join(directory, "missing", "report.json")], {});
      expect(preview.exit).toBe(1);
      expect(preview.out[1]).toBe(printedReading(PREVIEW_LINE_2));
      expect(preview.err).toEqual(["The preview report could not be written."]);
    });
  });
});

/** The declared key of a report from a project with no facts file. */
const NO_FACTS_FILE = { source: null, files: [], effects: [], problems: [] };

describe("the --json report of each audit gains a declared key and a checklist key, and nothing else", () => {
  const plainChecklist = {
    clauses: 64,
    reading: "0.42",
    tool: { fault: 27, passOnly: 1, needsTwoVersions: 7, notCheckable: 1, notRead: 28 },
    run: {
      used: ["1a", "3a", "3b", "4a", "6a", "8a", "8c", "9b", "12a", "12b", "12c", "13b", "15f", "17a", "19b", "19d", "25a"],
      notUsed: [{ clause: "15a", needs: ["jev-route"] }, { clause: "15c", needs: ["jev-route", "send"] }, { clause: "15d", needs: ["jev-route", "send"] }, ...BEFORE_NOT_USED],
      filesNotReached: 0,
      documentsNotSent: 0,
    },
  };

  test("the plain text audit adds it last, for a Markdown file and a .txt file", async () => {
    await inDirectory({ "doc.md": GUIDE, "doc.txt": GUIDE }, async directory => {
      const json = join(directory, "report.json");
      expect((await textAudit([join(directory, "doc.md"), "--project-dir", directory, "--json", json], {})).exit).toBe(0);
      const report = JSON.parse(readFileSync(json, "utf8"));
      expect(Object.keys(report)).toEqual(["configHash", "files", "totals", "skipped", "declared", "checklist"]);
      expect(report.declared).toEqual(NO_FACTS_FILE);
      expect(report.checklist).toEqual(plainChecklist);
      expect((await textAudit([join(directory, "doc.txt"), "--project-dir", directory, "--json", json], {})).exit).toBe(0);
      expect(JSON.parse(readFileSync(json, "utf8")).checklist.run.used).toEqual(NEED_NOTHING);
    });
  });

  test("the design audit adds it last, in a preview and in a send", async () => {
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const json = join(directory, "report.json");
      expect((await designAudit([join(directory, "doc.md"), "--project-dir", directory, "--json", json], {})).exit).toBe(0);
      const preview = JSON.parse(readFileSync(json, "utf8"));
      expect(Object.keys(preview)).toEqual(["mechanical", "jev", "preview", "declared", "checklist"]);
      expect(preview.declared).toEqual(NO_FACTS_FILE);
      expect(preview.checklist.run).toEqual({
        used: [...plainChecklist.run.used.slice(0, 12), "15a", "15f", "17a", "19b", "19d", "25a"], notUsed: [{ clause: "15c", needs: ["send"] }, { clause: "15d", needs: ["send"] }, ...BEFORE_NOT_USED],
        filesNotReached: 0, documentsNotSent: 0,
      });
      expect((await designAudit([join(directory, "doc.md"), "--project-dir", directory, "--send", "--yes", "--json", json], stubbed(NEITHER, [], []))).exit).toBe(0);
      const sent = JSON.parse(readFileSync(json, "utf8"));
      expect(Object.keys(sent)).toEqual(["mechanical", "jev", "declared", "checklist"]);
      expect(sent.declared).toEqual(NO_FACTS_FILE);
      expect(sent.checklist.run.notUsed).toEqual(BEFORE_NOT_USED);
      expect(sent.checklist.tool).toEqual(plainChecklist.tool);
    });
  });

  test("an empty selection and a refused document each carry the key", async () => {
    await inDirectory({ "notes.txt": GUIDE, "tab.md": REFUSED }, async directory => {
      const json = join(directory, "report.json");
      expect((await designAudit([join(directory, "tab.md"), "--project-dir", directory, "--json", json], {})).exit).toBe(0);
      const refused = JSON.parse(readFileSync(json, "utf8"));
      expect(refused.jev.notSent).toHaveLength(1);
      expect(refused.checklist.run.documentsNotSent).toBe(refused.jev.notSent.length);
      expect(refused.checklist.run.notUsed).toEqual([{ clause: "15c", needs: ["send"] }, { clause: "15d", needs: ["send"] }, ...BEFORE_NOT_USED]);
      rmSync(join(directory, "tab.md"));
      expect((await designAudit([directory, "--project-dir", directory, "--json", json], {})).exit).toBe(0);
      const empty = JSON.parse(readFileSync(json, "utf8"));
      expect(Object.keys(empty.mechanical.files)).toEqual([]);
      expect(empty.checklist.run.used).toEqual(NEED_NOTHING);
      expect([empty.checklist.run.filesNotReached, empty.checklist.run.documentsNotSent]).toEqual([0, 0]);
    });
  });
});

describe("the --json report carries the files not reached and the documents not sent", () => {
  test("a text Jev preview of a folder with a refused document and a .txt file counts each", async () => {
    await inDirectory({ "doc.md": GUIDE, "notes.txt": GUIDE, "tab.md": REFUSED }, async directory => {
      const json = join(directory, "report.json");
      expect((await textAudit([directory, "--project-dir", directory, "--jev-preview", "--json", json], {})).exit).toBe(0);
      const report = JSON.parse(readFileSync(json, "utf8"));
      expect(Object.keys(report.checklist.run)).toEqual(["used", "notUsed", "filesNotReached", "documentsNotSent"]);
      expect([report.checklist.run.filesNotReached, report.checklist.run.documentsNotSent]).toEqual([1, 1]);
      expect(report.checklist.run.documentsNotSent).toBe(report.jev.notSent.length);
    });
  });

  test("the plain text audit counts the .txt files of a mixed folder, and with --no-front-matter leaves 15f unused", async () => {
    await inDirectory({ "doc.md": GUIDE, "notes.txt": GUIDE }, async directory => {
      const json = join(directory, "report.json");
      expect((await textAudit([directory, "--project-dir", directory, "--no-front-matter", "--json", json], {})).exit).toBe(0);
      const run = JSON.parse(readFileSync(json, "utf8")).checklist.run;
      expect([run.filesNotReached, run.documentsNotSent]).toEqual([1, 0]);
      expect(run.used).not.toContain("15f");
      expect(run.notUsed.find((entry: { clause: string }) => entry.clause === "15f")).toEqual({ clause: "15f", needs: ["front-matter"] });
    });
  });
});

describe("no Jev answer reaches the reading", () => {
  test("two sends that Jev answers differently print the same reading and write the same checklist", async () => {
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const firstJson = join(directory, "first.json");
      const secondJson = join(directory, "second.json");
      const first = await designAudit([join(directory, "doc.md"), "--project-dir", directory, "--send", "--yes", "--json", firstJson], stubbed(NEITHER, [], []));
      const second = await designAudit([join(directory, "doc.md"), "--project-dir", directory, "--send", "--yes", "--json", secondJson], stubbed(BOTH, [], []));
      expect([first.exit, second.exit]).toEqual([0, 0]);
      // The answers differ, and so do the findings they gave.
      expect(first.out.at(-1)).not.toBe(second.out.at(-1));
      expect(first.out[1]).toBe(printedReading(SEND_LINE_2));
      expect(second.out[1]).toBe(first.out[1]);
      expect(JSON.parse(readFileSync(secondJson, "utf8")).checklist).toEqual(JSON.parse(readFileSync(firstJson, "utf8")).checklist);
    });
  });

  test("a send that fails prints Execution: incomplete elsewhere and leaves the reading alone", async () => {
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const bodies: string[] = [];
      const failed = await designAudit([join(directory, "doc.md"), "--project-dir", directory, "--send", "--yes"], refusing(bodies, []));
      expect(failed.exit).toBe(3);
      expect(bodies.length).toBeGreaterThan(0);
      expect(failed.out[1]).toBe(printedReading(SEND_LINE_2));
      expect(failed.out.at(-1)).toContain("Execution: incomplete.");
    });
  });
});

// The tests below send to a stand-in transport whose answers keep a
// different number of results each time: none, one, three, many, or none
// because the send failed. The report's reading must not follow that number.

/** A Markdown document with no title, so a send asks only about its two blocks. */
const UNTITLED = "Close the valve before you start.\n\nTurn the handle slowly to the left.\n";

/** A Markdown document with a title, an opening and seven blocks, so a send makes eight requests. */
const LONG_GUIDE = "# Pump guide\n\nThis guide helps you fix the pump.\n\n"
  + ["Turn off the power.", "Close the inlet valve.", "Drain the pump.", "Remove the cover.", "Replace the seal.", "Refit the cover."]
    .map(step => `${step} Check it twice before you go on.\n\n`).join("");

/** A text file, which the text audit reads and sends nothing from. */
const NOTES = "Plain words about the pump.\n";

/** A block's answer that leaves it unsure, so the report keeps it. */
const COLOUR_UNSURE = { type: "noul", noul: 0.5 };

/** A block's answer that passes it, so the report drops it. */
const COLOUR_PASSES = { type: "noul", noul: 0.05 };

/**
 * A block's answer that is not a probability, so the client rejects the
 * response. It asks again until its six attempts are spent, so each request
 * is sent six times.
 */
const COLOUR_INVALID = { type: "noul", noul: 7 };

/** How the stand-in transport answers every request of one send. */
type Answering = "keep every block" | "pass every block" | "refuse every request" | "answer out of range";

/** The answer to each block's colour question, by how the transport answers. */
const COLOUR_ANSWER: Readonly<Record<Exclude<Answering, "refuse every request">, unknown>> = {
  "keep every block": COLOUR_UNSURE,
  "pass every block": COLOUR_PASSES,
  "answer out of range": COLOUR_INVALID,
};

/**
 * One send and what it must give: the files in the selected folder, how
 * the transport answers, the exit code, how many requests it made and
 * results it kept, the facts of the run known before any request, and the
 * line 2 it prints.
 */
interface SendCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly answering: Answering;
  readonly exit: number;
  readonly requests: number;
  readonly results: number;
  readonly facts: Pick<RunFacts, "files" | "markdownFiles" | "refused">;
  readonly line2: string;
}

const TWO_REFUSED_SEND_LINE_2 = "This run was set to use 20 of the 27. 7 need the original version. 2 selected files are not sent because of their front matter, so the 3 that need the Jev route do not reach them.";
const ONE_TEXT_FILE_SEND_LINE_2 = "This run was set to use 20 of the 27. 7 need the original version. 1 selected file is not Markdown, so the 12 that need a Markdown file do not reach it.";
const TEXT_FILES_AND_REFUSED_SEND_LINE_2 = "This run was set to use 20 of the 27. 7 need the original version. 2 selected files are not Markdown, so the 12 that need a Markdown file do not reach them. "
  + "1 selected file is not sent because of its front matter, so the 3 that need the Jev route do not reach it.";
const TEXT_FILE_AND_REFUSED_SEND_LINE_2 = "This run was set to use 20 of the 27. 7 need the original version. 1 selected file is not Markdown, so the 12 that need a Markdown file do not reach it. "
  + "1 selected file is not sent because of its front matter, so the 3 that need the Jev route do not reach it.";
const TEXT_FILE_AND_TWO_REFUSED_SEND_LINE_2 = "This run was set to use 20 of the 27. 7 need the original version. 1 selected file is not Markdown, so the 12 that need a Markdown file do not reach it. "
  + "2 selected files are not sent because of their front matter, so the 3 that need the Jev route do not reach them.";
const ONLY_TEXT_FILES_SEND_LINE_2 = "This run was set to use 8 of the 27. 12 need a Markdown file. 7 need the original version.";

/** Design sends of a folder. The design audit reads no .txt file, so none is selected. */
const DESIGN_SENDS: readonly SendCase[] = [
  { name: "one document, none refused, three results kept", files: { "doc.md": GUIDE }, answering: "keep every block", exit: 0, requests: 3, results: 3, facts: { files: 1, markdownFiles: 1, refused: 0 }, line2: SEND_LINE_2 },
  { name: "one document, none refused, one result kept", files: { "doc.md": GUIDE }, answering: "pass every block", exit: 0, requests: 3, results: 1, facts: { files: 1, markdownFiles: 1, refused: 0 }, line2: SEND_LINE_2 },
  { name: "one refused beside a titled document, one result kept", files: { "doc.md": GUIDE, "tab.md": REFUSED }, answering: "pass every block", exit: 0, requests: 3, results: 1, facts: { files: 2, markdownFiles: 2, refused: 1 }, line2: REFUSED_SEND_LINE_2 },
  { name: "one refused beside an untitled document, no result kept", files: { "doc.md": UNTITLED, "tab.md": REFUSED }, answering: "pass every block", exit: 0, requests: 2, results: 0, facts: { files: 2, markdownFiles: 2, refused: 1 }, line2: REFUSED_SEND_LINE_2 },
  { name: "every document refused, no request made", files: { "tab.md": REFUSED, "old.md": REFUSED }, answering: "keep every block", exit: 0, requests: 0, results: 0, facts: { files: 2, markdownFiles: 2, refused: 2 }, line2: TWO_REFUSED_SEND_LINE_2 },
  { name: "one refused beside two documents, many results kept", files: { "a.md": LONG_GUIDE, "b.md": GUIDE, "tab.md": REFUSED }, answering: "keep every block", exit: 0, requests: 11, results: 11, facts: { files: 3, markdownFiles: 3, refused: 1 }, line2: REFUSED_SEND_LINE_2 },
  { name: "one refused beside a document, every request refused", files: { "doc.md": GUIDE, "tab.md": REFUSED }, answering: "refuse every request", exit: 3, requests: 3, results: 0, facts: { files: 2, markdownFiles: 2, refused: 1 }, line2: REFUSED_SEND_LINE_2 },
  { name: "one document, none refused, answers out of range", files: { "doc.md": GUIDE }, answering: "answer out of range", exit: 3, requests: 18, results: 0, facts: { files: 1, markdownFiles: 1, refused: 0 }, line2: SEND_LINE_2 },
];

/** Text audit sends of a folder with --jev, --send and --yes. The text audit reads .txt files and sends nothing from them. */
const TEXT_SENDS: readonly SendCase[] = [
  { name: "one document, none refused, three results kept", files: { "doc.md": GUIDE }, answering: "keep every block", exit: 0, requests: 3, results: 3, facts: { files: 1, markdownFiles: 1, refused: 0 }, line2: SEND_LINE_2 },
  { name: "a document and a text file, one result kept", files: { "doc.md": GUIDE, "notes.txt": NOTES }, answering: "pass every block", exit: 0, requests: 3, results: 1, facts: { files: 2, markdownFiles: 1, refused: 0 }, line2: ONE_TEXT_FILE_SEND_LINE_2 },
  { name: "a document, two text files and one refused, three results kept", files: { "doc.md": GUIDE, "notes.txt": NOTES, "more.txt": NOTES, "tab.md": REFUSED }, answering: "keep every block", exit: 0, requests: 3, results: 3, facts: { files: 4, markdownFiles: 2, refused: 1 }, line2: TEXT_FILES_AND_REFUSED_SEND_LINE_2 },
  { name: "an untitled document, a text file and one refused, no result kept", files: { "doc.md": UNTITLED, "notes.txt": NOTES, "tab.md": REFUSED }, answering: "pass every block", exit: 0, requests: 2, results: 0, facts: { files: 3, markdownFiles: 2, refused: 1 }, line2: TEXT_FILE_AND_REFUSED_SEND_LINE_2 },
  { name: "a long document, a text file and two refused, many results kept", files: { "a.md": LONG_GUIDE, "notes.txt": NOTES, "tab.md": REFUSED, "old.md": REFUSED }, answering: "keep every block", exit: 0, requests: 8, results: 8, facts: { files: 4, markdownFiles: 3, refused: 2 }, line2: TEXT_FILE_AND_TWO_REFUSED_SEND_LINE_2 },
  { name: "every document refused, no request made", files: { "tab.md": REFUSED, "old.md": REFUSED }, answering: "keep every block", exit: 0, requests: 0, results: 0, facts: { files: 2, markdownFiles: 2, refused: 2 }, line2: TWO_REFUSED_SEND_LINE_2 },
  { name: "only text files, no request made", files: { "notes.txt": NOTES, "more.txt": NOTES }, answering: "keep every block", exit: 0, requests: 0, results: 0, facts: { files: 2, markdownFiles: 0, refused: 0 }, line2: ONLY_TEXT_FILES_SEND_LINE_2 },
  { name: "a document, a text file and one refused, every request refused", files: { "doc.md": GUIDE, "notes.txt": NOTES, "tab.md": REFUSED }, answering: "refuse every request", exit: 3, requests: 3, results: 0, facts: { files: 3, markdownFiles: 2, refused: 1 }, line2: TEXT_FILE_AND_REFUSED_SEND_LINE_2 },
  { name: "a document and a text file, answers out of range", files: { "doc.md": GUIDE, "notes.txt": NOTES }, answering: "answer out of range", exit: 3, requests: 18, results: 0, facts: { files: 2, markdownFiles: 1, refused: 0 }, line2: ONE_TEXT_FILE_SEND_LINE_2 },
];

/**
 * Dependencies for a send that never leaves the machine, answering as
 * `answering` says. Every opening is answered `NEITHER`, which an opening
 * always keeps. Each request body is recorded in `bodies`.
 */
function answeredAs(answering: Answering, bodies: string[]): AuditDependencies {
  if (answering === "refuse every request") return refusing(bodies, []);
  const colour = COLOUR_ANSWER[answering];
  const dependencies = stubbed(NEITHER, bodies, []);
  return { ...dependencies, client: { ...dependencies.client, fetch: async (url, init) => {
    bodies.push(init.body);
    const questions = Object.keys(JSON.parse(init.body).questions);
    return Response.json({ model: MODEL, answers: Object.fromEntries(questions.map(id => [id, id === "purpose" ? NEITHER : colour])) });
  } } };
}

/** The facts of a send of `send.files`, known before any request. */
function sendFacts(mode: RunFacts["mode"], send: SendCase): RunFacts {
  return { ...send.facts, mode, frontMatter: true, jevPreview: false, jev: mode === "text", send: true, before: false, facts: [] };
}

/**
 * Checks that what a send printed and wrote holds the reading of its facts,
 * whatever the transport answered: the JSON reading is the one those facts
 * give, line 2 is the one given, and line 2 is what the JSON reading prints.
 * The counts of files not reached and documents not sent are the selected
 * .txt files and the selected refusals.
 */
function expectReadingBeforeRequests(mode: RunFacts["mode"], send: SendCase, printed: Printed, report: { jev: { results: unknown[]; notSent: Array<{ file: string }> }; checklist: ChecklistReading }, bodies: readonly string[]): void {
  expect(printed.exit).toBe(send.exit);
  // The answers really kept this many results, and the send made this many requests.
  expect([bodies.length, report.jev.results.length]).toEqual([send.requests, send.results]);
  expect(report.checklist).toEqual(checklistReading(CHECKLIST, sendFacts(mode, send)));
  expect(printed.out[1]).toBe(printedReading(send.line2));
  expect(formatChecklistReading(report.checklist, CHECKLIST)).toBe(printed.out[1] ?? "no line 2");
  const refused = Object.entries(send.files).filter(([, text]) => text === REFUSED).map(([name]) => name).sort();
  expect(report.jev.notSent.map(entry => entry.file).sort()).toEqual(refused);
  expect(printed.err.filter(line => line.startsWith("warning: not sent: ")).length).toBe(refused.length);
  expect(report.checklist.run.documentsNotSent).toBe(refused.length);
  expect(report.checklist.run.filesNotReached).toBe(Object.keys(send.files).filter(name => name.endsWith(".txt")).length);
}

describe("a send's --json reading is the reading taken before any request, however many results Jev's answers keep", () => {
  test("the cases keep different numbers of results, so a reading that followed them would differ", () => {
    for (const sends of [DESIGN_SENDS, TEXT_SENDS]) {
      expect(new Set(sends.map(send => send.results)).size).toBeGreaterThanOrEqual(4);
      expect(sends.some(send => send.facts.refused === 0) && sends.some(send => send.facts.refused === 1) && sends.some(send => send.facts.refused === send.facts.files)).toBe(true);
    }
  });

  for (const send of DESIGN_SENDS) {
    test(`design send, ${send.name}`, async () => {
      await inDirectory(send.files, async directory => {
        const bodies: string[] = [];
        const json = `${directory}.json`;
        try {
          const printed = await designAudit([directory, "--project-dir", directory, "--send", "--yes", "--json", json], answeredAs(send.answering, bodies));
          expectReadingBeforeRequests("design", send, printed, JSON.parse(readFileSync(json, "utf8")), bodies);
        } finally {
          rmSync(json, { force: true });
        }
      });
    });
  }

  for (const send of TEXT_SENDS) {
    test(`text send, ${send.name}`, async () => {
      await inDirectory(send.files, async directory => {
        const bodies: string[] = [];
        const json = `${directory}.json`;
        try {
          const printed = await textAudit([directory, "--project-dir", directory, "--jev", "--send", "--yes", "--json", json], answeredAs(send.answering, bodies));
          expectReadingBeforeRequests("text", send, printed, JSON.parse(readFileSync(json, "utf8")), bodies);
        } finally {
          rmSync(json, { force: true });
        }
      });
    });
  }
});

describe("the reading changes nothing that is sent or disclosed", () => {
  test("a send makes the same requests and logs the same digest as before the reading", async () => {
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const bodies: string[] = [];
      const logs: AuditLog[] = [];
      expect((await designAudit([join(directory, "doc.md"), "--project-dir", directory, "--send", "--yes"], stubbed(NEITHER, bodies, logs))).exit).toBe(0);
      expect(bodies).toHaveLength(3);
      expect(digest(JSON.stringify(bodies))).toBe(BASELINE_BODIES_DIGEST);
      expect(logs.map(record => [record.disclosureVersion, record.digest, record.complete])).toEqual([["0.8.0-r3", BASELINE_LOG_DIGEST, true]]);
    });
  });

  test("the disclosure and its version are as they were", async () => {
    expect(DISCLOSURE_VERSION).toBe("0.8.0-r3");
    await inDirectory({ "doc.md": GUIDE }, async directory => {
      const selection = selectDocuments(join(directory, "doc.md"), directory);
      selection.paths = ["doc.md"];
      expect(digest(formatPlan(selection))).toBe(BASELINE_PLAN_DIGEST);
    });
  });
});

describe("the tool reading is the same for every input", () => {
  test("every run prints the same first and third lines, and writes the same counts", async () => {
    await inDirectory({ "doc.md": GUIDE, "doc.txt": "Plain words.\n", "tab.md": REFUSED }, async directory => {
      const json = join(directory, "report.json");
      const printed: Printed[] = [];
      const tools: unknown[] = [];
      for (const file of ["doc.md", "doc.txt", "tab.md"]) {
        printed.push(await textAudit([join(directory, file), "--project-dir", directory, "--json", json], {}));
        tools.push(JSON.parse(readFileSync(json, "utf8")).checklist.tool);
        printed.push(await textAudit([join(directory, file), "--project-dir", directory, "--jev-preview", "--json", json], {}));
        tools.push(JSON.parse(readFileSync(json, "utf8")).checklist.tool);
      }
      printed.push(await designAudit([directory, "--project-dir", directory, "--json", json], {}));
      tools.push(JSON.parse(readFileSync(json, "utf8")).checklist.tool);
      expect(printed.map(result => result.exit)).toEqual([0, 0, 0, 0, 0, 0, 0]);
      for (const result of printed) {
        const lines = (result.out[1] ?? "").split("\n");
        expect([lines[0], lines[2], lines[3]]).toEqual([LINE_1, LINE_3, LINE_4]);
      }
      expect(new Set(tools.map(tool => JSON.stringify(tool))).size).toBe(1);
    });
  });
});
