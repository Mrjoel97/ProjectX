# ADR-047 — The billing ledger keeps its Stripe ids, and the two tables ADR-044 never checked

- **Status:** Accepted
- **Date:** 2026-09-09
- **Owner decision, 2026-09-09:** close the second half of ADR-044 D3 (`billingEvents`) so the WORM
  triggers stop waiting on it.
- **Supersedes:** nothing. ADR-044 and ADR-045 are Accepted and immutable. ADR-044 D3 left the
  `billingEvents` choice open and ADR-045 explicitly declined it ("What this does NOT close"); this
  ADR makes it, and records two findings that change what the question was.
- **Related:** ADR-002 (audit posture), ADR-044 (the archive claim), ADR-045 (the admission bridge).

## Context

ADR-044 D3 named the choice: *"For `billingEvents`, the choice is between severing the Stripe id and
narrowing the claim."* 47-05 narrowed the claim. This ADR answers whether to also sever, and it
starts by measuring the thing everyone has been reasoning about from the source.

### C1 — the entire billing bridge is LATENT. Every table is empty on production.

Measured 2026-09-09 against `prod:opulent-octopus-494`, with `audit` (672 rows) and `users` as the
positive control on the same connection — so `EMPTY` below is a reading, not a mis-pointed CLI:

| table | classification | production |
| --- | --- | --- |
| `billingEvents` | `audit_immutable` | **empty** |
| `billingCoverage` | `audit_immutable` | **empty** |
| `billingCustomers` | `tenant_owned` | empty |
| `betaInvites` | `admission_plane` | **empty** |
| `deadLetters` (billing rows) | `audit_immutable` | **none** — all 9 rows are workflow-source |
| `audit` (Stripe-shaped payload keys) | `audit_immutable` | **none** across all 672 rows |

Two consequences. First, **ADR-045's D2 sweep has no population**: it clears `betaInvites`
redemptions whose user row is gone, and there are no rows. ADR-044 T2's "the sweep has run" is
satisfied by measurement rather than by a write, and no destructive mutation was run to satisfy it.
Second, `billingEvents` could be reshaped today at zero cost — and after the first live delivery,
never again without *mutating* an `audit_immutable` table, which is the posture ADR-002 forbids.
That window is real, and it is why this decision was worth making now rather than at first payment.

### C2 — severing `stripeObjectId` would not close the bridge, and this is the crux

`billingEvents` carries the Stripe id **twice**: once in `stripeObjectId`, and once inside
`correlationId`, which is built as `billing/<stripe id>` at exactly one place
(`packages/billing/src/reconcile.ts:120`). ADR-044 C2 says so itself. So:

- **Nothing reads `stripeObjectId`.** Verified exhaustively: one write path
  (`billingLedger.ts:153`, fed from `billingWebhook.ts:545`), one test insert, **zero** reads, zero
  index usage, zero projection into a return validator, zero UI. The `stripeObjectId` rendered in
  `BillingPanel.tsx` is `billingUnapplied`'s field — a different table, `tenant_owned`, erased.
- **`correlationId` is load-bearing.** It is the dedupe identity `(tenantId, correlationId, phase)`
  and the `by_correlation` index. Different Stripe events must derive the *same* correlation to
  pair up — `actual` and `refunded` both correlate on the PaymentIntent — and that pairing is pure
  string equality.

Removing `stripeObjectId` alone therefore deletes a **duplicate** of the bridge and leaves the
bridge. A change that reads as a privacy win in a commit subject while delivering none is the
provenance-laundering pattern this repo keeps catching; the risk here is specific, because a future
reader would see the field gone and conclude C2 was closed.

### C3 — hashing the correlation id buys nothing, against either threat model

The remaining option is to hash the id inside `correlationId`. It is mechanically viable: nothing
anywhere splits, slices or prefix-matches a correlation (grepped), so `billing/<digest>` would
preserve both the index lookup and the replay guard, and it fits both length validators. It fails on
what it would actually achieve.

- **Against ourselves — no.** We hold the Stripe account. Stripe retains Customers, invoices and
  credit notes indefinitely and lists them by API. Enumerate them, hash each id, match against
  `correlationId`, and the join is back. A one-way function whose preimage set is *"objects we can
  list on demand"* is not one-way to us. A defence that only inconveniences its own operator is a
  claim, not a control.
- **Against a database leak — also no.** An attacker holding the rows but not the Stripe account
  gains nothing from `pi_3Qx…` that they would not gain from its digest: for an erased tenant the
  `tenantId` is already dangling, and a Stripe id resolves to a person only through Stripe. The
  hash defends the one case where the raw id was already useless.

## Decisions

**D1. `billingEvents` KEEPS its Stripe ids, raw, in both places. The claim stays narrowed.**
This is ADR-044 D3's "narrowing" branch, chosen deliberately over "severing" because C2 and C3 show
severing is unavailable rather than merely expensive. The archive statement shipped in 47-05 —
*"references, identifiers, hashes, and counts only — never the content of your messages, and no
directly identifying data"* — is the true sentence, and it stays.

