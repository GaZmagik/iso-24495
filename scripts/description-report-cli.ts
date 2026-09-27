import { runCli } from "./description-report.ts";

process.exit(runCli(process.argv, process.cwd(), console.log, console.error));
