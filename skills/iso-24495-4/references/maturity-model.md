# Maturity Model — Organisational Plain Language

Five dimensions, levels 0 to 4. A dimension holds a level only when every criterion at that level and below is met. Overall maturity is the weakest dimension. This table mirrors `scripts/lib/types.ts`; change both together.

| Level | Name | Meaning |
|-------|------|---------|
| 0 | Ad hoc | No defined approach; output depends on individuals. |
| 1 | Defined | Foundations exist on paper. |
| 2 | Implemented | The foundations are in active use. |
| 3 | Managed | Use is systematic and gated. |
| 4 | Sustained | Measured, championed, and continuously improved. |

## Criteria and the evidence an auditor requests

| Dimension | Level 1 | Level 2 | Level 3 | Level 4 |
|-----------|---------|---------|---------|---------|
| **Governance** | `policy-documented`: a written plain language policy exists. *Evidence: the policy file.* | `owner-accountable`: a named person owns it. *Evidence: name in the policy or org chart.* | `resourced-mandated`: time and budget are allocated. *Evidence: role descriptions, budget line.* | `executive-review-cycle`: leadership reviews it on a schedule. *Evidence: review minutes.* |
| **Capability** | `style-guide-available`: writers can reach a style guide. *Evidence: the guide and its location.* | `training-delivered`: training has run. *Evidence: materials and attendance.* | `competence-maintained`: refreshers and onboarding cover it. *Evidence: onboarding checklist.* | `roles-embedded`: plain language duties sit in job roles. *Evidence: role descriptions.* |
| **Process** | `review-step-exists`: documents get a review step. *Evidence: review template or workflow doc.* | `checks-in-workflow`: automated or checklist checks run in the workflow. *Evidence: CI config, checklist.* | `signoff-gates`: priority documents cannot ship without sign-off. *Evidence: gate definition.* | `all-document-types-covered`: the process covers every public document type. *Evidence: coverage list.* |
| **Measurement** | `corpus-baseline-taken`: a corpus audit baseline exists. *Evidence: `state.json` snapshot.* | `regular-sampling`: audits repeat on a schedule. *Evidence: two or more snapshots.* | `user-testing`: real readers test key documents. *Evidence: test reports.* | `metrics-drive-decisions`: results change practice. *Evidence: decisions citing metrics.* |
| **Culture** | `leadership-aware`: leaders know the policy exists. *Evidence: interview answer.* | `leadership-champions`: leaders visibly promote it. *Evidence: communications.* | `feedback-loops`: readers can report unclear text and someone acts. *Evidence: feedback channel and responses.* | `improvement-cycles`: lessons feed back into policy and training. *Evidence: change log.* |
