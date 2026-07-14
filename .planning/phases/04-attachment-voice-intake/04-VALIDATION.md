---
phase: 4
slug: attachment-voice-intake
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-14
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `04-RESEARCH.md` § Validation Architecture. Task-level rows are finalized by the planner.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x (unit) + `convex-test@0.0.54` (Convex) + Playwright 1.61.1 (E2E) |
| **Config file** | `packages/backend/vitest.config.*`, `packages/extraction/vitest.config.*` (Wave 0 if absent), `apps/web/playwright.config.*` |
| **Quick run command** | `pnpm --filter @pikar/extraction test` (pure) · `pnpm --filter @pikar/backend test -- intake` |
| **Full suite command** | `pnpm test` + `pnpm --filter @pikar/web exec playwright test intake` |
| **Estimated runtime** | ~ pure <1s · intake convex-test subset ~10s · full suite ~60s |

---

## Sampling Rate

- **After every task commit:** Run the relevant quick command (`@pikar/extraction` pure tests <1s; `intake` convex-test subset).
- **After every plan wave:** Run `pnpm test` (all packages) — must be green.
- **Before `/gsd:verify-work`:** Full suite + Playwright green; live smoke + human-verify before phase close.
- **Max feedback latency:** ~10 seconds (intake convex-test subset).

---

## Per-Task Verification Map

> Requirement-level map (planner splits into task IDs per plan). All SMOKE:: paths hit the REAL intake spine (classify → redact → cost → audit → merge) with ZERO real API calls.

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| INTK-02 | classify image/pdf/audio/document/unknown (magic bytes + mime + ext) | unit (pure) | `pnpm --filter @pikar/extraction test` | ❌ W0 (new pkg) | ⬜ pending |
| INTK-02 | extract → **redact** → persist safeText; raw never in audit | convex-test | `pnpm --filter @pikar/backend test -- intake` | ❌ W2 | ⬜ pending |
| INTK-02 | fail-closed: `scanText` Err → status=failed, no safeText, no merge | convex-test | `intake` + `SMOKE::extract::` + PII-poison fixture | ❌ W2 | ⬜ pending |
| INTK-02 | cost recorded for extraction call (kill-switch respected) | convex-test | assert `recordSpend` / budget decremented | ❌ W2 | ⬜ pending |
| INTK-02 | attachment safeText drives a cockpit turn (merge seam) | convex-test | assert `sendCockpitMessage` advances plan from framed text | ❌ W2 | ⬜ pending |
| INTK-03 | dictation transcript → conversation turn like a typed request | convex-test | `SMOKE::transcribe::<goal>` blob → `dictateToThread` | ❌ W2 | ⬜ pending |
| INTK-02/03 | UI: record/attach → upload → visible result in conversation | E2E (Playwright) | `playwright test intake` over SMOKE:: | ❌ W3 | ⬜ pending |
| SC3 | delivered email reflects attachment/dictation content past guardrails | **manual live** | human-verify checkpoint (Wave 4) | ❌ manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/extraction/` package scaffold + `vitest.config` + first `classify.test.ts`.
- [ ] `packages/backend` intake convex-test file + seed helper (register the components cockpit tests already use).
- [ ] No framework install needed (Vitest / convex-test / Playwright all present).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Delivered email reflects attached/dictated content past guardrails | SC3 (INTK-02/03) | Real OCR/transcription accuracy + real Gmail delivery cannot be exercised offline | On the live backend: (1) attach a REAL PDF + a REAL image → see them classified + content summarized into the conversation; (2) record + DICTATE a request → see the transcript enter as a request turn; (3) let the agent propose → Approve → confirm the delivered email reflects the attached/dictated content, audit refs-only. Mirrors Phase 3.3 CKPT-02. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
