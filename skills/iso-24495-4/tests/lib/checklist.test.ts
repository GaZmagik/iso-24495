import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
    limits: [
      "It reads Markdown headings and reports those deeper than level 4. It counts the absolute level, not the levels below the title, so under a level-2 title a heading 3 levels below it is reported. An HTML heading such as `<h5>Deep</h5>` is not reported, while a `#####` line inside an HTML block such as `<div>` can be, though it shows as text.",
    ],
  },
  { id: "2a", demand: "Each heading states its section's message, or is a name its genre expects.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "2b", demand: "No heading uses wordplay.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "2c", demand: "No heading uses a term the document has not yet explained.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "3a", demand: "A document with 6 or more sections carries a table of contents.", state: "fault",
    checks: [{ rule: "contents-list", kind: "offline" }], needs: ["markdown"],
    limits: [
      "It reads a document only when it counts 6 or more level-2 headings outside any list or quotation, and takes those as its sections. It does not count an HTML heading such as `<h2>Six</h2>`, but it can count a `##` line that shows as text, such as one inside an HTML block like `<div>`.",
      "Under a contents heading, such as Contents or Table of contents, a list item or table body row outside any quotation can satisfy it even when it is not a link, such as `- bananas`. Some entries that render do not, such as `- :` or the row `| - |`. A paragraph there can satisfy it when it holds a link to a fragment and little else, such as `[Install](#install)`, and text in square brackets can count as a link, as in `[Install](#install) [draft]`. Other words can stop it, as in `Install` or `Read [Install](#install).`, and so can a link whose title holds a parenthesis, such as `[Install](#install \"Step (1)\")`, or whose text runs over a line.",
      "Two or more links to fragments in the opening, outside any quotation, can also satisfy it, even when neither reaches a heading, if they sit in one list, in the body rows of one table, or in one paragraph that would count under a contents heading. Some are not counted, such as a link whose text runs over a line, one whose fragment holds a malformed escape such as `#%zz`, or one with a title in brackets such as `[One](#one (Hint))`. `Read [One](#one) and [Two](#two).` as a paragraph does not satisfy it, though the same sentence in a list item can. Two links in a table's header row do not, nor do `[One](#one)` and `[Two](#two)` as two separate paragraphs outside a list. In a reference link whose text runs over a line, such as `- [One` followed by `x][o]`, the second line's `[o]` can be read as a link of its own. It does not check that every section is listed.",
    ],
  },
  {
    id: "3b", demand: "The table of contents is worded identically to the headings.", state: "fault",
    checks: [{ rule: "contents-list", kind: "offline" }], needs: ["markdown"],
    limits: [
      "It can compare links that reach a level-2 section by fragment, under a contents heading or among two or more links to fragments in one list, table or paragraph of the opening. Some such links are not compared, such as one with a title like `[Wrong](#one \"Step\")`, an inline link whose text runs over a line, or one in a quotation or a table's header row. A paragraph outside a list or table is compared only when, apart from what it reads as links, it holds just white space, commas, semicolons, vertical bars or slashes, so `See [Wrong](#one).` is not compared. Text in square brackets can count as a link for this, as in `[Wrong](#one) [draft]` or `[Begin](#two junk)`. In a reference link whose text runs over a line, such as `- [Wrong` followed by `x][w]`, the second line's `[w]` can be compared instead. An entry that is not a link, or a link to a fragment that matches none of its sections, such as `#missing`, is not compared.",
      "It reads a document only when it counts 6 or more level-2 headings outside any list or quotation. It can count a `##` line that shows as text, such as one inside an HTML block like `<div>`.",
    ],
  },
  { id: "4a", demand: "Headings are numbered only where a reader must cite one by its identifier.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "5a", demand: "Each chunk carries one idea.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "5b", demand: "Each chunk is separated from the next by a blank line.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "6a", demand: "Sequences are in ordered lists, except a legal document's clause identifiers.", state: "fault",
    checks: [{ rule: "prose-enumeration", kind: "offline" }], needs: [],
    limits: [
      "It can report a prose block that holds rank 1 among at least 3 ranks, written as ordinal words such as `first` or as the numbers 1 to 6 in forms such as `1.` or `(1)`. It misses some, such as `Steps (1), (2) and (3) are required.`, where punctuation touches the numbers, or `**(1)**` in a block that also holds a link. It does not report `Open the box, then lift the lid, then read the note.`, nor the same steps written as separate bullets. It cannot tell a numbered set from a sequence, so `Bring: (1) gloves, (2) goggles and (3) boots.` is reported as well.",
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
    limits: [
      "It can report a Markdown bullet nested more than 2 unordered list items deep, counting the item itself. It counts across a quotation but not an ordered list, so a bullet beneath an ordered item beneath a bullet has depth 2 and passes. It misses some lists that render nested, such as nested HTML `<ul>` lists, or `-` above `  -` above `    - Three`.",
    ],
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
      "It judges colour only. The block request also asks about position, but the result does not use that answer, and shape and other devices are not asked about.",
      "It can pass a block or stay unsure, and never reports a fault. A pass appears only in the counts.",
    ],
  },
  { id: "11a", demand: "A text alternative is present only beside a picture or diagram, or beside a table whose headers miss values or whose order breaks the comparison.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "12a", demand: "Link text names its destination.", state: "fault",
    checks: [{ rule: "link-text", kind: "offline" }], needs: [],
    limits: [
      "It can report link text that is empty, a bare web address, or one of a fixed list of vague labels such as `click here`. It skips some links that render, such as `[here]()`, the autolink `<https://example.org>` or `[&#104;ere](repair.md)`. It removes some marks first, so `[h_ere](x)` is reported as `here`, and it can report text that begins with a web address even when words follow, such as `[https://example.org is the guide](x)`. Other text can pass even when it names the wrong destination, such as `[repair guide](install.md)`.",
      "Some links that run over a line are not read, though they still render, such as `[here](` with the destination on the next line, `[here](repair.md` with `\"Repair\")` on the next line, or `[click` with `here][r]` on the next line. Some are read, such as `[click` with `here](repair.md)` on the next line, or `[click here](repair.md \"Repair (advanced)` with `manual\")` on the next. In `[click` with `here][here]` on the next line, the second line is read as the link `[here]`.",
    ],
  },
  {
    id: "12b", demand: "A meaningful image says what it shows.", state: "fault",
    checks: [{ rule: "image-alt", kind: "offline" }], needs: [],
    limits: [
      "It can report a Markdown image with empty alternative text and an HTML image with no alt attribute. It skips some that render, such as `![]()`, and other text in an HTML tag can pass for an alt attribute, such as `data-alt=\"\"`. `<img src=\"chart.png\" alt=\"\">` is taken as decorative and not reported, even when the image is meaningful, but `<img src=\"chart.png\" alt>` is reported. The inline title decorative can mark an image as decorative, as in `![](chart.png \"decorative\")`, but can fail to when the destination or title holds a parenthesis, as in `![](chart(1).png \"decorative\")` or `![](chart.png (decorative))`.",
      "It cannot tell whether the text says what the image shows, so `![nonsense](chart.png)` passes. Text that looks like HTML can still be reported, as in `![The <img> tag](chart.png)`.",
      "Some images that run over a line are not reported, though they still render, such as `![](` with the destination on the next line, or `![](chart.png` with `\"Chart\")` on the next line.",
    ],
  },
  {
    id: "12c", demand: "A decorative image is marked as decorative.", state: "fault",
    checks: [{ rule: "image-alt", kind: "offline" }], needs: [],
    limits: [
      "It can report a Markdown image with empty alternative text. The inline title decorative can mark it, as in `![](decoration.png \"decorative\")`, but a parenthesis in the destination can stop that, so `![](decoration(1).png \"decorative\")` is reported. A decorative title in a reference definition does not mark it, so `![][dec]` with `[dec]: decoration.png \"decorative\"` is reported. It skips some images that render, such as `![]()`.",
      "`<img src=\"decoration.png\" alt=\"\">` is taken as marked, but `<img src=\"decoration.png\" alt>`, which HTML also reads as empty, is reported.",
      "A decorative image described in words can pass, such as `![Blue swirl](decoration.png)`.",
      "Some images that run over a line are not reported, though they still render, such as `![](` with the destination on the next line, or `![](decoration.png` with `\"Swirl\")` on the next line.",
    ],
  },
  { id: "13a", demand: "Every table carries a header row.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "13b", demand: "Each header identifies the values beneath it.", state: "fault",
    checks: [{ rule: "table-header", kind: "offline" }], needs: [],
    limits: [
      "It can report a pipe table whose header has an empty column name, such as `| Name | |`. A cell that renders blank, such as `&#32;`, can pass, and a header cell holding a code span with an escaped pipe can be reported. A header with wording, such as `| Thing | Stuff |`, can pass whatever the wording says. It does not read an HTML table as a table, so `<th></th>` is not reported.",
      "It can take a line holding a pipe, followed by a line of dashes, as a table header, so it can report text that is not a table, such as `plain text |` above `---`, or a line of an HTML table.",
    ],
  },
  { id: "14a", demand: "Document order matches reading order.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "14b", demand: "Each sidebar and displaced callout is given its own heading.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "15a", demand: "The document opens with its title.", state: "fault",
    checks: [{ rule: "opening-title", kind: "offline" }], needs: ["markdown", "jev-route"],
    limits: [
      "It can report a document with no Markdown level-1 heading. A document whose title does not come first is not reported, as when `Read this first.` comes above `# Guide`. An HTML title such as `<h1>Guide</h1>` is not read, so a document titled only that way can be reported.",
      "A preview of either audit prints it. A send that stops before it sends, such as one given no agreement, does not print it.",
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
      "It needs a Markdown level-1 title. A file named README, CONTRIBUTING, SECURITY or PULL_REQUEST_TEMPLATE, in any letter case and with or without an extension, is exempt, but a longer name such as `README-fr.md` is not. It is off when front matter is read as text.",
      "It recognises a version or date only in set forms, such as `Version: 1.2`, `Date: 3 March 2026`, a title suffix such as `(Version 1.2)`, or a front matter field. Some forms are not recognised, such as `Version: 2`, `Version: banana` or the title suffix `(2.0)`. In front matter that begins on the first line and parses as YAML, a key named version, date, updated or last_updated, in any letter case, can silence it when its value is a finite number or text that is not blank, even `version: banana` or the quoted `'true'`. The key counts at the top level, or directly under a key named `metadata` in lower case, but not under another key such as `release`. A value YAML reads as true or false, a list or a map does not count, and a block that does not parse, such as one holding `title: [unclosed`, does not silence it.",
    ],
  },
  { id: "16a", demand: "Where an overview is needed, it keeps the conclusion.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "16b", demand: "Where an overview is needed, it keeps the required action.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "16c", demand: "Where an overview is needed, it keeps every essential qualification.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "17a", demand: "The overview label is a heading, not bold text alone.", state: "fault",
    checks: [{ rule: "overview-label", kind: "offline" }], needs: ["markdown"],
    limits: [
      "It reads a document only when it counts 6 or more level-2 headings outside any list or quotation. It can count a `##` line that shows as text, such as one inside an HTML block like `<div>`.",
      "It asks for a heading worded Overview or Summary before the first content section, and fires on a document with no overview at all. It can accept other letter cases and a leading number, such as `## 1. OVERVIEW`, but not other wording, such as Executive overview, At a glance or `## 1) OVERVIEW`, nor an HTML heading such as `<h2>Overview</h2>`, nor a heading inside a Markdown list or quotation, such as `> ## Overview`.",
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
      "It judges link text. It can report a link whose text is empty, a bare web address, or one of a fixed list of vague labels such as `here`. It skips some links that render, such as `[here]()` or the autolink `<https://example.org>`, and it removes some marks first, so `[h_ere](x)` is reported as `here`. Other text can pass even when it names the wrong destination, such as `[installation guide](install.md)`.",
      "It cannot tell a referral from any other link. A referral written without a link, such as `read here: repair.md`, is not read, but an HTML tag that is not a link, such as `<a data-href=\"repair.md\">here</a>`, can be read as one.",
      "Some links that run over a line are not read, though they still render, such as `[here](` with the destination on the next line, `[here](repair.md` with `\"Repair\")` on the next line, or `[click` with `here][r]` on the next line. Some are read, such as `[click` with `here](repair.md)` on the next line, or `[click here](repair.md \"Repair (advanced)` with `manual\")` on the next. In `[click` with `here][here]` on the next line, the second line is read as the link `[here]`.",
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
  { clause: "1a", limit: 1, check: "heading-depth", text: "# Title\n\n<h5>Deep</h5>\n", found: [], control: { from: "<h5>Deep</h5>", to: "##### Deep", found: [HEADING_FIVE] } },
  { clause: "1a", limit: 1, check: "heading-depth", text: "# Title\n\n<div>\n##### Deep\n</div>\n", found: [HEADING_FIVE], control: { from: "##### Deep", to: "Deep", found: [] } },
  { clause: "3a", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}${FIVE_SECTIONS}`, found: [], control: { from: "## Five\n\nText.\n", to: "## Five\n\nText.\n\n## Six\n\nText.\n", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}> ## Quoted\n\n${FIVE_SECTIONS}`, found: [], control: { from: "> ## Quoted", to: "## Quoted", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}- ## Listed\n\n${FIVE_SECTIONS}`, found: [], control: { from: "- ## Listed", to: "## Listed", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}${FIVE_SECTIONS}\n<h2>Six</h2>\n`, found: [], control: { from: "<h2>Six</h2>", to: "## Six", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}${FIVE_SECTIONS}\n<div>\n## Six\n</div>\n`, found: [NO_CONTENTS], control: { from: "## Six", to: "Six", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- bananas\n\n${SIX_SECTIONS}`, found: [], control: { from: "## Contents", to: "## Index", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n| Section |\n|---|\n| Install |\n\n${SIX_SECTIONS}`, found: [], control: { from: "## Contents", to: "## Index", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\nInstall\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "\nInstall\n", to: "\n- Install\n", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\nRead [Install](#install).\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "Read [Install](#install).", to: "[Install](#install)", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Install](install.md)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "(install.md)", to: "(#install)", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Red](#missing)\n\n${SIX_SECTIONS}`, found: [], control: { from: "(#missing)", to: "(missing.md)", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n| Install |\n|---|\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "| Install |\n|---|", to: "| Section |\n|---|\n| Install |", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n> - Install\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "> - Install", to: "- Install", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n| Section |\n|---|\n| - |\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "| - |", to: "| Start |", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- :\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "- :", to: "- Start", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Install](#install "Step (1)")\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "(1)", to: "1", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Install](#install) [draft]\n\n${SIX_SECTIONS}`, found: [], control: { from: "[draft]", to: "draft", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Install\nguide](#install)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "[Install\nguide]", to: "[Install guide]", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n<ul><li>One</li></ul>\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "<ul><li>One</li></ul>", to: "- One", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n| Part |\n|---|\n| &nbsp; |\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "&nbsp;", to: "One", found: [] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}> ## Contents\n>\n> - One\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "> ## Contents\n>\n> - One", to: "## Contents\n\n- One", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}[red](#missing) [blue](#absent)\n\n${SIX_SECTIONS}`, found: [], control: { from: " [blue](#absent)", to: "", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}Read [One](#one) and [Two](#two).\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "Read [One](#one) and [Two](#two).", to: "[One](#one), [Two](#two)", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}[One](#one) - [Two](#two)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: " - ", to: " | ", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}- Read [One](#one) now.\n- Then [Two](#two).\n\n${SIX_SECTIONS}`, found: [], control: { from: "- Read [One](#one) now.\n- Then [Two](#two).", to: "Read [One](#one) now. Then [Two](#two).", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}| A | B |\n|---|---|\n| [One](#one) | [Two](#two) |\n\n${SIX_SECTIONS}`, found: [], control: { from: "| [Two](#two) |", to: "| Two |", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}[One](#one)\n\n[Two](#two)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "(#one)\n\n[Two]", to: "(#one) [Two]", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [One](#one)\n\n${SIX_SECTIONS}`, found: [], control: { from: "## Contents", to: "## Index", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}> - [One](#one)\n> - [Two](#two)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "> - [One](#one)\n> - [Two](#two)", to: "- [One](#one)\n- [Two](#two)", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}| [One](#one) | [Two](#two) |\n|---|---|\n| a | b |\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "| [One](#one) | [Two](#two) |\n|---|---|\n| a | b |", to: "| A | B |\n|---|---|\n| [One](#one) | [Two](#two) |", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}[One](#one), [Two](#two) [draft]\n\n${SIX_SECTIONS}`, found: [], control: { from: "[draft]", to: "draft", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}- [One\n  x](#one)\n- [Two](#two)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "[One\n  x]", to: "[One]", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}- [One](#%zz)\n- [Two](#two)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "#%zz", to: "#red", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}- [One\n  x][o]\n- [Two](#two)\n\n[o]: #one\n\n${SIX_SECTIONS}`, found: [NAVIGATION_WORDING], control: { from: "\n\n[o]: #one", to: "", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}[One](#one (Hint)) [Two](#two (Hint))\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "(#one (Hint)) [Two](#two (Hint))", to: "(#one) [Two](#two)", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}- Read [One](#one) and [Two](#two).\n\n${SIX_SECTIONS}`, found: [], control: { from: "- Read", to: "Read", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}- [One](#one)\n\n  [Two](#two)\n\n${SIX_SECTIONS}`, found: [], control: { from: "- [One](#one)\n\n  [Two](#two)", to: "[One](#one)\n\n[Two](#two)", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}| Read |\n|---|\n| Read [One](#one) and [Two](#two). |\n\n${SIX_SECTIONS}`, found: [], control: { from: "| Read |\n|---|\n| Read [One](#one) and [Two](#two). |", to: "Read [One](#one) and [Two](#two).", found: [NO_CONTENTS] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#missing)\n\n${SIX_SECTIONS}`, found: [], control: { from: "(#missing)", to: "(#one)", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#detail)\n\n${SIX_SECTIONS}\n### Detail\n\nText.\n`, found: [], control: { from: "### Detail", to: "## Detail", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- Wrong\n\n${SIX_SECTIONS}`, found: [], control: { from: "- Wrong", to: "- [Wrong](#one)", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\nSee [Wrong](#one).\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "See [Wrong](#one).", to: "- See [Wrong](#one).", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n| Section |\n|---|\n| [Wrong](#one) |\n\n${SIX_SECTIONS}`, found: [CONTENTS_WORDING], control: { from: "[Wrong](#one)", to: "[One](#one)", found: [] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n| [Wrong](#one) |\n|---|\n| Install |\n\n${SIX_SECTIONS}`, found: [], control: { from: "| [Wrong](#one) |\n|---|\n| Install |", to: "| Section |\n|---|\n| [Wrong](#one) |", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- Install\n\n> [Wrong](#one)\n\n${SIX_SECTIONS}`, found: [], control: { from: "> [Wrong](#one)", to: "[Wrong](#one)", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}[Wrong](#one) [Two](#two)\n\n${SIX_SECTIONS}`, found: [NAVIGATION_WORDING], control: { from: "[Wrong](#one)", to: "[One](#one)", found: [] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}Read [Wrong](#one) and [Two](#two).\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "Read [Wrong](#one) and [Two](#two).", to: "[Wrong](#one) [Two](#two)", found: [NAVIGATION_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Wrong](#one) [draft]\n\n${SIX_SECTIONS}`, found: [CONTENTS_WORDING], control: { from: "[draft]", to: "draft", found: [NO_CONTENTS] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}[Wrong](#one), [Two](#two) [draft]\n\n${SIX_SECTIONS}`, found: [NAVIGATION_WORDING], control: { from: "[draft]", to: "draft", found: [NO_CONTENTS] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Wrong](#one) [Begin](#two junk)\n\n${SIX_SECTIONS}`, found: [CONTENTS_WORDING], control: { from: "[Begin](#two junk)", to: "Begin junk", found: [NO_CONTENTS] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong\n  x](#one)\n\n${SIX_SECTIONS}`, found: [], control: { from: "[Wrong\n  x]", to: "[Wrong]", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#one "Step")\n\n${SIX_SECTIONS}`, found: [], control: { from: " \"Step\"", to: "", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong\n  x][w]\n\n[w]: #one\n\n${SIX_SECTIONS}`, found: [CONTENTS_WORDING], control: { from: "\n\n[w]: #one", to: "", found: [] } },
  { clause: "3b", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#one)\n\n${FOUR_SECTIONS}`, found: [], control: { from: "## Four\n\nText.\n", to: "## Four\n\nText.\n\n## Five\n\nText.\n", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#one)\n\n${FOUR_SECTIONS}\n<div>\n## Five\n</div>\n`, found: [CONTENTS_WORDING], control: { from: "## Five", to: "Five", found: [] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Do this: 1. open the box, 2. lift the lid, 3. read the note.\n", found: [PROSE_RANKS], control: { from: "1. open", to: "open", found: [] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Open the box, then lift the lid, then read the note.\n", found: [], control: { from: "Open the box, then lift the lid, then read", to: "First, open the box. Second, lift the lid. Third, read", found: [PROSE_RANKS] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "- First, open the box.\n- Second, lift the lid.\n- Third, read the note.\n", found: [], control: { from: "- First, open the box.\n- Second, lift the lid.\n- Third,", to: "First, open the box. Second, lift the lid. Third,", found: [PROSE_RANKS] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Steps (1), (2) and (3) are required.\n", found: [], control: { from: "(1), (2) and", to: "(1) and (2) and", found: [PROSE_RANKS] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Do this: **(1)** open, **(2)** lift, **(3)** read. [Guide](x)\n", found: [], control: { from: " [Guide](x)", to: "", found: [PROSE_RANKS] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Bring: (1) gloves, (2) goggles and (3) boots.\n", found: [PROSE_RANKS], control: { from: "(1) gloves, (2) goggles and (3) boots", to: "gloves, goggles and boots", found: [] } },
  { clause: "6a", limit: 2, check: "prose-enumeration", text: "Clause (1) The supplier delivers. (2) The buyer pays. (3) Either party may end the contract.\n", found: [PROSE_RANKS], control: { from: "(1) The supplier", to: "The supplier", found: [] } },
  { clause: "8c", limit: 1, check: "bullet-depth", text: "- Outer\n  1. Ordered\n     - Inner\n", found: [], control: { from: "1. Ordered", to: "- Ordered", found: [BULLET_THREE] } },
  { clause: "8c", limit: 1, check: "bullet-depth", text: "- Outer\n  > - Inner\n  >   - Deep\n", found: [BULLET_THREE], control: { from: "  >   - Deep\n", to: "", found: [] } },
  { clause: "8c", limit: 1, check: "bullet-depth", text: "<ul><li>One<ul><li>Two<ul><li>Three</li></ul></li></ul></li></ul>\n", found: [], control: { from: "<ul><li>One<ul><li>Two<ul><li>Three</li></ul></li></ul></li></ul>", to: "- One\n  - Two\n    - Three", found: [BULLET_THREE] } },
  { clause: "8c", limit: 1, check: "bullet-depth", text: "-\n  -\n    - Three\n", found: [], control: { from: "  -\n", to: "  - Two\n", found: [BULLET_THREE] } },
  { clause: "10c", limit: 1, check: "colour_only", answers: { kind: "block", answers: { colour_only: parseDecimal("0.01"), position_only: parseDecimal("0.99") } }, found: ["colour_only:pass"], control: { answers: { kind: "block", answers: { colour_only: parseDecimal("0.99"), position_only: parseDecimal("0.01") } }, found: ["colour_only:unsure"] } },
  { clause: "10c", limit: 2, check: "colour_only", answers: { kind: "block", answers: { colour_only: parseDecimal("0.99") } }, found: ["colour_only:unsure"], control: { answers: { kind: "block", answers: { colour_only: parseDecimal("0.01") } }, found: ["colour_only:pass"] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read the [repair guide](install.md).\n", found: [], control: { from: "repair guide", to: "click here", found: ["link text \"click here\" describes no destination (install.md)"] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read [https://example.org](https://example.org).\n", found: ["link text \"https://example.org\" describes no destination (https://example.org)"], control: { from: "[https://example.org]", to: "[Example site]", found: [] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read [here]().\n", found: [], control: { from: "()", to: "(repair.md)", found: ["link text \"here\" describes no destination (repair.md)"] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read <https://example.org>.\n", found: [], control: { from: "<https://example.org>", to: "[https://example.org](https://example.org)", found: ["link text \"https://example.org\" describes no destination (https://example.org)"] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read [&#104;ere](repair.md).\n", found: [], control: { from: "&#104;ere", to: "here", found: ["link text \"here\" describes no destination (repair.md)"] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read [h_ere](x).\n", found: ["link text \"here\" describes no destination (x)"], control: { from: "h_ere", to: "hxere", found: [] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read [https://example.org is the guide](x).\n", found: ["link text \"https://example.org is the guide\" describes no destination (x)"], control: { from: "https://example.org is the guide", to: "the guide at https://example.org", found: [] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read [here*](repair.md).\n", found: ["link text \"here\" describes no destination (repair.md)"], control: { from: "[here*]", to: "[repair guide]", found: [] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read [*](repair.md).\n", found: ["link has no text; say where it goes"], control: { from: "[*]", to: "[repair guide]", found: [] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read [here](<repair manual.md>).\n", found: [], control: { from: "<repair manual.md>", to: "repair.md", found: ["link text \"here\" describes no destination (repair.md)"] } },
  { clause: "12a", limit: 1, check: "link-text", text: "Read [here][r].\n\n[r]: repair.md\t\"Repair\"\n", found: [], control: { from: "\t", to: " ", found: ["link text \"here\" describes no destination (r)"] } },
  { clause: "12a", limit: 2, check: "link-text", text: "Read [here](\nrepair.md\n).\n", found: [], control: { from: "(\nrepair.md\n)", to: "(repair.md)", found: ["link text \"here\" describes no destination (repair.md)"] } },
  { clause: "12a", limit: 2, check: "link-text", text: "Read [here](repair.md\n\"Repair\").\n", found: [], control: { from: "\n\"Repair\"", to: " \"Repair\"", found: ["link text \"here\" describes no destination (repair.md \"Repair\")"] } },
  { clause: "12a", limit: 2, check: "link-text", text: "Read [click\nhere](repair.md).\n", found: ["link text \"click here\" describes no destination (repair.md)"], control: { from: "(repair.md)", to: "(\nrepair.md\n)", found: [] } },
  { clause: "12a", limit: 2, check: "link-text", text: "Read [click\nhere][r].\n\n[r]: repair.md\n", found: [], control: { from: "[click\nhere]", to: "[click here]", found: ["link text \"click here\" describes no destination (r)"] } },
  { clause: "12a", limit: 2, check: "link-text", text: "Read [click here](repair.md \"Repair (advanced)\nmanual\").\n", found: ["link text \"click here\" describes no destination (repair.md \"Repair (advanced)"], control: { from: "(advanced)", to: "advanced", found: [] } },
  { clause: "12a", limit: 2, check: "link-text", text: "Read [click\nhere][here].\n\n[here]: repair.md\n", found: ["link text \"here\" describes no destination (here)"], control: { from: "here][here]", to: "here][r]", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<img src=\"chart.png\">\n", found: ["image has no alternative text (chart.png)"], control: { from: "\">", to: "\" alt=\"\">", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<img src=\"chart.png\" alt=\"\">\n", found: [], control: { from: " alt=\"\"", to: "", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png \"decorative\")\n", found: [], control: { from: " \"decorative\"", to: "", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<img src=\"chart.png\" data-alt=\"\">\n", found: [], control: { from: "data-alt", to: "title", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<img src=\"chart.png\" alt>\n", found: ["image has no alternative text (chart.png)"], control: { from: " alt>", to: " alt=\"\">", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart(1).png \"decorative\")\n", found: ["image has no alternative text (chart(1)"], control: { from: "chart(1).png", to: "chart.png", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png (decorative))\n", found: ["image has no alternative text (chart.png (decorative)"], control: { from: "(decorative))", to: "\"decorative\")", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![]()\n", found: [], control: { from: "()", to: "(chart.png)", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png \"&#100;ecorative\")\n", found: ["image has no alternative text (chart.png \"&#100;ecorative\")"], control: { from: "&#100;", to: "d", found: [] } },
  { clause: "12b", limit: 2, check: "image-alt", text: "![nonsense](chart.png)\n", found: [], control: { from: "nonsense", to: "", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 2, check: "image-alt", text: "![The <img> tag](chart.png)\n", found: ["image has no alternative text (image)"], control: { from: "<img>", to: "img", found: [] } },
  { clause: "12b", limit: 3, check: "image-alt", text: "![](\nchart.png\n)\n", found: [], control: { from: "(\nchart.png\n)", to: "(chart.png)", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 3, check: "image-alt", text: "![](chart.png\n\"Chart\")\n", found: [], control: { from: "\n\"Chart\"", to: " \"Chart\"", found: ["image has no alternative text (chart.png \"Chart\")"] } },
  { clause: "12b", limit: 3, check: "image-alt", text: "![\n](chart.png)\n", found: [], control: { from: "![\n]", to: "![ ]", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: decoration.png \"decorative\"\n", found: ["image has no alternative text (dec)"], control: { from: "![][dec]", to: "![](decoration.png \"decorative\")", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration.png \"decorative\")\n", found: [], control: { from: " \"decorative\"", to: "", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration(1).png \"decorative\")\n", found: ["image has no alternative text (decoration(1)"], control: { from: "decoration(1).png", to: "decoration.png", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![]()\n", found: [], control: { from: "()", to: "(decoration.png)", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: decoration.png\t\"decorative\"\n", found: [], control: { from: "\t", to: " ", found: ["image has no alternative text (dec)"] } },
  { clause: "12c", limit: 2, check: "image-alt", text: "<img src=\"decoration.png\" alt=\"\">\n", found: [], control: { from: " alt=\"\"", to: "", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 2, check: "image-alt", text: "<img src=\"decoration.png\" alt>\n", found: ["image has no alternative text (decoration.png)"], control: { from: " alt>", to: " alt=\"\">", found: [] } },
  { clause: "12c", limit: 3, check: "image-alt", text: "![Blue swirl](decoration.png)\n", found: [], control: { from: "Blue swirl", to: "", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 4, check: "image-alt", text: "![](\ndecoration.png\n)\n", found: [], control: { from: "(\ndecoration.png\n)", to: "(decoration.png)", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 4, check: "image-alt", text: "![](decoration.png\n\"Swirl\")\n", found: [], control: { from: "\n\"Swirl\"", to: " \"Swirl\"", found: ["image has no alternative text (decoration.png \"Swirl\")"] } },
  { clause: "13b", limit: 1, check: "table-header", text: "| Thing | Stuff |\n|---|---|\n| Ann | 4 |\n", found: [], control: { from: " Stuff |", to: " |", found: [EMPTY_HEADER] } },
  { clause: "13b", limit: 1, check: "table-header", text: "<table><tr><th></th><th>Age</th></tr><tr><td>Ann</td><td>4</td></tr></table>\n", found: [], control: { from: "<table><tr><th></th><th>Age</th></tr><tr><td>Ann</td><td>4</td></tr></table>", to: "| | Age |\n|---|---|\n| Ann | 4 |", found: [EMPTY_HEADER] } },
  { clause: "13b", limit: 1, check: "table-header", text: "| &#32; | B |\n|---|---|\n| 1 | 2 |\n", found: [], control: { from: "&#32;", to: "", found: [EMPTY_HEADER] } },
  { clause: "13b", limit: 1, check: "table-header", text: "| `a\\|` | B |\n|---|---|\n| 1 | 2 |\n", found: [EMPTY_HEADER], control: { from: "`a\\|`", to: "`a`", found: [] } },
  { clause: "13b", limit: 2, check: "table-header", text: "---\n\nplain text |\n---\n", found: [EMPTY_HEADER], control: { from: "plain text |", to: "plain text", found: [] } },
  { clause: "13b", limit: 2, check: "table-header", text: "<table>\n<tr><th>Name |</th></tr>\n<tr><td>---</td></tr>\n</table>\n", found: [EMPTY_HEADER], control: { from: "Name |", to: "Name", found: [] } },
  { clause: "13b", limit: 2, check: "table-header", text: "```\n| A | |\n|---|---|\n```\n", found: [], control: { from: "```\n| A | |\n|---|---|\n```", to: "| A | |\n|---|---|", found: [EMPTY_HEADER] } },
  { clause: "15a", limit: 1, check: "opening-title", text: "Read this first.\n\n# Guide\n\nOpen the box.\n", found: [], control: { from: "# Guide", to: "Guide", found: [NO_TITLE] } },
  { clause: "15a", limit: 1, check: "opening-title", text: "<h1>Guide</h1>\n\nOpen the box.\n", found: [NO_TITLE], control: { from: "<h1>Guide</h1>", to: "# Guide", found: [] } },
  { clause: "15c", limit: 1, check: "purpose", answers: { kind: "opening", answers: TASK_ONLY }, found: ["purpose:fail"], control: { answers: { kind: "opening", answers: EXACT_ANSWERS.opening }, found: ["purpose:fail", "purpose:diagnosis:neither"] } },
  { clause: "15c", limit: 2, check: "purpose", answers: { kind: "opening", answers: BOTH_NAMED }, found: ["purpose:unsure"], control: { answers: { kind: "opening", answers: TASK_ONLY }, found: ["purpose:fail"] } },
  { clause: "15d", limit: 1, check: "purpose", answers: { kind: "opening", answers: TASK_ONLY }, found: ["purpose:fail"], control: { answers: { kind: "opening", answers: EXACT_ANSWERS.opening }, found: ["purpose:fail", "purpose:diagnosis:neither"] } },
  { clause: "15d", limit: 2, check: "purpose", answers: { kind: "opening", answers: BOTH_NAMED }, found: ["purpose:unsure"], control: { answers: { kind: "opening", answers: TASK_ONLY }, found: ["purpose:fail"] } },
  { clause: "15f", limit: 1, check: "opening-version-date", text: "# Title\n\nText.\n", found: [NO_EDITION], control: { from: "Text.", to: "Version: 1.0", found: [] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "Text with no title.\n", found: [], control: { from: "Text with no title.", to: "# Title\n\nText with no title.", found: [NO_EDITION] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "# Title\n\nText.\n", fileName: "docs/README.md", found: [], control: { fileName: "docs/GUIDE.md", found: [NO_EDITION] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "# Title\n\nText.\n", frontMatter: false, found: [], control: { frontMatter: true, found: [NO_EDITION] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "# Title\n\nText.\n", fileName: "docs/README-fr.md", found: [NO_EDITION], control: { fileName: "docs/README.fr.md", found: [] } },
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
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\ndate: soon\n---\n# Guide\n\nOpen the box.\n", found: [], control: { from: "date: soon", to: "dates: soon", found: [NO_EDITION] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\nUPDATED: 3\n---\n# Guide\n\nOpen the box.\n", found: [], control: { from: "UPDATED: 3", to: "UPDATED:", found: [NO_EDITION] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "\n---\nversion: banana\n---\n# Guide\n\nOpen the box.\n", found: [NO_EDITION], control: { from: "\n---\nversion", to: "---\nversion", found: [] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "# Guide\n\nVersion: 2\n", found: [NO_EDITION], control: { from: "Version: 2", to: "Version: 2.0", found: [] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "# Guide (2.0)\n\nText.\n", found: [NO_EDITION], control: { from: "(2.0)", to: "(Version 2.0)", found: [] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\nversion: 'true'\n---\n# Guide\n\nOpen the box.\n", found: [], control: { from: "'true'", to: "true", found: [NO_EDITION] } },
  { clause: "15f", limit: 3, check: "opening-version-date", text: "---\ntitle: [unclosed\nversion: 1.0\n---\n# Guide\n\nOpen the box.\n", found: [NO_EDITION], control: { from: "[unclosed", to: "closed", found: [] } },
  { clause: "17a", limit: 1, check: "overview-label", text: `${GUIDE_OPENING}${FIVE_SECTIONS}`, found: [], control: { from: "## Five\n\nText.\n", to: "## Five\n\nText.\n\n## Six\n\nText.\n", found: [NO_OVERVIEW] } },
  { clause: "17a", limit: 1, check: "overview-label", text: `${GUIDE_OPENING}${FIVE_SECTIONS}\n<div>\n## Six\n</div>\n`, found: [NO_OVERVIEW], control: { from: "## Six", to: "Six", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## Executive overview\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [NO_OVERVIEW], control: { from: "Executive overview", to: "Overview", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## At a glance\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [NO_OVERVIEW], control: { from: "At a glance", to: "Summary", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: SIX_SECTION_GUIDE, found: [NO_OVERVIEW], control: { from: "Version: 1.0\n\n", to: "Version: 1.0\n\n## Overview\n\nOpen the box.\n\n", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## Overview\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [], control: { from: "## Overview", to: "**Overview**", found: [NO_OVERVIEW] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## 1. OVERVIEW\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [], control: { from: "1. OVERVIEW", to: "1) OVERVIEW", found: [NO_OVERVIEW] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}<h2>Overview</h2>\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [NO_OVERVIEW], control: { from: "<h2>Overview</h2>", to: "## Overview", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}> ## Overview\n>\n> The gist.\n\n${SIX_SECTIONS}`, found: [NO_OVERVIEW], control: { from: "> ## Overview\n>\n> The gist.", to: "## Overview\n\nThe gist.", found: [] } },
  { clause: "19b", limit: 1, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read the [installation guide](install.md).\n", found: [], control: { from: "installation guide", to: "here", found: ["link text \"here\" describes no destination (install.md)"] } },
  { clause: "19b", limit: 1, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [here]().\n", found: [], control: { from: "()", to: "(repair.md)", found: ["link text \"here\" describes no destination (repair.md)"] } },
  { clause: "19b", limit: 1, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read <https://example.org/repair>.\n", found: [], control: { from: "<https://example.org/repair>", to: "[https://example.org/repair](https://example.org/repair)", found: ["link text \"https://example.org/repair\" describes no destination (https://example.org/repair)"] } },
  { clause: "19b", limit: 1, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [h_ere](repair.md).\n", found: ["link text \"here\" describes no destination (repair.md)"], control: { from: "h_ere", to: "hxere", found: [] } },
  { clause: "19b", limit: 2, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read here: repair.md.\n", found: [], control: { from: "here: repair.md", to: "[here](repair.md)", found: ["link text \"here\" describes no destination (repair.md)"] } },
  { clause: "19b", limit: 2, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read <a data-href=\"repair.md\">here</a>.\n", found: ["link text \"here\" describes no destination (repair.md)"], control: { from: "data-href", to: "data-x", found: [] } },
  { clause: "19b", limit: 3, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [here](\nrepair.md\n).\n", found: [], control: { from: "(\nrepair.md\n)", to: "(repair.md)", found: ["link text \"here\" describes no destination (repair.md)"] } },
  { clause: "19b", limit: 3, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [click\nhere](repair.md).\n", found: ["link text \"click here\" describes no destination (repair.md)"], control: { from: "(repair.md)", to: "(\nrepair.md\n)", found: [] } },
  { clause: "19b", limit: 3, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [click\nhere][r].\n\n[r]: repair.md\n", found: [], control: { from: "[click\nhere]", to: "[click here]", found: ["link text \"click here\" describes no destination (r)"] } },
  { clause: "19b", limit: 3, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [click here](repair.md \"Repair (advanced)\nmanual\").\n", found: ["link text \"click here\" describes no destination (repair.md \"Repair (advanced)"], control: { from: "(advanced)", to: "advanced", found: [] } },
  { clause: "19b", limit: 3, check: "link-text", text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [click\nhere][here].\n\n[here]: repair.md\n", found: ["link text \"here\" describes no destination (here)"], control: { from: "here][here]", to: "here][r]", found: [] } },
];

/**
 * How many limit specimens back each limit, keyed by clause, its limits in
 * order. A specimen added or removed changes this, so the change has to be
 * made here as well.
 */
const SPECIMENS_PER_LIMIT: Readonly<Record<string, readonly number[]>> = {
  "1a": [4],
  "3a": [5, 16, 17],
  "3b": [15, 2],
  "6a": [6, 1],
  "8c": [4],
  "10c": [1, 1],
  "12a": [11, 6],
  "12b": [9, 2, 3],
  "12c": [5, 2, 1, 2],
  "13b": [4, 3],
  "15a": [2, 0],
  "15c": [1, 1],
  "15d": [1, 1],
  "15f": [1, 4, 19],
  "17a": [2, 7],
  "19b": [4, 2, 5],
};

/** The test that shows 15a's second limit, which runs both audits and reads what they print. */
const PRINT_TEST = "a preview of either audit prints the opening-title finding, and a send that stops before it sends does not";

/**
 * The limits a test of their own shows instead of a limit specimen, by
 * clause and limit number, with the name of that test. Each has no limit
 * specimen.
 */
const LIMITS_SHOWN_BY_A_TEST: Readonly<Record<string, string>> = { "15a.2": PRINT_TEST };

/**
 * A digest of the limit specimens that back each limit, keyed by clause,
 * its limits in order, as `digestOf` writes it. Every part of each
 * specimen counts, its text above all, so a specimen changed here and not
 * in its digest fails. The change has to be made in both places on purpose.
 */
const LIMIT_SPECIMEN_DIGESTS: Readonly<Record<string, readonly string[]>> = {
  "1a": ["05c161cc89c947e2"],
  "3a": ["891e52073a6d41df", "9c7c19a42e393427", "7b0f0609fba19879"],
  "3b": ["3ea39c80143b34b0", "83be9494937e5f54"],
  "6a": ["30012afab98279ef", "ac7780100b062b44"],
  "8c": ["1e7ef38789ed8e7f"],
  "10c": ["b81c4742f0d8f982", "9136f07360ae2af1"],
  "12a": ["52d00e27020486eb", "9f6fa856a0e58f17"],
  "12b": ["290f4aa6ee5a25d8", "0a8d2b897cc61c2d", "978b9b349ab33d16"],
  "12c": ["bf1abce0e4e29fb3", "bf869cb66a91d31c", "c703fb9e206ab814", "444769517fdfd5cd"],
  "13b": ["b953b20f9ff853b2", "e2fd7a84834d8ea8"],
  "15a": ["de56b3a6afc9946f", "4f53cda18c2baa0c"],
  "15c": ["371efd19a5ca4c2e", "1afc94d906a22e1b"],
  "15d": ["e5a917bc6401d872", "6b5bdba68c9c7dcb"],
  "15f": ["463bba50c60651a7", "a043767c12cfe410", "cbe52aeab5b5f019"],
  "17a": ["d9351c7bdeced047", "bc6484bcb4ce3899"],
  "19b": ["8d7374144d4bb978", "8e3c4f0d60d846d8", "a2f3adc83db9c51d"],
};

/** A digest of each clause specimen, text and reasons, keyed by the clause, as `digestOf` writes it. */
const SPECIMEN_DIGESTS: Readonly<Record<string, string>> = {
  "1a": "634f9b7d0d8339ae",
  "3a": "05deb1c41fc09209",
  "3b": "2b287cac5742b449",
  "6a": "1fe5e2c752ffae09",
  "8c": "de544846e4fdb6fa",
  "10c": "ecdf55f88967aded",
  "12a": "c56cf169d00f950c",
  "12b": "b53788abf49f1e71",
  "12c": "2dbe29dac4576a69",
  "13b": "4bf003ee610bafdf",
  "15a": "dde96eedfccfa4b5",
  "15c": "14cef7c0a528c820",
  "15d": "14cef7c0a528c820",
  "15f": "a110f40c437220f5",
  "17a": "6371233b39f075a5",
  "19b": "44fdcbd1ca38383e",
};

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
 * What one run of an audit printed, both streams in the order written, and
 * its exit code. The run has a stubbed transport that records each request
 * in `requests`, and no terminal to agree on.
 */
async function printed(command: Route["command"], argv: readonly string[], requests: string[]): Promise<{ exit: number; text: string }> {
  const out: string[] = [];
  const dependencies = stubbedDependencies(requests);
  if (command === "text") return { exit: await runTextCli([...argv], text => out.push(text), text => out.push(text), dependencies), text: out.join("\n") };
  return { exit: await runDesignCli([...argv], text => out.push(text), text => out.push(text), dependencies), text: out.join("\n") };
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

/**
 * The first 16 hexadecimal digits of the SHA-256 of a value's JSON. An
 * exact decimal's digits are written as text, because JSON has no form for
 * them.
 */
function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, jsonOfBigInt)).digest("hex").slice(0, 16);
}

/** A JSON replacer that writes a bigint as its digits and leaves every other value as it is. */
function jsonOfBigInt(key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
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

/**
 * The name of each test this file declares, read from its own source: the
 * first argument of each `test(` call that opens a line, written either as
 * a quoted name or as a constant this file sets to one.
 *
 * @throws An `Error` when a call's name cannot be read, so that a test
 *     declared some other way is never left out without notice.
 */
function declaredTestNames(): Set<string> {
  const source = readFileSync(import.meta.path, "utf8");
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/^const ([A-Z_]+) = ("(?:[^"\\]|\\.)*");\r?$/gm)) {
    constants.set(match[1] ?? "", String(JSON.parse(match[2] ?? "")));
  }
  const names = new Set<string>();
  let read = 0;
  for (const match of source.matchAll(/^ *test\(("(?:[^"\\]|\\.)*"|[A-Z_]+),/gm)) {
    const argument = match[1] ?? "";
    const name = argument.startsWith("\"") ? String(JSON.parse(argument)) : constants.get(argument);
    if (name === undefined) throw new Error(`No constant in this file gives the test name ${argument}.`);
    names.add(name);
    read++;
  }
  const calls = source.match(/^ *test\(/gm)?.length ?? 0;
  if (read !== calls) throw new Error(`Read the names of ${read} of the ${calls} tests this file declares.`);
  return names;
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
    const directory = mkdtempSync(join(tmpdir(), "checklist-print-"));
    try {
      const file = join(directory, "untitled.md");
      writeFileSync(file, SPECIMENS["15a"]?.text ?? "");
      const base = ["bun", "cli", file, "--project-dir", directory];
      const designPreview = await printed("design", [...base], []);
      expect(designPreview.exit).toBe(0);
      expect(designPreview.text).toContain("| local | opening-title |");
      const textPreview = await printed("text", [...base, "--jev-preview"], []);
      expect(textPreview.exit).toBe(0);
      expect(textPreview.text).toContain("| local | opening-title |");
      const stoppedRequests: string[] = [];
      const stopped = await printed("design", [...base, "--send"], stoppedRequests);
      expect(stopped.exit).toBe(2);
      expect(stoppedRequests).toEqual([]);
      expect(stopped.text).not.toContain("opening-title");
      const textStopped = await printed("text", [...base, "--jev", "--send"], stoppedRequests);
      expect(textStopped.exit).toBe(2);
      expect(stoppedRequests).toEqual([]);
      expect(textStopped.text).not.toContain("opening-title");
      const sentRequests: string[] = [];
      const sent = await printed("design", [...base, "--send", "--yes"], sentRequests);
      expect(sent.exit).toBe(0);
      expect(sentRequests.length).toBeGreaterThan(0);
      expect(sent.text).toContain("| local | opening-title |");
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
    const declared = declaredTestNames();
    for (const [key, name] of Object.entries(LIMITS_SHOWN_BY_A_TEST)) {
      const [id, limit] = key.split(".");
      expect(CLAUSES.find(clause => clause.id === id)?.limits[Number(limit) - 1], `${key} is a limit`).toBeString();
      expect(declared.has(name), `${key} names a test this file declares: ${name}`).toBe(true);
    }
  });

  test("each specimen is pinned whole by a digest, so a specimen changed in one place fails", () => {
    const limits: Record<string, readonly string[]> = {};
    for (const clause of CLAUSES.filter(found => found.limits.length > 0)) {
      limits[clause.id] = [...clause.limits.keys()].map(index => digestOf(LIMIT_SPECIMENS.filter(specimen => specimen.clause === clause.id && specimen.limit === index + 1)));
    }
    expect(limits).toEqual(LIMIT_SPECIMEN_DIGESTS);
    const specimens: Record<string, string> = {};
    for (const [id, specimen] of Object.entries(SPECIMENS)) {
      specimens[id] = digestOf(specimen);
    }
    expect(specimens).toEqual(SPECIMEN_DIGESTS);
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
