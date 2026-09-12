# Playbook: Marketing and aggregate funnel links

> Last verified: 2026-09-12 — Phase 31-02 native funnel lifecycle, atomic resolver and generated API; HTTP, UI and live acceptance remain pending.
> Build history: `.planning/phases/31-marketing-surface-and-funnel-v0/` · Authority: ADR-015 and `31-00-SUMMARY.md`.

## Purpose and current status

Marketing will show honest channel availability, shareable Vault links and authenticated lead recording. The owner approved A1/B1/C1 with `PROCEED_COMPATIBLE`. The shared contracts, aggregate schema, authenticated funnel lifecycle and internal atomic resolver are implemented. Public HTTP routing, navigation activation and live acceptance remain downstream gates.

## Key files and dependencies

- `packages/core/src/marketing.ts`: six-channel catalog, `marketingChannelState`, exact stages/counter map, bounded source normalization, safe-integer parsing and missing-value formatting.
- `packages/core/src/marketing.test.ts`: channel totality, dual social blockers, Gmail unknown-state behavior, missing-vs-zero counts and parser bounds.
- `packages/backend/convex/schema.ts` and `funnels.test.ts`: minimal tenant/source/token-hash/asset schema and forbidden-field inventory.
- `packages/backend/convex/funnels.ts`: native tenant `create`, bounded `list`, idempotent `deactivate`, and internal `resolveAndIncrement`; generated API references are exercised directly by lifecycle tests.
- `packages/core/src/marketingLead.ts` and `packages/backend/convex/contacts.ts`: authenticated lead contract and adapter; see the Contacts/CRM playbook for provenance and suppression qualification.
- `31-00-SUMMARY.md`: exact question/owner answer and semantic contract. `31-VALIDATION.md`: requirement-to-evidence matrix.

Current authentication is Convex Auth with tenant wrappers; old plan references to Clerk must not introduce another auth provider. Downstream consumers use native generated Convex API declarations; no handwritten codegen. Vault ownership, fixed storage IDs, existing Phase19 contacts/suppressions and the configured Convex HTTP origin are the runtime dependencies.

## Approved data flow

1. An authenticated operator selects their downloadable Vault artifact, a title of at most 120 characters and a source of at most 64 input characters. Source normalizes ASCII spaces to hyphens and lowercase; only an alphanumeric first character followed by alphanumerics, hyphens or underscores is accepted. Controls/empty/oversized values are rejected.
2. Each source link gets one independently generated 256-bit token encoded as 43 unpadded base64url characters. Persist a domain-separated hash only. Raw links are shown only in the creation response, never later list results/logs. Lost links require replacement and deactivation, not recovery.
3. Public GET `/f/:token/:stage` accepts exactly visit, claim or download. Each successful request atomically increments only its corresponding safe-integer raw counter and returns 302 to the same persisted trusted Vault bytes. These are independent request labels, not unique people, completed consumption or ordered stages. Bots/retries count.
4. The source belongs to the link row. Public bounded `?s=` cannot override it, choose a destination or create new keys/rows. It is continuity metadata only. No visitor identity or event history is stored.
5. Authenticated lead recording goes through the existing Phase19 contact upsert. Manual entry uses `user-entered`; explicit per-person consent uses `asserted-by-user` and existing wording/context/time semantics. Preserve existing first origin/consent on duplicates. Recording alone is not outreach permission.
6. Suppressed contacts remain outbound-blocked. Both `executePlan` and `gmail.send` must retain their real suppression backstops. Marketing cannot publish or automatically send; its Executive Agent CTA only opens the governed workspace for a draft/proposal.

## Honest channel catalog

| Channel | v0 state |
| --- | --- |
| Gmail | Connected only from actual `gmailStatus.connected`; otherwise connectable only with configured Google OAuth, using existing `/connect-gmail`. Missing evidence remains unknown/loading/error, not disconnected or zero. |
| Meta/Instagram | Blocked: legal entity is not formed and Phase32 provider suitability/OAuth review has not started. |
| LinkedIn | Same two blockers. |
| TikTok | Same two blockers. |
| X | Same two blockers. |
| YouTube | Same two blockers. |

