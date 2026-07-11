# Phase 3: Guardrails - Research

**Researched:** 2026-07-12
**Domain:** LLM guardrails on a Convex durable-workflow pipeline (PII redaction, cost estimation/downgrade, tenant-namespaced action cache, fallback generation, rate limit + kill switch)
**Confidence:** HIGH (components verified against official READMEs/npm; codebase insertion points read directly)

<user_constraints>
## User Constraints (from STATE.md decisions + `.planning/design/pii-engine.md` — no CONTEXT.md exists; the PII design record's recommended defaults stand in for user context)

### Locked Decisions
- **PII engine is DECIDED**: pure-TS `packages/pii` `scanText` (email/card+Luhn/SSN/phone → stable placeholders, fail-closed `Result`). Exists, 8 tests green. Do NOT re-research PII approaches. No Presidio sidecar, no cloud DLP in v1.
- **`@convex-dev/action-cache` implements GRDL-04.** The cache key MUST include `tenantId` alongside `safeTextHash` (action-cache keys on the action's args — omitting tenantId serves one tenant's LLM response to another: cross-tenant leak, not a cache miss). GRDL-02 additionally forbids raw PII in the key, hence hashing `safeText` rather than keying on it.
- **`@convex-dev/rate-limiter` 0.3.2 is already installed AND registered** in `convex.config.ts` (Phase 1). Phase 3 is its first actual use — do not re-install or bump.
- **Zero-retention/no-training LLM terms** are a hard constraint before restricted-scope (Gmail-derived) data flows. Model is called via Vercel AI Gateway with bare string ids (no provider package import, no `@convex-dev/agent`).
- **Pre-1.0 components pinned EXACT** (no `^`). Adopting action-cache means pinning its current release after reading its README (done below).
- **`"use node"` modules contain ONLY actions**; DB helpers live in separate modules reached via `ctx.runQuery/runMutation`. Explicit return-type annotations on use-node actions joining the internal graph (TS circular-inference limit, guidelines §96).
- **Windows/Node24**: never trust `npx convex run` exit codes; `smokeRun.mjs` judges by output banner. `convex dev` must stay running (not `--once`) or workpool steps hang.
- **Insert-only audit; payloads carry refs/hashes/ids/counts ONLY** (CLAUDE.md §3/§4). Redact-then-write.
- **No hardcoded prompts** — skills load from the registry (CLAUDE.md §5).
- **The `SMOKE::route=…::` sentinel seam in `llm.ts` must keep working offline** (local backend has no `AI_GATEWAY_API_KEY`).

### Recommended defaults standing in for user context (pii-engine.md "Tensions")
1. **Names-in-prose**: v1 sends person names to the model under the zero-retention contract; logs/telemetry/cache stay hash-only regardless. Name redaction later = the Presidio trigger. (Adopt as-is.)
2. **Cache collision semantics**: two goals differing only in redacted values collapsing to one `safeTextHash` is SAFE today — recipient is delivery-supplied (llm.ts never sees it), placeholders are deterministic; a shared template, not a leak. Re-verify at CKPT-03 (recipient-aware drafting), not now.
3. **Fail-closed UX**: a scan `Err` stops the request; mirror INTK-04's rejection pattern (audit event + in-app notification, redaction-safe payload). Phase 3 must name the status + audit event (recommendation below).

### Deferred Ideas (OUT OF SCOPE)
- Presidio sidecar, cloud DLP, person-name/i18n redaction (upgrade path only).
- Per-tenant rate-limit policy configuration (single-owner beta: fixed constants suffice).
- Multi-provider availability failover (full-OpenAI-outage resilience) — same-provider cheaper-model fallback satisfies GRDL-05; note the ceiling.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GRDL-01 | PII-scan + redact to safeText before any external model call; unknown/null fails closed | `scanText` exists (fail-closed `Result`); insertion slots marked in `llm.ts`/`pipeline.ts`; structural enforcement pattern (safeText-or-throw reader) in Architecture Patterns |
| GRDL-02 | Redact-then-log ordering — no raw PII in logs, telemetry, or cache keys | Brand type + fail-closed `getSafeText` reader + static-scan test (mirrors `auditImmutability.test.ts`); `counts`/`safeTextHash` are the only loggable scan artifacts |
| GRDL-03 | Cost estimated from safeText, over-budget downgrades to cheaper model, unknown/null fails closed | chars/4 heuristic (no tokenizer dep — ladder), `packages/cost` pricing table, downgrade target `openai/gpt-4.1-nano` verified on the Gateway with pricing |
| GRDL-04 | Tenant-namespaced cache on safeTextHash; hit returns without a model call | `@convex-dev/action-cache` 0.3.1 API verified: args-based key, `fetch()` skips the action on hit, TTL + daily cleanup cron, `force` refresh |
| GRDL-05 | Primary model failure/timeout triggers fallback generation | AI SDK error taxonomy verified (`APICallError.isRetryable`, `NoObjectGeneratedError`, `AbortSignal.timeout`); double-retry trap resolved via `{ retry: false }` per-step option (verified in workflow README) |
| GRDL-06 | Per-user rate limit + cost kill-switch cap runaway spend | rate-limiter 0.3.2 API verified (`limit`/`check`, `key`, `count`, token bucket vs fixed window); global spend budget = keyless fixed-window limiter with `count = cost in cents`; manual kill switch = single config row |
</phase_requirements>

## Summary

