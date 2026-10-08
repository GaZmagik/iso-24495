// Process-artefact sweep: the PRIMARY audit for Part 4. Detects the presence
// of organisational plain language systems. It records presence and paths
// only. Evaluating artefact quality is the agent's job, with the human.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathFailure, writeTextFile } from "./lib/failure.ts";
import type { Evidence } from "./lib/types.ts";

/**
 * Sweeps a workspace for plain language artefacts and prints what it found.
 *
 *   bun audit-evidence-cli.ts <workspace-dir> [--json <out-file>]
 *
 * `--json` also writes the evidence to that file, replacing it.
 *
 * Exit 0 means the sweep ran, whatever it found. Exit 1 means the workspace
 * could not be read in full or the evidence file could not be written. Exit 2
 * means the arguments were wrong.
 *
 * @param argv The whole command line, so the workspace is at index 2.
 * @param stdout Receives the table, one line at a time.
 * @param stderr Receives the usage line or the reason for exit 1 or 2.
 */
export function runCli(
  argv: string[],
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): number {
  const dir = argv[2];
  if (!dir) {
    stderr("Usage: bun audit-evidence-cli.ts <workspace-dir> [--json <out-file>]");
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
      const problem = writeTextFile(argv[jsonFlag + 1], JSON.stringify(evidence, null, 2), "--json");
      if (problem !== null) {
        stderr(`audit-evidence: ${problem}`);
        return 1;
      }
    }
    stdout("| Artefact category | Found | Paths |");
    stdout("|-------------------|-------|-------|");
    for (const category of CATEGORIES) {
      const { found, paths } = evidence.artefacts[category];
      stdout(`| ${category} | ${found ? "yes" : "no"} | ${paths.join("<br>") || "-"} |`);
    }
    return 0;
  } catch (error) {
    // The report is written without throwing, so the sweep is the only work
    // here that touches a file, and every file it touches is under `dir`.
    stderr(`audit-evidence: ${pathFailure(error, dir, "<workspace-dir>", "cannot be read in full")}`);
    return 1;
  }
}

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

/**
 * Which plain language artefacts a workspace holds, by category.
 *
 * A file is matched by its path alone, so its presence is recorded and its
 * quality is not judged. The one exception is a workflow file, which is read
 * to see whether it names a prose checker. `node_modules` and `.git` are not
 * entered.
 *
 * @param dir The workspace to walk, at any depth. Links are followed, and
 *     nothing guards against one that forms a cycle.
 * @returns An entry for every name in `CATEGORIES`, each with the matching
 *     paths from `dir`, sorted, with forward slashes. A category with no
 *     match has `found: false` and no paths, which is the result for an empty
 *     workspace.
 * @throws The file system error when `dir`, or anything beneath it, cannot be
 *     read. A dangling link is such a case, and nothing is skipped.
 */
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
