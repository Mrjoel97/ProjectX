# ADR-044 — The audit-archive claim, and what must be true before WORM is armed

- **Status:** Accepted
- **Date:** 2026-09-08
- **Owner decision, 2026-09-08 (Q2):** write the argument down, and hold WORM off until it is.
- **Supersedes:** nothing. It does NOT supersede ADR-002 (insert-only audit), which is Accepted and
  immutable; this ADR takes ADR-002's design as given and asks a different question — whether the
  claim we make *about* that log to users is true.
- **Related:** ADR-002 (insert-only audit); `docs/playbooks/audit-dead-letter.md`;
  `docs/playbooks/beta-admission.md` invariant 3, which this ADR upgrades.

## Context

Three user-facing surfaces tell people the audit archive holds nothing personal, and that sentence
is the entire premise on which an append-only log and a right to erasure coexist:

- `packages/core/src/tenantData.ts` — `AUDIT_ARCHIVE_STATEMENT`: *"references, identifiers, hashes,
  and counts only — never the content of your messages, and no personal data."*
- The erasure UI and the privacy page repeat it.

The owner asked for that argument to be written down before WORM is armed. Writing it down is what
showed it does not currently hold. **This ADR records the argument, the two places it fails, and
the preconditions for arming — it does not certify the claim.**

### The argument, stated properly

`audit.tenantId` is the erased person's own account id on every row, for ever, and CLAUDE.md §4
explicitly permits ids. The claim "no personal data" therefore rests entirely on
**pseudonymisation**: an identifier is not personal data to a holder who cannot resolve it to a
person. The repo already reasons this way — `billingCustomers` is classified deletable precisely
because *"it is the ONLY row joining a person to a live merchant record, so an erasure that left it
behind would leave that link standing forever."*

So the claim is true if and only if **erasure destroys every surviving link from the id to a
person.** It does not.

### C2 — the claim FAILS TODAY, on two independent counts

`tenantId` is literally the `users` document id (`packages/backend/convex/lib/functions.ts` —
`return { userId, tenantId: String(userId) }`), and `deletableTables()` filters to `tenant_owned |
tenant_credential`, so whole classifications are structurally unreachable by the erasure walk.

1. **`betaInvites` (`admission_plane`, never deleted).** It carries `email: v.string()` *and*
   `redeemedUserId: v.optional(v.id("users"))` — and `redeemedSubject`
   (`provider|oauthSubject`). After a complete erasure that row still stands, so the id on every
   audit row resolves to the erased person's email address.
2. **`billingEvents` (`audit_immutable`, structurally unreachable).** It carries `tenantId`
   alongside `stripeObjectId`, and documents `correlationId` as `billing/<stripe id>` — the Stripe
   id is on the row twice. The bridge is external rather than local: the Stripe object resolves to
   a Customer holding an email. "Not under Pikar's control" is not an answer, because the join is
   performable by us on demand.

Every other surviving table was checked: `billingCoverage`, `workflowPackEvents` and
`billingStripeEvents` carry `tenantId` plus refs and counts, with no name or address. The failure is
these two and no others.

### C3 — §4 is unenforced systemically

`audit.payload` is `v.any()`. The immutability tests assert no patch/replace/delete, internal-only
builders, and no public writer — **nothing about payload content**. Redaction is a convention held
by ~47 writing modules and a handful of feature-specific tests. The contract is already bent in
practice: `auditProjection.ts` allowlists `piiCounts`, which is benign in value (four type keys,
integer counts) but is a payload key named for PII.

### C4/C5 — the identifier is on the row in more shapes than one

Correlation ids embed a tenantId at five sites, and `actor` is a raw tenantId at eleven audit-write
sites rather than a role word. The verdict is unchanged — these are the same identifier class the
row already carries — but any claim phrased as "the id appears once" is false.

### C1 — and the cursor starts at zero

`wormCursor.getCursor` returns `row?.lastExportedTs ?? 0`, and the unset-bucket path in `worm.ts`
returns early and **deliberately does not advance the cursor**, so no `exportCursors` row has ever
been written. The window is `ts > 0`.

