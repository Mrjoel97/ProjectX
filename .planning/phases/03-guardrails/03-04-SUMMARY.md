---
phase: 03-guardrails
plan: 04
subsystem: api
tags: [convex, action-cache, llm, guardrails, pii, cost, fallback, ai-sdk]

# Dependency graph
requires:
  - phase: 03-guardrails (03-01)
    provides: "@pikar/cost (CHEAP_MODEL, priceUsage), isFallbackEligible in @pikar/core, SafeText brand"
  - phase: 03-guardrails (03-02)
    provides: "action-cache 0.3.1 registered; requests.safeText/safeTextHash/lastInstruction + by_tenant_safeTextHash index; scanning/blocked statuses; blocked telemetry outcome"
  - phase: 03-guardrails (03-03)
    provides: "guardrails.prepare/preCall governed stops, getSafeTextByHash fail-closed reader, recordSpend, lib/hash.contentHash"
provides:
  - "llm.ts route/draft wrappers + routeUncached/draftUncached uncached actions behind the tenant-namespaced action cache"
  - "structural redact-then-model: llm.ts reads text ONLY via getSafeTextByHash (getForDelivery/.goal removed, static-scan enforced)"
  - "pipeline guard step (prepare) + governed blocked terminal + priced spend recording + regenerate-with-instruction"
  - "llmRedaction.test.ts GRDL-02 static scan"
affects: [03.1-cockpit, phase-07-ops, phase-08-skillopt]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-through action cache keyed on hash-only args (tenantId/safeTextHash/model/skillVersion[/instructionHash]) — never text, never requestId"
    - "Governed stop propagates as data (blocked:reason) through the llm wrapper into ONE pipeline blocked terminal — never a throw/DLQ"
    - "Timestamp-inference cache-hit detection (generatedAt < tStart) — action-cache 0.3.1 exposes no native hit signal"
    - "Real fallback via try/catch + isFallbackEligible: primary model → CHEAP_MODEL once, audited by error NAME only"

key-files:
  created:
    - packages/backend/convex/llmRedaction.test.ts
  modified:
    - packages/backend/convex/llm.ts
    - packages/backend/convex/guardrails.ts
    - packages/backend/convex/pipeline.ts

key-decisions:
  - "Cache both route and draft (route wrapper is a copy of the draft wrapper) — 03-RESEARCH recommendation"
  - "Cache-hit detected by generatedAt timestamp vs fetch-start (no native hit signal in action-cache 0.3.1)"
  - "LLM workflow steps run retry:false — retry budget lives entirely inside the action (SDK maxRetries:1 + one fallback)"
  - "Extended SMOKE sentinel grammar (cache=1, fail=primary) exercises the cache + fallback paths offline"

patterns-established:
  - "Redact-then-model is structural, not procedural: the model surface has no code path to raw goal text (GRDL-01/02, static-scan enforced)"
  - "A registry rollback invalidates cached drafts because skillVersion is part of the cache key (CLAUDE.md §5 survives the cache)"

requirements-completed: [GRDL-01, GRDL-02, GRDL-03, GRDL-04, GRDL-05]

# Metrics
duration: 12min
completed: 2026-07-12
---

# Phase 3 Plan 04: LLM Guardrail Choke Point Summary

**Rewired llm.ts so route/draft read redacted text through the fail-closed reader, pass through the tenant-namespaced action cache, and fall back to CHEAP_MODEL on eligible failures; slotted the guardrails.prepare step + governed blocked terminal + priced spend into the pipeline — after this plan no code path reaches a model without scan → kill-switch → budget → cache → fallback.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-12T04:57:00Z
- **Completed:** 2026-07-12T05:08:00Z
- **Tasks:** 3
- **Files modified:** 4 (3 modified, 1 created)

## Accomplishments

