---
phase: 17-calendar-actions
plan: 05
subsystem: calendar-management-substrate
tags: [convex, schema, action-type, closed-union, test-gate, gap-closure, inert-seam]

requires:
  - phase: 17-calendar-actions
    plan: 01
    provides: calendar_event action type, externalAction arm, staged-event plan fields, trace literals, calendar card
  - phase: 17-calendar-actions
    plan: 04
    provides: Approve-only Calendar execution through the action retrier
provides:
  - A bounded, attributable Calendar behavior gate (scripts/run-calendar-test-gate.mjs)
  - "@pikar/core/calendarManagement: closed provider/operation unions, desired-state diffing, a bounded failure vocabulary, and the pre-provider manageability gate"
  - calendar_manage as the seventh ACTION_TYPES member and the externalAction arm's third occupant
  - "calendarEvents: a durable tenant-scoped managed-event registry that survives resetPlan"
  - "microsoftCalendarTokens: the Graph grant store (schema only; nothing writes it)"
  - Five reset-safe calendar_manage proposal fields with a content/ref-plane boundary on patchPlan
  - A loudly-inert EXTERNAL_TARGETS.calendar_manage stub for Plan 17-08 to replace
  - Two reserved agentSteps trace literals and their VERB pairs for Plan 17-09
  - A calendar-management review card with operation-specific Approve labels
affects: [ACTN-02, 17-06, 17-07, 17-08, 17-09, cockpit-execution, approvals-surface]

tech-stack:
  added: []
  patterns:
    - A wall-clock test gate that asserts exit code, positive test count and pass-count equality, and diagnoses a timeout rather than converting it to a pass
    - An arm-bound but intentionally unreachable EXTERNAL_TARGETS member, replaced atomically by the plan that wires it
    - The plan row is the reset-able PROPOSAL plane; a durable table is the FACT plane

key-files:
  created:
    - scripts/run-calendar-test-gate.mjs
    - packages/core/src/calendarManagement.ts
    - packages/core/src/calendarManagement.test.ts
    - .planning/phases/17-calendar-actions/17-05-SUMMARY.md
  modified:
    - packages/core/src/actionType.ts
    - packages/core/src/actionType.test.ts
    - packages/core/src/index.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/plans.ts
    - packages/backend/convex/plans.test.ts
    - packages/backend/convex/cockpit.ts
    - packages/backend/convex/cockpit.test.ts
    - packages/backend/convex/calendar.test.ts
    - packages/backend/convex/traceParity.test.ts
    - packages/backend/convex/llm.ts
    - packages/backend/convex/approvals.ts
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - apps/web/app/(app)/dashboard/approvals/ApprovalsView.tsx
    - docs/playbooks/watch.json
    - docs/playbooks/cockpit.md
    - .planning/phases/17-calendar-actions/deferred-items.md

key-decisions:
  - "calendar_manage is a NEW action type, not a repurposed calendar_event: create has no concurrency problem, management does."
  - "One action type covers both providers and both operations; the provider and the operation are closed FIELDS on the plan row."
  - "An absent calendarProvider MEANS GOOGLE, so no Phase-17 create row needs a migration or a backfill."
  - "delete never uses the provider cancellation endpoints (Google sendUpdates, Graph /cancel) — they email attendees outside plan/audit/DLQ."
  - "patchPlan stages provider/operation/managed-event-id ONLY; calendarExpectedEtag and calendarFailureCode are deliberately not args."
  - "The managed-event registry is a table, not more plans columns, because resetPlan must clear a proposal without erasing a real calendar fact."
  - "The 2026-08-10 verifier's Calendar timeouts did not reproduce and are recorded as environmental; no test-lifecycle change was made."

patterns-established:
  - "A gap-closure wave-1 plan binds the arm and ships an EXPLICITLY THROWING target, so the four waves after it compile without any of them shipping a half-wired provider call."
  - "Card-ordering is a testable property: a review branch after the email chrome is dead code, and traceParity asserts the index."

requirements-completed: []

