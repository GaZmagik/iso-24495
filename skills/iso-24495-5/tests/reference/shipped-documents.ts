// Every file in this repository that is not TypeScript, plus anything a
// manifest points at wherever it lives.
//
// The boundary has moved outward five times, and each move was a review showing
// that the previous one was drawn around what I had in mind rather than around
// what a reader receives. Skills, then the manifests that decide which skills
// arrive, then the references and templates a skill hands over, then the
// licence and a command hidden in a directory named for code, and then an
// output style declared inside a directory this file skips.
//
// That last one is why the skip list is no longer the last word. A manifest can
// name a path anywhere, and a named path ships whatever it holds, so every
// declared path is followed even into a directory otherwise passed over.
//
// Two things are left out, and both are named rather than described, because a
// description is a shape an attacker can stand outside of.
//
// TypeScript is left out because it changes constantly and has its own suites
// and a coverage floor. That is not a claim that code is harmless: a review
// reversed the report's certification disclaimer in code and the gate stayed
// green, so the sentences the engine prints are pinned by their own tests.
//
// The rest is machinery that no reader receives, unless a manifest names it.
//
// The suite works the same set out for itself, without importing this module.
// Sharing it was a hole of its own: emptying one array here once satisfied both
// sides at once.

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { pathsManifestsName } from "./manifest-paths.ts";

/** Names holding machinery, skipped unless a manifest names inside them. */
const NOT_SHIPPED = new Set([".git", ".claude", ".iso-24495-4", "node_modules"]);

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

function relativePosix(root: string, path: string): string {
  return relative(root, path).split("\\").join("/");
}

function walk(root: string, directory: string, found: Set<string>, skip: boolean): void {
  const base = directory === "" ? root : join(root, directory);
  for (const entry of readdirSync(base)) {
    if (skip && NOT_SHIPPED.has(entry)) continue;
    const path = join(base, entry);
    if (isDirectory(path)) {
      walk(root, directory === "" ? entry : `${directory}/${entry}`, found, skip);
    } else if (!entry.toLowerCase().endsWith(".ts")) {
      found.add(relativePosix(root, path));
    }
  }
}

/** Every shipped file, in a stable order. */
export function shippedDocuments(root: string): string[] {
  const found = new Set<string>();
  walk(root, "", found, true);

  // A declared path is followed whether or not the walk would have gone there.
  for (const declared of pathsManifestsName(root)) {
    const path = join(root, declared);
    if (isFile(path)) {
      found.add(relativePosix(root, path));
    } else if (isDirectory(path)) {
      walk(root, relativePosix(root, path), found, false);
    }
  }

  return [...found].sort();
}
