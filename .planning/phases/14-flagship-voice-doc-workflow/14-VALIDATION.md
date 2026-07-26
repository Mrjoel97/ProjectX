---
phase: 14
slug: flagship-voice-doc-workflow
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-25
revised: 2026-07-25
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `14-RESEARCH.md` § Validation Architecture. Lane C (`lane-c/voice-doc`).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.7 + `convex-test` 0.0.54 (backend) · Vitest 3.2.7 (pure packages) · Playwright (`apps/web` e2e only — **`apps/web` has NO unit runner**) |
| **Config file** | `packages/backend/vitest.config.*` (per-package) · `apps/web/playwright.config.*` |
| **Quick run command** | `pnpm --filter @pikar/backend test <file-stem>` · `pnpm --filter @pikar/voice test` |
| **Full suite command** | `pnpm test` + `pnpm --filter @pikar/backend exec tsc --noEmit` + `pnpm --filter @pikar/web typecheck` + `node scripts/check-playbooks.mjs` |
| **Estimated runtime** | ~10s per-file quick run · ~3–5 min full suite |
| **Known baseline** | backend **494/495** — the single red is the documented pre-existing `audit.test.ts` `auditCounts` row. Backend `tsc --noEmit` has **52 pre-existing** test-file errors; the bar is **+0 new**. |

---

## Sampling Rate

- **After every task commit:** `pnpm --filter @pikar/backend test <changed-file-stem>` (sub-10s) + `pnpm --filter @pikar/voice test`
- **After every plan wave:** `pnpm test` + `pnpm --filter @pikar/backend exec tsc --noEmit` (+0 new over the 52 pre-existing) + `pnpm --filter @pikar/web typecheck` (exit 0) + `node scripts/check-playbooks.mjs` (exit 0) — this is the automated lane merge gate defined by `PARALLELIZATION.md` Stage 3
- **Before `/gsd:verify-work`:** Full suite green (494/495 baseline maintained, all new tests green), then the ONE live human-verify on integrated `main`
- **Max feedback latency:** 10 seconds (per-task), 300 seconds (per-wave)

### STATED EXCEPTION — `pnpm --filter @pikar/web build` as a per-task verify

Five tasks carry a full Next.js build in their per-task `<verify>`, which blows well past the
10-second per-task budget:

| Plan | Task | Why the build is the only sufficient gate |
|------|------|-------------------------------------------|
| 14-06 | T3 — read `?doc=` inside a Suspense boundary | This task **introduces** the `useSearchParams` call. Pitfall 6: without a `<Suspense>` boundary the App Router errors at prerender or silently deopts the whole page to client-side rendering. `tsc`/`typecheck` cannot see it — it only exists at build/prerender time. |
| 14-07 | T1 — vault "Discuss by voice" entry | Adds the route link into the same prerendered tree; the build is the phase-wide regression gate for the Pitfall-6 class. |
| 14-07 | T3 — `DocStrip` in `LiveSession` | Renders inside the `?doc=`-scoped subtree; a client/server boundary mistake here re-opens the same prerender failure. |
| 14-08 | T1 — the doc branch of `PostCall` | Same subtree, plus a new `useAction` + `CardList` mount under the Suspense boundary. |
| 14-08 | T2 — `EvaluationCard` / `CardList` edits | `cards.tsx` is imported by both the workspace route and (now) the voice route; a build is the only check that both prerender paths still compile. |

**Accepted, not waived.** Each of these tasks also runs `pnpm --filter @pikar/web typecheck` FIRST as
the fast (<10s) signal; the build runs second, as the gate. The Nyquist contract is satisfied on the
fast channel and the slow channel is what catches the one class of regression the fast channel is
structurally blind to. No other task in the phase may add a build to its per-task verify without
adding a row here.

---

## Per-Task Verification Map

Rows below are the **behavior contract** each task must map onto. Plan/Wave columns are filled in
from the committed Phase-14 plans. Every task's `<automated>` verify cites one of these commands or
declares a Wave 0 dependency.