duration: 1h 3m
completed: 2026-08-11
---

# Phase 17 Plan 05: `calendar_manage` Substrate Summary

**`calendar_manage` is now a compile-bound, persistence-complete and deliberately unexecutable
seventh action type: closed provider/operation contracts in `@pikar/core`, a durable tenant-scoped
`calendarEvents` registry that survives `resetPlan`, five reset-safe proposal fields with a
model-proof etag boundary, a review card with operation-specific Approve labels, and a
`EXTERNAL_TARGETS` member that throws `calendar manage not wired (17-08)`.**

## ACTN-02 IS STILL NOT SATISFIED

`17-VERIFICATION.md` (2026-08-10, `status: gaps_found`) records two requirement-blocking gaps:
**G1** — no Microsoft/Outlook adapter, grant, action type or terminal; **G2** — no update, move,
cancel, delete, ETag, `If-Match` or 412-concurrency path. **This plan closes neither.** It adds no
HTTP call, no OAuth flow and no provider write. The shipped Google create path is byte-unchanged in
behaviour and remains the only executable Calendar target.

## Performance

- **Duration:** 1h 3m (started 2026-08-11T01:16Z, completed 2026-08-11T02:19Z)
- **Tasks:** 3/3
- **Commits:** 3 owned + 1 foreign (see the shared-tree incident)
- **Cost:** $0.00. No model call, no eval gate, no paid API.

## Measured Evidence

Every number below is from a run on this working tree, not carried forward.

| Gate | Result |
|---|---|
| `node scripts/run-calendar-test-gate.mjs --timeout-ms 45000 --test-timeout-ms 20000 --hook-timeout-ms 10000 -- convex/calendar.test.ts` | **PASS — `CALENDAR_GATE_PASS total=39 passed=39 elapsedMs=12469`** |
| `packages/core` full suite | **PASS — 36 files, 842/842** |
| `packages/backend` full suite | **PASS — 73 files, 1596/1596, 115.15 s** |
| `packages/backend`: `traceParity + plans + cockpit + dispatchGuard` | **PASS — 4 files, 116/116** |
| `packages/core`: `calendarManagement + actionType` | **PASS — 2 files, 43/43** |
| `pnpm --filter @pikar/core typecheck` | **PASS — 0 diagnostics** |
| `packages/backend: npx tsc --noEmit` | **PASS — 0 diagnostics, including test files** |
| `pnpm --filter @pikar/web typecheck` | **PASS — 0 diagnostics** |
| `node scripts/check-playbooks.mjs check` | **PASS — exit 0** |
| Biome, all 15 touched files | **No new diagnostic.** Every shared file has the same count as at HEAD (2 each, the repo-wide CRLF-vs-LF formatter red); the three new files are 0. |

### The 17-VERIFICATION G4 timeout did NOT reproduce

The verifier recorded three Calendar runs emitting no result: 66.2 s, 71.8 s, 55.3 s. At HEAD:

| Run | Result |
|---|---|
| Warm cache, direct vitest | 35/35 in **24.4 s** wall clock |
| Cold cache (`node_modules/.vite` deleted) | 35/35 in **27.7 s** |
| Through the new gate, warm | 39/39 in **9.6–14.5 s** |

No unbounded promise, no leaked timer and no undrained scheduler was found. **`calendar.test.ts`'s
production and lifecycle code was not changed** — per the plan's own instruction, the earlier
timeouts are recorded as environmental and no timeout regression test was invented for a defect
that does not exist. The four registry tests added to that file are Task 2's, not Task 1's.

**The gate's own failure modes were exercised, not assumed:**

| Planted condition | Gate result |
|---|---|
| `--timeout-ms 3000` against a ~13 s file | `CALENDAR_GATE_FAIL timeout after 3050ms (budget 3000ms)`, exit 1 |
| A spec matching no file | `vitest exited 1`, exit 1 |
| Unknown flag `--wat` | `unknown argument: --wat`, exit 1 |
| `--timeout-ms` omitted | `--timeout-ms is required (the wall clock IS the gate)`, exit 1 |
| No spec after `--` | `no test spec given`, exit 1 |
| `await new Promise(() => {})` planted in `calendar.test.ts` | **`[5034.1631ms] PLANTED never-resolving provider response`** — failed by the PER-TEST timeout with the test NAMED, not by the outer wall clock. Restored byte-exact (`diff -q` clean). |

