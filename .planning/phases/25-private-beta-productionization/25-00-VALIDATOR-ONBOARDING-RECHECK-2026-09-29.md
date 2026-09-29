# Phase 25 key validators and first-Approve path — 2026-09-29

**Status:** targeted source recheck at `2cd7f27`, not Plan 25-00 Task 2 completion, hosted behavior, or owner approval. This records current code paths and validator invariants; it does not requalify the full BETA-03/DLVR-02 behavior.

## Current validators

| Table | Relevant current contract | Source |
|---|---|---|
| `gmailTokens` | Tenant-keyed Google grant: required `tenantId`, `refreshToken`, `scope`, `updatedAt`; optional `accessToken`, `expiresAt`; `by_tenant`. There is **no** `provider` discriminator. | `schema.ts:2084-2092` |
| `microsoftCalendarTokens` | Separate tenant-keyed shared Microsoft Calendar+Mail grant: required refresh/access tokens, expiry, scope, timestamp; `by_tenant`. Mail readiness derives from granted scope, not mere row existence. | `schema.ts:2094-2118`, ADR-018 |
| `requests` | Required tenant/correlation/goal/recipient/status/attachment refs/creation time. `mailProvider` is optional closed `google | microsoft`; absence means legacy Google. Status is a closed 14-member lifecycle union. | `schema.ts:778-856` |
| `plans` | Required tenant/thread/status; optional recipients and action `kind`. Absent kind is the legacy email plan, while the current closed union also includes memo, calendar create/manage, media, CRM and finance writes. Optional `mailProvider` is `google | microsoft` on the plan; the selected provider is copied into `requests` at execution. `by_tenant`, `by_thread` and other purpose-specific indexes remain in the parsed inventory. | `schema.ts:860-1441` |

This is a selected validator summary, not a complete field-by-field schema dump. The [parsed schema inventory](25-00-PARSED-SCHEMA-INVENTORY-2026-09-29.md) records every runtime table and index descriptor. The final Task 2 comparison must inspect Plan 01–19 assumptions against all relevant validator fields, not treat this summary as that comparison.

## First-run and first-Approve path

1. `apps/web/app/(app)/layout.tsx:142-158` projects `api.onboarding.status` and redirects a tenant without a committed profile to `/dashboard/onboarding`.
2. The onboarding page's `onConfirm` saves tier facts first, then calls `onboarding.commitProfile` with explicitly selected profile fields and routes to `/dashboard` only after the commit succeeds (`page.tsx:543-585`). The server's commit remains the required-facts gate.
3. `onboarding.firstSendOffer` is a tenant query with **no recipient argument**. It derives eligibility from the committed profile and reads the signed-in user's address; missing profile/address gives a refusal rather than another recipient (`onboarding.ts:622-676`).
4. The workspace displays the offer and the user explicitly requests a draft (`cards.tsx` `firstSendOffer` at 1585; `apps/web/e2e/onboarding-first-send.spec.ts:14-19`). The server's first-send marker reads the same projection (`cockpit.ts:932-938`).
5. The PlanCard's `approve()` calls `api.cockpit.executePlan` (`cards.tsx:660-687`). That server tenant mutation checks the first-send recipient against the authenticated identity before its approval CAS (`cockpit.ts:1310-1385`), then routes the email arm into governed delivery. No source observation here substitutes for a received first email.

Open proof: exact browser onboarding/Approve observation on the qualified SHA, recipient/provider delivery terminal, real self-mail receipt, hosted DNS/TLS and provider acceptance, and the Plan 25-00 owner gate. The full source/UI URL census and playbook watch-map reconciliation are separate Task 2 items.
