---
phase: 28-connector-backed-revenue-pack
plan: 04
subsystem: connectors
tags: [oauth-state, csprng, sha-256, replay, redirect-hygiene, endpoint-allow-list, bounded-fetch, pagination, retry, partial-results, rate-limit]

# Dependency graph
requires:
  - phase: 28-connector-backed-revenue-pack (plan 28-17)
    provides: the landed-contract readiness gate (scripts/check-phase28-readiness.mjs, exits 0)
  - phase: 28-connector-backed-revenue-pack (plan 28-03)
    provides: the connectorOAuthStates table, newConnectionId, hashExternalAccountId, and the CONNECTION_FAILURE_CLASSES closed set
  - phase: 28-connector-backed-revenue-pack (plan 28-02)
    provides: PROVIDERS, CAPS (page/item/byte) and the Projection ready|partial|unavailable vocabulary
  - phase: 28-connector-backed-revenue-pack (plan 28-01)
    provides: the four admission decisions — QuickBooks' write-scope blast radius and Stripe's unsettled route are what shape the allow-list
  - phase: earlier (packages/backend/convex/lib/functions.ts)
    provides: tenantMutation / tenantQuery — the multi-tenant isolation linchpin
  - phase: earlier (packages/backend/convex/gmailAuth.ts, microsoftAuth.ts)
    provides: the two prior OAuth round-trips whose shared, weakening parts justified generalising at all
provides:
  - "connectorOAuth.ts — one-time tenant-bound OAuth state: mintConnectState (tenantMutation), consumeConnectState (internalMutation, no tenantId argument), pendingConnectStates (counts-only tenantQuery)"
  - "safeRedirectPath / callbackRedirectPath / CONNECT_RESULTS — a redirect that structurally cannot carry a secret"
  - "PROVIDER_REVOKE_SUPPORT + classifyRevokeOutcome — the honest four-state revocation answer at the callback edge"
  - "connectorFetch.ts — PROVIDER_API_ORIGINS, PROVIDER_READ_PATHS, isAllowedRead, buildReadUrl: the compile-time GET-only endpoint allow-list"
  - "readPages — cursor pagination under page/item/byte caps + a repeated-cursor guard, preserving completed pages on a later failure"
  - "classifyStatus / retryDelayMs / READ_TIMEOUT_MS / MAX_RETRIES / MAX_RETRY_DELAY_MS — the bounded retry seam"
affects:
  - 28-05..28-08 (every provider callback must call consumeConnectState BEFORE its code exchange; every provider read goes through readPages and must add its paths to PROVIDER_READ_PATHS)
  - 28-07 (owns filling PROVIDER_READ_PATHS.stripe, which ships EMPTY on purpose)
  - 28-09 (the callback HTTP route and the connections UI consume CONNECT_RESULTS and callbackRedirectPath)
  - 28-11 (finance projections consume ReadPagesResult.partial/capped to set honest coverage)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A compile-time endpoint allow-list with whole-segment equality matching and a single-segment {} placeholder — never a prefix or includes match"
    - "State is a CSPRNG nonce stored only as SHA-256 and burned in the same serializable mutation that read it — the atomicity is the platform's, no lease and no CAS"
    - "A guard's refusal returns a bare reason and none of the scope a caller would need to proceed anyway"
    - "Redirect targets validated by character allow-list, at the write AND again at the read"
    - "Every stop short of end-of-list is partial; capped distinguishes a repo-owned bound from a provider failure"

key-files:
  created:
    - packages/backend/convex/connectorOAuth.ts
    - packages/backend/convex/connectorOAuth.test.ts
    - packages/backend/convex/connectorFetch.ts
    - packages/backend/convex/connectorFetch.test.ts
  modified:
    - docs/playbooks/revenue-connectors.md

