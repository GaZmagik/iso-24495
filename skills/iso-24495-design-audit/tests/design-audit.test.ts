import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditDocument,
  CUTOFFS,
  formatFindings,
  formatPlan,
  isOverviewLabel,
  planDocument,
  questionCount,
  runCli,
  selectDocuments,
  type CliDependencies,
} from "../scripts/design-audit.ts";
import { JevServiceError, type Ask, type JevRequest, type Probabilities } from "../scripts/jev.ts";

const GUIDE = [
  "# Deploying the billing service",
  "",
  "This guide is for on-call engineers. It explains how to deploy the billing service.",
  "",
  "## Summary",
  "",
  "Deploy on weekdays only. Roll back if errors rise.",
  "",
  "## 1. Overview",
  "",
  "One line.",
  "",
  "## Background",
  "",
  "The service moved to a new cluster in May. Invoices are generated nightly.",
  "",
  "```sh",
  "deploy --all",
  "```",
  "",
  "Setext heading",
  "--------------",
  "",
  "Single sentence paragraph.",
  "",
].join("\n");

const HEADING_QUESTIONS = {
  message: {
    instructions:
      "Does `heading` state the section's message or the task the reader performs there, rather than only naming a topic?",
    criteria: { true: "It states a message or a task.", false: "It only names a topic." },
  },
};

const OPENING_QUESTIONS = {
  purpose: {
    instructions: "Does `opening` state the document's purpose, as the reader's task and the document's scope?",
    criteria: { true: "It states the purpose.", false: "It does not state the purpose." },
  },
  reader: {
    instructions: [
      "Does `opening` state in words who the document is for?",
      "These count: a sentence naming the reader ('This guide is for contributors', 'designed to help developers build with the API'); a condition addressing the reader ('If you need to report a security issue, use the contacts below', 'If you use an AI agent to contribute, read this section'); a list of the reader's situations ('Whether you are reporting bugs, improving docs or submitting code').",
      "These do not count: a greeting ('Thank you for your interest in contributing', 'We welcome contributions'), a description of the product, or the title alone ('Contributing to X', 'X contributor guide').",
    ],
    criteria: {
      true: "It states in words who the document is for.",
      false: "It does not state in words who the document is for.",
    },
  },
};

const PARAGRAPH_QUESTIONS = {
  one_idea: {
    instructions: "Does `paragraph` hold one idea, rather than running two unrelated topics together?",
    criteria: {
      true: "It develops one idea or topic.",
      false: "It runs two or more unrelated topics together.",
    },
  },
  colour_only: {
    instructions:
      "Does `paragraph` identify something only by its colour, with no word, label or name that also identifies it?",
    criteria: {
      true: "Something is identified only by colour.",
      false: "Nothing is identified only by colour.",
    },
  },
  position_only: {
    instructions:
      "Does `paragraph` identify something on a page or screen only by its position, such as 'the button on the right', with no name or label?",
    criteria: {
      true: "Something is identified only by position.",
      false: "Nothing is identified only by position.",
    },
  },
};

/**
 * A stand-in for Jev. Each question gets the probability chosen for its
 * identifier, or else one that raises no finding.
 */
function standIn(chosen: Probabilities, asked: JevRequest[] = []): Ask {
  return async (request) => {
    asked.push(request);
    return Object.fromEntries(Object.keys(request.questions).map((id) => [
      id,
      chosen[id] ?? (id.endsWith("_only") ? 0.01 : 0.99),
    ]));
  };
}

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writeOut: (text: string) => stdout.push(text),
    writeErr: (text: string) => stderr.push(text),
  };
}

function withProject(run: (project: string) => Promise<void> | void): Promise<void> {
  const project = mkdtempSync(join(tmpdir(), "iso-design-audit-"));
  return Promise.resolve()
    .then(() => run(project))
    .finally(() => rmSync(project, { recursive: true, force: true }));
}