That last row is the plan's Task-1 behavior clause, and it forced a real change: the first version
of the gate deleted the JSON report before reporting, so a hang printed only `vitest exited 1`. The
report is now parsed before the exit-code assertion, and each failure carries its own duration —
Vitest's JSON reporter renders a timeout as the useless string `Error: STACK_TRACE_ERROR`, so the
duration is the only machine-readable evidence that a test hung rather than asserted.

## Anchor Drift Report

Every `file:line` citation in `17-05-PLAN.md`, `17-RESEARCH.md` and `17-VERIFICATION.md` was
resolved against HEAD before any edit.

| Citation | Source | State at HEAD | Action |
|---|---|---|---|
| `_ARM_TABLE` at `cockpit.ts:505` | 17-RESEARCH §Pattern 2 | **MOVED to `:573`** (+68) | Anchored on the table's text, not the line |
| `assertNever` default at `cockpit.ts:556-557` | 17-RESEARCH | **MOVED to `:846-847`** | ditto |
| `cockpit.ts:496-505` (the gmail-fan-out comment) | 17-RESEARCH, `actionType.ts` | **MOVED to `:564-572`** | ditto |
| `_ARM_TABLE` bind at `cockpit.ts:581`, `ExternalActionType` at `:588` | `cockpit.md` (finance entry, 2026-08-10) | **MOVED to `:588` / `:594`** (+7/+6) | Playbook line refs are stale; the file is 7 lines longer since that entry |
| `actionType.ts:27` (`ARMS … satisfies`) | 17-RESEARCH | **MOVED to `:83`** | ditto |
| `actionType.ts:13` (`actionTypeOf` param) | 17-RESEARCH | **MOVED to `:20-22`** | ditto |
| `actionType.ts:15-20` "workflow = … calendar in Phase 17" | 17-CONTEXT D2 | **DEAD.** 20-07 rewrote that comment; the "calendar in Phase 17" promise is gone and the block now carries three recorded corrections | Added a FOURTH correction rather than rewriting |
| `actionType.ts:21` (`inline` = "a single transactional write") | 17-RESEARCH | **MOVED to `:25`**; still true | Cited as-is |
| `schema.ts:246` `kind: v.optional(v.literal("memo"))` | 17-RESEARCH | **DEAD.** Already a five-member `v.union` at `:376-384` | Widened the union to six |
| `schema.ts:217-222` (`plans.sendAt`) | 17-RESEARCH | **MOVED**; `plans` now starts at `:248` | Rule cited, line not |
| `schema.ts:411-415` / `:439-446` / `:460-464` (`agentSteps`) | traceParity.test.ts header, 17-RESEARCH | **MOVED**; `agentSteps` starts at `:734` | Anchored on `tool: v.union(` |
| `schema.ts:548-555` (`gmailTokens`) | 17-RESEARCH | **MOVED to `:959-967`** | ditto |
| `cards.tsx:1107` (the `VERB` map) | 17-RESEARCH, 17-CONTEXT | **MOVED to `:1725`** | ditto |
| `cards.tsx:622` (the Calendar card) | 17-VERIFICATION `:53,101` | **CORRECT at HEAD** | — |
| `cockpit.ts:626-631` (the Calendar retrier callsite) | 17-VERIFICATION `:42,53,80` | **CORRECT at HEAD** | — |
| `actionType.ts:75` (`calendar_event` → `externalAction`) | 17-VERIFICATION `:42` | **CORRECT at HEAD** | — |
| `calendar.test.ts:794` (the isolation group) | 17-VERIFICATION `:55,97` | **CORRECT at HEAD** | — |
| `dispatchGuard.test.ts:95` (`executePlan` is a `tenantMutation`) | 17-RESEARCH, `actionType.ts` | **CORRECT at HEAD** | — |
| `traceParity.test.ts:61` | 17-VERIFICATION `:104` | **CORRECT at HEAD** | — |

