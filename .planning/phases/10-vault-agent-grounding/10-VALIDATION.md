---
phase: 10
slug: vault-agent-grounding
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-24
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` + `convex-test` (unit/integration); `pnpm eval:golden` live-model harness (`scripts/run-eval-golden.mjs`) for the gated skill |
| **Config file** | workspace vitest (per-package); eval harness is a standalone `.mjs` |
| **Quick run command** | `pnpm --filter @pikar/backend vitest run cockpitTools vaultGround` |
| **Full suite command** | `pnpm --filter @pikar/backend vitest run` then `pnpm eval:golden` |
| **Estimated runtime** | ~30s quick (SMOKE:: — no `OPENAI_API_KEY`); eval adds live-model latency |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @pikar/backend vitest run cockpitTools vaultGround`
- **After every plan wave:** Run `pnpm --filter @pikar/backend vitest run`
- **Before `/gsd:verify-work`:** Full suite green, then `pnpm eval:golden` green
- **Max feedback latency:** ~30 seconds (SMOKE:: path; eval gate is phase-boundary only)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-* | 01 | 1 | VGND-01 (hydration: titles + capped chunk text parallel to docIds) | unit (SMOKE::) | `pnpm --filter @pikar/backend vitest run vaultGround` | ❌ W0 (extend) | ⬜ pending |
| 10-02-* | 02 | 2 | VGND-01 (tool returns hydrated tenant-scoped text; empty search fails open with honest-no-match string) | unit (SMOKE::) | `pnpm --filter @pikar/backend vitest run cockpitTools` | ❌ W0 | ⬜ pending |
| 10-02-* | 02 | 2 | VGND-01/SC3 (no query string / chunk substring in `vault.searched` / step / DLQ payload) | unit regression | `pnpm --filter @pikar/backend vitest run cockpitTools` | ❌ W0 | ⬜ pending |
| 10-02-* | 02 | 2 | BETA-05/SC4 (tenant B's `searchVault` returns nothing from tenant A's corpus) | unit (SMOKE::) | `pnpm --filter @pikar/backend vitest run cockpitTools` | ⚠️ engine test exists; mirror at tool surface | ⬜ pending |
| 10-03-* | 03 | 3 | VGND-01 (SC1 UI: source card + activity step render; no-match nudge visible) | manual + component | see Manual-Only | n/a | ⬜ pending |
| 10-04-* | 04 | 3 | VGND-01/SC5 (grounded turn + empty-vault turn drive the real agent through the gated skill) | eval (live model) | `pnpm eval:golden` | ❌ W0 (new fixtures) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/backend/convex/cockpitTools.test.ts` — add `searchVault`: hydration return, fail-open no-match string, refs-only `vault.searched` payload (SC3), and the BETA-05 tenant-B-empty assertion at the tool surface (via `internal.llm.__invokeCockpitTool` + `SMOKE::`).
- [ ] `packages/backend/convex/vaultGround.test.ts` — extend for the hydration return (titles + capped chunk text) using existing `seedDoc`/`seedEdge` helpers.
- [ ] `packages/backend/scripts/eval-cases/25-vault-grounded.json` + `26-vault-empty.json` — grounded turn (seeded vault doc for the golden tenant + `SMOKE::` deterministic resolve) and a no-match/upload-nudge turn. **Confirm the eval harness can seed a tenant vault doc; if not, that seeding is itself a Wave 0 gap.**
- [ ] `packages/contracts/skills/cockpit-agent.md` — a **candidate** skill version teaching WHEN to call `searchVault` and that fenced vault context is reference-only (gated; activated only via `pnpm eval:golden`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Source card "📚 Grounded in N documents" renders with clickable titles alongside PLAN/BRIEFING/RESOLUTION cards | VGND-01 SC1 | Cross-surface React render (workspace `cards.tsx`) not covered by backend vitest | Run a grounded cockpit turn in the app; confirm the source card appears and a title opens the vault `PreviewModal` (or the fallback link to `/dashboard/vault`) |
| "Searching your knowledge vault…" activity step appears mid-turn | VGND-01 SC1 | SDK-loop callback emits the step; visible only in a live agent run | Observe the activity trace during a grounded turn |
| Upload-nudge phrasing on a real no-match turn reads honestly | VGND-01 SC1 | Prose quality is a human judgment | `/gsd:verify-work` conversational UAT |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-24 (plan-checker: VERIFICATION PASSED; Dimension 8 checks 8a–8d green)
