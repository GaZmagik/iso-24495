// Every file in this repository that is not TypeScript.
//
// The boundary has moved outward four times, and each move was a review showing
// that the previous one was drawn around what I had in mind rather than around
// what a reader receives. Skills, then the manifests that decide which skills
// arrive, then the references and templates a skill hands over, then the
// licence, a configuration file that starts a server, and a command hidden in a
// directory named for code. There is no version of that boundary worth
// defending, so there is no boundary now.
//
// Two things are left out, and both are named rather than described, because a
// description is a shape an attacker can stand outside of.
//
// TypeScript is left out because it changes constantly and has its own suites
// and a coverage floor. That is not a claim that code is harmless: a review
// reversed the report's certification disclaimer in code and the gate stayed
// green, so the sentences the engine prints are pinned by their own test rather
// than by this fixture.
//
// The rest is machinery that no reader receives: git's own directory, installed
// packages, the engine's cache, and a local settings file that differs on every
// machine and ships to nobody.
//
// The suite works the same set out for itself, without importing this module.
// Sharing it was a hole of its own: emptying one array here once satisfied both
// sides at once.

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Names that hold machinery rather than anything a reader is handed. */
const NOT_SHIPPED = new Set([".git", ".claude", ".iso-24495-4", "node_modules"]);

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walk(root: string, directory: string, found: Set<string>): void {
  const base = directory === "" ? root : join(root, directory);
  for (const entry of readdirSync(base)) {
    if (NOT_SHIPPED.has(entry)) continue;
    const here = directory === "" ? entry : `${directory}/${entry}`;
    if (isDirectory(join(base, entry))) {
      walk(root, here, found);
    } else if (!entry.toLowerCase().endsWith(".ts")) {
      found.add(relative(root, join(base, entry)).split("\\").join("/"));
    }
  }
}

/** Every shipped file, in a stable order. */
export function shippedDocuments(root: string): string[] {
  const found = new Set<string>();
  walk(root, "", found);
  return [...found].sort();
}
