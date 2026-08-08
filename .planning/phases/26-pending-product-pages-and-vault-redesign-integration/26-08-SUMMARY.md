---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 08
subsystem: backend
tags: [finance, spend-ledger, media, webhook-replay, unlanded]

requires:
  - phase: 26-06
    provides: append-only spendEvents writer, coverage start, movement validation
  - phase: 26-07
    provides: the derive-vs-mint correlation policy and the recordMovement seam
provides:
  - Media whole-job reservation and per-line landing movements
  - The third and last instrumented rail, so a Finance window is no longer partly dark
affects: [26-09, media, finance]

tech-stack:
  added: []
  patterns:
    - a rail whose two planes deliberately diverge in amount, reconciled through `unlanded`

key-files:
  created:
    - .planning/phases/26-pending-product-pages-and-vault-redesign-integration/26-08-SUMMARY.md
  modified:
    - packages/backend/convex/media.ts
    - packages/backend/convex/mediaComplete.ts
    - packages/backend/convex/media.test.ts
    - docs/playbooks/media.md

key-decisions:
  - "THE LEDGER RECORDS `actualCents`, NOT THE LIMITER'S `delta` — the only rail where the two planes diverge in amount, and it is deliberate. The limiter took the whole batch estimate up front and never refunds (20-04), so at a landing it needs only the overrun. The ledger answers a different question: what did this line cost. Recording the delta would report an ordinary clip that came in at or under estimate as costing NOTHING, which is every normal landing."
  - "ONE `reserved` movement per BATCH, not per line. `chooseMediaBatch` floors the TOTAL exactly once (D12a), so per-line reserved rows would not sum back to the reserved figure."
  - "A FAILED line writes NO movement. It never landed, so its share of the reservation stays `unlanded` rather than being recorded as zero spend — the must_have's exact wording, and the same principle as 26-07's rolled window."
  - "The media rail has NO refund path at all and must not grow one silently. A test asserts zero `refunded` movements on this rail: if one ever appears, either the rail gained a credit path (a design change to be argued) or something is minting money the limiter never returned."
  - "BOTH sites DERIVE their correlation; neither mints a nonce. The reasoning rail's mint rule is wrong here — a reservation happens inside the plan's proposed→approved CAS (approve-once is reserve-once) and a re-delivered fal webhook is a replay, not a second charge."
  - "The `<jobId>` segment on the landing correlation is load-bearing: every line of a batch shares one `batchId`, so a batch-scoped correlation would let the first landing suppress all twelve siblings of a 13-line reel."
  - "Both writes are guarded on `> 0`, and the zero case is REAL rather than defensive. A voice take can price under half a cent; a zero-cent movement is rejected outright and inside `landResult` that throw would abort the landing transaction, failing a sub-cent take's own webhook. Rounding up to 1c would invent money the limiter never took. Skipping is honest and the share stays in `unlanded`."

patterns-established:
  - "A surviving mutation is a COVERAGE HOLE, not a passing grade. The `<jobId>` mutation passed all six tests because replay identity is (tenant, correlation, phase) and `reserved` ≠ `actual` masked the collision; the fix was a new test, not a code change."
  - "When a rail's limiter and ledger legitimately disagree on AMOUNT, say so at the site and reconcile through `unlanded` rather than bending either plane to match the other."

requirements-completed: []

duration: 1h 20m
completed: 2026-08-09
---

# Phase 26 Plan 08: Media Rail Ledger Instrumentation Summary

The third and last rail. Media now writes one `reserved` movement per batch and one `actual`
movement per landed line, both in the same transaction as the limiter movement. Generation behaviour
is unchanged: no price table, rounding point, submit path or sidecar proof moved.

- **Tasks:** 2 of 2 complete. **Commit:** `cadbb28`.

## Where the movements land

| where | phase | amount | correlation |
|---|---|---|---|
| `reserveProviderLinesInner`, after both `limit()` | `reserved` | `estCents` — the WHOLE job | `mediabatch:<batchId>` |
| `mediaComplete.landResult`, success path | `actual` | that line's `actualCents` | `mediabatch:<batchId>:<jobId>` |

## The one place the two planes diverge on purpose

Every other rail writes the same cents to both planes. Media cannot: the limiter consumed the whole
estimate up front and consumes only the positive `delta` at a landing, because **this rail has no
refund path by design**. The ledger records what the line *cost*. `reserved − actual` is then
exactly the never-returned over-reservation, which `aggregateSpend` already reports as **`unlanded`**
— the honest shape rather than a number bent to make the planes match.

## Verification

| Gate | Result |
|------|--------|
| `media` + `spendLedger` + `guardrails` | 214/214 |
| `@pikar/backend` full suite | 1284/1284 |
| `@pikar/backend` typecheck | clean |
| `node scripts/check-playbooks.mjs` | exit 0 |

**Mutation checks — three run, all three now caught, each by a different test:**

1. Record the limiter's `delta` instead of `actualCents` → the per-line amount test goes red.
2. Drop `<jobId>` from the landing correlation → the sibling-lines test goes red.
3. Record one line's estimate instead of the batch total → the whole-job reserve test goes red.

**Mutation 2 initially SURVIVED, and that is the most useful thing this plan found.** All six tests
passed with a batch-scoped landing correlation, because replay identity is
`(tenantId, correlationId, phase)` and `reserved` ≠ `actual` masked the obvious collision. The real
defect was between *siblings*: a 13-line reel would have recorded one clip and silently lost twelve.
The fix was a new test that lands two lines and asserts two distinct correlations — not a change to
the code, which was already right.

## Deviations from Plan

**[Rule 1 - Bug] Five existing audio tests went red the moment the ledger went in.** A voice take can
price under half a cent, so `Math.round` yields `0`, and `validateSpendMovement` rejects a zero-cent
movement — which inside `landResult` aborts the whole landing transaction, failing a sub-cent take's
own webhook. Guarded both writes on `> 0`, matching `prepare` and `settleFolder`. Rounding up to 1¢
was rejected: it invents money the limiter never took. The line's share simply stays in `unlanded`.
This is the sub-cent fidelity limit already recorded in `guardrails.md` "Known gaps"; media hits it
hardest because tts lines are routinely fractions of a cent while clips are not.

**Total deviations:** 1 auto-fixed (Rule 1). **Impact:** no generation behaviour changed.

## Issues Encountered

1. **Nothing here is live-verified and no media has been generated.** This is offline evidence
   against the real rate-limiter component only. Phase 20's own live gate remains the first
   end-to-end exercise of `reserveJob`, and `$0` has been spent on this rail.
2. **Sub-cent lines record nothing**, by the reasoning above. A tts-heavy job's ledger will
   under-report against its invoice by up to 1¢ per line while still agreeing with the limiter.
3. **`startCoverage` has still not been called anywhere.** All three rails now write, so 26-09 is
   the first plan that may legitimately open coverage — until it does, every tenant correctly
   reports `unknown` rather than an honest-looking zero.

## Next Phase Readiness

All three rails are instrumented. **26-09** can now build the Finance reads: `finance.ts` exposes
tenant summaries/series/ledger plus owner-only global rails, over `spendLedger.listEvents` and
`aggregateSpend`. Two things it must honour: open coverage explicitly (nothing has), and treat a
media window's `unlanded` as a first-class value rather than a rounding artifact — on that rail it is
the permanent, by-design over-reservation, not a transient in-flight balance.
