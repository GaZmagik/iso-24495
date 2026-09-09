// Every document this repository ships to a reader, derived from the manifests
// that ship them.
//
// Derived rather than listed, because a list is a thing an editor can quietly
// shorten. A review deleted one line from the builder's array, rebuilt the
// fixture, and then changed the document that line had covered: the test count
// never moved and the gate stayed green. Nothing here can be shortened that
// way, because nothing here is written down. Remove a skill from a manifest and
// it stops shipping, which is a different and visible act.
//
// Both the builder and the suite read this, so the fixture cannot cover less
// than the manifests declare.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Directories holding a plugin or marketplace manifest. */
const MANIFEST_DIRECTORIES = [".claude-plugin", ".codex-plugin"];

/** Documents that ship outside any manifest's declaration. */
const ALWAYS = ["README.md"];

function posix(root: string, path: string): string {
  return relative(root, path).split("\\").join("/");
}

function jsonAt(root: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, file), "utf8")) as Record<string, unknown>;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Every manifest, found rather than named, so a new one cannot be missed. */
export function manifestFiles(root: string): string[] {
  return MANIFEST_DIRECTORIES.flatMap((directory) => {
    const path = join(root, directory);
    if (!isDirectory(path)) return [];
    return readdirSync(path)
      .filter((entry) => entry.toLowerCase().endsWith(".json"))
      .map((entry) => posix(root, join(path, entry)));
  });
}

/** Each SKILL.md a manifest declares, whether it names a skill or a root. */
function declaredSkillFiles(root: string): string[] {
  const found: string[] = [];

  const record = (candidate: string): void => {
    const path = join(root, candidate, "SKILL.md");
    try {
      if (statSync(path).isFile()) found.push(posix(root, path));
    } catch {
      // A declared path without a SKILL.md ships no skill.
    }
  };

  for (const manifest of manifestFiles(root)) {
    const contents = jsonAt(root, manifest);
    const entries = [contents, ...((contents.plugins as Record<string, unknown>[]) ?? [])];
    for (const entry of entries) {
      const declared = entry?.skills;
      const paths = Array.isArray(declared)
        ? declared as string[]
        : typeof declared === "string" ? [declared] : [];
      for (const declaredPath of paths) {
        // A declaration is either one skill or a root holding several.
        record(declaredPath);
        const directory = join(root, declaredPath);
        if (!isDirectory(directory)) continue;
        for (const child of readdirSync(directory)) record(join(declaredPath, child));
      }
    }
  }
  return found;
}

/** Every file in a directory a manifest names as its output styles. */
function declaredStyleFiles(root: string): string[] {
  const found: string[] = [];
  for (const manifest of manifestFiles(root)) {
    const declared = jsonAt(root, manifest).outputStyles;
    if (typeof declared !== "string") continue;
    const directory = join(root, declared);
    if (!isDirectory(directory)) continue;
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isFile()) found.push(posix(root, path));
    }
  }
  return found;
}

/**
 * Every document whose text is pinned, in a stable order.
 *
 * The manifests are here as well as the documents they declare. They decide
 * which repository a reader installs, at which commit, and which directories
 * supply the skills and the style, so a change there changes what the reader
 * receives while every document stays untouched. A review proved that three
 * ways: it repointed the source URL, added a commit that outranks the version
 * tag, and moved the output style to a directory holding different rules.
 */
export function shippedDocuments(root: string): string[] {
  const found = new Set<string>([
    ...ALWAYS,
    ...manifestFiles(root),
    ...declaredSkillFiles(root),
    ...declaredStyleFiles(root),
  ]);
  return [...found].sort();
}
