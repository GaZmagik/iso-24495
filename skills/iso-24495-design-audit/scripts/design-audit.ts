import { runAuditCli, type AuditDependencies } from "../../iso-24495-4/scripts/lib/jev/audit.ts";

export { planDocument } from "../../iso-24495-4/scripts/lib/jev/engine.ts";
export { selectDocuments, formatPlan, formatFindings } from "../../iso-24495-4/scripts/lib/jev/audit.ts";

export function runCli(argv: string[], stdout: (text: string) => void, stderr: (text: string) => void, dependencies: AuditDependencies = {}): Promise<number> {
  return runAuditCli("design", argv, stdout, stderr, dependencies);
}
