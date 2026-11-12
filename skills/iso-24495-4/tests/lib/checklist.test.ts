import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli as runDesignCli } from "../../../iso-24495-design-audit/scripts/design-audit.ts";
import { runCli as runTextCli } from "../../../iso-24495-text-audit/scripts/audit-text.ts";
import { auditText } from "../../scripts/audit-corpus.ts";
import { CHECKLIST, type Clause, type ClauseState, type Need } from "../../scripts/lib/checklist.ts";
import type { AuditDependencies } from "../../scripts/lib/jev/audit.ts";
import { calibrationEvidence, MODEL, type RequestKind } from "../../scripts/lib/jev/catalogue.ts";
import { parseDecimal } from "../../scripts/lib/jev/decimal.ts";
import { classify, planDocument, type ExactAnswers } from "../../scripts/lib/jev/engine.ts";

const MODULE_PATH = join(import.meta.dir, "..", "..", "scripts", "lib", "checklist.ts");
const SKILL_PATH = join(import.meta.dir, "..", "..", "..", "iso-24495-5", "SKILL.md");
const CHECKLIST_HEADING = "## Pre-Output Self-Audit Checklist";

/** Every clause of the registry, in order. */
const CLAUSES: readonly Clause[] = CHECKLIST.flatMap(entry => entry.clauses);

/**
 * How many clauses each item holds, items 1 to 25 in order. A clause added,
 * removed or merged changes this, so the change has to be made here as well.
 */
const CLAUSES_PER_ITEM = [1, 3, 2, 1, 2, 3, 1, 4, 3, 3, 1, 3, 2, 2, 6, 3, 2, 2, 4, 3, 3, 6, 2, 1, 1];

/** How many clauses are in each state today. Moving a clause from one state to another changes this. */
const STATE_TALLY: Readonly<Record<ClauseState, number>> = {
  "fault": 15,
  "pass-only": 1,
  "not-read": 33,
  "needs-two-versions": 14,
  "not-checkable": 1,
};

/** The limits 15c and 15d share, because one Jev gate reads both. */
const PURPOSE_LIMITS = [
  "A fail says the opening does not name both the task and the scope. On its own it does not say which is missing, so it does not say whether 15c or 15d failed. A diagnosis of neither says both are missing.",
  "It can fail an opening or stay unsure, and never passes one.",
];

/**
 * Every clause as the registry must hold it, written out in full and in
 * order. It is not read from the registry, so a change to a clause has to be
 * made in both places on purpose, and a change made in one alone fails.
 */
