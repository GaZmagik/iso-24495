import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { auditCorpus } from "../scripts/audit-corpus.ts";
import { auditEvidence } from "../scripts/audit-evidence.ts";
import { generateReport, runCli } from "../scripts/generate-report.ts";
import { scoreMaturity } from "../scripts/score-maturity.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const findings = auditCorpus(join(FIXTURES, "corpus"));
const evidence = auditEvidence(join(FIXTURES, "repo-level2"));
const answers = await Bun.file(join(FIXTURES, "answers.sample.json")).json();
const maturity = scoreMaturity(answers);
const NOW = "2026-08-11T14:00:00.000Z";

/** Named in the failure, because a difference of 45 lines needs a reason. */
const REPORT_MUST_MATCH =
  "the report changed. Read the diff as what a reader gains or loses, and update this only when that is what you meant.";

describe("generateReport", () => {
  test("the report contains every required section", () => {
    const { report } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    for (const heading of ["## Maturity", "## Evidence", "## Corpus findings", "## Limitations"]) {
      expect(report).toContain(heading);
    }
  });

  test("the report declares its provisional basis", () => {
    const { report } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    expect(report).toContain("ISO/CD 24495-4");
    expect(report.toLowerCase()).toContain("provisional");
  });

  // The whole report, line for line.
  //
  // Four checks tried to describe what the report must not do: no word
  // "certified", then no comment opener, then no less-than sign, then no
  // image syntax. A review walked past each in turn, and the last two also
  // refused output the generator legitimately produces, because a second
  // evidence path is separated with a break tag.
  //
  // Describing a document by what it may not contain was the mistake. This
  // is what it does contain, on fixed inputs and a fixed clock, checked
  // against a renderer when it was written down. Comparing the next report
  // with the one that was reviewed needs no renderer here.
  //
  // Every earlier survivor fails against this: a comment or a hidden div
  // around the body, the disclaimer as an image caption or a reference
  // definition, a maturity level replaced by a literal, a count replaced by
  // zero, and a reversed sentence about text quality. The four tests this
  // replaces each checked one of those and missed the rest.
  test("the report is exactly this document", () => {
    const { report } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    expect(report.split(/\r?\n/), REPORT_MUST_MATCH).toEqual([
    "# Plain Language Gap Analysis",
    "",
    "> Provisional: this analysis is based on the public scope of ISO/CD 24495-4 (committee draft, unpublished). It is not a compliance statement and confers no certification. Audit date: 2026-08-11T14:00:00.000Z.",
    "",
    "## Maturity",
    "",
    "| Dimension | Level | Blocking criteria |",
    "|-----------|-------|-------------------|",
    "| governance | 2 | resourced-mandated |",
    "| capability | 1 | training-delivered |",
    "| process | 2 | signoff-gates |",
    "| measurement | 0 | corpus-baseline-taken |",
    "| culture | 1 | leadership-champions |",
    "",
    "Overall maturity (weakest dimension): **0**.",
    "",
    "## Evidence",
    "",
    "| Artefact category | Found | Paths |",
    "|-------------------|-------|-------|",
    "| policy | yes | `docs/plain-language-policy.md` |",
    "| review-workflow | yes | `.github/PULL_REQUEST_TEMPLATE.md` |",
    "| automated-checks | yes | `.github/workflows/text-lint.yml` |",
    "| training | yes | `training/introduction.md` |",
    "| glossary | yes | `glossary.md` |",
    "",
    "## Corpus findings",
    "",
    "| Rule | Violations |",
    "|------|------------|",
    "| sentence-average | 1 |",
    "| paragraph-length | 1 |",
    "| heading-depth | 2 |",
    "| legalese | 5 |",
    "| sentence-length | 2 |",
    "",
    "Corpus metrics are proxies for the Measurement dimension only. Text quality alone never raises a maturity level.",
    "",
    "## Limitations",
    "",
    "- The underlying standard is an unpublished committee draft; criteria may change.",
    "- Text heuristics are English-centric and approximate.",
    "- Maturity levels reflect the evidence supplied; absent evidence scores as absent.",
    "- A human reviewer must validate this report before the organisation acts on it.",
    "",
    ]);
  });

  test("a first run creates state with one timestamped snapshot", () => {

    const { state } = generateReport({ findings, evidence, maturity, state: null, now: NOW });
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0].timestamp).toBe(NOW);
    expect(state.snapshots[0].totals["legalese"]).toBe(5);
  });

  test("a later run appends a snapshot without rewriting history", () => {
    const first = generateReport({ findings, evidence, maturity, state: null, now: NOW }).state;
    const LATER = "2026-11-01T09:00:00.000Z";
    const { state, report } = generateReport({ findings, evidence, maturity, state: first, now: LATER });
    expect(state.snapshots).toHaveLength(2);
    expect(state.snapshots[0]).toEqual(first.snapshots[0]);
    expect(state.snapshots[1].timestamp).toBe(LATER);
    expect(report).toContain("## Trend");
  });
});

