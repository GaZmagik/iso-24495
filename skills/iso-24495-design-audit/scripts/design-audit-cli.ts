import { runCli } from "./design-audit.ts";

process.exit(await runCli(process.argv, console.log, console.error));
