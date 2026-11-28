---
name: iso-24495-text-audit
description: Audit selected Markdown or text for offline mechanical findings. Optionally request calibrated Jev checks. Invoke explicitly.
disable-model-invocation: true
argument-hint: "[file-or-directory]"
metadata:
  version: "0.8.0"
---

# ISO 24495 Text Audit

Audit only the path the user selects. Report mechanical findings so the user can decide whether the text suits its readers and purpose.

## Language and input scope

The audit is written for English and supports English only. The skills and output style are instructions a model interprets, so they are not limited to English in the same way.

Its word rules match English words and phrases: `legalese`, `doublet`, `wordy-phrase`, `filler-opening`, `complex-word`, `double-negative`, and the phrases `link-text`, `provisional-label` and `generic-alt` look for. The `filler-opening` rule checks only the opening prose. The `link-text` rule also flags empty labels and labels that are bare web addresses.

Five word rules read headings as well as prose: `legalese`, `doublet`, `wordy-phrase`, `complex-word`, and `double-negative`. The rules about sentences and paragraphs read prose only, because a heading is not a sentence.

The `sentence-length` and `sentence-average` rules count words separated by whitespace, including spaces and line breaks, and use English benchmarks. The `paragraph-length` rule counts sentences, with a limit of five.

The `prose-enumeration` rule flags three or more distinct ranks in a prose block, including rank one. It recognises English ordinal words and numbered markers from one to six.

The audit reads Markdown as written and does not interpret raw HTML. It sets HTML tags aside and reads the text between them, even where GitHub would hide or change that text.

The audit reports nothing on a document where it may pair code fences differently from CommonMark. One such shape is a fence straight after a comment, a processing instruction or a declaration on the same line. The other is a line shaped like a fence in front matter that is read as front matter.

The check is broad, so it also silences a match inside code, or a quoted fence anywhere below a declaration or processing instruction. With `--before`, when any version holds such a line, every version is compared as holding no text. A true finding there is lost, so an empty report is not a clean one.

## Markdown layout recognition

Seven additional mechanical rules apply to Markdown, while `.txt` remains mechanical-only without structural checks.
These recognition choices are project proxies and remain unmeasured on a corpus.
Raw HTML structure, code and comments are excluded, though the empty signpost rule counts code and any raw HTML other than a comment beneath a heading as content.

The adjacent alerts rule reads no alert below any `<`, even in code, comments or front matter, nor one whose marker the text defines as a link label. Nor does it read one below a line that opens an empty quotation or list item, such as `> >`, `>>` or `-`.
The bullet paragraphs rule reads no item below a line shaped like a fence, fenced code included. Nor does it read one below a line starting HTML that runs past a blank line, such as `<!--`, even in code.
Front matter is excluded from prose checks, but recognised edition metadata can satisfy the version or date rule.

- **Contents list:** At six root H2 sections, require labelled contents or opening navigation containing two same-document fragment links in one block.
- **Wording comparison:** At six sections, resolved contents links must use the target H2 wording, preserving case, punctuation and numbering.
- **Version or date:** Ask whether a titled document needs edition metadata when none is recognised in its opening or front matter.
- **Bullet depth:** Report unordered items beyond two unordered ancestors, counting the item itself and ignoring ordered or quote containers.
- **Bullet paragraphs:** Report an unordered item that holds two or more paragraphs and nothing else, naming how many. An item that holds code, a quotation, a list, a table, a heading or HTML is not read, nor is one in a quotation or four or more columns in. Blank lines between items do not count, so a loose list of one-paragraph items is not reported. It reports only items it is sure of, so some go unreported.
- **Overview label:** At six root H2 sections, require an Overview or Summary heading before the first content H2, at any heading level outside lists and quotations.
- **Empty signpost:** Report a heading worded as a referral, such as See also, Related or Resources, with nothing beneath it. Blank lines, comments, one-line link definitions, thematic breaks and invisible text count as nothing. Any other line counts as content, so some sections that show nothing go unreported. Its section ends at the next heading at its level or above, and headings in lists and quotations are not read.
- **Adjacent alerts:** Report a GitHub alert, such as `> [!NOTE]`, that follows an alert of the same kind with only blank lines between. Alerts of different kinds, alerts in lists or quotations, and alerts with anything else between them are not reported. It reports only alerts it is sure of, so any below a `<` and some others go unreported. Ask whether the two serve one purpose before merging them.

The section count includes Contents, excludes H3 subsections and ignores headings inside lists or quotations.
Recognised contents labels:

```text
Contents
Table of contents
TOC
Key sections
```

Lists, paragraphs, tables and locally resolved reference links qualify; partial coverage and different ordering are accepted.
Loose list items remain one navigation block despite blank lines.
Entries are list items, fragment-link paragraphs or table data rows.
Headings, table headers and explanatory prose never count as entries.

