# Where these documents come from

This corpus measures how much noise the engine makes on writing that was not
produced for it. Two kinds of document sit here, and the difference matters when
reading the result.

## External documents

Written by other people, for real readers, before this project existed. These
are the only documents here that can support a claim about false positives,
because nothing about them was chosen to suit the rules.

| File | Source | Licence | Retrieved |
|---|---|---|---|
| `govuk-universal-credit.md` | https://www.gov.uk/universal-credit | Open Government Licence v3.0 | 2026-08-14 |

Contains public sector information licensed under the Open Government Licence
v3.0. The text is reproduced unchanged; only the heading and paragraph breaks
are ours, to make a valid markdown document.

**The adjudication came first.** Every expected result was written down before
the auditor saw the text. That adjudication said 10 sentences, an average of
18.0 words, a longest sentence of 26 words, and no findings. The engine then
agreed on every number. Had it disagreed, the disagreement would have been recorded as a false
positive rather than explained away by editing the expectation.

That document sits at exactly the ten-sentence sample floor, so it is the only
one here that exercises `sentence-average` at all.

## Written for this repository

The remaining files are ours, in registers the external set does not yet cover:
public service instructions, consumer rights, technical guidance, warnings,
names and measures, and international spelling.

They demonstrate the method and would catch gross drift. **They cannot support a
false-positive rate**, for two reasons. They are short, and prose written by an
agent working under this plugin's own output style is not neutral evidence about
that style. Treat their zero as a smoke test, not as a measurement.

## Documents expected to fail

`../difficult/` holds the opposite control. Every document above is expected to
pass, so on its own the corpus could not tell a working engine from a silent
one. These are published documents that should produce findings.

| File | Source | Licence | Retrieved |
|---|---|---|---|
| `us-foia-statute.md` | 5 U.S. Code section 552, subsection (a)(1), subparagraphs (A), (C) and (D) | Public domain, as a United States federal statute | 2026-08-15 |

Adjudicated before the first run: four sentences of 11, 44, 31 and 28 words.
One `legalese` finding, two `sentence-length` findings, and no average, because
four sentences sits below the floor. The engine agreed exactly.

**Re-adjudicated 2026-08-15.** A `complex-word` rule was added that day, and it
reports `whereby` in subparagraph (A). The finding is real, so the expected
result is now four rather than three. The rule set grew; the engine did not
drift. A changed expectation is only honest when the reason is recorded.

A quoted or backticked span exempts a term only when the span names that term.
Longer quoted sentences remain subject to the same checks as other prose.

Subparagraph (B) and the introductory clause of paragraph (1) are omitted
because they contain em dashes, which a repository test forbids in every
markdown file. Nothing that remains is altered.

## Adding to this corpus

1. Choose the document before running the auditor, and record where it came
   from and under what licence.
2. Write down every expected finding, sentence count and average first.
3. Run the engine once, and record what it actually said.
4. If the two disagree, keep both. The disagreement is the result.

Do not require zero findings from an external source. Published prose has no
obligation to satisfy this project's proxies, and a genuine finding is as
informative as a clean pass.
