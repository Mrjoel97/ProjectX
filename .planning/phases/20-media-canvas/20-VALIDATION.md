---
phase: 20
slug: media-canvas
status: draft
nyquist_compliant: false
wave_0_complete: false
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

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | | | MEDIA-01 | | | | ⬜ pending |

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
