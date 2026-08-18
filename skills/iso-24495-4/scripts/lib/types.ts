// Shared types and the maturity criteria catalogue. The catalogue mirrors
// references/maturity-model.md. Change both together.

export interface Violation {
  rule: string;
  line: number;
  detail: string;
}

export interface Findings {
  configHash: string;
  files: Record<string, { violations: Violation[] }>;
  totals: Record<string, number>;
}

export interface Evidence {
  artefacts: Record<string, { found: boolean; paths: string[] }>;
}

export interface Maturity {
  dimensions: Record<string, { level: number; missing: string[] }>;
  overall: number;
}

export interface Snapshot {
  timestamp: string;
  totals: Record<string, number>;
  overall: number;
}

export interface AuditState {
  snapshots: Snapshot[];
}

/**
 * Criteria per dimension, ordered by level (index 0 = level 1). A dimension
 * holds a level only when every criterion at that level and below is met.
 */
export const MATURITY_MODEL: Record<string, string[][]> = {
  governance: [
    ["policy-documented"],
    ["owner-accountable"],
    ["resourced-mandated"],
    ["executive-review-cycle"],
  ],
  capability: [
    ["style-guide-available"],
    ["training-delivered"],
    ["competence-maintained"],
    ["roles-embedded"],
  ],
  process: [
    ["review-step-exists"],
    ["checks-in-workflow"],
    ["signoff-gates"],
    ["all-document-types-covered"],
  ],
  measurement: [
    ["corpus-baseline-taken"],
    ["regular-sampling"],
    ["user-testing"],
    ["metrics-drive-decisions"],
  ],
  culture: [
    ["leadership-aware"],
    ["leadership-champions"],
    ["feedback-loops"],
    ["improvement-cycles"],
  ],
};
