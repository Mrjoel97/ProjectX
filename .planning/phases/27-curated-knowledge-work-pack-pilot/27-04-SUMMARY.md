---
phase: 27-curated-knowledge-work-pack-pilot
plan: 04
subsystem: workflow-packs
tags: [skill-bodies, fixtures, honest-partial, provenance]

requires: ["27-01", "27-02"]
provides:
  - Business Pulse and Campaign Plan candidate bodies as .md/.ts pairs with drift rows
  - Ten fixtures asserting structured outcome, source coverage and exact tool traces
affects: [skill-registry, workflow-packs, eval-harness]

tech-stack:
  added: []
  patterns:
    - one fixture FILE per pack, holding an array of cases

key-files:
  created:
    - packages/contracts/skills/pack-business-pulse.md
    - packages/contracts/skills/pack-campaign-plan.md
    - packages/contracts/src/skills/packBusinessPulse.ts
    - packages/contracts/src/skills/packCampaignPlan.ts
    - packages/backend/scripts/workflow-pack-fixtures/business-pulse.json
    - packages/backend/scripts/workflow-pack-fixtures/campaign-plan.json
  modified:
    - packages/contracts/src/skills/skillBodies.test.ts
    - packages/backend/scripts/run-workflow-pack-evals.mjs
    - packages/core/src/workflowPacks.test.ts
    - docs/playbooks/workflow-packs.md
    - docs/playbooks/skill-registry.md

key-decisions:
  - "Business Pulse's mandatory middle output section is 'What I could not see' — its upstream source is almost entirely connector-driven and Pikar reaches none of it."
  - "Campaign Plan states in its own second paragraph that it produces a document, because the boundary is enforced in code and a body promising orchestration promises what the runtime cannot keep."
  - "The '0 or 6 bodies' guard I wrote in 27-02 was wrong about how this phase lands, and is corrected here."
  - "The fixture runner now reads one file per PACK (an array of cases), matching all three wave-2 plans' files_modified."

patterns-established:
  - "An adaptation records what it REMOVED, not just what it kept: the missing-input sections are the diff against the upstream source made visible to the user."

requirements-completed: [PACK-01, PACK-02, PACK-03]

duration: 26min
completed: 2026-08-23
---

# Phase 27 Plan 04: Business Pulse and Campaign Plan Summary

**Two candidate bodies that are honest about being narrow — Business Pulse loses almost every input
its upstream source depends on, and says so in a section it is forbidden from omitting.**

## What the adaptation actually removed

Business Pulse upstream pulls QuickBooks, PayPal, Square, HubSpot, Gmail and Slack in one parallel
batch. Pikar reaches **none** of them. What survives is `readFinance` (figures the owner typed) and
`searchVault`. So the body:

- makes `## What I could not see` a MANDATORY middle section, and says plainly that a long first
  section crowding it out means the wrong report was written;
- forbids stating, estimating or implying any figure it did not read — no revenue, no pipeline, no
  "on track", no month-over-month unless both months came from `readFinance`;
- forbids calling one data point a trend ("one figure is a position, not a direction");
- refers to attention signals by what they are, never by position, because `HOME_PRIORITY_ORDER` is
  code-owned and moved once already.

Campaign Plan needed less surgery — its upstream is already a brief generator, not an orchestrator —
so the work was Pikar terminology, the three missing inputs named where they bite rather than in a
footnote, and the leaf-agent boundary stated in the body's own second paragraph.

## Two corrections to earlier plans

1. **`workflowPacks.test.ts` required "0 or 6 bodies, never a half corpus".** I wrote that in 27-02
   to stop a body being silently skipped. It was wrong about how this phase lands: 27-04/05/06 are
   three independent lanes writing two bodies each, so the rule reddened the moment the first lane
   committed and made wave 2 unlandable. The per-body "every granted tool is TAUGHT" check stays and
   now bites per body; completeness is enforced where it can actually be satisfied — 27-01's
   manifest refuses a half-populated adapted-body set.
2. **The fixture runner took one file per CASE**, while all three wave-2 plans name one file per
   PACK in `files_modified`. The runner now parses each `<packId>.json` as an array of cases. Needle
   uniqueness moved from file-keyed to case-keyed with it, because a file-keyed check stopped seeing
   collisions between two cases in the same file — which is where they are now most likely.

## Verification — all executed

```
cd packages/contracts && npx vitest run                 5 files / 77 passed
cd packages/contracts && npx tsc --noEmit               clean
cd packages/core && npx vitest run                      43 files / 1174 passed
cd packages/backend && npx tsc --noEmit                 clean
cd packages/backend && node scripts/run-workflow-pack-evals.mjs --packs business-pulse,campaign-plan --fixtures-only
npx biome ci . --diagnostic-level=error --max-diagnostics=none    683 files, clean
```

### Gates proven RED, then restored

| Mutation | Gate that caught it |
|---|---|
| a byte appended to a body | the `.md`/`.ts` drift row |
| `readFinance` removed from the body prose | "every granted tool is TAUGHT" |
| a case moved into the wrong pack file | the fixture validator |
| `toolsForbidden` naming a tool the pack holds | the fixture validator |
| `--packs` for a lane that has written no fixtures | the `--packs` gate |
