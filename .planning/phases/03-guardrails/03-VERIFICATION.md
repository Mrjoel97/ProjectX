---
phase: 03-guardrails
verified: 2026-07-12T05:45:00Z
status: passed
score: 5/5 must-haves verified
human_verification:
  - test: "Real-network fallback via a bogus model id on a deployment with AI_GATEWAY_API_KEY set"
    expected: "Primary call throws a real provider error, isFallbackEligible classifies it, CHEAP_MODEL fallback succeeds, llm.fallback audited"
    why_human: "Cannot force a real provider outage from CI; smoke.mjs's SMOKE::fail=primary seam already exercises the real classifier + catch/fallback wiring deterministically and offline. 03-VALIDATION.md explicitly marks this optional and non-blocking for the phase gate."
---

# Phase 3: Guardrails Verification Report

**Phase Goal:** Every request passes cost, PII, and quality guardrails before any external model call, and runaway spend is structurally impossible — governance as a shipped product feature, slotted into the existing pipeline steps.
**Verified:** 2026-07-12T05:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | Every request is PII-scanned and redacted to `safeText` before any external model call; unknown/null scan result fails closed | ✓ VERIFIED | `guardrails.prepare` calls `scanText(req.goal)` and returns `{ok:false, reason:"pii_scan_failed"}` on `!scan.ok` (guardrails.ts). `llm.ts` reads text ONLY via `getSafeTextByHash` — `getForDelivery`/`.goal` structurally absent, enforced by `llmRedaction.test.ts` (3/3 passing). Live smoke section 1/6: PII goal (email+SSN) redacted, hash returned. |
| 2 | No raw PII appears in any log, telemetry record, or cache key — redact-then-log ordering enforced | ✓ VERIFIED | All `audit.log` payloads in guardrails.ts/pipeline.ts/llm.ts carry refs/hashes/counts only (`piiCounts`, `safeTextHash`, `requestId`) — grep confirms no `entities` destructure in llm.ts/guardrails.ts/pipeline.ts (also enforced by `llmRedaction.test.ts`). Cache key is `{tenantId, safeTextHash, model, skillVersion}` — hash only. Live smoke section 1/6: `assertNoRawPii` needle-scans audit/deadLetters/telemetry for the raw email+SSN — zero matches. |
| 3 | Over-budget requests downgrade to a cheaper model; per-user rate limit + cost kill-switch hard-stop runaway spend; unknown/null cost results fail closed | ✓ VERIFIED | `chooseModel` (packages/cost/src/cost.ts) tries DEFAULT_MODEL then CHEAP_MODEL then `Err(over_budget)`; unknown model propagates Err (never NaN/throw) — 11/11 cost.test.ts passing. `guardrails.prepare`/`preCall` check kill switch first, then `dailySpendCents` fixed-window; `requests.submit` runs `rateLimiter.limit(submitRequest)` BEFORE validateSubmit. Live smoke sections 4/6 (kill switch), 5/6 (daily budget, prepare AND mid-flight preCall), 6/6 (submit rate limiter rejects 6th consume) — all passed against the live deployment. |
| 4 | Two different users submitting identical redacted input receive isolated, tenant-namespaced cache entries; a cache hit returns without a model call | ✓ VERIFIED | `routeCache`/`draftCache` are `ActionCache` instances keyed on `{tenantId, safeTextHash, model, skillVersion(, instructionHash)}`. Live smoke section 2/6: two tenants with the identical PII goal each produce exactly 1 `llm.called` draft row (isolated); the same tenant repeating the goal produces 0 new rows (cache hit, no model call). |
| 5 | A primary model failure or timeout transparently triggers fallback generation | ✓ VERIFIED | `isFallbackEligible` (packages/core/src/fallback.ts, 9/9 tests) classifies via SDK `.isInstance` statics; `routeUncached`/`draftUncached` catch, check eligibility, audit `llm.fallback` by error NAME only, retry once on CHEAP_MODEL. Live smoke section 3/6: forced primary failure (SMOKE::fail=primary) produces `llm.fallback` audit and the request still reaches review. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/pii/src/scan.ts` | `SafeText` brand + fail-closed `scanText` | ✓ VERIFIED | Brand type present (`SafeText = string & {readonly __safeText: unique symbol}`); fail-closed on non-string input; 8/8 tests pass |
| `packages/cost/src/cost.ts` | `estimateCostUsd`/`priceUsage`/`chooseModel`, PRICING, DEFAULT_MODEL/CHEAP_MODEL | ✓ VERIFIED | All exports present, Result-typed, fail-closed; 11/11 tests pass |
| `packages/core/src/fallback.ts` | `isFallbackEligible` classifier | ✓ VERIFIED | Uses `.isInstance` statics (RetryError/APICallError/NoObjectGeneratedError), name-match for timeout/abort; 9/9 tests pass |
| `packages/backend/convex/guardrails.ts` | `prepare`/`preCall`/`getSafeTextByHash`/`recordSpend`/`setKillSwitch` | ✓ VERIFIED | All exports present (plus `saveInstruction`, `rateLimiter`); 176 lines; discriminated ok/blocked returns, throws only on missing rows (bugs). 5/5 guardrails.test.ts pass |
| `packages/backend/convex/schema.ts` | safeText/safeTextHash/lastInstruction + by_tenant_safeTextHash index + guardrailConfig + scanning/blocked literals | ✓ VERIFIED | All fields, index, table, and literals present (lines 97–178) |
| `packages/backend/convex/convex.config.ts` | action-cache component registered | ✓ VERIFIED | `app.use(cache)` present |
| `packages/backend/package.json` | `@convex-dev/action-cache` exact-pinned 0.3.1 | ✓ VERIFIED | `"@convex-dev/action-cache": "0.3.1"` (no caret) |
| `packages/backend/convex/llm.ts` | route/draft wrappers + routeUncached/draftUncached + ActionCache + sentinel grammar | ✓ VERIFIED | 371 lines; all exports present; no `getForDelivery`/`.goal` references (grep confirms) |
| `packages/backend/convex/pipeline.ts` | guard step + blocked terminal + spend recording + retry:false | ✓ VERIFIED | `guardrails.prepare` runs before route; ONE `stopBlocked`/blocked terminal for prepare AND mid-flight preCall stops; `recordSpend` after each real call; `{retry:false}` on LLM steps |
| `packages/backend/convex/llmRedaction.test.ts` | GRDL-02 static scan | ✓ VERIFIED | 3/3 tests pass: no getForDelivery/.goal, getSafeTextByHash present, no `entities` leak, prompts load only from `skill.body` |
| `packages/backend/scripts/run-smoke-guardrails.mjs` | phase-gate smoke driving all SCs against dev deployment | ✓ VERIFIED | 112 lines, 6 sections; **ran live — PASSED all 6 sections** against the running `convex dev` deployment |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `packages/cost/src/cost.ts` | `packages/pii` (SafeText) | `chooseModel(safeText: SafeText, ...)` | ✓ WIRED | Signature imports and uses `SafeText` type |
| `packages/core/src/fallback.ts` | `ai` package error taxonomy | `.isInstance` guards | ✓ WIRED | RetryError/APICallError/NoObjectGeneratedError `.isInstance` used |
| `packages/backend/package.json` | `@convex-dev/action-cache` | exact 0.3.1 pin | ✓ WIRED | Confirmed no caret |
| `packages/backend/convex/telemetry.ts` | `blocked` outcome | `v.literal("blocked")` | ✓ WIRED | schema.ts line 111 |
| `packages/backend/convex/requests.ts` | `guardrails.rateLimiter` | `rateLimiter.limit(ctx,'submitRequest',{key:ctx.tenantId})` before validateSubmit | ✓ WIRED | Confirmed at requests.ts:52, before validateSubmit call |
| `packages/backend/convex/guardrails.ts` | `@pikar/cost chooseModel` | `prepare` estimates from SafeText | ✓ WIRED | `chooseModel(safeText, cfg.budgetUsdPerRequest)` in prepare |
| `packages/backend/convex/guardrails.ts` | `components.rateLimiter` | `dailySpendCents` fixed-window check + reserve-consume | ✓ WIRED | `rateLimiter.check`/`rateLimiter.limit(..., {reserve:true})` |
| `packages/backend/convex/llm.ts` | `guardrails.getSafeTextByHash` | `ctx.runQuery` — the ONLY text source | ✓ WIRED | Used in routeUncached/draftUncached/route/draft |
| `packages/backend/convex/llm.ts` | `components.actionCache` | `new ActionCache(...)` | ✓ WIRED | routeCache/draftCache instantiated |
| `packages/backend/convex/pipeline.ts` | `guardrails.prepare` | `step.runMutation` before route step | ✓ WIRED | Confirmed ordering in pipeline.ts |
| `packages/backend/convex/pipeline.ts` | `guardrails.recordSpend` | mutation step after each real call | ✓ WIRED | `recordSpend` called with `costUsd` from `priceUsage` |
| `packages/backend/scripts/run-smoke-guardrails.mjs` | `guardrails.setKillSwitch` | flip on → assert blocked → flip off (finally-guarded) | ✓ WIRED | try/finally around setKillSwitch(true)/(false) |
| `packages/backend/convex/smokeAssert.ts` | audit `llm.called` count | cache hit/miss oracle | ✓ WIRED | `assertLlmCalledCount` used in smoke section 2/6 |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| GRDL-01 | 03-02, 03-03, 03-04 | Every request is PII-scanned and redacted to safeText before any external model call; unknown/null scan results fail closed | ✓ SATISFIED | prepare scans+persists safeText before model steps; getSafeTextByHash is the only reader; live smoke 1/6 |
| GRDL-02 | 03-01, 03-04, 03-05 | Pipeline enforces redact-then-log ordering — no raw PII in logs, telemetry, or cache keys | ✓ SATISFIED | llmRedaction.test.ts static scan + live smoke 1/6 no-raw-PII needle scan |
| GRDL-03 | 03-01, 03-03, 03-04 | Cost estimated from safeText, checked against budget, downgrades or fails closed | ✓ SATISFIED | chooseModel fail-closed Result; prepare/recordSpend wired; cost.test.ts 11/11 |
| GRDL-04 | 03-02, 03-04, 03-05 | LLM responses cached keyed on tenant-namespaced safeTextHash; cache hits skip model call | ✓ SATISFIED | ActionCache keyed on {tenantId, safeTextHash, model, skillVersion}; live smoke 2/6 |
| GRDL-05 | 03-01, 03-04, 03-05 | Primary LLM generation failure/timeout triggers fallback | ✓ SATISFIED | isFallbackEligible + in-action CHEAP_MODEL retry; live smoke 3/6 |
| GRDL-06 | 03-02, 03-03, 03-05 | Per-user rate limiting and cost kill-switch cap runaway spend | ✓ SATISFIED | submitRequest token bucket + dailySpendCents fixed window + setKillSwitch; live smoke 4/6, 5/6, 6/6 |

No orphaned requirements — all 6 GRDL IDs declared across plan frontmatter and REQUIREMENTS.md agree (REQUIREMENTS.md already marks all six "Complete").

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | No TODO/FIXME/XXX/HACK/placeholder found in guardrails.ts, llm.ts, or pipeline.ts | — | none |

No blockers or warnings found in phase-3-modified production files. `ponytail:` comments present (fixed constants, timestamp-inference cache-hit signal, heuristic token estimator) are documented deliberate simplifications with named ceilings/upgrade paths, per CLAUDE.md §8 — not anti-patterns.

### Live Verification Run (this session, against the running `convex dev` deployment)

- `pnpm run smoke:guardrails` → **PASSED** all 6 sections (redaction/no-raw-PII, cache isolation + model-free hit, real fallback, kill switch, daily budget prepare+mid-flight, submit rate limiter).
- `pnpm run smoke:pipeline` → **PASSED** (Phase-2 spine regression intact).
- `vitest run` (backend): 50/51 tests pass; the 1 failure (`audit.test.ts` — `Component "auditCounts" is not registered"`) is the pre-existing, documented, out-of-scope gap in `deferred-items.md` (Phase-2 aggregate test-harness issue, unrelated to Phase 3 changes — reproduced independent of guardrail edits).
- `vitest run` (cost/core/pii packages): 11/11, 27/27, 8/8 — all green, including `fallback.test.ts` (9/9) and `guardrails.test.ts`/`llmRedaction.test.ts` (5/5, 3/3).
- `tsc --noEmit` (backend): errors confined to `*.test.ts` (`import.meta.glob` typing gap + un-null-guarded test assertions) — same pre-existing class documented in `deferred-items.md` (now also present in the new `guardrails.test.ts`, same root cause, not a new category). Production convex code (guardrails.ts, llm.ts, pipeline.ts, schema.ts) typechecks clean.
- Import guard: `guardrails.ts`/`llm.ts`/`pipeline.ts` import only `internal*` builders from `./_generated/server` (case-sensitive regex exemption, telemetry.ts precedent) — no raw `query`/`mutation` imports (CLAUDE.md §2).
- Audit/redaction: every `audit.log` payload touched by Phase 3 carries refs/hashes/counts only — no raw content (CLAUDE.md §4).