const EXPECTED_CLAUSES: readonly Clause[] = [
  {
    id: "1a", demand: "The document has 3 or fewer heading levels below its title.", state: "fault",
    checks: [{ rule: "heading-depth", kind: "offline" }], needs: [],
    limits: ["It reports a heading deeper than level 4. It counts the absolute level, not the levels below the title, so it is exact only where the title is a level-1 heading. Under a level-2 title, a heading 3 levels below it is reported."],
  },
  { id: "2a", demand: "Each heading states its section's message, or is a name its genre expects.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "2b", demand: "No heading uses wordplay.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "2c", demand: "No heading uses a term the document has not yet explained.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "3a", demand: "A document with 6 or more sections carries a table of contents.", state: "fault",
    checks: [{ rule: "contents-list", kind: "offline" }], needs: ["markdown"],
    limits: [
      "It reads only a document with 6 or more level-2 headings outside any list or quotation, and counts those headings as its sections.",
      "Under a heading worded Contents, Table of contents, TOC or Key sections, one list item or table row satisfies it, even one that is not a link. A paragraph there satisfies it only when it holds nothing but links, white space, commas, semicolons, vertical bars or slashes, and one of its links points to a fragment. A paragraph of prose does not, even one that names a section or links to one.",
      "So do two or more links to fragments in the opening, even when neither reaches a heading, if they sit in one list, in the body rows of one table, or in one paragraph of that kind. Two such links in a sentence of prose, or in two separate paragraphs, do not. It does not check that every section is listed.",
    ],
  },
  {
    id: "3b", demand: "The table of contents is worded identically to the headings.", state: "fault",
    checks: [{ rule: "contents-list", kind: "offline" }], needs: ["markdown"],
    limits: [
      "It compares only links that reach a level-2 section by fragment. Such a link is compared under a contents heading, or among two or more links to fragments in one list, table or paragraph of the opening. In a paragraph, in either place, it is compared only when the paragraph holds nothing but links, white space, commas, semicolons, vertical bars or slashes. An entry that is not a link, or a link that reaches no level-2 section, is not compared.",
      "It reads only a document with 6 or more level-2 headings outside any list or quotation.",
    ],
  },
  { id: "4a", demand: "Headings are numbered only where a reader must cite one by its identifier.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "5a", demand: "Each chunk carries one idea.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "5b", demand: "Each chunk is separated from the next by a blank line.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "6a", demand: "Sequences are in ordered lists, except a legal document's clause identifiers.", state: "fault",
    checks: [{ rule: "prose-enumeration", kind: "offline" }], needs: [],
    limits: [
      "It reports a prose block holding rank 1 and at least 3 ranks, written as ordinal words such as `first` or as the numbers 1 to 6 in forms such as `1.` or `(1)`. A sequence written any other way is not read, nor is one written as separate bullets.",
      "It has no exemption for a legal document's clause identifiers.",
    ],
  },
  { id: "6b", demand: "Sets are in bulleted lists.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "6c", demand: "Forks are in a decision table or labelled conditions.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "7a", demand: "A table is tested at a named target width, or labelled records are used because no width is named.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "8a", demand: "Each bulleted item is one paragraph.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "8b", demand: "Each bulleted item holds one idea.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "8c", demand: "Bulleted items are nested no deeper than 2 levels.", state: "fault",
    checks: [{ rule: "bullet-depth", kind: "offline" }], needs: ["markdown"],
    limits: ["It counts the unordered list items an item sits in, itself included, and reports a depth above 2. It counts across a quotation but not an ordered list, so a bullet beneath an ordered item beneath a bullet has depth 2 and passes."],
  },
  { id: "8d", demand: "Longer material is promoted to a subsection.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "9a", demand: "Each callout changes what the reader does.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "9b", demand: "Adjacent callouts are merged.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "9c", demand: "Each callout is named in a word.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "10a", demand: "Each device carries one meaning.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "10b", demand: "No two devices carry the same meaning.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "10c", demand: "No meaning rides on a device alone.", state: "pass-only",
    checks: [{ rule: "colour_only:pass", kind: "jev" }], needs: ["markdown", "jev-route", "send"],
    limits: [
      "It reads colour only. Position, shape and every other device are not read.",
      "It can pass a block or stay unsure, and never reports a fault. A pass appears only in the counts.",
    ],
  },
  { id: "11a", demand: "A text alternative is present only beside a picture or diagram, or beside a table whose headers miss values or whose order breaks the comparison.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "12a", demand: "Link text names its destination.", state: "fault",
    checks: [{ rule: "link-text", kind: "offline" }], needs: [],
    limits: [
      "It reports empty link text, a bare web address, and a fixed list of vague labels such as `click here`. Any other text is taken to name its destination, even when it names the wrong one.",
      "A Markdown link whose destination or title runs onto a later line is not read, though it still renders as a link. A link whose text alone runs over a line is read.",
    ],
  },
  {
    id: "12b", demand: "A meaningful image says what it shows.", state: "fault",
    checks: [{ rule: "image-alt", kind: "offline" }], needs: [],
    limits: [
      "It reports a Markdown image with empty alternative text and an HTML image with no alt attribute. An HTML image with an empty alt attribute, or a Markdown image written inline with the title decorative, is taken as decorative and is not reported, even when it is meaningful.",
      "It cannot tell whether the text it finds says what the image shows. Any alternative text passes.",
      "A Markdown image whose destination runs onto a later line is not read, though it still renders as an image, so an image written that way with empty alternative text is not reported.",
    ],
  },
  {
    id: "12c", demand: "A decorative image is marked as decorative.", state: "fault",
    checks: [{ rule: "image-alt", kind: "offline" }], needs: [],
    limits: [
      "It reports a Markdown image with empty alternative text, unless the image is written inline with the title decorative. A reference image is reported even when its definition's title is decorative, so that way of marking it is not recognised.",
      "An HTML image with an empty alt attribute is taken as marked.",
      "An image with any alternative text is taken as meaningful, so a decorative image described in words passes.",
      "A Markdown image whose destination runs onto a later line is not read, so an unmarked decorative image written that way is not reported.",
    ],
  },
  { id: "13a", demand: "Every table carries a header row.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "13b", demand: "Each header identifies the values beneath it.", state: "fault",
    checks: [{ rule: "table-header", kind: "offline" }], needs: [],
    limits: [
      "It reports a pipe table whose header has an empty column name. A header with any wording is taken to identify its values, and HTML tables are not read.",
      "It takes any line holding a pipe, followed by a line of dashes, as a table header, so it can report text that is not a table.",
    ],
  },
  { id: "14a", demand: "Document order matches reading order.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "14b", demand: "Each sidebar and displaced callout is given its own heading.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "15a", demand: "The document opens with its title.", state: "fault",
    checks: [{ rule: "opening-title", kind: "offline" }], needs: ["markdown", "jev-route"],
    limits: [
      "It reports only a document with no level-1 heading anywhere. A title that does not come first is not reported.",
      "A preview writes it to the `--json` report but does not print it. The report printed after a send does.",
    ],
  },
  { id: "15b", demand: "The purpose is one line.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "15c", demand: "The purpose names the reader's task.", state: "fault",
    checks: [{ rule: "purpose:fail", kind: "jev" }, { rule: "purpose:diagnosis:neither", kind: "jev" }],
    needs: ["markdown", "jev-route", "send"], limits: PURPOSE_LIMITS,
  },
  {
    id: "15d", demand: "The purpose names its scope.", state: "fault",
    checks: [{ rule: "purpose:fail", kind: "jev" }, { rule: "purpose:diagnosis:neither", kind: "jev" }],
    needs: ["markdown", "jev-route", "send"], limits: PURPOSE_LIMITS,
  },
  { id: "15e", demand: "The opening names the primary audience.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "15f", demand: "The opening gives a version or date.", state: "fault",
    checks: [{ rule: "opening-version-date", kind: "offline" }], needs: ["markdown"],
    limits: [
      "It asks a question as an advisory, rather than stating a fault.",
      "It needs a level-1 title. README, CONTRIBUTING, SECURITY and PULL_REQUEST_TEMPLATE files are exempt, and it is off when front matter is read as text.",
      "It recognises a version or date only in set forms, such as a Version or Date field, a title suffix or a front matter field. In front matter that begins on the first line, a key named version, date, updated or last_updated, in any letter case, silences it when its value is text that is not blank or a finite number, even `version: banana`. The key counts at the top level, or directly under a key named `metadata` in lower case, and under no other key, such as `release`. A value of true or false, a list or a nested map does not count.",
    ],
  },
  { id: "16a", demand: "Where an overview is needed, it keeps the conclusion.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "16b", demand: "Where an overview is needed, it keeps the required action.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "16c", demand: "Where an overview is needed, it keeps every essential qualification.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "17a", demand: "The overview label is a heading, not bold text alone.", state: "fault",
    checks: [{ rule: "overview-label", kind: "offline" }], needs: ["markdown"],
    limits: [
      "It reads only a document with 6 or more level-2 sections.",
      "It asks for a heading worded exactly Overview or Summary before the first content section. It does not recognise an overview under any other label, such as Executive overview or At a glance, and it also fires on a document with no overview at all.",
    ],
  },
  { id: "17b", demand: "The detail has moved to footnotes, an appendix or a collapsible block.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "18a", demand: "There are 3 or fewer levels of detail.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "18b", demand: "The optional detail is still reachable.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "19a", demand: "The referral is near the top or ends the opening section.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "19b", demand: "The referral names its destination.", state: "fault",
    checks: [{ rule: "link-text", kind: "offline" }], needs: [],
    limits: [
      "It reads link text only. It reports a link whose text is empty, a bare web address, or one of a fixed list of vague labels such as `here`. Any other text is taken to name its destination, even when it names the wrong one.",
      "It cannot tell a referral from any other link, and a referral written without a link is not read.",
      "A Markdown link whose destination or title runs onto a later line is not read, though it still renders as a link. A link whose text alone runs over a line is read.",
    ],
  },
  { id: "19c", demand: "The referral says when to use its destination.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "19d", demand: "There is no referral where nothing else exists.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "20a", demand: "On a restructure, every prose passage and content item is kept.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "20b", demand: "On a restructure, no prose is rewritten.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "20c", demand: "On a restructure, the tone is unchanged.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "21a", demand: "Every moved sentence or block keeps its dependencies.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "21b", demand: "Every moved sentence or block keeps its order against neighbouring steps.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "21c", demand: "Every moved sentence or block keeps the claim it qualifies.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "22a", demand: "Every promoted sentence comes unchanged from the document or the author.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "22b", demand: "Every promoted sentence states its field directly.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "22c", demand: "Every promoted sentence stays true.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "22d", demand: "Every promoted sentence stays complete.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "22e", demand: "Every mismatch is reported.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "22f", demand: "Every gap is marked.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "23a", demand: "Accuracy survives every structural choice, with nothing distorted to fit a layout.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "23b", demand: "Completeness survives every structural choice, with nothing cut to fit a layout.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "24a", demand: "Every design element serves a reader need.", state: "not-checkable", checks: [], needs: [], limits: [] },
  { id: "25a", demand: "Where the document cites Part 5, it says the standard is an unpublished draft.", state: "not-read", checks: [], needs: [], limits: [] },
];

/** Six level-2 sections, each holding one line of text. */
const SIX_SECTIONS = sections(["One", "Two", "Three", "Four", "Five", "Six"]);

/** Five level-2 sections, one short of the six the contents and overview rules read. */
const FIVE_SECTIONS = sections(["One", "Two", "Three", "Four", "Five"]);

/** Four level-2 sections. */
const FOUR_SECTIONS = sections(["One", "Two", "Three", "Four"]);

/** A title and a version, so that a specimen built on it raises no edition advisory. */
const GUIDE_OPENING = "# Guide\n\nVersion: 1.0\n\n";

/** A titled document with a version and six level-2 sections, and no contents or overview. */
const SIX_SECTION_GUIDE = `${GUIDE_OPENING}${SIX_SECTIONS}`;

