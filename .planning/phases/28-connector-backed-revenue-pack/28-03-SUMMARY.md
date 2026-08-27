---
phase: 28-connector-backed-revenue-pack
plan: 03
subsystem: connectors
tags: [aes-256-gcm, web-crypto, aad, credential-envelope, oauth-state, schema, tenant-isolation, revocation, cas, lease, key-rotation]

# Dependency graph
requires:
  - phase: 28-connector-backed-revenue-pack (plan 28-17)
    provides: the landed-contract readiness gate (scripts/check-phase28-readiness.mjs, exits 0)
  - phase: 28-connector-backed-revenue-pack (plan 28-02)
    provides: PROVIDERS closed set + isProvider guard, the frozen contracts the envelope binds to
  - phase: 28-connector-backed-revenue-pack (plan 28-01)
    provides: the four provider admission decisions and their still-open revocation conditions
  - phase: earlier (packages/backend/convex/lib/functions.ts)
    provides: tenantQuery — the multi-tenant isolation linchpin
  - phase: earlier (packages/core/src/tenantData.ts)
    provides: TENANT_TABLE_CLASSIFICATION, the export/deletion policy every new table must join
provides:
  - "packages/revenue/src/credential.ts — AES-256-GCM seal/open bound by AAD to keyVersion|environment|tenantId|provider|connectionId"
  - "The connection vocabulary: CONNECTOR_ENVIRONMENTS, CREDENTIAL_KEY_VERSIONS, CONNECTION_STATUSES, REVOCATION_UPSTREAM_STATES, CONNECTION_FAILURE_CLASSES"
  - "Four additive Convex tables: connectorConnections, connectorOAuthStates, contactProviderRefs, providerGates"
  - "connectorCredentials.ts — internal credential lifecycle (get/upsertSealed/acquireRefreshLease/commitRefresh/recordRevocation/recordReadOutcome) plus ONE public read"
  - "A four-value revocation record that keeps 'we deleted our copy' distinct from 'the grant is dead upstream'"
  - "Per-connection refresh lease + compare-and-set fence for QuickBooks' rolling refresh token"
  - "Four pre-declared agentSteps.tool revenue literals with their cards.tsx VERB entries"
affects:
  - 28-04 (owns connectorOAuth.ts; consumes the connectorOAuthStates table landed here)
  - 28-05..28-08 (provider callbacks seal through requireCredentialKey and upsertSealed)
  - 28-09 (connections UI reads connectorStatuses and the providerGates table)
  - 28-12 / 28-13 (BOUND to the four pre-declared tool literal names)
  - 28-14 / 28-15 (must land the workflowPackEvents pack-id literals 28-03 deliberately did not)

# Tech tracking
tech-stack:
  added: ["@pikar/revenue as a workspace dependency of @pikar/backend"]
  patterns:
    - "AAD is a JSON ARRAY, not a delimiter-joined string — the encoding must be injective or the binding is forgeable"
    - "ONE sealed blob per connection, not one field per token, so a refresh replaces both atomically in a single patch"
    - "A key version reserved ahead of use (v2), so a rotation under pressure needs no schema edit"
    - "Disconnect CLEARS the ciphertext and KEEPS the row; erasure deletes the row — two different operations"
    - "Closed schema unions pinned to the pure package's closed sets by a runtime validator scan"

key-files:
  created:
    - packages/revenue/src/credential.ts
    - packages/revenue/src/credential.test.ts
    - packages/backend/convex/connectorCredentials.ts
    - packages/backend/convex/connectorCredentials.test.ts
  modified:
    - packages/revenue/src/index.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/isolation.test.ts
    - packages/backend/convex/_generated/api.d.ts
    - packages/backend/package.json
    - packages/core/src/tenantData.ts
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - docs/playbooks/revenue-connectors.md
    - docs/playbooks/cockpit.md
    - docs/playbooks/audit-dead-letter.md
    - pnpm-lock.yaml

key-decisions:
  - "revocation.upstream is a FOUR-VALUE enum (confirmed/attempted_failed/unsupported/not_attempted), never a boolean — three of the four admitted providers cannot be revoked server-side with confidence"
  - "recordRevocation clears the ciphertext but KEEPS the row, unlike gmailAuth.deleteTokens, because the surviving revocation record is the only place the honest answer can live"
  - "One sealed blob holding access + refresh + scope + account id, so QuickBooks' rolling refresh is a single-field atomic patch and the scope string stays out of the clear"
  - "Refresh needs BOTH a lease and a revision fence — a lease without a fencing token is a lock that lies"
  - "AAD encoded as a JSON array so the field concatenation is injective and cannot be forged across boundaries"
  - "keyVersion v2 declared ahead of use so key rotation is a data migration, not a schema change plus a deploy mid-incident"
  - "contactProviderRefs is a join table, not a field on contacts, because the reverse provider-id lookup needs an index an array field cannot give"
  - "providerGates carries admission AND lane separately: approved_production with a parked lane is the normal state for most of this phase"
  - "Did NOT extend workflowPackEvents — its packId is pinned to @pikar/core WORKFLOW_PACK_IDS and the seven Phase 28 names are 28-14's contract, not guessable here"
  - "Did NOT add a provider cache table — no plan asks for one (YAGNI)"

