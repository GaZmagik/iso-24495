# ISO 24495 Plain Language Skills

Six [Agent Skills](https://code.claude.com/docs/en/skills) that support plain language writing, document audits, and organisational implementation. They apply principles inspired by the ISO 24495 *Plain language* series.

The skills are plain `SKILL.md` files with agent-neutral wording. Any tool that reads the Agent Skills format can use them.

This repository also packages them as a Claude Code plugin with an **ISO 24495 output style** (`output-styles/iso-24495.md`). Select the style with `/output-style` to hold every response to the core rules without relying on skill activation.

## Skills

| Skill | Scope |
|-------|-------|
| `iso-24495-1` | **Core principles.** Governs all user-facing output: no filler preambles, short sentences and paragraphs, active voice, scannable structure, concrete instructions. |
| `iso-24495-2` | **Legal writing.** Extends the core skill for contracts, licences, and compliance text: standardised modal verbs, no legalese, named actors, structured conditional clauses. |
| `iso-24495-3` | **Science and technical writing.** Extends the core skill for documentation, architecture, and code review: progressive disclosure, exact file citations, defined acronyms. |
| `iso-24495-4` | **Organisational implementation (provisional).** A task skill for plain language gap analysis in organisations: a process-artefact sweep, a corpus audit, a five-dimension maturity model with deterministic scoring, and an append-only audit trend. Ships TypeScript tooling run with [Bun](https://bun.sh) (`bun test` covered). Based on the unpublished ISO/CD 24495-4 committee draft. |
| `iso-24495-5` | **Document design (provisional).** Extends the core skill for structuring complex documents: visual hierarchy, navigation aids, tables for comparisons, consistent visual signalling. Based on the unpublished ISO/WD 24495-5 working draft. |
| `iso-24495-text-audit` | **User-invoked text audit.** Checks a selected `.md`, `.markdown`, or `.txt` file or directory. Reports mechanical findings with locations, without deciding validity or compliance. |

The core skill activates the relevant writing skills automatically. It triggers `iso-24495-2` for legal content, `iso-24495-3` for technical content, and `iso-24495-5` for complex documents. The text audit never activates automatically.

All skills exempt internal reasoning and preserve code blocks, commands, and logs untouched. Technical and legal accuracy always supersede formatting rules.

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

Codex reads the same marketplace manifest, so the plugin installs from the same
address:

```
codex plugin marketplace add https://github.com/GaZmagik/iso-24495.git
codex plugin add iso-24495-plain-language@iso-24495
```

Or from a local clone, where `.` is the repository root:

```
codex plugin marketplace add .
codex plugin add iso-24495-plain-language@iso-24495
```

Every skill carries `agents/openai.yaml`, which gives Codex its display name,
its short description, and the prompt Codex offers for it. Invoke a skill by
name, as in `$iso-24495-1`, or ask for it in words.

Codex has no output style, so the same rules are a skill there:
`iso-24495-style` holds the output style word for word, and a test keeps the
two identical. It lives in `codex-skills/` rather than `skills/`, because
Claude Code scans `skills/` and would otherwise offer a skill its output style
already covers. Codex reads both directories, named in `.codex-plugin/plugin.json`.

Name the skill in your `AGENTS.md` to apply it to every response:

```
Apply `iso-24495-style` to every response.
```

Put that in your project's `AGENTS.md` or in `~/.codex/AGENTS.md`. An
`AGENTS.md` inside a plugin is ignored, so a plugin cannot apply itself.

## Usage

Once installed, the agent loads the skills when their descriptions match the task. To apply one explicitly, ask for it by name, for example: "Apply `iso-24495-2` to this licence text."

Invoke `iso-24495-text-audit` directly and supply one file or directory. The skill reads only that path and leaves every change to the user:

```text
/iso-24495-plain-language:iso-24495-text-audit docs/policy.md
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

## What the engine reads

A rule can only be as right as the text it reads. So the engine parses
Markdown the way CommonMark describes it: each line is matched against the
containers already open, then against any container it starts. What remains
is the block a rule measures. That is what lets a wrapped list item, a
quotation continuing without its marker, and a heading written inside a list
all be read correctly.

**Measured, because a reader reads them:**

- paragraphs, wherever they sit;
- list items, which are often the longest sentences in a document;
- quotations, including GitHub alerts such as `> [!WARNING]`;
- headings, at any depth and in any container;
- HTML, because its text is prose a reader reads.

**Not measured, because they are not sentences:**

- fenced and indented code, which is a specimen rather than advice to give
  back to the writer;
- tables, whose cells belong to a grid, except that `table-header` reads them;
- YAML front matter, which is metadata;
- a GitHub alert label, which is a label;
- a task marker, which is a control rather than two words.

The parser is checked against the CommonMark reference implementation. 302
documents are recorded in `skills/iso-24495-4/tests/fixtures/reference-blocks.ts`,
and every one that this engine reads differently carries the reason why. The
reference is not a dependency: it was installed outside the repository, asked
once, and its answers kept.

## User-invoked text audit

The `iso-24495-text-audit` skill audits a selected `.md`, `.markdown`, or `.txt` file or directory. It uses the same rule engine as the Part 4 corpus audit. It reports each finding with its file, line, rule, and explanation.

The rules cover sentence length, sentence averages, paragraph length, legalese, and heading depth. They also cover `heading-skip`, `heading-style`, `acronym-undefined`, `doublet`, `prose-enumeration`, `link-text`, `image-alt`, `wordy-phrase`, `complex-word`, `double-negative`, `filler-opening`, and `table-header`.

The last two serve readers who hear or touch a document rather than look at it. A screen reader can list every link with no sentence around it, and an image without alternative text is silence.

The result reports zero findings when no implemented rule fires. That result does not prove the text suits its audience or purpose.

The shipped acronym list stays universal, so a technical vocabulary needs naming per project. Create `.iso-24495-4/acronyms.json` with the terms your readers already know:

```json
["SQL", "SDK", "CSS", "IDE"]
```

An unreadable or malformed file leaves the shipped list alone, because an advisory tool must never be the reason a document cannot be checked.

The skill never runs automatically. It requires Bun and does not alter the selected text.

Directory audits skip selected or nested symbolic links and directory junctions. The result reports each skipped entry instead of reading beyond the selected path or following a cycle.

## Testing policy

Run `bash scripts/check.sh` before you push. That script is the whole gate, and GitHub Actions runs the same file on every pull request. A failure on the server therefore reproduces locally with one command. New checks belong in the script, never in the workflow.

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

All six skills and the output style ship in v0.5.0. What remains:

- **When ISO publishes Part 4:** revise the provisional `iso-24495-4` skill against the published text. Its committee-draft text is not public, so the current maturity model is original guidance.
- **When ISO publishes Part 5:** revise the provisional `iso-24495-5` skill against the published text.

Plain-language checks on script comments were once planned for this release. That plan is cancelled. Comments are fragments, and checking them well would cost more machinery than the advice is worth.

## Licence

MIT
