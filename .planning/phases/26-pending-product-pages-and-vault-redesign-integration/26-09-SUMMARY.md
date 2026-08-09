---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 09
subsystem: backend
tags: [finance, cost-console, rate-limiter, owner-auth, coverage, projections]

requires:
  - phase: 26-06
    provides: append-only spendEvents, coverage start, aggregateSpend/UNLANDED_RESOLVES
  - phase: 26-07
    provides: reasoning + ingest movements and the correlation policy
  - phase: 26-08
    provides: the media rail, so no window is partly dark
provides:
  - Tenant Cost Console projections that keep the enforcement and reporting planes apart
  - Owner-only deployment ceilings, kill switches and per-request budget, gated server-side
  - The plain-function halves of the ledger reads, so a tenantQuery can use them
affects: [26-10, finance, guardrails, spendLedger]

tech-stack:
  added: []
  patterns:
    - roll a limiter window forward with the component's own calculateRateLimit before display
    - a tenant projection reads the PERSONAL window only; the keyless ceiling is owner-gated
    - one upsert per config table, one audit row per accepted transition

key-files:
  created:
    - packages/backend/convex/finance.ts
    - packages/backend/convex/finance.test.ts
    - .planning/phases/26-pending-product-pages-and-vault-redesign-integration/26-09-SUMMARY.md
  modified:
    - packages/backend/convex/spendLedger.ts
    - docs/playbooks/dashboard-pages.md

key-decisions:
  - "THE TENANT SURFACE MUST NOT USE `guardrails.remainingDailyCents`. It returns `min(tenant, deployment)` — right for sizing a sub-agent envelope, an INFORMATION DISCLOSURE here, because that minimum tells every tenant how drained the keyless deployment ceiling is. `finance.summary` reads the personal window only; the three ceilings are `finance.globalRails`, an `ownerQuery`. A test drains all three deployment windows and asserts no deployment constant appears anywhere in the tenant payload."
  - "`getValue` RETURNS STORED STATE, NOT A ROLL-FORWARD, and a Finance tile is the second place that bites. `guardrails.refundableCents` already learned it by refunding 2900 against a capacity of 2500; here the failure is opposite and user-facing — a tenant whose window rolled overnight would be shown $0 left with no way to tell that from real exhaustion. `railView` rolls with the component's OWN exported `calculateRateLimit`, so a version bump moves it instead of silently desynchronising."
  - "`resetsAtMs` IS NOT MIDNIGHT ANYWHERE and the mockup's `resets 00:00 UTC` is only true for a rail nothing has ever spent from. A fixed window with no `start` is anchored to the rail's FIRST spend, so each rail resets on its own offset. The honest answer is the current window's end, returned as an epoch instant labelled `resetTimeZone: \"UTC\"` — the ENFORCEMENT clock, kept separate from `window.timeZone`, the browser display timezone that never reaches a query."
  - "THE REPORTED WINDOW REACHES `aggregateSpend` UNCLAMPED. Clamping it up to `coverageStartedAt` — the obvious `resolveDashboardWindow` coverage argument — turns an unknown stretch into a silently shorter window with a confident, wrong total. `unknown` has to be able to reach the page. Each `spendSeries` bucket aggregates on its own for the same reason, so a pre-coverage bucket says so rather than inheriting the window's verdict."
  - "READS GO THROUGH NEW PLAIN-FUNCTION HALVES IN `spendLedger.ts` (`coverageFor`, `listEventsFor`), not through re-implemented queries in `finance.ts`. A Convex query cannot `runQuery`, and the playbook's rule is that Finance is a READER that must not re-derive the subsystem — a second copy of the 500-row cap and the index choice is exactly that. The `reserveFolderInner`/`reserveFolder` precedent, verbatim."
  - "`mediaLedger` USES CONVEX'S NATIVE CURSOR PAGINATION. Every line of a batch shares one `createdAt`, so a hand-rolled timestamp cursor drops or repeats rows at a page boundary that lands inside a tie; the index cursor carries the document id and cannot."
  - "ONE AUDIT ROW PER ACCEPTED TRANSITION, NONE FOR A NO-OP (the `owner.bootstrapOwner` precedent). An event for a change that did not happen makes the log lie about when the deployment moved. Every mutation returns the RE-READ effective state rather than echoing its argument, so a write a concurrent transaction overwrote cannot be reported as success."
  - "The per-request budget's maximum is DERIVED from `DAILY_BUDGET_CENTS` ($5.00), not typed as its own constant: a per-request ceiling above the tenant's whole day is not a ceiling. The floor is $0.001 because below it every model choice is refused and the control becomes an accidental kill switch with no warning copy."

patterns-established:
  - "Before putting a rate-limiter figure in front of a person, ask what `getValue` actually returns. It is the last WRITE's state; a window that rolled with nothing written since reports yesterday."
  - "A helper that is correct for enforcement can be an information leak when reused for display. `min(tenant, deployment)` is the same arithmetic and a different disclosure."

requirements-completed: []

duration: 1h 40m
completed: 2026-08-09
---

# Phase 26 Plan 09: Tenant and Owner Cost Console Projections Summary

The backend half of the Cost Console. Tenant projections return the enforcement plane and the
reporting plane **side by side and separately labelled**, and the deployment plane is behind the
owner wrappers rather than behind a hidden button. No enforcement behaviour moved: no cap, refusal,
correlation, rounding point or refund rule changed.

- **Tasks:** 2 of 2 complete. **Commit:** `e983d45`.

## What the surface is

