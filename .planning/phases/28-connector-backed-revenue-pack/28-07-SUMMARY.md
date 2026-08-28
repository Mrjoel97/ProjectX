---
phase: 28-connector-backed-revenue-pack
plan: 07
subsystem: revenue-connectors
tags: [stripe, stripe-apps, oauth, payment-rail, read-only, provider-lane, owner-override]
requires:
  - 28-01 (stripe admission `approved_production` by OWNER OVERRIDE, one open condition)
  - 28-02 (@pikar/revenue contracts + finance core: Projection, Money, reconcilePayments, sumMoney)
  - 28-03 (sealed credential envelope, refresh lease + revision fence, 4-state revocation)
  - 28-04 (one-time tenant-bound OAuth state, GET-only allow-listed read transport, `PROVIDER_READ_PATHS.stripe = []` by decision)
  - 28-26 (provider gate plane; `readPathCount` wired into the pure eligibility rule)
provides:
  - "packages/revenue/src/providers/stripe.ts — native minor-unit normalization, list pagination, the five read paths and the poll budget"
  - "packages/revenue/src/providers/shared.ts — boundedWindow / normalizeAll / separateByCurrency, hoisted out of the QuickBooks provider"
  - "convex/stripeAuth.ts — Stripe App OAuth: authorize, callback with live/test-mode binding, rolling refresh, LOCAL-ONLY disconnect"
  - "convex/stripeConnector.ts — bounded reads over a five-member closed union, per-currency figures from finance.ts"
  - "convex/stripeConnector.stripeReadEvidence — the ungated internal read 28-24 drives"
  - "convex/stripeAuth.disconnectForTenant — the lane runner's local clear"
  - "connectorFetch.PROVIDER_READ_PATHS.stripe — five paths; this is the moment Stripe stopped failing closed"
  - "connectorFetch.readPages `stripeApiVersion` — one validated value, not a header map"
  - "connectorOAuth.postTokenForm `bearerAuth` — mutually exclusive with basicAuth"
  - "scripts/smoke-stripe-read.mjs — lane evidence producer + offline validator that refuses every dishonest revocation state"
affects:
  - "28-09 (connections UI + the /stripe/callback route — handleCallback has NO caller)"
  - "28-24 (the Stripe lane seal — still owes the live read and the revocation answer)"
  - "28-08 (PayPal: reuse providers/shared.ts; PayPal's revoke is the same `unsupported` shape)"
  - "28-12/28-13 (nothing consumes these projections yet)"
tech-stack:
  added: []
  patterns:
    - "the route the plan named was DEAD; the brief's corrected route was built and the plan's key_link deliberately abandoned"
    - "a mandatory config value with NO default beats a fabricated one — an unpinned API version is an unknown shape"
    - "evidence reports the version pin the DEPLOYMENT used, never one the operator typed"
    - "an unhonest state made unreachable by construction, not by the caller's manners"
key-files:
  created:
    - packages/revenue/src/providers/stripe.ts
    - packages/revenue/src/providers/stripe.test.ts
    - packages/revenue/src/providers/shared.ts
    - packages/backend/convex/stripeAuth.ts
    - packages/backend/convex/stripeConnector.ts
    - packages/backend/convex/stripeConnector.test.ts
    - scripts/smoke-stripe-read.mjs
  modified:
    - packages/revenue/src/providers/quickbooks.ts
    - packages/backend/convex/connectorFetch.ts
    - packages/backend/convex/connectorFetch.test.ts
    - packages/backend/convex/connectorOAuth.ts
    - packages/backend/convex/providerGates.test.ts
    - packages/backend/convex/lib/env.ts
    - packages/backend/convex/_generated/api.d.ts
    - docs/connectors/stripe-suitability.md
    - docs/playbooks/connector-stripe.md
    - docs/playbooks/revenue-connectors.md
    - docs/playbooks/connector-quickbooks.md