### Human Verification Required

1 optional, non-blocking item (documented in 03-VALIDATION.md as "do not block the phase gate on it"):

1. **Real-network fallback on live provider outage**
   **Test:** On a deployment with `AI_GATEWAY_API_KEY` set, submit a request with a deliberately bad/unavailable model id and observe the real fallback path.
   **Expected:** Primary call throws a real provider error, `isFallbackEligible` classifies it, `CHEAP_MODEL` retry succeeds, `llm.fallback` audited.
   **Why human:** Cannot force a genuine provider outage from CI. The `SMOKE::fail=primary` seam already exercises the real classifier + catch/fallback code path deterministically and offline (live smoke section 3/6, passed this session). 03-VALIDATION.md explicitly scopes this as optional.

### Gaps Summary

None. All 5 ROADMAP success criteria verified with both static code inspection and a live re-run of `smoke:guardrails` (all 6 sections) and `smoke:pipeline` against the running dev deployment this session. All 6 GRDL requirements satisfied with no orphans. The one pre-existing test/typecheck gap (`audit.test.ts` unregistered `auditCounts` aggregate component under convex-test) is documented in `deferred-items.md`, reproduces independent of Phase 3's changes, and does not affect production code or the phase-gate smoke.

---

_Verified: 2026-07-12T05:45:00Z_
_Verifier: Claude (gsd-verifier)_
