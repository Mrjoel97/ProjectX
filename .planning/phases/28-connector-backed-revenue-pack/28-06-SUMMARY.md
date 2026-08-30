---
phase: 28-connector-backed-revenue-pack
plan: 06
subsystem: revenue-connectors
tags: [quickbooks, intuit, oauth, accounting, rolling-refresh, read-only, provider-lane]
requires:
  - 28-01 (quickbooks admission `approved_production` on OWNER ATTESTATION, one open condition)
  - 28-02 (@pikar/revenue contracts + finance core: Projection, Money, agingReport, sumMoney)
  - 28-03 (sealed credential envelope, refresh lease + revision fence, 4-state revocation)
  - 28-04 (one-time tenant-bound OAuth state, GET-only allow-listed read transport)
  - 28-26 (provider gate plane; admission and lane as separate axes)
provides:
  - "packages/revenue/src/providers/quickbooks.ts — query-text construction, pagination, strict entity/money normalization"
  - "convex/quickbooksAuth.ts — realm-bound connect/callback/refresh/disconnect with a single-flight rolling refresh"
  - "convex/quickbooks.ts — bounded reads over a four-member closed entity union + two finance.ts-derived figures"
  - "convex/quickbooks.quickbooksReadEvidence — the ungated internal read 28-23 drives"
  - "convex/quickbooksAuth.disconnectForTenant — the lane runner's destructive revoke"
  - "scripts/smoke-quickbooks-read.mjs — lane evidence producer + offline validator that refuses to call a stub a pass"
affects:
  - "28-09 (connections UI + the /quickbooks/callback route — handleCallback has NO caller)"
  - "28-23 (the QuickBooks lane seal — still owes the live read, the live revoke and the partner tier)"
  - "28-12/28-13 (nothing consumes these projections yet)"
tech-stack:
  added: []
  patterns:
    - "the gate on the CONSUMER, never on the evidence producer — a pass you must hold to earn the pass is a decorative pass"
    - "one revokeAndClear body shared by the tenant action and the lane runner, so revoke-before-delete cannot drift"
    - "an evidence validator that refuses to assert a partner tier it does not know"
key-files:
  created:
    - packages/revenue/src/providers/quickbooks.ts
    - packages/revenue/src/providers/quickbooks.test.ts
    - packages/backend/convex/quickbooksAuth.ts
    - packages/backend/convex/quickbooks.ts
    - packages/backend/convex/quickbooks.test.ts
    - scripts/smoke-quickbooks-read.mjs
  modified:
    - packages/backend/convex/lib/env.ts
    - packages/backend/convex/_generated/api.d.ts
    - docs/connectors/quickbooks-suitability.md
    - docs/playbooks/connector-quickbooks.md
decisions:
  - "The gate is checked on the three TENANT actions, NOT inside the shared read — gating the evidence producer on the pass it produces would force 28-23 to seal first and verify after (28-05 reached the same conclusion for HubSpot)"
  - "The realm id is read out of the CIPHERTEXT and validated as numeric before the code is spent, because it becomes a path segment"
  - "Refresh has a lease AND a revision fence AND no retry on any failure class — Intuit revokes the grant when two refreshes race"
  - "QUICKBOOKS_HOME_CURRENCY is deployment config, not a caller argument: QuickBooks omits CurrencyRef entirely when multicurrency is off"
  - "The lane stays `parked` and `partner-tier-and-poll-budget` stays UNCLEARED — no Intuit credential exists in this deployment"
  - "REVN-02/REVN-05 stay PENDING: they need 28-23's live gate, which this plan could not run"
metrics:
  duration: ~3h across three sessions (two killed by rate limits)
  completed: 2026-08-28
  tasks: 3
  tests_added: 163 (73 revenue + 90 backend) + 22 gate-validator cases
  commits: 3
---

# Phase 28 Plan 06: Read-only QuickBooks rail Summary

The accounting rail: realm-bound Intuit OAuth with a single-flight rolling refresh, bounded
GET-only reads over four entities, and a lane gate that is runnable the moment credentials exist —
**and that has never spoken to Intuit.**

## What landed

