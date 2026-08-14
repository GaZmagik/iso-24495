import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { adviseOnFile } from "../../../hooks/audit-markdown.ts";
import { join, relative } from "node:path";
import { auditText, ENGINE_THRESHOLDS, isAuditedDocument } from "../../iso-24495-4/scripts/audit-corpus.ts";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..", "..");
const SKILLS_ROOT = join(REPOSITORY_ROOT, "skills");
const SKIPPED_DIRECTORIES = new Set([".git", ".iso-24495-4", "node_modules"]);
const SENTENCE_OR_LINE = /(?<=[.!?])[ \t]+|\r?\n/;
// A floor can be worded as a range as easily as as a minimum. "Average 15 to
// 20 words" is an instruction to reach 15, so any sentence about the average
// that names the lower number must also mark it as a target.
const FLOOR_WORDING = /between|at least|no fewer|minimum/i;
const RANGE_WORDING = /(?<![0-9])15(?![0-9])/;
const TARGET_WORDING = /aim|target|or fewer|at or under|not a fault/i;
const ENTRY_FILES = [
  "hooks/audit-markdown-main.ts",
  "skills/iso-24495-4/scripts/audit-corpus-cli.ts",
  "skills/iso-24495-4/scripts/audit-evidence-cli.ts",
  "skills/iso-24495-4/scripts/generate-report-cli.ts",
  "skills/iso-24495-4/scripts/score-maturity-cli.ts",
  "skills/iso-24495-4/scripts/watch-corpus-main.ts",
];
const AGENT_SPECIFIC_PATTERNS = [
  { name: "agent name", pattern: /\b(?:Claude Code|Codex|agy|muse)\b/i },
  {
    name: "tool name",
    pattern:
      /\b(?:(?:view|read|write|edit)_file|str_replace|apply_patch|shell_command|exec_command|run_command)\b/i,
  },
  { name: "tool label", pattern: /\b(?:Read|Write|Edit|Bash|Grep|Glob) tool\b/i },
];
const REFERENCE_DIRECTIVE_PATTERN = /^\s*\/\/\/\s*<reference\b/;
const SUPPRESSION_DIRECTIVE_PATTERN = /@ts-(?:ignore|nocheck|expect-error)\b/;
const VAR_DECLARATION_PATTERN = new RegExp("\\bvar\\s+");
const EXPLICIT_ANY_PATTERN = new RegExp("(?::\\s*any\\b|\\bas\\s+any\\b)");
const LOOSE_EQUALITY_PATTERN = new RegExp("(?<![=!])(?:==|!=)(?!=)", "g");
const NULL_PATTERN = new RegExp("^null\\b");
const DEFAULT_EXPORT_PATTERN = new RegExp("\\bexport\\s+default\\b");
const NAMESPACE_PATTERN = new RegExp("\\bnamespace\\s+[A-Za-z_$]");
const DECLARATION_PATTERN = new RegExp("\\b(?:let|const)\\b", "g");
const PRIVATE_FIELD_PATTERN = new RegExp("#[A-Za-z_$][\\w$]*");

interface LexicalState {
  blockComment: boolean;
  quote: "\"" | "'" | "`" | null;
}

interface StyleViolation {
  line: number;
  rule: string;
}

function repositoryTextFiles(dir = REPOSITORY_ROOT): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...repositoryTextFiles(path));
    } else if (isAuditedDocument(entry) || entry.toLowerCase().endsWith(".ts")) {
      files.push(path);
    }
  }
  return files.sort();
}

function maskCommentsAndStrings(line: string, state: LexicalState): string {
  let result = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (state.blockComment) {
      result += " ";
      if (character === "*" && next === "/") {
        result += " ";
        index += 1;
        state.blockComment = false;
      }
      continue;
    }

    if (state.quote !== null) {
      result += " ";
      if (character === "\\") {
        if (next !== undefined) {
          result += " ";
          index += 1;
        }
      } else if (character === state.quote) {
        state.quote = null;
      }
      continue;
    }

    if (character === "/" && next === "/") {
      return result.padEnd(line.length, " ");
    }
    if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      state.blockComment = true;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      result += " ";
      state.quote = character;
      continue;
    }
    result += character;
  }
  return result;
}

