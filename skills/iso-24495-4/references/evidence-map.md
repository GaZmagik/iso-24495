# Evidence Map

What `scripts/audit-evidence.ts` detects, and what its findings can and cannot support. The sweep records presence and paths only; judging artefact quality is the agent's job, with the human.

| Category | Detected by | Supports criteria | Does not prove |
|----------|-------------|-------------------|----------------|
| `policy` | Filenames matching plain-language-policy or style-guide | `policy-documented`, `style-guide-available` | That anyone follows it (`owner-accountable` needs a name; usage needs interview) |
| `review-workflow` | Pull request templates; review process/workflow/checklist documents | `review-step-exists` | That the step runs on every document (`signoff-gates` needs a gate definition) |
| `automated-checks` | Workflow files invoking prose linters (vale, textlint); linter configs | `checks-in-workflow` | That checks block merges, or cover all document types |
| `training` | Files under `training/` or `onboarding/` directories | `training-delivered` (partially) | That training actually ran; confirm delivery and dates in interview |
| `glossary` | Filenames matching glossary or terminology | Consistency practice (supports `style-guide-available`) | That terms are applied consistently in output |

A `found: false` in one workspace is not proof the artefact does not exist elsewhere in the organisation. Ask before concluding absence, and widen the sweep to other repositories or shared drives where the user points to them.