**`packages/revenue/src/providers/quickbooks.ts`** — the pure normalizer. Query-text construction
(`SELECT * FROM <entity> WHERE TxnDate >= …`), Intuit's in-query `STARTPOSITION`/`MAXRESULTS`
pagination, and strict normalization of Invoice / Payment / Bill / Account into integer minor units
with an explicit currency. No Convex import, no URL, no request verb, no arithmetic.

**`packages/backend/convex/quickbooksAuth.ts`** — realm-bound `beginConnect` / `handleCallback` /
`refreshConnection` / `disconnect`. The refresh carries a per-connection lease *and* a `revision`
fence, and makes **exactly one attempt on every failure class**: Intuit's rolling refresh token can
have the whole grant revoked when two refreshes race, so a retry does not degrade the connection,
it kills it.

**`packages/backend/convex/quickbooks.ts`** — the reads. `readEntity` over a four-member **closed
union**, plus `receivablesSummary` and `cashOnHand`, which return `finance.ts`'s figures and compute
none of their own. An unavailable read yields `null` with `unavailable` coverage — never a zero
total, because "we could not see your books" and "you are owed nothing" are different sentences.

**`scripts/smoke-quickbooks-read.mjs`** — the lane evidence producer, with `--self-test` and
`--verify-evidence` offline and a live mode that needs credentials.

## The write boundary, since there is no read-only scope

`com.intuit.quickbooks.accounting` grants the **entire Accounting API, including writes**. Intuit
publishes no read-only accounting scope, so the compile-time allow-list is the only boundary that
exists. What holds it:

- **No request-method parameter anywhere in the lane.** `readPages` hardcodes GET and refuses a
  redirect. The one non-GET the whole connector plane can reach is `connectorOAuth.postTokenForm`.
- **No path parameter.** The caller names an entity from a closed union of four; the path is built
  from a pinned template plus the realm read out of the ciphertext.
- **No entity create/update export.** Nothing in the module can express a write.
- Enforced twice: the `read-only` row of `check-provider-lane.mjs` **and** a mirrored source scan
  inside `quickbooks.test.ts`, because a gate that only runs at release is a gate discovered at
  release.

## Task 3 could not run, and that is recorded rather than papered over

**There is no Intuit credential in this deployment.** The owner attested on 2026-08-27 that Pikar
holds Intuit production credentials; that attestation is testimony and is not a grant. So the plan's
"create and run the live report/revoke gate" became **create the gate, prove it offline, and stop** —
the same shape 28-05 used an hour earlier for HubSpot.

- `--self-test` builds a stub file through the **same builder the live run uses**, then feeds 22
  mutated copies through the validator and requires every guard to fire. It then prints, in its own
  output: *"THIS IS NOT A LIVE PASS … Nothing here has spoken to Intuit."*
- The stub is stamped `mode: "self-test"`, and `--verify-evidence` prints
  ***"THIS FILE IS A STUB, NOT A LIVE PASS"*** on it. A well-formed file is not evidence.
- A bare run with no tenant exits **2** with `LIVE_EVIDENCE_NOT_PRODUCED` rather than reading green
  while doing nothing.
- The validator refuses evidence that claims the open condition resolved, **and refuses evidence
  that asserts an App Partner Program tier at all** — "Builder = 500,000 CorePlus calls per
  workspace per month" is a documented ceiling for one tier, not this app's entitlement.
- `docs/connectors/quickbooks-suitability.md` now carries a *Lane gate status — 2026-08-28* section
  saying no live grant was available, plus the exact `npx convex env set` names below.

**Lane state:** `parked`. Open condition `partner-tier-and-poll-budget`: **UNCLEARED**.
`check-provider-lane.mjs --provider quickbooks` reads `consistent`, 1 row pending. **Consistent is
not passed.** 28-23 owns the seal.

### What the owner must set for a live run

On the **deployment** (`cd packages/backend`, then `npx convex env set …`):
`QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`,
`QUICKBOOKS_REDIRECT_URI` (must match the registered URI **exactly** or Intuit refuses the exchange),
`QUICKBOOKS_HOME_CURRENCY` (optional; unset mislabels a non-USD company's money as USD rather than
failing), and `CONNECTOR_CREDENTIAL_KEY_V1`. A live run also needs the `/quickbooks/callback` route,
which does not exist — `handleCallback` is an `internalAction` with **no caller** (28-09).

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — Bug] The gate was circular, and it would have made 28-23's seal decorative**

