import { runCli } from "./generate-report.ts";

process.exit(runCli(process.argv, console.log, console.error));
