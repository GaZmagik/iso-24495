import { readFileSync } from "node:fs";
import { runHook } from "./audit-markdown.ts";

runHook(readFileSync(0, "utf8"), console.log);
