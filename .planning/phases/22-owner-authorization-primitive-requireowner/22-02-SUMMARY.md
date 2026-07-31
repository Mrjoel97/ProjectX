---
phase: 22-owner-authorization-primitive-requireowner
plan: 02
status: complete
completed: 2026-07-31
requirements: [GOVN-01]
---

# 22-02 Summary — owner-gate the four Phase-8 endpoints

All three tasks complete and green. This plan closes the standing Phase-8 owner-auth blocker
recorded in `docs/playbooks/skill-registry.md`.

## The vulnerability was documented in the source

Both files stated it in prose. `skills.ts`: *"A tenantMutation — the authenticated identity IS
the owner gate"*. `optimizerConfig.ts`: *"the authenticated identity is the owner gate"*. Those
comments are now corrected, not just the wrappers.

| Endpoint | Was | Now | What a non-owner could do before |
|---|---|---|---|
| `optimizerConfig.getOptimizerStatus` | `tenantQuery` | `ownerQuery` | Read GLOBAL optimizer state |
| `optimizerConfig.setOptimizerEnabled` | `tenantMutation` | `ownerMutation` | Disable self-improvement deployment-wide |
| `skills.activateCandidate` | `tenantMutation` | `ownerMutation` | Flip any skill live / roll back |
| `skills.candidatesForReview` | `tenantQuery` | `ownerQuery` | **Read every candidate PROMPT BODY in the deployment** |

`candidatesForReview` was the sharpest: `skills` rows are a GLOBAL registry and
`fromBody`/`toBody` are raw prompt bodies, so a tenant wrapper gated nothing meaningful.

## What was deliberately NOT changed

- **`activateSkillVersion` stays un-gated by owner.** It is the single EVAL_GATE implementation
  AND the trusted path for `internal.skills.activateSkill`, seeding, and the eval runner — all of
  which run from the scheduler with no browser identity. Moving `requireOwner` into it would break
  those callers and conflate two orthogonal questions.
- **`getConfig`/`writeConfig` stay un-gated** for the same reason (internal CI + eligibility).
- **Rollback stays evidence-exempt BY TARGET STATUS** — it must work mid-incident. It is now
  owner-*authorized* but still evidence-exempt; those are different axes.

## Evidence

- Targeted: `owner` + `optimizerConfig` + `skills` + `importGuard` — **129/129 green**.
- **Full backend suite: 53/53 files, 860/860 tests green.**
- `node scripts/check-playbooks.mjs` — pass.
- Typecheck (`--force`): **162 total, 0 in production `convex/*.ts`** — identical to 22-01, i.e.
  this plan added zero errors. (The 12 above the 150 baseline are `owner.test.ts`'s
  `Property 'owner' does not exist`, pending codegen.)
- Only other caller of the four endpoints is `apps/web/app/(app)/ops/page.tsx` — 22-03's scope.

### New tests (all negative cases anti-vacuous)

`optimizerConfig.test.ts`: non-owner read refused; refused write leaves the table ABSENT; refused
write against an existing row leaves it byte-identical; internal seams still work with no identity.
`skills.test.ts`: non-owner cannot read bodies (anchored by an owner read proving the fixture
really holds `"SECRET NEW BODY"`); non-owner activation refused with statuses unchanged **while the
candidate carries PASSING evidence** — so only the owner check stopped it; non-owner rollback
refused; owner still hits `EVAL_GATE`; internal activate still works identity-free.
`importGuard.test.ts`: a four-row named-endpoint table pinning each export to its wrapper.

## Mutation checks

**1. Downgrade an endpoint to a tenant wrapper — PASSED (turned red as required).**
`candidatesForReview` → `tenantQuery` produced exactly 2 failures: the static guard
(`skills.ts:candidatesForReview is declared with ownerQuery`) AND the behavioural test
(`a non-owner cannot read candidate BODIES`). Reverted, green.

**2. Move authorization below the write — NOT SATISFIABLE ON CONVEX. Not faked.**
The plan required this check. It was attempted verbatim: `setOptimizerEnabled` as a
`tenantMutation` with `await requireOwner(ctx)` placed *after* `writeConfig`. **All 11 optimizer
tests still passed — correctly.** Convex mutations are atomic transactions, so a throw after the
write rolls the entire transaction back and the resulting DB state is byte-identical to the
refusal case. There is no window of exposure, therefore nothing to observe, therefore no test can
distinguish the two.

The invariant that IS real is **un-skippability** — that the guard runs before the handler at all
— and that is pinned by the wrapper placement plus the static name guard. Recorded in
`docs/playbooks/authorization.md` under *"Why there is no 'check happens before the write' test"*
so a later reader does not manufacture a red by weakening a fixture.

## Notes for the next reader

- **One flake observed and resolved, not suppressed.** The first full-suite run showed
  `onboarding.test.ts:434` red (tier/persona markdown). It passes in isolation (24/24), paired with
  `tenantProfile.test.ts` (43/43), and in a clean full re-run (860/860). Three disconfirmations;
  treated as a cross-file ordering flake in that subsystem, NOT as a Phase-22 regression. If it
  recurs, it belongs to onboarding/tenantProfile, which this phase never touched.
- **The suite's total test count is not a fixed number.** `importGuard.test.ts` generates one test
  per non-exempt module from `import.meta.glob`, so transient files on disk change the total (862
  vs 860 across two otherwise-identical runs; the likely cause is leftovers from a failed
  `npx convex codegen`). This is benign — the scan is eager and exhaustive over whatever exists, so
  a new unguarded module can only ADD a test, never silently skip one.

## Playbooks

- `authorization.md` — `Last verified` bumped; added invariants 9 (independent gates) and 10 (the
  named-endpoint table) and the Convex-atomicity note.
- `skill-registry.md` — `Last verified` bumped; **Phase-8 blocker (a) marked CLOSED** with the
  independent-gates and internal-path caveats recorded. Phase 25 still owes the two-real-user
  cross-tenant assertion.
