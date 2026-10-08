// Pushed tag check: stage 3 of the three release checks. `release-versions.ts`
// describes all three stages and holds the check they share.
//
// This module adds what only this stage needs: the rule that a pushed tag names
// the version every site declares. `release-tag-cli.ts` is the command, which
// `.github/workflows/release-tag.yml` runs on every pushed tag.

import { checkVersionSites, DOTTED_VERSION, RELEASE_TAG } from "./release-versions.ts";

/**
 * Stage 3: checks a pushed tag against the checkout it names.
 *
 * Exit 0 means the tag names the version every site declares. Exit 1 means it
 * does not, or the sites disagree. Exit 2 means no tag was given.
 *
 * @param argv The whole command line, so the tag is at index 2.
 * @param root The checkout the tag was pushed for.
 * @param stdout Receives one line when the tag matches.
 * @param stderr Receives the usage line, or one line for each problem.
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

/**
 * Why a pushed tag does not match the version the checkout declares.
 *
 * @param tag The tag as pushed, with its "v".
 * @param version The declared version, without a "v".
 * @returns Empty when the tag is "v" followed by the version. Otherwise one
 *     sentence, which quotes the tag only where it has the form v1.2.3.
 */
export function tagProblems(tag: string, version: string): string[] {
  if (tag === `v${version}`) return [];
  const expected = DOTTED_VERSION.test(version) ? `v${version}` : "the tag for the declared version";
  const arrived = RELEASE_TAG.test(tag)
    ? `the tag ${tag}`
    : `${tag.length} characters that are not a release tag of the form v1.2.3`;
  return [`The pushed tag must name the declared version: expected ${expected}, got ${arrived}.`];
}
