# Plan 50-03 shared-file pre-edit baseline

Captured before this plan's edits. Root review should attribute only the Plan 03 additions below;
the rest of these files' working-tree changes predate this plan. SHA-256 values are exact
pre-edit worktree bytes.

| Path | Pre-edit SHA-256 | Plan 03-owned hunk |
| --- | --- | --- |
| `packages/backend/convex/isolation.test.ts` | `17A9D5F16062C41FF8391DAB03FF833C018F3C76984000DB6BFDD5C2383317C1` | Import `makeFunctionReference` and aggregate schema; append `tenant catalogue production adapter isolation` two-tenant/owner/anonymous matrix after the pre-existing behavioral matrix. |
| `docs/playbooks/authorization.md` | `3327BC2E2E3FCDFA093DFAD86415216C86DFFB8CB1F11328D69CD107B115E78F` | First 2026-09-24 `Last verified` paragraph for the catalogue identity boundary only. |
| `docs/playbooks/tenant-commerce.md` | `C2CBD4E17D624023B2C8DFE235C60645498601D4D48766F967B5C1777E6F5523` | Advance `Last verified` to Plan 03, document authenticated controls/isolation/verification, and advance known-gap plan range to 04–15. The Plan 02 text below remains preserved. |
| `docs/playbooks/public-web-runtime.md` | `EBDD48EE395AF9DB615C6686910B6CBF5C6A36486A36578128441517FD731A48` | First 2026-09-24 `Last verified` paragraph for private catalogue controls and unchanged public darkness. |
| `apps/web/app/(app)/dashboard/sites/page.tsx` | `6842C64BF21E97E6327080D0FE09CADC9C9CFF3AB08C218D048BA2688EC31FB9` | Import and mount `<TenantCatalogue />` in the authenticated sites page; no existing site editor branch changed. |

`TenantCatalogue.tsx` and `tenantCatalogue.test.tsx` were absent before this plan. Root
explicitly approved the one-file page mount expansion because the planned component would
otherwise have been inaccessible. The `50-03-PLAN.md` files list was updated accordingly.
All work remains uncommitted for root's single batched review; unrelated staged and untracked
user files are not part of this plan.
