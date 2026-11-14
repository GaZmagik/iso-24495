import { describe, expect, test } from "bun:test";
import { CHECKLIST, type ChecklistItem, type Clause, type ClauseState, type Need } from "../../scripts/lib/checklist.ts";
import { checklistReading, formatChecklistReading, type RunFacts } from "../../scripts/lib/checklist-reading.ts";

/** A plain text audit of one Markdown file: no Jev option, no send. */
const PLAIN_MARKDOWN: RunFacts = { mode: "text", markdown: true, jevPreview: false, jev: false, send: false, before: false, facts: [] };

/** Every key a run fact may have. The function reads these and nothing else. */
const RUN_FACT_KEYS = ["mode", "markdown", "jevPreview", "jev", "send", "before", "facts"];

/** The fault clauses of today's registry that need nothing, in order. */
const NEED_NOTHING = ["1a", "6a", "12a", "12b", "12c", "13b", "19b"];

/** The fault clauses of today's registry that need a Markdown file alone, in order. */
const NEED_MARKDOWN = ["3a", "3b", "8c", "15f", "17a"];

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

/** The ids a reading did not use, each with the needs it names as unmet. */
function unmet(facts: RunFacts): Array<[string, readonly Need[]]> {
  return checklistReading(CHECKLIST, facts).run.notUsed.map(entry => [entry.clause, entry.needs]);
}

