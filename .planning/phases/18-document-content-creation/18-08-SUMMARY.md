---
phase: 18-document-content-creation
plan: 08
subsystem: agent
tags: [skill-registry, createDocument, eval-fixture, shared-candidate-stream]

requires:
  - phase: 18-06
    provides: the createDocument tool + its `create=` SMOKE op
  - phase: 18-07
    provides: the Output card the created artifact renders into
provides:
  - cockpit-agent teaching for createDocument, live-certified at v17
  - eval fixture 35 + the createdDocCount expectation key
  - smoke:createdDocCountForThread, the behavioural read behind it
affects: [16, 26-18, cockpit, skill-registry]

tech-stack:
  added: []
  patterns: [one shared candidate stream certified by one multi-pin gate run]

key-files:
  created:
    - packages/backend/scripts/eval-cases/35-create-document.json
    - .planning/phases/18-document-content-creation/18-08-SUMMARY.md
  modified:
    - packages/contracts/skills/cockpit-agent.md
    - packages/contracts/src/skills/cockpitAgent.ts
    - packages/backend/convex/smoke.ts
    - packages/backend/scripts/run-eval-golden.mjs
    - .planning/PARALLELIZATION.md

key-decisions:
  - "The 18-08 gate was OWNER-OVERRIDDEN on 2026-08-02: rather than hold Phase 18 at 7/10 behind a billing-blocked Phase 16, cockpit-agent.md carries BOTH lanes' teaching, seedSkills mints ONE candidate (v17), and ONE gate run certifies both. Two paid runs became one."
  - "The override's condition was answered with a FIXTURE, not with good manners: `createdDocCount` reads the vaultSources role:'created' row, so an agent answering in prose about the one-pager it would write reads 0 and fails, which no reply assertion can distinguish from success."
  - "The trigger rule has NO code branch — there is no `confirmed` argument, because a model-supplied confirmation flag is the model grading its own trigger. The wording IS the mechanism, and only a live run can verify it."

patterns-established:
  - "A lane that takes an override on a shared candidate stream owes a fixture that exercises its own teaching BEFORE the shared gate runs (recorded in PARALLELIZATION.md as a rule, not this plan's courtesy)."

requirements-completed: []
---

# 18-08: teach createDocument — certified live on 2026-08-08

## What shipped, and when it was actually proven

The body edit and fixture 35 landed in `cb48d11` (2026-08-02). **That commit proved the fixture
OFFLINE only** — "self-check 34 fixtures green", including both negatives (prose-only reads 0, an
appending `replace` reads 2). A live model had never been asked to satisfy it.

The first live execution was the Phase-16 golden gate on **2026-08-08**, and **it failed**:
`createdDocCount: expected 1, got 0`.

## What that first live run found

Not a wording problem. `createDocument` was called **13 times** in the two-turn fixture, every step
recorded `done`, and nothing was created. The cause was in the tool, not the teaching: the live
model supplies `replace` on EVERY call — including the first, when the conversation holds no created
documents — and the tool obeyed it, routing a create down `patchCreatedDoc`, which refused correctly
("there's no document #1"). The agent read the honest refusal as "try again" and looped.

Fixed in `0094ac0` (`effectiveReplace = docIds.length === 0 ? undefined : replace`), which is this
plan's own `confirmed`-flag principle applied to the one model-supplied field that predated it.

**So the fixture did exactly the job the override promised.** It caught a real defect on its first
live execution — one that no reply-text assertion would have seen, because the agent's prose was
perfectly plausible throughout.

## Evidence

- Gate `14feb4b7` — **34/34**, $0.3456, unfiltered, `cockpit-agent@17` among five pins; evidence
  recorded and v17 ACTIVATED (v15 → v17, verified by re-reading the active row).
- Gate `d17039a8` — **34/34**, $0.3574, re-confirmation after an unrelated corpus fix.
- Fixture 35 green in both, plus in isolation at $0.0053.

## Scope note

This plan's teaching is certified; Phase 18's remaining plans (18-09, 18-10) are untouched by it.
The phase advances 7/10 → 8/10 on this summary alone.
