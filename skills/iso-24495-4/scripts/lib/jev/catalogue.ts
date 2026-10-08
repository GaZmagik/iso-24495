import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type RequestKind = "opening" | "block";
export interface Question { type: "choice" | "noul"; instructions: string | string[]; criteria: Record<string, string> }
export interface RequestBody { model: string; state: Record<string, string | number>; questions: Record<string, Question> }
export interface GateEvidence { id: string; cutOff: string; dependencies: string[]; clusters: number; wrong: number; bound: string }
export const MODEL = "jev-1.13.0";
export const CATALOGUE_DIGEST = "264f2270f881d99751ef13085f70da7f8a8917caa63abb859b38a7582674d538";
const TEMPLATE_DIGESTS = { opening: "ecf372a1dafdb7a00c97ddb823e4f5e4a6ed06ddd8ba7cea51542f7c984b0399", block: "c25950fd65014487a54c35050da0e60d6fc0b3307d3f6664b44207e74b3872bf" };

/**
 * The request body for one opening or one block: the pinned model, a copy of
 * `state`, and the questions of the arm A template for that kind.
 *
 * The template is read from disk on every call and its digest is not checked
 * here. Run `validateCalibration` first where the bytes must be the reviewed
 * ones.
 *
 * @param state The text the questions read: `opening` for an opening and
 *     `paragraph` for a block. It is copied, and its fields are not checked.
 * @throws The file system error when the template is missing, and a
 *     `SyntaxError` when it is not JSON.
 */
export function buildRequest(kind: RequestKind, state: Record<string, string | number>): RequestBody {
  const template = JSON.parse(readFileSync(join(import.meta.dir, "templates", `${kind}-A.json`), "utf8")) as RequestBody;
  return { model: MODEL, state: { ...state }, questions: template.questions };
}

/**
 * Return the recorded gate evidence from the integrity-checked catalogue.
 *
 * @returns One entry for each gate in `results-r11.json`, read from disk on
 *     every call.
 * @throws Whatever `validateCalibration` throws, which runs first.
 */
export function calibrationEvidence(): GateEvidence[] {
  validateCalibration();
  return JSON.parse(readFileSync(join(import.meta.dir, "results-r11.json"), "utf8")).gates;
}

/**
 * Checks that the catalogue and both arm A templates still hold the bytes
 * that were reviewed, and returns nothing when they do.
 *
 * The catalogue and templates are closed, reviewed inputs rather than user configuration.
 *
 * @param read Replaces the file reader. It is given the full path of each of
 *     the three files beside this module.
 * @throws An `Error` saying whether the catalogue or a template changed. The
 *     error from `read` when a file is missing.
 */
export function validateCalibration(read: (path: string) => Buffer = readFileSync): void {
  const bytes = read(join(import.meta.dir, "results-r11.json"));
  if (sha256(bytes) !== CATALOGUE_DIGEST) throw new Error("Calibration integrity failed: catalogue bytes changed.");
  // This whole-file digest closes the catalogue to precisely the three recorded gates,
  // including their dependencies, cut-offs, evidence and provenance hashes.
  for (const kind of ["opening", "block"] as const) {
    if (sha256(read(join(import.meta.dir, "templates", `${kind}-A.json`))) !== TEMPLATE_DIGESTS[kind]) throw new Error("Calibration integrity failed: template bytes changed.");
  }
}

/**
 * The SHA-256 digest of the bytes, as 64 lower-case hexadecimal characters.
 * Text is hashed as UTF-8. Empty input has a digest like any other.
 */
export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
