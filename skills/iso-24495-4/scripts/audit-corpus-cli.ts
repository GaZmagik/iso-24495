import { runCli } from "./audit-corpus.ts";

process.exit(runCli(process.argv, console.log, console.error));
