---
phase: 04-attachment-voice-intake
plan: 03
subsystem: intake-schema-cost
tags: [schema, cost, guardrails, intake]
requires: []
provides:
  - "intakeArtifacts table (thread-scoped inbound intake plane)"
  - "priceTranscription per-audio-minute cost helper"
affects:
  - "packages/backend/convex/schema.ts"
  - "packages/cost/src/cost.ts"
tech-stack:
  added: []
  patterns:
    - "Append-only shared schema.ts block (new table over new fields, own region)"
    - "Result-typed fail-closed pricing helper, mirrors estimateCostUsd/priceUsage"
key-files:
  created: []
  modified:
    - packages/backend/convex/schema.ts
    - packages/cost/src/cost.ts
    - packages/cost/src/cost.test.ts
decisions:
  - "Transcription billed in whole minutes (Math.ceil(seconds/60)) — matches OpenAI per-minute billing; 0s bills 0."
  - "priceTranscription rejects non-finite/negative seconds with Err({code:'over_budget'}) — reuses the existing CostError union rather than adding a new error code, keeping the caller's Err-handling uniform with estimateCostUsd/chooseModel."
metrics:
  duration: "~25 min"
  completed: 2026-07-14
---

# Phase 4 Plan 03: Intake Schema + Transcription Pricing Summary

Added the thread-scoped `intakeArtifacts` table to the shared `schema.ts` and a fail-closed,
per-audio-minute `priceTranscription` helper to `@pikar/cost` — the two additive foundations
Plan 04 (backend intake spine) needs to persist artifacts and price/record transcription spend
against the daily budget and kill switch.

## What Was Built

**`intakeArtifacts` table** (`packages/backend/convex/schema.ts`) — appended in its own
Lane-B-commented region after `demoItems` (no other table reordered/touched). Thread-scoped
(`tenantId`, `threadId`, `by_thread` index) because intake ingestion happens DURING the cockpit
conversation, before any `request`/`plan` row exists — distinct from the request-scoped
`attachments` table and the outbound `plans.attachments` (Phase 3.3 / CKPT-02). Tracks
`storageId`/`filename`/`mimeType`/`size`/`kind` (image/pdf/audio/document/unknown) and a
`status` lifecycle (uploaded/extracting/extracted/failed). `extracted` holds REDACTED safeText
only (content plane, CLAUDE.md §4) — raw bytes live in `_storage`, never inlined.

**`priceTranscription` + `TRANSCRIPTION_PRICING`** (`packages/cost/src/cost.ts`) — additive
export, existing `PRICING`/`estimateCostUsd`/`priceUsage`/`chooseModel` untouched.
`priceTranscription(seconds)` bills `Math.ceil(seconds / 60)` whole minutes at
`TRANSCRIPTION_PRICING.perMinuteUsd` and returns `Result<number, CostError>`: fail-closed
(`err({code:"over_budget"})`) on negative/NaN/non-finite input, `ok(0)` for `0` seconds. This
closes the Pitfall-5 gap where `priceUsage('gpt-4o-transcribe', …)` would return `Err`
(`unknown_model`, no per-minute audio model in the token-based `PRICING` map) and silently
under-count transcription spend, bypassing the kill switch. The returned USD number feeds
`guardrails.recordSpend({costUsd})` unchanged.

Built TDD: RED (6 new test cases: 0s, 30s partial-minute round-up, 90s→2min, negative, NaN,
Infinity) committed failing, then GREEN implementation. `packages/cost` suite: 17/17 green.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written for both tasks (verbatim `intakeArtifacts` block from
`04-RESEARCH.md`; `priceTranscription` additive per the interface contract).

### Concurrency note (not a Rule 1-4 deviation — a shared-worktree race, documented per plan's PARALLEL WAVE warning)

