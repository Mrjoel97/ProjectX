# Playbook: Marketing and aggregate funnel links

> Last verified: 2026-09-12 — Phase 31-03 public GET transport, HEAD rejection and paginated artifact picker; UI and live acceptance remain pending.
> Build history: `.planning/phases/31-marketing-surface-and-funnel-v0/` · Authority: ADR-015 and `31-00-SUMMARY.md`.

## Purpose and current status

Marketing will show honest channel availability, shareable Vault links and authenticated lead recording. The owner approved A1/B1/C1 with `PROCEED_COMPATIBLE`. Shared contracts, aggregate schema, authenticated funnel lifecycle, internal atomic resolver and public GET transport are implemented. Navigation activation and live acceptance remain downstream gates.

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

## Public route verification and artifact selection

Links terminate directly at `https://<deployment>.convex.site/f/<REDACTED_TOKEN>/visit?s=newsletter` (or `claim` / `download`). Next middleware and authenticated app routing are unchanged. The path requires exactly 43 base64url token characters and a lowercase stage without a trailing slash. Query strings accept at most one `s`, at most 64 decoded source characters, and at most 256 raw query characters; unknown keys and duplicates fail closed.

| Request | Response | Counter effect |
| --- | --- | --- |
| Valid GET for each stage | Empty 302, trusted fixed storage Location, no-store and no-referrer | Exactly the corresponding counter +1 |
| Malformed, unknown, inactive or unavailable GET | Identical empty 404, no-store | None |
| HEAD | Empty 405, Allow: GET, no-store | None; Convex maps HEAD to GET but the handler checks the original method |
| POST/PUT/PATCH/DELETE/OPTIONS | Native unmatched-router 404 | None; no write or preflight route exists |

The no-store guarantee covers all responses produced by the funnel handler. Unsupported methods are rejected by Convex's router before the handler and retain its default response headers. The handler sets no auth cookie or permissive CORS header and logs no request data.

For acceptance, create a disposable link in an authenticated session, record its initial aggregate counters, then open each stage once in a separate signed-out browser context. Inspect 302 headers without following redirects first; verify the downloaded bytes separately against the selected original file. Compare exact counter deltas, then deactivate and confirm empty 404 with unchanged counters. Do not use `curl -I` to measure a visit: HEAD is deliberately side-effect free. If using curl, supply the private URL through protected process input rather than recording it in command history, and avoid verbose logs or secret-bearing traces. Store only redacted result/status/count evidence, then remove owned fixtures. These instructions are an acceptance procedure, not a claim of deployed success.

`api.funnels.downloadableArtifacts({ paginationOpts })` is the authenticated picker prerequisite added with this plan. It scans at most 50 tenant-owned Vault rows per page and returns only `{ id, title, mimeType }` for ready documents whose stored bytes actually exist, including filed documents. It returns native `continueCursor` / `isDone`; an empty filtered page can still have more results, so the UI must allow continued paging. Storage IDs and tokens are absent from this DTO. Creation independently rechecks ownership and storage availability to close the selection-to-create race.

## Authenticated Marketing surface (31-05)

`/dashboard/marketing` is a direct authenticated route with three independent section error boundaries. Gmail uses live connection/configuration queries. Every social card states that the legal entity is not formed and provider suitability/permissions review has not started; publishing is unavailable. Product copy uses those facts rather than internal phase numbers. The sidebar intentionally has no Marketing entry until31-07: its existing navigation has no disabled/soon renderer, so adding a generic navigation abstraction was deferred.

The Vault picker uses native pagination and offers continuation even after an empty filtered page. Creation selects only an actual returned document ID and relies on the mutation to revalidate storage. Creation URLs exist only in component state, appear in readonly inputs and copy buttons, and are never navigation/prefetch links or persisted to storage. Closing the panel, confirmed deactivation of that link, or leaving the route removes them. An ambiguous creation failure advises checking the list rather than retrying automatically. Deactivation requires an explicit inline confirmation and cannot revoke bytes already obtained. Rows distinguish unavailable counters from zero and retain full safe integers.