**Therefore the first armed run archives the entire audit history**, into `ObjectLockMode:
"COMPLIANCE"` objects retained for `RETENTION_MS` (7 years), undeletable by anyone including the
deployment owner. Arming is not "start archiving from now" — it is "freeze everything ever written,
permanently, today."

## Decisions

**D1. The claim as written is NOT true today, and this ADR says so rather than defending it.**
The archive holds identifiers that remain resolvable to a person through two links erasure does not
sever. This is a technical finding about our own data model. **It is not a legal conclusion, and
this repo does not make one** — whether that renders the archive "personal data" under any
particular regime is for the owner and their advisers.

**D2. WORM STAYS OFF.** `WORM_BUCKET` remains unset in every deployment until T1–T4 below hold.
This is the operative decision.

**D3. The bridges are a named, owner-owned choice — not something an ADR closes quietly.** For
`betaInvites` the realistic options are: **(a)** clear `email`, `redeemedUserId` and
`redeemedSubject` at erasure while keeping `redeemedAt`, so the invite stays spent and admission
accounting survives; **(b)** classify it deletable, which risks a redeemed invite becoming
re-redeemable; **(c)** accept the bridge and narrow the three disclosure surfaces to match.
**Recommended: (a).** For `billingEvents`, the choice is between severing the Stripe id and
narrowing the claim; it is an `audit_immutable` table, so (a)-style clearing is not available
without superseding ADR-002's posture for it.

**D4. Whatever is chosen, the fix is forward-only unless a sweep is run.** Editing the erasure path
does nothing for people already erased: their `betaInvites` rows keep `email` + `redeemedUserId`
today. A one-time sweep clearing those fields on every row whose `redeemedUserId` no longer resolves
to a live `users` document needs no list of who was erased — which is exactly what makes it safe.

## The arming triggers — all four, before `WORM_BUCKET` is ever set

**T1.** The disclosure surfaces and the data model agree. Either D3 closes both bridges, or the
three surfaces are narrowed to something true (e.g. "no message content and no directly identifying
data") — read `docs/design/BRAND.md` first, per §10.

**T2.** D3 is decided **and** D4's sweep has run, so the claim holds for people already erased and
not only for future ones.

**T3.** A systemic §4 payload check exists, or the owner records that they accept its absence.
Because of C1 this is not a forward-only concern: every latent §4 defect in the history becomes
permanent on arming day, and a source scan cannot see a single already-written row. The honest
check reads rows, not code.

**T4.** Arming is gated on a **successful export**, not on the env var. `worm.ts` throws without
advancing the cursor when the bucket is wrong, and it throws daily and quietly — so a misconfigured
bucket would sit failing while the privacy page had already been flipped to say the archive is on.
Flip the copy after the first confirmed object, never before.

## Consequences

- The `RETENTION_MS` 7-year placeholder is NOT re-decided here. It becomes a real decision at the
  same moment arming does, and it is gated behind the same triggers.
- **An export disclosure trigger.** `tenantExport` still contains no files while the erasure UI says
  "Download your data first if you want a copy." That sentence is false today for the user's own
  documents and media. It is deliberately not patched in this doc-only commit — the fix belongs with
  the export change that makes it true — but it is recorded here so it cannot be forgotten.
- `docs/playbooks/beta-admission.md` invariant 3 currently files the `betaInvites` bridge as "a real
  open Art. 17 question, deliberately not decided in an admission plan." This ADR upgrades it: it is
  now the named falsifier of a claim on three user-facing surfaces.

## Rejected

- **Assert the claim and move on.** It is the cheapest option today and the most expensive if wrong,
  and the two bridges are evidenced rather than hypothetical.
- **Arm WORM and fix the bridges afterwards.** COMPLIANCE mode is irreversible and the cursor starts
  at zero, so "afterwards" does not exist for anything already written.
- **Delete the audit archive claim from the UI entirely.** It is load-bearing for user trust and it
  is nearly true; narrowing it (D3c) is honest, deleting it reads as hiding something.
- **Decide D3 inside this ADR.** It changes what an erasure does to admission state and, on one
  option, what an `audit_immutable` table means. That is the owner's call, and an ADR that made it
  silently would be the "accepted ADR can be wrong" pattern this repo has already recorded.