decisions:
  - "The plan's Connect-Extension route was NOT built: Extensions are deprecated and `read_only` is extension-only, so `oauth/deauthorize`, `Stripe-Account` and `read_only` are absent by decision and a source scan keeps them out"
  - "The disconnect makes ZERO upstream requests and records `unsupported` — there is no documented platform-initiated revoke, so `confirmed` and `attempted_failed` would both be fabrications"
  - "STRIPE_APP_API_VERSION is mandatory with NO default: an unverifiable version string is not worth inventing, and unset would read whatever version the tenant's dashboard is on"
  - "The evidence file's version pin is reported BY the deployment with each read, so the smoke script has no `--api-version` flag to fabricate one with"
  - "`payment_intents` and `balance_transactions` are not allow-listed: the first double-counts charges under the SAME authority, which `reconcilePayments` cannot de-duplicate"
  - "The gate is checked on the four TENANT actions, NOT inside the shared read (28-05/28-06 reached this first) — gating the evidence producer on the pass it produces would force 28-24 to seal first and verify after"
  - "The lane stays `parked` and `platform-initiated-revocation` stays UNCLEARED — no Stripe App credential exists in this deployment"
  - "REVN-03 stays PENDING: it needs 28-24's live gate, which this plan could not run"
metrics:
  duration: ~2h50m, one session
  completed: 2026-08-28
  tasks: 3
  tests_added: 125 (39 revenue + 86 backend) + 28 gate-validator cases
  commits: 5
---

# Phase 28 Plan 07: Read-only Stripe rail Summary

The payment rail: Stripe **App** OAuth with `*_read`-only manifest permissions, five bounded
list/retrieve reads pinned to a mandatory API version, and a disconnect that says out loud it did not
revoke anything upstream — **and that has never spoken to Stripe.**

## The plan's route was dead. The brief's was built.

28-07's frontmatter asked for a Connect **Extension** with `read_only` scope, `Stripe-Account`
headers and `oauth/deauthorize`. That route is closed, not gated: Stripe's own docs now read
*"You can no longer build new Connect extensions"*, and the Connect OAuth reference still says
`read_only` *"can only be specified for extensions"*. Nothing in this repo can become one.

So the plan's `key_links` pattern (`read_only|Stripe-Account|oauth/deauthorize`) was **deliberately
not satisfied**, and a source scan now keeps all three strings OUT of the lane. What was built
instead is a **Stripe App** with `stripe_api_access_type: "oauth"` declaring only `*_read`
permissions:

- consent at `https://marketplace.stripe.com/oauth/v2/authorize` — with **no `scope` parameter at
  all**, so there is no field in which a wider grant could be requested "for later";
- exchange and rolling refresh at `POST https://api.stripe.com/v1/oauth/token`, authenticated with
  the app developer's secret key through a new `bearerAuth` input on the shared `postTokenForm`;
- reads with the OAuth access token, which is already account-scoped — no `Stripe-Account` header.

**This is a stronger position than the QuickBooks lane, not a weaker one.** There, a write-capable
scope makes this repo's allow-list the entire containment story. Here the token *cannot express a
write at the vendor*, and the allow-list is the second boundary.

## The fail-closed handoff is discharged

`PROVIDER_READ_PATHS.stripe` was `[]` **by decision** from 28-04, and 28-26 wired its LENGTH into
`resolveProviderEligibility` precisely so Stripe could not be made available while it was empty. It
now holds five paths — `/v1/balance`, `/v1/charges`, `/v1/invoices`, `/v1/payouts`, `/v1/disputes` —
each with a parser in the pure module, compared against it in **both** directions by a test.

`node scripts/check-provider-lane.mjs --provider stripe --stage engineering`, before and after:

| Row | Before | After |
|---|---|---|
| adapter | PEND — admitted, not built | **OK** — `stripeAuth.ts`, `stripeConnector.ts` |
| read-only | PEND — no lane module to scan | **OK** — 2 modules read-only |
| allow-list | PEND — empty by decision | **OK** — 5 allow-listed paths |
| open-conditions | PEND — `platform-initiated-revocation` | **PEND — unchanged** |

`RESULT: consistent`, 1 row pending. **Consistent is not passed.**

`payment_intents` and `balance_transactions` are deliberately absent: the first reports the same
business activity as `charges` one step earlier, and both on the list means a projection can count
one payment twice — which `finance.reconcilePayments` cannot catch, because it de-duplicates across
*authorities* and these would be the same authority.

