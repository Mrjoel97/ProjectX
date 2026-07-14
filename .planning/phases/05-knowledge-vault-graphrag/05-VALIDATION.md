---
phase: 5
slug: knowledge-vault-graphrag
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` ^3.2.7 + `convex-test` 0.0.54 (backend); pure `vitest` (`@pikar/vault`); Playwright 1.61.1 (web E2E) |
| **Config file** | `packages/backend/vitest.config.*` (existing); web `apps/web/playwright.config.ts` (existing) |
| **Quick run command** | `pnpm --filter @pikar/vault test` (pure domain) / `pnpm --filter @pikar/backend test vault` (convex-test) |
| **Full suite command** | `pnpm test` + `pnpm --filter @pikar/backend smoke:vault` (live) + `pnpm --filter @pikar/web test vault` (Playwright) |
| **Estimated runtime** | ~15s pure/convex-test; ~60s Playwright; smoke:vault needs a live `convex dev` deployment |

*No framework install needed — vitest / convex-test / Playwright / the workpool devDep are all already present (STATE.md, Phase 3.3).*

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @pikar/vault test` (fast, pure) + the touched `convex-test` file.
- **After every plan wave:** Run `pnpm --filter @pikar/backend test` + `pnpm --filter @pikar/web typecheck`.
- **Before `/gsd:verify-work`:** Full `pnpm test` green + `smoke:vault` (live embed/search/ground on a dev deployment) + the Playwright vault spec.
- **Max feedback latency:** ~15 seconds (pure + convex-test unit path).

---

## Per-Task Verification Map

| Req | Behavior | Wave | Test Type | Automated Command | File Exists | Status |
|-----|----------|------|-----------|-------------------|-------------|--------|
| VALT-01 | `vaultUpload` writes `vaultDocuments{status:processing}` + storage + starts ingest workflow; hash-dedup skips re-embed | 4 (Plan 04) | unit (convex-test) | `pnpm --filter @pikar/backend test vault` | ✅ created by 05-04 | ⬜ pending |
| VALT-01 | Real embed via `rag.add` (text-embedding-3-small@1536) → entry searchable | 7 (Plan 07) | live smoke | `pnpm --filter @pikar/backend smoke:vault` | ✅ created by 05-07 | ⬜ pending |
| VALT-02 | `extractGraph` SMOKE:: fixture → `upsertGraph` dedupes same entity across 2 docs to ONE node; degree bookkeeping | 3 (Plan 03) | unit (convex-test) | `pnpm --filter @pikar/backend test vaultGraph` | ✅ created by 05-03 | ⬜ pending |
| VALT-02 | `normalizeName`, BFS traversal, fusion correct (pure); orphan-GC-on-delete correct (convex-test) | 1 (Plan 01) + 4 (Plan 04) | unit (pure) + convex-test | `pnpm --filter @pikar/vault test` ; `pnpm --filter @pikar/backend test vault` | ✅ created by 05-01/05-04 | ⬜ pending |
| VALT-03 | `vaultGround` SMOKE:: path: vector-seed → graph-expand ≤2 → merge; tenant-scoped (cross-tenant returns nothing) | 5 (Plan 05) | unit (convex-test) + pure fusion | `pnpm --filter @pikar/backend test vaultGround` | ✅ created by 05-05 | ⬜ pending |
| VALT-03 | Live hybrid retrieval returns a real merged context for a seeded corpus | 7 (Plan 07) | live smoke | `pnpm --filter @pikar/backend smoke:vault` | ✅ created by 05-07 | ⬜ pending |
| VALT-04 | Vault route renders 4 stat tiles + 6 tabs + dropzone + search + grid/list; honest-zero empty state; upload→processing→ready reactive; delete cascades | 6 (Plan 06) build + 7 (Plan 07) E2E | E2E (Playwright, SMOKE:: ingest) | `pnpm --filter @pikar/web test vault` | ✅ created by 05-07 | ⬜ pending |
| VALT-04 | Signed-URL download is tenant-guarded (cross-tenant → null) | 5 (Plan 05) | unit (convex-test) | `pnpm --filter @pikar/backend test vault` | ✅ created by 05-05 | ⬜ pending |
| §4 | graph/audit/deadLetter payloads carry NO raw text; only `vaultDocuments.text` + rag chunks hold raw | 4 (Plan 04) | static scan (mirror `llmRedaction.test.ts`) | `pnpm --filter @pikar/backend test vaultRedaction` | ✅ created by 05-04 | ⬜ pending |

*Wave column filled by the planner. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Nyquist note: this phase has no separate "Wave 0" plan — each plan is test-first and creates its own scaffold in the same wave it lands (pure tests in Plan 01; convex-test files in Plans 03/04/05; the redaction scan in Plan 04; the Playwright spec + live smoke in Plan 07). The mapping below shows which plan creates each missing reference.*

- [ ] `packages/vault/` scaffold + `src/*.test.ts` (normalizeName, BFS traversal, fusion, category mapping) — **Plan 01** — VALT-02/03
- [ ] `convex/vaultGraph.test.ts` — upsert dedup + degree bookkeeping + orphan GC + BFS scope — **Plan 03** — VALT-02
- [ ] `convex/vault.test.ts` — ingest / hash-dedup / accept-but-defer / download-guard / delete-cascade (register `workflow` + `rag` components) — **Plan 04/05** — VALT-01/04
- [ ] `convex/vaultRedaction.test.ts` — §4 static scan of the new vault modules — **Plan 04**
- [ ] `convex/vaultGround.test.ts` — SMOKE:: hybrid fusion + tenant scope — **Plan 05** — VALT-03
- [ ] `apps/web/e2e/vault.spec.ts` — Playwright E2E over a SMOKE:: ingest — **Plan 07** — VALT-04
- [ ] `scripts/run-smoke-vault.mjs` + a `smoke:vault` package script — live embed/search/ground gate — **Plan 07**
- [ ] `SMOKE::` seam in the extractor (Plan 03) + embed/search paths (Plans 04/05) — deterministic offline fixtures, no live model
- [ ] No framework install needed (vitest / convex-test / Playwright / workpool devDep all present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live embed + hybrid retrieval quality over a real seeded corpus | VALT-01, VALT-03 | Real OpenAI embeddings + RRF ranking can't run in `convex-test` (no network embed); quality is judged, not asserted | Run `smoke:vault` against a live `convex dev` deployment (Plan 07); upload 2–3 briefs, confirm search + `vaultGround` return sensible merged context |
| Vault UI matches the committed screenshots (`brand-024242/024258`) 1:1 | VALT-04 | Visual fidelity (spacing, tiles, tabs, tokens) is a human judgment beyond Playwright DOM assertions | Open `/dashboard/vault` (Plan 07 checkpoint), compare against the two screenshots; verify stat tiles, 6 tabs, dropzone copy, grid/list, Refresh + Loading pill |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (mapped to the creating plan)
- [x] No watch-mode flags
- [x] Feedback latency < 20s (unit path)
- [x] `nyquist_compliant: true` set in frontmatter (waves/tasks assigned)

**Approval:** planner-signed 2026-07-14 (7 plans, 7 waves)
