---
phase: 20
slug: media-canvas
status: planned
nyquist_compliant: true
wave_0_complete: false  # 20-01, 20-04 and 20-13 create the missing test files
created: 2026-08-01
revised: 2026-08-01   # finished-reel re-scope: 12 plans -> 17 plans, 9 waves -> 14 waves
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `20-RESEARCH.md` § *Validation Architecture* and `20-RESEARCH-DELTA.md` §
> *Validation Architecture (delta)*. The per-task map below is filled by the planner; everything
> above it is settled.

**REVISED 2026-08-01 for the finished-reel re-scope.** The offline discipline is UNCHANGED and
absolute: **every automated row costs $0, and no test may call fal, OpenAI or Vercel.** What changed
is that there are now **three** offline seams instead of one (`FAL_FIXTURE`, `MEDIA_SANDBOX_FIXTURE`,
and the `@pikar/core` pure layer), and the single live gate is more expensive and proves more.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.2.7 + `convex-test` 0.0.54 (in-memory Convex functions) — both already installed and pinned. **No new framework.** |
| **Config file** | `packages/backend/vitest.config.ts` — `environment: "edge-runtime"`, `include: ["convex/**/*.test.ts"]`, `testTimeout: 20_000`, **no watch mode ever** |
| **Env pragma** | a test that reads repo files off disk needs `// @vitest-environment node` on line 1 (`traceParity.test.ts:1`, `research.test.ts:1`) — `edge-runtime` has no `node:fs` |
| **Quick run command** | `pnpm --filter @pikar/cost test` · `pnpm --filter @pikar/core test` · `pnpm --filter @pikar/backend test -- media` |
| **Full suite command** | `pnpm test` (turbo, all packages) |
| **Estimated runtime** | ~30 s quick · full suite per repo norm |
| **Typecheck** | `pnpm typecheck` — backend baseline is **exactly 150 errors, all in test files, ZERO non-test**. Any delta is a regression. |
| **Web build** | `pnpm --filter @pikar/web build` — required for any wave touching `cards.tsx` **or `apps/web/app/api/`** (vitest proves neither) |
| **Playbook gate** | `node scripts/check-playbooks.mjs` must exit 0 |
| **New runtime dependency** | exactly one: **`@vercel/sandbox` in `apps/web`** (1.4 MB unpacked, zero native deps). NOT in `packages/backend` — D11 puts the runner in the web app. |
| **Cost of the whole suite** | **$0.** No test in this phase may call fal, OpenAI or Vercel. |

### The three offline seams

| Seam | Set by | What it short-circuits | Precedent |
|---|---|---|---|
| `FAL_FIXTURE` | every backend test run | `submitLine` returns a synthetic `request_id` and issues zero fetches — covers clips, voice AND transcript | `llm.ts:922-924` (`render=fail::`) |
| **`MEDIA_SANDBOX_FIXTURE`** | every backend test run | `renderReel` never reaches the route handler; returns a committed ~2 KB `ftyp` stub MP4 + a fixture sidecar, exercising **every line after the sandbox** | same |
| the `@pikar/core` pure layer | always | `parseBlockDeck`, `parseAssemblySidecar`, `buildSandboxOptions`, `rebaseWords`/`toAss` are Convex-free and SDK-free, so the load-bearing rules are plain assertions | `packages/cost/src/cost.test.ts` |

> **`MEDIA_SANDBOX_FIXTURE` MUST be the DEFAULT in tests.** On the Hobby tier, exhausting the free
> Sandbox allotment **pauses creation for 30 days rather than charging** (delta pitfall 18). An
> accidental real `Sandbox.create` in a suite is a month-long outage, not a bill.

---

## Sampling Rate