key-decisions:
  - "consumeConnectState takes NO tenantId argument — the tenant is read out of the row the state resolves to, so a callback can only ever reach the tenant that minted it"
  - "State is a server CSPRNG nonce hashed at rest, NOT an HMAC of the tenantId like gmailAuth/microsoftAuth — an HMAC binds the tenant but replays forever, and its signing key is the OAuth client secret"
  - "A refusal does not burn the row: a wrong-provider probe must not strand a user's legitimate in-flight consent"
  - "A refusal carries no tenantId, connectionId or redirectPath, so 'zero exchange, zero store' does not depend on the caller checking ok"
  - "connectionId is minted BEFORE the redirect, so the credential AAD tuple is fixed before any token exists and a callback cannot choose which connection its tokens bind to"
  - "readPages has NO method, origin, host, header or body parameter — for QuickBooks the allow-list is the ONLY thing between a stolen token and a write, since the accounting scope grants writes and Intuit ships no read-only alternative"
  - "PROVIDER_READ_PATHS.stripe ships EMPTY by decision, not omission — the Stripe App route is unsettled and its revocation condition is open, so Stripe currently reads nothing and fails closed"
  - "A Retry-After longer than MAX_RETRY_DELAY_MS means STOP, not retry sooner — Intuit's documented 60 s wait cannot be slept in an action and calling back early turns a rate limit into a ban"
  - "A timeout is NOT retried (the attempt already spent the whole budget); a network throw and a 5xx are"
  - "Malformed JSON is a non-retriable provider_error that keeps the pages that parsed"
  - "redirect: 'error' rather than following a 3xx — undici would replay the Authorization header at the new origin"
  - "Did NOT hoist a shared refresh routine, account verifier or normalizer: two concrete implementations must justify any further shared abstraction"

patterns-established:
  - "Mutation discipline: off-by-one on caps/counts and RENAME on status/header/path literals — deletion-only mutation cannot see a substring match"
  - "A constant the test imports cannot be pinned by mutating the constant; mutate the RELATION that uses it"
  - "When two guards sit in sequence (declared content-length, then measured bytes), disable each independently and require exactly one test to fail per guard"

requirements-completed: []

# Metrics
duration: ~50min (continuation agent; Task 1 landed in a prior session)
completed: 2026-08-27
---

# Phase 28 Plan 04: Shared OAuth and Bounded-Read Mechanics Summary

**A connector consent is now a one-time, tenant-bound, hash-at-rest nonce that is burned before any
code exchange, and every provider read is a hardcoded GET against a compile-time endpoint
allow-list under repo-owned page/item/byte caps that can only ever report `partial` — never a
shorter list that reads as complete.**

Nothing in this plan has spoken to a provider. All 68 tests are offline against an injected `fetch`
or a fake DB, at $0.

## What shipped

### Task 1 — one-time tenant-bound OAuth state (landed in a prior session, verified here)

`packages/backend/convex/connectorOAuth.ts` + `.test.ts` (30 tests), commits `6757a64` (RED) and
`48f5ef0` (GREEN). Verified present and committed before continuing; **not redone.**

The load-bearing property is that `consumeConnectState` **takes no `tenantId` argument.** A provider
callback arrives with a code and a state and no session; if it could also name a tenant, an attacker
who completes their own consent could graft their provider account onto someone else's tenant. The
tenant is read *out of* the row the state hash resolves to.

The state itself is 32 CSPRNG bytes stored only as its SHA-256 — deliberately **not** the
HMAC-of-tenantId pattern that `gmailAuth.ts` and `microsoftAuth.ts` already use twice. An HMAC binds
the tenant but replays forever, and its signing key is the OAuth client secret.

### Task 2 — the bounded read transport

`packages/backend/convex/connectorFetch.ts` + `.test.ts` (38 tests), commits `20488e6` (RED) and
`8eaca77` (GREEN).

The 38 tests were written before the module existed (previous session, uncommitted) and were treated
as the specification. **The implementation was built to them; they were not rewritten to suit it.**

Three things it structurally cannot do:

1. **Be steered.** There is no method, origin, host, header or body parameter. A caller supplies a
   provider, an environment and a path that must appear in `PROVIDER_READ_PATHS`; the verb is a
   hardcoded `GET` and `redirect: "error"` refuses to follow a 3xx (undici would replay the bearer
   at whatever origin the provider named). For QuickBooks this list is the entire containment story:
   `com.intuit.quickbooks.accounting` grants writes, Intuit publishes no read-only scope and will
   not constrain it, so the allow-list is what stands between a stolen token and a journal entry —
   which is exactly what 28-01's carried-forward item 1 made binding.
