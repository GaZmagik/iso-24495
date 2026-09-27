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
const FRONTMATTER_VERSION = /^\s*version:\s*"([^"]+)"/m;
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
      problems.push(`${site} states ${JSON.stringify(stated) ?? "nothing"}, not "${wanted}".`);
    }
  };

  const claude = readJson(".claude-plugin/plugin.json");
  const version = typeof claude.version === "string" ? claude.version : "";
  if (!DOTTED_VERSION.test(version)) {
    problems.push(
      `.claude-plugin/plugin.json states "${version}", not a version of the form 1.2.3.`,
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
    const frontmatter = text.split("---")[1] ?? "";
    requireValue(`${skill} metadata.version`, FRONTMATTER_VERSION.exec(frontmatter)?.[1], version);
  }

  const changelog = read("CHANGELOG.md");
  if (changelog !== null) {
    const recorded = [...changelog.matchAll(CHANGELOG_HEADING)].map((match) => match[1]);
    if (!recorded.includes(version)) {
      problems.push(`CHANGELOG.md has no entry headed [${version}].`);
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
    problems.push(`${version} is not later than the latest release, ${latest}.`);
  }
  return problems;
}

/** Why a pushed tag does not match the version the checkout declares. */
export function tagProblems(tag: string, version: string): string[] {
  return tag === `v${version}`
    ? []
    : [`The tag ${tag} does not name the declared version, which would be tagged v${version}.`];
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