| SC | Behavior | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|----|----------|------|------|-------------|-----------|-------------------|-------------|--------|
| SC1 | Doc-scoped session refuses a non-`ready` / cross-tenant document | 14-03 T1, T3 | 3 | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 (`voiceDoc.test.ts`) | ⬜ pending |
| SC1 | Retrieval action returns passages from **this doc only** (drill-in), over the `SMOKE::` seam, no network | 14-03 T2, T3 | 3 | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 | ⬜ pending |
| SC1 | Tool JSON schema is the **flat** Realtime shape; digest respects the char budget | 14-01 T2 · 14-02 T1 | 1 · 2 | DOCV-01 | unit (pure) | `pnpm --filter @pikar/voice test` | ❌ W0 (`docSession.test.ts`) | ⬜ pending |
| SC1 | Mint body carries the doc digest + tool array + registry persona; still returns only `{clientSecret,expiresAt}` | 14-04 | 4 | DOCV-01 | unit (stubbed fetch) | `pnpm --filter @pikar/backend test voiceToken` | ✅ extend (`voiceToken.test.ts:26-70`) | ⬜ pending |
| SC1 | Browser relay round-trips a `search_document` call over the data channel | 14-06 T2, T3 | 6 | DOCV-01 | typecheck + **build** (stated exception) | `pnpm --filter @pikar/web typecheck` then `pnpm --filter @pikar/web build` | n/a (no unit runner) | ⬜ pending |
| SC1 | Live drill-in over a real call (an answer the agent did not have at connect) | 14-09 T3 | 9 | DOCV-01 | **manual-only** | human-verify on integrated `main` | n/a | ⬜ pending |
| SC2 | Every persisted finding carries `citationDocId` + `citationTitle` | 14-05 T3 | 5 | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 | ⬜ pending |
| SC2 | **Quoted passage, persisted**: a finding carries a capped (`EXCERPT_CHAR_CAP`), substring-verified `citationExcerpt` when the model quoted the report — and NO key at all when it did not (absent is valid, non-degraded) | 14-02 T2 · 14-05 T1, T3 | 2 · 5 | DOCV-01 | unit (pure) + unit (convex-test) | `pnpm --filter @pikar/voice test` · `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 | ⬜ pending |
| SC2 | **Quoted passage, shown**: the post-call card renders `citationExcerpt` when present and renders exactly as today (no empty quote block) when absent | 14-08 T2, T3 | 8 | DOCV-01 | e2e (offline, seeded) + **build** (stated exception) | `pnpm test:e2e` · `pnpm --filter @pikar/web build` | ❌ W0 (`e2e/voice-doc.spec.ts`) | ⬜ pending |
| SC2 | Citations are **welded in code** — the model output schema has no citation/verdict/route/playbook/rank field. Its ONE deliberate exception is `excerpt`, whose PRESENCE is also asserted so a cleanup cannot silently drop half the locked citation decision | 14-09 T1 | 9 | DOCV-01 | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ extend | ⬜ pending |
| SC2 | **Honest "no gaps"**: healthy fixture ⇒ `verdict:"healthy"` **and** `findings.length > 0` **and** `gaps.length === 0` | 14-02 T2 · 14-05 T3 | 2 · 5 | DOCV-01 | unit (pure) + unit (convex-test) | `pnpm --filter @pikar/voice test` · `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 | ⬜ pending |
| SC2 | **No fabricated gap**: zero grounded findings ⇒ `verdict:"insufficient"` and `gaps.length === 0` | 14-02 T2 · 14-05 T3 | 2 · 5 | DOCV-01 | unit (pure) + unit (convex-test) | `pnpm --filter @pikar/voice test` · `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 | ⬜ pending |
| SC2 | The agent *says* "no gaps" aloud | 14-09 T3 | 9 | DOCV-01 | **manual-only** | human-verify | n/a | ⬜ pending |
| SC3 | Memo path stores exactly ONE vault artifact per session (idempotent on `briefRef`) | 14-08 T3 | 8 | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voice` | ✅ extend (`voice.test.ts:234`) | ⬜ pending |
| SC3 | `actOnGap` on the synthetic voice-doc thread stages a `proposed` `kind:"memo"` plan | 14-08 T3 | 8 | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test gapAction` | ✅ extend | ⬜ pending |
| SC3 | User chooses after the discussion; the plan crosses the Approve gate | 14-08 T3 | 8 | DOCV-01 | e2e (offline, seeded) | `pnpm test:e2e` | ❌ W0 (`e2e/voice-doc.spec.ts` + `smoke:seedVoiceDocSession`) | ⬜ pending |
| SC4 | Retrieval audit payload is `{sessionId, queryHash, resultCount}` — no query text, no passages | 14-09 T1 | 9 | DOCV-01 | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ extend | ⬜ pending |
| SC4 | New module writes **no** other log-plane row; `audit.log` call-site count pinned; `agentSteps` allow-list unchanged | 14-09 T1 | 9 | DOCV-01 | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ extend | ⬜ pending |
| SC4 | Passages/findings prose never reach a return-to-log path (`payload:` objects free of `passages\|chunks\|text\|label\|citationTitle\|transcript\|query\b`) | 14-09 T1 | 9 | DOCV-01 | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ extend | ⬜ pending |
| SC4 | **Quoted excerpts never reach a log-plane row** — every `payload:` block in `voiceDoc.ts` (and the Phase-14 payloads in `voice.ts`) is free of `citationExcerpt\|\bexcerpt\b`. This is the newest and highest-value leak surface: `citationExcerpt` is the only verbatim report content the phase persists. **Mutation-verified** like every other scan (plant `citationExcerpt` in the `voicedoc.reviewed` payload → confirm RED → revert) | 14-09 T1 | 9 | DOCV-01 | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ extend | ⬜ pending |
| SC4 | `voice.ts` session audits stay refs/counts-only after the `docRef` change | 14-09 T1 | 9 | DOCV-01 | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ exists (~line 706) | ⬜ pending |
| BETA-05 | Tenant A's voice-doc session can never retrieve or cite tenant B's document | 14-03 T3 · 14-05 T3 | 3 · 5 | DOCV-01 | unit (convex-test, two identities) | `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 | ⬜ pending |
| §5 | Persona loads from the registry and **fails closed** unseeded | 14-04 | 4 | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voiceToken` | ✅ pattern (`voiceToken.test.ts:86`) | ⬜ pending |
| §1 | Doc-discussion domain logic is pure and Convex-free | 14-02 | 2 | DOCV-01 | unit (pure) + `importGuard.test.ts` | `pnpm --filter @pikar/voice test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Static-scan discipline (house style, from `llmRedaction.test.ts`):** every new scan must be
**mutation-verified** — deliberately interpolate the forbidden value, confirm the test goes RED,
revert. A scan that cannot go red is theatre. Every scan also asserts its target identifier is
*present*, so a rename fails loudly instead of passing vacuously.