patterns-established:
  - "Mutation discipline: boundary off-by-one and wrong-identifier rename, never deletion — and a SURVIVING mutant is a finding, not a pass"
  - "Run tsc --noEmit separately from vitest, from inside the package: a green suite is not a typecheck"
  - "A new Convex table costs three edits — schema.ts, tenantData.ts classification, and NON_TENANT_LEADING for any non-tenant-leading index"

requirements-completed: []

# Metrics
duration: ~55min
completed: 2026-08-27
---

# Phase 28 Plan 03: Encrypted Credentials and the Additive Connector Schema Summary

**Connector credentials are now AES-256-GCM sealed and cryptographically bound to their exact
tenant/provider/connection/environment/key-version tuple, the whole Phase 28 schema landed in one
additive edit, and the revocation record is a four-value enum rather than a boolean — because for
three of the four admitted providers, deleting our local copy may be the only revocation Pikar can
actually perform, and the product must not claim otherwise.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3/3
- **Files created:** 4 (+11 modified)
- **Tests:** 55 new (25 envelope + 30 adapter). Revenue 104/104, backend 2571/2571, web 236/236 on
  the touched surface. `tsc --noEmit` exit 0 in `packages/revenue`, `packages/backend`,
  `packages/core` and `apps/web` — each run separately from vitest.

## Readiness Gate

`node scripts/check-phase28-readiness.mjs` was run FIRST, directly (not through a pipe), and exited
**0** over all 16 Phase 19/25/27 prerequisite rows. No implementation began before it was green.

## Accomplishments

### The envelope binds, it does not merely encrypt

`packages/revenue/src/credential.ts` is Web Crypto AES-256-GCM with a fresh random 96-bit IV per
seal — no cipher is implemented here (CLAUDE.md §8 rung 4). What it adds is what a primitive cannot
know: additional authenticated data covering
`keyVersion | environment | tenantId | provider | connectionId`. Ciphertext lifted out of one row
and dropped into another fails authentication instead of decrypting.

The AAD is a **JSON array, not a delimiter-joined string**, and that is load-bearing: `tenant|a` + `b`
and `tenant` + `a|b` join to identical bytes, so a delimiter encoding is forgeable across field
boundaries. JSON escapes its own separators, so the encoding is injective.

Copy-resistance is asserted **one case per AAD component** rather than once in aggregate — a single
forgotten component is invisible in a combined check.

### ONE sealed blob, not one field per token

The row stores a single `credentialCiphertextB64` holding access token, refresh token, granted scope
and the provider account id together. Three consequences, all deliberate:

- Replacing both tokens on refresh is a **single-field patch inside one Convex transaction**, so
  there is no window where a row holds a new access token beside a dead refresh token. That is what
  makes QuickBooks' rolling refresh survivable.
- The **granted scope string never sits in the clear** — a scope string is a capability inventory,
  which is `gmailAuth.gmailStatus`'s existing standing rule.
- The **provider account id never sits in the clear** either; only a SHA-256 `externalAccountHash`
  does, which is enough to prove a re-consent returned the same account.

### The revocation record does not lie

This is the plan's load-bearing decision. As of the 2026-08-27 admissions:

| Provider | Server-side revoke | What disconnect actually does |
|---|---|---|
| QuickBooks | confirmed endpoint | revoke, then clear locally |
| HubSpot | endpoint exists, cascade to ACCESS tokens **unproven** | revoke, clear, and record a `residualAccessUntil` window |
| Stripe Apps | **undocumented** (owner override, 28-24 open) | clear locally; the grant stays live until the user uninstalls |
| PayPal | **none documented anywhere** | clear locally; revocation is a seller account action, not an API |

A `revoked: boolean` would have collapsed all four rows into one claim. `revocation.upstream` is
therefore `confirmed | attempted_failed | unsupported | not_attempted`, and `recordRevocation`
**clears the ciphertext but keeps the row** — unlike `gmailAuth.deleteTokens`, which can safely
delete because Google's revoke is confirmed to kill the whole grant. Delete the row here and the
connections surface has nothing left to be honest with. Tenant *erasure* still removes the row: the
table is `tenant_credential` and rides the normal deletion walk. Disconnect and erasure are
different operations and now stay that way.

