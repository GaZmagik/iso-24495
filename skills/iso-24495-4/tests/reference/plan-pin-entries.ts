// What the plan pin records for each document it covers. The test in
// `../lib/jev/engine.test.ts` and the builder beside this file both call it,
// so the record and the check cannot drift apart.

import { planDocument } from "../../scripts/lib/jev/engine.ts";
import { sha256 } from "../../scripts/lib/jev/catalogue.ts";
import { PLAN_SPECIMENS } from "../fixtures/plan-specimens.ts";
import { REFERENCE_SHAPES } from "../fixtures/reference-blocks.ts";

/**
 * What `planDocument` made of one document. The digest covers the whole
 * plan, every request body byte for byte; the rest shows a reader of a diff
 * which request changed.
 */
export interface PlanRecord {
  /** SHA-256 of the plan as `JSON.stringify` writes it. */
  digest: string;
  /** Each request, as its id, its kind and the state its body carries. */
  candidates: Array<{ id: string; kind: string; state: Record<string, string | number> }>;
  /** Each finding made without Jev, as its line and rule. */
  findings: string[];
}

/**
 * Every document the pin covers, by name: the specimens of
 * `plan-specimens.ts`, then the 302 documents of `reference-blocks.ts`, each
 * name prefixed with `reference: `. A reference document is its lines, each
 * ended by a line feed, as the block-structure test reads it.
 */
export function planPinDocuments(): Array<{ name: string; text: string }> {
  return [
    ...PLAN_SPECIMENS.map(specimen => ({ name: specimen.name, text: specimen.text })),
    ...REFERENCE_SHAPES.map(shape => ({ name: `reference: ${shape.name}`, text: shape.lines.map(line => `${line}\n`).join("") })),
  ];
}

/** The record of what `planDocument` makes of each covered document, by name, in the order `planPinDocuments` gives. */
export function planPinEntries(): Record<string, PlanRecord> {
  const entries: Record<string, PlanRecord> = {};
  for (const document of planPinDocuments()) {
    const plan = planDocument(document.text);
    entries[document.name] = {
      digest: sha256(JSON.stringify(plan)),
      candidates: plan.candidates.map(candidate => ({ id: candidate.id, kind: candidate.kind, state: candidate.body.state })),
      findings: plan.findings.map(finding => `${finding.line} ${finding.rule}`),
    };
  }
  return entries;
}
