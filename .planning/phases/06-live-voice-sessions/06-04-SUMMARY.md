---
phase: 06-live-voice-sessions
plan: 04
subsystem: api
tags: [voice, llm, generateObject, skills-registry, governed-spend, ai-sdk, convex]

# Dependency graph
requires:
  - phase: 06-01
    provides: "@pikar/voice buildBriefMarkdown composer + BriefSections/TranscriptTurn shape"
  - phase: 06-02
    provides: "voice-brief registry skill (seedSkills) + VOICE_BRIEF_SKILL constant"
provides:
  - "internal.llm.draftVoiceBrief internalAction — the single place a kept transcript becomes fixed-section brief markdown"
  - "SMOKE:: offline seam for the brief→vault→plan convex-test path (no model call)"
  - "governed (DEFAULT→CHEAP, both metered) + registry-driven live path for VOIC-03 brief content"
affects: [06-05 voice.storeBrief, live-voice-sessions]

# Tech tracking
tech-stack:
  added: ["@pikar/voice linked into @pikar/backend"]
  patterns: ["toolless generateObject drafter mirroring digestInbox/draftReply; code-welded transcript (buildBriefMarkdown) over model-authored narrative sections"]

key-files:
  created:
    - packages/backend/convex/voiceBriefDraft.test.ts
  modified:
    - packages/backend/convex/llm.ts
    - docs/playbooks/cockpit.md
    - packages/backend/package.json
    - pnpm-lock.yaml

key-decisions:
  - "SMOKE:: sentinel detected on the FIRST transcript turn's text (parseSmoke(transcript[0]?.text)) — the array-shaped analogue of the string-prefix seam the other drafters use"
  - "SMOKE offline brief leaves openQuestions empty so the composer's literal 'None' rendering is exercised without a model call"
  - "briefSchema is strict-mode legal (all five BriefSections fields in properties AND required) — the digestSchema precedent"

patterns-established:
  - "Voice-brief drafter is a near-clone of digestInbox: fail-closed skill load FIRST, SMOKE short-circuit AFTER (load exercised offline), DEFAULT→CHEAP fallback both recordModelSpend'd, explicit Promise<string> return"
  - "Model fills narrative sections only; the full transcript is welded on in code via buildBriefMarkdown (never model-authored — the joinDigest precedent)"

requirements-completed: [VOIC-03]

# Metrics
duration: 14min
completed: 2026-07-20
---

# Phase 06 Plan 04: Voice-Brief Drafter Summary

**`draftVoiceBrief` — a toolless `generateObject` action that structures a kept voice transcript into fixed-section brief markdown via the `voice-brief` registry skill, with a SMOKE offline seam and DEFAULT→CHEAP governed spend, welding the full transcript on in code.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-20T~01:50Z
- **Completed:** 2026-07-20
- **Tasks:** 1 (TDD)
- **Files modified:** 4 (1 created)

## Accomplishments
- `internal.llm.draftVoiceBrief` added inside `llm.ts` (the sole "use node" module — no second node module, per the circular-inference constraint): fail-closed `voice-brief` load FIRST, `SMOKE::` short-circuit AFTER, `DEFAULT_MODEL → isFallbackEligible → CHEAP_MODEL` fallback with BOTH branches `recordModelSpend`'d, explicit `Promise<string>` on every path.
- Toolless `generateObject` over the `@pikar/voice` `BriefSections` schema (strict-mode legal); the model fills only the five narrative sections and the full transcript is code-welded via `buildBriefMarkdown` — never model-authored.
- SMOKE offline path returns a deterministic fixed-section brief (empty section → "None", transcript welded verbatim, `<!-- brief-language: … -->` metadata) with NO model call — the plan-05 `voice.storeBrief` convex-test path.
- `cockpit.md` playbook bumped (llm.ts is watched by it) naming `draftVoiceBrief` as the voice-brief seam.

## Task Commits