### Refresh: a lease AND a fence

Intuit documents that a second concurrent refresh does not merely fail — Intuit's servers may revoke
the token the *first* successful call issued, killing the connection and forcing re-consent. So:
`acquireRefreshLease` stops a concurrent refresher from starting, and `revision` is the
compare-and-set fence that stops one which already started, slept past its lease, and came back with
a stale credential. An expired lease is takeable, so a crashed refresher cannot wedge a connection
forever.

### Schema: four tables, strictly additive

No existing table or field was altered; nothing needs a backfill.

| Table | Classification | Notes |
|---|---|---|
| `connectorConnections` | `tenant_credential` | tenant × provider × environment; sealed credential + honest lifecycle; `by_tenant`, `by_tenant_provider_environment` |
| `connectorOAuthStates` | `tenant_credential` | SHA-256 of a server nonce (the nonce itself is never stored), consumed atomically; 28-04 owns the module |
| `contactProviderRefs` | `tenant_owned` | a JOIN to Phase 19 contacts — explicitly not a second person store |
| `providerGates` | `global` | deployment-wide, **no `tenantId`**; `admission` and `lane` kept separate |

### Public surface: exactly one function, and it is a read

`connectorStatuses` (a `tenantQuery`) projects provider, environment, status, timestamps, the closed
failure class, and `revocation.upstream` + `residualAccessUntil`. Absent **by construction**, not by
a filter someone could forget: ciphertext, IV, key version, connection id, external account hash,
revision, lease, and the provider's HTTP status code. A source scan in the test file fails if a
public write builder ever appears in the module — 28-RESEARCH forbids a public "store secret"
mutation.

## Mutation Testing — including one that SURVIVED

Four non-deletion mutations, each observed and restored.

| # | Mutation | Kind | Result |
|---|---|---|---|
| A | `IV_BYTES` 12 → 13 | off-by-one | **RED** (1 test). Round-trip still passed — WebCrypto accepts a 13-byte IV — which is precisely why the explicit length assertion is load-bearing. |
| B | AAD `scope.provider` → `scope.tenantId` | wrong-identifier rename | **RED** (the provider-swap case only, as intended) |
| C | `commitRefresh` patches ciphertext without the IV | atomicity | **RED** |
| D | `recordRevocation` forces `upstream: "confirmed"` | value | **RED** (2 tests) |

**A fifth mutation SURVIVED and that is the real finding.** Weakening the CAS fence from
`row.revision !== revision` to `row.revision < revision` left the entire suite green. Cause: after a
successful commit the lease is released, so my "a STALE revision is refused" test was being satisfied
by the **lease** check — the fence was never exercised. The test proved "the lease was released", not
"the fence works", over a guard I had just written a playbook invariant about.

Fixed by adding `"the FENCE refuses a stale revision even when the lease check would pass"`, which
renews the *same* lease id before retrying with the cached revision so only the fence can refuse.
The mutation now goes RED. This is the `green tests over broken capability` defect class, caught
inside the plan that introduced it.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] `@pikar/revenue` was not a dependency of `@pikar/backend`**
- **Found during:** Task 2
- **Issue:** The adapter must import `sealCredential`/`importCredentialKey` from the pure package
  (CLAUDE.md §1, §8 rung 2), but the workspace link did not exist.
- **Fix:** Added `"@pikar/revenue": "workspace:*"` to `packages/backend/package.json` and ran
  `pnpm install`. No dependency cycle: `@pikar/revenue` depends only on `@pikar/core`.
- **Files modified:** `packages/backend/package.json`, `pnpm-lock.yaml`
- **Commit:** 82d14a6

**2. [Rule 3 - Blocking] Four new tables had to be classified in `packages/core/src/tenantData.ts`**
- **Found during:** Task 2
- **Issue:** `isolation.test.ts` derives table coverage from the runtime schema in BOTH directions —
  an unclassified schema addition fails the suite. The file was not in the plan's `files_modified`.
- **Fix:** Added the four entries with the disconnect-vs-erasure reasoning. `audit-dead-letter.md`
  watches that path, so it was bumped in the same commit (CLAUDE.md §9).
- **Commit:** 82d14a6

**3. [Rule 3 - Blocking] `connectorOAuthStates.by_state` needed a `NON_TENANT_LEADING` entry**
- **Found during:** Task 2
- **Issue:** Every index on a `tenantId`-bearing table must lead with `tenantId` or name why it does
  not. An OAuth callback arrives with a nonce and no tenant at all — that is the entire reason the
  row exists — so this index structurally cannot lead with `tenantId`.
- **Fix:** Registered in `isolation.test.ts` with the consumer that makes it safe.
- **Commit:** 82d14a6

