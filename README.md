# ISO 24495 Plain Language Skills

Five [Agent Skills](https://code.claude.com/docs/en/skills) that make an AI agent write in plain language, and help organisations implement it. They apply principles inspired by the ISO 24495 *Plain language* series to every user-facing response.

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

The core skill activates the other skills automatically. It triggers `iso-24495-2` for legal content, `iso-24495-3` for technical content, and `iso-24495-5` for complex multi-section documents. Each also activates on request by name.

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

## Usage

Once installed, the agent loads the skills when their descriptions match the task. To apply one explicitly, ask for it by name, for example: "Apply `iso-24495-2` to this licence text."

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

## Background monitor (Claude Code)

The plugin ships a background monitor (`monitors/monitors.json`) for `iso-24495-4` engagements. It stays silent unless the working directory contains `.iso-24495-4/monitor.json` naming a corpus directory:

```json
{ "corpusDir": "docs" }
```

When configured, it re-audits changed documents and notifies the agent of rule-count deltas as they happen. Without a config it waits for one to appear and never exits on its own. The host therefore never raises a "task ended" notification.

Removing the config mid-session returns the monitor to the waiting state. It requires Bun and is Claude Code-specific; the skills themselves work without it.

## Advisory markdown hook (Claude Code)

The plugin ships a `PostToolUse` hook (`hooks/`) that audits every `.md`, `.markdown`, or `.txt` file Claude writes or edits. It uses the same rule engine as the Part 4 corpus audit. When a file carries violations, Claude receives one terse advisory line with per-rule counts.

The rules cover sentence length, sentence averages, paragraph length, legalese, heading depth, `heading-skip`, `heading-style`, `acronym-undefined`, `doublet`, and `prose-enumeration`.

A clean file produces nothing, and the hook never blocks a write.

To switch it off for a project, create `.iso-24495-4/hooks.json` containing:

```json
{ "markdownAudit": false }
```

It requires Bun and is Claude Code-specific; the skills themselves work without it.

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

This repository is both the tool and a user of the tool. Its hook audits every markdown edit, including this file. Its own audits have failed and forced rewrites; the changelog records them.

That is deliberate. A plain language project that exempts itself has no claim on anyone else. The Part 4 maturity audit runs against this repository first, and its findings are acted on here first.

## Roadmap

All five skills, the output style, the background monitor, and the advisory markdown hook have shipped. What remains:

- **When ISO publishes Part 4:** revise the provisional `iso-24495-4` skill against the published text. Its committee-draft text is not public, so the current maturity model is original guidance.
- **When ISO publishes Part 5:** revise the provisional `iso-24495-5` skill against the published text.

Plain-language checks on script comments were once planned for this release. That plan is cancelled. Comments are fragments, and checking them well would cost more machinery than the advice is worth.

## Licence

MIT
