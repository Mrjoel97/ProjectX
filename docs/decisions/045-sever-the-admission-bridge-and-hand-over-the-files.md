# ADR-045 — Sever the admission bridge, and hand over the files

- **Status:** Accepted
- **Date:** 2026-09-08
- **Owner decision, 2026-09-08:** ADR-044 D3 option **(a)** plus the D4 sweep; and close the export
  gap ADR-044 recorded as its export disclosure trigger.
- **Supersedes:** nothing. ADR-044 is Accepted and immutable; this ADR RESOLVES the choice ADR-044
  deliberately left open, and does not restate or amend it.

## Decisions

**D1. `betaInvites` is CLEARED at erasure, not deleted.** `email`, `redeemedUserId` and
`redeemedSubject` are emptied; `redeemedAt` and `code` remain, so the invite stays **spent**.
Deleting the row would hand a used code back to whoever still holds it — admission integrity and
erasure are both satisfied by clearing, and only by clearing.

The lookup uses the shipped `by_email` index off the `users` row the erasure terminal has already
loaded. There is no index on `redeemedUserId`, and a table scan inside the one path that must always
finish would be a scale defect.

**D2. A one-time paged sweep closes the forward-only gap (ADR-044 D4).**
`tenantDelete.sweepOrphanedInviteIdentities` clears any redemption whose `redeemedUserId` no longer
resolves to a live `users` document. **It needs no list of who was erased** — a dangling pointer IS
the evidence — which is what makes it impossible for it to clear a living user's row. Paged,
idempotent, and run from the owner's terminal until `done: true`.

**D3. The export hands over the files.** `exportTenantData` now returns a `files` array per page:
`{ table, rowId, storageId, url }`, built with the SAME `STORAGE_ID_FIELDS` map the erasure walk
uses — so a table erasure clears is a table the export hands over, and the two cannot drift.
`ctx.storage.getUrl` is legitimate here and only here: `llmRedaction.test.ts` forbids minting a
bearer capability outside a `tenantQuery`, and this is one; handing a tenant a link to their **own**
bytes is the point. The 44-01 erasure walk deliberately used the `_storage` system table instead,
because there the URL would have been minted only to be discarded.

**D4. The copy now says what is true, including the limit.** The export surface states that files
come as **time-limited** download links that expire, so they should be fetched when the export is
taken. A `url` of `null` is a real state — a row can point at a blob that is already gone — and the
export says so rather than omitting the entry.

## What this does NOT close

**The `billingEvents` bridge remains open (ADR-044 C2, second count).** It is `audit_immutable` and
carries `tenantId` beside `stripeObjectId`, bridging externally through Stripe. D1 closes the
`betaInvites` bridge only. **The "no personal data" claim is therefore still not strictly true, and
ADR-044 D2 still holds: WORM stays OFF.** Do not read this ADR as clearing ADR-044's triggers — it
advances T1/T2 and leaves T3/T4 and the second bridge untouched.

## Consequences

- Export pages now perform one `getUrl` per file per page. Bounded by the page size; no new rail.
- A cleared invite has `email: ""`. Anything matching invites by email must treat empty as "no
  match" — the `by_email` index still contains the row.
- `TenantDataExportPage` gained a required `files` field, so every consumer sees it.