describe("isOverviewLabel", () => {
  test("exempts Summary and Overview, with or without a leading number, in any case", () => {
    for (const text of ["Summary", "overview", "1. Summary", "2 OVERVIEW", "1.2. Overview"]) {
      expect(isOverviewLabel(text), text).toBe(true);
    }
    for (const text of ["Summary of changes", "Executive summary", "Overview:", "Background"]) {
      expect(isOverviewLabel(text), text).toBe(false);
    }
  });

  test("reads the plain text, so emphasis and code marks do not hide the label", () => {
    for (const text of [
      "**Summary**", "`Overview`", "_overview_", "*Summary*", "__Overview__",
      "1. **Summary**", "**1. Summary**", "2. `Overview`",
    ]) {
      expect(isOverviewLabel(text), text).toBe(true);
    }
    for (const text of ["**Summary of changes**", "`Overview` of the API", "**Summary**:"]) {
      expect(isOverviewLabel(text), text).toBe(false);
    }
  });

  test("strips only formatting that wraps the whole label, never a mark inside the words", () => {
    for (const text of ["**Summary**", "`Overview`", "1. Summary", "_Summary_"]) {
      expect(isOverviewLabel(text), text).toBe(true);
    }
    for (const text of ["`Summary_`", "Summary *", "Sum_mary", "*Summary", "**Summary*", "_Summary*"]) {
      expect(isOverviewLabel(text), text).toBe(false);
    }
  });

  // Review found valid formatting that the single-pair match missed: a triple
  // emphasis run, a double-backtick code span and emphasis nested in emphasis.
  // A code span holds literal text, so marks inside one are never unwrapped.
  test("unwraps nested emphasis and code spans of any length, but not marks inside code", () => {
    for (const text of [
      "***Summary***", "``Overview``", "**_Summary_**", "_**Overview**_", "``` Summary ```",
      "1. ***Summary***", "**1. _Summary_**",
    ]) {
      expect(isOverviewLabel(text), text).toBe(true);
    }
    for (const text of ["`**Summary**`", "``_Overview_``", "***Summary**", "**_Summary**_", "``Summary`"]) {
      expect(isOverviewLabel(text), text).toBe(false);
    }
  });
});