describe("a report built from files nobody has read", () => {
  // Every value in the report comes from a JSON file the user names. The
  // evidence paths come from a directory walk, and the rest is whatever the
  // file holds, a number included: nothing checks its shape.
  test("no control character, direction mark or line break from an input reaches the report", () => {
    for (const code of [27, 0x9b, 0x202e]) {
      const character = String.fromCharCode(code);
      const unread = `x${character}[2J|y\nz`;
      const asNumber = unread as unknown as number;
      const { report, state } = generateReport({
        findings: { configHash: "c", files: {}, totals: { [unread]: asNumber } },
        evidence: { artefacts: { [unread]: { found: true, paths: [unread, "docs/policy.md"] } } },
        maturity: { dimensions: { [unread]: { level: asNumber, missing: [unread, "owner-accountable"] } }, overall: asNumber },
        state: { snapshots: [{ timestamp: unread, totals: { legalese: asNumber }, overall: asNumber }] },
        now: NOW,
      });
      const clean = "x [2J\\|y z";
      expect(report).not.toContain(character);
      expect(report).toContain(`| ${clean} | ${clean} | ${clean}, owner-accountable |`);
      expect(report).toContain(`Overall maturity (weakest dimension): **${clean}**.`);
      // An evidence path is printed as a path: each character kept or shown as its
      // code, the line break included, and the pipe escaped.
      const slash = String.fromCharCode(92);
      const shown = `${slash}u${code.toString(16).padStart(4, "0")}`;
      const tick = String.fromCharCode(96);
      expect(report).toContain(`| ${clean} | yes | ${tick}x${shown}[2J${slash}|y${slash}u000az${tick}<br>${tick}docs/policy.md${tick} |`);
      expect(report).toContain(`| ${clean} | ${clean} |`);
      expect(report).toContain(`| ${clean} | ${clean} | 0${clean} |`);
      // Each row is still one line of the table.
      expect(report.split("\n").filter((line) => line.includes("[2J")).every((line) => line.startsWith("| ") || line.startsWith("Overall"))).toBe(true);
      // The state is data for the next audit, so it keeps what it was given.
      expect(state.snapshots[0]?.timestamp).toBe(unread);
      expect(state.snapshots[1]?.totals).toEqual({ [unread]: asNumber });
    }
  });
});

