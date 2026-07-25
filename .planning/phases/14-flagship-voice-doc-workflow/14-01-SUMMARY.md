---
phase: 14-flagship-voice-doc-workflow
plan: 01
subsystem: voice-doc
tags: [wave-0, schema, skill-registry, stubs, freeze-commit, lane-c]
requires: []
provides:
  - "evaluations.framework accepts 'document-review'"
  - "evaluations.findings[].citationExcerpt (optional, capped, substring-verified)"
  - "voiceSessions.docRef (optional, no index)"
  - "@pikar/voice docSession.ts contract surface (DOC_REVIEW_FRAMEWORK, VOICE_DOC_THREAD_PREFIX, voiceDocThreadId, SEARCH_DOCUMENT_TOOL, DIGEST_CHAR_CAP, RETRIEVAL_CHAR_CAP, RETRIEVAL_MAX_PASSAGES, EXCERPT_CHAR_CAP, DOC_GAP_ROUTE, DOC_GAP_PLAYBOOK)"
  - "packages/backend/convex/voiceDoc.ts (lane-owned module stub)"
  - "smoke:seedVoiceDocSession (SC3 offline e2e seed)"
  - "document-analyst skill row, seeded UNGATED"
affects:
  - "packages/backend/convex/evaluations.ts (runEvaluation arg validator pinned — approved deviation)"
  - "packages/backend/convex/proactiveReview.ts (carry-forward narrowed)"
  - "apps/web/.../workspace/cards.tsx (FRAMEWORK_LABEL)"
tech-stack:
  added: []
  patterns:
    - "schema-derived validators: widening a schema union widens EVERY signature deriving from it"
    - "5-file skill mirror (.md + derived .ts + name const + seed row + drift row)"
    - "asymmetric e2e fixtures (one finding quoted, one not) to cover both render paths"
key-files:
  created:
    - packages/voice/src/docSession.ts
    - packages/voice/src/docSession.test.ts
    - packages/backend/convex/voiceDoc.ts
    - packages/backend/convex/voiceDoc.test.ts
    - apps/web/e2e/voice-doc.spec.ts
    - packages/contracts/skills/document-analyst.md
    - packages/contracts/src/skills/documentAnalyst.ts
  modified:
    - packages/backend/convex/schema.ts
    - packages/backend/convex/evaluations.ts
    - packages/backend/convex/proactiveReview.ts
    - packages/backend/convex/skills.ts
    - packages/backend/convex/smoke.ts
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - packages/voice/src/index.ts
    - packages/contracts/src/skill.ts
    - packages/contracts/src/skills/skillBodies.test.ts
    - docs/playbooks/watch.json
    - docs/playbooks/voice.md
    - docs/playbooks/cockpit.md
    - docs/playbooks/skill-registry.md
    - docs/playbooks/business-evaluation.md
    - .planning/PARALLELIZATION.md
decisions:
  - "runEvaluation's framework arg is PINNED, not schema-derived — the research premise 'zero edits to evaluations.ts' was false"
  - "document-analyst seeded UNGATED (locked user decision) — run-eval-golden.mjs cannot drive a Realtime voice persona"
  - "the synthetic voice-doc:<sessionId> thread is DERIVED, never stored as a second column"
metrics:
  duration: ~140 min (incl. one checkpoint)
  tasks: 3
  files: 21 code/doc (34 incl. planning + graph artifacts)
  completed: 2026-07-25
---

# Phase 14 Plan 01: Wave-0 Freeze Commit Summary

Landed Phase 14's entire share of the Wave-0 freeze — the widened `evaluations` schema, every
Lane-C stub with its real contract surface, and the ungated `document-analyst` persona — so no
later plan needs a cross-lane contract change.

## What shipped

**Task 1 — schema widening + paired label** (`45f3543`). `evaluations.framework` gained
`"document-review"`; the literal is human-readable because `buildMemo` prints it verbatim as
user-visible memo prose. `evaluations.findings[].citationExcerpt` (optional) is the persisted half of
the locked citation decision — absent is a valid, non-degraded state, never an empty string.
`voiceSessions.docRef` is optional with no index. `FRAMEWORK_LABEL` in `cards.tsx` gained the
matching entry in the SAME commit, as the plan required: that map is
`Record<Evaluation["framework"], string>`, so splitting them makes web typecheck red.