Every social row must state both blockers in plain language, with no disabled Connect button, launch promise, fake follower/engagement count or Phase 32 analytics. User-facing copy says provider suitability and permissions review rather than an internal phase number. Connected Gmail can be reported even if the independent configured query has not settled; absent Gmail evidence is not fabricated.

## Invariants and threat checklist

- Exactly `visits`, `claims`, `downloads` as integer aggregates. Convex `v.number()` alone permits fractional/unsafe values; downstream writes MUST use safe-integer validation and refuse overflow before any increment.
- No raw token storage/recovery, arbitrary destination, public contact write, event table, IP/user-agent/referrer/per-click metadata, visitor IDs, unbounded source maps, campaign membership or second leads store.
- Only the Convex HTTP GET link/redirect is public. Do not widen Next middleware, CORS, auth cookies or unrelated webhook handlers.
- Unknown/malformed/inactive/missing-asset requests return the same minimal404 without increment. Refuse invalid storage origins before increment/redirect; destination comes only from trusted storage resolution.
- All management queries/mutations remain tenant-scoped. Public responses expose no tenant identity. Raw token/query data must not enter audit or diagnostic payloads.
- `funnels.by_token_hash` is the named isolation-inventory exception for the planned internal bearer resolver, not a tenant-facing list. The source, counters and fixed storage reference participate in existing tenant export/erasure; a changed Vault pointer cannot orphan link bytes. Tests exercise both native lifecycle paths with a foreign-tenant control.

## How to verify and change safely

| Requirement | Automated seam | Live gate |
| --- | --- | --- |
| MKTG-01 | Core catalog tests; later Marketing rendering tests | Actual Gmail/social states, desktop/mobile and workspace handoff |
| MKTG-02 | Schema guards; later native lifecycle/HTTP concurrency and token tests | Authenticated creation, three separate unauthenticated302 requests/counter deltas, downloaded byte identity, deactivation404 |
| MKTG-03 | Later contacts plus real cockpit/Gmail suppression convergence tests | Recorded lead provenance in existing Contacts and suppressed-address refusal |

Run `pnpm --filter @pikar/core test -- marketing.test.ts`, core typecheck, `pnpm --filter @pikar/backend test -- funnels.test.ts`, backend typecheck and `node scripts/check-playbooks.mjs`. Later plans must run native codegen, frontend rendering tests, full repository qualification and disposable live UAT from31-VALIDATION. No live success follows from schema tests.

## Operations and remaining work

Deactivation prevents future funnel resolutions; it cannot revoke an already-issued storage URL or downloaded/copied bytes. Do not promise file revocation. Replace compromised/lost links and review the underlying artifact separately using existing Vault controls. Live checks must redact tokens and disable secret-bearing traces, then deactivate disposable links and remove only their owned fixtures.

Creation validates the ready, tenant-owned Vault document and actual storage metadata before issuing a token. Links retain the exact storage ID captured at creation. Revising or deleting the source may delete those original bytes and invalidate the link; a link never silently redirects to replacement bytes. The resolver checks both the source document and original storage metadata before counting. Native tests exercise `vault.patchCreatedDoc` plus its old-byte cleanup and `vault.deleteVaultDoc`, not only synthetic status changes.

`CONVEX_SITE_URL` must be an HTTPS `*.convex.site` origin, never the app URL or `*.convex.cloud`. Storage redirects use the configured deployment's HTTPS cloud storage origin. Insecure localhost public links are deliberately unsupported; tests configure trusted deployment origins. Management listing returns at most 100 safe display rows plus `hasMore`, excluding token hashes and storage IDs. Missing/invalid counters remain unknown; they are not repaired to zero. Atomic increments reject unsafe integers and overflow; concurrent requests are covered by native transaction tests.

Plan31-02 implements token lifecycle/atomic resolution;31-03 adds public HTTP with no-store responses;31-04 adds authenticated lead recording;31-05 builds a directly accessible authenticated route with navigation disabled;31-06 qualifies it;31-07 records live evidence and explicit navigation activation. No event analytics, public lead form, outbound send or social publisher is authorized in this phase.