Phase 3 slots four guard mechanisms into the existing `pipelineWorkflow` and `llm.ts` choke points, all of which are already marked with `ponytail:` comments. The PII engine is done; the work is *wiring*: (1) a guard mutation step that scans the goal to `safeText`, persists it on the request row, checks the kill switch, estimates cost, and picks the model; (2) rewiring `llm.route/draft` to read safeText via a fail-closed query (they structurally *cannot* see the raw goal anymore); (3) wrapping the draft model call in an `ActionCache` keyed on `{tenantId, safeTextHash, model, skillVersion}`; (4) a try/catch fallback inside the action (timeout via `AbortSignal.timeout`, one attempt on the cheap model), with workflow-level step retries turned OFF for LLM steps to kill the retry-multiplication trap.

Everything external is verified current: **action-cache 0.3.1** (published 2026-07-07, args-keyed, TTL + daily cron cleanup), **rate-limiter 0.3.2** as already pinned (token-bucket per-user limits keyed on `tenantId`, keyless fixed-window global limits, `count` for weighted consumption — which makes a "cents spent per day" budget limiter a one-liner), and the **AI SDK 7** error surface (`AI_APICallError.isRetryable`, `AI_NoObjectGeneratedError`, `maxRetries` default 2, `abortSignal` supported on `generateObject`). The cheaper model for both downgrade and fallback is **`openai/gpt-4.1-nano`** ($0.10/$0.40 per MTok vs gpt-4o-mini's $0.15/$0.60; non-reasoning, so no surprise reasoning-token billing, and structured-output friendly).

The one genuinely novel design problem is the cache key: the cached action's args ARE the key, the key may not contain text, but the model needs text. The resolution is an args shape of `{tenantId, safeTextHash, model, skillVersion}` plus a tenant-scoped index lookup (`requests.by_tenant_safeTextHash`) inside the cached action to recover `safeText` from its hash. Same tenant + same hash → same safeText, so the lookup is deterministic and the key stays hash-only.

**Primary recommendation:** Build one guard choke point (`guardrails.ts` mutation + the rewired `llm.ts` wrapper) so every model call — today's pipeline, the regenerate loop, and the future cockpit — passes scan → kill-switch → budget → cache → model → fallback in one place, and enforce redact-then-log by making raw-goal access structurally impossible from `llm.ts`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@convex-dev/action-cache` | **0.3.1** (pin exact; published 2026-07-07; peer `convex ^1.24.8` — repo has 1.42.1 ✓) | GRDL-04 tenant-namespaced LLM response cache | Locked decision; args-based key, hit skips the action, TTL + daily cleanup cron built in |
| `@convex-dev/rate-limiter` | 0.3.2 (ALREADY installed + registered) | GRDL-06 per-user limit + global spend budget | Locked decision; transactional, `count` supports weighted (cost-based) consumption |
| `packages/pii` (`scanText`) | workspace | GRDL-01/02 scan + redact | Decided 2026-07-12; tested; fail-closed `Result` |
| `ai` | 7.0.20 (existing, pinned) | `generateObject` + error taxonomy + `abortSignal`/`maxRetries` for GRDL-05 | Already the LLM surface; no new dep |
| `packages/cost` (NEW pure-TS package) | workspace | GRDL-03 token estimate + pricing table + `priceUsage` | CLAUDE.md §1 names `cost` as a planned domain package; keeps convex/ a thin adapter |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `crypto.subtle` (SHA-256) | platform | `safeTextHash` | Reuse `requests.ts` `contentHash` verbatim (works in default Convex runtime — already proven in a mutation) |
| `AbortSignal.timeout(ms)` | platform (Node 18+/Convex node runtime) | GRDL-05 timeout enforcement | Pass as `abortSignal` to `generateObject`; documented AI SDK pattern |
| `convex-test` + vitest + `@edge-runtime/vm` | existing | Unit/integration tests | Pure logic + non-component convex functions |
| `scripts/smokeRun.mjs` pattern | existing | Component + workflow integration verification | Anything touching action-cache/rate-limiter/workflow (see Validation Architecture) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| chars/4 token heuristic | `tiktoken`/`js-tiktoken` (wasm dep) | The estimate feeds a budget *threshold*, not billing; ±20% error is irrelevant against a 2–5× budget margin. Adding a wasm dep for this fails the ponytail ladder (rung 5/6). Actual cost uses real `usage` from the SDK, not the estimate |
| `openai/gpt-4.1-nano` as downgrade/fallback | `openai/gpt-5-nano` ($0.05/$0.40) | gpt-5-nano is a *reasoning* model: reasoning tokens bill as output (erasing the input saving), slower, and less predictable under `generateObject`. gpt-4.1-nano is non-reasoning, 1M context, built for routing/classification workloads — the right shape for a fallback drafter |
| Single-row `guardrailConfig` table for budget + kill switch | Convex env vars | Kill switch needs a runtime flip without redeploy; a table row read in the guard step gives that and carries `budgetUsdPerRequest`/`dailyBudgetCents` in the same place. Default-on-read (missing row = defaults, switch off) avoids any seed migration |
| Global spend limiter (`fixed window`, keyless, `count`=cents) | Hand-rolled spend counter table | The installed rate-limiter already does transactional, sharded, windowed counting — hand-rolling it is exactly the "don't hand-roll" trap |

**Installation:**
```bash
pnpm --filter @pikar/backend add @convex-dev/action-cache@0.3.1   # then pin exact in package.json (no ^)
# convex.config.ts: app.use(actionCache) → npx convex dev (codegen emits components.actionCache)
```

## Architecture Patterns

### Where everything lands (existing files, marked slots)

```
packages/
├── pii/                    # EXISTS — scanText (do not touch except maybe a SafeText brand export)
├── cost/                   # NEW pure-TS: estimateTokens, estimateCostUsd, priceUsage, PRICING table
└── backend/convex/
    ├── guardrails.ts       # NEW: prepare (guard mutation), getSafeTextByHash, recordSpend,
    │                       #      setKillSwitch, config read (raw-builder allowlist, like pipeline.ts)
    ├── llm.ts              # REWIRED: reads safeText-or-throw; cache wrapper; fallback; model arg
    ├── pipeline.ts         # guard step inserted before route; "blocked" terminal branch
    └── convex.config.ts    # + app.use(actionCache)
```

### Pattern 1: Guard step before any model call (GRDL-01/02/03/06 in one mutation)

The pipeline gains one mutation step ahead of `route` (the exact slot the `ponytail:` comment in `pipeline.ts` reserves). Mutations are transactional and are NOT retried on application error (verified: workflow README — action retries only apply to actions), so a guard rejection is deterministic.

```typescript
// guardrails.ts (allowlisted internalMutation, same as pipeline.ts)
// Returns a discriminated result — EXPECTED rejections return, they don't throw.
// Throw = bug → onComplete → DLQ. Return {ok:false} = governed stop → "blocked" terminal.
export const prepare = internalMutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }): Promise<
    | { ok: true; model: string; safeTextHash: string; piiCounts: Record<string, number> }
    | { ok: false; reason: "pii_scan_failed" | "kill_switch" | "over_budget" }
  > => {
    const req = await ctx.db.get(requestId);
    if (!req) throw new Error(`guardrails.prepare: no request ${requestId}`);

    // 1. Kill switch (GRDL-06) — single config row, default-on-read.
    if ((await getConfig(ctx)).killSwitch) return { ok: false, reason: "kill_switch" };

    // 2. PII scan (GRDL-01) — fail closed on Err. entities NEVER leave this function.
    const scan = scanText(req.goal);
    if (!scan.ok) return { ok: false, reason: "pii_scan_failed" };
    const safeTextHash = await contentHash(scan.value.safeText); // requests.ts pattern

    // 3. Cost estimate from safeText (GRDL-03) — Result-typed; Err (unknown model) fails closed.
    //    Over budget on DEFAULT_MODEL → downgrade to CHEAP_MODEL; still over → blocked.
    const model = chooseModel(scan.value.safeText, config); // pure, from @pikar/cost

    // 4. Global daily spend pre-check (GRDL-06) — check() the estimate without consuming;
    //    actual usage is consumed post-call by recordSpend.
    const spend = await rateLimiter.check(ctx, "dailySpendCents", { count: estCents });
    if (!spend.ok) return { ok: false, reason: "over_budget" };

    // 5. Persist the redaction ON the content plane (requests row — raw goal already lives there).
    await ctx.db.patch(requestId, { safeText: scan.value.safeText, safeTextHash });
    return { ok: true, model, safeTextHash, piiCounts: scan.value.counts };
  },
});
```

The workflow branches on `ok:false` exactly like the `gmail.send` `delivered:false` hold pattern: set a new `"blocked"` status, audit `guardrail.blocked` (payload: `{ requestId, reason }` — refs only), notify (INTK-04 mirror: "Request stopped — <reason>"), write terminal telemetry, `return null`.

**Per-user request rate limit lives in `requests.submit`** (tenantMutation), not the workflow: `rateLimiter.limit(ctx, "submitRequest", { key: ctx.tenantId })` before `validateSubmit` — immediate rejection UX, transactional, mirrors the existing rejection branch (audit `request.rejected` reason `rate_limited` + notification, no workflow started).

### Pattern 2: Redact-then-log made structurally hard to violate (GRDL-02)

Three reinforcing layers, cheapest first:

1. **Fail-closed safeText reader.** `llm.route/draft` stop calling `gmailAuth.getForDelivery` (which returns the raw goal). They call a new `internal.guardrails.getSafeText` internalQuery that returns `safeText` **or throws** when it is absent. The model call *cannot* obtain raw text: redaction-before-call becomes a runtime invariant, not a convention. (The `ponytail:` comment in llm.ts anticipated exactly this divergence.)
2. **`SafeText` brand type** in `packages/pii`: `type SafeText = string & { readonly __safe: unique symbol }`; `scanText` returns it; the cost estimator and any log-payload builder accept `SafeText`/hash types only. Compile-time discipline inside TS (brands erase at Convex arg boundaries — that's what layer 1 covers).
3. **Static-scan test** (the §4-style scanner the audit recommended — mirror `auditImmutability.test.ts` / `importGuard.test.ts`): a vitest that reads `llm.ts` source and asserts it contains no `getForDelivery` reference and no `.goal` property access; and reads `guardrails.ts` asserting `entities` never appears in an `audit.log`/`deadLetters` call site. Cheap, proven pattern in this repo.

### Pattern 3: The cache key problem and its resolution (GRDL-04)

`ActionCache` keys on **the cached action's args** (verified: README — "The cache key is the ActionCache's name and the arguments to the action"). Constraints: key must contain `tenantId` (locked), must NOT contain text (roadmap: hash, not safeText), must not contain `requestId` (would fragment the key — every request would miss). But the model needs the text.

**Resolution:** cached action args = `{ tenantId, safeTextHash, model, skillVersion }`; the action recovers the text via an index lookup:

```typescript
// convex.config.ts: app.use(actionCache)
import { ActionCache } from "@convex-dev/action-cache";
const draftCache = new ActionCache(components.actionCache, {
  action: internal.llm.draftUncached,
  name: "draft-v1",                    // bump to invalidate wholesale (removeAllForName)
  ttl: 1000 * 60 * 60 * 24 * 7,        // 7 days; expired entries purged on read + daily cron
});

// llm.draftUncached (internalAction, "use node"): args {tenantId, safeTextHash, model, skillVersion}
//   → ctx.runQuery(internal.guardrails.getSafeTextByHash, { tenantId, safeTextHash })  // index by_tenant_safeTextHash, fail-closed
//   → generateObject({ model, schema: draftSchema, system: skill.body, prompt: safeText, ... })
// llm.draft (internalAction wrapper the pipeline calls):
//   → smoke sentinel check FIRST (never touches the cache)
//   → ctx.runMutation(internal.guardrails.preCall)   // kill-switch + spend re-check per call
//   → draftCache.fetch(ctx, { tenantId, safeTextHash, model, skillVersion })
```

Key composition rationale (each member prevents a real staleness/leak bug):
- `tenantId` — cross-tenant leak prevention (locked decision; SC-4).
- `safeTextHash` — no text in the key (GRDL-02); needs new optional `requests.safeText`/`safeTextHash` fields + `by_tenant_safeTextHash` index. Same tenant + same hash ⇒ same safeText, so the lookup is deterministic.
- `model` — a downgraded (gpt-4.1-nano) draft must not be served when budget allows gpt-4o-mini, and vice versa.
- `skillVersion` (from `getActiveSkill`, which already returns `{ body, version }`) — a skill registry rollback/bump must invalidate cached drafts, or prompt governance (CLAUDE.md §5) is silently defeated by the cache.

**Regenerate MUST bypass or fork the key**: an identical-args `fetch` after "Ask for changes" returns the *same cached draft* — the user asks for changes and gets identical text. Use `fetch(ctx, args, { force: true })` on regenerate attempts (README-verified option), and when Phase 3 threads the review `instruction` into the draft prompt, that instruction is user text: scan it with `scanText` too and fold its hash into the key (e.g. hash of `safeText + "\0" + safeInstruction`).

**Route caching:** GRDL-04 says "LLM responses"; the draft is the expensive call. Caching `route` with the same wrapper is a copy-paste (`name: "route-v1"`, routing skill version). Recommend: cache both, same pattern — but draft alone satisfies the SC if plan budget is tight (Claude discretion).

**Hit/miss observability:** `cache.fetch` returns only the value — it does not report hit vs miss (LOW confidence there's any API for it; verify against installed types). Don't need it: have `draftUncached` write the audit event `llm.called` (payload: model id + requestId ref) when it actually runs. A cache hit = no new `llm.called` row. That is also exactly how SC-4's "cache hit returns without a model call" gets asserted in the smoke script. Telemetry on a hit: store `usage` inside the cached value and zero the cost contribution on hits (tokens weren't spent twice), or simpler — cached value carries `usage` and the pipeline records it with `costUsd: 0` plus an `llm.cache_hit` audit event.

### Pattern 4: Fallback + timeout inside the action; step retries OFF for LLM steps (GRDL-05)

```typescript
// inside llm.draftUncached / routeUncached ("use node")
try {
  return await generateObject({
    model,                                  // chosen by guard: gpt-4o-mini or gpt-4.1-nano
    schema: draftSchema, system: skill.body, prompt: safeText,
    abortSignal: AbortSignal.timeout(45_000),
    maxRetries: 1,                          // SDK default is 2; one transient retry is enough here
  });
} catch (e) {
  if (!isFallbackEligible(e)) throw e;      // config/auth/prompt bugs → workflow fails → DLQ
  // audit "llm.fallback" { fromModel, toModel, errorName } — names/ids only, never message text
  return await generateObject({ model: FALLBACK_MODEL, /* same */, abortSignal: AbortSignal.timeout(45_000), maxRetries: 0 });
}
```

**Error classification (`isFallbackEligible`, pure function in `packages/cost` or `packages/core` — unit-testable):**

| Error | Meaning | Action |
|---|---|---|
| `APICallError` with `isRetryable === true` (429/5xx/timeouts) | Provider/model transient | fallback |
| `NoObjectGeneratedError` (model emitted unparsable/schema-invalid output; carries `text`, `usage`, `cause`) | Model-quality failure — a *different model* is the fix | fallback |
| `RetryError` (SDK exhausted its internal retries) | Wrapped transient | fallback if last error retryable |
| Abort: `DOMException` name `TimeoutError`/`AbortError` (from `AbortSignal.timeout`) | Timeout | fallback (MEDIUM confidence on exact error shape through SDK v7 — verify with one runtime probe during implementation; match on `error.name` covers both) |
| `LoadAPIKeyError`, `InvalidPromptError`, `APICallError` non-retryable 4xx | Our bug / config | rethrow → DLQ |

Use `APICallError.isInstance(e)` / `NoObjectGeneratedError.isInstance(e)` (SDK-provided static checks) rather than `instanceof` (survives duplicate package instances). **`NoObjectGeneratedError.text` may contain model output — never put it in an audit/DLQ payload; log only `error.name`** (thrown error *messages* land in `deadLetters.error`, so rethrown errors must carry no content either — SDK messages are metadata-only, but do not wrap them with prompt text).

**Double-retry trap resolved:** the workpool default is `maxAttempts: 3` on every action step (`index.ts`). Left alone: 3 step attempts × (1+1 SDK retries + fallback) = up to 12 model calls for one draft. Per-step override is verified API: `step.runAction(internal.llm.draft, args, { retry: false })`. Recommendation: **`{ retry: false }` on both LLM steps** — in-action `maxRetries: 1` + one fallback attempt already covers transients; anything past that should dead-letter promptly, and every retry costs real money that the budget limiter would otherwise have to absorb. (Delivery/other steps keep the workpool default.)

### Pattern 5: Spend metering + kill switch (GRDL-06)

- **Per-user submit limit:** `new RateLimiter(components.rateLimiter, { submitRequest: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 } })`, `limit(ctx, "submitRequest", { key: tenantId })` in `requests.submit`. Token bucket = steady rate + small burst; keyed per tenant.
- **Global daily budget:** `dailySpendCents: { kind: "fixed window", rate: 500, period: 24 * HOUR }` (≈$5/day; knob in one place), **no `key`** = global, `count` = cents. Guard step `check()`s the estimate; after each real model call a mutation step (`recordSpend`) `limit()`s the **actual** cost in integer cents from `priceUsage(model, usage)` (use integer cents — don't rely on fractional counts). When exhausted, the *next* guard check fails closed → blocked. This makes runaway spend structurally impossible even if some future code loops model calls: the window runs dry.
- **Manual kill switch:** `guardrailConfig` single row `{ killSwitch: boolean, budgetUsdPerRequest, dailyBudgetCents }`, default-on-read (no row = defaults, switch off — zero migration). Flip via `internal.guardrails.setKillSwitch` internalMutation, run by the operator: `npx convex run guardrails:setKillSwitch '{"on":true}'`. Checked in `prepare` AND in `preCall` (so regenerate-loop calls mid-flight also stop). All limiter/config ops run in **mutation steps** (transactional; sidesteps the "can I call the limiter from an action" question entirely).
- **Actual cost finally lands in telemetry:** `pipeline.ts` `toUsage()` has `costUsd: 0` with a `ponytail:` note pointing at GRDL-03 — `priceUsage` from `packages/cost` is the "one place" it reserved.

### Pipeline wiring summary (order of steps)

```
setStatus("scanning")                      ← new status (optional but observable; SC-1)
guard = step.runMutation(guardrails.prepare)
if (!guard.ok) → setStatus("blocked") + audit guardrail.blocked + notify + writeTelemetry("blocked") + return
audit "request.redacted" { requestId, piiCounts, safeTextHash }        ← counts+hash only
setStatus("routing")
route = step.runAction(llm.route, { requestId, model: guard.model }, { retry: false })
recordSpend(actual route cost)             ← mutation step
setStatus("drafting")
draft = step.runAction(llm.draft, { requestId, model: guard.model }, { retry: false })   // wrapper: preCall → cache.fetch
recordSpend(actual draft cost — 0 on cache hit)
… review gate unchanged … (regenerate branch: llm.draft with force:true + preCall re-check)
… delivery unchanged …
```

### Anti-Patterns to Avoid
- **Throwing for expected guard rejections.** A throw fails the workflow → DLQ `failed` terminal — wrong outcome and wrong operator signal for a governed stop. Return discriminated results (the `gmail.send` `delivered:false` precedent) and own the `blocked` terminal in-workflow. Throws are for bugs.
- **Guard logic in the workflow handler body.** Handlers replay; all DB/limiter/config reads must be inside steps (mutations), never inline in the handler.
- **Passing `safeText` (or worse, `goal`) as a cached-action arg.** Args = cache key = stored in the component's tables. Hash only.
- **Putting `scan.value.entities` anywhere but the request content plane.** It's raw PII by definition; today nothing needs re-substitution (recipient is delivery-supplied) — recommend not persisting `entities` at all in Phase 3 (YAGNI until a re-substitution need exists; CKPT-03 revisits).
- **A new `"use node"` module.** The wrappers belong in `llm.ts` (already node, already annotated); DB lookups go in `guardrails.ts` (default runtime). A new node module re-triggers the TS circular-inference cliff for zero gain.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Response cache w/ TTL + cleanup | cache table + cron + expiry logic | `@convex-dev/action-cache` 0.3.1 | Locked decision; expiry-on-read + daily cron + `force`/`remove`/`removeAllForName` all exist |
| Rate limiting / spend windowing | counters table + window math | `@convex-dev/rate-limiter` 0.3.2 (installed) | Transactional, sharded, `count`-weighted consumption = cost budget for free |
| Retry/backoff around model calls | custom retry loops | AI SDK `maxRetries` + workflow workpool (per-step `retry` option) | Two retry systems already exist; the job is *coordinating* them (turn one off), not adding a third |
| Token counting | tiktoken integration | `Math.ceil(chars / 4)` heuristic in `packages/cost` | Threshold check, not billing; real cost uses SDK `usage`. Mark with a `ponytail:` ceiling comment |
| PII detection | anything | `packages/pii` `scanText` | Decided + tested; re-litigating it is out of scope |
| Timeout plumbing | Promise.race timers | `AbortSignal.timeout()` → `abortSignal` option | Documented SDK pattern; actually cancels the HTTP call instead of abandoning it |

**Key insight:** every guardrail primitive already exists as an installed (or decided) component; Phase 3's real work is one choke point (`guard → cache → model → fallback → record`) and the discipline that nothing routes around it.

## Common Pitfalls

### Pitfall 1: Cross-tenant cache leak via key omission
**What goes wrong:** cache key lacks `tenantId`; tenant B gets tenant A's draft.
**Why it happens:** action-cache keys on args invisibly — nothing forces tenant scoping (the cache lives outside `tenantQuery` wrappers).
**How to avoid:** `tenantId` is the first member of the cached action's args; the smoke test seeds two tenants with identical goals and asserts two `llm.called` audit events (no cross-hit).
**Warning signs:** cache hit rate "too good" across users in dev.

### Pitfall 2: Regenerate returns the identical cached draft
**What goes wrong:** "Ask for changes" → same args → cache hit → same text; the regenerate loop becomes a no-op that still burns a review attempt.
**How to avoid:** `force: true` on regenerate-path fetches; fold the (scanned) instruction hash into the key when instructions are threaded in.
**Warning signs:** regenerated draft byte-identical to the prior one.

### Pitfall 3: Retry multiplication (workpool × SDK × fallback)
**What goes wrong:** up to 12 model calls per step; latency and spend balloon; the budget limiter absorbs retries instead of real traffic.
**How to avoid:** `{ retry: false }` on LLM steps; `maxRetries: 1` primary, `0` fallback. One knob per layer, documented at the step call site.
**Warning signs:** telemetry `tokensIn` for one request ≫ estimate; duplicate `llm.called` audit rows per stage.

### Pitfall 4: PII escapes through the *error* plane
**What goes wrong:** a thrown error message containing prompt/output text lands in `deadLetters.error` or an audit payload; `NoObjectGeneratedError.text` is model output; `scan.entities` in any log is raw PII.
**How to avoid:** log `error.name` only; never interpolate text into thrown messages; the static-scan test asserts `entities` never reaches a log call site. `scanText`'s own Err messages carry only `typeof` info (verified in source) — keep it that way.
**Warning signs:** any `@`-sign or digit-run in an audit/DLQ payload during the smoke run.

### Pitfall 5: Guards break the offline smoke seam
**What goes wrong:** the SMOKE:: sentinel goal now flows through scan/budget/cache; a cached smoke draft masks regressions, or the guard blocks the sentinel (no AI_GATEWAY_API_KEY locally is fine — but a drained dev budget limiter would block smokes).
**How to avoid:** sentinel check runs FIRST in the `llm.draft`/`route` wrappers, before `preCall` and before `cache.fetch` (the sentinel contains no PII patterns, so `prepare`'s scan passes it untouched — verified against the detector regexes). Smoke runs still exercise `prepare` (scan+persist), which is what SC-1 needs.
**Warning signs:** `smoke:pipeline` hangs or blocks after guard wiring.

### Pitfall 6: TS circular-inference collapse (again)
**What goes wrong:** new internal calls from `llm.ts` (`getSafeTextByHash`, `preCall`, cache component types) tip sibling use-node modules to `any` (this exact thing happened when `gmail.ts` landed).
**How to avoid:** explicit return-type annotations on every new/changed action handler and every `ctx.runQuery/runMutation` result in node modules (guidelines §96); action-cache README itself flags the same need when returning `fetch` results.
**Warning signs:** typecheck green but IDE shows `any` on `internal.llm.*`.

### Pitfall 7: Schema/migration friction
**What goes wrong:** treating new fields as backfill work.
**How to avoid:** `safeText`, `safeTextHash` (requests) are `v.optional` — no backfill needed; new `"scanning"`/`"blocked"` status literals extend the union without touching old rows; `guardrailConfig` is default-on-read (no seed). No `@convex-dev/migrations` run is required this phase — note that explicitly in the plan so nobody invents one. `telemetry.writeTerminal` + `buildTelemetry` gain the `"blocked"` outcome.

## Code Examples

### action-cache registration + construction (source: get-convex/action-cache README, fetched 2026-07-12)
```typescript
// convex.config.ts
import cache from "@convex-dev/action-cache/convex.config.js";
app.use(cache);

// llm.ts
const draftCache = new ActionCache(components.actionCache, {
  action: internal.llm.draftUncached,
  name: "draft-v1",                 // versioning/group-removal handle
  ttl: 1000 * 60 * 60 * 24 * 7,     // ms; expired entries deleted on read + daily cron
});
const result = await draftCache.fetch(ctx, { tenantId, safeTextHash, model, skillVersion });
await draftCache.fetch(ctx, args, { force: true });   // regenerate path
```

### rate-limiter definitions (source: get-convex/rate-limiter README, fetched 2026-07-12)
```typescript
const rateLimiter = new RateLimiter(components.rateLimiter, {
  submitRequest:   { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  dailySpendCents: { kind: "fixed window", rate: 500, period: 24 * HOUR },
});
const st = await rateLimiter.limit(ctx, "submitRequest", { key: tenantId });   // { ok, retryAfter }
await rateLimiter.check(ctx, "dailySpendCents", { count: estCents });          // inspect, no consume
await rateLimiter.limit(ctx, "dailySpendCents", { count: actualCents });       // weighted consume
```

### Timeout + bounded retries on generateObject (source: ai-sdk.dev settings docs, fetched 2026-07-12)
```typescript
await generateObject({
  model, schema, system, prompt,
  abortSignal: AbortSignal.timeout(45_000),  // "optional abort signal … define a timeout"
  maxRetries: 1,                              // default is 2; 0 disables
});
```

### Per-step retry override (source: get-convex/workflow README, fetched 2026-07-12)
```typescript
await step.runAction(internal.llm.draft, args, { retry: false });  // overrides workpool default
// mutations: "exactly-once execution", retried only on system/OCC errors — app throws fail the workflow
```

### Cost package shape (pattern; pricing verified on vercel.com/ai-gateway/models, 2026-07-12)
```typescript
// packages/cost — pure TS, Result-typed like packages/pii
export const PRICING: Record<string, { inPerMTok: number; outPerMTok: number }> = {
  "openai/gpt-4o-mini":  { inPerMTok: 0.15, outPerMTok: 0.60 },
  "openai/gpt-4.1-nano": { inPerMTok: 0.10, outPerMTok: 0.40 },
};
// ponytail: chars/4 token heuristic — threshold check only; real cost prices SDK usage.
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
export function estimateCostUsd(model: string, tokensIn: number, expectedOut: number): Result<number, CostError>;
export function priceUsage(model: string, usage: { inputTokens?: number; outputTokens?: number }): Result<number, CostError>;
// unknown model / NaN → Err → caller fails closed (GRDL-03 "unknown/null results fail closed")
```

## State of the Art

| Old Approach (Phase 2 code) | Current Approach (Phase 3) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `llm.ts` reads raw goal via `gmailAuth.getForDelivery` | fail-closed `getSafeText` reader; raw goal unreachable from llm.ts | this phase | GRDL-01/02 structural |
| `const MODEL = "openai/gpt-4o-mini"` knob | `model` chosen by guard (default gpt-4o-mini, downgrade gpt-4.1-nano), passed as action arg | this phase | GRDL-03/05 |
| `toUsage → costUsd: 0` | `priceUsage` from `packages/cost` | this phase | OPSG-01 telemetry gets real cost |
| Workpool default retries on every step | `{ retry: false }` on LLM steps; in-action fallback | this phase | GRDL-05 without retry multiplication |
| rate-limiter registered, unused | submit limit + spend budget limiter | this phase | GRDL-06 |

**Deprecated/outdated:** nothing removed; the `SMOKE::` sentinel stays (still no mock-gateway smoke). The `ponytail:` slot comments in `llm.ts`/`pipeline.ts` get consumed and deleted as part of the wiring.

## Open Questions

1. **ActionCache hit/miss signal**
   - What we know: `fetch` returns the value; README shows no hit metadata.
   - What's unclear: whether 0.3.1 exposes any hit indicator on the return or a companion method.
   - Recommendation: don't depend on one — `llm.called` audit event from the uncached action is the hit/miss oracle (and doubles as SC-4's assertion). Check the installed `.d.ts` once during implementation; if a hit signal exists, use it for the `llm.cache_hit` audit event, else derive it.
2. **Exact abort-error shape through AI SDK 7 on `AbortSignal.timeout`**
   - What we know: `abortSignal` is a documented option; platform throws `DOMException` named `TimeoutError`.
   - What's unclear: whether the SDK rethrows it bare or wrapped (e.g. inside `RetryError`).
   - Recommendation: `isFallbackEligible` matches `error.name ∈ {TimeoutError, AbortError}` AND unwraps `RetryError.lastError`; add one unit test per shape. Verify with a 1 ms-timeout probe during implementation (single runnable check, ponytail-compliant).
3. **Cache `route` as well as `draft`?**
   - What we know: GRDL-04 says "LLM responses"; draft is the expensive call; the wrapper pattern is identical for both.
   - Recommendation: wire both (marginal cost is a second `ActionCache` instance); if plan scope needs trimming, draft-only still satisfies SC-4's letter — planner's call.
4. **`"scanning"` as a new visible status**
   - What we know: statuses are the product's live-progress surface (BETA-04); scan is fast (in-process regex).
   - Recommendation: include it — one union literal, and SC-1's "every request is PII-scanned" becomes user-observable; drop it only if the union churn annoys.
5. **Fractional cents in limiter `count`**
   - What we know: `count` is a number; docs don't state integer-only.
   - Recommendation: round up to integer cents (`Math.max(1, Math.ceil(usd * 100))`) — sidesteps the question and biases fail-closed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7 (+ convex-test 0.0.54, `@edge-runtime/vm`) in `packages/backend`; plain vitest in `packages/pii`/`packages/core`/`packages/cost`; node smoke scripts via `smokeRun.mjs` |
| Config file | existing per-package vitest configs; smoke scripts in `packages/backend/scripts/` |
| Quick run command | `pnpm --filter @pikar/backend test` (and `pnpm --filter @pikar/cost test` for the new package) |
| Full suite command | `pnpm -r test` then `pnpm --filter @pikar/backend smoke:guardrails && pnpm --filter @pikar/backend smoke:pipeline` (dev deployment running; banner-judged, never exit codes — Windows/Node24 rule) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRDL-01 | scanText fail-closed + placeholders | unit | `pnpm --filter @pikar/pii test` | ✅ (`packages/pii/src/scan.test.ts`, 8 green) |
| GRDL-01 | guard blocks on scan Err; safeText persisted before route | unit (convex-test) | `pnpm --filter @pikar/backend test -- guardrails` | ❌ Wave 0 (`convex/guardrails.test.ts`) |
| GRDL-02 | llm.ts cannot reach raw goal; `entities` never logged | static-scan test | `pnpm --filter @pikar/backend test -- llmRedaction` | ❌ Wave 0 (`convex/llmRedaction.test.ts`, mirrors `auditImmutability.test.ts`) |
| GRDL-02 | no raw PII in audit/telemetry after a PII-bearing run | smoke assert | `pnpm --filter @pikar/backend smoke:guardrails` (asserts no `@`/SSN pattern in audit rows for the cid) | ❌ Wave 0 (`scripts/run-smoke-guardrails.mjs` + `smokeAssert` additions) |
| GRDL-03 | estimate/downgrade/fail-closed on unknown model; priceUsage | unit | `pnpm --filter @pikar/cost test` | ❌ Wave 0 (`packages/cost/src/*.test.ts`) |
| GRDL-04 | tenant-isolated entries; hit skips model | smoke assert | `smoke:guardrails`: two tenants, identical goal → 2× `llm.called`; same tenant twice → still 1× `llm.called` for that tenant | ❌ Wave 0 |
| GRDL-05 | error classifier routes fallback vs DLQ | unit | `pnpm --filter @pikar/backend test -- fallback` (pure `isFallbackEligible`) | ❌ Wave 0 |
| GRDL-05 | fallback path end-to-end (offline) | smoke | extend sentinel grammar `SMOKE::route=direct_llm::fail=primary::` → wrapper's primary throws, fallback fixed draft returned; assert `llm.fallback` audit event | ❌ Wave 0 |
| GRDL-06 | submit rate limit rejects N+1; kill switch blocks; budget exhaust blocks | convex-test (limiter via mutation) + smoke (flip `setKillSwitch`, submit, assert `blocked`) | `smoke:guardrails` | ❌ Wave 0 |

**Component caveat:** convex-test with third-party components (action-cache, rate-limiter) requires registering component modules — friction this repo hasn't paid yet. Established house pattern is dev-deployment smoke scripts for component behavior (`smoke:pipeline` precedent); keep convex-test for pure/guard-mutation logic and let `smoke:guardrails` carry the component-integration SCs. Do not block plans on making convex-test load components.

### Sampling Rate
- **Per task commit:** `pnpm --filter @pikar/backend test` (+ the touched package's vitest)
- **Per wave merge:** `pnpm -r test && pnpm --filter @pikar/backend typecheck`
- **Phase gate:** full suite + `smoke:guardrails` + `smoke:pipeline` (regression: guards must not break the Phase-2 spine) green before `/gsd:verify-work`; SC-5 real-network fallback optionally eyeballed once against the dev deployment with the gateway key

### Wave 0 Gaps
- [ ] `packages/cost/` package scaffold + `src/*.test.ts` — covers GRDL-03
- [ ] `packages/backend/convex/guardrails.test.ts` — guard mutation branches (GRDL-01/06 fail-closed)
- [ ] `packages/backend/convex/llmRedaction.test.ts` — static scan (GRDL-02)
- [ ] `packages/backend/convex/fallback` classifier test — GRDL-05
- [ ] `packages/backend/scripts/run-smoke-guardrails.mjs` + `smokeAssert.ts` additions (blocked-status, no-PII-in-audit, cache-isolation, fallback-sentinel asserts) — GRDL-02/04/05/06
- [ ] `pnpm --filter @pikar/backend add @convex-dev/action-cache@0.3.1` + `app.use` + codegen (framework install for the phase)

## Sources

### Primary (HIGH confidence)
- Repo source read directly: `packages/pii/src/scan.ts`, `convex/llm.ts`, `convex/pipeline.ts`, `convex/lib/functions.ts`, `convex/requests.ts`, `convex/schema.ts`, `convex/audit.ts`, `convex/index.ts`, `convex/skills.ts`, `convex/convex.config.ts`, `package.json`, `scripts/run-smoke-pipeline.mjs`, `convex/_generated/ai/guidelines.md`
- https://github.com/get-convex/action-cache — README (constructor, args-based key, `fetch`/`force`/`remove*`, TTL + daily cron, return-type gotcha)
- https://registry.npmjs.org/@convex-dev/action-cache — latest **0.3.1**, published 2026-07-07, peer `convex ^1.24.8`
- https://github.com/get-convex/rate-limiter — README (configs, `limit`/`check`/`reset`, `key`/`count`/`reserve`/`throws`, keyless global limits)
- https://github.com/get-convex/workflow — README (per-step `{ retry }` override; mutation exactly-once semantics)
- https://ai-sdk.dev/docs/ai-sdk-core/settings — `maxRetries` default 2, `abortSignal` + `AbortSignal.timeout` example
- https://ai-sdk.dev/docs/reference/ai-sdk-errors — error class inventory; `AI_APICallError.isRetryable`/`statusCode`
- https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data — `NoObjectGeneratedError` properties (`text`, `response`, `usage`, `cause`)
- https://vercel.com/ai-gateway/models/gpt-4.1-nano — id `openai/gpt-4.1-nano`, $0.10/$0.40 per MTok, non-reasoning, 1M ctx
- https://vercel.com/ai-gateway/models/gpt-4o-mini — id `openai/gpt-4o-mini`, $0.15/$0.60 per MTok
- https://vercel.com/ai-gateway/models/gpt-5-nano — id `openai/gpt-5-nano`, $0.05/$0.40, reasoning model (rejected as fallback)

### Secondary (MEDIUM confidence)
- Rate-limiter usable from actions (component calls its own mutation) — inferred from client design; moot because all limiter ops are placed in mutation steps here.
- Abort error propagation shape through AI SDK 7 (`TimeoutError` name) — platform behavior verified, SDK pass-through unverified; mitigated in Open Question 2.

### Tertiary (LOW confidence)
- ActionCache exposing no hit/miss metadata — absence-of-evidence from README only; mitigated by the `llm.called` audit-marker design that works either way.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions read from npm registry/package.json; APIs from official READMEs/docs fetched today
- Architecture: HIGH — insertion points are literally marked in the repo; patterns reuse proven house precedents (gmail.send result-branching, INTK-04 rejection, static-scan tests, smoke scripts)
- Pitfalls: HIGH for cache-key/retry/PII-in-errors (derived from verified API semantics + repo history); MEDIUM for abort-error shape

**Research date:** 2026-07-12
**Valid until:** ~2026-08-11 (Gateway model pricing and pre-1.0 component APIs move fast; re-check action-cache version at install time)
