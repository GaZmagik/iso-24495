import { join } from "node:path";
import { realDependencies, runCli } from "./audit-pull-request-text.ts";

// Written to the streams themselves. `console.error` colours its text where
// colour is forced, and a message must arrive as the fixed words it is.
const dependencies = realDependencies(join(import.meta.dir, ".."), process.env.GITHUB_STEP_SUMMARY);
process.exit(runCli(
  process.argv,
  (text) => process.stdout.write(`${text}\n`),
  (text) => process.stderr.write(`${text}\n`),
  dependencies,
));
