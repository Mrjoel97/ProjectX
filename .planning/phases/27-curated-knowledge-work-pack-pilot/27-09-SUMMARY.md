---
phase: 27-curated-knowledge-work-pack-pilot
plan: 09
status: partial
completed: 2026-08-23
requirements: [PACK-02, PACK-03, PACK-04]
files_modified:
  - packages/backend/convex/lib/functions.ts                        # ownerAction, DEVIATION
  - packages/backend/convex/owner.ts                                # ownsDeployment, DEVIATION
  - packages/backend/convex/cockpit.ts
  - packages/backend/convex/cockpit.test.ts
  - packages/backend/convex/skills.ts                               # deactivatePack
  - packages/backend/convex/skills.test.ts
  - packages/backend/convex/isolation.test.ts                       # DEVIATION (owner surface 19)
  - packages/backend/convex/workflowPackDiscovery.ts                # NEW
  - packages/backend/convex/workflowPackDiscovery.test.ts           # NEW
  - packages/backend/convex/workflowPackBinding.ts                  # probe extracted, no behaviour change
  - packages/core/src/workflowPacks.ts                              # title/blurb/opener
  - packages/core/src/workflowPacks.test.ts
  - apps/web/app/(app)/dashboard/workspace/WorkflowPackQuickStarts.tsx      # NEW
  - apps/web/app/(app)/dashboard/workspace/WorkflowPackPreflight.tsx        # NEW
  - apps/web/app/(app)/dashboard/workspace/workflowPackQuickStarts.test.ts  # NEW
  - apps/web/app/(app)/dashboard/workspace/workflowPackPreflight.test.ts    # NEW
  - apps/web/app/(app)/dashboard/workspace/page.tsx
  - apps/web/app/(app)/dashboard/workspace/pinnedPrompts.test.ts    # guard narrowed
  - apps/web/e2e/workflow-pack-pilot.spec.ts                        # NEW, AUTHORED AND UNRUN
  - docs/playbooks/authorization.md
  - docs/playbooks/cockpit.md
  - docs/playbooks/skill-registry.md
  - docs/playbooks/workflow-packs.md
---

# 27-09 — The discovery surface, the owner primitive, and the deadlock they had to break

## Dated reconciliation — 2026-09-10: remains partial

Later evidence retires several historical blockers below. The **2026-08-26** entries in `docs/playbooks/workflow-packs.md` record all six pilot packs active after accepted provenance/eval/browser gates, rollback-to-dark from the owner control (`36c7b8d`), and a real Brand Review v4-to-v3 browser rollback that left the pack offered (`12ea37c`). The quota, absent owner control, and missing rollback statements below describe August 23, not the current implementation.

They do **not** finish Task 2's stronger browser protocol. The same later playbook explicitly bounds browser evidence to each candidate card/preflight/enabled control at 1440 and 390 plus **one** real Preview press; it expressly does not claim every pack ran in the browser. The plan requires each candidate's positive and partial/refused paths, approval edit/reject, injection, and telemetry privacy through owner preview. No complete per-pack record of that protocol or explicit per-candidate Task 3 review decision was located in this bounded reconciliation. Accepted lifecycle gates cannot supply those missing observations. Keep this plan partial and Phase 27 at **8/9** until those records exist or an explicit, recorded scope amendment changes the requirement. Current provider/candidate versions need their own exact-version evidence; the historical activation is not reusable certification. No live action was taken here.

**Tasks 1 and the server half of Task 2 are complete. Tasks 3 and 4 are not started, and cannot
be until the six paid eval runs happen** (27-08's blocker: the dev key's OpenAI balance is
exhausted). Everything below cost **$0.00** and nothing is activated. All six packs are still
`candidate` on dev, and the product proves it: `listPacks` returns nothing.

## The finding that had to be resolved before any of it

**27-09 as planned is a deadlock.** The pack activation gate requires browser evidence; browser
evidence requires running the pack in a browser; running it requires an ACTIVE registry row —
which no pack has, by design, until the gate passes. `runSpecialistTurn` fails closed on
`NO_ACTIVE_SKILL`, so the gate could never be satisfied by anyone.

The plan's RE-PLAN item 1 flags this, but against `sendCockpitMessage`. **The real door is
`cockpit.startWorkflowPack`, which 27-07 added after the plan was written** — and that made the
fix far smaller than the plan feared: `runWorkflowPack` already accepts `skillVersions`, so
`llm.ts` is byte-unchanged and no signature in the agent loop moved.

