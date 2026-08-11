# ISO 24495 Plain Language — Claude Code Plugin

Three [Agent Skills](https://code.claude.com/docs/en/skills) that make Claude write in plain language. They apply principles inspired by the ISO 24495 *Plain language* series to every user-facing response.

## Skills

| Skill | Scope |
|-------|-------|
| `iso-24495-1` | **Core principles.** Governs all user-facing output: no filler preambles, short sentences and paragraphs, active voice, scannable structure, concrete instructions. |
| `iso-24495-2` | **Legal writing.** Extends the core skill for contracts, licences, and compliance text: standardised modal verbs, no legalese, named actors, structured conditional clauses. |
| `iso-24495-3` | **Science and technical writing.** Extends the core skill for documentation, architecture, and code review: progressive disclosure, exact file citations, defined acronyms. |

The core skill activates the two extensions automatically. It triggers `iso-24495-2` for legal content and `iso-24495-3` for technical content.

All three skills exempt internal reasoning and preserve code blocks, commands, and logs untouched. Technical and legal accuracy always supersede formatting rules.

## Installation

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

Once installed, Claude loads the skills when their descriptions match the task. To apply one explicitly, ask Claude to use it by name, for example: "Apply `iso-24495-2` to this licence text."

To enforce the core skill on every response, add a line to your `CLAUDE.md`:

```markdown
- ALWAYS activate and adhere to the `iso-24495-1` Plain Language skill across all responses
```

## Disclaimer

This is an unofficial project. It is not affiliated with, endorsed by, or approved by the International Organization for Standardization (ISO). The skills contain original guidance inspired by the ISO 24495 series; they do not reproduce the text of any ISO standard. The `iso-24495-3` skill cites a 2026 edition of Part 3; treat that citation as provisional rather than settled.

## Licence

MIT
