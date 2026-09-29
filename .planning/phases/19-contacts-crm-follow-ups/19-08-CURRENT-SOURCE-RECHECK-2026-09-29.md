# Plan 19-08 current-source recheck — 2026-09-29

Scope: Plan 19-08's repository/offline objective on source revision `2bb2fc2`.
No product source changed since the successful exact-head CI on `9998de6`.
This does not assert that a live model consistently chooses the tool, a hosted
mailbox was searched, or a founder accepted the CRM experience. Plan 19-09's
active-skill instruction/evaluation gate remains separate.

Current `resolveContacts` checks tenant-saved contacts first. A saved match
returns its open follow-ups in the same tool result; the Gmail-header search is
the fallback. The tests count `mailbox.searched` audit rows to prove that the
saved-contact branch made no header request, and count contact rows across no,
one and several saved matches to pin the no-cache-at-rest invariant. The
current `stageCrmWrite` tool validates an operation list and proposes a
`crm_write` plan without applying it; empty, contactless-follow-up, incomplete
and cross-kind cases return governed sentences. The deterministic offline
SMOKE case traces `stageCrmWrite` with zero contact writes and no paid call.

The tool key is present in the `llm.ts` record, the closed
`schema.ts` `agentSteps.tool` literal and the workspace VERB map. Current
`traceParity` tests assert both directions. The Plan 19-08 summary records
three reverted RED mutation checks (missing literal, missing VERB and a
premature Gmail search); those are historical mutation evidence, not new
mutations performed in this recheck.

| Evidence | Result |
| --- | --- |
| `packages/backend/convex/llm.ts` SHA-256 | `38e40411fbc44fb683ac32b32d7e0355edaba18e308003c95af7f38018eda335` |
| `packages/backend/convex/contacts.ts` SHA-256 | `375d67d64f4240c1ee3d98f560b50023f43a8226165cbc7b35ae81180bfc775c` |
| `packages/backend/convex/cockpitTools.test.ts` SHA-256 | `1b6f52ca48e74bd9aeb08af5c9cfc2e0d883e8a8496221e7a71bc1271a1e316c` |
| `packages/backend/convex/traceParity.test.ts` SHA-256 | `5d1d390d530a5b2a8e98ce98c09196d36d9eb1ace3ef7729e0342e93fa34e6b3` |
| `pnpm --filter @pikar/backend test cockpitTools traceParity` | 179/179 pass (172 + 7), exit 0 |
| `node scripts/check-playbooks.mjs` | exit 0 |
| Backend-wide suite on same product source | 183 files / 4,648 tests pass, exit 0 |
| Exact-head CI on `9998de6`, run `36500841194` | success across full tests, typechecks, lint, free gates and production build; relevant product files unchanged since |

Disposition for `PLAN:19-contacts-crm-follow-ups/19-08`:
`implemented=yes`, `offline_tested=yes`, objective closed at those layers.
Deployed, live-observed, owner-accepted and externally-enabled layers remain
unknown. Wave 1's entry gate is not declared passed here.
