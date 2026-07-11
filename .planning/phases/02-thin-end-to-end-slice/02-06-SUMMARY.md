---
phase: 02-thin-end-to-end-slice
plan: 06
subsystem: api
tags: [convex-workflow, pipeline, dead-letter, telemetry, review-gate, gmail, agnt-03]

# Dependency graph
requires:
  - phase: 02-02
    provides: internal.llm.route/draft (skill-registry prompts, usage for telemetry)
  - phase: 02-03
    provides: requests.submit intake + workflow.start with onComplete DLQ context (requestId in payload)
  - phase: 02-04
    provides: review gate (armTimeout/sendDecision, attempt-suffixed events) + telemetry.writeTerminal
  - phase: 02-05
    provides: internal.gmail.send (retrier-safe, awaiting_reauth on token death) + gmailAuth readers
provides:
  - pipelineWorkflow — the Phase-2 spine (route → draft → review gate w/ regenerate loop → Gmail delivery)
  - failed-terminal wiring at deadLetter.onPipelineComplete (status=failed + one failed telemetry row)
  - tenant-scoped operator dead-letter surface (newCount/listNew/markResolved) — OPSG-07
  - SMOKE::route sentinel in llm.route/draft enabling deterministic offline spine smoke
  - full-spine + AGNT-03 DLQ smoke scripts passing against the dev deployment
