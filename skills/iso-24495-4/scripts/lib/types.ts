// Shared types and the maturity criteria catalogue. The catalogue mirrors
// references/maturity-model.md. Change both together.
//
// Each type a command reads back from a file has its shape stated below it. A
// type is a promise the compiler cannot keep about a file, so the command
// checks the shape before it treats the value as the type. Change a type and
// its shape together.

import type { Shape } from "./json-shape.ts";

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

const COUNT: Shape = { kind: "whole", least: 0 };
const TEXT: Shape = { kind: "text" };

/** What `audit-corpus-cli.ts --json` writes. A member it does not name is passed over. */
export const FINDINGS_SHAPE: Shape = {
  kind: "object",
  required: {
    configHash: TEXT,
    files: {
      kind: "map",
      member: {
        kind: "object",
        required: {
          violations: { kind: "list", item: { kind: "object", required: { rule: TEXT, line: COUNT, detail: TEXT } } },
        },
      },
    },
    totals: { kind: "map", member: COUNT },
  },
};

/** What `audit-evidence-cli.ts --json` writes. */
export const EVIDENCE_SHAPE: Shape = {
  kind: "object",
  required: {
    artefacts: {
      kind: "map",
      member: { kind: "object", required: { found: { kind: "flag" }, paths: { kind: "list", item: TEXT } } },
    },
  },
};

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

/** The highest level any dimension of the catalogue can hold. */
const TOP_LEVEL = Math.max(...Object.values(MATURITY_MODEL).map((levels) => levels.length));

/**
 * What `score-maturity-cli.ts --json` writes: every dimension of the catalogue
 * and no other, each at a level its own criteria allow.
 */
export const MATURITY_SHAPE: Shape = {
  kind: "object",
  required: {
    dimensions: {
      kind: "object",
      required: Object.fromEntries(Object.entries(MATURITY_MODEL).map(([dimension, levels]) => [dimension, {
        kind: "object",
        required: { level: { kind: "whole", least: 0, most: levels.length }, missing: { kind: "list", item: TEXT } },
      }])),
      closed: true,
    },
    overall: { kind: "whole", least: 0, most: TOP_LEVEL },
  },
};

/** The audit history `generate-report-cli.ts --state` keeps. */
export const STATE_SHAPE: Shape = {
  kind: "object",
  required: {
    snapshots: {
      kind: "list",
      item: {
        kind: "object",
        required: {
          timestamp: TEXT,
          totals: { kind: "map", member: COUNT },
          overall: { kind: "whole", least: 0, most: TOP_LEVEL },
        },
      },
    },
  },
};