## Revocation: implemented honestly, and left open

Stripe documents **no** platform-initiated revoke or uninstall for Stripe Apps. Only the user can
uninstall; `account.application.deauthorized` reports it afterwards. Connect's `oauth/deauthorize`
belongs to the other flow.

So `disconnect` makes **zero** upstream requests. It clears the local ciphertext — a real and useful
act — and records `revocation.upstream = "unsupported"`.

- `classifyRevokeOutcome` returns `unsupported` for this provider **before it looks at a status
  code**, so `confirmed` is unreachable by construction rather than by this module's manners.
- The smoke validator **rejects every other upstream state**: `confirmed` and `attempted_failed` are
  fabrications on a route with no endpoint, and `not_attempted` would claim one exists that we
  skipped.
- A local clear must also carry `grantRemainsLiveUpstream: true` — the sentence the tenant is owed,
  in the artefact rather than left to prose.

**None of this resolves the condition.** `platform-initiated-revocation` stays UNCLEARED and 28-24
owns it. The admission is an **OWNER OVERRIDE recorded against the evidence**, and that is stated as
an override — never as a finding — in the module header, the playbook, the suitability record and the
smoke script's own output.

## The API version pin has no default, deliberately

Stripe pins its API version by request **header** with no query-parameter form. Unpinned, a read
silently takes whichever version the *connected account's* dashboard is on — which the tenant can
change under us — and a projection's meaning changes without a code edit.

`STRIPE_APP_API_VERSION` is therefore **required with no default**: unset or malformed, the lane
returns `unavailable` and makes no request. This repository cannot verify a currently-valid Stripe
version string offline, and inventing one would have been a fabricated fact.

`readPages` gained **one validated value**, `stripeApiVersion`, applied to a fixed header name and
rejected for any provider but Stripe. It is not a header map — that is the parameter `connectorFetch`
exists without.

And the evidence file names the pin **the deployment reported with each read**. The smoke script has
no `--api-version` flag, because an operator-typed version is an unverified claim about a shape: the
file would name a version the read never used and nothing downstream could tell.

## The 28.1 namespace boundary

Nothing under `packages/billing/`, `convex/billing*.ts` or any `BILLING_STRIPE_*` name was touched or
referenced. Two guards hold it: a source scan over every `convex/stripe*.ts`, and a `BILLING_STRIPE`
forbidden substring in the evidence validator.

The scan is run over **comment-stripped** source. Its first run went red on `stripeAuth.ts`'s own doc
comment explaining why `BILLING_STRIPE_*` must never appear — `env.test.ts`'s "guard catching its own
documentation" defect, recurring. The fix keeps that file's line-comments-first ordering, and a
companion test proves the stripper still catches a real reference.

## Task 3 could not run, and that is recorded rather than papered over

**There is no Stripe App credential in this deployment**, and the App itself is not registered. So
the plan's "create and run the live gate" became **create the gate, prove it offline, and stop**.

- `--self-test` builds a stub through the **same builder the live run uses**, feeds 28 mutated copies
  through the validator, requires every guard to fire, and prints
  *"THIS IS NOT A LIVE PASS … Nothing here has spoken to Stripe."*
- The stub is stamped `mode: "self-test"`; `--verify-evidence` prints
  ***"THIS FILE IS A STUB, NOT A LIVE PASS"*** on it.
- A bare run exits **2** with `LIVE_EVIDENCE_NOT_PRODUCED` rather than reading green while doing
  nothing.
- `docs/connectors/stripe-suitability.md` gained a *Lane gate status — 2026-08-28* section with the
  exact `npx convex env set` names and the two things a live run still lacks.

### What the owner must set for a live run

On the **deployment** (`cd packages/backend`, then `npx convex env set …`): `STRIPE_APP_CLIENT_ID`,
`STRIPE_APP_SECRET_KEY` (the **app developer's** `sk_…`, **not** `BILLING_STRIPE_SECRET_KEY`),
`STRIPE_APP_REDIRECT_URI`, `STRIPE_APP_API_VERSION`, and `CONNECTOR_CREDENTIAL_KEY_V1`.

A live run also needs the `/stripe/callback` route, which does not exist — `handleCallback` is an
`internalAction` with **no caller** (28-09) — and the Stripe App registration itself, which is an
owner action.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — Bug] The plan's whole route was factually dead**

