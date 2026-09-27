# Plan 47-20 pre-edit baseline — 2026-09-25

The exact accepted, unexpired 47-14 stage lists the six paths below, `tenantActivation: disabled`, isolated-test scope, and forbids production, provider, paid and outbound use. The historical decision remains `decision: defer`. All candidate paths are pre-existing untracked worktree files; the playbook has pre-existing edits. No target bytes have been changed for this plan yet.

| Path | SHA-256 before edit | Starting git state |
| --- | --- | --- |
| `packages/backend/candidate/recurrence/schema.ts` | `80276b9742cc115c44fe0fc0ff0588aca430d22dfdcc81c45d74216430053a60` | untracked |
| `packages/backend/candidate/recurrence/model.ts` | `3317bf07665fab773a9410b7df190d740206614a774137ff56866d5e62464100` | untracked |
| `packages/backend/candidate/recurrence/model.test.ts` | `272cd6b00328013c3ecda0d72a7f72ad11a009e12370e751905998cfda6596f2` | untracked |
| `packages/backend/candidate/recurrence/tsconfig.json` | `f4bcc6cf834dbc7601af35296e14315093ca83639e1f77dbd61c3f126e863087` | untracked |
| `packages/backend/candidate/recurrence/vitest.config.mts` | `023572d21ee41e72287a616272f6079a45ac43ed0bb0a85e9d9f453ef6a4a7d8` | untracked |
| `packages/backend/candidate/recurrence/README.md` | `3bf3fdead2ee0a7e745e7fe702d33880a415028ff0fbcb58e916f15a8ad61770` | untracked |
| `docs/playbooks/knowledge-search-routines.md` | `f22dbc4fa1b7b9925dd053d107bdce5349608052062d8464d4b202c6d465daa4` | modified |

Read-only guards: 47-14 stage `cd6c993ffc3f0fee3e5d7188055811ed338271b421728b95adfbb9c0ac295e34`; ADR-046 `153412ad41ddf274799cf77019915c4d344103a6bf8fa74468e79cc0fd522b45`; ADR-050 `5872061c0c2ffa2a1e481116f884af08ac26aa3dc94856a51f451bad236a3303`; ADR-051 `d52ca4736eff665e3f1f3747a2be984f6138236347353fffbf4455c7d8ec813c`; historical decision `cc7d4a8667ba5ed9be584e059964708b14433be751ae845dd09a7bdbb775e2ce`; gate checker `e8599c09f737601940c7dc4cd1c8d14c7364e19b9643be99312560d4204d261f`. The worktree contains many unrelated pre-existing edits, preserved. The target hashes above are compare-before-edit guards.

Baseline from `packages/backend`: explicit candidate Vitest 9/9 exit 0; candidate `tsc --noEmit --project candidate/recurrence/tsconfig.json` exit 0; backend `tsc --noEmit` exit 0. With historical artifact `../../.planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md`, separate checker `--matrix`/`--eligibility`/`--validate-decision` exits 0/1/0; with stage artifact `../../.planning/phases/47-the-schedule-row-that-re-arms/47-14-STAGE-DECISION.md`, `--validate-stage` exits 0. Eligibility refuses 14 findings, including missing D1–D8 rows and missing/non-collected live DST, OAuth and provider-read evidence. An initial invocation without an artifact returned usage exit 1 and was corrected before this baseline.

## Commit-order contract for the candidate edit

The current `syntheticAttempt` awaits `rails.reserve`, commits only a status/version read, then invokes `prepare`; there is no paid-step admission or one-winner start claim. It also releases in `finally` on `retry_pending`, losing the whole-run hold.

One run-scoped reservation admission and two stable rail keys must be stored before either rail call. A transaction re-reading tenant, run and routine status/version is the pause-versus-reservation linearization point. Each keyed rail must provide reserve, outcome lookup and release; ambiguous allocate/credit results require lookup and a durable blocked state if unresolved. Confirmed both-rail hold is the only state that permits a paid step. A separate paid-step admission transaction checks the current fence and one-outstanding slot; a subsequent atomic admitted-to-start-claimed transition is the same-ID worker race winner. The landing transaction matches run, bounded step ID and token, records a closed result and clears the slot. A claimed start without a recorded result is ambiguous after restart and cannot be dispatched again. `retry_pending` retains the same hold; terminal paths reconcile/release both keys once. A pre-pause proposed plan is non-actionable after pause; synthetic external-action admission requires current fence and a distinct per-run human approval. These transactions supply the ordering claim only inside `convex-test`, never real rail or production proof.