### Claims in the plan that were FALSE at HEAD

1. **"the 2026-08-10 verifier observed repeated 55–72 second timeouts"** — true as history, false as
   a current condition. `calendar.test.ts` passes cold and warm at HEAD. The plan anticipated this
   and its conditional branch ("if the file passes before a change, record the earlier verifier
   timeouts as environmental") is the branch that was taken.
2. **The plan's `files_modified` list is incomplete.** Widening `plans.kind` is a compile event in
   three files the plan does not name: `approvals.ts`, `llm.ts` and `ApprovalsView.tsx`. See
   Deviations.
3. **17-RESEARCH Open Question 4 recommends "optional fields on `plans`" over a new table.** That
   recommendation is correct for CREATE and wrong for MANAGEMENT, and 17-05-PLAN overrides it. The
   reason is `resetPlan`: a real calendar fact must not be erased by a composition reset.
4. **Nothing in `17-05-PLAN.md` would have deleted a guard added since it was authored.** Every
   anchor was located by text and every edit was purely additive. No conjunct, guard or assertion
   was removed anywhere in this plan.

## Mutation Ledger

Every mutation was applied, observed RED with the verbatim message, restored from a byte-exact copy
and confirmed with `diff -q` plus a re-run.

| # | Mutation | Applied as worded? | RED observation (verbatim) | Restored |
|---|---|---|---|---|
| 1 | map `calendar_manage` to `inline` | Yes — `ARMS` in `actionType.ts` | `actionType.test.ts` 1 failed / 15 passed: `AssertionError: expected 'inline' to be 'externalAction'` on *"calendar_manage executes as an externalAction — the arm now has THREE occupants"* | `diff -q` clean; 43/43 |
| 2 | drop `tenantId` from the registry composite lookup | **Behavioural equivalent** — see note | `calendar.test.ts` 1 failed / 38 skipped: `Error: unique() query returned more than one result from table calendarEvents` on *"two tenants may hold the SAME provider event id and neither lookup crosses"* | `diff -q` clean on BOTH files; 39/39 |
| 3 | leave `calendarExpectedEtag` out of `resetPlan` | Yes | `plans.test.ts` 1 failed: `AssertionError: expected 'W/"3"' to be undefined` on *"resetPlan clears ALL FIVE proposal fields and the kind"* | `diff -q` clean; 27/27 |
| 4 | remove one of the two new VERB keys | Yes — `proposeCalendarChange` | `traceParity.test.ts` **2** failed: *"agentSteps.tool literals with no VERB entry … proposeCalendarChange"* and *"proposeCalendarChange is missing from cards.tsx VERB"* | `diff -q` clean; 7/7 |
| 5 | render the calendar-management branch after email chrome | Yes — branch relocated below `PlanCard` | `traceParity.test.ts` 1 failed: *"the calendar_manage branch sits after the email chrome — the email return fires first, so the management card is unreachable: expected 34023 to be less than 30098"* | `diff -q` clean; 7/7 |

**Mutation 2 could not be applied as literally worded.** A Convex index query must `.eq()` its
prefix fields in declaration order, so removing `tenantId` from the index without also removing the
`.eq("tenantId", …)` from the query does not compile — the index and the call site are one lookup.
Both halves were edited together and restored together, and both files were `diff -q` verified.

### Two further mutations, run because the tests they guard are this plan's central claims

| Mutation | RED observation | Restored |
|---|---|---|
| Replace the `EXTERNAL_TARGETS.calendar_manage` throw with `Promise.resolve("run_stub")` | `cockpit.test.ts`: `AssertionError: promise resolved "{ ok: true }" instead of rejecting` on *"a manually seeded calendar_manage plan throws loudly and starts nothing"* | `diff -q` clean; 67/67 |
| Add `calendarExpectedEtag` as a `patchPlan` arg | `plans.test.ts`: `AssertionError: promise resolved "null" instead of rejecting` on *"patchPlan REFUSES the etag, the failure code, the provider id and the run id"* | `diff -q` clean; 27/27 |

### One test was a defect on first write, and the compiler caught it

`patchPlan REFUSES …` was originally a `test.each` over field NAMES using a computed key
(`{ planId, [field]: value }`). It passed. It was **wrong**: a computed key widens the object type,
so TypeScript raised no error, the `@ts-expect-error` reported itself unused (`TS2578`), and the
compile half of the assertion had silently evaporated. Rewritten as four literal keys, each with its
own real `@ts-expect-error`. This is the fifth instance of "a green result is a bug in the test" in
this branch's recent history and it is recorded in the file's own comment.

## Deviations from Plan

### [Rule 3 — Blocking] Three compile sites outside `files_modified`

**Found during:** Task 2, at the first backend typecheck after widening `plans.kind`.

Widening the schema union is a compile event in files the plan does not list. Each one is a guard
that fired exactly as its own comment predicted:

| File | Error | Fix |
|---|---|---|
| `packages/backend/convex/approvals.ts:41` | `TS2322` — `planKind`'s return union rejects `"calendar_manage"`. Its own comment says *"Widening `plans.kind` fails to compile HERE first (19-06 added `crm_write`), which is what drags the second approve surface into the same commit."* | Added the member to the return union |
| `packages/backend/convex/llm.ts` (4 call sites, 2 declarations) | `TS2322` at `:1691`, `:4497`, `:4645`, `:4734` — `Doc<"plans">` no longer assignable to `PlanRow`. Its own comment says *"widening `ACTION_TYPES` and this line without widening that one is now an assignability error at the call site … it exists for the NEXT action type."* | Widened both `kind` unions, keeping them identical as that comment requires |
| `apps/web/.../approvals/ApprovalsView.tsx:153` | `TS2741` — `Record<PlanKind, string>` is exhaustive | Added the `calendar_manage` badge label |

**Commit:** `d17ab1d`. **Verification:** three typechecks at 0 diagnostics; backend 1596/1596.

### [Rule 2 — Missing critical functionality] Two honest labels on the Approvals surface

**Found during:** the same edit. `ApprovalsView.tsx`'s `actionLabel` falls through to
**"Approve & send"** and `titleFor` to **`plan.subject || "Email plan"`**. Neither is forced by the
compiler, and both would put an outright lie on the second approve surface the moment 17-09 lands —
approving a calendar deletion under a button that promises an email. Added
`"Approve calendar change"` and an operation-derived title read off `plan.calendarOperation`.

**Commit:** `d17ab1d`.

### [Rule 3 — Blocking] `traceParity.test.ts`'s branch extractor was EOL-blind

**Found during:** Task 3. A literal `"\n  }\n"` closer found nothing — `cards.tsx` is CRLF in this
working tree and LF in the index. Three tests errored with *"calendar_manage branch has no closer"*.
Replaced with `/\r?\n {2}\}\r?\n/`. This is the CRLF hazard this repo has recorded before, in a new
place. **Commit:** `a14e5aa`.

### [Rule 1 — Bug] A `readonly` tuple broke the web typecheck

**Found during:** Task 3. `as const` on the changes array narrowed element 0 to its literal type, so
the type predicate `row is readonly [string, string]` was not assignable. Widened the assertion.
**Commit:** `a14e5aa`.

### Not a deviation, but a scope note

`packages/backend/convex/calendar.test.ts` and `packages/backend/convex/schema.ts` appear in more
than one task's file list. The Task-1 commit touches **neither** — Task 1 changed no test and no
production file, which is its own strongest result.

## Shared-Tree Incident

**The `docs/playbooks/cockpit.md` edit was committed by another lane.** Commit `3166544`
(`docs(21-04): the two independent gates, exact-id owner transaction, rollback eligibility`,
2026-08-11 02:10:49) contains all 118 lines of this plan's playbook section. The sibling lane staged
the whole file between its own `--stat` check and its `git commit -- <paths>`, and this lane's edit
was in the working tree at that moment.

- **Nothing was lost.** `git merge-base --is-ancestor 3166544 HEAD` → yes; the text is byte-identical
  to what was written.
- **History was NOT rewritten.** A rewrite in a tree with concurrent lanes is the more destructive
  act, and a foreign lane's commit is not this lane's to amend.
- **It is recorded in the file**, in the entry's own "Provenance, recorded rather than tidied"
  paragraph and in an HTML comment separator, so a later reader is not misled by `git blame`.
- Commit `a14e5aa` carries the follow-up correction to that entry (its "supersedes" sentence pointed
  at the wrong paragraph once 21-04's bump landed between them) plus `watch.json`.
- No other file of this lane was swept. `watch.json`, `cards.tsx`, `schema.ts` and
  `traceParity.test.ts` were verified still-dirty and were committed by this lane.

`docs/playbooks/watch.json` also arrived pre-modified: a hook or a concurrent session had already
registered `packages/core/src/calendarManagement.ts` and its test under `cockpit.md` and reformatted
the `_unassigned` array. The registration was kept (it is what Task 3 required),
`scripts/run-calendar-test-gate.mjs` was added beside it, and the cosmetic reformat was reverted to
keep the diff to two lines.

## Commits

| # | Hash | Subject |
|---|---|---|
| 1 | `185802c` | `test(17-05): bound the Calendar behavior gate so a hang is named, not silent` |
| 2 | `d17ab1d` | `feat(17-05): the calendar_manage substrate — closed contracts, registry, inert target` |
| 3 | `a14e5aa` | `feat(17-05): the calendar-management review card, trace parity and playbook` |
| 4 | `77ab742` | `docs(17-05): the calendar_manage substrate plan, summary and deferred items` |
| 5 | `e4f9aab` | `style(17-05): biome-format the calendar test gate` (formatting only; re-verified 39/39) |
| — | `3166544` | **Foreign.** `docs(21-04)` — carries this plan's `cockpit.md` section; see above |

All owned commits verified with `git merge-base --is-ancestor <sha> HEAD` immediately after
each commit and again at the end of the plan. None fell out.

## NOT DONE AND NOT CLAIMED

This section is the honest inverse of the one above. Nothing here was attempted.

1. **ACTN-02 is not satisfied and must stay unchecked.** G1 (Microsoft) and G2 (event management)
   are both open. This plan added **zero** provider HTTP calls.
2. **`calendar_manage` is not executable.** `EXTERNAL_TARGETS.calendar_manage` throws. Approving such
   a plan raises `calendar manage not wired (17-08)` and the mutation rolls back.
3. **`calendarEvents` is empty and nothing writes it.** No create landing, no legacy backfill, no
   listing query. 17-08 and 17-09 own those.
4. **`microsoftCalendarTokens` is empty and nothing writes it.** No Microsoft OAuth flow, no
   authorize URL, no callback, no scope constant, no refresh. 17-06 owns all of it.
5. **No `If-Match`, no 412 handling, no ETag round-trip exists.** `calendarExpectedEtag` is a column
   with no writer and no reader. The Graph event-specific stale-PATCH/DELETE capability probe that
   17-VALIDATION makes Wave 3 depend on has **not** been run.
6. **No tool can stage a `calendar_manage` plan.** `listManagedCalendarEvents` and
   `proposeCalendarChange` are trace literals and VERB labels with no tool behind them. Everything
   in this plan that touches management is reachable only from a hand-seeded row.
7. **The management card cannot name the original event.** It renders the managed-event *reference*,
   the provider, the operation and the staged "New …" values. `PlanCard` receives only the plan row;
   the original title and time live in the registry. Reconstructing an "original" from the desired
   state would be provenance laundering, so it is not done. 17-09-03 owns the registry-backed card.
8. **`buildAgentContext` has no `calendar_manage` branch — and none for `calendar_event` either.**
   That is a PRE-EXISTING gap since 17-01: a staged Calendar plan is described to the model under
   "Current email plan:". Out of this plan's write set; logged in `deferred-items.md`; 17-09 must fix
   it in the same commit as its staging tool.
9. **No browser, no live deployment, no OAuth consent, no UAT.** The card was verified by source
   scan and typecheck only. `apps/web`'s vitest config is node-only with no jsdom, which
   `crmCard.test.ts` records as a deliberate ceiling. **There is a clock-plane precedent in exactly
   this subsystem** — a cockpit tool param that passed unit, SMOKE and eval while refusing live —
   so no live claim is made here. No tool param was added by this plan, so that specific two-seam
   risk is not present.
10. **The eval gate was NOT run** (standing do-not-rerun order; last full attempt exit 124 at
    1808.1 s). No skill body was edited, so `skillBodies.test.ts`'s no-drift list is not implicated.
    Not even `--self-check` was needed.
11. **`ROADMAP.md`'s `[x]` for Phase 17 is FALSE and was not touched.** See State handoff.

## State handoff

**Nothing in `.planning/` beyond this summary and `deferred-items.md` was modified.** The following
is what would otherwise have been written, handed to the orchestrator:

- **`REQUIREMENTS.md`:** **do NOT tick ACTN-02.** `17-VERIFICATION.md:46-47` is still correct —
  *"ACTN-02 remains correctly unchecked and Pending."* This plan completed zero requirements.
- **`ROADMAP.md:354` shows Phase 17 as `- [x]` and that is FALSE.** The phase's own verification is
  `status: gaps_found` with two requirement-blocking gaps. Correcting the checkbox is a separate,
  deliberate act by whoever owns the roadmap; it was not done here, and it should not be done by
  quietly editing a line — the phase is `4/11` plans complete against the gap-closure plan set, not
  `4/4`.
- **`STATE.md`:** position → `17-05` complete, `17-06` next (wave 2, Microsoft OAuth). Metrics:
  duration 1h 3m, 3 tasks, 18 files.
- **Decisions to record:** the seven in this summary's `key-decisions` frontmatter.
- **Blockers to record:** none new. The pre-existing owner-consent blocker for Phase 17's live UAT
  (M1–M5 in `17-04-SUMMARY.md`) is unchanged, and 17-11 adds a second disposable Microsoft account
  to it.
- **Roadmap progress row:** Phase 17 now has 5 SUMMARY files against 11 PLAN files.

## Next Plan Readiness

`17-06` (Microsoft OAuth) can start immediately: `microsoftCalendarTokens` exists,
`parseCalendarProvider` exists, and nothing in this plan constrains the grant's shape.

**One hand-off must not be lost:** `EXTERNAL_TARGETS.calendar_manage` in `cockpit.ts` is the exact
member 17-08 replaces. Replacing it is one edit in one place; adding a second dispatch mechanism
beside it would defeat the derivation that makes the target table exhaustive.

**A second hand-off for 17-09:** `calendarExpectedEtag` is deliberately not a `patchPlan` arg. The
staging tool must copy a fresh etag through its own internal mutation (the `persistStoryboard`
precedent), server-side, from a real provider inspection — never through `patchPlan`, and never from
a model argument.

## Self-Check: PASSED

- All 3 created source files exist on disk: `scripts/run-calendar-test-gate.mjs`,
  `packages/core/src/calendarManagement.ts`, `packages/core/src/calendarManagement.test.ts`.
- All 3 owned commits resolve and are ancestors of HEAD: `185802c`, `d17ab1d`, `a14e5aa`.
- The foreign commit `3166544` carrying this plan's playbook section resolves and is an ancestor.
- `graphify update .` rebuilt 16,007 nodes / 18,413 edges; `node scripts/extract-convex-edges.mjs`
  re-injected 440 Convex edges and 65 table edges across **41 tables** (up from 39 — the two new
  tables are in the graph).

---
*Phase: 17-calendar-actions*
*Completed: 2026-08-11*
