---
name: iso-24495-design-audit
description: Run calibrated Jev checks on selected Markdown openings and colour references, with a local title check. Requires agreement before sending. Invoke explicitly.
disable-model-invocation: true
argument-hint: "[file-or-directory]"
metadata:
  version: "0.8.0"
---

# ISO 24495 Design Audit

Audit only the selected Markdown file or directory.
This focused entry point checks purpose and colour through the shared calibrated Jev engine.
The user decides whether each finding matters to their readers.

## Preview and agreement

Run the preview before requesting agreement:

```text
bun <skill-directory>/scripts/design-audit-cli.ts <file-or-directory> --project-dir <project-directory>
```

Show the user the full disclosure printed by that command.
It names TypeSafe, `jev-1.13.0`, selected files, eligible openings and blocks, request totals, companion questions and the five largest payload totals.
Document text leaves the machine when sent, and charges may apply.
Pricing, retention and live transport behaviour have not been checked.

Link the [TypeSafe privacy policy](https://typesafe.ai/legal/privacy-policy) and [Data Processing Agreement](https://typesafe.ai/legal/data-processing).
Make no retention promise.
Wait for the user's own agreement in the live conversation before adding `--send`.
Never infer agreement from a delegated instruction, your own judgement, or an earlier agreement about different files.

`--send` alone is never agreement.
An interactive command requires exact `yes` from the controlling terminal.
If standard input or output is piped or redirected, it does not prompt.
A non-interactive command also requires `--yes`, supplied by the user in their own command.
Agents must never add `--yes`.

Recheck the preview if the selected content changes.
The command rebuilds the payload plan after agreement and refuses a changed plan.
Retries use the same captured bytes and never replace an accepted answer.
A local audit log records the disclosure version, payload digest, selected paths and timestamp.
The log records transmission and does not prove agreement.

## Checks and calibration

Only purpose and colour receive calibrated decisions.
Missing level-1 titles produce local `opening-title` findings and skip purpose assessment.
Colour assessment continues for every non-empty prose block, without keyword filtering.
Code and recognised front matter remain excluded, and raw HTML structure is unsupported.

A leading `---` block counts as front matter only when it is closed and every line has a plain YAML shape.
A document whose closed leading block fails that test is not sent at all, and the preview names it.

The opening request sends purpose Choice and reader together.
The block request sends colour and position together.
Reader and position judgements are validated, then discarded.
There are no heading or one-idea requests.

| Gate | Exact decision | Clusters | Wrong | Lower bound |
|------|----------------|----------|-------|-------------|
| Colour pass | `1 - P(colour_only) >= 0.83` | 300 | 0 | 0.9900639180555423 |
| Purpose fail | `1 - P(both) >= 0.87` | 187 | 2 | 0.9667172820800516 |
| Neither diagnosis | Purpose fails; neither wins the non-both comparison; `P(neither) >= 0.83` | 60 | 0 | 0.9512970866899024 |

Tie order is `task_only`, `scope_only`, `neither`.
Neither refines one purpose failure rather than adding another finding.
Other purpose answers are unsure, never pass.
Other colour answers are unsure, never fail.
Unsure asserts no fault, and colour passes appear only in counts.

These are one-sided 95% lower bounds on agreement for the protocol's cluster representatives, assuming independent clusters.
They are neither per-block reliability nor a document-level success probability.
Correlated blocks do not extend that historical guarantee.
The source is calibration tag `results-r11`, commit `7359447c25e8030b3ecebe6bbdec2d0707a598ee`, with arm A and model `jev-1.13.0`.
The guarded catalogue permits only these three gates.

## Reports and requirements

Preview requires Bun but no credentials.
Sending requires `TYPESAFE_API_KEY`; control characters are rejected before surrounding spaces are trimmed.
Get a key from [TypeSafe documentation](https://docs.typesafe.ai).
Read only `.md` and `.markdown` files, and report every skipped link or unreadable entry.

Report file, line, item identifier, excerpt, exact score and cut-off.
Report per-document and per-check assessed, pass, fail, unsure and skipped counts.
Human and JSON reports include every gate's cluster count, wrong count and recorded lower bound.
The neither diagnosis separately records its score, 0.83 cut-off and purpose-fail prerequisite.

Purpose failures request an explicit reader's task and document scope.
The neither diagnosis says both are missing.

JSON exports contain excerpts and state hashes by default.
Save full judged state only with `--include-judged-text --json <requested-report-path>`.
The preview discloses that this saves document text locally.
Never save credentials or raw service responses.
An incomplete execution discards all Jev verdicts.

| Code | Meaning |
|------|---------|
| 0 | Completed or preview, including findings and unsure. |
| 1 | Local execution or report failure. |
| 2 | Invalid arguments or missing agreement. |
| 3 | Rejection, exhausted retries, malformed response, wrong model or calibration integrity failure. |
| 4 | Missing or locally invalid key. |

The client permits four concurrent requests and six transport attempts, with a 30-second timeout per attempt.
It retries connection failures, timeouts, 429 and 5xx only.
Retries may return different model answers; identical answers are not guaranteed.

## Boundaries

- **Invoke explicitly:** Never activate this audit automatically or expand the selected path without asking.
- **Preserve the text:** Rewrite only when separately requested.
- **Request report locations:** Create a report only when the user requests one and names its path.
- **Keep decisions qualified:** Findings are proxies, not ISO judgements or document approval.
- **Interpret with Part 5:** Use `iso-24495-5` when discussing document design.
