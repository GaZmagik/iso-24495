// Every place that carries the release version, and the three checks that read
// them.
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
//      every release and its tag to be free.
//   3. On a pushed tag: `.github/workflows/release-tag.yml` runs
//      `bun scripts/release-tag-cli.ts <tag>`, which requires the tag to name
//      the version every site declares.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DOTTED_VERSION = /^\d+\.\d+\.\d+$/;
const RELEASE_TAG = /^v(\d+\.\d+\.\d+)$/;
const CHANGELOG_HEADING = /^## \[([^\]]+)\]/gm;
const SKILL_ROOTS = ["skills", "codex-skills"];

export interface VersionReport {
  /** The version the Claude manifest declares, which every other site must match. */
  version: string;
  /** Every skill file read, relative to the checkout. */
  skills: string[];
  /** One sentence for each site that disagrees or cannot be read. Empty when all agree. */
  problems: string[];
}

/** The outcome of listing the release tags on `origin`. */
export type RemoteTags = { ok: true; output: string } | { ok: false; reason: string };

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
 * Whether every version site in a checkout agrees, and the changelog records the
 * version. A site that is missing or malformed is a problem, never an exception,
 * so one report names everything wrong at once.
 */
export function checkVersionSites(root: string): VersionReport {
  const problems: string[] = [];
  const read = (path: string): string | null => {
    try {
      return readFileSync(join(root, path), "utf8");
    } catch {
      problems.push(`${path} cannot be read.`);
      return null;
    }
  };
  const readJson = (path: string): Record<string, unknown> => {
    const text = read(path);
    if (text === null) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      problems.push(`${path} is not valid JSON.`);
      return {};
    }
  };
  const requireValue = (site: string, stated: unknown, wanted: string): void => {
    if (stated !== wanted) {
      const expected = isVersionText(wanted) ? `"${wanted}"` : "what .claude-plugin/plugin.json declares";
      problems.push(`${site} states ${describeStated(stated)}, not ${expected}.`);
    }
  };

  const claude = readJson(".claude-plugin/plugin.json");
  const version = typeof claude.version === "string" ? claude.version : "";
  if (!DOTTED_VERSION.test(version)) {
    problems.push(
      `.claude-plugin/plugin.json version must have the form 1.2.3; it states ${describeStated(claude.version)}.`,
    );
  }
  requireValue(".codex-plugin/plugin.json version", readJson(".codex-plugin/plugin.json").version,
    version);

  const marketplace = readJson(".claude-plugin/marketplace.json") as {
    plugins?: Array<{ version?: unknown; source?: { ref?: unknown } }>;
  };
  const entry = marketplace.plugins?.[0];
  requireValue(".claude-plugin/marketplace.json marketplace version", entry?.version, version);
  // The ref is the half that gets forgotten, because it reads as a separate
  // fact rather than as the same number wearing a "v".
  requireValue(".claude-plugin/marketplace.json marketplace source.ref", entry?.source?.ref,
    `v${version}`);

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
    const text = read(skill);
    if (text === null) continue;
    const found = skillVersion(text);
    if ("problem" in found) {
      problems.push(`${skill} ${found.problem}`);
      continue;
    }
    requireValue(`${skill} metadata.version`, found.stated, version);
  }

  const changelog = read("CHANGELOG.md");
  if (changelog !== null) {
    const recorded = [...changelog.matchAll(CHANGELOG_HEADING)].map((match) => match[1]);
    if (!recorded.includes(version)) {
      const heading = DOTTED_VERSION.test(version) ? `[${version}]` : "with the declared version";
      problems.push(`CHANGELOG.md has no entry headed ${heading}.`);
    }
  }
  return { version, skills, problems };
}

/** Compares dotted versions as numbers, so 0.10.0 sorts after 0.9.0 rather than before it. */
export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let part = 0; part < 3; part += 1) {
    if (a[part] !== b[part]) return (a[part] as number) - (b[part] as number);
  }
  return 0;
}

