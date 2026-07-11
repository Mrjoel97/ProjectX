---
phase: 02-thin-end-to-end-slice
plan: 02
subsystem: api
tags: [llm, ai-gateway, zod, convex, skills-registry, generateObject, routing]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: skills registry (loadSkill/getActiveSkill/seedSkills), immutable-per-version .ts↔.md drift guard
  - phase: 02-01
    provides: requests table + schema; gmailAuth.getForDelivery internal reader
provides:
  - routingDecision contract (routingSchema + parseRouting → unknown_route, never a default)
  - draftSchema output contract (subject + body, recipient never model-derived)
  - executive-router + email-drafter skills seeded in the registry (each v1, active)
  - convex/llm.ts route + draft internalActions through the Vercel AI Gateway
affects: [02-06 pipeline, 03 guardrails/redaction, 08 skill-optimization]

# Tech tracking
tech-stack:
  added: [ai@7.0.20 generateObject via Vercel AI Gateway (bare string model id)]
  patterns:
    - "Schema-constrained LLM output: generateObject(schema=zod contract) + discriminated parse → throw on invalid, never default (AGNT-03)"
    - "Prompts load from the skills registry at runtime via ctx.runQuery(getActiveSkill); no prompt hardcoded in source (CLAUDE.md §5)"
    - "Output/domain schemas live in @pikar/contracts so the use-node adapter stays zod-free and thin (CLAUDE.md §1)"

key-files:
  created:
    - packages/contracts/src/routing.ts
    - packages/contracts/src/routing.test.ts
    - packages/contracts/src/drafting.ts
    - packages/contracts/skills/executive-router.md
    - packages/contracts/skills/email-drafter.md
    - packages/contracts/src/skills/executiveRouter.ts
    - packages/contracts/src/skills/emailDrafter.ts
    - packages/backend/convex/llm.ts
  modified:
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - packages/contracts/src/skill.ts

key-decisions:
  - "Two skill rows (executive-router + email-drafter), not one — different failure modes, optimized against different evidence in Phase 8"
  - "Draft output schema lives in @pikar/contracts (drafting.ts), not inline in the backend, so the use-node adapter needs no zod dependency"
  - "route reuses gmailAuth.getForDelivery (its subject field carries the raw goal pre-draft) rather than adding a second request reader"
  - "Single MODEL constant (openai/gpt-4o-mini) so Phase-3 GRDL-03/05 can vary the model in one place; bare string routes through the AI Gateway with no provider import"

patterns-established:
  - "AGNT-03 no-silent-default lives in the type system: parseRouting collapses any invalid output to unknown_route, the action throws it, the pipeline dead-letters deterministically"
  - "usage (inputTokens/outputTokens) returned from every LLM action for OPSG-01 telemetry"

requirements-completed: [AGNT-01, AGNT-02, AGNT-03]

# Metrics
duration: 28min
completed: 2026-07-11
---

# Phase 2 Plan 02: Executive Agent LLM Surface Summary

**Schema-constrained routing decision (routingSchema + parseRouting → unknown_route, never a default) plus registry-loaded route/draft actions through the Vercel AI Gateway, with the draft-output contract kept in the pure contracts package.**

## Performance

- **Duration:** 28 min (18:09→18:37, spanning two sessions; Task 3 this session)
- **Started:** 2026-07-11T15:09:40Z
- **Completed:** 2026-07-11T15:37:51Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments
- `routingSchema` (enum route + steps[] + rationale) with `parseRouting` returning a discriminated `{ok}` / `{ok:false, reason:"unknown_route"}` — AGNT-03's "never a silent default" now lives in the type system (6 tests green).
- `executive-router` + `email-drafter` seeded as two registry rows (v1, active) via the existing `seedSkills`; the `.ts`↔`.md` drift guard extended to both (8 skills tests green).
- `convex/llm.ts` (`"use node"`, internalActions only): `route` and `draft` load their prompts from the registry via `ctx.runQuery`, call `generateObject` through the AI Gateway (bare string model id, no provider import), and return `usage` for telemetry.

## Task Commits

1. **Task 1: routingDecision contract + tests** (TDD) - `bfd5fd5` (test RED) → `4182e53` (feat GREEN)
2. **Task 2: Seed executive-router + email-drafter skills** - `79162c4` (feat)
3. **Task 3: LLM route + draft action (AI Gateway)** - `28cf9e7` (feat)