| function | wrapper | answers |
|---|---|---|
| `finance.summary` | `tenantQuery` | the three PERSONAL rails now, plus the window's tracked totals and coverage |
| `finance.spendSeries` | `tenantQuery` | the same window bucketed into UTC days, each bucket aggregated on its own |
| `finance.mediaLedger` | `tenantQuery` | media movements newest-first, natively cursor-paginated |
| `finance.globalRails` | `ownerQuery` | the three KEYLESS deployment ceilings, read separately |
| `finance.controls` | `ownerQuery` | the stored control state via the same default-on-read the guard uses |
| `finance.setMasterKillSwitch` / `setMediaKillSwitch` / `setPerRequestBudget` | `ownerMutation` | the writes |

## The two things that would have shipped a lie

**1. `min(tenant, deployment)` is an information disclosure on a tenant page.** The three existing
`remaining*Cents` helpers return the tighter of the two windows, which is exactly right for sizing a
sub-agent envelope and wrong here: it tells every tenant how drained the shared ceiling is. The
regression test drains all three deployment windows to zero, leaves the tenant's own barely touched,
and asserts the tenant still reads its own remaining figure — and that no deployment constant appears
anywhere in the serialized payload.

**2. `getValue` reports the last WRITE, not the present.** A tenant who spent their whole day
yesterday and has a full allowance today would have been shown `$0 left` with nothing to distinguish
it from real exhaustion. `railView` rolls the window forward with the component's own
`calculateRateLimit` — the same fix, and the same reasoning, as `guardrails.refundableCents`.

## Verification

| Gate | Result |
|------|--------|
| `finance` | 15/15 |
| `finance` + `owner` + `spendLedger` + `guardrails` | 77/77 |
| `@pikar/backend` full suite | 1304/1304 |
| `@pikar/backend` typecheck | clean |
| `npx biome check` on the three touched sources | clean |
| `node scripts/check-playbooks.mjs` | exit 0 |

**Mutation checks — five run, all five caught, each by a different test:**

1. Drop the roll-forward and read `getValue`'s stored value → the overnight-rollover test goes red.
2. Read `deploymentSpendCents` into the tenant's reasoning rail → the disclosure test goes red.
3. Clamp `windowSinceMs` up to `coverageStartedAt` → the pre-coverage test goes red (the window
   silently becomes `covered` with a confident total for a stretch nobody observed).
4. Audit on every call instead of only on a transition → the one-row-per-change test goes red.
5. Swap `ownerQuery` for `tenantQuery` on `controls` → the non-owner rejection test goes red.

## Deviations from Plan

**[Rule 2 - File list] `packages/backend/convex/spendLedger.ts` was modified, and it is not in the
plan's `files_modified`.**

- Why: `finance.summary` is a `tenantQuery`, and a Convex query cannot `ctx.runQuery`, so
  `spendLedger`'s `coverage` and `listEvents` internalQueries are unreachable from it.
- Alternative rejected: re-querying `spendEvents`/`spendCoverage` directly inside `finance.ts`. That
  would put a second copy of the 500-row cap and the index choice in a module the playbook
  explicitly designates a READER that "must not re-derive any of it".
- What changed: additive only — `coverageFor`, `listEventsFor` and `SPEND_EVENT_PAGE_LIMIT` were
  extracted, and the two internalQueries now delegate to them. No behaviour moved, and the
  insert-only source scan still passes (nothing mutating was added).
- The file is watched by `dashboard-pages.md`, the playbook this plan already owns, so the watcher
  needed no new registration.

**Total deviations:** 1 (Rule 2). **Impact:** none on behaviour; `spendLedger.test.ts` is unchanged
and green.

## Issues Encountered

1. **Nothing here is live-verified.** These are offline projections against the real rate-limiter
   component and directly-inserted ledger rows. No money has moved through any rail; the first real
   exercise is 26-10's authenticated browser gate and its owner UAT.
2. **A capped window under-reports and only says so in `bound`.** `listEventsFor` returns at most 500
   rows, so `tracked.totals` for a busy month is a floor, not the total. The `partial` + `"row-cap"`
   pair is the only thing standing between that and a quietly wrong number on the page — 26-10 must
   render it, and a component test should assert it does.
3. **`spendSeries` and `summary` each read the window separately.** Two subscriptions, two reads of
   the same rows. That is deliberate (26-10's key_link wants a ledger error not to erase the live
   rails) but it is duplicated work, and a shared bounded read is the upgrade path if it ever shows.
4. **The mockup's "resets 00:00 UTC" is not what the limiter does** and the copy will need to change
   in 26-10. Each rail's window is anchored to its own first spend.
5. **`folder.spentCents` is still permanently 0** (carried from 26-07). Finance does not read it, but
   a zero money field beside a real ledger still invites someone to believe it.

## Next Phase Readiness

Ready for **26-10** (the connected route). The contract it consumes:

- `summary` → `{ window, rails[3], coverageStartedAt, tracked, unlandedResolves, bound }`.
  `tracked` is a `SpendAggregate`: either `{coverage:"unknown", reason}` or
  `{coverage:"covered", totals, byRail}`. **Never render an `unknown` window as `$0`.**
- `unlandedResolves.media === false` — media's unlanded money is a PERMANENT over-reservation, not
  "pending". The copy for the media rail must differ from the other two.
- `rails[].resetTimeZone` is `"UTC"` and is the ENFORCEMENT clock; `window.timeZone` is the browser
  display timezone with `timeZoneSource: "browser-fallback"`. They are two different labels and the
  page must not merge them.
- `bound.partial` on `summary`/`spendSeries` means the totals are a floor.
- `controls.*.requiresConfirmation` is `true` on all three; the console must honour it.
- Non-owner: `globalRails`/`controls`/the setters throw `OWNER_REQUIRED`. Use `api.owner.viewer`
  (a `tenantQuery` that returns one boolean) to decide whether to mount the section at all.
