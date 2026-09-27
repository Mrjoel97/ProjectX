# Plan 50-19 pre-edit baseline — 2026-09-24

All nine Plan 19 owned source/test/playbook paths were already tracked and modified in the shared worktree before this plan. Preserve their existing edits and every unrelated dirty/untracked file. Plan 18's eleven-file goods-kind/policy implementation and schema are locally verified but not staged or committed; they are read-only inputs for Plan 19.

| Plan 19 owned path | Pre-edit SHA-256 |
| --- | --- |
| `packages/core/src/tenantData.ts` | `4A187BC7819D73943B82FBCE70CAF08F6BB6021FB4F111DB5B1C85DF2AD1832D` |
| `packages/core/src/tenantData.test.ts` | `34D9DAF609B8B7B48AF617AD3704CF8B686D62ECB78CB52E5DFFAE99F8492A41` |
| `packages/backend/convex/tenantExport.ts` | `6C1B2EE4BAD69E625F498174215E513B81BC0F70F7A1964A3FC5960633BBD0CD` |
| `packages/backend/convex/tenantExport.test.ts` | `5D82A5661EEBE1919EC4779456E1CB1C81DAF194AA050E6A80EA6E7A99A5FBAB` |
| `packages/backend/convex/tenantDelete.ts` | `25D7282DD76AF3D091CB24A16C128C8D688059E4A33F0D0E8B477F78BD8CC584` |
| `packages/backend/convex/tenantDelete.test.ts` | `F637F74A852FD2948C3755CB8684F5E93B489CCA02405004FE3116643E99FEE2` |
| `docs/playbooks/tenant-commerce.md` | `F7533D66518CDE3DBF051DD5A55EEF09D7DF535CC644195CAEF78A160E2A736A` |
| `docs/playbooks/audit-dead-letter.md` | `BB8DE3EFC2EC3D680A4DD634ACB1871D1AACC5B7D0F6EFDC5D780B61EECBBAD7` |
| `docs/playbooks/skill-registry.md` | `FBED690ADDB226F0ADC69CA44DA0A6738AB47F48DCE8075A909B03C2F4B37300` |

Pre-edit focused tests on the current working tree: `pnpm --filter @pikar/core test src/tenantData.test.ts` passed 17/17; `pnpm --filter @pikar/backend test convex/tenantExport.test.ts convex/tenantDelete.test.ts` passed 44/44. These do not establish Plan 19's new field classification or merchant-safe export controls.
