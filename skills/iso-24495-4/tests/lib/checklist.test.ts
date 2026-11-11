import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auditText } from "../../scripts/audit-corpus.ts";
import { CHECKLIST, type Clause, type ClauseState, type Need } from "../../scripts/lib/checklist.ts";
import { calibrationEvidence, type RequestKind } from "../../scripts/lib/jev/catalogue.ts";
import { parseDecimal } from "../../scripts/lib/jev/decimal.ts";
import { classify, planDocument, type ExactAnswers } from "../../scripts/lib/jev/engine.ts";

const MODULE_PATH = join(import.meta.dir, "..", "..", "scripts", "lib", "checklist.ts");
const SKILL_PATH = join(import.meta.dir, "..", "..", "..", "iso-24495-5", "SKILL.md");
const CHECKLIST_HEADING = "## Pre-Output Self-Audit Checklist";

/** Every clause of the registry, in order. */
const CLAUSES: readonly Clause[] = CHECKLIST.flatMap(entry => entry.clauses);

/**
 * How many clauses each item holds, items 1 to 25 in order. A clause added,
 * removed or merged changes this, so the change has to be made here as well.
 */
const CLAUSES_PER_ITEM = [1, 3, 2, 1, 2, 3, 1, 4, 3, 3, 1, 3, 2, 2, 6, 3, 2, 2, 4, 3, 3, 6, 2, 1, 1];

/** How many clauses are in each state today. Moving a clause from one state to another changes this. */
const STATE_TALLY: Readonly<Record<ClauseState, number>> = {
  "fault": 14,
  "pass-only": 1,
  "not-read": 34,
  "needs-two-versions": 14,
  "not-checkable": 1,
};

/**
 * A text and the engine that must name a check when it reads that text.
 * Offline rules are read by `auditText` or `planDocument`, and Jev gates by
 * `classify` from answers written here. No request is sent.
 */
type Specimen =
  | { readonly engine: "auditText"; readonly text: string }
  | { readonly engine: "planDocument"; readonly text: string }
  | { readonly engine: "classify"; readonly kind: RequestKind; readonly answers: ExactAnswers };

/** Six level-2 sections with no contents and no overview. */
const SIX_SECTIONS = "# Guide\n\nVersion: 1.0\n\n" + ["One", "Two", "Three", "Four", "Five", "Six"].map(name => `## ${name}\n\nText.\n`).join("\n");

/** Purpose answers that fail an opening and give the diagnosis neither. */
const NO_PURPOSE: ExactAnswers = {
  purpose: { both: parseDecimal("0.04"), task_only: parseDecimal("0.04"), scope_only: parseDecimal("0.04"), neither: parseDecimal("0.88") },
};

/** One specimen for each check the registry names, keyed by the check's name. */
const SPECIMENS: Readonly<Record<string, Specimen>> = {
  "heading-depth": { engine: "auditText", text: "# Title\n\n##### Too deep\n\nText.\n" },
  "contents-list": { engine: "auditText", text: SIX_SECTIONS },
  "prose-enumeration": { engine: "auditText", text: "First, open the box. Second, lift the lid. Third, read the note.\n" },
  "bullet-depth": { engine: "auditText", text: "- One\n  - Two\n    - Three\n" },
  "link-text": { engine: "auditText", text: "Read the guide [here](https://example.org/guide).\n" },
  "image-alt": { engine: "auditText", text: "![](picture.png)\n" },
  "table-header": { engine: "auditText", text: "| Name | |\n|---|---|\n| Ann | 4 |\n" },
  "overview-label": { engine: "auditText", text: SIX_SECTIONS },
  "opening-version-date": { engine: "auditText", text: "# Title\n\nText.\n" },
  "opening-title": { engine: "planDocument", text: "Text with no title.\n" },
  "purpose:fail": { engine: "classify", kind: "opening", answers: NO_PURPOSE },
  "purpose:diagnosis:neither": { engine: "classify", kind: "opening", answers: NO_PURPOSE },
  "colour_only:pass": { engine: "classify", kind: "block", answers: { colour_only: parseDecimal("0.01") } },
};

/** The order in which a clause's needs are written. */
const NEED_ORDER: readonly Need[] = ["markdown", "design", "send", "before"];

/**
 * The checklist lines of the Part 5 skill: each line that opens a check box,
 * from the checklist heading to the next heading.
 *
 * @throws An `Error` when the skill has no checklist heading.
 */
