import { describe, expect, test } from "bun:test";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditCorpus,
  auditText,
  configHash,
  ENGINE_THRESHOLDS,
  isAuditedDocument,
  listTextFiles,
  runCli,
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
      const blocked = join(root, "blocked.md");
      writeFileSync(blocked, "This entry disappears during inspection.\n");
      const target = join(root, "target-dir");
      mkdirSync(target);
      const dangling = join(root, "dangling");
      symlinkSync(target, dangling, "junction");
      rmSync(target, { recursive: true, force: true });
      const skipped: string[] = [];
      const inspectEntry = entryInspectorFailingAt(blocked);
      expect(listTextFiles(root, (path) => skipped.push(path), readdirSync, inspectEntry))
        .toEqual([join(root, "good.md")]);
      expect(skipped.sort()).toEqual([blocked, dangling].sort());
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
      const readDirectory = directoryReaderFailingAt(nested);
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
      const blocked = join(root, "blocked.md");
      writeFileSync(blocked, "This file becomes unreadable.\n");
      const target = join(root, "target-dir");
      mkdirSync(target);
      symlinkSync(target, join(root, "dangling"), "junction");
      rmSync(target, { recursive: true, force: true });
      const skipped: string[] = [];
      const readText = textReaderFailingAt(blocked);
      const findings = auditCorpus(root, (path) => skipped.push(path), readText);
      expect(Object.keys(findings.files)).toEqual(["good.md"]);
      expect(skipped.sort()).toEqual([blocked, join(root, "dangling")].sort());
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
    expect(findings.files["good-policy.md"]?.violations).toHaveLength(0);
  });

  test("long-sentences.md flags only sentences over the 30-word cap", () => {
    const v = findings.files["long-sentences.md"]?.violations ?? [];
    expect(v.filter((x) => x.rule === "sentence-length")).toHaveLength(2);
    expect(v.filter((x) => x.rule !== "sentence-length")).toHaveLength(0);
  });

  test("a sustained high average is caught even with no single offender", () => {
    const v = findings.files["average-heavy.md"]?.violations ?? [];
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("sentence-average");
    expect(v[0]?.detail).toContain("average 22.0");
    expect(v[0]?.detail).toContain("12 sentences");
    expect(v[0]?.detail).toContain("limit 20");
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

  test("the average fires at exactly ten sentences and not at 20.0 exactly", () => {
    const tenAt21 = Array.from<string>({ length: 10 }).fill(sentenceOf(21)).join(" ");
    const fired = auditText(tenAt21).filter((x) => x.rule === "sentence-average");
    expect(fired).toHaveLength(1);
    expect(fired[0]?.detail).toContain("21.0");
    expect(fired[0]?.detail).toContain("10 sentences");

    const nineAt21 = Array.from<string>({ length: 9 }).fill(sentenceOf(21)).join(" ");
    expect(auditText(nineAt21).filter((x) => x.rule === "sentence-average")).toHaveLength(0);

    const tenAt20 = Array.from<string>({ length: 10 }).fill(sentenceOf(20)).join(" ");
    expect(auditText(tenAt20).filter((x) => x.rule === "sentence-average")).toHaveLength(0);
  });

  test("the average accumulates across separate prose blocks", () => {
    const spread = Array.from<string>({ length: 10 }).fill(sentenceOf(21)).join("\n\n");
    expect(auditText(spread).filter((x) => x.rule === "sentence-average")).toHaveLength(1);
  });

  test("short documents are exempt from the average rule", () => {
    // good-policy.md is clean and has fewer than ten sentences; the average
    // rule must not fire on samples too small to judge fairly.
    expect(findings.files["good-policy.md"]?.violations).toHaveLength(0);
  });

  test("fenced code is immune to every rule", () => {
    expect(findings.files["code-fenced.md"]?.violations).toHaveLength(0);
  });

  test("legalese violations name the matched term", () => {
    const terms = (findings.files["legalese-sample.md"]?.violations ?? [])
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

/**
 * A synthetic sentence of exactly n words; programmatic, so the count
 * cannot be wrong by hand.
 */
function sentenceOf(n: number): string {
  return Array.from({ length: n }, (slot, i) => `word${i}`).join(" ") + ".";
}

/**
 * Makes an entry inspector that reads an entry as `lstatSync` does, except at
 * the one path given, where it throws an `Error` as if the entry had gone.
 *
 * @returns The inspector.
 */
function entryInspectorFailingAt(blocked: string): (path: string) => Stats {
  return (path: string): Stats => {
    if (path === blocked) throw new Error("entry vanished");
    return lstatSync(path);
  };
}

/**
 * Makes a directory reader that lists a directory as `readdirSync` does,
 * except at the one path given, where it throws an `Error` as if the
 * directory had become unreadable.
 *
 * @returns The reader.
 */
function directoryReaderFailingAt(nested: string): (path: string) => string[] {
  return (path: string): string[] => {
    if (path === nested) throw new Error("directory vanished");
    return readdirSync(path);
  };
}

/**
 * Makes a text reader that reads a file as UTF-8, except at the one path
 * given, where it throws an `Error` as if the file had become unreadable.
 *
 * @returns The reader.
 */
function textReaderFailingAt(blocked: string): (path: string) => string {
  return (path: string): string => {
    if (path === blocked) throw new Error("file became unreadable");
    return readFileSync(path, "utf8");
  };
}

describe("lucid-inspired advisory rules", () => {
  test("heading-skip checks adjacent structural levels", () => {
    expect(violationsFor("### Initial heading\n", "heading-skip")).toEqual([]);

    const skipped = violationsFor("# First\nContent does not matter.\n### Third\n#### Fourth\n", "heading-skip");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.line).toBe(3);
    expect(skipped[0]?.detail).toContain("level 1 to level 3");

    expect(violationsFor("# First\n## Second\n### Third\n", "heading-skip")).toEqual([]);
    expect(violationsFor("### Third\n# First\n", "heading-skip")).toEqual([]);
    expect(violationsFor("# First\n```md\n### Code sample\n```\n## Second\n", "heading-skip")).toEqual([]);

    // Round 6. CommonMark allows up to three spaces before the hashes, so an
    // indented heading was invisible to every heading rule. A fourth space
    // makes it an indented code block, which is not a heading.
    expect(violationsFor("# Title\n\n   ### Skipped\n", "heading-skip")).toHaveLength(1);
    expect(violationsFor("# Title\n\n    ### Code block\n", "heading-skip")).toEqual([]);
  });

  test("heading-style checks length and sentence form with defined priorities", () => {
    const twelve = "# One two three four five six seven eight nine ten eleven twelve";
    const thirteen = `${twelve} thirteen`;
    expect(violationsFor(twelve, "heading-style")).toEqual([]);

    const long = violationsFor(thirteen, "heading-style");
    expect(long).toHaveLength(1);
    expect(long[0]?.detail).toContain("13 words");

    expect(violationsFor("# Is this a question?", "heading-style")).toEqual([]);
    expect(violationsFor("# This is exciting!", "heading-style")).toEqual([]);
    expect(violationsFor("# Wait...", "heading-style")).toEqual([]);
    expect(violationsFor("# Wait…", "heading-style")).toEqual([]);
    expect(violationsFor("## 2.1. Component Diagram", "heading-style")).toEqual([]);

    const fullStop = violationsFor("# This is a statement.", "heading-style");
    expect(fullStop).toHaveLength(1);
    expect(fullStop[0]?.detail).toContain("full stop");

    const multiple = violationsFor("# First statement. Second statement", "heading-style");
    expect(multiple).toHaveLength(1);
    expect(multiple[0]?.detail).toContain("2 sentences");

    const priority = violationsFor(`${thirteen}.`, "heading-style");
    expect(priority).toHaveLength(1);
    expect(priority[0]?.detail).toContain("13 words");
    expect(priority[0]?.detail).not.toContain("full stop");
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
    expect(first[0]?.detail).toContain('"ABC"');

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
    expect(dotted[0]?.detail).toContain('"U.A.E."');

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

    // Round 6. A pair of capitals carries almost no evidence, so it must be
    // entirely ordinary words to count as shouting, and an ordinary word is
    // never reported as an acronym even inside a run that is not shouting.
    expect(violationsFor("ENABLE MFA before you continue.", "acronym-undefined")).toHaveLength(1);
    expect(violationsFor("VERIFY OTP at the prompt.", "acronym-undefined")).toHaveLength(1);
    expect(violationsFor("ROTATE KEYS every quarter.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("DO NOT USE S3 DATA here.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("WASH HANDS FIRST here.", "acronym-undefined")).toEqual([]);

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

    // Round 6. A capitalised name carries a regnal number; a short capitalised
    // word opening a sentence is usually a verb. Four letters or more is a
    // numeral in a list, but not when it is a documented name such as MMIX.
    expect(violationsFor("Elizabeth II reigned.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("Queen Elizabeth II reigned.", "acronym-undefined")).toEqual([]);
    expect(violationsFor("The MMIX computer is documented.", "acronym-undefined")).toHaveLength(1);
    expect(violationsFor("Open the form and review CI settings.", "acronym-undefined")).toHaveLength(1);
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
    expect(findings[0]?.detail).toContain('consider "void"');
    expect(findings[1]?.detail).toContain('consider "result"');
    expect(findings[2]?.detail).toContain('consider "revert"');

    expect(violationsFor("This is null, and void.", "doublet")).toEqual([]);
    expect(violationsFor("This is null. And void remains.", "doublet")).toEqual([]);
    expect(violationsFor("Each and every result is final.", "doublet")).toHaveLength(1);

    for (const phrase of ["cease and desist", "terms and conditions"]) {
      const legal = violationsFor(`These ${phrase} remain.`, "doublet");
      expect(legal).toHaveLength(1);
      expect(legal[0]?.detail).toContain("legal-register phrase");
      expect(legal[0]?.detail).not.toContain("consider");
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

    // Round 6. An inline abbreviation followed by a capital used to merge, so
    // two real sentences became one long one and a six-sentence paragraph
    // became five. It abstains now, and the readings differ.
    const joined = "We ship the packs, the tiers and the tables etc. Customers receive the update today.";
    expect(mergedSentences(joined)).toHaveLength(1);
    expect(splitSentences(joined)).toHaveLength(2);

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

describe("an argument list with a hole", () => {
  // Stopping at a hole ended the options early, so the command ran and exited 0
  // with an option it would have refused still unread.
  test("is refused, and so is what follows the hole", () => {
    const holed: string[] = ["bun", "audit-corpus-cli.ts", CORPUS];
    holed.length = 4;
    const trailing = [...holed];
    trailing.length = 4;
    holed.push("--unknown");
    for (const argv of [holed, trailing]) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      expect(runCli(argv, (text) => stdout.push(text), (text) => stderr.push(text))).toBe(2);
      expect(stderr).toEqual(["audit-corpus: argument 2 is missing; expected --json"]);
      expect(stdout).toEqual([]);
    }
  });
});

/** What the alt-text rule says about a text, as its finding details. */
function altFindings(text: string): string[] {
  return auditText(text)
    .filter((finding) => finding.rule === "image-alt")
    .map((finding) => finding.detail);
}

/** The finding the alt-text rule gives for an image, named as the finding names it. */
function missingAlt(name: string): string {
  return `image has no alternative text (${name})`;
}

const BACKSLASH = "\\";
const DEFINITION = '[dec]: decoration.png "decorative"';

/** A character from its code, which may be half a surrogate pair. */
function character(code: number): string {
  return code > 0xffff ? String.fromCodePoint(code) : String.fromCharCode(code);
}

// Destinations beyond ASCII that both renderers end in the same place: Latin,
// Chinese, Arabic, a combining mark, an emoji outside the basic plane, private
// use and a noncharacter.
const BEYOND_ASCII_DESTINATIONS = [
  `caf${character(0xe9)}.png`,
  `${character(0x56fe)}${character(0x7247)}.png`,
  `${character(0x635)}${character(0x648)}${character(0x631)}${character(0x629)}.png`,
  `e${character(0x301)}.png`,
  `a${character(0x1f600)}.png`,
  `a${character(0xe000)}${character(0xfffe)}b`,
];

// Every Unicode space and separator but the ASCII ones, which are tested apart.
const UNICODE_SPACES = [
  0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
];

// Control characters, including those that Unicode also counts as whitespace.
const CONTROLS = [0x1, 0xb, 0xc, 0x1f, 0x7f, 0x85, 0x9f];

// Format characters, which are invisible, and each half of a surrogate pair on its own.
const FORMAT_CHARACTERS = [0xad, 0x180e, 0x200b, 0x200c, 0x200d, 0x202e, 0x2066, 0xfeff, 0xd800, 0xdc00];

// The title decorative marks an image that carries no meaning. The rule
// honours it only in one closed form, which both reference renderers read the
// same way, and not in any other.
describe("a decorative title on an inline image", () => {
  test("is honoured after a plain destination and one space, in either quotes and any case", () => {
    expect(altFindings('![](decoration.png "decorative")\n')).toEqual([]);
    expect(altFindings("![](decoration.png 'decorative')\n")).toEqual([]);
    expect(altFindings('![](decoration.png "DecoRative")\n')).toEqual([]);
    expect(altFindings('![](https://example.com/a-b_c?d=1&e=%20#f "decorative")\n')).toEqual([]);
  });

  test("is honoured wherever such an image stands on a line", () => {
    const image = '![](decoration.png "decorative")';
    for (const text of [`- ${image}`, `> ${image}`, `# ${image}`, `[${image}](page.md)`, `Text ${image} text.`, `[t](a "x") ${image}`]) {
      expect(altFindings(`${text}\n`), text).toEqual([]);
    }
  });

  test("is honoured after a tab where the reader keeps it, in a heading", () => {
    expect(altFindings('# ![](decoration.png\t"decorative")\n')).toEqual([]);
    // In a paragraph the reader turns the tab into spaces, so the rule reports it.
    expect(altFindings('![](decoration.png\t"decorative")\n')).toHaveLength(1);
  });

  test("is honoured with every printable ASCII character in the destination but the excluded ones", () => {
    for (let code = 0x21; code < 0x7f; code++) {
      const character = String.fromCharCode(code);
      const expected = `"'()<>${BACKSLASH}`.includes(character) ? 1 : 0;
      expect(altFindings(`![](a${character}b "decorative")\n`), character).toHaveLength(expected);
    }
  });

  test("is honoured with a destination beyond ASCII, in any script and with emoji", () => {
    for (const destination of BEYOND_ASCII_DESTINATIONS) {
      expect(altFindings(`![](${destination} "decorative")\n`), destination).toEqual([]);
    }
  });

  test("is not honoured with Unicode whitespace or a separator in the destination", () => {
    for (const code of UNICODE_SPACES) {
      expect(altFindings(`![](a${character(code)}b "decorative")\n`), code.toString(16)).toHaveLength(1);
    }
    // A tab is kept as written in a heading, so the rule reads it there.
    expect(altFindings('# ![](a\tb "decorative")\n')).toHaveLength(1);
  });

  test("is not honoured with a control character in the destination", () => {
    for (const code of CONTROLS) {
      expect(altFindings(`![](a${character(code)}b "decorative")\n`), code.toString(16)).toHaveLength(1);
    }
  });

  test("is not honoured with a format character or half a surrogate pair in the destination", () => {
    for (const code of FORMAT_CHARACTERS) {
      expect(altFindings(`![](a${character(code)}b "decorative")\n`), code.toString(16)).toHaveLength(1);
    }
  });

  test("is not honoured with an excluded ASCII character in a destination beyond ASCII", () => {
    for (const excluded of `"'()<>${BACKSLASH}`) {
      expect(altFindings(`![](caf${character(0xe9)}${excluded}1 "decorative")\n`), excluded).toHaveLength(1);
    }
  });

  test("is not honoured on a title spelt with a letter beyond ASCII", () => {
    // A dotless i and a dotted capital I are not the ASCII letter.
    for (const title of [`decorat${character(0x131)}ve`, `DECORAT${character(0x130)}VE`]) {
      expect(altFindings(`![](decoration.png "${title}")\n`), title).toHaveLength(1);
    }
  });

  test("is not honoured in parentheses, which the scan cuts at the title's own \")\"", () => {
    expect(altFindings("![](decoration.png (decorative))\n")).toEqual([missingAlt("decoration.png (decorative")]);
  });

  test("is not honoured after any other destination or gap", () => {
    for (const written of [
      '<decoration.png> "decorative"', '<my decoration.png> "decorative"', 'decoration(1).png "decorative"',
      `decoration${BACKSLASH}).png "decorative"`, `my${BACKSLASH} decoration.png "decorative"`,
      'decoration.png  "decorative"', 'decoration.png"decorative"', ' "decorative"',
      `decoration.png${String.fromCharCode(0xa0)}"decorative"`, 'decoration.png "decorative" ',
      'decoration.png "decorative image"', 'decoration.png ""',
    ]) {
      // The reader takes "<my decoration.png>" for a tag, so only the count is compared.
      expect(altFindings(`![](${written})\n`), written).toHaveLength(1);
    }
  });

  test("is not honoured where the reader rewrote anything on the image's line", () => {
    // An escape, a code span and a tag reach the rule as spaces, so what the
    // rule reads is not what was written, and it reports rather than guess.
    const image = '![](decoration.png "decorative")';
    for (const text of [`${BACKSLASH}* ${image}`, `\`code\` ${image}`, `<b>bold</b> ${image}`]) {
      expect(altFindings(`${text}\n`), text).toHaveLength(1);
    }
    // In the text as written, the tag is part of the destination and there is no title.
    expect(altFindings('![](decoration.png<b>"decorative")\n')).toHaveLength(1);
  });

  test("is not honoured on an image with a label of spaces", () => {
    expect(altFindings('![ ](decoration.png "decorative")\n')).toEqual([missingAlt('decoration.png "decorative"')]);
  });
});

describe("a decorative title on a reference image", () => {
  test("is honoured from one plain definition on a line of its own, before or after the image", () => {
    expect(altFindings(`![][dec]\n\n${DEFINITION}\n`)).toEqual([]);
    expect(altFindings(`${DEFINITION}\n\n![][dec]\n`)).toEqual([]);
    expect(altFindings("![][dec]\n\n[dec]: decoration.png 'DECORATIVE'\n")).toEqual([]);
    expect(altFindings(`![][dec]\r\n\r\n${DEFINITION}\r\n`)).toEqual([]);
  });

  test("matches the label as a renderer does, ignoring case and runs of space", () => {
    expect(altFindings(`![][DEC]\n\n${DEFINITION}\n`)).toEqual([]);
    expect(altFindings('![][the  Dec_1-x]\n\n[The dec_1-X]: decoration.png "decorative"\n')).toEqual([]);
    // The title belongs to the definition the image names, not to its neighbour.
    expect(altFindings(`![][plain]\n\n${DEFINITION}\n[plain]: plain.png\n`)).toEqual([missingAlt("plain")]);
  });

  test("is needed: a definition with no title, or another, leaves the image reported", () => {
    for (const definition of ["[dec]: decoration.png", "[dec]: decorative.png", '[dec]: decoration.png "not decorative"']) {
      expect(altFindings(`![][dec]\n\n${definition}\n`), definition).toEqual([missingAlt("dec")]);
    }
  });

  test("is not honoured from a definition in any other form", () => {
    for (const definition of [
      "[dec]: decoration.png (decorative)", '[dec]: <decoration.png> "decorative"', '[dec]:  decoration.png "decorative"',
      '[dec]: decoration.png  "decorative"', '[dec]: decoration.png "decorative" ', ' [dec]: decoration.png "decorative"',
      `[dec]: decoration${BACKSLASH}_1.png "decorative"`, '[dec]: decoration(1).png "decorative"',
    ]) {
      expect(altFindings(`![][dec]\n\n${definition}\n`), definition).toEqual([missingAlt("dec")]);
    }
    // A definition in a quotation or a list item, or one whose title is on the next line.
    expect(altFindings(`![][dec]\n\n> ${DEFINITION}\n`)).toEqual([missingAlt("dec")]);
    expect(altFindings(`![][dec]\n\n- ${DEFINITION}\n`)).toEqual([missingAlt("dec")]);
    expect(altFindings('![][dec]\n\n[dec]: decoration.png\n"decorative"\n')).toEqual([missingAlt("dec")]);
  });

  test("is honoured from a definition whose destination is beyond ASCII", () => {
    for (const destination of BEYOND_ASCII_DESTINATIONS) {
      expect(altFindings(`![][dec]\n\n[dec]: ${destination} "decorative"\n`), destination).toEqual([]);
    }
  });

  test("is not honoured from a definition whose destination holds a Unicode space, a control or a format character", () => {
    // The reader reads no definition with an ASCII control in it, so the image
    // is skipped as naming none. The controls beyond ASCII are tried instead.
    for (const code of [...UNICODE_SPACES, 0x85, 0x9f, ...FORMAT_CHARACTERS]) {
      const definition = `[dec]: a${character(code)}b "decorative"`;
      expect(altFindings(`![][dec]\n\n${definition}\n`), code.toString(16)).toEqual([missingAlt("dec")]);
    }
  });

  test("is not honoured on a label with anything but ASCII letters, digits, spaces, hyphens and underscores", () => {
    for (const label of ["a.b", "a:b", "a/b"]) {
      expect(altFindings(`![][${label}]\n\n[${label}]: decoration.png "decorative"\n`), label).toHaveLength(1);
    }
    // The Kelvin sign is "k" in lower case, but it is not ASCII, so the image is reported.
    const kelvin = String.fromCharCode(0x212a);
    expect(altFindings(`![][${kelvin}]\n\n[k]: decoration.png "decorative"\n`)).toEqual([missingAlt(kelvin)]);
  });

  test("is not honoured when another definition could be the one a renderer takes", () => {
    const untitled = "[dec]: other.png";
    expect(altFindings(`![][dec]\n\n${DEFINITION}\n${untitled}\n`)).toEqual([missingAlt("dec")]);
    expect(altFindings(`![][dec]\n\n${untitled}\n${DEFINITION}\n`)).toEqual([missingAlt("dec")]);
    // Labels that differ only in spaces, hyphens, underscores or escapes are counted as one.
    for (const other of ["[d ec]: other.png", "[de-c]: other.png", "[d_ec]: other.png", `[de${BACKSLASH}c]: other.png`]) {
      expect(altFindings(`![][dec]\n\n${DEFINITION}\n${other}\n`), other).toEqual([missingAlt("dec")]);
    }
    // A label written over two lines, which both renderers take as the first
    // definition, though the reader does not read it as one.
    expect(altFindings(`![][d ec]\n\n[d\nec]: first.png\n\n[d ec]: decoration.png "decorative"\n`)).toEqual([missingAlt("d ec")]);
  });

  test("is not honoured when any definition's label holds a character beyond ASCII", () => {
    // Renderers fold case across Unicode, so these labels can match a plain one.
    const folding: ReadonlyArray<[image: string, first: string]> = [
      ["SS", "ß"], ["k", String.fromCharCode(0x212a)], ["i", String.fromCharCode(0x131)], ["a b", `a${String.fromCharCode(0xa0)}b`],
    ];
    for (const [image, first] of folding) {
      const text = `![][${image}]\n\n[${first}]: first.png\n[${image}]: second.png "decorative"\n`;
      expect(altFindings(text), image).toEqual([missingAlt(image)]);
    }
    // So does one that could not match, since the rule does not fold case itself.
    expect(altFindings(`![][dec]\n\n${DEFINITION}\n[café]: cafe.png\n`)).toEqual([missingAlt("dec")]);
  });

  test("is not honoured on an image after other image syntax in its paragraph", () => {
    // Each of these renders one image with no title, of which the reference is a part.
    for (const text of ["![](a![][dec]\n)", "![](\na![][dec])", "![![](q)](<a) ![][dec]>)", "![![][dec]](\nx.png)"]) {
      expect(altFindings(`${text}\n\n${DEFINITION}\n`), text).toHaveLength(1);
    }
    expect(altFindings(`![![][dec]][other\n]\n\n${DEFINITION}\n[other]: u.png\n`)).toHaveLength(1);
    // Even after an image that the reference is not part of.
    expect(altFindings(`\`![x]\` ![][dec]\n\n${DEFINITION}\n`)).toEqual([missingAlt("dec")]);
    expect(altFindings(`![][dec] ![][dec]\n\n${DEFINITION}\n`)).toEqual([missingAlt("dec")]);
    // A line of spaces is blank and ends the paragraph; a no-break space does not.
    expect(altFindings(`![x](a.png)\n \t\n![][dec]\n\n${DEFINITION}\n`)).toEqual([]);
    expect(altFindings(`![x](a.png)\n${String.fromCharCode(0xa0)}\n![][dec]\n\n${DEFINITION}\n`)).toEqual([missingAlt("dec")]);
  });

  test("is not honoured where the reader rewrote anything on the image's line", () => {
    expect(altFindings(`<b>x</b> ![][dec]\n\n${DEFINITION}\n`)).toEqual([missingAlt("dec")]);
    // The reader reads this label as "de c", whose definition is decorative, but
    // both renderers take the definition written "de<b>c", which has no title.
    expect(altFindings('![][de<b>c]\n\n[de c]: decoration.png "decorative"\n[de<b>c]: other.png\n'))
      .toEqual([missingAlt("de c")]);
  });

  test("leaves alone what was never reported", () => {
    // Collapsed and shortcut images carry their label as alternative text.
    expect(altFindings(`![dec][]\n\n${DEFINITION}\n`)).toEqual([]);
    expect(altFindings(`![dec]\n\n${DEFINITION}\n`)).toEqual([]);
    // An image naming no definition renders as text, and a tab makes the reader skip a definition.
    expect(altFindings(`![][missing]\n\n${DEFINITION}\n`)).toEqual([]);
    expect(altFindings('![][dec]\n\n[dec]:\tdecoration.png "decorative"\n')).toEqual([]);
  });
});

// One image's title must never stand for another's, so these hold two images.
describe("two images with no alternative text, one marked decorative", () => {
  const untitledInline = "![](plain.png)";
  const decorativeInline = '![](decoration.png "decorative")';
  const definitions = `${DEFINITION}\n[plain]: plain.png`;

  test("report the untitled one and honour the decorative inline one, in either order", () => {
    for (const between of [" ", "\n", "\n\n"]) {
      expect(altFindings(`${untitledInline}${between}${decorativeInline}\n`)).toEqual([missingAlt("plain.png")]);
      expect(altFindings(`${decorativeInline}${between}${untitledInline}\n`)).toEqual([missingAlt("plain.png")]);
      expect(altFindings(`![][plain]${between}${decorativeInline}\n\n${definitions}\n`)).toEqual([missingAlt("plain")]);
    }
  });

  test("honour a decorative reference image only when it comes first in its paragraph", () => {
    for (const untitled of [untitledInline, "![][plain]"]) {
      const named = missingAlt(untitled === untitledInline ? "plain.png" : "plain");
      expect(altFindings(`![][dec] ${untitled}\n\n${definitions}\n`), untitled).toEqual([named]);
      expect(altFindings(`![][dec]\n\n${untitled}\n\n${definitions}\n`), untitled).toEqual([named]);
      expect(altFindings(`${untitled}\n\n![][dec]\n\n${definitions}\n`), untitled).toEqual([named]);
      expect(altFindings(`${untitled} ![][dec]\n\n${definitions}\n`), untitled).toEqual([named, missingAlt("dec")]);
    }
  });

  test("keep the finding on a real image whose destination holds text like a decorative image", () => {
    // Both renderers show one image with no title, whose destination holds the
    // second "image". The rule reports the real one, at the start of the line.
    expect(altFindings(`![](<a) ${decorativeInline}>)\n`)).toEqual([missingAlt("<a")]);
    expect(altFindings(`![](<a) ![][dec]>)\n\n${DEFINITION}\n`)).toEqual([missingAlt("<a"), missingAlt("dec")]);
  });
});

// Neither renderer shows an image in raw HTML, so these findings are on text
// alone. The rule cannot see the HTML block, and the checklist names this.
describe("image syntax inside a raw HTML block", () => {
  test("is reported unless it is written in the decorative form", () => {
    expect(altFindings("<div>\n![](probe.png)\n</div>\n")).toHaveLength(1);
    expect(altFindings("<div>\n![](probe.png (decorative))\n</div>\n")).toHaveLength(1);
    expect(altFindings('<div>\n![](probe.png "decorative")\n</div>\n')).toEqual([]);
    expect(altFindings(`<div>\n![][dec]\n</div>\n\n${DEFINITION}\n`)).toEqual([]);
  });
});

// The third review of pull request 76 found these. Each renders an image with
// no title under both renderers, except the raw HTML ones, which render none.
describe("the third review's regressions", () => {
  const space = String.fromCharCode(0xa0);
  test("report an image whose label another definition matches first", () => {
    for (const text of [
      `![][a b]\n\n[a${space}b]: first.png "decorative"\n[a b]: second.png`,
      `![][a!b]\n\n[a${BACKSLASH}!b]: first.png "decorative"\n[a!b]: second.png`,
      '![][SS]\n\n[ß]: first.png\n[SS]: second.png "decorative"',
      '![][σ]\n\n[ς]: first.png\n[σ]: second.png "decorative"',
      `![][${String.fromCharCode(0x131)}]\n\n[i]: first.png\n[${String.fromCharCode(0x131)}]: second.png "decorative"`,
    ]) {
      expect(altFindings(text), text).toHaveLength(1);
    }
    expect(altFindings(`![][a b] ![](titled.png (decorative))\n\n[a${space}b]: first.png "decorative"\n[a b]: second.png`))
      .toEqual([missingAlt("a b"), missingAlt("titled.png (decorative")]);
  });

  test("report image syntax in raw HTML written with a title in parentheses", () => {
    expect(altFindings("<div>\n![](probe.png (decorative))\n</div>")).toHaveLength(1);
  });

  test("keep their controls", () => {
    expect(altFindings("![](probe.png)")).toHaveLength(1);
    expect(altFindings('![](probe.png "decorative")')).toEqual([]);
    expect(altFindings('![][dec]\n\n[dec]: probe.png "decorative"')).toEqual([]);
  });
});

/** What `provisional-label` says about a document that cites Part 5 with no draft label beside the citation. */
const UNLABELLED = "no paragraph that cites ISO 24495-5 or its skill says the standard is a draft; say it is an unpublished draft where you cite it";

/** Each `provisional-label` finding as its line and detail. */
function labelFindings(text: string, frontMatter?: boolean): Array<{ line: number; detail: string }> {
  return auditText(text, frontMatter === undefined ? {} : { frontMatter })
    .filter((violation) => violation.rule === "provisional-label")
    .map(({ line, detail }) => ({ line, detail }));
}

// Part 5 asks a document that cites the skill or ISO 24495-5 to say that the
// standard is an unpublished draft. The rule asks it once: one paragraph that
// cites it must carry the label. A label elsewhere in the file is not beside
// the citation a reader meets, and a label in every citing paragraph is more
// than the clause asks.
describe("provisional-label", () => {
  test("reports a citation in any of its forms when nothing beside it says draft", () => {
    for (const text of [
      "Our layout follows ISO 24495-5.\n",
      "Our layout follows ISO/WD 24495-5.\n",
      "Run `iso-24495-5` over the guide.\n",
      "The skills/iso-24495-5/SKILL.md file sets the rules.\n",
      "Our layout follows ISO 24495-5:2027.\n",
    ]) {
      expect(labelFindings(text), text).toEqual([{ line: 1, detail: UNLABELLED }]);
    }
  });

  test("passes a citing paragraph that says draft, drafts, provisional or unpublished, in any letter case", () => {
    for (const label of ["a draft", "one of the drafts", "provisional", "unpublished", "a DRAFT", "Provisional", "an _unpublished_ draft", "a **draft**"]) {
      const text = `Our layout follows ISO 24495-5, which is ${label}.\n`;
      expect(labelFindings(text), text).toEqual([]);
    }
  });

  test("does not take a longer word or another number for the label or the citation", () => {
    expect(labelFindings("The guide was drafted against ISO 24495-5.\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
    expect(labelFindings("We will redraft it against ISO 24495-5.\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
    expect(labelFindings("Our layout follows ISO 24495-50.\n")).toEqual([]);
    expect(labelFindings("Our layout follows ISO 124495-5.\n")).toEqual([]);
    expect(labelFindings("Our wording follows ISO 24495-1.\n")).toEqual([]);
    expect(labelFindings("Our layout follows Part 5.\n")).toEqual([]);
  });

  test("needs the label in a paragraph that cites, not elsewhere in the file", () => {
    expect(labelFindings("ISO 24495-5 shapes this guide.\n\nThis guide is a draft.\n"))
      .toEqual([{ line: 1, detail: UNLABELLED }]);
    expect(labelFindings("This guide is a draft.\n\nISO 24495-5 shapes this guide.\n"))
      .toEqual([{ line: 3, detail: UNLABELLED }]);
  });

  test("needs the label in one citing paragraph, not in every one", () => {
    expect(labelFindings("ISO 24495-5 is an unpublished draft.\n\nWe follow ISO 24495-5 throughout.\n")).toEqual([]);
    expect(labelFindings("We follow ISO 24495-5 throughout.\n\nISO 24495-5 is an unpublished draft.\n")).toEqual([]);
  });

  test("reports a document once, at its first citation", () => {
    expect(labelFindings("# Guide\n\nWe follow ISO 24495-5.\n\nRun `iso-24495-5` on it.\n"))
      .toEqual([{ line: 3, detail: UNLABELLED }]);
  });

  test("reads each list item, quotation, heading and table row as a paragraph of its own", () => {
    expect(labelFindings("- Uses ISO 24495-5\n- Is a draft\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
    expect(labelFindings("- Uses ISO 24495-5, a draft\n- Is long\n")).toEqual([]);
    expect(labelFindings("> ISO 24495-5 is a working draft.\n")).toEqual([]);
    expect(labelFindings("> ISO 24495-5 is a working paper.\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
    expect(labelFindings("# ISO 24495-5 guide (draft)\n\nText.\n")).toEqual([]);
    expect(labelFindings("# ISO 24495-5 guide\n\nIt is a draft.\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
    expect(labelFindings("Guide to ISO 24495-5\n====\n\nText.\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
    const table = "| Skill | Status |\n|---|---|\n| `iso-24495-5` | provisional |\n| `iso-24495-1` | ready |\n";
    expect(labelFindings(table)).toEqual([]);
    expect(labelFindings(table.replace("provisional", "ready"))).toEqual([{ line: 3, detail: UNLABELLED }]);
    const labelInAnotherRow = "| Skill | Status |\n|---|---|\n| `iso-24495-5` | ready |\n| `iso-24495-1` | draft |\n";
    expect(labelFindings(labelInAnotherRow)).toEqual([{ line: 3, detail: UNLABELLED }]);
    expect(labelFindings("| ISO 24495-5 | Status |\n|---|---|\n| a | b |\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
  });

  test("skips code, front matter, comments, link destinations and quoted text", () => {
    expect(labelFindings("```\nISO 24495-5\n```\n")).toEqual([]);
    expect(labelFindings("Text.\n\n    ISO 24495-5\n")).toEqual([]);
    expect(labelFindings("<!-- ISO 24495-5 -->\n\nText.\n")).toEqual([]);
    expect(labelFindings("Read the [guide](iso-24495-5.md).\n")).toEqual([]);
    expect(labelFindings("Never write \"follows ISO 24495-5\" alone.\n")).toEqual([]);
    expect(labelFindings("Never write “follows ISO 24495-5” alone.\n")).toEqual([]);
    expect(labelFindings("---\nsource: ISO 24495-5\n---\n\nText.\n")).toEqual([]);
  });

  test("keeps the controls of what it skips", () => {
    expect(labelFindings("ISO 24495-5\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
    expect(labelFindings("Read the iso-24495-5 guide.\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
    expect(labelFindings("Never write follows ISO 24495-5 alone.\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
    expect(labelFindings("---\nsource: ISO 24495-5\n---\n\nText.\n", false)).toEqual([{ line: 2, detail: UNLABELLED }]);
  });

  test("does not count a draft word inside quotation marks as the label", () => {
    expect(labelFindings("ISO 24495-5 is a \"draft\".\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
    expect(labelFindings("We follow ISO 24495-5. Avoid the phrase \"standard draft\".\n")).toEqual([{ line: 1, detail: UNLABELLED }]);
    expect(labelFindings("ISO 24495-5 is a draft.\n")).toEqual([]);
  });
});
