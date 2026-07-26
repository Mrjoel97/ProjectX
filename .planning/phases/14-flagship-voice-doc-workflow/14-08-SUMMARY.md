---
phase: 14-flagship-voice-doc-workflow
plan: 08
subsystem: voice-doc
tags: [wave-8, ui, post-call, card-reuse, approve-gate, e2e, lane-c]
requires:
  - phase: 14-05
    provides: "reviewSession + the cited evaluations row on the synthetic thread"
  - phase: 14-06
    provides: "the docId prop on PostCall"
  - phase: 14-07
    provides: "docContext (reused here for the memo's document title)"
provides:
  - "the doc branch of PostCall: review-once, composeDocMemo seeding, CardList in place, one footer action"
  - "CardList's opt-in noPlanHint"
  - "EvaluationCard's document-review copy branches + the citationExcerpt <blockquote>"
  - "SC3 automated coverage: one artifact, gap -> proposed memo plan, Approve gate intact, and the offline e2e"
affects:
  - "14-09 (static scans over the new payload-free UI path; human-verify of the visual result)"
tech-stack:
  added: []
  patterns:
    - "ref-guarded once-only effect for an expensive call, belt-and-braces with server idempotence"
    - "inherit idempotence instead of re-implementing it — the doc memo rides the Phase-6 briefRef spine"
    - "opt-in prop with a default equal to today's behaviour, so no existing caller changes"
    - "assert the OUTCOME, not the implementation, when a parallel lane is rewriting the function under test"
key-files:
  created: []
  modified:
    - apps/web/app/(app)/dashboard/voice/PostCall.tsx
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - apps/web/e2e/voice-doc.spec.ts
    - packages/backend/convex/gapAction.test.ts
    - packages/backend/convex/voice.test.ts
    - packages/backend/convex/smoke.ts
    - docs/playbooks/voice.md
    - docs/playbooks/cockpit.md
key-decisions:
  - "the memo rides the existing endSessionClean/briefRef spine, so ONE-artifact-per-session is inherited rather than re-implemented"
  - "no 'Continue with your agent' on the doc branch — the synthetic thread is not a Convex Agent thread and a composer there would throw (Pitfall 7)"
  - "the citationExcerpt render is framework-agnostic, so Phase-12 rows stay byte-identical and no second branch exists"
  - "SC3 assertions target the outcome (proposed memo plan, zero requests rows) because Lane A is concurrently splitting actOnGap into two terminals"
---

# Plan 14-08 Summary — the post-call outcome

**Wave:** 8 · **Tasks:** 3/3 · **Commits:** 3

The screen where the user decides. The review runs once, the cited findings render in place through
the exported `CardList`, the memo is the brief in document flavour, and a gap crosses the existing
single Approve gate — all without a new card idiom and without leaving the page.

## Commits

| Commit | Tasks | What |
|--------|-------|------|
| `24daa74` | 1, 2 | `PostCall`'s doc branch; four surgical `cards.tsx` edits |
| `6bb6edc` | 3 | SC3 coverage: gapAction (+5), voice (+2), the real e2e, and a seeder fix |
| *(this)* | 1–3 | `voice.md` + `cockpit.md`, SUMMARY/STATE/ROADMAP, graph |

## Gates

| Gate | Result |
|------|--------|
| `test gapAction` | **9/9** (was 4) |
| `test voice` | **14/14** (was 12) |
| `test voiceDoc` | 23/23 |
| `pnpm test` (whole monorepo) | **903/903, zero failures** — backend **537/537** |
| `pnpm --filter @pikar/web typecheck` | exit 0 |
| `pnpm --filter @pikar/web build` | compiles; `/dashboard/{voice,workspace}` stay `ƒ (Dynamic)` |
| backend `tsc --noEmit` | **49**, +0 new |
| frozen files (`plans.ts`, `deliverApprovedPlan.ts`, `cockpit.ts`, `llm.ts`, `run-eval-golden.mjs`) | **zero diff across the entire phase** |
| `evaluations.ts` | 12 lines — only the user-authorized `runEvaluation` pin |

## Two of my own assumptions were wrong, and the code was right

Recorded because the corrections are the useful part:

1. **`source: "grounded"`** — the schema union is `vault | user-provided`, and `"vault"` is exactly
   what `shapeDocReview` welds. A fixture must mirror the real writer, not paraphrase it.
2. **"A second tap refuses."** It does not, and should not: a second tap on a still-`proposed` plan
   SUCCEEDS by recycling the row, because changing your mind about which gap to act on must restage
   the memo. `plan_busy` is for mid-flight/delivered only. The invariant that actually matters —
   never a SECOND `plans` row, since `plans.byThread` is a `.unique()` read and a duplicate makes
   every later read THROW — is now what the test asserts, plus a separate case that drives a plan to
   `delivering` and confirms the real `plan_busy` refusal.

## Defect found and fixed in 14-01's seeder

`smoke:seedVoiceDocSession` seeded `section: "findings"`, which is **not** in `DOC_REVIEW_SECTIONS`
(`insight | pattern | strength | risk`). `shapeDocReview` **drops** findings outside that union, so
the e2e fixture described a row production can never emit — the spec would have passed against an
impossible shape. Now `"pattern"` and `"insight"`. **A fixture that is not a legal row is not a
fixture.**

## Cross-lane check (asked for explicitly)

Lane A (`lane-a/dispatch-core`, Phase 15 complete) touches `schema.ts`, `evaluations.ts`,
`cards.tsx`, `llmRedaction.test.ts`, `gapAction.test.ts` and `watch.json` — all files this lane also
changed. **Every conflict is mechanical, none semantic:**

| File | Nature | Resolution |
|------|--------|-----------|
| `schema.ts` | different unions/tables (ours `evaluations.framework`, theirs dispatch step types) | keep both |
| `cards.tsx` | different maps; Lane A never touches `FRAMEWORK_LABEL`, `EvaluationCard` or `CardList` | keep both |
| `evaluations.ts` | different regions (ours `runEvaluation` args, theirs imports + `buildMemo`) | keep both |
| `watch.json`, playbooks, `.planning/*` singletons | different entries / documented keep-both | keep both |
| `graphify-out/*` | generated (≈3,100 of the 3,125 markers) | regenerate |

**The important interlock:** Lane A's 15-04 rewrote `actOnGap` into two terminals — a gap whose
`route` names a **registered** specialist now schedules a dispatch instead of staging a memo. Their
`SPECIALISTS` registry holds exactly `offer-architect`, `money-model-designer`, `lead-engine`.
`DOC_GAP_ROUTE` is `"document-analyst"`, which is **not** registered anywhere in their branch — so a
voice-doc gap keeps taking the memo branch, which is precisely what SC #3 requires. The two lanes
interlock correctly without having coordinated. This plan's SC3 assertions were written against the
**outcome** rather than `actOnGap`'s internals so they survive that merge regardless.

`main` is separately clean: its 2 new commits are docs-only and auto-mergeable.

## Notes for 14-09

- The new UI path writes **no** log-plane row. `PostCall` and `cards.tsx` call no audit/telemetry
  function; the excerpt is rendered and never logged. The static scans should confirm that rather
  than assume it.
- The visual result — how `CardList` looks at `min(46rem, 100%)`, the excerpt block, the three vault
  status states, the partial badge — is deliberately **unasserted** here and belongs to the
  human-verify rows.
- `DOCV-01` deliberately left **Pending**.