**4. [Rule 3 - Blocking] Tool literals cannot land without their `cards.tsx` VERB entries**
- **Found during:** Task 2
- **Issue:** The plan asks 28-03 to land "closed revenue tool literals". `traceParity.test.ts`
  asserts the `agentSteps.tool` set and the `cards.tsx` `VERB` key set equal **both ways**, so
  either half alone is RED. `cards.tsx` is nominally 28-16's file and is watched by `cockpit.md`.
- **Fix:** Landed both halves plus a `cockpit.md` bump. Four literals — `dispatchRevenue`,
  `readRevenueCrm`, `readBusinessFinance`, `stageInvoiceReminder` — pre-declared because 28-12 and
  28-13 cannot edit `schema.ts` and a missing literal is swallowed by the AI SDK (this union's
  fifth spring of that trap). **The names are now binding on 28-12/28-13.**
- **Commit:** 82d14a6

**5. [Rule 1 - Bug] Four real `tsc` errors under a fully green vitest run**
- **Found during:** Task 1
- **Issue:** 104 green tests over four TS 7 `Uint8Array<ArrayBufferLike>` vs
  `ArrayBufferView<ArrayBuffer>` errors in `credential.ts`. A fifth appeared in Task 2 (`.json` is a
  runtime getter on every Convex validator but is absent from `VObject`'s public type).
- **Fix:** Annotated `decodeB64`/`encodeB64`/`aad` as `Uint8Array<ArrayBuffer>`; cast the validator
  getter with a comment naming why. `tsc --noEmit` now exits 0 in all four packages.
- **Commits:** a86ca13, 82d14a6

**6. [Rule 1 - Bug] A test that proved the wrong thing** — the surviving CAS mutation above.
- **Commit:** 82d14a6

### Deliberate non-implementations (scope decisions, recorded rather than silently skipped)

**`workflowPackEvents` was NOT extended.** The plan says "Phase 27-compatible outcome fields only if
required". Its `packId` union is pinned to `WORKFLOW_PACK_IDS` in `@pikar/core` by a source scan, so
adding the seven Phase 28 workflow ids means editing `schema.ts` **and** `workflowPacks.ts` together
— and those seven names are 28-14's contract. Guessing them from a schema plan produces wrong names
with a green test over them. **Consequence, recorded in the playbook: 28-03 is the single schema
owner for the CONNECTOR tables only. 28-14 must own the pack-event literal edit, and 28-15 must not
emit a pack event whose `packId` has no literal** — the insert throws and the event vanishes.

**No provider cache table.** 28-RESEARCH permits "optional non-authoritative caches"; no Phase 28
plan asks for one. A speculative table with no reader is a migration nobody needed (CLAUDE.md §8
rung 1). Upgrade path recorded in the playbook: one table with an explicit freshness column, because
a cache without a visible retrieval time would break Invariant 6.

**No shared OAuth runtime.** 28-04 owns `connectorOAuth.ts`. This plan landed the *table* and left
the seam.

## Authentication Gates

None. Every test is $0 and offline — convex-test and Web Crypto only, no network, no provider, no
model call.

## Issues / Notes for Later

- **`tenantDelete.ts` does not know about connector connections.** Erasure *does* delete the rows
  (they are `tenant_credential`), but its per-provider disconnect report covers only Google and
  Microsoft — so it cannot say whether the four connector grants were revoked upstream, which per
  Invariant 12 is often "we could not". `tenantDelete.ts` belongs to `audit-dead-letter.md` and no
  Phase 28 plan currently claims it. Flagged in the playbook, not fixed here.
- **`vitest run` exits 1 in `packages/backend` on a fully passing suite.** Cause is a pre-existing
  worker-level `ReferenceError: process is not defined`, present **identically (7 occurrences) in
  the pre-change baseline**. All 2571 tests pass in both runs. Out of scope; noted so the next lane
  does not read it as new.
- **`CONNECTOR_CREDENTIAL_KEY_V1` is not set on any deployment yet.** Nothing needs it until the
  first provider callback lands (28-05..28-08). `requireCredentialKey` throws until it is; the
  playbook carries the generate/validate/rotate/loss procedure, none of which prints the key.
- **No lane has passed and no provider exists.** This plan delivered the ability to store a
  connector credential safely *if one ever arrives* — a precondition, not a feature. All four open
  admission conditions survive untouched, which is why `requirements-completed` is EMPTY.

## Self-Check: PASSED

All 7 named files exist on disk. All 3 commits (`a86ca13`, `82d14a6`, `5516a9d`) resolve in
`git log --all`. `git diff --stat HEAD -- "*.ts" "*.tsx" "*.md"` is empty — the committed tree is
the tested tree. Every file in the plan's `files_modified` was touched; the 11 additional files are
each accounted for under Deviations.
