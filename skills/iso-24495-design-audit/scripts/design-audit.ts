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
import {
  connectToJev,
  type Ask,
  type JevRequest,
  type NoulQuestion,
  type Probabilities,
  type RecordModel,
} from "./jev.ts";

const EXIT_RAN = 0;
const EXIT_BAD_INPUT = 2;
const EXIT_SERVICE_FAILED = 3;
const EXIT_MISSING_KEY = 4;

const SECTION_START_LENGTH = 300;
/** How many files the preview names as the largest, and how many untitled files the report names. */
const FILES_NAMED = 5;
/** How many characters of a judged paragraph a finding quotes. */
const EXCERPT_LENGTH = 60;
const MARKDOWN = /\.(?:md|markdown)$/i;
// A line holding nothing but quote markers is a blank line inside a quote.
const BLANK_QUOTE_LINE = /^\s*>[\s>]*$/;
// A rule between blocks, inside any quote, carries no words for a reader.
const THEMATIC_BREAK = /^[\s>]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LEADING_NUMBER = /^\d+(?:\.\d+)*\.?\s+/;
// An emphasis run of up to three marks around the whole label, matched by the
// backreference, so a mark that belongs to the words is never removed.
// CommonMark reads a mark with a space just inside it as a literal character,
// so the wrapped text must start and end with something other than a space.
const WRAPPING_EMPHASIS = /^(\*{1,3}|_{1,3})(\S(?:.*\S)?)\1$/;
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
  /**
   * An answer at or beyond this, in the other direction, fails. Null where
   * no labelled real failure has been measured, so the rule has no fail band
   * and reports needs improvement at most.
   */
  failAt: number | null;
  /** True where a yes means a problem, so the cut-offs run the other way. */
  yesIsAProblem: boolean;
}

/**
 * The cut-offs for every question, kept here so they can be recalibrated in
 * one place. A borderline answer is not a pass, so the band between them is
 * reported. Each was set on 2026-09-28 against labels two model families
 * agreed on, blind to Jev, and is chosen from and measured on the same items.
 * The purpose, reader, colour_only and position_only figures come from the
 * requests this audit sends; message and one_idea come from an earlier sample.
 *
 * - message: pass band right on 14 of 14 headings, fail band on 10 of 10.
 * - purpose: pass band 11 of 11 openings, fail band 49 of 50.
 * - reader: pass band 11 of 11 openings, fail band 62 of 65.
 * - one_idea: pass band 13 of 13; the fail cut-off is provisional, because
 *   real documents held too few failures to calibrate it.
 * - colour_only and position_only: pass band 200 of 201 and 199 of 199
 *   blocks. No fail band: no labelled real colour failure exists, and one
 *   real position failure cannot set one.
 */
/**
 * The Jev model the cut-offs were calibrated on. The audit asks for
 * jev-latest, so the report names the models that answered and says when
 * one of them is not this one.
 */
export const CALIBRATED_MODEL = "jev-1.13.0";

export const CUTOFFS: Readonly<Record<string, Cutoffs>> = Object.freeze({
  message: { passAt: 0.6, failAt: 0.28, yesIsAProblem: false },
  purpose: { passAt: 0.95, failAt: 0.4, yesIsAProblem: false },
  reader: { passAt: 0.75, failAt: 0.25, yesIsAProblem: false },
  one_idea: { passAt: 0.9, failAt: 0.5, yesIsAProblem: false },
  colour_only: { passAt: 0.3, failAt: null, yesIsAProblem: true },
  position_only: { passAt: 0.3, failAt: null, yesIsAProblem: true },
});