**Anti-vacuous pairing (Phase 12 lesson):** `gapCount: 0` alone also passes on the thin-data
`insufficient` verdict. The honest-no-gaps assertion MUST pair `findingsPresent` with
`gapCount === 0` and pin `verdict === "healthy"`.

**Content-plane / log-plane line for the excerpt (Phase-14 addition):** `citationExcerpt` is
verbatim report content. It is **legal** in `evaluations.findings[]`, in `composeDocMemo`'s memo
body and in the post-call card. It is **illegal** in every `audit` / `deadLetters` / `telemetry`
`payload:` and in every `agentSteps` row. There is no third state — if a future task needs to "log
which finding", it logs an index or a count, never the quote.

---

## Wave 0 Requirements

- [ ] `packages/backend/convex/voiceDoc.ts` — empty stub (lane-owned module, must exist before the freeze)
- [ ] `packages/backend/convex/voiceDoc.test.ts` — SC1/SC2/BETA-05 coverage stubs
- [ ] `packages/voice/src/docSession.ts` + `docSession.test.ts` — pure domain (convention §1), including `EXCERPT_CHAR_CAP`
- [ ] `apps/web/e2e/voice-doc.spec.ts` + a `smoke:seedVoiceDocSession` internal mutation in `convex/smoke.ts` — SC3 offline e2e; the seed carries TWO findings, one WITH a `citationExcerpt` and one WITHOUT, so both render paths are exercised
- [ ] `convex/schema.ts` (Wave-0 freeze commit): widen `evaluations.framework` with the document-review literal; add `evaluations.findings[].citationExcerpt: v.optional(v.string())`; add `voiceSessions.docRef: v.optional(v.id("vaultDocuments"))`
- [ ] `apps/web/.../workspace/cards.tsx`: add the `FRAMEWORK_LABEL` entry — **web typecheck goes red the moment the schema widening lands without it** (`cards.tsx:1235` is `Record<Evaluation["framework"], string>`). Same commit as the schema edit, no exceptions.
- [ ] `docs/playbooks/watch.json`: register `packages/backend/convex/voiceDoc.ts`, `voiceDoc.test.ts`, `apps/web/e2e/voice-doc.spec.ts` under `voice.md` (`packages/voice/` and `apps/web/app/(app)/dashboard/voice/` already covered)
- [ ] `convex/skills.ts` + the 5-file skill mirror for the document-analyst persona — seeded **UNGATED** (user decision 2026-07-25, voice-session precedent); **Lane A seeds this — coordinate or land it in Wave 0**
- [ ] Framework install: **none** — vitest / convex-test / Playwright all present