/** The details the offline rules give, as each finding states them. */
const NO_CONTENTS = "Add contents or navigation for six or more root H2 sections.";
const CONTENTS_WORDING = "Use the target section's exact wording in this contents link.";
const NAVIGATION_WORDING = "Use the target section's exact wording in this navigation link.";
const NO_OVERVIEW = "Add an Overview or Summary heading before the first content section.";
const NO_EDITION = "No version or date was recognised in the opening. Would readers need one to identify the edition or judge how current it is?";
const NO_TITLE = "Add a level-1 document title. Purpose assessment is skipped without one.";
const HEADING_FIVE = "heading level 5 (limit 4)";
const PROSE_RANKS = "enumeration ranks 1, 2, 3 in prose; consider a list";
const BULLET_THREE = "Unordered bullet depth 3 (limit 2). Flatten this item.";
const EMPTY_HEADER = "table header has an empty column name";

/**
 * A specimen document for a clause that names a check, and the detail of
 * each finding each of its offline rules gives on it, in order. Each
 * specimen fails that clause's demand, so each of the clause's checks must
 * name it, and an offline rule must name it for the reason given here.
 */
interface ClauseSpecimen {
  readonly text: string;
  readonly reasons: Readonly<Record<string, readonly string[]>>;
}

/** A specimen for each clause that names a check, keyed by the clause. */
const SPECIMENS: Readonly<Record<string, ClauseSpecimen>> = {
  "1a": { text: "# Title\n\n##### Too deep\n\nText.\n", reasons: { "heading-depth": [HEADING_FIVE] } },
  "3a": { text: SIX_SECTION_GUIDE, reasons: { "contents-list": [NO_CONTENTS] } },
  "3b": { text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#one)\n\n${SIX_SECTIONS}`, reasons: { "contents-list": [CONTENTS_WORDING] } },
  "6a": { text: "First, open the box. Second, lift the lid. Third, read the note.\n", reasons: { "prose-enumeration": [PROSE_RANKS] } },
  "8c": { text: "- One\n  - Two\n    - Three\n", reasons: { "bullet-depth": [BULLET_THREE] } },
  "10c": { text: `${GUIDE_OPENING}The valve opens when the pressure rises.\n`, reasons: {} },
  "12a": { text: "Read the guide [here](https://example.org/guide).\n", reasons: { "link-text": ["link text \"here\" describes no destination (https://example.org/guide)"] } },
  "12b": { text: "![](chart.png)\n", reasons: { "image-alt": ["image has no alternative text (chart.png)"] } },
  "12c": { text: "![](decoration.png)\n", reasons: { "image-alt": ["image has no alternative text (decoration.png)"] } },
  "13b": { text: "| Name | |\n|---|---|\n| Ann | 4 |\n", reasons: { "table-header": [EMPTY_HEADER] } },
  "15a": { text: "Text with no title.\n", reasons: { "opening-title": [NO_TITLE] } },
  "15c": { text: `${GUIDE_OPENING}Read this.\n`, reasons: {} },
  "15d": { text: `${GUIDE_OPENING}Read this.\n`, reasons: {} },
  "15f": { text: "# Title\n\nText.\n", reasons: { "opening-version-date": [NO_EDITION] } },
  "17a": { text: `${GUIDE_OPENING}**Overview**\n\nOpen the box.\n\n${SIX_SECTIONS}`, reasons: { "overview-label": [NO_OVERVIEW] } },
  "19b": { text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [here](repair.md).\n", reasons: { "link-text": ["link text \"here\" describes no destination (repair.md)"] } },
};

/**
 * Jev's answer to the purpose question in every stubbed send: it fails the
 * opening, with the diagnosis neither. The digits are those Jev would send.
 */
const NO_PURPOSE = { both: "0.04", task_only: "0.04", scope_only: "0.04", neither: "0.88" };

/** Jev's answer to the colour question in every stubbed send: colour carries no meaning alone, so the block passes. */
const CLEAR_COLOUR = "0.01";

/** The answers above, as the classifier reads them, keyed by the kind of request that asks each question. */
const EXACT_ANSWERS: Readonly<Record<RequestKind, ExactAnswers>> = {
  opening: { purpose: Object.fromEntries(Object.entries(NO_PURPOSE).map(([option, value]) => [option, parseDecimal(value)])) },
  block: { colour_only: parseDecimal(CLEAR_COLOUR) },
};

/** The question each Jev result answers, by the rule the report gives it. */
const QUESTION_OF_RULE: Readonly<Record<string, string>> = { "opening-purpose": "purpose", "colour-only": "colour_only" };

/** The question each coverage count answers, by the name the report gives the count. */
const QUESTION_OF_COVERAGE: Readonly<Record<string, string>> = { purpose: "purpose", colour: "colour_only" };

/** The kind of request that asks each Jev question. */
const KIND_OF_QUESTION: Readonly<Record<string, RequestKind>> = { purpose: "opening", colour_only: "block" };

/** The order in which a clause's needs are written. */
const NEED_ORDER: readonly Need[] = ["markdown", "jev-route", "send", "before"];

/** One check a clause names. */
type Check = Clause["checks"][number];

/**
 * One way of running the audit: the command, the options it is given
 * besides the target, the project folder and `--json`, the needs it meets
 * beside Markdown, and the endings of the files it reads. The design audit
 * reads no `.txt` file.
 */
interface Route {
  readonly name: string;
  readonly command: "text" | "design";
  readonly options: readonly string[];
  readonly meets: readonly Need[];
  readonly reads: readonly string[];
}

/**
 * Each command the checklist's needs describe, as a user would run it. The
 * send routes reach a stubbed transport and never the network.
 */
const ROUTES: readonly Route[] = [
  { name: "text audit", command: "text", options: [], meets: [], reads: ["md", "txt"] },
  { name: "text audit --jev-preview", command: "text", options: ["--jev-preview"], meets: ["jev-route"], reads: ["md", "txt"] },
  { name: "text audit --jev --send", command: "text", options: ["--jev", "--send", "--yes"], meets: ["jev-route", "send"], reads: ["md", "txt"] },
  { name: "design audit", command: "design", options: [], meets: ["jev-route"], reads: ["md"] },
  { name: "design audit --send", command: "design", options: ["--send", "--yes"], meets: ["jev-route", "send"], reads: ["md"] },
];

/**
 * What one route named for each specimen file, and of which kind, and the
 * detail of each offline finding it gave, by file and rule.
 */
interface RouteReading {
  readonly route: Route;
  readonly named: ReadonlyMap<string, ReadonlyMap<string, Check["kind"]>>;
  readonly reasons: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
}

/** Answers for the classifier, and the kind of request that asked them. */
interface Answers {
  readonly kind: RequestKind;
  readonly answers: ExactAnswers;
}

/**
 * What one check is given to read: a text, read as Markdown with the file
 * name and front matter setting given, or answers for the classifier.
 */
interface LimitReading {
  readonly check: string;
  readonly text?: string;
  readonly fileName?: string;
  readonly frontMatter?: boolean;
  readonly answers?: Answers;
}

/**
 * A change to a limit specimen and what the check then gives. `from` is
 * replaced by `to`, and must occur in the specimen's text exactly once. A
 * file name, front matter setting or answers given here replace the
 * specimen's.
 */
interface Control {
  readonly from?: string;
  readonly to?: string;
  readonly fileName?: string;
  readonly frontMatter?: boolean;
  readonly answers?: Answers;
  readonly found: readonly string[];
}

/**
 * A reading that backs one of a clause's limits, counted from 1. `found` is
 * what the check gives today: the detail of each finding of the rule in
 * order, or the question with its band and any diagnosis gate. The control
 * changes the reading in one stated way and must give something else, so
 * the specimen shows both what the limit claims and that its text holds
 * what makes the difference.
 */
