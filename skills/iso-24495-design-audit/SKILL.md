---
name: iso-24495-design-audit
description: Audit user-selected Markdown files for document design findings, using the Jev judgement model from TypeSafe. Requires a TypeSafe API key. Use only when the user explicitly invokes this skill.
disable-model-invocation: true
argument-hint: "[file-or-directory]"
metadata:
  version: "0.7.0"
---

# ISO 24495 Design Audit

Audit only the path the user selects, for the document structure that Part 5 asks for. Report each finding so the user can decide whether the document suits its readers and purpose.

## What it checks

The text audit measures words and sentences, so it cannot see document structure. This audit asks Jev, the judgement model from TypeSafe, narrow yes-or-no questions. Code finds each candidate, and Jev answers with a probability.

- `opening-title`: the document has no level-1 title. Code finds this without asking Jev.
- `opening-purpose`: the opening block does not state the reader's task and the document's scope. The opening block is the level-1 title and everything before the next heading.
- `opening-reader`: the opening block does not state in words who the document is for. A greeting, a description of the product or the title alone does not count.
- `heading-message`: a heading below the title only names a topic. A heading reading "Summary" or "Overview" is exempt, whatever its formatting, because Part 5 lets that one heading name its section.
- `one-idea`: a paragraph of two or more sentences runs unrelated topics together.
- `colour-only`: a paragraph identifies something only by its colour.
- `position-only`: a paragraph identifies something on a page or screen only by where it sits.

Part 5 also allows a topic name for a reference section that a reader jumps to by subject. It allows one for a fixed section name that a document type requires, such as Context, Decision and Consequences in a decision record. Jev cannot tell those sections from one heading, so the audit still reports them, and each heading finding names these exceptions. The user decides whether each one is a reference section or a fixed name.

It does not check link text, because the text audit's `link-text` rule covers links. It does not check alternative text, which has not been measured on real documents.

## Bands

Each answer falls in one of three bands: passes, unsure, or fails. An unsure answer lies between the cut-offs, where Jev cannot decide; it does not mean the text partly complies. It is not a pass either, so the audit reports both unsure and fails, and names the band in each finding. An unsure finding says what to check and claims no fault. The audit never reports a pass.

`colour-only` and `position-only` have no fail band, so they report unsure at most. No labelled real failure has been measured for either rule.

The cut-offs were set on 2026-09-28 against popular open-source documents, labelled by two model families blind to Jev. Only labels both agreed on were used. Each cut-off was chosen on the same items it was measured on, so the counts below are small and the cut-offs are provisional:

- `heading-message`: the pass band was right on 14 of 14 headings, and the fail band on 10 of 10.
- `opening-purpose`: pass band 11 of 11 openings, fail band 49 of 50.
- `opening-reader`: pass band 11 of 11 openings, fail band 62 of 65.
- `one-idea`: pass band 13 of 13 paragraphs. Its fail cut-off is the least certain, because real documents held too few failures to calibrate it.
- `colour-only` and `position-only`: pass band 200 of 201 and 199 of 199 blocks.

The opening, colour and position figures come from the requests this audit sends. The heading and one-idea figures come from an earlier sample. The owner checked 30 agreed labels: 24 matched blind, and 29 after the owner reviewed quick errors.

## Requirements

This audit requires Jev and a TypeSafe API key, and cannot run without them. Get a key from https://docs.typesafe.ai and set it in the `TYPESAFE_API_KEY` environment variable. The audit also requires Bun.

The audit asks for `jev-1.13.0` by name, not the `jev-latest` alias, because an alias moves when TypeSafe ships a new release. The cut-offs were calibrated on `jev-1.13.0`, so an answer from any other model stops the audit.

## Language and input scope

The audit is written for English and supports English only. Its questions to Jev are in English and were measured on English documents.

It reads `.md` and `.markdown` files only, as one file or a directory. It sets code blocks and front matter aside.

## Workflow

1. Read the path from `$ARGUMENTS`. Ask for a path when none was supplied.
2. Resolve the audit script relative to this `SKILL.md` file.
3. State the selected file or directory before running the script.
4. Treat an explicitly supplied directory as approval to read that directory.
5. Ask before expanding the audit beyond the supplied path.
6. Run the script without `--send`. It prints the questions it would send, by file and by rule, and the largest files. It sends nothing and gives no cost, because how TypeSafe bills has not been checked:

```text
bun <skill-directory>/scripts/design-audit-cli.ts <file-or-directory> --project-dir <project-directory>
```

7. Before sending anything, tell the user that the text of each document goes to the TypeSafe service. Point them to the TypeSafe privacy policy at https://typesafe.ai/legal/privacy-policy and its Data Processing Agreement at https://typesafe.ai/legal/data-processing. Tell them that TypeSafe offers zero data retention to enterprise customers. Wait for their agreement.
8. With that agreement, run the same command with `--send` added.
9. Report every finding with its file, line, rule, band, explanation, and the probability Jev gave. A paragraph finding also quotes the start of the text judged.
10. Report the counts by rule, and what was not checked: exempt overview headings, and the opening of any document with no level-1 title.
11. Report the Jev model that answered. If the audit stopped because another model answered, tell the user that the cut-offs apply only to `jev-1.13.0`.
12. Report skipped or unreadable entries. Never treat an incomplete audit as clean.
13. Explain that the findings come from a model and can be wrong. Mechanical and model findings are proxies, not an ISO judgement.
14. Leave the final decision and any rewriting request to the user.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | The audit ran, or printed what it would send. Findings never change the code. |
| 2 | The arguments were wrong, or a selected file cannot be read or is not Markdown. |
| 3 | Jev failed after its retries, answered in a form the audit cannot use, or answered with a model other than `jev-1.13.0`. No findings are printed, because the audit is incomplete. |
| 4 | The command had `--send` but no usable key in `TYPESAFE_API_KEY`: none at all, or one holding a line break or other control character. Tell the user that this audit requires Jev and a TypeSafe API key, and where to get one. A key with a control character is never sent or printed. |

## Boundaries

- Send nothing without `--send`, and never add `--send` before the user agrees.
- Do not follow a selected or nested symbolic link or directory junction. Report each one as skipped.
- Do not alter the selected text unless the user separately requests changes.
- Do not create a report file unless the user requests one and names its location.
- Do not describe zero findings as proof that the document is well designed, compliant, or suitable.
- Use `iso-24495-5` when interpreting findings or restructuring the document.