- **Found during:** Task 1, reading the plan's `key_links` against the suitability record.
- **Issue:** the plan required `read_only`, `Stripe-Account` and `oauth/deauthorize`. Connect
  Extensions are deprecated, `read_only` is extension-only, and Connect's deauthorize is documented
  for a different flow — building toward any of the three would have produced a lane that cannot be
  installed and a revoke that reports success for a grant that is still live.
- **Fix:** built the Stripe App route; added a source scan asserting all three strings are absent.
- **Commit:** `d9da40e`

**2. [Rule 2 — Missing critical functionality] No way to pin the API version**

- **Issue:** `readPages` has no header parameter by design, and Stripe pins its version only by
  header. Without a pin, every projection's meaning is at the mercy of a setting the tenant controls.
- **Fix:** one validated `stripeApiVersion` value with a fixed header name, gated to Stripe, plus a
  mandatory no-default env name so the lane fails closed rather than reading an unknown shape.
- **Commit:** `f233cfd`

**3. [Rule 1 — Bug] Two tests asserted the state 28-07 exists to end**

- **Found during:** Task 2, the first whole-suite run.
- **Issue:** `connectorFetch.test.ts` asserted `PROVIDER_READ_PATHS.stripe` is `[]` and
  `providerGates.test.ts` asserted a Stripe seal is refused with `no_read_paths`. Both were correct
  and both had to change.
- **Fix:** replaced with the MECHANISM rather than deleted — a path off *any* provider's list fails
  closed and throws, and `readPathCount: 0` yields `no_read_paths` against the **pure rule**, which
  outlives whichever provider happened to be empty. The positive counterpart (a fully evidenced
  Stripe seal is now accepted) was added beside it.
- **Commit:** `f233cfd`

**4. [Rule 1 — Bug] A helper signature that lied, and an unverifiable evidence field**

- **Found during:** the Task-2 lint pass (`noUnusedFunctionParameters`).
- **Issue:** `totalsPerCurrency` handed the receipts callback a list of amounts it then ignored,
  because `receiptsTotal` takes a `Reconciled`. Separately, the evidence file's `apiVersion` came
  from the operator's shell, so a well-formed file could name a version the read never used.
- **Fix:** the receipts loop is explicit and no longer pretends to use the list; `StripeReadEvidence`
  gained `apiVersion` reported by the read itself, and the smoke script's `--api-version` flag and
  env fallback were removed.
- **Commit:** `e68c9a4`

**5. [Rule 3 — Blocking] `npx convex codegen` cannot run here**

- **Issue:** codegen needs a local backend on :3210, which is not running, so `_generated/api.d.ts`
  had no `stripeAuth`/`stripeConnector` entries and `tsc` failed on every `api.stripeAuth.*`.
- **Fix:** the four lines were hand-added exactly as codegen emits them, in alphabetical position —
  the same workaround 28.1-01 recorded.
- **Commits:** `d9da40e`, `f233cfd`

### Deliberate refactor

`boundedWindow`, `normalizeAll` and `separateByCurrency` were hoisted from
`providers/quickbooks.ts` to `providers/shared.ts` and re-exported (no behaviour change), before
PayPal made them a third copy. `connector-quickbooks.md` was bumped in the same phase.

**6. [Rule 3 — Blocking] The new `providers/shared.ts` was covered by no playbook**

- **Found by:** the Stop hook, NOT by my own run of the same script.
- **Issue:** CLAUDE.md §9 forbids finishing with a new code file under `packages/` that no playbook
  watches. `providers/shared.ts` was new and unregistered.
- **Why my verification missed it:** I ran `check-playbooks.mjs < /dev/null`, read an empty STDOUT
  and recorded it as a pass. That script **always exits 0** and produces nothing when fed no stdin —
  it is precisely the no-op gate that reads green this repo has a standing note about. An empty
  STDOUT from it is not evidence of anything.
