// Decides whether the text audit's JSON report shows that it read the pull
// request description, and nothing else. scripts/audit-pull-request-text.sh
// asks this before it trusts a report.
//
// A search for the text "violations": used to stand in for this, and a review
// broke it both ways. It passed invalid JSON, a report naming another file, and
// a report that skipped the description beside a top-level violations list. It
// refused a sound report whose spacing differed. So the report is parsed.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Whether a report can be trusted, and if so how many findings it holds. */
export type ReportCheck = { ok: true; findings: number } | { ok: false; reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks a report against the description it should describe.
 *
 * The audit names each file by its path from the directory it ran in, so
 * `projectDir` is that directory. A sound report is a JSON object naming the
 * description and no other file, with a violations list for it, and an empty
 * list of skipped entries.
 *
 * @param reportText The report as the audit wrote it, not yet parsed.
 * @param description Path of the description file, absolute or relative to
 *     the current directory.
 * @returns The number of findings for a sound report, which may be zero.
 *     Anything else, empty text included, gives `ok: false` and a reason in
 *     fixed words that is safe to print. Bad input is returned, never thrown.
 */
export function checkReport(reportText: string, description: string, projectDir: string): ReportCheck {
  let report: unknown;
  try {
    report = JSON.parse(reportText);
  } catch {
    return { ok: false, reason: "the report is not valid JSON" };
  }
  if (!isObject(report)) return { ok: false, reason: "the report is not a JSON object" };
  const files = report.files;
  if (!isObject(files)) return { ok: false, reason: "the report has no files object" };
  const named = Object.keys(files);
  if (named.length !== 1) {
    return { ok: false, reason: `the report names ${named.length} files, not the description alone` };
  }
  const [path] = named as [string];
  if (resolve(projectDir, path) !== resolve(description)) {
    return {
      ok: false,
      reason: `the report must name the description alone; it names another path, ${path.length} characters long`,
    };
  }
  const entry = files[path];
  const violations = isObject(entry) ? entry.violations : undefined;
  if (!Array.isArray(violations)) {
    return { ok: false, reason: "the description's entry has no violations list" };
  }
  if (!Array.isArray(report.skipped)) {
    return { ok: false, reason: "the report has no list of skipped entries" };
  }
  if (report.skipped.length > 0) {
    const count = report.skipped.length;
    return { ok: false, reason: `the report skipped ${count} ${count === 1 ? "entry" : "entries"}` };
  }
  return { ok: true, findings: violations.length };
}

/**
 * Reads a report file and checks it against the description.
 *
 *   bun scripts/description-report-cli.ts <report.json> <description>
 *
 * Exit 0 prints the number of findings. Exit 1 says why the report cannot be
 * trusted. Exit 2 means the arguments were wrong.
 *
 * @param argv The whole command line, so the two paths are at index 2 and 3.
 * @param projectDir The directory the audit ran in, as `checkReport` needs it.
 * @param stdout Receives the number of findings and nothing else.
 * @param stderr Receives the usage line or the reason.
 * @returns The exit code. A report file that is missing or unreadable is
 *     exit 1, not exit 2.
 */
export function runCli(
  argv: string[],
  projectDir: string,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): number {
  const [reportPath, description] = [argv[2], argv[3]];
  if (!reportPath || !description) {
    stderr("Usage: bun scripts/description-report-cli.ts <report.json> <description>");
    return 2;
  }
  let reportText: string;
  try {
    reportText = readFileSync(reportPath, "utf8");
  } catch {
    stderr("description report: the report cannot be read.");
    return 1;
  }
  const check = checkReport(reportText, description, projectDir);
  if (!check.ok) {
    stderr(`description report: ${check.reason}.`);
    return 1;
  }
  stdout(String(check.findings));
  return 0;
}
