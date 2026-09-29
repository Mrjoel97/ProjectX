# Plan 47-22 pre-edit baseline — 2026-09-26

This is a byte and authority checkpoint before editing the disabled, synthetic Wave 6 recurrence candidate. It is not a D6, ROUT-02, deployment, or activation verdict. The operational decision in Phase 29 remains `defer`.

## Authority and inventory

The accepted `47-14-STAGE-DECISION.md` lists exactly six candidate paths: `schema.ts`, `model.ts`, `model.test.ts`, `tsconfig.json`, `vitest.config.mts`, and `README.md` under `packages/backend/candidate/recurrence/`. Tenant activation is disabled; production deployment, provider and paid calls, external writes and sends are forbidden. This plan may edit only the first, second, third and sixth paths. ADR-046 D3/D4/D6/D8 and ADR-050/051/052 remain binding; ADR-051 is a conditional sweep-only design, not production D6 evidence. No production sweep/caller exists for this candidate.

| Pre-edit path | Git status | SHA-256 |
| --- | --- | --- |
| `packages/backend/candidate/recurrence/schema.ts` | untracked, pre-existing | `51a3e31bc583f706b9f7b2207858cc0778dd2e8255fa85a40a2ea2d5c544b8f9` |
| `packages/backend/candidate/recurrence/model.ts` | untracked, pre-existing | `4b4c710b22c7271f29052b9e8a2743b3cf729bd2ee5d1f2ba16d799cd2a8006e` |
| `packages/backend/candidate/recurrence/model.test.ts` | untracked, pre-existing | `b8eddb3d2af89fe3dba390da93009cee148089bda43a3bed19909275d1112ef8` |
| `packages/backend/candidate/recurrence/README.md` | untracked, pre-existing | `d5d049220a3f96bb2ce21c0731105a4e2fd9f91f5bb67902e6e36b7507e33df2` |
| `docs/playbooks/knowledge-search-routines.md` | modified, pre-existing | `f4cbeb5aa4e6107019db67fff1d15b212adf135da526d940e644709cad81d124` |

These untracked files and playbook changes are existing user/worktree material, not disposable scratch. Before each edit compare the current hash with this baseline or the last plan-owned hash; preserve unrelated diff. The candidate has 25 passing Vitest cases and candidate TypeScript passes before edits. Actual gate exits, separately rerun on 2026-09-26: matrix `0`, eligibility `1` (14 explicit findings/refusal), defer decision `0`, build-for-evidence stage `0`. An eligibility refusal is expected and must not be presented as green. The current model stores `nextDueUtcMs` and next-local fields, trusts a selected expected key, and its reconciliation sweep reads only the first 16 pending rows with no durable progress. It has no due-sweep driver. These are the gaps addressed here.

| Unchanged authority path | SHA-256 |
| --- | --- |
| `47-14-STAGE-DECISION.md` | `cd6c993ffc3f0fee3e5d7188055811ed338271b421728b95adfbb9c0ac295e34` |
| `29-RECURRENCE-DECISION.md` | `cc7d4a8667ba5ed9be584e059964708b14433be751ae845dd09a7bdbb775e2ce` |
| `docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md` | `153412ad41ddf274799cf77019915c4d344103a6bf8fa74468e79cc0fd522b45` |
| `docs/decisions/050-recurrence-build-for-evidence.md` | `5872061c0c2ffa2a1e481116f884af08ac26aa3dc94856a51f451bad236a3303` |
| `docs/decisions/051-sweep-only-pause-fencing-for-recurring-routines.md` | `d52ca4736eff665e3f1f3747a2be984f6138236347353fffbf4455c7d8ec813c` |
| `docs/decisions/052-sweep-only-recurrence-d6-evidence-reconciliation.md` | `525590dc6dff1f6f9f1d42c13c1f3f565add4b3502d091e6808e66e97b760b65` |
| `packages/backend/scripts/check-routine-gate.mjs` | `444e249c20c5b13f69ebb9bb93a1cd517156828721e12087675dee9b293b67ae` |

## Synthetic contract to implement

Use the existing `nextOccurrence` and `occurrenceKey` helpers. A routine's approval/material-reapproval time is its activation anchor, so pre-approval local occurrences are never backfilled. At a sweep or claim, inspect only the bounded cadence horizon ending at `nowUtcMs` (15 local days suffices for daily/weekly rules), find the latest scheduled occurrence at or before `now`, and compare its key with `lastOccurrenceKey`. If none is eligible, return no due. If the latest is within the single `MISSED_GRACE_MS = 300000` window, claim once; otherwise record one `skipped_missed` audit and advance the key. Do not enumerate earlier occurrences into a catch-up queue. Repeated fall-back wall times share an occurrence key; a gap-shifted or skipped local date follows the core helper's IANA semantics. The claim transaction re-reads tenant/status/version/active run and recomputes occurrence; a selected key or time is only a stale-read hint.

Use finite pages (maximum 16) in separate tenant-scoped due and recovery lanes. A durable per-tenant monotonic ordinal is assigned transactionally at row creation, and each lane records its cursor and pass high-water ordinal. An index on tenant and ordinal gives stable traversal independent of mutable status and Convex `_creationTime`; the current pass stops at its waterline and wraps to a new pass, so steady insertions cannot extend the old pass forever. Each row's cursor advance commits with its claim or local recovery classification; an external keyed rail effect is reconciled before a terminal settlement, and replay after a crash is idempotent. An unresolved row records a blocked result but does not pin the cursor forever; wrapping revisits it, so later known holds cannot starve. Recovery scans pending `reconciliation_required`, interrupted `running`, and held `retry_pending` without redispatching a `start_claimed` paid step or guessing an uncertain rail. No test-only sweep is registered with a scheduler: progress requires explicit invocation, and deployed recovery liveness remains unproved.

If that contract cannot fit within the six candidate files and their tests, the implementation is NO-GO; no seventh file or production edge may be added implicitly.
