# Plan 50-02 shared-file pre-edit baseline

Captured before this plan's edits. These paths already had unrelated worktree changes. Root review must compare the plan's additions against this baseline, not attribute the entire worktree diff to Plan 50-02. SHA-256 is of each exact pre-edit worktree file.

| Path | SHA-256 | Existing unstaged diff (+/-) |
| --- | --- | --- |
| `packages/backend/convex/schema.ts` | `22397FAF9274AFE66EE2994A112154AD779BA91B43E4B8193B4B1E5688BEC38B` | 228/2 |
| `packages/core/src/tenantData.ts` | `A4602845AC267FB118BD9F575E27C7DEA9269911ADF9F5A771EBE2CA3EA64719` | 10/0 |
| `packages/core/src/tenantData.test.ts` | `B1B0CAFA6637BE77071679DFEE417D89B9A3DFE4802370A618F34C20325F4150` | 17/1 |
| `packages/backend/convex/tenantExport.test.ts` | `F935A1878D4518C233EA98F46EE77994C06853C4DC844D08B3C5519F180750E0` | 97/1 |
| `packages/backend/convex/tenantDelete.test.ts` | `11F0701273CA117F7CE31233BC4F13143702F5A4622F57ED628B977A08C138C4` | 102/5 |
| `docs/playbooks/audit-dead-letter.md` | `E344D855D9C26EBD2EEDA6597657AF912268A30340343383188C2F1107957460` | 5/0 |
| `docs/playbooks/skill-registry.md` | `4AD03FF4935B33AD44648BA9B68634F46105F3CC81FF151DD3845CBA6383C164` | 136/0 |

Pre-existing staged user files are not part of Plan 50-02 and must remain untouched.
