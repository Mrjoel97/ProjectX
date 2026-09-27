# Plan 50-05 pre-edit baseline (2026-09-24)

All hashes below are SHA-256 of working-tree bytes before Plan 05 edits. These paths already contained user/other-plan work, so this plan must preserve those bytes except for narrow owned additions. No staging or commit is authorized for this worker.

| Path | Pre-edit Git status | SHA-256 |
| --- | --- | --- |
| `packages/backend/convex/http.ts` | modified, +154/−0 unstaged | `9DF864B7E94862E90DD4A215EBD88626311BBB2D946B92FDDF78A88771D3B7B2` |
| `packages/backend/convex/isolation.test.ts` | modified, +280/−17 unstaged | `4DA1D8A1A97967326CA491DA86D1DB38FB6A4781103B4A8A1064F286AECA8C1E` |
| `docs/playbooks/tenant-commerce.md` | modified, +45/−3 unstaged | `E7DBD438ACEAE64A4B9F733B4490B3EC023741CDF2844CED48474B0298638EB0` |
| `docs/playbooks/cockpit.md` | modified, +15/−0 unstaged | `7AEA46AADD81606CF036973FC4B23972F1081E44B73770725F99DF4B0FDD0163` |
| `docs/playbooks/public-web-runtime.md` | untracked pre-existing Phase 48/49 playbook | `0B6129A731823337AE5F7B62360AD05946163EE4BFA6EA915F6509FA6DF89249` |
| `docs/playbooks/authorization.md` | modified, +14/−0 unstaged | `470570F1EA12829D174C9AFA91A115A3466D5056B3D2AC075762415D58EE8801` |
| `packages/backend/convex/tenantOrders.ts` | untracked pre-existing Plan 04 | `68BE4F56C3CCC45365D33D1D94B481092F487AF56D8DB1CA863B4D81AAC2DD06` |
| `packages/backend/convex/tenantOrders.test.ts` | untracked pre-existing Plan 04 | `493862C921F7F01C954A04BDD2831B6F4BB88940623CC1542F1BC02C4BC45258` |
| `packages/backend/convex/webProjects.ts` | untracked pre-existing Phase 48/49 | `545E2DAF2BD341C2464E64B81F5E0E176B7653F5DDD312B906CFA7E3A6E2FDC2` |
| `packages/backend/convex/webProjects.test.ts` | untracked pre-existing Phase 48/49 | `0FAA296B9C2D20514080AFFA337617BD9BC63780CF9A79D88ECE96A3F03EF123` |

`tenantCommerceHttp.test.ts` did not exist before Plan 05. The HTTP baseline adds the Phase 48 `/p/` GET/POST public runtime ahead of unrelated existing auth and billing routes; it must not be replaced. The isolation baseline includes the Phase 50 Plan 03 two-tenant catalogue matrix. The expanded untracked Plan 04 and Phase 48/49 source/test files are entire pre-existing artifacts, not Plan 05 creations. Plan 05 will add only dedicated commerce-boundary functions/tests and short playbook entries; root will compare against this baseline before any Git integration.