This plan's worktree is shared concurrently with sibling plans 04-01/04-02 (same wave). Despite
using scoped `git add <file>` for every task in this plan, two commits ended up with their
committed content misattributed across lane boundaries because a sibling process's own
(non-pathspec) `git commit` ran against the shared index at the same moment my file was staged,
and vice versa:

- Commit `6e9374f` (intended: schema.ts only) also swept in 3 already-staged sibling files
  (`packages/contracts/skills/attachment-extractor.md`, `packages/contracts/src/skill.ts`,
  `packages/contracts/src/skills/attachmentExtractor.ts` — sibling 04-02's WIP at that instant).
- The Task 2 GREEN `cost.ts` implementation (staged by this plan) was itself swept into a
  sibling's commit `00d711c` ("feat(04-01): scaffold @pikar/extraction + intake §9 playbook
  and watch registration") when that sibling process committed without a pathspec while
  `cost.ts` was staged in the shared index.

**Verified no content was lost or corrupted:** `git diff HEAD -- packages/backend/convex/schema.ts
packages/cost/src/cost.ts packages/cost/src/cost.test.ts` is empty (zero uncommitted diff); the
`intakeArtifacts` table is present in `schema.ts` at HEAD; `priceTranscription` is present in
`cost.ts` at HEAD; `pnpm --filter @pikar/cost test` is 17/17 green; `pnpm --filter @pikar/backend
typecheck` has zero errors attributable to `schema.ts` (the reported errors are pre-existing
test-file noise, confirmed identical via `git stash`/typecheck/`git stash pop` before this plan's
changes were even applied). No history rewrite was attempted (destructive, and unsafe against
concurrently-running sibling sessions) — the commit boundaries are imperfect but every task's
content is correctly present and functioning at HEAD.

Root cause: no cross-process git-index lock exists between concurrently executing agent
sessions sharing one worktree; a plain `git commit -m "..."` (no pathspec) commits the ENTIRE
current index, not just what the calling process last `git add`ed. Mitigation applied
mid-execution: switched to pathspec-scoped `git commit -m "..." -- <file>` for remaining
commits in this plan (the Task 2 GREEN attempt used this form, but by the time it ran the
content had already been committed by the sibling a moment earlier, so the scoped commit
correctly found "nothing to commit" for that path).

## Requirements Tracking Note

This plan's frontmatter lists `requirements: [INTK-02, INTK-03]`, but `requirements mark-complete`
was deliberately NOT run for either ID. Per `04-VALIDATION.md`'s per-task verification map, the
actual classify/extract/transcribe/merge-into-conversation behavior these requirements describe
spans multiple plans (04-01 classify + frame, 04-04 extract/redact/persist/merge + dictation
turn, 04-05 UI). This plan delivers only the schema table + pricing helper foundation those
plans consume — marking INTK-02/INTK-03 fully `Complete` in `REQUIREMENTS.md` now would
misrepresent project state. Leave both `Pending` until the plan(s) that actually deliver the
observable behavior close them out.

## Cross-Lane Announcement

`@pikar/cost` is a shared pure package. `TRANSCRIPTION_PRICING` and `priceTranscription` are
purely additive — no existing export's signature changed. Lane A/C should rebase cleanly.

## Self-Check: PASSED

- FOUND: packages/backend/convex/schema.ts contains `intakeArtifacts`
- FOUND: packages/cost/src/cost.ts contains `priceTranscription`
- FOUND: packages/cost/src/cost.test.ts contains `describe("priceTranscription"`
- FOUND commit 6e9374f (schema.ts content, mixed with sibling files per concurrency note)
- FOUND commit 4f89ad3 (RED tests, clean)
- FOUND commit 00d711c (contains cost.ts GREEN implementation, sibling-attributed per concurrency note)
- `pnpm --filter @pikar/cost test`: 17/17 passed
- `pnpm --filter @pikar/backend typecheck`: zero schema.ts-attributable errors (pre-existing test-file noise only, confirmed via stash diff)
