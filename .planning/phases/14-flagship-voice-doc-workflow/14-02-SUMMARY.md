---
phase: 14-flagship-voice-doc-workflow
plan: 02
subsystem: voice-doc
tags: [wave-2, pure-domain, prompt-fencing, citations, honesty-verdict, realtime-tools, lane-c]
requires:
  - phase: 14-01
    provides: "the docSession.ts contract surface (DOC_REVIEW_FRAMEWORK, caps, SEARCH_DOCUMENT_TOOL, DOC_GAP_ROUTE/PLAYBOOK) and the widened evaluations schema this shaping targets"
  - phase: 06-live-voice-sessions
    provides: "brief.ts (BRIEF_HEADERS / composeBrief / planSeedFromBrief) and realtime.ts's pinned event vocabulary"
provides:
  - "buildDocDigest(doc) — bounded + fenced + truncation-disclosing mint-time document facts"
  - "DIGEST_FENCE_OPEN / DIGEST_FENCE_CLOSE and non-escapable marker neutralization"
  - "shapeDocReview(raw, doc) — welded citations/route/playbook/rank + the honesty verdict"
  - "RawDocReview / ShapedDocReview / ShapedDocFinding / ShapedDocGap types (the evaluations row shape)"
  - "DOC_REVIEW_SECTIONS + DOC_REVIEW_CONFIDENCE closed taxonomies"
  - "composeDocMemo(turns, review, docTitle, date) — the ONE vault artifact, built ON composeBrief"
  - "REALTIME_FUNCTION_CALL / SESSION_TOOL_KEYS / TOOL_CHOICE_AUTO + a dated blank-until-verified tool-declaration decision record"
affects:
  - "14-04 (mint body: digest + tool array + the undecided mint-time-vs-session.update branch)"
  - "14-05 (voiceDoc producer: calls shapeDocReview, adds the substring provenance check, persists the row)"
  - "14-06 (browser relay: reads REALTIME_FUNCTION_CALL off response.done)"
  - "14-08 (PostCall: composeDocMemo + the citationExcerpt render branch)"
  - "14-09 (static scan: the RawDocReview shape is the evidence that citations are welded)"
tech-stack:
  added: []
  patterns:
    - "cap-then-neutralize: neutralize a planted fence marker with a strictly SHORTER literal so sanitizing can never push a slice back over its cap"
    - "omit-the-key, never empty-string: an absent optional is a valid non-degraded state, expressed as a spread of {} rather than a falsy value"
    - "verdict-by-code-rule: the honesty verdict is derived from the shaped counts in one place, never asked of the model"
    - "reuse the shared header set instead of forking a composer — composeDocMemo fills the headers composeBrief leaves unused"
key-files:
  created: []
  modified:
    - packages/voice/src/docSession.ts
    - packages/voice/src/docSession.test.ts
    - packages/voice/src/realtime.ts
    - packages/voice/src/index.ts
    - docs/playbooks/voice.md
key-decisions:
  - "composeDocMemo fills SUMMARY / DISCUSSION / OPEN QUESTIONS — the three BRIEF_HEADERS the client brief leaves unused — instead of inventing new headers; GAPS is a plain label and deliberately NOT added to BRIEF_HEADERS, because that set is what planSeedFromBrief uses to find section boundaries in BOTH brief flavors"
  - "the fence-marker neutralizer replaces with a strictly SHORTER non-empty literal, which makes the fence both non-escapable (no re-assembly) and cap-safe (sanitizing cannot grow the slice)"
  - "the digest's cap is measured on the DOCUMENT SLICE; title/disclosure/fence/safety chrome is not charged to it, so the budget means the same thing regardless of title length"
  - "no new Realtime event name — the relay triggers off the already-live-verified responseDone; the tool-DECLARATION branch is recorded as explicitly unverified rather than guessed"
patterns-established:
  - "Anti-vacuous verdict testing: healthy asserts findings>0 AND gaps===0 AND verdict, because gaps===0 alone also holds on insufficient"
  - "Malformed model output is DROPPED, never coerced — a bad section cannot become a grounded finding and flip insufficient into healthy"
requirements-completed: []
duration: ~20 min
completed: 2026-07-25
---

# Phase 14 Plan 02: Pure Voice-Doc Domain Summary

**`@pikar/voice` now owns the whole Convex-free doc-discussion domain: a cap-measured, non-escapable
fenced digest, a shaping function that makes "every finding is cited" and "no fabricated gap"
structural instead of prompted, a memo composer that reuses `BRIEF_HEADERS` rather than forking one,
and a pinned Realtime function-call vocabulary whose tool-declaration branch is recorded as
explicitly unverified.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-25T21:04:15Z
- **Tasks:** 3 (2 TDD)
- **Files modified:** 5 code/doc (+ regenerated graph artifacts)

