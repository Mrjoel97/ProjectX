# 29-13 — SUMMARY: branch-correct routine UX, and the final gates

**Status: COMPLETE. The deferred branch is built and proven in a real browser, and Task 3's owner
checkpoint was APPROVED on 2026-08-30 (§6).**

Commit: `fd71212`. Executed 2026-08-30; the two artifacts were begun by an agent that died mid-flight
(`API Error: Connection lost mid-response`) and were completed, corrected and proven by the
orchestrator.

---

## 1. The branch was PARSED, not assumed

`29-RECURRENCE-DECISION.md` carries `decision: defer`, and the gate agrees when run directly on the
real artifact:

```
node packages/backend/scripts/check-routine-gate.mjs <artifact> --matrix             -> exit 0
node packages/backend/scripts/check-routine-gate.mjs <artifact> --eligibility        -> exit 1 (13 problems)
node packages/backend/scripts/check-routine-gate.mjs <artifact> --validate-decision  -> exit 0
```

`--eligibility` refusing is the whole point: `enable-safe` requires every row `pass` with `live`
evidence on `oauth-expiry-reauth`, `dst-boundary` and `provider-read`, and none of those has a live
trace. The owner's standing ruling was "let the gate decide, fail-closed", and it did.

## 2. What was built

| File | What it is |
|---|---|
| `apps/web/app/(app)/dashboard/workflows/routineBranch.test.ts` | reads the decision artifact and asserts the branch THAT artifact selects |
| `apps/web/e2e/routines.spec.ts` | the browser half: a manual **Run again** exists, and nothing schedules, pauses, resumes or revokes |

The deferred branch means: **no `RoutineControls.tsx`, nothing mounted, no recurrence API bound, no
dependency installed, no schema or scheduler file touched.** `schema.ts`'s verbatim "There is
deliberately NO `routines` table…" comment stands.

`routineBranch.test.ts` is decision-aware rather than hard-coded to `defer` — if the decision ever
flips, the file asserts the other branch instead of quietly continuing to prove the wrong thing.
`routines.spec.ts` asserts the recorded decision FIRST, as a failing assertion rather than a skip:
going red is how a flip gets noticed.

## 3. Results, and both directions proven

```
apps/web  pnpm vitest run routineBranch        5 passed | 2 skipped   (the enable-safe branch)
apps/web  e2e/routines.spec.ts                 5 passed · PW_EXIT=0   (incl. tenant B)
```

| Probe planted | Result |
|---|---|
| `RoutineControls.tsx` in the workflows route | **3** `routineBranch` tests RED, then deleted |
| `<button>Pause schedule</button>` in `workflows/page.tsx` | browser scan RED naming it (`+ "Pause schedule"`), then reverted, rebuilt, 5/5 green |

Two full `next build` + restart cycles per direction — `@pikar/core` exports raw TS so Next bundles
it, and without a rebuild the browser tests the previous bundle.

## 4. THE SETTLE SIGNAL WAS ITSELF VACUOUS, and only the positive control caught it

The spec waited on `main.getByText("Run again")` before scanning for absence. But the pinned
surface's always-present intro reads *"Nothing starts by itself — you press **Run again**."* So the
settle matched **static copy**, fired before a single Convex query resolved, and every
`toHaveCount(0)` ran against a page still rendering "Loading your workflows…".

What refused was the scan's own positive control — `expect(names.length).toBeGreaterThan(0)` — with
**0 controls found**. Without it this would have been a green absence proof over a DOM the spec never
read: exactly the defect `workflow-pack-pilot.spec.ts`'s `@dark` block shipped, which passed with all
six packs ACTIVE because `toHaveCount(0)` succeeds on its first poll.

**Fixed by settling on a CONTROL, never on prose:** a `button` named "Pin this workflow"/"Run again",
or the empty-state sentence. None of those can render before `listPins`/`listPacks` answer.
**The rule this cost us: a settle signal must match something that CANNOT exist before the thing you
are waiting for.** And an absence proof needs TWO independent guards, because the first can be wrong
in precisely the way it was built to prevent.

## 5. Task 2 — validation

`29-VALIDATION.md` is updated with real commands and real numbers, and `29-VERIFICATION.md` records
the goal-backward read. Rules honoured: **no connected-provider, DST, OAuth or live-recurrence row is
marked green**, because none has live evidence — that absence is the basis of the `defer` verdict.

## 6. Task 3 — OWNER APPROVED, 2026-08-30

**The owner reviewed the running app and approved.** Recorded verbatim rather than paraphrased:
*"i approve and i have checked what you asked me to, you may proceed."*

What was put to them, and what the app was configured as at review time:

- sign-in at `http://127.0.0.1:3111` as the seeded owner account;
- unified knowledge search on `/dashboard/workspace` — per-source outcomes, and an unconnected
  mailbox saying so rather than reading as empty;
- `/dashboard/workflows` — the four-field closed customization schema, save, reload;
- pin a workflow and press **Run again** twice — two separate conversations, no replayed plan;
- the absence of any schedule / pause / resume / revoke control, the deferred branch's whole claim.

**The deployment was in its KEYED configuration for this review** — `PIKAR_OFFLINE_FIXTURES=1` but
both model keys present, so `offlineSeamAvailable()` was FALSE and the review exercised REAL models
at real cost, not the \$0 fixture seam. That was stated to the owner before they reviewed.

Two known conditions were disclosed in advance so they would not be read as defects found in review:
the save emits no confirmation (29-10 §3), and a saved customization reports that it is not used
(`PACK_GATE`, fail-closed).

**This approval covers the reviewed surfaces only.** It does NOT convert any of the "NOT MET" rows
below into met — in particular the synthesizer still has no live evidence, and activation/rollback
remain unreachable.

## 7. Honest gaps this phase closes WITH, carried into the record

- ~~**The synthesizer has no live evidence.**~~ **CLOSED 2026-08-30** — a document ingested through
  the real `vault.vaultIngestText` pipeline and embedded by `vaultRag:embedDoc` produced a cited
  claim and a `knowledge.synthesize` ledger row. **A new gap took its place:** the planner left
  `vault: unplanned` for an ordinary pricing question and planned the unconnected `crm-facts`, so a
  tenant document that WAS retrievable went unsearched. See 29-VERIFICATION.md, KNOW-01.
- **Activation and rollback of a tenant pack candidate are unreachable** (`PACK_GATE`, fail-closed,
  both `ownerMutation`), and a published customization is **inert** (`cockpit.ts` passes no
  `tenantSkillIds`).
- **KNOW-01 is inert on any deployment where `skills:seedSkills` has not run since Phase 29 landed** —
  the browser gate's first run failed on `NO_ACTIVE_SKILL: knowledge-query-planner` while every unit
  test passed, because `convex-test` seeds the registry inside the test.
- **The save has no completion signal** and navigating after it aborts the write (29-10 §3).
- **An unexplained serial-worker hang** in the pack isolation test (29-10 §4).