2. **Report a bound as a complete answer.** A page/item/byte cap, a repeated cursor, a 4xx, a 5xx, a
   network error, a timeout or malformed JSON all yield `partial: true`. `capped` further separates
   "a repo-owned bound fired" from "the provider failed". A 401 on page one is an **empty partial,
   never an empty success** — missing history is unknown, never zero.
3. **Leak.** Only the closed `ConnectionFailureClass` escapes. There is no `console.*`, no reach into
   audit/telemetry/dead letters, no Convex function declaration, and the bearer never appears in a
   result. Four source scans in the test file hold each of those.

Completed pages survive a later page's failure: a 500 on page three returns pages one and two.

### Task 3 — the playbook

`docs/playbooks/revenue-connectors.md`, commit `c799762` (+180/-11). New **"Shared connector
mechanics"** section covering the state lifecycle, the callback ordering contract (consume BEFORE
exchange), redirect hygiene, account binding, why refresh stays per-provider, the allow-list
extension rules, the retry/partial table and status/counts-only diagnostics. Invariant 8 rewritten
as LANDED; new invariant 14 for the unsteerable bounded read. `Last verified` bumped to `8eaca77`.

`watch.json` needed no change — its existing `packages/backend/convex/connector` prefix already
covers both new modules.

## Verification

| Gate | Result |
|---|---|
| `node scripts/check-phase28-readiness.mjs` | **exit 0**, run first, unpiped |
| `npx vitest run convex/connectorFetch.test.ts` (from `packages/backend`) | **38/38**, exit 0 |
| `npx vitest run convex/connectorOAuth.test.ts` | **30/30**, exit 0 |
| `npx vitest run` (whole backend) | **2641/2641**, 103 files, **exit 0** |
| `npx tsc --noEmit` (from inside `packages/backend`, run SEPARATELY) | **exit 0** |
| `pnpm --filter @pikar/backend typecheck` | **exit 0** |
| `npx biome check` on both new files | clean (after one real fix, below) |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | **empty stdout — no `"decision":"block"`** |
| `git diff --stat HEAD -- "*.ts"` | empty after every commit |

Note on the backend suite: 28-03 recorded `vitest run` exiting 1 on a fully passing 2571/2571 from a
pre-existing worker-level `process is not defined`. **That did not reproduce here** — the run was
2641/2641 at exit 0 with no `ReferenceError` in the output. Recorded as an observation, not a fix;
nothing in this plan touched it.

## Mutation evidence

Deletion-only mutation is worthless here, so every mutation was an **off-by-one** on a bound or a
**rename** of a literal. Each was applied to a pristine copy, run, and restored (`cmp` verified
clean after each batch).

| # | Mutation | Kind | Result |
|---|---|---|---|
| 1 | `pagesRead < maxPages` → `<=` | off-by-one | **RED** (1 failed) |
| 2 | `ms > MAX_RETRY_DELAY_MS` → `>=` | off-by-one (boundary) | **RED** (1) |
| 3 | `items.length = maxItems` → `maxItems - 1` | off-by-one | **RED** (1) |
| 4 | `retries < MAX_RETRIES` → `<=` | off-by-one | **RED** (1) |
| 5 | `headers.get("retry-after")` → `"retry_after"` | rename | **RED** (2) |
| 6 | `name === "TimeoutError"` → `"TimedOutError"` | rename | **RED** (1) |
| 7 | `"/v3/company/{}/query"` → `".../queries"` | rename | **RED** (3) |
| 8 | QuickBooks sandbox origin → the production origin | rename | **RED** (1) |
| 9 | `"/crm/v3/objects/contacts"` → `".../contact"` | rename | **RED** (19) |
| 10 | disable the **declared content-length** byte guard only | absorbed-guard probe | **RED** (exactly 1) |
| 11 | disable the **measured-bytes** byte guard only | absorbed-guard probe | **RED** (exactly 1) |