- **Fix:** `packages/revenue/src/providers/shared` registered under `revenue-connectors.md` in
  `watch.json` (it is provider-agnostic, so it belongs to the shared playbook rather than to any one
  connector), and the playbook now documents the three helpers and the rule that nothing
  provider-specific may enter them.

## Verification

| Check | Result |
|---|---|
| `check-phase28-readiness.mjs` | exit 0, `passed` |
| backend `npx vitest run` (whole package) | **2913 passed / 108 files**; the non-zero exit is the pre-existing worker-teardown `process is not defined` |
| backend `npx tsc --noEmit` (run **separately**) | exit 0 — caught 2 real errors a green 76-test run was silent over |
| revenue `npx vitest run` | 265 passed |
| revenue `npx tsc --noEmit` (run **separately**) | exit 0 |
| `smoke-stripe-read.mjs --self-test` | 28/28 guards observed refusing; prints "NOT A LIVE PASS" |
| `smoke-stripe-read.mjs --verify-evidence <stub>` | accepts it **and** prints "THIS FILE IS A STUB, NOT A LIVE PASS" |
| `smoke-stripe-read.mjs` (bare) | exit **2**, `LIVE_EVIDENCE_NOT_PRODUCED` |
| `check-provider-lane.mjs --provider stripe` | `consistent`, 1 row pending — **not passed** |
| `check-playbooks.mjs` (manual) | exit 0, STDOUT empty — **and that was NOT a pass** |
| Stop-hook playbook check | **caught `providers/shared.ts` uncovered**; fixed in `watch.json` + `revenue-connectors.md` |
| `git diff --stat HEAD -- "*.ts"` | empty after committing |

A single `media.test.ts` failure appeared in one whole-suite run. It is an order-dependent **flake**:
that file passes alone (255/255) and the whole suite passed on a clean re-run (108/108, 2913/2913),
and `git diff --stat` proves this plan never touched it.

**Mutation checks, non-deletion (rename/substitution), each observed RED then restored:**

| Mutation | Observed |
|---|---|
| `STRIPE_GRANT_SCOPE` `stripe_apps` → `read_only` | **11 failed** of 49 |
| `modeMatches` compares `"production"` → `"sandbox"` | **4 failed** |
| authorize host → `connect.stripe.com` | **1 failed** (the literal pin) |
| `PROVIDER_REVOKE_SUPPORT.stripe` → `confirmed` | **6 failed** |
| **`moneyFromMinor` → `moneyFromNumber`** | **8 failed** of 39 — the double-conversion bug as a rename |
| `STRIPE_READ_PATHS.charges` → `/v1/payment_intents` | **1 revenue + 10 backend failed** |
| `gate.state !== "passed"` → `!== "parked"` | **11 failed** of 115 |
| `balance.available` → `balance.pending` | **1 failed** |
| `Stripe-Version` header renamed | **1 failed** |

Two blind spots addressed explicitly: `STRIPE_GRANT_SCOPE` and the authorize endpoint are asserted as
**literals once**, because a constant every other test imports cannot be pinned by mutating it; and
every guard scan compares a `path:boolean` string so a failure names *which* input escaped.

## Self-Check: PASSED

All files in `key-files` exist on disk. All five commits (`1a37fa2`, `d9da40e`, `8f30d7c`, `f233cfd`,
`e68c9a4`) are in `git log`.

## What this plan did NOT do

- **No live Stripe call of any kind.** REVN-03 stays **PENDING**; `requirements mark-complete` was
  deliberately not run.
- Did not clear `platform-initiated-revocation`, and did not soften the owner override.
- No `/stripe/callback` route and no connections UI — `handleCallback` has no caller (28-09).
- Did not register the Stripe App or author its manifest — an owner action.
- Did not read `payment_intents` or `balance_transactions`, and computed no aging (Stripe returns
  several currencies; `agingReport` needs one — 28-12 owns combining these with the books).
- No webhooks. `account.application.deauthorized` is recorded as the only deauth signal that exists.
- Left `packages/revenue/src/providers/quickbooks.test.ts`'s pre-existing biome formatter failure
  alone; logged to `deferred-items.md`.
