# Plans 19-01/02 current-source recheck — 2026-09-29

Scope: these two repository/offline plan objectives on source revision
`1ae79c9b66ec9d2993ecd02cf4c050112c02abd0`. The Phase 19 historical
owner UAT remains separate; no deployment, external provider, mailbox or
current-release founder observation occurred in this recheck. Wave 1's entry
gate for Wave 2 remains open.

| Current source or check | Result |
| --- | --- |
| `packages/core/src/contacts.ts` SHA-256 | `01ff214aedacd58e0b306f7e58282c696e81f42f2b17a8ec3248c0ba96296eab` |
| `packages/core/src/contacts.test.ts` SHA-256 | `9dc374a5f62373aeae8a63542f55b014f778ced9b2abbd3683fab7b86355d6d2` |
| `packages/backend/convex/contacts.ts` SHA-256 | `375d67d64f4240c1ee3d98f560b50023f43a8226165cbc7b35ae81180bfc775c` |
| `packages/backend/convex/contacts.test.ts` SHA-256 | `5ba97ca69025faeb392062d04ca3d485b294acefa0898c1412821a24e59622d3` |
| `packages/backend/convex/importGuard.test.ts` SHA-256 | `8c48cdce1724e2be3428d84a201565a95ee3278e5def01f65d4776fb805c2470` |
| `pnpm --filter @pikar/core test contacts` | 29/29 pass, exit 0 |
| `pnpm --filter @pikar/backend test contacts importGuard` | 258/258 pass (93 contacts, 165 import guard), exit 0 |
| Core and backend `typecheck` | both exit 0 |

Plan 19-01: the current core barrel exports `contacts.ts`. Its four original
functions (`normalizeAddress`, `needsAttention`, `followUpIsDue`, `renderFooter`)
remain present; the current focused suite covers address normalization,
attention/due boundaries and empty-postal-address refusal. Validation rows 2
and 3 are green historically, and this run renews their executable coverage.

Plan 19-02: current public contacts functions use `tenantQuery` or
`tenantMutation`; service-only functions use `internalQuery` or
`internalMutation`. The focused backend/import-guard run covers the
`acknowledged:true` unsuppress gate, comma-joined suppression lookup and
missing-secret unsubscribe token refusal. Source inspection finds no raw
public Convex builder in this module.

For these two exact plan objectives, `implemented=yes` and
`offline_tested=yes` are justified. Deployed, live-observed,
owner-accepted and externally-enabled layers remain unknown in the closure
ledger from this recheck. Their later historical Phase 19 owner sign-off is
not silently projected onto the current release.
