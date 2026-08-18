import { runCli } from "./audit-text.ts";

process.exit(runCli(process.argv, console.log, console.error));
