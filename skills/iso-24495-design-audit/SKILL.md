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

Part 5 also allows a topic name for a reference section that a reader jumps to by subject. It allows one for a fixed section name that a document type requires, such as Context, Decision and Consequences in a decision record. Jev cannot tell those sections from one heading, so the audit still reports them. The user decides whether each one is a reference section or a fixed name.

It does not check link text, because the text audit's `link-text` rule covers links. It does not check alternative text, which has not been measured on real documents.

## Bands

Each answer falls in one of three bands: passes, needs improvement, or fails. A borderline answer is not a pass, so the audit reports both needs improvement and fails, and names the band in each finding. It never reports a pass.

The cut-offs between the bands were calibrated on 2026-09-28 against labelled samples from popular open-source documents. Each sits where blind labels agreed with Jev at least 95% of the time. The cut-offs are provisional. The fail cut-offs for `one-idea`, `colour-only` and `position-only` are the least certain, because real documents held too few failures to calibrate them.

## Requirements

This audit requires Jev and a TypeSafe API key, and cannot run without them. Get a key from https://docs.typesafe.ai and set it in the `TYPESAFE_API_KEY` environment variable. The audit also requires Bun.

## Language and input scope

The audit is written for English and supports English only. Its questions to Jev are in English and were measured on English documents.

It reads `.md` and `.markdown` files only, as one file or a directory. It sets code blocks and front matter aside.

## Workflow

1. Read the path from `$ARGUMENTS`. Ask for a path when none was supplied.
2. Resolve the audit script relative to this `SKILL.md` file.
3. State the selected file or directory before running the script.
4. Treat an explicitly supplied directory as approval to read that directory.
5. Ask before expanding the audit beyond the supplied path.
6. Run the script without `--send`. It prints the files and the number of questions it would send, and sends nothing:

```text
bun <skill-directory>/scripts/design-audit-cli.ts <file-or-directory> --project-dir <project-directory>
```

7. Before sending anything, tell the user that the text of each document goes to the TypeSafe service. Tell them that the published TypeSafe API documentation states no data retention policy. Wait for their agreement.
8. With that agreement, run the same command with `--send` added.
9. Report every finding with its file, line, rule, band, explanation, and the probability Jev gave.
10. Report skipped or unreadable entries. Never treat an incomplete audit as clean.
11. Explain that the findings come from a model and can be wrong. Mechanical and model findings are proxies, not an ISO judgement.
12. Leave the final decision and any rewriting request to the user.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | The audit ran, or printed what it would send. Findings never change the code. |
| 2 | The arguments were wrong, or a selected file cannot be read or is not Markdown. |
| 3 | Jev failed after its retries. No findings are printed, because the audit is incomplete. |
| 4 | The command had `--send` but no usable key in `TYPESAFE_API_KEY`: none at all, or one holding a line break or other control character. Tell the user that this audit requires Jev and a TypeSafe API key, and where to get one. A key with a control character is never sent or printed. |

## Boundaries

- Send nothing without `--send`, and never add `--send` before the user agrees.
- Do not follow a selected or nested symbolic link or directory junction. Report each one as skipped.
- Do not alter the selected text unless the user separately requests changes.
- Do not create a report file unless the user requests one and names its location.
- Do not describe zero findings as proof that the document is well designed, compliant, or suitable.
- Use `iso-24495-5` when interpreting findings or restructuring the document.