// The wordings below are the ones measured, and changing one changes what
// the probabilities and the cut-offs mean. The reader question needs an
// explicit statement, as the IPLF Audience identifier pattern and the
// Massachusetts plain language review both ask. The purpose question holds
// the same explicit standard, because Jev scored product descriptions highly
// under a shorter wording.
const OPENING_QUESTIONS: Record<string, NoulQuestion> = {
  purpose: {
    instructions: [
      "Does `opening` state in words what the document is for: what the reader can do with it, or what it covers for them?",
      "These count: a sentence saying what the document explains or lets the reader do ('This guide explains how to install and configure the server', 'This document describes how to report a security vulnerability', 'This guide will help you get started with development'); a list of what the document covers, introduced as its contents.",
      "These do not count: a description of the product or project ('X is a fast library for Y', 'X is an open model for developers'), a greeting, badges or links, a notice about the product's status, or the title alone ('Security Policy', 'Contributing to X').",
    ],
    criteria: {
      true: "It states in words what the document is for.",
      false: "It does not state in words what the document is for.",
    },
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
  /** For a paragraph finding, the start of the text judged, safe to print. */
  excerpt?: string;
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
  /** Overview headings left unasked, because Part 5 lets them name their section. */
  exemptOverviews: number;
}

export interface Selection {
  documents: Array<{ file: string; plan: DocumentPlan }>;
  skipped: string[];
}

export interface AuditResult {
  files: Array<{ file: string; plan: DocumentPlan; findings: DesignFinding[] }>;
  skipped: string[];
  /** Every model that answered during the run, sorted. */
  models: string[];
}

export interface CliDependencies {
  env: Record<string, string | undefined>;
  /**
   * Builds the function that asks Jev, telling `recordModel` which model
   * answered. Tests pass a stand-in, so the suite never sends anything.
   */
  connect: (apiKey: string, recordModel: RecordModel) => Ask;
}

type ReadTextFile = (path: string, encoding: "utf8") => string;

/**
 * One rule a candidate is judged by. A failing answer states the problem; an
 * answer in the needs-improvement band is borderline, so its wording says the
 * problem may be there rather than asserting it. A rule with no fail band has
 * no failing wording. Each wording ends with a fixed action, never a rewrite
 * of the text, because Jev returns only a probability.
 */
interface Check {
  question: string;
  rule: string;
  detail?: string;
  unsure: string;
}

const OPENING_CHECKS: Check[] = [
  {
    question: "purpose",
    rule: "opening-purpose",
    detail: "The opening does not state the document's purpose: the reader's task and the document's scope. Add a sentence near the title that says what the reader can do with the document and what it covers.",
    unsure: "The opening may not state the document's purpose clearly: the reader's task and the document's scope. Check that a sentence near the title says what the reader can do with the document and what it covers.",
  },
  {
    question: "reader",
    rule: "opening-reader",
    detail: "The opening does not state in words who the document is for. Add a sentence near the title that names its readers.",
    unsure: "The opening may not state clearly in words who the document is for. Check that a sentence near the title names its readers.",
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
    unsure: "Something may be identified only by its colour. Check that a word, label or name also identifies it.",
  },
  {
    question: "position_only",
    rule: "position-only",
    unsure: "Something may be identified only by its position. Check that a name or label also identifies it.",
  },
];

const TITLE_RULE = "opening-title";
const HEADING_RULE = "heading-message";

/** The rule each question is reported under. */
const RULE_FOR_QUESTION: Readonly<Record<string, string>> = Object.fromEntries([
  ...OPENING_CHECKS.map((check) => [check.question, check.rule]),
  ["message", HEADING_RULE],
  ...PARAGRAPH_CHECKS.map((check) => [check.question, check.rule]),
]);

/** Every rule, in the order the report and the preview list them. */
const RULE_ORDER: readonly string[] = [TITLE_RULE, ...Object.values(RULE_FOR_QUESTION)];

/** The band an answer falls in, or null when it passes. */
function bandOf(question: string, probability: number): Band | null {
  const cutoffs = CUTOFFS[question] as Cutoffs;
  // Turned round where a yes means a problem, so larger is always better.
  const direction = cutoffs.yesIsAProblem ? -1 : 1;
  const answer = direction * probability;
  if (answer >= direction * cutoffs.passAt) return null;
  if (cutoffs.failAt !== null && answer <= direction * cutoffs.failAt) return "fails";
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
    label = (emphasis[2] as string).replace(LEADING_NUMBER, "");
  }
  return OVERVIEW_LABEL.test(label);
}

