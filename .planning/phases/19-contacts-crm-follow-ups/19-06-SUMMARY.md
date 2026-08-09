---
phase: 19-contacts-crm-follow-ups
plan: 06
subsystem: action-types
tags: [action-type, arm-table, crm, plan-gate, fan-out-edit, atomicity, resumed-plan]
requires:
  - "19-02: the contacts/followUps person store this writes into"
  - "19-05: the executePlan CAS + pre-CAS gate ordering the inline arm sits above"
provides:
  - "crm_write as the FIFTH ACTION_TYPES member, on the inline arm (the arm's second occupant)"
  - "@pikar/core parseCrmOperations + CrmOperation — the pure operation-list contract, run at BOTH boundaries"
  - "contacts.ts: upsertContactRow / createFollowUpRow / setFollowUpStatusRow shared helpers + applyCrmOperations"
  - "plans.crmOperations (content plane) on the schema, on patchPlan's args, cleared by resetPlan"
  - "the cockpit CRM plan card and the Approvals badge/title/action-label trio"
affects:
  - "packages/backend/convex/approvals.ts + ApprovalsView.tsx (NOT on the plan's file list — dragged in by a COMPILE error)"
  - "packages/backend/convex/llm.ts buildAgentContext (NOT on the plan's file list — 19-08's file, kept; see the decision below)"
  - "19-08 (the staging tool that will write plans.crmOperations — patchPlan already carries the arg)"
  - "19-09/19-10 (the Pipeline page and the UAT that will eyeball the never-seen CRM card)"
tech-stack:
  added: []
  patterns:
    - "fan-out edit: every registration site in ONE commit — a partially-registered action type is worse than an unregistered one"
    - "one implementation of the write rule: public tenantMutations delegate to plain helpers the applier also calls"
    - "validate at BOTH the write and the apply boundary with ONE idempotent parser (the plan row is content plane)"
    - "all-or-none for free: a Convex mutation is one serializable transaction — asserted, not assumed"
    - "correct a stale prediction in the commit that falsifies it, in the file's own 'CORRECTED in Phase N' voice"
key-files:
  created:
    - apps/web/app/(app)/dashboard/workspace/crmCard.test.ts
  modified:
    - packages/core/src/actionType.ts
    - packages/core/src/actionType.test.ts
    - packages/core/src/contacts.ts
    - packages/core/src/contacts.test.ts
    - packages/backend/convex/cockpit.ts
    - packages/backend/convex/cockpit.test.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/plans.ts
    - packages/backend/convex/plans.test.ts
    - packages/backend/convex/contacts.ts
    - packages/backend/convex/approvals.ts
    - packages/backend/convex/llm.ts
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - apps/web/app/(app)/dashboard/approvals/ApprovalsView.tsx
    - apps/web/app/(app)/dashboard/approvals/approvalsView.test.ts
    - docs/playbooks/cockpit.md
    - docs/playbooks/contacts-crm.md
    - docs/playbooks/dashboard-pages.md
decisions:
  - "FOURTEEN registration sites, not the plan's eleven. The three the plan did not name are approvals.ts planKind, ApprovalsView's badge/title/actionLabel trio, and llm.ts buildAgentContext. Two of them are compile errors; the third is silent, which is the dangerous one."
  - "The llm.ts edit is KEPT, not reverted as scope creep into 19-08. buildAgentContext branches on the action type to tell the model what the plan IS; without the branch a CRM plan is announced to the model as an email, on this plan's own code, from the moment crm_write exists."
  - "buildAgentContext's own comment claimed it was a compile-error site. It is not, and the comment is corrected in place: PlanRow does not declare `kind` at all, so widening ACTION_TYPES never breaks the call — media proved it by shipping in Phase 20 without ever reaching that parameter union."
  - "contacts.ts's three public write mutations were refactored to one-line delegations to shared helpers the applier also calls, rather than the applier re-implementing the upsert. Three copies of the identity rule is three chances to disagree about who someone is."
  - "The follow-up text field is `note`, not the plan's `title` — 19-01 shipped `followUps.note` and the plan text pre-dates it (19-02 recorded the same correction)."
  - "applyCrmOperations UPSERTS the contact a follow-up names rather than refusing an unknown address: the human approved a card naming that address, so the row is a deliberate human act, and refusing after Approve would error on a plan the user already agreed to."
  - "The tests live in cockpit.test.ts and plans.test.ts, not the plan's cockpitTools.test.ts — the same correction 19-05 recorded: cockpitTools.test.ts contains zero executePlan tests."
