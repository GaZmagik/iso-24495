# ISO 24495 Plain Language Skills

Four [Agent Skills](https://code.claude.com/docs/en/skills) that make an AI agent write in plain language. They apply principles inspired by the ISO 24495 *Plain language* series to every user-facing response.

The skills are plain `SKILL.md` files with agent-neutral wording, so any tool that reads the Agent Skills format can use them. This repository also packages them as a Claude Code plugin, which additionally ships an **ISO 24495 output style** (`output-styles/iso-24495.md`): select it with `/output-style` to hold every response to the core plain language rules without relying on skill activation.

## Skills

| Skill | Scope |
|-------|-------|
| `iso-24495-1` | **Core principles.** Governs all user-facing output: no filler preambles, short sentences and paragraphs, active voice, scannable structure, concrete instructions. |
| `iso-24495-2` | **Legal writing.** Extends the core skill for contracts, licences, and compliance text: standardised modal verbs, no legalese, named actors, structured conditional clauses. |
| `iso-24495-3` | **Science and technical writing.** Extends the core skill for documentation, architecture, and code review: progressive disclosure, exact file citations, defined acronyms. |
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

## Roadmap

- **`iso-24495-5`:** Revise the provisional document design skill against the published standard when ISO releases it.
- **Part 4:** Out of scope. ISO/CD 24495-4 covers organisational implementation and certification of plain language processes, not writing itself, so there is nothing for an output skill to enforce.

## Licence

MIT
