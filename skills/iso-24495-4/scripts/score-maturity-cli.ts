import { runCli } from "./score-maturity.ts";

process.exit(runCli(process.argv, console.log, console.error));
