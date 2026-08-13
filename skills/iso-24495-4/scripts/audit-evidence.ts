// Process-artefact sweep: the PRIMARY audit for Part 4. Detects the presence
// of organisational plain language systems. It records presence and paths
// only. Evaluating artefact quality is the agent's job, with the human.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Evidence } from "./lib/types.ts";

export const CATEGORIES = [
  "policy",
  "review-workflow",
  "automated-checks",
  "training",
  "glossary",
] as const;

function walk(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, root, out);
    } else {
      out.push(relative(root, full).replaceAll("\\", "/"));
    }
  }
}

function matchCategory(category: string, path: string, root: string): boolean {
  const name = path.toLowerCase();
  switch (category) {
    case "policy":
      return /(plain[-_ ]?language[-_ ]?policy|style[-_ ]?guide)/.test(name);
    case "review-workflow":
      return /pull_request_template|review[-_ ]?(process|workflow|checklist)/.test(name);
    case "automated-checks":
      if (/\.vale\.ini$|\.textlintrc/.test(name)) return true;
      if (/workflows\/.*\.(yml|yaml)$/.test(name)) {
        const content = readFileSync(join(root, path), "utf8").toLowerCase();
        return /(vale|textlint|prose|lint)/.test(content);
      }
      return false;
    case "training":
      return /(^|\/)(training|onboarding)\//.test(name);
    case "glossary":
      return /glossary|terminology/.test(name);
    default:
      return false;
  }
}

export function auditEvidence(dir: string): Evidence {
  const paths: string[] = [];
  walk(dir, dir, paths);
  const evidence: Evidence = { artefacts: {} };
  for (const category of CATEGORIES) {
    const matched = paths.filter((p) => matchCategory(category, p, dir)).sort();
    evidence.artefacts[category] = { found: matched.length > 0, paths: matched };
  }
  return evidence;
}

export function runCli(
  argv: string[],
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): number {
  const dir = argv[2];
  if (!dir) {
    stderr("Usage: bun audit-evidence.ts <workspace-dir> [--json <out-file>]");
    return 2;
  }
  const jsonFlag = argv.indexOf("--json");
  if (jsonFlag !== -1 && !argv[jsonFlag + 1]) {
    stderr("audit-evidence: --json requires an output file");
    return 2;
  }
  try {
    const evidence = auditEvidence(dir);
    if (jsonFlag !== -1) {
      writeFileSync(argv[jsonFlag + 1], JSON.stringify(evidence, null, 2));
    }
    stdout("| Artefact category | Found | Paths |");
    stdout("|-------------------|-------|-------|");
    for (const category of CATEGORIES) {
      const { found, paths } = evidence.artefacts[category];
      stdout(`| ${category} | ${found ? "yes" : "no"} | ${paths.join("<br>") || "-"} |`);
    }
    return 0;
  } catch (error) {
    stderr(`audit-evidence: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// Coverage exemption: logic-free process entry shim.
if (import.meta.main) {
  const exitCode = runCli(process.argv, console.log, console.error);
  process.exit(exitCode);
}
