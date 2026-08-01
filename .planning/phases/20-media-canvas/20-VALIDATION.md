---
phase: 20
slug: media-canvas
status: planned
nyquist_compliant: true
wave_0_complete: false  # 20-01 + 20-04 create the missing test files
created: 2026-08-01
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `20-RESEARCH.md` § *Validation Architecture*. The per-task map below is filled by
> the planner; everything above it is settled.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.2.7 + `convex-test` 0.0.54 (in-memory Convex functions) — both already installed and pinned. **No new framework.** |
| **Config file** | `packages/backend/vitest.config.ts` — `environment: "edge-runtime"`, `include: ["convex/**/*.test.ts"]`, `testTimeout: 20_000`, **no watch mode ever** |
| **Env pragma** | a test that reads repo files off disk needs `// @vitest-environment node` on line 1 (`traceParity.test.ts:1`, `research.test.ts:1`) — `edge-runtime` has no `node:fs` |
| **Quick run command** | `pnpm --filter @pikar/cost test` and `pnpm --filter @pikar/backend test -- media` |
| **Full suite command** | `pnpm test` (turbo, all packages) |
| **Estimated runtime** | ~30 s quick · full suite per repo norm |
| **Typecheck** | `pnpm typecheck` — backend baseline is **exactly 150 errors, all in test files, ZERO non-test**. Any delta is a regression. |
| **Web build** | `pnpm --filter @pikar/web build` — required for any wave touching `cards.tsx` (vitest does not prove a web build) |
| **Playbook gate** | `node scripts/check-playbooks.mjs` must exit 0 |
| **Cost of the whole suite** | **$0.** No test in this phase may call fal or OpenAI. |

---

## Sampling Rate

- **After every task commit:** `pnpm --filter @pikar/cost test` + `pnpm --filter @pikar/backend test -- media` (both < 30 s)
- **After every plan wave:** `pnpm test` + `pnpm typecheck` (backend delta **exactly 0** vs the 150 baseline) + `pnpm --filter @pikar/web build` if `cards.tsx` was touched + `node scripts/check-playbooks.mjs` exit 0
- **Before `/gsd:verify-work`:** full suite green, then the owner-run live gate below
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

*Filled by the planner once plans exist. Every row must trace to an SC below.*

| Task ID | Plan | Wave | SC | Test Type | Automated Command | File Exists | Status |
|---------|------|------|----|-----------|-------------------|-------------|--------|
| 01-T1 | 20-01 | 1 | SC5 | playbook gate | `node scripts/check-playbooks.mjs` | ❌ create | ⬜ pending |
| 01-T2 | 20-01 | 1 | SC3 | pure unit, $0 | `pnpm --filter @pikar/core test -- storyboard` | ❌ create | ⬜ pending |
| 01-T3 | 20-01 | 1 | SC3, SC5 | pure unit + static scan | `pnpm --filter @pikar/cost test` | ❌ create | ⬜ pending |
| 02-T1 | 20-02 | 1 | SC4 | schema | `pnpm --filter @pikar/backend test -- schema` | ✅ exists | ⬜ pending |
| 02-T2 | 20-02 | 1 | Surface | static scan | `pnpm --filter @pikar/backend test -- traceParity` | ✅ exists (goes RED until both land) | ⬜ pending |
| 02-T3 | 20-02 | 1 | SC4 | unit | `pnpm --filter @pikar/backend test -- plans` | ✅ exists | ⬜ pending |
| 03-T1 | 20-03 | 2 | Surface | round trip | `pnpm --filter @pikar/core test -- storyboard` | ❌ extend | ⬜ pending |
| 03-T2 | 20-03 | 2 | Surface | unit (md↔ts drift + UNGATED) | `pnpm --filter @pikar/contracts test` | ✅ add rows | ⬜ pending |
| 03-T3 | 20-03 | 2 | Surface | round trip | `pnpm --filter @pikar/core test -- storyboard` | ❌ extend | ⬜ pending |
| 04-T1 | 20-04 | 2 | SC3 | convex-test, $0 | `pnpm --filter @pikar/backend test -- guardrails` | ✅ exists | ⬜ pending |
| 04-T2 | 20-04 | 2 | SC3 | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 → created here | ⬜ pending |
| 04-T3 | 20-04 | 2 | SC3 | convex-test concurrency + mutation check | `pnpm --filter @pikar/backend test -- media` | ❌ created here | ⬜ pending |
| 05-T1 | 20-05 | 3 | SC1 | unit, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 05-T2 | 20-05 | 3 | SC1, SC2 | unit + static scan | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 05-T3 | 20-05 | 3 | SC5 | playbook gate | `node scripts/check-playbooks.mjs` | ✅ exists | ⬜ pending |
| 06-T1 | 20-06 | 4 | SC1 | convex-test http, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 06-T2 | 20-06 | 4 | SC4 | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 06-T3 | 20-06 | 4 | SC2, SC4 | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ add cases | ⬜ pending |
| 07-T1 | 20-07 | 5 | SC3 | unit + typecheck delta | `pnpm --filter @pikar/core test -- actionType` | ✅ exists | ⬜ pending |
| 07-T2 | 20-07 | 5 | SC3 | convex-test, $0 | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ exists | ⬜ pending |
| 07-T3 | 20-07 | 5 | SC3 | regression, $0 | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ exists | ⬜ pending |
| 08-T1 | 20-08 | 6 | Surface | unit | `pnpm --filter @pikar/core test -- specialists` | ✅ extend | ⬜ pending |
| 08-T2 | 20-08 | 6 | SC3, Surface | unit + static scan | `pnpm --filter @pikar/core test -- specialists` | ✅ extend | ⬜ pending |
| 08-T3 | 20-08 | 6 | SC2 | convex-test, $0 | `pnpm --filter @pikar/backend test -- dispatch` | ✅ exists | ⬜ pending |
| 09-T1 | 20-09 | 6 | SC2, SC4 | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 09-T2 | 20-09 | 6 | SC3 | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 09-T3 | 20-09 | 6 | SC4 | convex-test isolation, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 10-T1 | 20-10 | 7 | SC2 | web build | `pnpm --filter @pikar/web build` | n/a | ⬜ pending |
| 10-T2 | 20-10 | 7 | SC2, SC4 | web build + static scan | `pnpm --filter @pikar/web build` | n/a | ⬜ pending |
| 10-T3 | 20-10 | 7 | SC3 | web build | `pnpm --filter @pikar/web build` | n/a | ⬜ pending |
| 11-T1 | 20-11 | 8 | SC1, SC5 | doc + playbook gate | `node scripts/check-playbooks.mjs` | ❌ create ADR-012 | ⬜ pending |
| 11-T2 | 20-11 | 8 | SC5 | doc + playbook gate | `node scripts/check-playbooks.mjs` | ✅ exists | ⬜ pending |
| 11-T3 | 20-11 | 8 | SC1, SC5 | **MANUAL — owner live gate ≈$0.26** | manual (see Manual-Only table) | n/a | ⬜ pending |
| 12-T1 | 20-12 | 9 | Surface | **MANUAL — blocking decision checkpoint** | manual (Phase-16 stream check) | n/a | ⬜ pending |
| 12-T2 | 20-12 | 9 | Surface | unit (md↔ts drift) | `pnpm --filter @pikar/contracts test` | ✅ exists | ⬜ pending |