// With one path given for the history and for the report, the command wrote the
// history, wrote the report over it, and exited 0. Issue 48.
describe("one file named for both the state and the report", () => {
  const ONE_FILE = "generate-report: --state and --out name one file; give each a file of its own";

  /** Runs the command on the three sample inputs, in a directory of its own, and removes it. */
  function withInputs(check: (directory: string, run: (...options: string[]) => { exit: number; stdout: string[]; stderr: string[] }) => void): void {
    const directory = mkdtempSync(join(tmpdir(), "one-file-"));
    try {
      const inputs = [["findings.json", findings], ["evidence.json", evidence], ["maturity.json", maturity]].map(([name, value]) => {
        const path = join(directory, name as string);
        writeFileSync(path, JSON.stringify(value));
        return path;
      });
      check(directory, (...options) => {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const exit = runCli(["bun", "cli", ...inputs, ...options], (text) => stdout.push(text), (text) => stderr.push(text), () => NOW);
        return { exit, stdout, stderr };
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  test("is refused before anything is written, whichever option comes first", () => {
    withInputs((directory, run) => {
      const one = join(directory, "audit");
      for (const options of [["--state", one, "--out", one], ["--out", one, "--state", one]]) {
        expect(run(...options)).toEqual({ exit: 2, stdout: [], stderr: [ONE_FILE] });
        expect(existsSync(one)).toBe(false);
      }
      expect(readdirSync(directory).sort()).toEqual(["evidence.json", "findings.json", "maturity.json"]);
    });
  });

  test("is refused before anything is read, so inputs that are not there are not what is reported", () => {
    const stderr: string[] = [];
    const missing = join(tmpdir(), "no-such-directory-for-this-test", "x.json");
    expect(runCli(["bun", "cli", missing, missing, missing, "--state", "s", "--out", "s"], () => {}, (text) => stderr.push(text), () => NOW)).toBe(2);
    expect(stderr).toEqual([ONE_FILE]);
  });

  test("two spellings of one file are one file", () => {
    withInputs((directory, run) => {
      const plain = join(directory, "audit.md");
      const spellings = [
        [plain, `${directory}/./audit.md`],
        [plain, `${directory}/other/../audit.md`],
        [plain, relative(process.cwd(), plain)],
        [`${directory}//audit.md`, plain],
        // Neither of these is there, nor is made: the names are compared as they resolve.
        ["no-such-audit-state", "./no-such-audit-state"],
        [resolve("no-such-audit-state"), "no-such-audit-state"],
        // A directory that is not there yet is spelled in two ways as well.
        [join(directory, "later", "audit.md"), `${directory}/later/./audit.md`],
      ];
      for (const [state, out] of spellings) {
        expect(run("--state", state as string, "--out", out as string), `${state} ${out}`).toEqual({ exit: 2, stdout: [], stderr: [ONE_FILE] });
      }
      expect(existsSync(plain)).toBe(false);
      // And so are two spellings of a file that is there already, which is left as it was.
      const kept = JSON.stringify({ snapshots: [] });
      writeFileSync(plain, kept);
      for (const [state, out] of spellings.slice(0, 4)) {
        expect(run("--state", state as string, "--out", out as string).exit, `${state} ${out}`).toBe(2);
      }
      expect(readFileSync(plain, "utf8")).toBe(kept);
    });
  });

  test("two cases of one name are one file on Windows, and two files elsewhere", () => {
    withInputs((directory, run) => {
      const result = run("--state", join(directory, "audit.json"), "--out", join(directory, "AUDIT.JSON"));
      if (process.platform === "win32") {
        expect(result).toEqual({ exit: 2, stdout: [], stderr: [ONE_FILE] });
        expect(existsSync(join(directory, "audit.json"))).toBe(false);
      } else {
        expect(result.stderr).toEqual([]);
      }
    });
  });

  test("a path through a link to its directory is the same file", () => {
    withInputs((directory, run) => {
      const real = join(directory, "real");
      mkdirSync(real);
      // A junction on Windows, which needs no right to make, and a symbolic link elsewhere.
      symlinkSync(real, join(directory, "linked"), "junction");
      // Neither file is there yet, and one directory holds both.
      expect(run("--state", join(real, "new.md"), "--out", join(directory, "linked", "new.md"))).toEqual({ exit: 2, stdout: [], stderr: [ONE_FILE] });
      expect(readdirSync(real)).toEqual([]);
      writeFileSync(join(real, "new.md"), "kept");
      expect(run("--state", join(directory, "linked", "new.md"), "--out", join(real, "new.md")).exit).toBe(2);
      expect(readFileSync(join(real, "new.md"), "utf8")).toBe("kept");
    });
  });

  // Where this account may make a symbolic link to a file. Where it may not, as on
  // Windows without the right to, this case is passed over.
  test("a path through a symbolic link to the file is the same file", () => {
    withInputs((directory, run) => {
      const target = join(directory, "audit.md");
      writeFileSync(target, "kept");
      try {
        symlinkSync(target, join(directory, "link.md"), "file");
      } catch {
        return;
      }
      expect(run("--state", join(directory, "link.md"), "--out", target)).toEqual({ exit: 2, stdout: [], stderr: [ONE_FILE] });
      expect(readFileSync(target, "utf8")).toBe("kept");
    });
  });

  test("two files are written as before", () => {
    withInputs((directory, run) => {
      const state = join(directory, "state.json");
      const out = join(directory, "report.md");
      expect(run("--state", state, "--out", out)).toEqual({ exit: 0, stdout: [], stderr: [] });
      expect(JSON.parse(readFileSync(state, "utf8")).snapshots).toHaveLength(1);
      expect(readFileSync(out, "utf8")).toStartWith("# ");
      // One of the two alone names no second file to be the same as.
      expect(run("--state", state).exit).toBe(0);
      expect(run("--out", out).exit).toBe(0);
      expect(JSON.parse(readFileSync(state, "utf8")).snapshots).toHaveLength(2);
    });
  });
});