function skillChecklistLines(): string[] {
  const lines = readFileSync(SKILL_PATH, "utf8").split(/\r?\n/);
  const start = lines.indexOf(CHECKLIST_HEADING);
  if (start === -1) throw new Error(`The Part 5 skill has no line "${CHECKLIST_HEADING}".`);
  const after = lines.slice(start + 1);
  const end = after.findIndex(line => /^#{1,6} /.test(line));
  return (end === -1 ? after : after.slice(0, end)).filter(line => line.startsWith("- [ ]"));
}

/**
 * What a run must have for the engine of a specimen to name its check, as
 * measured on the specimen where the engine allows it.
 *
 * `auditText` is run with and without Markdown: a rule that fires without it
 * needs nothing, and one that fires only with it needs Markdown. The design
 * audit plans only Markdown files, and `classify` reads only answers sent by
 * the design audit, so those needs are stated rather than measured.
 */
function measuredNeeds(rule: string, specimen: Specimen): Need[] {
  if (specimen.engine === "auditText") {
    return auditText(specimen.text).some(finding => finding.rule === rule) ? [] : ["markdown"];
  }
  if (specimen.engine === "planDocument") return ["markdown", "design"];
  return ["markdown", "design", "send"];
}

/**
 * The check names an engine gives for a specimen.
 *
 * A Jev gate is named as the calibration record names it: the question
 * answered, a colon and the band, or the identifier of a diagnosis gate.
 */
function namedChecks(specimen: Specimen): string[] {
  if (specimen.engine === "auditText") return auditText(specimen.text, { markdown: true }).map(finding => finding.rule);
  if (specimen.engine === "planDocument") return planDocument(specimen.text).findings.map(finding => finding.rule);
  const decision = classify(specimen.kind, specimen.answers);
  const questions = Object.keys(specimen.answers);
  return [...questions.map(question => `${question}:${decision.band}`), ...(decision.diagnosisGate === undefined ? [] : [decision.diagnosisGate.id])];
}

/** Every check name the registry uses, once each, sorted. */
function registryCheckNames(): string[] {
  return [...new Set(CLAUSES.flatMap(clause => clause.checks.map(check => check.rule)))].sort();
}

/** Whether a value holds only text, numbers, lists and plain objects, at any depth. */
function isPlainData(value: unknown): boolean {
  if (typeof value === "string" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.every(isPlainData);
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every(isPlainData);
}

describe("the Part 5 checklist clause registry", () => {
  test("holds every checklist line of the Part 5 skill, word for word and in order", () => {
    const lines = skillChecklistLines();
    expect(lines).toHaveLength(25);
    expect(CHECKLIST.map(entry => entry.line)).toEqual(lines);
    expect(CHECKLIST.map(entry => entry.item)).toEqual(lines.map((line, index) => index + 1));
  });

  test("splits each item into its agreed number of clauses, lettered in order", () => {
    expect(CHECKLIST.map(entry => entry.clauses.length)).toEqual(CLAUSES_PER_ITEM);
    for (const entry of CHECKLIST) {
      expect(entry.clauses.map(clause => clause.id)).toEqual(entry.clauses.map((clause, index) => `${entry.item}${"abcdefghij".charAt(index)}`));
    }
    expect(CLAUSES).toHaveLength(64);
  });

  test("every named check fires on its specimen", () => {
    for (const [rule, specimen] of Object.entries(SPECIMENS)) {
      expect(namedChecks(specimen), `${rule} did not fire on its specimen`).toContain(rule);
    }
  });

  test("a Jev gate is one the calibration record holds, at the cut-off the classifier applies", () => {
    const evidence = new Map(calibrationEvidence().map(gate => [gate.id, gate.cutOff]));
    for (const check of CLAUSES.flatMap(clause => clause.checks).filter(found => found.kind === "jev")) {
      const specimen = SPECIMENS[check.rule];
      if (specimen?.engine !== "classify") throw new Error(`${check.rule} has no classifier specimen.`);
      const decision = classify(specimen.kind, specimen.answers);
      const cutOff = decision.diagnosisGate?.id === check.rule ? decision.diagnosisGate.cutOff : decision.cutOff;
      expect(evidence.get(check.rule), check.rule).toBe(cutOff);
    }
  });

  test("the specimens and the registry name the same checks, of the same kind", () => {
    expect(Object.keys(SPECIMENS).sort()).toEqual(registryCheckNames());
    for (const check of CLAUSES.flatMap(clause => clause.checks)) {
      expect(SPECIMENS[check.rule]?.engine === "classify", check.rule).toBe(check.kind === "jev");
    }
  });

  test("each clause's needs are what its checks were measured to need", () => {
    for (const clause of CLAUSES) {
      const needs = new Set(clause.checks.flatMap(check => {
        const specimen = SPECIMENS[check.rule];
        return specimen === undefined ? [] : measuredNeeds(check.rule, specimen);
      }));
      expect(clause.needs, clause.id).toEqual(NEED_ORDER.filter(need => needs.has(need)));
    }
  });

  test("a clause names a check exactly when its state says one can report on it", () => {
    for (const clause of CLAUSES) {
      const reported = clause.state === "fault" || clause.state === "pass-only";
      expect(clause.checks.length > 0, `${clause.id} is ${clause.state}`).toBe(reported);
      if (!reported) expect([...clause.needs, ...clause.limits], clause.id).toEqual([]);
    }
  });

  test("the states tally to every clause, with today's count in each", () => {
    const tally: Record<ClauseState, number> = { "fault": 0, "pass-only": 0, "not-read": 0, "needs-two-versions": 0, "not-checkable": 0 };
    for (const clause of CLAUSES) {
      tally[clause.state] += 1;
    }
    expect(tally).toEqual(STATE_TALLY);
    expect(Object.values(tally).reduce((sum, count) => sum + count, 0)).toBe(CLAUSES.length);
  });

  test("no Jev answer can reach the registry: the module imports nothing and holds only data", () => {
    const source = readFileSync(MODULE_PATH, "utf8");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\b/m);
    expect(source).not.toMatch(/\b(?:require|import)\s*\(/);
    expect(isPlainData(CHECKLIST)).toBe(true);
  });

  test("the data check refuses a function, a class instance and an empty value", () => {
    expect(isPlainData([{ rule: "x", run: () => 1 }])).toBe(false);
    expect(isPlainData(new Date(0))).toBe(false);
    expect(isPlainData(null)).toBe(false);
    expect(isPlainData(true)).toBe(false);
  });
});
