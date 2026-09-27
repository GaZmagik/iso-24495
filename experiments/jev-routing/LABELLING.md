# Label the Jev routing trial

Use this rubric to label requests independently of Jev's predictions.
Read each request together with its text, including the intended output.
The unit is a request-text pair because task scope and output form affect routing.
Label all four skills independently; several may apply together.
The core skill always applies and is outside this trial.

Parts 4 and 5 are provisional skills based on unpublished drafts.

## Apply the repository rules

These quotations come from `skills/iso-24495-1/SKILL.md`, lines 101 to 104, under "Domain Extension Triggers".
They describe this plugin's rules, not the ISO standards themselves.

```text
- **`iso-24495-2` (Legal & Compliance):** Activate when handling contracts, licenses, terms of service, privacy policies, or statutory rules. Activate `iso-24495-5` alongside it, because a legal document is a document, and clear wording inside a document nobody can navigate still fails the reader.
- **`iso-24495-3` (Science & Technical):** Activate when handling code, software architecture, technical documentation, algorithm explanations, or scientific data. Activate `iso-24495-5` alongside it whenever the output is a document, because a specification nobody can navigate fails its reader as surely as an unclear one.
- **`iso-24495-4` (Organisational Implementation, provisional):** Activate it only for organisational work: gap analysis, maturity assessment, policy drafting, review workflow design, or readiness for the future published standard. Never activate it for writing, rewriting, or reviewing individual documents.
- **`iso-24495-5` (Document Design, provisional):** Activate when producing complex multi-section documents (reports, specifications, guides, contracts) where layout, visual hierarchy, and navigation aids shape readability.
```

Part 3 clarifies the output boundary in `skills/iso-24495-3/SKILL.md`, lines 25 to 27:

```text
3. **Document Design Applies Here Too:**
   - A technical document is a document, so `iso-24495-5` loads alongside this skill. Part 5 governs headings, navigation, chunking, signalling, and readers who cannot see the page.
   - It loads for a document, not for every explanation. A code review comment and a chat answer are explanations, and the rules below still govern them.
```

Part 4 clarifies task scope in `skills/iso-24495-4/SKILL.md`, lines 18 to 20:

```text
1. **Activation Rules:**
   - **Activate for:** plain language gap analysis, maturity assessment, policy or style guide drafting, review workflow design, training planning, readiness for the future published standard.
   - **Never activate for:** writing, rewriting, summarising, or reviewing an individual document. Those tasks belong to `iso-24495-1`, `-2`, `-3`, and `-5`.
```

An organisational policy task concerns how the organisation implements plain language.
A request to rewrite one policy clause remains an individual-document task.
A legal task carries the Part 5 pairing rule even when the requested reply is short.
Judge the intended output rather than assuming the source text's format determines it.

## Record independent decisions

Copy `labels.template.jsonl` to a separate file for each labeller.
Keep every item ID unchanged.
Replace each null with a boolean, and enter the labeller's name or agreed identifier.
The mapping is `legal` to Part 2, `technical` to Part 3, `organisational` to Part 4, and `document_design` to Part 5.

Read `borderline_note` as a reason to inspect the boundary, not as a proposed answer.
If the request is ambiguous, leave affected fields null and record the reason in the later adjudication discussion.
Do not infer a missing label from another skill's prediction.
Resolve disagreements only after independent labelling, without viewing Jev's probabilities first.

## Read the report

Predictions at or above a threshold count as yes.
The report always includes 0.5 and adds the chosen threshold if different.
It prints confusion counts, precision and recall for each skill.
Calibration buckets include their lower boundary and exclude their upper boundary, except the final bucket includes 1.0.
Each bucket reports its count, mean probability and observed yes-rate.

Missing labels count separately for each skill and across items with any missing field.
Labels without results are also counted.
An undefined ratio appears as `n/a`, never as zero.
Blank template rows are missing evidence, not negative labels.
This small, deliberately varied corpus measures routing boundaries; it does not estimate performance on representative production traffic.
