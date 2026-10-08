// Release preflight: stage 2 of the three release checks, run by hand before a
// release is tagged. `release-versions.ts` describes all three stages and holds
// the check they share.
//
// This module adds what only the preflight needs: the release tags on `origin`,
// read with git, and the rule that the declared version must be later than
// every release. `release-preflight-cli.ts` is the command, and its header
// gives the release steps in order.

import { fileFault, unexpectedKind } from "../skills/iso-24495-4/scripts/lib/failure.ts";
import { checkVersionSites, DOTTED_VERSION, RELEASE_TAG } from "./release-versions.ts";

/**
 * Stage 2: checks a checkout before its version is tagged.
 *
 * Exit 0 means the tag can be created. Exit 1 means the checkout is not ready:
 * a site disagrees, or the version is not later than every release. Exit 2 means
 * the release history could not be read, which is never a pass, because an empty
 * list is what an unreachable remote looks like.
 *
 * It takes no arguments from the command line.
 *
 * @param root The checkout to check.
 * @param stdout Receives one line when the tag can be created.
 * @param stderr Receives one line for each problem.
 * @param listTags Replaces the call to git, which needs the network.
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

/** The outcome of listing the release tags on `origin`. */
export type RemoteTags = { ok: true; output: string } | { ok: false; reason: string };

/** Runs a command to its end in `cwd`, and returns what it printed. */
export type RunCommand = (
  command: string[],
  options: { cwd: string },
) => { exitCode: number; stdout: Uint8Array; stderr: Uint8Array };

/**
 * Lists the tags on `origin` with git. A failure is returned, never thrown.
 *
 * When git runs and fails, the reason is what git printed. When git cannot be
 * started, the reason is in fixed words: the runtime's message quotes the
 * directory it was given.
 *
 * @param root The checkout whose `origin` is asked. Asking needs the network.
 * @param runCommand Replaces the real process runner.
 * @returns On success, the listing for `releasedVersions`. A remote with no
 *     tags succeeds with empty output, so an empty listing is not a failure
 *     here.
 */
export function remoteTags(root: string, runCommand: RunCommand = runToEnd): RemoteTags {
  try {
    const run = runCommand(["git", "ls-remote", "--tags", "origin"], { cwd: root });
    const decoder = new TextDecoder();
    if (run.exitCode === 0) return { ok: true, output: decoder.decode(run.stdout) };
    return { ok: false, reason: decoder.decode(run.stderr).trim() || `git exited ${run.exitCode}` };
  } catch (error) {
    return { ok: false, reason: `git could not be started: ${fileFault(error) ?? unexpectedKind(error)}` };
  }
}

function runToEnd(command: string[], options: { cwd: string }): ReturnType<RunCommand> {
  return Bun.spawnSync(command, options);
}

/**
 * The released versions in the output of `git ls-remote --tags`.
 *
 * Only tags of the form v1.2.3 are releases. An annotated tag is listed twice,
 * the second time with "^{}" to name the commit it points at, and that line is
 * the same release rather than a second one.
 *
 * @param listing The text git printed, as `remoteTags` returns it.
 * @returns Each release without its "v", in the order listed. Empty when the
 *     listing is empty or holds no release tag, which `runPreflight` treats as
 *     a history that was not read.
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
 *
 * @param version The declared version, in the form 1.2.3. Another shape can
 *     pass here unreported, so pair this with `checkVersionSites`, which
 *     reports it.
 * @param released Versions without their "v", as `releasedVersions` returns
 *     them.
 * @returns One sentence for each reason. Empty when the version can be
 *     released, and also when `released` is empty.
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

/**
 * Compares dotted versions as numbers, so 0.10.0 sorts after 0.9.0 rather than before it.
 *
 * Both versions must have the form 1.2.3. Another shape is not refused: it
 * can return NaN, which sorts unpredictably and fails every comparison.
 *
 * @returns Below zero, zero or above zero, as `left` is earlier than, the same
 *     as or later than `right`. Fit for `Array.prototype.sort`.
 */
export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let part = 0; part < 3; part += 1) {
    if (a[part] !== b[part]) return (a[part] as number) - (b[part] as number);
  }
  return 0;
}
