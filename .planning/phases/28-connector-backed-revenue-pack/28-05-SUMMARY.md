---
phase: 28-connector-backed-revenue-pack
plan: 05
subsystem: revenue-connectors
tags: [hubspot, oauth, crm, read-only, revocation, provider-lane]
requires:
  - 28-01 (hubspot admission `approved_production`, one open condition)
  - 28-02 (@pikar/revenue contracts: Projection, SourceRef, MoneyFigure, CAPS)
  - 28-03 (sealed credential envelope, refresh lease + revision fence, 4-state revocation)
  - 28-04 (one-time OAuth state, GET-only allow-listed read transport)
  - 28-26 (provider gate plane; admission and lane as separate axes)
provides:
  - "packages/revenue/src/providers/hubspot.ts — HubSpot scope/endpoint/property allow-lists and total page parsers"
  - "convex/hubspotAuth.ts — connect, refresh, revoke, and probeRevocationCascade"
  - "convex/hubspot.ts — five bounded CRM read actions returning Projections"
  - "convex/connectorOAuth.postTokenForm — the ONE non-GET in the connector plane, shared"
  - "scripts/smoke-hubspot-read.mjs — lane evidence producer + offline validator"
affects:
  - "28-09 (connections UI + OAuth callback route — completeHubSpotConnect is waiting for it)"
  - "28-10/28-21 (attaching HubSpot refs to Phase 19 contacts)"
  - "28-22 (the HubSpot lane seal — still owes the open condition)"
  - "28-06/07/08 (postTokenForm is now the shared token POST)"
tech-stack:
  added: []
  patterns:
    - "compile-time property allow-list: never ASK the provider for PII, rather than filtering it out"
    - "the destructive probe as one action, because the token must not outlive it"
    - "an evidence validator that refuses to let its own file claim a verdict"
key-files:
  created:
    - packages/revenue/src/providers/hubspot.ts
    - packages/revenue/src/providers/hubspot.test.ts
    - packages/backend/convex/hubspotAuth.ts
    - packages/backend/convex/hubspot.ts
    - packages/backend/convex/hubspot.test.ts
    - scripts/smoke-hubspot-read.mjs
  modified:
    - packages/backend/convex/connectorOAuth.ts
    - packages/backend/convex/connectorFetch.ts
    - packages/backend/convex/lib/env.ts
    - packages/backend/convex/_generated/api.d.ts
    - docs/connectors/hubspot-suitability.md
    - docs/playbooks/connector-hubspot.md
    - docs/playbooks/revenue-connectors.md
decisions:
  - "The read/connect path does NOT check providerGates — gating it on a PASSED lane is circular, and the gate governs consumption"
  - "postTokenForm lives in connectorOAuth, not in each rail, which is what makes the lane checker's read-only scan literally true"
  - "hub_id account binding is opportunistic: undocumented on the 2026-03 token response, so absent means the check does not run, never that it passed"
  - "The revocation-cascade probe reports true/false/NULL — inconclusive is a first-class answer"
  - "REVN-01 stays PENDING: the lane is consistent, not passed"
metrics:
  duration: ~2h
  completed: 2026-08-28
  tasks: 3
  tests_added: 77
  commits: 3
---

# Phase 28 Plan 05: Read-only HubSpot rail Summary

A tenant-scoped, read-only HubSpot CRM rail that cannot ask for a person's name, cannot make a
non-GET request outside one shared token POST, reports a throttled or capped read as partial rather
than as zero, and records a disconnect as `confirmed` **with** a residual-access window because
HubSpot's revoke-to-access-token cascade is still undocumented — plus the probe that will settle it
and an honest record that it has never been run.

## What shipped

**The pure half** (`packages/revenue/src/providers/hubspot.ts`, 30 tests). The five evidenced read
scopes; the date-versioned `2026-03` OAuth endpoints pinned from the API reference rather than the
stale `working-with-oauth` guide; the five allow-listed CRM GET paths; three compile-time property
allow-lists; total parsers from raw contact/company/deal/owner/deal-pipeline pages into bounded rows;
and `hubspotProjection`, in which `capped` implies `partial` structurally.

**The auth lifecycle** (`convex/hubspotAuth.ts`). Connect URL over `mintConnectState`; callback
completion that burns the state *before* the exchange; `ensureHubSpotAccessToken` refreshing under
28-03's lease + revision fence; `disconnectHubSpot`; and `probeRevocationCascade`.

**The reads** (`convex/hubspot.ts`). One implementation behind a `tenantAction` (browser) and an
`internalAction` (lane runner), over `connectorFetch.readPages`.

**The shared token POST** (`connectorOAuth.postTokenForm`). One function, no method or header
parameter, `redirect: "error"`, status code out and never the response text.