describe("planDocument", () => {
  test("asks about the opening block, each heading below the title, and each paragraph", () => {
    const plan = planDocument(GUIDE);

    expect(plan.findings).toEqual([]);
    expect(plan.candidates.map((candidate) => [candidate.line, candidate.request.state])).toEqual([
      [1, {
        opening:
          "# Deploying the billing service\n\nThis guide is for on-call engineers. It explains how to deploy the billing service.",
      }],
      [13, {
        document_title: "Deploying the billing service",
        heading: "Background",
        level: 2,
        section_start: "The service moved to a new cluster in May. Invoices are generated nightly.",
      }],
      [21, {
        document_title: "Deploying the billing service",
        heading: "Setext heading",
        level: 2,
        section_start: "Single sentence paragraph.",
      }],
      [3, { paragraph: "This guide is for on-call engineers. It explains how to deploy the billing service." }],
      [7, { paragraph: "Deploy on weekdays only. Roll back if errors rise." }],
      [11, { paragraph: "One line." }],
      [15, { paragraph: "The service moved to a new cluster in May. Invoices are generated nightly." }],
      [24, { paragraph: "Single sentence paragraph." }],
    ]);
    expect(questionCount(plan)).toBe(2 + 2 * 1 + 3 * 3 + 2 * 2);
  });

  test("asks every paragraph about colour and position, and only a longer one about one idea", async () => {
    const plan = planDocument(
      "# Controls\n\nPress the blue button.\n\nClick the button on the right.\n\nOne idea here. A second sentence.\n",
    );
    const paragraphs = plan.candidates.filter((candidate) => "paragraph" in candidate.request.state);
    expect(paragraphs.map((candidate) => [candidate.request.state.paragraph, candidate.request.questions]))
      .toEqual([
        ["Press the blue button.", {
          colour_only: PARAGRAPH_QUESTIONS.colour_only,
          position_only: PARAGRAPH_QUESTIONS.position_only,
        }],
        ["Click the button on the right.", {
          colour_only: PARAGRAPH_QUESTIONS.colour_only,
          position_only: PARAGRAPH_QUESTIONS.position_only,
        }],
        ["One idea here. A second sentence.", PARAGRAPH_QUESTIONS],
      ]);

    const findings = await auditDocument(plan, standIn({ one_idea: 0.1, colour_only: 0.73, position_only: 0.61 }));
    expect(findings.map((finding) => `${finding.line} ${finding.rule} ${finding.band} ${finding.probability}`))
      .toEqual([
        "3 colour-only fails 0.73",
        "3 position-only fails 0.61",
        "5 colour-only fails 0.73",
        "5 position-only fails 0.61",
        "7 one-idea fails 0.10",
        "7 colour-only fails 0.73",
        "7 position-only fails 0.61",
      ]);
  });

  test("uses the measured question wordings, and asks a heading only about its message", () => {
    const plan = planDocument(GUIDE);
    expect(plan.candidates[0]?.request.questions).toEqual(OPENING_QUESTIONS);
    expect(plan.candidates[1]?.request.questions).toEqual(HEADING_QUESTIONS);
    expect(plan.candidates[3]?.request.questions).toEqual(PARAGRAPH_QUESTIONS);
  });

  test("exempts a formatted overview label before asking", () => {
    const plan = planDocument(
      "# Title\n\n## **Summary**\n\nText.\n\n## `Overview`\n\nText.\n\n## 1. Summary\n\nText.\n\n## _Summary_\n\nText.\n\n## `Summary_`\n\nText.\n\n## Summary *\n\nText.\n\n## Steps\n\nText.\n",
    );
    expect(plan.candidates.flatMap((candidate) => {
      const heading = candidate.request.state.heading;
      return heading === undefined ? [] : [heading];
    })).toEqual(["`Summary_`", "Summary *", "Steps"]);
  });

  // Finding each setext underline by reading the document again once per
  // heading made planning quadratic: 4,000 headings took 50 seconds. One call
  // at N and one at 3N, each against a fixed budget, with no repeated samples
  // and no salt. The engine suite gave up ratio guards at 7dec2ae for budgets
  // like these, because a ratio of two short timings is noise on a busy machine.
  test("plans a document with thousands of headings in linear time", () => {
    const manyHeadings = (count: number): string => {
      const lines = ["# Reference", "", "This reference is for maintainers. It lists every setting.", ""];
      for (let index = 0; index < count; index += 1) {
        if (index % 2 === 0) {
          lines.push(`## Setting ${index}`);
        } else {
          lines.push(`Setting ${index}`, "-".repeat(12));
        }
        lines.push("", "Set this value before the service starts.", "");
      }
      return lines.join("\n");
    };
    const timed = (count: number): number => {
      const text = manyHeadings(count);
      const started = performance.now();
      planDocument(text);
      return performance.now() - started;
    };
    const atN = timed(1_000);
    const at3N = timed(3_000);
    expect(atN, `1,000 headings took ${Math.round(atN)} ms`).toBeLessThan(1_500);
    expect(at3N, `3,000 headings took ${Math.round(at3N)} ms`).toBeLessThan(4_500);
  }, 60_000);

  test("leaves a thematic break out of the section start, in a quote too", () => {
    const plan = planDocument([
      "# Doc", "",
      "## Dashes", "", "---", "", "Prose after dashes.", "",
      "## Stars", "", "***", "", "Prose after stars.", "",
      "## Spaced", "", "- - -", "", "Prose after spaced.", "",
      "## Quoted", "", "> ***", ">", "> Prose after the quoted rule.", "",
    ].join("\n"));
    expect(plan.candidates.flatMap((candidate) => {
      const { heading, section_start: start } = candidate.request.state;
      return heading === undefined ? [] : [[heading, start]];
    })).toEqual([
      ["Dashes", "Prose after dashes."],
      ["Stars", "Prose after stars."],
      ["Spaced", "Prose after spaced."],
      ["Quoted", "Prose after the quoted rule."],
    ]);
  });

  // An underline of equals signs is no thematic break, so only the parser
  // knowing the heading is setext keeps it out of the opening block.
  test("leaves an equals-sign underline out of the opening block, in a quote or a list too", () => {
    const underline = "=".repeat(60);
    const openings = [
      ["Plain title", underline, "", "This guide is for maintainers."],
      ["> Quoted title", `> ${underline}`, ">", "> This guide is for maintainers."],
      ["10. Listed title", `    ${underline}`, "", "    This guide is for maintainers."],
    ].map((lines) => planDocument(lines.join("\n")).candidates[0]?.request.state.opening);
    expect(openings).toEqual([
      "# Plain title\n\nThis guide is for maintainers.",
      "# Quoted title\n\nThis guide is for maintainers.",
      "# Listed title\n\nThis guide is for maintainers.",
    ]);
  });

  test("starts a section after the underline of a setext heading, in a quote or a list too", () => {
    const underline = "-".repeat(60);
    const plan = planDocument([
      "# Doc", "",
      "Plain heading", underline, "", "Prose after plain.", "",
      "> Quoted heading", `> ${underline}`, ">", "> Prose after quoted.", "",
      "10. Listed heading", `    ${underline}`, "", "    Prose after listed.", "",
    ].join("\n"));
    expect(plan.candidates.flatMap((candidate) => {
      const { heading, section_start: start } = candidate.request.state;
      return heading === undefined ? [] : [[heading, start]];
    })).toEqual([
      ["Plain heading", "Prose after plain."],
      ["Quoted heading", "Prose after quoted."],
      ["Listed heading", "Prose after listed."],
    ]);
  });

  test("gives a section start of at most 300 characters, with code left out", () => {
    const long = "word ".repeat(100).trim();
    const plan = planDocument(`# Title\n\n## Steps\n\n\`\`\`\nhidden code\n\`\`\`\n\n${long}\n`);
    const start = plan.candidates.find((candidate) => candidate.request.state.heading === "Steps")
      ?.request.state.section_start as string;
    expect(start).toHaveLength(300);
    expect(start.startsWith("word word")).toBe(true);
  });

  test("reports a missing level-1 title from code, and still asks about headings", () => {
    const plan = planDocument("Some text here. More text here.\n\n## Steps\n\nDo this.\n");

    expect(plan.findings).toEqual([{
      line: 1,
      rule: "opening-title",
      detail: "The document has no level-1 title, so it has no opening block to state its purpose and reader.",
      band: "fails",
      probability: "none, found by code",
    }]);
    expect(plan.candidates.map((candidate) => candidate.request.state)).toEqual([
      { document_title: "", heading: "Steps", level: 2, section_start: "Do this." },
      { paragraph: "Some text here. More text here." },
      { paragraph: "Do this." },
    ]);
  });
});

