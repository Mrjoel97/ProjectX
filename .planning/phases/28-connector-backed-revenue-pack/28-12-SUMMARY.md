---
phase: 28-connector-backed-revenue-pack
plan: 12
subsystem: governed-agent-tools
tags: [revenue, crm, finance, tools, audit, prompt-injection]
requires:
  - phase: 28-connector-backed-revenue-pack
    provides: normalized CRM and deterministic business-finance results from plans 28-10 and 28-11
provides:
  - Static revenue specialist route with an immutable three-tool grant
  - Bounded CRM and business-finance read tools in the existing governed loop
  - Provider-content evidence fence and refs/counts/status-only audit payloads
affects: [28-13, 28-19, 28-20, 28-21]
tech-stack:
  added: []
  patterns:
    - Capability tuples are identity-checked before structurally constructing tool closures
    - Provider output is projected to closed enums, opaque refs, counts and code-owned numbers
key-files:
  created:
    - packages/backend/convex/revenueTools.ts
    - packages/backend/convex/revenueTools.test.ts
  modified:
    - packages/core/src/specialists.ts
    - packages/core/src/specialists.test.ts
    - packages/contracts/src/skill.ts
    - packages/backend/convex/llm.ts
    - packages/backend/convex/cockpitTools.test.ts
    - docs/playbooks/cockpit.md
    - docs/playbooks/revenue-connectors.md
key-decisions:
  - "A copied array with the same tool names is not a revenue grant; only the immutable code-owned tuple opens the closures."
  - "Provider free text, missing reasons and exclusion prose are omitted rather than sanitized into model-visible instructions."
  - "The structured refusal is a third local tool with a closed reason enum and no action authority."
patterns-established:
  - "Revenue evidence fence: typed facts inside <revenue_evidence>; explicit evidence-not-instructions sentence outside."
  - "Revenue audit boundary: opaque refs, counts, environments and closed status values only."
requirements-completed: [REVN-04, REVN-05, REVN-06]
duration: 52min
completed: 2026-08-31
---

# Phase 28 Plan 12: Governed Revenue Tools Summary

**The governed loop now exposes CRM and deterministic finance evidence through an immutable, read-only three-tool specialist grant.**

## Performance

- **Duration:** 52 min
- **Started:** 2026-08-31T15:58:00Z
- **Completed:** 2026-08-31T16:50:00Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Added the `revenue` specialist route and seven workflow registry identifiers with the exact
  `readRevenueCrm`, `readBusinessFinance`, `declareUnsupported` capability tuple.
- Registered bounded CRM/finance tools only when the runtime receives that same immutable tuple.
- Kept partial/unavailable semantics honest and omitted provider-controlled prose while retaining
  typed numbers, opaque refs, coverage, counts and code-owned enum labels.
- Added tenant-scoped provider-ref resolution and refs/counts/status-only audit rows.
- Documented the runtime grant, evidence fence and forbidden write/paid capabilities in both watched
  operational playbooks.

## Task Commits

1. **Task 1: Add the static revenue specialist grant** — `418eba7` (feat; inherited from the interrupted parallel executor)
2. **Task 2: Register bounded revenue read tools** — `5d41e8d` (feat), `cc973ee` (fix: complete the promised structured-refusal grant)
3. **Task 3: Update watched capability-boundary documentation** — `241ccaa` (docs)

## Decisions Made

- Tool-name equality is insufficient authority: `isRevenueToolGrant` requires the exact frozen
  tuple object, and direct `buildCockpitTools` tests prove the closures are absent otherwise.
- Free text from `missing`, `because`, `from`, CRM notes, names, addresses and provider labels is
  never copied into the model-facing result. Counts replace missing/exclusion prose.
- `declareUnsupported` accepts only `unavailable`, `partial` or `unsupported_operation` and changes
  no plan, provider, CRM or accounting state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Completed the declared three-tool grant**

- **Found during:** Task 2 verification
- **Issue:** The interrupted implementation exposed the two reads but omitted the tuple's
  `declareUnsupported` tool, leaving code and contract inconsistent.
- **Fix:** Added a closed-enum, side-effect-free structured refusal and expanded structural tests.
- **Files modified:** `revenueTools.ts`, `revenueTools.test.ts`, `cockpitTools.test.ts`
- **Verification:** revenueTools 5/5; cockpitTools 149/149; backend typecheck exit 0
- **Committed in:** `cc973ee`

**Total deviations:** 1 auto-fixed bug. **Impact:** Closed a capability-contract mismatch without
widening authority.

## Issues Encountered

- All original subagents hit the account usage ceiling after partial commits. Work resumed from the
  shared tree; committed progress was preserved and no history was rewritten.
- The repository-level `biome` executable is unavailable through `pnpm exec`; focused Vitest,
  TypeScript and playbook gates passed.

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter @pikar/core test -- specialists` | Passed in inherited Task 1 evidence |
| `pnpm --filter @pikar/contracts test` | Passed in inherited Task 1 evidence |
| `pnpm --filter @pikar/backend test -- revenueTools cockpitTools dispatch` | 288/288 after Task 2; focused re-run 154/154 after refusal fix |
| `pnpm --filter @pikar/backend typecheck` | exit 0 |
| `'{}' \| node scripts/check-playbooks.mjs check` | silent/pass |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 28-13 can add the executive-only reminder staging tool without granting it to the revenue
  specialist.
- Candidate evaluation and activation remain serialized in plans 28-19 and 28-20.

## Self-Check: PASSED

- `packages/backend/convex/revenueTools.ts` — FOUND
- `packages/backend/convex/revenueTools.test.ts` — FOUND
- Commits `418eba7`, `5d41e8d`, `cc973ee`, `241ccaa` — FOUND
- No `## Self-Check: FAILED` marker — CONFIRMED

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-08-31*
