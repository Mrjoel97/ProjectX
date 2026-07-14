---
phase: 5
slug: knowledge-vault-graphrag
status: draft
nyquist_compliant: false
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
| VALT-01 | `vaultUpload` writes `vaultDocuments{status:processing}` + storage + starts ingest workflow; hash-dedup skips re-embed | — | unit (convex-test) | `pnpm --filter @pikar/backend test vault` | ❌ W0 | ⬜ pending |
| VALT-01 | Real embed via `rag.add` (text-embedding-3-small@1536) → entry searchable | — | live smoke | `pnpm --filter @pikar/backend smoke:vault` | ❌ W0 | ⬜ pending |
| VALT-02 | `extractGraph` SMOKE:: fixture → `upsertGraph` dedupes same entity across 2 docs to ONE node; degree bookkeeping | — | unit (convex-test) | `pnpm --filter @pikar/backend test vaultGraph` | ❌ W0 | ⬜ pending |
| VALT-02 | `normalizeName`, BFS traversal, orphan-GC-on-delete correct | — | unit (pure) | `pnpm --filter @pikar/vault test` | ❌ W0 | ⬜ pending |
| VALT-03 | `vaultGround` SMOKE:: path: vector-seed → graph-expand ≤2 → merge; tenant-scoped (cross-tenant returns nothing) | — | unit (convex-test) + pure fusion | `pnpm --filter @pikar/backend test vaultGround` | ❌ W0 | ⬜ pending |
| VALT-03 | Live hybrid retrieval returns a real merged context for a seeded corpus | — | live smoke | `pnpm --filter @pikar/backend smoke:vault` | ❌ W0 | ⬜ pending |
| VALT-04 | Vault route renders 4 stat tiles + 6 tabs + dropzone + search + grid/list; honest-zero empty state; upload→processing→ready reactive; delete cascades | — | E2E (Playwright, SMOKE:: ingest) | `pnpm --filter @pikar/web test vault` | ❌ W0 | ⬜ pending |
| VALT-04 | Signed-URL download is tenant-guarded (cross-tenant → null) | — | unit (convex-test) | `pnpm --filter @pikar/backend test vault` | ❌ W0 | ⬜ pending |
| §4 | graph/audit/deadLetter payloads carry NO raw text; only `vaultDocuments.text` + rag chunks hold raw | — | static scan (mirror `llmRedaction.test.ts`) | `pnpm --filter @pikar/backend test vaultRedaction` | ❌ W0 | ⬜ pending |

*Wave column filled by the planner once plans/waves are assigned. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/vault/` package scaffold + `src/*.test.ts` (normalizeName, BFS traversal, fusion, category mapping) — VALT-02/03
- [ ] `convex/vault.test.ts` — ingest / hash-dedup / download-guard / delete-cascade (register `workflow` + `rag` components in convex-test) — VALT-01/04
- [ ] `convex/vaultGraph.test.ts` — upsert dedup + degree bookkeeping + orphan GC — VALT-02
- [ ] `convex/vaultGround.test.ts` — SMOKE:: hybrid fusion + tenant scope — VALT-03
- [ ] `convex/vaultRedaction.test.ts` — §4 static scan of the new vault modules
- [ ] `apps/web/.../vault.spec.ts` — Playwright E2E over a SMOKE:: ingest — VALT-04
- [ ] `scripts/run-smoke-vault.mjs` + a `smoke:vault` package script — live embed/search/ground gate
- [ ] `SMOKE::` seam in the extractor + embed/search paths (deterministic offline fixtures, no live model)
- [ ] No framework install needed (vitest / convex-test / Playwright / workpool devDep all present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live embed + hybrid retrieval quality over a real seeded corpus | VALT-01, VALT-03 | Real OpenAI embeddings + RRF ranking can't run in `convex-test` (no network embed); quality is judged, not asserted | Run `smoke:vault` against a live `convex dev` deployment; upload 2–3 briefs, confirm search + `vaultGround` return sensible merged context |
| Vault UI matches the committed screenshots (`brand-024242/024258`) 1:1 | VALT-04 | Visual fidelity (spacing, tiles, tabs, tokens) is a human judgment beyond Playwright DOM assertions | Open `/dashboard/vault`, compare against the two screenshots; verify stat tiles, 6 tabs, dropzone copy, grid/list, Refresh + Loading pill |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s (unit path)
- [ ] `nyquist_compliant: true` set in frontmatter (after planner assigns waves/tasks)

**Approval:** pending
