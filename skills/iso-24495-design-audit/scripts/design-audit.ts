// A document design audit that asks Jev the questions a rule engine cannot.
//
// The text audit measures words and sentences. The structure Part 5 asks for
// needs judgement: whether the opening states a purpose and names a reader,
// whether a heading states a message, and whether a paragraph holds one idea.
// Narrow yes-or-no questions to Jev were measured on 2026-09-28 and work, so
// code finds each candidate and Jev answers one question about it.
//
// Three questions were measured and left out. Jev flagged good link text on
// real documents, and the mechanical link-text rule already covers links.
// Alternative text has not been measured on real documents yet. Whether a
// heading names a reference section or a fixed section fell between 0.3 and
// 0.7 for 61% of 1,219 real headings, so Jev cannot tell from one heading,
// and a heading is judged by its message alone.

import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { listTextFiles } from "../../iso-24495-4/scripts/audit-corpus.ts";
import {
  headings,
  mergedSentences,
  readDocument,
  readerProseBlocks,
  type Document,
  type Heading,
} from "../../iso-24495-4/scripts/lib/parse.ts";
import { createAsk, type Ask, type JevRequest, type NoulQuestion, type Probabilities } from "./jev.ts";

const EXIT_RAN = 0;
const EXIT_BAD_INPUT = 2;
const EXIT_SERVICE_FAILED = 3;
const EXIT_MISSING_KEY = 4;