- **After every task commit:** `pnpm --filter @pikar/cost test` + `pnpm --filter @pikar/core test` + `pnpm --filter @pikar/backend test -- media` (all < 30 s)
- **After every plan wave:** `pnpm test` + `pnpm typecheck` (backend delta **exactly 0** vs the 150 baseline) + `pnpm --filter @pikar/web build` if `cards.tsx` or `apps/web/app/api/` was touched + `node scripts/check-playbooks.mjs` exit 0
- **Before `/gsd:verify-work`:** full suite green, then the owner-run live gate below
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | SC | Test Type | Automated Command | File Exists | Status |
|---------|------|------|----|-----------|-------------------|-------------|--------|
| 01-T1 | 20-01 | 1 | SC5 | playbook gate | `node scripts/check-playbooks.mjs` | ❌ create | ⬜ pending |
| 01-T2 | 20-01 | 1 | SC3 | pure unit, $0 | `pnpm --filter @pikar/core test -- storyboard` | ❌ create | ⬜ pending |
| 01-T3 | 20-01 | 1 | SC3, SC5 | pure unit + static scan | `pnpm --filter @pikar/cost test` | ❌ create | ⬜ pending |
| 02-T1 | 20-02 | 2 | SC4 | schema | `pnpm --filter @pikar/backend test -- schema` | ✅ exists | ⬜ pending |
| 02-T2 | 20-02 | 2 | Surface | static scan | `pnpm --filter @pikar/backend test -- traceParity` | ✅ exists (goes RED until both land) | ⬜ pending |
| 02-T3 | 20-02 | 2 | SC4 | unit | `pnpm --filter @pikar/backend test -- plans` | ✅ exists | ⬜ pending |
| 13-T1 | 20-13 | 2 | SC6 | unit (sh↔ts drift + no-time-stretch scan) | `pnpm --filter @pikar/backend test -- assembleScript` | ❌ Wave 0 | ⬜ pending |
| 13-T2 | 20-13 | 2 | SC6 | pure unit, $0 | `pnpm --filter @pikar/core test -- assembly` | ❌ Wave 0 | ⬜ pending |
| 13-T3 | 20-13 | 2 | SC6 | static scan (RCE tripwire) | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ add case | ⬜ pending |
| 03-T1 | 20-03 | 3 | Surface | round trip | `pnpm --filter @pikar/core test -- storyboard` | ❌ extend | ⬜ pending |
| 03-T2 | 20-03 | 3 | Surface | unit (md↔ts drift + UNGATED) | `pnpm --filter @pikar/contracts test` | ✅ add rows | ⬜ pending |
| 03-T3 | 20-03 | 3 | Surface | round trip + narration ceiling | `pnpm --filter @pikar/core test -- storyboard` | ❌ extend | ⬜ pending |
| 04-T1 | 20-04 | 3 | SC3 | convex-test, $0 | `pnpm --filter @pikar/backend test -- guardrails` | ✅ exists | ⬜ pending |
| 04-T2 | 20-04 | 3 | SC3 | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 → created here | ⬜ pending |
| 04-T3 | 20-04 | 3 | SC3 | concurrency + 2 mutation checks | `pnpm --filter @pikar/backend test -- media` | ❌ created here | ⬜ pending |
| 05-T1 | 20-05 | 4 | SC1 | unit + tsc exhaustiveness, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 05-T2 | 20-05 | 4 | SC1, SC2 | unit + static scan | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 05-T3 | 20-05 | 4 | SC5 | playbook gate | `node scripts/check-playbooks.mjs` | ✅ exists | ⬜ pending |
| 06-T1 | 20-06 | 5 | SC1 | convex-test http, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 06-T2 | 20-06 | 5 | SC4 | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 06-T3 | 20-06 | 5 | SC2, SC4 | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ add cases | ⬜ pending |
| 07-T1 | 20-07 | 6 | SC3 | unit + typecheck delta | `pnpm --filter @pikar/core test -- actionType` | ✅ exists | ⬜ pending |
| 07-T2 | 20-07 | 6 | SC3 | convex-test, $0 | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ exists | ⬜ pending |
| 07-T3 | 20-07 | 6 | SC3 | regression, $0 | `pnpm --filter @pikar/backend test -- cockpitTools` | ✅ exists | ⬜ pending |
| 08-T1 | 20-08 | 7 | Surface | unit | `pnpm --filter @pikar/core test -- specialists` | ✅ extend | ⬜ pending |
| 08-T2 | 20-08 | 7 | SC3, Surface | unit + static scan | `pnpm --filter @pikar/core test -- specialists` | ✅ extend | ⬜ pending |
| 08-T3 | 20-08 | 7 | SC2 | convex-test, $0 | `pnpm --filter @pikar/backend test -- dispatch` | ✅ exists | ⬜ pending |
| 14-T1 | 20-14 | 7 | SC1, SC7 | unit (exact key set), $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 14-T2 | 20-14 | 7 | SC3, SC4 | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 15-T1 | 20-15 | 8 | SC6 | **MANUAL — blocking decision checkpoint** | manual (Vercel tier + maxDuration) | n/a | ⬜ pending |
| 15-T2 | 20-15 | 8 | SC6 | pure unit, $0 | `pnpm --filter @pikar/core test -- render` | ❌ Wave 0 | ⬜ pending |
| 15-T3 | 20-15 | 8 | SC4, SC6 | convex-test offline seam, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 15-T4 | 20-15 | 8 | SC4, SC6 | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ add cases | ⬜ pending |
| 09-T1 | 20-09 | 9 | SC2, SC4 | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 09-T2 | 20-09 | 9 | SC3 | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 09-T3 | 20-09 | 9 | SC4 | convex-test isolation, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 16-T1 | 20-16 | 10 | SC6 | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 16-T2 | 20-16 | 10 | SC6 | convex-test failure matrix, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 16-T3 | 20-16 | 10 | SC7 | convex-test + static scan, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending |
| 10-T1 | 20-10 | 11 | SC2 | web build | `pnpm --filter @pikar/web build` | n/a | ⬜ pending |
| 10-T2 | 20-10 | 11 | SC2, SC4, SC6 | web build + static scan | `pnpm --filter @pikar/web build` | n/a | ⬜ pending |
| 10-T3 | 20-10 | 11 | SC3 | web build | `pnpm --filter @pikar/web build` | n/a | ⬜ pending |
| 17-T1 | 20-17 | 12 | SC6 | pure unit, $0 | `pnpm --filter @pikar/core test -- captions` | ❌ Wave 0 | ⬜ pending · **CUTTABLE** |
| 17-T2 | 20-17 | 12 | SC1, SC4 | convex-test + static scan, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending · **CUTTABLE** |
| 17-T3 | 20-17 | 12 | SC6, SC7 | convex-test + web build, $0 | `pnpm --filter @pikar/backend test -- media` | ✅ exists | ⬜ pending · **CUTTABLE** |
| 11-T1 | 20-11 | 13 | SC1, SC5 | doc + playbook gate | `node scripts/check-playbooks.mjs` | ❌ create ADR-012 | ⬜ pending |
| 11-T2 | 20-11 | 13 | SC6 | doc + playbook gate | `node scripts/check-playbooks.mjs` | ❌ create ADR-013 | ⬜ pending |
| 11-T3 | 20-11 | 13 | SC5 | doc + playbook gate | `node scripts/check-playbooks.mjs` | ✅ exists | ⬜ pending |
| 11-T4 | 20-11 | 13 | SC1, SC5, SC6 | **MANUAL — owner live gate ≈$0.29** | manual (see Manual-Only table) | n/a | ⬜ pending |
| 12-T1 | 20-12 | 14 | Surface | **MANUAL — blocking decision checkpoint** | manual (Phase-16 stream check) | n/a | ⬜ pending |
| 12-T2 | 20-12 | 14 | Surface | unit (md↔ts drift) | `pnpm --filter @pikar/contracts test` | ✅ exists | ⬜ pending |

