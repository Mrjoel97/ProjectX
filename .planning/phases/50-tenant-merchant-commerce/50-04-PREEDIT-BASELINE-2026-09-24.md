# Plan 50-04 shared-worktree baseline

Captured before Plan 04 edits, with SHA-256 from `Get-FileHash`. These files already included
uncommitted work from earlier plans and other users. Root must stage reviewed hunks, not files
wholesale. Plan 04 made no commit.

| Overlapping file | Pre-edit SHA-256 | Plan 04 owned hunks |
| --- | --- | --- |
| `packages/backend/convex/schema.ts` | `556E12B16719F69EBBA845AB1871E4C3FFEB6C2307B7016498A19658D0F9BB28` | table index count/list; optional order/attempt reservation links and index; five new local commerce table definitions |
| `packages/core/src/tenantData.ts` | `C4C7D4B4915766FCCAC7637A4C1A32D4E59212262745725A0454DF0072FD66AF` | five Plan 04 tenant-owned classifications and retention comment |
| `packages/core/src/tenantData.test.ts` | `2E113884E95ED6B46339FA0D699362C21371265DFD187746A167D1DCF18A8074` | count 71→76 and five-table classification assertion |
| `packages/backend/convex/tenantExport.ts` | `3F5AC2F711C2F23850D68D56FC0E689710E6D8330F6CF98FCD0362810A53D3BA` | Plan 04 classification/export explanatory comment |
| `packages/backend/convex/tenantDelete.ts` | `5BC8D79830096F4F6896B8D2AF1181A5B9849216CF5F1788150AB013B4F215F3` | preflight refusal when any tenant order exists |
| `docs/playbooks/tenant-commerce.md` | `54054E755ABEE0687F14152F8EEA247AD1E6E28CE4DDAD34DC489E5F22051377` | Last verified, Plan 04 local order flow, invariants, verification and gaps |
| `docs/playbooks/audit-dead-letter.md` | `836329794B243562D23FDC3A2F4F25602368E9F8B6D7C67293A01A15C96E322A` | new leading Plan 04 tenant-data/audit entry |
| `docs/playbooks/skill-registry.md` | `F6EB6A4C200259E32E29DD104E60E5438BFE53D3DE8B882F3576A8EA9DC35B9` | new leading Plan 04 schema entry |

`tenantOrder.ts`, `tenantOrder.test.ts`, `tenantOrders.ts`, and `tenantOrders.test.ts` did not
exist at this baseline and were created by Plan 04. The current shared worktree also contains
many unrelated modified, staged, and untracked files. They were preserved.