function hasLooseEquality(code: string): boolean {
  for (const match of code.matchAll(LOOSE_EQUALITY_PATTERN)) {
    const rightOperand = code.slice((match.index ?? 0) + match[0].length).trimStart();
    if (!NULL_PATTERN.test(rightOperand)) return true;
  }
  return false;
}

function hasMultipleDeclarations(code: string): boolean {
  DECLARATION_PATTERN.lastIndex = 0;
  for (const match of code.matchAll(DECLARATION_PATTERN)) {
    let roundDepth = 0;
    let squareDepth = 0;
    let braceDepth = 0;
    let angleDepth = 0;
    const start = (match.index ?? 0) + match[0].length;
    for (let index = start; index < code.length; index += 1) {
      const character = code[index];
      if (character === "(") roundDepth += 1;
      if (character === ")") roundDepth -= 1;
      if (character === "[") squareDepth += 1;
      if (character === "]") squareDepth -= 1;
      if (character === "{") braceDepth += 1;
      if (character === "}") braceDepth -= 1;
      if (character === "<") angleDepth += 1;
      if (character === ">" && angleDepth > 0) angleDepth -= 1;
      const topLevel =
        roundDepth === 0 && squareDepth === 0 && braceDepth === 0 && angleDepth === 0;
      if (topLevel && character === ",") return true;
      if (topLevel && character === ";") break;
    }
  }
  return false;
}

function typescriptStyleViolations(path: string): StyleViolation[] {
  const state: LexicalState = { blockComment: false, quote: null };
  return readFileSync(path, "utf8").split(/\r\n?|\n/).flatMap((line, index) => {
    const violations: StyleViolation[] = [];
    const lineNumber = index + 1;
    if (REFERENCE_DIRECTIVE_PATTERN.test(line)) {
      violations.push({ line: lineNumber, rule: "namespace or triple-slash reference" });
    }
    if (SUPPRESSION_DIRECTIVE_PATTERN.test(line)) {
      violations.push({ line: lineNumber, rule: "TypeScript suppression directive" });
    }

    const code = maskCommentsAndStrings(line, state);
    if (VAR_DECLARATION_PATTERN.test(code)) {
      violations.push({ line: lineNumber, rule: "var declaration" });
    }
    if (EXPLICIT_ANY_PATTERN.test(code)) {
      violations.push({ line: lineNumber, rule: "explicit any" });
    }
    if (hasLooseEquality(code)) {
      violations.push({ line: lineNumber, rule: "loose equality" });
    }
    if (DEFAULT_EXPORT_PATTERN.test(code)) {
      violations.push({ line: lineNumber, rule: "default export" });
    }
    if (NAMESPACE_PATTERN.test(code)) {
      violations.push({ line: lineNumber, rule: "namespace or triple-slash reference" });
    }
    if (hasMultipleDeclarations(code)) {
      violations.push({ line: lineNumber, rule: "multiple declarations" });
    }
    if (PRIVATE_FIELD_PATTERN.test(code)) {
      violations.push({ line: lineNumber, rule: "private field syntax" });
    }
    return violations;
  });
}