describe("the tool reading counts every clause of the registry", () => {
  test("today's registry has 64 clauses, 15 of them in the fault state, read as 0.23", () => {
    const reading = checklistReading(CHECKLIST, PLAIN_MARKDOWN);
    expect(reading.clauses).toBe(64);
    expect(reading.reading).toBe("0.23");
    expect(reading.tool).toEqual({ fault: 15, passOnly: 1, needsTwoVersions: 14, notCheckable: 1, notRead: 33 });
  });

  test("the tool reading is the same whatever the run", () => {
    const first = checklistReading(CHECKLIST, PLAIN_MARKDOWN);
    for (const mode of ["text", "design"] as const) {
      for (const flags of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]) {
        const facts: RunFacts = { mode, markdown: (flags & 1) > 0, jevPreview: (flags & 2) > 0, jev: (flags & 4) > 0, send: (flags & 8) > 0, before: (flags & 16) > 0, facts: ["any"] };
        const reading = checklistReading(CHECKLIST, facts);
        expect([reading.clauses, reading.reading, reading.tool]).toEqual([first.clauses, first.reading, first.tool]);
        expect(reading.run.used.length + reading.run.notUsed.length).toBe(15);
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
  test("a plain text audit of a Markdown file uses 12, and leaves the title and purpose to the Jev route", () => {
    const reading = checklistReading(CHECKLIST, PLAIN_MARKDOWN);
    expect(reading.run.used).toEqual(["1a", "3a", "3b", "6a", "8c", "12a", "12b", "12c", "13b", "15f", "17a", "19b"]);
    expect(unmet(PLAIN_MARKDOWN)).toEqual([["15a", ["jev-route"]], ["15c", ["jev-route", "send"]], ["15d", ["jev-route", "send"]]]);
  });

  test("a .txt file meets no Markdown need", () => {
    const facts = run({ markdown: false });
    expect(checklistReading(CHECKLIST, facts).run.used).toEqual(NEED_NOTHING);
    expect(unmet(facts)).toEqual([
      ["3a", ["markdown"]], ["3b", ["markdown"]], ["8c", ["markdown"]], ["15a", ["markdown", "jev-route"]],
      ["15c", ["markdown", "jev-route", "send"]], ["15d", ["markdown", "jev-route", "send"]], ["15f", ["markdown"]], ["17a", ["markdown"]],
    ]);
  });

  test("the text audit meets the Jev route with --jev-preview, or with --jev and --send together", () => {
    expect(unmet(run({ jevPreview: true }))).toEqual([["15c", ["send"]], ["15d", ["send"]]]);
    expect(unmet(run({ jev: true, send: true }))).toEqual([]);
    expect(unmet(run({ jev: true }))).toEqual([["15a", ["jev-route"]], ["15c", ["jev-route", "send"]], ["15d", ["jev-route", "send"]]]);
  });

  test("the text audit meets no send with --send alone, or with --send beside --jev-preview", () => {
    expect(unmet(run({ send: true }))).toEqual([["15a", ["jev-route"]], ["15c", ["jev-route", "send"]], ["15d", ["jev-route", "send"]]]);
    expect(unmet(run({ jevPreview: true, send: true }))).toEqual([["15c", ["send"]], ["15d", ["send"]]]);
  });

  test("the design audit always meets the Jev route, and meets a send with --send", () => {
    expect(unmet(run({ mode: "design" }))).toEqual([["15c", ["send"]], ["15d", ["send"]]]);
    expect(unmet(run({ mode: "design", send: true }))).toEqual([]);
    expect(checklistReading(CHECKLIST, run({ mode: "design", send: true })).run.used)
      .toEqual(["1a", "3a", "3b", "6a", "8c", "12a", "12b", "12c", "13b", "15a", "15c", "15d", "15f", "17a", "19b"]);
  });

  test("a clause that needs the original version is met only by --before", () => {
    const probe = registry([{ state: "fault", needs: ["before"] }]);
    expect(checklistReading(probe, PLAIN_MARKDOWN).run).toEqual({ used: [], notUsed: [{ clause: "1a", needs: ["before"] }] });
    expect(checklistReading(probe, run({ before: true })).run).toEqual({ used: ["1a"], notUsed: [] });
  });

  test("a clause that needs a declared fact is met only when that fact exists", () => {
    const probe = registry([{ state: "fault", needs: ["fact:audience"] }]);
    expect(checklistReading(probe, run({ facts: ["date"] })).run).toEqual({ used: [], notUsed: [{ clause: "1a", needs: ["fact:audience"] }] });
    expect(checklistReading(probe, run({ facts: ["date", "audience"] })).run).toEqual({ used: ["1a"], notUsed: [] });
  });

  test("a clause in another state is neither used nor listed as not used, whatever its needs", () => {
    const probe = registry([{ state: "pass-only", needs: ["send"] }, { state: "not-read" }, { state: "fault" }]);
    expect(checklistReading(probe, PLAIN_MARKDOWN).run).toEqual({ used: ["1c"], notUsed: [] });
  });
});

describe("the function reads the registry and the run facts, and nothing else", () => {
  // A report, a Jev verdict or any answer has no way in: the function takes two
  // arguments, and reads only the named keys of the second.
  test("it takes two arguments", () => {
    expect(checklistReading.length).toBe(2);
  });

  test("it reads no key of the run facts but the seven named", () => {
    const read = new Set<string | symbol>();
    const watched = new Proxy({ ...PLAIN_MARKDOWN, verdict: "fail", results: [] }, {
      get(target, key, receiver) {
        read.add(key);
        return Reflect.get(target, key, receiver);
      },
    });
    const reading = checklistReading(CHECKLIST, watched);
    expect([...read].every(key => RUN_FACT_KEYS.includes(String(key)))).toBe(true);
    expect(read.has("markdown")).toBe(true);
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
    expect(formatChecklistReading(checklistReading(CHECKLIST, PLAIN_MARKDOWN)).split("\n")).toEqual([
      "Part 5 checklist reading: checks can report a fault on 15 of 64 clauses (0.23), each within recorded limits.",
      "This run was set to use 12 of the 15. 1 needs the Jev route. 2 need the Jev route and --send.",
      "Of the other 49 clauses: 1 can only pass, 14 need the original version, 1 is a judgement, 33 are not read.",
      "This reading shows what the audit reads. It does not measure the document.",
    ]);
  });

  test("a run that uses every fault clause says so", () => {
    expect(formatChecklistReading(checklistReading(CHECKLIST, run({ mode: "design", send: true }))).split("\n")[1])
      .toBe("This run was set to use all 15.");
  });

  test("unused clauses are grouped by what they still need, in the order they first appear", () => {
    expect(formatChecklistReading(checklistReading(CHECKLIST, run({ markdown: false }))).split("\n")[1])
      .toBe("This run was set to use 7 of the 15. 5 need a Markdown file. 1 needs a Markdown file and the Jev route. 2 need a Markdown file, the Jev route and --send.");
    const probe = registry([{ state: "fault", needs: ["fact:audience", "before"] }, { state: "fault", needs: ["before"] }, { state: "fault", needs: ["before"] }]);
    expect(formatChecklistReading(checklistReading(probe, PLAIN_MARKDOWN)).split("\n")[1])
      .toBe("This run was set to use 0 of the 3. 1 needs the declared fact audience and the original version. 2 need the original version.");
  });

  test("a count of one takes the singular in every phrase", () => {
    const reading = checklistReading(registry([{ state: "fault" }, { state: "pass-only" }, { state: "needs-two-versions" }, { state: "not-checkable" }, { state: "not-read" }]), PLAIN_MARKDOWN);
    expect(formatChecklistReading(reading).split("\n")).toEqual([
      "Part 5 checklist reading: checks can report a fault on 1 of 5 clauses (0.20), each within recorded limits.",
      "This run was set to use all 1.",
      "Of the other 4 clauses: 1 can only pass, 1 needs the original version, 1 is a judgement, 1 is not read.",
      "This reading shows what the audit reads. It does not measure the document.",
    ]);
  });

  test("a count other than one takes the plural in every phrase", () => {
    const reading = checklistReading(registry([
      { state: "pass-only" }, { state: "pass-only" }, { state: "needs-two-versions" }, { state: "needs-two-versions" },
      { state: "not-checkable" }, { state: "not-checkable" }, { state: "not-read" }, { state: "not-read" },
    ]), PLAIN_MARKDOWN);
    expect(formatChecklistReading(reading).split("\n").slice(0, 3)).toEqual([
      "Part 5 checklist reading: checks can report a fault on 0 of 8 clauses (0.00), each within recorded limits.",
      "This run was set to use all 0.",
      "Of the other 8 clauses: 2 can only pass, 2 need the original version, 2 are judgements, 2 are not read.",
    ]);
  });

  test("a registry of one clause is named in the singular", () => {
    expect(formatChecklistReading(checklistReading(registry([{ state: "not-read" }]), PLAIN_MARKDOWN)).split("\n").slice(0, 3)).toEqual([
      "Part 5 checklist reading: checks can report a fault on 0 of 1 clause (0.00), each within recorded limits.",
      "This run was set to use all 0.",
      "Of the other 1 clause: 0 can only pass, 0 need the original version, 0 are judgements, 1 is not read.",
    ]);
  });

  test("every sentence printed for today's registry is under 30 words", () => {
    for (const facts of [PLAIN_MARKDOWN, run({ markdown: false }), run({ jevPreview: true }), run({ mode: "design" }), run({ mode: "design", send: true })]) {
      for (const sentence of formatChecklistReading(checklistReading(CHECKLIST, facts)).split(/(?<=\.)\s+|\n/)) {
        expect(sentence.split(/\s+/).filter(word => word.length > 0).length).toBeLessThan(30);
      }
    }
  });

  test("the printed reading holds no clause id", () => {
    const text = formatChecklistReading(checklistReading(CHECKLIST, run({ markdown: false })));
    for (const id of [...NEED_NOTHING, ...NEED_MARKDOWN, "15a", "15c", "15d"]) {
      expect(text).not.toContain(id);
    }
  });
});