describe("auditDocument", () => {
  const DOCUMENT = "# Title\n\nFirst sentence here. Second sentence here.\n\n## Topic\n\nBody text.\n";

  async function rulesFor(chosen: Probabilities): Promise<string[]> {
    const findings = await auditDocument(planDocument(DOCUMENT), standIn(chosen));
    return findings.map((finding) => `${finding.line} ${finding.rule} ${finding.band} ${finding.probability}`);
  }

  test("keeps every cut-off in one table", () => {
    expect(CUTOFFS).toEqual({
      message: { passAt: 0.6, failAt: 0.28, yesIsAProblem: false },
      purpose: { passAt: 0.53, failAt: 0.35, yesIsAProblem: false },
      reader: { passAt: 0.75, failAt: 0.3, yesIsAProblem: false },
      one_idea: { passAt: 0.9, failAt: 0.5, yesIsAProblem: false },
      colour_only: { passAt: 0.3, failAt: 0.5, yesIsAProblem: true },
      position_only: { passAt: 0.3, failAt: 0.5, yesIsAProblem: true },
    });
  });

  test("reports each answer in its band, and says nothing of a pass", async () => {
    const cases: Array<[Probabilities, string[]]> = [
      [{ message: 0.6 }, []],
      [{ message: 0.59 }, ["5 heading-message needs improvement 0.59"]],
      [{ message: 0.29 }, ["5 heading-message needs improvement 0.29"]],
      [{ message: 0.28 }, ["5 heading-message fails 0.28"]],
      [{ purpose: 0.53 }, []],
      [{ purpose: 0.52 }, ["1 opening-purpose needs improvement 0.52"]],
      [{ purpose: 0.36 }, ["1 opening-purpose needs improvement 0.36"]],
      [{ purpose: 0.35 }, ["1 opening-purpose fails 0.35"]],
      [{ reader: 0.75 }, []],
      [{ reader: 0.74 }, ["1 opening-reader needs improvement 0.74"]],
      [{ reader: 0.31 }, ["1 opening-reader needs improvement 0.31"]],
      [{ reader: 0.3 }, ["1 opening-reader fails 0.30"]],
      [{ one_idea: 0.9 }, []],
      [{ one_idea: 0.89 }, ["3 one-idea needs improvement 0.89"]],
      [{ one_idea: 0.51 }, ["3 one-idea needs improvement 0.51"]],
      [{ one_idea: 0.5 }, ["3 one-idea fails 0.50"]],
      [{ colour_only: 0.3 }, []],
      [{ colour_only: 0.31 }, ["3 colour-only needs improvement 0.31", "7 colour-only needs improvement 0.31"]],
      [{ colour_only: 0.49 }, ["3 colour-only needs improvement 0.49", "7 colour-only needs improvement 0.49"]],
      [{ colour_only: 0.5 }, ["3 colour-only fails 0.50", "7 colour-only fails 0.50"]],
      [{ position_only: 0.3 }, []],
      [{ position_only: 0.31 }, ["3 position-only needs improvement 0.31", "7 position-only needs improvement 0.31"]],
      [{ position_only: 0.49 }, ["3 position-only needs improvement 0.49", "7 position-only needs improvement 0.49"]],
      [{ position_only: 0.5 }, ["3 position-only fails 0.50", "7 position-only fails 0.50"]],
    ];
    for (const [chosen, expected] of cases) {
      expect(await rulesFor(chosen), JSON.stringify(chosen)).toEqual(expected);
    }
  });

  test("names what the opening block lacks, one finding for each", async () => {
    expect(await rulesFor({ purpose: 0.1, reader: 0.5 })).toEqual([
      "1 opening-purpose fails 0.10",
      "1 opening-reader needs improvement 0.50",
    ]);
  });

  test("keeps the code finding and orders every finding by line", async () => {
    const plan = planDocument("Text one here. Text two here.\n\n## Topic\n\nBody.\n");
    const findings = await auditDocument(plan, standIn({ one_idea: 0.1, message: 0.1 }));
    expect(findings.map((finding) => `${finding.line} ${finding.rule}`))
      .toEqual(["1 opening-title", "1 one-idea", "3 heading-message"]);
    expect(findings[2]?.detail).toBe(
      "The heading \"Topic\" names a topic. State the section's message or the reader's task instead.",
    );
  });

  // A borderline answer still needs improvement, but the model is unsure, so the
  // finding must not state the problem as certain. A live run reported the FAQ
  // question "What platforms does uv support?" as naming a topic at 0.48.
  test("hedges a finding in the needs-improvement band, and states a failure plainly", async () => {
    const plan = planDocument("# Guide\n\n## Topic\n\nOne idea here. Another sentence.\n");
    const unsure = await auditDocument(plan, standIn({ message: 0.45, reader: 0.5, one_idea: 0.7, colour_only: 0.4, position_only: 0.4, purpose: 0.45 }));
    expect(unsure.map((finding) => `${finding.rule} ${finding.band}: ${finding.detail}`)).toEqual([
      "opening-purpose needs improvement: The opening may not state the document's purpose clearly: the reader's task and the document's scope.",
      "opening-reader needs improvement: The opening may not state clearly in words who the document is for.",
      "heading-message needs improvement: The heading \"Topic\" may only name a topic. State the section's message or the reader's task instead.",
      "one-idea needs improvement: The paragraph may run two unrelated topics together. Check that it holds one idea.",
      "colour-only needs improvement: Something may be identified only by its colour. Check that a word, label or name also identifies it.",
      "position-only needs improvement: Something may be identified only by its position. Check that a name or label also identifies it.",
    ]);
    const failing = await auditDocument(plan, standIn({ message: 0.1 }));
    expect(failing.find((finding) => finding.rule === "heading-message")?.detail).toBe(
      "The heading \"Topic\" names a topic. State the section's message or the reader's task instead.",
    );
  });
});

