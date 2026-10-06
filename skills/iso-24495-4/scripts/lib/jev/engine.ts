import { headings, readDocument, readerProseBlocks } from "../parse.ts";
import { buildRequest } from "./catalogue.ts";
import { compare, decimalText, ONE, parseDecimal, subtract, type Decimal } from "./decimal.ts";
import type { RequestBody, RequestKind } from "./catalogue.ts";

export { buildRequest } from "./catalogue.ts";

export interface Candidate {
  id: string;
  line: number;
  kind: RequestKind;
  body: RequestBody;
}
export interface LocalFinding { line: number; rule: string; detail: string }
export interface DocumentPlan { candidates: Candidate[]; findings: LocalFinding[] }
export interface Decision {
  rule: "opening-purpose" | "colour-only";
  band: "pass" | "fail" | "unsure";
  score: string;
  cutOff: string;
  diagnosis?: "neither";
  diagnosisGate?: { id: "purpose:diagnosis:neither"; score: string; cutOff: "0.83"; prerequisite: "purpose:fail" };
}
export type ExactAnswers = Record<string, Decimal | Record<string, Decimal>>;

/**
 * What a Jev audit would ask about one Markdown document: one request for the
 * opening under its title, and one for each block of prose.
 *
 * The extraction preserves the one the calibration used, for openings and
 * blocks alike, including source lines. Prose in the opening is planned
 * twice: once in the opening request and again as blocks.
 *
 * @param text The whole document. A leading "---" block is read as front
 *     matter, and no option changes that.
 * @returns `candidates` holds the opening first, then the blocks in document
 *     order, each with a request body ready to send and the line it starts
 *     on, counted from 1. Without a level-1 heading there is no opening
 *     candidate, and `findings` holds one `opening-title` finding; the blocks
 *     are planned all the same. Empty text gives that finding and no
 *     candidates.
 * @throws Whatever `buildRequest` throws when a template cannot be read.
 */
export function planDocument(text: string): DocumentPlan {
  const document = readDocument(text);
  const found = headings(text);
  const titleIndex = found.findIndex(heading => heading.level === 1);
  const candidates: Candidate[] = [];
  const findings: LocalFinding[] = [];
  if (titleIndex < 0) {
    findings.push({ line: 1, rule: "opening-title", detail: "Add a level-1 document title. Purpose assessment is skipped without one." });
  } else {
    const title = found[titleIndex];
    const from = title.line - 1 + title.lines + (title.setext ? 1 : 0);
    const to = found[titleIndex + 1]?.line === undefined ? document.lines.length : found[titleIndex + 1].line - 1;
    const body = document.lines.slice(from, to).filter((line, offset) => !document.hidden(from + offset)
      && !/^\s*>[\s>]*$/.test(line) && !/^[\s>]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)).join("\n").trim();
    candidates.push({ id: `${title.line}:opening`, line: title.line, kind: "opening", body: buildRequest("opening", { opening: `# ${title.text}\n\n${body}`.trim() }) });
  }
  for (const block of readerProseBlocks(text)) {
    const paragraph = block.lines.join(" ").replace(/\s+/g, " ").trim();
    if (paragraph === "") continue;
    candidates.push({ id: `${block.line}:block`, line: block.line, kind: "block", body: buildRequest("block", { paragraph }) });
  }
  return { candidates, findings };
}

/**
 * The calibrated decision for one answered request.
 *
 * A block can pass or stay unsure, and never fails: it passes when 1 less the
 * `colour_only` probability is at least 0.83. An opening can fail or stay
 * unsure, and never passes: it fails when 1 less the `both` probability of
 * `purpose` is at least 0.87. A failed opening also carries the diagnosis
 * "neither" when that option outscores `task_only` and `scope_only` and is
 * at least 0.83.
 *
 * Gate comparisons use the exact number tokens, never rounded display values.
 *
 * @param answers The answers `readAnswers` returned for the template of this
 *     kind: `colour_only` for a block, and `purpose` with its four options
 *     for an opening.
 * @returns The rule, the band, and the score and cut-off as exact decimal
 *     text.
 * @throws A `TypeError` when the answer this kind needs is absent.
 */
export function classify(kind: RequestKind, answers: ExactAnswers): Decision {
  if (kind === "block") {
    const score = subtract(ONE, answers.colour_only as Decimal);
    return { rule: "colour-only", band: compare(score, parseDecimal("0.83")) >= 0 ? "pass" : "unsure", score: decimalText(score), cutOff: "0.83" };
  }
  const probabilities = answers.purpose as Record<string, Decimal>;
  const score = subtract(ONE, probabilities.both);
  const decision: Decision = { rule: "opening-purpose", band: compare(score, parseDecimal("0.87")) >= 0 ? "fail" : "unsure", score: decimalText(score), cutOff: "0.87" };
  let best = "task_only";
  for (const option of ["task_only", "scope_only", "neither"]) {
    if (compare(probabilities[option], probabilities[best]) > 0) best = option;
  }
  if (decision.band === "fail" && best === "neither" && compare(probabilities.neither, parseDecimal("0.83")) >= 0) {
    decision.diagnosis = "neither";
    decision.diagnosisGate = { id: "purpose:diagnosis:neither", score: decimalText(probabilities.neither), cutOff: "0.83", prerequisite: "purpose:fail" };
  }
  return decision;
}
