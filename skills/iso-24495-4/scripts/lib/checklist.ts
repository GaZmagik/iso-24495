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
          "It reads Markdown headings and reports those deeper than level 4. It counts the absolute level, not the levels below the title, so under a level-2 title a heading 3 levels below it is reported. An HTML heading such as `<h5>Deep</h5>` is not reported, while a `#####` line inside an HTML block such as `<div>` can be, though it shows as text.",
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
          "It reads a document only when it counts 6 or more level-2 headings outside any Markdown list or quotation, and takes those as its sections. It does not count an HTML heading such as `<h2>Six</h2>`, but it can count a `##` line that shows as text, such as one inside an HTML block like `<div>`. It can also count a heading inside an HTML `<blockquote>`.",
          "Under a contents heading, such as Contents or Table of contents, a list item or table body row outside any Markdown quotation can satisfy it even when it is not a link, such as `- bananas`. So can one inside an HTML `<blockquote>`. Some entries that render do not, such as `- :` or the row `| - |`. A paragraph there can satisfy it when it holds a link to a fragment and little else, such as `[Install](#install)`, and text in square brackets can count as a link, as in `[Install](#install) [draft]`. Other words can stop it, as in `Install` or `Read [Install](#install).`, and so can a link whose title holds a parenthesis, such as `[Install](#install \"Step (1)\")`, or whose text runs over a line.",
          "Two or more links to fragments in the opening, outside any Markdown quotation, can also satisfy it, even when neither reaches a heading, if they sit in one list, in the body rows of one table, or in one paragraph that would count under a contents heading. So can a list inside an HTML `<blockquote>`. Some are not counted, such as a link whose text runs over a line or one whose fragment holds a malformed escape such as `#%zz`. A link with a title in brackets, such as `[One](#one (Hint))`, can be counted in a list or in a table's body rows, but it can stop a whole paragraph counting, so `[One](#one (Hint)), [Two](#two), [Three](#three)` does not satisfy it. `Read [One](#one) and [Two](#two).` as a paragraph does not satisfy it, though the same sentence in a list item can. Two links in a table's header row do not, nor do `[One](#one)` and `[Two](#two)` as two separate paragraphs outside a list. In a reference link whose text runs over a line, such as `- [One` followed by `x][o]`, the second line's `[o]` can be read as a link of its own. It does not check that every section is listed.",
        ],
      },
      {
        id: "3b", demand: "The table of contents is worded identically to the headings.", state: "fault",
        checks: [{ rule: "contents-list", kind: "offline" }], needs: ["markdown"],
        limits: [
          "It can compare links that reach a level-2 section by fragment, under a contents heading or among two or more links to fragments in one list, table or paragraph of the opening. Some such links are not compared, such as one with a title like `[Wrong](#one \"Step\")`, an inline link whose text runs over a line, or one in a Markdown quotation or a table's header row, though one inside an HTML `<blockquote>` can be compared. A paragraph outside a list or table can be compared when, apart from what it reads as links, it holds little else. Some syntax does not stop it, such as the escaped full stop `\\.`, a code span holding `!` or an HTML comment, even one holding words, but other words can, so `See [Wrong](#one).` is not compared. Text in square brackets can count as a link for this, as in `[Wrong](#one) [draft]` or `[Begin](#two junk)`. In a reference link whose text runs over a line, such as `- [Wrong` followed by `x][w]`, the second line's `[w]` can be compared instead. An entry that is not a link, or a link to a fragment that matches none of its sections, such as `#missing`, is not compared.",
          "It reads a document only when it counts 6 or more level-2 headings outside any Markdown list or quotation. It can count a `##` line that shows as text, such as one inside an HTML block like `<div>`, and a heading inside an HTML `<blockquote>`.",
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
          "It can report a prose block that holds rank 1 among at least 3 ranks, written as ordinal words such as `first` or as the numbers 1 to 6 in forms such as `1.` or `(1)`. It misses some, such as `Steps (1), (2) and (3) are required.`, where punctuation touches the numbers, or `**(1)**` in a block that also holds a link. It does not report `Open the box, then lift the lid, then read the note.`, nor the same steps written as separate bullets. It cannot tell a numbered set from a sequence, so `Bring: (1) gloves, (2) goggles and (3) boots.` is reported as well.",
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
        limits: [
          "It can report a Markdown bullet nested more than 2 unordered list items deep, counting the item itself. It counts across a quotation but not an ordered list, so a bullet beneath an ordered item beneath a bullet has depth 2 and passes. It misses some lists that render nested, such as nested HTML `<ul>` lists, or `-` above `  -` above `    - Three`.",
        ],
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
          "It judges colour only. The block request also asks about position, but the result does not use that answer, and shape and other devices are not asked about.",
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
          "It can report a Markdown image with empty alternative text. The inline title decorative can mark it, as in `![](decoration.png \"decorative\")`, but a parenthesis in the destination can stop that, so `![](decoration(1).png \"decorative\")` is reported. A decorative title in a reference definition does not mark it, so `![][dec]` with `[dec]: decoration.png \"decorative\"` is reported. It skips some images that render, such as `![]()`, or `![][dec]` when a tab, not a space, separates the parts of its definition.",
          "`<img src=\"decoration.png\" alt=\"\">` is taken as marked, but `<img src=\"decoration.png\" alt>`, which HTML also reads as empty, is reported.",
          "A decorative image described in words can pass, such as `![Blue swirl](decoration.png)`.",
          "Some images that run over a line are not reported, though they still render, such as `![](` with the destination on the next line, or `![](decoration.png` with `\"Swirl\")` on the next line.",
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
          "It can report a pipe table whose header has an empty column name, such as `| Name | |`. A cell that renders blank, such as `&#32;`, can pass, and a header cell holding a code span with an escaped pipe can be reported. A header with wording, such as `| Thing | Stuff |`, can pass whatever the wording says. It does not read an HTML table as a table, so `<th></th>` is not reported.",
          "It can take a line holding a pipe, followed by a line of dashes, as a table header, so it can report text that is not a table, such as `plain text |` above `---`, or a line of an HTML table.",
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
          "It can report a document with no Markdown level-1 heading. A document whose title does not come first is not reported, as when `Read this first.` comes above `# Guide`. An HTML title such as `<h1>Guide</h1>` is not read, so a document titled only that way can be reported.",
          "A preview of either audit prints it. A send that stops before it sends, such as one given no agreement, does not print it.",
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
          "It needs a Markdown level-1 title, though not every one counts, such as `> # Guide`. It does not read an HTML title such as `<h1>Guide</h1>`, but it can take a `#` line that shows as text, such as one inside an HTML block like `<div>`, as one. A file named README, CONTRIBUTING, SECURITY or PULL_REQUEST_TEMPLATE is exempt, with or without an extension, even a two-part one such as `README.fr.md`. So can one in another letter case, such as `readme.MD`, but a longer name such as `README-fr.md` is not. It is off when front matter is read as text.",
          "It recognises a version or date in set forms, such as `Version: 1.2`, `Date: 3 March 2026`, a title suffix such as `(Version 1.2)`, or a front matter field. Some forms are not recognised, such as `Version: 2`, `Version: banana` or the title suffix `(2.0)`. In front matter that begins on the first line and parses as YAML, a key named version, date, updated or last_updated, in any letter case, can silence it when its value is a finite number or text that is not blank, even `version: banana` or the quoted `'true'`. The key counts at the top level, or directly under a key named `metadata` in lower case, but not under another key such as `release`. A value YAML reads as true or false, a list or a map does not count, and a block that does not parse, such as one holding `title: [unclosed`, does not silence it.",
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
          "It reads a document only when it counts 6 or more level-2 headings outside any Markdown list or quotation. It can count a `##` line that shows as text, such as one inside an HTML block like `<div>`, and a heading inside an HTML `<blockquote>`.",
          "It asks for a heading worded Overview or Summary before the first content section, and fires on a document with no overview heading at all, though it can take a `## Overview` line that shows as text, such as one inside an HTML block like `<div>`, as one. It can accept other letter cases and a leading number, such as `## 1. OVERVIEW`, but not other wording, such as Executive overview, At a glance or `## 1) OVERVIEW`, nor an HTML heading such as `<h2>Overview</h2>`, nor a heading inside a Markdown list or quotation, such as `> ## Overview`.",
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
          "It judges link text. It can report a link whose text is empty, a bare web address, or one of a fixed list of vague labels such as `here`. It skips some links that render, such as `[here]()` or the autolink `<https://example.org>`, and it removes some marks first, so `[h_ere](x)` is reported as `here`. Other text can pass even when it names the wrong destination, such as `[installation guide](install.md)`.",
          "It cannot tell a referral from any other link. A referral written without a link, such as `read here: repair.md`, is not read, but an HTML tag that is not a link, such as `<a data-href=\"repair.md\">here</a>`, can be read as one.",
          "Some links that run over a line are not read, though they still render, such as `[here](` with the destination on the next line, `[here](repair.md` with `\"Repair\")` on the next line, or `[click` with `here][r]` on the next line. Some are read, such as `[click` with `here](repair.md)` on the next line, or `[click here](repair.md \"Repair (advanced)` with `manual\")` on the next. In `[click` with `here][here]` on the next line, the second line is read as the link `[here]`.",
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
