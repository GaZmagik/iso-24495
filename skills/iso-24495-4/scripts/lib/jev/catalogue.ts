import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type RequestKind = "opening" | "block";
export interface Question { type: "choice" | "noul"; instructions: string | string[]; criteria: Record<string, string> }
export interface RequestBody { model: string; state: Record<string, string | number>; questions: Record<string, Question> }
export const MODEL = "jev-1.13.0";
export const CATALOGUE_DIGEST = "93128b7df08e66a131d932a8d36369aa00fa4489a98fd1dffa067b54ffa58241";
const TEMPLATE_DIGESTS = { opening: "ecf372a1dafdb7a00c97ddb823e4f5e4a6ed06ddd8ba7cea51542f7c984b0399", block: "c25950fd65014487a54c35050da0e60d6fc0b3307d3f6664b44207e74b3872bf" };

export function buildRequest(kind: RequestKind, state: Record<string, string | number>): RequestBody {
  const template = JSON.parse(readFileSync(join(import.meta.dir, "templates", `${kind}-A.json`), "utf8")) as RequestBody;
  return { model: MODEL, state: { ...state }, questions: template.questions };
}

/** The catalogue and templates are closed, reviewed inputs rather than user configuration. */
export function validateCalibration(read: (path: string) => Buffer = readFileSync): void {
  const bytes = read(join(import.meta.dir, "results-r11.json"));
  if (sha256(bytes) !== CATALOGUE_DIGEST) throw new Error("Calibration integrity failed: catalogue bytes changed.");
  // This whole-file digest closes the catalogue to precisely the three recorded gates,
  // including their dependencies, cut-offs, evidence and provenance hashes.
  for (const kind of ["opening", "block"] as const) {
    if (sha256(read(join(import.meta.dir, "templates", `${kind}-A.json`))) !== TEMPLATE_DIGESTS[kind]) throw new Error("Calibration integrity failed: template bytes changed.");
  }
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
