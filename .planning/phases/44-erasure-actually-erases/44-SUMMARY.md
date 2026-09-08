# Phase 44 — Erasure actually erases

**Opened and part-closed 2026-09-08.** Head `52ed980` (44-01, deployed) + this commit (44-02).

Built from the Track C step 12 research turn, which found that step 12 was not next: two of its
three parts should not be built at all, and the third — the retention ADR — sat behind a defect that
outranked the whole build guide. Owner answered five questions on 2026-09-08; this phase is Q1-Q4.

## 44-01 — the fix (`52ed980`, deployed)

**The product offered a delete that did not delete, and said so in writing.**
`deleteTenantDataPage`'s walk was `.take()` + `ctx.db.delete(row._id)` and nothing else — a
case-insensitive grep of `tenantDelete.ts` for "storage" returned ZERO. Seven schema fields hold
`v.id("_storage")`. Erasure deleted the POINTERS and left the BYTES, and with the pointer gone those
bytes were unreachable AND unremovable by any product path. `tenantExport.ts` has the same zero, so
the halves failed in opposite directions: the export promised a copy and omitted the files, the
delete promised removal and kept them.

What shipped: `STORAGE_ID_FIELDS` + `storageIdsIn` in `@pikar/core` (a declarative map including the
nested `plans.attachments[].storageId`), the blob delete inside the walk guarded by the `_storage`
system table, the `vaultDocuments` RAG cascade, the agent-component thread cascade on the action,
and the same fix on `vault.deleteVaultDoc` (the everyday single-document path had the identical
bug — one rule, two callers).

Three things worth carrying forward:
- **The probe decided the design.** A throwaway convex-test probe established that
  `ctx.storage.delete` rolls back with its transaction. Had it not, deleting blobs inside a
  resumable paged mutation would have WEDGED erasure for ever, because `storage.delete` throws on an
  already-gone id and every retry would re-throw on the first blob it had already removed.
- **A shipped scan caught a bearer-capability smell.** The first existence check used
  `ctx.storage.getUrl`; `llmRedaction.test.ts` went red because a storage URL is a bearer
  capability. `ctx.db.system.get("_storage", id)` answers the same question and mints nothing.
- **Mutation testing found the guard too weak.** The drift guard originally checked TABLE coverage;
  dropping the nested `attachments[].storageId` PATH sailed through. It is field-level now.

## 44-02 — the argument, the spec, the drill, the corpus (this commit)

No production code. **ADR-044** records that the "no personal data" claim on three user-facing
surfaces does not hold today, and holds WORM off until four triggers are met. Writing the argument
down is what showed it fails.

**Two bridges, both evidenced.** `betaInvites` (`admission_plane`, never deleted) carries `email` +
`redeemedUserId`, and `tenantId` IS `String(userId)` — so every audit row's id resolves to the
erased person's address. `billingEvents` (`audit_immutable`, structurally unreachable) carries
`tenantId` beside `stripeObjectId`, bridging externally through Stripe. Every other surviving table
was checked and carries refs and counts only.

**And the cursor starts at zero.** `getCursor` returns `?? 0` and the unset-bucket path deliberately
never advances it, so arming WORM does not start archiving from now — it freezes the ENTIRE history
into 7-year COMPLIANCE objects on day one, keyed by identifiers that still resolve, with
`audit.payload` typed `v.any()` and no systemic §4 scanner having ever read a row.

Also in 44-02: `apps/web/e2e/erasure.spec.ts` (the first browser coverage of `/dashboard/settings`,
minting and erasing its own disposable tenant behind two fail-closed guards); the GOVN-03 drill
widened to name artifacts, because as written every leg was rows-only and it would have passed green
through the whole 44-01 defect; `beta-admission.md` invariant 3 upgraded; and the corpus re-synced.

## Owner-side

1. **Decide ADR-044 D3** (the `betaInvites` bridge — recommended: clear the identifying fields at
   erasure, keep `redeemedAt`) and D4's sweep for people already erased. WORM stays off until then.
2. **Read the media storage number** in the Convex dashboard (Q5). An age-out placed on
   `reliability-sweep` deletes zero bytes until `RELIABILITY_SWEEP_ARMED=1` is set on prod.
3. Run the erasure spec once against a local deployment to move GOVN-03 off open.
4. Unchanged and still first in the queue: the full unfiltered pinned eval run, then the G19
   activations.

## Not done, deliberately

`tenantExport` still contains no files, so "Download your data first if you want a copy" is false
for the user's own documents and media. The copy fix is not taken here because it would have to be
reverted by the export change that makes it true; it is recorded as ADR-044's export disclosure
trigger and as leg L7 of the widened drill.

## Verification

44-01: backend 4099 (2112 + 1987, 0 FAIL), core 1540, contracts 123; four typechecks and biome clean;
four mutations RED and cmp-restored. 44-02: no production code; `apps/web` tsc exit 0 with the spec
in place, biome clean, `playwright test --list` discovers it, `check-playbooks` and
`check-planning` exit 0. **The erasure spec has never been executed** — e2e is not in CI and this
environment has no running stack. Nothing here is erasure evidence.
