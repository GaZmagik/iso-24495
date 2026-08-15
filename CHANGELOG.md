# Changelog

All notable changes to the ISO 24495 Plain Language plugin. Versions follow [Semantic Versioning](https://semver.org). Installs are pinned to tagged releases via the marketplace manifest.

## [0.5.0] - 2026-08-12

### Added

- Part 5 now provides templates for architecture decision records, runbooks, and design documents.
- Part 5 requires the matching template before writing and defines a content-preserving restructuring workflow.
- `filler-opening` now requires a whole word and skips front matter. It reported "Surely the answer is correct" and "Let meadows grow naturally" as filler openings, which is wrong advice on ordinary sentences. It also missed a filler opening after front matter, which is how most templated documents begin.
- `table-header` now recognises tables written without outer pipes, which GitHub renders and writers commonly use.
- `complex-word` suggests only equivalents no longer than the word they replace, so its own advice cannot push a sentence past the 30-word cap. "ascertain" now suggests "find" rather than "find out".
- One integrated fixture trips all seventeen rules in a realistic document. It complements the isolated positive controls by checking that rules remain observable when their findings occur together.
- The advisory hook now reports totals and up to three starting lines in document order. It states how many findings remain and keeps document averages separate from line-specific repairs.
- Every part of the engine reads one structure: front matter, then fenced code, then tables, decided once before any rule runs. While each scanner kept its own state they disagreed, and each disagreement removed text a reader can see. Fenced code now follows the CommonMark rules. An indented marker no longer opens a fence, and a fence closes only with its own character at a length at least equal to the opener.
- A document is split on a bare carriage return as well as CRLF, and a leading byte order mark is removed. Either one could hide a whole document.
- Front matter and tables are structure everywhere, not just in one rule. Metadata such as `title: Each and Every Shall Policy` was audited as a sentence, and produced legalese and doublet findings. A table written without leading pipes had its cells audited as prose.
- A project can name the acronyms its readers know, in `.iso-24495-4/acronyms.json`. The shipped list stays universal, so CSS, SQL, SDK and a dozen more were reported as undefined to the writers most likely to use them.
- An acronym defined in a heading, list or table now counts as defined. That is where people define terms, and the engine only looked at prose.
- `filler-opening` matches a filler as a whole word, through emphasis and smart apostrophes. It reported `Sure-fire evidence`, and missed `**Certainly!**` because the emphasis was stripped before the check.
- Every `complex-word` suggestion is a single word no longer than the word it replaces, enforced across the whole table rather than for one example.
- Four more rules close gaps between what the skills promise and what the engine checked. `complex-word` reports a formal word with an everyday equivalent, and exempts a word being quoted as an example, so the skill can still name it. `filler-opening` reports an opening that delays the answer, which the core skill's first rule forbids. `double-negative` reports a construction such as "not unusual", which makes a reader unpick two negations. `table-header` reports a table with an empty column name, because a listener hears each cell announced against its column.
- A blanket positive-framing rule was measured and rejected. Checking for "do not" and "never" found 58 constructions in this repository's own documents. Only three sat in a sentence that read as a warning, so the rule would have produced noise instead of advice. The double negative is the part of positive framing a deterministic rule can judge.
- `wordy-phrase` reports a long phrase with a shorter exact equivalent, such as "in order to" for "to" and "due to the fact that" for "because". The core skill has asked writers to make these swaps since the first release, and nothing checked them, so the guidance named a rule the engine never applied. Exact phrases only, matched like the doublets, with the longest phrase winning where one contains another.
- Two rules serve readers who do not look at the page. `link-text` reports a link whose text names no destination. A screen reader can list every link in a document and read each one aloud with no sentence around it, so "click here" and a bare address say nothing. `image-alt` reports an image with no alternative text, which is silence to a reader who cannot see it. An image marked decorative is exempt, and both rules ignore fenced code.
- The core skill now states who the intended readers are. They include everyone who uses the document, whether they see it, hear it or read it by touch. It also names the primary audience rule for documents with more than one audience. It records that skimming is a high-literacy behaviour, so a document must work read straight through as well as scanned.
- Part 5 no longer assumes a reader who is looking at the page. Its rules are reframed around the heading tree, link text and reading order, which are the structure a listener actually has. It gains a rule that no meaning may be carried by bold, colour or position alone.
- Five shared advisory rules add `heading-skip`, `heading-style`, `acronym-undefined`, `doublet`, and `prose-enumeration`. Their concepts were studied in [lucid](https://github.com/maricastroc/lucid), but no code was copied and this implementation is independent. The rules remain project proxies rather than standard clauses.
- Corpus JSON output now carries a deterministic configuration hash covering every engine threshold.
- Setext headings are now recognised. A heading underlined with `=` or `-` was invisible to every heading rule, so a fourteen-word one escaped `heading-style` and its underline counted as a word of prose. Thematic breaks, front matter, underlines inside fences or lists, four-space indented code, and an underline separated from its text by a blank line are all excluded.
- A behaviour contract test covers what coverage cannot. It pins the boundary verdicts for technical punctuation, the acronym calibration matrix, complete heading recognition, and the Markdown exclusions the engine makes deliberately. It also pins encoding and English-variety equivalence, rule composition with isolated repairs, and the capability boundary. That last one asserts the engine emits exactly seventeen rules and names what it deliberately does not detect, so nobody mistakes writing guidance for an automated check.
- A hand-written known-good corpus measures the false-positive rate on plain prose, which was previously unmeasured. Six documents in different registers currently produce nothing.
- A GitHub Actions workflow runs the suite on every pull request. It calls `scripts/check.sh`, the same single gate a contributor runs locally, so a failed build reproduces with one command.
- Plain-language checks for script comments are cancelled, not deferred. Version 0.4.0 announced them for this release. Comments are fragments rather than documents, and checking them well would need a separate extractor for each language plus the docstring conventions layered on top. That machinery costs more than the advice it would produce, so the plan is withdrawn rather than postponed.

### Changed

- Sentence rules recalibrated. The engine now flags a document average above 20 words (new `sentence-average` rule, minimum sample 10 sentences) and raises the per-sentence cap from 20 to 30. Public plain-language guidance (Cutts, the Plain English Campaign, the Clear English Standard) specifies an average of 15 to 20 words rather than a per-sentence cap. The cap of 30 and the 10-sentence minimum are this project's own proxy choices, informed by measurements of local sessions whose data is not part of this repository.
- Paragraph limit relaxed from 3 sentences to 5, matching public guidance (3 to 5, with single-sentence paragraphs fine for emphasis).
- The core skill's voice rule is no longer absolute: active is the default, and passive is accepted where the actor is unknown, irrelevant, or secondary.
- The core skill and output style gain guidance the standards emphasise and the plugin lacked: the four governing principles named (relevant, findable, understandable, usable), and audience-first framing. It also adds positive framing, direct address, subject-verb proximity, explicit connective words, wordy-phrase replacements, and repetition over elegant variation. Layout rules are now labelled house conventions.
- The advisory hook now audits `.md`, `.markdown`, and `.txt` files.
- The output style gains a **Reporting work** section, and the send-time check grows from four measures to nine. Two external reviews judged 165 of this project's own replies against the four governing principles. They found failures the sentence and paragraph limits cannot see: a defect reported as a count rather than a finding, and work called done while a gate was still open. They also found options described unevenly, a rule contradicted after it was given, and grammar dropped in the name of brevity.
- Each of those failures is a rule with a matching item in the send-time check. The five reporting items apply only when a reply reports work, so a one-line answer stays one line.
- The output style now covers reply layout and carries a send-time check. It states the limits apply to replies as well as documents, and holds a reply paragraph to 4 sentences. It asks for the draft to be read back against four measures before sending. Measured on one long reply, the revision cut violations from 10 to 1 and the average sentence from 23.1 words to 14.8. It cut the length from 463 words to 266 with no loss of content.
- Tests pin that the style and core skill quote the engine's current limits, and that the check survives edits.
- Each script is now a library module with a separate logic-free entry file (`audit-corpus-cli.ts`, `watch-corpus-main.ts`, and so on). Hook and monitor commands point at the new entries. Every measured file covers 100% of lines and functions, and end-to-end tests run each entry.

### Fixed

- The shouting test now reads a distilled lexicon of about 7,400 words rather than 400 hand-picked ones. Absence from a short list meant nothing, so `ROTATE KEYS` was reported as two undefined acronyms while `ENABLE MFA` was silent. The list is distilled offline from local English prose, keeping only words written in lower case in at least 92% of their uses, so acronyms cannot enter it. Words that are also common acronyms are removed deliberately. A run of two capitals must now be entirely ordinary words to count as shouting, and an ordinary word is never reported as an acronym.
- Headings indented up to three spaces are now recognised, as CommonMark requires. An indented heading was invisible to every heading rule, so a skipped level inside an indented block went unreported.
- An inline abbreviation followed by a capital is now undecided rather than joined. Merging by default turned two real sentences into one long one and reduced a six-sentence paragraph to five, which hid a violation.
- Roman numeral evidence is narrower. `form`, `round`, `group` and `mark` are no longer numbering words. Each is an ordinary noun or verb, and `Open the form and review CI settings` then excused `CI`. A capitalised name of five letters or more now carries a regnal number. So `Elizabeth II` no longer asks for an expansion, while `MMIX` is reported as the computer name it is.
- A full stop now has three verdicts rather than two: ends a sentence, does not, or cannot be decided. Rules that punish length count the most sentences the text can hold, and rules that punish sentence count take the fewest. So an undecided stop can never create a violation on its own. Two curated word lists carry the evidence: words almost never capitalised mid-sentence, and ordinary words that appear in shouted text. Both are hand-curated for this project and are not distilled from a corpus.
- `acronym-undefined` states its limits plainly. It reports a capitalised token that no other evidence explains. It stays silent inside a run of capitals that is mostly ordinary English words, because that is shouting rather than terminology. It stays silent on a Roman numeral unless the numeral is one that commonly doubles as an acronym and nothing nearby marks it as a number. It does not attempt to expand acronyms, and it will miss an undefined acronym that sits inside shouted text.
- `prose-enumeration` no longer counts an ordinal inside a hyphenated compound. `third-party service` was read as a third item and turned ordinary prose into a finding.
- The output style no longer presents 15 words as a minimum average. The engine sets an upper limit and no lower one, so a concise reply was failing a check whose only remedy was padding.
- The repository's own audit guard now covers every extension the hook audits, not only `.md`. A violating `.txt` or `.markdown` file could previously ship with every gate green. Both the hook and the guard now call one exported predicate, `isAuditedDocument`, which ignores letter case. A file named `NOTES.TXT` can no longer be audited in one place and skipped in the other.
- The end-to-end entry file tests no longer fail at random. Each spawns a cold Bun process, which can take longer than the default five second limit on a loaded machine, and the process was then killed mid-run. Two of five suite runs failed before the fix and six of six passed after it.
- The background monitor now detects a change by content digest rather than by modification time and size. A correction that preserved byte length within one filesystem timestamp tick, two seconds on some filesystems, went unreported (present since 0.3.1).

## [0.4.1] - 2026-08-12

### Fixed
- Plugin installation no longer requires GitHub SSH keys. The marketplace source is now an explicit HTTPS git URL (`"source": "url"`). That keeps the release tag pin, and bypasses the Claude Code installer's SSH default for `github`-type sources (reported in #9 by ArchitektApx; upstream: anthropics/claude-code#18001, #26588, #31930). Users on other affected marketplaces can set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`.

## [0.4.0] - 2026-08-11

### Added
- Advisory markdown audit hook (`hooks/`): after Claude writes or edits a `.md` file, a `PostToolUse` hook audits it with the Part 4 rule engine. It feeds one terse per-rule line back as context. It never blocks a write, stays silent when the file is clean, and skips non-markdown files, `node_modules`, and `.git`.
- Per-project off switch: `.iso-24495-4/hooks.json` with `{"markdownAudit": false}`. It is anchored to the stable project root (`CLAUDE_PROJECT_DIR`), so changing directory mid-session cannot disable it. An unreadable switch file leaves the hook on.
- Plain-language checks for script comments are deferred to 0.5.0.

### Changed
- Conformance language tightened across the plugin: example labels are renamed from "Compliant" to "Aligned". The core skill and output style now state that their quantitative rules are this project's own proxies for the standard's public principles, and the README carries an explicit conformance disclaimer. The licensed ISO texts have not been consulted; nothing the plugin produces claims ISO conformance.

## [0.3.1] - 2026-08-11

### Fixed
- Background monitor primes baselines from existing corpus files when the watch starts. Pre-existing violations are no longer misreported as new changes, and first-edit improvements are reported correctly (present since 0.3.0).
- Background monitor reports decreases when a corpus file is deleted, and prunes its per-file state.
- The 30-second interval now re-scans corpus content (by modification time and size), so changes hidden by a missed or filename-less watch event are reported within 30 seconds instead of lost.
- A missing or unreadable corpus root is an error again in the audit CLI, instead of a clean empty audit. Below the root, unreadable entries are skipped and reported to the caller.
- Priming is per file. Everything present at the first enumeration of an engagement primes silently on first successful read, including subtrees that were unreadable at that moment. Files appearing later report as additions.
- A persistent unreadable entry can no longer hold the monitor in a silent mode. An unreadable subtree is never reported as deletions, because suppression is scoped to the skipped paths only. The engagement holds when the config file is present but momentarily unparseable. The audit CLI warns on stderr for each entry it had to skip.
- Background monitor no longer exits when no engagement is configured. It now waits for `.iso-24495-4/monitor.json` to appear, starts watching the corpus when it does, and returns to waiting if the config is removed. This stops the host from raising a "task ended" notification at the start of every session without an engagement. A half-written or invalid config no longer kills the process.

## [0.3.0] - 2026-08-11

### Added
- `iso-24495-4` (provisional, ISO/CD 24495-4): organisational implementation task skill. Process-artefact sweep (primary evidence), corpus proxy audit (secondary, Measurement dimension only), deterministic 5×5 maturity scoring, append-only audit state with trend reporting. TypeScript on Bun, zero dependencies, 22 pinned tests.
- Background monitor (`monitors/monitors.json`): re-audits a configured corpus on change during an engagement; silent when unconfigured.
- ISO 24495 output style (`output-styles/iso-24495.md`).
- Release-gated distribution: the marketplace source pins a tagged release.

### Changed
- Core skill and output style now reference all five skills, with a negative guard so Part 4 never activates on ordinary writing tasks.
- All skills carry the plugin version in `metadata.version`.

## [0.2.0] - 2026-08-11

### Added
- `iso-24495-5` (provisional, ISO/WD 24495-5): document design extension.
- Spec-compliant `metadata` blocks (version, iso-standard, iso-status) on every skill.

### Changed
- Agent-neutral wording throughout; any Agent Skills-compatible tool can use the skills.
- Core skill auto-triggers `iso-24495-5` for complex multi-section documents.
- README corrected: Parts 2 and 3 are published (August 2025 and May 2026).

## [0.1.0] - 2026-08-11

### Added
- Initial plugin: `iso-24495-1` (core), `iso-24495-2` (legal), `iso-24495-3` (science and technical), marketplace manifest, MIT licence.
