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
      "One entry under a heading worded Contents, Table of contents, TOC or Key sections satisfies it, even an entry that is not a link. So do two fragment links in one block of the opening, even when neither reaches a heading. It does not check that every section is listed.",
    ],
  },
  {
    id: "3b", demand: "The table of contents is worded identically to the headings.", state: "fault",
    checks: [{ rule: "contents-list", kind: "offline" }], needs: ["markdown"],
    limits: [
      "It compares only links that reach a level-2 section by fragment, placed under a contents heading or among two or more links in one block of the opening. An entry that is not a link, or a link that reaches no level-2 section, is not compared.",
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
    limits: ["It reports empty link text, a bare web address, and a fixed list of vague labels such as `click here`. Any other text is taken to name its destination, even when it names the wrong one."],
  },
  {
    id: "12b", demand: "A meaningful image says what it shows.", state: "fault",
    checks: [{ rule: "image-alt", kind: "offline" }], needs: [],
    limits: [
      "It reports a Markdown image with empty alternative text and an HTML image with no alt attribute. An HTML image with an empty alt attribute, or a Markdown image written inline with the title decorative, is taken as decorative and is not reported, even when it is meaningful.",
      "It cannot tell whether the text it finds says what the image shows. Any alternative text passes.",
    ],
  },
  {
    id: "12c", demand: "A decorative image is marked as decorative.", state: "fault",
    checks: [{ rule: "image-alt", kind: "offline" }], needs: [],
    limits: [
      "It reports a Markdown image with empty alternative text, unless the image is written inline with the title decorative. A reference image is reported even when its definition's title is decorative, so that way of marking it is not recognised.",
      "An HTML image with an empty alt attribute is taken as marked.",
      "An image with any alternative text is taken as meaningful, so a decorative image described in words passes.",
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
      "It recognises a version or date only in set forms, such as a Version or Date field, a title suffix or a front matter field. Any non-empty version or date field in front matter silences it, even `version: banana`.",
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
const SIX_SECTIONS = ["One", "Two", "Three", "Four", "Five", "Six"].map(name => `## ${name}\n\nText.\n`).join("\n");

/** A titled document with a version and six level-2 sections, and no contents or overview. */
const SIX_SECTION_GUIDE = `# Guide\n\nVersion: 1.0\n\n${SIX_SECTIONS}`;

/**
 * A document for each clause that names a check, keyed by the clause. Each
 * fails that clause's demand, so each of the clause's checks must name it.
 */
const SPECIMENS: Readonly<Record<string, string>> = {
  "1a": "# Title\n\n##### Too deep\n\nText.\n",
  "3a": SIX_SECTION_GUIDE,
  "3b": `# Guide\n\nVersion: 1.0\n\n## Contents\n\n- [Wrong](#one)\n\n${SIX_SECTIONS}`,
  "6a": "First, open the box. Second, lift the lid. Third, read the note.\n",
  "8c": "- One\n  - Two\n    - Three\n",
  "10c": "# Guide\n\nVersion: 1.0\n\nThe valve opens when the pressure rises.\n",
  "12a": "Read the guide [here](https://example.org/guide).\n",
  "12b": "![](chart.png)\n",
  "12c": "![](decoration.png)\n",
  "13b": "| Name | |\n|---|---|\n| Ann | 4 |\n",
  "15a": "Text with no title.\n",
  "15c": "# Guide\n\nVersion: 1.0\n\nRead this.\n",
  "15d": "# Guide\n\nVersion: 1.0\n\nRead this.\n",
  "15f": "# Title\n\nText.\n",
  "17a": `# Guide\n\nVersion: 1.0\n\n**Overview**\n\nOpen the box.\n\n${SIX_SECTIONS}`,
  "19b": "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [here](repair.md).\n",
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

/** What one route named for each specimen file, and of which kind. */
interface RouteReading {
  readonly route: Route;
  readonly named: ReadonlyMap<string, ReadonlyMap<string, Check["kind"]>>;
}

/**
 * A text and what one check must do on it today. Each backs a sentence of a
 * clause's limits: a check that the limit says catches the text must name
 * it, and one that the limit says misses it must not.
 */
interface LimitSpecimen {
  readonly clause: string;
  readonly check: string;
  readonly fires: boolean;
  readonly text?: string;
  readonly fileName?: string;
  readonly frontMatter?: boolean;
  readonly answers?: { readonly kind: RequestKind; readonly answers: ExactAnswers };
}

/** Purpose answers whose most likely failure is the task alone. */
const TASK_ONLY: ExactAnswers = { purpose: { both: parseDecimal("0.05"), task_only: parseDecimal("0.80"), scope_only: parseDecimal("0.10"), neither: parseDecimal("0.05") } };

/** The behaviour each clause's limits describe, one text for each claim. */
const LIMIT_SPECIMENS: readonly LimitSpecimen[] = [
  { clause: "1a", check: "heading-depth", fires: true, text: "## Title\n\n### First\n\n#### Second\n\n##### Third\n" },
  { clause: "1a", check: "heading-depth", fires: false, text: "# Title\n\n## First\n\n### Second\n\n#### Third\n" },
  { clause: "3a", check: "contents-list", fires: false, text: `# Guide\n\nVersion: 1.0\n\n${["One", "Two", "Three", "Four", "Five"].map(name => `## ${name}\n\nText.\n`).join("\n")}` },
  { clause: "3a", check: "contents-list", fires: false, text: `# Guide\n\nVersion: 1.0\n\n> ## Quoted\n\n${["One", "Two", "Three", "Four", "Five"].map(name => `## ${name}\n\nText.\n`).join("\n")}` },
  { clause: "3a", check: "contents-list", fires: false, text: `# Guide\n\nVersion: 1.0\n\n## Contents\n\n- bananas\n\n${SIX_SECTIONS}` },
  { clause: "3a", check: "contents-list", fires: false, text: `# Guide\n\nVersion: 1.0\n\n[red](#missing) [blue](#absent)\n\n${SIX_SECTIONS}` },
  { clause: "3a", check: "contents-list", fires: false, text: `# Guide\n\nVersion: 1.0\n\n## Contents\n\n- [One](#one)\n\n${SIX_SECTIONS}` },
  { clause: "3b", check: "contents-list", fires: false, text: `# Guide\n\nVersion: 1.0\n\n## Contents\n\n- [Wrong](#missing)\n\n${SIX_SECTIONS}` },
  { clause: "3b", check: "contents-list", fires: false, text: `# Guide\n\nVersion: 1.0\n\n## Contents\n\n- [Wrong](#detail)\n\n${SIX_SECTIONS}\n### Detail\n\nText.\n` },
  { clause: "3b", check: "contents-list", fires: true, text: `# Guide\n\nVersion: 1.0\n\n[Wrong](#one) [Two](#two)\n\n${SIX_SECTIONS}` },
  { clause: "3b", check: "contents-list", fires: false, text: `# Guide\n\nVersion: 1.0\n\n## Contents\n\n- [Wrong](#one)\n\n${["One", "Two", "Three", "Four"].map(name => `## ${name}\n\nText.\n`).join("\n")}` },
  { clause: "6a", check: "prose-enumeration", fires: true, text: "Do this: 1. open the box, 2. lift the lid, 3. read the note.\n" },
  { clause: "6a", check: "prose-enumeration", fires: false, text: "Open the box, then lift the lid, then read the note.\n" },
  { clause: "6a", check: "prose-enumeration", fires: false, text: "- First, open the box.\n- Second, lift the lid.\n- Third, read the note.\n" },
  { clause: "6a", check: "prose-enumeration", fires: true, text: "Clause (1) The supplier delivers. (2) The buyer pays. (3) Either party may end the contract.\n" },
  { clause: "8c", check: "bullet-depth", fires: false, text: "- Outer\n  1. Ordered\n     - Inner\n" },
  { clause: "8c", check: "bullet-depth", fires: true, text: "- Outer\n  > - Inner\n  >   - Deep\n" },
  { clause: "10c", check: "colour_only:fail", fires: false, answers: { kind: "block", answers: { colour_only: parseDecimal("0.99") } } },
  { clause: "12a", check: "link-text", fires: false, text: "Read the [repair guide](install.md).\n" },
  { clause: "12a", check: "link-text", fires: true, text: "Read [https://example.org](https://example.org).\n" },
  { clause: "12b", check: "image-alt", fires: true, text: "<img src=\"chart.png\">\n" },
  { clause: "12b", check: "image-alt", fires: false, text: "<img src=\"chart.png\" alt=\"\">\n" },
  { clause: "12b", check: "image-alt", fires: false, text: "![](chart.png \"decorative\")\n" },
  { clause: "12b", check: "image-alt", fires: false, text: "![nonsense](chart.png)\n" },
  { clause: "12c", check: "image-alt", fires: true, text: "![][dec]\n\n[dec]: decoration.png \"decorative\"\n" },
  { clause: "12c", check: "image-alt", fires: false, text: "<img src=\"decoration.png\" alt=\"\">\n" },
  { clause: "12c", check: "image-alt", fires: false, text: "![Blue swirl](decoration.png)\n" },
  { clause: "13b", check: "table-header", fires: false, text: "| Thing | Stuff |\n|---|---|\n| Ann | 4 |\n" },
  { clause: "13b", check: "table-header", fires: false, text: "<table><tr><th></th><th>Age</th></tr><tr><td>Ann</td><td>4</td></tr></table>\n" },
  { clause: "13b", check: "table-header", fires: true, text: "---\n\nplain text |\n---\n" },
  { clause: "15a", check: "opening-title", fires: false, text: "Read this first.\n\n# Guide\n\nOpen the box.\n" },
  { clause: "15c", check: "purpose:fail", fires: true, answers: { kind: "opening", answers: TASK_ONLY } },
  { clause: "15c", check: "purpose:diagnosis:neither", fires: false, answers: { kind: "opening", answers: TASK_ONLY } },
  { clause: "15c", check: "purpose:pass", fires: false, answers: { kind: "opening", answers: { purpose: { both: parseDecimal("0.97"), task_only: parseDecimal("0.01"), scope_only: parseDecimal("0.01"), neither: parseDecimal("0.01") } } } },
  { clause: "15f", check: "opening-version-date", fires: false, text: "Text with no title.\n" },
  { clause: "15f", check: "opening-version-date", fires: false, text: "# Title\n\nText.\n", fileName: "docs/README.md" },
  { clause: "15f", check: "opening-version-date", fires: false, text: "# Title\n\nText.\n", frontMatter: false },
  { clause: "15f", check: "opening-version-date", fires: false, text: "# Guide\n\nDate: 3 March 2026\n" },
  { clause: "15f", check: "opening-version-date", fires: false, text: "# Guide (Version 1.2)\n\nText.\n" },
  { clause: "15f", check: "opening-version-date", fires: false, text: "---\nversion: banana\n---\n# Guide\n\nOpen the box.\n" },
  { clause: "15f", check: "opening-version-date", fires: true, text: "# Guide\n\nVersion: banana\n" },
  { clause: "17a", check: "overview-label", fires: true, text: `# Guide\n\nVersion: 1.0\n\n## Executive overview\n\nOpen the box.\n\n${SIX_SECTIONS}` },
  { clause: "17a", check: "overview-label", fires: true, text: `# Guide\n\nVersion: 1.0\n\n## At a glance\n\nOpen the box.\n\n${SIX_SECTIONS}` },
  { clause: "17a", check: "overview-label", fires: true, text: SIX_SECTION_GUIDE },
  { clause: "17a", check: "overview-label", fires: false, text: `# Guide\n\nVersion: 1.0\n\n## Overview\n\nOpen the box.\n\n${SIX_SECTIONS}` },
  { clause: "17a", check: "overview-label", fires: false, text: `# Guide\n\nVersion: 1.0\n\n${["One", "Two", "Three", "Four", "Five"].map(name => `## ${name}\n\nText.\n`).join("\n")}` },
  { clause: "19b", check: "link-text", fires: false, text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read the [installation guide](install.md).\n" },
  { clause: "19b", check: "link-text", fires: false, text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read here: repair.md.\n" },
];

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

/** The parts of a `--json` report that `namedInReport` reads. A plain text audit writes the mechanical part alone, at the top. */
interface ReportJson {
  readonly mechanical?: ReportJson;
  readonly files?: Readonly<Record<string, { readonly violations: ReadonlyArray<{ readonly rule: string }> }>>;
  readonly jev?: {
    readonly localFindings: ReadonlyArray<{ readonly file: string; readonly rule: string }>;
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
    for (const [id, text] of Object.entries(SPECIMENS)) {
      writeFileSync(join(directory, `${id}.md`), text);
      writeFileSync(join(directory, `${id}.txt`), text);
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
      readings.push({ route, named: namedInReport(JSON.parse(readFileSync(json, "utf8"))) });
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
 * The check names an engine gives for a limit specimen. `auditText` reads it
 * as Markdown, with the file name and front matter setting given, and
 * `planDocument` plans it. `classify` reads answers instead of text.
 */
function limitChecks(specimen: LimitSpecimen): string[] {
  if (specimen.answers !== undefined) {
    const decision = classify(specimen.answers.kind, specimen.answers.answers);
    return [...Object.keys(specimen.answers.answers).map(question => `${question}:${decision.band}`), ...(decision.diagnosisGate === undefined ? [] : [decision.diagnosisGate.id])];
  }
  const text = specimen.text ?? "";
  const reading = { markdown: true, ...(specimen.fileName === undefined ? {} : { fileName: specimen.fileName }), ...(specimen.frontMatter === undefined ? {} : { frontMatter: specimen.frontMatter }) };
  return [...auditText(text, reading).map(finding => finding.rule), ...planDocument(text).findings.map(finding => finding.rule)];
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

  test("each clause that names a check has a specimen, and its checks name that specimen on the fullest route", async () => {
    const withChecks = CLAUSES.filter(clause => clause.checks.length > 0).map(clause => clause.id);
    expect(Object.keys(SPECIMENS).sort()).toEqual([...withChecks].sort());
    const readings = await readRoutes();
    const fullest = readings.find(reading => reading.route.name === "design audit --send");
    for (const clause of CLAUSES) {
      for (const check of clause.checks) {
        expect(fullest?.named.get(`${clause.id}.md`)?.get(check.rule), `${clause.id} ${check.rule}`).toBe(check.kind);
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

  test("a preview prints no opening-title finding, and the report printed after a send does", async () => {
    const out: string[] = [];
    const directory = mkdtempSync(join(tmpdir(), "checklist-print-"));
    try {
      const file = join(directory, "untitled.md");
      writeFileSync(file, SPECIMENS["15a"] ?? "");
      expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory], text => out.push(text), text => out.push(text), stubbedDependencies([]))).toBe(0);
      expect(out.join("\n")).not.toContain("opening-title");
      expect(await runDesignCli(["bun", "cli", file, "--project-dir", directory, "--send", "--yes"], text => out.push(text), text => out.push(text), stubbedDependencies([]))).toBe(0);
      expect(out.join("\n")).toContain("| local | opening-title |");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("each limit's stated catch or miss holds today", () => {
    for (const specimen of LIMIT_SPECIMENS) {
      const question = specimen.check.split(":")[0];
      expect(CLAUSES.find(clause => clause.id === specimen.clause)?.checks.some(check => check.rule.split(":")[0] === question), `${specimen.clause} names no ${question} check`).toBe(true);
      expect(limitChecks(specimen).includes(specimen.check), `${specimen.clause} ${specimen.check} on ${JSON.stringify(specimen.text ?? specimen.answers?.kind)}`).toBe(specimen.fires);
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