**The lane gate** (`scripts/smoke-hubspot-read.mjs`). `--self-test` (20 cases, offline),
`--verify-evidence`, and a live read / `--revoke` probe.

## The open condition — NOT cleared, and the honest reason

`revoke-cascades-to-access-tokens` is **still open.** The plan required 28-05 to test it against a
live grant. The mechanism exists and is offline-proven in three directions (401 → cascade, 200 → no
cascade, anything else → `null`); **it has never been pointed at HubSpot, because no live grant,
client id or test portal exists for this deployment.**

That is recorded in `docs/connectors/hubspot-suitability.md` as "Observed result: NONE", not softened.
Three things enforce it rather than leaving it to good manners:

- `PROVIDER_REVOKE_SUPPORT.hubspot = "unproven"`, so `classifyRevokeOutcome` returns `confirmed`
  **with** `residualAccessUnproven`, and the rail sets `residualAccessUntil` from the access token's
  own expiry. A test asserts that window is non-null.
- The smoke's validator **refuses any evidence file claiming the condition is resolved**, and refuses
  a `confirmed` revoke with no proven cascade and no residual window.
- A backend test asserts the probe writes no `providerGates` row and leaves
  `PROVIDER_OPEN_CONDITIONS.hubspot` intact.

`node scripts/check-provider-lane.mjs --provider hubspot` reads `consistent` with the condition
`PEND`. **28-22 must not seal this lane until a live observation lands.**

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — Bug] The `revoked` branch was unreachable behind an outer ciphertext guard**
- **Found during:** Task 1, by a test the plan asked for ("revoke" path) — the outer-guard-absorbs-inner
  failure class this repo has now hit twice.
- **Issue:** `ensureHubSpotAccessToken` checked `!row.credentialCiphertextB64` before
  `row.status === "revoked"`. A disconnect clears the ciphertext and keeps the row, so every revoked
  connection reported `not_connected` — "you never connected this" instead of "you disconnected this".
- **Fix:** the `revoked` check moved above the ciphertext check, with a comment naming the ordering
  as load-bearing.
- **Commit:** `ccb0281`

**2. [Rule 2 — Missing critical functionality] No test covered the ciphertext guard**
- **Found during:** mutation testing — deleting the guard survived.
- **Fix:** added a test patching a `connected` row's ciphertext away. The guard is defence in depth
  (no code path reaches that state today) and is now pinned. Each guard now fails **exactly one**
  test when disabled independently.
- **Commit:** `ccb0281`

**3. [Rule 3 — Blocking issue] Three env names were read but never classified**
- **Found during:** the full-suite regression run, by `convex/env.test.ts`, which scans source for
  literal `process.env.X` reads and requires every one to appear in `ENV_MANIFEST`.
- **Issue:** `HUBSPOT_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` were unclassified, so the
  deployment readiness screen would have demanded nothing for a rail that cannot connect without
  them.
- **Fix:** all three added at `feature` tier (unset, the app runs and `requireHubSpotConfig` throws
  naming the variable), and `HUBSPOT_OAUTH_REDIRECT_URI` added to `ORIGIN_ENV` beside the Gmail and
  Microsoft callbacks — an OAuth callback minted from an ephemeral preview URL stops resolving.
  A comment records why `CONNECTOR_CREDENTIAL_KEY_V1/_V2` stay out: they are read through a
  computed `process.env[name]` the literal scan cannot see.
- **Commit:** `0dca7bd`

### Scope notes (not deviations, but worth naming)

- **The plan branches on `approved_beta`; the record says `approved_production`.** The suitability
  record states the production marker carries beta engineering authority (the beta stage was skipped,
  not passed), so the implementation path was taken and no `parked`/absence branch was written.
- **`postTokenForm` was added to `connectorOAuth.ts`, a file this plan did not name.** Necessary:
  `scripts/check-provider-lane.mjs` scans every `hubspot*.ts` module for `"POST"` and `fetch(`, so a
  rail with its own token POST trips its own gate. The checker's own comment already designates
  `connectorOAuth` as where a token exchange and revoke legitimately POST.
- **No OAuth callback HTTP route and no connections UI.** `http.ts` and the web app were outside this
  lane's ownership; `completeHubSpotConnect` is an `internalAction` waiting for 28-09.

## Verification