describe("selectDocuments", () => {
  test("reads Markdown files in a directory and skips links, other types and unreadable files", () =>
    withProject((project) => {
      const docs = join(project, "docs");
      mkdirSync(join(docs, "nested"), { recursive: true });
      writeFileSync(join(docs, "guide.md"), "# Guide\n");
      writeFileSync(join(docs, "nested", "notes.markdown"), "# Notes\n");
      writeFileSync(join(docs, "plain.txt"), "Not Markdown.\n");
      writeFileSync(join(docs, "locked.md"), "# Locked\n");
      const target = join(project, "elsewhere");
      mkdirSync(target);
      symlinkSync(target, join(docs, "link"), "junction");

      const unreadable = (path: string): string => {
        if (path.endsWith("locked.md")) throw new Error("permission denied");
        return "# Readable\n";
      };
      const selection = selectDocuments(docs, project, unreadable);

      expect(selection.documents.map((document) => document.file))
        .toEqual(["docs/guide.md", "docs/nested/notes.markdown"]);
      expect(selection.documents[0]?.plan.candidates).toHaveLength(1);
      expect(selection.skipped).toEqual([join(docs, "link"), join(docs, "locked.md")]);
    }));

  test("reads one selected Markdown file, and refuses any other type", () =>
    withProject((project) => {
      const file = join(project, "README.MARKDOWN");
      writeFileSync(file, "# Readme\n");
      expect(selectDocuments(file, project).documents.map((document) => document.file))
        .toEqual(["README.MARKDOWN"]);

      const text = join(project, "notes.txt");
      writeFileSync(text, "Plain.\n");
      expect(() => selectDocuments(text, project))
        .toThrow("Select a Markdown file ending in .md or .markdown");
    }));

  test("skips a selected symbolic link rather than following it", () =>
    withProject((project) => {
      const target = join(project, "real");
      mkdirSync(target);
      const link = join(project, "link");
      symlinkSync(target, link, "junction");
      expect(selectDocuments(link, project)).toEqual({ documents: [], skipped: [link] });
    }));
});

