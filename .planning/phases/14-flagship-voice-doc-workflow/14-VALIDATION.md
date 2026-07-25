---
phase: 14
slug: flagship-voice-doc-workflow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-25
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

---

## Per-Task Verification Map

Task IDs are assigned by the planner; rows below are the **behavior contract** each task must map onto.
Every task's `<automated>` verify must cite one of these commands or declare a Wave 0 dependency.

| SC | Behavior | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|----|----------|------|------|-------------|-----------|-------------------|-------------|--------|
| SC1 | Doc-scoped session refuses a non-`ready` / cross-tenant document | TBD | TBD | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 (`voiceDoc.test.ts`) | ⬜ pending |
| SC1 | Retrieval action returns passages from **this doc only** (drill-in), over the `SMOKE::` seam, no network | TBD | TBD | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 | ⬜ pending |
| SC1 | Tool JSON schema is the **flat** Realtime shape; digest respects the char budget | TBD | TBD | DOCV-01 | unit (pure) | `pnpm --filter @pikar/voice test` | ❌ W0 (`docSession.test.ts`) | ⬜ pending |
| SC1 | Mint body carries the doc digest + tool array + registry persona; still returns only `{clientSecret,expiresAt}` | TBD | TBD | DOCV-01 | unit (stubbed fetch) | `pnpm --filter @pikar/backend test voiceToken` | ✅ extend (`voiceToken.test.ts:26-70`) | ⬜ pending |
| SC1 | Live drill-in over a real call (an answer the agent did not have at connect) | TBD | TBD | DOCV-01 | **manual-only** | human-verify on integrated `main` | n/a | ⬜ pending |
| SC2 | Every persisted finding carries `citationDocId` + `citationTitle` | TBD | TBD | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 | ⬜ pending |
| SC2 | Citations are **welded in code** — the model output schema has no citation field | TBD | TBD | DOCV-01 | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ extend | ⬜ pending |
| SC2 | **Honest "no gaps"**: healthy fixture ⇒ `verdict:"healthy"` **and** `findings.length > 0` **and** `gaps.length === 0` | TBD | TBD | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 | ⬜ pending |
| SC2 | **No fabricated gap**: zero grounded findings ⇒ `verdict:"insufficient"` and `gaps.length === 0` | TBD | TBD | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 | ⬜ pending |
| SC2 | The agent *says* "no gaps" aloud | TBD | TBD | DOCV-01 | **manual-only** | human-verify | n/a | ⬜ pending |
| SC3 | Memo path stores exactly ONE vault artifact per session (idempotent on `briefRef`) | TBD | TBD | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voice` | ✅ extend (`voice.test.ts:234`) | ⬜ pending |
| SC3 | `actOnGap` on the synthetic voice-doc thread stages a `proposed` `kind:"memo"` plan | TBD | TBD | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test gapAction` | ✅ extend | ⬜ pending |
| SC3 | User chooses after the discussion; the plan crosses the Approve gate | TBD | TBD | DOCV-01 | e2e (offline, seeded) | `pnpm test:e2e` | ❌ W0 (`e2e/voice-doc.spec.ts` + `smoke:seedVoiceDocSession`) | ⬜ pending |
| SC4 | Retrieval audit payload is `{sessionId, queryHash, resultCount}` — no query text, no passages | TBD | TBD | DOCV-01 | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ extend | ⬜ pending |
| SC4 | New module writes **no** other log-plane row; `audit.log` call-site count pinned; `agentSteps` allow-list unchanged | TBD | TBD | DOCV-01 | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ extend | ⬜ pending |
| SC4 | Passages/findings prose never reach a return-to-log path (`payload:` objects free of `passages\|chunks\|text\|label\|citationTitle\|transcript\|query\b`) | TBD | TBD | DOCV-01 | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ extend | ⬜ pending |
| SC4 | `voice.ts` session audits stay refs/counts-only after the `docRef` change | TBD | TBD | DOCV-01 | static scan | `pnpm --filter @pikar/backend test llmRedaction` | ✅ exists (~line 706) | ⬜ pending |
| BETA-05 | Tenant A's voice-doc session can never retrieve or cite tenant B's document | TBD | TBD | DOCV-01 | unit (convex-test, two identities) | `pnpm --filter @pikar/backend test voiceDoc` | ❌ W0 | ⬜ pending |
| §5 | Persona loads from the registry and **fails closed** unseeded | TBD | TBD | DOCV-01 | unit (convex-test) | `pnpm --filter @pikar/backend test voiceToken` | ✅ pattern (`voiceToken.test.ts:86`) | ⬜ pending |
| §1 | Doc-discussion domain logic is pure and Convex-free | TBD | TBD | DOCV-01 | unit (pure) + `importGuard.test.ts` | `pnpm --filter @pikar/voice test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Static-scan discipline (house style, from `llmRedaction.test.ts`):** every new scan must be
**mutation-verified** — deliberately interpolate the forbidden value, confirm the test goes RED,
revert. A scan that cannot go red is theatre. Every scan also asserts its target identifier is
*present*, so a rename fails loudly instead of passing vacuously.

**Anti-vacuous pairing (Phase 12 lesson):** `gapCount: 0` alone also passes on the thin-data
`insufficient` verdict. The honest-no-gaps assertion MUST pair `findingsPresent` with
`gapCount === 0` and pin `verdict === "healthy"`.

---

## Wave 0 Requirements

- [ ] `packages/backend/convex/voiceDoc.ts` — empty stub (lane-owned module, must exist before the freeze)
- [ ] `packages/backend/convex/voiceDoc.test.ts` — SC1/SC2/BETA-05 coverage stubs
- [ ] `packages/voice/src/docSession.ts` + `docSession.test.ts` — pure domain (convention §1)
- [ ] `apps/web/e2e/voice-doc.spec.ts` + a `smoke:seedVoiceDocSession` internal mutation in `convex/smoke.ts` — SC3 offline e2e
- [ ] `convex/schema.ts` (Wave-0 freeze commit): widen `evaluations.framework` with the document-review literal; add `voiceSessions.docRef: v.optional(v.id("vaultDocuments"))`
- [ ] `apps/web/.../workspace/cards.tsx`: add the `FRAMEWORK_LABEL` entry — **web typecheck goes red the moment the schema widening lands without it** (`cards.tsx:1235` is `Record<Evaluation["framework"], string>`)
- [ ] `docs/playbooks/watch.json`: register `packages/backend/convex/voiceDoc.ts`, `voiceDoc.test.ts`, `apps/web/e2e/voice-doc.spec.ts` under `voice.md` (`packages/voice/` and `apps/web/app/(app)/dashboard/voice/` already covered)
- [ ] `convex/skills.ts` + the 5-file skill mirror for the document-analyst persona — seeded **UNGATED** (user decision 2026-07-25, voice-session precedent); **Lane A seeds this — coordinate or land it in Wave 0**
- [ ] Framework install: **none** — vitest / convex-test / Playwright all present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live drill-in: mid-call, ask something the agent did not have at connect; it retrieves and answers from **this** document | DOCV-01 / SC1 | A live Realtime call needs a mic, a real `OPENAI_API_KEY`, and audio. `e2e/voice.spec.ts` is deliberately offline; no automated harness exists. | On integrated `main`: upload a report → wait for `ready` → "Discuss by voice" → connect → ask a detail only present deep in the doc → confirm the answer is grounded and cited |
| Interrupt / redirect mid-answer | DOCV-01 / SC1 | Requires real duplex audio | Same session: talk over the agent; confirm it yields and follows the redirect |
| The agent *says* "no gaps" aloud on a healthy document | DOCV-01 / SC2 | Realtime speech; the golden runner cannot drive a voice persona | Use the healthy fixture document; ask "what are the gaps?"; confirm it says there are none rather than inventing one |
| Post-call choice: memo vs gap-bridging plan, then Approve | DOCV-01 / SC3 | Automated coverage is the seeded offline e2e; the real end-to-end flow needs a real session | After a live call, choose each outcome once; confirm the plan → Approve gate is crossed and no send occurs before approval |
| Relayed-retrieval round-trip latency inside the 15-minute cap | DOCV-01 | Nothing in-repo measures it (Open Question 5) | Time the pause between question and grounded answer during live verify; record the observation in `docs/playbooks/voice.md` |
| Mint-time `tools` vs `session.update` tools (Open Question 3) | DOCV-01 | REST and TypeScript references disagree; `voiceToken.ts` has been wrong twice about this body | Live-verify which branch the API accepts; record the outcome **with a date** in `packages/voice/src/realtime.ts`, as Phase 6 did |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a declared Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all ❌ MISSING references above
- [ ] Every new static scan is mutation-verified (goes RED when the forbidden value is planted)
- [ ] No watch-mode flags in any verify command
- [ ] Feedback latency < 10s per task
- [ ] Backend baseline held at 494/495; `tsc --noEmit` +0 new over the 52 pre-existing
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