affects: [phase-03-guardrails, phase-04-intake, phase-07-notifications, review-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single workflow.define spine composes existing internal.* steps; status transitions via reused setStatus"
    - "Failed terminal owned at the single onComplete choke point (root-cause, not per-branch patches)"
    - "Deterministic offline smoke via a per-request content sentinel (no shared env flag, no pipeline duplication)"

key-files:
  created:
    - packages/backend/convex/deadLetters.ts
    - packages/backend/convex/deadLetters.test.ts
    - packages/backend/scripts/run-smoke-pipeline.mjs
  modified:
    - packages/backend/convex/pipeline.ts
    - packages/backend/convex/deadLetter.ts
    - packages/backend/convex/llm.ts
    - packages/backend/convex/smoke.ts
    - packages/backend/convex/smokeAssert.ts
    - packages/backend/scripts/run-smoke-dlq.mjs
    - packages/backend/package.json

key-decisions:
  - "Spine uses step.runAction(internal.gmail.send) + workpool default retries (not retrier.run) — a workflow handler has no scheduler ctx to await a retrier result; gmail.send's own throw-on-5xx drives retries and its discriminated result drives the sent-vs-hold branch. Matches Research Pattern 1 verbatim."
  - "durationMs measured in-handler via the workflow's patched-deterministic Date.now() (startedAt→terminal); no telemetry.writeTerminal signature change needed."
  - "SMOKE::route=<value>:: goal sentinel in llm.route/draft forces route/draft deterministically offline — the local backend has no AI_GATEWAY_API_KEY and a real model can't be forced onto sub_agent/unknown to exercise both AGNT-03 DLQ paths. Keeps the REAL pipeline (gate, delivery, DLQ, telemetry) in the loop with zero duplication."
  - "regenerate past MAX_REGENERATE breaks to delivery per Research Pattern 1 (UI stops offering regenerate at the cap); the regenerate instruction is not yet threaded into llm.draft — Phase 3 wires it with the redact step."

patterns-established:
  - "Content-plane persistence (draft/editedBody/rejectReason) via internal saveDraft mutation; raw content stays on requests, never in audit/DLQ payloads"
  - "Operator DLQ surface is tenant-scoped (tenantQuery/tenantMutation) and DISTINCT from the insert-only deadLetter.ts onComplete handler"

requirements-completed: [AGNT-03, OPSG-07, REVW-01, DLVR-01, DLVR-03, OPSG-01]

# Metrics
duration: ~35min
completed: 2026-07-11
---

# Phase 2 Plan 6: Pipeline Spine + Operator Dead-Letter Surface Summary

**One durable pipelineWorkflow sequences route → draft → review gate (regenerate loop) → Gmail delivery with staged status; both AGNT-03 mis-routes dead-letter under distinct reasons and drive a `failed` terminal, and the operator gets a tenant-scoped DLQ surface — all proven by full-spine + DLQ smoke scripts against the live deployment.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-11T18:50:00Z
- **Completed:** 2026-07-11T19:10:00Z
- **Tasks:** 3
- **Files modified:** 10 (2 created code + 1 test created, 7 modified)

## Accomplishments
- `pipelineWorkflow` composes the whole Phase-2 spine, transitioning `requests.status` at every observable stage (routing → drafting → awaiting_review → delivering → sent, with rejected/expired/awaiting_reauth branches).
- The `failed` terminal is owned at the single choke point every failure routes through — `deadLetter.onPipelineComplete` now patches `status=failed` and writes exactly one `failed` telemetry row (OPSG-01), so a mis-routed request never hangs at "routing".
- `unknown_route` (parse fail) and `route_not_implemented` (sub_agent) dead-letter under DISTINCT reasons — no silent default (AGNT-03).
- Tenant-scoped operator surface (`newCount`/`listNew`/`markResolved`) clears the DLQ badge without database inspection (OPSG-07); replay deliberately deferred.
- Full-spine and DLQ smoke scripts PASS against the live local convex deployment.

## Task Commits

1. **Task 1: Pipeline spine + failed-terminal DLQ wiring** - `daf7512` (feat)
2. **Task 2: Operator dead-letter surface** - `ce670aa` (test, RED) → `e27dd9d` (feat, GREEN)
3. **Task 3: Full-spine + AGNT-03 DLQ smoke scripts** - `8262345` (feat)

_Task 2 was TDD: failing test committed first, then the implementation._

## Files Created/Modified
- `convex/pipeline.ts` - Replaced the no-op stub with the real spine handler + `saveDraft`/`useVerbatimDraft` content mutations; reuses `setStatus`.
- `convex/deadLetter.ts` - Extended `onPipelineComplete` with the OPSG-01 failed terminal (status + one failed telemetry row), redaction-safe, idempotent.
- `convex/deadLetters.ts` - NEW tenant-scoped operator surface over `by_tenant_status`.
- `convex/deadLetters.test.ts` - NEW convex-test coverage (tenant isolation, badge clearing, fail-closed).
- `convex/llm.ts` - Added the `SMOKE::route` sentinel seam to `route`/`draft` for deterministic offline smoke.
- `convex/smoke.ts` - `seedPipeline` starts the real pipeline with the onComplete DLQ context.
- `convex/smokeAssert.ts` - `assertPipelineDelivered` + `assertDeadLetterReason`.
- `scripts/run-smoke-pipeline.mjs` - NEW full-spine smoke (approve → awaiting_reauth).
- `scripts/run-smoke-dlq.mjs` - Extended with both AGNT-03 paths.
- `package.json` - Registered `smoke:pipeline`.

## Decisions Made
See frontmatter `key-decisions`. Headlines: step.runAction (not retrier.run) inside the workflow per Research Pattern 1; in-handler deterministic `Date.now()` for durationMs; the `SMOKE::route` content sentinel for offline deterministic smoke; regenerate-past-cap breaks to delivery per Pattern 1.

## Deviations from Plan

### Auto-fixed / adapted

**1. [Rule 3 - Blocking] step.runAction for delivery instead of `retrier.run(ctx, ...)`**
- **Found during:** Task 1
- **Issue:** The plan prose said `await retrier.run(ctx, internal.gmail.send, ...)`, but a `workflow.define` handler is `(step, args)` — it has no mutation/scheduler `ctx`, and the retrier returns a runId (fire-and-onComplete), not a synchronous result the linear spine can branch on.
- **Fix:** Used `await step.runAction(internal.gmail.send, { requestId })` — the workpool already retries actions by default and gmail.send throws on 5xx (retry) / returns a discriminated result (sent vs awaiting_reauth). This is exactly what Research Pattern 1's reproduced code uses.
- **Files modified:** convex/pipeline.ts
- **Verification:** Full-spine smoke reaches awaiting_reauth; typecheck clean.
- **Committed in:** `daf7512`

**2. [Rule 3 - Blocking] SMOKE::route sentinel to run the spine offline**
- **Found during:** Task 3
- **Issue:** The local convex deployment has NO environment variables (`AI_GATEWAY_API_KEY` unset), so the real LLM route/draft cannot run; and a real model can't be deterministically forced onto `sub_agent`/`unknown` to exercise both AGNT-03 DLQ paths the plan requires ("a pipeline forced to an unknown route").
- **Fix:** Added a per-request goal sentinel (`SMOKE::route=<value>::`) that `llm.route`/`llm.draft` short-circuit on, returning a fixed route/draft with zero usage. Real goals never carry it; it only affects the caller's own request. This keeps the REAL pipeline (gate, delivery, DLQ, telemetry, failed-terminal wiring) in the loop with zero pipeline duplication.
- **Files modified:** convex/llm.ts
- **Verification:** Both smoke scripts pass against the live deployment.
- **Committed in:** `8262345`

**3. [Rule 1 - Bug] ZERO_USAGE cast to satisfy the AI SDK usage type**
- **Found during:** Task 3
- **Issue:** `LanguageModelUsage` requires `inputTokenDetails`/`outputTokenDetails`; a bare `{inputTokens,outputTokens,totalTokens}` failed typecheck.
- **Fix:** `as unknown as GenUsage` cast — the telemetry consumer reads only token counts; the zero-cost smoke route needs no detail fields.
- **Files modified:** convex/llm.ts
- **Committed in:** `8262345`

---

**Total deviations:** 3 (2 blocking adaptations, 1 type fix). All within the plan's intent (the plan itself anticipated "a pipeline forced to an unknown route" and the smoke as the only way to exercise component-backed workflows). No scope creep.

## Issues Encountered
- **Pre-existing typecheck failures (out of scope):** `convex/*.test.ts` `import.meta.glob` gap and `convex/smoke.ts` circular `internal`-graph inference — both present at baseline 77ca77d, my code adds zero new errors. Neither blocks `convex run`. Logged in `deferred-items.md`.
- **Pre-existing test failure (out of scope):** `convex/audit.test.ts` fails with `Component "auditCounts" is not registered` — verified identical at baseline; the aggregate component isn't registered in that test's harness. Untouched by 02-06. Logged in `deferred-items.md`.

## User Setup Required
None for this plan's automated verification. A REAL Gmail send still requires human OAuth consent (manual per 02-VALIDATION.md) and `GOOGLE_OAUTH_*` + `AI_GATEWAY_API_KEY` set on the deployment — the smoke covers the automatable half (awaiting_reauth) offline.

## Next Phase Readiness
- The Phase-2 spine is complete and observable end-to-end; the DLQ collects and surfaces failures.
- Phase 3 (GRDL) slots the redact step ahead of `llm.route`/`llm.draft` (seam marked `ponytail:`), threads the regenerate instruction into drafting, and prices tokens (costUsd currently 0). The `SMOKE::route` sentinel should be removed once a mock-gateway smoke exists.

---
*Phase: 02-thin-end-to-end-slice*
*Completed: 2026-07-11*

## Self-Check: PASSED
All created files present on disk; all task commits (daf7512, ce670aa, e27dd9d, 8262345) present in git history.
