// Entry point for the visible-text check. The decision lives in the module
// beside this file; this shim only reads the file and sets the exit code.
//
//   bun scripts/visible-text-cli.ts <file>
//
// Exit 0 means the file shows a reader text, 1 means it shows none, and 2 means
// it could not be read.

import { readFileSync } from "node:fs";
import { hasVisibleText } from "./visible-text.ts";

let text: string;
try {
  text = readFileSync(process.argv[2] ?? "", "utf8");
} catch {
  process.exit(2);
}
process.exit(hasVisibleText(text) ? 0 : 1);