## Accomplishments

- **`buildDocDigest`** — the one place document text enters an `instructions` field. The
  `DIGEST_CHAR_CAP` is enforced on the **document slice**, not the whole string, so the budget means
  the same thing whatever the title is. A planted fence marker collapses to a strictly shorter
  literal: the fence cannot be escaped (a split marker cannot re-assemble around a non-empty
  replacement) and sanitizing cannot push the slice back over the cap. A truncated extraction says
  so **before** the fence opens; empty/whitespace-only text says so plainly and still fences.
- **`shapeDocReview`** — the honesty rule in code. `findings.length === 0` FORCES `gaps = []` and
  `verdict = "insufficient"`; findings with no gaps is `healthy`; otherwise `gaps`. A finding whose
  `section` or `confidence` is outside the closed taxonomy is **dropped, not coerced**, which is
  what stops garbage from turning `insufficient` into `healthy` by the back door. Citations,
  `route`, `playbook` and a dense 1-based `leverageRank` are welded from the `doc` argument and
  module constants regardless of anything the model sent.
- **The quoted passage, both halves of the locked decision.** `citationExcerpt` is trimmed,
  whitespace-collapsed and hard-capped at `EXCERPT_CHAR_CAP` — and the **key is omitted entirely**
  when the raw excerpt is missing/null/empty/whitespace-only. Never `""`, never a throw, and the
  doc-level citation floor still holds on a quote-less finding.
- **`composeDocMemo`** — one vault artifact, no second brief builder. Built on
  `composeBrief(turns, date)`, then the review fills the three headers the client brief leaves
  unused. An absent excerpt renders **nothing** (no empty quote line), which is the memo-side half
  of "shows a quoted passage where available".
- **`realtime.ts`** gained the function-call item vocabulary, the session tool keys and a dated,
  **blank-until-live-verify** decision record for the mint-time-vs-`session.update` branch.

## Task Commits

1. **Task 1: buildDocDigest** — `3095e89` (feat; TDD RED confirmed at 6 failing assertions before implementation)
2. **Task 2: shapeDocReview + composeDocMemo** — `95a59da` (feat; TDD RED confirmed on unresolvable imports)
3. **Task 3: Realtime function-call vocabulary + playbook** — `21cac4e` (feat)

## Files Created/Modified

- `packages/voice/src/docSession.ts` — +`DIGEST_FENCE_OPEN`/`CLOSE`, `buildDocDigest`,
  `DOC_REVIEW_SECTIONS`, `DOC_REVIEW_CONFIDENCE`, `RawDocReview`/`ShapedDocReview` types,
  `shapeDocReview`, `composeDocMemo`. Now imports `./brief` (and nothing else).
- `packages/voice/src/docSession.test.ts` — 10 → 28 assertions.
- `packages/voice/src/realtime.ts` — `REALTIME_FUNCTION_CALL`, `SESSION_TOOL_KEYS`,
  `TOOL_CHOICE_AUTO`, the decision-record block, and a comment on `responseDone` recording that it
  now also carries `response.output[]` function calls.
- `packages/voice/src/index.ts` — barrel re-exports for everything above (values + types).
- `docs/playbooks/voice.md` — three new invariants (honesty verdict, welded citations + the one
  `excerpt` exception, bounded+fenced digest), the pure-domain surface, the open tool-declaration
  branch, `Last verified` bumped.

## Decisions Made

- **`GAPS` is a plain label, not a `BRIEF_HEADERS` entry.** Adding it would change how
  `planSeedFromBrief` finds section boundaries in **both** existing brief flavors — a silent
  behavior change to the Phase-6 plan seed for a cosmetic gain. The memo's gap block sits after
  `OPEN QUESTIONS`, which `planSeedFromBrief` never parses.
- **The memo fills the unused headers rather than inventing new ones.** `SUMMARY` = the verdict
  sentence, `DISCUSSION` = the cited findings, `OPEN QUESTIONS` = `notEnoughData` (a literal fit).
  This is what lets the plan's "contains every `BRIEF_HEADERS` header" behavior be true without a
  second builder.
- **Neutralize with a shorter, non-empty literal.** Removal-without-replacement lets a nested
  marker re-assemble; a longer replacement could push a cap-length slice over the cap. Shorter +
  non-empty satisfies both at once.
- **`DOC_REVIEW_CONFIDENCE` is exported as a named constant**, not an inline array — rule 1 drops on
  it, so 14-05's producer and 14-09's scan need to name the same closed list.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3 auto-fixes were needed and no Rule 4
architectural question arose.

Two plan statements were interpreted rather than followed literally, both recorded above as
decisions: the memo's "contains every `BRIEF_HEADERS` header" behavior (satisfied by filling
`composeBrief`'s three unused headers, since `composeBrief` alone emits only three of six), and the
plan's claim that `importGuard.test.ts` enforces Convex-freedom on `docSession.ts` — see Issues.