const SECTION_START_LENGTH = 300;
const MARKDOWN = /\.(?:md|markdown)$/i;
// A line holding nothing but quote markers is a blank line inside a quote.
const BLANK_QUOTE_LINE = /^\s*>[\s>]*$/;
// A rule between blocks, inside any quote, carries no words for a reader.
const THEMATIC_BREAK = /^[\s>]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LEADING_NUMBER = /^\d+(?:\.\d+)*\.?\s+/;
// An emphasis run of up to three marks around the whole label, matched by the
// backreference, so a mark that belongs to the words is never removed.
const WRAPPING_EMPHASIS = /^(\*{1,3}|_{1,3})(.+)\1$/;
// A code span of any number of backticks around the whole label. Its content is
// literal, so nothing inside it is unwrapped further.
const WRAPPING_CODE = /^(`+)(.+)\1$/;
const OVERVIEW_LABEL = /^(?:summary|overview)$/i;

const PRIVACY_POLICY = "https://typesafe.ai/legal/privacy-policy";
const DATA_PROCESSING_AGREEMENT = "https://typesafe.ai/legal/data-processing";

const MISSING_KEY =
  "design-audit: this audit requires Jev, the TypeSafe judgement model, and a TypeSafe API key. Set TYPESAFE_API_KEY to your key. Get one from https://docs.typesafe.ai";
const KEY_HAS_CONTROL_CHARACTER =
  "design-audit: TYPESAFE_API_KEY contains a line break or another control character, so it was not sent. Set it again with the key alone.";
// A key is sent in a header, where a control character is invalid, and a runtime
// quotes the invalid header value in its error. Such a key is refused unsent.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const USAGE =
  "Usage: bun design-audit-cli.ts <file-or-directory> [--send] [--project-dir <directory>]";

/** Where an answer passes, and where it fails. Between the two it needs improvement. */
export interface Cutoffs {
  /** An answer at or beyond this passes. */
  passAt: number;
  /** An answer at or beyond this, in the other direction, fails. */
  failAt: number;
  /** True where a yes means a problem, so the cut-offs run the other way. */
  yesIsAProblem: boolean;
}

/**
 * The cut-offs for every question, kept here so they can be recalibrated in
 * one place. Each was set on 2026-09-28 where blind labels on samples from
 * popular open-source documents agreed with Jev at least 95% of the time.
 * A borderline answer is not a pass, so the band between them is reported.
 *
 * The fail cut-offs for one_idea, colour_only and position_only are
 * provisional: real documents held too few failures to calibrate them.
 */
export const CUTOFFS: Readonly<Record<string, Cutoffs>> = Object.freeze({
  message: { passAt: 0.6, failAt: 0.28, yesIsAProblem: false },
  purpose: { passAt: 0.53, failAt: 0.35, yesIsAProblem: false },
  reader: { passAt: 0.75, failAt: 0.3, yesIsAProblem: false },
  one_idea: { passAt: 0.9, failAt: 0.5, yesIsAProblem: false },
  colour_only: { passAt: 0.3, failAt: 0.5, yesIsAProblem: true },
  position_only: { passAt: 0.3, failAt: 0.5, yesIsAProblem: true },
});

// The wordings below are the ones measured, and changing one changes what
// the probabilities and the cut-offs mean. The reader question needs an
// explicit statement, as the IPLF Audience identifier pattern and the
// Massachusetts plain language review both ask. It scored 36 of 37 on
// held-out openings.
const OPENING_QUESTIONS: Record<string, NoulQuestion> = {
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

const HEADING_QUESTIONS: Record<string, NoulQuestion> = {
  message: {
    instructions:
      "Does `heading` state the section's message or the task the reader performs there, rather than only naming a topic?",
    criteria: { true: "It states a message or a task.", false: "It only names a topic." },
  },
};

const PARAGRAPH_QUESTIONS: Record<string, NoulQuestion> = {
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

/** A pass is never reported, so a finding is in one of these two bands. */
export type Band = "fails" | "needs improvement";

export interface DesignFinding {
  line: number;
  rule: string;
  band: Band;
  detail: string;
  /** What Jev answered, or a note that code found it. */
  probability: string;
}

/** One request to Jev, and how to turn its answers into findings. */
export interface Candidate {
  line: number;
  request: JevRequest;
  judge: (answers: Probabilities) => DesignFinding[];
}

export interface DocumentPlan {
  candidates: Candidate[];
  /** Findings that code makes without asking Jev. */
  findings: DesignFinding[];
}

export interface Selection {
  documents: Array<{ file: string; plan: DocumentPlan }>;
  skipped: string[];
}

export interface AuditResult {
  files: Array<{ file: string; findings: DesignFinding[] }>;
  questions: number;
  skipped: string[];
}

export interface CliDependencies {
  env: Record<string, string | undefined>;
  /** Builds the function that asks Jev. Tests pass a stand-in, so the suite never sends anything. */
  connect: (apiKey: string) => Ask;
}

type ReadTextFile = (path: string, encoding: "utf8") => string;

/**
 * One rule a candidate is judged by. A failing answer states the problem; an
 * answer in the needs-improvement band is borderline, so its wording says the
 * problem may be there rather than asserting it.
 */
interface Check {
  question: string;
  rule: string;
  detail: string;
  unsure: string;
}

const OPENING_CHECKS: Check[] = [
  {
    question: "purpose",
    rule: "opening-purpose",
    detail: "The opening does not state the document's purpose: the reader's task and the document's scope.",
    unsure: "The opening may not state the document's purpose clearly: the reader's task and the document's scope.",
  },
  {
    question: "reader",
    rule: "opening-reader",
    detail: "The opening does not state in words who the document is for.",
    unsure: "The opening may not state clearly in words who the document is for.",
  },
];

const PARAGRAPH_CHECKS: Check[] = [
  {
    question: "one_idea",
    rule: "one-idea",
    detail: "The paragraph runs two or more unrelated topics together. Give each idea its own paragraph.",
    unsure: "The paragraph may run two unrelated topics together. Check that it holds one idea.",
  },
  {
    question: "colour_only",
    rule: "colour-only",
    detail: "Something is identified only by its colour. Add a word, label or name that also identifies it.",
    unsure: "Something may be identified only by its colour. Check that a word, label or name also identifies it.",
  },
  {
    question: "position_only",
    rule: "position-only",
    detail: "Something is identified only by its position. Add the name or label a reader can find it by.",
    unsure: "Something may be identified only by its position. Check that a name or label also identifies it.",
  },
];

/** The band an answer falls in, or null when it passes. */
function bandOf(question: string, probability: number): Band | null {
  const cutoffs = CUTOFFS[question] as Cutoffs;
  // Turned round where a yes means a problem, so larger is always better.
  const direction = cutoffs.yesIsAProblem ? -1 : 1;
  const answer = direction * probability;
  if (answer >= direction * cutoffs.passAt) return null;
  if (answer <= direction * cutoffs.failAt) return "fails";
  return "needs improvement";
}

/**
 * Part 5 rule 8 lets one overview heading name its section, so "Summary" and
 * "Overview" are exempt before Jev is asked. A leading number such as "1."
 * is ignored, and so is formatting wrapping the whole label, one layer at a
 * time: emphasis runs, nested in any order, and a code span, whose literal
 * content ends the unwrapping. A mark inside the words is not formatting, so
 * "Sum_mary" is asked about. The measurement spike flagged "Summary" three
 * times without this.
 */
export function isOverviewLabel(text: string): boolean {
  let label = text.trim().replace(LEADING_NUMBER, "");
  for (;;) {
    const code = WRAPPING_CODE.exec(label);
    if (code !== null) {
      label = (code[2] as string).trim();
      break;
    }
    const emphasis = WRAPPING_EMPHASIS.exec(label);
    if (emphasis === null) break;
    label = (emphasis[2] as string).trim().replace(LEADING_NUMBER, "");
  }
  return OVERVIEW_LABEL.test(label);
}

function judgeEach(line: number, checks: Check[], answers: Probabilities): DesignFinding[] {
  const findings: DesignFinding[] = [];
  for (const check of checks) {
    const probability = answers[check.question] as number;
    const band = bandOf(check.question, probability);
    if (band === null) continue;
    const detail = band === "fails" ? check.detail : check.unsure;
    findings.push({ line, rule: check.rule, band, detail, probability: probability.toFixed(2) });
  }
  return findings;
}

/**
 * The visible text below a heading and above the next one, with code left out.
 * The parser records a setext heading, whose underline is the line after its
 * text, so the underline is skipped whatever quote or list holds it. The next
 * heading is passed in, so planning stays linear in the number of headings.
 */
function sectionText(document: Document, heading: Heading, next: Heading | undefined): string {
  const afterText = heading.line - 1 + heading.lines;
  const from = heading.setext ? afterText + 1 : afterText;
  const to = next === undefined ? document.lines.length : next.line - 1;
  return document.lines
    .slice(from, to)
    .filter((line, offset) => !document.hidden(from + offset)
      && !BLANK_QUOTE_LINE.test(line) && !THEMATIC_BREAK.test(line))
    .join("\n")
    .trim();
}

function openingCandidate(title: Heading, body: string): Candidate {
  return {
    line: title.line,
    request: { state: { opening: `# ${title.text}\n\n${body}`.trim() }, questions: OPENING_QUESTIONS },
    judge: (answers) => judgeEach(title.line, OPENING_CHECKS, answers),
  };
}