> Every row above is MEDIA-01. All 12 plans carry `requirements: [MEDIA-01]`.
> **Offline cost of every automated row: $0.** The only spend in this phase is 11-T3.

### Success-Criteria → Test Map (settled by research)

| SC | Behavior | Test type | Automated command | File exists? |
|----|----------|-----------|-------------------|--------------|
| **SC1** | the fal adapter builds a submit body whose `model`/`resolution`/`duration` are **exactly the priced spec** — no provider default is ever relied on | unit | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC1 | `FAL_KEY` unset → the adapter refuses **before** any fetch (fail-closed, the `requireEnv` idiom) | unit | same | ❌ Wave 0 |
| SC1 | the webhook rejects a bad/absent HMAC segment with 401 and writes **nothing** | unit (convex-test http) | same | ❌ Wave 0 |
| **SC2** | submit returns immediately `status: "submitted"`; no path awaits completion; the canvas renders per-shot status before any asset exists | unit | same | ❌ Wave 0 |
| SC2 | the webhook is the ONLY writer of `succeeded`/`failed`/`blocked` | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ add cases |
| **SC3** | price table: known (model, resolution) prices correctly; **unknown model → `unknown_model`**; **unknown resolution → `unknown_model`, never a tier fallback**; image megapixels round UP | pure unit, $0 | `pnpm --filter @pikar/cost test` | ❌ Wave 0 |
| SC3 | `chooseMediaBatch` sums N shots, returns `over_batch_cap` above $1.00; free shot types cost 0 | pure unit, $0 | same | ❌ Wave 0 |
| SC3 | **the D4 numbers as data:** Wan 2.5 480p×10s = $0.50 ✅ · 720p×10s = $1.00 ✅ (boundary) · **1080p×10s = $1.50 ❌ refused** · Veo-class ❌ refused | pure unit, $0 | same | ❌ Wave 0 |
| SC3 | `reserveBatch` refuses on `mediaKillSwitch` **and** on the global `killSwitch`, independently | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC3 | **per-tenant window:** tenant A exhausting `mediaSpendCents` does not refuse tenant B (the 22.1-02 assertion, re-run for media) | convex-test, $0 | same | ❌ Wave 0 |
| SC3 | **rails are separate:** a media reserve does not move `dailySpendCents`; an LLM `recordSpend` does not move `mediaSpendCents` | convex-test, $0 | same | ❌ Wave 0 |
| SC3 | **plan-gated by construction:** no `SPECIALIST_TOOLS`/`RESEARCH_TOOLS` member reaches the fal adapter; submit is called only from the post-approve arm and the canvas mutations | static scan | `pnpm --filter @pikar/core test -- specialists` + `… test -- llmRedaction` | ✅ extend |
| **SC4** | asset bytes land in `_storage`; the row holds `assetStorageId` + `assetHash`; **no field anywhere holds a fal URL** | convex-test + static scan | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC4 | audit payload keys are exactly the allow-list; **no `url`/`href`/`http` substring**; no prompt text | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ add cases |
| SC4 | verdict ∈ the four enum values; a video response with no moderation field yields **`none_reported`**, never a clear/pass value | unit | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC4 | **isolation assertion:** tenant B gets `[]` from `media.assetUrls` on tenant A's plan; cannot regenerate tenant A's shot; the webhook writes only the row its `callbackHash` resolves | convex-test, $0 | same | ❌ Wave 0 |
| **SC5** | the price table carries a `ponytail:` comment naming the ceiling + upgrade path; `docs/playbooks/media.md` holds a runnable manual reconciliation procedure | static scan + doc | `pnpm --filter @pikar/cost test` + `node scripts/check-playbooks.mjs` | ❌ Wave 0 |
| **Surface** | `agentSteps.tool` and the `cards.tsx` VERB map agree **both ways** for `dispatchMedia` | static scan | `pnpm --filter @pikar/backend test -- traceParity` | ✅ exists — goes RED until both land |
| **Surface** | `SPECIALIST_ROUTES` exact array; media's grant is exactly `["searchVault"]`; every granted tool is taught in the body; **`diagnose()` emits no `"media"`** | unit | `pnpm --filter @pikar/core test -- specialists` | ✅ extend |
| **Surface** | every media `.md` body is byte-identical (LF-normalized) to its derived `.ts` constant; media skills are **NOT** in `GATED_SKILLS` | unit | `pnpm --filter @pikar/contracts test` | ✅ add rows |

