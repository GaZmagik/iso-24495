import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  auditText,
  ENGINE_THRESHOLDS,
  isAuditedDocument,
  projectAcronyms,
} from "../../iso-24495-4/scripts/audit-corpus.ts";
import { readDocument } from "../../iso-24495-4/scripts/lib/parse.ts";
import { PINNED_DOCUMENT_TEXT } from "./fixtures/pinned-documents.ts";
import { normalisedForHashing } from "./reference/hashable-bytes.ts";

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
/**
 * The documents whose text this suite pins, as repository-relative paths.
 *
 * A reader meets these as rendered pages, so what they say and what a browser
 * shows have to stay the same thing.
 */
/**
 * Every file that is not TypeScript, walked here rather than asked for.
 *
 * The builder walks the same repository, and sharing that walk with this
 * file was itself a hole: a review emptied one array in the shared module,
 * and both sides then agreed that the README needed no cover. These two
 * cannot see each other, so shortening one no longer lets it agree with
 * itself.
 *
 * Four boundaries were drawn before this one and a review stood outside
 * each. So there is no boundary now: everything is covered except
 * TypeScript, whose printed sentences are pinned by their own test, and
 * machinery no reader receives.
 */
function documentsThatShip(): string[] {
  const machinery = new Set([".git", ".claude", ".iso-24495-4", "node_modules"]);
  const found = new Set<string>();

  const walk = (directory: string): void => {
    const base = directory === "" ? REPOSITORY_ROOT : join(REPOSITORY_ROOT, directory);
    for (const entry of readdirSync(base)) {
      if (machinery.has(entry)) continue;
      const here = directory === "" ? entry : `${directory}/${entry}`;
      if (statSync(join(base, entry)).isDirectory()) {
        walk(here);
      } else if (!entry.toLowerCase().endsWith(".ts")) {
        found.add(here);
      }
    }
  };

  /** The same walk without the skip list, for a directory a manifest names. */
  const walkEverything = (directory: string): void => {
    const base = join(REPOSITORY_ROOT, directory);
    for (const entry of readdirSync(base)) {
      const here = `${directory}/${entry}`;
      if (statSync(join(base, entry)).isDirectory()) {
        walkEverything(here);
      } else if (!entry.toLowerCase().endsWith(".ts")) {
        found.add(here);
      }
    }
  };

  // A manifest may point a component anywhere, including inside a directory
  // this walk skips. Three reviews attacked a list of the fields that can
  // hold such a path, and each time the list was short: the array form, then
  // MCP servers, then language servers.
  //
  // So no field names are read. Every string in a manifest that resolves to
  // something in this repository is a path this repository ships, whichever
  // key holds it, and a key the host invents tomorrow is covered today.
  const declared = (): string[] => {
    const named: string[] = [];

    const strings = (node: unknown, into: string[]): void => {
      if (typeof node === "string") {
        into.push(node);
      } else if (Array.isArray(node)) {
        for (const item of node) { strings(item, into); }
      } else if (node !== null && typeof node === "object") {
        for (const value of Object.values(node)) { strings(value, into); }
      }
    };

    for (const directory of [".claude-plugin", ".codex-plugin"]) {
      const base = join(REPOSITORY_ROOT, directory);
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base)) {
        if (!entry.toLowerCase().endsWith(".json")) continue;
        let manifest: unknown;
        try {
          manifest = JSON.parse(readFileSync(join(base, entry), "utf8"));
        } catch {
          continue;
        }
        const candidates: string[] = [];
        strings(manifest, candidates);
        for (const candidate of candidates) {
          const path = candidate.replace(/^\.\//, "").replace(/\/+$/, "");
          if (path === "" || path.includes("..")) continue;
          if (existsSync(join(REPOSITORY_ROOT, path))) named.push(path);
        }
      }
    }
    return named;
  };
  walk("");

  for (const path of declared()) {
    const full = join(REPOSITORY_ROOT, path);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) {
      walkEverything(path);
    } else if (!path.toLowerCase().endsWith(".ts")) {
      found.add(path);
    }
  }

  return [...found].sort();
}

const PINNED_DOCUMENTS = documentsThatShip();
/** Named in every failure here, because a diff cannot say what to run. */
const REBUILD =
  "rebuild with: bun skills/iso-24495-5/tests/reference/build-pinned-documents.ts";
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

/**
 * The document-level rules Part 2 adds, named as their own headings name them.
 *
 * Derived rather than written out, because a fixed list is blind to the
 * direction rules grow: a review added a sixth rule and every check passed.
 * Rules 1 to 3 govern wording, which Part 5 never covered, so the
 * document-level rules start at 4.
 */