describe("formatFindings and formatPlan", () => {
  test("prints a table, the counts and the disclaimer", () => {
    const text = formatFindings({
      files: [{
        file: "docs/a|b.md",
        findings: [
          { line: 4, rule: "one-idea", band: "fails", detail: "Two\ntopics.", probability: "0.12" },
          { line: 9, rule: "colour-only", band: "needs improvement", detail: "Red.", probability: "0.40" },
        ],
      }],
      questions: 5,
      skipped: ["x"],
    });
    expect(text).toBe([
      "| File | Line | Rule | Band | Finding | Jev probability |",
      "|------|------|------|------|---------|-----------------|",
      "| docs/a\\|b.md | 4 | one-idea | fails | Two topics. | 0.12 |",
      "| docs/a\\|b.md | 9 | colour-only | needs improvement | Red. | 0.40 |",
      "",
      "Finding count: 2. Fails: 1. Needs improvement: 1. Files read: 1. Questions asked: 5. Skipped entries: 1.",
      "Mechanical and model findings are proxies, not an ISO judgement.",
      "These findings come from a model, Jev, and can be wrong.",
      "The cut-offs between the bands were calibrated on 2026-09-28 and are provisional.",
      "The user decides whether the text suits its readers and purpose.",
    ].join("\n"));
  });

  test("says what would be sent, and that nothing was", () => {
    const plan = planDocument(GUIDE);
    expect(formatPlan({ documents: [{ file: "guide.md", plan }], skipped: [] })).toBe([
      "Nothing was sent. With --send, this audit sends the text of these files to TypeSafe's Jev service:",
      "- guide.md: 17 questions in 8 requests",
      "Total: 17 questions from 1 file.",
      "How TypeSafe handles that text is set out in its privacy policy and its Data Processing Agreement:",
      "- https://typesafe.ai/legal/privacy-policy",
      "- https://typesafe.ai/legal/data-processing",
      "TypeSafe offers zero data retention to enterprise customers.",
    ].join("\n"));
  });
});