interface LimitSpecimen extends LimitReading {
  readonly clause: string;
  readonly limit: number;
  readonly found: readonly string[];
  readonly control: Control;
}

/** Purpose answers whose most likely failure is the task alone. */
const TASK_ONLY: ExactAnswers = { purpose: { both: parseDecimal("0.05"), task_only: parseDecimal("0.80"), scope_only: parseDecimal("0.10"), neither: parseDecimal("0.05") } };

/** Purpose answers that say the opening names both the task and the scope. */
const BOTH_NAMED: ExactAnswers = { purpose: { both: parseDecimal("0.97"), task_only: parseDecimal("0.01"), scope_only: parseDecimal("0.01"), neither: parseDecimal("0.01") } };

/** The behaviour each clause's limits describe, with the limit each specimen backs. */
const LIMIT_SPECIMENS: readonly LimitSpecimen[] = [
  { clause: "1a", limit: 1, check: "heading-depth", text: "## Title\n\n### First\n\n#### Second\n\n##### Third\n", found: [HEADING_FIVE], control: { from: "##### Third", to: "#### Third", found: [] } },
  { clause: "1a", limit: 1, check: "heading-depth", text: "# Title\n\n## First\n\n### Second\n\n#### Third\n", found: [], control: { from: "#### Third", to: "##### Third", found: [HEADING_FIVE] } },
  { clause: "3a", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}${FIVE_SECTIONS}`, found: [], control: { from: "## Five\n\nText.\n", to: "## Five\n\nText.\n\n## Six\n\nText.\n", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}> ## Quoted\n\n${FIVE_SECTIONS}`, found: [], control: { from: "> ## Quoted", to: "## Quoted", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}- ## Listed\n\n${FIVE_SECTIONS}`, found: [], control: { from: "- ## Listed", to: "## Listed", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- bananas\n\n${SIX_SECTIONS}`, found: [], control: { from: "## Contents", to: "## Index", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n| Section |\n|---|\n| Install |\n\n${SIX_SECTIONS}`, found: [], control: { from: "## Contents", to: "## Index", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\nInstall\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "\nInstall\n", to: "\n- Install\n", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\nRead [Install](#install).\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "Read [Install](#install).", to: "[Install](#install)", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Install](install.md)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "(install.md)", to: "(#install)", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Red](#missing)\n\n${SIX_SECTIONS}`, found: [], control: { from: "(#missing)", to: "(missing.md)", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}[red](#missing) [blue](#absent)\n\n${SIX_SECTIONS}`, found: [], control: { from: " [blue](#absent)", to: "", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}Read [One](#one) and [Two](#two).\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "Read [One](#one) and [Two](#two).", to: "[One](#one), [Two](#two)", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}[One](#one) - [Two](#two)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: " - ", to: " | ", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}- Read [One](#one) now.\n- Then [Two](#two).\n\n${SIX_SECTIONS}`, found: [], control: { from: "- Read [One](#one) now.\n- Then [Two](#two).", to: "Read [One](#one) now. Then [Two](#two).", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}| A | B |\n|---|---|\n| [One](#one) | [Two](#two) |\n\n${SIX_SECTIONS}`, found: [], control: { from: "| [Two](#two) |", to: "| Two |", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}[One](#one)\n\n[Two](#two)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "(#one)\n\n[Two]", to: "(#one) [Two]", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [One](#one)\n\n${SIX_SECTIONS}`, found: [], control: { from: "## Contents", to: "## Index", found: [NO_CONTENTS] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#missing)\n\n${SIX_SECTIONS}`, found: [], control: { from: "(#missing)", to: "(#one)", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#detail)\n\n${SIX_SECTIONS}\n### Detail\n\nText.\n`, found: [], control: { from: "### Detail", to: "## Detail", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- Wrong\n\n${SIX_SECTIONS}`, found: [], control: { from: "- Wrong", to: "- [Wrong](#one)", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\nSee [Wrong](#one).\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "See [Wrong](#one).", to: "- See [Wrong](#one).", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n| Section |\n|---|\n| [Wrong](#one) |\n\n${SIX_SECTIONS}`, found: [CONTENTS_WORDING], control: { from: "[Wrong](#one)", to: "[One](#one)", found: [] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}[Wrong](#one) [Two](#two)\n\n${SIX_SECTIONS}`, found: [NAVIGATION_WORDING], control: { from: "[Wrong](#one)", to: "[One](#one)", found: [] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}Read [Wrong](#one) and [Two](#two).\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "Read [Wrong](#one) and [Two](#two).", to: "[Wrong](#one) [Two](#two)", found: [NAVIGATION_WORDING] } },
  { clause: "3b", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#one)\n\n${FOUR_SECTIONS}`, found: [], control: { from: "## Four\n\nText.\n", to: "## Four\n\nText.\n\n## Five\n\nText.\n", found: [CONTENTS_WORDING] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Do this: 1. open the box, 2. lift the lid, 3. read the note.\n", found: [PROSE_RANKS], control: { from: "1. open", to: "open", found: [] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Open the box, then lift the lid, then read the note.\n", found: [], control: { from: "Open the box, then lift the lid, then read", to: "First, open the box. Second, lift the lid. Third, read", found: [PROSE_RANKS] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "- First, open the box.\n- Second, lift the lid.\n- Third, read the note.\n", found: [], control: { from: "- First, open the box.\n- Second, lift the lid.\n- Third,", to: "First, open the box. Second, lift the lid. Third,", found: [PROSE_RANKS] } },
  { clause: "6a", limit: 2, check: "prose-enumeration", text: "Clause (1) The supplier delivers. (2) The buyer pays. (3) Either party may end the contract.\n", found: [PROSE_RANKS], control: { from: "(1) The supplier", to: "The supplier", found: [] } },
  { clause: "8c", limit: 1, check: "bullet-depth", text: "- Outer\n  1. Ordered\n     - Inner\n", found: [], control: { from: "1. Ordered", to: "- Ordered", found: [BULLET_THREE] } },
  { clause: "8c", limit: 1, check: "bullet-depth", text: "- Outer\n  > - Inner\n  >   - Deep\n", found: [BULLET_THREE], control: { from: "  >   - Deep\n", to: "", found: [] } },
  { clause: "10c", limit: 1, check: "colour_only", answers: { kind: "block", answers: { colour_only: parseDecimal("0.01"), position_only: parseDecimal("0.99") } }, found: ["colour_only:pass"], control: { answers: { kind: "block", answers: { colour_only: parseDecimal("0.99"), position_only: parseDecimal("0.01") } }, found: ["colour_only:unsure"] } },
  { clause: "10c", limit: 2, check: "colour_only", answers: { kind: "block", answers: { colour_only: parseDecimal("0.99") } }, found: ["colour_only:unsure"], control: { answers: { kind: "block", answers: { colour_only: parseDecimal("0.01") } }, found: ["colour_only:pass"] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read the [repair guide](install.md).\n", found: [], control: { from: "repair guide", to: "click here", found: ["link text \"click here\" describes no destination (install.md)"] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read [https://example.org](https://example.org).\n", found: ["link text \"https://example.org\" describes no destination (https://example.org)"], control: { from: "[https://example.org]", to: "[Example site]", found: [] } },
  { clause: "12a", limit: 2, check: "link-text", text: "Read [here](\nrepair.md\n).\n", found: [], control: { from: "(\nrepair.md\n)", to: "(repair.md)", found: ["link text \"here\" describes no destination (repair.md)"] } },
  { clause: "12a", limit: 2, check: "link-text", text: "Read [here](repair.md\n\"Repair\").\n", found: [], control: { from: "\n\"Repair\"", to: " \"Repair\"", found: ["link text \"here\" describes no destination (repair.md \"Repair\")"] } },
  { clause: "12a", limit: 2, check: "link-text", text: "Read [click\nhere](repair.md).\n", found: ["link text \"click here\" describes no destination (repair.md)"], control: { from: "(repair.md)", to: "(\nrepair.md\n)", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<img src=\"chart.png\">\n", found: ["image has no alternative text (chart.png)"], control: { from: "\">", to: "\" alt=\"\">", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<img src=\"chart.png\" alt=\"\">\n", found: [], control: { from: " alt=\"\"", to: "", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png \"decorative\")\n", found: [], control: { from: " \"decorative\"", to: "", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 2, check: "image-alt", text: "![nonsense](chart.png)\n", found: [], control: { from: "nonsense", to: "", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 3, check: "image-alt", text: "![](\nchart.png\n)\n", found: [], control: { from: "(\nchart.png\n)", to: "(chart.png)", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: decoration.png \"decorative\"\n", found: ["image has no alternative text (dec)"], control: { from: "![][dec]", to: "![](decoration.png \"decorative\")", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration.png \"decorative\")\n", found: [], control: { from: " \"decorative\"", to: "", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 2, check: "image-alt", text: "<img src=\"decoration.png\" alt=\"\">\n", found: [], control: { from: " alt=\"\"", to: "", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 3, check: "image-alt", text: "![Blue swirl](decoration.png)\n", found: [], control: { from: "Blue swirl", to: "", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 4, check: "image-alt", text: "![](\ndecoration.png\n)\n", found: [], control: { from: "(\ndecoration.png\n)", to: "(decoration.png)", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "13b", limit: 1, check: "table-header", text: "| Thing | Stuff |\n|---|---|\n| Ann | 4 |\n", found: [], control: { from: " Stuff |", to: " |", found: [EMPTY_HEADER] } },
  { clause: "13b", limit: 1, check: "table-header", text: "<table><tr><th></th><th>Age</th></tr><tr><td>Ann</td><td>4</td></tr></table>\n", found: [], control: { from: "<table><tr><th></th><th>Age</th></tr><tr><td>Ann</td><td>4</td></tr></table>", to: "| | Age |\n|---|---|\n| Ann | 4 |", found: [EMPTY_HEADER] } },
  { clause: "13b", limit: 2, check: "table-header", text: "---\n\nplain text |\n---\n", found: [EMPTY_HEADER], control: { from: "plain text |", to: "plain text", found: [] } },
  { clause: "15a", limit: 1, check: "opening-title", text: "Read this first.\n\n# Guide\n\nOpen the box.\n", found: [], control: { from: "# Guide", to: "Guide", found: [NO_TITLE] } },
  { clause: "15c", limit: 1, check: "purpose", answers: { kind: "opening", answers: TASK_ONLY }, found: ["purpose:fail"], control: { answers: { kind: "opening", answers: EXACT_ANSWERS.opening }, found: ["purpose:fail", "purpose:diagnosis:neither"] } },
  { clause: "15c", limit: 2, check: "purpose", answers: { kind: "opening", answers: BOTH_NAMED }, found: ["purpose:unsure"], control: { answers: { kind: "opening", answers: TASK_ONLY }, found: ["purpose:fail"] } },
  { clause: "15d", limit: 1, check: "purpose", answers: { kind: "opening", answers: TASK_ONLY }, found: ["purpose:fail"], control: { answers: { kind: "opening", answers: EXACT_ANSWERS.opening }, found: ["purpose:fail", "purpose:diagnosis:neither"] } },
  { clause: "15d", limit: 2, check: "purpose", answers: { kind: "opening", answers: BOTH_NAMED }, found: ["purpose:unsure"], control: { answers: { kind: "opening", answers: TASK_ONLY }, found: ["purpose:fail"] } },
  { clause: "15f", limit: 1, check: "opening-version-date", text: "# Title\n\nText.\n", found: [NO_EDITION], control: { from: "Text.", to: "Version: 1.0", found: [] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "Text with no title.\n", found: [], control: { from: "Text with no title.", to: "# Title\n\nText with no title.", found: [NO_EDITION] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "# Title\n\nText.\n", fileName: "docs/README.md", found: [], control: { fileName: "docs/GUIDE.md", found: [NO_EDITION] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "# Title\n\nText.\n", frontMatter: false, found: [], control: { frontMatter: true, found: [NO_EDITION] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "# Guide\n\nDate: 3 March 2026\n", found: [], control: { from: "3 March 2026", to: "soon", found: [NO_EDITION] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "# Guide (Version 1.2)\n\nText.\n", found: [], control: { from: "(Version 1.2)", to: "(draft)", found: [NO_EDITION] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "# Guide\n\nVersion: banana\n", found: [NO_EDITION], control: { from: "banana", to: "1.2", found: [] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\nversion: banana\n---\n# Guide\n\nOpen the box.\n", found: [], control: { from: "version: banana", to: "revision: banana", found: [NO_EDITION] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\nLast_Updated: soon\n---\n# Guide\n\nOpen the box.\n", found: [], control: { from: "Last_Updated", to: "Last-Updated", found: [NO_EDITION] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\nversion: 0\n---\n# Guide\n\nOpen the box.\n", found: [], control: { from: "version: 0", to: "version: .nan", found: [NO_EDITION] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\nversion: '  '\n---\n# Guide\n\nOpen the box.\n", found: [NO_EDITION], control: { from: "'  '", to: "'1'", found: [] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\nversion: true\n---\n# Guide\n\nOpen the box.\n", found: [NO_EDITION], control: { from: "true", to: "banana", found: [] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\nversion: [1, 2]\n---\n# Guide\n\nOpen the box.\n", found: [NO_EDITION], control: { from: "[1, 2]", to: "1.2", found: [] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\nversion: {a: 1}\n---\n# Guide\n\nOpen the box.\n", found: [NO_EDITION], control: { from: "{a: 1}", to: "banana", found: [] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\nrelease:\n  version: banana\n---\n# Guide\n\nOpen the box.\n", found: [NO_EDITION], control: { from: "release:", to: "metadata:", found: [] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\nmetadata:\n  version: banana\n---\n# Guide\n\nOpen the box.\n", found: [], control: { from: "metadata:", to: "Metadata:", found: [NO_EDITION] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "\n---\nversion: banana\n---\n# Guide\n\nOpen the box.\n", found: [NO_EDITION], control: { from: "\n---\nversion", to: "---\nversion", found: [] } },
  { clause: "17a", limit: 1, check: "overview-label", text: `${GUIDE_OPENING}${FIVE_SECTIONS}`, found: [], control: { from: "## Five\n\nText.\n", to: "## Five\n\nText.\n\n## Six\n\nText.\n", found: [NO_OVERVIEW] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## Executive overview\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [NO_OVERVIEW], control: { from: "Executive overview", to: "Overview", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## At a glance\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [NO_OVERVIEW], control: { from: "At a glance", to: "Summary", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: SIX_SECTION_GUIDE, found: [NO_OVERVIEW], control: { from: "Version: 1.0\n\n", to: "Version: 1.0\n\n## Overview\n\nOpen the box.\n\n", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## Overview\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [], control: { from: "## Overview", to: "**Overview**", found: [NO_OVERVIEW] } },
  { clause: "19b", limit: 1, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read the [installation guide](install.md).\n", found: [], control: { from: "installation guide", to: "here", found: ["link text \"here\" describes no destination (install.md)"] } },
  { clause: "19b", limit: 2, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read here: repair.md.\n", found: [], control: { from: "here: repair.md", to: "[here](repair.md)", found: ["link text \"here\" describes no destination (repair.md)"] } },
  { clause: "19b", limit: 3, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [here](\nrepair.md\n).\n", found: [], control: { from: "(\nrepair.md\n)", to: "(repair.md)", found: ["link text \"here\" describes no destination (repair.md)"] } },
  { clause: "19b", limit: 3, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [click\nhere](repair.md).\n", found: ["link text \"click here\" describes no destination (repair.md)"], control: { from: "(repair.md)", to: "(\nrepair.md\n)", found: [] } },
];

/**
 * How many limit specimens back each limit, keyed by clause, its limits in
 * order. A specimen added or removed changes this, so the change has to be
 * made here as well.
 */
const SPECIMENS_PER_LIMIT: Readonly<Record<string, readonly number[]>> = {
  "1a": [2],
  "3a": [3, 6, 7],
  "3b": [7, 1],
  "6a": [3, 1],
  "8c": [2],
  "10c": [1, 1],
  "12a": [2, 3],
  "12b": [3, 1, 1],
  "12c": [2, 1, 1, 1],
  "13b": [2, 1],
  "15a": [1, 0],
  "15c": [1, 1],
  "15d": [1, 1],
  "15f": [1, 3, 13],
  "17a": [1, 4],
  "19b": [1, 1, 2],
};

/** The test that shows 15a's second limit, which runs the design audit and reads what it prints. */
const PRINT_TEST = "a preview prints no opening-title finding, and the report printed after a send does";

/**
 * The limits a test of their own shows instead of a limit specimen, by
 * clause and limit number, with the name of that test. Each has no limit
 * specimen.
 */
const LIMITS_SHOWN_BY_A_TEST: Readonly<Record<string, string>> = { "15a.2": PRINT_TEST };

/** Receives what a command prints and keeps none of it. */
function ignore(): void {
  // A route that prints is read through its `--json` report instead.
}

/**
 * Dependencies for a send that never leaves the machine: a stand-in key,
 * terminal, send log and transport. The transport answers every opening with
 * `NO_PURPOSE` and every block with `CLEAR_COLOUR`, and counts the requests.
 */
function stubbedDependencies(requests: string[]): AuditDependencies {
  return {
    env: { TYPESAFE_API_KEY: "stand-in-key" },
    now: () => new Date("2026-11-12T00:00:00Z"),
    terminal: { inputIsTTY: false, outputIsTTY: false, prompt: async () => "no" },
    writeLog: () => {},
    client: {
      fetch: async (url, init) => {
        requests.push(url);
        const questions = Object.keys(JSON.parse(init.body).questions);
        return Response.json({ model: MODEL, answers: Object.fromEntries(questions.map(id => [id, stubAnswer(id)])) });
      },
      clock: { schedule: () => () => {} },
      sleep: async () => {},
    },
  };
}

/** The stubbed transport's answer to one question, as Jev would write it. */
function stubAnswer(question: string): unknown {
  if (question === "purpose") {
    const probabilities = Object.fromEntries(Object.entries(NO_PURPOSE).map(([option, value]) => [option, Number(value)]));
    return { type: "choice", choice: "neither", confidence: Number(NO_PURPOSE.neither), probabilities };
  }
  return { type: "noul", noul: question === "colour_only" ? Number(CLEAR_COLOUR) : 0.5 };
}

/**
 * The check names a report gives each file, with the kind of each. A rule is
 * offline whether the mechanical audit or the planner reports it. A Jev gate
 * is named as the calibration record names it: the question, a colon and the
 * band, or the identifier of a diagnosis gate. A pass is read from the
 * coverage counts, because a report lists no pass among its results.
 */
function namedInReport(report: ReportJson): Map<string, Map<string, Check["kind"]>> {
  const named = new Map<string, Map<string, Check["kind"]>>();
  const mechanical = report.mechanical ?? report;
  for (const [file, result] of Object.entries(mechanical.files ?? {})) {
    for (const finding of result.violations) {
      addName(named, file, finding.rule, "offline");
    }
  }
  for (const finding of report.jev?.localFindings ?? []) {
    addName(named, finding.file, finding.rule, "offline");
  }
  for (const result of report.jev?.results ?? []) {
    addName(named, result.file, `${QUESTION_OF_RULE[result.rule]}:${result.band}`, "jev");
    if (result.diagnosisGate !== undefined) addName(named, result.file, result.diagnosisGate.id, "jev");
  }
  for (const coverage of report.jev?.coverage ?? []) {
    for (const [count, counts] of Object.entries(coverage.checks)) {
      if (counts.pass > 0) addName(named, coverage.file, `${QUESTION_OF_COVERAGE[count]}:pass`, "jev");
    }
  }
  return named;
}

/** Records that a report named a check for a file, and of which kind. */
function addName(named: Map<string, Map<string, Check["kind"]>>, file: string, check: string, kind: Check["kind"]): void {
  named.set(file, (named.get(file) ?? new Map<string, Check["kind"]>()).set(check, kind));
}

/**
 * The detail of each offline finding a report gives each file, by rule and
 * in the order the report lists them: the mechanical findings, then the
 * planner's.
 */
function reasonsInReport(report: ReportJson): Map<string, Map<string, string[]>> {
  const reasons = new Map<string, Map<string, string[]>>();
  const mechanical = report.mechanical ?? report;
  const findings = [
    ...Object.entries(mechanical.files ?? {}).flatMap(([file, result]) => result.violations.map(finding => ({ file, ...finding }))),
    ...report.jev?.localFindings ?? [],
  ];
  for (const finding of findings) {
    const rules = reasons.get(finding.file) ?? new Map<string, string[]>();
    rules.set(finding.rule, [...rules.get(finding.rule) ?? [], finding.detail]);
    reasons.set(finding.file, rules);
  }
  return reasons;
}

/** The parts of a `--json` report that `namedInReport` and `reasonsInReport` read. A plain text audit writes the mechanical part alone, at the top. */
interface ReportJson {
  readonly mechanical?: ReportJson;
  readonly files?: Readonly<Record<string, { readonly violations: ReadonlyArray<{ readonly rule: string; readonly detail: string }> }>>;
  readonly jev?: {
    readonly localFindings: ReadonlyArray<{ readonly file: string; readonly rule: string; readonly detail: string }>;
    readonly results: ReadonlyArray<{ readonly file: string; readonly rule: string; readonly band: string; readonly diagnosisGate?: { readonly id: string } }>;
    readonly coverage: ReadonlyArray<{ readonly file: string; readonly checks: Readonly<Record<string, { readonly pass: number }>> }>;
  };
}

let routeReadings: Promise<RouteReading[]> | undefined;

/**
 * Runs every route once over one directory holding each specimen twice, as
 * `<clause>.md` and as `<clause>.txt`, and reads what each named. The runs
 * are made on the first call and shared after it.
 *
 * @throws An `Error` when a route exits with anything but 0, when a route
 *     that does not send makes a request, or when a send route makes none.
 */
function readRoutes(): Promise<RouteReading[]> {
  routeReadings ??= measureRoutes();
  return routeReadings;
}

/**
 * The runs `readRoutes` shares. It removes every file it writes.
 *
 * @throws An `Error` when a route exits with anything but 0, when a route
 *     that does not send makes a request, or when a send route makes none.
 */
async function measureRoutes(): Promise<RouteReading[]> {
  const directory = mkdtempSync(join(tmpdir(), "checklist-routes-"));
  try {
    for (const [id, specimen] of Object.entries(SPECIMENS)) {
      writeFileSync(join(directory, `${id}.md`), specimen.text);
      writeFileSync(join(directory, `${id}.txt`), specimen.text);
    }
    const readings: RouteReading[] = [];
    for (const [index, route] of ROUTES.entries()) {
      const json = join(tmpdir(), `checklist-route-${process.pid}-${index}.json`);
      const requests: string[] = [];
      const dependencies = stubbedDependencies(requests);
      const exit = await runRoute(route, directory, json, dependencies);
      if (exit !== 0) throw new Error(`${route.name} exited ${exit}.`);
      if (!route.meets.includes("send") && requests.length > 0) throw new Error(`${route.name} sent a request.`);
      if (route.meets.includes("send") && requests.length === 0) throw new Error(`${route.name} sent nothing.`);
      const report: ReportJson = JSON.parse(readFileSync(json, "utf8"));
      readings.push({ route, named: namedInReport(report), reasons: reasonsInReport(report) });
      rmSync(json, { force: true });
    }
    return readings;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Runs one route over a directory, with its report written to `json`.
 *
 * @returns The command's exit code.
 */
async function runRoute(route: Route, directory: string, json: string, dependencies: AuditDependencies): Promise<number> {
  const argv = ["bun", "cli", directory, "--project-dir", directory, ...route.options, "--json", json];
  if (route.command === "text") return await runTextCli(argv, ignore, ignore, dependencies);
  return await runDesignCli(argv, ignore, ignore, dependencies);
}

/**
 * The needs a check was measured to have on its clause's specimen: Markdown
 * when no route names it on the `.txt` copy, the Jev route when the plain
 * text audit does not name it, and a send when no preview names it.
 */
function measuredNeeds(check: string, clause: string, readings: readonly RouteReading[]): Need[] {
  const needs: Need[] = [];
  if (!readings.some(reading => names(reading, `${clause}.txt`, check))) needs.push("markdown");
  if (!readings.some(reading => reading.route.meets.length === 0 && (names(reading, `${clause}.md`, check) || names(reading, `${clause}.txt`, check)))) needs.push("jev-route");
  if (!readings.some(reading => !reading.route.meets.includes("send") && (names(reading, `${clause}.md`, check) || names(reading, `${clause}.txt`, check)))) needs.push("send");
  return needs;
}

/** Whether a route named a check for one specimen file. */
function names(reading: RouteReading, file: string, check: string): boolean {
  return reading.named.get(file)?.has(check) ?? false;
}

/**
 * What one check gives on a reading. For a text, `auditText` reads it as
 * Markdown, with the file name and front matter setting given, and
 * `planDocument` plans it; the result is the detail of each finding of the
 * rule named, in that order. For answers, `classify` reads them; the result
 * is the question with the band, then any diagnosis gate.
 */
function limitFound(reading: LimitReading): string[] {
  if (reading.answers !== undefined) {
    const decision = classify(reading.answers.kind, reading.answers.answers);
    return [`${reading.check}:${decision.band}`, ...(decision.diagnosisGate === undefined ? [] : [decision.diagnosisGate.id])];
  }
  const text = reading.text ?? "";
  const options = { markdown: true, ...(reading.fileName === undefined ? {} : { fileName: reading.fileName }), ...(reading.frontMatter === undefined ? {} : { frontMatter: reading.frontMatter }) };
  return [...auditText(text, options), ...planDocument(text).findings].filter(finding => finding.rule === reading.check).map(finding => finding.detail);
}

/**
 * A limit specimen with its control applied: each `from` in the text made
 * `to`, and the control's file name, front matter setting or answers in
 * place of the specimen's.
 */
function underControl(specimen: LimitSpecimen): LimitReading {
  const { control } = specimen;
  const text = specimen.text === undefined || control.from === undefined ? specimen.text : specimen.text.split(control.from).join(control.to ?? "");
  const fileName = control.fileName ?? specimen.fileName;
  const frontMatter = control.frontMatter ?? specimen.frontMatter;
  const answers = control.answers ?? specimen.answers;
  return {
    check: specimen.check,
    ...(text === undefined ? {} : { text }),
    ...(fileName === undefined ? {} : { fileName }),
    ...(frontMatter === undefined ? {} : { frontMatter }),
    ...(answers === undefined ? {} : { answers }),
  };
}

/** Level-2 sections with the names given, in order, each holding one line of text. */
function sections(names: readonly string[]): string {
  return names.map(name => `## ${name}\n\nText.\n`).join("\n");
}

/**
 * The checklist lines of the Part 5 skill: each line that opens a check box,
 * from the checklist heading to the next heading.
 *
 * @throws An `Error` when the skill has no checklist heading.
 */
function skillChecklistLines(): string[] {
  const lines = readFileSync(SKILL_PATH, "utf8").split(/\r?\n/);
  const start = lines.indexOf(CHECKLIST_HEADING);
  if (start === -1) throw new Error(`The Part 5 skill has no line "${CHECKLIST_HEADING}".`);
  const after = lines.slice(start + 1);
  const end = after.findIndex(line => /^#{1,6} /.test(line));
  return (end === -1 ? after : after.slice(0, end)).filter(line => line.startsWith("- [ ]"));
}

/** Whether a value holds only text, numbers, lists and plain objects, at any depth. */
function isPlainData(value: unknown): boolean {
  if (typeof value === "string" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.every(isPlainData);
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every(isPlainData);
}

describe("the Part 5 checklist clause registry", () => {
  test("holds every checklist line of the Part 5 skill, word for word and in order", () => {
    const lines = skillChecklistLines();
    expect(lines).toHaveLength(25);
    expect(CHECKLIST.map(entry => entry.line)).toEqual(lines);
    expect(CHECKLIST.map(entry => entry.item)).toEqual(lines.map((line, index) => index + 1));
  });

  test("splits each item into its agreed number of clauses, lettered in order", () => {
    expect(CHECKLIST.map(entry => entry.clauses.length)).toEqual(CLAUSES_PER_ITEM);
    for (const entry of CHECKLIST) {
      expect(entry.clauses.map(clause => clause.id)).toEqual(entry.clauses.map((clause, index) => `${entry.item}${"abcdefghij".charAt(index)}`));
    }
    expect(CLAUSES).toHaveLength(64);
  });

  test("holds each clause exactly as this test writes it out: demand, state, checks, needs and limits", () => {
    expect(CLAUSES.map(clause => clause.id)).toEqual(EXPECTED_CLAUSES.map(clause => clause.id));
    for (const [index, expected] of EXPECTED_CLAUSES.entries()) {
      expect(CLAUSES[index], expected.id).toEqual(expected);
    }
  });

  test("each clause that names a check has a specimen, and its checks name that specimen on the fullest route, each offline rule for the reason given", async () => {
    const withChecks = CLAUSES.filter(clause => clause.checks.length > 0).map(clause => clause.id);
    expect(Object.keys(SPECIMENS).sort()).toEqual([...withChecks].sort());
    const readings = await readRoutes();
    const fullest = readings.find(reading => reading.route.name === "design audit --send");
    for (const clause of CLAUSES) {
      for (const check of clause.checks) {
        expect(fullest?.named.get(`${clause.id}.md`)?.get(check.rule), `${clause.id} ${check.rule}`).toBe(check.kind);
      }
      if (clause.checks.length === 0) continue;
      const offline = clause.checks.filter(check => check.kind === "offline").map(check => check.rule);
      const reasons = SPECIMENS[clause.id]?.reasons ?? {};
      expect(Object.keys(reasons), `${clause.id} gives a reason for each offline rule`).toEqual(offline);
      for (const rule of offline) {
        expect(reasons[rule]?.length ?? 0, `${clause.id} ${rule} has a reason`).toBeGreaterThan(0);
        expect(fullest?.reasons.get(`${clause.id}.md`)?.get(rule), `${clause.id} ${rule} reasons`).toEqual(reasons[rule]);
      }
    }
  }, 60000);

  test("each clause's needs are what its checks were measured to need, by running the commands", async () => {
    const readings = await readRoutes();
    for (const clause of CLAUSES.filter(found => found.checks.length > 0)) {
      const needs = new Set(clause.checks.flatMap(check => measuredNeeds(check.rule, clause.id, readings)));
      expect(clause.needs, clause.id).toEqual(NEED_ORDER.filter(need => needs.has(need)));
      for (const reading of readings) {
        if (!clause.needs.every(need => need === "markdown" || reading.route.meets.includes(need))) continue;
        for (const extension of reading.route.reads.filter(found => found === "md" || !clause.needs.includes("markdown"))) {
          for (const check of clause.checks) {
            expect(reading.named.get(`${clause.id}.${extension}`)?.has(check.rule), `${clause.id}.${extension} ${check.rule} on ${reading.route.name}`).toBe(true);
          }
        }
      }
    }
  }, 60000);

  test(PRINT_TEST, async () => {
    const out: string[] = [];
    const directory = mkdtempSync(join(tmpdir(), "checklist-print-"));
    try {
      const file = join(directory, "untitled.md");
      writeFileSync(file, SPECIMENS["15a"]?.text ?? "");
      expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory], text => out.push(text), text => out.push(text), stubbedDependencies([]))).toBe(0);
      expect(out.join("\n")).not.toContain("opening-title");
      expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory, "--send", "--yes"], text => out.push(text), text => out.push(text), stubbedDependencies([]))).toBe(0);
      expect(out.join("\n")).toContain("| local | opening-title |");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("each limit has the agreed number of limit specimens, and each limit specimen backs a limit", () => {
    const limited = CLAUSES.filter(clause => clause.limits.length > 0);
    expect(Object.keys(SPECIMENS_PER_LIMIT)).toEqual(limited.map(clause => clause.id));
    for (const specimen of LIMIT_SPECIMENS) {
      const limits = CLAUSES.find(clause => clause.id === specimen.clause)?.limits.length ?? 0;
      expect(Number.isInteger(specimen.limit) && specimen.limit >= 1 && specimen.limit <= limits, `${specimen.clause} has no limit ${specimen.limit}`).toBe(true);
    }
    for (const clause of limited) {
      const counts = [...clause.limits.keys()].map(index => LIMIT_SPECIMENS.filter(specimen => specimen.clause === clause.id && specimen.limit === index + 1).length);
      expect(counts, clause.id).toEqual([...SPECIMENS_PER_LIMIT[clause.id] ?? []]);
      for (const [index, count] of counts.entries()) {
        const key = `${clause.id}.${index + 1}`;
        expect(count > 0, `${key} has ${count} limit specimens`).toBe(LIMITS_SHOWN_BY_A_TEST[key] === undefined);
      }
    }
    for (const key of Object.keys(LIMITS_SHOWN_BY_A_TEST)) {
      const [id, limit] = key.split(".");
      expect(CLAUSES.find(clause => clause.id === id)?.limits[Number(limit) - 1], `${key} is a limit`).toBeString();
    }
  });

  test("each limit specimen gives today what its limit says, and its control gives something else", () => {
    for (const specimen of LIMIT_SPECIMENS) {
      const { control } = specimen;
      const label = `${specimen.clause} limit ${specimen.limit} on ${JSON.stringify(specimen.text ?? specimen.answers?.kind)}`;
      expect(CLAUSES.find(clause => clause.id === specimen.clause)?.checks.some(check => check.rule.split(":")[0] === specimen.check), `${label} names no ${specimen.check} check`).toBe(true);
      expect(specimen.text === undefined, `${label} reads a text or answers`).toBe(specimen.answers !== undefined);
      expect(control.from === undefined, `${label} control gives both from and to`).toBe(control.to === undefined);
      expect(control.from !== undefined || control.fileName !== undefined || control.frontMatter !== undefined || control.answers !== undefined, `${label} control changes something`).toBe(true);
      if (control.from !== undefined) expect(specimen.text?.split(control.from).length, `${label} holds the control's text once`).toBe(2);
      expect(limitFound(specimen), label).toEqual([...specimen.found]);
      expect(limitFound(underControl(specimen)), `${label} under its control`).toEqual([...control.found]);
      expect(control.found, `${label} control gives the same`).not.toEqual(specimen.found);
    }
  });

  test("a Jev gate is one the calibration record holds, at the cut-off the classifier applies", () => {
    const evidence = new Map(calibrationEvidence().map(gate => [gate.id, gate.cutOff]));
    for (const check of CLAUSES.flatMap(clause => clause.checks).filter(found => found.kind === "jev")) {
      const kind = KIND_OF_QUESTION[check.rule.split(":")[0] ?? ""];
      if (kind === undefined) throw new Error(`${check.rule} asks no known question.`);
      const decision = classify(kind, EXACT_ANSWERS[kind]);
      const cutOff = decision.diagnosisGate?.id === check.rule ? decision.diagnosisGate.cutOff : decision.cutOff;
      expect(evidence.get(check.rule), check.rule).toBe(cutOff);
    }
  });

  test("a clause names a check exactly when its state says one can report on it", () => {
    for (const clause of CLAUSES) {
      const reported = clause.state === "fault" || clause.state === "pass-only";
      expect(clause.checks.length > 0, `${clause.id} is ${clause.state}`).toBe(reported);
      expect(clause.limits.length > 0, `${clause.id} limits`).toBe(reported);
      if (!reported) expect(clause.needs, clause.id).toEqual([]);
    }
  });

  test("the states tally to every clause, with today's count in each", () => {
    const tally: Record<ClauseState, number> = { "fault": 0, "pass-only": 0, "not-read": 0, "needs-two-versions": 0, "not-checkable": 0 };
    for (const clause of CLAUSES) {
      tally[clause.state] += 1;
    }
    expect(tally).toEqual(STATE_TALLY);
    expect(Object.values(tally).reduce((sum, count) => sum + count, 0)).toBe(CLAUSES.length);
  });

  test("no Jev answer can reach the registry: the module imports nothing and holds only data", () => {
    const source = readFileSync(MODULE_PATH, "utf8");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\b/m);
    expect(source).not.toMatch(/\b(?:require|import)\s*\(/);
    expect(isPlainData(CHECKLIST)).toBe(true);
  });

  test("the data check refuses a function, a class instance and an empty value", () => {
    expect(isPlainData([{ rule: "x", run: () => 1 }])).toBe(false);
    expect(isPlainData(new Date(0))).toBe(false);
    expect(isPlainData(null)).toBe(false);
    expect(isPlainData(true)).toBe(false);
  });
});
