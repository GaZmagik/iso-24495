import { runCli } from "./audit-evidence.ts";

process.exit(runCli(process.argv, console.log, console.error));
