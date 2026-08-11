// Deterministic corpus audit: mechanical proxies for the Part 1/2 rules.
// Emits counts and locations only. It never judges clarity and its output
// must never be presented as ISO compliance.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { headings, proseBlocks, splitSentences, wordCount } from "./lib/parse.ts";
import type { Findings, Violation } from "./lib/types.ts";

const SENTENCE_WORD_LIMIT = 20;
const PARAGRAPH_SENTENCE_LIMIT = 3;
const MAX_HEADING_LEVEL = 4;
const TEXT_EXTENSIONS = [".md", ".txt"];
const LEGALESE = ["shall", "hereby", "hereinafter", "wherefore", "heretofore", "aforesaid"];

export function auditText(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const block of proseBlocks(text)) {
    const paragraph = block.lines.join(" ");
    const sentences = splitSentences(paragraph);
    for (const sentence of sentences) {
      const words = wordCount(sentence);
      if (words > SENTENCE_WORD_LIMIT) {
        violations.push({
          rule: "sentence-length",
          line: block.line,
          detail: `${words} words (limit ${SENTENCE_WORD_LIMIT})`,
        });
      }
    }
    if (sentences.length > PARAGRAPH_SENTENCE_LIMIT) {
      violations.push({
        rule: "paragraph-length",
        line: block.line,
        detail: `${sentences.length} sentences (limit ${PARAGRAPH_SENTENCE_LIMIT})`,
      });
    }
    for (let i = 0; i < block.lines.length; i++) {
      for (const term of LEGALESE) {
        const matches = block.lines[i].match(new RegExp(`\\b${term}\\b`, "gi"));
        for (let n = 0; n < (matches?.length ?? 0); n++) {
          violations.push({
            rule: "legalese",
            line: block.line + i,
            detail: `banned term "${term}"`,
          });
        }
      }
    }
  }
  for (const heading of headings(text)) {
    if (heading.level > MAX_HEADING_LEVEL) {
      violations.push({
        rule: "heading-depth",
        line: heading.line,
        detail: `heading level ${heading.level} (limit ${MAX_HEADING_LEVEL})`,
      });
    }
  }
  return violations;
}

function walk(
  dir: string,
  out: string[],
  onSkip: ((path: string) => void) | undefined,
  isRoot: boolean,
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    // An unreadable root is an error the caller must see — a mistyped corpus
    // path must not read as a clean empty corpus. Below the root, the skip is
    // reported and the walk continues.
    if (isRoot) throw error;
    onSkip?.(dir);
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      // Dangling links and permission failures skip the entry, not the walk —
      // but the caller is told, so it can distinguish "skipped" from "gone".
      onSkip?.(full);
      continue;
    }
    if (isDirectory) {
      walk(full, out, onSkip, false);
    } else if (TEXT_EXTENSIONS.some((ext) => entry.toLowerCase().endsWith(ext))) {
      out.push(full);
    }
  }
}

export function listTextFiles(dir: string, onSkip?: (path: string) => void): string[] {
  const paths: string[] = [];
  walk(dir, paths, onSkip, true);
  return paths.sort();
}

export function auditCorpus(dir: string): Findings {
  const paths = listTextFiles(dir);
  const findings: Findings = { files: {}, totals: {} };
  for (const path of paths) {
    const key = relative(dir, path).replaceAll("\\", "/");
    const violations = auditText(readFileSync(path, "utf8"));
    findings.files[key] = { violations };
    for (const v of violations) {
      findings.totals[v.rule] = (findings.totals[v.rule] ?? 0) + 1;
    }
  }
  return findings;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: bun audit-corpus.ts <corpus-dir> [--json <out-file>]");
    process.exit(2);
  }
  const findings = auditCorpus(dir);
  const jsonFlag = process.argv.indexOf("--json");
  if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
    await Bun.write(process.argv[jsonFlag + 1], JSON.stringify(findings, null, 2));
  }
  console.log("| Rule | Violations |");
  console.log("|------|------------|");
  for (const [rule, count] of Object.entries(findings.totals)) {
    console.log(`| ${rule} | ${count} |`);
  }
  const total = Object.values(findings.totals).reduce((a, b) => a + b, 0);
  console.log(`\nTotal: ${total} across ${Object.keys(findings.files).length} files.`);
}
