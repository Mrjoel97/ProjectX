# Plan 19-13 current-source recheck — 2026-09-29

Scope: the Plan 19-13 repository/offline objective only, on source revision
`1ae79c9b66ec9d2993ecd02cf4c050112c02abd0`. This does not reaccept the
whole Phase 19, qualify a deployment, inspect a real consent record, or clear
Wave 1's entry gate for Wave 2.

The current `contacts.consentRecord` public `tenantQuery` performs one
`ctx.db.get(contactId)`, rejects a missing or foreign-tenant row, returns
`null` when no consent exists, and otherwise projects the stored timestamp,
source, exact wording and capture context. It has no audit writer. The current
tests assert owner readback, foreign and unauthenticated refusal, exact
wording/context/timestamp and no audit side effect.

| Evidence | Result |
| --- | --- |
| `packages/backend/convex/contacts.ts` SHA-256 | `375d67d64f4240c1ee3d98f560b50023f43a8226165cbc7b35ae81180bfc775c` |
| `packages/backend/convex/contacts.test.ts` SHA-256 | `5ba97ca69025faeb392062d04ca3d485b294acefa0898c1412821a24e59622d3` |
| `pnpm --filter @pikar/backend test contacts importGuard` | 258/258 pass (93 contacts; 165 import-guard), exit 0 |
| `pnpm --filter @pikar/backend typecheck` | exit 0 |
| `pnpm --filter @pikar/core test contacts` | 29/29 pass, exit 0; adjacent contact substrate only |
| `pnpm --filter @pikar/web test pipelineView` | 32/32 pass, exit 0; adjacent UI only |

Disposition for `PLAN:19-contacts-crm-follow-ups/19-13`:
`implemented=yes`, `offline_tested=yes`, objective closed at those layers.
Deployed, live-observed, owner-accepted and externally-enabled layers are not
inferred from these tests; the later Phase 19 historical owner record remains
separate. This recheck is not a current-release beta verdict.