---

## Wave 0 Requirements

- [ ] `packages/cost/src/media.ts` + `packages/cost/src/media.test.ts` — price table keyed by
      **(model, resolution)**, batch estimator, SC3 boundaries.
      **`packages/cost/` is uncovered by `watch.json` — registering it is part of this item.**
- [ ] `packages/backend/convex/media.test.ts` — convex-test harness; copy `research.test.ts:1-40`'s
      component-schema registration block verbatim. Covers SC1/SC2/SC3/SC4 + isolation.
- [ ] `packages/backend/convex/llmRedaction.test.ts` — **exists**; add the media audit allow-list
      scan, the no-URL scan, and the pinned media audit-site count.
- [ ] `packages/contracts/src/skills/skillBodies.test.ts` — **exists**; add one `bodies[]` row per
      media skill + one "DELIBERATELY UNGATED" assertion (the `business-blueprint` block at `:66-70`).
- [ ] `packages/core/src/specialists.test.ts` — **exists**; extend four assertions, add the
      `diagnose()`-emits-no-`media` companion.
- [ ] `packages/backend/convex/traceParity.test.ts` — **exists, needs no edit**; it goes RED the
      moment the schema literal lands without its VERB entry. That is the point.
- [ ] The offline fal seam (`FAL_FIXTURE` env / `smoke::` prefix) — no new framework, one branch in
      `media.ts`, following the `llm.ts:922-924` `render=fail::` precedent. Leave a `ponytail:`
      comment naming the seam and its removal condition.
- [ ] Framework install: **none.** vitest + convex-test are already present and pinned.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| fal's live queue accepts our submit body; our webhook URL is reachable from fal's egress; the actual billed amount matches the price table | MEDIA-01 / SC1 / SC5 | Offline tests cannot prove a third party's acceptance, its egress reaching us, or real billing. The 15.2 / 17.1-10 owner-run live-gate precedent applies. | Owner-run, budgeted **≈ $0.26**: one 480p×5s Wan 2.5 clip ($0.25) + one FLUX schnell image ($0.009). Record the observed fal dashboard delta against `sum(mediaJobs.actualCents)`. **That single observation IS D5's first reconciliation run** — the playbook must say so. |
| The media canvas renders correctly in the workspace right pane (storyboard tiles, live per-shot status, the four editor affordances) | MEDIA-01 / SC2 | DOM/visual behaviour; vitest does not prove a rendered pane. `pnpm --filter @pikar/web build` proves compilation only. | Owner UAT in the workspace: dispatch a media request, confirm the canvas spins up, a shot shows status before its asset exists, and prompt-edit / regenerate / reorder / delete each behave. Confirm a regenerate shows its cost estimate **before** spending. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] Backend typecheck delta is **exactly 0** against the 150 baseline
- [ ] `node scripts/check-playbooks.mjs` exits 0
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
