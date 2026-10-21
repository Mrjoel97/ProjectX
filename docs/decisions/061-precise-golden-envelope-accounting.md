# ADR-061: Use precise ledger accounting for new golden evaluation envelopes

Status: Proposed — offline implementation under review; no deployment or new paid-run authority.
Date: 2026-10-21

## Context

Staging evaluation `31a81b38` stopped after28 passing cases. Server errors from the same request
identified `EVAL_BUDGET_EXHAUSTED` in reservation admission and the Executive action. Its198 settled
provider calls cost `$0.14551101`, but per-call rounding consumed198 enforcement cents from the
approved200-cent envelope. The next complete call reservation could not fit the remaining2 cents.
The runner correctly stopped without replay, qualification evidence, activation or cleanup.
Normal guarded closure preserved the ledger. This is not evidence that the unattempted cases pass.

Whole-cent worst-case reservations are useful admission bounds. Rounding every settled sub-cent
charge up to a cent also makes a long evaluation stop far below its approved aggregate dollar cap.
Increasing the user's cap or replenishing a stopped envelope is not the repair.

## Proposed decision

Only newly opened isolated `family:"golden"` envelopes without an authoring probe receive an
immutable `accountingMode:"ledger-nanos-v1"` marker. Their aggregate admission uses the existing
bounded, exact-budget append-only ledger, in the same native transaction as reservation insertion.
It counts settled provider USD conservatively rounded upward to integer nanodollars, plus every
outstanding call's complete whole-cent reservation. One dollar is1,000,000,000 nanodollars; a cent
is10,000,000. Unsafe, duplicate or orphan ledger arithmetic fails closed.

The next call's unchanged worst-case ceiling must fit the remaining aggregate capacity. Unknown
charges retain their full hold. Integer bounds and the existing500-call/ledger limits bound both
arithmetic and queries. Indexed native reads and insertion remain in one transaction so competing
reservations and closure cannot independently admit the same capacity.

Existing envelopes lacking the marker retain their original limiter-based accounting. Newly
opened authoring probes, packs and vertical evaluation envelopes also retain that path. There is
no conversion, replenishment, reopening or caller-selected accounting override. Legacy exhausted
or closed budgets are not reused.

Per-call ceilings, provider bounds, tenant/deployment spend rails, expiry, breach checks, unknown
holds, native workflow/ingest closure checks and explicit single-attempt authorization remain.
The existing status shape retains exact provider `actualUsd` and conservative floor-cent
`remainingCents`; it does not relabel rounded operational ledger movements as provider bills.

## Consequences and verification

The same approved aggregate cap can fund many small calls without losing a whole cent per settled
call. Full outstanding reservations can still stop a run below its actual billed cap. Daily and
deployment rails remain independently conservative. A denied or uncertain action is not replayed.

Meaningful offline tests must cover the observed198-call pattern, full unknown holds, competing
reservations, boundary rounding/overflow/invalid ledgers, legacy preservation and closure/expiry
refusal. The evaluator identity must change with the accounting implementation. Free CI cannot
qualify the new behavior in staging: any deployment needs its own reviewed source authorization,
then a new versioned handoff and a separately approved full evaluation. No prior attempt supplies
passing evidence or new spending permission.
