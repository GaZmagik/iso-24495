# Changelog

All notable changes to the ISO 24495 Plain Language plugin. Versions follow [Semantic Versioning](https://semver.org). Installs are pinned to tagged releases via the marketplace manifest.

## [0.5.0] - 2026-08-12

### Added

- Part 5 now provides templates for architecture decision records, runbooks, and design documents.
- Part 5 requires the matching template before writing and defines a content-preserving restructuring workflow.
- Five shared advisory rules add `heading-skip`, `heading-style`, `acronym-undefined`, `doublet`, and `prose-enumeration`. Their concepts were studied in [lucid](https://github.com/maricastroc/lucid), but no code was copied and this implementation is independent. The rules remain project proxies rather than standard clauses.
- Corpus JSON output now carries a deterministic configuration hash covering every engine threshold.
- Plain-language checks for script comments remain deferred to a later release.

### Changed

- Sentence rules recalibrated. The engine now flags a document average above 20 words (new `sentence-average` rule, minimum sample 10 sentences) and raises the per-sentence cap from 20 to 30. Public plain-language guidance (Cutts, the Plain English Campaign, the Clear English Standard) specifies an average of 15 to 20 words rather than a per-sentence cap. The cap of 30 and the 10-sentence minimum are this project's own proxy choices, informed by measurements of local sessions whose data is not part of this repository.
- Paragraph limit relaxed from 3 sentences to 5, matching public guidance (3 to 5, with single-sentence paragraphs fine for emphasis).
- The core skill's voice rule is no longer absolute: active is the default, and passive is accepted where the actor is unknown, irrelevant, or secondary.
- The core skill and output style gain guidance the standards emphasise and the plugin lacked: the four governing principles named (relevant, findable, understandable, usable), audience-first framing, positive framing, direct address, subject-verb proximity, explicit connective words, wordy-phrase replacements, and repetition over elegant variation. Layout rules are now labelled house conventions.
- The advisory hook now audits `.md`, `.markdown`, and `.txt` files.
- Each script is now a library module with a separate logic-free entry file (`audit-corpus-cli.ts`, `watch-corpus-main.ts`, and so on). Hook and monitor commands point at the new entries. Every measured file covers 100% of lines and functions, and end-to-end tests run each entry.

### Fixed

- The background monitor now detects a change by content digest rather than by modification time and size. A correction that preserved byte length within one filesystem timestamp tick, two seconds on some filesystems, went unreported (present since 0.3.1).

## [0.4.1] - 2026-08-12

### Fixed
- Plugin installation no longer requires GitHub SSH keys. The marketplace source is now an explicit HTTPS git URL (`"source": "url"`), which keeps the release tag pin while bypassing the Claude Code installer's SSH default for `github`-type sources (reported in #9 by ArchitektApx; upstream: anthropics/claude-code#18001, #26588, #31930). Users on other affected marketplaces can set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`.

## [0.4.0] - 2026-08-11

### Added
- Advisory markdown audit hook (`hooks/`): after Claude writes or edits a `.md` file, a `PostToolUse` hook audits it with the Part 4 rule engine and feeds one terse per-rule line back as context. It never blocks a write, stays silent when the file is clean, and skips non-markdown files, `node_modules`, and `.git`. Per-project off switch: `.iso-24495-4/hooks.json` with `{"markdownAudit": false}`, anchored to the stable project root (`CLAUDE_PROJECT_DIR`) so changing directory mid-session cannot disable it; an unreadable switch file leaves the hook on. Plain-language checks for script comments are deferred to 0.5.0.

### Changed
- Conformance language tightened across the plugin: example labels renamed from "Compliant" to "Aligned", the core skill and output style now state that their quantitative rules are this project's own proxies for the standard's public principles, and the README carries an explicit conformance disclaimer. The licensed ISO texts have not been consulted; nothing the plugin produces claims ISO conformance.

## [0.3.1] - 2026-08-11

### Fixed
- Background monitor primes baselines from existing corpus files when the watch starts, so pre-existing violations are no longer misreported as new changes and first-edit improvements are reported correctly (present since 0.3.0).
- Background monitor reports decreases when a corpus file is deleted, and prunes its per-file state.
- The 30-second interval now re-scans corpus content (by modification time and size), so changes hidden by a missed or filename-less watch event are reported within 30 seconds instead of lost.
- A missing or unreadable corpus root is an error again in the audit CLI instead of a clean empty audit; below the root, unreadable entries are skipped and reported to the caller.
- Priming is per file: everything present at the first enumeration of an engagement (including subtrees that were unreadable at that moment) primes silently on first successful read, while files appearing later report as additions. A persistent unreadable entry can no longer hold the monitor in a silent mode, an unreadable subtree is never reported as deletions (suppression is scoped to the skipped paths only), and the engagement holds when the config file is present but momentarily unparseable. The audit CLI warns on stderr for each entry it had to skip.
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
