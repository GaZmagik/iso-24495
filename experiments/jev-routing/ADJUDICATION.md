# Label adjudication, 2026-09-28

Two labellers labelled all 50 items blind: Gemini (`gemini-3.8-flash-high`, through agy) and Claude (`claude-opus-5-5`, high effort). Their reasons are in `labels.gemini.notes.md` and `labels.claude.notes.md`. Neither saw Jev's probabilities, and the coordinator did not view them until this file was complete.

## Agreement before adjudication

| Skill | Agreed labels |
|---|---|
| technical | 50 of 50 |
| organisational | 50 of 50 |
| legal | 48 of 50 |
| document_design | 43 of 50 |

Where both labellers agreed, their label stands. The settled labels are in `labels.jsonl` (kept local, per `DATA-RULE.md`).

## Settled by the coordinator from the rules

Rule references are to `skills/iso-24495-1/SKILL.md`.

| Item | Label | Decision | Reason |
|---|---|---|---|
| trial-043 | document_design | yes | Line 102 pairs Part 5 with Part 3 whenever the output is a document; the output is the corrected document. |
| trial-024 | document_design | yes | The request asks for "a structured programme document" (line 104). |
| trial-047 | document_design | yes | A style guide for all departments with owners and a review cycle is a multi-section guide (line 104). |
| trial-039 | document_design | no | Line 104 requires a complex multi-section document; this guide is 18 words in two sections. |

## Settled by the user

| Item | Label | Decision |
|---|---|---|
| trial-037 | document_design | no: a brief technical note is an explanation, not a document. |
| trial-038 | legal | no: "should" etiquette is not a contract, terms or statute. |
| trial-038 | document_design | no: follows from legal being no, and a friendly reply is not a document. |

The user also ruled on the general question: **a Part 4 task still triggers Parts 2 and 5 when their own triggers are met.** This rule is not written in the skills today. It keeps the yes labels on trial-024 and trial-047.

## Excluded from scoring (left null)

| Item | Label | Why |
|---|---|---|
| trial-036 | organisational | "Make this style guide better" could be an individual rewrite or organisation-wide practice. Both labellers abstained; the user chose to exclude it. |
| trial-022 | document_design | The user answered "Part 4" (already agreed yes). Whether an organisation-wide policy is a complex document stays undecided by the rules. The coordinator excluded it rather than guess. |
| trial-042 | legal | The user answered "Part 4" (already agreed yes). Whether a gap assessment across privacy notices "handles" privacy policies stays undecided. The coordinator excluded it rather than guess. |

## Known limits of this label set

- 48 of 50 items are synthetic, written by one model (Codex GPT-6 Astra). Results may not carry over to real requests.
- The labellers' compliance with the instruction not to read each other's files was not checked in their transcripts. Their files were written a minute apart.