function headingCandidate(heading: Heading, documentTitle: string, body: string): Candidate {
  return {
    line: heading.line,
    request: {
      state: {
        document_title: documentTitle,
        heading: heading.text,
        level: heading.level,
        section_start: body.replace(/\s+/g, " ").slice(0, SECTION_START_LENGTH),
      },
      questions: HEADING_QUESTIONS,
    },
    judge: (answers) => judgeEach(heading.line, [{
      question: "message",
      rule: "heading-message",
      detail: `The heading "${heading.text}" names a topic. State the section's message or the reader's task instead.`,
      unsure: `The heading "${heading.text}" may only name a topic. State the section's message or the reader's task instead.`,
    }], answers),
  };
}

/**
 * Colour and position can mislead in a paragraph of any length. Whether a
 * paragraph holds one idea is only asked of two sentences or more.
 */
function paragraphCandidate(line: number, paragraph: string, severalSentences: boolean): Candidate {
  const checks = severalSentences
    ? PARAGRAPH_CHECKS
    : PARAGRAPH_CHECKS.filter((check) => check.question !== "one_idea");
  const questions = Object.fromEntries(
    checks.map((check) => [check.question, PARAGRAPH_QUESTIONS[check.question] as NoulQuestion]),
  );
  return {
    line,
    request: { state: { paragraph }, questions },
    judge: (answers) => judgeEach(line, checks, answers),
  };
}

/**
 * Find what to ask about, without asking. The opening block is the level-1
 * title and everything before the next heading. Every heading below that level
 * is a candidate, and so is every paragraph.
 */
