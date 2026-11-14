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
    // A third parameter with a default leaves the length at 2, so the type check holds the count too.
    const takesTwo: TakesExactlyTwo = true;
    expect(takesTwo).toBe(true);
  });

  test("it reads no key of the run facts but the seven named", () => {
    KEYS_READ.clear();
    const withVerdict = { ...PLAIN_MARKDOWN, verdict: "fail", results: [] };
    const watched = new Proxy<RunFacts>(withVerdict, { get: recordRead });
    const reading = checklistReading(CHECKLIST, watched);
    expect([...KEYS_READ].every(key => RUN_FACT_KEYS.includes(String(key)))).toBe(true);
    expect(KEYS_READ.has("markdown")).toBe(true);
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

// The tests below run both audits as a user would, with a stand-in for the
// transport, and pin what they print with literal lines.

const LINE_1 = "Part 5 checklist reading: checks can report a fault on 15 of 64 clauses (0.23), each within recorded limits.";
const LINE_3 = "Of the other 49 clauses: 1 can only pass, 14 need the original version, 1 is a judgement, 33 are not read.";
const LINE_4 = "This reading shows what the audit reads. It does not measure the document.";
const PLAIN_LINE_2 = "This run was set to use 12 of the 15. 1 needs the Jev route. 2 need the Jev route and --send.";
const PREVIEW_LINE_2 = "This run was set to use 13 of the 15. 2 need --send.";
const SEND_LINE_2 = "This run was set to use all 15.";
const TEXT_FILE_LINE_2 = "This run was set to use 7 of the 15. 5 need a Markdown file. 1 needs a Markdown file and the Jev route. 2 need a Markdown file, the Jev route and --send.";
const TEXT_FILE_ROUTE_LINE_2 = "This run was set to use 7 of the 15. 6 need a Markdown file. 2 need a Markdown file and --send.";

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

  // A refused document is still a Markdown file, and the design audit still
  // takes the Jev route for the run. The reading is set by the run's
  // arguments and files, so it does not change; the warning says that
  // nothing from the document is sent.
  test("a refused document gives the reading of any Markdown file", async () => {
    await inDirectory({ "tab.md": REFUSED }, async directory => {
      const preview = await designAudit([join(directory, "tab.md"), "--project-dir", directory], {});
      expect(preview.exit).toBe(0);
      expect(preview.err).toHaveLength(1);
      expect(preview.out[1]).toBe(printedReading(PREVIEW_LINE_2));
    });
  });
});

describe("a run that stops before the audit prints no reading, and keeps its exit code", () => {
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

describe("the --json report of each audit gains a checklist key, and nothing else", () => {
  const plainChecklist = {
    clauses: 64,
    reading: "0.23",
    tool: { fault: 15, passOnly: 1, needsTwoVersions: 14, notCheckable: 1, notRead: 33 },
    run: {
      used: ["1a", "3a", "3b", "6a", "8c", "12a", "12b", "12c", "13b", "15f", "17a", "19b"],
      notUsed: [{ clause: "15a", needs: ["jev-route"] }, { clause: "15c", needs: ["jev-route", "send"] }, { clause: "15d", needs: ["jev-route", "send"] }],
    },
  };

  test("the plain text audit adds it last, for a Markdown file and a .txt file", async () => {
    await inDirectory({ "doc.md": GUIDE, "doc.txt": GUIDE }, async directory => {
      const json = join(directory, "report.json");
      expect((await textAudit([join(directory, "doc.md"), "--project-dir", directory, "--json", json], {})).exit).toBe(0);
      const report = JSON.parse(readFileSync(json, "utf8"));
      expect(Object.keys(report)).toEqual(["configHash", "files", "totals", "skipped", "checklist"]);
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
      expect(Object.keys(preview)).toEqual(["mechanical", "jev", "preview", "checklist"]);
      expect(preview.checklist.run).toEqual({ used: [...plainChecklist.run.used.slice(0, 9), "15a", "15f", "17a", "19b"], notUsed: [{ clause: "15c", needs: ["send"] }, { clause: "15d", needs: ["send"] }] });
      expect((await designAudit([join(directory, "doc.md"), "--project-dir", directory, "--send", "--yes", "--json", json], stubbed(NEITHER, [], []))).exit).toBe(0);
      const sent = JSON.parse(readFileSync(json, "utf8"));
      expect(Object.keys(sent)).toEqual(["mechanical", "jev", "checklist"]);
      expect(sent.checklist.run.notUsed).toEqual([]);
      expect(sent.checklist.tool).toEqual(plainChecklist.tool);
    });
  });

  test("an empty selection and a refused document each carry the key", async () => {
    await inDirectory({ "notes.txt": GUIDE, "tab.md": REFUSED }, async directory => {
      const json = join(directory, "report.json");
      expect((await designAudit([join(directory, "tab.md"), "--project-dir", directory, "--json", json], {})).exit).toBe(0);
      const refused = JSON.parse(readFileSync(json, "utf8"));
      expect(refused.jev.notSent).toHaveLength(1);
      expect(refused.checklist.run.notUsed).toEqual([{ clause: "15c", needs: ["send"] }, { clause: "15d", needs: ["send"] }]);
      rmSync(join(directory, "tab.md"));
      expect((await designAudit([directory, "--project-dir", directory, "--json", json], {})).exit).toBe(0);
      const empty = JSON.parse(readFileSync(json, "utf8"));
      expect(Object.keys(empty.mechanical.files)).toEqual([]);
      expect(empty.checklist.run.used).toEqual(NEED_NOTHING);
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
