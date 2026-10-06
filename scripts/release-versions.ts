// Every place that carries the release version, and the check that they agree.
//
// Twelve places carry the version between them: both plugin manifests, the
// marketplace entry's version and the `ref` in its source object, and every
// skill's `metadata.version`. Moving some but not all of them has reached users.
// The 0.6.1 release missed `.codex-plugin/plugin.json`, and a forgotten `ref`
// once left users installing the previous release, because installs pin to the
// tag the `ref` names.
//
// The checks run in three stages, and each asks this module, so the stages
// cannot disagree about what "agree" means:
//
//   1. Every gate run: `checkVersionSites` requires every site to name the same
//      version and the changelog to record it. It reads no tags, so a checkout
//      of a release that is already tagged still passes.
//   2. Before tagging, by hand: `bun scripts/release-preflight-cli.ts` adds the
//      release history from `origin`, and requires the version to be later than
//      every release and its tag to be free. That stage is `release-preflight.ts`.
//   3. On a pushed tag: `.github/workflows/release-tag.yml` runs
//      `bun scripts/release-tag-cli.ts <tag>`, which requires the tag to name
//      the version every site declares. That stage is `release-tag.ts`.
//
// Stage 1 is this module. Stages 2 and 3 import it, and it imports neither.
// The two patterns that say what a version and a release tag look like are
// exported for the same reason as the check: one definition, read by all three.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { safeText } from "../skills/iso-24495-4/scripts/lib/safe-text.ts";

/**
 * Whether every version site in a checkout agrees, and the changelog records the
 * version. A site that is missing or malformed is a problem, never an exception,
 * so one report names everything wrong at once.
 *
 * @param root The checkout to read. Nothing is written and no tag is read.
 * @returns The report. `version` is what `.claude-plugin/plugin.json` states,
 *     or an empty string where it states no text. `problems` is empty only
 *     when every site agrees, so test that list and not `version`. A problem
 *     is written to be printed, so a skill directory is named in it with
 *     control characters and marks that reverse text direction made spaces.
 *     `skills` is data and keeps each name as the directory listing gave it.
 */
export function checkVersionSites(root: string): VersionReport {
  const problems: string[] = [];
  const claude = readJson(root, problems, ".claude-plugin/plugin.json");
  const version = typeof claude.version === "string" ? claude.version : "";
  if (!DOTTED_VERSION.test(version)) {
    problems.push(
      `.claude-plugin/plugin.json version must have the form 1.2.3; it states ${describeStated(claude.version)}.`,
    );
  }
  requireValue(problems, ".codex-plugin/plugin.json version",
    readJson(root, problems, ".codex-plugin/plugin.json").version, version);

  // Each level is checked before it is read. A manifest is a file anyone can
  // edit, and one of the wrong shape must state nothing, not stop the check.
  const marketplace = readJson(root, problems, ".claude-plugin/marketplace.json");
  const first: unknown = Array.isArray(marketplace.plugins) ? marketplace.plugins[0] : undefined;
  const entry = isObject(first) ? first : {};
  const source = isObject(entry.source) ? entry.source : {};
  requireValue(problems, ".claude-plugin/marketplace.json marketplace version", entry.version,
    version);
  // The ref is the half that gets forgotten, because it reads as a separate
  // fact rather than as the same number wearing a "v".
  requireValue(problems, ".claude-plugin/marketplace.json marketplace source.ref",
    source.ref, `v${version}`);

  const skills = SKILL_ROOTS.flatMap((skillRoot) => {
    try {
      return readdirSync(join(root, skillRoot))
        .filter((name) => name.startsWith("iso-24495-"))
        .map((name) => `${skillRoot}/${name}/SKILL.md`);
    } catch {
      problems.push(`${skillRoot} cannot be listed.`);
      return [];
    }
  }).sort();
  for (const skill of skills) {
    const text = read(root, problems, skill);
    if (text === null) continue;
    const found = skillVersion(text);
    if ("problem" in found) {
      problems.push(`${safeText(skill)} ${found.problem}`);
      continue;
    }
    requireValue(problems, `${safeText(skill)} metadata.version`, found.stated, version);
  }

  const changelog = read(root, problems, "CHANGELOG.md");
  if (changelog !== null) {
    const recorded = [...changelog.matchAll(CHANGELOG_HEADING)].map((match) => match[1]);
    if (!recorded.includes(version)) {
      const heading = DOTTED_VERSION.test(version) ? `[${version}]` : "with the declared version";
      problems.push(`CHANGELOG.md has no entry headed ${heading}.`);
    }
  }
  return { version, skills, problems };
}