| Check | Result |
|---|---|
| `node scripts/check-phase28-readiness.mjs` (unpiped, first) | **exit 0**, all Phase 19/25/27 prerequisites landed |
| `npx vitest run src/providers/hubspot` (revenue) | **30/30** |
| `npx vitest run convex/hubspot.test.ts` (backend) | **47/47** |
| revenue full suite | **226/226**, 6 files |
| backend full suite (excluding the parallel agent's in-flight `quickbooks*.test.ts`) | **2718/2719, 104/105 files.** The single failure is `env.test.ts` reporting FOUR unclassified `QUICKBOOKS_*` names â the parallel agent's, not this lane's (this lane's three were found the same way and fixed, see deviation 3) |
| `npx tsc --noEmit` (revenue, separate) | **exit 0** |
| `npx tsc --noEmit` (backend, separate) | **exit 0 for this lane** — 42 errors present in the tree, all in the parallel 28-06 agent's uncommitted `quickbooks*.ts`; zero in any file this plan touched |
| `node scripts/check-provider-lane.mjs --provider hubspot` | **consistent**; `read-only 2 module(s)`, `allow-list 5 paths`, open condition `PEND` |
| `node scripts/smoke-hubspot-read.mjs --self-test` | **20/20 guards observed refusing** |
| bare `node scripts/smoke-hubspot-read.mjs` | **exit 2**, `LIVE_EVIDENCE_NOT_PRODUCED` — refuses to read green |
| `node scripts/check-playbooks.mjs < /dev/null` | blocks only on the parallel agent's `connector-quickbooks.md`; both playbooks this plan owns are satisfied |

**Backend baseline before this plan: 104 files / 2668 tests pass, 1 pre-existing worker-teardown
`ReferenceError: process is not defined`.** That teardown error did NOT reappear in the final run.

**A false alarm worth recording:** an earlier full run reported `media.test.ts` and
`vaultDigest.test.ts` failing. Both pass 264/264 in isolation â they were contention flakes from
running two full backend suites concurrently against one working tree. Do not chase them; do not run
two full suites at once here.

### Mutation testing — 10 mutations, ALL RED, zero survivors

All three known blind spots addressed explicitly.

| # | Mutation | Kind | Result |
|---|---|---|---|
| M1 | `crm.objects.deals.read` → `crm.objects.deal.read` | RENAME | RED |
| M2 | `HUBSPOT_OAUTH_VERSION` `2026-03` → `v3` | RENAME | RED |
| M3 | `/crm/v3/pipelines/deals` → `.../deal` | RENAME | RED |
| M4a | drop the `revoked` guard | guard, disabled ALONE | RED — **exactly 1** test |
| M4b | drop the ciphertext guard | guard, disabled ALONE | RED — **exactly 1** test (after the fix above) |
| M5 | `residualAccessUntil` always `null` | substitution | RED |
| M6 | a capped read may be `ready` | substitution | RED |
| M7 | an inconclusive post-revoke read reads as a cascade | substitution | RED |
| M8 | add `dealname` to the deal property allow-list | ADDITION | RED |
| M9 | invert the account-binding comparison | substitution | RED |

- **(a) deletion-only is blind to substring matching** — M1/M2/M3 are renames, and the assertions are
  whole-array/whole-string comparisons, not `includes`.
- **(b) an outer guard absorbs tests aimed at the inner** — M4a and M4b were disabled independently
  and each fails exactly one test. The first pass found M4b surviving; that hole was closed rather
  than accepted.
- **(c) a constant the test imports cannot be pinned by mutating it** — the scope set, the endpoint
  URLs, the read paths and the deal property list are each asserted against a **written-out literal**
  at least once, so mutating the constant moves it away from the literal.

## Notes for the next agent

- **Do not treat this lane as passed.** `consistent` ≠ `passed`. The one thing 28-22 needs is a live
  `--revoke` observation, and nothing in this repository has spoken to HubSpot.
- **`REVN-01` was NOT marked complete**, per the plan's own success criteria.
- **`connectorOAuth.ts` is contended, and the near-miss is worth knowing about.** While this plan
  ran, the parallel 28-06 agent had `classifyRevokeOutcome` mutated in the working tree to treat a
  400 as success (Intuit's rule) — a change to a SHARED function the HubSpot revoke also calls, under
  which a HubSpot 400 revoke would have reported `confirmed` with nothing in the HubSpot record
  supporting it. 28-05 staged only its own version via git plumbing rather than committing a
  neighbour's in-flight edit. **They then dropped it:** the landed `d18a70e` extends `postTokenForm`
  with an optional `basicAuth` and `asJson` (both opt-in, both unused by HubSpot) and leaves
  `classifyRevokeOutcome` alone. The hubspot suite is green against the landed version. **The lesson
  stands: never `git add` a shared connector file wholesale here.**
- **`hub_id` is the weakest link in re-consent binding.** If a live run shows it is always present on
  the `2026-03` token response, record that and make the binding check mandatory.

## Self-Check: PASSED

All six created files exist on disk; all three commits (`ccb0281`, `362dee8`, `0dca7bd`) exist in
`git log`. `git diff --stat HEAD` is empty for every file this plan owns, so the committed HEAD is
what was tested — not a partially staged tree.
