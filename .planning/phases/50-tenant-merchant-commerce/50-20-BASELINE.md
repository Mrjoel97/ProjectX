# Plan 50-20 pre-edit baseline — 2026-09-26

The owner selected a **merchant-configurable 1–60-minute** finite-stock hold for the first test-mode shop. For payment received after hold expiry when stock is unavailable, a **merchant admin** chooses either a refund or a documented fulfilment alternative, and the buyer receives a status notice. These are business-policy choices, not Stripe/PayPal eligibility, refund API authority, a customer notification implementation or checkout activation. Plan 50-06 remains pending and ADR-049 does not exist.

| Target | Pre-edit SHA-256 | Git status |
| --- | --- | --- |
| `packages/core/src/tenantInventory.ts` | `fe9c2de211e71abfe2fa774c9ec0515f16b0d6a8660f11d742b9ffcecb567bcc` | untracked, pre-existing |
| `packages/core/src/tenantInventory.test.ts` | `7dcfc3382c2e5d69540653dadd953468697fa9d2e0eae76a74d287f189433ea7` | untracked, pre-existing |
| `packages/core/src/tenantOrder.ts` | `1a20046e92be8e419876240afc1f40b21b7ecea0817f3ae4ab9844c276162b4e` | untracked, pre-existing |
| `packages/core/src/tenantOrder.test.ts` | `1edceda1fe9096b7a1de6195b2c9f5eb106e947f0a1ce0c4b5cc6c0a08122b58` | untracked, pre-existing |
| `packages/backend/convex/tenantCatalogue.test.ts` | `bd64a03e2463b38bb7d6bc68a6da501f8723bbbbbe29da226e268c5c9cda9a46a` | untracked, pre-existing |
| `scripts/check-phase50-merchant-decision.mjs` | `886d7ddde9f56ed230632d2af212a4e17defc336fe81f6b0f70a656457fa14bf` | untracked, pre-existing |
| `docs/releases/phase-50-merchant-decision.md` | `3a31031a4762853c8b312434852c3f841d297240ce1eef741045b9619d19de8b` | untracked, pre-existing |
| `docs/playbooks/tenant-commerce.md` | `f6b9da5119b1f28df6c2792bf985893323331f1711101c68f7421f29e15d155b` | modified, pre-existing |
| `50-06-OWNER-INPUTS-2026-09-24.md` | `a696eac0a3a5ef5d59a223a08f1d1fdb22a2290c7212089a2ef32374cda6d318` | untracked, pre-existing |

The existing core inventory policy accepts finite reservation TTLs from 60,000 through 86,400,000 ms, and order quote repeats that upper bound. The merchant decision checker permits up to 1,440 minutes; its synthetic accepted fixture uses 1,440. The real packet has `null` final range and review-operation facts, and therefore correctly refuses. No plan-owned source edit has occurred at this baseline. Recheck each target against this hash or the last plan-owned hash before changing it; preserve unrelated worktree content.

## Later order-clock correction baseline — 2026-09-26

The broader commerce regression exposed a missed clock interaction after the initial Plan 20 work: `placeOrder` used `Math.min(cart.expiresAt, now + stock hold)` and thus truncated a merchant-configured 60-minute hold to the remaining 30-minute cart lifetime. Immediately before the correction, `tenantOrders.ts` SHA-256 was `54ea24c51c6fa7789f1f7c50b421b0159cc58b1df885293ce2034c36830307ba` and `tenantOrders.test.ts` was `0cd765097efdd0f868a263c5b6b54e58b8d9c208c793046c88f0cdffe3fdb221`; both were pre-existing untracked files. A new backend test failed first on the actual one-minute-versus-60-minute expiry, then passed after the correction. This is a subsequent scoped baseline, not a claim that those files were in the original Plan 20 inventory.