Captured lead recording defaults consent to absent and collects exact wording/context only after explicit assertion. Result copy follows `suppressed`, `consent_missing`, or `approval_required` and never authorizes a send. Contacts remain in the existing Pipeline. Channel CTAs use only the closed `intent=marketing&channel=<catalog-id>` route parameters. ChatPane consumes this once, fills only an empty idle composer, removes the parameters, and never calls the send path. An existing draft or in-flight turn is preserved.

Focused DOM tests exercise file selection/create, ephemeral non-navigable links, empty-page continuation, consent absence/suppression, deactivation confirmation and section failure isolation; SSR checks channel gates and counters. Pure prefill tests reject unknown/duplicate intent/channel values and protect existing drafts. Live desktop/mobile and real funnel acceptance remain31-07 gates, not claims made by unit tests.

## Executable pre-activation acceptance (31-06)

Last verified: 2026-09-12 — `apps/web/e2e/marketing-uat.spec.ts` collects three serial scenarios. Collection is preparation, not live acceptance. From `apps/web`, use `node node_modules/@playwright/test/cli.js test e2e/marketing-uat.spec.ts --list --no-deps --project=chromium`. Execute the same exact file only after production qualification, replacing `--list` with `--workers=1`. Do not use the older broad pipeline-UAT or provisioning setup; this spec uses native Convex Auth's real browser session and never extracts JWTs.

Explicit private prerequisites: `PIKAR_MARKETING_UAT=1`, the deployment app origin in `PIKAR_E2E_BASE_URL`, and `PIKAR_E2E_STORAGE_STATE` pointing to an ignored storage state exported through the existing signed-in browser context. `--no-deps` prevents signup/setup side effects. For the link scenario supply `PIKAR_MARKETING_ARTIFACT_ID` and an independently known original-file `PIKAR_MARKETING_ARTIFACT_SHA256`; verify the reference is an owned synthetic artifact with actual stored bytes. Never select the first arbitrary Vault document. A prior synthetic PDF may establish file delivery even if its historical research semantics failed; do not upgrade that research acceptance result. No new model generation or paid ingestion is part of this suite.

For lead acceptance supply an exact `PIKAR_MARKETING_LEAD_EMAIL` matching `marketing-uat-<tag>@example.test`. Prepare or reuse this explicit synthetic contact and suppression once through existing Contacts UI/native seams, retaining a refs-only fixture receipt. The test first reads that exact Pipeline row and its `You added them` provenance/suppression before any capture write. Missing input skips with a precise prerequisite reason; a supplied but missing/broken fixture fails rather than becoming a skip. Contacts has no native delete: this synthetic fixture and its suppression remain intentionally retained. Do not unsuppress, delete a tenant, or invent a cleanup endpoint. Existing source files are preserved; only the test's unique tracked link is deactivated in `finally` (also after ambiguous creation), with cleanup failures visible.

All test retries, traces, screenshots and video are off. Raw URLs live only in process memory; readonly copy controls are closed before HTTP assertions. Each stage uses a newly created empty anonymous request context with no cookies or authorization. All token/storage request exceptions are replaced with closed errors, and assertions use numeric status/counts or boolean SHA256 comparisons instead of actual URLs. Final cleanup navigates to `about:blank`, falling back to DOM scrub/close, so Playwright's separate automatic error-context snapshot cannot retain the secret panel. Do not enable debug/network logging or add raw response/URL attachments. Preserve the original signed-in profile; the spec opens its own browser context from its exported state.

The journey checks desktop/mobile document fit and keyboard focus, actual Gmail state, all five social blockers, exact raw counter deltas, 302 to the same original file and matching byte hash for three independent stages, no HEAD increment, source-tamper attribution preservation, and deactivated empty404 with unchanged counts. A separate retained-contact journey confirms suppression still blocks capture-time outbound posture and Pipeline provenance. No provider/model/send is invoked.

No funnelEvents, public contact write, or publishing action: the native funnel tests pin the schema field/table ceiling, safe list DTO, trusted redirect, GET-only router and unchanged app middleware boundary. Contacts/cockpit/Gmail convergence tests pin capture-to-approval/send suppression with zero provider calls. The UI source guard limits mutation hooks to create/deactivate/recordMarketingLead and excludes model/publisher hooks; component tests cover the actual navigation-only handoff and isolated failures. Repository-wide test/type/build results are recorded separately by the coordinating release lane; navigation remains absent until31-07 live evidence.