describe("runCli", () => {
  const DOCUMENT = "# Title\n\nFirst sentence here. Second sentence here.\n";

  function dependencies(ask: Ask, env: Record<string, string> = { TYPESAFE_API_KEY: "key" }) {
    const keys: string[] = [];
    const deps: CliDependencies = {
      env,
      connect: (apiKey) => {
        keys.push(apiKey);
        return ask;
      },
    };
    return { deps, keys };
  }

  test("rejects bad arguments with exit code 2", async () => {
    const { deps, keys } = dependencies(standIn({}));
    const cases: Array<[string[], string]> = [
      [[], "Usage: bun design-audit-cli.ts <file-or-directory> [--send] [--project-dir <directory>]"],
      [["a.md", "--json"], "design-audit: unknown option: --json"],
      [["a.md", "extra"], "design-audit: unexpected argument: extra"],
      [["a.md", "--send", "--send"], "design-audit: --send appears more than once"],
      [["a.md", "--project-dir"], "design-audit: --project-dir requires a directory"],
      [["a.md", "--project-dir", "--send"], "design-audit: --project-dir requires a directory"],
    ];
    for (const [args, message] of cases) {
      const output = capture();
      expect(await runCli(["bun", "design-audit-cli.ts", ...args], output.writeOut, output.writeErr, deps))
        .toBe(2);
      expect(output.stderr).toEqual([message]);
      expect(output.stdout).toEqual([]);
    }
    expect(keys).toEqual([]);
  });

  test("an unreadable or unsupported file exits 2", () =>
    withProject(async (project) => {
      const { deps } = dependencies(standIn({}));
      const missing = capture();
      expect(await runCli(["bun", "cli", join(project, "absent.md"), "--send"],
        missing.writeOut, missing.writeErr, deps)).toBe(2);
      expect(missing.stderr[0]).toStartWith("design-audit: ");

      const text = join(project, "notes.txt");
      writeFileSync(text, "Plain.\n");
      const refused = capture();
      expect(await runCli(["bun", "cli", text], refused.writeOut, refused.writeErr, deps)).toBe(2);
      expect(refused.stderr).toEqual([
        `design-audit: Select a Markdown file ending in .md or .markdown: ${text}`,
      ]);
    }));

  test("without --send it prints what it would send and sends nothing", () =>
    withProject(async (project) => {
      const file = join(project, "doc.md");
      writeFileSync(file, DOCUMENT);
      const { deps, keys } = dependencies(standIn({}), {});
      const output = capture();

      expect(await runCli(["bun", "cli", file, "--project-dir", project],
        output.writeOut, output.writeErr, deps)).toBe(0);
      expect(output.stdout.join("\n")).toContain("- doc.md: 5 questions in 2 requests");
      expect(output.stdout.join("\n")).toContain("Nothing was sent.");
      expect(keys).toEqual([]);
    }));

  test("without --send it sends nothing even when a key is set", () =>
    withProject(async (project) => {
      const file = join(project, "doc.md");
      writeFileSync(file, DOCUMENT);
      const asked: JevRequest[] = [];
      const { deps, keys } = dependencies(standIn({}, asked), { TYPESAFE_API_KEY: "key" });
      const output = capture();

      expect(await runCli(["bun", "cli", file], output.writeOut, output.writeErr, deps)).toBe(0);
      expect(output.stdout.join("\n")).toContain("Nothing was sent.");
      expect(keys).toEqual([]);
      expect(asked).toEqual([]);
    }));

  test("with --send and no key it stops with exit code 4 and says where to get one", () =>
    withProject(async (project) => {
      const file = join(project, "doc.md");
      writeFileSync(file, DOCUMENT);
      for (const env of [{}, { TYPESAFE_API_KEY: "  " }]) {
        const { deps, keys } = dependencies(standIn({}), env);
        const output = capture();
        expect(await runCli(["bun", "cli", file, "--send"], output.writeOut, output.writeErr, deps))
          .toBe(4);
        expect(output.stderr).toEqual([
          "design-audit: this audit requires Jev, the TypeSafe judgement model, and a TypeSafe API key. Set TYPESAFE_API_KEY to your key. Get one from https://docs.typesafe.ai",
        ]);
        expect(keys).toEqual([]);
      }
    }));

  // Bun and Node both quote a rejected header value in their error, so a key with
  // a line break inside it would be printed. The key is refused before anything
  // is sent, and the message never repeats it.
  test("with --send and a key holding a control character it stops with exit code 4 and never prints the key", () =>
    withProject(async (project) => {
      const file = join(project, "doc.md");
      writeFileSync(file, DOCUMENT);
      for (const key of ["SECRET-first\nsecond", "SECRET-a\tb", "SECRET-c\u0000d"]) {
        const { deps, keys } = dependencies(standIn({}), { TYPESAFE_API_KEY: key });
        const output = capture();
        expect(await runCli(["bun", "cli", file, "--send"], output.writeOut, output.writeErr, deps))
          .toBe(4);
        expect(output.stderr).toEqual([
          "design-audit: TYPESAFE_API_KEY contains a line break or another control character, so it was not sent. Set it again with the key alone.",
        ]);
        expect([...output.stdout, ...output.stderr].join("\n")).not.toContain("SECRET");
        expect(keys).toEqual([]);
      }
    }));

  test("with --send and a key it prints the findings and exits 0 whatever they are", () =>
    withProject(async (project) => {
      mkdirSync(join(project, "docs"));
      writeFileSync(join(project, "docs", "doc.md"), DOCUMENT);
      writeFileSync(join(project, "docs", "clean.md"), "# Clean\n");
      const target = join(project, "elsewhere");
      mkdirSync(target);
      symlinkSync(target, join(project, "docs", "link"), "junction");
      const asked: JevRequest[] = [];
      const { deps, keys } = dependencies(standIn({ reader: 0.1 }, asked));
      const output = capture();

      expect(await runCli(["bun", "cli", join(project, "docs"), "--send", "--project-dir", project],
        output.writeOut, output.writeErr, deps)).toBe(0);
      expect(keys).toEqual(["key"]);
      expect(asked).toHaveLength(3);
      expect(output.stderr).toEqual([`warning: skipped entry: ${join(project, "docs", "link")}`]);
      expect(output.stdout).toHaveLength(1);
      expect(output.stdout[0]).toContain(
        "| docs/clean.md | 1 | opening-reader | fails | The opening does not state in words who the document is for. | 0.10 |",
      );
      expect(output.stdout[0]).toContain(
        "Finding count: 2. Fails: 2. Needs improvement: 0. Files read: 2. Questions asked: 7. Skipped entries: 1.",
      );
    }));

  test("a service that fails after its retries exits 3 and prints no findings", () =>
    withProject(async (project) => {
      const file = join(project, "doc.md");
      writeFileSync(file, DOCUMENT);
      const failing: Ask = async () => {
        throw new JevServiceError("Jev did not answer after 6 attempts.");
      };
      const { deps } = dependencies(failing);
      const output = capture();

      expect(await runCli(["bun", "cli", file, "--send"], output.writeOut, output.writeErr, deps))
        .toBe(3);
      expect(output.stdout).toEqual([]);
      expect(output.stderr).toEqual([
        "design-audit: the audit is incomplete, so no findings are reported. Jev did not answer after 6 attempts.",
      ]);
    }));
});