1. **Task 1 (RED): failing SMOKE offline test** - `fcceda5` (test)
2. **Task 1 (GREEN): draftVoiceBrief + @pikar/voice link + cockpit.md bump** - `7f5f598` (feat)

_No REFACTOR commit — the GREEN implementation was already the minimal mirror of `digestInbox`._

## Files Created/Modified
- `packages/backend/convex/voiceBriefDraft.test.ts` - SMOKE offline path test (fixed sections + welded transcript + "None") and fail-closed-unseeded assertion
- `packages/backend/convex/llm.ts` - `draftVoiceBrief` internalAction + `briefSchema` + `SMOKE_BRIEF_SECTIONS`; imports `VOICE_BRIEF_SKILL` and `buildBriefMarkdown`/`BriefSections`
- `docs/playbooks/cockpit.md` - new "Last verified: 2026-07-20 (06-04)" entry documenting the voice-brief drafter invariants
- `packages/backend/package.json` - `@pikar/voice: workspace:*` dependency (co-added by parallel plan 06-03; already at HEAD)
- `pnpm-lock.yaml` - `@pikar/voice` workspace link entry

## Decisions Made
- **SMOKE detection on the first turn's text.** The other drafters take a string and prefix-match `SMOKE::`; `draftVoiceBrief` takes a turn array, so it detects the sentinel on `transcript[0].text`. Fully deterministic and offline.
- **openQuestions empty in the offline brief** so the composer's "None" rendering is proven without a live model.
- **No redaction/scanText inside the action.** Mirrors `draftReply`/`draftCockpit` — the caller (plan 05 `voice.storeBrief`) owns correlation/scanning; the transcript reaches an LLM only in this toolless call, so an injected instruction has nothing to actuate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Linked `@pikar/voice` into `@pikar/backend`**
- **Found during:** Task 1 (GREEN)
- **Issue:** `buildBriefMarkdown`/`BriefSections` live in `@pikar/voice`, which was not a declared dependency of `@pikar/backend` — the import would not resolve at test/build time.
- **Fix:** Added `"@pikar/voice": "workspace:*"` to `packages/backend/package.json` and ran `pnpm install` (workspace link). Parallel plan 06-03 independently added the same dep line (their commit is now HEAD), so the package.json line was already committed by the time I staged; I committed only the `pnpm-lock.yaml` voice-link.
- **Files modified:** packages/backend/package.json, pnpm-lock.yaml
- **Verification:** `require.resolve('@pikar/voice')` links after install; the offline test loads `llm.ts` and passes.
- **Committed in:** 7f5f598 (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The dependency link was required to import the mandated composer. No scope creep — the plan explicitly key-links `draftVoiceBrief → buildBriefMarkdown (@pikar/voice)`.

## Issues Encountered
- **Shared-tree parallel execution with plan 06-03.** 06-03 committed (`b14d27c`, `6ae31ae`) between my RED and GREEN commits, moving HEAD and independently adding the `@pikar/voice` dep. Handled by staging ONLY my own files with explicit `git add` (never `-A`) and leaving `voiceToken.ts`/`voice.md`/`graphify-out/*` untouched.
- **`check-playbooks` emits a `block` decision for `voice.md`/`voiceToken.ts`** — that is 06-03's file, not mine. The hook's exit code is 0, and my `llm.ts` change is satisfied by the `cockpit.md` bump (no complaint about it). Per coordination I did not touch `voice.md`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 05's `voice.storeBrief` can now call `internal.llm.draftVoiceBrief` and get back ready-to-ingest brief markdown — offline via SMOKE for the unit path, governed + registry-driven for the live path.

---
*Phase: 06-live-voice-sessions*
*Completed: 2026-07-20*

## Self-Check: PASSED

All claimed files exist (voiceBriefDraft.test.ts, cockpit.md, 06-04-SUMMARY.md) and both commits (fcceda5 test, 7f5f598 feat) are in the git log. `draftVoiceBrief` export present in llm.ts.
