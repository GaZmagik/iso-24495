// The Part 5 self-audit checklist, split into the clauses a document can fail
// one at a time, with what the audit reads of each. It is data and nothing
// else: it imports nothing and computes nothing, so no Jev answer can reach it.
//
// One rule decides what a clause is: a demand a document can fail while
// meeting the rest of its line. An "or" stays one clause. A condition or an
// exemption is written into the demand it limits, and is not a clause.

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
        limits: ["It reports a heading deeper than level 4. It counts the absolute level, not the levels below the title, so it is exact only where the title is a level-1 heading."],
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
          "It counts as sections the level-2 headings outside any list or quotation.",
          "One contents entry, or two linked headings in one block of the opening, satisfies it. It does not check that every section is listed.",
        ],
      },
      {
        id: "3b", demand: "The table of contents is worded identically to the headings.", state: "fault",
        checks: [{ rule: "contents-list", kind: "offline" }], needs: ["markdown"],
        limits: ["It compares only entries that link by fragment to a level-2 section, and only in a document with 6 or more such sections."],
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
          "It reports a prose block holding rank 1 and at least 3 ranks, written as ordinal words such as `first` or as the numbers 1 to 6. A sequence written any other way is not read.",
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
        checks: [{ rule: "bullet-depth", kind: "offline" }], needs: ["markdown"], limits: [],
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
        checks: [{ rule: "colour_only:pass", kind: "jev" }], needs: ["markdown", "design", "send"],
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
        limits: ["It reports empty link text, a bare web address, and a fixed list of vague labels such as `click here`. Any other text is taken to name its destination."],
      },
      {
        id: "12b", demand: "A meaningful image says what it shows.", state: "fault",
        checks: [{ rule: "image-alt", kind: "offline" }], needs: [],
        limits: ["It reports an image with no alternative text. It cannot tell whether the text it finds says what the image shows."],
      },
      {
        id: "12c", demand: "A decorative image is marked as decorative.", state: "fault",
        checks: [{ rule: "image-alt", kind: "offline" }], needs: [],
        limits: ["It reports a Markdown image with empty alternative text unless its title is the word decorative. An HTML image with an empty alt attribute is taken as marked."],
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
        limits: ["It reports a pipe table whose header has an empty column name. HTML tables are not read, and a header with any wording is taken to identify its values."],
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
        checks: [{ rule: "opening-title", kind: "offline" }], needs: ["markdown", "design"],
        limits: [
          "The design audit reads it. The text audit does not.",
          "It reports only a document with no level-1 heading anywhere. A title that does not come first is not reported.",
          "A preview does not print it. The report printed after a send does.",
        ],
      },
      { id: "15b", demand: "The purpose is one line.", state: "not-read", checks: [], needs: [], limits: [] },
      {
        id: "15c", demand: "The purpose names the reader's task.", state: "fault",
        checks: [{ rule: "purpose:fail", kind: "jev" }, { rule: "purpose:diagnosis:neither", kind: "jev" }],
        needs: ["markdown", "design", "send"],
        limits: [
          "A fail says the opening does not name both the task and the scope. It does not say which is missing, unless the diagnosis is neither.",
          "It can fail an opening or stay unsure, and never passes one.",
        ],
      },
      {
        id: "15d", demand: "The purpose names its scope.", state: "fault",
        checks: [{ rule: "purpose:fail", kind: "jev" }, { rule: "purpose:diagnosis:neither", kind: "jev" }],
        needs: ["markdown", "design", "send"],
        limits: [
          "A fail says the opening does not name both the task and the scope. It does not say which is missing, unless the diagnosis is neither.",
          "It can fail an opening or stay unsure, and never passes one.",
        ],
      },
      { id: "15e", demand: "The opening names the primary audience.", state: "not-read", checks: [], needs: [], limits: [] },
      {
        id: "15f", demand: "The opening gives a version or date.", state: "fault",
        checks: [{ rule: "opening-version-date", kind: "offline" }], needs: ["markdown"],
        limits: [
          "It asks a question rather than stating a fault.",
          "It needs a level-1 title. README, CONTRIBUTING, SECURITY and PULL_REQUEST_TEMPLATE files are exempt, and it is off when front matter is read as text.",
          "It recognises a version or date only in set forms, such as a Version or Date field, a title suffix or a front matter field.",
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
          "It asks for a heading worded Overview or Summary before the first content section. It also fires on a document with no overview at all, and does not recognise an overview under any other label.",
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
      { id: "19b", demand: "The referral names its destination.", state: "not-read", checks: [], needs: [], limits: [] },
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
 * One thing a run must have for a check to run: a Markdown file, the design
 * audit, a send to Jev, the original version, or a fact the author declared.
 */
export type Need = "markdown" | "design" | "send" | "before" | `fact:${string}`;
