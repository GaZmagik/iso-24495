# Interview Guide

Ask at most 5 questions per audit. Ask only what the file system cannot show. Before asking, fill every criterion you can from the evidence sweep, then pick the questions that unblock the most uncertain dimensions.

## Question bank

Pick 3 to 5. One question per line; ask them plainly.

1. **Culture / leadership-aware, leadership-champions:** "When did a leader last mention plain language to the wider organisation, and in what form?"
2. **Governance / owner-accountable, resourced-mandated:** "Who is personally accountable for plain language here, and what time or budget do they get for it?"
3. **Capability / training-delivered:** "Has anyone been trained in plain language in the last year? Who, and by whom?"
4. **Measurement / user-testing:** "Have real readers ever been watched or asked while using one of your documents? What happened to the results?"
5. **Culture / feedback-loops:** "If a reader finds a document confusing today, what do they do, and who acts on it?"
6. **Process / signoff-gates:** "Can a public document ship without anyone checking its clarity? What stops it?"

## Recording answers

- Record each answer as `true` only with evidence: a named artefact, date, person, or example.
- An enthusiastic "yes" without evidence records as `false` with a note.
- Write results into the `answers.json` structure (see `tests/fixtures/answers.sample.json` for the shape) and score with `scripts/score-maturity-cli.ts`.