/**
 * Whether a character could change what a terminal or a table shows: the C0
 * and C1 control characters, delete, and the marks that reorder text.
 */
function isUnsafeToPrint(codePoint: number): boolean {
  return codePoint <= 0x1f
    || (codePoint >= 0x7f && codePoint <= 0x9f)
    || codePoint === 0x200e || codePoint === 0x200f
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2066 && codePoint <= 0x2069);
}

/** Text with every unsafe character turned into a space, and runs of space closed up. */
function safeToPrint(text: string): string {
  return Array.from(text, (character) =>
    isUnsafeToPrint(character.codePointAt(0) as number) ? " " : character)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The start of a judged paragraph, safe to print: unsafe characters become
 * spaces, and the cut falls between characters, never inside one.
 */
export function excerptOf(text: string): string {
  const cleaned = safeToPrint(text);
  const characters = Array.from(cleaned);
  if (characters.length <= EXCERPT_LENGTH) return cleaned;
  return `${characters.slice(0, EXCERPT_LENGTH).join("").trimEnd()}...`;
}

function judgeEach(line: number, checks: Check[], answers: Probabilities, excerpt?: string): DesignFinding[] {
  const findings: DesignFinding[] = [];
  for (const check of checks) {
    const probability = answers[check.question] as number;
    const band = bandOf(check.question, probability);
    if (band === null) continue;
    const detail = band === "fails" && check.detail !== undefined ? check.detail : check.unsure;
    const finding: DesignFinding = { line, rule: check.rule, band, detail, probability: probability.toFixed(2) };
    if (excerpt !== undefined) finding.excerpt = excerpt;
    findings.push(finding);
  }
  return findings;
}

/**
 * The visible text below a heading and above the next one, with code left out.
 * The parser records a setext heading, whose underline is the line after its
 * text, so the underline is skipped whatever quote or list holds it. The next
 * heading is passed in, so no heading is searched for again.
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

// Part 5 allows a topic name in two places, and Jev cannot tell them from one
// heading, so every heading finding asks the user to check them first.
const PART_5_HEADING_EXCEPTIONS =
  "Part 5 allows that for a reference section, or a name its document type requires, such as Context in a decision record. Otherwise, state the section's message or the reader's task instead.";

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
      rule: HEADING_RULE,
      detail: `The heading "${heading.text}" names a topic. ${PART_5_HEADING_EXCEPTIONS}`,
      unsure: `The heading "${heading.text}" may only name a topic. ${PART_5_HEADING_EXCEPTIONS}`,
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
    judge: (answers) => judgeEach(line, checks, answers, excerptOf(paragraph)),
  };
}

/**
 * Find what to ask about, without asking. The opening block is the level-1
 * title and everything before the next heading. Every heading below that level
 * is a candidate, and so is every paragraph.
 */
export function planDocument(text: string): DocumentPlan {
  const { candidates, findings, exemptOverviews } = planSections(readDocument(text), headings(text));

  // The fewest sentences the text can hold, so an ambiguous full stop cannot
  // turn a one-sentence paragraph into a question about one idea.
  for (const block of readerProseBlocks(text)) {
    const paragraph = block.lines.join(" ").replace(/\s+/g, " ").trim();
    candidates.push(paragraphCandidate(block.line, paragraph, mergedSentences(paragraph).length >= 2));
  }
  return { candidates, findings, exemptOverviews };
}

/**
 * The opening and heading candidates. The parser lists headings in document
 * order, so each heading's section ends at the next index, and every heading
 * is read a fixed number of times.
 */
export function planSections(document: Document, found: readonly Heading[]): DocumentPlan {
  const titleIndex = found.findIndex((heading) => heading.level === 1);
  const title = titleIndex === -1 ? undefined : found[titleIndex];
  const candidates: Candidate[] = [];
  const findings: DesignFinding[] = [];

  if (title === undefined) {
    findings.push({
      line: 1,
      rule: TITLE_RULE,
      band: "fails",
      detail: "The document has no level-1 title, so it has no opening block to state its purpose and reader. Add a level-1 title, then a sentence on the document's purpose and one naming its readers.",
      probability: "none, found by code",
    });
  } else {
    candidates.push(openingCandidate(title, sectionText(document, title, found[titleIndex + 1])));
  }

  const documentTitle = title === undefined ? "" : title.text;
  let exemptOverviews = 0;
  found.forEach((heading, index) => {
    if (heading.level < 2 || heading.text === "") return;
    if (isOverviewLabel(heading.text)) {
      exemptOverviews += 1;
      return;
    }
    candidates.push(headingCandidate(heading, documentTitle, sectionText(document, heading, found[index + 1])));
  });
  return { candidates, findings, exemptOverviews };
}

/** How many questions the plan asks under each rule. A rule with none is left out. */
export function questionsByRule(plan: DocumentPlan): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const candidate of plan.candidates) {
    for (const question of Object.keys(candidate.request.questions)) {
      const rule = RULE_FOR_QUESTION[question] as string;
      counts[rule] = (counts[rule] ?? 0) + 1;
    }
  }
  return counts;
}

