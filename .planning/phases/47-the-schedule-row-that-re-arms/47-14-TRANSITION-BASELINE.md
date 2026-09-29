# Plan 47-14 bounded-transition baseline

Captured 2026-09-24 before Task 3. Owner accepted the exact draft. Historical `--validate-decision` exited 0 (`defer`). These hashes identify the exact pre-transition files; unrelated worktree changes are not recovery targets.

| File | SHA-256 before Task 3 |
| --- | --- |
| `packages/backend/scripts/check-routine-gate.mjs` | `6ee826820abcc58e1c1d735ab0b0c2abc5b7368757e864453a7ce91ddef94090` |
| `packages/backend/convex/routineDecision.test.ts` | `18d0f0c04d8e01e2252cceeddc8db3bf908f25aef115a21115f1dbcda75f9990` |
| `docs/playbooks/knowledge-search-routines.md` | `157866225819f462b86c12bdd8b6cbfc39bef567f45cd23f90dae6ee116bfc36` |
| historical `29-RECURRENCE-DECISION.md` (must remain untouched) | `cc7d4a8667ba5ed9be584e059964708b14433be751ae845dd09a7bdbb775e2ce` |
| `packages/backend/convex/dstProbe.ts` (must remain untouched) | `c265841a87574166cb5957f6e7ac68ddf54c9c96299146a4e00177829311d0c0` |

The accepted ADR-050 and stage-decision paths were absent. The planning draft existed and now records the owner's exact-text verdict. If Task 3 or its technical review fails, restore only Task 3 edits to its three existing files and remove only its two new artifacts; keep this baseline and the accepted draft.