## Issues Encountered

- **`importGuard.test.ts` does NOT cover `packages/voice/`.** The plan's `<verification>` asks to
  "confirm it covers this file". It does not: that scan is `import.meta.glob("./**/*.ts")` rooted in
  `packages/backend/convex/`, and it bans raw `query`/`mutation` imports from `_generated/server` —
  a backend-only concern. **The real enforcement is structural and stronger:** `@pikar/voice`'s only
  dependency is `@pikar/core`, so a Convex import cannot resolve in this package at all, and
  `pnpm --filter @pikar/voice typecheck` would fail if one were added. The file header comment was
  corrected to say that instead of citing a guard that does not watch it. No new test was added —
  standing up a second static scan to prove a dependency graph that `package.json` already proves
  would be exactly the abstraction CLAUDE.md §8 forbids.
- **One full-suite run showed backend 495/498.** Re-run in isolation and again as a full suite:
  **497/498** both times, sole red the documented pre-existing `audit.test.ts` `auditCounts` row.
  Same parallel-load flake class 14-01 recorded for `runCockpitAgent.test.ts`. Not a regression.

## Verification

| Gate | Result |
|------|--------|
| `pnpm --filter @pikar/voice test` | **56/56** green (was 36; +20 new) |
| `pnpm --filter @pikar/voice typecheck` | exit 0 |
| `pnpm test` (full monorepo) | core 195/195, vault 42/42, pii 8/8, extraction 28/28, cost 22/22, contracts 14/14, voice 56/56, **backend 497/498** (baseline held) |
| `pnpm --filter @pikar/backend exec tsc --noEmit` | exactly **52** errors, all pre-existing test-file ones (**+0 new**) |
| `pnpm --filter @pikar/web typecheck` | exit 0 |
| `node scripts/check-playbooks.mjs check` | exit 0 |
| `packages/voice/src/docSession.ts` Convex-free | yes — imports only `./brief`; `@pikar/voice` depends only on `@pikar/core` |
| Frozen files byte-unchanged | `llm.ts`, `evaluations.ts`, `deliverApprovedPlan.ts`, `run-eval-golden.mjs` — zero diff this plan |

**14-VALIDATION rows now green** (the `pnpm --filter @pikar/voice test` half of each): SC1 tool
schema + digest budget, SC2 quoted-passage-persisted (pure half), SC2 honest no-gaps, SC2 no
fabricated gap, §1 pure Convex-free domain.

## User Setup Required

None.

## Next Phase Readiness

- **14-04 (mint):** call `buildDocDigest` for the document block and declare
  `[SEARCH_DOCUMENT_TOOL]` under `SESSION_TOOL_KEYS.tools` with `TOOL_CHOICE_AUTO`. The mint-time vs
  `session.update` branch is genuinely undecided — implement mint-time first, fall back on a 400,
  and **fill in the `LIVE-VERIFIED ____-__-__:` line in `realtime.ts` with the branch that worked.**
  Do not delete that line and do not fill it from a doc page.
- **14-05 (producer):** `shapeDocReview` caps and normalizes the excerpt; it does **not** verify
  provenance. The substring check against the document text is yours — you are the layer holding the
  text. Everything else (citations, route, playbook, rank, verdict) is already welded; do not
  re-derive any of it, and do not pass a `verdict` into the shaping function.
- **14-06 (relay):** read `REALTIME_FUNCTION_CALL.itemType` items out of `response.output[]` on the
  EXISTING `REALTIME_EVENTS.responseDone`. No new event name exists, on purpose.
- **14-08 (PostCall / cards):** `composeDocMemo` is the memo. Its finding lines are
  `- <label> [<citationTitle>]` with the quote on an indented following line — and the quote-less
  path renders nothing extra, which is the render branch the seeded asymmetric e2e fixture exercises.
- **14-09 (scan):** `RawDocReview` in `docSession.ts` is the machine-checkable evidence that the
  model output schema has no citation/verdict/route/playbook/rank field, and that `excerpt` is its
  ONE deliberate exception.

## Self-Check: PASSED

All 5 modified files exist on disk; all 3 task commits (`3095e89`, `95a59da`, `21cac4e`) resolve in
`git log`. `must_haves` artifacts verified: `docSession.ts` 309 lines (min 120), `docSession.test.ts`
339 lines (min 100), `realtime.ts` contains `function_call`. `key_links` patterns present:
`BRIEF_HEADERS|composeBrief` in `docSession.ts` (8 hits), `docSession` in `index.ts` (2 hits).

---
*Phase: 14-flagship-voice-doc-workflow*
*Completed: 2026-07-25*
</content>
