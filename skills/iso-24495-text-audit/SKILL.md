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

Its word rules match English words and phrases: `legalese`, `doublet`, `wordy-phrase`, `filler-opening`, `complex-word`, `double-negative`, and the phrases `link-text` looks for. The `filler-opening` rule checks only the opening prose. The `link-text` rule also flags empty labels and labels that are bare web addresses.

Five word rules read headings as well as prose: `legalese`, `doublet`, `wordy-phrase`, `complex-word`, and `double-negative`. The rules about sentences and paragraphs read prose only, because a heading is not a sentence.

The `sentence-length` and `sentence-average` rules count words separated by whitespace, including spaces and line breaks, and use English benchmarks. The `paragraph-length` rule counts sentences, with a limit of five.

The `prose-enumeration` rule flags three or more distinct ranks in a prose block, including rank one. It recognises English ordinal words and numbered markers from one to six.

The audit reads Markdown as written and does not interpret raw HTML. It sets HTML tags aside and reads the text between them, even where GitHub would hide or change that text.

## Markdown layout recognition

Four additional mechanical rules apply to Markdown, while `.txt` remains mechanical-only without structural checks.
These recognition choices are project proxies and remain unmeasured on a corpus.
Raw HTML structure, code and comments are excluded.
Front matter is excluded from prose checks, but recognised edition metadata can satisfy the version or date rule.

- **Contents list:** At six root H2 sections, require labelled contents or opening navigation containing two same-document fragment links in one block.
- **Wording comparison:** At six sections, resolved contents links must use the target H2 wording, preserving case, punctuation and numbering.
- **Version or date:** Ask whether a titled document needs edition metadata when none is recognised in its opening or front matter.
- **Bullet depth:** Report unordered items beyond two unordered ancestors, counting the item itself and ignoring ordered or quote containers.
- **Overview label:** At six root H2 sections, require an Overview or Summary heading before the first content H2, at any heading level outside lists and quotations.

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

7. Report every finding with its file, line, rule, and explanation.
8. Report skipped or unreadable entries. Never treat an incomplete audit as clean.
9. Explain that findings are mechanical proxies, not an ISO judgement.
10. Leave the final decision and any rewriting request to the user.

## Optional calibrated Jev checks

The default command stays deterministic, offline, free and independent of credentials.
Jev options require an explicit user request and apply only to Markdown.
Both audits use the same calibrated engine, templates, exact validation and three approved gates.
Only purpose and colour receive calibrated decisions; reader and position companion judgements are discarded.
Read the [design audit calibration and evidence](../iso-24495-design-audit/SKILL.md#checks-and-calibration) before interpreting them.

Preview locally with `--jev-preview`.
Show the full disclosure to the user, including selected files, payloads, companion questions, model, privacy links and possible charges.
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
Report every skipped entry.

JSON defaults to excerpts and state hashes.
Full judged state needs `--include-judged-text --json <requested-report-path>`, disclosed in the preview as a local document-text export.
Never save keys or raw responses.
A local send log records transmission, not proof of agreement.
Pricing, retention and live transport behaviour remain unverified.

Exit codes are 0 for completed or preview, 1 for local failure, and 2 for invalid arguments or missing agreement.
Code 3 covers service, response, model and calibration failures; code 4 covers a missing or invalid key.
Neither findings nor unsure results change a completed audit's exit code.

## Boundaries

- Read `.md`, `.markdown`, and `.txt` files only.
- Do not follow a selected or nested symbolic link or directory junction. Report each one as skipped.
- Do not alter the selected text unless the user separately requests changes.
- Do not create a report file unless the user requests one and names its location.
- Do not describe zero findings as proof that text is valid, compliant, or suitable.
- Use the relevant sector skill when interpreting findings in legal, technical, scientific, or designed documents.