- **Found during:** Task 3, reading the plan's Task-3 verification against the Task-2 code.
- **Issue:** `readEntityRows` refused unless `providerGates` resolved `passed`. But the lane only
  becomes `passed` once a live read and a live revoke have been observed — through that same
  function. The only way to ever seal QuickBooks would have been to seal it **first** and verify
  afterwards, which publishes it into `availableProviders` for every tenant on evidence nobody has.
  That is precisely the collapse of the two axes `providerGates` exists to prevent, and 28-05 had
  already rejected it for HubSpot.
- **Fix:** The gate moved to `gatedRead`, which the three tenant-facing actions call. The new
  internal `quickbooksReadEvidence` calls `readEntityRows` directly — it still goes through the same
  allow-list, closed union, caps and GET-only transport; the only thing it skips is the lane check.
- **Proof:** two tests read the **same unsealed state** twice, once through each door, and require
  opposite answers.
- **Commit:** `3905c23`

**2. [Rule 1 — Bug] `convex/env.test.ts` was RED on four unclassified `QUICKBOOKS_*` names**

- **Found during:** Task 3 baseline. The Task-1/2 filtered runs never loaded `env.test.ts`, so the
  previous session's "green" was green over a red file — the same defect 28-05 shipped and fixed in
  `0dca7bd`, recurring one plan later.
- **Fix:** all four classified as `feature` tier in `ENV_MANIFEST`, and
  `QUICKBOOKS_REDIRECT_URI` added to `ORIGIN_ENV` (Intuit matches the redirect URI exactly, so an
  ephemeral origin is refused before the browser moves).
- **Commit:** `3905c23`

**3. [Rule 3 — Blocking] The lane runner had no reachable revoke**

- **Issue:** `disconnect` is a `tenantAction`; `npx convex run` carries no identity, so the smoke
  could not drive the revoke half of its own gate.
- **Fix:** the body was extracted to one `revokeAndClear` shared by `disconnect` and the new
  internal `disconnectForTenant`. **One** implementation deliberately: a second revoke path is a
  second chance for the upstream-first ordering to drift.
- **Commit:** `3905c23`

## Verification

| Check | Result |
|---|---|
| `check-phase28-readiness.mjs` | exit 0, `passed` |
| backend `npx vitest run` (whole package) | **2809 passed / 106 files**; the 1 reported "error" is the pre-existing worker-teardown `process is not defined` |
| backend `npx tsc --noEmit` (run **separately**) | exit 0 |
| revenue `npx vitest run` | 226 passed |
| revenue `npx tsc --noEmit` (run **separately**) | exit 0 |
| `smoke-quickbooks-read.mjs --self-test` | 22/22 guards observed refusing; prints "NOT A LIVE PASS" |
| `smoke-quickbooks-read.mjs --verify-evidence <stub>` | accepts the file **and** prints "THIS FILE IS A STUB, NOT A LIVE PASS" |
| `smoke-quickbooks-read.mjs` (no tenant) | exit **2**, `LIVE_EVIDENCE_NOT_PRODUCED` |
| `check-provider-lane.mjs --provider quickbooks` | `consistent`, 1 row pending — **not passed** |
| `check-playbooks.mjs` | exit 0, no output |

**Mutation checks, non-deletion (rename), each observed RED then restored:**

| Mutation | Expected | Observed |
|---|---|---|
| `gate.state !== "passed"` → `!== "parked"` in `gatedRead` | fail-closed tests die | **12 failed** of 90 |
| `condition.resolved !== false` → `!== null` in the smoke validator | the guard stops guarding | **SELF-TEST FAILED**, 1 guard |

## Self-Check: PASSED

All files listed in `key-files` exist on disk; all three commits (`e19af8b`, `d18a70e`, `e842993`,
`3905c23`) are in `git log`.

## What this plan did NOT do

- **No live QuickBooks call of any kind.** REVN-02 and REVN-05 stay **PENDING**;
  `requirements mark-complete` was deliberately not run.
- No `/quickbooks/callback` route and no connections UI — `handleCallback` has no caller (28-09).
- Nothing consumes these projections yet (28-12/28-13).
- The App Partner Program tier is still unknown, and the "Intuit recommends six months for report
  requests" figure remains **UNSOURCED** — recorded as unsourced rather than cited as Intuit's.
