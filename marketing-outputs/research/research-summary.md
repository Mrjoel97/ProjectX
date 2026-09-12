# Phase 31 research and implementation handoff

Reviewed 2026-09-10. Research is preparatory; no product decision, release, live UAT or marketing publication is asserted.

## Evidence boundary

Read the four companion research files for linked observations, dated offer comparisons and explicit missing evidence. Public-site patterns are hypotheses. The current [Relay notice](https://relay.app/) supersedes older recommendations of that vendor. Social engagement and conversion performance remain unverified.

## Actual plan scope and present gaps

Plans 31-00 through 31-07 require an authenticated Marketing dashboard, six honest channel states, one-time secret links to stored Vault bytes, exactly three aggregate request counters, existing Contacts capture, and a workspace handoff. The final navigation activation requires live browser/HTTP evidence. Current source has no Marketing route, funnel table/module or core marketing contract. The existing landing page and invitation/waitlist service are product admission, not this funnel; they should not be repurposed as contact capture.

Plan 31-00 has no decision summary. Its explicit unresolved contract covers stage semantics, source persistence and the authenticated lead actor/consent boundary. A recommendation is not the required owner decision. Implementation must preserve that distinction and must not fabricate `PROCEED_COMPATIBLE`.

## Reusable implementation design, pending the semantic decision

1. `packages/core/src/marketing.ts` and test: total channel catalog, bounded source/stage parsing, safe integer counters and missing-value handling; export only the downstream contracts.
2. `packages/backend/convex/funnels.ts` and test: owner wrappers, existing `contentHash`, one random 32-byte token, hash-only persistence, indexed atomic counter mutation, existing Vault ownership/storage checks, uniform refusal. Add only the approved aggregate schema fields through the schema owner. Recheck sealed/deleted assets and storage identity; a public link must not silently switch to replacement private bytes.
3. `packages/backend/convex/http.ts`: strict Convex GET route, trusted storage redirect, no Next middleware change, no caching/referrer propagation and no raw token logging. Deployment-origin handling must be tested before any counter is incremented for a rejected redirect.
4. `packages/backend/convex/contacts.ts`: reuse `upsertContactRow` with actual provenance and verbatim consent evidence only if the owner approves those semantics. Manual entry does not prove that consent came from a form: existing sources are `asserted-by-user`, `inbound-form` and `imported-attested`; select the truthful approved source rather than defaulting every capture to `inbound-form`. Preserve duplicate provenance/consent and independent suppression. Add real approve/send convergence regressions, not a second person store.
5. `apps/web/app/(app)/dashboard/marketing/`: independent sections using existing Gmail queries, owner funnel management and Contacts adapter. Workspace handoff only; no model, provider or send operation. Keep navigation dark until live evidence.
6. Extend existing tenant export/deletion and storage-field policy for any new table; register modules in generated API and security/isolation inventories; update playbook/watch ownership. These cross-cutting seams are required even though the individual plan file lists do not enumerate every registry.

Use existing packages and dependencies. No analytics SDK, social connector, new lead table or outbound authority is needed. UI tests must distinguish loading/error/unavailable from measured zero and must exercise one-time link disclosure without saving secrets in evidence.

Current-code drift must be reconciled before executing old plan snippets: authentication uses the pinned Convex Auth wrappers rather than a new Clerk integration, and the current navigation requires an `href` on every entry after removing its old `soon` renderer. A direct authenticated route can stay absent from navigation until evidence; restoring a disabled-entry renderer would be a deliberate UI change, not reuse of an existing branch.

## Redirect and revocation limitation

The required `302` discloses the final storage URL. Convex's current [file-serving documentation](https://docs.convex.dev/file-storage/serve-files) says that anyone holding that URL can reuse it; revocation requires deleting the stored file. Therefore deactivating a funnel can prevent later `/f/` resolutions but cannot revoke an already revealed storage URL or downloaded copy. This limitation belongs in the owner decision, creation disclosure and live acceptance checklist. Do not call these storage URLs short-lived, or claim that link deactivation makes previously shared bytes private. A per-request access-controlled byte proxy would change the stipulated `302` contract and needs a deliberate requirement change.

The same documentation confirms `storage.getUrl` is available in mutation context, supporting atomic asset-check/counter behavior. [Convex HTTP actions](https://docs.convex.dev/functions/http-actions) expose the separate site endpoint and can call internal mutations; there is no reason to widen the web application's middleware.

## Verification sequence

Exact owner decision → pure contract tests → owner/foreign tenant, sealed/missing storage, token, source, overflow and concurrency tests → public HTTP matrix → Contacts suppression at both outbound terminals → rendered page tests → full type/build gates → disposable authenticated and no-cookie live journey → owner acceptance. Shared schema, generated API and navigation edits need explicit file ownership coordination. Do not mark Phase 31 complete based on this preparatory research.
