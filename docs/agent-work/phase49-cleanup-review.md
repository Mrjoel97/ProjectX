# Phase 49 cleanup safety review

Status: `accepted` — cleanup/setup safety slice only, root review 2026-09-23.

Root inspected the actual seeder, ownership marker, deployment guard, bounded cleanup and
preservation tests after one consolidated correction. A fresh focused run passed all three
cleanup tests (196 unrelated tests skipped); the worker's full 199-test run and backend/web
typechecks are recorded below. This does not accept Plan 06 or its browser evidence protocol.

## Scope and changes

- `packages/backend/convex/schema.ts`: added the optional `qualificationFixtureRunId` marker to
  skill rows.
- `packages/backend/convex/skills.ts`: added a dedicated fixture seeder gated by the shared
  `offlineSeamAvailable()` consent and an exact loopback `http://` `CONVEX_SITE_URL` origin with a
  valid explicit port. Its initial call rejects any existing row in the three recipe families,
  mints a run token and stamps only newly inserted rows. A later seed requires exactly one active,
  validly evidenced v1 per family with that token. Cleanup requires the same deployment guard,
  token and exact captured ids; it caps ids at six, scans each family with `.take(7)`, and refuses
  duplicate ids, non-recipe or wrong-run ids, and any uncaptured family row before deleting.
- `packages/backend/convex/skills.test.ts`: added regressions for missing offline consent, a keyed
  deployment, remote/missing/malformed/credential-bearing site URLs, valid loopback, nonempty
  historical baselines and exact-state preservation, duplicate ids, captured unmarked/non-recipe
  rows, wrong tokens, v2 state requirements, uncaptured v2 rows, and successful exact-id cleanup.
- `apps/web/e2e/phase49-recipe-qualification.spec.ts`: refuses setup when any recipe row exists,
  captures the seeder-returned IDs for both version waves, and supplies those IDs and the server
  token to cleanup.
- `docs/playbooks/skill-registry.md`: documented the isolated fixture, marker and cleanup invariant.
- `docs/agent-work/phase49-cleanup-review.md`: this review handoff.

## Verification

- `pnpm --filter @pikar/backend test -- convex/skills.test.ts` — passed, 199 tests.
- `pnpm --filter @pikar/backend typecheck` — passed.
- `pnpm --filter @pikar/web typecheck` — passed.
- No E2E runtime, production deployment, provider call, dependency install or commit was run.
- `graphify query` and `graphify update .` produced no output within the 10-second bound and were
  stopped. `node scripts/extract-convex-edges.mjs` — passed after the graph refresh timeout.
- Direct Biome `check --write` completed on the four owned TypeScript files. It reported 74 existing
  `noNonNullAssertion` warnings in `skills.test.ts`; it applied formatting and no unsafe fixes.

Review remains limited to cleanup/setup ownership and safety. The browser-evidence trust and
qualification-protocol findings in the root review remain separate and unresolved by this change.
