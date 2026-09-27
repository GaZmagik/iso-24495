import { appendFileSync } from "node:fs";
import { readOptionalFile, runCli } from "./jev-routing.ts";

process.exit(await runCli(process.argv.slice(2), process.env.TYPESAFE_API_KEY, {
  readText: readOptionalFile,
  appendLine: (path, line) => appendFileSync(path, line, "utf8"),
  fetch: (url, init) => fetch(url, init),
  sleep: (milliseconds) => Bun.sleep(milliseconds),
  now: () => new Date().toISOString(),
}, console.log, console.error));