> Every row above is MEDIA-01. All 17 plans carry `requirements: [MEDIA-01]`.
> **Offline cost of every automated row: $0.** The only spend in this phase is 11-T4.
> **Sampling continuity:** no three consecutive tasks lack an automated verify. The three manual rows
> (15-T1, 11-T4, 12-T1) are each adjacent to automated ones.

### Success-Criteria → Test Map

**SC1–SC5 are the ROADMAP's. SC6 (the render) and SC7 (retention) are added by the re-scope.**

| SC | Behavior | Test type | Automated command | File exists? |
|----|----------|-----------|-------------------|--------------|
| **SC1** | the fal adapter builds a submit body whose every priced dimension is **exactly the priced spec** — for all four kinds — and adding a fifth kind is a COMPILE error | unit | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC1 | a media line item billed per GENERATED output duration or per COMPUTE second is `unknown_model`, **never a duration guess** | pure unit, $0 | `pnpm --filter @pikar/cost test` | ❌ Wave 0 |
| SC1 | the TTS body carries **no `speed`/`rate` key** — exact key-set equality, not substring absence | unit | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC1 | `FAL_KEY` unset → the adapter refuses **before** any fetch (fail-closed, the `requireEnv` idiom) | unit | same | ❌ Wave 0 |
| SC1 | the webhook rejects a bad/absent HMAC segment with 401 and writes **nothing** | unit (convex-test http) | same | ❌ Wave 0 |
| **SC2** | submit returns immediately; no path awaits completion; the canvas renders **two** per-block statuses before any asset exists | unit | same | ❌ Wave 0 |
| SC2 | the terminal-status writer set is exactly `{media.ts, mediaComplete.ts}`, with `succeeded` reachable ONLY from `mediaComplete.ts` | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ add cases |
| **SC3** | price table: known (model, unit) prices correctly; **unknown model → `unknown_model`**; **unknown resolution → `unknown_model`, never a tier fallback**; image megapixels round UP; **TTS thousands do NOT** | pure unit, $0 | `pnpm --filter @pikar/cost test` | ❌ Wave 0 |
| SC3 | **the cents floor is applied ONCE, on the batch total: a 6-line batch of $0.002 items reserves 1 cent, not 6** (D12a) | pure unit + convex-test, $0 | `pnpm --filter @pikar/cost test` + `… backend test -- media` | ❌ Wave 0 |
| SC3 | **the D10 numbers as data:** 6×480p+voice+stt+render = $3.05 ✅ · 6×720p ❌ refused · 12×480p ❌ refused · Veo-class ❌ refused | pure unit, $0 | `pnpm --filter @pikar/cost test` | ❌ Wave 0 |
| SC3 | **the whole JOB is the reserved unit:** ONE transaction inserts N video + N tts (+1 stt) rows; a refusal inserts **zero** | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC3 | **a 186-char narration is refused at storyboard parse AND at the reserve**, with a distinct reason and no money moved (delta pitfall 13) | pure unit + convex-test, $0 | `pnpm --filter @pikar/core test -- storyboard` + `… backend test -- media` | ❌ Wave 0 |
| SC3 | the voice line is reserved at exactly **2×** its character estimate | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC3 | `reserveJob` refuses on `mediaKillSwitch` **and** on the global `killSwitch`, independently | convex-test, $0 | same | ❌ Wave 0 |
| SC3 | **per-tenant window:** tenant A exhausting `mediaSpendCents` does not refuse tenant B (the 22.1-02 assertion, re-run for media) | convex-test, $0 | same | ❌ Wave 0 |
| SC3 | **rails are separate:** a media reserve does not move `dailySpendCents`; an LLM `recordSpend` does not move `mediaSpendCents` | convex-test, $0 | same | ❌ Wave 0 |
| SC3 | **plan-gated by construction:** no `SPECIALIST_TOOLS`/`RESEARCH_TOOLS` member reaches any of the four paid entry points | static scan | `pnpm --filter @pikar/core test -- specialists` | ✅ extend |
| **SC4** | asset bytes land in `_storage`; the row holds `assetStorageId` + `assetHash`; **no field anywhere holds a fal URL** | convex-test + static scan | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC4 | audit payload keys are exactly the allow-list; **no `url`/`href`/`http` substring**; no prompt text and **no narration text** | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ add cases |
| SC4 | verdict ∈ the four enum values; a video **or audio** response with no moderation field yields **`none_reported`**, never a clear/pass value | unit | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC4 | `actual == est` for `EXACT_SPEND_KINDS`; the window moves by **exactly 0** on a tts/stt landing | convex-test, $0 | same | ❌ Wave 0 |
| SC4 | **isolation:** tenant B gets `[]`/null from `byPlan`, `assetUrls` and `reel`; cannot regenerate or edit tenant A's block; the webhook writes only the row its digest resolves | convex-test, $0 | same | ❌ Wave 0 |
| SC4 | **nothing forbidden crosses into the sandbox:** no key, no fal URL, no `tenantId`, no `getUrl` result in the render request body | static scan + runtime assertion | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ add cases |
| **SC5** | the price table carries a `ponytail:` ceiling + upgrade path, **agrees with `media.fixtures.json`**, and `docs/playbooks/media.md` holds a runnable two-bullet reconciliation procedure | static scan + doc | `pnpm --filter @pikar/cost test` + `node scripts/check-playbooks.mjs` | ❌ Wave 0 |
| **SC6 (new)** | **`buildSandboxOptions` has `persistent: false`, `networkPolicy: "deny-all"`, NO `name`, and `timeout` < the route's maxDuration** — asserted as a plain object, no SDK (delta pitfall 14, 16) | pure unit, $0 | `pnpm --filter @pikar/core test -- render` | ❌ Wave 0 |
| SC6 | **`assembly.json` validator:** every field range-checked; `overrun: true` on any block ⇒ INVALID; a missing `speech_abs_s` ⇒ INVALID | pure unit, $0 | `pnpm --filter @pikar/core test -- assembly` | ❌ Wave 0 |
| SC6 | **an invalid sidecar publishes NOTHING** — `renderStorageId` is absent, not merely a failed status | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC6 | the seven-fixture failure matrix (null · empty · non-`ftyp` · oversize · malformed JSON · `overrun:true` · valid) each yields a **distinct** reason code | convex-test offline seam, $0 | same | ❌ Wave 0 |
| SC6 | the assemble script and its `.ts` mirror are byte-identical (LF-normalised); **no `assemble` entry in `skills.ts`'s seeds** (delta pitfall 17) | unit + static scan | `pnpm --filter @pikar/backend test -- assembleScript` + `… -- llmRedaction` | ❌ Wave 0 / ✅ add case |
| SC6 | **no `atempo` / `setpts` / `speed` / `rate` token anywhere in the media or render diff** (delta pitfall 15) | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ add case |
| SC6 | **`stderr()` appears only inside `reasonCodeFor`** (delta pitfall 19) | static scan | same | ✅ add case |
| SC6 | **zero occurrences of `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID` in the repo** (D11's headline property) | static scan | same | ✅ add case |
| SC6 | the render route 401s on a bad/absent/unset bearer with **zero sandbox creations** | convex-test + route unit, $0 | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| **SC7 (new)** | **retention:** a successful render DELETES the intermediate clip and voice blobs and nulls their fields; a FAILED render KEEPS them (D12b). **Both halves asserted.** | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| SC7 | `ctx.storage.delete` appears in exactly ONE place in the media subsystem | static scan | `pnpm --filter @pikar/backend test -- llmRedaction` | ✅ add case |
| SC7 | regenerating any block, reordering or deleting one **clears every render artifact field** in the same transaction | convex-test, $0 | `pnpm --filter @pikar/backend test -- media` | ❌ Wave 0 |
| **Surface** | `agentSteps.tool` and the `cards.tsx` VERB map agree **both ways** for `dispatchMedia` | static scan | `pnpm --filter @pikar/backend test -- traceParity` | ✅ exists — goes RED until both land |
| **Surface** | `SPECIALIST_ROUTES` exact array; media's grant is exactly `["searchVault"]`; every granted tool is taught in the body; **`diagnose()` emits no `"media"`** | unit | `pnpm --filter @pikar/core test -- specialists` | ✅ extend |
| **Surface** | every media `.md`/`.sh` body is byte-identical (LF-normalized) to its derived `.ts` constant; the media skill is **NOT** in `GATED_SKILLS` | unit | `pnpm --filter @pikar/contracts test` + `… backend test -- assembleScript` | ✅ add rows / ❌ Wave 0 |

---

## Wave 0 Requirements

- [ ] `packages/cost/src/media.ts` + `media.test.ts` + **`media.fixtures.json`** — four billing units,
      the D10 constants, the **once-only cents floor**, the vendor-provenance fixture and its
      agreement test. **`packages/cost/` is uncovered by `watch.json` — registering it is part of this item.**
- [ ] `packages/core/src/storyboard.ts` + `storyboard.test.ts` — the fixed-block contract and the
      **140-character narration ceiling** with its refusal.
- [ ] **`packages/core/src/assembly.ts` + `assembly.test.ts`** — the sidecar validator and its refusal,
      plus the committed fixture set under `packages/core/src/__fixtures__/assembly/` that plan 20-15
      reuses as its failure matrix.
- [ ] **`packages/core/src/render.ts` + `render.test.ts`** — `buildSandboxOptions`,
      `validateRenderReturn`, `reasonCodeFor`.
- [ ] **`packages/core/src/captions.ts` + `captions.test.ts`** — the `.ass` writer and the rebase.
      **CUTTABLE with plan 20-17.**
- [ ] **`packages/backend/convex/render/assemble_final.sh`** + its derived `.ts` mirror + the drift
      test + the no-time-stretch scan.
- [ ] **`packages/backend/convex/render/fixtures/`** — a ~2 KB `ftyp`-prefixed stub MP4 for the
      `MEDIA_SANDBOX_FIXTURE` seam.
- [ ] `packages/backend/convex/media.test.ts` — convex-test harness; copy `research.test.ts:1-40`'s
      component-schema registration block verbatim. Covers SC1/SC2/SC3/SC4/SC6/SC7 + isolation.
- [ ] `packages/backend/convex/llmRedaction.test.ts` — **exists**; add the media audit allow-list scan,
      the no-URL scan, the pinned audit-site count, the no-`assemble`-seed RCE tripwire, the
      nothing-forbidden-in scan, the `stderr`-only-in-`reasonCodeFor` scan, the repo-wide
      `VERCEL_TOKEN` scan, the single-`storage.delete`-site scan and the no-time-stretch scan.
- [ ] `packages/contracts/src/skills/skillBodies.test.ts` — **exists**; add the `media-director` row +
      the "DELIBERATELY UNGATED" assertion (the `business-blueprint` block at `:66-70`).
- [ ] `packages/core/src/specialists.test.ts` — **exists**; extend four assertions, add the
      `diagnose()`-emits-no-`media` companion and the `PAID_ENTRY_POINTS` no-path scan.
- [ ] `packages/backend/convex/traceParity.test.ts` — **exists, needs no edit**; it goes RED the moment
      the schema literal lands without its VERB entry. That is the point.
- [ ] The three offline seams (`FAL_FIXTURE`, `MEDIA_SANDBOX_FIXTURE`, the pure layer) — no new
      framework, one branch each, following the `llm.ts:922-924` `render=fail::` precedent. Leave a
      `ponytail:` comment naming each seam and its removal condition.
- [ ] `docs/playbooks/watch.json` — register `packages/cost/src/media.ts`,
      `packages/core/src/{storyboard,assembly,render,captions}.ts`,
      `packages/backend/convex/render/` and **`apps/web/app/api/media/`** under `media.md`, **in plan
      20-01 (Wave 1)**, or the creation gap blocks plans 20-13 and 20-15.
- [ ] Framework install: **none.** vitest + convex-test are present and pinned. One new runtime
      dependency: **`@vercel/sandbox`, in `apps/web`**.
- [ ] **`convex.json` is NOT needed.** The delta wanted it to pin Node 22 for `@vercel/sandbox` under
      the Convex bundler; **D11 removes the package from Convex entirely**, so the Node-runtime
      question and the pre-N3 connectivity spike are both moot. Recorded so nobody re-adds them.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| **The Vercel plan tier and the route's max duration fit a 60–150 s render; the Sandbox allotment fits ~60 renders/month** | MEDIA-01 / SC6 | A vendor account property. Under D11 the Vercel function's max duration is the BINDING ceiling (Hobby defaults to 60 s), and on Hobby an exhausted allotment is a 30-day OUTAGE rather than a bill. Neither is knowable from the repo. | Plan **20-15 Task 1**, blocking. Read the tier and the Functions max duration from the Vercel dashboard, record BOTH in `docs/playbooks/media.md`'s dependency section, and confirm `maxDuration − 30 s` exceeds the render you are willing to commit to. |
| fal's live queue accepts our **clip, voice AND transcript** submit bodies; our webhook URL is reachable from fal's egress; **a real sandbox boots from our snapshot, finds ffmpeg, and finishes inside the ceiling**; the harvested assembler writes a sidecar our validator ACCEPTS; the actual billed amount matches the price table | MEDIA-01 / SC1 / SC5 / SC6 | Offline tests cannot prove a third party's acceptance, its egress reaching us, a real microVM's image, or real billing. The 15.2 / 17.1-10 owner-run live-gate precedent applies. | Plan **20-11 Task 4**, owner-run, budgeted **≈ $0.29**: 2 × 480p × 5 s clips ($0.50) or 1 clip + 1 FLUX image, 2 TTS takes (~$0.002), 1 STT minute ($0.008), 1 real sandbox render (~$0.02). Record the fal dashboard delta against `sum(mediaJobs.actualCents)`, **the reserved cents vs the sum of floored line items** (D12a in production), the observed render wall-clock, and the retention outcome. **That single observation IS D5's first reconciliation run** — the playbook must say so. |
| The media canvas renders correctly in the workspace right pane — the reel region, block tiles with **two** status rows each, the itemised estimate, and the five editor affordances | MEDIA-01 / SC2 | DOM/visual behaviour; vitest does not prove a rendered pane. `pnpm --filter @pikar/web build` proves compilation only. | Owner UAT inside plan 20-11's gate: dispatch a media request, confirm the canvas spins up, a block shows clip AND voice status before either asset exists, the reel region moves to "Assembling…" **with no reload**, and prompt-edit / narration-edit (with the live 140 counter refusing 141) / regenerate / reorder / delete each behave. Confirm a regenerate shows its cost estimate **before** spending **and** that the reel region says the reel is out of date. |

---

## The cut line

**Plan 20-17 (captions) is CUTTABLE and is the phase's designated cut line** (delta §3.4). Cutting it
removes rows 17-T1..17-T3 and the `captions.ts` Wave 0 item, and removes ~$0.008 from the live gate.
It removes NOTHING from SC1–SC5 and only the caption-burn half of SC6. **Without it the phase still
ships D8's headline deliverable — one finished mp4 with voiceover — and nothing above it needs
re-work**, because the sidecar's `speech_abs_s` / `lead_silence_s` fields and the baked font ship
regardless. Cut it if the phase runs long or if the first live sandbox render needs more than one
image iteration.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] Backend typecheck delta is **exactly 0** against the 150 baseline
- [ ] `pnpm --filter @pikar/web build` green for waves 2, 11 and (if 20-17 ships) 12 — `cards.tsx` and `apps/web/app/api/`
- [ ] `node scripts/check-playbooks.mjs` exits 0
- [ ] **No test reaches `Sandbox.create`, `queue.fal.run` or an OpenAI endpoint** — the three seams are the default
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
</content>
