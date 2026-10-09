import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, posix, relative } from "node:path";
import ts from "typescript";
import {
  auditText,
  ENGINE_THRESHOLDS,
  isAuditedDocument,
  projectAcronyms,
} from "../../iso-24495-4/scripts/audit-corpus.ts";
import { checkVersionSites } from "../../../scripts/release-versions.ts";
import { PINNED_DOCUMENT_TEXT } from "./fixtures/pinned-documents.ts";
import { SHIPPED_DOCUMENTS } from "./reference/shipped-documents.ts";

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
 * Whether a file is one this repository pins, decided by its name.
 *
 * Deciding by decoding was circular, and a review walked through the circle:
 * it removed a reference from the list, reversed a sentence in it and appended
 * one invalid byte, and the file then failed to be text and so was never
 * required to be listed. A file does not stop being a document by being
 * damaged. Its name says what it is meant to be, and the encoding check below
 * says whether it still is.
 */
function isPinnedKind(file: string): boolean {
  const name = file.toLowerCase();
  // Prose comes from the engine's own list, which a second list here got
  // wrong: it omitted the .markdown extension that this repository documents
  // and the engine audits, so a reference in that format shipped unpinned.
  // The engine's comment says every caller must ask it rather than compare
  // extensions, and this is a caller.
  return isAuditedDocument(name)
    || [".yaml", ".yml", ".json"].some((kind) => name.endsWith(kind))
    || !name.includes(".");
}

const PINNED_DOCUMENTS = [...SHIPPED_DOCUMENTS];
/** Named in every failure here, because a diff cannot say what to run. */
const REBUILD =
  "rebuild with: bun skills/iso-24495-5/tests/reference/build-pinned-documents.ts";
