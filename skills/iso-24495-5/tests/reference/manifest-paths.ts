// Every path a manifest names for a plugin component.
//
// A manifest decides which directories supply the skills, the commands, the
// agents and the output style, and it may name a file as readily as a
// directory, written as one string or as several. A review used each of those
// forms in turn: a style file rather than a directory, a style inside a skipped
// directory, and an array where a string was expected.
//
// The suite works these out for itself as well. They are computed twice on
// purpose, because a single computation is a single edit away from agreeing
// with itself.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The fields that point at a component, whatever a host calls them. */
const COMPONENT_FIELDS = ["skills", "outputStyles", "commands", "agents", "hooks", "mcpServers"];

function manifestDirectories(root: string): string[] {
  return [".claude-plugin", ".codex-plugin"].filter((directory) => {
    try {
      return statSync(join(root, directory)).isDirectory();
    } catch {
      return false;
    }
  });
}

/** Paths named by any manifest, relative to the repository root. */
export function pathsManifestsName(root: string): string[] {
  const named: string[] = [];

  for (const directory of manifestDirectories(root)) {
    for (const entry of readdirSync(join(root, directory))) {
      if (!entry.toLowerCase().endsWith(".json")) continue;
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(
          readFileSync(join(root, directory, entry), "utf8"),
        ) as Record<string, unknown>;
      } catch {
        continue;
      }

      const holders = [manifest, ...((manifest.plugins as Record<string, unknown>[]) ?? [])];
      for (const holder of holders) {
        for (const field of COMPONENT_FIELDS) {
          const declared = holder?.[field];
          const paths = Array.isArray(declared)
            ? declared.filter((value) => typeof value === "string") as string[]
            : typeof declared === "string" ? [declared] : [];
          named.push(...paths.map((value) => value.replace(/^\.\//, "")));
        }
      }
    }
  }

  return [...new Set(named)].sort();
}