- `llm.ts` model surface can no longer reach raw goal text: `getForDelivery`/`.goal` are gone; the only text source is `guardrails.getSafeTextByHash`, enforced permanently by `llmRedaction.test.ts` (GRDL-01/02).
- `routeUncached`/`draftUncached` internal actions carry hash-only cache-key args and run a real try/catch fallback to `CHEAP_MODEL` (one attempt, `llm.fallback` audited by error NAME only); parse-fail/our-bugs still dead-letter (AGNT-03/GRDL-05).
- `routeCache`/`draftCache` (names `route-v1`/`draft-v1`, 7d ttl) wrap the uncached actions; the `route`/`draft` wrappers do sentinel-first short-circuit → `preCall` governed gate → cache fetch → timestamp-inferred `cacheHit`.
- Pipeline runs `guardrails.prepare` BEFORE the route step; a rejection (prepare OR a mid-flight `preCall` stop surfaced by the wrappers) ends in ONE governed `blocked` terminal (status + `guardrail.blocked` audit + notify + blocked telemetry), never a DLQ throw.
- Telemetry `costUsd` is real (`priceUsage` of actual SDK usage; 0 on cache hits) and every real call's cost is consumed by `recordSpend`; LLM steps run `retry:false` (retry budget lives in the action's SDK+fallback layer). `smoke:pipeline` PASSED through the new guard step.

## Task Commits

Each task was committed atomically:

1. **Task 1: routeUncached/draftUncached + fail-closed reader + fallback + saveInstruction** - `ddc5a51` (feat)
2. **Task 2: cache instances + route/draft wrappers + GRDL-02 static scan** - `e04b0a7` (feat)
3. **Task 3: pipeline guard step, blocked terminal, priced spend, regenerate** - `16aff19` (feat)

## Files Created/Modified

- `packages/backend/convex/llm.ts` - Rewired: extended SMOKE sentinel, `routeUncached`/`draftUncached` (fail-closed reader, timeout, real fallback), `routeCache`/`draftCache`, `route`/`draft` wrappers (preCall gate + cache-hit inference)
- `packages/backend/convex/guardrails.ts` - Added `saveInstruction` internalMutation (persists already-scanned regenerate instruction to the content plane)
- `packages/backend/convex/pipeline.ts` - Guard step + `stopBlocked` terminal + `recordLlm` (priced spend + cache_hit audit); LLM steps retry:false; regenerate threads `instruction` + `force:true`
- `packages/backend/convex/llmRedaction.test.ts` - GRDL-02 static scan (no getForDelivery/.goal/entities in the model/guard/pipeline surface; only `skill.body` as system prompt)

## Decisions Made

- Cache both route and draft (03-RESEARCH: route wrapper is a copy of the draft wrapper; caching both is cheap).
- Cache-hit inferred by comparing the cached `generatedAt` to the wrapper's fetch-start timestamp — action-cache 0.3.1 exposes no native hit signal (verified against the installed `.d.ts`). Marked with a `ponytail:` upgrade note.
- LLM workflow steps run `{ retry: false }` so the retry budget cannot multiply (workpool 3× × SDK 1+1 × fallback = up to 12 paid calls per draft).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Pre-existing `audit.test.ts` failure (out of scope):** `audit.log inserts exactly one row that round-trips` throws `Component "auditCounts" is not registered` — the convex-test harness in that file never registers the `auditCounts` aggregate component (from Phase 02). Untouched by 03-04 (no change to audit.ts/audit.test.ts/aggregates.ts). Logged to `deferred-items.md`. 50/51 backend tests pass; the new `llmRedaction` and existing `guardrails` tests are green.
- **Pre-existing test-file typecheck errors (out of scope):** several Phase-1-era `*.test.ts` files use Vite's `import.meta.glob` (not in tsc's lib) and hit `possibly-undefined` in test assertions. All 03-04 source files (llm.ts, pipeline.ts, guardrails.ts) typecheck with zero errors after codegen.

## User Setup Required

None - no external service configuration required. (A real LLM path needs `AI_GATEWAY_API_KEY` on the deployment; the offline SMOKE seam covers the spine without it.)

## Next Phase Readiness

- THE choke point is closed: scan → kill-switch → budget → cache → fallback fronts every model call, structurally enforced. The cockpit (Phase 3.1+) and later phases build on the governed spine unchanged.
- `convex dev` is running with a live workpool (needed for smoke; do not leave `--once`).

---
*Phase: 03-guardrails*
*Completed: 2026-07-12*

## Self-Check: PASSED

All 4 source/test files and all 3 task commits verified present.
