---
phase: 27-curated-knowledge-work-pack-pilot
plan: 03
subsystem: workflow-packs
tags: [telemetry, metrics, privacy, tenant-isolation, append-only]

requires: ["27-02"]
provides:
  - Pure outcome metric definitions with explicit not-applicable semantics
  - The sole append-only write surface for the workflowPackEvents table
  - A tenant-derived bounded read model returning the metric shape
affects: [workflow-packs, tenant-data-plane]

tech-stack:
  added: []
  patterns:
    - not_applicable as a first-class metric answer, distinguishing zero_denominator from no_data
    - privacy enforced by two independent closed validators rather than by convention
    - metric input type with nowhere to put cost or latency

key-files:
  created:
    - packages/core/src/workflowPackMetrics.ts
    - packages/core/src/workflowPackMetrics.test.ts
    - packages/backend/convex/workflowPackEventLog.ts
    - packages/backend/convex/workflowPackEventLog.test.ts
  modified:
    - packages/core/src/index.ts
    - packages/backend/convex/_generated/api.d.ts
    - docs/playbooks/workflow-packs.md

key-decisions:
  - "A zero denominator is `not_applicable`, never 1.0 or 0.0 — and `zero_denominator` is a different answer from `no_data`."
  - "Time to first useful outcome has THREE unknowns and never returns a negative duration: a useful run predating onboarding is a broken clock, not a fast onboarding."
  - "Cost and latency are absent from `PackMetricEvent` structurally, so no function can produce a second billing number; `PACK_DERIVED_METRIC_SOURCES` names their real owners."
  - "`tenantId` is an ARGUMENT on the recorder (emitters are actions, the `audit.log` shape) but wrapper-DERIVED on the read model, which is the surface a client can reach."
  - "`internalMutation` needs no allow-list entry — `lib/allowlist.ts` documents that the import guard's regex matches only lowercase `query`/`mutation`."
  - "watch.json needed no change: 27-02's `packages/core/src/workflowPack` and `packages/backend/convex/workflowPack` prefixes already cover both new files (verified by running the prefix match, not by eye)."

patterns-established:
  - "A metric module's INPUT TYPE is where a prohibition lives: no field for cost means no function can emit one."
  - "A privacy claim about an event table is proven by making the write REFUSE each plausible content field, and by mutating every validator in the path to show which one does the refusing."

requirements-completed: [PACK-04]

duration: 21min
completed: 2026-08-23
---

# Phase 27 Plan 03: Pack Measurement Plane Summary

**The pilot can now be judged on completed useful outcomes rather than installations — and the plane
that measures it structurally cannot hold a prompt, an output, a customer name, a financial value,
or a second cost number.**

## Performance

- **Duration:** ~21 min
- **Tasks:** 2
- **Files created/modified:** 7
- **Cost:** $0.00 — offline, no deployment touched, no model call.

## Accomplishments

- **Eight metric definitions** as pure functions over the closed event vocabulary: time to first
  useful outcome, recommendation acceptance, plan decisions, missing-connector surprise, citation
  coverage, unsupported-claim rate, completion outcomes and follow-up recovery.
- **`not_applicable` as a first-class answer**, splitting `zero_denominator` from `no_data`. A run
  that made no claims contributes to neither side of citation coverage rather than earning a free
  100%.
- **Cost and latency made unrepresentable.** `PackMetricEvent` has no field for either;
  `PACK_DERIVED_METRIC_SOURCES` names `spendEvents` (rail `reasoning`, `by_correlation`) and
  `telemetry.durationMs` / `agentSteps` as the owners to join to.
- **The sole append-only write surface**, insert-only and enforced by a source scan — the table is
  `audit_immutable`, and an update path there would leave rows outside the tenant deletion walk that
  are still rewritable.
- **A tenant-derived, bounded read model** returning the metric shape rather than raw rows.

## Verification — all executed

```
cd packages/core && npx vitest run                          43 files / 1174 passed
cd packages/core && npx tsc --noEmit                        clean
cd packages/backend && npx tsc --noEmit                     clean
cd packages/backend && npx vitest run                       97 files / 2404 passed (FULL suite)
npx biome ci . --diagnostic-level=error --max-diagnostics=none    676 files, clean
```

### Mutations observed RED, then restored green

| Mutation | Result |
|---|---|
| the read model's `Math.min` clamp removed | the bounded-read test reddens |
| `note: v.optional(v.string())` added to the recorder's ARGS validator | still green — see below |
| `note` added to the TABLE validator as well | the "a note field is refused" test reddens |

## The finding worth carrying forward

**One test was vacuous on first writing, and I caught it by asking the right question rather than by
running it.** The bounded-read case seeded five rows and requested a limit of 1,000,000 — it passed
whether or not the query clamped anything at all. It now seeds past `PACK_EVENT_PAGE_MAX`, and
removing the clamp reddens it. Same class as phase 26's ordering tests: a test that never approaches
the boundary it claims to check.

**Privacy is defended twice, and I only learned that by mutating.** Widening the recorder's ARGS
validator did NOT redden the content-rejection tests, which initially looked like the tests passing
for the wrong reason. Probing the actual error showed why: `record` spreads its args into
`ctx.db.insert`, so the TABLE's own closed validator refuses the field a second time
(`Unexpected field 'note' in object`). A text field becomes storable only if BOTH validators are
widened. That is a stronger property than the one I set out to assert, and it is now recorded in the
test and the playbook so a future reader does not "simplify" one of the two away believing the other
covers it.

## Deviations from the plan

- **`docs/playbooks/watch.json` is unchanged.** The plan said to register the `workflowPack` prefixes
  "if 27-02 has not" — it had. Verified by running the actual `startsWith` match for both new files
  rather than reading the file, since the point of the prefix is what it matches.
- **`packages/backend/convex/_generated/api.d.ts`** is in the commit because a new Convex module
  changes it and it is a tracked file.

## Next

27-01 (upstream provenance) is the only remaining wave-1 plan and is now the phase's critical path:
27-04/05/06 all declare `depends_on: ["27-01", "27-02"]`, so no pack body can be authored until it
lands. It is also the one plan the phase context says **halts on its first task as written** — its
source table names `small-business/skills/ticket-deflector/`, which does not exist at pinned SHA
`5267cf7`, and Sales Call Prep and Process/SOP Builder were never inventoried at all. It needs the
upstream tree re-inventoried at that SHA, and it needs the phase's one network fetch.
