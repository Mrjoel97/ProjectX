---
phase: 27-curated-knowledge-work-pack-pilot
plan: 06
subsystem: workflow-packs
tags: [skill-bodies, fixtures, honest-partial, invented-authority]

requires: ["27-01", "27-02"]
provides:
  - Process/SOP Builder and Brand Review bodies as .md/.ts pairs with drift rows
  - Ten fixtures including the load-bearing absent-brand-guidance case
  - The complete six-pack body corpus and a 30-fixture eval set
affects: [skill-registry, workflow-packs, eval-harness]

tech-stack:
  added: []
  patterns:
    - an unstated owner is `Unassigned` and surfaced, never a plausible default

key-files:
  created:
    - packages/contracts/skills/pack-process-sop.md
    - packages/contracts/skills/pack-brand-review.md
    - packages/contracts/src/skills/packProcessSop.ts
    - packages/contracts/src/skills/packBrandReview.ts
    - packages/backend/scripts/workflow-pack-fixtures/process-sop.json
    - packages/backend/scripts/workflow-pack-fixtures/brand-review.json
  modified:
    - packages/contracts/src/skills/skillBodies.test.ts
    - docs/playbooks/workflow-packs.md
    - docs/playbooks/skill-registry.md

key-decisions:
  - "Brand Review's FIRST output section is 'What I reviewed against' — with no brand store, a review that does not name its basis is a false claim about work the owner will act on."
  - "With neither stated guidance nor vault material, Brand Review reviews against general principles and SAYS so; it does not decline. A pack that refuses whenever it is under-equipped is not honest, it is useless."
  - "An SOP step whose owner was never stated reads `Unassigned` and appears in a mandatory unsettled section — an invented owner is authority made up and written into a document people follow."
  - "The body bans the specific sentences that would imply a stored standard, rather than warning generally."

patterns-established:
  - "Distinguish OBSERVED from CONFIRMED: 'your last three posts open with a question' is an observation; 'your brand opens with a question' is an invention."

requirements-completed: [PACK-02, PACK-03]

duration: 21min
completed: 2026-08-23
---

# Phase 27 Plan 06: Process/SOP Builder and Brand Review Summary

**The last two bodies. All six packs now exist, the corpus is 30 fixtures, and the "every granted
tool is TAUGHT" check finally covers every pack rather than whichever subset had landed.**

## Brand Review ships starved, and says so first

There is no tenant brand store. `brandVoice` is a per-plan optional string, not a queryable one, and
no agent tool reads it; the content shelf is `tenantQuery`-only. So the body has exactly two possible
sources — guidance the owner states in the turn, and material `searchVault` returns — and its FIRST
output section names which of them it had. With neither, it reviews against general writing
principles and says exactly that.

The body bans the specific sentences that would imply a stored standard: "deviates from your brand
voice", "inconsistent with your guidelines", "off-pillar". It may say "this reads differently from
the three documents I found in your vault", because that is a claim it can support. The distinction
between **observed** and **confirmed** guidance is the whole design.

The load-bearing fixture is the no-guidance case, and its pass condition is that the review **runs
and states its basis** — not that it declines. A pack that refuses whenever it is under-equipped is
not honest, it is useless; that is the difference between the honest-partial contract and a refusal.

## Process/SOP will not invent authority

A step whose owner the user never stated reads `Unassigned` and appears in a mandatory "What is not
settled" section. An invented owner or deadline is not a helpful default — it is authority made up
and written into a document people will follow.

There is no task system, publishing tool or design tool, and the body may not describe one as
available: `createDocument` writes markdown plus a derived PDF into the vault and nothing else.

## Verification — all executed

```
cd packages/contracts && npx vitest run                 5 files / 79 passed
cd packages/contracts && npx tsc --noEmit               clean
cd packages/core && npx vitest run                      43 files / 1174 passed
cd packages/backend && npx tsc --noEmit                 clean
cd packages/backend && node scripts/run-workflow-pack-evals.mjs --fixtures-only --self-test
    30 valid — brand-review=5 business-pulse=5 campaign-plan=5 customer-complaint=5
               process-sop=5 sales-call-prep=5
node scripts/verify-knowledge-work-provenance.mjs --check-source     green
npx biome ci . --diagnostic-level=error --max-diagnostics=none       691 files, clean
```

## Wave 2 is complete

All six bodies exist as byte-identical `.md`/`.ts` pairs with drift rows, every granted tool is
taught in its own body, and every pack has five fixtures that fail differently. **27-07 is now
unblocked** — it binds `toolsForWorkflowPack` into the runtime and lands the event call sites, and it
is the first plan in this phase whose gates need a live deployment rather than an offline check.
