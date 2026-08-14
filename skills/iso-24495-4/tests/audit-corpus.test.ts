import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditCorpus,
  auditText,
  configHash,
  ENGINE_THRESHOLDS,
  isAuditedDocument,
  listTextFiles,
} from "../scripts/audit-corpus.ts";
import { classifyBoundary, mergedSentences, splitSentences } from "../scripts/lib/parse.ts";

const CORPUS = join(import.meta.dir, "fixtures", "corpus");

describe("listTextFiles", () => {
  test("returns absolute paths of text files, including nested ones, excluding other types", () => {
    const root = join(import.meta.dir, "fixtures", "repo-level2");
    const files = listTextFiles(root);
    expect(files).toHaveLength(4);
    expect(files).toContain(join(root, "docs", "plain-language-policy.md"));
    expect(files.some((f) => f.endsWith(".yml"))).toBe(false);
  });

  test("skips entries that cannot be inspected and reports each skip", () => {
    const root = mkdtempSync(join(tmpdir(), "iso-24495-4-walk-"));
    try {
      writeFileSync(join(root, "good.md"), "A short sentence.\n");
      const target = join(root, "target-dir");
      mkdirSync(target);
      symlinkSync(target, join(root, "dangling"), "junction");
      rmSync(target, { recursive: true, force: true });
      const skipped: string[] = [];
      expect(listTextFiles(root, (path) => skipped.push(path))).toEqual([join(root, "good.md")]);
      expect(skipped).toEqual([join(root, "dangling")]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("throws on a missing or unreadable root instead of reporting an empty corpus", () => {
    expect(() => listTextFiles(join(tmpdir(), "iso-24495-4-no-such-root"))).toThrow();
  });

  test("reports a nested directory that becomes unreadable", () => {
    const root = mkdtempSync(join(tmpdir(), "iso-24495-4-nested-read-"));
    try {
      const nested = join(root, "nested");
      mkdirSync(nested);
      const skipped: string[] = [];
      const readDirectory: typeof readdirSync = (path) => {
        if (path === nested) throw new Error("directory vanished");
        return readdirSync(path);
      };
      expect(listTextFiles(root, (path) => skipped.push(path), readDirectory)).toEqual([]);
      expect(skipped).toEqual([nested]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auditCorpus skip reporting", () => {
  test("forwards walk skips to the caller so partial audits are visible", () => {
    const root = mkdtempSync(join(tmpdir(), "iso-24495-4-audit-skip-"));
    try {
      writeFileSync(join(root, "good.md"), "A short sentence.\n");
      const target = join(root, "target-dir");
      mkdirSync(target);
      symlinkSync(target, join(root, "dangling"), "junction");
      rmSync(target, { recursive: true, force: true });
      const skipped: string[] = [];
      const findings = auditCorpus(root, (path) => skipped.push(path));
      expect(Object.keys(findings.files)).toEqual(["good.md"]);
      expect(skipped).toEqual([join(root, "dangling")]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auditCorpus", () => {
  const findings = auditCorpus(CORPUS);

  test("pins per-rule totals across the fixture corpus", () => {
    expect(findings.totals["sentence-length"]).toBe(2);
    expect(findings.totals["sentence-average"]).toBe(1);
    expect(findings.totals["paragraph-length"]).toBe(1);
    expect(findings.totals["legalese"]).toBe(5);
    expect(findings.totals["heading-depth"]).toBe(2);
  });

  test("a proxy-clean file has zero violations", () => {
    expect(findings.files["good-policy.md"].violations).toHaveLength(0);
  });

  test("long-sentences.md flags only sentences over the 30-word cap", () => {
    const v = findings.files["long-sentences.md"].violations;
    expect(v.filter((x) => x.rule === "sentence-length")).toHaveLength(2);
    expect(v.filter((x) => x.rule !== "sentence-length")).toHaveLength(0);
  });

  test("a sustained high average is caught even with no single offender", () => {
    const v = findings.files["average-heavy.md"].violations;
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("sentence-average");
    expect(v[0].detail).toContain("average 22.0");
    expect(v[0].detail).toContain("12 sentences");
    expect(v[0].detail).toContain("limit 20");
  });

  test("indented list items are structure, not prose", () => {
    // Regression for the column-zero bug: list markers must be recognised
    // at any indentation, or nested bullets merge into giant fake sentences.
    const nested = [
      "1. **Top item:**",
      "   - **First nested point:** some words that continue along here",
      "   - **Second nested point:** more words that continue along here",
      "   * another marker style, indented",
      "     2) a doubly indented numbered item with several words in it",
    ].join("\n");
    expect(auditText(nested)).toEqual([]);
  });

  // A synthetic sentence of exactly n words; programmatic, so the count
  // cannot be wrong by hand.
  const sentenceOf = (n: number) =>
    Array.from({ length: n }, (_, i) => `word${i}`).join(" ") + ".";

  test("the average fires at exactly ten sentences and not at 20.0 exactly", () => {
    const tenAt21 = Array(10).fill(sentenceOf(21)).join(" ");
    const fired = auditText(tenAt21).filter((x) => x.rule === "sentence-average");
    expect(fired).toHaveLength(1);
    expect(fired[0].detail).toContain("21.0");
    expect(fired[0].detail).toContain("10 sentences");

    const nineAt21 = Array(9).fill(sentenceOf(21)).join(" ");
    expect(auditText(nineAt21).filter((x) => x.rule === "sentence-average")).toHaveLength(0);

    const tenAt20 = Array(10).fill(sentenceOf(20)).join(" ");
    expect(auditText(tenAt20).filter((x) => x.rule === "sentence-average")).toHaveLength(0);
  });

  test("the average accumulates across separate prose blocks", () => {
    const spread = Array(10).fill(sentenceOf(21)).join("\n\n");
    expect(auditText(spread).filter((x) => x.rule === "sentence-average")).toHaveLength(1);
  });

  test("short documents are exempt from the average rule", () => {
    // good-policy.md is clean and has fewer than ten sentences; the average
    // rule must not fire on samples too small to judge fairly.
    expect(findings.files["good-policy.md"].violations).toHaveLength(0);
  });

  test("fenced code is immune to every rule", () => {
    expect(findings.files["code-fenced.md"].violations).toHaveLength(0);
  });

  test("legalese violations name the matched term", () => {
    const terms = findings.files["legalese-sample.md"].violations
      .filter((x) => x.rule === "legalese")
      .map((x) => x.detail);
    expect(terms.filter((t) => t.includes("shall"))).toHaveLength(3);
    expect(terms.filter((t) => t.includes("hereby"))).toHaveLength(1);
    expect(terms.filter((t) => t.includes("hereinafter"))).toHaveLength(1);
  });

  test("every violation cites a line number", () => {
    for (const file of Object.values(findings.files)) {
      for (const v of file.violations) {
        expect(v.line).toBeGreaterThan(0);
      }
    }
  });
});

function violationsFor(text: string, rule: string) {
  return auditText(text).filter((violation) => violation.rule === rule);
}

describe("lucid-inspired advisory rules", () => {
  test("heading-skip checks adjacent structural levels", () => {
    expect(violationsFor("### Initial heading\n", "heading-skip")).toEqual([]);

    const skipped = violationsFor("# First\nContent does not matter.\n### Third\n#### Fourth\n", "heading-skip");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].line).toBe(3);
    expect(skipped[0].detail).toContain("level 1 to level 3");

    expect(violationsFor("# First\n## Second\n### Third\n", "heading-skip")).toEqual([]);
    expect(violationsFor("### Third\n# First\n", "heading-skip")).toEqual([]);
    expect(violationsFor("# First\n```md\n### Code sample\n```\n## Second\n", "heading-skip")).toEqual([]);
  });

  test("heading-style checks length and sentence form with defined priorities", () => {
    const twelve = "# One two three four five six seven eight nine ten eleven twelve";
    const thirteen = `${twelve} thirteen`;
    expect(violationsFor(twelve, "heading-style")).toEqual([]);

    const long = violationsFor(thirteen, "heading-style");
    expect(long).toHaveLength(1);
    expect(long[0].detail).toContain("13 words");

    expect(violationsFor("# Is this a question?", "heading-style")).toEqual([]);
    expect(violationsFor("# This is exciting!", "heading-style")).toEqual([]);
    expect(violationsFor("# Wait...", "heading-style")).toEqual([]);
    expect(violationsFor("# Wait…", "heading-style")).toEqual([]);
    expect(violationsFor("## 2.1. Component Diagram", "heading-style")).toEqual([]);

    const fullStop = violationsFor("# This is a statement.", "heading-style");
    expect(fullStop).toHaveLength(1);
    expect(fullStop[0].detail).toContain("full stop");

    const multiple = violationsFor("# First statement. Second statement", "heading-style");
    expect(multiple).toHaveLength(1);
    expect(multiple[0].detail).toContain("2 sentences");

    const priority = violationsFor(`${thirteen}.`, "heading-style");
    expect(priority).toHaveLength(1);
    expect(priority[0].detail).toContain("13 words");
    expect(priority[0].detail).not.toContain("full stop");
    expect(violationsFor("This paragraph ends with a full stop.", "heading-style")).toEqual([]);

    // An abbreviation is not a sentence end. Splitting on every full stop made
    // ordinary titles look like two sentences, which is advice the reader
    // cannot act on.
    expect(violationsFor("# Dr. Smith explains the release", "heading-style")).toEqual([]);
    expect(violationsFor("# U.S. policy overview", "heading-style")).toEqual([]);
    expect(violationsFor("# Release notes, e.g. the summary", "heading-style")).toEqual([]);
    expect(violationsFor("# Ship it. Then tell the team", "heading-style")).toHaveLength(1);
    expect(violationsFor("# See Fig. 3 for the layout", "heading-style")).toEqual([]);
  });

  test("acronym-undefined applies definitions and false-positive guards", () => {
    const first = violationsFor("The ABC controls access. ABC appears again.", "acronym-undefined");
    expect(first).toHaveLength(1);
    expect(first[0].detail).toContain('"ABC"');

    expect(violationsFor("Application Binary Code (ABC) controls access. ABC continues.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("ABC (Application Binary Code) controls access.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("Section II precedes section IV. MP3 and A4 remain common.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("KG KM CM MM MB GB KB TB PDF URL HTML TV PIN UN USA U.S.A.", "acronym-undefined")).toEqual([]);
    for (const acronym of ["ISO", "AI", "API", "CLI", "JSON", "HTTP", "HTTPS", "SSH", "MIT"]) {
      expect(violationsFor(`The ${acronym} guidance applies.`, "acronym-undefined")).toEqual([]);
    }
    expect(violationsFor("THIS IS IMPORTANT prose.", "acronym-undefined")).toEqual([]);

    expect(violationsFor("The ADR records the choice.", "acronym-undefined")).toHaveLength(1);

    const dotted = violationsFor("The U.A.E. appears here.", "acronym-undefined");
    expect(dotted).toHaveLength(1);
    expect(dotted[0].detail).toContain('"U.A.E."');

    // Two capitalised terms side by side is ordinary technical prose, not
    // shouting. Suppressing on a single neighbour hid the commonest real case
    // while everyday words were still reported.
    expect(violationsFor("The DNS TTL controls caching.", "acronym-undefined")).toHaveLength(2);
    expect(violationsFor("The XML DOM represents the document.", "acronym-undefined")).toHaveLength(2);
    expect(violationsFor("THIS IS IMPORTANT prose.", "acronym-undefined")).toEqual([]);
    for (const word of ["OK", "ID", "AM", "PM"]) {
      expect(violationsFor(`Press ${word} to continue.`, "acronym-undefined")).toEqual([]);
    }

    // A run of initialisms is terminology; a shouted warning is ordinary words
    // in capitals. Counting tokens alone confused the two in both directions.
    expect(violationsFor("DO NOT continue until the backup finishes.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("WARNING: BACKUP FIRST before you upgrade.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("The AWS IAM SSO policy controls access.", "acronym-undefined")).toHaveLength(3);
    expect(violationsFor("Compare the CPU RAM SSD limits before purchase.", "acronym-undefined")).toHaveLength(3);
    expect(violationsFor("The AWS IAM SSO MFA configuration controls access.", "acronym-undefined")).toHaveLength(4);
    expect(violationsFor("The MICROSOFT SQL ODBC configuration controls access.", "acronym-undefined")).toHaveLength(2);
    expect(violationsFor("SAVE DATA FIRST before upgrading.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("BACK UP NOW before upgrading.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("The CAN bus carries each frame.", "acronym-undefined")).toHaveLength(1);

    // A Roman numeral is a numeral because of where it sits, not because of
    // which letters it uses. Shape alone exempted CI, MD, MIX and CD.
    expect(violationsFor("Section II precedes section IV.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("Chapter XI follows part IX.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("See Sections II and IV.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("Chapters II, III and IV apply.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("King Henry VIII reigned.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("The Super Bowl LVIII drew a crowd.", "acronym-undefined")).toEqual([]);
    for (const label of ["Title IV", "Schedule II", "Clause IV"]) {
      expect(violationsFor(`${label} applies here.`, "acronym-undefined"), label).toEqual([]);
    }
    // A collision-set numeral coordinated with another numeral is a numeral.
    expect(violationsFor("Sections IV and VI apply.", "acronym-undefined")).toEqual([]);
    // "and" alone is not evidence; there must be a numeral behind it.
    expect(violationsFor("Buy a drive and CD media online.", "acronym-undefined")).toHaveLength(1);
    expect(violationsFor("Type CD at the prompt.", "acronym-undefined")).toHaveLength(1);
    expect(violationsFor("Book MD appointments online.", "acronym-undefined")).toHaveLength(1);
    for (const acronym of ["CI", "MD", "MIX", "CD", "DC"]) {
      expect(
        violationsFor(`The ${acronym} record matters.`, "acronym-undefined"),
        `${acronym} must not be exempt outside a numbering context`,
      ).toHaveLength(1);
    }
  });

  test("doublet matches exact case-folded phrases without overlaps", () => {
    const findings = violationsFor(
      "The clause is NULL AND VOID, and the end result is clear. We also revert back once.",
      "doublet",
    );
    expect(findings).toHaveLength(3);
    expect(findings[0].detail).toContain('consider "void"');
    expect(findings[1].detail).toContain('consider "result"');
    expect(findings[2].detail).toContain('consider "revert"');

    expect(violationsFor("This is null, and void.", "doublet")).toEqual([]);
    expect(violationsFor("This is null. And void remains.", "doublet")).toEqual([]);
    expect(violationsFor("Each and every result is final.", "doublet")).toHaveLength(1);

    for (const phrase of ["cease and desist", "terms and conditions"]) {
      const legal = violationsFor(`These ${phrase} remain.`, "doublet");
      expect(legal).toHaveLength(1);
      expect(legal[0].detail).toContain("legal-register phrase");
      expect(legal[0].detail).not.toContain("consider");
    }
  });

  test("prose-enumeration requires three distinct ranks including rank one", () => {
    expect(violationsFor("First gather input, secondly compare it, and third report it.", "prose-enumeration")).toHaveLength(1);
    expect(violationsFor("First gather input and second compare it.", "prose-enumeration")).toEqual([]);
    expect(violationsFor("Second gather input, third compare it, and fourth report it.", "prose-enumeration")).toEqual([]);
    expect(violationsFor("The process is 1. gather input 2. compare it 3. report it", "prose-enumeration")).toHaveLength(1);
    expect(violationsFor("The process is (1) gather input (2) compare it (3) report it", "prose-enumeration")).toHaveLength(1);
    expect(violationsFor("The process is 1) gather input 2) compare it 3) report it", "prose-enumeration")).toHaveLength(1);
    expect(violationsFor("1. Gather input\n2. Compare it\n3. Report it\n", "prose-enumeration")).toEqual([]);
    expect(violationsFor("The years 1999, 2000, and 2001 matter.", "prose-enumeration")).toEqual([]);
    expect(violationsFor("The first example stands alone.", "prose-enumeration")).toEqual([]);
    expect(violationsFor("Firstly gather input, secondly compare it, and thirdly report it.", "prose-enumeration")).toHaveLength(1);

    // A hyphenated compound is one word, not a rank. "third-party" counted as
    // a third item and turned ordinary prose into a finding.
    expect(violationsFor(
      "We cache the first request, then the second cache layer, then a third-party service.",
      "prose-enumeration",
    )).toEqual([]);
    expect(violationsFor("The second-best option is a first-class fix.", "prose-enumeration")).toEqual([]);
  });
});

describe("sentence boundaries around abbreviations", () => {
  // Whether a full stop ends a sentence depends on what follows it. A title is
  // always followed by a name, so it never ends one; every other short form
  // ends a sentence when a new one starts with a capital.
  // The matrix that two review rounds produced. Each row broke a previous
  // version of this rule, in one direction or the other.
  test("the review matrix segments correctly", () => {
    // Each row states the fewest and the most sentences the text can hold.
    // Where the two differ, the evidence did not settle it, and the rules take
    // whichever reading cannot invent a violation.
    const cases: Array<[string, number, number]> = [
      ["U.S. Department of State guidance", 1, 2],
      ["See Fig. A for the layout", 1, 1],
      ["J. Smith release notes", 1, 1],
      ["J. de Vries release notes", 1, 2],
      ["Platforms, e.g. iOS and Android", 1, 2],
      ["Years, e.g. 2025 and 2026", 1, 2],
      ["It happened in the U.S. iOS users were unaffected.", 1, 2],
      ["It happened in the U.S. 2025 brought major changes.", 1, 2],
      ["U.S. Customers receive support.", 1, 2],
      ["He works in the U.S. The weather is fine.", 2, 2],
      ["Dr. Smith explains the release.", 1, 1],
      ["Ship it. Then tell the team.", 2, 2],
    ];
    for (const [text, fewest, most] of cases) {
      expect(mergedSentences(text).length, `${text} (fewest)`).toBe(fewest);
      expect(splitSentences(text).length, `${text} (most)`).toBe(most);
    }
  });

  // The guarantee the changelog makes: an undecided stop can never be the
  // reason a document is reported.
  test("an undecided boundary never creates a violation", () => {
    const heading = "# U.S. Customers receive support";
    expect(violationsFor(heading, "heading-style")).toEqual([]);

    // Ten sentences only when the ambiguous stop is counted as a boundary.
    const body = `${"Each sentence here carries a deliberately generous number of words for the average. ".repeat(9)}Formats, e.g. JSON output is supported.`;
    expect(auditText(body).filter((v) => v.rule === "sentence-average")).toEqual([]);
  });

  test("a following capital ends the sentence unless the short form is a title", () => {
    expect(splitSentences("He works in the U.S. The weather is fine.")).toHaveLength(2);
    expect(splitSentences("We ship on Monday, e.g. the first release. Then we stop.")).toHaveLength(2);
    expect(splitSentences("Dr. Smith explains the release.")).toHaveLength(1);
    expect(splitSentences("U.S. policy applies here.")).toHaveLength(1);
    expect(splitSentences("Release notes, e.g. the summary.")).toHaveLength(1);
    expect(splitSentences("See Fig. 3 for the layout.")).toHaveLength(1);
    expect(splitSentences("Ship it. Then tell the team.")).toHaveLength(2);

    // The inline abbreviation branch, whichever way the next word points.
    expect(splitSentences("Upgrade the server, etc. iOS clients are unaffected.")).toHaveLength(2);
    expect(splitSentences("Compare the versions, etc. The result is the same.")).toHaveLength(2);
    expect(splitSentences("Compare the versions, etc. before you upgrade.")).toHaveLength(1);

    // Neither reading is safe here, so the two counts differ and each rule
    // takes the one that cannot invent a violation.
    const ambiguous = "Formats, e.g. JSON output is supported.";
    expect(splitSentences(ambiguous)).toHaveLength(2);
    expect(mergedSentences(ambiguous)).toHaveLength(1);
    expect(classifyBoundary("Formats, e.g.", "JSON output is supported.")).toBe("ambiguous");
  });
});

describe("the audited document list", () => {
  // The hook lower-cased the extension and the repository walker did not, so a
  // file named in capitals was audited in one place and skipped in the other.
  test("extension matching ignores case everywhere", () => {
    for (const name of ["notes.txt", "notes.TXT", "notes.Markdown", "README.MD"]) {
      expect(isAuditedDocument(name), `${name} must be audited`).toBe(true);
    }
    for (const name of ["script.ts", "notes.txtx", "archive.md.zip", "plain"]) {
      expect(isAuditedDocument(name), `${name} must not be audited`).toBe(false);
    }
  });
});

describe("audit configuration identity", () => {
  test("configHash is stable and changes with any threshold", () => {
    const current = configHash();
    expect(current).toMatch(/^[0-9a-f]{8}$/);
    expect(configHash()).toBe(current);
    expect(auditCorpus(CORPUS).configHash).toBe(current);
    expect(configHash({
      ...ENGINE_THRESHOLDS,
      sentenceWordLimit: ENGINE_THRESHOLDS.sentenceWordLimit + 1,
    })).not.toBe(current);
  });
});