**Task 2 — Lane-C stubs** (`bceeb5b` RED → `c50f9e5` GREEN, then `dd76e34`). TDD on the pure
surface: the failing test landed first (confirmed red on an unresolvable import), then
`docSession.ts`. `voiceDoc.ts` is a zero-export module (valid Convex, keeps the freeze inert) whose
header pins the V8-runtime / explicit-`Promise<>` constraints. `voiceDoc.test.ts` is the real proof
that Task 1's widening reached the schema-derived write validator. `smoke:seedVoiceDocSession` seeds
two deliberately asymmetric findings — one with a verbatim-substring `citationExcerpt`, one with
none — so the SC3 e2e covers both render paths. `voice-doc.spec.ts` carries the agreed harness
copied verbatim from `voice.spec.ts` behind one `test.fixme`.

**Task 3 — the persona** (`19f5bee`). The 5-file mirror, seeded UNGATED, appended directly after
`VOICE_BRIEF_SKILL` with no other row touched or reordered.

## Deviations from Plan

### 1. [Rule 4 — architectural, USER-APPROVED] The "zero edits to `evaluations.ts`" premise was false

- **Found during:** Task 1, at the first `pnpm --filter @pikar/web typecheck`.
- **Issue:** The plan (from `14-RESEARCH.md`) asserted that widening the schema union widens
  `insertEvaluation`'s validator "with **zero edits to `evaluations.ts`**". That is only half true.
  `const evalFields = schema.tables.evaluations.validator.fields` feeds **two** signatures:
  `insertEvaluation` (`:139` — which does widen for free, exactly as researched) and
  `runEvaluation` (`:161`). Widening the latter broke `const chosen: Framework = framework ?? …`
  at `:291`. Exactly one non-test error, in both the web and backend gates.
- **Resolution:** STOPPED and returned a checkpoint rather than edit a file the orchestrator had
  explicitly forbidden. User selected **Option A**: pin `runEvaluation`'s `framework` arg to the four
  business frameworks instead of deriving it. This is strictly STRONGER than the plan's Pitfall-2
  guarantee — a doc-review row is now refused at the **validator boundary**, not merely at the
  `FRAMEWORK_SKILL` lookup. `insertEvaluation` stays schema-derived; the local `Framework` type,
  `FRAMEWORK_SKILL` and `buildMemo` are byte-unchanged; `llm.ts` is untouched (its `evaluateBusiness`
  enum is hardcoded, not schema-derived).
- **Files modified:** `packages/backend/convex/evaluations.ts` (one line + a do-not-simplify comment).
- **Also amended:** the plan's `<verification>` line and `.planning/PARALLELIZATION.md` (Lane C's row
  now records the one authorized exception, so other lanes coordinate against it).
- **Commit:** `45f3543`
- **For Phase 15's planner:** do NOT inherit the premise. Any schema-union widening in this repo must
  be checked against **every** signature deriving from `evalFields`-style schema-derived validators,
  not just the intended write surface.

### 2. [Rule 3 — blocking] `proactiveReview.ts` carried the widened framework forward

- **Found during:** Task 1, immediately after the approved pin.
- **Issue:** `proactiveReview.ts:79` passes `last?.framework` (read from a persisted row, now widened)
  into `runEvaluation` (now pinned narrower) — a second type error.
- **Fix:** `framework: last?.framework === "document-review" ? undefined : last?.framework`. A
  doc-review row cannot reach the stable review thread today (those live on synthetic
  `voice-doc:<sessionId>` threads), so this is a type-level guard, not a live branch. It falls back to
  auto-pick rather than throwing, because the weekly review must never fail on a framework it can
  simply re-derive.
- **Commit:** `45f3543`

### 3. [Rule 3 — blocking] Playbook ordering vs. the §9 Stop hook

- **Issue:** The plan assigns all playbook writes to Task 3, but the Stop hook blocks any turn that
  changes a watched path without touching its playbook — so Task 1 (`cards.tsx` → `cockpit.md`) and
  Task 2 (`voiceDoc.ts`, `voice-doc.spec.ts` → `voice.md` + `cockpit.md`) each needed their own
  playbook touch. Each commit now carries the playbook content for its OWN code, which is what
  CLAUDE.md §9 actually asks for.
- **Also:** the plan named only `voice.md` and `cockpit.md`, but two more playbooks watch paths this
  plan touched, and both were caught by the Stop hook rather than by the plan:
  - `skill-registry.md` watches `convex/skills.ts`, `contracts/src/skill.ts`,
    `contracts/src/skills/` and `contracts/skills/` — all four touched by Task 3.
  - `business-evaluation.md` watches `evaluations.ts` and `proactiveReview.ts` — both touched by
    Task 1's approved deviation. This is the playbook where the `runEvaluation` pin most belongs, so
    it got a full section ("Sharing the `evaluations` table with voice-doc") plus a new bullet in its
    Invariants list, not just a `Last verified` bump. The table is shared with voice-doc; the engine
    is not, and that line is now written down.
