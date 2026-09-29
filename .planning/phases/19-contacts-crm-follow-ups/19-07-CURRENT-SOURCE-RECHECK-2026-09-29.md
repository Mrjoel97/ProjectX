# Plan 19-07 current-source recheck — 2026-09-29

Scope: Plan 19-07's repository/offline Pipeline objective on source revision
`1957ef4` (no product-source change since exact-head CI `9998de6`). This does
not qualify a current hosted browser, founder acceptance, a second CRM system,
or Wave 2's still-gated release.

The three current public read models are `tenantQuery` functions over the
existing contacts, follow-ups, suppression and delivered-request substrate.
`listContacts` and `listUnassignedFollowUps` consume the shared
`createDashboardBound`/cursor contract, rather than exposing an unbounded
offset list. Tests with more rows than the requested limit assert
`nextCursor → partial` with a closed partial reason and a disjoint page-2
round-trip. The three models are each asserted under distinct tenant A/B
identities. Empty-tenant tiles are actual numeric zeroes; the later bounded
scan correction also reports a `row-cap` floor instead of an unqualified total.
The comment-stripped structural test rejects opportunity, stage and monetary
fields in the substrate and schema.

The connected Pipeline page reads each section separately through those same
functions. Current component tests cover four rendered zeroes without a dash
or `Unknown`, no-name contact fallback to address, consent and last-touch
truthfulness, and the unassigned-follow-up section. The historical Phase 19
browser UAT is not promoted to a current hosted/live verdict here.

| Evidence | Result |
| --- | --- |
| `packages/backend/convex/contacts.ts` SHA-256 | `375d67d64f4240c1ee3d98f560b50023f43a8226165cbc7b35ae81180bfc775c` |
| `packages/backend/convex/contacts.test.ts` SHA-256 | `5ba97ca69025faeb392062d04ca3d485b294acefa0898c1412821a24e59622d3` |
| `apps/web/app/(app)/dashboard/pipeline/PipelineView.tsx` SHA-256 | `c60551acd3076fbd0cefc91b29e996d48823def5edbb7477fb07fcfc8fe0da14` |
| `apps/web/app/(app)/dashboard/pipeline/pipelineView.test.ts` SHA-256 | `eae16f0e15780f7a42272f4d2beda89b60a94da58faca30d4c28b6fdfc0053be` |
| `pnpm --filter @pikar/backend test contacts` | 93/93 pass, exit 0 |
| `pnpm --filter @pikar/web test pipelineView` | 32/32 pass, exit 0 |
| Exact-head CI on `9998de6`, run `36500841194` | success including full tests, typechecks, lint and production build; these product files are unchanged since that revision |

Disposition for `PLAN:19-contacts-crm-follow-ups/19-07`:
`implemented=yes`, `offline_tested=yes`, objective closed at those layers.
Deployed, live-observed, owner-accepted and externally-enabled layers remain
unknown. The historical browser UAT does not by itself prove a current release.