/**
 * The released versions in the output of `git ls-remote --tags`.
 *
 * Only tags of the form v1.2.3 are releases. An annotated tag is listed twice,
 * the second time with "^{}" to name the commit it points at, and that line is
 * the same release rather than a second one.
 */
export function releasedVersions(listing: string): string[] {
  return listing.split(/\r?\n/).flatMap((line) => {
    const name = line.split("\trefs/tags/")[1];
    const match = name === undefined ? null : RELEASE_TAG.exec(name);
    return match === null ? [] : [match[1] as string];
  });
}

/**
 * Why `version` cannot be the next release, given the versions already released.
 *
 * The version must be later than every release. Equal is not enough: equal is
 * what a forgotten version bump looks like.
 */
export function preflightProblems(version: string, released: string[]): string[] {
  const problems: string[] = [];
  if (released.includes(version)) {
    problems.push(`v${version} is already tagged. Raise the version at every site before releasing.`);
  }
  const latest = [...released].sort(compareVersions).at(-1);
  if (latest !== undefined && compareVersions(version, latest) <= 0) {
    const declared = DOTTED_VERSION.test(version) ? version : "The declared version";
    problems.push(`${declared} is not later than the latest release, ${latest}.`);
  }
  return problems;
}

/** Why a pushed tag does not match the version the checkout declares. */
export function tagProblems(tag: string, version: string): string[] {
  if (tag === `v${version}`) return [];
  const expected = DOTTED_VERSION.test(version) ? `v${version}` : "the tag for the declared version";
  const arrived = RELEASE_TAG.test(tag)
    ? `the tag ${tag}`
    : `${tag.length} characters that are not a release tag of the form v1.2.3`;
  return [`The pushed tag must name the declared version: expected ${expected}, got ${arrived}.`];
}

/** Lists the tags on `origin` with git. A failure is returned, never thrown. */
export function remoteTags(root: string): RemoteTags {
  try {
    const run = Bun.spawnSync(["git", "ls-remote", "--tags", "origin"], { cwd: root });
    const decoder = new TextDecoder();
    if (run.exitCode === 0) return { ok: true, output: decoder.decode(run.stdout) };
    return { ok: false, reason: decoder.decode(run.stderr).trim() || `git exited ${run.exitCode}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Stage 2: checks a checkout before its version is tagged.
 *
 * Exit 0 means the tag can be created. Exit 1 means the checkout is not ready:
 * a site disagrees, or the version is not later than every release. Exit 2 means
 * the release history could not be read, which is never a pass, because an empty
 * list is what an unreachable remote looks like.
 */
export function runPreflight(
  root: string,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
  listTags: (root: string) => RemoteTags = remoteTags,
): number {
  const tags = listTags(root);
  if (!tags.ok) {
    stderr(`release preflight: the release tags on origin could not be listed: ${tags.reason}`);
    return 2;
  }
  const released = releasedVersions(tags.output);
  if (released.length === 0) {
    stderr("release preflight: origin lists no release tags, so the release history was not read.");
    return 2;
  }
  const report = checkVersionSites(root);
  const problems = [...report.problems, ...preflightProblems(report.version, released)];
  for (const problem of problems) stderr(`release preflight: ${problem}`);
  if (problems.length > 0) return 1;
  stdout(
    `release preflight: every site declares ${report.version}, which is later than every release, `
      + `so v${report.version} can be tagged.`,
  );
  return 0;
}

/**
 * Stage 3: checks a pushed tag against the checkout it names.
 *
 * Exit 0 means the tag names the version every site declares. Exit 1 means it
 * does not, or the sites disagree. Exit 2 means no tag was given.
 */
export function runTagCheck(
  argv: string[],
  root: string,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): number {
  const tag = argv[2];
  if (!tag) {
    stderr("Usage: bun scripts/release-tag-cli.ts <tag>");
    return 2;
  }
  const report = checkVersionSites(root);
  const problems = [...report.problems, ...tagProblems(tag, report.version)];
  for (const problem of problems) stderr(`release tag: ${problem}`);
  if (problems.length > 0) return 1;
  stdout(`release tag: ${tag} names the version every site declares.`);
  return 0;
}