metrics:
  duration: ~1h (resumed; predecessor's session was killed mid-Task-3)
  tasks: 3
  files: 19
  completed: 2026-08-09
---

# Phase 19 Plan 06: crm_write, the fifth action type Summary

`crm_write` is the `inline` arm's SECOND occupant, landed across fourteen registration sites in one
commit. Approving a CRM plan applies its whole operation list in one serializable transaction, sets
the plan `done`, seeds zero `requests` rows, needs no Gmail token, and applies nothing a second time.

**This plan was RESUMED after the first executor's session was killed.** That agent had written 871
uncommitted insertions across 15 files and created zero commits; its last output was "Now
`ApprovalsView.tsx` — the second approve surface." Nothing was discarded. This summary distinguishes
what was inherited from what was finished here.

## State at resume, and what was actually left

The predecessor's uncommitted diff was read in full and reconciled against the plan. Tasks 1 and 2
were complete and correct; Task 3 was complete for `cards.tsx` and for the `ApprovalsView.tsx` work
its last message announced. **What remained was the tail of Task 3 and the whole verification gate:**
the two playbook bumps the plan names, a third playbook the watch-gate then demanded, codegen, the
mutation check, and the full suite. No source logic was rewritten.

## The registration sites — FOURTEEN, ticked

The plan says eleven. Independently enumerating every site that switches on, validates, persists or
renders an action type found fourteen. This is the same class of finding as 19-05's "`gmail.send`
has two callers, not one", and it is now a checklist in `cockpit.md` so the next member does not
have to rediscover it.

| # | Site | Compile error? |
|---|---|---|
| 1 | `core/actionType.ts` — `ACTION_TYPES` | — |
| 2 | `core/actionType.ts` — `actionTypeOf`'s param union | — (needed for #7's widening) |
| 3 | `core/actionType.ts` — `ARMS` `satisfies Record<ActionType, Arm>` | **YES** |
| 4 | `core/actionType.test.ts` — `_COMPLETE_ARMS` + the exact-array assertion | **YES** |
| 5 | `cockpit.ts` — `_ARM_TABLE` (the second, separate bind) | **YES** |
| 6 | `cockpit.ts` — `executePlan`'s `case "inline"` body | — |
| 7 | `schema.ts` — `plans.kind` union (+ `plans.crmOperations`) | — |
| 8 | `plans.ts` — `patchPlan`'s HAND-MAINTAINED mirror (+ the `crmOperations` arg) | — (**Pitfall 1**) |
| 9 | `plans.ts` — `resetPlan` clears `crmOperations` | — (Pitfall 6 class) |
| 10 | **`approvals.ts` — `planKind`'s return union** | **YES** — *not on the plan's list* |
| 11 | **`ApprovalsView.tsx` — `ApprovalKindBadge`'s `Record<PlanKind, string>`** | **YES** (via #10) — *not on the plan's list* |
| 12 | **`ApprovalsView.tsx` — `titleFor` + `actionLabel`** | — | *not on the plan's list* |
| 13 | **`llm.ts` — `buildAgentContext`'s model-facing branch** | **NO, and it should be** — *not on the plan's list* |
| 14 | `cards.tsx` — the card branch (before the email chrome) + the `hasDraft` exclusion | — |

`EXTERNAL_TARGETS` correctly needs NO entry and could not be given one: `ExternalActionType` is
derived from `_ARM_TABLE`, so an `inline` member is excluded by construction. `dispatchGuard.test.ts`
stayed green unmodified, as the plan predicted.

### The `llm.ts` question, decided: KEEP

`packages/backend/convex/llm.ts` is on **19-08's** file list, not this plan's, so the edit had to be
judged rather than assumed. It is kept, for two reasons.

1. **It is a registration site by the definition used for the other thirteen** — it branches on
   `actionTypeOf(plan.kind)` and renders a different description of the plan. Its `memo` branch is
   the exact template. Leaving it out would not defer work to 19-08; it would ship a live defect on
   *this* plan's code, because from the moment `crm_write` exists, `buildAgentContext` falls through
   to the email branch and tells the model a CRM plan has recipients and a send mode.
