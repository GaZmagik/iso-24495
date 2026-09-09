// Every path a manifest names, whatever field it names it in.
//
// Three reviews attacked a list of field names, and each time the list was
// short. First it read only the string form of a path and missed the array
// form. Then the two computations disagreed, because one of them knew about
// MCP servers and the other did not. Then both missed language servers, which
// the host documents alongside the fields they did know.
//
// A list of field names can only ever be as current as the host's
// documentation, and the host adds fields. So this asks no field names at all.
// It walks the manifest and takes every string in it that resolves to
// something in this repository. A path that points at a real file is a path
// this repository ships, whichever key happens to hold it, and a key invented
// tomorrow is covered today.
//
// The cost is that a string coinciding with a real path is followed even when
// it was meant as something else. That errs towards covering more, which is
// the safe direction here.
//
// The suite works this out for itself as well. Sharing was a hole of its own.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Every string anywhere in a parsed manifest. */
function strings(node: unknown, found: string[]): void {
  if (typeof node === "string") {
    found.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) { strings(item, found); }
  } else if (node !== null && typeof node === "object") {
    for (const value of Object.values(node)) { strings(value, found); }
  }
}

/** Paths named by any manifest, relative to the repository root. */
export function pathsManifestsName(root: string): string[] {
  const named: string[] = [];

  for (const directory of [".claude-plugin", ".codex-plugin"]) {
    const base = join(root, directory);
    if (!exists(base)) continue;
    for (const entry of readdirSync(base)) {
      if (!entry.toLowerCase().endsWith(".json")) continue;
      let manifest: unknown;
      try {
        manifest = JSON.parse(readFileSync(join(base, entry), "utf8"));
      } catch {
        continue;
      }
      const candidates: string[] = [];
      strings(manifest, candidates);
      for (const candidate of candidates) {
        const path = candidate.replace(/^\.\//, "").replace(/\/+$/, "");
        if (path === "" || path.includes("..")) continue;
        if (exists(join(root, path))) named.push(path);
      }
    }
  }

  return [...new Set(named)].sort();
}
