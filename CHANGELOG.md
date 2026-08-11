# Changelog

All notable changes to the ISO 24495 Plain Language plugin. Versions follow [Semantic Versioning](https://semver.org). Installs are pinned to tagged releases via the marketplace manifest.

## [0.3.1] — 2026-08-11

### Fixed
- Background monitor primes baselines from existing corpus files when the watch starts, so pre-existing violations are no longer misreported as new changes and first-edit improvements are reported correctly (present since 0.3.0).
- Background monitor reports decreases when a corpus file is deleted, and prunes its per-file state.
- The 30-second interval now re-scans corpus content (by modification time and size), so changes hidden by a missed or filename-less watch event are reported within 30 seconds instead of lost.
- A missing or unreadable corpus root is an error again in the audit CLI instead of a clean empty audit; below the root, unreadable entries are skipped and reported to the caller.
- The monitor does not report an unreadable subtree as deletions, does not mark a priming pass complete when anything was skipped, silently primes transiently unreadable files on their first successful read, and holds the engagement when the config file is present but momentarily unparseable.
- Background monitor no longer exits when no engagement is configured. It now waits for `.iso-24495-4/monitor.json` to appear, starts watching the corpus when it does, and returns to waiting if the config is removed. This stops the host from raising a "task ended" notification at the start of every session without an engagement. A half-written or invalid config no longer kills the process.

## [0.3.0] — 2026-08-11

### Added
- `iso-24495-4` (provisional, ISO/CD 24495-4): organisational implementation task skill. Process-artefact sweep (primary evidence), corpus proxy audit (secondary, Measurement dimension only), deterministic 5×5 maturity scoring, append-only audit state with trend reporting. TypeScript on Bun, zero dependencies, 22 pinned tests.
- Background monitor (`monitors/monitors.json`): re-audits a configured corpus on change during an engagement; silent when unconfigured.
- ISO 24495 output style (`output-styles/iso-24495.md`).
- Release-gated distribution: the marketplace source pins a tagged release.

### Changed
- Core skill and output style now reference all five skills, with a negative guard so Part 4 never activates on ordinary writing tasks.
- All skills carry the plugin version in `metadata.version`.

## [0.2.0] — 2026-08-11

### Added
- `iso-24495-5` (provisional, ISO/WD 24495-5): document design extension.
- Spec-compliant `metadata` blocks (version, iso-standard, iso-status) on every skill.

### Changed
- Agent-neutral wording throughout; any Agent Skills-compatible tool can use the skills.
- Core skill auto-triggers `iso-24495-5` for complex multi-section documents.
- README corrected: Parts 2 and 3 are published (August 2025 and May 2026).

## [0.1.0] — 2026-08-11

### Added
- Initial plugin: `iso-24495-1` (core), `iso-24495-2` (legal), `iso-24495-3` (science and technical), marketplace manifest, MIT licence.
