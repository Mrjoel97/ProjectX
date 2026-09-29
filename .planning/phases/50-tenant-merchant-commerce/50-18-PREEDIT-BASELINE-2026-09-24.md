# Plan 50-18 pre-edit baseline — 2026-09-24

This is a read-only snapshot before Plan 18 product-code work. The shared worktree is already dirty. Preserve all pre-existing edits and untracked files; do not stage them broadly or infer a committed baseline.

| Existing target state | Paths |
| --- | --- |
| Tracked, modified before Plan 18 | `schema.ts`, `tenantData.ts`/`.test.ts`, `tenantExport.ts`/`.test.ts`, `tenantDelete.ts`/`.test.ts` |
| Untracked, already present before Plan 18 | `tenantInventory.ts`/`.test.ts`, `tenantOrder.ts`/`.test.ts`, `tenantCatalogue.ts`/`.test.ts`, `tenantOrders.ts`/`.test.ts` |

Exact focused pre-edit checks on the current working tree:

- `pnpm --filter @pikar/core test src/tenantInventory.test.ts src/tenantOrder.test.ts`: 10/10, exit 0.
- `pnpm --filter @pikar/backend test convex/tenantCatalogue.test.ts convex/tenantOrders.test.ts`: 14/14, exit 0.
- `pnpm --filter @pikar/core test src/tenantData.test.ts`: 17/17, exit 0.
- `pnpm --filter @pikar/backend test convex/tenantExport.test.ts convex/tenantDelete.test.ts`: 44/44, exit 0.

These tests exercise the existing local model, not the new goods-kind and merchant-policy scope. The current `OrderPolicy` has one `shippingMinor` and no physical/digital product-kind field; the baseline does not qualify a digital-only or mixed cart. `50-18-SUMMARY.md` must compare its final changed paths with this baseline and run the new positive/refusal controls.