- **Note for future plans in this phase:** `check-playbooks.mjs check` evaluates the *uncommitted*
  file set, so it can pass per-commit while the Stop hook (which sees the whole turn) still blocks.
  Budget for a playbook touch per subsystem you cross, not per plan.

### 4. [Rule 3 — environment] No `node_modules` and no `CONVEX_DEPLOYMENT` in this worktree

- Ran `pnpm install` (per `PARALLELIZATION.md` Stage-2 per-worktree setup).
- **`npx convex codegen` cannot run here** — this worktree has no `.env.local` / `CONVEX_DEPLOYMENT`,
  and codegen refuses without one. Copied `packages/backend/convex/_generated/` from the main
  worktree instead. It is gitignored, so it never entered a commit. Verified sufficient: generated
  `dataModel.d.ts` derives from `../schema`, so the Task-1 schema edits flow through without a regen,
  and nothing in this plan references `api.voiceDoc.*`.
- **Next Lane-C session:** you will need to redo both steps, or run `npx convex dev` once to give this
  worktree its own deployment (which is what the lane contract actually wants before any live smoke).

## Verification

| Gate | Result |
|------|--------|
| `pnpm test` (full monorepo) | core 195/195, vault 42/42, pii 8/8, extraction 28/28, cost 22/22, contracts 14/14, voice 36/36, **backend 497/498** |
| Backend baseline | Held. Sole red is the documented pre-existing `audit.test.ts` `auditCounts` row. Was 494/495; +3 new green (2 `voiceDoc`, 1 skill drift row) |
| `pnpm --filter @pikar/backend exec tsc --noEmit` | **0** non-test errors; exactly **52** pre-existing test-file errors (+0 new) |
| `pnpm --filter @pikar/web typecheck` | exit 0 |
| `node scripts/check-playbooks.mjs check` | exit 0 |
| Frozen files byte-unchanged | `llm.ts`, `deliverApprovedPlan.ts`, `run-eval-golden.mjs` — empty diff vs. phase base |
| `GATED_SKILLS` byte-unchanged | `skill.ts` diff is insertions-only; no line removed |
| `evaluations.ts` scope | diff is exactly ONE changed line (the approved pin) + its comment |

One flake observed: `runCockpitAgent.test.ts` failed once under full-suite parallel load, then passed
18/18 in isolation and on a full-suite re-run. Not a regression; it is a slow (3.3s) test.

## Wave 0 Requirements — all closed

Every `❌ Wave 0` row in `14-VALIDATION.md` now exists on disk: `voiceDoc.ts`, `voiceDoc.test.ts`,
`docSession.ts` + `docSession.test.ts` (incl. `EXCERPT_CHAR_CAP`), `voice-doc.spec.ts` +
`smoke:seedVoiceDocSession`, the three schema fields, the `FRAMEWORK_LABEL` entry, the `watch.json`
registrations, and the ungated `document-analyst` mirror. No framework install was needed.

## For the next plans

- **14-02** owns `packages/voice/src/*`. The contract surface is already exported from the barrel —
  import from `@pikar/voice`, do not re-declare a literal. `shapeDocReview` is yours; it must
  substring-verify the excerpt against the document text and cap it at `EXCERPT_CHAR_CAP`.
- **14-03 / 14-05** own `voiceDoc.ts`. It is a zero-export stub; its header already pins the V8-runtime
  and explicit-`Promise<>` constraints — honor them or you re-trigger the inference cliff.
- **14-08** fills `voice-doc.spec.ts`'s single `test.fixme`. The harness is already there; do not
  invent a different one. `smoke:seedVoiceDocSession` returns `{sessionId, threadId, vaultDocId}` and
  seeds one quoted + one quote-less finding — assert BOTH render paths.
- **14-09**'s static scan should note that `citationExcerpt` is the phase's only verbatim-report-content
  field, and is already documented as log-plane-illegal in `voice.md`.
- **`convex/skills.ts` is now touched by Lane C.** The `document-analyst` row landed in the freeze
  commit BEFORE Lane A begins seeding Phase-15 specialists, which is the coordination resolution for
  `seedSkills`'s `maxVersion + 1`. Lane A: append after it, do not reorder.

## Self-Check: PASSED