## Open RE-PLAN items, as resolved

1. **Candidate preview: THREADED, not cut.** Owner-only `previewVersion` on `startWorkflowPack`,
   checked server-side, checked ONLY when supplied (that action is every user's door to a pack),
   and REFUSED rather than ignored — silently dropping it would run the active row while the
   caller believed a candidate ran.
2. **Rollback: `deactivatePack` shipped, drills NOT run.** Both are recorded as owed, with the
   reason, in the spec's `@drill` block. See *What is not done*.
3. **`convex run` signs the browser out: resolved by (b), partially.** The mutation exists so the
   dark path need not use the CLI — but it is an `ownerMutation` and `convex run` carries no
   identity, so it is **not reachable from anywhere yet**. Stated, not papered over.
4. **Six packs, not three** — unchanged, owner decision A.

## Decisions the next session must carry

1. **`ownerAction` now exists, and the comment saying it deliberately did not was wrong.** "An
   action has no `ctx.db`" is true; "so it cannot read the row" is not — the read moves into
   `owner.ownsDeployment`, an `internalQuery` applying the same exact-`true` rule. Two surfaces:
   `requireOwnerAction(ctx)` for a CONDITIONAL gate (the first consumer), `ownerAction` for a
   whole owner-only action. The asymmetry was not free: having two of the three wrappers is
   exactly why this check had nowhere to go.
2. **`listPacks` is ACTIVE-ONLY on the SERVER.** No client filter, no `showCandidates` prop — a
   filter in the browser is a filter a future caller can pass `false` to.
3. **The probe moved out of the `"use node"` binding** into `workflowPackDiscovery.ts`, so the
   preflight a user is shown and the preflight the model is told are one resolution. The binding
   is otherwise unchanged and its 31 tests are untouched.
4. **`title` / `blurb` / `opener` are code-owned in `@pikar/core`.** The opener is sent as the
   USER's first message — pressing Start IS the request — and a test refuses one that reads like
   an instruction to a model, which would put a second prompt outside the registry (§5).
5. **The `useAction(` ban is now conditional.** `startWorkflowPack` takes no `clientContext`, so
   a hook around it protects nothing — but the exemption is tied to that fact, and the day the
   argument appears the test demands a hook.

## What is not done, and why

- **Task 3 (owner decides each pack) and Task 4 (activation).** Both require eval evidence, which
  requires the six paid runs, which require an OpenAI balance.
- **Both rollback drills.** `deactivatePack` is an `ownerMutation`, and `convex run` has no
  identity — so the dark drill needs an owner-facing **Turn off** control in the workspace, which
  this plan did not ship. Rollback-to-prior-version needs a second activated version, which no
  pack has while the pilot is dark. Recorded as `test.fixme` with the reason, not faked.
- **`apps/web/e2e/workflow-pack-pilot.spec.ts` has NEVER BEEN RUN.** It is authored against a
  deployment with no model balance and says so in its own header. `@dark` and `@discovery` are
  free and should be run first; `@run` spends. Do not read it as coverage.
- **The pack path still sends no `clientContext`.** Bounded: `briefInbox` is the only granted pack
  tool that reads a clock and it degrades to UTC, which `llm.ts` documents as cosmetic
  (`replyToMessage` does not read one). Threading it would change `runSpecialistTurn`'s signature.

## Near-misses worth keeping

- The conditional `useAction` guard first took the WRONG branch: slicing `cockpit.ts` from
  `startWorkflowPack` to `executePlan` swallowed `sendCockpitMessage`, which does take
  `clientContext`. It would have permanently demanded a hook nobody needs. Anchored to the next
  export instead, and proven in both directions.
- `isolation.test.ts` discovered `deactivatePack` on its own and refused to let it be called with
  `{}` — the owner surface is pinned at 19 now. Its fixture uses a REAL pack name, because
  `NOT_A_PACK` fires after the owner wrapper and a bogus name would pass while proving nothing.

## Evidence

- **backend 100 files / 2475 · web 34 / 586 · core 43 / 1177 · contracts 6 / 93.**
- Four typechecks clean; `biome ci` zero errors over all twelve touched source files.
- Mutations observed RED and restored: deleting the preview owner gate (2 tests); MOVING it after
  the thread/plan creation; `listPacks` reading `.first()` instead of exact-`active` (3 tests);
  adding `clientContext` to `startWorkflowPack` (the conditional guard flips).
- One `media.test.ts` failure appeared mid-run and is the intermittent flake 27-07 recorded; it
  passed alone and on the next full run.