2. **The edit also corrects a false claim in that file's own comment**, which belongs with the
   commit that disproves it (the same rule this plan applies to `actionType.ts`). The comment said
   branching on the shared reader made a new member "surface here as a compile error". It does not:
   `PlanRow`, the type every caller passes, does not declare `kind` at all. `media` proved it —
   Phase 20 shipped without `media` ever reaching that parameter union, so that branch has been
   quietly missing for a whole phase. The correction is now in the file and in `cockpit.md`.

19-08 will still edit `llm.ts` for the staging tool; this is 16 lines in a function it does not
otherwise touch.

## The stale prediction, corrected

`actionType.ts`'s `Arm` doc comment predicted that "Phases 18 (document creation) and 19 (CRM
writes) are the same mechanism … so they reuse this arm rather than adding a fourth". It is
superseded in place, in the file's established "CORRECTED in Phase N" voice, recording that it was
wrong about **both** phases: Phase 18 never took the arm at all (it shipped `createDocument` as a
cockpit tool with `ACTION_TYPES` still four members), and Phase 19 is `inline` because a CRM write
targets our own tables — "a single transactional write", this file's own definition three lines up.
The standing lesson is written down: *a future phase's arm is a PREDICTION until its member is in
`ARMS`. Read the table, not the prose.*

## Verification