export function planDocument(text: string): DocumentPlan {
  const document = readDocument(text);
  const found = headings(text);
  // The parser lists headings in document order, so the next one is at the next index.
  const titleIndex = found.findIndex((heading) => heading.level === 1);
  const title = titleIndex === -1 ? undefined : found[titleIndex];
  const candidates: Candidate[] = [];
  const findings: DesignFinding[] = [];

  if (title === undefined) {
    findings.push({
      line: 1,
      rule: "opening-title",
      band: "fails",
      detail: "The document has no level-1 title, so it has no opening block to state its purpose and reader.",
      probability: "none, found by code",
    });
  } else {
    candidates.push(openingCandidate(title, sectionText(document, title, found[titleIndex + 1])));
  }

  const documentTitle = title === undefined ? "" : title.text;
  found.forEach((heading, index) => {
    if (heading.level < 2 || heading.text === "" || isOverviewLabel(heading.text)) return;
    candidates.push(headingCandidate(heading, documentTitle, sectionText(document, heading, found[index + 1])));
  });

  // The fewest sentences the text can hold, so an ambiguous full stop cannot
  // turn a one-sentence paragraph into a question about one idea.
  for (const block of readerProseBlocks(text)) {
    const paragraph = block.lines.join(" ").replace(/\s+/g, " ").trim();
    candidates.push(paragraphCandidate(block.line, paragraph, mergedSentences(paragraph).length >= 2));
  }
  return { candidates, findings };
}

export function questionCount(plan: DocumentPlan): number {
  return plan.candidates.reduce(
    (total, candidate) => total + Object.keys(candidate.request.questions).length,
    0,
  );
}

/** Ask Jev about every candidate, and return the findings in line order. */
export async function auditDocument(plan: DocumentPlan, ask: Ask): Promise<DesignFinding[]> {
  const judged = await Promise.all(
    plan.candidates.map(async (candidate) => candidate.judge(await ask(candidate.request))),
  );
  return [...plan.findings, ...judged.flat()].sort((first, second) => first.line - second.line);
}

function displayPath(path: string, projectDir: string): string {
  return relative(projectDir, path).replaceAll("\\", "/");
}

/**
 * Read the selected Markdown file, or every Markdown file in the selected
 * directory. Links are skipped rather than followed, as the text audit does.
 * A file that cannot be read inside a directory is skipped and reported. A
 * selected file that cannot be read throws.
 */
export function selectDocuments(
  target: string,
  projectDir: string,
  readText: ReadTextFile = readFileSync,
): Selection {
  const absoluteTarget = resolve(target);
  const absoluteProject = resolve(projectDir);
  const targetStat = lstatSync(absoluteTarget);
  if (targetStat.isSymbolicLink()) return { documents: [], skipped: [absoluteTarget] };

  const skipped: string[] = [];
  const documents: Selection["documents"] = [];
  if (!targetStat.isDirectory()) {
    if (!MARKDOWN.test(absoluteTarget)) {
      throw new Error(`Select a Markdown file ending in .md or .markdown: ${target}`);
    }
    const plan = planDocument(readText(absoluteTarget, "utf8"));
    return { documents: [{ file: displayPath(absoluteTarget, absoluteProject), plan }], skipped };
  }

  const paths = listTextFiles(absoluteTarget, (path) => skipped.push(path))
    .filter((path) => MARKDOWN.test(path));
  for (const path of paths) {
    let text: string;
    try {
      text = readText(path, "utf8");
    } catch {
      skipped.push(path);
      continue;
    }
    documents.push({ file: displayPath(path, absoluteProject), plan: planDocument(text) });
  }
  return { documents, skipped };
}

function tableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What a run with --send would send. Printed when it was not given. */
export function formatPlan(selection: Selection): string {
  const lines = [
    "Nothing was sent. With --send, this audit sends the text of these files to TypeSafe's Jev service:",
  ];
  let total = 0;
  for (const document of selection.documents) {
    const questions = questionCount(document.plan);
    total += questions;
    lines.push(
      `- ${document.file}: ${countOf(questions, "question")} in ${countOf(document.plan.candidates.length, "request")}`,
    );
  }
  lines.push(
    `Total: ${countOf(total, "question")} from ${countOf(selection.documents.length, "file")}.`,
    "How TypeSafe handles that text is set out in its privacy policy and its Data Processing Agreement:",
    `- ${PRIVACY_POLICY}`,
    `- ${DATA_PROCESSING_AGREEMENT}`,
    "TypeSafe offers zero data retention to enterprise customers.",
  );
  return lines.join("\n");
}