const ENTRY_FILES = [
  "skills/iso-24495-design-audit/scripts/design-audit-cli.ts",
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
    // It reads every text file in the repository, which took 16 seconds on a
    // loaded machine against the 5-second default, so it gets the same limit as
    // the other whole-repository tests.
  }, 60_000);

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

  test("every output-style bullet opens with bold words", () => {
    const style = readFileSync(join(REPOSITORY_ROOT, "output-styles", "iso-24495.md"), "utf8");
    const bullets = style.split(/\r?\n/).filter((line) => /^\s*-\s+/.test(line));
    expect(bullets.length, "the output style must contain enough bullets to exercise the rule")
      .toBeGreaterThanOrEqual(20);
    const unlabelled = bullets.filter((line) => !/^\s*-\s+\*\*[^*]+\*\*/.test(line));
    expect(unlabelled).toEqual([]);
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
  // Part 5 forbids rewording prose: a restructure changes headings, list types,
  // formatting and position, adds a label or a marked slot, and leaves every
  // word as written. Examples 17 and 18 each once reworded their "before", and
  // each was found by a reviewer rather than a test.
  test("every Part 5 example in the output style restructures without rewording", () => {
    const style = readFileSync(join(REPOSITORY_ROOT, "output-styles", "iso-24495.md"), "utf8");
    const section = style.slice(
      style.indexOf("### Document design (Part 5)"),
      style.indexOf("### Source code"),
    );
    const examples = section.split(/\n(?=#### \d+\. )/).slice(1);
    expect(examples.length).toBe(4);
    /** The words a reader meets, once the structure a restructure may add is removed. */
    const words = (block: string): string[] => block
      .split("\n")
      .map((line) => line.replace(/^(?:Before:|After:)/, "").replace(/^ {0,8}/, ""))
      // A heading, and an elision standing for the lines not shown.
      .filter((line) => !/^\s*(?:#|\.\.\.\s*$)/.test(line))
      // A list marker, a bold label such as "**Purpose:**", and a marked slot.
      .map((line) => line
        .replace(/^\s*-\s*/, "")
        .replace(/^\*\*[^*]+:\*\*\s*/, "")
        .replace(/\[Author needed:[^\]]*\]/g, "")
        .replace(/\*\*/g, "")
        // A link reads as its text.
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"))
      .join(" ")
      .split(/\s+/)
      .filter((word) => word !== "");
    for (const example of examples) {
      const title = example.split("\n")[0];
      const code = /```text\n([\s\S]*?)```/.exec(example);
      expect(code, title).not.toBeNull();
      const [before, after] = (code as RegExpExecArray)[1].split(/^After:/m);
      expect(after, title).toBeDefined();
      expect(words(after as string), title).toEqual(words(before));
    }
  });

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
    "* ❌ **Not aligned (the summary drops conditions in the source clause):**",
    "  ```text",
    "  9.1 The Customer may terminate this Agreement by giving the Supplier at",
    "      least 30 days' written notice. If the Customer does so, the Supplier",
    "      must refund to the Customer the fees paid for the part of the term",
    "      that has not yet run. The refund is calculated pro rata.",
    "",
    "  Summary: You can end the Agreement and get your money back.",
    "  ```",
    "* ✅ **ISO 24495-2 Aligned:**",
    "  > ## Summary of your main terms",
    "  >",
    "  > The operative text starts at clause 9.1 below, and it governs.",
    "  >",
    "  > - **Ending the Agreement:** You may end this Agreement by giving the Supplier at least 30 days' written notice.",
    "  > - **Refund:** If you do, the Supplier must refund you the fees paid for the part of the term that has not yet run, calculated pro rata.",
    "  >",
    "  > ```text",
    "  > 9.1 The Customer may terminate this Agreement by giving the Supplier at",
    "  >     least 30 days' written notice. If the Customer does so, the Supplier",
    "  >     must refund to the Customer the fees paid for the part of the term",
    "  >     that has not yet run. The refund is calculated pro rata.",
    "  > ```",
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
    const example = between("### Example 2:", "\n---");
    expect(example).toEqual(PART_2_SUMMARY_EXAMPLE);
    const sourceStart = example.findIndex((line) => line.startsWith("  9.1 "));
    const operativeStart = example.findIndex((line) => line.startsWith("  > 9.1 "));
    const operativeEnd = example.findIndex((line, index) => index > operativeStart && line === "  > ```");
    expect(sourceStart).toBeGreaterThan(-1);
    expect(operativeStart).toBeGreaterThan(-1);
    expect(operativeEnd).toBeGreaterThan(operativeStart);
    const sourceEnd = example.findIndex((line, index) => index > sourceStart && line === "");
    expect(sourceEnd).toBeGreaterThan(sourceStart);
    const sourceClause = example.slice(sourceStart, sourceEnd)
      .map((line) => line.trim()).join(" ");
    const operativeClause = example.slice(operativeStart, operativeEnd)
      .map((line) => line.replace(/^ {2}>\s*/, "").trim()).join(" ");
    expect(operativeClause, "the operative text must preserve its governing source")
      .toBe(sourceClause);
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
  // moved. So the fixture's keys and the pinned list must agree here, and the
  // floor below says nothing has quietly left that list.
  // A list can be short, and a review proved that by shortening one. This
  // is the floor beneath it: everything of a kind this repository is known
  // to ship must be listed, so a skill or a manifest cannot arrive unnoticed.
  //
  // It checks kinds it can name rather than trying to work out what a host
  // will load. Five attempts at that inference were defeated in turn, and
  // the reviewer who defeated them advised stopping. A narrow floor that
  // holds beats a broad one that does not.
  test("every skill and manifest present is on the pinned list", () => {
    const listed = new Set(SHIPPED_DOCUMENTS);
    const missing: string[] = [];

    for (const root of ["skills", "codex-skills"]) {
      const base = join(REPOSITORY_ROOT, root);
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base)) {
        for (const file of ["SKILL.md", "agents/openai.yaml"]) {
          const path = `${root}/${entry}/${file}`;
          if (!existsSync(join(REPOSITORY_ROOT, path))) continue;
          if (!listed.has(path)) missing.push(path);
        }
      }
    }

    for (const root of [".claude-plugin", ".codex-plugin"]) {
      const base = join(REPOSITORY_ROOT, root);
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base)) {
        if (!entry.toLowerCase().endsWith(".json")) continue;
        const path = `${root}/${entry}`;
        if (!listed.has(path)) missing.push(path);
      }
    }

    // The other kinds this repository is known to ship: what a skill hands a
    // reader, the output style, and the three documents at the root. Removing
    // one line from the list passed until these were counted too.
    // Files, at whatever depth, and text only. A review added a note in a
    // sub-folder and a diagram beside it, and the floor demanded the folder
    // rather than the note while the diagram failed for not being text. A
    // skill may hand a reader a picture; this list holds what it says, and a
    // picture says nothing this fixture can hold.
    const textFilesUnder = (directory: string, prefix: string): void => {
      const base = join(REPOSITORY_ROOT, directory);
      if (!existsSync(base)) return;
      for (const entry of readdirSync(base)) {
        const here = `${prefix}/${entry}`;
        const path = join(base, entry);
        if (statSync(path).isDirectory()) {
          textFilesUnder(`${directory}/${entry}`, here);
        } else if (isPinnedKind(entry) && !listed.has(here)) {
          missing.push(here);
        }
      }
    };

    for (const root of ["skills", "codex-skills"]) {
      const base = join(REPOSITORY_ROOT, root);
      if (!existsSync(base)) continue;
      for (const skill of readdirSync(base)) {
        for (const kind of ["assets", "references"]) {
          textFilesUnder(`${root}/${skill}/${kind}`, `${root}/${skill}/${kind}`);
        }
      }
    }

    textFilesUnder("output-styles", "output-styles");

    // Named rather than swept, because the root holds build and repository
    // furniture that no reader receives. A review added a contributing guide
    // and it was not required here, which is a narrower claim than the commit
    // made and the honest one.
    for (const file of ["README.md", "LICENSE", "CHANGELOG.md", "CONTRIBUTING.md"]) {
      if (!existsSync(join(REPOSITORY_ROOT, file))) continue;
      if (!listed.has(file)) missing.push(file);
    }

    expect(missing, `these ship but are not pinned. ${REBUILD}`).toEqual([]);

    // And nothing listed has quietly left the repository.
    const absent = SHIPPED_DOCUMENTS
      .filter((file) => !existsSync(join(REPOSITORY_ROOT, file)));
    expect(absent, "these are pinned but missing from the repository").toEqual([]);
  });

  // The builder is a documented command, and a review found it broken by a
  // missing import while the gate stayed green. A command nobody runs is a
  // command nobody knows the state of, so this runs it.
  //
  // It rebuilds somewhere harmless. The first version rebuilt over the very
  // fixture it was checking, so a failing run adopted the change it had just
  // rejected and the next run passed.
  //
  // Line endings are normalised before comparing, because a checkout decides
  // them and this file is committed.
  test("the documented rebuild command reproduces the fixture", () => {
    const fixture = join(import.meta.dir, "fixtures", "pinned-documents.ts");
    const workspace = mkdtempSync(join(tmpdir(), "iso-rebuild-"));
    try {
      const rebuilt = join(workspace, "pinned-documents.ts");
      execSync(
        `bun skills/iso-24495-5/tests/reference/build-pinned-documents.ts "${rebuilt}"`,
        { cwd: REPOSITORY_ROOT, stdio: "pipe" },
      );
      const asWritten = (text: string): string => text.replace(/\r\n/g, "\n");
      expect(
        asWritten(readFileSync(rebuilt, "utf8")),
        "a rebuild on an unchanged tree must reproduce the fixture",
      ).toBe(asWritten(readFileSync(fixture, "utf8")));
      // Where it writes when told nothing, which the check above never sees
      // because it always tells it. Reading the source for the right filename
      // was not enough either: a review appended a replace call to the same
      // expression and the spelling still matched. So the command is run with
      // no argument, and the fixture it should have written is restored
      // afterwards whatever happened.
      // A mark is left in the fixture first, so that a command writing
      // somewhere else leaves it behind. Comparing the file with itself proved
      // nothing: a review redirected the default with a replace call, the real
      // fixture went untouched, and an unchanged file matched.
      const fixtureBefore = readFileSync(fixture, "utf8");
      try {
        writeFileSync(fixture, "// replaced by a test, and rebuilt below\n", "utf8");
        execSync(
          "bun skills/iso-24495-5/tests/reference/build-pinned-documents.ts",
          { cwd: REPOSITORY_ROOT, stdio: "pipe" },
        );
        // Compared as written, like the rebuild above. Comparing the raw text
        // failed a normal checkout: this repository is checked out with
        // carriage returns and the builder writes without them, so a correct
        // tree looked wrong.
        expect(
          asWritten(readFileSync(fixture, "utf8")),
          "the documented command with no argument must write this fixture",
        ).toBe(asWritten(fixtureBefore));
      } finally {
        writeFileSync(fixture, fixtureBefore, "utf8");
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
  test("the fixture covers every document the manifests ship", () => {
    // Both sorted, so where a name sits in the list is not a second thing to
    // get right. A document added out of alphabetical order failed here while
    // being correctly listed and rebuilt.
    expect(Object.keys(PINNED_DOCUMENT_TEXT).sort(), REBUILD)
      .toEqual([...PINNED_DOCUMENTS].sort());
  });

  test("no line of a pinned document changes without its fixture changing", () => {

    for (const file of PINNED_DOCUMENTS) {
      // Required to survive a round trip through UTF-8. A review changed a
      // price written in UTF-16 from pounds to yen, and every line still
      // matched, because both bytes decode to the same replacement character.
      // Refusing a file that does not come back unchanged closes that, and the
      // floor decides which files must be here by their names rather than by
      // whether they decode, so damaging one cannot excuse it.
      const bytes = readFileSync(join(REPOSITORY_ROOT, file));
      const text = bytes.toString("utf8");
      expect(
        Buffer.from(text, "utf8").equals(bytes),
        `${file} must be UTF-8 text. ${REBUILD}`,
      ).toBe(true);

      const actual = text.split(/\r?\n/);
      const expected = PINNED_DOCUMENT_TEXT[file] ?? [];

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
    // Three skills are deliberately unrouted. Code sits outside the standard,
    // and the style skill holds the output style itself rather than being a
    // destination anyone routes to. The design audit sends a document to an
    // outside service, so it runs only when the user invokes it by name, and
    // no routing list names it.
    const UNROUTED = new Set(["iso-24495-code", "iso-24495-design-audit", "iso-24495-style"]);
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
      expect(script, "the lint must fail on a warning as well as on an error").toMatch(
        /^node_modules\/\.bin\/eslint \. --max-warnings 0$/m,
      );
      expect(script, "the script must run every shipped command with nothing installed").toMatch(
        /^bash scripts\/check-without-packages\.sh$/m,
      );
    });

    // Windows separators reach bash as escape characters rather than as path
    // separators, and `dirname` then reads the whole path as one name. Both
    // platforms accept forward slashes, so both get them.
    const forBash = (path: string): string => path.split("\\").join("/");

    /** The one run block of a workflow job, read from the parsed YAML. */
    const runBlock = (path: string, job: string): string => {
      const parsed = Bun.YAML.parse(readFileSync(path, "utf8")) as {
        jobs: Record<string, { steps: Array<{ run?: string }> }>;
      };
      const runSteps = parsed.jobs[job].steps.filter((step) => step.run !== undefined);
      expect(runSteps.length, `the ${job} job must hold exactly one run block`).toBe(1);
      return runSteps[0].run ?? "";
    };

    /** Runs a run block with bash, the way the runner would, and returns its exit code. */
    const runBlockIn = (
      block: string,
      cwd: string,
      env: Record<string, string> = {},
    ): number | null => {
      const directory = mkdtempSync(join(tmpdir(), "iso-24495-step-"));
      try {
        const step = join(directory, "step.sh");
        writeFileSync(step, block, "utf8");
        const run = Bun.spawnSync(["bash", forBash(step)], {
          cwd,
          env: { ...process.env, RUNNER_TEMP: forBash(directory), ...env },
        });
        return run.exitCode;
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    };

    // Execute the checked-in shell block against a stand-in gate. It must pass
    // when the gate passes and fail when the gate fails. Running the real gate
    // here would run this suite inside itself. This test does not validate the
    // GitHub workflow settings that decide whether or where the block runs.
    test("the workflow runs that script, and fails when it fails", () => {
      const workflow = readFileSync(workflowPath, "utf8");
      expect(workflow, "the workflow must run on pull requests").toMatch(/^\s*pull_request:/m);

      const block = runBlock(workflowPath, "check");
      for (const status of [0, 1]) {
        const repository = mkdtempSync(join(tmpdir(), "iso-24495-gate-"));
        try {
          mkdirSync(join(repository, "scripts"));
          writeFileSync(join(repository, "scripts", "check.sh"), `exit ${status}\n`, "utf8");
          expect(runBlockIn(block, repository), `a gate that exits ${status}`).toBe(status);
        } finally {
          rmSync(repository, { recursive: true, force: true });
        }
      }
    });

    // The stage that runs every shipped command with nothing installed makes
    // its copy under a directory whose name is the contributor's and not ours.
    // A review gave it a name holding an apostrophe: the stage had pasted the
    // path into the text of its clean-up, so the clean-up was a syntax error
    // and the copy stayed. One name here holds an apostrophe, a space and a
    // dollar sign, and ends in a space.
    //
    // Where that directory may go is the stage's question, not this test's. A
    // later review ran the gate in a checkout whose parent held node_modules,
    // with a clean TMPDIR. The stage passed, and this test failed, because it
    // had its own idea of a clean place: beside the repository. It now asks
    // the stage's one search.
    const AWKWARD_NAME = "owner's $tmp dir ";
    /** The one line ending a script puts after a path it prints. */
    const LINE_ENDING = /\r?\n$/;

    test("the run with nothing installed works, and cleans up, under an awkward temporary path", () => {
      const search = Bun.spawnSync(["bash", "scripts/check-without-packages.sh", "--clean-parent"], {
        cwd: REPOSITORY_ROOT,
        env: process.env,
      });
      // With no clean place anywhere, this fails with the stage's own words,
      // which say to set TMPDIR. It must not pass by doing nothing.
      expect(search.exitCode, search.stderr.toString()).toBe(0);
      // The path is kept exactly as printed, less the one line ending. A name
      // may end in a space, and trimming the output once lost that space.
      const holder = mkdtempSync(join(search.stdout.toString().replace(LINE_ENDING, ""), "iso-24495-odd-"));
      try {
        const awkward = join(holder, AWKWARD_NAME);
        mkdirSync(awkward);
        const run = Bun.spawnSync(["bash", "scripts/check-without-packages.sh"], {
          cwd: REPOSITORY_ROOT,
          // The stage gives its commands an environment of its own making. A
          // review set NODE_PATH to an installed node_modules, the copy then
          // reached a package, and the stage failed with no source changed.
          // So this run carries that variable, and must pass all the same.
          env: {
            ...process.env,
            TMPDIR: forBash(awkward),
            NODE_PATH: forBash(join(REPOSITORY_ROOT, "node_modules")),
          },
        });
        expect(run.exitCode, run.stderr.toString()).toBe(0);
        // It must have used that directory, not passed it over for another.
        expect(run.stdout.toString()).toContain(`${AWKWARD_NAME}/iso-24495-bare.`);
        expect(readdirSync(awkward), "the copy must be gone").toEqual([]);
      } finally {
        rmSync(holder, { recursive: true, force: true });
      }
    });

    // A place that cannot be written to is passed over, and when every place
    // is, the stage must say what to do. Here no directory can be made at all,
    // because the program that makes one is replaced by one that fails.
    test("with no clean place for its copy, the run says to set TMPDIR", () => {
      const stubs = mkdtempSync(join(tmpdir(), "iso-24495-stub-"));
      try {
        writeFileSync(join(stubs, "mktemp"), "#!/usr/bin/env bash\nexit 1\n", { mode: 0o755 });
        const environment = { ...process.env, PATH: `${forBash(stubs)}${delimiter}${process.env.PATH ?? ""}` };
        for (const mode of [["--clean-parent"], []]) {
          const run = Bun.spawnSync(["bash", "scripts/check-without-packages.sh", ...mode], {
            cwd: REPOSITORY_ROOT,
            env: environment,
          });
          expect(run.exitCode).toBe(1);
          expect(run.stderr.toString()).toBe(
            "The gate found no place for its copy: each place it tried could not be written to, "
            + "or has a node_modules directory in it or above it.\n"
            + "Set TMPDIR to a directory you can write to, with no node_modules in it or above it, "
            + "then run the gate again.\n"
            + "One likely cause is a stray node_modules directory in a home directory.\n",
          );
          expect(run.stdout.toString()).toBe("");
        }
      } finally {
        rmSync(stubs, { recursive: true, force: true });
      }
    });

    // The search tries a place by making a directory there, then removes it. A
    // review made that removal fail. Asked for the clean place alone, the
    // script stopped. The stage asked through "$(...)", where the failure
    // passed unseen: it ran its commands, exited 0, and left the directory
    // behind. Here the program that removes an empty directory is replaced by
    // one that fails.
    test("when the run cannot remove a directory it made, it stops and names it", () => {
      const search = Bun.spawnSync(["bash", "scripts/check-without-packages.sh", "--clean-parent"], {
        cwd: REPOSITORY_ROOT,
        env: process.env,
      });
      expect(search.exitCode, search.stderr.toString()).toBe(0);
      // A holder of this test's own, because the directory will be left in it.
      const holder = mkdtempSync(join(search.stdout.toString().replace(LINE_ENDING, ""), "iso-24495-kept-"));
      try {
        const stubs = join(holder, "stubs");
        const place = join(holder, "place");
        mkdirSync(stubs);
        mkdirSync(place);
        writeFileSync(join(stubs, "rmdir"), "#!/usr/bin/env bash\nexit 1\n", { mode: 0o755 });
        const environment = {
          ...process.env,
          TMPDIR: forBash(place),
          PATH: `${forBash(stubs)}${delimiter}${process.env.PATH ?? ""}`,
        };
        for (const mode of [["--clean-parent"], []]) {
          const run = Bun.spawnSync(["bash", "scripts/check-without-packages.sh", ...mode], {
            cwd: REPOSITORY_ROOT,
            env: environment,
          });
          expect(run.exitCode).toBe(1);
          const left = readdirSync(place);
          expect(left.length, "the directory the search made is still there").toBe(1);
          // The message gives the directory's own name, and not where it is.
          expect(run.stderr.toString()).toBe(`Could not remove the directory ${left[0]}, which this stage made.\n`);
          expect(run.stdout.toString(), "no command may run after that").toBe("");
          rmSync(join(place, left[0] ?? ""), { recursive: true });
        }
      } finally {
        rmSync(holder, { recursive: true, force: true });
      }
    });

    // The gate's linter starts on Node, where everything else runs on Bun. A
    // runner's own Node moves without notice, so each workflow that runs the
    // gate names one exact version, and both name the same one.
    test("each workflow that runs the gate sets up the same exact Node", () => {
      const versions = ["tests.yml", "release-tag.yml"].map((name) => {
        const parsed = Bun.YAML.parse(
          readFileSync(join(REPOSITORY_ROOT, ".github", "workflows", name), "utf8"),
        ) as { jobs: Record<string, { steps: Array<{ uses?: string; run?: string; with?: Record<string, string> }> }> };
        const steps = Object.values(parsed.jobs).flatMap((job) => job.steps);
        const node = steps.findIndex((step) => step.uses?.startsWith("actions/setup-node@"));
        const gate = steps.findIndex((step) => step.run?.includes("scripts/check.sh"));
        expect(node, `${name} sets up Node`).toBeGreaterThan(-1);
        expect(gate, `${name} sets up Node before it runs the gate`).toBeGreaterThan(node);
        return steps[node]?.with?.["node-version"];
      });
      expect(versions[0], "an exact version, not a range").toMatch(/^\d+\.\d+\.\d+$/);
      expect(versions[1]).toBe(versions[0]);
    });

    test("the README tells a contributor to run the same script", () => {
      const readme = readFileSync(join(REPOSITORY_ROOT, "README.md"), "utf8");
      expect(readme).toMatch(/scripts\/check\.sh/);
    });

    // A pushed tag is checked by its own workflow, because only a tag push has
    // the tag. The script it runs has its own tests, so these confirm the
    // workflow reaches it: that tags trigger the run, and that the run fails
    // when the tag check or the gate fails.
    describe("the pushed tag check", () => {
      const tagWorkflow = join(REPOSITORY_ROOT, ".github", "workflows", "release-tag.yml");

      test("a pushed tag beginning with v starts the run, with the pinned Bun", () => {
        const parsed = Bun.YAML.parse(readFileSync(tagWorkflow, "utf8")) as {
          on: { push: { tags?: string[]; branches?: string[] } };
          jobs: Record<string, { steps: Array<{ uses?: string; with?: Record<string, string> }> }>;
        };
        expect(parsed.on.push.tags).toEqual(["v*"]);
        // A branch filter beside the tag filter would still let tags through,
        // but a branch filter alone would not, so none is allowed here.
        expect(parsed.on.push.branches).toBeUndefined();
        const steps = parsed.jobs.validate.steps;
        expect(steps.some((step) => step.uses?.startsWith("actions/checkout@"))).toBe(true);
        const bun = steps.find((step) => step.uses?.startsWith("oven-sh/setup-bun@"));
        expect(bun?.with?.["bun-version"]).toBe("1.4.2");
      });

      // The run must check the commit the pushed tag names. A checkout given
      // `ref: main` validates main instead, and a review showed every test
      // still passed. The triggering commit is the default, or it can be
      // named as github.ref or github.sha; any other ref or repository is
      // refused.
      test("every checkout takes the commit the pushed tag names", () => {
        type Workflow = {
          jobs: Record<string, { steps: Array<{ uses?: string; with?: Record<string, unknown> }> }>;
        };
        const TRIGGERING_REF = /^\$\{\{\s*github\.(?:ref|sha)\s*\}\}$/;
        const TRIGGERING_REPOSITORY = /^\$\{\{\s*github\.repository\s*\}\}$/;
        /** Every checkout step's problem with what it checks out, if any. */
        const wrongCheckouts = (text: string): string[] => {
          const parsed = Bun.YAML.parse(text) as Workflow;
          const checkouts = Object.values(parsed.jobs).flatMap((job) =>
            job.steps.filter((step) => step.uses?.startsWith("actions/checkout@")));
          expect(checkouts.length, "the workflow checks the repository out").toBeGreaterThan(0);
          return checkouts.flatMap((step) => {
            const ref = step.with?.ref;
            const repository = step.with?.repository;
            return [
              ...(ref === undefined || TRIGGERING_REF.test(String(ref)) ? [] : [`ref: ${ref}`]),
              ...(repository === undefined || TRIGGERING_REPOSITORY.test(String(repository))
                ? []
                : [`repository: ${repository}`]),
            ];
          });
        };

        const workflow = readFileSync(tagWorkflow, "utf8").replace(/\r\n/g, "\n");
        expect(wrongCheckouts(workflow)).toEqual([]);

        // The rule itself, on edited copies of the workflow.
        const checkoutWith = (lines: string[]): string => {
          const edited = workflow.replace(
            /^( *)- uses: actions\/checkout@(\S+)\n/m,
            (_, indent: string, version: string) =>
              [`${indent}- uses: actions/checkout@${version}`, `${indent}  with:`,
                ...lines.map((line) => `${indent}    ${line}`), ""].join("\n"),
          );
          expect(edited, "the edit must reach the checkout step").not.toBe(workflow);
          return edited;
        };
        expect(wrongCheckouts(checkoutWith(["ref: main"]))).toEqual(["ref: main"]);
        expect(wrongCheckouts(checkoutWith(["repository: someone/fork"])))
          .toEqual(["repository: someone/fork"]);
        expect(wrongCheckouts(checkoutWith(["ref: ${{ github.ref }}"]))).toEqual([]);
        expect(wrongCheckouts(checkoutWith(["ref: ${{ github.sha }}"]))).toEqual([]);
        expect(wrongCheckouts(checkoutWith(["repository: ${{ github.repository }}"]))).toEqual([]);
      });

      // Stand-ins replace the tag check and the gate, so the real gate never
      // runs inside itself. The tag check passes only for the tag it is given.
      test("the run fails when the tag check fails, and when the gate fails", () => {
        const block = runBlock(tagWorkflow, "validate");
        const run = (tag: string, gate: number): number | null => {
          const repository = mkdtempSync(join(tmpdir(), "iso-24495-tag-"));
          try {
            mkdirSync(join(repository, "scripts"));
            writeFileSync(
              join(repository, "scripts", "release-tag-cli.ts"),
              "process.exit(process.argv[2] === \"v9.9.9\" ? 0 : 1);\n",
              "utf8",
            );
            writeFileSync(join(repository, "scripts", "check.sh"), `exit ${gate}\n`, "utf8");
            return runBlockIn(block, repository, { GITHUB_REF_NAME: tag });
          } finally {
            rmSync(repository, { recursive: true, force: true });
          }
        };
        expect(run("v9.9.9", 0), "a matching tag and a passing gate").toBe(0);
        expect(run("v9.9.8", 0), "a tag that does not match").not.toBe(0);
        expect(run("v9.9.9", 1), "a gate that fails").not.toBe(0);
      });
    });

    // A pull request description is text a reader receives, and until now the
    // suite read every document in this repository except that one. It lives on
    // GitHub rather than in the tree, so a second workflow fetches it and hands
    // it to the same script a contributor can run over any file.
    describe("the pull request description check", () => {
      const auditScript = join(REPOSITORY_ROOT, "scripts", "audit-pull-request-text.sh");
      const descriptionWorkflow = join(
        REPOSITORY_ROOT,
        ".github",
        "workflows",
        "pull-request-text.yml",
      );

      /** The environment the check runs in, with no step summary unless one is given. */
      const checkEnvironment = (extra: Record<string, string> = {}): Record<string, string> => {
        const environment: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined && key !== "GITHUB_STEP_SUMMARY") environment[key] = value;
        }
        return { ...environment, ...extra };
      };

      /** Runs a copy of the check, and reports its exit code and everything it printed. */
      const runCheck = (
        script: string,
        file: string,
        extra: Record<string, string> = {},
      ): { status: number | null; output: string } => {
        const run = Bun.spawnSync(["bash", forBash(script), forBash(file)], {
          env: checkEnvironment(extra),
        });
        const decoder = new TextDecoder();
        return {
          status: run.exitCode,
          output: `${decoder.decode(run.stdout)}${decoder.decode(run.stderr)}`,
        };
      };

      /** Runs the check over one piece of text, and reports what a reader sees. */
      const audit = (
        text: string,
        name = "description.md",
        extra: Record<string, string> = {},
      ): { status: number | null; output: string } => {
        const directory = mkdtempSync(join(tmpdir(), "iso-24495-description-"));
        try {
          const file = join(directory, name);
          writeFileSync(file, text, "utf8");
          return runCheck(auditScript, file, extra);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      };

      // Every pass says what a pass means, so nobody reads a green tick as a
      // judgement that the description is clear.
      const PASS_MEANING = "A pass means the audit ran on a description that is not empty.";

      // The script once did the work itself: three reads, three programs and two
      // temporary files, each a place to fail in another program's words. Three
      // reviews running found one. It now starts one program and does nothing else.
      test("the script only starts the program that holds the decision", () => {
        expect(existsSync(auditScript), "scripts/audit-pull-request-text.sh must exist").toBe(true);
        const script = readFileSync(auditScript, "utf8");
        expect(script.includes(String.fromCharCode(13)), "the script must hold no carriage return").toBe(false);
        const commands = script.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#"));
        expect(commands).toEqual([
          "set -euo pipefail",
          'exec bun "$(dirname -- "$0")/audit-pull-request-text-cli.ts" "$@"',
        ]);
        expect(existsSync(join(REPOSITORY_ROOT, "scripts", "audit-pull-request-text-cli.ts"))).toBe(true);
      });

      test("plain text passes, whichever line endings it arrives with", () => {
        const lines = [
          "This branch adds the Part 5 rules.",
          "",
          "It fixes the timing guards as well.",
        ];
        // A description written in the GitHub editor arrives with Windows line
        // endings. A check that passed here and failed there would be the drift
        // the shared script exists to prevent, so both are pinned.
        for (const ending of ["\n", "\r\n"]) {
          const result = audit(lines.join(ending) + ending);
          expect(result.status, `${JSON.stringify(ending)} gave: ${result.output}`).toBe(0);
          expect(result.output).toContain(PASS_MEANING);
        }
      });

      // No explanation could satisfy a check that failed on any finding, so a
      // finding is advice: the log names it, and the check still passes.
      test("findings are listed as advice, and do not block", () => {
        const result = audit(`${"word ".repeat(40)}stop.`);
        expect(result.status, result.output).toBe(0);
        // A bare exit code leaves the author nothing to act on, so the findings
        // themselves have to reach the log.
        expect(result.output, "the log must name the rule").toContain("sentence-length");
        expect(result.output).toContain("The audit reported 1 finding. It is advice");
        expect(result.output).toContain(PASS_MEANING);
        const two = audit(`${"word ".repeat(40)}stop.\n\nWe shall pay.\n`);
        expect(two.status, two.output).toBe(0);
        expect(two.output).toContain("The audit reported 2 findings. They are advice");
      });

      // A byte count called a description of spaces and newlines text, while a
      // reader gets exactly as much from it as from an empty one. Whitespace is
      // whatever JavaScript's \s matches, so a no-break space, an ideographic
      // space and a byte order mark are whitespace too.
      test("a description that is empty or only whitespace blocks", () => {
        for (const empty of ["", " \t\r\n  \n", "\n\n\n", "\u00a0\u3000\ufeff\n"]) {
          const result = audit(empty);
          expect(result.status, `${JSON.stringify(empty)} gave: ${result.output}`).toBe(1);
          expect(result.output).toContain("empty or holds only whitespace");
        }
      });

      // Emptiness is a test of the source, not of what a page shows. A comment
      // or an image is not whitespace, so the audit runs, and the pass says
      // what little it had to read rather than blocking the merge.
      test("a description of only a comment or only an image passes, as advice", () => {
        for (const sparse of [
          "<!-- Describe your change here. -->\n",
          "<!-- One. -->\n<!-- Two. -->\n",
          "![](screenshot.png)\n",
          "![The new settings page](screenshot.png)\n",
        ]) {
          const result = audit(sparse);
          expect(result.status, `${JSON.stringify(sparse)} gave: ${result.output}`).toBe(0);
          expect(result.output).toContain("only a comment or an image gives it little to read");
        }
        // An image without alternative text is still reported, as advice.
        expect(audit("![](screenshot.png)\n").output).toContain("image-alt");
      });

      // A description has no front matter, so GitHub shows a leading "---" block
      // as a rule and a heading. The audit read it as metadata, and passed a
      // description whose only text sat inside it.
      test("a leading front matter block is read as text", () => {
        const result = audit("---\nnote: We shall pay.\n---\n");
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("legalese");
        expect(result.output).toContain("heading-style");
      });

      // A contributor reads the job's summary page, not its raw log, so the
      // findings go there too. The log keeps them as well.
      test("the findings reach the step summary when there is one", () => {
        const directory = mkdtempSync(join(tmpdir(), "iso-24495-summary-"));
        try {
          const summary = join(directory, "summary.md");
          writeFileSync(summary, "Earlier step.\n", "utf8");
          const result = audit(`${"word ".repeat(40)}stop.`, "description.md", {
            GITHUB_STEP_SUMMARY: forBash(summary),
          });
          expect(result.status, result.output).toBe(0);
          expect(result.output, "the log keeps the findings").toContain("sentence-length");
          const written = readFileSync(summary, "utf8");
          expect(written, "the summary is appended to, never replaced").toStartWith("Earlier step.\n");
          expect(written).toContain("sentence-length");
          expect(written).toContain("| Line | Rule |");
          expect(written).toContain(PASS_MEANING);

          const blocked = audit(" \n", "description.md", { GITHUB_STEP_SUMMARY: forBash(summary) });
          expect(blocked.status).toBe(1);
          expect(readFileSync(summary, "utf8")).toContain("empty or holds only whitespace");

          // A summary that cannot be written is said in fixed words, and the verdict
          // stands. With the variable naming a directory, bash once printed its own
          // diagnostic with the whole path and the script left with 1.
          const unwritable = join(directory, "PRIVATE-directory");
          mkdirSync(unwritable);
          const given = forBash(unwritable);
          const advised = audit(`${"word ".repeat(40)}stop.`, "description.md", { GITHUB_STEP_SUMMARY: given });
          expect(advised.status, advised.output).toBe(0);
          expect(advised.output).toContain("The audit reported 1 finding.");
          expect(advised.output).toContain(
            `The step summary named by GITHUB_STEP_SUMMARY, a path ${given.length} characters long, could not be written. The result above is complete without it.\n`,
          );
          expect(advised.output.includes("PRIVATE"), advised.output).toBe(false);
          expect(audit(" \n", "description.md", { GITHUB_STEP_SUMMARY: given }).status).toBe(1);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });

      // The audit refuses a file type it does not read. That is a failure to
      // run, not a verdict about text, so it blocks with a code of its own.
      test("an audit that fails to run blocks with its own code", () => {
        const result = audit("This description reads plainly.\n", "description.rst");
        expect(result.status, result.output).toBe(3);
        expect(result.output).toContain("did not run");
      });

      // The audit does not follow a symbolic link. The script once left that to the
      // audit, which skipped the link, and a report with no file in it was then
      // refused with exit 3. The program now asks what the path names before it
      // reads, and a link is a wrong argument like a directory. A Windows account
      // without the right to make a file link cannot build the first case, and the
      // tests of the program cover it on every platform.
      test("a linked description and a directory are refused before anything is read", () => {
        const directory = mkdtempSync(join(tmpdir(), "iso-24495-link-"));
        try {
          const refusedDirectory = runCheck(auditScript, directory);
          expect(refusedDirectory.status).toBe(2);
          expect(refusedDirectory.output).toBe(
            `The path given as the first argument, ${forBash(directory).length} characters long, names a directory, where a file is needed.\n`,
          );
          const target = join(directory, "target.md");
          writeFileSync(target, "This description reads plainly.\n", "utf8");
          const link = join(directory, "description.md");
          try {
            symlinkSync(target, link, "file");
          } catch {
            return; // this account cannot make a file link
          }
          const refusedLink = runCheck(auditScript, link);
          expect(refusedLink.status, "a linked description").toBe(2);
          expect(refusedLink.output).toContain("names a symbolic link, which this check does not follow.");
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }, 60_000);

      // The argument is text nobody has read. Printed back, an escape character in
      // it drives the terminal that shows the message, and a right-to-left override
      // reorders the line. So each message gives the argument by its length alone.
      test("a path the script refuses is never printed back", () => {
        const escape = String.fromCharCode(27);
        const override = String.fromCharCode(0x202e);
        const directory = mkdtempSync(join(tmpdir(), "iso-24495-refused-"));
        try {
          const refused: Array<[fault: string, path: string]> = [
            ["no directory", `${forBash(directory)}/gone${escape}[2J${override}dir/description.md`],
            ["no file", `${forBash(directory)}/gone${escape}[2J${override}.md`],
          ];
          for (const [fault, path] of refused) {
            const result = runCheck(auditScript, path);
            expect(result.status, fault).toBe(2);
            // The length is that of the argument as it was given, not as it was resolved.
            expect(result.output, fault)
              .toBe(`The path given as the first argument, ${path.length} characters long, names no file to read.\n`);
            for (const part of [escape, override, "[2J", "gone"]) {
              expect(result.output.includes(part), `${fault}: part of the path was printed`).toBe(false);
            }
          }
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });

      // The script promises exit 2 for a file it cannot read, but a permission
      // error from grep fell through to "no text" with exit 1.
      test("an unreadable file exits 2, not 1", () => {
        const directory = mkdtempSync(join(tmpdir(), "iso-24495-unreadable-"));
        try {
          const file = join(directory, "locked.md");
          writeFileSync(file, "This text reads plainly.\n", "utf8");
          // Probe whether chmod 000 actually removes read permission here.
          // Git Bash on Windows may ignore it, so the test is skipped where it
          // has no effect rather than asserting a platform it cannot control.
          const probe = Bun.spawnSync(
            ["bash", "-c", "chmod 000 -- \"$1\" && ! test -r \"$1\"", "_", forBash(file)],
          );
          if (probe.exitCode !== 0) {
            // chmod had no effect; restore and skip.
            Bun.spawnSync(["bash", "-c", "chmod 644 -- \"$1\"", "_", forBash(file)]);
            return; // skipped on this platform
          }
          const run = Bun.spawnSync(["bash", forBash(auditScript), forBash(file)]);
          // Restore before any assertion, so cleanup always succeeds.
          Bun.spawnSync(["bash", "-c", "chmod 644 -- \"$1\"", "_", forBash(file)]);
          expect(run.exitCode, "an unreadable file must exit 2").toBe(2);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });

      // Permission bits are one way a file refuses to be read, and a review
      // found another. A Windows exclusive lock leaves `-r` true while every
      // read fails, and the script called that "no text" with exit 1. The
      // chmod test above is skipped on Windows, where chmod has no effect, so
      // this one holds a real lock there. Elsewhere it checks that the script
      // reads the file before judging it, which is the guard both cases need.
      test("a file that refuses to be read exits 2, whatever refuses it", async () => {
        if (process.platform !== "win32") {
          return;
        }
        const directory = mkdtempSync(join(tmpdir(), "iso-24495-locked-"));
        try {
          // A review put the file under "reader's cache", and the apostrophe
          // closed the PowerShell string before the lock was taken. The path
          // now reaches PowerShell as a variable, never as part of the command,
          // and the apostrophe stays here so the test proves that it does.
          mkdirSync(join(directory, "reader's cache"));
          const file = join(directory, "reader's cache", "locked.md");
          writeFileSync(file, "This text reads plainly.\n", "utf8");
          const holder = Bun.spawn(
            [
              "powershell.exe",
              "-NoProfile",
              "-Command",
              // Without "Stop", a failed Open is reported and the next statement
              // still prints "locked", so the check below would believe it.
              "$ErrorActionPreference = 'Stop'; " +
                "$h = [IO.File]::Open($env:LOCKED_FILE, 'Open', 'Read', 'None'); " +
                "Write-Output locked; Start-Sleep 60",
            ],
            { stdout: "pipe", env: { ...process.env, LOCKED_FILE: file } },
          );
          try {
            const reader = holder.stdout.getReader();
            const { value } = await reader.read();
            expect(new TextDecoder().decode(value), "the lock must be held").toContain("locked");
            const run = runCheck(auditScript, file);
            expect(run.status, "a locked file must exit 2").toBe(2);
            expect(run.output).toBe(
              `The path given as the first argument, ${forBash(file).length} characters long, names a file that exists but cannot be read.\n`,
            );
          } finally {
            holder.kill();
            await holder.exited;
          }
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }, 30_000);

      // A name beginning with a dash reached `dirname` as an option, and the
      // failure was swallowed. A file that did not exist then resolved to the
      // current directory, where the script audited a neighbour and passed.
      // Passing for the wrong target is worse than failing.
      test("a name beginning with a dash names that file, or nothing", () => {
        const directory = mkdtempSync(join(tmpdir(), "iso-24495-dash-"));
        try {
          // A neighbour that would pass, so auditing the wrong file reads green.
          writeFileSync(join(directory, "aaa-neighbour.md"), "This reads plainly.\n", "utf8");
          writeFileSync(join(directory, "-description.md"), "This description reads plainly.\n", "utf8");

          // The argument itself must begin with a dash, not hide behind a
          // directory prefix. Setting cwd to the fixture directory and passing
          // the bare name is what makes the dash lead the argument.
          const present = Bun.spawnSync(
            ["bash", forBash(auditScript), "-description.md"],
            { cwd: directory, env: checkEnvironment() },
          );
          expect(present.exitCode, "a real file must be audited, whatever its name").toBe(0);

          const absent = Bun.spawnSync(
            ["bash", forBash(auditScript), "-missing.md"],
            { cwd: directory, env: checkEnvironment() },
          );
          expect(absent.exitCode, "a file that is not there cannot pass").toBe(2);

          // A bare name exercises `basename` and leaves `dirname` reading ".",
          // so a review removed only the "--" before `dirname` and every test
          // still passed. A directory whose name begins with a dash makes
          // `dirname` receive it. Findings no longer block, so the file inside
          // holds only whitespace, which does. The neighbour beside the
          // script's argument holds text and passes, so auditing the wrong one
          // turns this red.
          mkdirSync(join(directory, "-dashdir"));
          writeFileSync(join(directory, "-dashdir", "file.md"), " \n", "utf8");
          writeFileSync(join(directory, "file.md"), "This neighbour reads plainly.\n", "utf8");
          const nested = Bun.spawnSync(
            ["bash", forBash(auditScript), "-dashdir/file.md"],
            { cwd: directory, env: checkEnvironment() },
          );
          expect(nested.exitCode, "the file inside the dashed directory must be the one audited")
            .toBe(1);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });

      test("a missing argument is a usage error rather than a pass", () => {
        const run = Bun.spawnSync(["bash", forBash(auditScript)]);
        expect(run.exitCode).toBe(2);
      });

      /** The parsed description workflow. */
      const parsedWorkflow = (): {
        on: { pull_request: { types: string[] } };
        jobs: Record<string, { steps: Array<{ run?: string; env?: Record<string, string> }> }>;
      } => Bun.YAML.parse(readFileSync(descriptionWorkflow, "utf8")) as ReturnType<typeof parsedWorkflow>;

      // A description changes without a commit, so pushes alone would miss it.
      test("the workflow runs when a description is edited", () => {
        expect(parsedWorkflow().on.pull_request.types).toContain("edited");
      });

      // A description is text from outside this repository. Expanded into the
      // command it would be shell, so it reaches the step as a variable. The
      // test below supplies its own PR_BODY, so it cannot see what the workflow
      // binds; this is the one fact it reads rather than runs.
      test("the description reaches the shell as a variable, never as a command", () => {
        const step = parsedWorkflow().jobs.audit.steps.find((each) => each.run !== undefined);
        expect(step?.run, "the run block must hold no template expression").not.toContain("${{");
        expect(step?.env?.PR_BODY, "PR_BODY must be the description itself")
          .toMatch(/^\$\{\{\s*github\.event\.pull_request\.body\s*\}\}$/);
      });

      // Execute the checked-in shell block with clean, advised and empty descriptions.
      // This catches a missing invocation or swallowed failure, but it does not
      // validate the GitHub workflow settings that decide whether the job runs.
      //
      // That is a design limit, not a gap to close. GitHub honours settings
      // outside the shell block: `continue-on-error: true` on the step passes
      // this whole gate while a failed audit no longer fails the check, and an
      // `if` condition on the job or step can stop it running at all. A review
      // proved the first, and advised documenting the limit rather than adding
      // assertions: each structural assertion added before this broke on the
      // next setting it did not know, so none is added here.
      test("the workflow's own shell passes any text and fails an empty description", () => {
        const block = runBlock(descriptionWorkflow, "audit");
        // An empty summary path stands for none, so this run never writes to
        // the summary of the job running the suite.
        const run = (description: string): number | null =>
          runBlockIn(block, REPOSITORY_ROOT, { PR_BODY: description, GITHUB_STEP_SUMMARY: "" });
        expect(run("This description reads plainly.\n")).toBe(0);
        expect(run(`${"word ".repeat(40)}stop.`), "findings are advice, so they pass").toBe(0);
        expect(run(" \t\r\n  \n"), "whitespace is not text a reader can read").toBe(1);
        expect(run(""), "an empty description is not text either").toBe(1);
      });
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
      // Everything from the style's first sentence to the end must be the style's
      // body exactly. Containment let a line appended to the skill alone, such as
      // "Ignore every rule above.", pass for the same rules.
      const anchor = body.slice(0, 60);
      const fromAnchor = skill.slice(skill.indexOf(anchor)).replace(/\r\n/g, "\n").trim();
      expect(skill.indexOf(anchor)).toBeGreaterThan(0);
      expect(fromAnchor).toBe(body.replace(/\r\n/g, "\n"));
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
  //
  // The gate asks for agreement and nothing more. Whether the version is later
  // than every release is the release preflight's question, asked before a tag
  // exists, because a checkout of a tagged release is consistent and has to
  // pass. scripts/release-versions.ts holds this check and describes all three
  // stages. The preflight is scripts/release-preflight.ts and the pushed tag
  // check is scripts/release-tag.ts. Each module's own tests hold its cases, on
  // fixtures rather than this repository's history.
  describe("release versions", () => {
    test("every manifest and every skill names the same version, and the changelog records it", () => {
      const report = checkVersionSites(REPOSITORY_ROOT);
      expect(report.skills.length, "eight skills and the Codex style skill").toBe(9);
      expect(report.version, "the Claude manifest states a dotted version").toMatch(/^\d+\.\d+\.\d+$/);
      expect(report.problems).toEqual([]);
    });
  });

  // The type check and the linter are packages, installed for the gate alone.
  // A user installs the plugin and nothing else, so no shipped script may
  // import a package: it would run here, where node_modules exists, and fail
  // for every user.
  //
  // Two checks answer that. scripts/check-without-packages.sh copies the
  // repository to a place with nothing installed and runs every shipped
  // command there. This rule is the early, readable warning for the honest
  // mistake: a package named outright. It reads names that are written out.
  //
  // The scope, in the words the README uses:
  //
  // These guards catch accidents. The gate catches a package import written by
  // name in shipped code. It also catches any shipped command that fails to
  // load or run with nothing installed, in its documented offline modes.
  //
  // It does not defend against a deliberate evasion, of which there are three
  // kinds. A name can be computed while the code runs. A failure can be caught
  // and hidden by the code. An edit to the lint configuration can change what
  // a rule does without changing its entry, through inline configuration or a
  // processor.
  //
  // The person who reviews the diff covers those, because each is visible in
  // the change that introduces it.
  //
  // Which forms count as written, again in the README's words:
  //
  // The rule on written imports reads five forms. They are a static `import`
  // and an `export ... from`, and the calls `import()`, `require()` and
  // `import.meta.require()` with the name as their first argument. A name
  // handed to any other loader is not read by the rule, even when it is
  // written out. `createRequire` and `require.resolve` are two such loaders.
  // The run with nothing installed still catches such a load on any path it
  // runs.
  describe("shipped code names no package in an import", () => {
    test("every written import outside the tests is a node: built-in or a shipped file", () => {
      const shipped = shippedSources();
      expect(shipped.size).toBeGreaterThanOrEqual(30);
      expect([...shipped.keys()]).toContain("skills/iso-24495-4/scripts/audit-corpus-cli.ts");
      expect([...shipped.keys()]).toContain("scripts/traffic-snapshot-cli.ts");

      const imports = [...shipped.values()].flatMap((source) => writtenImports(source));
      expect(imports.length).toBeGreaterThanOrEqual(shipped.size);
      expect(importProblems(shipped, (path) => existsSync(join(REPOSITORY_ROOT, path)))).toEqual([]);
    });

    test("the rule sees every form a written import takes", () => {
      const source = [
        "import type { A } from \"type-only\";",
        "import { b } from \"named\";",
        "import \"side-effect\";",
        "export { c } from \"re-exported\";",
        "export * from \"re-exported-whole\";",
        "export type { D } from \"type-re-exported\";",
        "const e = await import(\"dynamic\");",
        "const f = require(\"required\");",
        "import { g } from \"node:fs\";",
        "import { h } from \"./relative.ts\";",
        "import {",
        "  i,",
        "} from \"across-lines\";",
        "const j = await import(`plain-template`);",
        "import l = require(\"import-equals\");",
        "let m: import(\"type-query\").M;",
        "// import n from \"in-a-comment\";",
        "const o = \"import p from 'in-a-string'\";",
        "const q = await import(\"with-options\", {});",
        "const r = await import(\"with-attributes\", { with: { type: \"json\" } });",
        "const s = require(\"required-with-more\", 1);",
        "const t = require(`required-template`);",
        "const u = import.meta.require(\"meta-required\");",
        // These two name a module and load nothing, so the rule passes them by.
        "const v = require.resolve(\"only-resolved\");",
        "const w = import.meta.resolve(\"only-meta-resolved\");",
        "console.log(b, e, f, g, h, i, j, l, m, o, q, r, s, t, u, v, w);",
      ].join("\n");
      expect(writtenImports(source)).toEqual([
        "./relative.ts", "across-lines", "dynamic", "import-equals", "meta-required", "named", "node:fs",
        "plain-template", "re-exported", "re-exported-whole", "required", "required-template",
        "required-with-more", "side-effect", "type-only", "type-query", "type-re-exported",
        "with-attributes", "with-options",
      ]);
      // A JavaScript file is read by both readings too.
      expect(writtenImports("await import(\"with-options\", {}); require(\"required\");", "source.mjs"))
        .toEqual(["required", "with-options"]);
    });

    test("the rule refuses a package, a bare built-in and a file it does not read", () => {
      const problems = (files: Record<string, string>, onDisk: string[] = []): string[] =>
        importProblems(new Map(Object.entries(files)), (path) => onDisk.includes(path));

      expect(problems({ "scripts/a.ts": "import \"typescript\";" }))
        .toEqual(["scripts/a.ts imports \"typescript\", which is neither relative nor a node: built-in"]);
      expect(problems({ "scripts/a.ts": "import { sep } from \"path\"; console.log(sep);" }))
        .toEqual(["scripts/a.ts imports \"path\", which is neither relative nor a node: built-in"]);
      expect(problems({ "scripts/a.mjs": "await import(\"typescript\");" }))
        .toEqual(["scripts/a.mjs imports \"typescript\", which is neither relative nor a node: built-in"]);
      expect(problems({ "scripts/a.cjs": "require(\"typescript\");" }))
        .toEqual(["scripts/a.cjs imports \"typescript\", which is neither relative nor a node: built-in"]);
      // A review wrote this one inside a try that hides its failure.
      expect(problems({ "scripts/a.ts": "try { import.meta.require(\"typescript\"); } catch { console.log(1); }" }))
        .toEqual(["scripts/a.ts imports \"typescript\", which is neither relative nor a node: built-in"]);
      // A review wrote this one inside a branch that only one flag reaches.
      expect(problems({ "scripts/a.ts": "export async function late(): Promise<void> { await import(\"typescript\", {}); }" }))
        .toEqual(["scripts/a.ts imports \"typescript\", which is neither relative nor a node: built-in"]);

      // A relative import must land on a file this rule also reads, so that no
      // file sits outside it. A review hid a package behind a .mjs file.
      expect(problems({ "scripts/a.ts": "import \"./loader.mjs\";", "scripts/loader.mjs": "import \"node:fs\";" }))
        .toEqual([]);
      expect(problems({ "scripts/a.ts": "import \"./loader.mjs\";", "scripts/loader.mjs": "import \"typescript\";" }))
        .toEqual(["scripts/loader.mjs imports \"typescript\", which is neither relative nor a node: built-in"]);
      expect(problems({ "scripts/a.ts": "import \"./loader.wasm\";" }, ["scripts/loader.wasm"]))
        .toEqual(["scripts/a.ts imports \"./loader.wasm\", which is not a file this rule reads"]);
      expect(problems({ "skills/x/scripts/a.ts": "import \"../tests/helper.ts\";" }, ["skills/x/tests/helper.ts"]))
        .toEqual(["skills/x/scripts/a.ts imports \"../tests/helper.ts\", which is not a file this rule reads"]);
      expect(problems({ "scripts/a.ts": "import \"./missing.ts\";" }))
        .toEqual(["scripts/a.ts imports \"./missing.ts\", which is not a file this rule reads"]);
      expect(problems({ "scripts/a.ts": "import \"./b\";", "scripts/b.ts": "" }))
        .toEqual(["scripts/a.ts imports \"./b\", which is not a file this rule reads"]);
      expect(problems({ "scripts/lib/a.ts": "import \"../b.ts\";", "scripts/b.ts": "" })).toEqual([]);

      // A JSON file is data and imports nothing, so it need only exist.
      expect(problems({ "scripts/a.ts": "import data from \"./data.json\"; console.log(data);" }, ["scripts/data.json"]))
        .toEqual([]);
      expect(problems({ "scripts/a.ts": "import data from \"./data.json\"; console.log(data);" }))
        .toEqual(["scripts/a.ts imports \"./data.json\", which is not a file this rule reads"]);

      // No claim is made about a computed name. The run with nothing
      // installed is what catches this one, which a review wrote.
      expect(problems({ "scripts/a.ts": "const name = \"typescript\"; await import(name);" })).toEqual([]);
      // Nor about a name handed to another loader. In these three the name is
      // written out, and the loader is what the rule does not read:
      // createRequire, reached plainly and then by a computed member as a
      // review wrote it, and require.resolve. The run with nothing installed
      // catches such a load on any path it runs.
      expect(problems({
        "scripts/a.ts": "import { createRequire } from \"node:module\"; createRequire(import.meta.url)(\"typescript\");",
      })).toEqual([]);
      expect(problems({
        "scripts/a.ts": "import * as loader from \"node:module\"; loader[\"createRequire\"](import.meta.url)(\"typescript\");",
      })).toEqual([]);
      expect(problems({ "scripts/a.ts": "require.resolve(\"typescript\");" })).toEqual([]);
      // A member that happens to be called require loads nothing. An earlier
      // form of this rule refused it.
      expect(problems({ "scripts/a.ts": "export interface ReviewPolicy { require: boolean; }" })).toEqual([]);
    });
  });
});

const SOURCE_FILE = /\.(?:ts|js|mjs|cjs)$/;

/**
 * Every source file under `skills/` and `scripts/` outside the tests: each
 * `.ts`, `.js`, `.mjs` and `.cjs` file, with its text.
 *
 * @returns The text of each file, keyed by its path from the repository root
 *     with forward slashes.
 * @throws The file system error when a directory cannot be listed or a file
 *     cannot be read.
 */
function shippedSources(): Map<string, string> {
  const sources = new Map<string, string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(join(REPOSITORY_ROOT, directory))) {
      if (SKIPPED_DIRECTORIES.has(entry) || entry === "tests") continue;
      const path = `${directory}/${entry}`;
      if (statSync(join(REPOSITORY_ROOT, path)).isDirectory()) walk(path);
      else if (SOURCE_FILE.test(entry)) sources.set(path, readFileSync(join(REPOSITORY_ROOT, path), "utf8"));
    }
  };
  walk("skills");
  walk("scripts");
  return sources;
}

/**
 * What is wrong with the written imports of a set of source files.
 *
 * A written import must be a `node:` built-in or a relative path. A relative
 * path must name, exactly as written, another file in the set, so that every
 * file reached is itself read. A relative path to a `.json` file need only
 * exist, because JSON imports nothing.
 *
 * @param sources The text of each file, keyed by its path from the
 *     repository root with forward slashes.
 * @param exists Whether a path from the repository root is a file on disk.
 * @returns One sentence for each import at fault, naming the file and the
 *     import. Empty when every written import is allowed. Nothing is said
 *     about an import whose name is not written out.
 */
function importProblems(sources: ReadonlyMap<string, string>, exists: (path: string) => boolean): string[] {
  const problems: string[] = [];
  for (const [path, source] of sources) {
    for (const module of writtenImports(source, path)) {
      if (module.startsWith("node:")) continue;
      if (!/^\.{1,2}\//.test(module)) {
        problems.push(`${path} imports "${module}", which is neither relative nor a node: built-in`);
        continue;
      }
      const target = posix.normalize(posix.join(posix.dirname(path), module));
      const read = sources.has(target) || (target.endsWith(".json") && exists(target));
      if (!read) problems.push(`${path} imports "${module}", which is not a file this rule reads`);
    }
  }
  return problems;
}

/**
 * Every module a source imports under a name written in the source.
 *
 * Two readings are joined, and a name either one finds is returned.
 *
 * The first parses the source with the TypeScript compiler, so a comment or
 * a string that looks like an import is not one. A name counts as written
 * when it is a string, or a template with nothing substituted into it. It
 * reads `import` and `export ... from` declarations, an import of types
 * alone, and `import()`, `require()` or `import.meta.require()` whose first
 * argument is a written name, whatever arguments follow.
 *
 * The second is Bun's own scanner. Bun is what loads these files, so this
 * rule must not read fewer written names than Bun does. Bun leaves out an
 * import of types alone, which the first reading supplies.
 *
 * @param fileName Decides how the source is parsed, by its ending: as
 *     TypeScript for `.ts`, and as JavaScript otherwise.
 * @returns The names sorted, each once. Empty for a source that imports
 *     nothing under a written name.
 * @throws What Bun's scanner throws for a source it cannot parse.
 */
function writtenImports(source: string, fileName = "source.ts"): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const modules = new Set<string>();
  const visit = (node: ts.Node): void => {
    const module = writtenModule(node);
    if (module !== null) modules.add(module);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const loader = fileName.endsWith(".ts") ? "ts" : "js";
  for (const found of new Bun.Transpiler({ loader }).scanImports(source)) modules.add(found.path);
  return [...modules].sort();
}

/**
 * The module one node imports under a written name.
 *
 * @returns The name, or null when the node is not an import or its name is
 *     not written out.
 */
function writtenModule(node: ts.Node): string | null {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isExternalModuleReference(node) && ts.isStringLiteralLike(node.expression)) {
    return node.expression.text;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
    && ts.isStringLiteralLike(node.argument.literal)) {
    return node.argument.literal.text;
  }
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
    || (ts.isIdentifier(node.expression) && node.expression.text === "require")
    || isImportMetaRequire(node.expression))) {
    // The first argument is the name, whatever follows it. A review wrote
    // import("typescript", {}), and a rule that wanted one argument alone
    // read nothing there.
    const name = node.arguments[0];
    if (name !== undefined && ts.isStringLiteralLike(name)) return name.text;
  }
  return null;
}

/**
 * Whether an expression is `import.meta.require`, which Bun gives a module
 * as a third call that loads one by name.
 */
function isImportMetaRequire(expression: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expression) && expression.name.text === "require"
    && ts.isMetaProperty(expression.expression)
    && expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
}
