// The Part 5 self-audit checklist, split into the clauses a document can fail
// one at a time, with what the audit reads of each. It is data and nothing
// else: it imports nothing and computes nothing, so no Jev answer can reach it.
//
// One rule decides what a clause is: a demand a document can fail while
// meeting the rest of its line. An "or" stays one clause. A condition or an
// exemption is written into the demand it limits, and is not a clause.
//
// A clause's needs name what a run must have for its checks to run:
//
// - markdown: the document is a Markdown file, ending in .md or .markdown.
//   The text audit reads a .txt file as plain text, and the design audit
//   does not read one.
// - jev-route: the run takes the shared Jev audit route. The design audit
//   always does. The text audit does only with --jev-preview, or with --jev
//   and --send together. Without them it runs no Jev check and plans
//   nothing, so it reports neither a missing title nor any Jev gate.
// - send: the run sends the document to Jev after agreement: the design
//   audit with --send, or the text audit with --jev and --send. A preview
//   sends nothing and receives no answer.
//
// The test of this module measures each need by running those commands with
// and without what the need names, with a stand-in for the transport.

/**
 * Every item of the self-audit checklist in `skills/iso-24495-5/SKILL.md`, in
 * order, each with its checklist line word for word and its clauses.
 *
 * A clause's state says what the audit can do with it today. Its checks name
 * the rules or Jev gates that can report on it, its needs say what a run
 * must have for those checks to run, and its limits say what the checks miss.
 * A clause with no check has no needs and no limits.
 */
