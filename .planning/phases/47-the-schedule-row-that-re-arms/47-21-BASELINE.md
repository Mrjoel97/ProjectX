# Plan 47-21 pre-edit governance baseline — 2026-09-25

This is a draft-only checkpoint. No accepted ADR, stage, checker, test, historical decision, matrix, runtime or playbook is edited by Task 1. Proposed `docs/decisions/052-sweep-only-recurrence-d6-evidence-reconciliation.md` is absent; no other `052-` decision file was found. The `recurrence` filename token is intentional: the historical defer scan must detect this ADR until a separate exact identity exception is accepted and verified.

| Path | SHA-256 before Task 1 | Git status before Task 1 |
| --- | --- | --- |
| `docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md` | `153412ad41ddf274799cf77019915c4d344103a6bf8fa74468e79cc0fd522b45` | tracked clean |
| `docs/decisions/050-recurrence-build-for-evidence.md` | `5872061c0c2ffa2a1e481116f884af08ac26aa3dc94856a51f451bad236a3303` | untracked pre-existing |
| `docs/decisions/051-sweep-only-pause-fencing-for-recurring-routines.md` | `d52ca4736eff665e3f1f3747a2be984f6138236347353fffbf4455c7d8ec813c` | untracked pre-existing |
| `.planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md` | `cc7d4a8667ba5ed9be584e059964708b14433be751ae845dd09a7bdbb775e2ce` | tracked clean |
| `.planning/phases/47-the-schedule-row-that-re-arms/47-14-STAGE-DECISION.md` | `cd6c993ffc3f0fee3e5d7188055811ed338271b421728b95adfbb9c0ac295e34` | untracked pre-existing |
| `packages/backend/scripts/check-routine-gate.mjs` | `e8599c09f737601940c7dc4cd1c8d14c7364e19b9643be99312560d4204d261f` | tracked modified pre-existing |
| `packages/backend/convex/routineDecision.test.ts` | `a35e266981fc4cb3d1d5219dbf36ee6bff385ab6228b4e94a8216307bf9112dd` | tracked modified pre-existing |
| `docs/playbooks/knowledge-search-routines.md` | `61fb77097d4c65feb819fe2a870b69785d7563638350c616db18a7c015fc316b` | tracked modified pre-existing |
| `packages/backend/candidate/recurrence/schema.ts` | `51a3e31bc583f706b9f7b2207858cc0778dd2e8255fa85a40a2ea2d5c544b8f9` | untracked pre-existing candidate |
| `packages/backend/candidate/recurrence/model.ts` | `4b4c710b22c7271f29052b9e8a2743b3cf729bd2ee5d1f2ba16d799cd2a8006e` | untracked pre-existing candidate |
| `packages/backend/candidate/recurrence/model.test.ts` | `b8eddb3d2af89fe3dba390da93009cee148089bda43a3bed19909275d1112ef8` | untracked pre-existing candidate |
| `packages/backend/candidate/recurrence/tsconfig.json` | `f4bcc6cf834dbc7601af35296e14315093ca83639e1f77dbd61c3f126e863087` | untracked pre-existing candidate |
| `packages/backend/candidate/recurrence/vitest.config.mts` | `023572d21ee41e72287a616272f6079a45ac43ed0bb0a85e9d9f453ef6a4a7d8` | untracked pre-existing candidate |
| `packages/backend/candidate/recurrence/README.md` | `d5d049220a3f96bb2ce21c0731105a4e2fd9f91f5bb67902e6e36b7507e33df2` | untracked pre-existing candidate |

Baseline commands: `Get-FileHash -Algorithm SHA256` on each literal path; `git status --short --` scoped to the same paths; `rg --files docs/decisions | rg '(^|[/\\])052-'`. The actual four checker modes on the historical decision and accepted stage exited `--matrix 0`, `--eligibility 1` (14 findings), `--validate-decision 0`, `--validate-stage 0`. The eligibility findings include missing D1–D8 rows and missing or invalidly cited live OAuth, DST and provider-read evidence. A green stage is isolated-development authority only.

The accepted ADRs are immutable. If a later, separately owner-accepted transition is attempted, capture byte-exact backups of the *then-current* checker, test, stage and playbook in a narrowly scoped protected temporary directory, record their absolute resolved paths and hashes, compare each target to this baseline and the last observed hash immediately before editing, and stop on drift. Roll back only plan-owned bytes after a fresh compare; never use a broad checkout/reset or overwrite a concurrent change. The new ADR-052 path must still be absent immediately before creation. This baseline alone grants no Task 2 authority.
