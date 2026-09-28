# Plan 30-08 Task 1 — local candidate registry checkpoint

The current repository already routes all six vertical bodies through the Phase 29 native `publishPack` path via the explicit `seedVerticalCandidates` mutation. This task added `verticalPackRegistry.test.ts` as a regression around that existing implementation. No registry mutation, candidate publication to a deployment, activation, provider call or paid evaluation was performed in this checkpoint.

The focused checks confirm exact-six candidate names (`vertical-data`, `vertical-design`, `vertical-engineering`, `vertical-hr`, `vertical-legal`, `vertical-product`), LF-normalized canonical body/hash parity, persisted provenance matching each reviewed manifest (source repo, commit, paths, license, modification notice, version pin and body hash), candidate-only rows with no evidence or browser evidence, idempotent initial seeding, independent version allocation for all six names, and rejection of `vertical-bio`. The six reviewed operation matrices agree with the code-owned `searchVault` and `saveAsDocument` grant across the three tiers; forbidden operations have no tools. The Data matrix additionally describes its owner-only deterministic preview, which grants no model tool.

Local verification on 2026-09-28:

- `pnpm --filter @pikar/contracts test -- skillBodies`: 56/56 passed.
- `pnpm --filter @pikar/backend test -- verticalPackBinding`: 13/13 passed.
- `pnpm --filter @pikar/backend test -- verticalPackRegistry`: 3/3 passed.
- `pnpm --filter @pikar/contracts typecheck`: passed.
- `pnpm --filter @pikar/backend typecheck`: passed.

The registry implementation predated this checkpoint, so the new regression passed on its first run; this is a current-state verification, not a claim of a newly observed TDD red-to-green transition. Task 2's exact-candidate outcome/adversarial eval and Task 3's owner evidence review remain open. These free local checks do not supply semantic, provider, browser, activation or release evidence.