export interface VersionReport {
  /** The version the Claude manifest declares, which every other site must match. */
  version: string;
  /** Every skill file read, relative to the checkout. */
  skills: string[];
  /** One sentence for each site that disagrees or cannot be read. Empty when all agree. */
  problems: string[];
}

export const DOTTED_VERSION = /^\d+\.\d+\.\d+$/;
export const RELEASE_TAG = /^v(\d+\.\d+\.\d+)$/;
const CHANGELOG_HEADING = /^## \[([^\]]+)\]/gm;
const SKILL_ROOTS = ["skills", "codex-skills"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether text is a version or a release tag. Such text is safe to quote, because the pattern decides what it holds. */
function isVersionText(text: string): boolean {
  return DOTTED_VERSION.test(text) || RELEASE_TAG.test(text);
}

/**
 * What a site states, worded for a problem. A version or a release tag is
 * quoted. Anything else has failed the check with contents nobody has read, so
 * only its shape is given.
 */
function describeStated(stated: unknown): string {
  if (stated === undefined || stated === null) return "nothing";
  if (typeof stated !== "string") return `a value of type ${typeof stated}`;
  return isVersionText(stated) ? `"${stated}"` : `${stated.length} characters that are not a version`;
}

/**
 * A skill's `metadata.version`, read from its front matter as YAML.
 *
 * A pattern over the front matter took the first "version:" line anywhere in
 * it, so a line inside a description could stand in for a stale
 * `metadata.version`. The front matter runs from a "---" first line to the next
 * line that is "---" and nothing else. Returns a problem when there is none, or
 * it is not YAML.
 */
function skillVersion(text: string): { stated: unknown } | { problem: string } {
  const lines = text.split(/\r?\n/);
  const closing = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line));
  if (!/^---[ \t]*$/.test(lines[0] ?? "") || closing === -1) return { problem: "has no front matter." };
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(lines.slice(1, closing).join("\n"));
  } catch {
    return { problem: "front matter is not valid YAML." };
  }
  const metadata = isObject(parsed) ? parsed.metadata : undefined;
  return { stated: isObject(metadata) ? metadata.version : undefined };
}

/**
 * A file's text, or null with a problem recorded where it cannot be read. A
 * skill's path holds a name from a directory listing, so the problem shows the
 * path cleaned.
 */
function read(root: string, problems: string[], path: string): string | null {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    problems.push(`${safeText(path)} cannot be read.`);
    return null;
  }
}

/**
 * The JSON object a file holds. Where the file cannot be read, is not JSON, or
 * holds JSON that is not an object, a problem is recorded and the result is an
 * empty object, so every site read from it states nothing.
 */
function readJson(root: string, problems: string[], path: string): Record<string, unknown> {
  const text = read(root, problems, path);
  if (text === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    problems.push(`${path} is not valid JSON.`);
    return {};
  }
  if (isObject(parsed)) return parsed;
  problems.push(`${path} must hold a JSON object; it holds ${describeShape(parsed)}.`);
  return {};
}

/** What kind of JSON value this is, in fixed words and without its contents. */
function describeShape(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "a list" : `a value of type ${typeof value}`;
}

/** Records a problem where a site does not state the wanted value. */
function requireValue(problems: string[], site: string, stated: unknown, wanted: string): void {
  if (stated !== wanted) {
    const expected = isVersionText(wanted) ? `"${wanted}"` : "what .claude-plugin/plugin.json declares";
    problems.push(`${site} states ${describeStated(stated)}, not ${expected}.`);
  }
}