**D2. `stripeObjectId` is NOT deleted, even though nothing reads it.** The tempting tidy-up is
refused on purpose. Under D1 there is no bridge to close, so removing it would be a cosmetic change
carrying a privacy implication it does not have — and it would cost the one thing the field is
there for: `credit_note.created` correlates on the credit note (Stripe permits several against one
invoice, and correlating on the invoice made the second collide with the first), so
`stripeObjectId` is the only place the invoice appears on that row. Recorded here so the next
reader who greps it, finds no callers, and reaches for the delete key finds this paragraph first.

**D3. This repo states a technical finding and not a legal one.** Same posture as ADR-044 D1: a
retained, reconcilable payment ledger is a different kind of record from user content, and whether
that distinction carries in any particular regime is for the owner and their advisers. Nothing here
concludes it does.

**D4. The set of tables that outlive an erasure is now DERIVED and pinned, not remembered.**
`tenantData.test.ts` asserts the full membership of `audit_immutable`, `admission_plane` and
`global` against the classification map, with a positive control. Adding a table to any surviving
class now fails by name, and whoever adds it has to say what personal data it carries. See C4 —
this guard exists because the hand-written version of that list was wrong twice.

## What this does NOT close

**C4 — ADR-044's survey missed two tables, and one of them is not hypothetical.** ADR-044 C2 wrote
*"Every other surviving table was checked… The failure is these two and no others."* Deriving the
list from the classification map instead of reading it (47-09) found two it never named:

1. **`deadLetters` (`audit_immutable`).** `billingWebhook.ts:371-376` builds a dead-letter payload
   carrying `stripeCustomerId`, `stripeObjectId` and `billedTenantId` **together** — a Stripe
   customer beside our tenant id, in a table excluded from the erasure walk. It is the exact shape
   ADR-044 objected to in `billingEvents`, one table over, and the same payload is spread into an
   `audit` row on the next line. **Latent: zero billing dead-letters on production.** Not decided
   here, because ADR-044 D3 is explicit that these are "a named, owner-owned choice — not something
   an ADR closes quietly", and the trade is real: a dead letter with no Stripe handle is a failure
   nobody can diagnose, and Stripe retires events from its API after 30 days.

2. **`betaWaitlist` (`admission_plane`) — LIVE, and the only item in this whole argument that is.**
   It holds a raw `email`, a `name`, and a free-text `referral`, it is excluded from the erasure
   walk exactly as `betaInvites` is, and **production held 2 rows when this was written** (both
   `pending`, both carrying an email and a name, requested 2026-09-06 and 2026-09-08). `approve`
   *patches* the row to `approved` and copies the address into `betaInvites`; nothing deletes it.
   So an address entered on the waitlist has no removal path at all — not because erasure skips it,
   but because a person who never created an account never reaches the erasure terminal.

   ADR-045 D1 solved this shape for `betaInvites` by CLEARING rather than deleting, which keeps an
   invite spent. The waitlist has no equivalent argument for retention once a row is approved or
   declined, so the options are narrower and the owner should pick one. **It is the most urgent
   open item in this file and the only one with real people's data behind it.**

**ADR-044 T4 is untouched.** Arming still waits on a confirmed successful export, and the copy is
still flipped after the first object, never before.

## Consequences

- **ADR-044's triggers now stand at T1 met (47-05), T2 met (ADR-045 D1 + the C1 measurement),
  T3 met (47-03/47-06/47-08: 672 audit + 9 deadLetter rows, complete, 0 violations, 0 suspects),
  T4 open.** WORM stays OFF under ADR-044 D2 until T4 is discharged, and D2 is unchanged by this
  ADR. What changes is that the remaining blocker is one operational step rather than three builds.
- A future `billingEvents` reader may see a Stripe id and must not read it as a defect. D1 is the
  reason it is there.
- The C4 items are open and named. The next person to ask "what survives an erasure" should read
  the pinned set in `tenantData.test.ts`, not this list — lists in prose are what went wrong here.

## Rejected

- **Delete `stripeObjectId` anyway, because nothing reads it.** Ponytail says delete the unread
  field, and on any other table it would be right. Here the field sits in the middle of the exact
  claim ADR-044 made about it, and removing it changes what a reader believes without changing what
  is true. Tidiness is not worth a false impression on a privacy surface.
- **Hash the correlation id.** C3. Real cost to reconciliation, no gain against either threat model.
- **Reclassify `billingEvents` as `tenant_owned` so erasure reaches it.** It is the merchant's own
  record of what a customer paid; a customer deleting Pikar's books is not erasure. ADR-044 and
  `tenantData.test.ts` both already say so, and nothing here reopens it.
- **Decide `betaWaitlist` in this ADR.** It is a live surface with real addresses on it, and
  ADR-044 D3's rule applies with more force, not less: named, owner-owned, and not closed quietly
  inside a document about the billing ledger.
