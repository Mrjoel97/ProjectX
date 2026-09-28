# Plan 19-03 current-source recheck — 2026-09-29

Scope: the Plan 19-03 repository/offline objective only, on source revision
`b2cb0aba77938d089c4239e103272c862710110a`. This does not reaccept all
of Phase 19, qualify a deployment, verify a real physical postal address, or
clear Wave 1's entry gate for Wave 2.

The current tenant-profile `saveFacts` validates a supplied postal address at
the write boundary, trims it, refuses empty-after-trim and more than 500
characters, and preserves an existing address when the argument is absent.
`get` and internal `forTenant` return the stored field. Focused tests cover
round-trip, rejection without a partial write, absent-field preservation,
tenant isolation, and unchanged onboarding completeness with and without the
address. The profile page's existing `ShapePanel` displays and submits the
field; the onboarding playbook identifies it as enrichment, not an onboarding
requirement. An address recorded for a tenant is not Pikar-AI's pending legal
registered address.

| Evidence | Result |
| --- | --- |
| `packages/backend/convex/tenantProfile.ts` SHA-256 | `dd5c4325f8f99c2f6c2c2a685bb749722ca31587912c3943ffc87983082afa40` |
| `packages/backend/convex/tenantProfile.test.ts` SHA-256 | `0962e1021d444bd115382e92333968458fa074a495003f1ea9f281f1f71676d3` |
| `apps/web/app/(app)/dashboard/profile/ShapePanel.tsx` SHA-256 | `ade8d0b1849516493430ca035548ec0c5bc1468655c9db82ed6e95a981735cb3` |
| `docs/playbooks/onboarding.md` SHA-256 | `b0cfc196d76787597dfed866bde9cbe69a3ec98912c2ee01ad6eb21b45969` |
| `pnpm --filter @pikar/backend test tenantProfile` | 26/26 pass, exit 0 |
| `pnpm --filter @pikar/backend typecheck` | exit 0 |
| `pnpm --filter @pikar/web typecheck` | exit 0 |
| `pnpm --filter @pikar/web build` | exit 0 with network access for declared Google Fonts; `/dashboard/profile` included. One existing next.config NFT tracing warning. A restricted-network first attempt failed solely to fetch those fonts. |
| `node scripts/check-playbooks.mjs` | exit 0 |

Disposition for `PLAN:19-contacts-crm-follow-ups/19-03`:
`implemented=yes`, `offline_tested=yes`, objective closed at those layers.
Deployed, live-observed, owner-accepted and externally-enabled layers are not
inferred. This recheck is not a current-release beta verdict.