---

## Wave / File-Ownership Contract

`docs/playbooks/voice.md` is written by **every** plan in this phase (the Stop hook,
`scripts/check-playbooks.mjs`, blocks any turn that changes a watched path without touching its
playbook). Two plans appending to one file in one worktree can silently lose an update, and there is
no git "keep both" recovery for that — so Phase 14's waves are deliberately **one plan per wave**:

| Wave | Plan | Also owns |
|------|------|-----------|
| 1 | 14-01 | `schema.ts`, `cards.tsx` (`FRAMEWORK_LABEL`), all Wave-0 stubs, `skills.ts`, `watch.json`, `cockpit.md` |
| 2 | 14-02 | `packages/voice/src/*` |
| 3 | 14-03 | `voice.ts`, `voiceDoc.ts` |
| 4 | 14-04 | `voiceToken.ts` |
| 5 | 14-05 | `voiceDoc.ts` |
| 6 | 14-06 | `useVoiceSession.ts`, `voice/page.tsx` |
| 7 | 14-07 | `DocGrid.tsx`, `PreviewModal.tsx`, `DocStrip.tsx`, `LiveSession.tsx`, `vault.md` |
| 8 | 14-08 | `PostCall.tsx`, `cards.tsx`, `voice-doc.spec.ts`, `cockpit.md` |
| 9 | 14-09 | `llmRedaction.test.ts`, the live-verify checkpoint |

Serialization is the cost of a single shared playbook and a single worktree; it is deliberate, not
an oversight. Do not "restore parallelism" by having a plan skip its playbook edit — the Stop hook
will block that turn anyway.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live drill-in: mid-call, ask something the agent did not have at connect; it retrieves and answers from **this** document | DOCV-01 / SC1 | A live Realtime call needs a mic, a real `OPENAI_API_KEY`, and audio. `e2e/voice.spec.ts` is deliberately offline; no automated harness exists. | On integrated `main`: upload a report → wait for `ready` → "Discuss by voice" → connect → ask a detail only present deep in the doc → confirm the answer is grounded and cited |
| Interrupt / redirect mid-answer | DOCV-01 / SC1 | Requires real duplex audio | Same session: talk over the agent; confirm it yields and follows the redirect |
| The agent *says* "no gaps" aloud on a healthy document | DOCV-01 / SC2 | Realtime speech; the golden runner cannot drive a voice persona | Use the healthy fixture document; ask "what are the gaps?"; confirm it says there are none rather than inventing one |
| A quoted passage on a REAL model call is verbatim from the report | DOCV-01 / SC2 | The substring check proves provenance offline against fixtures; only a live call shows whether the model quotes usefully (right sentence, right length) rather than merely legally | After a live session, open the post-call findings and compare each quoted passage against the source document in `PreviewModal`; note any finding that produced no quote where an obvious one existed |
| Post-call choice: memo vs gap-bridging plan, then Approve | DOCV-01 / SC3 | Automated coverage is the seeded offline e2e; the real end-to-end flow needs a real session | After a live call, choose each outcome once; confirm the plan → Approve gate is crossed and no send occurs before approval |
| Relayed-retrieval round-trip latency inside the 15-minute cap | DOCV-01 | Nothing in-repo measures it (Open Question 5) | Time the pause between question and grounded answer during live verify; record the observation in `docs/playbooks/voice.md` |
| Mint-time `tools` vs `session.update` tools (Open Question 3) | DOCV-01 | REST and TypeScript references disagree; `voiceToken.ts` has been wrong twice about this body | Live-verify which branch the API accepts; record the outcome **with a date** in `packages/voice/src/realtime.ts`, as Phase 6 did |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a declared Wave 0 dependency — the only task without one is 14-09 T3, which is a `checkpoint:human-verify` by design
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all ❌ MISSING references above — all of them land in 14-01
- [x] Every new static scan is mutation-verified (goes RED when the forbidden value is planted) — including the new `citationExcerpt` scan, whose planted value is named in 14-09 T1
- [x] No watch-mode flags in any verify command
- [x] Feedback latency < 10s per task — **except** the five `pnpm --filter @pikar/web build` tasks recorded above as a stated exception; each of those also runs `typecheck` first as the fast channel
- [ ] Backend baseline held at 494/495; `tsc --noEmit` +0 new over the 52 pre-existing — *verified at execution, per wave*
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-25