**Plan metadata:** _(final docs commit)_

## Files Created/Modified
- `packages/contracts/src/routing.ts` - routingSchema + parseRouting + RoutingDecision type
- `packages/contracts/src/routing.test.ts` - 6 tests (valid parse, unknown route rejected, malformed rejected)
- `packages/contracts/src/drafting.ts` - draftSchema output contract (subject + body)
- `packages/contracts/skills/executive-router.md` + `src/skills/executiveRouter.ts` - router prompt (canonical .md + derived .ts)
- `packages/contracts/skills/email-drafter.md` + `src/skills/emailDrafter.ts` - drafter prompt
- `packages/backend/convex/skills.ts` - seedSkills extended with both new skills
- `packages/backend/convex/skills.test.ts` - drift guard extended to both new .ts↔.md pairs
- `packages/contracts/src/skill.ts` - EXECUTIVE_ROUTER_SKILL / EMAIL_DRAFTER_SKILL name constants
- `packages/backend/convex/llm.ts` - route + draft internalActions

## Decisions Made
- **Draft schema in contracts, not the adapter:** `zod` is not a backend dependency, and CLAUDE.md §1 keeps the `"use node"` adapter thin. Put `draftSchema` in `@pikar/contracts/drafting` (mirroring `routingSchema`) instead of adding `zod` to the backend.
- **Reused `gmailAuth.getForDelivery`** to read the goal (its `subject` field carries the raw goal pre-draft) rather than adding a near-identical request reader.
- **Single `MODEL` constant** so Phase-3 GRDL-03/05 can swap the model in one place; the bare string id routes through the AI Gateway.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Draft output schema moved to `@pikar/contracts/drafting`**
- **Found during:** Task 3 (LLM route + draft action)
- **Issue:** The plan wrote `draftSchema` inline in `convex/llm.ts` with `import { z } from "zod"`, but `zod` is not a backend dependency (`TS2307: Cannot find module 'zod'`). Adding `zod` to the backend would also violate CLAUDE.md §1 (the `"use node"` module is a thin adapter; domain schemas live in `packages/*`).
- **Fix:** Created `packages/contracts/src/drafting.ts` exporting `draftSchema` + `DraftOutput` (mirroring `routingSchema`), imported it into `llm.ts`. Backend stays zod-free.
- **Files modified:** packages/contracts/src/drafting.ts (new), packages/backend/convex/llm.ts
- **Verification:** `pnpm --filter @pikar/backend typecheck` — 0 errors attributable to llm.ts/drafting.ts (confirmed by `git stash -u` baseline diff).
- **Committed in:** `28cf9e7` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix keeps the adapter thin and zod-free per CLAUDE.md §1; no scope creep (one 18-line contract file replacing an inline schema).

## Issues Encountered
- **Pre-existing backend typecheck errors (18):** `pnpm --filter @pikar/backend typecheck` reports 18 errors, ALL in files not touched by this plan (`*.test.ts` `import.meta.glob`, `smoke.ts` implicit-any). Confirmed pre-existing via `git stash -u` baseline (identical count with/without this plan's files). Out of scope; logged in `deferred-items.md` (re-confirmed for 02-02). The real function typecheck (`npx convex codegen`) passes.

## User Setup Required
`AI_GATEWAY_API_KEY` must be set on the Convex deployment for `llm.route`/`llm.draft` to reach the Vercel AI Gateway. Runtime behavior is exercised by the pipeline smoke in plan 02-06; this plan verifies the contract + typecheck surface only.

## Next Phase Readiness
- `route` and `draft` steps are ready for the pipeline to wire in plan 02-06.
- Phase 3 (GRDL-01) slots a redact step AHEAD of the `generateObject` prompt sites (marked with `ponytail:` comments in `llm.ts`).
- `usage` is returned from both actions, ready for OPSG-01 telemetry recording.

---
*Phase: 02-thin-end-to-end-slice*
*Completed: 2026-07-11*

## Self-Check: PASSED

All created files and task commits (bfd5fd5, 4182e53, 79162c4, 28cf9e7) verified present on disk and in git history.