**One mutation survived, and it is a finding worth recording rather than a hole to patch.** Setting
`MAX_RETRIES = 2 → 3` left the suite fully green — because the test *imports* `MAX_RETRIES` and
asserts `expect(r.retries).toBe(MAX_RETRIES)`, so mutating the constant moves the assertion with it.
The constant's *value* is therefore not pinned; the *relation* is. Mutation 4 above (`<` → `<=`) is
the one that actually tests the guard, and it goes red. **Generalised rule for this repo: a constant
the test imports cannot be pinned by mutating that constant — mutate the relation that consumes it.**

### The absorbed-guard check (28-03's lesson, applied)

The byte cap is **two** guards in sequence — refuse on the declared `content-length` before touching
the body, then refuse on the measured bytes after reading it. That is exactly the shape that hid
28-03's CAS fence behind its lease check. Mutations 10 and 11 disabled each independently and
**exactly one test failed in each case**, so neither guard is absorbing the other's coverage. The
`bodyUsed === false` assertion is what makes the first one observable at all.

The allow-list-vs-request ordering has the same shape and is covered by an existing case: an
unallow-listed path rejects **and** `calls` is length 0, proving `buildReadUrl` refuses before any
request rather than a later guard catching it.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Unsafe optional chaining in the pre-written test file**

- **Found during:** Task 2, on `biome check`
- **Issue:** `connectorFetch.test.ts:225` read
  `(call.init?.headers as Record<string, string>).Authorization` — a real
  `lint/correctness/noUnsafeOptionalChaining` error. If `init` were ever undefined the line throws a
  `TypeError` instead of failing the assertion, so the case would report as an error rather than a
  clean red. This would have failed CI.
- **Fix:** widened the cast to `| undefined` and made the property access optional. **The assertion
  is unchanged** — an absent header still compares `undefined` against the expected bearer string
  and still fails. This is the one deliberate edit to the pre-written spec, and it changes a lint
  defect, not an expectation.
- **Files modified:** `packages/backend/convex/connectorFetch.test.ts`
- **Commit:** `20488e6`

**2. [Rule 3 - Blocking] Biome formatting on both new files**

Formatting-only (`biome check --write`); no logic touched. Tests and typecheck re-run green
afterwards, and the structural source scans still hold (they key off `export type ReadPagesOptions`
and the first `};`, which formatting preserved).

### Not a deviation, but worth stating

The plan's `files_modified` lists `connectorOAuth.ts` and `connectorOAuth.test.ts`. Those were
written and committed by Task 1 in the prior session (`6757a64`, `48f5ef0`) and this agent did not
touch them — verified by `git log` before starting. **No file the plan names went untouched across
the plan as a whole**, so there is no coverage hole.

The plan's stated verify command is `pnpm --filter @pikar/backend test -- connectorFetch`. That form
**does not filter** in this repo (the `--` is swallowed and the whole suite runs), and
`vitest --root <pkg>` from the repo root breaks convex-test's `_generated` glob. Both suites were
run by `cd`-ing into `packages/backend` and invoking `npx vitest run <file>` directly.

## Follow-ups for later plans

- **28-07 must fill `PROVIDER_READ_PATHS.stripe`.** It is `[]` today and Stripe consequently reads
  nothing. That is deliberate and fails closed, but it is not a finished state.
- **28-05/28-06/28-08 each add their own paths**, whole, per the extension rules now in the playbook.
  HubSpot ships with `/crm/v3/objects/deals` and `/crm/v3/objects/contacts`; QuickBooks with
  `query` and `reports` only; PayPal with `/v1/reporting/transactions` and `/v1/reporting/balances`.
- **Invariant 1 (read-only static reachability) still has no enforcement** — 28-26 owns it. The
  allow-list is a strong structural control but it is not the same thing as a scan proving no write
  endpoint is reachable from any specialist grant.
- `requirements-completed: []` — **REVN-01/02/03 stay pending.** No provider rail exists, no lane has
  passed, and all four open admission conditions survive untouched.

## Self-Check: PASSED
