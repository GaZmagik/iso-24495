// Every file this repository ships to a reader or an agent.
//
// Derived by walking, not by listing. A review deleted one line from an earlier
// array, rebuilt the fixture, and changed the document that line had covered:
// the gate stayed green and the test count never moved. A walk has no line to
// delete. A file leaves this set by leaving the repository.
//
// The suite works the same set out for itself, without importing this module.
// Sharing it was a hole of its own: emptying one array here once satisfied both
// sides at once. Two computations that cannot see each other must be changed
// twice, and the second change is the one a reader notices.
//
// What is left out, and why. Test and script directories hold code, which has
// its own suites and its own coverage floor, and which changes far too often to
// pin line by line. Everything else ships as words that a reader or an agent
// acts on: the skills and their references, templates and interface files, the
// output style, the manifests that decide which of them arrive, and the README.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Directories holding code rather than words. */
const NOT_SHIPPED_AS_WORDS = new Set(["tests", "scripts", "node_modules", ".git"]);

/** Where a plugin's components live, whether or not a manifest names them. */
const COMPONENT_DIRECTORIES = [
  ".claude-plugin",
  ".codex-plugin",
  "output-styles",
  "commands",
  "agents",
  "skills",
  "codex-skills",
];

/** Files that ship on their own, outside any component directory. */
const STANDALONE = ["README.md"];

function posix(root: string, path: string): string {
  return relative(root, path).split("\\").join("/");
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function filesUnder(root: string, directory: string, found: Set<string>): void {
  const base = join(root, directory);
  if (!isDirectory(base)) return;
  for (const entry of readdirSync(base)) {
    if (NOT_SHIPPED_AS_WORDS.has(entry)) continue;
    const path = join(base, entry);
    if (isDirectory(path)) {
      filesUnder(root, join(directory, entry), found);
    } else if (isFile(path)) {
      found.add(posix(root, path));
    }
  }
}

/**
 * Directories a manifest names, which need not be the usual ones.
 *
 * A path may be written as one string or as several, and both are valid
 * configuration. Reading only the string form made the builder drop the output
 * style from an equivalent manifest, and no rebuild could put it back.
 */
function directoriesManifestsName(root: string): string[] {
  const named: string[] = [];
  for (const directory of [".claude-plugin", ".codex-plugin"]) {
    const base = join(root, directory);
    if (!isDirectory(base)) continue;
    for (const entry of readdirSync(base)) {
      if (!entry.toLowerCase().endsWith(".json")) continue;
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(readFileSync(join(base, entry), "utf8")) as Record<string, unknown>;
      } catch {
        continue;
      }
      const holders = [manifest, ...((manifest.plugins as Record<string, unknown>[]) ?? [])];
      for (const holder of holders) {
        for (const key of ["skills", "outputStyles", "commands", "agents"]) {
          const declared = holder?.[key];
          const paths = Array.isArray(declared)
            ? declared.filter((entry) => typeof entry === "string") as string[]
            : typeof declared === "string" ? [declared] : [];
          named.push(...paths);
        }
      }
    }
  }
  return named;
}

/** Every shipped file, in a stable order. */
export function shippedDocuments(root: string): string[] {
  const found = new Set<string>();

  for (const file of STANDALONE) {
    if (isFile(join(root, file))) found.add(file);
  }
  for (const directory of [...COMPONENT_DIRECTORIES, ...directoriesManifestsName(root)]) {
    filesUnder(root, directory, found);
  }

  return [...found].sort();
}
