import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli as runDesignCli } from "../../../iso-24495-design-audit/scripts/design-audit.ts";
import { runCli as runTextCli } from "../../../iso-24495-text-audit/scripts/audit-text.ts";
import { auditText } from "../../scripts/audit-corpus.ts";
import { compareVersions } from "../../scripts/lib/restructure.ts";
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
  "fault": 25,
  "pass-only": 1,
  "not-read": 30,
  "needs-two-versions": 7,
  "not-checkable": 1,
};

/** How many clauses are in the fault state, each of which the option sweep reads. */
const FAULT_CLAUSES = 25;

/** The limit 20a and 23b share on what the comparison reads, because one check reads both. */
const UNITS_READ_LIMIT = "It reads the sentences of paragraphs, list items, quotations, table cells and headings, the contents of code blocks, and the alternative text of Markdown images. "
  + "It does not read front matter unless it is read as text, a raw HTML block such as `<pre>`, or the alternative text of an HTML image. "
  + "A heading that is gone is counted, not reported, so wording held only in a heading can go unreported. "
  + "A hard line break inside a heading underlined on the next line reads as a backslash, so that heading is counted as new and as gone.";

/** The limit 20a and 23b share on the words compared. */
const WORDS_SEEN_LIMIT = "It compares the words a reader sees, so a changed link destination or image source is not reported, as when `[guide](a.md)` becomes `[guide](b.md)`. "
  + "Nor is a strike through words that stay, as when `the valve` becomes `the ~~valve~~`, because struck words are still on the page.";

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
  {
    id: "9b", demand: "Adjacent callouts are merged.", state: "fault",
    checks: [{ rule: "adjacent-alerts", kind: "offline" }], needs: ["markdown"],
    limits: [
      "It reads a GitHub alert as a callout: a quotation outside every list and quotation whose first line is its marker alone, such as `> [!NOTE]`, with only spaces or tabs after it. The marker may name `NOTE`, `TIP`, `IMPORTANT`, `WARNING` or `CAUTION`, in any letter case. Other callouts are not read, such as a bold `**Note:**` line, an HTML `<div>` or an admonition such as `!!! note`.",
      "It reports an alert that follows an alert of the same kind with only blank lines between, on the later alert's marker line, so three in a row give two findings. Alerts of different kinds are not reported, even with nothing between them, such as a `NOTE` and then a `WARNING`. Nor are alerts with anything else between them, such as a paragraph, a comment, a link definition, a thematic break or a zero-width space.",
      "It reports only alerts it is sure of, so some adjacent alerts are not reported. One example is an alert straight below a line that is not blank, such as a heading or `<div>`. Another is an alert whose next line is not text in it, such as `> ---`, `>`, `> |---|` or `> <b>Note</b> said.`. So is an alert with an underline or a row of dashes, such as `> ===` or `> ---`, on any line up to the next blank line. So is an alert with text after its marker. So is every alert of a kind the text also defines as a link label, such as `[!NOTE]: notes.md`. So is every alert below a line that holds a `<`, as all HTML starts with one. A `<` counts wherever it stands: in closed HTML such as `<kbd>Ctrl</kbd>`, in a comment, in code, or in text such as `a < b`. So is every alert below a line that opens an empty quotation or list item, such as `> >`, `>>`, `-` or `> 1.`. That is a line of only markers, spaces and tabs that holds a list marker or two or more `>`, though a lone `>` does not count. Such a line counts wherever it stands, in code too and as a thematic break such as `- - -`.",
      "It does not read what the alerts say, so two alerts on unrelated subjects are reported, though the clause asks to merge only those serving one purpose.",
    ],
  },
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
    checks: [{ rule: "image-alt", kind: "offline" }, { rule: "generic-alt", kind: "offline" }], needs: [],
    limits: [
      "It can report a Markdown image with empty alternative text and a HyperText Markup Language (HTML) image with no alt attribute. It skips some that render, such as `![]()`, and other text in an HTML tag can pass for an alt attribute, such as `data-alt=\"\"`. `<img src=\"chart.png\" alt=\"\">` is taken as decorative and not reported, even when the image is meaningful, but `<img src=\"chart.png\" alt>` is reported. A title reading decorative marks a Markdown image as decorative only in this form: `![](chart.png \"decorative\")`, or `![][c]` with `[c]: chart.png \"decorative\"` on a line of its own. In that form nothing stands between the brackets of `![]`, and one space comes before the title. In a heading a tab can stand there instead, though only Bun's renderer then shows an image. The title can be in any letter case, in double or single quotes. The destination holds no space, quote, backslash, angle bracket or parenthesis, and no Unicode space, separator, control or format character. Nor does it hold a lone surrogate, which is half of a pair of code units that encode one character. Only a string passed to the audit from code can hold one. Nothing on the image's line is a code span, an HTML tag or an escape. Outside a heading, no tab stands in the text of its line. A reference image comes after no other image syntax in its paragraph. Its definition starts its line and has one space after the colon. Its label holds only American Standard Code for Information Interchange (ASCII) letters and digits, spaces, hyphens and underscores. No other text in the document is shaped like a definition, as `[x]:` is, with a label of the same ASCII letters and digits. Nor is any text shaped like one with a label holding a character beyond ASCII. Written any other way, an image with empty alternative text and that title is still reported, even where a renderer shows the title. The exceptions are the images this limit and the one on lines say are skipped. To clear such a finding, write the image in the form above. The reported spellings named next are examples, not a complete list. Images still reported include `![](chart(1).png \"decorative\")`, `![](<chart.png> \"decorative\")` and `![](chart.png (decorative))`. So are `![](chart.png  \"decorative\")` with two spaces, `![](chart.png \"decorative\" )` and `![](my'chart.png \"decorative\")`. So is a destination holding a no-break space, the next-line character, a zero-width space or a lone surrogate. So is a title written with a character reference, such as `![](chart.png \"&#100;ecorative\")`, which renderers read as decorative. So is an image on a line with a code span, an HTML tag or an escape, as in `<b>bold</b> ![](chart.png \"decorative\")`. Bun's renderer, though not the CommonMark reference, shows the title in `![](my\\ chart.png \"decorative\")`, and in a paragraph where a tab comes before the title. Both are reported. A reference image is reported when its definition's title is on the line below, or when other image syntax comes before it, as in `![x](a.png) ![][c]`. So is one beside another definition that could match its label, such as `[C]: other.png`, or text shaped like one, such as `See [c]: here.`. So is one in a document holding `[ß]: other.png`, or `[é]:` inside a destination, as in `[c]: a[é]:b \"decorative\"`. Text shaped like that has the same effect in a paragraph, in code, in an HTML comment, in a title or in alternative text. Neither renderer reads it as a definition there. Such text does not affect an inline image. It also skips `![][c]` when a tab, not a space, separates the parts of its definition. Text that renders no image can still be reported, such as `![](<chart.png>x \"decorative\")`. Text that renders no image goes unreported when it carries such a title in a raw HTML block, or in an earlier link's destination or title. In an earlier link it looks like `[t](<a) ![][c]>)` or `[t](a 'x) ![](chart.png \"decorative\")')`.",
      "It cannot tell whether the text says what the image shows, so `![nonsense](chart.png)` passes. Text that looks like HTML can still be reported, as in `![The <img> tag](chart.png)`.",
      "Some images that run over a line are not reported, though they still render, such as `![](` with the destination on the next line, or `![](chart.png` with `\"Chart\")` on the next line.",
      "The `generic-alt` check can report alternative text that is only one word naming the kind of image, or only an image's file name. The words are image, picture, photo, screenshot, graphic, figure, diagram, icon and logo, in any letter case, so `![Logo](logo.png)` is reported. A file name holds no space, slash or backslash, and ends in `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp`, `.ico`, `.tif`, `.tiff` or `.avif`, in any letter case. So `![IMG_0042.jpg](photo.jpg)` is reported. Emphasis and code marks and spaces at either end are not read, paired or not, so `![**logo**](logo.png)` is reported too. A mark inside the text stays, so `![lo_go](logo.png)` passes. A title does not clear a finding, even a decorative one, as in `![logo](logo.png \"decorative\")`. To clear a finding, say what the image shows, as in `![Acme logo](logo.png)`. For an image that adds nothing to the text beside it, empty the alternative text and mark it decorative instead, as in `![](logo.png \"decorative\")`. The passing forms named next are examples, not a complete list. Text that says more passes, such as `an image`, `Figure 1`, `logos` or `Image:`, and so does a path such as `images/chart.png`. So does a word written with a character reference, such as `&#108;ogo`, or with a letter beyond ASCII, such as a dotted capital I in place of the I of Image.",
      "The `generic-alt` check reads Markdown images, inline or by reference, including one in a table, a link or a heading. It finds them in each line as the audit reads it, with HTML tags, code spans and escapes set aside. It finds an HTML image by its `<img` tag, and reads its alt attribute, as in `<img src=\"logo.png\" alt=\"logo\">`. It reads no other attribute, so `data-alt=\"logo\"` passes. Found this way, some spellings of an image that renders are missed, and some text that renders no image is reported. The cases named next are examples, not a complete list. It skips an image with nothing between its parentheses, such as `![logo]()`, though `![logo]( )` is read. It skips a reference image whose label has no definition, such as `![logo][l]` alone. It also skips one whose label holds HTML, a code span or an escape, as in `![logo][<b>]`, `![logo][a<b>]` or `![logo][a\\_]`, even where that label is defined. With the label `[a]` and `[a]: logo.png`, the image is reported. An image whose alternative text holds another image is read as written, so `![![logo](a.png)](b.png)` passes, though a renderer reads its alternative text as logo. It skips an image whose alternative text or destination runs over a line, such as `![logo](` with the destination on the next line. It skips an HTML image with a blank line inside its tag, and it skips code, front matter and HTML comments. It skips an HTML image in a link's destination or title, or in an image's alternative text, which a renderer shows as text, as in `[guide](a.md \"<img alt='logo'>\")`. It skips one there in a raw HTML block such as `<div>` too, where a renderer shows the image. Text that renders no image can still be reported, such as image syntax in a raw HTML block like `<div>`, or in an earlier link's destination, as in `[t](<a) ![logo](a.png)>)`. So can an `<img` tag inside another tag's attribute, as in `<span title=\"<img alt='logo'>\">`. Written as `&lt;img` there, it passes.",
    ],
  },
  {
    id: "12c", demand: "A decorative image is marked as decorative.", state: "fault",
    checks: [{ rule: "image-alt", kind: "offline" }], needs: [],
    limits: [
      "It can report a Markdown image with empty alternative text. A title reading decorative marks it as decorative only in this form: `![](decoration.png \"decorative\")`, or `![][dec]` with `[dec]: decoration.png \"decorative\"` on a line of its own. In that form nothing stands between the brackets of `![]`, and one space comes before the title. In a heading a tab can stand there instead, though only Bun's renderer then shows an image. The title can be in any letter case, in double or single quotes. The destination holds no space, quote, backslash, angle bracket or parenthesis, and no Unicode space, separator, control or format character. Nor does it hold a lone surrogate, which is half of a pair of code units that encode one character. Only a string passed to the audit from code can hold one. Nothing on the image's line is a code span, a HyperText Markup Language (HTML) tag or an escape. Outside a heading, no tab stands in the text of its line. A reference image comes after no other image syntax in its paragraph. Its definition starts its line and has one space after the colon. Its label holds only American Standard Code for Information Interchange (ASCII) letters and digits, spaces, hyphens and underscores. No other text in the document is shaped like a definition, as `[x]:` is, with a label of the same ASCII letters and digits. Nor is any text shaped like one with a label holding a character beyond ASCII. Written any other way, an image with empty alternative text and that title is still reported, even where a renderer shows the title. The exceptions are the images this limit and the one on lines say are skipped. To clear such a finding, write the image in the form above. The reported spellings named next are examples, not a complete list. Images still reported include `![](decoration(1).png \"decorative\")`, `![](<decoration.png> \"decorative\")` and `![](decoration.png (decorative))`. So are `![](decoration.png  \"decorative\")` with two spaces, `![](decoration.png \"decorative\" )` and `![](my'decoration.png \"decorative\")`. So is a destination holding a no-break space, the next-line character, a zero-width space or a lone surrogate. So is a title written with a character reference, such as `![](decoration.png \"&#100;ecorative\")`, which renderers read as decorative. So is an image on a line with a code span, an HTML tag or an escape, as in `<b>bold</b> ![](decoration.png \"decorative\")`. Bun's renderer, though not the CommonMark reference, shows the title in `![](my\\ decoration.png \"decorative\")`, and in a paragraph where a tab comes before the title. Both are reported. A reference image is reported when its definition's title is on the line below, or when other image syntax comes before it, as in `![x](a.png) ![][dec]`. So is one beside another definition that could match its label, such as `[DEC]: other.png`, or text shaped like one, such as `See [dec]: here.`. So is one in a document holding `[ß]: other.png`, or `[é]:` inside a destination, as in `[dec]: a[é]:b \"decorative\"`. Text shaped like that has the same effect in a paragraph, in code, in an HTML comment, in a title or in alternative text. Neither renderer reads it as a definition there. Such text does not affect an inline image. It skips some images that render, such as `![]()`, or `![][dec]` when a tab, not a space, separates the parts of its definition. Text that renders no image can still be reported, such as `![](<decoration.png>x \"decorative\")`. Text that renders no image goes unreported when it carries such a title in a raw HTML block, or in an earlier link's destination or title. In an earlier link it looks like `[t](<a) ![][dec]>)` or `[t](a 'x) ![](decoration.png \"decorative\")')`.",
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
    checks: [{ rule: "opening-version-date", kind: "offline" }], needs: ["markdown", "front-matter"],
    limits: [
      "It asks a question as an advisory, rather than stating a fault.",
      "It needs a Markdown level-1 title, though not every one counts, such as `> # Guide`. It does not read an HTML title such as `<h1>Guide</h1>`, but it can take a `#` line that shows as text, such as one inside an HTML block like `<div>`, as one. A file named README, CONTRIBUTING, SECURITY or PULL_REQUEST_TEMPLATE is exempt, with or without an extension, even a two-part one such as `README.fr.md`. So can one in another letter case, such as `readme.MD`, but a longer name such as `README-fr.md` is not. It is off when front matter is read as text.",
      "It recognises a version or date in set forms, such as `Version: 1.2`, `Date: 3 March 2026`, a title suffix such as `(Version 1.2)`, or a front matter field. Some forms are not recognised, such as `Version: 2`, `Version: banana` or the title suffix `(2.0)`. In front matter that begins on the first line and parses as YAML, a key named version, date, updated or last_updated, in any letter case, can silence it when its value is a finite number or text that is not blank, even `version: banana` or the quoted `'true'`. The key counts at the top level, or directly under a key named `metadata` in lower case, but not under another key such as `release`. A value YAML reads as true or false, a list or a map does not count, and a block that does not parse, such as one holding `title: [unclosed`, does not silence it.",
    ],
  },
  { id: "16a", demand: "Where an overview is needed, it keeps the conclusion.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "16b", demand: "Where an overview is needed, it keeps the required action.", state: "not-read", checks: [], needs: [], limits: [] },
  { id: "16c", demand: "Where an overview is needed, it keeps every essential qualification.", state: "not-read", checks: [], needs: [], limits: [] },
  {
    id: "17a", demand: "The overview label is a heading, not bold text alone.", state: "fault",
    checks: [{ rule: "overview-label", kind: "offline" }], needs: ["markdown"],
    limits: [
      "It reads a document only when it counts 6 or more level-2 headings outside any Markdown list or quotation. It can count a `##` line that shows as text, such as one inside an HTML block like `<div>`, and a heading inside an HTML `<blockquote>`.",
      "It asks for a heading worded Overview or Summary before the first content section, and fires on a document with no overview heading at all, though it can take a `## Overview` line that shows as text, such as one inside an HTML block like `<div>`, as one. It can accept other letter cases and a leading number, such as `## 1. OVERVIEW`, but not other wording, such as Executive overview, At a glance or `## 1) OVERVIEW`, nor an HTML heading such as `<h2>Overview</h2>`, nor a heading inside a Markdown list or quotation, such as `> ## Overview`.",
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
  {
    id: "19d", demand: "There is no referral where nothing else exists.", state: "fault",
    checks: [{ rule: "empty-signpost", kind: "offline" }], needs: ["markdown"],
    limits: [
      "It reads a heading whose whole wording names somewhere else to go, such as `See also`, `Related`, `Related documents`, `Resources`, `Further reading` or `Other languages`. It reads that wording in any letter case, after a leading number such as `7.`, and with symbols at either end set aside, so `## 7. See also:` is read. Other wording is not read, even when it holds one of those words, such as `References`, `Next steps` or `Human resources`. Nor is a bold line such as `**See also**`, an HTML heading such as `<h2>See also</h2>`, or a heading inside a list or a quotation.",
      "It reads the lines from the heading to the next heading at its level or above, or to the end of the text. It reports the heading only when each line is one of these: blank, an HTML comment standing as its own block, a link definition on one line, a thematic break alone or in a quotation, or text of only invisible characters. A deeper heading does not count unless it holds a link or an image, but what sits beneath it does. So `## See also` with only `### Guides` beneath is reported.",
      "Any other line counts as content, so some sections that show a reader nothing are not reported. Examples are an empty list item such as `- `, a thematic break in a list item such as `* ---`, and a footnote body such as `[^1]: guide.md`. So are a link definition whose destination or title is on the next line or follows a tab, a second comment on one line, and a comment ended by `--!>`.",
      "Raw HTML other than a comment always counts, so `<pre>`, `<textarea>`, `<?php ?>`, `<!DOCTYPE html>` and even an empty `<div>` clear the heading. A comment inside a paragraph counts too. So do dashes straight below a link definition, which a renderer can show as text. A character reference such as `&nbsp;` counts, and so does a line of only a byte order mark, a no-break space or a wide space.",
      "Invisible characters are white space, control and format characters other than NUL, and characters Unicode says to show as nothing, such as a zero-width space or a Hangul filler. The blank braille pattern is one too. A lone combining mark counts as content.",
      "It finds headings as the shared structural reading does, as the other layout rules do. So `## See also` straight below `<div>` is read as a heading, although CommonMark makes it part of that HTML block.",
      "It does not read what the content says, so `## See also` followed by `None.` passes. Front matter is not read, unless the text is read as having none, when its block can become a heading, as `---`, `related:`, `---` does.",
    ],
  },
  {
    id: "20a", demand: "On a restructure, every prose passage and content item is kept.", state: "fault",
    checks: [{ rule: "restructure-dropped", kind: "offline" }], needs: ["before"],
    limits: [
      "It compares wording, not meaning. A passage reworded reads as dropped, as one removed does, unless 20b's check pairs it as rewritten or reads it with a new table, so a dropped row does not say whether 20a or 20b failed.",
      UNITS_READ_LIMIT,
      WORDS_SEEN_LIMIT,
    ],
  },
  {
    id: "20b", demand: "On a restructure, no prose is rewritten.", state: "fault",
    checks: [{ rule: "restructure-rewritten", kind: "offline" }], needs: ["before"],
    limits: [
      "It pairs a unit of the original that has no unchanged copy with a unit of the new version left over, when the two share at least two words and at least half the words of the longer. A word counts as often as it stands, in any letter case, and a bold label such as `**Purpose:**` is set aside. It lists each pair as rewritten, for a person to confirm, and does not read whether the meaning changed. A unit reworded further reads as dropped and added, so `Close the valve.` becoming `Shut it.` is not paired.",
      "It pairs only sentences, list items, table cells and image alternatives, never a heading, a code block, a unit that is one slot, or a unit that matches the author's wording. Of the pairs that qualify, the one sharing the largest part of the longer one's words is taken first, then the one sharing more words, then the earliest in the original, then the earliest in the new version, so it does not always make the most pairs. A pair is not read for order, so a unit reworded and moved reads as rewritten and not as moved.",
      "A unit of the original left over with at least two, and at least half, of its different words among the words of a new table is read with that table. The table must keep no unit of the original, reword none, hold two or more units, and have at least half its own different words among those of the units read with it. It then prints one row, as restructured or rewritten, and its units are not listed as added. This has been checked only on Part 5's own plans example and on constructed specimens, not on a real document turned into a table.",
      "When its searches for pairs, tables and values would take more than 20,000,000 steps, as when the original holds 2,500 copies of one sentence and the new version 2,500 copies of a sentence rewording it, it pairs nothing, reads no table and lists no value, and the printed comparison says so.",
      "Wording that many documents share counts like any other, so a sentence can pair with one from an unrelated section. Under a Medicine heading, `For further information contact the doctor before treatment.` pairs with `For further information contact the bank about mortgages.` under a Banking heading, because the two share five of eight words. It does not read headings or sections when it pairs.",
    ],
  },
  { id: "20c", demand: "On a restructure, the tone is unchanged.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  {
    id: "21a", demand: "Every moved sentence or block keeps its dependencies.", state: "fault",
    checks: [{ rule: "restructure-moved", kind: "offline" }], needs: ["before"],
    limits: [
      "It lists each unit kept word for word that now stands outside the longest order the kept units share with the original, for a person to check. "
        + "A unit of a step out of order against the other steps of its list is listed by 21b's check instead, and not also here. "
        + "It does not read whether a moved unit keeps what it depends on, except that a moved sentence, list item or table cell opening with `This`, `It` or `These` gets a question about what that word refers to. "
        + "The same rows are where to look for 21c, which no check reads. "
        + "A row clears only when the unit is back in its original order against the units kept around it.",
      "Where two orders keep as many units, it names the unit that stood first in the original, so of two sentences that swap places, the first is listed. "
        + "Otherwise it names the part with fewer kept units, so when a heading and the text beside it change places, the heading can be the unit listed. "
        + "Units next to each other in both versions share one row, and only the first of them gets the question.",
      "Copies of one text pair by whole wording first, and no comparison keeps fewer units than whole wording alone, nor fewer in order when it keeps as many. "
        + "When repeated wording and labels both change, a unit that another pairing would keep in place can read as moved. "
        + "When a label passes between two copies of a sentence, the pairs cross, and the copy that stood first in the original is named, labelled or not. "
        + "A short text that stands more than once, such as a number in a table, can pair with a copy beside another label, so a value moved to another row reads as moved, and the row cannot tell that from a move of the label. "
        + "When the copies of repeated texts would need more than 1,000,000 pairings, the texts with the most copies pair in document order, so a copy added or dropped can make another read as moved.",
      "It reads only units kept word for word, of the kinds 20a's check reads, so a sentence both moved and reworded reads as rewritten, or as dropped and added, not as moved. "
        + "A heading's unit with no letter, such as the number of `## 4. Remove`, is kept but not read for order, so headings renumbered when a section is added list nothing.",
    ],
  },
  {
    id: "21b", demand: "Every moved sentence or block keeps its order against neighbouring steps.", state: "fault",
    checks: [{ rule: "restructure-step-order", kind: "offline" }], needs: ["before"],
    limits: [
      "It reads a step as an item of an ordered list in the original, with everything the item holds: its paragraphs, bullets, tables, headings and code. "
        + "It reports each kept unit of a step that now stands in another order against the kept units of the other steps of its list, wherever it now stands, in a list or not. "
        + "Units that change places inside one step are listed as moved instead. "
        + "A unit it reports is not also listed as moved. "
        + "A row clears when the steps keep their original order, whatever their numbers or markers.",
      "It does not read steps written as prose, such as `First, open the box. Then lift the lid.`, or numbers typed into a paragraph, so a sequence that is an ordered list only in the new version is read as moved. "
        + "Of two steps that swap places, it names the one with fewer kept units. "
        + "When they have as many, it names one outside the longest order of the whole document, and otherwise the one that stood first in the original. "
        + "When repeated wording and labels both change, a step that another pairing would keep in order can read as out of order. "
        + "A unit is read against the 10 innermost ordered lists around it and no more.",
    ],
  },
  { id: "21c", demand: "Every moved sentence or block keeps the claim it qualifies.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  {
    id: "22a", demand: "Every promoted sentence comes unchanged from the document or the author.", state: "fault",
    checks: [{ rule: "restructure-added", kind: "offline" }], needs: ["before"],
    limits: [
      "It reports each unit of the new version found neither in the original nor in the wording given with `--author-text`, not only a promoted sentence. "
        + "It compares wording, not meaning, so a promoted sentence that was reworded is reported, as rewritten when 20b's check pairs it with its original and as added otherwise, and a person must confirm its source. The units of a new table that 20b's check reads with units of the original are not listed one by one.",
      "A new heading is counted and not reported, and so is a bold label ending in a colon, such as `**Purpose:**`, before a sentence that is kept. "
        + "A unit that is one slot such as `[Author needed: reader]` is listed as a marked gap and not reported.",
    ],
  },
  { id: "22b", demand: "Every promoted sentence states its field directly.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "22c", demand: "Every promoted sentence stays true.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "22d", demand: "Every promoted sentence stays complete.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "22e", demand: "Every mismatch is reported.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  { id: "22f", demand: "Every gap is marked.", state: "needs-two-versions", checks: [], needs: [], limits: [] },
  {
    id: "23a", demand: "Accuracy survives every structural choice, with nothing distorted to fit a layout.", state: "fault",
    checks: [{ rule: "restructure-value", kind: "offline" }], needs: ["before"],
    limits: [
      "It reads a value as a number written in figures, or the text of a code span, in a sentence, list item, table cell or image alternative of the original that has no unchanged copy in the new version. Outside an image alternative, a number inside a code span is read only as part of the span. In an image alternative, a code span is read as prose and a number inside it as a number, so `--send` that becomes `send` there is not listed. Other values written as text, such as names and dates in words, are not read. It lists each value not found as written in the new version, for a person to confirm, and does not read whether a value it finds kept its meaning or its place.",
      "A value counts as held where its text stands anywhere in the new file, even inside a longer word or figure, once white space is made single in both, so `pre` is held by `prefix` and `13` by `1.13.0`. The file is read as written, with its character references decoded and its backslash escapes read, as the text a reader sees once its markup is taken out, as the next limit describes, and as the units the comparison reads, so front matter, HTML, link destinations and image alternatives count. A number also counts as held by the same value written in these other ways, in the file as written or in its units, and only these: its digits grouped in threes or not, as in `1,000`, `1 000` and `1000`, and a figure grouped by spaces, such as `3 500`, by each group standing as a number, as in `3 then 500`; a full stop or a comma as its decimal point, as in `2,5` and `2.5`; leading zeros or trailing decimal zeros, as in `05` and `2.50`; and English words up to the billions, such as `five`, `twenty-five` or `fifth`, wherever they stand, so any `one` holds 1. A number of two or more runs of digits, such as `10.30`, also counts as held where those runs stand in the same order in one unit or one line, with at most three marks or spaces between each and the next. So `10:30` holds `10.30` and `3, 4` holds `3,4`, even inside a longer figure, so `0.3.1` holds `0.3`, but `10 --- 30` does not hold `10.30`. A month's name that opens with a capital, in full or cut to three letters, holds the month's number, so `28 September 2026` holds the `09` of `2026-09-28`, and a sentence opening with `May` holds `5`.",
      "Markup is taken out as HTML reads it, and again as CommonMark passes Markdown to a browser, and a value either reading holds counts as held. So a quoted attribute that holds `>` or `<` does not end its tag, a comment is not text, and nor is the content of `script`, `style`, `title`, `iframe`, `noembed`, `noframes` and `noscript` up to its end tag, which a browser that runs scripts hides. So `42` that becomes `4<span title=\">\">2</span>`, `4<!-- > -->2` or `4<script>x</script>2` is held. Text that an element, an attribute or a style hides in other ways, as `template` and `hidden` do, is read as text, so `42` that becomes `4<span hidden>x</span>2` is listed. Text a browser moves, as from inside a table to before it, is read where the file writes it, so `42` that becomes `<table><tr><td>2</td></tr>4</table>` is listed. A comment an HTML block leaves open runs on to the next `-->` in the file, as a browser reads it on, and a tag the block leaves open ends with it. Where Markdown's containers make a browser read such markup differently, a value can be listed though a reader sees it, as in these two cases among others. A browser ends the comment only at a `-->` that CommonMark passes as HTML, so `42` that becomes `<div>4<!--`, a blank line and `-->x<!-- x -->2</div>` is listed. In a tight list a browser reads the tag on into the text after it, so `42` that becomes `- <pre></pre>4<b` and a line `  c=\"x <i>2</i>` is listed. The text with references decoded, or with markup taken out, is searched only for a number as the original writes it, not for its other forms, so `2,500` that becomes `2<b>500</b>` or `2&#53;00` in an HTML block is listed, while in prose the units hold `2500` and it is not.",
      "A value written another way is listed, as when `0.5` becomes `50%` or `half`, `4.2` becomes `4 point 2`, or `1000000000000` becomes `one trillion`. A figure is read from its first digit, so `.5` is read as `5`. A code span's marks are part of its text, so `<thinking>` that becomes `thinking` is listed, but a change to its white space alone is not, as when `echo  foo` becomes `echo foo`. A number written only in words in the original, such as `five`, is not read, nor is a code span holding no letter or digit, such as `--`, nor a value in a heading or a code block. A value counts as held however many times it stood in the original, so cutting one of two copies of it lists nothing. A value not held is listed once for each unit it stood in, and figures there that read as the same value, such as `5` and `5.0`, are one value. A code span that a full stop splits across two sentences, such as `a. b`, is one value, listed with the first of its sentences not kept.",
      "When its searches for pairs, tables and values would take more than 20,000,000 steps, as when the original holds 2,500 copies of one sentence and the new version 2,500 copies of a sentence rewording it, it pairs nothing, reads no table and lists no value, and the printed comparison says so.",
    ],
  },
  {
    id: "23b", demand: "Completeness survives every structural choice, with nothing cut to fit a layout.", state: "fault",
    checks: [{ rule: "restructure-dropped", kind: "offline" }], needs: ["before"],
    limits: [
      "It reports each unit of the original with no unchanged copy in the new version, so it cannot tell a cut made to fit a layout from any other. A passage reworded is reported as dropped too, unless 20b's check pairs it as rewritten or reads it with a new table.",
      UNITS_READ_LIMIT,
      WORDS_SEEN_LIMIT,
    ],
  },
  { id: "24a", demand: "Every design element serves a reader need.", state: "not-checkable", checks: [], needs: [], limits: [] },
  {
    id: "25a", demand: "Where the document cites Part 5, it says the standard is an unpublished draft.", state: "fault",
    checks: [{ rule: "provisional-label", kind: "offline" }], needs: [],
    limits: [
      "It reads a citation as the number 24495-5 with no digit beside it, in any form, such as `ISO 24495-5`, `ISO/WD 24495-5` or the skill's name `iso-24495-5`, in a code span or not. A citation by name alone, such as `Part 5`, is not read, nor one written with another hyphen, such as a non-breaking hyphen. Nor is one split by emphasis marks, such as `ISO **24495**-5`, or one only in a link's destination, such as `[guide](iso-24495-5.md)`, though one in a link's text is read. A table row is read cell by cell, as GitHub shows it: a pipe ends a cell and any link in it, and a cell past the header's last column is not read.",
      "It passes a document when one paragraph, list item, quotation, heading or table row that cites the standard also holds the word draft, drafts, provisional or unpublished, in any letter case. It does not read what that word says, so `ISO 24495-5 is not a draft` passes, as does `iso-24495-5` followed by `(provisional)`, which labels the skill. A word in another paragraph does not count, even one beneath a heading that cites the standard. A longer word, such as `drafted`, does not count either, nor one split by emphasis marks, such as `pro**vision**al`, nor one only in a link's destination, such as `[guide](draft.md)`. It reports a document once, at its first citation.",
      "It skips fenced and indented code, front matter, HTML comments, HTML tags with their attributes and text in double quotation marks, so `Never write \"ISO 24495-5\" alone.` passes. A draft word in quotation marks does not count either, so `ISO 24495-5 is a \"draft\".` is reported. Front matter read as text is read, and so is the text of a raw HTML block such as `<pre>`. A comment or tag in a table cell is skipped as well.",
    ],
  },
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
const EMPTY_SEE_ALSO = emptySignpost("See also");
const ADJACENT_NOTE = adjacentAlert("NOTE", 1);
const UNLABELLED = "no paragraph that cites ISO 24495-5 or its skill says the standard is a draft; say it is an unpublished draft where you cite it";

/** A non-breaking hyphen, which looks like the hyphen in 24495-5 and is another character. */
const NON_BREAKING_HYPHEN = String.fromCharCode(0x2011);

/** A capital I with a dot above, which looks like the I of Image and is another letter. */
const DOTTED_CAPITAL_I = String.fromCharCode(0x130);

/** What `generic-alt` says of alternative text that is one word naming the kind of image. */
/** The adjacent-alerts finding for an alert of this kind, on the line after the one given, three lines on. */
function adjacentAlert(kind: string, first: number): string {
  return `This ${kind} alert follows the ${kind} alert on line ${first} with only blank lines between. If the two serve one purpose, merge them into one alert.`;
}

/** The empty-signpost finding for a heading with this wording. */
function emptySignpost(wording: string): string {
  return `The "${wording}" heading has nothing beneath it. List where else to go beneath it, or remove the heading when nothing else exists.`;
}

function kindOfImage(alt: string): string {
  return `alternative text "${alt}" names the kind of image, not what it shows`;
}

/** What `generic-alt` says of alternative text that is a file name. */
function fileOfImage(alt: string): string {
  return `alternative text "${alt}" is a file name, not what the image shows`;
}

/**
 * A specimen document for a clause that names a check, and the detail of
 * each finding each of its offline rules gives on it, in order. Each
 * specimen fails that clause's demand, so each of the clause's checks must
 * name it, and an offline rule must name it for the reason given here.
 */
interface ClauseSpecimen {
  readonly text: string;
  /** The original of `text`, for a clause that needs one. A route given `--before` compares `text` with it. */
  readonly before?: string;
  readonly reasons: Readonly<Record<string, readonly string[]>>;
}

/** The specimen 20a and 23b share: a restructure that keeps one sentence of two. */
const ONE_SENTENCE_DROPPED: ClauseSpecimen = { before: "Close the valve. Open the vent.\n", text: "- Close the valve.\n", reasons: { "restructure-dropped": ["Open the vent."] } };

/** A specimen for each clause that names a check, keyed by the clause. */
const SPECIMENS: Readonly<Record<string, ClauseSpecimen>> = {
  "1a": { text: "# Title\n\n##### Too deep\n\nText.\n", reasons: { "heading-depth": [HEADING_FIVE] } },
  "3a": { text: SIX_SECTION_GUIDE, reasons: { "contents-list": [NO_CONTENTS] } },
  "3b": { text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#one)\n\n${SIX_SECTIONS}`, reasons: { "contents-list": [CONTENTS_WORDING] } },
  "6a": { text: "First, open the box. Second, lift the lid. Third, read the note.\n", reasons: { "prose-enumeration": [PROSE_RANKS] } },
  "8c": { text: "- One\n  - Two\n    - Three\n", reasons: { "bullet-depth": [BULLET_THREE] } },
  "9b": { text: "# Install guide\n\nVersion: 1.0\n\n> [!NOTE]\n> Close the valve.\n\n> [!NOTE]\n> Open the vent.\n", reasons: { "adjacent-alerts": [adjacentAlert("NOTE", 5)] } },
  "10c": { text: `${GUIDE_OPENING}The valve opens when the pressure rises.\n`, reasons: {} },
  "12a": { text: "Read the guide [here](https://example.org/guide).\n", reasons: { "link-text": ["link text \"here\" describes no destination (https://example.org/guide)"] } },
  "12b": { text: "![](chart.png)\n\n![image](graph.png)\n", reasons: { "image-alt": ["image has no alternative text (chart.png)"], "generic-alt": [kindOfImage("image")] } },
  "12c": { text: "![](decoration.png)\n", reasons: { "image-alt": ["image has no alternative text (decoration.png)"] } },
  "13b": { text: "| Name | |\n|---|---|\n| Ann | 4 |\n", reasons: { "table-header": [EMPTY_HEADER] } },
  "15a": { text: "Text with no title.\n", reasons: { "opening-title": [NO_TITLE] } },
  "15c": { text: `${GUIDE_OPENING}Read this.\n`, reasons: {} },
  "15d": { text: `${GUIDE_OPENING}Read this.\n`, reasons: {} },
  "15f": { text: "# Title\n\nText.\n", reasons: { "opening-version-date": [NO_EDITION] } },
  "17a": { text: `${GUIDE_OPENING}**Overview**\n\nOpen the box.\n\n${SIX_SECTIONS}`, reasons: { "overview-label": [NO_OVERVIEW] } },
  "19b": { text: "# Install guide\n\nVersion: 1.0\n\nFor repairs, read [here](repair.md).\n", reasons: { "link-text": ["link text \"here\" describes no destination (repair.md)"] } },
  "19d": { text: "# Install guide\n\nVersion: 1.0\n\nFit the valve.\n\n## See also\n", reasons: { "empty-signpost": [EMPTY_SEE_ALSO] } },
  "20a": ONE_SENTENCE_DROPPED,
  "20b": { before: "Close the valve now.\n", text: "Close the valve today.\n", reasons: { "restructure-rewritten": ["Close the valve today."] } },
  "21a": { before: "Fit the seal. Check the lip. This keeps water out.\n", text: "This keeps water out. Fit the seal. Check the lip.\n", reasons: { "restructure-moved": ["This keeps water out."] } },
  "21b": { before: "1. Close the valve.\n2. Open the vent.\n", text: "1. Open the vent.\n2. Close the valve.\n", reasons: { "restructure-step-order": ["Close the valve."] } },
  "22a": { before: "Close the valve.\n", text: "Close the valve.\n\nThe valve is new.\n", reasons: { "restructure-added": ["The valve is new."] } },
  "23a": { before: "Keep it below 5 bar.\n", text: "Keep it below the limit.\n", reasons: { "restructure-value": ["5"] } },
  "23b": ONE_SENTENCE_DROPPED,
  "25a": { text: "Our layout follows ISO 24495-5.\n", reasons: { "provisional-label": [UNLABELLED] } },
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
const NEED_ORDER: readonly Need[] = ["markdown", "jev-route", "send", "front-matter", "before"];

/**
 * The needs a route meets or not by its options, in the order they are
 * measured. The original version comes first, so the other needs of a check
 * that needs it are judged on the routes that give it.
 */
const ROUTE_NEEDS: readonly Need[] = ["before", "jev-route", "send", "front-matter"];

/** One check a clause names. */
type Check = Clause["checks"][number];

/**
 * One way of running the audit: the command, the options it is given
 * besides the target, the project folder and `--json`, the needs it meets
 * beside Markdown, and the endings of the files it reads. The design audit
 * reads no `.txt` file, and only the plain text audit takes
 * `--no-front-matter` and `--before`. A route given `--before` runs once for
 * each file, because `--before` compares one file, and the option is followed
 * by the file's original: the specimen's `before`, or its own text when it
 * has none.
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
  { name: "text audit", command: "text", options: [], meets: ["front-matter"], reads: ["md", "txt"] },
  { name: "text audit --no-front-matter", command: "text", options: ["--no-front-matter"], meets: [], reads: ["md", "txt"] },
  { name: "text audit --jev-preview", command: "text", options: ["--jev-preview"], meets: ["jev-route", "front-matter"], reads: ["md", "txt"] },
  { name: "text audit --jev --send", command: "text", options: ["--jev", "--send", "--yes"], meets: ["jev-route", "send", "front-matter"], reads: ["md", "txt"] },
  { name: "design audit", command: "design", options: [], meets: ["jev-route", "front-matter"], reads: ["md"] },
  { name: "design audit --send", command: "design", options: ["--send", "--yes"], meets: ["jev-route", "send", "front-matter"], reads: ["md"] },
  { name: "text audit --before", command: "text", options: ["--before"], meets: ["front-matter", "before"], reads: ["md", "txt"] },
  { name: "text audit --before --no-front-matter", command: "text", options: ["--before", "--no-front-matter"], meets: ["before"], reads: ["md", "txt"] },
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
  /** For a check of the two-version comparison, the original `text` is compared with. */
  readonly before?: string;
  /** For a check of the two-version comparison, the author's wording. */
  readonly authorText?: string;
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
  readonly before?: string;
  readonly authorText?: string;
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
  { clause: "3a", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}${FIVE_SECTIONS}\n<blockquote>\n\n## Six\n\n</blockquote>\n`, found: [NO_CONTENTS], control: { from: "<blockquote>\n\n## Six\n\n</blockquote>", to: "> ## Six", found: [] } },
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
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Install](#install) [x][nodef]\n\n${SIX_SECTIONS}`, found: [], control: { from: " [x][nodef]", to: " x", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n<blockquote>\n- bananas\n</blockquote>\n\n${SIX_SECTIONS}`, found: [], control: { from: "<blockquote>\n- bananas\n</blockquote>", to: "> - bananas", found: [NO_CONTENTS] } },
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
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}- [One](#one (Hint))\n- [Two](#two)\n\n${SIX_SECTIONS}`, found: [], control: { from: "(#one (Hint))", to: "(#%zz)", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}| A | B |\n|---|---|\n| [One](#one (Hint)) | [Two](#two) |\n\n${SIX_SECTIONS}`, found: [], control: { from: "(#one (Hint))", to: "(#%zz)", found: [NO_CONTENTS] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}[One](#one (Hint)), [Two](#two), [Three](#three)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: " (Hint)", to: "", found: [] } },
  { clause: "3a", limit: 3, check: "contents-list", text: `${GUIDE_OPENING}<blockquote>\n- [One](#red)\n- [Two](#blue)\n</blockquote>\n\n${SIX_SECTIONS}`, found: [], control: { from: "<blockquote>\n- [One](#red)\n- [Two](#blue)\n</blockquote>", to: "> - [One](#red)\n> - [Two](#blue)", found: [NO_CONTENTS] } },
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
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#hidden)\n\n${SIX_SECTIONS}\n<div>\n## Hidden\n</div>\n`, found: [CONTENTS_WORDING], control: { from: "## Hidden", to: "Hidden", found: [] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}> ## Contents\n\n- [Wrong](#one)\n\n${SIX_SECTIONS}`, found: [NO_CONTENTS], control: { from: "> ## Contents", to: "## Contents", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Wrong](#one) \\. [Two](#two)\n\n${SIX_SECTIONS}`, found: [CONTENTS_WORDING], control: { from: "\\.", to: "\\. Read", found: [NO_CONTENTS] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}[Wrong](#one) \\. [Two](#two)\n\n${SIX_SECTIONS}`, found: [NAVIGATION_WORDING], control: { from: "\\.", to: ".", found: [NO_CONTENTS] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Wrong](#one) <!-- Read these first. --> [Two](#two)\n\n${SIX_SECTIONS}`, found: [CONTENTS_WORDING], control: { from: "<!-- Read these first. -->", to: "Read these first.", found: [NO_CONTENTS] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n[Wrong](#one) \`!\` [Two](#two)\n\n${SIX_SECTIONS}`, found: [CONTENTS_WORDING], control: { from: "`!`", to: "`Read`", found: [NO_CONTENTS] } },
  { clause: "3b", limit: 1, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n<blockquote>\n- [Wrong](#one)\n</blockquote>\n\n${SIX_SECTIONS}`, found: [CONTENTS_WORDING], control: { from: "<blockquote>\n- [Wrong](#one)\n</blockquote>", to: "> - [Wrong](#one)", found: [NO_CONTENTS] } },
  { clause: "3b", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#one)\n\n${FOUR_SECTIONS}`, found: [], control: { from: "## Four\n\nText.\n", to: "## Four\n\nText.\n\n## Five\n\nText.\n", found: [CONTENTS_WORDING] } },
  { clause: "3b", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}## Contents\n\n- [Wrong](#one)\n\n${FOUR_SECTIONS}\n<div>\n## Five\n</div>\n`, found: [CONTENTS_WORDING], control: { from: "## Five", to: "Five", found: [] } },
  { clause: "3b", limit: 2, check: "contents-list", text: `${GUIDE_OPENING}[Wrong](#one), [Two](#two)\n\n${FIVE_SECTIONS}\n<blockquote>\n\n## Six\n\n</blockquote>\n`, found: [NAVIGATION_WORDING], control: { from: "<blockquote>\n\n## Six\n\n</blockquote>", to: "> ## Six", found: [] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Do this: 1. open the box, 2. lift the lid, 3. read the note.\n", found: [PROSE_RANKS], control: { from: "1. open", to: "open", found: [] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Open the box, then lift the lid, then read the note.\n", found: [], control: { from: "Open the box, then lift the lid, then read", to: "First, open the box. Second, lift the lid. Third, read", found: [PROSE_RANKS] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "- First, open the box.\n- Second, lift the lid.\n- Third, read the note.\n", found: [], control: { from: "- First, open the box.\n- Second, lift the lid.\n- Third,", to: "First, open the box. Second, lift the lid. Third,", found: [PROSE_RANKS] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Steps (1), (2) and (3) are required.\n", found: [], control: { from: "(1), (2) and", to: "(1) and (2) and", found: [PROSE_RANKS] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Do this: **(1)** open, **(2)** lift, **(3)** read. [Guide](x)\n", found: [], control: { from: " [Guide](x)", to: "", found: [PROSE_RANKS] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Bring: (1) gloves, (2) goggles and (3) boots.\n", found: [PROSE_RANKS], control: { from: "(1) gloves, (2) goggles and (3) boots", to: "gloves, goggles and boots", found: [] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Do this: 1. open the box, 2. lift the lid, 7. read the note.\n", found: [], control: { from: "7. read", to: "6. read", found: ["enumeration ranks 1, 2, 6 in prose; consider a list"] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Do this: (1) open the box, (2) lift the lid, (7) read the note.\n", found: [], control: { from: "(7) read", to: "(6) read", found: ["enumeration ranks 1, 2, 6 in prose; consider a list"] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Do this: 2. open the box, 3. lift the lid, 4. read the note.\n", found: [], control: { from: "2. open", to: "1. open", found: ["enumeration ranks 1, 3, 4 in prose; consider a list"] } },
  { clause: "6a", limit: 1, check: "prose-enumeration", text: "Do this: 1. open the box, 2. lift the lid.\n", found: [], control: { from: "2. lift the lid.", to: "2. lift the lid, 3. read the note.", found: [PROSE_RANKS] } },
  { clause: "6a", limit: 2, check: "prose-enumeration", text: "Clause (1) The supplier delivers. (2) The buyer pays. (3) Either party may end the contract.\n", found: [PROSE_RANKS], control: { from: "(1) The supplier", to: "The supplier", found: [] } },
  { clause: "8c", limit: 1, check: "bullet-depth", text: "- Outer\n  1. Ordered\n     - Inner\n", found: [], control: { from: "1. Ordered", to: "- Ordered", found: [BULLET_THREE] } },
  { clause: "8c", limit: 1, check: "bullet-depth", text: "- Outer\n  > - Inner\n  >   - Deep\n", found: [BULLET_THREE], control: { from: "  >   - Deep\n", to: "", found: [] } },
  { clause: "8c", limit: 1, check: "bullet-depth", text: "<ul><li>One<ul><li>Two<ul><li>Three</li></ul></li></ul></li></ul>\n", found: [], control: { from: "<ul><li>One<ul><li>Two<ul><li>Three</li></ul></li></ul></li></ul>", to: "- One\n  - Two\n    - Three", found: [BULLET_THREE] } },
  { clause: "8c", limit: 1, check: "bullet-depth", text: "-\n  -\n    - Three\n", found: [], control: { from: "  -\n", to: "  - Two\n", found: [BULLET_THREE] } },
  { clause: "9b", limit: 1, check: "adjacent-alerts", text: "> [!note]\n> One.\n\n> [!Note]\n> Two.\n", found: [ADJACENT_NOTE], control: { from: "[!Note]", to: "[!Danger]", found: [] } },
  { clause: "9b", limit: 1, check: "adjacent-alerts", text: "> [!CAUTION]\n> One.\n\n> [!CAUTION]\n> Two.\n", found: [adjacentAlert("CAUTION", 1)], control: { from: "> [!CAUTION]\n> Two.", to: "> [!WARNING]\n> Two.", found: [] } },
  { clause: "9b", limit: 1, check: "adjacent-alerts", text: "> [!TIP]\t\n> One.\n\n> [!TIP]\n> Two.\n", found: [adjacentAlert("TIP", 1)], control: { from: "[!TIP]\t", to: "[!TIP] Tab.", found: [] } },
  { clause: "9b", limit: 1, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n\n**Note:** Two.\n", found: [], control: { from: "**Note:** Two.", to: "> [!NOTE]\n> Two.", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 1, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n\n<div class=\"note\">Two.</div>\n", found: [], control: { from: "<div class=\"note\">Two.</div>", to: "> [!NOTE]\n> Two.", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 1, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n\n!!! note\n    Two.\n", found: [], control: { from: "!!! note\n    Two.", to: "> [!NOTE]\n> Two.", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 1, check: "adjacent-alerts", text: "- > [!NOTE]\n  > One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "- > [!NOTE]\n  > One.", to: "> [!NOTE]\n> One.", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 1, check: "adjacent-alerts", text: "> > [!NOTE]\n> > One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "> > [!NOTE]\n> > One.", to: "> [!NOTE]\n> One.", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 2, check: "adjacent-alerts", text: "> [!TIP]\n> One.\n\n> [!TIP]\n> Two.\n\n> [!TIP]\n> Three.\n", found: [adjacentAlert("TIP", 1), adjacentAlert("TIP", 4)], control: { from: "\n\n> [!TIP]\n> Three.", to: "", found: [adjacentAlert("TIP", 1)] } },
  { clause: "9b", limit: 2, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n   \n\n> [!NOTE]\n> Two.\n", found: [ADJACENT_NOTE], control: { from: "   \n", to: "   \nText.\n", found: [] } },
  { clause: "9b", limit: 2, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n\n> [!WARNING]\n> Two.\n", found: [], control: { from: "[!WARNING]", to: "[!NOTE]", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 2, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n\nBetween.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "Between.\n\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 2, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n\n<!-- Between. -->\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "<!-- Between. -->\n\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 2, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n\n[guide]: guide.md\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "[guide]: guide.md\n\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 2, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n\n---\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "---\n\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 2, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n\u200B\n> [!NOTE]\n> Two.\n", found: [], control: { from: "\u200B", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "# Guide\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "# Guide\n", to: "# Guide\n\n", found: [adjacentAlert("NOTE", 3)] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "<div>\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "<div>\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n> ---\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "> ---\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n>\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: ">\n> One.", to: "> One.", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n> <b>Note</b> said.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "<b>Note</b> said.", to: "Note said.", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE] Read this.\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: " Read this.", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n\n[!NOTE]: notes.md\n", found: [], control: { from: "[!NOTE]: notes.md", to: "[notes]: notes.md", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n> |---|\n> | One |\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "> |---|\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n> ===\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "> ===\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n> | a |\n> ---\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "> ---\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "<pre\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n</pre>\n", found: [], control: { from: "<pre\n\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "<details>\n<summary>Notes</summary>\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n\n</details>\n", found: [], control: { from: "<details>\n<summary>Notes</summary>\n\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "Press <kbd>Ctrl</kbd>.\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "<kbd>Ctrl</kbd>", to: "Ctrl", found: [adjacentAlert("NOTE", 3)] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "<!-- c -->\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "<!-- c -->", to: "c", found: [adjacentAlert("NOTE", 3)] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "Use `<details>` to fold text.\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "`<details>`", to: "`details`", found: [adjacentAlert("NOTE", 3)] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "If a < b, stop.\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "a < b", to: "a is less than b", found: [adjacentAlert("NOTE", 3)] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "| Command |\n|---|\n| `make BRANCH=<name>` |\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "<name>", to: "name", found: [adjacentAlert("NOTE", 5)] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n> Press <kbd>Ctrl</kbd>.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "<kbd>Ctrl</kbd>", to: "Ctrl", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "<!-- c --><script><details></script>\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "<!-- c --><script><details></script>", to: "Text.", found: [adjacentAlert("NOTE", 3)] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "<div></div>\n<script/x>\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "<div></div>\n<script/x>", to: "Text.", found: [adjacentAlert("NOTE", 3)] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n\n<details>\n", found: [ADJACENT_NOTE], control: { from: "> [!NOTE]\n> One.", to: "<details>\n\n> [!NOTE]\n> One.", found: [] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n> >\nBetween.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "> >\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n>\n> 1.\nBetween.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: ">\n> 1.\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "- \t\n  Item.\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: "- \t\n  Item.\n\n", to: "", found: [ADJACENT_NOTE] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "```\n>>\n```\n\n> [!NOTE]\n> One.\n\n> [!NOTE]\n> Two.\n", found: [], control: { from: ">>", to: "x", found: [adjacentAlert("NOTE", 5)] } },
  { clause: "9b", limit: 3, check: "adjacent-alerts", text: "> [!NOTE]\n> One.\n>\n> More.\n\n> [!NOTE]\n> Two.\n", found: [ADJACENT_NOTE], control: { from: ">\n> More.", to: "> >\n> More.", found: [] } },
  { clause: "9b", limit: 4, check: "adjacent-alerts", text: "> [!NOTE]\n> The valve is brass.\n\n> [!NOTE]\n> Lunch is at noon.\n", found: [ADJACENT_NOTE], control: { from: "> [!NOTE]\n> Lunch", to: "> [!TIP]\n> Lunch", found: [] } },
  { clause: "10c", limit: 1, check: "colour_only", answers: { kind: "block", answers: { colour_only: parseDecimal("0.01"), position_only: parseDecimal("0.99") } }, found: ["colour_only:pass"], control: { answers: { kind: "block", answers: { colour_only: parseDecimal("0.99"), position_only: parseDecimal("0.01") } }, found: ["colour_only:unsure"] } },
  { clause: "10c", limit: 1, check: "colour_only", answers: { kind: "block", answers: { colour_only: parseDecimal("0.01"), position_only: parseDecimal("0.01") } }, found: ["colour_only:pass"], control: { answers: { kind: "block", answers: { colour_only: parseDecimal("0.99"), position_only: parseDecimal("0.01") } }, found: ["colour_only:unsure"] } },
  { clause: "10c", limit: 1, check: "colour_only", answers: { kind: "block", answers: { colour_only: parseDecimal("0.99"), position_only: parseDecimal("0.99") } }, found: ["colour_only:unsure"], control: { answers: { kind: "block", answers: { colour_only: parseDecimal("0.01"), position_only: parseDecimal("0.99") } }, found: ["colour_only:pass"] } },
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
  { clause: "12a", limit: 2, check: "link-text", text: "Read [here][ref].\n\n[ref]: repair.md\n  \"Repair manual\"\n", found: ["link text \"here\" describes no destination (ref)"], control: { from: "[here][ref].\n\n[ref]: repair.md\n  \"Repair manual\"", to: "[here](repair.md\n  \"Repair manual\").", found: [] } },
  { clause: "12a", limit: 2, check: "link-text", text: "Read [click here](repair(1).md\n\"Repair manual\").\n", found: ["link text \"click here\" describes no destination (repair(1)"], control: { from: "repair(1).md", to: "repair.md", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<img src=\"chart.png\">\n", found: ["image has no alternative text (chart.png)"], control: { from: "\">", to: "\" alt=\"\">", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<img src=\"chart.png\" alt=\"\">\n", found: [], control: { from: " alt=\"\"", to: "", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png \"decorative\")\n", found: [], control: { from: " \"decorative\"", to: "", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<img src=\"chart.png\" data-alt=\"\">\n", found: [], control: { from: "data-alt", to: "title", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<img src=\"chart.png\" alt>\n", found: ["image has no alternative text (chart.png)"], control: { from: " alt>", to: " alt=\"\">", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart(1).png \"decorative\")\n", found: ["image has no alternative text (chart(1)"], control: { from: "chart(1).png", to: "chart.png", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png (decorative))\n", found: ["image has no alternative text (chart.png (decorative)"], control: { from: "(decorative)", to: "\"decorative\"", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]: chart.png \"decorative\"\n", found: [], control: { from: " \"decorative\"", to: "", found: ["image has no alternative text (c)"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![]()\n", found: [], control: { from: "()", to: "(chart.png)", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png \"&#100;ecorative\")\n", found: ["image has no alternative text (chart.png \"&#100;ecorative\")"], control: { from: "&#100;", to: "d", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](<chart.png>x \"decorative\")\n", found: ["image has no alternative text (<chart.png>x \"decorative\")"], control: { from: "<chart.png>x", to: "chart.png", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<div>\n![](chart.png \"decorative\")\n</div>\n", found: [], control: { from: "\"decorative\"", to: "\"ornament\"", found: ["image has no alternative text (chart.png \"ornament\")"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "[t](<a) ![](chart.png \"decorative\")>)\n", found: [], control: { from: "\"decorative\"", to: "\"ornament\"", found: ["image has no alternative text (chart.png \"ornament\")"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](<chart.png> \"decorative\")\n", found: ["image has no alternative text (<chart.png> \"decorative\")"], control: { from: "<chart.png>", to: "chart.png", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png \"decorative\" )\n", found: ["image has no alternative text (chart.png \"decorative\" )"], control: { from: "\" )", to: "\")", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "`code` ![](chart.png \"decorative\")\n", found: ["image has no alternative text (chart.png \"decorative\")"], control: { from: "`code` ", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "<b>bold</b> ![](chart.png \"decorative\")\n", found: ["image has no alternative text (chart.png \"decorative\")"], control: { from: "<b>bold</b>", to: "bold", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "\\* ![](chart.png \"decorative\")\n", found: ["image has no alternative text (chart.png \"decorative\")"], control: { from: "\\* ", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png  \"decorative\")\n", found: ["image has no alternative text (chart.png  \"decorative\")"], control: { from: "  \"", to: " \"", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](my\u00a0chart.png \"decorative\")\n", found: ["image has no alternative text (my\u00a0chart.png \"decorative\")"], control: { from: "\u00a0", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](my\u0085chart.png \"decorative\")\n", found: ["image has no alternative text (my\u0085chart.png \"decorative\")"], control: { from: "\u0085", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](my'chart.png \"decorative\")\n", found: ["image has no alternative text (my'chart.png \"decorative\")"], control: { from: "'", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](my\\chart.png \"decorative\")\n", found: ["image has no alternative text (my\\chart.png \"decorative\")"], control: { from: "\\", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](my<chart.png \"decorative\")\n", found: ["image has no alternative text (my<chart.png \"decorative\")"], control: { from: "<", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](my\u200bchart.png \"decorative\")\n", found: ["image has no alternative text (my\u200bchart.png \"decorative\")"], control: { from: "\u200b", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](my\\ chart.png \"decorative\")\n", found: ["image has no alternative text (my\\ chart.png \"decorative\")"], control: { from: "\\ ", to: "-", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png\t\"decorative\")\n", found: ["image has no alternative text (chart.png   \"decorative\")"], control: { from: "\t", to: " ", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart\ud800.png \"decorative\")\n", found: ["image has no alternative text (chart\ud800.png \"decorative\")"], control: { from: "\ud800", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart\udc00.png \"decorative\")\n", found: ["image has no alternative text (chart\udc00.png \"decorative\")"], control: { from: "\udc00", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]: chart\ud800.png \"decorative\"\n", found: ["image has no alternative text (c)"], control: { from: "\ud800", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "[t](a 'x) ![](chart.png \"decorative\")')\n", found: [], control: { from: "\"decorative\"", to: "\"ornament\"", found: ["image has no alternative text (chart.png \"ornament\")"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]: chart.png\n\"decorative\"\n", found: ["image has no alternative text (c)"], control: { from: "\n\"decorative\"", to: " \"decorative\"", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]: chart.png \"decorative\"\n[C]: other.png\n", found: ["image has no alternative text (c)"], control: { from: "\n[C]: other.png", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]: chart.png \"decorative\"\n[ß]: other.png\n", found: ["image has no alternative text (c)"], control: { from: "ß", to: "ss", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![x](a.png) ![][c]\n\n[c]: chart.png \"decorative\"\n", found: ["image has no alternative text (c)"], control: { from: "![x](a.png) ", to: "", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]:\tchart.png\n", found: [], control: { from: "\t", to: " ", found: ["image has no alternative text (c)"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]: a[é]:b \"decorative\"\n", found: ["image has no alternative text (c)"], control: { from: "é]:", to: "é]", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]: a[é]:b \"decorative\"\n", found: ["image has no alternative text (c)"], control: { from: "é", to: "e", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]: chart.png \"decorative\"\n\nType `[é]:` here.\n", found: ["image has no alternative text (c)"], control: { from: "`[é]:`", to: "`[é] :`", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]: chart.png \"decorative\"\n\nSee [c]: here.\n", found: ["image has no alternative text (c)"], control: { from: "See [c]:", to: "See [c]", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png 'DECORATIVE')\n", found: [], control: { from: "'DECORATIVE'", to: "'ornament'", found: ["image has no alternative text (chart.png 'ornament')"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "# ![](chart.png\t\"decorative\")\n", found: [], control: { from: "\"decorative\"", to: "\"ornament\"", found: ["image has no alternative text (chart.png\t\"ornament\")"] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n [c]: chart.png \"decorative\"\n", found: ["image has no alternative text (c)"], control: { from: "\n [", to: "\n[", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]:  chart.png \"decorative\"\n", found: ["image has no alternative text (c)"], control: { from: "]:  ", to: "]: ", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\n\n[c]: chart.png \"decorative\" \n", found: ["image has no alternative text (c)"], control: { from: "\"decorative\" ", to: "\"decorative\"", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "See\t![](chart.png \"decorative\")\n", found: ["image has no alternative text (chart.png \"decorative\")"], control: { from: "\t", to: " ", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![][c]\tdone\n\n[c]: chart.png \"decorative\"\n", found: ["image has no alternative text (c)"], control: { from: "\t", to: " ", found: [] } },
  { clause: "12b", limit: 1, check: "image-alt", text: "![](chart.png \"decorative\")\n\nType `[é]:` here.\n", found: [], control: { from: "\"decorative\"", to: "\"ornament\"", found: ["image has no alternative text (chart.png \"ornament\")"] } },
  { clause: "12b", limit: 2, check: "image-alt", text: "![nonsense](chart.png)\n", found: [], control: { from: "nonsense", to: "", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 2, check: "image-alt", text: "![The <img> tag](chart.png)\n", found: ["image has no alternative text (image)"], control: { from: "<img>", to: "img", found: [] } },
  { clause: "12b", limit: 3, check: "image-alt", text: "![](\nchart.png\n)\n", found: [], control: { from: "(\nchart.png\n)", to: "(chart.png)", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 3, check: "image-alt", text: "![](chart.png\n\"Chart\")\n", found: [], control: { from: "\n\"Chart\"", to: " \"Chart\"", found: ["image has no alternative text (chart.png \"Chart\")"] } },
  { clause: "12b", limit: 3, check: "image-alt", text: "![\n](chart.png)\n", found: [], control: { from: "![\n]", to: "![ ]", found: ["image has no alternative text (chart.png)"] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![Logo](logo.png)\n", found: [kindOfImage("Logo")], control: { from: "Logo", to: "Acme logo", found: [] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![IMG_0042.jpg](photo.jpg)\n", found: [fileOfImage("IMG_0042.jpg")], control: { from: "IMG_0042.jpg", to: "Harbour at dawn", found: [] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![**logo**](logo.png)\n", found: [kindOfImage("**logo**")], control: { from: "**logo**", to: "**Acme logo**", found: [] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![lo_go](logo.png)\n", found: [], control: { from: "lo_go", to: "_logo_", found: [kindOfImage("_logo_")] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![logo](logo.png \"decorative\")\n", found: [kindOfImage("logo")], control: { from: "![logo]", to: "![]", found: [] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![an image](chart.png)\n", found: [], control: { from: "an image", to: "image", found: [kindOfImage("image")] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![Figure 1](chart.png)\n", found: [], control: { from: "Figure 1", to: "Figure", found: [kindOfImage("Figure")] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![logos](logo.png)\n", found: [], control: { from: "logos", to: "logo", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![Image:](chart.png)\n", found: [], control: { from: "Image:", to: "Image", found: [kindOfImage("Image")] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![images/chart.png](chart.png)\n", found: [], control: { from: "images/", to: "", found: [fileOfImage("chart.png")] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![chart.txt](chart.png)\n", found: [], control: { from: ".txt", to: ".svg", found: [fileOfImage("chart.svg")] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: "![&#108;ogo](logo.png)\n", found: [], control: { from: "&#108;", to: "l", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 4, check: "generic-alt", text: `![${DOTTED_CAPITAL_I}mage](chart.png)\n`, found: [], control: { from: DOTTED_CAPITAL_I, to: "I", found: [kindOfImage("Image")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "| Mark |\n|---|\n| [![icon](a.png)](https://acme.example) |\n", found: [kindOfImage("icon")], control: { from: "![icon]", to: "![Acme icon]", found: [] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "# ![logo](logo.png) Acme\n", found: [kindOfImage("logo")], control: { from: "![logo]", to: "![Acme logo]", found: [] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "<img src=\"logo.png\" alt=\"logo\">\n", found: [kindOfImage("logo")], control: { from: "alt=\"logo\"", to: "alt=\"Acme logo\"", found: [] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "<img src=\"logo.png\" data-alt=\"logo\">\n", found: [], control: { from: "data-alt", to: "alt", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "![logo]()\n", found: [], control: { from: "()", to: "(logo.png)", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "![logo]( )\n", found: [kindOfImage("logo")], control: { from: "( )", to: "()", found: [] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "![logo][l]\n", found: [], control: { from: "[l]\n", to: "[l]\n\n[l]: logo.png\n", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "![logo][<b>]\n\n[<b>]: logo.png\n", found: [], control: { from: "[<b>]\n\n[<b>]", to: "[b]\n\n[b]", found: [kindOfImage("logo")] } },
  // A label partly set aside is missed too. A renderer shows each image, as Bun's does.
  { clause: "12b", limit: 5, check: "generic-alt", text: "![logo][a<b>]\n\n[a<b>]: logo.png\n", found: [], control: { from: "[a<b>]\n\n[a<b>]", to: "[a]\n\n[a]", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "![logo][a\\_]\n\n[a\\_]: logo.png\n", found: [], control: { from: "[a\\_]\n\n[a\\_]", to: "[a]\n\n[a]", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "![logo][`a`]\n\n[`a`]: logo.png\n", found: [], control: { from: "[`a`]\n\n[`a`]", to: "[a]\n\n[a]", found: [kindOfImage("logo")] } },
  // An "<img" inside another tag's attribute is text, and no image renders.
  { clause: "12b", limit: 5, check: "generic-alt", text: "<span title=\"<img alt='logo'>\">Words</span>\n", found: [kindOfImage("logo")], control: { from: "<img", to: "&lt;img", found: [] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "![![logo](a.png)](b.png)\n", found: [], control: { from: "![![logo](a.png)](b.png)", to: "![logo](b.png)", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "![logo](\nlogo.png)\n", found: [], control: { from: "(\nlogo", to: "(logo", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "![logo\n](logo.png)\n", found: [], control: { from: "logo\n]", to: "logo]", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "Text <img alt=\"logo\"\n\nsrc=\"a.png\">\n", found: [], control: { from: "\n\nsrc", to: " src", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "[guide](a.md \"<img alt='logo'>\")\n", found: [], control: { from: " \"<img alt='logo'>\")", to: ") <img alt='logo'>", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "<div>\n[t](a.md \"<img alt='logo'>\")\n</div>\n", found: [], control: { from: "[t](a.md \"<img alt='logo'>\")", to: "<img alt='logo'>", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "```\n![logo](a.png)\n```\n", found: [], control: { from: "```\n![logo](a.png)\n```", to: "![logo](a.png)", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "<!-- ![logo](a.png) -->\n", found: [], control: { from: "<!-- ![logo](a.png) -->", to: "![logo](a.png)", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "| Tag |\n|---|\n| `<img alt=\"logo\">` |\n", found: [], control: { from: "`<img alt=\"logo\">`", to: "<img alt=\"logo\">", found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "---\nbanner: ![logo](a.png)\n---\n\nText.\n", found: [], control: { frontMatter: false, found: [kindOfImage("logo")] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "<div>\n![logo](a.png)\n</div>\n", found: [kindOfImage("logo")], control: { from: "<div>\n![logo](a.png)\n</div>", to: "```\n![logo](a.png)\n```", found: [] } },
  { clause: "12b", limit: 5, check: "generic-alt", text: "[t](<a) ![logo](a.png)>)\n", found: [kindOfImage("logo")], control: { from: "logo", to: "Acme logo", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: decoration.png \"decorative\"\n", found: [], control: { from: " \"decorative\"", to: "", found: ["image has no alternative text (dec)"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration.png \"decorative\")\n", found: [], control: { from: " \"decorative\"", to: "", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration(1).png \"decorative\")\n", found: ["image has no alternative text (decoration(1)"], control: { from: "decoration(1).png", to: "decoration.png", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](<decoration.png> \"decorative\")\n", found: ["image has no alternative text (<decoration.png> \"decorative\")"], control: { from: "<decoration.png>", to: "decoration.png", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration.png (decorative))\n", found: ["image has no alternative text (decoration.png (decorative)"], control: { from: "(decorative)", to: "\"decorative\"", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "`code` ![](decoration.png \"decorative\")\n", found: ["image has no alternative text (decoration.png \"decorative\")"], control: { from: "`code` ", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: decoration.png\n\"decorative\"\n", found: ["image has no alternative text (dec)"], control: { from: "\n\"decorative\"", to: " \"decorative\"", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: decoration.png \"decorative\"\n[DEC]: other.png\n", found: ["image has no alternative text (dec)"], control: { from: "\n[DEC]: other.png", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: decoration.png \"decorative\"\n[ß]: other.png\n", found: ["image has no alternative text (dec)"], control: { from: "ß", to: "ss", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![x](a.png) ![][dec]\n\n[dec]: decoration.png \"decorative\"\n", found: ["image has no alternative text (dec)"], control: { from: "![x](a.png) ", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![]()\n", found: [], control: { from: "()", to: "(decoration.png)", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]:\tdecoration.png\n", found: [], control: { from: "\t", to: " ", found: ["image has no alternative text (dec)"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](<decoration.png>x \"decorative\")\n", found: ["image has no alternative text (<decoration.png>x \"decorative\")"], control: { from: "<decoration.png>x", to: "decoration.png", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "<div>\n![](decoration.png \"decorative\")\n</div>\n", found: [], control: { from: "\"decorative\"", to: "\"ornament\"", found: ["image has no alternative text (decoration.png \"ornament\")"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "[t](<a) ![][dec]>)\n\n[dec]: decoration.png \"decorative\"\n", found: [], control: { from: " \"decorative\"", to: "", found: ["image has no alternative text (dec)"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration.png  \"decorative\")\n", found: ["image has no alternative text (decoration.png  \"decorative\")"], control: { from: "  \"", to: " \"", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration.png \"decorative\" )\n", found: ["image has no alternative text (decoration.png \"decorative\" )"], control: { from: "\" )", to: "\")", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](my\u200bdecoration.png \"decorative\")\n", found: ["image has no alternative text (my\u200bdecoration.png \"decorative\")"], control: { from: "\u200b", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](my\u00a0decoration.png \"decorative\")\n", found: ["image has no alternative text (my\u00a0decoration.png \"decorative\")"], control: { from: "\u00a0", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](my\u0085decoration.png \"decorative\")\n", found: ["image has no alternative text (my\u0085decoration.png \"decorative\")"], control: { from: "\u0085", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](my'decoration.png \"decorative\")\n", found: ["image has no alternative text (my'decoration.png \"decorative\")"], control: { from: "'", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](my\\decoration.png \"decorative\")\n", found: ["image has no alternative text (my\\decoration.png \"decorative\")"], control: { from: "\\", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](my<decoration.png \"decorative\")\n", found: ["image has no alternative text (my<decoration.png \"decorative\")"], control: { from: "<", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "<b>bold</b> ![](decoration.png \"decorative\")\n", found: ["image has no alternative text (decoration.png \"decorative\")"], control: { from: "<b>bold</b>", to: "bold", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "\\* ![](decoration.png \"decorative\")\n", found: ["image has no alternative text (decoration.png \"decorative\")"], control: { from: "\\* ", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](my\\ decoration.png \"decorative\")\n", found: ["image has no alternative text (my\\ decoration.png \"decorative\")"], control: { from: "\\ ", to: "-", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration.png\t\"decorative\")\n", found: ["image has no alternative text (decoration.png  \"decorative\")"], control: { from: "\t", to: " ", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration\ud800.png \"decorative\")\n", found: ["image has no alternative text (decoration\ud800.png \"decorative\")"], control: { from: "\ud800", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration\udc00.png \"decorative\")\n", found: ["image has no alternative text (decoration\udc00.png \"decorative\")"], control: { from: "\udc00", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: decoration\ud800.png \"decorative\"\n", found: ["image has no alternative text (dec)"], control: { from: "\ud800", to: "", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration.png \"&#100;ecorative\")\n", found: ["image has no alternative text (decoration.png \"&#100;ecorative\")"], control: { from: "&#100;", to: "d", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "[t](a 'x) ![](decoration.png \"decorative\")')\n", found: [], control: { from: "\"decorative\"", to: "\"ornament\"", found: ["image has no alternative text (decoration.png \"ornament\")"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: a[é]:b \"decorative\"\n", found: ["image has no alternative text (dec)"], control: { from: "é]:", to: "é]", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: a[é]:b \"decorative\"\n", found: ["image has no alternative text (dec)"], control: { from: "é", to: "e", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: decoration.png \"decorative\"\n\nType `[é]:` here.\n", found: ["image has no alternative text (dec)"], control: { from: "`[é]:`", to: "`[é] :`", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: decoration.png \"decorative\"\n\nSee [dec]: here.\n", found: ["image has no alternative text (dec)"], control: { from: "See [dec]:", to: "See [dec]", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration.png 'DECORATIVE')\n", found: [], control: { from: "'DECORATIVE'", to: "'ornament'", found: ["image has no alternative text (decoration.png 'ornament')"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "# ![](decoration.png\t\"decorative\")\n", found: [], control: { from: "\"decorative\"", to: "\"ornament\"", found: ["image has no alternative text (decoration.png\t\"ornament\")"] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n [dec]: decoration.png \"decorative\"\n", found: ["image has no alternative text (dec)"], control: { from: "\n [", to: "\n[", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]:  decoration.png \"decorative\"\n", found: ["image has no alternative text (dec)"], control: { from: "]:  ", to: "]: ", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\n\n[dec]: decoration.png \"decorative\" \n", found: ["image has no alternative text (dec)"], control: { from: "\"decorative\" ", to: "\"decorative\"", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "See\t![](decoration.png \"decorative\")\n", found: ["image has no alternative text (decoration.png \"decorative\")"], control: { from: "\t", to: " ", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![][dec]\tdone\n\n[dec]: decoration.png \"decorative\"\n", found: ["image has no alternative text (dec)"], control: { from: "\t", to: " ", found: [] } },
  { clause: "12c", limit: 1, check: "image-alt", text: "![](decoration.png \"decorative\")\n\nType `[é]:` here.\n", found: [], control: { from: "\"decorative\"", to: "\"ornament\"", found: ["image has no alternative text (decoration.png \"ornament\")"] } },
  { clause: "12c", limit: 2, check: "image-alt", text: "<img src=\"decoration.png\" alt=\"\">\n", found: [], control: { from: " alt=\"\"", to: "", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 2, check: "image-alt", text: "<img src=\"decoration.png\" alt>\n", found: ["image has no alternative text (decoration.png)"], control: { from: " alt>", to: " alt=\"\">", found: [] } },
  { clause: "12c", limit: 3, check: "image-alt", text: "![Blue swirl](decoration.png)\n", found: [], control: { from: "Blue swirl", to: "", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 3, check: "image-alt", text: "This icon is decorative. ![The <img> tag](chart.svg)\n", found: ["image has no alternative text (image)"], control: { from: "<img>", to: "img", found: [] } },
  { clause: "12c", limit: 4, check: "image-alt", text: "![](\ndecoration.png\n)\n", found: [], control: { from: "(\ndecoration.png\n)", to: "(decoration.png)", found: ["image has no alternative text (decoration.png)"] } },
  { clause: "12c", limit: 4, check: "image-alt", text: "![](decoration.png\n\"Swirl\")\n", found: [], control: { from: "\n\"Swirl\"", to: " \"Swirl\"", found: ["image has no alternative text (decoration.png \"Swirl\")"] } },
  { clause: "13b", limit: 1, check: "table-header", text: "| Thing | Stuff |\n|---|---|\n| Ann | 4 |\n", found: [], control: { from: " Stuff |", to: " |", found: [EMPTY_HEADER] } },
  { clause: "13b", limit: 1, check: "table-header", text: "<table><tr><th></th><th>Age</th></tr><tr><td>Ann</td><td>4</td></tr></table>\n", found: [], control: { from: "<table><tr><th></th><th>Age</th></tr><tr><td>Ann</td><td>4</td></tr></table>", to: "| | Age |\n|---|---|\n| Ann | 4 |", found: [EMPTY_HEADER] } },
  { clause: "13b", limit: 1, check: "table-header", text: "| &#32; | B |\n|---|---|\n| 1 | 2 |\n", found: [], control: { from: "&#32;", to: "", found: [EMPTY_HEADER] } },
  { clause: "13b", limit: 1, check: "table-header", text: "| `a\\|` | B |\n|---|---|\n| 1 | 2 |\n", found: [EMPTY_HEADER], control: { from: "`a\\|`", to: "`a`", found: [] } },
  { clause: "13b", limit: 2, check: "table-header", text: "---\n\nplain text |\n---\n", found: [EMPTY_HEADER], control: { from: "plain text |", to: "plain text", found: [] } },
  { clause: "13b", limit: 2, check: "table-header", text: "<table>\n<tr><th>Name |</th></tr>\n<tr><td>---</td></tr>\n</table>\n", found: [EMPTY_HEADER], control: { from: "Name |", to: "Name", found: [] } },
  { clause: "13b", limit: 2, check: "table-header", text: "```\n| A | |\n|---|---|\n```\n", found: [], control: { from: "```\n| A | |\n|---|---|\n```", to: "| A | |\n|---|---|", found: [EMPTY_HEADER] } },
  { clause: "13b", limit: 2, check: "table-header", text: "Text.\n\n    Cost | \n    ---\n", found: [], control: { from: "    Cost | \n    ---", to: "Cost | \n---", found: [EMPTY_HEADER] } },
  { clause: "13b", limit: 2, check: "table-header", text: "---\nsummary: a | \n---\n\n# Title\n", found: [], control: { from: "---\nsummary", to: "Intro.\n\nsummary", found: [EMPTY_HEADER] } },
  { clause: "13b", limit: 2, check: "table-header", text: "<!-- a | -->\n---\n", found: [], control: { from: "<!-- a | -->", to: "a | ", found: [EMPTY_HEADER] } },
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
  { clause: "15f", limit: 2, check: "opening-version-date", text: "<div>\n# Guide\n</div>\n\nText.\n", found: [NO_EDITION], control: { from: "# Guide", to: "Guide", found: [] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "> # Guide\n\nText.\n", found: [], control: { from: "> # Guide", to: "# Guide", found: [NO_EDITION] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "<h1>Guide</h1>\n\nText.\n", found: [], control: { from: "<h1>Guide</h1>", to: "# Guide", found: [NO_EDITION] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "# Title\n\nText.\n", fileName: "readme.MD", found: [], control: { fileName: "readme-fr.MD", found: [NO_EDITION] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "# Title\n\nText.\n", fileName: "README", found: [], control: { fileName: "READMEx", found: [NO_EDITION] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "# Title\n\nText.\n", fileName: "CONTRIBUTING.md", found: [], control: { fileName: "CONTRIBUTING-fr.md", found: [NO_EDITION] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "# Title\n\nText.\n", fileName: "Security.txt", found: [], control: { fileName: "Security-fr.txt", found: [NO_EDITION] } },
  { clause: "15f", limit: 2, check: "opening-version-date", text: "# Title\n\nText.\n", fileName: ".github/pull_request_template.md", found: [], control: { fileName: ".github/pull_request_template-fr.md", found: [NO_EDITION] } },
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
  { clause: "17a", limit: 1, check: "overview-label", text: `${GUIDE_OPENING}Open the box.\n\n${FIVE_SECTIONS}\n<blockquote>\n\n## Six\n\n</blockquote>\n`, found: [NO_OVERVIEW], control: { from: "<blockquote>\n\n## Six\n\n</blockquote>", to: "> ## Six", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## Executive overview\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [NO_OVERVIEW], control: { from: "Executive overview", to: "Overview", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## At a glance\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [NO_OVERVIEW], control: { from: "At a glance", to: "Summary", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: SIX_SECTION_GUIDE, found: [NO_OVERVIEW], control: { from: "Version: 1.0\n\n", to: "Version: 1.0\n\n## Overview\n\nOpen the box.\n\n", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## Overview\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [], control: { from: "## Overview", to: "**Overview**", found: [NO_OVERVIEW] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## 1. OVERVIEW\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [], control: { from: "1. OVERVIEW", to: "1) OVERVIEW", found: [NO_OVERVIEW] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}<h2>Overview</h2>\n\nOpen the box.\n\n${SIX_SECTIONS}`, found: [NO_OVERVIEW], control: { from: "<h2>Overview</h2>", to: "## Overview", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}> ## Overview\n>\n> The gist.\n\n${SIX_SECTIONS}`, found: [NO_OVERVIEW], control: { from: "> ## Overview\n>\n> The gist.", to: "## Overview\n\nThe gist.", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}## 1. Summary\n\nThe gist.\n\n${SIX_SECTIONS}`, found: [], control: { from: "## 1. Summary", to: "## 1) Summary", found: [NO_OVERVIEW] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}- ## Overview\n\n  The gist.\n\n${SIX_SECTIONS}`, found: [NO_OVERVIEW], control: { from: "- ## Overview\n\n  The gist.", to: "## Overview\n\nThe gist.", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}${SIX_SECTIONS}\n## Overview\n\nThe gist.\n`, found: [NO_OVERVIEW], control: { from: "Version: 1.0\n\n", to: "Version: 1.0\n\n## Overview\n\nThe gist.\n\n", found: [] } },
  { clause: "17a", limit: 2, check: "overview-label", text: `${GUIDE_OPENING}<div>\n## Overview\n</div>\n\nThe gist.\n\n${SIX_SECTIONS}`, found: [], control: { from: "## Overview", to: "Overview", found: [NO_OVERVIEW] } },
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
  { clause: "19d", limit: 1, check: "empty-signpost", text: "## References\n", found: [], control: { from: "References", to: "See also", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 1, check: "empty-signpost", text: "**See also**\n", found: [], control: { from: "**See also**", to: "## See also", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 1, check: "empty-signpost", text: "<h2>See also</h2>\n", found: [], control: { from: "<h2>See also</h2>", to: "## See also", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 1, check: "empty-signpost", text: "- ## See also\n", found: [], control: { from: "- ## ", to: "## ", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 1, check: "empty-signpost", text: "## 7. See also:\n", found: [emptySignpost("7. See also:")], control: { from: "7. See also:", to: "7. See also the guide", found: [] } },
  { clause: "19d", limit: 2, check: "empty-signpost", text: "## See also\n\n### Guides\n", found: [EMPTY_SEE_ALSO], control: { from: "### Guides", to: "### [Guides](guides.md)", found: [] } },
  { clause: "19d", limit: 2, check: "empty-signpost", text: "## See also\n\n---\n", found: [EMPTY_SEE_ALSO], control: { from: "---", to: "Ask the help desk.", found: [] } },
  { clause: "19d", limit: 2, check: "empty-signpost", text: "## See also\n\n<!-- Add links. -->\n", found: [EMPTY_SEE_ALSO], control: { from: "<!-- Add links. -->", to: "Add links.", found: [] } },
  { clause: "19d", limit: 2, check: "empty-signpost", text: "## See also\n\n[guide]: guide.md\n", found: [EMPTY_SEE_ALSO], control: { from: "[guide]: guide.md", to: "[guide](guide.md)", found: [] } },
  { clause: "19d", limit: 2, check: "empty-signpost", text: "## See also\n\n> ---\n", found: [EMPTY_SEE_ALSO], control: { from: "> ---", to: "> Ask the help desk.", found: [] } },
  { clause: "19d", limit: 2, check: "empty-signpost", text: "## See also\n\n\u200B\n", found: [EMPTY_SEE_ALSO], control: { from: "\u200B", to: "Ask the help desk.", found: [] } },
  { clause: "19d", limit: 3, check: "empty-signpost", text: "## See also\n\n- \n", found: [], control: { from: "- ", to: "", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 3, check: "empty-signpost", text: "## See also\n\n* ---\n", found: [], control: { from: "* ---", to: "---", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 3, check: "empty-signpost", text: "## See also\n\n[^1]: guide.md\n", found: [], control: { from: "[^1]", to: "[1]", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 3, check: "empty-signpost", text: "## See also\n\n[guide]:\n  guide.md\n", found: [], control: { from: ":\n  ", to: ": ", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 3, check: "empty-signpost", text: "## See also\n\n<!-- a --> <!-- b -->\n", found: [], control: { from: " <!-- b -->", to: "", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 3, check: "empty-signpost", text: "## See also\n\n<!-- a --!>\n", found: [], control: { from: "--!>", to: "-->", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 4, check: "empty-signpost", text: "## See also\n\n<pre>\nman install\n</pre>\n", found: [], control: { from: "<pre>\nman install\n</pre>", to: "<!--\nman install\n-->", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 4, check: "empty-signpost", text: "## See also\n\n<?> Ask the help desk.\n", found: [], control: { from: "<?> Ask the help desk.", to: "<!-- -->", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 4, check: "empty-signpost", text: "## See also\n\n&nbsp;<!-- a -->\n", found: [], control: { from: "&nbsp;<!-- a -->", to: "<!-- a -->", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 4, check: "empty-signpost", text: "## See also\n\n[guide]: guide.md\n---\n", found: [], control: { from: "md\n---", to: "md\n\n---", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 4, check: "empty-signpost", text: "## See also\n\n&#8203;\n", found: [], control: { from: "&#8203;", to: "\u200B", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 4, check: "empty-signpost", text: "## See also\n\n\u00A0\n", found: [], control: { from: "\u00A0", to: "\u200B", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 5, check: "empty-signpost", text: "## See also\n\n\u2800\n", found: [EMPTY_SEE_ALSO], control: { from: "\u2800", to: "\u2801", found: [] } },
  { clause: "19d", limit: 5, check: "empty-signpost", text: "## See also\n\n\u0000\n", found: [], control: { from: "\u0000", to: "\u200B", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 5, check: "empty-signpost", text: "## See also\n\n\u0301\n", found: [], control: { from: "\u0301", to: "\u200B", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 6, check: "empty-signpost", text: "<div>\n## See also\n", found: [EMPTY_SEE_ALSO], control: { from: "See also", to: "Next", found: [] } },
  { clause: "19d", limit: 7, check: "empty-signpost", text: "## See also\n\nNone.\n", found: [], control: { from: "None.", to: "", found: [EMPTY_SEE_ALSO] } },
  { clause: "19d", limit: 7, check: "empty-signpost", text: "---\nrelated:\n---\n", found: [], control: { frontMatter: false, found: [emptySignpost("related:")] } },
  ...["20a", "23b"].flatMap(clause => [
    { clause, limit: 1, check: "restructure-dropped", before: "Close the valve.\n", text: "Shut it.\n", found: ["Close the valve."], control: { from: "Shut it.", to: "Shut the valve.", found: [] } },
    { clause, limit: 1, check: "restructure-dropped", before: "The Basic plan costs £5.\n", text: "| Plan | Price |\n|---|---|\n| Basic | £5 |\n", found: [], control: { before: "The Pro plan costs £15.\n", found: ["The Pro plan costs £15."] } },
    { clause, limit: 2, check: "restructure-dropped", before: "## Keep below 5 bar\n\nText.\n", text: "Text.\n", found: [], control: { before: "Keep below 5 bar.\n\nText.\n", found: ["Keep below 5 bar."] } },
    { clause, limit: 2, check: "restructure-dropped", before: "---\nsummary: Keep below 5 bar.\n---\n\nText.\n", text: "Text.\n", found: [], control: { before: "summary: Keep below 5 bar.\n\nText.\n", found: ["summary: Keep below 5 bar."] } },
    { clause, limit: 2, check: "restructure-dropped", before: "<pre>\nkeep below 5 bar\n</pre>\n\nText.\n", text: "Text.\n", found: [], control: { before: "```\nkeep below 5 bar\n```\n\nText.\n", found: ["keep below 5 bar"] } },
    { clause, limit: 2, check: "restructure-dropped", before: "<img src=\"c.png\" alt=\"Pressure chart\">\n\nText.\n", text: "Text.\n", found: [], control: { before: "![Pressure chart](c.png)\n\nText.\n", found: ["Pressure chart"] } },
    { clause, limit: 3, check: "restructure-dropped", before: "Read [the guide](a.md).\n", text: "Read [the guide](b.md).\n", found: [], control: { from: "[the guide]", to: "[a manual]", found: ["Read the guide."] } },
    { clause, limit: 3, check: "restructure-dropped", before: "![Chart](a.png)\n", text: "![Chart](b.png)\n", found: [], control: { from: "![Chart]", to: "![Graph]", found: ["Chart"] } },
  ]),
  { clause: "21a", limit: 1, check: "restructure-moved", before: "Fit the seal. Check the lip. This keeps water out.\n", text: "This keeps water out. Fit the seal. Check the lip.\n", found: ["This keeps water out."], control: { from: "This keeps water out. Fit the seal. Check the lip.", to: "Fit the seal. Check the lip. This keeps water out.", found: [] } },
  { clause: "21a", limit: 1, check: "restructure-moved", before: "Fit the seal. Check the lip. Dry the lip.\n", text: "Dry the lip. Fit the seal. Check the lip.\n", found: ["Dry the lip."], control: { from: "Dry the lip. Fit the seal. Check the lip.", to: "Fit the seal. Check the lip. Dry the lip.", found: [] } },
  { clause: "21a", limit: 1, check: "restructure-moved", before: "Read this first.\n\n1. Close the valve.\n2. Open the vent.\n", text: "Open the vent.\n\nRead this first.\n\nClose the valve.\n", found: [], control: { before: "Read this first.\n\nClose the valve.\n\nOpen the vent.\n", found: ["Open the vent."] } },
  { clause: "21a", limit: 2, check: "restructure-moved", before: "Fit the seal. Check the lip.\n", text: "Check the lip. Fit the seal.\n", found: ["Fit the seal."], control: { before: "Check the lip. Fit the seal.\n", found: [] } },
  { clause: "21a", limit: 2, check: "restructure-moved", before: "Fit the seal. Check the lip.\n\n## Notes\n", text: "## Notes\n\nFit the seal. Check the lip.\n", found: ["Notes"], control: { from: "## Notes\n\n", to: "", found: [] } },
  { clause: "21a", limit: 3, check: "restructure-moved", before: "| Kind | Number |\n|---|---|\n| familiarity | 41 |\n| training | 43 |\n", text: "| Kind | Number |\n|---|---|\n| familiarity | 43 |\n| training | 41 |\n", found: ["41", "training"], control: { from: "| familiarity | 43 |\n| training | 41 |", to: "| familiarity | 41 |\n| training | 43 |", found: [] } },
  { clause: "21a", limit: 3, check: "restructure-moved", before: "Close the valve.\n\nClose the valve.\n", text: "**Purpose:** Close the valve.\n\nClose the valve.\n", found: [], control: { before: "Close the valve.\n\n**Purpose:** Close the valve.\n", found: ["Close the valve."] } },
  { clause: "21a", limit: 3, check: "restructure-moved", before: "**Purpose:** Close the valve.\n\nClose the valve.\n", text: "Close the valve.\n\n**Purpose:** Close the valve.\n", found: ["Purpose: Close the valve."], control: { before: "Close the valve.\n\n**Purpose:** Close the valve.\n", found: [] } },
  { clause: "21a", limit: 3, check: "restructure-moved", before: "Close the valve.\n\nClose the valve.\n", text: "**Note:** Close the valve.\n\nClose the valve.\n\n**Purpose:** Close the valve.\n\n**Purpose:** Close the valve.\n", found: ["Close the valve."], control: { from: "\n\n**Purpose:** Close the valve.\n\n**Purpose:** Close the valve.\n", to: "\n", found: [] } },
  { clause: "21a", limit: 3, check: "restructure-moved", before: "**Purpose:** Close the valve.\n\n**Purpose:** Close the valve.\n", text: "Close the valve.\n\n**Purpose:** Close the valve.\n\nClose the valve.\n\nClose the valve.\n", found: ["Purpose: Close the valve."], control: { from: "\n\nClose the valve.\n\nClose the valve.\n", to: "\n", found: [] } },
  { clause: "21a", limit: 4, check: "restructure-moved", before: "Fit the seal. Check the lip. Dry the lip.\n", text: "Dry the lips. Fit the seal. Check the lip.\n", found: [], control: { from: "Dry the lips.", to: "Dry the lip.", found: ["Dry the lip."] } },
  { clause: "21a", limit: 4, check: "restructure-moved", before: "## 1. Fit\n\nText.\n\n## 2. Dry\n\nMore.\n", text: "## 1. Clean\n\nWipe.\n\n## 2. Fit\n\nText.\n\n## 3. Dry\n\nMore.\n", found: [], control: { before: "## 1. Dry\n\nMore.\n\n## 2. Fit\n\nText.\n", found: ["Dry", "More."] } },
  { clause: "21b", limit: 1, check: "restructure-step-order", before: "1. Close the valve.\n2. Open the vent.\n", text: "1. Open the vent.\n2. Close the valve.\n", found: ["Close the valve."], control: { from: "1. Open the vent.\n2. Close the valve.", to: "1. Close the valve.\n2. Open the vent.", found: [] } },
  { clause: "21b", limit: 1, check: "restructure-step-order", before: "1. Close the valve.\n2. Open the vent.\n", text: "Open the vent.\n\n- Close the valve.\n", found: ["Close the valve."], control: { from: "Open the vent.\n\n- Close the valve.", to: "- Close the valve.\n\nOpen the vent.", found: [] } },
  { clause: "21b", limit: 1, check: "restructure-step-order", before: "1. Close the valve. Wait.\n2. Open the vent.\n", text: "1. Wait. Close the valve.\n2. Open the vent.\n", found: [], control: { from: "1. Wait. Close the valve.\n2. Open the vent.", to: "1. Wait.\n2. Open the vent. Close the valve.", found: ["Close the valve."] } },
  { clause: "21b", limit: 2, check: "restructure-step-order", before: "First, open the box. Then lift the lid.\n", text: "Then lift the lid. First, open the box.\n", found: [], control: { before: "1. First, open the box.\n2. Then lift the lid.\n", found: ["First, open the box."] } },
  { clause: "21b", limit: 2, check: "restructure-step-order", before: "1. Close the valve. Wait.\n2. Open the vent.\n", text: "1. Open the vent.\n2. Close the valve. Wait.\n", found: ["Open the vent."], control: { from: "2. Close the valve. Wait.", to: "2. Close the valve.", found: ["Close the valve."] } },
  { clause: "21b", limit: 2, check: "restructure-step-order", before: "Prepare.\n\n1. Close the valve.\n2. Open the vent.\n\nFinish now.\n", text: "Open the vent.\n\nPrepare.\n\nClose the valve.\n\nFinish now.\n", found: ["Open the vent."], control: { from: "Open the vent.\n\nPrepare.", to: "Prepare.\n\nOpen the vent.", found: ["Close the valve."] } },
  { clause: "21b", limit: 2, check: "restructure-step-order", before: "1. Close the valve.\n2. Close the valve.\n", text: "1. **Note:** Close the valve.\n2. Close the valve.\n3. **Purpose:** Close the valve.\n4. **Purpose:** Close the valve.\n", found: ["Close the valve."], control: { from: "\n3. **Purpose:** Close the valve.\n4. **Purpose:** Close the valve.\n", to: "\n", found: [] } },
  { clause: "21b", limit: 2, check: "restructure-step-order", before: "1. **Purpose:** Close the valve.\n2. **Purpose:** Close the valve.\n", text: "1. Close the valve.\n2. **Purpose:** Close the valve.\n3. Close the valve.\n4. Close the valve.\n", found: ["Purpose: Close the valve."], control: { from: "\n3. Close the valve.\n4. Close the valve.\n", to: "\n", found: [] } },
  { clause: "22a", limit: 1, check: "restructure-added", before: "Close the valve.\n", text: "Close the valve.\n\nThe valve is new.\n", found: ["The valve is new."], control: { authorText: "The valve is new.\n", found: [] } },
  { clause: "22a", limit: 1, check: "restructure-added", before: "The valve is new and quiet.\n", text: "- **Purpose:** The valve is new.\n\nThe valve is new and quiet.\n", found: ["Purpose: The valve is new."], control: { before: "The valve is new.\n\nThe valve is new and quiet.\n", found: [] } },
  { clause: "22a", limit: 2, check: "restructure-added", before: "Text.\n", text: "## Overview\n\nText.\n", found: [], control: { from: "## Overview", to: "Overview.", found: ["Overview."] } },
  { clause: "22a", limit: 1, check: "restructure-added", before: "Close the valve now.\n", text: "Close the valve today.\n", found: [], control: { from: "Close the valve today.", to: "Shut it.", found: ["Shut it."] } },
  { clause: "22a", limit: 1, check: "restructure-added", before: "The Basic plan costs £5.\n", text: "| Plan | Price |\n|---|---|\n| Basic | £5 |\n", found: [], control: { before: "The Pro plan costs £15.\n", found: ["Plan", "Price", "Basic", "£5"] } },
  { clause: "22a", limit: 2, check: "restructure-added", before: "Go.\n", text: "- **Purpose:** Go.\n", found: [], control: { from: "**Purpose:**", to: "Purpose", found: ["Purpose Go."] } },
  { clause: "22a", limit: 2, check: "restructure-added", before: "Text.\n", text: "Text.\n\n[Author needed: reader]\n", found: [], control: { from: "[Author needed: reader]", to: "Readers are fitters.", found: ["Readers are fitters."] } },
  { clause: "20b", limit: 1, check: "restructure-rewritten", before: "Close the valve now.\n", text: "Close the valve today.\n", found: ["Close the valve today."], control: { from: "Close the valve today.", to: "Shut it.", found: [] } },
  { clause: "20b", limit: 1, check: "restructure-rewritten", before: "Lead with the outcome.\n", text: "Opening states the outcome.\n", found: ["Opening states the outcome."], control: { from: "states", to: "states clearly", found: [] } },
  { clause: "20b", limit: 1, check: "restructure-rewritten", before: "Close it.\n", text: "Close it!\n", found: ["Close it!"], control: { from: "it!", to: "now!", found: [] } },
  { clause: "20b", limit: 1, check: "restructure-rewritten", before: "**Purpose:** Close the valve now.\n", text: "Close the valve today.\n", found: ["Close the valve today."], control: { before: "**Purpose:** Close it.\n", found: [] } },
  { clause: "20b", limit: 2, check: "restructure-rewritten", before: "## Close the valve now\n\nText.\n", text: "## Close the valve today\n\nText.\n", found: [], control: { from: "## Close the valve today", to: "Close the valve today.", before: "Close the valve now.\n\nText.\n", found: ["Close the valve today."] } },
  { clause: "20b", limit: 2, check: "restructure-rewritten", before: "```\nclose the valve now\n```\n", text: "```\nclose the valve today\n```\n", found: [], control: { from: "```\nclose the valve today\n```", to: "close the valve today", before: "close the valve now\n", found: ["close the valve today"] } },
  { clause: "20b", limit: 2, check: "restructure-rewritten", before: "Close the valve now.\n", text: "Close the valve today.\n", authorText: "Close the valve today.\n", found: [], control: { authorText: "Something else.\n", found: ["Close the valve today."] } },
  { clause: "20b", limit: 2, check: "restructure-rewritten", before: "Run step one now. Run step two now.\n", text: "Run step two today. Run step one today.\n", found: ["Run step one today.", "Run step two today."], control: { from: "Run step two today.", to: "Stop.", found: ["Run step one today."] } },
  { clause: "20b", limit: 2, check: "restructure-rewritten", before: "Fit the seal. Check the lip. Close the valve now.\n", text: "Close the valve today. Fit the seal. Check the lip.\n", found: ["Close the valve today."], control: { from: "Close the valve today.", to: "Close the valve now.", found: [] } },
  { clause: "20b", limit: 3, check: "restructure-rewritten", before: "The Basic plan costs £5.\n", text: "| Plan | Price |\n|---|---|\n| Basic | £5 |\n", found: ["The Basic plan costs £5."], control: { before: "The Pro plan costs £15.\n", found: [] } },
  { clause: "20b", limit: 3, check: "restructure-rewritten", before: "The Basic plan costs £5.\n", text: "| Plan | Price | Owner | Region |\n|---|---|---|---|\n| Basic | £5 | Ann | North |\n", found: [], control: { from: " Owner | Region |\n|---|---|---|---|\n| Basic | £5 | Ann | North |", to: "\n|---|---|\n| Basic | £5 |", found: ["The Basic plan costs £5."] } },
  { clause: "20b", limit: 3, check: "restructure-rewritten", before: "The Basic plan costs £5.\n\n| Plan |\n|---|\n", text: "| Plan | Price |\n|---|---|\n| Basic | £5 |\n", found: [], control: { before: "The Basic plan costs £5.\n", found: ["The Basic plan costs £5."] } },
  {
    clause: "20b", limit: 5, check: "restructure-rewritten",
    before: "## Medicine\n\nFor further information contact the doctor before treatment.\n\n## Banking\n\nContact our bank to ask about payment and loans.\n",
    text: "## Banking\n\nFor further information contact the bank about mortgages.\n\n## Medicine\n\nAsk your GP about the treatment before you begin.\n",
    found: ["For further information contact the bank about mortgages."], control: { from: "For further information contact", to: "Ask", found: [] },
  },
  { clause: "23a", limit: 1, check: "restructure-value", before: "Keep it below 5 bar.\n", text: "Keep it below the limit.\n", found: ["5"], control: { from: "the limit", to: "5 bar", found: [] } },
  { clause: "23a", limit: 1, check: "restructure-value", before: "Run `npm test` before you merge.\n", text: "Run the tests before you merge.\n", found: ["npm test"], control: { from: "the tests", to: "`npm test`", found: [] } },
  { clause: "23a", limit: 1, check: "restructure-value", before: "Close the valve. Keep it below 5 bar.\n", text: "Close the valve.\n\nThe limit is 5 bar.\n", found: [], control: { from: "5 bar", to: "6 bar", found: ["5"] } },
  { clause: "23a", limit: 1, check: "restructure-value", before: "![Set the limit to 1000 now](x.png)\n", text: "![Set the limit to 2000 now](x.png)\n", found: ["1000"], control: { from: "2000", to: "1000", found: [] } },
  { clause: "23a", limit: 1, check: "restructure-value", before: "![Use `--send` now](x.png)\n", text: "![Use send now](x.png)\n", found: [], control: { from: "![Use send now](x.png)", to: "Use send now.", before: "Use `--send` now.\n", found: ["--send"] } },
  { clause: "23a", limit: 1, check: "restructure-value", before: "![Set `limit=1000` now](x.png)\n", text: "![Set `limit=2000` now](x.png)\n", found: ["1000"], control: { from: "![Set `limit=2000` now](x.png)", to: "Set `limit=2000` now.", before: "Set `limit=1000` now.\n", found: ["limit=1000"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "It takes 1,000 days now.\n", text: "It takes 1000 days today.\n", found: [], control: { from: "1000", to: "2000", found: ["1,000"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "It takes 5 days now.\n", text: "It takes five days today.\n", found: [], control: { from: "five", to: "several", found: ["5"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Score 3 500 now.\n", text: "Score 3 then 500 today.\n", found: [], control: { from: "500", to: "600", found: ["3 500"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "It takes 2,5 days now.\n", text: "It takes 2.5 days today.\n", found: [], control: { from: "2.5", to: "25", found: ["2,5"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Keep it below 5 bar.\n", text: "Keep it low.\n\n```\nlimit 5\n```\n", found: [], control: { from: "limit 5", to: "limit 6", found: ["5"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Read issue 22 today.\n", text: "---\nissue: 22\n---\n\nRead the issue today.\n", found: [], control: { from: "issue: 22", to: "issue: 23", found: ["22"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Keep 1 spare now.\n", text: "Keep a spare, the one by the door, today.\n", found: [], control: { from: "the one", to: "that", found: ["1"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Open at 10.30 now.\n", text: "Open at 10:30 today.\n", found: [], control: { from: "10:30", to: "10 to 30", found: ["10.30"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Use version 0.3 now.\n", text: "Use version 0.3.1 today.\n", found: [], control: { from: "0.3.1", to: "0.4.1", found: ["0.3"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Released on 2026-09-28 now.\n", text: "Released on 28 September 2026 today.\n", found: [], control: { from: "September", to: "october", found: ["09"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Due in 2026-05 now.\n", text: "May it be due in 2026, then.\n", found: [], control: { from: "May it", to: "may it", found: ["05"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Pick 3,4 now.\n", text: "Pick 3 - 4 today.\n", found: [], control: { from: "3 - 4", to: "3 --- 4", found: ["3,4"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Due on 2026-09-28 now.\n", text: "Due on 28 Sep 2026 today.\n", found: [], control: { from: "Sep", to: "sep", found: ["09"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Read page 13 now.\n", text: "Read page 1.13.0 today.\n", found: [], control: { from: "1.13.0", to: "1.14.0", found: ["13"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Run the pump 4096 times first.\n", text: "<pre>\n<b>40</b>96\n</pre>\n\nRun it first.\n", found: [], control: { from: "<b>40</b>96", to: "<b>40</b>69", found: ["4096"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Run `npm test` before you merge.\n", text: "Run the tests before you merge.\n\n```\nnpm test --watch\n```\n", found: [], control: { from: "npm test --watch", to: "npm run", found: ["npm test"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Use `pre` now.\n", text: "Use the prefix today.\n", found: [], control: { from: "prefix", to: "suffix", found: ["pre"] } },
  { clause: "23a", limit: 2, check: "restructure-value", before: "Run `npm test` first.\n", text: "<pre>\n<b>npm</b> test\n</pre>\n\nRun it first.\n", found: [], control: { from: "<b>npm</b> test", to: "<b>npm</b> run", found: ["npm test"] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "The total is 42 units.\n", text: "Something else.\n\n<pre>4<span title=\">\">2</span></pre>\n", found: [], control: { from: "2</span>", to: "3</span>", found: ["42"] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "The total is 42 units.\n", text: "Something else.\n\n<pre>4<!-- > -->2</pre>\n", found: [], control: { from: "-->2", to: "-->3", found: ["42"] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "The total is 42 units.\n", text: "Something else.\n\n<pre>4<script>x</script>2</pre>\n", found: [], control: { from: "<script>x</script>", to: "<b>x</b>", found: ["42"] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "The total is 42 units.\n", text: "Something else.\n\n4<script>\n\nx\n\n</script>2\n", found: [], control: { from: "<script>\n\nx\n\n</script>", to: "<b>\n\nx\n\n</b>", found: ["42"] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "Run `npm test` first.\n", text: "Run it first.\n\n<pre>np<span title=\">\">m</span> test</pre>\n", found: [], control: { from: "m</span> test", to: "m</span> tset", found: ["npm test"] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "Run `npm test` first.\n", text: "Run it first.\n\nUse `<!--` then np<b>m</b> test and `-->`.\n", found: [], control: { from: "m</b> test", to: "m</b> tset", found: ["npm test"] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "Run `npm test` first.\n", text: "Run it first.\n\nUse <b c=\"x\"d=\"> then np<b>m</b> test \"> now.\n", found: [], control: { from: "m</b> test", to: "m</b> tset", found: ["npm test"] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "The total is 42 units.\n", text: "Something else.\n\n<pre>4<template>x</template>2</pre>\n", found: ["42"], control: { from: "<template>x</template>", to: "<template></template>", found: [] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "The total is 42 units.\n", text: "Something else.\n\n<table><tr><td>2</td></tr>4</table>\n", found: ["42"], control: { from: "<td>2</td></tr>4", to: "<td>42</td></tr>", found: [] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "The total is 42 units.\n", text: "Something else.\n\n<pre>4<span hidden>x</span>2</pre>\n", found: ["42"], control: { from: "<span hidden>x</span>", to: "<span hidden></span>", found: [] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "The total is 42 units.\n", text: "Something else.\n\n<div>4<!--\n\n-->x<!-- x -->2</div>\n", found: ["42"], control: { from: "-->x<!--", to: "--><!--", found: [] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "The total is 42 units.\n", text: "Something else.\n\n- <pre></pre>4<b\n  c=\"x <i>2</i>\n", found: ["42"], control: { from: "c=\"x", to: "c=x", found: [] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "The total is 2,500 units.\n", text: "Something else.\n\n<pre>2<b>500</b></pre>\n", found: ["2,500"], control: { from: "Something else.\n\n<pre>2<b>500</b></pre>", to: "Something else, 2<b>500</b> in all.", found: [] } },
  { clause: "23a", limit: 3, check: "restructure-value", before: "The total is 2,500 units.\n", text: "Something else.\n\n<pre>2&#53;00</pre>\n", found: ["2,500"], control: { from: "2&#53;00", to: "2500", found: [] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "The share is 0.5 now.\n", text: "The share is 50% today.\n", found: ["0.5"], control: { from: "50%", to: "0.50", found: [] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "It takes five days now.\n", text: "It takes many days today.\n", found: [], control: { before: "It takes 5 days now.\n", found: ["5"] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "## Step 4\n\nText.\n", text: "## Step five\n\nText.\n", found: [], control: { from: "## Step five", to: "Step five.", before: "Step 4.\n\nText.\n", found: ["4"] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "Keep 5 bar now. Hold 5 bar later.\n", text: "Keep 5 bar now.\n", found: [], control: { before: "Keep 5 bar now. Hold 6 bar later.\n", found: ["6"] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "Read section 4.2 now.\n", text: "Read section 4 point 2 today.\n", found: ["4.2"], control: { from: "4 point 2", to: "4.2", found: [] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "Hold 14 of 14 now.\n", text: "Hold most of them today.\n", found: ["14"], control: { before: "Hold 14 of 15 now.\n", found: ["14", "15"] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "Pay 1000000000000 pounds now.\n", text: "Pay one trillion pounds today.\n", found: ["1000000000000"], control: { from: "one trillion", to: "1000000000000", found: [] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "Apply .5 litres now.\n", text: "Apply half a litre today.\n", found: ["5"], control: { from: "half a litre", to: "0.5 litres", found: [] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "The limit is 5 or 5.0 now.\n", text: "The limit is absent today.\n", found: ["5"], control: { before: "The limit is 5 or 6.0 now.\n", found: ["5", "6.0"] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "Pass `--` before the name.\n", text: "Pass nothing before the name.\n", found: [], control: { before: "Pass `-x` before the name.\n", found: ["-x"] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "Use `<thinking>` tags now.\n", text: "Use thinking tags today.\n", found: ["<thinking>"], control: { from: "thinking tags", to: "`<thinking>` tags", found: [] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "Run `echo  foo` now.\n", text: "Run `echo foo` today.\n", found: [], control: { from: "echo foo", to: "echo bar", found: ["echo foo"] } },
  { clause: "23a", limit: 4, check: "restructure-value", before: "Run `a. b` now.\n", text: "Run `a. c` now.\n\nKeep b.\n", found: ["a. b"], control: { from: "a. c", to: "a. b", found: [] } },
  { clause: "25a", limit: 1, check: "provisional-label", text: "Our layout follows Part 5.\n", found: [], control: { from: "Part 5", to: "ISO 24495-5", found: [UNLABELLED] } },
  { clause: "25a", limit: 1, check: "provisional-label", text: "Run `iso-24495-5` on it.\n", found: [UNLABELLED], control: { from: "iso-24495-5", to: "iso-24495-4", found: [] } },
  { clause: "25a", limit: 1, check: "provisional-label", text: "Our layout follows ISO 24495-50.\n", found: [], control: { from: "24495-50", to: "24495-5", found: [UNLABELLED] } },
  { clause: "25a", limit: 1, check: "provisional-label", text: `Our layout follows ISO 24495${NON_BREAKING_HYPHEN}5.\n`, found: [], control: { from: NON_BREAKING_HYPHEN, to: "-", found: [UNLABELLED] } },
  { clause: "25a", limit: 1, check: "provisional-label", text: "Read the [guide](iso-24495-5.md).\n", found: [], control: { from: "[guide](iso-24495-5.md)", to: "[ISO 24495-5](guide.md)", found: [UNLABELLED] } },
  { clause: "25a", limit: 1, check: "provisional-label", text: "ISO **24495**-5.\n", found: [], control: { from: "**24495**", to: "24495", found: [UNLABELLED] } },
  { clause: "25a", limit: 1, check: "provisional-label", text: "| Guide |\n|---|\n| [guide](iso-24495-5.md) |\n", found: [], control: { from: "[guide](iso-24495-5.md)", to: "[ISO 24495-5](guide.md)", found: [UNLABELLED] } },
  { clause: "25a", limit: 1, check: "provisional-label", text: "| A | B |\n|---|---|\n| [a](x|iso-24495-5.md) |\n", found: [UNLABELLED], control: { from: "|iso", to: "/iso", found: [] } },
  { clause: "25a", limit: 1, check: "provisional-label", text: "| A |\n|---|\n| a | ISO 24495-5 |\n", found: [], control: { from: "| A |\n|---|", to: "| A | B |\n|---|---|", found: [UNLABELLED] } },
  { clause: "25a", limit: 2, check: "provisional-label", text: "ISO 24495-5 is not a draft.\n", found: [], control: { from: "not a draft", to: "settled", found: [UNLABELLED] } },
  { clause: "25a", limit: 2, check: "provisional-label", text: "Run `iso-24495-5` (provisional) on it.\n", found: [], control: { from: " (provisional)", to: "", found: [UNLABELLED] } },
  { clause: "25a", limit: 2, check: "provisional-label", text: "# ISO 24495-5\n\nIt is a draft.\n", found: [UNLABELLED], control: { from: "\n\nIt is a draft.", to: " (draft)", found: [] } },
  { clause: "25a", limit: 2, check: "provisional-label", text: "We follow ISO 24495-5.\n\nThis guide is a draft.\n", found: [UNLABELLED], control: { from: "24495-5.\n\nThis", to: "24495-5. This", found: [] } },
  { clause: "25a", limit: 2, check: "provisional-label", text: "ISO 24495-5 is a draft.\n\nWe follow ISO 24495-5.\n", found: [], control: { from: "is a draft", to: "is long", found: [UNLABELLED] } },
  { clause: "25a", limit: 2, check: "provisional-label", text: "The guide was drafted against ISO 24495-5.\n", found: [UNLABELLED], control: { from: "drafted", to: "a draft", found: [] } },
  { clause: "25a", limit: 2, check: "provisional-label", text: "We follow ISO 24495-5.\n\nRun `iso-24495-5` on it.\n", found: [UNLABELLED], control: { from: "We follow ISO 24495-5.", to: "We follow ISO 24495-5, a draft.", found: [] } },
  { clause: "25a", limit: 2, check: "provisional-label", text: "| Skill | Status |\n|---|---|\n| `iso-24495-5` | provisional |\n", found: [], control: { from: "provisional", to: "ready", found: [UNLABELLED] } },
  { clause: "25a", limit: 2, check: "provisional-label", text: "ISO 24495-5 is pro**vision**al.\n", found: [UNLABELLED], control: { from: "pro**vision**al", to: "provisional", found: [] } },
  { clause: "25a", limit: 2, check: "provisional-label", text: "ISO 24495-5, see the [guide](draft.md).\n", found: [UNLABELLED], control: { from: "[guide](draft.md)", to: "[draft](guide.md)", found: [] } },
  { clause: "25a", limit: 2, check: "provisional-label", text: "| Guide |\n|---|\n| ISO 24495-5 [guide](draft.md) |\n", found: [UNLABELLED], control: { from: "[guide](draft.md)", to: "[draft](guide.md)", found: [] } },
  { clause: "25a", limit: 3, check: "provisional-label", text: "```\nISO 24495-5\n```\n", found: [], control: { from: "```\nISO 24495-5\n```", to: "ISO 24495-5", found: [UNLABELLED] } },
  { clause: "25a", limit: 3, check: "provisional-label", text: "Text.\n\n    ISO 24495-5\n", found: [], control: { from: "    ISO", to: "ISO", found: [UNLABELLED] } },
  { clause: "25a", limit: 3, check: "provisional-label", text: "<!-- ISO 24495-5 -->\n\nText.\n", found: [], control: { from: "<!-- ISO 24495-5 -->", to: "ISO 24495-5", found: [UNLABELLED] } },
  { clause: "25a", limit: 3, check: "provisional-label", text: "Never write \"ISO 24495-5\" alone.\n", found: [], control: { from: "\"ISO 24495-5\"", to: "ISO 24495-5", found: [UNLABELLED] } },
  { clause: "25a", limit: 3, check: "provisional-label", text: "ISO 24495-5 is a \"draft\".\n", found: [UNLABELLED], control: { from: "\"draft\"", to: "draft", found: [] } },
  { clause: "25a", limit: 3, check: "provisional-label", text: "---\nsource: ISO 24495-5\n---\n\nText.\n", found: [], control: { frontMatter: false, found: [UNLABELLED] } },
  { clause: "25a", limit: 3, check: "provisional-label", text: "<pre>\nISO 24495-5\n</pre>\n", found: [UNLABELLED], control: { from: "<pre>\nISO 24495-5\n</pre>", to: "```\nISO 24495-5\n```", found: [] } },
  { clause: "25a", limit: 3, check: "provisional-label", text: "| Guide |\n|---|\n| <!-- ISO 24495-5 -->Guide |\n", found: [], control: { from: "<!-- ISO 24495-5 -->", to: "ISO 24495-5 ", found: [UNLABELLED] } },
  { clause: "25a", limit: 3, check: "provisional-label", text: "| Guide |\n|---|\n| ISO 24495-5 <!-- draft --> |\n", found: [UNLABELLED], control: { from: "<!-- draft -->", to: "draft", found: [] } },
  { clause: "25a", limit: 3, check: "provisional-label", text: "Read the <span title='ISO 24495-5'>guide</span>.\n", found: [], control: { from: "<span title='ISO 24495-5'>guide</span>", to: "ISO 24495-5 guide", found: [UNLABELLED] } },
  { clause: "25a", limit: 3, check: "provisional-label", text: "| Guide |\n|---|\n| <span title='ISO 24495-5'>Guide</span> |\n", found: [], control: { from: "<span title='ISO 24495-5'>Guide</span>", to: "ISO 24495-5 Guide", found: [UNLABELLED] } },
];

/**
 * How many limit specimens back each limit, keyed by clause, its limits in
 * order. A specimen added or removed changes this, so the change has to be
 * made here as well.
 */
const SPECIMENS_PER_LIMIT: Readonly<Record<string, readonly number[]>> = {
  "1a": [4],
  "3a": [6, 18, 21],
  "3b": [22, 3],
  "6a": [10, 1],
  "8c": [4],
  "9b": [8, 8, 26, 1],
  "10c": [3, 1],
  "12a": [11, 8],
  "12b": [48, 2, 3, 13, 24],
  "12c": [44, 2, 2, 2],
  "13b": [4, 6],
  "15a": [2, 0],
  "15c": [1, 1],
  "15d": [1, 1],
  "15f": [1, 12, 19],
  "17a": [3, 11],
  "19b": [4, 2, 5],
  "19d": [5, 6, 6, 6, 3, 1, 2],
  "20a": [2, 4, 2],
  "20b": [4, 5, 3, 0, 1],
  "21a": [3, 2, 5, 2],
  "21b": [3, 5],
  "22a": [4, 3],
  "23a": [6, 18, 14, 13, 0],
  "23b": [2, 4, 2],
  "25a": [9, 11, 11],
};

/** The test that shows the last limit of 20b and of 23a, which compares versions too large to weigh. */
const WEIGHING_TEST = "past the weighing limit, the comparison pairs nothing, reads no table, lists no value and says so";

/** The test that shows 15a's second limit, which runs both audits and reads what they print. */
const PRINT_TEST = "a preview of either audit prints the opening-title finding, and a send that stops before it sends does not";

/**
 * The limits a test of their own shows instead of a limit specimen, by
 * clause and limit number, with the name of that test. Each has no limit
 * specimen.
 */
const LIMITS_SHOWN_BY_A_TEST: Readonly<Record<string, string>> = { "15a.2": PRINT_TEST, "20b.4": WEIGHING_TEST, "23a.5": WEIGHING_TEST };

/**
 * A digest of the limit specimens that back each limit, keyed by clause,
 * its limits in order, as `digestOf` writes it. Every part of each
 * specimen counts, its text above all, so a specimen changed here and not
 * in its digest fails. The change has to be made in both places on purpose.
 */
const LIMIT_SPECIMEN_DIGESTS: Readonly<Record<string, readonly string[]>> = {
  "1a": ["05c161cc89c947e2"],
  "3a": ["bec14fbb73268aeb", "19259afeef2d29c4", "18e740d0195e1360"],
  "3b": ["a89a361732bfc545", "cb48ca7f8f73c2bf"],
  "6a": ["a0eca4bb5ee78b0b", "ac7780100b062b44"],
  "8c": ["1e7ef38789ed8e7f"],
  "9b": ["99c493162f01aa4e", "a471bdd7bd76b27b", "b4c3f5010ee1eff7", "ceaaded3dfdafc7c"],
  "10c": ["715422e93c74c160", "9136f07360ae2af1"],
  "12a": ["52d00e27020486eb", "fba17df6643bd1d8"],
  "12b": ["70527e3f6be02239", "0a8d2b897cc61c2d", "978b9b349ab33d16", "dc14dabc5b0e0873", "674628e5f56dee55"],
  "12c": ["d230a142efde418d", "bf869cb66a91d31c", "0c0fabba94c93851", "444769517fdfd5cd"],
  "13b": ["b953b20f9ff853b2", "b24f75b567f42726"],
  "15a": ["de56b3a6afc9946f", "4f53cda18c2baa0c"],
  "15c": ["371efd19a5ca4c2e", "1afc94d906a22e1b"],
  "15d": ["e5a917bc6401d872", "6b5bdba68c9c7dcb"],
  "15f": ["463bba50c60651a7", "72c02ad5ffca09f8", "cbe52aeab5b5f019"],
  "17a": ["cfc121eded58bd56", "347357b868e06e98"],
  "19b": ["8d7374144d4bb978", "8e3c4f0d60d846d8", "a2f3adc83db9c51d"],
  "19d": ["158731c1cbd995b3", "4ead0c2b7442da76", "2fea839acce8ecf8", "8e6ac8af7b8d42ac", "f321e10be3b9cd16", "9a9c678461efcfde", "bfb05222f94b4000"],
  "20a": ["33013b31c9957fad", "694867c80cb848a9", "07fa519e7ed2b7a3"],
  "20b": ["eb1ab916de0f39e1", "27bfab238ead99db", "57cff3e6b60fcaf3", "4f53cda18c2baa0c", "6d75ad5f9e457b18"],
  "21a": ["3b17814a63e62b11", "3b754fa55057fc97", "0e60fa8f01851b96", "12d1c0838eff6d32"],
  "21b": ["e52f54e7545cd726", "b37773368f704475"],
  "22a": ["1224b0f4632021e6", "53d917c002246746"],
  "23a": ["d386ec890eb05491", "23405503f912e7f1", "f6c08f92c4a461bd", "5ff30eb936981e30", "4f53cda18c2baa0c"],
  "23b": ["a38dd81a0292b5e4", "22bbc5d504e85772", "98f759163397de5f"],
  "25a": ["e2349adc4cce5065", "7868d82e12361114", "722af960a8b0ab98"],
};

/** A digest of each clause specimen, text and reasons, keyed by the clause, as `digestOf` writes it. */
const SPECIMEN_DIGESTS: Readonly<Record<string, string>> = {
  "1a": "634f9b7d0d8339ae",
  "3a": "05deb1c41fc09209",
  "3b": "2b287cac5742b449",
  "6a": "1fe5e2c752ffae09",
  "8c": "de544846e4fdb6fa",
  "9b": "5090ff4499d5b3d2",
  "10c": "ecdf55f88967aded",
  "12a": "c56cf169d00f950c",
  "12b": "a9413d3cd9973b1f",
  "12c": "2dbe29dac4576a69",
  "13b": "4bf003ee610bafdf",
  "15a": "dde96eedfccfa4b5",
  "15c": "14cef7c0a528c820",
  "15d": "14cef7c0a528c820",
  "15f": "a110f40c437220f5",
  "17a": "6371233b39f075a5",
  "19b": "44fdcbd1ca38383e",
  "19d": "f4449702033d278c",
  "20a": "a146fb876a677b53",
  "20b": "f75b5601294ff0a5",
  "21a": "e5e214b5ae080f5c",
  "21b": "ca4561dc88636124",
  "22a": "0d7658fd5996b91b",
  "23a": "f87806aa2421b71d",
  "23b": "a146fb876a677b53",
  "25a": "8147f5bfb7a185bc",
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
 * coverage counts, because a report lists no pass among its results. The
 * two-version comparison names `restructure-dropped` for the file after
 * when it drops a unit, `restructure-added` when it adds one,
 * `restructure-moved` when a kept unit moved, `restructure-step-order`
 * when a kept unit of a step is out of order, `restructure-rewritten` when
 * it pairs a reworded unit or reads one with a new table, and
 * `restructure-value` when a value is not found.
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
  for (const [rule, units] of restructureFindings(report)) {
    if (units.length > 0) addName(named, report.restructure?.after ?? "", rule, "offline");
  }
  return named;
}

/**
 * The units a report's two-version comparison gives for each of its checks:
 * those dropped, those added, the kept units moved, the kept units of steps
 * out of order, and the units rewritten or read with a new table, each as
 * its excerpt, then each value not found.
 */
function restructureFindings(report: ReportJson): Array<[string, string[]]> {
  const restructure = report.restructure;
  if (restructure === undefined) return [];
  return [
    ["restructure-dropped", restructure.dropped.map(unit => unit.excerpt)],
    ["restructure-added", restructure.added.map(unit => unit.excerpt)],
    ["restructure-moved", restructure.moved.map(unit => unit.excerpt)],
    ["restructure-step-order", restructure.stepOrder.map(unit => unit.excerpt)],
    ["restructure-rewritten", [...restructure.rewritten.map(pair => pair.excerpt), ...restructure.tables.map(table => table.excerpt)]],
    ["restructure-value", restructure.values.map(value => value.value)],
  ];
}

/** Records that a report named a check for a file, and of which kind. */
function addName(named: Map<string, Map<string, Check["kind"]>>, file: string, check: string, kind: Check["kind"]): void {
  named.set(file, (named.get(file) ?? new Map<string, Check["kind"]>()).set(check, kind));
}

/**
 * The detail of each offline finding a report gives each file, by rule and
 * in the order the report lists them: the mechanical findings, then the
 * planner's, then the excerpt of each unit the two-version comparison drops
 * or adds.
 */
function reasonsInReport(report: ReportJson): Map<string, Map<string, string[]>> {
  const reasons = new Map<string, Map<string, string[]>>();
  const mechanical = report.mechanical ?? report;
  const findings = [
    ...Object.entries(mechanical.files ?? {}).flatMap(([file, result]) => result.violations.map(finding => ({ file, ...finding }))),
    ...report.jev?.localFindings ?? [],
  ];
  for (const [rule, units] of restructureFindings(report)) {
    findings.push(...units.map(detail => ({ file: report.restructure?.after ?? "", rule, detail })));
  }
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
  readonly restructure?: {
    readonly after: string;
    readonly dropped: ReadonlyArray<{ readonly excerpt: string }>;
    readonly added: ReadonlyArray<{ readonly excerpt: string }>;
    readonly moved: ReadonlyArray<{ readonly excerpt: string }>;
    readonly stepOrder: ReadonlyArray<{ readonly excerpt: string }>;
    readonly rewritten: ReadonlyArray<{ readonly excerpt: string }>;
    readonly tables: ReadonlyArray<{ readonly excerpt: string }>;
    readonly values: ReadonlyArray<{ readonly value: string }>;
  };
}

let routeReadings: Promise<RouteReading[]> | undefined;

/**
 * Runs every route once over one directory holding each specimen twice, as
 * `<clause>.md` and as `<clause>.txt`, and reads what each named. A route
 * given `--before` runs once for each of those files instead. The runs are
 * made on the first call and shared after it.
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
  const originals = mkdtempSync(join(tmpdir(), "checklist-originals-"));
  try {
    for (const [id, specimen] of Object.entries(SPECIMENS)) {
      writeFileSync(join(directory, `${id}.md`), specimen.text);
      writeFileSync(join(directory, `${id}.txt`), specimen.text);
      writeFileSync(join(originals, `${id}.md`), specimen.before ?? specimen.text);
    }
    const readings: RouteReading[] = [];
    for (const [index, route] of ROUTES.entries()) {
      const json = join(tmpdir(), `checklist-route-${process.pid}-${index}.json`);
      const requests: string[] = [];
      const dependencies = stubbedDependencies(requests);
      const named = new Map<string, Map<string, Check["kind"]>>();
      const reasons = new Map<string, Map<string, string[]>>();
      const runs = route.options.includes("--before")
        ? Object.keys(SPECIMENS).flatMap(id => route.reads.map(extension => ({ target: join(directory, `${id}.${extension}`), original: join(originals, `${id}.md`) })))
        : [{ target: directory, original: "" }];
      for (const run of runs) {
        const exit = await runRoute(route, run.target, json, dependencies, directory, run.original);
        if (exit !== 0) throw new Error(`${route.name} exited ${exit}.`);
        const report: ReportJson = JSON.parse(readFileSync(json, "utf8"));
        for (const [file, checks] of namedInReport(report)) {
          named.set(file, checks);
        }
        for (const [file, rules] of reasonsInReport(report)) {
          reasons.set(file, rules);
        }
        rmSync(json, { force: true });
      }
      if (!route.meets.includes("send") && requests.length > 0) throw new Error(`${route.name} sent a request.`);
      if (route.meets.includes("send") && requests.length === 0) throw new Error(`${route.name} sent nothing.`);
      readings.push({ route, named, reasons });
    }
    return readings;
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(originals, { recursive: true, force: true });
  }
}

/**
 * Runs one route over a target, with its report written to `json`.
 *
 * @param target The directory of specimens, or one specimen for a route
 *     given `--before`.
 * @param projectDirectory The folder paths are named from. Left out, it is
 *     the target.
 * @param original The file `--before` names, for a route that takes it.
 * @returns The command's exit code.
 */
async function runRoute(route: Route, target: string, json: string, dependencies: AuditDependencies, projectDirectory = target, original = ""): Promise<number> {
  const options = route.options.flatMap(option => option === "--before" ? [option, original] : [option]);
  const argv = ["bun", "cli", target, "--project-dir", projectDirectory, ...options, "--json", json];
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
 * when no route names it on the `.txt` copy. Then each other need in turn,
 * judged only on the routes that do not meet it but meet every need found
 * before it: it is a need when there is such a route and none of them names
 * the check on either copy.
 *
 * So the Jev route is a need when neither plain text audit names it, a send
 * when no preview names it, and front matter when the text audit with
 * `--no-front-matter` does not name it. A Jev check is not judged for front
 * matter, because no route that refuses it takes the Jev route.
 */
function measuredNeeds(check: string, clause: string, readings: readonly RouteReading[]): Need[] {
  const needs: Need[] = [];
  if (!readings.some(reading => names(reading, `${clause}.txt`, check))) needs.push("markdown");
  for (const need of ROUTE_NEEDS) {
    const lacking = readings.filter(reading => !reading.route.meets.includes(need) && needs.every(found => found === "markdown" || reading.route.meets.includes(found)));
    if (lacking.length > 0 && !lacking.some(reading => names(reading, `${clause}.md`, check) || names(reading, `${clause}.txt`, check))) needs.push(need);
  }
  return needs;
}

/** Whether a route named a check for one specimen file. */
function names(reading: RouteReading, file: string, check: string): boolean {
  return reading.named.get(file)?.has(check) ?? false;
}

/**
 * Front matter put before each specimen for the option sweep. Its last line
 * sits directly above the closing "---", so a run that reads the block as
 * text reads its two lines as a heading, and reports its style.
 */
const SWEEP_FRONT_MATTER = "---\n"
  + "summary: This summary line is written on purpose to be far longer than any single sentence that a careful reader should ever have to meet in one go here.\n"
  + "title: Probe\n---\n\n";

/** A document whose acronym only the project's acronym list defines. */
const ACRONYM_PROBE = "# Probe\n\nThe QZXW tool runs every day.\n";

/**
 * A document whose front matter holds a vague link. The plain text audit,
 * reading the block as front matter, finds no link in it:
 *
 *     | `metadata.md` | 5 | opening-version-date | No version or date was recognised in the opening. Would readers need one to identify the edition or judge how current it is? |
 *
 * With `--no-front-matter` it reads the block as text, so the link-text
 * check of 12a and 19b reports the metadata, the heading check reports the
 * block's last line, and the version or date check is off:
 *
 *     | `metadata.md` | 2 | heading-style | heading ends with a full stop |
 *     | `metadata.md` | 2 | link-text | link text "here" describes no destination (metadata.md) |
 *
 * So `--no-front-matter` can change what a fault check other than 15f's
 * finds. The option sweep does not see this, because it compares each
 * clause's checks on that clause's own specimens, and no specimen holds a
 * link in its front matter.
 */
const METADATA_PROBE = "---\nsummary: Read [here](metadata.md).\n---\n\n# Appliance\n\nClose the valve.\n";

/**
 * What one plain text audit named and found, read from its `--json` report.
 * The report is written in `directory` and removed.
 *
 * @throws An `Error` when the run exits with anything but 0.
 */
async function reportOf(argv: readonly string[], directory: string): Promise<Omit<RouteReading, "route">> {
  const json = join(directory, "author-sweep.json");
  const run = await printed("text", ["bun", "cli", ...argv, "--json", json], []);
  if (run.exit !== 0) throw new Error(`The text audit exited ${run.exit}.`);
  const report: ReportJson = JSON.parse(readFileSync(json, "utf8"));
  rmSync(json, { force: true });
  return { named: namedInReport(report), reasons: reasonsInReport(report) };
}

/** The rows of a printed table of findings that name `metadata.md`. */
function metadataRows(text: string): string[] {
  return text.split("\n").filter(line => line.startsWith("| `metadata.md` |"));
}

/** The finding of the version or date check when the opening has neither. */
const NO_VERSION_OR_DATE = "No version or date was recognised in the opening. Would readers need one to identify the edition or judge how current it is?";

/**
 * One option of either audit, swept over every specimen: the command, the
 * options it runs with beside the option and without it, and whether the
 * run without it agrees at a terminal. `--project-dir` is swept by what it
 * chooses, the project folder's acronym list, so both runs keep the same
 * folder and the same file names.
 */
interface Sweep {
  readonly name: string;
  readonly command: Route["command"];
  readonly without: readonly string[];
  readonly with: readonly string[];
  readonly acronyms?: boolean;
  readonly agreesWithout?: boolean;
}

/**
 * Every option either audit accepts that is not a route option. The route
 * options, `--jev-preview`, `--jev` and `--send`, are measured as needs by
 * the test of each clause's needs. `--json` is swept by what each audit
 * prints, since the other runs read the report it writes.
 */
const SWEEPS: readonly Sweep[] = [
  { name: "text audit --no-front-matter", command: "text", without: [], with: ["--no-front-matter"] },
  { name: "text audit, acronym list of --project-dir", command: "text", without: [], with: [], acronyms: true },
  { name: "text audit --jev-preview, acronym list of --project-dir", command: "text", without: ["--jev-preview"], with: ["--jev-preview"], acronyms: true },
  { name: "text audit --jev-preview --include-judged-text", command: "text", without: ["--jev-preview"], with: ["--jev-preview", "--include-judged-text"] },
  { name: "text audit --jev --send, acronym list of --project-dir", command: "text", without: ["--jev", "--send", "--yes"], with: ["--jev", "--send", "--yes"], acronyms: true },
  { name: "text audit --jev --send --include-judged-text", command: "text", without: ["--jev", "--send", "--yes"], with: ["--jev", "--send", "--yes", "--include-judged-text"] },
  { name: "text audit --jev --send --yes", command: "text", without: ["--jev", "--send"], with: ["--jev", "--send", "--yes"], agreesWithout: true },
  { name: "design audit, acronym list of --project-dir", command: "design", without: [], with: [], acronyms: true },
  { name: "design audit --include-judged-text", command: "design", without: [], with: ["--include-judged-text"] },
  { name: "design audit --send, acronym list of --project-dir", command: "design", without: ["--send", "--yes"], with: ["--send", "--yes"], acronyms: true },
  { name: "design audit --send --include-judged-text", command: "design", without: ["--send", "--yes"], with: ["--send", "--yes", "--include-judged-text"] },
  { name: "design audit --send --yes", command: "design", without: ["--send"], with: ["--send", "--yes"], agreesWithout: true },
];

/**
 * What each sweep changed on the sweep's specimens, by fault clause: `off`
 * lists the clauses with a check that one side named and the other did not,
 * and `reads` the other clauses with an offline check whose findings differ
 * between the sides. On those specimens only `--no-front-matter` changes a
 * clause, and only 15f. `METADATA_PROBE` shows that on another input it
 * changes the findings of 12a and 19b as well.
 */
const SWEEP_CHANGES: Readonly<Record<string, { readonly off: readonly string[]; readonly reads: readonly string[] }>> = Object.fromEntries(
  SWEEPS.map(sweep => [sweep.name, { off: sweep.name === "text audit --no-front-matter" ? ["15f"] : [], reads: [] }]),
);

/**
 * What one side of a sweep named for each file. The project folder holds the
 * acronym list only on the side with the option. A run that does not agree
 * at a terminal is given one that agrees.
 *
 * @throws An `Error` when the run exits with anything but 0.
 */
async function sweepNamed(sweep: Sweep, withOption: boolean, directory: string): Promise<Omit<RouteReading, "route">> {
  const list = join(directory, ".iso-24495-4", "acronyms.json");
  rmSync(list, { force: true });
  if (withOption && sweep.acronyms === true) {
    mkdirSync(join(directory, ".iso-24495-4"), { recursive: true });
    writeFileSync(list, JSON.stringify(["QZXW"]));
  }
  const json = join(tmpdir(), `checklist-sweep-${process.pid}.json`);
  const dependencies = stubbedDependencies([]);
  const agreeing: AuditDependencies = { ...dependencies, terminal: { inputIsTTY: true, outputIsTTY: true, prompt: async () => "yes" } };
  const route: Route = { name: sweep.name, command: sweep.command, options: withOption ? sweep.with : sweep.without, meets: [], reads: [] };
  const exit = await runRoute(route, directory, json, !withOption && sweep.agreesWithout === true ? agreeing : dependencies);
  if (exit !== 0) throw new Error(`${sweep.name} exited ${exit}.`);
  const report: ReportJson = JSON.parse(readFileSync(json, "utf8"));
  rmSync(json, { force: true });
  return { named: namedInReport(report), reasons: reasonsInReport(report) };
}

/** Whether two runs differ on whether they named a check for a file. */
function namesDiffer(first: Omit<RouteReading, "route">, second: Omit<RouteReading, "route">, file: string, check: string): boolean {
  return (first.named.get(file)?.has(check) ?? false) !== (second.named.get(file)?.has(check) ?? false);
}

/** Every rule either run gave a finding of for a file. */
function rulesFound(first: Omit<RouteReading, "route">, second: Omit<RouteReading, "route">, file: string): string[] {
  return [...new Set([...first.reasons.get(file)?.keys() ?? [], ...second.reasons.get(file)?.keys() ?? []])];
}

/** Whether two runs differ on the findings an offline check gave for a file. */
function findingsDiffer(first: Omit<RouteReading, "route">, second: Omit<RouteReading, "route">, file: string, check: string): boolean {
  return JSON.stringify(first.reasons.get(file)?.get(check) ?? []) !== JSON.stringify(second.reasons.get(file)?.get(check) ?? []);
}

/**
 * What one run of an audit printed on standard output, block by block, with
 * a stubbed transport and no terminal to agree on. The run must exit 0.
 */
async function printedBlocks(command: Route["command"], argv: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  const dependencies = stubbedDependencies([]);
  if (command === "text") {
    expect(await runTextCli(["bun", "cli", ...argv], text => out.push(text), ignore, dependencies)).toBe(0);
    return out;
  }
  expect(await runDesignCli(["bun", "cli", ...argv], text => out.push(text), ignore, dependencies)).toBe(0);
  return out;
}

/**
 * What one check gives on a reading. For a text, `auditText` reads it as
 * Markdown, with the file name and front matter setting given, and
 * `planDocument` plans it; the result is the detail of each finding of the
 * rule named, in that order. For answers, `classify` reads them; the result
 * is the question with the band, then any diagnosis gate. For a check of the
 * two-version comparison, the text is compared with its original and the
 * author's wording; the result is the text of each unit dropped or added,
 * or of each kept unit moved or out of step order, as the check names.
 */
function limitFound(reading: LimitReading): string[] {
  if (reading.check.startsWith("restructure-")) {
    const comparison = compareVersions(reading.before ?? "", reading.text ?? "", reading.authorText ?? null, reading.frontMatter === undefined ? {} : { frontMatter: reading.frontMatter });
    if (reading.check === "restructure-moved") return comparison.moved.map(pair => pair.after.key);
    if (reading.check === "restructure-step-order") return comparison.stepOrder.map(pair => pair.after.key);
    if (reading.check === "restructure-rewritten") return [...comparison.rewritten.map(pair => pair.after.key), ...comparison.tables.map(table => table.sources[0]?.key ?? "")];
    if (reading.check === "restructure-value") return comparison.values.map(value => value.value);
    return (reading.check === "restructure-dropped" ? comparison.dropped : comparison.added).map(unit => unit.key);
  }
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
 * `to`, and the control's original, author's wording, file name, front
 * matter setting or answers in place of the specimen's.
 */
function underControl(specimen: LimitSpecimen): LimitReading {
  const { control } = specimen;
  const text = specimen.text === undefined || control.from === undefined ? specimen.text : specimen.text.split(control.from).join(control.to ?? "");
  const fileName = control.fileName ?? specimen.fileName;
  const frontMatter = control.frontMatter ?? specimen.frontMatter;
  const answers = control.answers ?? specimen.answers;
  const before = control.before ?? specimen.before;
  const authorText = control.authorText ?? specimen.authorText;
  return {
    check: specimen.check,
    ...(text === undefined ? {} : { text }),
    ...(before === undefined ? {} : { before }),
    ...(authorText === undefined ? {} : { authorText }),
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
    for (const clause of CLAUSES) {
      // The design audit takes no --before, so a check that needs the original is read on the text audit given it.
      const fullest = readings.find(reading => reading.route.name === (clause.needs.includes("before") ? "text audit --before" : "design audit --send"));
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

  test("both Jev routes refuse --no-front-matter, so only the plain text audit can leave the front matter need unmet", async () => {
    const directory = mkdtempSync(join(tmpdir(), "checklist-front-matter-"));
    try {
      const file = join(directory, "dated.md");
      writeFileSync(file, SPECIMENS["15f"]?.text ?? "");
      const jevRoutes = ROUTES.filter(route => route.meets.includes("jev-route"));
      expect(jevRoutes).toHaveLength(4);
      for (const route of jevRoutes) {
        const requests: string[] = [];
        const run = await printed(route.command, ["bun", "cli", file, "--project-dir", directory, ...route.options, "--no-front-matter"], requests);
        expect(run.exit, route.name).toBe(2);
        expect(requests, route.name).toEqual([]);
      }
      expect(ROUTES.filter(route => !route.meets.includes("front-matter")).map(route => route.options)).toEqual([["--no-front-matter"], ["--before", "--no-front-matter"]]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the design audit and both Jev routes refuse --before and --author-text, so only the plain text audit meets the original-version need", async () => {
    const directory = mkdtempSync(join(tmpdir(), "checklist-before-"));
    try {
      const file = join(directory, "doc.md");
      const original = join(directory, "original.md");
      writeFileSync(file, SPECIMENS["20a"]?.text ?? "");
      writeFileSync(original, SPECIMENS["20a"]?.before ?? "");
      const refusing = ROUTES.filter(route => route.command === "design" || route.meets.includes("jev-route"));
      expect(refusing).toHaveLength(4);
      for (const route of refusing) {
        for (const option of ["--before", "--author-text"]) {
          const requests: string[] = [];
          const run = await printed(route.command, ["bun", "cli", file, "--project-dir", directory, ...route.options, option, original], requests);
          expect(run.exit, `${route.name} ${option}`).toBe(2);
          expect(requests, `${route.name} ${option}`).toEqual([]);
        }
      }
      expect(ROUTES.filter(route => route.meets.includes("before")).map(route => [route.command, ...route.options]))
        .toEqual([["text", "--before"], ["text", "--before", "--no-front-matter"]]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // What this sweep establishes: each of the 12 sweeps runs the audit over
  // one folder with its option and without it. For each of the 25 fault
  // clauses, 300 cells, it compares the two runs on that clause's own
  // specimen, as written and behind front matter, each as a .md file and a
  // .txt file. A cell changes when one run names a check of the clause on
  // one of those four files and the other does not, or when an offline
  // check's finding details differ there. Only the cell of 15f under
  // --no-front-matter changes.
  //
  // What it does not establish: that the same holds on every input. It holds
  // for these specimens only, and it compares neither line numbers nor Jev
  // scores, only which Jev bands are named. No sweep gives --before, so the
  // seven clauses that need it are named on neither side; the sweep of
  // --author-text has a test of its own. On METADATA_PROBE,
  // --no-front-matter also changes what the link-text check of 12a and 19b
  // finds. The reading's claim of the clauses a run is set to use is about
  // which checks run, not about what they find.
  test("on each fault clause's own specimens, no option of either audit changes that clause's checks, but --no-front-matter on 15f", async () => {
    const directory = mkdtempSync(join(tmpdir(), "checklist-sweep-"));
    try {
      for (const [id, specimen] of Object.entries(SPECIMENS)) {
        for (const [ending, text] of [["", specimen.text], ["-fm", SWEEP_FRONT_MATTER + specimen.text]] as const) {
          writeFileSync(join(directory, `${id}${ending}.md`), text);
          writeFileSync(join(directory, `${id}${ending}.txt`), text);
        }
      }
      writeFileSync(join(directory, "acronym-probe.md"), ACRONYM_PROBE);
      writeFileSync(join(directory, "metadata.md"), METADATA_PROBE);
      const changes: Record<string, { readonly off: readonly string[]; readonly reads: readonly string[] }> = {};
      let cells = 0;
      for (const sweep of SWEEPS) {
        const without = await sweepNamed(sweep, false, directory);
        const withOption = await sweepNamed(sweep, true, directory);
        const change = { off: [] as string[], reads: [] as string[] };
        changes[sweep.name] = change;
        for (const clause of CLAUSES.filter(found => found.state === "fault")) {
          cells++;
          const files = ["", "-fm"].flatMap(ending => [`${clause.id}${ending}.md`, `${clause.id}${ending}.txt`]);
          if (clause.checks.some(check => files.some(file => namesDiffer(without, withOption, file, check.rule)))) {
            change.off.push(clause.id);
          } else if (clause.checks.some(check => check.kind === "offline" && files.some(file => findingsDiffer(without, withOption, file, check.rule)))) {
            change.reads.push(clause.id);
          }
        }
        // Front matter read as text acts on more than 15f: some other finding
        // differs on a file that opens with front matter.
        if (sweep.name === "text audit --no-front-matter") {
          const fileNames = [...new Set([...without.reasons.keys(), ...withOption.reasons.keys()])].filter(file => file.includes("-fm."));
          expect(fileNames.some(file => rulesFound(without, withOption, file).some(rule => rule !== "opening-version-date" && findingsDiffer(without, withOption, file, rule)))).toBe(true);
          // It also changes a fault check other than 15f's, outside the
          // specimens: the metadata's vague link is found only when the
          // block is read as text.
          expect([Object.fromEntries(without.reasons.get("metadata.md") ?? []), Object.fromEntries(withOption.reasons.get("metadata.md") ?? [])]).toEqual([
            { "opening-version-date": [NO_VERSION_OR_DATE] },
            { "heading-style": ["heading ends with a full stop"], "link-text": ["link text \"here\" describes no destination (metadata.md)"] },
          ]);
        } else {
          // No other sweep changes the metadata probe's offline findings.
          expect(rulesFound(without, withOption, "metadata.md").filter(rule => namesDiffer(without, withOption, "metadata.md", rule) || findingsDiffer(without, withOption, "metadata.md", rule)), sweep.name).toEqual([]);
        }
        // The acronym list acts: it takes the probe's acronym finding away.
        if (sweep.acronyms === true) {
          expect([without.named.get("acronym-probe.md")?.has("acronym-undefined"), withOption.named.get("acronym-probe.md")?.has("acronym-undefined")], sweep.name).toEqual([true, false]);
        }
      }
      expect(cells).toBe(SWEEPS.length * FAULT_CLAUSES);
      expect(changes).toEqual(SWEEP_CHANGES);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120000);

  test("--no-front-matter exposes the metadata probe's link to the link-text check, while the reading still has 12a and 19b in use on both sides", async () => {
    const directory = mkdtempSync(join(tmpdir(), "checklist-metadata-"));
    try {
      const file = join(directory, "metadata.md");
      const json = join(directory, "report.json");
      writeFileSync(file, METADATA_PROBE);
      const base = ["bun", "cli", file, "--project-dir", directory, "--json", json];
      const asFrontMatter = await printed("text", base, []);
      const usedAsFrontMatter: string[] = JSON.parse(readFileSync(json, "utf8")).checklist.run.used;
      const asText = await printed("text", [...base, "--no-front-matter"], []);
      const usedAsText: string[] = JSON.parse(readFileSync(json, "utf8")).checklist.run.used;
      expect([asFrontMatter.exit, asText.exit]).toEqual([0, 0]);
      expect(metadataRows(asFrontMatter.text)).toEqual([`| \`metadata.md\` | 5 | opening-version-date | ${NO_VERSION_OR_DATE} |`]);
      expect(metadataRows(asText.text)).toEqual([
        "| `metadata.md` | 2 | heading-style | heading ends with a full stop |",
        "| `metadata.md` | 2 | link-text | link text \"here\" describes no destination (metadata.md) |",
      ]);
      // The reading says which checks run. The link-text check runs on both
      // sides, and only 15f's check is off when front matter is read as text.
      expect(usedAsFrontMatter).toEqual(expect.arrayContaining(["12a", "19b", "15f"]));
      expect(usedAsText).toEqual(usedAsFrontMatter.filter(id => id !== "15f"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("--json changes nothing either audit prints but the disclosure's name for the report", async () => {
    const directory = mkdtempSync(join(tmpdir(), "checklist-sweep-json-"));
    try {
      for (const [id, specimen] of Object.entries(SPECIMENS)) {
        writeFileSync(join(directory, `${id}.md`), specimen.text);
        writeFileSync(join(directory, `${id}.txt`), specimen.text);
      }
      const json = join(directory, "report.json");
      for (const options of [[], ["--jev-preview"], ["--jev", "--send", "--yes"]]) {
        const without = await printedBlocks("text", [directory, "--project-dir", directory, ...options]);
        const withJson = await printedBlocks("text", [directory, "--project-dir", directory, ...options, "--json", json]);
        expect(withJson.length, options.join(" ")).toBe(without.length);
        expect([withJson[0], withJson[1], withJson.at(-1)], options.join(" ")).toEqual([without[0], without[1], without.at(-1)]);
      }
      for (const options of [[], ["--send", "--yes"]]) {
        const without = await printedBlocks("design", [directory, "--project-dir", directory, ...options]);
        const withJson = await printedBlocks("design", [directory, "--project-dir", directory, ...options, "--json", json]);
        expect(withJson.length, options.join(" ")).toBe(without.length);
        expect([withJson[0], withJson[1], withJson.at(-1)], options.join(" ")).toEqual([without[0], without[1], without.at(-1)]);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60000);

  // --author-text is the one option left that no route or sweep above gives.
  // It is swept here on each specimen, compared with its original, one file
  // at a time: wording that matches no specimen changes no check, and the
  // added sentence of 22a's specimen, given as the author's, takes 22a's
  // finding away.
  test("--author-text changes no check of any specimen unless it holds the wording that specimen added", async () => {
    const directory = mkdtempSync(join(tmpdir(), "checklist-author-"));
    try {
      const unrelated = join(directory, "unrelated.txt");
      const added = join(directory, "added.txt");
      writeFileSync(unrelated, "Nothing in any specimen says this.\n");
      writeFileSync(added, "The valve is new.\n");
      const changed: string[] = [];
      for (const [id, specimen] of Object.entries(SPECIMENS)) {
        writeFileSync(join(directory, `${id}.md`), specimen.text);
        writeFileSync(join(directory, `${id}-before.md`), specimen.before ?? specimen.text);
        const base = [join(directory, `${id}.md`), "--project-dir", directory, "--before", join(directory, `${id}-before.md`)];
        const without = await reportOf(base, directory);
        expect(await reportOf([...base, "--author-text", unrelated], directory), id).toEqual(without);
        const withAdded = await reportOf([...base, "--author-text", added], directory);
        // JSON.stringify writes every Map as {}, so the two readings are compared deeply.
        if (!Bun.deepEquals(withAdded, without)) changed.push(id);
      }
      expect(changed).toEqual(["22a"]);
      const base = [join(directory, "22a.md"), "--project-dir", directory, "--before", join(directory, "22a-before.md")];
      expect([(await reportOf(base, directory)).named.get("22a.md")?.has("restructure-added"), (await reportOf([...base, "--author-text", added], directory)).named.get("22a.md")?.has("restructure-added")])
        .toEqual([true, undefined]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test(WEIGHING_TEST, () => {
    const comparison = compareVersions("Close the valve 5 times.\n\n".repeat(2_500), "Close the valve now please.\n\n".repeat(2_500), null);
    expect([comparison.weighed, comparison.rewritten.length, comparison.tables.length, comparison.values.length, comparison.dropped.length]).toEqual([false, 0, 0, 0, 2_500]);
    const control = compareVersions("Close the valve 5 times.\n\n".repeat(1_000), "Close the valve now please.\n\n".repeat(1_000), null);
    expect([control.weighed, control.rewritten.length, control.values.length, control.dropped.length]).toEqual([true, 1_000, 1_000, 0]);
  });

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
      expect(control.from !== undefined || control.before !== undefined || control.authorText !== undefined || control.fileName !== undefined
        || control.frontMatter !== undefined || control.answers !== undefined, `${label} control changes something`).toBe(true);
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
