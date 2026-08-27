# Changelog

All notable changes to the ISO 24495 Plain Language plugin. Versions follow [Semantic Versioning](https://semver.org). Installs are pinned to tagged releases via the marketplace manifest.

## [0.6.2] - 2026-08-27

### Added

- **An opening block.** Every document states its title, a one-line purpose, its version or date,
  and the reader it is for. Each field carries a minimum. Purpose gives the reader's task and the
  document's scope, the reader line names the primary audience, and the referral names the
  alternative and when to use it. Part 1 still decides who the reader is, and this rule decides
  only where the answer appears.
- **A layering rule.** A document with 6 or more sections labels its overview, as does one whose
  conclusion readers need before the detail. That overview keeps the conclusion, the required
  action and every essential qualification. Detail only some readers need moves to footnotes, an
  appendix or a collapsible block, and stays reachable. Three levels is the ceiling, and Part 3
  governs the wording across them.
- **A signposting rule.** A document tells a reader who needs something else where to go, naming
  the alternative and when to use it. It leaves the signpost out where no alternative exists,
  rather than shipping an empty heading.
- **Two exceptions to the heading rule, and no others.** A document type with a published structure
  keeps that structure's section names, as a decision record keeps Context and Decision. A
  reference section a reader jumps to by subject keeps the subject. A section read in sequence
  gets a message or a task.
- **One override.** The overview's label names its section rather than its message, so the layering
  rule overrides the heading rule for that heading and no other.
- **Branching routes.** A forking procedure gets a decision table or labelled conditions, never one
  numbered list. A labelled decision table is already the written form, so prose is added only
  where the routes are drawn as a picture.
- **Heading numbering**, for documents whose sections a reader must cite by identifier.
- **Named heading failures.** Reject a heading that jokes, puns or plays with words, and one built
  on a term the document has not yet explained. The engine checks heading length and form, so this
  is guidance rather than a gate.
- **Limits on structures the skill required without any.** Name the narrowest presentation a table
  must survive and read it back at that width, or use labelled records where nobody has named one.
  Reserve a callout for what changes the reader's action, and merge adjacent ones. Keep a sequence
  an ordered list, so it survives being heard.
- **Bullet limits**: one paragraph carrying one idea, nested no deeper than two levels, with longer
  material promoted to a subsection.
- **An accessibility exemption** from the ban on two devices carrying one meaning. A text
  alternative is exempt beside a picture or diagram, or where the original is not exposed to a
  screen reader. A table is excluded only where its headers identify every value and its reading
  order keeps the comparison intact.
- **A provisional-label rule.** A document citing this skill says that Part 5 is an unpublished
  draft.
- **The self-audit checklist grows from 6 checks to 24**, so every rule above it has one. The new checks
  cover heading quality and numbering, chunking, table width, callout restraint and branching.
  They also cover link text, alternative text, table headers, reading order, the opening block, the
  overview, and the three restructuring guarantees.

### Changed

- **All three templates carry the opening block**, as a list with a purpose line and a conditional
  referral. Every table in them tells the author to name a width or use labelled records.
- **The runbook's headings state their task**: check these before you start, run these steps in
  order, confirm the task worked. Topic labels do not survive the heading rule on sections read in
  sequence.
- **The design document names what its sequential subsections explain**, while its reference
  sections keep their subjects. It also says why it numbers its sections, and tells an author to
  remove the numbers from the headings and the contents list together.
- **The decision record gains a status**, being proposed, accepted, deprecated or superseded, and
  names Michael Nygard's Documenting Architecture Decisions, 2011, as the structure its headings
  come from. Its options heading states its message, because that section is this template's own
  addition rather than part of that structure.

### Fixed

- Restructuring an existing document could have required inventing content. The workflow forbids
  adding content, while the new opening block and signposting rules demand it. An agent asked to
  restructure a document with no purpose statement had to fabricate one, or leave the document
  non-compliant. Restructuring now builds those blocks only from sentences the document already
  holds, or from wording the author supplies, and marks what is missing as a gap. A wrong purpose
  sends a reader confidently in the wrong direction, which is worse than no purpose at all.
- A promoted sentence can now move only where its dependencies, its order against neighbouring
  steps and the claim it qualifies all survive. Every word can survive a move while the meaning
  does not, as a warning parted from its procedure shows.
- The Codex manifest sat at 0.6.0 while every other version site had moved to 0.6.1. The 0.6.1
  release bumped the marketplace, the Claude manifest and all eight skill files, and missed
  `.codex-plugin/plugin.json`, because nothing checks that the versions agree. A Codex user
  reading the manifest saw a version two releases behind the skills beside it.
- The three templates are now compared against their recorded text, so no reader-visible change to
  them can happen without the test changing in the same commit.

These additions paraphrase the Document design pattern library, version 0.6, June 2025, by Waller,
van der Waarde, Schriver, Slabbert, Cheek and Linsky, for the International Plain Language
Federation. No substantial wording is copied from it.

## [0.6.1] - 2026-08-22

### Fixed

- `iso-24495-code` would not load. Its description was an unquoted YAML scalar holding a colon
  and a space, in "the parts of code a person reads: the order units appear in". YAML reads that
  as the start of a nested mapping, so a loader refused the file with "mapping values are not
  allowed in this context at line 2 column 123". The skill has been unloadable since 0.6.0
  shipped. The description is now quoted, so a later edit that adds a colon still parses.
- Nothing had ever parsed a `SKILL.md` as YAML, which is why the gate did not catch it. The
  other tests read these files as text, check the prose inside them and the files beside them,
  and took the frontmatter on trust. Every skill's frontmatter is now parsed on each run, and
  must carry a name matching its directory and a description that is not empty.

## [0.6.0] - 2026-08-20

### Added

- `iso-24495-code` applies the plain language principles to source code: the order units appear in, their names, what a comment says, and what an error tells the reader who hits it. It does not set size or complexity thresholds, because those are software quality rather than language, and it says so.
- The skill exists because the writing rules were measured and found to do nothing to code. Across 30 generated implementations of one specification, the prose style changed neither the number of functions nor their length. It left the public function anywhere in the file, and last of all in half of them. Explicit code rules put it in the first fifth every time, and raised named units from a median of 12 to 15. Every implementation still passed all 25 hidden tests.
- The README now points at the standard itself. It links the ISO catalogue entry for Part 1, the International Plain Language Federation framework, and PLAIN's background on the standard.

### Fixed

- A full stop inside emphasis, quotes or brackets now ends a sentence. `**Lead in.** Next sentence.` was read as one sentence, because the terminator sits before the closing markers rather than before the space. Two short sentences were merged and reported as one long one, so the bug manufactured `sentence-length` findings on the commonest heading-in-a-paragraph pattern in these very skills.
- The sentence scanner runs in one forward pass. An earlier draft of this release used a variable-length lookbehind, which rescanned a run of closing markup. 25,000 markers took 2.1 seconds, and a million took roughly two minutes of processor time. Hostile or generated Markdown could therefore stall an audit. The scan is now linear, and a million markers takes 51 milliseconds.
- An unmatched backtick run no longer swallows the sentence before it. A stop followed by a lone backtick and a new sentence was read as one sentence. The scanner cleared its state on sight of a backtick, rather than on a span that closes.
- `auditText` no longer rebuilds each sentence as a regular expression to find where it starts. That threw `regular expression too large` on a long enough sentence, so a document could crash the audit rather than be audited. The splitter reports offsets instead.
- An unmatched backtick run is skipped whole when inline markup is read. Emitting one character and looking again made the next backtick rescan the rest of the run. An audit of 10,000 backticks took 5.4 seconds, and now takes 154 milliseconds. The parser is linear where it was quadratic.
- An abbreviation behind emphasis is still an abbreviation. `**e.g.**` split a sentence where `e.g.` did not, because the closing markup hid the stop from the classifier.
- A code span is now one atom. `` `alpha. beta` `` split a sentence into three, so any text that quotes punctuation was miscounted. A span in backticks is a term being named, which the word rules already respected and the sentence splitter did not.

- Every link and image is found by one scan rather than by a pattern per rule. Each pattern read a label by scanning to the end of the line from every `[`, so a document full of brackets cost each rule the square of its length. Ten thousand unmatched brackets took about nine seconds and now take 18 milliseconds.
- A link label may hold balanced brackets, and what sits inside it is read. A pattern that stopped at the first `]` left the destination and title in place, so hidden text was counted as prose. A badge, written as an image inside a reference link, lost its `image-alt` finding entirely.
- An escaped character is read as the character a reader sees. CommonMark renders `\!` as `!`, and the scanner cleared its state for every escape. An escaped terminator therefore lost its sentence boundary, and an abbreviation behind an escaped bracket stopped being an abbreviation.
- An escaped backtick can still close a code span. CommonMark blocks an escape from opening one, but the search for a closer ignores backslashes, and discarding every escaped run merged two short sentences into one over-long one.
- Markup that spans lines no longer moves the lines after it. A link destination or title may hold a line ending, and flattening the link deleted it, so later findings pointed one line early and a reader opened an innocent line.
- An empty link measures as what a reader sees, which is nothing. Its destination and title were counted as prose beside the correct report of a link with no text.
- A definition is judged by the words that spell the acronym, and the acronym decides how many that takes. A nine-letter dotted initialism was reported undefined although the text defined it on the spot.
- Four more places that grew with the square of the document are now linear. They are the acronym scan, the expansion lookahead, the line-number lookup, and the reader of a sentence's last word. The worst cost 10.8 seconds on 4,000 long sentences in one paragraph and now costs 1.9.

### Known limitations

These are stated rather than fixed, and each needs Markdown a reader is unlikely to write.

- A link destination ends at the first `)`. CommonMark allows balanced pairs of brackets inside one, so a destination holding both parentheses and a raw `]` is not read as a link.
- A link inside a link label is reported as two links. CommonMark resolves those to the innermost link alone.
- An image whose description is made only of another image with no description of its own is not reported. The released engine does not report it either.

## [0.5.0] - 2026-08-17

### Added

- The plugin installs in Codex CLI as well as Claude Code. Codex reads the same marketplace manifest, and every skill now carries `agents/openai.yaml`, which gives Codex its display name, short description and suggested prompt.
- `iso-24495-style` carries the output style as a skill, word for word, with a test keeping the two identical. Codex has no output style, so a Codex user names this skill in their own `AGENTS.md` to get the same behaviour.
- The style skill ships in `codex-skills/`, which Codex reads through `.codex-plugin/plugin.json` and Claude Code does not scan. Claude keeps its six skills and its output style.
- A plugin cannot apply itself in Codex: an `AGENTS.md` inside a plugin is ignored, which was tested rather than assumed. Only a project's file, or the one in the Codex home directory, is read.
- `iso-24495-text-audit` lets the user audit one selected `.md`, `.markdown`, or `.txt` file or directory. It reports located mechanical findings and leaves validity, suitability, and rewriting decisions to the user.
- Part 5 now provides templates for architecture decision records, runbooks, and design documents.
- Part 5 requires the matching template before writing and defines a content-preserving restructuring workflow.
- `filler-opening` now requires a whole word and skips front matter. It reported "Surely the answer is correct" and "Let meadows grow naturally" as filler openings, which is wrong advice on ordinary sentences. It also missed a filler opening after front matter, which is how most templated documents begin.
- `table-header` now recognises tables written without outer pipes, which GitHub renders and writers commonly use.
- `complex-word` suggests only equivalents no longer than the word they replace, so its own advice cannot push a sentence past the 30-word cap. "ascertain" now suggests "find" rather than "find out".
- One integrated fixture trips all seventeen rules in a realistic document. It complements the isolated positive controls by checking that rules remain observable when their findings occur together.
- The text audit reports every finding with its file, line, rule, and explanation. It also reports unreadable entries and carries no pass or compliance verdict.
- List items are measured as the sentences a reader reads them as. A bullet is prose, it can run to forty words, and nothing was checking it, so the longest text in many documents went unadvised. Each item is its own block, so six bullets are not a six-sentence paragraph, and the marker is not counted as a word.
- Quotations are measured too. Markdown cannot prove who wrote a quotation, and GitHub renders `> [!WARNING]` as an alert, which this plugin's own runbook template asks writers to use. Staying silent there hid the most important sentence in a document. The alert label is skipped, because a label is not a sentence.
- A demonstration of bad writing belongs in a fenced block, which the engine leaves alone. The three skills showed their misaligned examples as quotations, so those examples are now fenced, and the aligned examples stay as quotations and pass the rules they demonstrate.
- Containers are tracked as a stack of content columns. A list item holds whole blocks: a second paragraph, a fence, a table, then more prose. The paragraph after them was read as indented code and lost. A nested item and its parent joined into a paragraph nobody wrote, and a task marker counted as two words.
- Headings and tables are recognised inside containers. A heading written as a list item was invisible to every heading rule, and a table inside a quotation was read as one 52-word sentence.
- A word in quotation marks or backticks is being named, so the rules that read words skip it. Emphasis is not naming: a writer emphasises a word they are using, and while emphasis counted, a whole sentence in bold escaped every one of those rules. A quoted span longer than six words is prose rather than a name.
- `legalese`, `wordy-phrase` and `double-negative` skip a term that a document names rather than uses, as `complex-word` has since it shipped. A skill that teaches writers to avoid `shall` was told never to write it, and the advice to prefer `to` over `in order to` was reported as wordy.
- The repository audits itself with its own per-project acronym list, in `.iso-24495-4/acronyms.json`. It had been held to a stricter setting than the one it ships to its users.
- Every construct the engine relies on was compared against CommonMark and the GitHub table extension, rather than sampled. Fenced code, indented code, headings of both kinds, lists, blockquotes, tables, thematic breaks, front matter, line endings and Unicode whitespace each follow their specification now.
- Indented code is code, so a sample containing "shall" no longer draws advice about legalese. Code cannot interrupt a paragraph, so an indented line continuing one is still measured.
- A heading with no text still holds its level, so `#` above `###` reports the skip between them, and a `##` between the two fills it.
- Every part of the engine reads one structure: front matter, then fenced code, then tables, decided once before any rule runs. While each scanner kept its own state they disagreed, and each disagreement removed text a reader can see. Fenced code now follows the CommonMark rules. An indented marker no longer opens a fence, and a fence closes only with its own character at a length at least equal to the opener.
- A document is split on a bare carriage return as well as CRLF, and a leading byte order mark is removed. Either one could hide a whole document.
- Front matter and tables are structure everywhere, not just in one rule. A metadata line naming a policy was audited as a sentence, and produced legalese and doublet findings. A table written without leading pipes had its cells audited as prose.
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
- A hand-written known-good corpus measures the false-positive rate on plain prose, which was previously unmeasured. Seven documents in different registers currently produce nothing.
- A GitHub Actions workflow runs the suite on every pull request. It calls `scripts/check.sh`, the same single gate a contributor runs locally, so a failed build reproduces with one command.
- Plain-language checks for script comments are cancelled, not deferred. Version 0.4.0 announced them for this release. Comments are fragments rather than documents, and checking them well would need a separate extractor for each language plus the docstring conventions layered on top. That machinery costs more than the advice it would produce, so the plan is withdrawn rather than postponed.

### Changed

- Acronym definitions now work in document order and must match the acronym. A later expansion or unrelated parenthesis no longer excuses an unexplained first use.
- Link advice now follows wrapped HTML and Markdown labels and treats non-breaking space entities as spaces.
- Image destinations containing "decorative" no longer excuse missing alternative text. Only an exact decorative title does.
- Prose rules now judge rendered link labels rather than hidden destinations. Link and image checks cover inline, full-reference, collapsed-reference, shortcut-reference, and HTML forms.
- Advice for long sentences now cites the sentence's starting line. Filler answers, formatted headings, formatted link labels, empty formatted table headers, and proper names are calibrated separately.
- Sentence rules recalibrated. The engine now flags a document average above 20 words (new `sentence-average` rule, minimum sample 10 sentences) and raises the per-sentence cap from 20 to 30. Public plain-language guidance (Cutts, the Plain English Campaign, the Clear English Standard) specifies an average of 15 to 20 words rather than a per-sentence cap. The cap of 30 and the 10-sentence minimum are this project's own proxy choices, informed by measurements of local sessions whose data is not part of this repository.
- Paragraph limit relaxed from 3 sentences to 5, matching public guidance (3 to 5, with single-sentence paragraphs fine for emphasis).
- The core skill's voice rule is no longer absolute: active is the default, and passive is accepted where the actor is unknown, irrelevant, or secondary.
- The core skill and output style gain guidance the standards emphasise and the plugin lacked: the four governing principles named (relevant, findable, understandable, usable), and audience-first framing. It also adds positive framing, direct address, subject-verb proximity, explicit connective words, wordy-phrase replacements, and repetition over elegant variation. Layout rules are now labelled house conventions.
- The text audit reads `.md`, `.markdown`, and `.txt` files.
- The output style gains a **Reporting work** section, and the send-time check grows from four measures to nine. Two external reviews judged 165 of this project's own replies against the four governing principles. They found failures the sentence and paragraph limits cannot see: a defect reported as a count rather than a finding, and work called done while a gate was still open. They also found options described unevenly, a rule contradicted after it was given, and grammar dropped in the name of brevity.
- Each of those failures is a rule with a matching item in the send-time check. The five reporting items apply only when a reply reports work, so a one-line answer stays one line.
- The output style now covers reply layout and carries a send-time check. It states the limits apply to replies as well as documents, and holds a reply paragraph to 4 sentences. It asks for the draft to be read back against four measures before sending. Measured on one long reply, the revision cut violations from 10 to 1 and the average sentence from 23.1 words to 14.8. It cut the length from 463 words to 266 with no loss of content.
- Tests pin that the style and core skill quote the engine's current limits, and that the check survives edits.
- Each shipped command now has a library module and a separate logic-free entry file. Every measured file covers 100% of lines and functions, and end-to-end tests run each entry.

### Removed

- The background corpus monitor no longer ships. Installing the plugin no longer creates a session-long task that can interfere with `/goal`.
- The automatic `PostToolUse` text hook no longer ships. Text auditing now begins only when the user invokes `iso-24495-text-audit`.

### Fixed

- Selected and nested symbolic links or directory junctions are now skipped and reported. Directory audits never follow them beyond the path the user approved or around a cycle.
- Text and corpus audits now report a file that becomes unreadable after enumeration as skipped, while continuing with readable files.
- Both audit commands reject missing option values, unknown options, extra arguments, and duplicate options before writing output.
- The obsolete project-level monitor configuration was removed with the monitor implementation.
- The shouting test now reads a distilled lexicon of about 7,400 words rather than 400 hand-picked ones. Absence from a short list meant nothing, so `ROTATE KEYS` was reported as two undefined acronyms while `ENABLE MFA` was silent. The list is distilled offline from local English prose, keeping only words written in lower case in at least 92% of their uses, so acronyms cannot enter it. Words that are also common acronyms are removed deliberately. A run of two capitals must now be entirely ordinary words to count as shouting, and an ordinary word is never reported as an acronym.
- Headings indented up to three spaces are now recognised, as CommonMark requires. An indented heading was invisible to every heading rule, so a skipped level inside an indented block went unreported.
- An inline abbreviation followed by a capital is now undecided rather than joined. Merging by default turned two real sentences into one long one and reduced a six-sentence paragraph to five, which hid a violation.
- Roman numeral evidence is narrower. `form`, `round`, `group` and `mark` are no longer numbering words. Each is an ordinary noun or verb, and `Open the form and review CI settings` then excused `CI`. A capitalised name of five letters or more now carries a regnal number. So `Elizabeth II` no longer asks for an expansion, while `MMIX` is reported as the computer name it is.
- A full stop now has three verdicts rather than two: ends a sentence, does not, or cannot be decided. Rules that punish length count the most sentences the text can hold, and rules that punish sentence count take the fewest. So an undecided stop can never create a violation on its own. Two curated word lists carry the evidence: words almost never capitalised mid-sentence, and ordinary words that appear in shouted text. Both are hand-curated for this project and are not distilled from a corpus.
- `acronym-undefined` states its limits plainly. It reports a capitalised token that no other evidence explains. It stays silent inside a run of capitals that is mostly ordinary English words, because that is shouting rather than terminology. It stays silent on a Roman numeral unless the numeral is one that commonly doubles as an acronym and nothing nearby marks it as a number. It does not attempt to expand acronyms, and it will miss an undefined acronym that sits inside shouted text.
- `prose-enumeration` no longer counts an ordinal inside a hyphenated compound. `third-party service` was read as a third item and turned ordinary prose into a finding.
- The output style no longer presents 15 words as a minimum average. The engine sets an upper limit and no lower one, so a concise reply was failing a check whose only remedy was padding.
- The repository's own audit guard covers every extension the text audit reads, not only `.md`. Both use `isAuditedDocument`, which ignores letter case.
- The end-to-end entry file tests no longer fail at random. Each spawns a cold Bun process, which can take longer than the default five second limit on a loaded machine, and the process was then killed mid-run. Two of five suite runs failed before the fix and six of six passed after it.

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
