# ISO 24495 Plain Language Skills

Five [Agent Skills](https://code.claude.com/docs/en/skills) that make an AI agent write in plain language — and help organisations implement it. They apply principles inspired by the ISO 24495 *Plain language* series to every user-facing response.

The skills are plain `SKILL.md` files with agent-neutral wording, so any tool that reads the Agent Skills format can use them. This repository also packages them as a Claude Code plugin, which additionally ships an **ISO 24495 output style** (`output-styles/iso-24495.md`): select it with `/output-style` to hold every response to the core plain language rules without relying on skill activation.

## Skills

| Skill | Scope |
|-------|-------|
| `iso-24495-1` | **Core principles.** Governs all user-facing output: no filler preambles, short sentences and paragraphs, active voice, scannable structure, concrete instructions. |
| `iso-24495-2` | **Legal writing.** Extends the core skill for contracts, licences, and compliance text: standardised modal verbs, no legalese, named actors, structured conditional clauses. |
| `iso-24495-3` | **Science and technical writing.** Extends the core skill for documentation, architecture, and code review: progressive disclosure, exact file citations, defined acronyms. |
| `iso-24495-4` | **Organisational implementation (provisional).** A task skill for plain language gap analysis in organisations: a process-artefact sweep, a corpus audit, a five-dimension maturity model with deterministic scoring, and an append-only audit trend. Ships TypeScript tooling run with [Bun](https://bun.sh) (`bun test` covered). Based on the unpublished ISO/CD 24495-4 committee draft. |
| `iso-24495-5` | **Document design (provisional).** Extends the core skill for structuring complex documents: visual hierarchy, navigation aids, tables for comparisons, consistent visual signalling. Based on the unpublished ISO/WD 24495-5 working draft. |

The core skill activates the legal and technical extensions automatically. It triggers `iso-24495-2` for legal content and `iso-24495-3` for technical content. The document design skill activates through its own description, or on request by name.

All skills exempt internal reasoning and preserve code blocks, commands, and logs untouched. Technical and legal accuracy always supersede formatting rules.

## Installation (Claude Code)

Add this repository as a plugin marketplace, then install the plugin:

```
/plugin marketplace add <owner>/<repo>
/plugin install iso-24495-plain-language@iso-24495
```

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

This is an unofficial project. It is not affiliated with, endorsed by, or approved by the International Organization for Standardization (ISO). The skills contain original guidance inspired by the ISO 24495 series; they do not reproduce the text of any ISO standard.

Publication status of the underlying standards: Part 1 published 2023, Part 2 published August 2025, Part 3 published May 2026. Part 5 (document design) is an unpublished working draft (ISO/WD 24495-5); the `iso-24495-5` skill is provisional guidance based on its public scope and will be revised when the standard is published.

**Conformance disclaimer.** The full ISO 24495 texts are licensed and have not been consulted. These skills are built from the standards' public principles (which derive from the International Plain Language Federation's freely published framework), their published scopes and abstracts, and common plain-language practice. Every quantitative rule in this plugin (sentence length, paragraph length, legalese terms, heading depth) is this project's own proxy, not a clause of any standard. Nothing this plugin produces is a statement of ISO conformance, and no certification scheme exists for ISO 24495 in any case. "Aligned" in the skills means aligned with this plugin's interpretation of the principles, nothing more.

## Background monitor (Claude Code)

The plugin ships a background monitor (`monitors/monitors.json`) for `iso-24495-4` engagements. It stays silent unless the working directory contains `.iso-24495-4/monitor.json` naming a corpus directory:

```json
{ "corpusDir": "docs" }
```

When configured, it re-audits changed documents and notifies the agent of rule-count deltas as they happen. Without a config it waits, watching for one to appear; it never exits on its own, so the host never raises a "task ended" notification. Removing the config mid-session returns it to the waiting state. It requires Bun and is Claude Code-specific; the skills themselves work without it.

## Advisory markdown hook (Claude Code)

The plugin ships a `PostToolUse` hook (`hooks/`) that audits every markdown file Claude writes or edits, using the same rule engine as the Part 4 corpus audit. When a file carries violations, Claude receives one terse advisory line with per-rule counts; a clean file produces nothing. The hook never blocks a write.

To switch it off for a project, create `.iso-24495-4/hooks.json` containing:

```json
{ "markdownAudit": false }
```

It requires Bun and is Claude Code-specific; the skills themselves work without it.

## Releasing a new version

Installs are pinned to tagged releases: the marketplace manifest points at a `vX.Y.Z` tag, so `main` can move without affecting users. To ship a release:

1. **Bump versions together:** `plugin.json`, the plugin entry in `marketplace.json` (both `version` and the source `ref`), and every skill's `metadata.version`.
2. **Update `CHANGELOG.md`** with the changes.
3. **Merge to `main`** via pull request, then tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. **Create the GitHub release** from the tag: `gh release create vX.Y.Z --notes-from-tag` (or paste the changelog entry).
5. **Verify** a fresh `/plugin install` pulls the tag, not `main`.

Forgetting the `ref` bump in step 1 leaves users silently on the previous release.

## Roadmap

- **`iso-24495-4`:** Revise the provisional implementation skill against the published standard when ISO releases it; its committee-draft text is not public, so the maturity model is original guidance.
- **`iso-24495-5`:** Revise the provisional document design skill against the published standard when ISO releases it.

## Licence

MIT
