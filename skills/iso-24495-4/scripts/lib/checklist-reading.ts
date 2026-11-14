// The Part 5 checklist reading: how many clauses of the checklist the audit's
// checks can report a fault on, and how many of those one run was set to use.
// It is a reading of progress, not a score, and it measures no document.
//
// It reads the registry and the facts of the run, and nothing else. A report,
// a Jev verdict or any answer has no way in, so two sends that Jev answers
// differently print the same reading. A run's facts are known before any
// request is made.

import type { ChecklistItem, ClauseState, Need } from "./checklist.ts";
import { itemAt } from "./item-at.ts";

/**
 * Reads the registry against the facts of one run.
 *
 * The tool reading counts the clauses in each state, and gives the clauses
 * in the fault state over all clauses, to two decimals. It is the same for
 * every run and every document.
 *
 * The this-run reading lists the fault clauses whose needs the run meets,
 * and each other fault clause with the needs it does not meet:
 *
 * - `markdown` is met when the run read at least one Markdown file.
 * - `jev-route` is met by the design audit, and by the text audit with
 *   `--jev-preview`, or with `--jev` and `--send` together.
 * - `send` is met by the design audit with `--send`, and by the text audit
 *   with `--jev` and `--send` together.
 * - `before` is met when the original version was given.
 * - `fact:<name>` is met when the author declared that fact.
 *
 * @param registry The checklist, item by item, as `CHECKLIST` holds it.
 * @param run The facts of the run, read from its arguments and its files.
 * @returns The reading, in the shape a `--json` report writes it. Ids are
 *     in registry order, and each unmet need in the order its clause names it.
 * @throws A `RangeError` when the registry holds no clause, because a share
 *     of nothing has no value.
 */
export function checklistReading(registry: readonly ChecklistItem[], run: RunFacts): ChecklistReading {
  const clauses = registry.flatMap(item => item.clauses);
  if (clauses.length === 0) throw new RangeError("The registry holds no clause.");
  const tool: StateCounts = { fault: 0, passOnly: 0, needsTwoVersions: 0, notCheckable: 0, notRead: 0 };
  const used: string[] = [];
  const notUsed: Array<{ clause: string; needs: Need[] }> = [];
  for (const clause of clauses) {
    tool[stateKey(clause.state)]++;
    if (clause.state !== "fault") continue;
    const unmetNeeds = clause.needs.filter(need => !meets(need, run));
    if (unmetNeeds.length === 0) {
      used.push(clause.id);
    } else {
      notUsed.push({ clause: clause.id, needs: unmetNeeds });
    }
  }
  return { clauses: clauses.length, reading: twoDecimals(tool.fault, clauses.length), tool, run: { used, notUsed } };
}

/**
 * The reading as four lines of plain words: what the checks can report on,
 * what this run was set to use and what the rest still need, what the other
 * clauses are, and that the reading does not measure the document.
 *
 * Unused clauses are counted by the needs they still lack, grouped in the
 * order each group first appears. No clause id is printed.
 *
 * @returns The four lines joined by line breaks.
 */
export function formatChecklistReading(reading: ChecklistReading): string {
  const { tool } = reading;
  const others = reading.clauses - tool.fault;
  return [
    `Part 5 checklist reading: checks can report a fault on ${tool.fault} of ${reading.clauses} ${reading.clauses === 1 ? "clause" : "clauses"} (${reading.reading}), each within recorded limits.`,
    runLine(reading),
    `Of the other ${others} ${others === 1 ? "clause" : "clauses"}: ${tool.passOnly} can only pass, ${tool.needsTwoVersions} ${tool.needsTwoVersions === 1 ? "needs" : "need"} the original version, `
      + `${tool.notCheckable} ${tool.notCheckable === 1 ? "is a judgement" : "are judgements"}, ${tool.notRead} ${tool.notRead === 1 ? "is" : "are"} not read.`,
    "This reading shows what the audit reads. It does not measure the document.",
  ].join("\n");
}

/**
 * What one run is: its mode and what its arguments and files give it. Each
 * is known before any request is made, and none comes from a report or an
 * answer.
 */
export interface RunFacts {
  readonly mode: "text" | "design";
  /** At least one file the run read ends in .md or .markdown. */
  readonly markdown: boolean;
  readonly jevPreview: boolean;
  readonly jev: boolean;
  readonly send: boolean;
  /** The original version of a restructured document was given. No option gives it today. */
  readonly before: boolean;
  /** The names of the facts the author declared. None can be declared today. */
  readonly facts: readonly string[];
}

/**
 * The reading of one run, as the `checklist` key of a `--json` report holds
 * it.
 *
 * - `clauses`: every clause of the registry.
 * - `reading`: the fault clauses over every clause, to two decimals.
 * - `tool`: how many clauses are in each state.
 * - `run.used`: the fault clauses whose needs the run meets.
 * - `run.notUsed`: every other fault clause, with the needs the run does not meet.
 */
export interface ChecklistReading {
  clauses: number;
  reading: string;
  tool: StateCounts;
  run: { used: string[]; notUsed: Array<{ clause: string; needs: Need[] }> };
}

/** How many clauses are in each state, by the state's name in a JSON report. */
export interface StateCounts { fault: number; passOnly: number; needsTwoVersions: number; notCheckable: number; notRead: number }

/** The key of `StateCounts` that counts a state. */
function stateKey(state: ClauseState): keyof StateCounts {
  if (state === "pass-only") return "passOnly";
  if (state === "needs-two-versions") return "needsTwoVersions";
  if (state === "not-checkable") return "notCheckable";
  if (state === "not-read") return "notRead";
  return "fault";
}

/** Whether the run meets one need, as `checklistReading` sets out. */
function meets(need: Need, run: RunFacts): boolean {
  if (need === "markdown") return run.markdown;
  if (need === "jev-route") return run.mode === "design" || run.jevPreview || (run.jev && run.send);
  if (need === "send") return run.send && (run.mode === "design" || run.jev);
  if (need === "before") return run.before;
  return run.facts.includes(need.slice("fact:".length));
}

/**
 * `part` over `whole` to two decimals, a half rounding up. The arithmetic is
 * on whole numbers, so no binary fraction can tip a value the wrong way.
 */
function twoDecimals(part: number, whole: number): string {
  const hundredths = Math.floor((200 * part + whole) / (2 * whole));
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** The second line: how many fault clauses the run was set to use, and what the others still need. */
function runLine(reading: ChecklistReading): string {
  const fault = reading.tool.fault;
  if (reading.run.notUsed.length === 0) return `This run was set to use all ${fault}.`;
  const groups = new Map<string, { needs: Need[]; count: number }>();
  for (const entry of reading.run.notUsed) {
    const key = entry.needs.join(" ");
    const group = groups.get(key) ?? { needs: entry.needs, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  const sentences = [...groups.values()].map(group => `${group.count} ${group.count === 1 ? "needs" : "need"} ${listed(group.needs.map(needWords))}.`);
  return [`This run was set to use ${reading.run.used.length} of the ${fault}.`, ...sentences].join(" ");
}

/** What a need asks of a run, in the words a reader would act on. */
function needWords(need: Need): string {
  if (need === "markdown") return "a Markdown file";
  if (need === "jev-route") return "the Jev route";
  if (need === "send") return "--send";
  if (need === "before") return "the original version";
  return `the declared fact ${need.slice("fact:".length)}`;
}

/** Phrases joined as a list is read: "a", "a and b", "a, b and c". */
function listed(phrases: readonly string[]): string {
  if (phrases.length === 1) return itemAt(phrases, 0);
  return `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
}
