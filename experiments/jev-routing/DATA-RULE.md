# Jev trial data rule

Only items in this directory's `items.jsonl` may be sent to TypeSafe.
This is a shadow measurement; its results never change plugin routing.
Review both the request and the text before adding an item.
The harness reads this fixed file and sends only those two fields.

Every text must be public, with its source and licence recorded, or synthetic and marked as such.
Synthetic items must name their author.
Never include repository source, logs, bench briefs, file paths, credentials or personal data in either field.
Metadata validation cannot establish that content is safe to send; the person adding an item must check it.

The public excerpts here come from the GOV.UK Universal Credit fixture, whose `SOURCES.md` records the Open Government Licence v3.0.
Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
All other texts and all requests are synthetic trial material written by codex gpt-6-astra, under this repository's MIT licence.
No repository code is included, including in the synthetic technical examples.

The API permits 32k tokens for state plus the longest single question, within a 64k total request limit.
The harness refuses states above 8,000 characters in a basic Latin character projection of serialised JSON.
Each non-ASCII UTF-16 unit counts as six characters; JSON escaping also counts towards the budget.
This bounds encoded state size conservatively and leaves room for the longest question.
It is a character guard, not a token measurement or a guarantee about Jev's undisclosed tokeniser.

Any 422 response stops the run without appending a result for that item.

Keep one writer per output file.
Resume only an unchanged item set and unchanged questions.
The harness checks each completed item's request fingerprint and rejects unknown result IDs.
Inspect and repair a damaged final output line before resuming; no line is silently discarded.
Keep results and completed labels local until their separate review.
