import { runAuditCli, type AuditDependencies } from "../../iso-24495-4/scripts/lib/jev/audit.ts";

export { planDocument } from "../../iso-24495-4/scripts/lib/jev/engine.ts";
export { selectDocuments, formatPlan, formatFindings } from "../../iso-24495-4/scripts/lib/jev/audit.ts";

/**
 * The design audit command: `runAuditCli` in design mode.
 *
 *   bun design-audit-cli.ts <file-or-directory> [--send] [--yes] [--json <file>] [--include-judged-text] [--project-dir <directory>]
 *
 * Without `--send` it previews and nothing leaves the machine. With it, and
 * after agreement, document text is sent to TypeSafe. Exit 0 means the
 * preview or the send completed, 1 a local failure, 2 invalid arguments or
 * no agreement, 3 a calibration or service failure, and 4 a missing or
 * malformed key. `runAuditCli` gives each argument, exit code and side effect
 * in full.
 */
export function runCli(argv: string[], stdout: (text: string) => void, stderr: (text: string) => void, dependencies: AuditDependencies = {}): Promise<number> {
  return runAuditCli("design", argv, stdout, stderr, dependencies);
}