Below six sections, the contents rule reports nothing, including wording mismatches.
Unresolved custom anchors and coverage gaps are informational limitations, rather than wording findings.

Heading IDs lowercase normalised wording, retain Unicode letters, numbers, marks, underscores and hyphens, and replace spaces with hyphens.
Other punctuation is removed, and duplicate IDs receive numeric suffixes.
Wording renders inline formatting, entities and links, then collapses whitespace.
Intraword underscores, escaped punctuation and code-span contents remain literal.

Version labels are Version or Revision, with optional colon and v before dot-separated integers and optional Semantic Versioning suffixes.
Date labels are Date, Updated, Last updated or Reviewed.
Dates accept calendar-valid ISO, day-month-year or month-day-year forms, full or abbreviated English months, month/year, and Q1 through Q4 with a year.
Labels are case-insensitive.

A document field is a standalone line, a metadata table row with the label first, a final parenthesised title suffix, or badge alternative text.
Metadata rows require a parsed table; pipe-separated prose does not qualify.

Front-matter keys `version`, `date`, `updated` and `last_updated` declare edition metadata at the top level or directly under a top-level `metadata` key.
Values must resolve to a non-empty trimmed string, a finite number or a date.
Booleans, null, empty strings, maps, lists, other nesting and malformed front matter do not count.

Front matter is parsed once, with aliases resolved.
This checks for a declared field, not a valid format: `version: banana` counts.
YAML can change number spelling and resolve aliases, so declaration checks avoid guesses about the original format.

Visible opening fields retain the version and date formats above.
Bare v2.1, product requirements and footer-only dates do not qualify.
Badge images are never fetched, and hard-coded alternative text can be out of date.

The rule applies only to documents with a root H1 title.
Files named `readme`, `contributing`, `security` or `pull_request_template` are exempt in any folder, regardless of case or extension.
Text audited with `--no-front-matter`, including pull request descriptions, is exempt.
The advisory asks whether readers need a version or date to identify the edition or judge how current it is.
It does not require authors to add one.

The overview label ignores case, inline formatting and a leading decimal section number.
Bold prose and contents entries do not qualify.
The separate need for a conclusion before detail is not detected mechanically, and no approved Jev gate supplies that judgement.

## Workflow

1. Read the path from `$ARGUMENTS`. Ask for a path when none was supplied.
2. Resolve the audit script relative to this `SKILL.md` file.
3. State the selected file or directory before running the script.
4. Treat an explicitly supplied directory as approval to read that directory.
5. Ask before expanding the audit beyond the supplied path.
6. Run the script with Bun:

```text
bun <skill-directory>/scripts/audit-text-cli.ts <file-or-directory> --project-dir <project-directory>
```

   Add `--no-front-matter` for text that cannot carry metadata, such as a pull request description. A leading `---` block is then read as text, not set aside as front matter. The version or date rule is also disabled.

   Add `--before <original-file>` only when the user asks to check a restructured file against its original. The [two-version comparison](#two-version-comparison) says what it reads.

7. Report every finding with its file, line, rule, and explanation.
8. Show the Part 5 checklist reading printed after the findings. It marks what the audit can read, not how good the document is.
9. Report skipped or unreadable entries. Never treat an incomplete audit as clean.
10. Explain that findings are mechanical proxies, not an ISO judgement.
11. Leave the final decision and any rewriting request to the user.

### Two-version comparison

Use this mode when the user asks whether a restructure kept the original's wording.

```text
bun <skill-directory>/scripts/audit-text-cli.ts <after-file> --before <before-file> [--author-text <file>] --project-dir <project-directory>
```

- The selected path must be one file. A directory selected with `--before` exits 2.
- `--author-text` names wording the author gave for the restructure, such as a purpose line. It needs `--before`.
- No file may be a symbolic link or a directory junction, or sit in a directory reached through one. A path that runs through a link when it is checked exits 1, and the file is not read. A link put on the path after that check, while the command runs, is not caught. The design audit and the Jev options do not take `--before`.

The comparison reads each version as units: sentences of prose, list items, quotations, table cells and headings, code blocks, and the alternative text of Markdown images.
It matches them by the wording a reader sees, so a line wrap, a hard line break, emphasis, a strike, a list marker or a table border makes no difference.
Case, punctuation, numbers and the contents of code blocks, tabs included, do make a difference.

It prints a row for each of these:

- **Dropped:** a unit of the original with no unchanged copy in the new version.
- **Value:** a number written in figures, or the text of a code span, that is not found as written in the new version. It comes from a sentence, list item, table cell or image alternative that was dropped, rewritten or restructured. Each value is listed once for its unit, and figures that read as the same value, such as `5` and `5.0`, are one value. The row asks a person to confirm that the value was not cut or changed.
- **Rewritten:** a unit of the original with no unchanged copy, paired with a unit of the new version left over. The two share at least two words, and at least half the words of the longer. Of the pairs that qualify, the one sharing the largest part of its words is taken first. The row quotes both and says how many words they share.
- **Restructured or rewritten:** units of the original with at least half their different words among those of a new table that keeps nothing of the original. The table prints one row, which says how many of their numbers and code spans are in the table, elsewhere in the new version, and not found. Its units are not listed as added.
- **Added:** a unit of the new version found in neither the original nor the author's wording. The added units of a new list or table that keeps nothing of the original share one row, which says how many units it stands for.
- **From the author:** a unit that matches the author's wording.
- **Marked gap:** a unit that is one `[Author needed: ...]` slot and nothing else. A full stop inside the slot does not split it.
- **Moved:** a unit kept word for word that stands outside the longest order the kept units share with the original, and is not listed under step order. Units moved together share one row. A moved sentence, list item or table cell that opens with "This", "It" or "These" also asks what that word refers to.
- **Step order:** a kept unit of an ordered-list step that now stands in another order against the other steps of its list, wherever it now stands. Units that change places inside one step are listed as moved instead, and a step listed here is not also listed as moved.

Headings and bold labels such as `**Purpose:**` that a restructure adds or removes are counted and not listed, because Part 5 lets a restructure change them.
A heading is counted once, however many of its sentences changed. Its JSON entry holds the sentences of it that were not kept.

The comparison reads wording, not meaning.
A sentence reworded further than a rewritten pair allows reads as dropped and added.
A rewritten pair is not read for order, so a sentence reworded and moved reads as rewritten, not as moved.
It reads no unit from front matter, a raw HTML block such as `<pre>`, or the alternative text of an HTML image, and it does not compare link destinations.
A hard line break inside a heading underlined on the next line reads as a backslash, so that heading is counted as new and as gone.

A value counts as held where its text stands anywhere in the new file, even inside a longer word or figure, so `pre` is held by `prefix`.
White space is made single first, so a code span whose spacing alone changed is not listed.
The file is read as written, with references decoded and escapes read, with its markup taken out, and as the units the comparison reads.
So front matter, HTML, link destinations and image alternatives all count.

Markup is taken out as HTML reads it, and again as CommonMark passes Markdown to a browser.
The file is read once more as HTML with each line's quotation and list markers taken off, and a value any reading holds is held.
A quoted attribute holding `>` does not end its tag, so `npm test` that becomes `np<span title=">">m</span> test` is held.
Comments are not text, and nor is the content of `script`, `style` and the other elements a browser that runs scripts hides.

Text that `template`, an attribute or a style hides is read as text, so `42` that becomes `4<span hidden>x</span>2` is listed.
Text a browser moves, as out of a table, is read where the file writes it.
With references decoded or markup taken out, only the number as the original writes it is looked for, so `2,500` that becomes `2<b>500</b>` in an HTML block is listed.

Where markup is left open across the end of a block, the readings cannot follow how a browser reads it on, so no value of that file is listed.
That covers a tag or comment passed to a browser as HTML that does not end in its block, and an element such as `script` with no end tag there.
It also covers a list item or quotation that ends inside an HTML block or a fence.

These are blocks as the comparison reads them, so a file can be in doubt where CommonMark leaves nothing open.
An HTML block or a fence that opens two spaces in at the top level, with a later line not indented, is in doubt too.
So is a code span inside an HTML block's comment or attribute, where CommonMark reads none.
When a value was looked for in a file in doubt, a closing line says that none is listed as not found.
A value read with a new table is still looked for in the table, and one not there counts as elsewhere.

A reading can find a block's start or end, or the markers that open a line, other than where CommonMark finds them. A number or code span can then still be listed though a reader sees it.

A value whose text stands whole in the new file as written, once white space is made single, is never listed.
Markup that a renderer drops or moves can split a value that a reader sees whole, and that value may be listed.
That markup can be an HTML tag, a quotation marker inside a fence, an inline table whose text a browser moves, or an inline link's label.
Writing the value whole in the new version clears the row.

A number also counts as held where the file as written, or its units, holds the same value in figures, or in English words up to the billions.
A number of two or more runs of digits, such as `10.30`, also counts as held where those runs stand in the same order.
Between each run and the next there may be at most three marks or spaces, as in `10:30`, and they must stand in one unit or one line.
That holds even inside a longer figure, so `0.3.1` holds `0.3`, and any `one` holds 1.
A month's name, in full or cut to three letters, holds the month's number when it opens with a capital.

A code span's marks are part of its text, so `<thinking>` that becomes `thinking` is listed.
A code span that a full stop splits across two sentences is one value.
In an image alternative, a code span is read as prose and a number inside it as a number.
When the searches for pairs, tables and values would take more than 20,000,000 steps, none of them is read, and the comparison says so.

A moved row asks a person to check the move, because Part 5 allows a move that keeps its dependencies and the claim it qualifies.
The comparison reads neither, beyond the question about "This", "It" or "These".
Of two units that swap places, it names the one that stood first in the original.

Of two steps that swap with other wording around them, it can name the one outside the longest order of the whole document instead.
When repeated wording and labels both change, a unit that another pairing would keep in place can read as moved or as a step out of order.
When a label passes between two copies of a sentence, the copy that stood first in the original is named as moved, labelled or not.
A number in a table that moved to another row reads as moved too, so the row cannot tell a changed value from a move.
A heading's number, such as the `4.` of `## 4. Remove`, is not read for order, so renumbered headings list nothing.

A row makes white space single, so a code block that changed only a tab or a space prints a dropped row and an added row that look alike.
The JSON report, under `restructure`, holds the first 60 characters of each dropped and added unit exactly.
Under `moved` and `stepOrder` it gives each such unit's line in both versions, its first 60 characters, its printed row and any word asked about.
A difference after those 60 characters shows in neither the printed rows nor the JSON report, and kept units are counted, not listed.

Under `rewritten` it gives both lines, the new unit's kind, the first 60 characters of each unit, the words shared and the words of the longer.
Under `values` it gives the line of the value's unit, and the line of the unit or table that unit went to, or null.
It also gives the value's kind, `number` or `code`, and the first 60 characters of the value and of its unit.
Under `tables` it gives the lines of the units read with each table, the table's first line and how many units it holds.
It also gives the first 60 characters of the first unit read with it, and its counts of values.

`weighed` is false when the searches passed their limit.
`valuesInDoubt` is true when a value was looked for in a file in doubt, so none is listed as not found.
Report every row to the user, and leave it to the user to decide what each one means.

## Optional calibrated Jev checks

The default command stays deterministic, offline, free and independent of credentials.
Jev options require an explicit user request and apply only to Markdown.
Both audits use the same calibrated engine, templates, exact validation and three approved gates.
Only purpose and colour receive calibrated decisions; reader and position companion judgements are discarded.
Read the [design audit calibration and evidence](../iso-24495-design-audit/SKILL.md#checks-and-calibration) before interpreting them.

Preview locally with `--jev-preview`.
Show the full disclosure to the user, including selected files, payloads, companion questions, model, privacy links and possible charges.
Also show any local findings, such as a missing title, which the preview prints just before it.

The preview counts requests, not attempts, and each request may be sent up to six times.
A request sent again for any reason may be charged again.

Wait for the user's own agreement in the live conversation before adding `--jev --send`.
Never infer agreement from delegation, your own judgement, or earlier agreement about different files.
Agents must never add `--yes`.

An interactive send reads exact yes from the controlling terminal, never standard input.
Piped or redirected input or output requires the user to supply `--yes` in their own command.
`--send` alone is neither agreement nor a valid text-audit option.
The CLI refuses Jev options with `--no-front-matter` and conflicting preview/send options.
Changed payloads require renewed agreement, and retries preserve the captured bytes.

Mechanical findings and Jev results appear in separate report sections and JSON properties.
Report each document's assessed, pass, fail, unsure and skipped counts for purpose and colour.
Unsure asserts no fault, and colour passes appear only in counts.

On terminal Jev failure, retain mechanical findings, discard Jev verdicts and report incomplete execution.
Report the `Failure:` line after "Execution: incomplete.", which names the first failure in fixed words.
Those words never hold the service's reply, the key or an unexpected error's message.
Report every skipped entry.

JSON defaults to excerpts and state hashes.
Full judged state needs `--include-judged-text --json <requested-report-path>`, disclosed in the preview as a local document-text export.
Never save keys or raw responses.
A local send log records transmission, not proof of agreement.
Pricing, retention and live transport behaviour remain unverified.

Exit codes are 0 for completed or preview, 1 for local failure, and 2 for invalid arguments or missing agreement.
Code 3 covers service, response, model and calibration failures; code 4 covers a missing or invalid key.
Code 3 also covers an unexpected error, whose message is deliberately not shown.
Neither findings nor unsure results change a completed audit's exit code.

## Boundaries

- Read `.md`, `.markdown`, and `.txt` files only.
- Do not follow a selected or nested symbolic link or directory junction. Report each one as skipped.
- Do not alter the selected text unless the user separately requests changes.
- Do not create a report file unless the user requests one and names its location.
- Do not describe zero findings as proof that text is valid, compliant, or suitable.
- Use the relevant sector skill when interpreting findings in legal, technical, scientific, or designed documents.