function questionsByRuleAcross(plans: readonly DocumentPlan[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const plan of plans) {
    for (const [rule, count] of Object.entries(questionsByRule(plan))) {
      totals[rule] = (totals[rule] ?? 0) + count;
    }
  }
  return totals;
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

function fileLine(document: { file: string; plan: DocumentPlan }): string {
  const questions = countOf(questionCount(document.plan), "question");
  return `- ${document.file}: ${questions} in ${countOf(document.plan.candidates.length, "request")}`;
}

/** Up to five names, then how many more there are. */
function namedList(names: readonly string[]): string {
  const named = names.slice(0, FILES_NAMED).join(", ");
  const more = names.length - FILES_NAMED;
  return more > 0 ? `${named} and ${more} more` : named;
}

/**
 * What a run with --send would send. Printed when it was not given. It states
 * no money figure, because how TypeSafe bills for questions is unchecked.
 */
export function formatPlan(selection: Selection): string {
  const lines = [
    "Nothing was sent. With --send, this audit sends the text of these files to TypeSafe's Jev service:",
    ...selection.documents.map(fileLine),
  ];
  const total = selection.documents.reduce((sum, document) => sum + questionCount(document.plan), 0);
  const byRule = questionsByRuleAcross(selection.documents.map((document) => document.plan));
  lines.push(
    `Total: ${countOf(total, "question")} from ${countOf(selection.documents.length, "file")}.`,
    "Questions by rule:",
    ...RULE_ORDER.filter((rule) => rule !== TITLE_RULE).map((rule) => `- ${rule}: ${byRule[rule] ?? 0}`),
  );
  if (selection.documents.length > 1) {
    const largest = [...selection.documents]
      .sort((first, second) => questionCount(second.plan) - questionCount(first.plan)
        || (first.file < second.file ? -1 : 1))
      .slice(0, FILES_NAMED);
    lines.push("Largest files by question count:", ...largest.map(fileLine));
  }
  lines.push(
    "No cost is estimated, because how TypeSafe bills for questions has not been checked.",
    "How TypeSafe handles that text is set out in its privacy policy and its Data Processing Agreement:",
    `- ${PRIVACY_POLICY}`,
    `- ${DATA_PROCESSING_AGREEMENT}`,
    "TypeSafe offers zero data retention to enterprise customers.",
  );
  return lines.join("\n");
}

function findingText(finding: DesignFinding): string {
  return finding.excerpt === undefined ? finding.detail : `${finding.detail} Excerpt: "${finding.excerpt}"`;
}

/**
 * For each rule, how many candidates were checked and how many reported each
 * band. The title check runs on every file, by code rather than by Jev.
 */
function ruleTable(result: AuditResult, found: readonly DesignFinding[]): string[] {
  const checked = questionsByRuleAcross(result.files.map((file) => file.plan));
  checked[TITLE_RULE] = result.files.length;
  const inBand = (rule: string, band: Band): number =>
    found.filter((finding) => finding.rule === rule && finding.band === band).length;
  return [
    "| Rule | Checked | Fails | Needs improvement |",
    "|------|---------|-------|-------------------|",
    ...RULE_ORDER.map((rule) =>
      `| ${rule} | ${checked[rule] ?? 0} | ${inBand(rule, "fails")} | ${inBand(rule, "needs improvement")} |`),
  ];
}

/** What the audit left unasked, so a reader does not take silence for a pass. */
function notChecked(result: AuditResult): string[] {
  const exempt = result.files.reduce((sum, file) => sum + file.plan.exemptOverviews, 0);
  const untitled = result.files
    .filter((file) => file.plan.findings.some((finding) => finding.rule === TITLE_RULE))
    .map((file) => file.file);
  return [
    `Not checked: ${countOf(exempt, "overview heading")}, exempt because Part 5 lets that heading name its section.`,
    untitled.length === 0
      ? "Every document has a level-1 title, so every opening was judged."
      : `Not checked: the opening of ${countOf(untitled.length, "document")} with no level-1 title: ${namedList(untitled)}.`,
  ];
}

/** Which models answered, and a plain warning when one was not the calibrated model. */
function modelLines(models: readonly string[]): string[] {
  const calibrated = `The cut-offs were calibrated on ${CALIBRATED_MODEL}.`;
  if (models.length === 0) return [`Jev models that answered: none, because nothing was asked. ${calibrated}`];
  const named = models.map(safeToPrint);
  const lines = [`Jev models that answered: ${named.join(", ")}. ${calibrated}`];
  const others = named.filter((model) => model !== CALIBRATED_MODEL);
  if (others.length > 0) {
    lines.push(`The cut-offs were measured on ${CALIBRATED_MODEL} and may not fit answers from ${others.join(", ")}.`);
  }
  return lines;
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
      `| ${tableCell(file)} | ${finding.line} | ${finding.rule} | ${finding.band} | ${tableCell(findingText(finding))} | ${finding.probability} |`,
    );
  }
  const failing = found.filter(({ finding }) => finding.band === "fails").length;
  const questions = result.files.reduce((sum, file) => sum + questionCount(file.plan), 0);
  lines.push(
    "",
    `Finding count: ${found.length}. Fails: ${failing}. Needs improvement: ${found.length - failing}. Files read: ${result.files.length}. Questions asked: ${questions}. Skipped entries: ${result.skipped.length}.`,
    "",
    ...ruleTable(result, found.map(({ finding }) => finding)),
    "",
    ...notChecked(result),
    "",
    ...modelLines(result.models),
    "",
    "The audit never reports a pass, and zero findings is not proof of good design.",
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
  dependencies: CliDependencies = { env: process.env, connect: connectToJev },
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

  const models = new Set<string>();
  const ask = dependencies.connect(apiKey, (model) => {
    models.add(model);
  });
  try {
    const files = await Promise.all(selection.documents.map(async (document) => ({
      file: document.file,
      plan: document.plan,
      findings: await auditDocument(document.plan, ask),
    })));
    stdout(formatFindings({ files, skipped: selection.skipped, models: [...models].sort() }));
    return EXIT_RAN;
  } catch (error) {
    stderr(`design-audit: the audit is incomplete, so no findings are reported. ${(error as Error).message}`);
    return EXIT_SERVICE_FAILED;
  }
}