export function formatFindings(result: AuditResult): string {
  const lines = [
    "| File | Line | Rule | Band | Finding | Jev probability |",
    "|------|------|------|------|---------|-----------------|",
  ];
  const found = result.files.flatMap(({ file, findings }) =>
    findings.map((finding) => ({ file, finding })));
  for (const { file, finding } of found) {
    lines.push(
      `| ${tableCell(file)} | ${finding.line} | ${finding.rule} | ${finding.band} | ${tableCell(finding.detail)} | ${finding.probability} |`,
    );
  }
  const failing = found.filter(({ finding }) => finding.band === "fails").length;
  lines.push(
    "",
    `Finding count: ${found.length}. Fails: ${failing}. Needs improvement: ${found.length - failing}. Files read: ${result.files.length}. Questions asked: ${result.questions}. Skipped entries: ${result.skipped.length}.`,
    "Mechanical and model findings are proxies, not an ISO judgement.",
    "These findings come from a model, Jev, and can be wrong.",
    "The cut-offs between the bands were calibrated on 2026-09-28 and are provisional.",
    "The user decides whether the text suits its readers and purpose.",
  );
  return lines.join("\n");
}

interface Arguments {
  target: string;
  send: boolean;
  projectDir: string;
}

function readArguments(argv: string[]): Arguments | { problem: string } {
  const target = argv[2];
  if (!target) return { problem: USAGE };
  const parsed: Arguments = { target, send: false, projectDir: process.cwd() };
  const seen = new Set<string>();
  for (let index = 3; index < argv.length; index += 1) {
    const option = argv[index] as string;
    if (option !== "--send" && option !== "--project-dir") {
      const kind = option.startsWith("--") ? "unknown option" : "unexpected argument";
      return { problem: `design-audit: ${kind}: ${option}` };
    }
    if (seen.has(option)) return { problem: `design-audit: ${option} appears more than once` };
    seen.add(option);
    if (option === "--send") {
      parsed.send = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      return { problem: "design-audit: --project-dir requires a directory" };
    }
    parsed.projectDir = value;
    index += 1;
  }
  return parsed;
}

/**
 * Run the design audit from the command line.
 *
 * Nothing leaves the machine without --send. Without it, the audit prints
 * which files it would send and how many questions it would ask, then exits.
 *
 * Exit codes:
 *   0  the audit ran, or printed what it would send. Findings are advice and
 *      never change the exit code.
 *   2  bad arguments, or a selected file that cannot be read or is not Markdown.
 *   3  Jev failed after its retries. No findings are printed, because an
 *      incomplete audit must never read as a clean one.
 *   4  --send was given without a usable key in TYPESAFE_API_KEY: none, or one
 *      holding a control character, which is refused unsent and unprinted.
 */
export async function runCli(
  argv: string[],
  stdout: (text: string) => void,
  stderr: (text: string) => void,
  dependencies: CliDependencies = { env: process.env, connect: createAsk },
): Promise<number> {
  const parsed = readArguments(argv);
  if ("problem" in parsed) {
    stderr(parsed.problem);
    return EXIT_BAD_INPUT;
  }

  let selection: Selection;
  try {
    selection = selectDocuments(parsed.target, parsed.projectDir);
  } catch (error) {
    stderr(`design-audit: ${(error as Error).message}`);
    return EXIT_BAD_INPUT;
  }
  for (const path of selection.skipped) {
    stderr(`warning: skipped entry: ${path}`);
  }

  if (!parsed.send) {
    stdout(formatPlan(selection));
    return EXIT_RAN;
  }
  const apiKey = (dependencies.env.TYPESAFE_API_KEY ?? "").trim();
  if (apiKey === "") {
    stderr(MISSING_KEY);
    return EXIT_MISSING_KEY;
  }
  if (CONTROL_CHARACTER.test(apiKey)) {
    stderr(KEY_HAS_CONTROL_CHARACTER);
    return EXIT_MISSING_KEY;
  }

  const ask = dependencies.connect(apiKey);
  try {
    const files = await Promise.all(selection.documents.map(async (document) => ({
      file: document.file,
      findings: await auditDocument(document.plan, ask),
    })));
    const questions = selection.documents
      .reduce((total, document) => total + questionCount(document.plan), 0);
    stdout(formatFindings({ files, questions, skipped: selection.skipped }));
    return EXIT_RAN;
  } catch (error) {
    stderr(`design-audit: the audit is incomplete, so no findings are reported. ${(error as Error).message}`);
    return EXIT_SERVICE_FAILED;
  }
}