function documentRuleNames(legal: string): string[] {
  return [...legal.matchAll(/^(\d+)\. \*\*(.+?):\*\*/gm)]
    .filter((match) => Number(match[1]) >= 4)
    .map((match) => (match[2] as string).toLowerCase().replace(/^the /, ""));
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

  // A legal document is a document, and Part 2 governed wording alone. So a
  // contract drafted through this plugin came out clearly worded inside a
  // structure nobody could navigate, which is the failure the findable
  // principle names.
  //
  // Five rounds of review found here the lesson the templates found in eight
  // disguises: a pinned phrase leaves every sentence it does not name
  // unprotected. Three separate rounds each deleted a different unpinned
  // sentence and the suite stayed green, including the layering resolution the
  // whole change was built on, and a rule added under an unbolded heading was
  // invisible to every check that existed.
  //
  // So these three blocks are the expectation as whole text. Editing a rule,
  // the worked example or the checklist means editing this list in the same
  // commit, which is the point rather than a cost.
  const PART_2_DOCUMENT_RULES = [
    "4. **Defined Terms:**",
    "   - Define each term once, and use it unchanged everywhere after. Two words for one concept invite an argument that they mean two things.",
    "   - Put the definition where the reader first meets the term. Where a term appears in more than one section, collect the definitions in one section and point the first use at it.",
    "   - Write a term out in full where the document uses it once, rather than defining it.",
    "   - Say in words that a term is defined, and where. Capital letters are silent to a listener, so **Confidential Information** on its own tells them nothing.",
    "",
    "5. **Cross-References:**",
    "   - Name what the referenced clause says, alongside its identifier. Write *\"the notice deadline in clause 4.2\"* rather than *\"clause 4.2\"*.",
    "   - Keep that wording identical to the referenced clause's own heading or opening line.",
    "   - When you point at an obligation, point at the clause carrying it, never at one that only points somewhere else. A first use pointing at the collected definitions is the exception rule 4 requires, because a definition binds nobody.",
    "",
    "6. **Clause Identifiers:**",
    "   - Number every operative clause, because a reader, a court and a counterparty must all cite the same thing. An operative clause imposes, permits or prohibits an action. Recitals, definitions and schedules are numbered by the conventions of the document, not by this rule.",
    "   - Write the identifier into the clause text rather than as list markup. Markdown numbers an ordered list 1, 2, 3, so a compound identifier such as 4.2.1 survives only when it is written in the text.",
    "   - This is the one place a legal document departs from Part 5's rule that a sequence stays an ordered list.",
    "   - A clause identifier is neither a heading nor list numbering. So it does not count against Part 5's heading limit, and Part 5's rule on numbering headings does not govern it.",
    "   - Keep an identifier for the life of the document. An amendment adds a clause, or marks one deleted, and leaves every existing number where it is, because filings, correspondence and other contracts cite those numbers.",
    "",
    "7. **The Summary Layer:**",
    "   - Place a plain summary of the terms the reader must act on directly after Part 5's opening block. Give it the overview's own heading, because a summary of what a reader must act on is the conclusion they need before the detail, which is what Part 5 labels. Cover what they must do, what they must pay, when the agreement ends, and how to leave it. A document without one or more of those, such as a privacy policy with no payment, covers the rest. A document with no terms the reader must act on needs no summary of this shape, and Part 5 still decides whether it has an overview.",
    "   - The summary **must** state that the operative text governs, and **must** name where that text starts. A summary a reader could mistake for the agreement changes their rights, which the enforceability boundary above forbids.",
    "   - The summary **must not** add an obligation, newly qualify one, or leave a reader believing an obligation is gone. Where the operative text already qualifies a term, state the term together with that qualification, which Part 5 requires the overview to keep. Where stating it would take more words than the clause itself, leave the term out and point to its clause. A pointer keeps the obligation reachable, so it is not a removal.",
    "   - Map the document onto Part 5's three levels of detail. The summary is the overview, and the operative terms are the main body. Place each schedule by what it holds, because Part 5's optional detail is for what only some readers need. A schedule carrying an obligation, a payment or a limit belongs in the main body with the rest of the operative terms, whichever page it is printed on. Reserve the optional level for a schedule a reader can skip and still comply, such as a list of contacts or a specimen form.",
    "",
    "8. **Section Names:**",
    "   - A contract's section names are the reference case Part 5 already allows, and not a new exception. A reader jumps to Payment, Termination or Liability by subject, so each keeps its subject as its name.",
  ];

  const PART_2_SUMMARY_EXAMPLE = [
    "### Example 2: The Summary Layer",
    "* ❌ **Not aligned (no governing text named, and an obligation stated without its qualification):**",
    "  ```text",
    "  Summary: You can cancel at any time and we will refund the current month.",
    "  ```",
    "* ✅ **ISO 24495-2 Aligned:**",
    "  > #### Summary of your main terms",
    "  >",
    "  > This summary helps you find your obligations. The agreement itself, starting at clause 1, is what governs.",
    "  >",
    "  > - **What you pay:** You must pay £15 each month, in advance. Clause 3 covers late payment.",
    "  > - **What you must do:** You must keep your account details current. Clause 5 lists your other obligations.",
    "  > - **When it ends:** The agreement ends after 12 months, unless you renew it. Clause 6 has the renewal terms.",
    "  > - **How to leave:** You may cancel, giving the notice set out in clause 7.",
  ];

  const PART_2_CHECKLIST = [
    "- [ ] **No legalese:** Are terms like *\"shall\"*, *\"hereinafter\"*, and *\"hereby\"* eliminated?",
    "- [ ] **Modal verbs:** Are obligations expressed using only *must*, *must not*, or *may*?",
    "- [ ] **Explicit subjects:** Is every obligation attached to a clearly named actor?",
    "- [ ] **Structured clauses:** Are complex conditions presented as itemised lists?",
    "- [ ] **Legal accuracy:** Is legal enforceability preserved?",
    "- [ ] **Defined terms:** Is each term defined once, used unchanged, and reachable from its first use?",
    "- [ ] **Cross-references:** Does each name what the clause says, as well as its identifier?",
    "- [ ] **Identifiers:** Is every operative clause numbered, with existing numbers untouched by amendment?",
    "- [ ] **Summary:** Does it name the governing text, and add, qualify and remove nothing?",
    "- [ ] **Section names:** Does each name the subject a reader would look for?",
    "- [ ] **Design applied:** Did `iso-24495-5` run over the document as well as this skill?",
  ];

  test("the legal skill's rules, example and checklist are exactly this text", () => {
    const legal = readFileSync(join(SKILLS_ROOT, "iso-24495-2", "SKILL.md"), "utf8");
    const between = (start: string, end: string): string[] => {
      const from = legal.indexOf(start);
      expect(from, `iso-24495-2 must contain ${start}`).toBeGreaterThan(-1);
      const to = legal.indexOf(end, from);
      expect(to, `${start} must be followed by ${end}`).toBeGreaterThan(from);
      return legal.slice(from, to).trimEnd().split(/\r?\n/);
    };
    expect(between("4. **Defined Terms:**", "\n---")).toEqual(PART_2_DOCUMENT_RULES);
    expect(between("### Example 2:", "\n---")).toEqual(PART_2_SUMMARY_EXAMPLE);
    const checklist = legal.slice(legal.indexOf("- [ ] **No legalese:**"));
    expect(checklist.trimEnd().split(/\r?\n/)).toEqual(PART_2_CHECKLIST);
  });

  // Both skills load on a contract, so their limits have to agree in writing.
  // Clause 4.2.1 is a compound identifier, and no ordered list renders one, so
  // Part 5's rule that a sequence stays an ordered list needs the exception
  // stated where that rule is stated.
  test("the legal and design skills name their shared boundary", () => {
    const legal = readFileSync(join(SKILLS_ROOT, "iso-24495-2", "SKILL.md"), "utf8");
    const design = readFileSync(join(SKILLS_ROOT, "iso-24495-5", "SKILL.md"), "utf8");
    expect(legal, "Part 2 must send the reader to Part 5").toContain(
      "`iso-24495-5` loads alongside this skill");
    expect(legal, "a contract's headings must use an exception Part 5 already allows").toContain(
      "A contract's section names are the reference case Part 5 already allows");
    expect(design, "Part 5 must name the clause-identifier exception").toContain(
      "A legal document's clause identifiers are the one exception");
    // The rule body and the checklist have to carry the same exception, or the
    // self-audit rejects a document the rule permits.
    expect(design, "the Part 5 checklist must carry the same exception").toContain(
      "clause identifiers exempt");

    // The boundary tells a writer which skill holds what, so a rule it never
    // names sends them to the wrong one. Carving section names out of the
    // summary rule did exactly that.
    //
    // The list is derived from the rules rather than written out here, for two
    // reasons a review demonstrated against the written-out version. A fixed
    // list is blind to the direction rules actually grow: a sixth rule was
    // added and the check passed. And searching the whole boundary section
    // passes on words appearing anywhere in it, so the enumeration was emptied
    // into a neighbouring bullet and the check still passed. So this reads the
    // one bullet that divides the rules, and asks it about every rule that
    // exists. The bullet splits them: most cover what Part 5 leaves out, and
    // section names apply a case it already allows. Both halves are on the
    // line, because naming only the additions would leave the rest unplaced.
    const enumeration = legal.split(/\r?\n/)
      .find((line) => /rules below cover what Part 5 leaves out/.test(line)) ?? "";
    expect(enumeration, "the boundary must carry an enumeration").not.toBe("");
    const added = documentRuleNames(legal);
    expect(added.length, "the skill must carry document-level rules").toBeGreaterThan(0);
    for (const rule of added) {
      expect(enumeration, `the boundary must name the rule it adds: ${rule}`)
        .toContain(rule);
    }

    // The README row is living documentation of what this skill carries, and a
    // snapshot of the skill cannot see it. A review deleted the section-names
    // clause from that row and every test passed.
    const readme = readFileSync(join(REPOSITORY_ROOT, "README.md"), "utf8");
    const row = readme.split(/\r?\n/).find((line) => line.startsWith("| `iso-24495-2` |")) ?? "";
    expect(row, "the README must carry a row for the legal skill").not.toBe("");
    for (const rule of added) {
      expect(row.toLowerCase(), `the README row must name: ${rule}`).toContain(rule);
    }
  });

  // Wording rules were all a contract task could reach. The Part 5 trigger
  // named reports, specifications and guides, and stopped there, so the design
  // rules existed and nothing routed a licence or a contract to them.
  test("a legal task reaches the document design skill", () => {
    const core = readFileSync(join(SKILLS_ROOT, "iso-24495-1", "SKILL.md"), "utf8");
    const lines = core.split("\n");
    const legalTrigger = lines.find((line) => line.includes("`iso-24495-2` (Legal")) ?? "";
    expect(legalTrigger, "the legal trigger must activate Part 5 too").toContain(
      "Activate `iso-24495-5` alongside it");
    const designTrigger = lines.find((line) => line.includes("`iso-24495-5` (Document Design")) ?? "";
    expect(designTrigger, "the design trigger must name contracts").toContain("contracts");

    // The Codex style skill holds this body word for word, so one check covers
    // both. Both halves are pinned: the legal entry that reaches Part 5, and
    // the Part 5 entry that admits a contract.
    const style = readFileSync(join(REPOSITORY_ROOT, "output-styles", "iso-24495.md"), "utf8");
    const styleLines = style.split("\n");
    const styleLegal = styleLines.find((line) => line.includes("**`iso-24495-2`:**")) ?? "";
    expect(styleLegal, "the style must route a legal task to Part 5").toContain(
      "Invoke `iso-24495-5` with it");
    const styleDesign = styleLines.find((line) => line.includes("**`iso-24495-5`:**")) ?? "";
    expect(styleDesign, "the style's design entry must admit a contract").toContain(
      "contracts included");

  });

  // The lesson the rules block already learned, applied to every line this
  // branch wrote in the other files. Pinning a phrase leaves every other
  // phrase of the same sentence deletable: a review kept the pinned tail of
  // the README's routing sentence and deleted its main clause, so the file
  // stopped saying that legal content triggers this skill at all.
  //
  // These are whole lines and whole blocks. Editing one means editing it here
  // in the same commit, which is the point rather than a cost.
  const PART_2_SCOPE_BOUNDARY = [
    "3. **Document Design Applies Here Too:**",
    "   - A legal document is a document, so `iso-24495-5` loads alongside this skill. Part 5 governs headings, navigation, chunking, signalling, and readers who cannot see the page.",
    "   - Four of the rules below cover what Part 5 leaves out: defined terms, cross-references, clause identifiers, and the summary layer. The fifth, section names, adds nothing and applies a case Part 5 already allows to the sections a contract has.",
    "   - Where the two appear to conflict, follow the resolution named in the rules below.",
  ];

  const PART_3_SCOPE_BOUNDARY = [
    "3. **Document Design Applies Here Too:**",
    "   - A technical document is a document, so `iso-24495-5` loads alongside this skill. Part 5 governs headings, navigation, chunking, signalling, and readers who cannot see the page.",
    "   - It loads for a document, not for every explanation. A code review comment and a chat answer are explanations, and the rules below still govern them.",
    "   - Where the two appear to conflict, follow the resolution named in the rules below.",
  ];

  const PART_3_RULES = [
    "1. **Progressive Disclosure Ordering:**",
    "   Structure every technical explanation in these stages, in this order:",
    "   1. **System Purpose:** High-level operational intent (1 sentence).",
    "   2. **Architecture & Data Flow:** Diagram (Mermaid) or summary table. Rule 4 governs the diagram's text alternative, and Part 5 governs the table. Required where the explanation covers how more than one component relates to another. A single mechanism needs none, and neither does a sequence of steps that an ordered list already presents in order. A diagram nobody needs is the decoration Part 5 forbids.",
    "   3. **Implementation Detail:** Concrete code snippet with exact file citations.",
    "",
    "   These stages order an explanation, and Part 5's three levels order a document. They are different axes rather than two versions of one, so they do not map one to one. Where the explanation is a document:",
    "   - The purpose sentence supplies the purpose line of Part 5's opening block, and opens its overview where Part 5 calls for one. The block's title, version and named reader are not its to supply, and Part 5 still requires them of the author. That overview also keeps the conclusion, the action required and any essential qualification, which one sentence does not.",
    "   - Stages 2 and 3 sit in the main body, in that order.",
    "   - Part 5's optional detail holds what a reader can skip and still act on. No stage covers it, so nothing is demoted there by default.",
    "",
    "   A stage covers what the explanation contains. A runbook explains what to do and a decision record explains a choice, so neither needs stage 2's diagram of components nor stage 3's code. Omit a stage the explanation has no content for, and keep the order of those it has. They also do not exclude what a genre needs beside them: an incident report's timeline sits with the stages rather than inside one.",
    "",
    "2. **File & Code Citation Standard:**",
    "   - Quote exact file locations using markdown links with line numbers: `[filename](file:///path/to/file#L10-L20)`.",
    "   - Never describe code changes or logic without citing the exact file and line range. This governs an explanation of code. A guide describing what a user does needs no citation.",
    "",
    "3. **Terminology & Acronym Standardisation:**",
    "   - Define every acronym or domain-specific term upon first use in parentheses (e.g. *\"Abstract Syntax Tree (AST)\"*).",
    "   - Use consistent symbol names across text, code snippets, and diagrams.",
    "",
    "4. **Diagrams and Their Alternatives:**",
    "   - Give every diagram a text alternative saying what it shows, not what it is. Part 5 requires that of any image carrying meaning. Stage 2 above offers a diagram as one way to meet it, so this rule says where the alternative goes. A summary table is the other way, and Part 5 already governs it.",
    "   - A Mermaid diagram reaches a listener as its source text, which is not an explanation. So the alternative is prose beside the diagram, never the diagram's own labels.",
  ];

  const PART_3_EXAMPLE = [
    "### Example 1: Concurrency Control Explanation",
    "* ❌ **Not aligned (Dense & Abstract):**",
    "  ```text",
    "  In order to prevent race conditions during concurrent state mutations",
    "  within the execution pipeline, a mutex lock mechanism is introduced prior",
    "  to updating the shared buffer allocation in memory.",
    "  ```",
    "* ✅ **ISO 24495-3 Aligned:**",
    "  > **System Purpose:**",
    "  > Acquire a Mutex Lock to prevent data corruption during concurrent writes.",
    "  > ",
    "  > **Implementation Detail:**",
    "  > The locking logic is implemented in [`state_manager.rs:L45-L52`](file:///src/state_manager.rs#L45-L52):",
    "  > ```rust",
    "  > let _guard = self.mutex.lock().unwrap();",
    "  > self.buffer.update(data);",
    "  > ```",
  ];

  const PART_3_CHECKLIST = [
    "- [ ] **Progressive structure:** Is system purpose stated before architecture and code?",
    "- [ ] **Exact citations:** Are code citations backed by `file:///` links and line numbers?",
    "- [ ] **Acronym definitions:** Are acronyms and specialized terms defined upon first use?",
    "- [ ] **Visual aids:** Does a diagram or table show how components relate, unless an ordered list already presents that relationship as a sequence?",
    "- [ ] **Code immunity:** Are code snippets and commands intact and un-mangled?",
    "- [ ] **Text alternatives:** Does every diagram carry prose saying what it shows?",
    "- [ ] **Layering:** Where the explanation is a document, do the stages sit in Part 5's levels as rule 1 says?",
    "- [ ] **Design applied:** Did `iso-24495-5` run over the document as well as this skill?",
  ];

  const PART_5_TOUCHED_LINES = [
    "   - **Sequences:** Use a numbered list for steps that must happen in order. Keep it an ordered list rather than numbers typed into a paragraph, so the sequence survives when the document is heard. A legal document's clause identifiers are the one exception, because no ordered list renders a compound identifier such as 4.2.1, and `iso-24495-2` governs them.",
    "   - **Options and collections:** Use a bulleted list for unordered sets of 3 or more items. Keep each bullet to one paragraph carrying one idea, and nest bulleted lists no deeper than 2 levels. Promote longer material to a subsection.",
    "- [ ] **Restraint:** Is every bulleted item one paragraph on one idea, nested no deeper than 2 levels, with longer material promoted to a subsection?",
    "- [ ] **Structure fit:** Are sequences in ordered lists, sets in bullets, and forks in a decision table or labelled conditions, with a legal document's clause identifiers exempt?",
    "   - Use at most **3 levels**: overview, main body, and optional detail. Part 3 governs a technical explanation's stages, and states where each one lands in these levels.",
    "   - Two exceptions here, one override in rule 8, and no others. A document type with a published structure keeps that structure's section names, as a decision record keeps Context and Decision.",
    "   - Give that label a heading, never bold text or a visual treatment alone. A listener reaches it through the heading list or not at all.",
    "- [ ] **Overview label and detail:** Is the label a heading rather than bold text alone, and has the detail moved to footnotes, an appendix or a collapsible block?",
  ];

  const PROXY_NOTE_LINES = [
    "> **Proxy status:** These rules are this project's own proxies for the standard's principles, not its text. Following them is never a claim of ISO conformance.",
  ];

  const CORE_ROUTING_LINES = [
    "- **`iso-24495-2` (Legal & Compliance):** Activate when handling contracts, licenses, terms of service, privacy policies, or statutory rules. Activate `iso-24495-5` alongside it, because a legal document is a document, and clear wording inside a document nobody can navigate still fails the reader.",
    "- **`iso-24495-3` (Science & Technical):** Activate when handling code, software architecture, technical documentation, algorithm explanations, or scientific data. Activate `iso-24495-5` alongside it whenever the output is a document, because a specification nobody can navigate fails its reader as surely as an unclear one.",
    "- **`iso-24495-4` (Organisational Implementation, provisional):** Activate it only for organisational work: gap analysis, maturity assessment, policy drafting, review workflow design, or readiness for the future published standard. Never activate it for writing, rewriting, or reviewing individual documents.",
    "- **`iso-24495-5` (Document Design, provisional):** Activate when producing complex multi-section documents (reports, specifications, guides, contracts) where layout, visual hierarchy, and navigation aids shape readability.",
    "- **`iso-24495-text-audit` (Text Audit):** Never activate automatically. The user invokes it to audit one selected text file or directory.",
  ];

  const STYLE_ROUTING_LINES = [
    "- **`iso-24495-1`:** The core standard; governs every response.",
    "- **`iso-24495-2`:** Legal writing: contracts, licences, compliance text. Invoke `iso-24495-5` with it, because a legal document must be navigable as well as readable.",
    "- **`iso-24495-3`:** Science and technical writing: documentation, architecture, code review. Invoke `iso-24495-5` with it whenever the output is a document.",
    "- **`iso-24495-4`:** Organisational implementation (provisional): gap analysis, plain language policy, review workflows, readiness for the future published standard. Never for writing individual documents.",
    "- **`iso-24495-5`:** Document design (provisional): structuring complex multi-section documents, contracts included.",
    "- **`iso-24495-text-audit`:** User-invoked text audit. Never invoke it automatically.",
  ];

  const README_LINES = [
    "| `iso-24495-2` | **Legal writing.** Extends the core skill for contracts, licences, and compliance text: standardised modal verbs, no legalese, named actors, structured conditional clauses, defined terms, cross-references that name what they point at, stable clause identifiers, a summary layer over the operative text, and section names a reader can navigate by. |",
    "| `iso-24495-3` | **Science and technical writing.** Extends the core skill for documentation, architecture, and code review: progressive disclosure, exact file citations, defined acronyms, text alternatives for diagrams, and the stages placed inside the document levels of `iso-24495-5`. |",
    "The core skill activates the relevant writing skills automatically. It triggers `iso-24495-2` for legal content, `iso-24495-3` for technical content, and `iso-24495-5` for complex documents. A legal document always pairs with `iso-24495-5`, and a technical one does whenever its output is a document. The text audit never activates automatically.",
  ];
  test("the lines this branch wrote elsewhere are exactly this text", () => {
    const blockOf = (text: string, start: string, end: string, what: string): string[] => {
      const from = text.indexOf(start);
      expect(from, `${what} must contain ${start}`).toBeGreaterThan(-1);
      const to = text.indexOf(end, from);
      expect(to, `${start} must be followed by ${end}`).toBeGreaterThan(from);
      return text.slice(from, to).trimEnd().split(/\r?\n/);
    };

    const legal = readFileSync(join(SKILLS_ROOT, "iso-24495-2", "SKILL.md"), "utf8");
    expect(blockOf(legal, "3. **Document Design Applies Here Too:**", "\n---", "iso-24495-2"))
      .toEqual(PART_2_SCOPE_BOUNDARY);

    // Part 3 is held to the same standard from its first commit, rather than
    // after a review demonstrates the hole. Nine rounds on Part 2 earned that.
    const tech = readFileSync(join(SKILLS_ROOT, "iso-24495-3", "SKILL.md"), "utf8");
    expect(blockOf(tech, "3. **Document Design Applies Here Too:**", "\n---", "iso-24495-3"))
      .toEqual(PART_3_SCOPE_BOUNDARY);
    expect(blockOf(tech, "1. **Progressive Disclosure Ordering:**", "\n---", "iso-24495-3"))
      .toEqual(PART_3_RULES);
    // The rule was relaxed because this example was compliant, so the
    // justification for that change rests on the example staying as it is.
    expect(blockOf(tech, "### Example 1: Concurrency Control Explanation", "\n---",
      "iso-24495-3")).toEqual(PART_3_EXAMPLE);
    const checklist = tech.slice(tech.indexOf("- [ ] **Progressive structure:**"));
    expect(checklist.trimEnd().split(/\r?\n/)).toEqual(PART_3_CHECKLIST);

    // Both skills whose title names a published standard carry the same note,
    // because a title read alone can look like the standard itself.
    for (const skill of ["iso-24495-2", "iso-24495-3"]) {
      const lines = readFileSync(join(SKILLS_ROOT, skill, "SKILL.md"), "utf8").split(/\r?\n/);
      for (const line of PROXY_NOTE_LINES) {
        expect(lines, `${skill} must keep its proxy note`).toContain(line);
      }
    }

    const design = readFileSync(join(SKILLS_ROOT, "iso-24495-5", "SKILL.md"), "utf8")
      .split(/\r?\n/);
    for (const line of PART_5_TOUCHED_LINES) {
      expect(design, `Part 5 must keep this line unchanged: ${line.slice(0, 40)}`)
        .toContain(line);
    }

    const readme = readFileSync(join(REPOSITORY_ROOT, "README.md"), "utf8").split(/\r?\n/);
    for (const line of README_LINES) {
      expect(readme, `the README must keep this line unchanged: ${line.slice(0, 40)}`)
        .toContain(line);
    }

    // The three routing lists. Their instructions were pinned by phrase, and a
    // review deleted the reason this change gave on each while the suite
    // stayed green. A reader who is told to do a thing and not why drops it
    // first, so the reason is part of the line.
    const core = readFileSync(join(SKILLS_ROOT, "iso-24495-1", "SKILL.md"), "utf8")
      .split(/\r?\n/);
    for (const line of CORE_ROUTING_LINES) {
      expect(core, `the core skill must keep this trigger unchanged: ${line.slice(0, 40)}`)
        .toContain(line);
    }
    // The Codex skill holds the output style body word for word, and a
    // separate test enforces that. Both are checked here, so deleting the same
    // text from both at once cannot slip through the pair being identical.
    for (const file of [
      join(REPOSITORY_ROOT, "output-styles", "iso-24495.md"),
      join(CODEX_SKILLS_ROOT, "iso-24495-style", "SKILL.md"),
    ]) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (const line of STYLE_ROUTING_LINES) {
        expect(lines, `${relative(REPOSITORY_ROOT, file)} must keep: ${line.slice(0, 40)}`)
          .toContain(line);
      }
    }
  });

  // Five checks tried to name what a document may not contain, and five
  // reviews walked past them. A tag at a line start, then anywhere, then
  // code spans and autolinks exempted, then a tokeniser, then the character
  // itself. The last one failed on its own premise: a paragraph wrapped in
  // image syntax renders as alternative text, and one wrapped in a link
  // title renders as an attribute, and neither needs a less-than sign. The
  // pinned text was intact, the gate was green, and a browser showed no
  // paragraph.
  //
  // Each of those checks guarded the text and left the space around it open,
  // which is the same defect the block expectations already learned once.
  // Pinning a phrase left the rest of its sentence free; pinning a block
  // leaves the lines on either side of it free. Nothing short of the whole
  // file closes that, and the whole file needs no grammar to check.
  //
  // So these documents are held entire, the way the three templates are.
  // The cost is that editing one means running the builder in the same
  // commit, and that cost is the point: the fixture's diff is the record of
  // what a reader's page gained or lost.
  // The fixture is written by a script, and a script's inputs are a place to
  // hide. A review deleted one path from the builder, rebuilt, and then
  // changed the document that path had covered: nothing failed and no count
  // moved. So the set is derived from the manifests here as well as there,
  // and the two must agree. Each is computed without reading the other, so
  // shortening one no longer lets it agree with itself. Removing a skill
  // from a manifest stops it
  // shipping, which is a visible act rather than a quiet one.
  test("the fixture covers every document the manifests ship", () => {
    expect(Object.keys(PINNED_DOCUMENT_TEXT).sort(), REBUILD)
      .toEqual(PINNED_DOCUMENTS);
  });

  test("no line of a pinned document changes without its fixture changing", () => {

    for (const file of PINNED_DOCUMENTS) {
      const bytes = readFileSync(join(REPOSITORY_ROOT, file));
      const pinned = PINNED_DOCUMENT_TEXT[file];
      const actual = bytes.toString("utf8").split(/\r?\n/);
      const expected = pinned?.lines ?? [];

      // Decoding is lossy, and a review used that: a price written in UTF-16
      // changed from pounds to yen, both bytes decoded to the same replacement
      // character, and every line still matched. The digest sees the bytes.
      expect(
        createHash("sha256")
          .update(normalisedForHashing(bytes), "latin1")
          .digest("hex"),
        `${file} changed in bytes its lines cannot show. ${REBUILD}`,
      ).toBe(pinned?.digest ?? "");

      // Named line by line rather than as one blob, because a failure saying
      // only that a 209 line file differs sends the reader to a diff tool.
      const reach = Math.max(actual.length, expected.length);
      for (let line = 0; line < reach; line += 1) {
        expect(actual[line], `${file}:${line + 1} changed. ${REBUILD}`)
          .toBe(expected[line] as string);
      }
    }
  });

  test("every skill directory is routed, so a new one cannot arrive unrouted", () => {
    // The code skill is deliberately absent from both lists, because code
    // sits outside the standard. The core skill hosts the routing list, so
    // it does not route itself, though the output style still names it.
    // Two skills are deliberately unrouted. Code sits outside the standard,
    // and the style skill holds the output style itself rather than being a
    // destination anyone routes to.
    const UNROUTED = new Set(["iso-24495-code", "iso-24495-style"]);
    const HOSTS_THE_LIST = "iso-24495-1";

    // A skill is any directory holding a SKILL.md under either root, which is
    // how the frontmatter suite finds them. Two narrower guesses shipped a
    // skill unrouted with the gate green: filtering on the iso-24495 prefix
    // missed one named for its subject, and reading only skills/ missed one
    // that the Codex manifest ships from codex-skills/.
    const shipped = [SKILLS_ROOT, CODEX_SKILLS_ROOT]
      .flatMap((root) => readdirSync(root)
        .filter((entry) => existsSync(join(root, entry, "SKILL.md"))))
      .filter((entry) => !UNROUTED.has(entry))
      .sort();
    expect(shipped.length, "there must be skills to route").toBeGreaterThan(0);

    const core = CORE_ROUTING_LINES.join(String.fromCharCode(10));
    const style = STYLE_ROUTING_LINES.join(String.fromCharCode(10));

    for (const skill of shipped) {
      expect(style, `the output style must route ${skill}`)
        .toContain(`\`${skill}\``);
      if (skill === HOSTS_THE_LIST) continue;
      expect(core, `the core skill must route ${skill}`)
        .toContain(`\`${skill}\``);
    }

    // And nothing routes what is deliberately unrouted.
    for (const skill of UNROUTED) {
      expect(core, `${skill} must stay out of the core routing list`)
        .not.toContain(`\`${skill}\``);
      expect(style, `${skill} must stay out of the style routing list`)
        .not.toContain(`\`${skill}\``);
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

      // The version test reads git tags, and a default checkout fetches none.
      // It already refuses an empty tag list, so a shallow checkout fails the
      // build rather than passing quietly. This says so here instead, where
      // the cause is one line away from the reader, because a run that dies
      // in the version test names the symptom and not this setting.
      expect(workflow, "a shallow checkout leaves the version test no tags to read")
        .toMatch(/^\s*fetch-depth:\s*0\s*$/m);
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
