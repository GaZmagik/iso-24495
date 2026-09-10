// The documents this repository pins, named rather than discovered.
//
// Six versions of this file tried to work the set out: from the skills, then
// the manifests, then every component directory, then the whole repository,
// then any string in a manifest that resolved to a path. A review defeated
// each one, and the last two failed in both directions at once, missing a
// declared style whose name held two dots while pulling one machine's local
// settings into the fixture because a description happened to name a folder.
//
// The reviewer's own advice, asked for and taken: keep whole-text fixtures for
// an explicitly reviewed set, and stop reproducing packaging behaviour,
// filesystem semantics and file-format decisions. Those attempts were reaching
// past their evidence, and each repair cost about as much as it bought.
//
// So this is a list. A list can be short, and a review proved that by
// shortening one. What answers that is not a cleverer derivation but a floor
// checked separately: every skill and every manifest present must appear here,
// which fails when something arrives unlisted. The list says what is covered,
// the floor says nothing has slipped out of it, and neither pretends to know
// what a host will load.

/** Every document whose text is pinned, in a stable order. */
export const SHIPPED_DOCUMENTS: readonly string[] = [
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "codex-skills/iso-24495-style/SKILL.md",
  "codex-skills/iso-24495-style/agents/openai.yaml",
  "output-styles/iso-24495.md",
  "skills/iso-24495-1/SKILL.md",
  "skills/iso-24495-1/agents/openai.yaml",
  "skills/iso-24495-2/SKILL.md",
  "skills/iso-24495-2/agents/openai.yaml",
  "skills/iso-24495-3/SKILL.md",
  "skills/iso-24495-3/agents/openai.yaml",
  "skills/iso-24495-4/SKILL.md",
  "skills/iso-24495-4/agents/openai.yaml",
  "skills/iso-24495-4/assets/gap-report-template.md",
  "skills/iso-24495-4/references/evidence-map.md",
  "skills/iso-24495-4/references/interview-guide.md",
  "skills/iso-24495-4/references/maturity-model.md",
  "skills/iso-24495-5/SKILL.md",
  "skills/iso-24495-5/agents/openai.yaml",
  "skills/iso-24495-5/assets/adr-template.md",
  "skills/iso-24495-5/assets/design-doc-template.md",
  "skills/iso-24495-5/assets/runbook-template.md",
  "skills/iso-24495-code/SKILL.md",
  "skills/iso-24495-code/agents/openai.yaml",
  "skills/iso-24495-text-audit/SKILL.md",
  "skills/iso-24495-text-audit/agents/openai.yaml",
];