describe("repository writing conventions", () => {
  test("all five skills use agent-neutral wording", () => {
    const skillFiles = readdirSync(SKILLS_ROOT)
      .map((directory) => join(SKILLS_ROOT, directory, "SKILL.md"))
      .filter(existsSync)
      .sort();
    expect(skillFiles).toHaveLength(5);

    const violations = skillFiles.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return AGENT_SPECIFIC_PATTERNS.flatMap(({ name, pattern }) =>
        pattern.test(text) ? [`${relative(REPOSITORY_ROOT, path)}: ${name}`] : [],
      );
    });
    expect(violations).toEqual([]);
  });

  test("no markdown or TypeScript file contains an em or en dash", () => {
    const files = repositoryTextFiles();
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(files).toContain(join(REPOSITORY_ROOT, "README.md"));
    expect(files).toContain(join(REPOSITORY_ROOT, "hooks", "audit-markdown.ts"));

    // No historical exemption. The changelog's date separators carry no
    // meaning, so they were normalised too and the rule covers everything.
    const violations = files.flatMap((path) => {
      const relativePath = relative(REPOSITORY_ROOT, path).replaceAll("\\", "/");
      return /[\u2013\u2014]/.test(readFileSync(path, "utf8")) ? [relativePath] : [];
    });
    expect(violations).toEqual([]);
  });

  // The guard has to accept every document the shipped hook accepts. Comparing
  // two extension lists proved nothing: one caller lower-cased the extension
  // and the other did not, so a file named in capitals slipped between them.
  // Both now call the engine's own predicate, which this pins by behaviour.
  test("the dogfood guard audits exactly what the hook audits", () => {
    const temp = mkdtempSync(join(tmpdir(), "iso-extension-"));
    try {
      // Distinct stems: this filesystem is case-insensitive, so "a.txt" and
      // "a.TXT" would be one file and the case test would prove nothing.
      for (const name of ["lower.txt", "upper.TXT", "readme.MD", "guide.Markdown"]) {
        const path = join(temp, name);
        writeFileSync(path, "The supplier shall comply.");
        expect(isAuditedDocument(path), `${name} must be audited`).toBe(true);
        expect(adviseOnFile(path, temp), `${name} must reach the hook`).toContain("legalese");
        expect(repositoryTextFiles(temp), `${name} must reach the guard`).toContain(path);
      }
      const ignored = join(temp, "notes.txtx");
      writeFileSync(ignored, "The supplier shall comply.");
      expect(isAuditedDocument(ignored)).toBe(false);
      expect(adviseOnFile(ignored, temp)).toBeNull();
      expect(repositoryTextFiles(temp)).not.toContain(ignored);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("all repository documents pass the shared audit", () => {
    const markdownFiles = repositoryTextFiles().filter((path) => {
      const relativePath = relative(REPOSITORY_ROOT, path).replaceAll("\\", "/");
      return isAuditedDocument(path) && !relativePath.includes("/tests/fixtures/");
    });
    expect(markdownFiles.length).toBeGreaterThanOrEqual(15);
    expect(markdownFiles).toContain(join(REPOSITORY_ROOT, "README.md"));

    const violations = markdownFiles.flatMap((path) => {
      const relativePath = relative(REPOSITORY_ROOT, path).replaceAll("\\", "/");
      return auditText(readFileSync(path, "utf8")).map(
        (violation) => `${relativePath}:${violation.line}: ${violation.rule}: ${violation.detail}`,
      );
    });
    expect(violations).toEqual([]);
  });

  test("TypeScript follows the mechanically checkable style rules", () => {
    const typescriptFiles = repositoryTextFiles().filter((path) => {
      const relativePath = relative(REPOSITORY_ROOT, path).replaceAll("\\", "/");
      return path.endsWith(".ts") && !relativePath.includes("/tests/fixtures/");
    });
    expect(typescriptFiles.length).toBeGreaterThanOrEqual(10);
    expect(typescriptFiles).toContain(
      join(REPOSITORY_ROOT, "skills", "iso-24495-4", "scripts", "audit-corpus.ts"),
    );

    const violations = typescriptFiles.flatMap((path) => {
      const relativePath = relative(REPOSITORY_ROOT, path).replaceAll("\\", "/");
      return typescriptStyleViolations(path).map(
        (violation) => `${relativePath}:${violation.line}: ${violation.rule}`,
      );
    });
    expect(violations).toEqual([]);
  });

  // Recalibration has to move the engine, the output style, and the core
  // skill together. This catches the half-finished version, where the engine
  // measures one limit and the guidance still quotes the old one.
  test("the output style and core skill quote the engine's current limits", () => {
    const guidance = [
      join(REPOSITORY_ROOT, "output-styles", "iso-24495.md"),
      join(SKILLS_ROOT, "iso-24495-1", "SKILL.md"),
    ];
    // Anchored to the sentence making each claim. Testing only that the number
    // appears somewhere in the file passes even when the claim itself is wrong,
    // because the same number occurs elsewhere.
    const limits = [
      { name: "sentence cap", anchor: /ceiling|exceed|none over/i, value: ENGINE_THRESHOLDS.sentenceWordLimit },
      { name: "average limit", anchor: /average/i, value: ENGINE_THRESHOLDS.sentenceAverageLimit },
      { name: "paragraph limit", anchor: /paragraph/i, value: ENGINE_THRESHOLDS.paragraphSentenceLimit },
    ];

    const wrong = guidance.flatMap((path) => {
      const sentences = readFileSync(path, "utf8").split(/(?<=[.!?])\s+|\n/);
      return limits.flatMap(({ name, anchor, value }) => {
        const claims = sentences.filter((sentence) => anchor.test(sentence) && /\d/.test(sentence));
        const stated = claims.some((sentence) => new RegExp(`\\b${value}\\b`).test(sentence));
        return claims.length > 0 && stated
          ? []
          : [`${relative(REPOSITORY_ROOT, path)}: ${name} must state ${value}`];
      });
    });
    expect(wrong).toEqual([]);
  });

  // The style states measurable limits, which are worth nothing if nothing
  // tells the model to read its own draft back against them.
  // These rules came from two external reviews of the plugin author's own
  // replies. Each names a failure the sentence and paragraph limits cannot
  // see, so a shortened style would lose exactly what measurement misses.
  //
  // The first version of this test searched the whole file for five phrases.
  // Inverting three rules into their opposites still passed it. Each rule is
  // now anchored to the start of its own bullet, inside the section, so a
  // negation breaks the anchor rather than satisfying it.
  test("the output style keeps the reporting rules", () => {
    const style = readFileSync(join(REPOSITORY_ROOT, "output-styles", "iso-24495.md"), "utf8");
    expect(style).toMatch(/^## Reporting work$/m);
    const section = style.split("## Reporting work")[1]?.split("\n## ")[0] ?? "";
    const rules = [
      "- **Show material findings.**",
      "- **Report status precisely.**",
      "- **Compare options consistently.**",
      "- **Stay consistent.**",
      "- **Use grammatical prose.**",
    ];
    for (const rule of rules) {
      expect(section, `${rule} must open its own bullet`).toContain(rule);
    }

    // Every rule needs a send-time item, or the file's own warning applies:
    // a rule stated once loses to habit.
    const check = style.split("## Check before you send")[1] ?? "";
    const checks = [
      /evidence and effect/i,
      /[Bb]uilt and verified/i,
      /same criteria, evidence, detail and tone/i,
      /contradicts a rule or fact stated earlier/i,
      /fragments confined to headings/i,
    ];
    for (const item of checks) {
      expect(check, `the send-time check must cover ${item}`).toMatch(item);
    }
    // The reporting items are conditional, so a one-line answer stays one line.
    expect(check).toMatch(/when the reply reports work/i);
  });

  test("the output style keeps a send-time check", () => {
    const style = readFileSync(join(REPOSITORY_ROOT, "output-styles", "iso-24495.md"), "utf8");
    expect(style).toMatch(/^## Check before you send$/m);
    expect(style).toMatch(/^## Applying this to a reply$/m);
  });

  // The engine sets an upper limit on the average and no lower one. A check
  // that reads as "between 15 and 20" makes a concise reply a failure, and the
  // only way to pass is to pad it.
  test("the average is stated as an aim, never as a floor", () => {
    const guidance = [
      join(REPOSITORY_ROOT, "output-styles", "iso-24495.md"),
      join(SKILLS_ROOT, "iso-24495-1", "SKILL.md"),
    ];
    const floors = guidance.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      const claims = text.split(SENTENCE_OR_LINE).filter((line) => /average/i.test(line));
      return claims
        .filter((line) => FLOOR_WORDING.test(line)
          || (RANGE_WORDING.test(line) && !TARGET_WORDING.test(line)))
        .map((line) => `${relative(REPOSITORY_ROOT, path)}: ${line.trim()}`);
    });
    expect(floors).toEqual([]);
    const style = readFileSync(guidance[0], "utf8");
    const average = ENGINE_THRESHOLDS.sentenceAverageLimit;
    expect(style, "the send-time check must name the average as a target").toMatch(
      new RegExp(`aim[^.]*${average}|${average}[^.]*aim`, "i"),
    );
  });

  test("entry files remain logic-free composition roots", () => {
    for (const relativePath of ENTRY_FILES) {
      const path = join(REPOSITORY_ROOT, relativePath);
      expect(existsSync(path), `${relativePath} must exist`).toBe(true);
      const codeLines = readFileSync(path, "utf8")
        .split(/\r\n?|\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      expect(codeLines.length, `${relativePath} must contain at most five lines`).toBeLessThanOrEqual(5);
      expect(codeLines.length, `${relativePath} must contain imports and one call`).toBeGreaterThanOrEqual(2);
      for (const importLine of codeLines.slice(0, -1)) {
        expect(importLine, `${relativePath} may contain only imports before its call`).toMatch(
          /^import\s+(?:\{[^}]+\}|[^;]+)\s+from\s+"[^"]+";$/,
        );
      }
      expect(codeLines.at(-1), `${relativePath} must end with one invocation`).toMatch(
        /^[A-Za-z_$][\w$.]*\(.*\);$/,
      );
      expect(codeLines.at(-1), `${relativePath} invocation must not contain control flow`).not.toMatch(
        /\b(?:if|for|while|switch|try|catch|function|class)\b|=>|\?|&&|\|\|/,
      );
    }
  });

  // A check that only runs on a maintainer's machine is not enforcement, and a
  // check that only runs on a server cannot be reproduced before pushing. Both
  // routes must therefore call one script, so neither can drift from the other.
  describe("the continuous integration check", () => {
    const scriptPath = join(REPOSITORY_ROOT, "scripts", "check.sh");
    const workflowPath = join(REPOSITORY_ROOT, ".github", "workflows", "tests.yml");

    test("a single checked-in script holds every gate", () => {
      expect(existsSync(scriptPath), "scripts/check.sh must exist").toBe(true);
      const script = readFileSync(scriptPath, "utf8");
      expect(script, "the script must fail on the first error").toMatch(/^set -euo pipefail$/m);
      expect(script, "the script must run the test suite").toMatch(/\bbun test\b/);
      expect(script, "the script must audit the repository's own documents").toMatch(
        /audit-corpus-cli\.ts/,
      );
    });

    test("the workflow runs that script rather than its own commands", () => {
      expect(existsSync(workflowPath), ".github/workflows/tests.yml must exist").toBe(true);
      const workflow = readFileSync(workflowPath, "utf8");
      expect(workflow, "the workflow must run on pull requests").toMatch(/^\s*pull_request:/m);
      expect(workflow, "the workflow must install Bun").toMatch(/oven-sh\/setup-bun/);
      expect(workflow, "the workflow must call the shared script").toMatch(
        /bash\s+scripts\/check\.sh/,
      );
      const inlineBunCalls = workflow.match(/^\s*run:\s*bun\b/gm) ?? [];
      expect(inlineBunCalls, "the workflow must not run its own bun commands").toEqual([]);
    });

    test("the README tells a contributor to run the same script", () => {
      const readme = readFileSync(join(REPOSITORY_ROOT, "README.md"), "utf8");
      expect(readme).toMatch(/scripts\/check\.sh/);
    });
  });
});