export const CHECKLIST: readonly ChecklistItem[] = [
  {
    item: 1,
    line: "- [ ] **Hierarchy depth:** Are there 3 or fewer heading levels below the title?",
    clauses: [
      {
        id: "1a", demand: "The document has 3 or fewer heading levels below its title.", state: "fault",
        checks: [{ rule: "heading-depth", kind: "offline" }], needs: [],
        limits: [
          "It reports a heading deeper than level 4. It counts the absolute level, not the levels below the title, so it is exact only where the title is a level-1 heading. Under a level-2 title, a heading 3 levels below it is reported.",
        ],
      },
    ],
  },
  {
    item: 2,
    line: "- [ ] **Heading quality:** Does each heading state its section's message, or a name its genre expects, free of wordplay and of terms not yet explained?",
    clauses: [
      { id: "2a", demand: "Each heading states its section's message, or is a name its genre expects.", state: "not-read", checks: [], needs: [], limits: [] },
      { id: "2b", demand: "No heading uses wordplay.", state: "not-read", checks: [], needs: [], limits: [] },
      { id: "2c", demand: "No heading uses a term the document has not yet explained.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 3,
    line: "- [ ] **Navigation:** Does a document with 6 or more sections carry a table of contents worded identically to its headings?",
    clauses: [
      {
        id: "3a", demand: "A document with 6 or more sections carries a table of contents.", state: "fault",
        checks: [{ rule: "contents-list", kind: "offline" }], needs: ["markdown"],
        limits: [
          "It reads only a document with 6 or more level-2 headings outside any list or quotation, and counts those headings as its sections.",
          "Under a heading worded Contents, Table of contents, TOC or Key sections, a list item or table body row outside any quotation can satisfy it even when it is not a link, such as `- bananas`. One holding only hyphens, colons, vertical bars or white space does not, such as the body row `| - |` or the item `- :`, though it still renders. A paragraph there usually satisfies it when it holds a link to a fragment and nothing else but links, white space, commas, semicolons, vertical bars or slashes, though a link whose title holds a closing parenthesis, such as `[Install](#install \"Step (1)\")`, often stops it. Links are read by their written shape on each line, not as they render, so text in square brackets often counts as a link even when it renders as plain text: `[Install](#install) [draft]`, with no definition for `[draft]`, satisfies it, while `[Install](#install) draft` does not. A link whose text runs over a line is not taken as one. A paragraph such as `Install` or `Read [Install](#install).` does not satisfy it.",
          "So, usually, do two or more links to fragments in the opening, outside any quotation, even when neither reaches a heading, if they sit in one list, in the body rows of one table, or in one paragraph that would count under a contents heading. Links are read by their written shape on each line, not as they render: a paragraph such as `[One](#one), [Two](#two) [draft]`, with no definition for `[draft]`, satisfies it, while `[One](#one), [Two](#two) draft` does not, and a link whose text runs over a line, or whose fragment holds a malformed escape such as `#%zz`, is not counted. Two links in a sentence such as `Read [One](#one) and [Two](#two).`, in a table's header row, or in two separate paragraphs, do not. It does not check that every section is listed.",
        ],
      },
      {
        id: "3b", demand: "The table of contents is worded identically to the headings.", state: "fault",
        checks: [{ rule: "contents-list", kind: "offline" }], needs: ["markdown"],
        limits: [
          "It compares only links that reach a level-2 section by fragment, outside any quotation and any table's header row. Such a link is usually compared under a contents heading, or among two or more links to fragments in one list, table or paragraph of the opening, but not when its text runs over a line, nor when it is an inline link with a title, such as `[Wrong](#one \"Step\")`. In a paragraph, in either place, it is compared only when the paragraph holds nothing but links, white space, commas, semicolons, vertical bars or slashes. Links are read here by their written shape on each line, not as they render, so text in square brackets often counts as a link even when it renders as plain text, such as `[draft]` with no definition or `[Begin](#two junk)`: under a contents heading, `[Wrong](#one) [draft]` is compared, while `[Wrong](#one) draft` is not. An entry that is not a link, or a link that reaches no level-2 section, is not compared.",
          "It reads only a document with 6 or more level-2 headings outside any list or quotation.",
        ],
      },
    ],
  },
  {
    item: 4,
    line: "- [ ] **Numbering:** Are headings numbered only where a reader must cite one by its identifier?",
    clauses: [
      { id: "4a", demand: "Headings are numbered only where a reader must cite one by its identifier.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 5,
    line: "- [ ] **Chunking:** Does each chunk carry one idea, separated from the next by a blank line?",
    clauses: [
      { id: "5a", demand: "Each chunk carries one idea.", state: "not-read", checks: [], needs: [], limits: [] },
      { id: "5b", demand: "Each chunk is separated from the next by a blank line.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 6,
    line: "- [ ] **Structure fit:** Are sequences in ordered lists, sets in bullets, and forks in a decision table or labelled conditions, with a legal document's clause identifiers exempt?",
    clauses: [
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
    ],
  },
  {
    item: 7,
    line: "- [ ] **Comparisons:** Is the table tested at a named target width, or are labelled records used because no width is named?",
    clauses: [
      { id: "7a", demand: "A table is tested at a named target width, or labelled records are used because no width is named.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 8,
    line: "- [ ] **Restraint:** Is every bulleted item one paragraph on one idea, nested no deeper than 2 levels, with longer material promoted to a subsection?",
    clauses: [
      { id: "8a", demand: "Each bulleted item is one paragraph.", state: "not-read", checks: [], needs: [], limits: [] },
      { id: "8b", demand: "Each bulleted item holds one idea.", state: "not-read", checks: [], needs: [], limits: [] },
      {
        id: "8c", demand: "Bulleted items are nested no deeper than 2 levels.", state: "fault",
        checks: [{ rule: "bullet-depth", kind: "offline" }], needs: ["markdown"],
        limits: ["It counts the unordered list items an item sits in, itself included, and reports a depth above 2. It counts across a quotation but not an ordered list, so a bullet beneath an ordered item beneath a bullet has depth 2 and passes."],
      },
      { id: "8d", demand: "Longer material is promoted to a subsection.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 9,
    line: "- [ ] **Callouts:** Does each change what the reader does, with adjacent ones merged and each named in a word?",
    clauses: [
      { id: "9a", demand: "Each callout changes what the reader does.", state: "not-read", checks: [], needs: [], limits: [] },
      { id: "9b", demand: "Adjacent callouts are merged.", state: "not-read", checks: [], needs: [], limits: [] },
      { id: "9c", demand: "Each callout is named in a word.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 10,
    line: "- [ ] **Signal consistency:** Does each device carry one meaning, no two devices carry the same meaning, and no meaning ride on a device alone?",
    clauses: [
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
    ],
  },
  {
    item: 11,
    line: "- [ ] **Alternatives:** Is a text alternative present only beside a picture or diagram, or beside a table whose headers miss values or whose order breaks the comparison?",
    clauses: [
      { id: "11a", demand: "A text alternative is present only beside a picture or diagram, or beside a table whose headers miss values or whose order breaks the comparison.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 12,
    line: "- [ ] **Links and images:** Does link text name its destination, does a meaningful image say what it shows, and is a decorative one marked as decorative?",
    clauses: [
      {
        id: "12a", demand: "Link text names its destination.", state: "fault",
        checks: [{ rule: "link-text", kind: "offline" }], needs: [],
        limits: [
          "It reports empty link text, a bare web address, and a fixed list of vague labels such as `click here`. Any other text is taken to name its destination, even when it names the wrong one.",
          "A Markdown link whose destination starts on a later line is not read, though it still renders as a link. One whose title runs onto a later line is often not read either, but it can be read when a closing parenthesis follows on its first line, as `[click here](repair.md \"Repair (advanced)` is when `manual\")` ends the next line. A reference link whose text runs over a line is often not read, though in `[click` followed by `here][here]` the second line is read as the link `[here]`. An inline link whose text alone runs over a line is read.",
        ],
      },
      {
        id: "12b", demand: "A meaningful image says what it shows.", state: "fault",
        checks: [{ rule: "image-alt", kind: "offline" }], needs: [],
        limits: [
          "It usually reports a Markdown image with empty alternative text and an HTML image with no alt attribute, though text elsewhere in an HTML image's tag can pass for one, such as `data-alt=\"\"`, and then the image is not reported. An HTML image with `alt=\"\"` is taken as decorative and is not reported, even when it is meaningful, but one with a bare `alt`, which HTML also reads as empty, is reported. A Markdown image written inline with the title decorative is usually taken as decorative and is not reported, but one whose destination or title holds a closing parenthesis, such as `![](chart(1).png \"decorative\")` or `![](chart.png (decorative))`, is often reported even so.",
          "It cannot tell whether the text it finds says what the image shows. Any alternative text passes.",
          "A Markdown image whose destination starts on a later line is not read, though it still renders as an image, so an image written that way with empty alternative text is not reported. One whose title runs onto a later line, such as `![](chart.png` followed by `\"Chart\")`, is often not reported either.",
        ],
      },
      {
        id: "12c", demand: "A decorative image is marked as decorative.", state: "fault",
        checks: [{ rule: "image-alt", kind: "offline" }], needs: [],
        limits: [
          "It usually reports a Markdown image with empty alternative text, though usually not one written inline with the title decorative. One whose destination or title holds a closing parenthesis, such as `![](decoration(1).png \"decorative\")`, is often reported even with that title. A reference image is reported even when its definition's title is decorative, so that way of marking it is not recognised.",
          "An HTML image with `alt=\"\"` is taken as marked, but one with a bare `alt`, which HTML also reads as empty, is reported.",
          "An image with any alternative text is taken as meaningful, so a decorative image described in words passes.",
          "A Markdown image whose destination starts on a later line is not read, so an unmarked decorative image written that way is not reported. One whose title runs onto a later line, such as `![](decoration.png` followed by `\"Swirl\")`, is often not reported either.",
        ],
      },
    ],
  },
  {
    item: 13,
    line: "- [ ] **Tables heard:** Does every table carry a header row, with headers that identify each value beneath them?",
    clauses: [
      { id: "13a", demand: "Every table carries a header row.", state: "not-read", checks: [], needs: [], limits: [] },
      {
        id: "13b", demand: "Each header identifies the values beneath it.", state: "fault",
        checks: [{ rule: "table-header", kind: "offline" }], needs: [],
        limits: [
          "It reports a pipe table whose header has an empty column name. A header with any wording is taken to identify its values, and HTML tables are not read.",
          "It takes any line holding a pipe, followed by a line of dashes, as a table header, so it can report text that is not a table.",
        ],
      },
    ],
  },
  {
    item: 14,
    line: "- [ ] **Reading order:** Does document order match reading order, with each sidebar and displaced callout given its own heading?",
    clauses: [
      { id: "14a", demand: "Document order matches reading order.", state: "not-read", checks: [], needs: [], limits: [] },
      { id: "14b", demand: "Each sidebar and displaced callout is given its own heading.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 15,
    line: "- [ ] **Opening block:** Does the document open with its title, a one-line purpose naming the reader's task and scope, the primary audience, and a version or date?",
    clauses: [
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
        needs: ["markdown", "jev-route", "send"],
        limits: [
          "A fail says the opening does not name both the task and the scope. On its own it does not say which is missing, so it does not say whether 15c or 15d failed. A diagnosis of neither says both are missing.",
          "It can fail an opening or stay unsure, and never passes one.",
        ],
      },
      {
        id: "15d", demand: "The purpose names its scope.", state: "fault",
        checks: [{ rule: "purpose:fail", kind: "jev" }, { rule: "purpose:diagnosis:neither", kind: "jev" }],
        needs: ["markdown", "jev-route", "send"],
        limits: [
          "A fail says the opening does not name both the task and the scope. On its own it does not say which is missing, so it does not say whether 15c or 15d failed. A diagnosis of neither says both are missing.",
          "It can fail an opening or stay unsure, and never passes one.",
        ],
      },
      { id: "15e", demand: "The opening names the primary audience.", state: "not-read", checks: [], needs: [], limits: [] },
      {
        id: "15f", demand: "The opening gives a version or date.", state: "fault",
        checks: [{ rule: "opening-version-date", kind: "offline" }], needs: ["markdown"],
        limits: [
          "It asks a question as an advisory, rather than stating a fault.",
          "It needs a level-1 title. README, CONTRIBUTING, SECURITY and PULL_REQUEST_TEMPLATE files are exempt, and it is off when front matter is read as text.",
          "It recognises a version or date only in set forms, such as a Version or Date field, a title suffix or a front matter field. In front matter that begins on the first line, a key named version, date, updated or last_updated, in any letter case, silences it when its value is a finite number or text that is not blank, even `version: banana`. The key counts at the top level, or directly under a key named `metadata` in lower case, and under no other key, such as `release`. A value of true or false, a list or a nested map does not count.",
        ],
      },
    ],
  },
  {
    item: 16,
    line: "- [ ] **Overview contents:** Where needed, does it keep the conclusion, the required action and every essential qualification?",
    clauses: [
      { id: "16a", demand: "Where an overview is needed, it keeps the conclusion.", state: "not-read", checks: [], needs: [], limits: [] },
      { id: "16b", demand: "Where an overview is needed, it keeps the required action.", state: "not-read", checks: [], needs: [], limits: [] },
      { id: "16c", demand: "Where an overview is needed, it keeps every essential qualification.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 17,
    line: "- [ ] **Overview label and detail:** Is the label a heading rather than bold text alone, and has the detail moved to footnotes, an appendix or a collapsible block?",
    clauses: [
      {
        id: "17a", demand: "The overview label is a heading, not bold text alone.", state: "fault",
        checks: [{ rule: "overview-label", kind: "offline" }], needs: ["markdown"],
        limits: [
          "It reads only a document with 6 or more level-2 sections.",
          "It asks for a heading worded exactly Overview or Summary before the first content section. It does not recognise an overview under any other label, such as Executive overview or At a glance, and it also fires on a document with no overview at all.",
        ],
      },
      { id: "17b", demand: "The detail has moved to footnotes, an appendix or a collapsible block.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 18,
    line: "- [ ] **Levels:** Are there 3 or fewer levels of detail, and is the optional detail still reachable?",
    clauses: [
      { id: "18a", demand: "There are 3 or fewer levels of detail.", state: "not-read", checks: [], needs: [], limits: [] },
      { id: "18b", demand: "The optional detail is still reachable.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 19,
    line: "- [ ] **Signposting:** Is the referral near the top or ending the opening section, naming its destination and when to use it, and absent where nothing else exists?",
    clauses: [
      { id: "19a", demand: "The referral is near the top or ends the opening section.", state: "not-read", checks: [], needs: [], limits: [] },
      {
        id: "19b", demand: "The referral names its destination.", state: "fault",
        checks: [{ rule: "link-text", kind: "offline" }], needs: [],
        limits: [
          "It reads link text only. It reports a link whose text is empty, a bare web address, or one of a fixed list of vague labels such as `here`. Any other text is taken to name its destination, even when it names the wrong one.",
          "It cannot tell a referral from any other link, and a referral written without a link is not read.",
          "A Markdown link whose destination starts on a later line is not read, though it still renders as a link. One whose title runs onto a later line is often not read either, but it can be read when a closing parenthesis follows on its first line, as `[click here](repair.md \"Repair (advanced)` is when `manual\")` ends the next line. A reference link whose text runs over a line is often not read, though in `[click` followed by `here][here]` the second line is read as the link `[here]`. An inline link whose text alone runs over a line is read.",
        ],
      },
      { id: "19c", demand: "The referral says when to use its destination.", state: "not-read", checks: [], needs: [], limits: [] },
      { id: "19d", demand: "There is no referral where nothing else exists.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 20,
    line: "- [ ] **Preserved:** On a restructure, was every prose passage and content item kept, with no prose rewritten and no tone changed?",
    clauses: [
      { id: "20a", demand: "On a restructure, every prose passage and content item is kept.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
      { id: "20b", demand: "On a restructure, no prose is rewritten.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
      { id: "20c", demand: "On a restructure, the tone is unchanged.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 21,
    line: "- [ ] **Safe moves:** Did every moved sentence or block keep its dependencies, its order against neighbouring steps, and the claim it qualifies?",
    clauses: [
      { id: "21a", demand: "Every moved sentence or block keeps its dependencies.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
      { id: "21b", demand: "Every moved sentence or block keeps its order against neighbouring steps.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
      { id: "21c", demand: "Every moved sentence or block keeps the claim it qualifies.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 22,
    line: "- [ ] **Never invented:** Did every promoted sentence come unchanged from the document or the author, state its field directly, stay true and complete, with mismatches reported and gaps marked?",
    clauses: [
      { id: "22a", demand: "Every promoted sentence comes unchanged from the document or the author.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
      { id: "22b", demand: "Every promoted sentence states its field directly.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
      { id: "22c", demand: "Every promoted sentence stays true.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
      { id: "22d", demand: "Every promoted sentence stays complete.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
      { id: "22e", demand: "Every mismatch is reported.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
      { id: "22f", demand: "Every gap is marked.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 23,
    line: "- [ ] **Content primacy:** Did accuracy and completeness survive every structural choice, with nothing cut or distorted to fit a layout?",
    clauses: [
      { id: "23a", demand: "Accuracy survives every structural choice, with nothing distorted to fit a layout.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
      { id: "23b", demand: "Completeness survives every structural choice, with nothing cut to fit a layout.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 24,
    line: "- [ ] **Evidence over aesthetics:** Does every design element serve a reader need?",
    clauses: [
      { id: "24a", demand: "Every design element serves a reader need.", state: "not-checkable", checks: [], needs: [], limits: [] },
    ],
  },
  {
    item: 25,
    line: "- [ ] **Provisional label:** Where the document cites Part 5, does it say the standard is an unpublished draft?",
    clauses: [
      { id: "25a", demand: "Where the document cites Part 5, it says the standard is an unpublished draft.", state: "not-read", checks: [], needs: [], limits: [] },
    ],
  },
];

/** One item of the checklist: its number, its line word for word, and its clauses in the order the line states them. */
export interface ChecklistItem {
  readonly item: number;
  readonly line: string;
  readonly clauses: readonly Clause[];
}

/** One demand of a checklist line, and what the audit reads of it. */
export interface Clause {
  /** The item number and a letter, such as 15a, in the order of the line. */
  readonly id: string;
  /** The demand in one sentence, with any condition or exemption it carries. */
  readonly demand: string;
  readonly state: ClauseState;
  /** Empty unless the state is fault or pass-only. */
  readonly checks: readonly Check[];
  /** What a run must have for the checks to run. Empty when no check needs anything, or there is no check. */
  readonly needs: readonly Need[];
  /** What the checks miss, in plain words. */
  readonly limits: readonly string[];
}

/**
 * What the audit can do with a clause today.
 *
 * - `fault`: a check can report that a document fails it.
 * - `pass-only`: a check can confirm it, and never reports a fault.
 * - `not-read`: no check looks at it.
 * - `needs-two-versions`: it can be read only against the original of a restructured document.
 * - `not-checkable`: it is a judgement the document gives no means to check.
 */
export type ClauseState = "fault" | "pass-only" | "not-read" | "needs-two-versions" | "not-checkable";

/**
 * A rule or a Jev gate that can report on a clause. An offline rule is named
 * as its findings name it. A Jev gate is named by its identifier in the
 * calibration record.
 */
export interface Check {
  readonly rule: string;
  readonly kind: "offline" | "jev";
}

/**
 * One thing a run must have for a check to run: a Markdown file, the shared
 * Jev audit route, a send to Jev, the original version, or a fact the author
 * declared. The comment at the top of this module says which commands meet
 * the first three.
 */
export type Need = "markdown" | "jev-route" | "send" | "before" | `fact:${string}`;
