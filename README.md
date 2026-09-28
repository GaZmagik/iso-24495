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
| `iso-24495-design-audit` | **User-invoked design audit.** Checks a selected `.md` or `.markdown` file or directory for the document structure that Part 5 asks for. Uses the Jev judgement model from TypeSafe, so it needs a TypeSafe API key. |

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

The `sentence-length` and `sentence-average` rules count words separated by whitespace, including spaces and line breaks, and use English benchmarks. The `paragraph-length` rule counts sentences, with a limit of five.

The `prose-enumeration` rule flags three or more distinct ranks in a prose block, including rank one. It recognises English ordinal words and numbered markers from one to six.

The audit reads Markdown as written and does not interpret raw HTML. It sets HTML tags aside and reads the text between them, even where GitHub would hide or change that text.

A leading `---` block is front matter, which the audit sets aside as metadata. Text that cannot carry metadata, such as a pull request description, takes `--no-front-matter`, and the block is then read as text.

The rules cover sentence length, sentence averages, paragraph length, legalese, and heading depth. They also cover `heading-skip`, `heading-style`, `acronym-undefined`, `doublet`, `prose-enumeration`, `link-text`, `image-alt`, `wordy-phrase`, `complex-word`, `double-negative`, `filler-opening`, and `table-header`.

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

The `iso-24495-design-audit` skill checks a selected `.md` or `.markdown` file or directory for the document structure that Part 5 asks for. The text audit cannot see that structure, because its rules are mechanical. This audit asks Jev, the judgement model from TypeSafe, narrow yes-or-no questions about each candidate that code finds.

It checks four things:

- whether the opening block has a level-1 title, states its purpose, and states in words who the document is for
- whether each section heading states a message or a task, rather than only naming a topic, with a "Summary" or "Overview" label exempt
- whether each paragraph of two or more sentences holds one idea
- whether a paragraph identifies something only by its colour or only by its position

Part 5 allows a topic name for a reference section, and for a fixed name a document type requires, such as Context in a decision record. Jev cannot tell those sections from one heading, so the audit still reports them, and you decide.

Each answer falls in one of three bands: passes, needs improvement, or fails. A borderline answer is not a pass, so the audit reports both needs improvement and fails, and names the band. The cut-offs were calibrated on 2026-09-28 against labelled samples from popular open-source documents, and they are provisional.

`colour-only` and `position-only` report needs improvement at most. No labelled real failure has been measured for either, so neither has a fail band.

Each finding says what to do, and a paragraph finding quotes the start of the text judged. A heading finding names the Part 5 exceptions, so you can check them before rewording.

The report counts, for each rule, the candidates checked and the findings in each band. It also says what was not checked: exempt overview headings, and the opening of a document with no level-1 title. It names the Jev models that answered, and warns when one is not `jev-1.13.0`, the model the cut-offs were calibrated on.

Link text and alternative text are left out. On real documents Jev flagged good link text, and the `link-text` rule already covers links. Alternative text has not been measured on real documents.

The audit requires Jev and a TypeSafe API key, set in the `TYPESAFE_API_KEY` environment variable. Get a key from https://docs.typesafe.ai. Without a key, the audit stops and says so.

Nothing leaves your machine unless the command has `--send`. Without it, the audit prints the questions it would send, by file and by rule, and the largest files. It gives no cost estimate, because how TypeSafe bills has not been checked.

With `--send`, the text of each document goes to the TypeSafe service, and the skill tells you so before it sends anything. The TypeSafe [privacy policy](https://typesafe.ai/legal/privacy-policy) and [Data Processing Agreement](https://typesafe.ai/legal/data-processing) say how TypeSafe handles that text. TypeSafe offers zero data retention to enterprise customers.

Every finding except a missing title comes from a model and can be wrong. Like a text audit finding, it is a proxy and not an ISO judgement. The audit supports English only.

The skill never runs automatically. It requires Bun and does not alter the selected text.

## Testing policy

Run `bash scripts/check.sh` before you push. That script is the whole gate, and GitHub Actions runs the same file on every pull request. A failure on the server therefore reproduces locally with one command. New checks belong in the script, never in the workflow.

A pull request description is text a reader receives, so it is audited as well. It is not in the tree, so `scripts/check.sh` cannot reach it and a second workflow fetches it instead. The rule above still holds, because that workflow decides nothing: it hands the text to a checked-in script, which you can run over any file.

```bash
bash scripts/audit-pull-request-text.sh <file>
```

Findings are advice, and never fail the check. The script lists them in its log, and on the job's summary page when it runs on GitHub. No explanation of why a text suits its readers could satisfy a check that failed on findings.

The check fails in two cases only. It fails a description that is empty or holds only whitespace, because there is nothing to audit. It also fails when the audit does not run, or its report does not show that it read the text.

A pass means only that the audit ran on a description that is not empty. It does not mean the description is clear.

A description has no front matter, so the script passes `--no-front-matter` to the audit. A leading `---` block is then read as text, rather than set aside as metadata the way a repository file's is.

A file the script cannot read stops it with a different code, rather than any verdict about text. A review found the reason for that: a mistyped name beginning with a dash reached `dirname` as an option, and the script audited a neighbouring file and passed. A check that passes for the wrong target is worse than one that fails.

Both workflows are required status checks on main, so a pull request merges only once each reports a pass. Each check takes its name from the job key inside its workflow, which is why those keys carry a warning against renaming them. Renaming one leaves a required check waiting for a report that never arrives, and every merge stops.

`bun test` always measures coverage. Every measured source file must cover 100% of lines and functions. Test files are excluded from those totals.

The current suite covers 100% of measured source lines and functions.

Bun reports line and function coverage only in this toolchain. We make no branch-coverage claim.

Logic-free composition roots are separate entry files. Tests never import them, so Bun excludes them from the coverage report. End-to-end tests still exercise those entries.

Every new test receives a mutation check. The implementation is deliberately broken, the test must fail, and the correct behaviour is then restored.

## TypeScript style

This project follows the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html). It uses kebab-case filenames instead of snake_case and double quotes instead of single quotes. Both deviations match the wider ecosystem, and the repository conventions test enforces the mechanically checkable rules.

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
