import { runCli } from "./audit-text.ts";

process.exit(await runCli(process.argv, console.log, console.error));