| Check | Result |
|---|---|
| `pnpm test` (full turbo) | **9/9 tasks, run TWICE** — backend **72 files / 1391 tests**, core 697, web 105, all green, no Errors line |
| `pnpm typecheck` (full turbo) | **10/10, exit 0, delta 0** vs the measured zero baseline |
| `pnpm --filter @pikar/web build` | green |
| `node scripts/check-playbooks.mjs` | exit 0 (after the third playbook bump — see deviations) |
| **mutation check** — drop `v.literal("crm_write")` from `patchPlan`'s mirror alone | **2 RED** (`Validator error: Expected one of literal, literal, literal, got "crm_write"`), typecheck still passes — exactly Pitfall 1. Reverted. |
| `npx convex codegen` (from `packages/backend`, 180s timeout) | ran clean; `_generated/` **unchanged** — no new module, and `dataModel.d.ts` is generic over the schema |
| `biome check` on all 16 touched files | no new diagnostic (ApprovalsView's 6 and the `llm.ts`/`plans.test.ts` non-null assertions are pre-existing) |
| `graphify update .` + `extract-convex-edges` | 14577 nodes / 16610 edges, +407 convex edges, +62 table edges |

Backend test counts: 1383 (19-05) → **1391** (+6 `cockpit.test.ts`, +2 `plans.test.ts`).
Web: 103 → **105** (the new `crmCard.test.ts`). Core: 697 (+8 in `actionType`/`contacts`).

The CRM arm's tests use a **plain `convexTest` with no component registration** — which is itself an
assertion: `workflow.start` throws without the workflow component, so a regression routing a CRM
plan into the fan-out fails loudly rather than quietly seeding rows. The predecessor had already
applied 19-05's fork-crash lesson, and no crash occurred across two full runs.

## Deviations from Plan

### Auto-fixed

**1. [Rule 2 — missing critical functionality] Three registration sites the plan did not name**
- **Found during:** the independent enumeration the resume instructions required.
- **Issue:** the plan's eleven omit `approvals.ts` `planKind`, the `ApprovalsView.tsx` trio, and
  `llm.ts` `buildAgentContext`. Two are compile errors, so the plan as written could not have
  compiled; the third is silent and would have shipped.
- **Fix:** all three landed in the same commit as the rest. The predecessor had found all three; this
  resume verified them rather than discovering them.
- **Commit:** `ccad3ce`

**2. [Rule 1 — bug in a comment that would mislead the next author] `buildAgentContext` is not a
compile-error site.** Corrected in place — see the `llm.ts` decision above. **Commit:** `ccad3ce`

**3. [Rule 3 — blocking] A THIRD playbook had to be bumped**
- **Found during:** the `check-playbooks.mjs` gate, which blocked on `dashboard-pages.md`.
- **Issue:** the plan names `cockpit.md` and `contacts-crm.md`. Because the Approvals surface turned
  out to be a registration site (deviation 1), `dashboard-pages.md`'s watched paths were touched and
  the Stop hook refused the turn.
- **Fix:** a scoped entry recording that this surface is dragged in by a compile error, that
  `actionLabel` must name what Approve *does*, and that `crm_write` deliberately gets no
  "Schedule…" button.
- **Commit:** `5bce978`

### Judgement calls recorded

**One commit for all fourteen sites plus their tests, one for the playbooks.** The plan's TDD task
split would have meant re-deriving RED/GREEN boundaries from finished code, and any split of the
registration sites risks the intermediate non-exhaustive state the whole plan exists to avoid. The
uncommitted starting state made single-commit atomicity the natural outcome rather than a
constraint.

**`ROADMAP.md` is hand-edited but NOT committed.** It currently mixes a concurrent phase-25 lane's
17 uncommitted lines with this plan's one. The `19-06-PLAN.md` checkbox is ticked so the tree is
correct; committing the file would sweep in the other lane's WIP. **19-10 reconciles the roadmap.**
Likewise `graphify-out/*` was dirty before this session and is in neither commit, and no phase-25
file was touched.

**No `gsd-tools state *` subcommand was run.** Every one of them clobbers this project's STATE.md
frontmatter (drops `current_phase`, reverts `current_plan`, flips `status`). Hand-edited instead.

## Notes for the next plans

- **19-08 owns the staging tool.** `patchPlan` already accepts `kind: "crm_write"` and
  `crmOperations`, and `parseCrmOperations` is exported from `@pikar/core` — the tool should call it
  at the WRITE boundary too, not only rely on the apply-boundary re-parse. It is idempotent over its
  own output, so double-validation is safe by construction (there is a test for exactly that).
- **The agent must always name a contact on a follow-up.** `CrmOperation`'s `addFollowUp` arm carries
  a REQUIRED `email` while `contacts.createFollowUp`'s `contactId` stays optional for the human. Do
  not "helpfully" relax this in 19-08 — it is the structural brake against the CRM becoming a general
  task generator, and it is invariant 11 in `contacts-crm.md`.
- **`llm.ts` will need one more hand edit per new action type, forever**, until someone gives
  `PlanRow` a `kind` field. That is the cheapest fix and it was deliberately not done here (it would
  ripple through every `PlanRow` caller in a plan that is already a fan-out edit). Logged as the
  upgrade path in `cockpit.md` invariant 4.
- **19-10 UAT owes an eyeball to a card no human has seen:** the CRM plan card's operation lines, its
  "Approving saves all N changes to your records. Nothing is sent to anyone." line, and the
  unparseable-list fallback ("This plan's records list is incomplete…"). Also the Approvals badge
  "CRM update" and the "N changes to your records" title.
- **A CRM plan reaches `done` with no receipt in chat, deliberately.** The receipt IS the plan
  reaching `done` and the Pipeline page reflecting it; a second confirmation message is a second
  thing that can disagree with the database. If UAT reads that as "nothing happened", the fix is the
  Pipeline page, not a chat message.

## Self-Check: PASSED

- `packages/core/src/actionType.ts` — FOUND (`crm_write` in `ACTION_TYPES` and `ARMS`; the third correction present)
- `packages/core/src/contacts.ts` — FOUND (`parseCrmOperations`, `CRM_OPERATION_MAX`)
- `packages/backend/convex/cockpit.ts` — FOUND (`_ARM_TABLE` entry + the `applyCrmOperations` branch)
- `packages/backend/convex/schema.ts` — FOUND (`v.literal("crm_write")`, `crmOperations`)
- `packages/backend/convex/plans.ts` — FOUND (2 `crm_write` hits: the mirror + the `resetPlan` clear)
- `packages/backend/convex/contacts.ts` — FOUND (`applyCrmOperations` + the three shared helpers)
- `packages/backend/convex/approvals.ts` — FOUND (`planKind` widened)
- `packages/backend/convex/llm.ts` — FOUND (the `crm_write` branch + the corrected comment)
- `apps/web/.../workspace/cards.tsx` — FOUND (`data-testid="crm-plan-card"`, the `hasDraft` exclusion)
- `apps/web/.../workspace/crmCard.test.ts` — FOUND (created, 2 tests green)
- `apps/web/.../approvals/ApprovalsView.tsx` — FOUND (badge, title, `actionLabel`)
- `docs/playbooks/cockpit.md` / `contacts-crm.md` / `dashboard-pages.md` — FOUND (`19-06` in all three; `check-playbooks.mjs` exit 0)
- commits `ccad3ce`, `5bce978` — both FOUND in `git log`
