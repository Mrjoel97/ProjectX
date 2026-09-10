---
phase: 21-user-authored-skills-and-routines
plan: 08
status: partial-complete
date: 2026-08-18
cost_usd: 0.00
requirements: [SKILL-01]
---

# 21-08 — the free half of the live gate: executed, except the half that cannot be

## Dated reconciliation — 2026-09-10: remains partial

`21-VERIFICATION.md` (2026-08-20) expressly verifies SKILL-01 and all three phase success criteria while retaining the absent tenant-runtime observations and missing `21-LIVE-RESULT.json`. That later verification does not complete this plan's stronger steps 3/4/6/7. The ROADMAP execution count is corrected to **7/8 complete plans**, with 21-08 partial; the requirement-level proof remains valid within its recorded boundary. Finish with a controllable real author identity, exact candidate/baseline readbacks, authorized bounded runtime calls, foreign-tenant attribution refusal, fresh-thread prompt run/delete and the required privacy scan, then validate a complete live result. Do not treat synthetic eval attribution as the author's runtime or infer fresh credentials/approval from the August record.

**Nothing was purchased.** The gate bought by 21-07 (`de976d8e`, 41/41, `$0.49466045`) was read, never
re-run. Deployment `b8c08f7d…` (local), handoff sha256 `30c9062a…` unchanged throughout.

## Executed — PASS

| Step | Evidence |
|---|---|
| Task 1 — gate intact | `compare-refs --self-check` 14/14; handoff bytes match `handoffSha256`; inspection `mismatches: []`; `compare-refs` 5/5 |
| Step 1 — non-owner refusal | `OWNER_REQUIRED`, request `c868a28876ec1d28`, as `kn735m0c…` with `owner:viewer → {isOwner:false}` captured in the same batch |
| Step 1 — invisibility | `skills:myUserSkills` `[]`, `savedPrompts:list` `[]` |
| Step 1 — state unchanged | `compare-refs` 5/5; candidate immutables NONE changed; row still `candidate` |
| Step 2 — owner activation | `active` / `passing` / `gatePassed true`; current-effective became `qx73bwsh…` v12 hash `aee0008c…` (was global v4); baseline archived; global + foreign unmoved |
| Step 5 — exact-baseline rollback | current-effective = `qx73cg6grg5gjr9tx1r3bzs5zx8ck3te` v1 hash `4b6a29f9…` active; candidate archived with hash, evidence and self-target intact; **`requiredEval: false`** |

`rollbackEligible` on the candidate flipped `false → true` at activation — the "has genuinely been
live" semantics that separates a real rollback target from a superseded draft.

## NOT executed — steps 3 and 4, and they are not deferrable

Tenant runtime attribution cannot be produced on this deployment:

1. The author tenant `kn790hj6…` is `e2e-wave6@pikar.test`, synthetic. No password exists in the repo
   (full-tree search: 22 hits, all prose), no reset flow is built, and `smoke.ts` exposes no
   entrypoint that runs the agent loop for an arbitrary tenant.
2. A specialist turn is a paid model call (`costUsd` `0.00256`…`0.0541` on sibling
   `subagent.completed` rows), contradicting the plan's truth #1.
3. The only rows attributing a run to `qx73bwsh…` belong to `eval-de976d8e` / `eval-a88a4597`, the
   harness's per-run synthetic tenants. `userSkillRuntimeAttribution` re-checks tenant equality, so
   A's query correctly returns `null`.

`21-LIVE-RESULT.json` was deliberately NOT written: it requires `authorRuntime`/`foreignRuntime`/
`promptRun`/`privacy`, and Task 3 rejects a partial object by design. Detail:
`21-LIVE-PARTIAL-2026-08-18.md`.

## Deviations from the plan

- **A second identity was created**, which the plan assumed already existed. Route: public
  `invites.requestAccess` → owner `invites.approve` at `/admin` → `/signup` redemption. `$0`.
- **Plan bug.** Task 1's verify block uses `$H` (path) and `$h` (parsed object); PowerShell variable
  names are case-insensitive, so the path is destroyed and `compare-refs` dies with ENOENT on a
  filename like `@{schema=…}`. Use distinct names.
- **Steps 6-7 (fresh-thread pin/run/delete, privacy needle scan) not run** — they sit behind the same
  checkpoint as 3-4.
- `docs/playbooks/cockpit.md` was NOT touched: no cockpit behaviour was verified this session, and
  bumping its "Last verified" would assert otherwise.

## Phase closure

All three of Phase 21's success criteria are met and were proven live (criterion 2 today). SKILL-01
is marked Complete with the runtime-attribution limit recorded on the requirement row itself.

**Structural lesson:** a phase artifact minted in a synthetic e2e tenant can never have its runtime
observed. The `$0.49` gate on `qx73bwsh…` is permanently unobservable at runtime for that reason.
