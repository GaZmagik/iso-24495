import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  auditText,
  ENGINE_THRESHOLDS,
  isAuditedDocument,
  projectAcronyms,
} from "../../iso-24495-4/scripts/audit-corpus.ts";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..", "..");
const SKILLS_ROOT = join(REPOSITORY_ROOT, "skills");
const CODEX_SKILLS_ROOT = join(REPOSITORY_ROOT, "codex-skills");

/** Every skill this repository ships, whichever agent reads it. */
function everySkillDirectory(): Array<{ name: string; path: string }> {
  return [SKILLS_ROOT, CODEX_SKILLS_ROOT].flatMap((root) =>
    readdirSync(root)
      .filter((entry) => entry.startsWith("iso-24495-"))
      .map((entry) => ({ name: entry, path: join(root, entry) })),
  );
}
const SKIPPED_DIRECTORIES = new Set([".git", ".iso-24495-4", "node_modules"]);
const SENTENCE_OR_LINE = /(?<=[.!?])[ \t]+|\r?\n/;
// A floor can be worded as a range as easily as as a minimum. "Average 15 to
// 20 words" is an instruction to reach 15, so any sentence about the average
// that names the lower number must also mark it as a target.
const FLOOR_WORDING = /between|at least|no fewer|minimum/i;
const RANGE_WORDING = /(?<![0-9])15(?![0-9])/;
const TARGET_WORDING = /aim|target|or fewer|at or under|not a fault/i;
const ENTRY_FILES = [
  "skills/iso-24495-text-audit/scripts/audit-text-cli.ts",
  "skills/iso-24495-4/scripts/audit-corpus-cli.ts",
  "skills/iso-24495-4/scripts/audit-evidence-cli.ts",
  "skills/iso-24495-4/scripts/generate-report-cli.ts",
  "skills/iso-24495-4/scripts/score-maturity-cli.ts",
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
  // Only the skills Claude and Codex both read. A skill under `codex-skills/`
  // is read by one agent by construction, so naming that agent there tells a
  // reader what to do rather than leaving them to guess.
  test("every shared skill uses agent-neutral wording", () => {
    const skillFiles = readdirSync(SKILLS_ROOT)
      .map((entry) => join(SKILLS_ROOT, entry, "SKILL.md"))
      .filter(existsSync)
      .sort();
    expect(skillFiles.length).toBeGreaterThanOrEqual(6);

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
    expect(files).toContain(
      join(REPOSITORY_ROOT, "skills", "iso-24495-text-audit", "SKILL.md"),
    );

    // No historical exemption. The changelog's date separators carry no
    // meaning, so they were normalised too and the rule covers everything.
    const violations = files.flatMap((path) => {
      const relativePath = relative(REPOSITORY_ROOT, path).replaceAll("\\", "/");
      return /[\u2013\u2014]/.test(readFileSync(path, "utf8")) ? [relativePath] : [];
    });
    expect(violations).toEqual([]);
  });

  test("the dogfood guard follows the engine's audited extensions", () => {
    const temp = mkdtempSync(join(tmpdir(), "iso-extension-"));
    try {
      // Distinct stems: this filesystem is case-insensitive, so "a.txt" and
      // "a.TXT" would be one file and the case test would prove nothing.
      for (const name of ["lower.txt", "upper.TXT", "readme.MD", "guide.Markdown"]) {
        const path = join(temp, name);
        writeFileSync(path, "The supplier shall comply.");
        expect(isAuditedDocument(path), `${name} must be audited`).toBe(true);
        expect(repositoryTextFiles(temp), `${name} must reach the guard`).toContain(path);
      }
      const ignored = join(temp, "notes.txtx");
      writeFileSync(ignored, "The supplier shall comply.");
      expect(isAuditedDocument(ignored)).toBe(false);
      expect(repositoryTextFiles(temp)).not.toContain(ignored);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("the plugin remains passive until the text audit skill is invoked", () => {
    const plugin = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, ".claude-plugin", "plugin.json"), "utf8"),
    ) as { experimental?: { monitors?: unknown } };
    expect(plugin.experimental?.monitors).toBeUndefined();
    expect(existsSync(join(REPOSITORY_ROOT, "monitors", "monitors.json"))).toBe(false);
    expect(existsSync(join(REPOSITORY_ROOT, "hooks", "hooks.json"))).toBe(false);
    expect(existsSync(join(REPOSITORY_ROOT, ".iso-24495-4", "monitor.json"))).toBe(false);

    const marketplace = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, ".claude-plugin", "marketplace.json"), "utf8"),
    ) as { plugins: Array<{ skills: string[] }> };
    expect(marketplace.plugins[0].skills).toContain("./skills/iso-24495-text-audit");

    const auditSkill = readFileSync(
      join(SKILLS_ROOT, "iso-24495-text-audit", "SKILL.md"),
      "utf8",
    );
    expect(auditSkill).toMatch(/^disable-model-invocation: true$/m);
    expect(auditSkill).toMatch(/^argument-hint: "\[file-or-directory\]"$/m);
    expect(auditSkill).not.toContain("[TODO:");
    const auditInterface = readFileSync(
      join(SKILLS_ROOT, "iso-24495-text-audit", "agents", "openai.yaml"),
      "utf8",
    );
    expect(auditInterface).toMatch(/^\s*allow_implicit_invocation: false$/m);
  });

  test("current release guidance no longer describes the removed automation", () => {
    const checkScript = readFileSync(join(REPOSITORY_ROOT, "scripts", "check.sh"), "utf8");
    expect(checkScript).not.toContain("user's hook and monitor");

    const auditSource = readFileSync(
      join(SKILLS_ROOT, "iso-24495-4", "scripts", "audit-corpus.ts"),
      "utf8",
    );
    expect(auditSource).not.toContain("switching the hook off");

    const changelog = readFileSync(join(REPOSITORY_ROOT, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("Seven documents in different registers currently produce nothing.");
    expect(changelog).not.toContain("Six documents in different registers currently produce nothing.");

    const readme = readFileSync(join(REPOSITORY_ROOT, "README.md"), "utf8");
    expect(readme).toContain("Directory audits skip selected or nested symbolic links and directory junctions");

    const auditSkill = readFileSync(
      join(SKILLS_ROOT, "iso-24495-text-audit", "SKILL.md"),
      "utf8",
    );
    expect(auditSkill).toContain("Do not follow a selected or nested symbolic link or directory junction");
  });

  test("all repository documents pass the shared audit", () => {
    const markdownFiles = repositoryTextFiles().filter((path) => {
      const relativePath = relative(REPOSITORY_ROOT, path).replaceAll("\\", "/");
      return isAuditedDocument(path) && !relativePath.includes("/tests/fixtures/");
    });
    expect(markdownFiles.length).toBeGreaterThanOrEqual(15);
    expect(markdownFiles).toContain(join(REPOSITORY_ROOT, "README.md"));

    const known = projectAcronyms(REPOSITORY_ROOT);
    expect(known.size).toBeGreaterThan(0);
    const violations = markdownFiles.flatMap((path) => {
      const relativePath = relative(REPOSITORY_ROOT, path).replaceAll("\\", "/");
      // The repository is a project like any other, so it uses its own
      // per-project acronym list rather than a stricter setting than it ships.
      return auditText(readFileSync(path, "utf8"), { knownAcronyms: known }).map(
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

    // The bodies carry the meaning, and inverting them left every label intact.
    // Each rule therefore pins a phrase from its own sentence, and the section
    // must contain no negation of a rule it states.
    const bodies = [
      "State the defect, its evidence and its effect before proposing a repair",
      "Separate built from verified, and name each required check still open",
      "Use the same criteria, evidence, detail and tone for every option",
      "Do not contradict a rule or fact you have already stated",
      "Keep fragments for headings, labels, table cells and deliberate status markers",
    ];
    for (const body of bodies) {
      expect(section, `the rule body "${body}" must survive`).toContain(body);
    }
    const inversions = [
      "Never state the defect or its effect",
      "Built and verified need not be distinguished",
      "Use different evidence for the preferred option",
      "Contradictions need no explanation",
      "Use fragments throughout prose",
    ];
    for (const inversion of inversions) {
      expect(section, `the section must not contain "${inversion}"`).not.toContain(inversion);
    }

    // Every rule needs a send-time item, or the file's own warning applies:
    // a rule stated once loses to habit.
    const check = style.split("## Check before you send")[1] ?? "";
    const checks = [
      "Every defect named carries its evidence and effect, not only a count.",
      "Built and verified are distinguished, and any check still open is named.",
      "Options are compared on the same criteria, evidence, detail and tone.",
      "Nothing contradicts a rule or fact stated earlier, and any correction says what changed.",
      "Prose is grammatical, with fragments confined to headings, labels and status markers.",
    ];
    for (const item of checks) {
      expect(check, `the send-time check must cover ${item}`).toContain(item);
    }
    // The reporting items are conditional, so a one-line answer stays one line.
    expect(check).toContain("These five apply whenever the reply reports work, however short it is.");
    // The exception must not swallow short answers that report work.
    expect(check).toContain("Only a reply that reports no work skips them:");
    expect(check).toContain('"Did the gate pass?" is a simple question, and "Done." is not an acceptable answer to it.');
  });

  // The standard counts everyone who uses a document as an intended reader,
  // whether they see it, hear it or touch it. The guidance was written for a
  // single sighted reader until this was pinned, and Part 5 described its own
  // rules as visual, which is the assumption that excluded a listener.
  test("the guidance addresses readers who do not look at the page", () => {
    const core = readFileSync(join(SKILLS_ROOT, "iso-24495-1", "SKILL.md"), "utf8");
    expect(core, "the core skill must name the primary audience rule").toContain(
      "name the primary audience");
    expect(core, "the core skill must cover hearing and touch").toMatch(
      /hear it through a screen reader/i);
    expect(core, "skimming must be named as a high-literacy behaviour").toContain(
      "Skimming is a high-literacy behaviour");

    const design = readFileSync(join(SKILLS_ROOT, "iso-24495-5", "SKILL.md"), "utf8");
    for (const requirement of [
      "Link text names its destination",
      "alternative text",
      "Tables carry a header row",
      "The reading order is the document order",
      "Never let a visual device carry meaning on its own",
    ]) {
      expect(design, `Part 5 must keep: ${requirement}`).toContain(requirement);
    }
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

  // Codex reads the same marketplace manifest as Claude Code, and gives each
  // skill its display name from `agents/openai.yaml`. Both were checked against
  // Codex itself: it registered this repository as a marketplace and listed the
  // plugin, and every key below appears in the Codex binary.
  describe("Codex CLI compatibility", () => {
    const skills = everySkillDirectory();

    test("every skill carries a Codex interface file", () => {
      expect(skills.length).toBeGreaterThanOrEqual(7);
      for (const { name, path: directory } of skills) {
        const path = join(directory, "agents", "openai.yaml");
        expect(existsSync(path), `${name} has agents/openai.yaml`).toBe(true);
        const contents = readFileSync(path, "utf8");
        // The three keys Codex reads for presentation. A missing one leaves the
        // skill unnamed in its interface.
        expect(contents, name).toMatch(/^\s*display_name: ".+"$/m);
        expect(contents, name).toMatch(/^\s*short_description: ".+"$/m);
        expect(contents, name).toMatch(/^\s*default_prompt: ".+"$/m);
        // Codex invokes a skill as $name, so the prompt has to name it.
        expect(contents, name).toContain(`$${name}`);
      }
    });

    // Claude reads the marketplace manifest and scans `skills/` whatever the
    // manifest says, which was tested: a skill left out of the list still
    // loaded. So the response style lives outside that directory, and Codex
    // finds it through its own manifest, which names both roots.
    test("each manifest names the skills its agent should read", () => {
      const marketplace = readFileSync(
        join(REPOSITORY_ROOT, ".claude-plugin", "marketplace.json"),
        "utf8",
      );
      for (const entry of readdirSync(SKILLS_ROOT)) {
        expect(marketplace, entry).toContain(`./skills/${entry}`);
      }
      expect(marketplace).not.toContain("codex-skills");

      const codex = JSON.parse(readFileSync(
        join(REPOSITORY_ROOT, ".codex-plugin", "plugin.json"),
        "utf8",
      )) as { skills: string[] };
      expect(codex.skills).toEqual(["./skills/", "./codex-skills/"]);
    });

    // Codex has no output style, so the same rules are a skill there. The two
    // must say the same thing, or a Codex user and a Claude user are held to
    // different standards.
    test("the style skill holds the output style word for word", () => {
      const style = readFileSync(
        join(REPOSITORY_ROOT, "output-styles", "iso-24495.md"),
        "utf8",
      );
      const skill = readFileSync(
        join(CODEX_SKILLS_ROOT, "iso-24495-style", "SKILL.md"),
        "utf8",
      );
      const body = style.split("---")[2].trim();
      expect(body.length).toBeGreaterThan(500);
      expect(skill).toContain(body);
    });

    test("the README explains Codex installation and its one limit", () => {
      const readme = readFileSync(join(REPOSITORY_ROOT, "README.md"), "utf8");
      expect(readme).toContain("codex plugin marketplace add");
      expect(readme).toContain("codex plugin add iso-24495-plain-language@iso-24495");
      // A plugin cannot apply itself in Codex: its own AGENTS.md is ignored,
      // which was tested directly rather than assumed.
      expect(readme).toContain("AGENTS.md");
      expect(readme).toMatch(/iso-24495-style/);
    });

    // A rule stated flat in one place and qualified in another is a conflict, and the
    // model resolves it by picking one. Both carve-outs were stated in the rule bodies
    // while the summary table still stated the bare rule, so the table contradicted them.
    test("the code skill states its carve-outs wherever it states the rule", () => {
      const skill = readFileSync(join(SKILLS_ROOT, "iso-24495-code", "SKILL.md"), "utf8");
      const table = skill
        .split("\n")
        .filter((line) => line.startsWith("| "))
        .join("\n");

      // Interface documentation says what a function does, so "why, never what" cannot
      // stand alone anywhere in the skill.
      expect(skill).not.toContain("says why, never what");
      expect(table).toContain("interface documentation says what");

      // A secret must never reach a log, so no site may ask for the offending value flat.
      expect(skill).not.toContain("shows the offending value");
      expect(skill).toContain("Never put a secret in an error");
      expect(table).toContain("a safe value");

      // The prose ban is not enough on its own. The worked example is the part a model
      // copies, and it interpolated an arbitrary input straight into the message while
      // the rule above it forbade exactly that.
      // Banning two names let the same sink back in under a third. A value on a throw
      // path has just failed validation, so no bare identifier may be interpolated at
      // all; a shape such as ".length" or a "typeof" is what the rule asks for.
      const examples = skill.split("```")[1] ?? "";
      expect(examples).toContain("token.length");
      const bareValue = new RegExp("\\$\\{\\s*[A-Za-z_\\$][\\w\\$]*\\s*}");
      expect(bareValue.test(examples), examples).toBe(false);
    });
  });

  // Twelve places carry the release version between them, and moving some but
  // not all of them has already reached users. The 0.6.1 release bumped the
  // marketplace, the Claude manifest and all eight skill files, and missed
  // `.codex-plugin/plugin.json`, so a Codex user read a version one release
  // behind the skills beside it. The changelog names the cause: nothing
  // checked that the versions agree. This does.
  describe("release versions", () => {
    const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
    const FRONTMATTER_VERSION = /^\s*version:\s*"([^"]+)"/m;

    /** The version the rest of the repository has to match. */
    function declaredVersion(): string {
      const manifest = JSON.parse(
        readFileSync(join(REPOSITORY_ROOT, ".claude-plugin", "plugin.json"), "utf8"),
      ) as { version: string };
      return manifest.version;
    }

    /** A dotted version as numbers, so 0.10.0 sorts above 0.9.0 rather than below. */
    function ordered(version: string): number[] {
      return version.split(".").map(Number);
    }

    /** True when `candidate` is a later release than `existing`. */
    function isLater(candidate: number[], existing: number[]): boolean {
      for (let part = 0; part < 3; part += 1) {
        if (candidate[part] !== existing[part]) return candidate[part] > existing[part];
      }
      return false;
    }

    test("every manifest and every skill names the same version", () => {
      const version = declaredVersion();
      expect(version, "the Claude manifest states a dotted version").toMatch(/^\d+\.\d+\.\d+$/);

      const codex = JSON.parse(
        readFileSync(join(REPOSITORY_ROOT, ".codex-plugin", "plugin.json"), "utf8"),
      ) as { version: string };
      expect(codex.version, ".codex-plugin/plugin.json").toBe(version);

      const marketplace = JSON.parse(
        readFileSync(join(REPOSITORY_ROOT, ".claude-plugin", "marketplace.json"), "utf8"),
      ) as { plugins: Array<{ version: string; source: { ref: string } }> };
      expect(marketplace.plugins[0].version, "marketplace version").toBe(version);
      // The ref is the half that gets forgotten, because it reads as a
      // separate fact rather than as the same number wearing a "v".
      expect(marketplace.plugins[0].source.ref, "marketplace source.ref").toBe(`v${version}`);

      const skills = everySkillDirectory();
      expect(skills.length, "seven skills and the Codex style skill").toBe(8);
      for (const { name, path: directory } of skills) {
        const frontmatter = readFileSync(join(directory, "SKILL.md"), "utf8").split("---")[1] ?? "";
        const stated = FRONTMATTER_VERSION.exec(frontmatter);
        expect(stated, `${name} states metadata.version`).not.toBeNull();
        expect(stated?.[1], `${name} metadata.version`).toBe(version);
      }
    });

    // Matching the whole file would print all 36 KB of it on a failure, which
    // buries the one line the reader needs. The headings alone are the answer.
    test("the changelog records the version being shipped", () => {
      const recorded = readFileSync(join(REPOSITORY_ROOT, "CHANGELOG.md"), "utf8")
        .split("\n")
        .map((line) => /^## \[([^\]]+)\]/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => match[1]);

      expect(recorded, `the changelog holds ${recorded.length} release headings`).toContain(
        declaredVersion(),
      );
    });

    // Agreement alone passes when nobody touched the version at all, so this
    // asks the harder question: is the working version ahead of what has
    // already been released? Continuous integration must fetch tags for it,
    // which is why the workflow sets `fetch-depth: 0`.
    test("the version is ahead of every release already tagged", () => {
      const released = execSync("git tag --list", { cwd: REPOSITORY_ROOT, encoding: "utf8" })
        .split("\n")
        .map((tag) => RELEASE_TAG.exec(tag.trim()))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => match.slice(1, 4).map(Number));

      // An empty list means the tags were never fetched, not that nothing has
      // been released. Saying so beats passing a check that examined nothing.
      expect(released.length, "release tags are present; CI needs fetch-depth: 0").toBeGreaterThan(0);

      const working = ordered(declaredVersion());
      for (const tag of released) {
        expect(
          isLater(working, tag),
          `${working.join(".")} must be later than the released ${tag.join(".")}`,
        ).toBe(true);
      }
    });
  });
});
