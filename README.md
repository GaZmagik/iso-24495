# ISO 24495 Plain Language Skills

Eight [Agent Skills](https://code.claude.com/docs/en/skills) that support plain language writing, document audits, code, and organisational implementation. They apply principles inspired by the ISO 24495 *Plain language* series.

The skills are plain `SKILL.md` files with agent-neutral wording. Any tool that reads the Agent Skills format can use them.

This repository also packages them as a Claude Code plugin with an **ISO 24495 output style** (`output-styles/iso-24495.md`). Select the style with `/output-style` to hold every response to the core rules without relying on skill activation.

## Skills

| Skill | Scope |
|-------|-------|
| `iso-24495-1` | **Core principles.** Governs all user-facing output: no filler preambles, short sentences and paragraphs, active voice, scannable structure, concrete instructions. |
| `iso-24495-2` | **Legal writing.** Extends the core skill for contracts, licences, and compliance text: standardised modal verbs, no legalese, named actors, structured conditional clauses, defined terms, cross-references that name what they point at, stable clause identifiers, a summary layer over the operative text, and section names a reader can navigate by. |
| `iso-24495-3` | **Science and technical writing.** Extends the core skill for documentation, architecture, and code review: progressive disclosure, exact file citations, defined acronyms, text alternatives for diagrams, and the stages placed inside the document levels of `iso-24495-5`. |
| `iso-24495-4` | **Organisational implementation (provisional).** A task skill for plain language gap analysis in organisations: a process-artefact sweep, a corpus audit, a five-dimension maturity model with deterministic scoring, and an append-only audit trend. Ships TypeScript tooling run with [Bun](https://bun.sh) (`bun test` covered). Based on the unpublished ISO/CD 24495-4 committee draft. |
| `iso-24495-5` | **Document design (provisional).** Extends the core skill for structuring complex documents: an opening block, visual hierarchy, navigation aids, layered detail, comparisons, consistent signalling, and a signpost for the reader who wanted a different document. Ships a decision record, a runbook and a design document template. Based on the unpublished ISO/WD 24495-5 working draft. |
| `iso-24495-code` | **Plain language in code.** Applies the principles to what a person reads in source: the order units appear in, their names, what comments say, and what an error tells the reader who hits it. Measured to change how Claude structures a file, at no cost to correctness. |
| `iso-24495-text-audit` | **User-invoked text audit.** Checks a selected `.md`, `.markdown`, or `.txt` file or directory. Reports mechanical findings with locations, without deciding validity or compliance. |
| `iso-24495-design-audit` | **User-invoked design audit.** Previews calibrated purpose and colour checks for selected Markdown, with a local title check. Sending requires agreement and a TypeSafe API key. |

The core skill activates the relevant writing skills automatically. It triggers `iso-24495-2` for legal content, `iso-24495-3` for technical content, and `iso-24495-5` for complex documents. A legal document always pairs with `iso-24495-5`, and a technical one does whenever its output is a document. The text audit never activates automatically.

All skills exempt internal reasoning. The writing skills preserve code blocks, commands, and logs untouched; `iso-24495-code` is the exception, because governing code is its subject. Technical and legal accuracy always supersede formatting rules.

## Installation (Claude Code)

Add this repository as a plugin marketplace, then install the plugin:

```
/plugin marketplace add https://github.com/GaZmagik/iso-24495.git
/plugin install iso-24495-plain-language@iso-24495
```

Use the full HTTPS address as shown. The short `owner/repo` form makes some Claude Code versions clone over SSH, which fails without GitHub SSH keys.

Or from a local clone:

```
/plugin marketplace add ./path/to/this/repo
/plugin install iso-24495-plain-language@iso-24495
```

## Installation (Codex CLI)

Codex reads the same marketplace manifest, so the plugin installs from the same address:

```
codex plugin marketplace add https://github.com/GaZmagik/iso-24495.git
codex plugin add iso-24495-plain-language@iso-24495
```

Or from a local clone, where `.` is the repository root:

```
codex plugin marketplace add .
codex plugin add iso-24495-plain-language@iso-24495
```

Every skill carries `agents/openai.yaml`, which gives Codex its display name, its short description, and the prompt Codex offers for it. Invoke a skill by name, as in `$iso-24495-1`, or ask for it in words.

Codex has no output style, so the same rules are a skill there: `iso-24495-style` holds the output style word for word, and a test keeps the two identical. It lives in `codex-skills/` rather than `skills/`, because Claude Code scans `skills/` and would otherwise offer a skill its output style already covers. Codex reads both directories, named in `.codex-plugin/plugin.json`.

Name the skill in your `AGENTS.md` to apply it to every response:

```
Apply `iso-24495-style` to every response.
```

Put that in your project's `AGENTS.md` or in `~/.codex/AGENTS.md`. An `AGENTS.md` inside a plugin is ignored, so a plugin cannot apply itself.

## Usage

Once installed, the agent loads the skills when their descriptions match the task. To apply one explicitly, ask for it by name, for example: "Apply `iso-24495-2` to this licence text."

Invoke `iso-24495-text-audit` directly and supply one file or directory. The skill reads only that path and leaves every change to the user:

```text
/iso-24495-plain-language:iso-24495-text-audit docs/policy.md
```

Invoke `iso-24495-design-audit` the same way. It needs a TypeSafe API key, and it asks before it sends the document to the TypeSafe service:

```text
/iso-24495-plain-language:iso-24495-design-audit docs/guide.md
```

To enforce the core skill on every response, add a line to your agent's instruction file (`CLAUDE.md`, `AGENTS.md`, or equivalent):

```markdown
- ALWAYS activate and adhere to the `iso-24495-1` Plain Language skill across all responses
```

For agents without a plugin system, copy the `skills/` subdirectories into wherever the tool discovers skills.

## Disclaimer

This unofficial project is not affiliated with, endorsed by, or approved by the International Organization for Standardization (ISO). The skills contain original guidance inspired by the ISO 24495 series. They do not reproduce the text of any ISO standard.

Publication status: Part 1 published 2023, Part 2 August 2025, Part 3 May 2026. Parts 4 and 5 remain unpublished drafts (ISO/CD 24495-4 and ISO/WD 24495-5). Their skills are provisional guidance from public scope statements, to be revised when ISO publishes.

**Conformance disclaimer.** The full ISO 24495 texts are licensed and have not been consulted. These skills are built from public principles, published scopes, and common plain-language practice.

The principles derive from the International Plain Language Federation's freely published framework. Every quantitative rule here (sentence length, paragraph density, legalese, heading depth) is this project's own proxy. No rule is a clause of any standard.

Nothing this plugin produces is a statement of ISO conformance. No certification scheme exists for ISO 24495. "Aligned" in the skills means aligned with this project's interpretation, nothing more.

## Reference

Read the standard rather than this project's reading of it.

- **[ISO 24495-1:2023, Plain language, Part 1: Governing principles and guidelines](https://www.iso.org/standard/78907.html)**, the published standard these skills interpret. The ISO catalogue also carries Part 2 (legal writing) and Part 3 (science and technical communication).
- **[The International Plain Language Federation's definition and framework](https://www.iplfederation.org/iso-standard/)**, freely published, and the source of the four governing principles used here.
- **[Plain Language Association International on the ISO standard](https://plainlanguage.com/what-is-plain-language/iso-plain-language-standard/)**, background on how the standard was drafted and what it covers.

The ISO texts are licensed, so the standards themselves cost money. Everything in this repository is built from the freely published material above.

## What the engine reads

A rule can only be as right as the text it reads. So the engine parses Markdown the way CommonMark describes it: each line is matched against the containers already open, then against any container it starts. What remains is the block a rule measures. That is what lets a wrapped list item, a quotation continuing without its marker, and a heading written inside a list all be read correctly.

**Measured, because a reader reads them:**

- paragraphs, wherever they sit;
- list items, which are often the longest sentences in a document;
- quotations, including GitHub alerts such as `> [!WARNING]`;
- headings, at any depth and in any container, through the heading rules and the five word rules named below.

**Not measured, because they are not sentences:**

- fenced and indented code, which is a specimen rather than advice to give back to the writer;
- tables, whose cells belong to a grid, except that `table-header` reads them;
- YAML front matter, which is metadata, unless the audit is told the text has none;
- a GitHub alert label, which is a label;
- a task marker, which is a control rather than two words.

The parser is checked against the CommonMark reference implementation. 302 documents are recorded in `skills/iso-24495-4/tests/fixtures/reference-blocks.ts`, and every one that this engine reads differently carries the reason why. The reference is not a dependency: it was installed outside the repository, asked once, and its answers kept.

## User-invoked text audit

The `iso-24495-text-audit` skill audits a selected `.md`, `.markdown`, or `.txt` file or directory. It uses the same rule engine as the Part 4 corpus audit. It reports each finding with its file, line, rule, and explanation.

The audit is written for English and supports English only. The skills and output style are instructions a model interprets, so they are not limited to English in the same way.

Its word rules match English words and phrases: `legalese`, `doublet`, `wordy-phrase`, `filler-opening`, `complex-word`, `double-negative`, and the phrases `link-text` looks for. The `filler-opening` rule checks only the opening prose. The `link-text` rule also flags empty labels and labels that are bare web addresses.

Five word rules read headings as well as prose: `legalese`, `doublet`, `wordy-phrase`, `complex-word`, and `double-negative`. The rules about sentences and paragraphs read prose only, because a heading is not a sentence.

Those five rules, `acronym-undefined` and `prose-enumeration` read through paired emphasis marks, so `in **order** to` is the phrase `in order to`. A block whose lines hold `[`, `<`, `://` or `www.` is the exception: its marks stay, because pairing them around a link reported words no reader sees. A phrase split by emphasis is therefore missed in a block that holds a link, a bare web address, a task marker, an HTML tag or a bracket in code.

The `sentence-length` and `sentence-average` rules count words separated by whitespace, including spaces and line breaks, and use English benchmarks. The `paragraph-length` rule counts sentences, with a limit of five.

The `prose-enumeration` rule flags three or more distinct ranks in a prose block, including rank one. It recognises English ordinal words and numbered markers from one to six.

The audit reads Markdown as written and does not interpret raw HTML. It sets HTML tags aside and reads the text between them, even where GitHub would hide or change that text.

A leading `---` block is front matter, which the prose checks set aside as metadata. Text that cannot carry metadata, such as a pull request description, takes `--no-front-matter`, and the block is then read as text.

Four Markdown layout rules add contents navigation, an edition metadata advisory, unordered bullet depth and an overview before detail.
Their [recognition limits](skills/iso-24495-text-audit/SKILL.md#markdown-layout-recognition) remain unmeasured on a corpus.

The edition advisory applies only to titled documents and asks whether readers need a version or date.
Files named `readme`, `contributing`, `security` or `pull_request_template` are exempt in any folder, regardless of case or extension.
Text audited with `--no-front-matter` is also exempt.
Front-matter keys `version`, `date`, `updated` and `last_updated` satisfy it at the top level or directly under `metadata`.
Visible opening fields still require a recognised version or date.

Front matter is parsed once; aliases resolve before checking for a declared field.
A non-empty trimmed string, finite number or date counts, including `version: banana`.
The field's format is not validated, because YAML can change number spelling and resolve aliases.
Booleans, null, empty strings, maps, lists, other nesting and malformed front matter do not count.

The existing rules cover sentence length, sentence averages, paragraph length, legalese, and heading depth. They also cover `heading-skip`, `heading-style`, `acronym-undefined`, `doublet`, `prose-enumeration`, `link-text`, `image-alt`, `wordy-phrase`, `complex-word`, `double-negative`, `filler-opening`, and `table-header`.

The `link-text` and `image-alt` rules serve readers who hear or touch a document rather than look at it. A screen reader can list every link with no sentence around it, and an image without alternative text is silence.

The result reports zero findings when no implemented rule fires. That result does not prove the text suits its audience or purpose.

The shipped acronym list stays universal, so a technical vocabulary needs naming per project. Create `.iso-24495-4/acronyms.json` with the terms your readers already know:

```json
["SQL", "SDK", "CSS", "IDE"]
```

An unreadable or malformed file leaves the shipped list alone, because an advisory tool must never be the reason a document cannot be checked.

The skill never runs automatically. It requires Bun and does not alter the selected text.

Directory audits skip selected or nested symbolic links and directory junctions. The result reports each skipped entry instead of reading beyond the selected path or following a cycle.

## User-invoked design audit

The design audit previews calibrated purpose and colour checks for selected Markdown.
The text audit optionally adds these same checks with `--jev-preview` or `--jev --send`.
Its default remains offline and free, and `.txt` files remain mechanical-only.

Only purpose and colour receive calibrated decisions.
Purpose can fail or remain unsure; colour can pass or remain unsure.
The neither diagnosis refines one purpose failure.
Reader and position travel as companion questions, but their judgements are discarded.
Missing titles produce local findings and skip purpose assessment, while colour checks continue.

A document whose closed leading `---` block is not recognised as front matter is never sent, and the preview names it.

Requests reproduce calibration tag `results-r11`, commit `7359447c25e8030b3ecebe6bbdec2d0707a598ee`, using arm A and model `jev-1.13.0`.
The three-gate catalogue pins purpose failure at 0.87, colour pass at 0.83, and neither diagnosis at 0.83.
All scores use exact decimal tokens and distributions are never renormalised.
Read the [calibration gates and evidence](skills/iso-24495-design-audit/SKILL.md#checks-and-calibration) for the decision arithmetic and counts.

Bounds are one-sided 95% lower bounds on agreement for the protocol's cluster representatives, assuming independent clusters.
They are neither per-block reliability nor a document-level success probability.
Correlated document blocks do not extend that guarantee.
Unsure asserts no fault, and colour passes appear only in counts.

Preview names TypeSafe, the model, selected files, requests, companion questions and the five largest payload totals.
Document text leaves the machine when sent, and charges may apply.
Pricing, retention and live transport behaviour have not been checked.
Read the [privacy policy](https://typesafe.ai/legal/privacy-policy) and [Data Processing Agreement](https://typesafe.ai/legal/data-processing).

`--send` alone is never agreement.
An interactive command requires exact yes from the controlling terminal.
Piped or redirected input or output requires a user-supplied `--yes` as well.
Agents show the full disclosure and wait for the user's own live agreement; they must never add `--yes`.
Changed payloads require renewed agreement, and retries preserve the captured bytes.

Mechanical findings and Jev results occupy separate report sections and JSON properties.
JSON defaults to excerpts and state hashes.
Full judged state requires `--include-judged-text --json <requested-report-path>` and is disclosed as a local text export.
Credentials and raw responses are never saved.
A local send log records transmission rather than proof of agreement.

Sending requires Bun and a key in `TYPESAFE_API_KEY`.
The client permits four concurrent requests and six transport attempts, with a 30-second timeout per attempt.
It retries connection failures, timeouts, 429 and 5xx only, and never replaces an accepted answer.
On terminal failure, Jev verdicts are discarded and the report states incomplete execution.

Exit codes are 0 for completed or preview, 1 for local failure, and 2 for invalid arguments or missing agreement.
Code 3 covers service, response, model and calibration failures; code 4 covers a missing or locally invalid key.
Findings and unsure results never change a completed audit's exit code.

## Testing policy

Run `bash scripts/check.sh` before you push. That script is the whole gate, and GitHub Actions runs the same file on every pull request. A failure on the server therefore reproduces locally with one command. New checks belong in the script, never in the workflow.

Run `bun install` once after you clone, and have Node on your path. The gate runs a type check and a linter before the tests, and both are development dependencies. The linter starts on Node. The gate installs exactly what `bun.lock` records, and stops when that file and `package.json` disagree.

A user of the plugin installs none of this. So the gate copies the working tree to a place with nothing installed, and runs every shipped command there, in each documented mode that works offline. Bun is told not to fetch a missing package during that run.

The copy needs a place with no `node_modules` directory above it. The gate uses `TMPDIR` when that is set and clean. Otherwise it tries the system's temporary directory, the directory holding the repository, and the root of the repository's drive. On Windows it then tries the system drive, and elsewhere `/var/tmp` and `/dev/shm`. It uses the first clean one and says which, so you configure nothing.

That run proves each command loads and runs in those modes with nothing installed. It does not prove that every path through a command does. A send and a live fetch are not run. A test also refuses a package named outright in a shipped import, which catches the plain mistake early.

These guards catch accidents. The gate catches a package import written by name in shipped code. It also catches any shipped command that fails to load or run with nothing installed, in its documented offline modes.

It does not defend against a deliberate evasion, of which there are three kinds. A name can be computed while the code runs. A failure can be caught and hidden by the code. An edit to the lint configuration can change what a rule does without changing its entry, through inline configuration or a processor.

The person who reviews the diff covers those, because each is visible in the change that introduces it.

A pull request description is text a reader receives, so it is audited as well. It is not in the tree, so `scripts/check.sh` cannot reach it and a second workflow fetches it instead. The rule above still holds, because that workflow decides nothing: it hands the text to a checked-in script, which you can run over any file.

```bash
bash scripts/audit-pull-request-text.sh <file>
```

Findings are advice, and never fail the check. The script lists them in its log, and on the job's summary page when it runs on GitHub. No explanation of why a text suits its readers could satisfy a check that failed on findings.

The check fails in two cases only. It fails a description that is empty or holds nothing a reader can see, because there is nothing to audit. It also fails when the audit does not run.

A pass means only that the audit ran on a description that is not empty. It does not mean the description is clear.

A description has no front matter, so the check tells the audit there is none. A leading `---` block is then read as text, rather than set aside as metadata the way a repository file's is.

A file the script cannot read stops it with a different code, rather than any verdict about text. A review found the reason for that: a mistyped name beginning with a dash reached `dirname` as an option, and the script audited a neighbouring file and passed. A check that passes for the wrong target is worse than one that fails.

The script only starts one program, `scripts/audit-pull-request-text.ts`, which reads the file once. The text it tests for emptiness is therefore the text it audits. A directory or a symbolic link is refused like a file that cannot be read.

The file is opened once. Its text is read from that open file, and only where that is the regular file the path names. So a link put in its place between the check and the read is not followed.

Both workflows are required status checks on main, so a pull request merges only once each reports a pass. Each check takes its name from the job key inside its workflow, which is why those keys carry a warning against renaming them. Renaming one leaves a required check waiting for a report that never arrives, and every merge stops.

`bun test` always measures coverage. Every measured source file must cover 100% of lines and functions. Test files are excluded from those totals.

The current suite covers 100% of measured source lines and functions.

Bun reports line and function coverage only in this toolchain. We make no branch-coverage claim.

Logic-free composition roots are separate entry files. Tests never import them, so Bun excludes them from the coverage report. End-to-end tests still exercise those entries.

Every new test receives a mutation check. The implementation is deliberately broken, the test must fail, and the correct behaviour is then restored.

## TypeScript style

This project follows the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html). It uses kebab-case filenames instead of snake_case and double quotes instead of single quotes. Both deviations match the wider ecosystem.

Two tools in the gate enforce the guide. The TypeScript compiler checks every file with `strict` on. ESLint applies the rules in `eslint.config.mjs`: those Google's own `gts` package switches on, less its formatter, and a few more.

A lint that finds nothing proves little when a rule is switched off or weakened by mistake. So `eslint.config.mjs` states the enforced rules once, and a test reads that list.

The test asks ESLint which configuration applies to each TypeScript file. Every enforced rule must be set there as that list states it: an error, with the same options. It also gives the linter one deliberate breach of each rule, and requires an error for each.

As configured, a comment in a file cannot change a rule or switch one off, and the gate fails on a warning. The testing policy above says what these guards do not defend against. Rules of the guide that no tool here checks are left to review.

## Why this project holds itself to these rules

This repository is both the tool and a user of the tool. Its shared gate audits every supported document, including this file.

That is deliberate. A plain language project that exempts itself has no claim on anyone else. The Part 4 maturity audit runs against this repository first, and its findings are acted on here first.

## Roadmap

All seven skills and the output style ship in v0.6.0. What remains:

- **When ISO publishes Part 4:** revise the provisional `iso-24495-4` skill against the published text. Its committee-draft text is not public, so the current maturity model is original guidance.
- **When ISO publishes Part 5:** revise the provisional `iso-24495-5` skill against the published text.

Plain-language checks on script comments were once planned for this release. That plan is cancelled. Comments are fragments, and checking them well would cost more machinery than the advice is worth.

## Licence

MIT
