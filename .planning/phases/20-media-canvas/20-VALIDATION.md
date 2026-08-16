---
phase: 20
slug: media-canvas
status: partial
nyquist_compliant: false
wave_0_complete: true
created: 2026-08-01
updated: 2026-08-16
---

# Phase 20 — Validation Strategy

> Reconstructed from all 20 plans, every available summary, the provider decision, current
> implementation/tests, and the recorded live evidence. Phase 20 is deliberately not green: the
> supported paid media Run A has not been executed and no `20-VERIFICATION.md` exists.

## Evidence Boundary

- Plans 20-01 through 20-10 and 20-13 through 20-19 are implemented, summarized, and covered by
  offline behavioral tests. Their provider fixtures, budget rails, callback, render, captions,
  retention, reconciliation readers, and drift monitor are implementation evidence, not proof that
  the deployed fal/webhook/sandbox chain works.
- Plan 20-11 Tasks 1-3 landed in `1db8a03`. Task 4, the owner-approved governed Run A, is still
  pending; therefore Task 5 has no observations to write and `20-11-SUMMARY.md` correctly does not
  exist.
- Plan 20-20 is complete within its stated boundary. The owner ratified cloud-dev
  `cockpit-agent v1` / run `107ee875` as the finance-bearing predecessor. Its summary explicitly
  records that this did not imply production activation.
- Plan 20-12 is complete. The same certified body is active on local dev (`cockpit-agent@24`, run
  `62903ef6`, 38/38) and production (`cockpit-agent@5`, run `7d3b852e`, 38/38); the owner separately
  authorized both activations and approved the later production no-spend observation. This is
  historical live/manual evidence, not an offline-green row from this audit.
- LongCat, a 30-second block, and the fps-divisor probe remain explicitly unsupported/deferred.
  They are not Phase 20 failures and must not be simulated with direct provider calls.

## Test Infrastructure

| Property | Current contract |
|---|---|
| Framework | Vitest 3.2.7 + `convex-test` |
| Offline seams | `FAL_FIXTURE`, `MEDIA_SANDBOX_FIXTURE`, pure `@pikar/core` and `@pikar/cost` contracts |
| Focused backend | `pnpm --filter @pikar/backend test -- convex/media.test.ts --maxWorkers=1` |
| Focused canvas | `pnpm --filter @pikar/web test -- "app/(app)/dashboard/workspace/mediaCanvas.test.ts" --maxWorkers=1` |
| Skill preflight | `node packages/backend/scripts/run-eval-golden.mjs --self-check` |
| Playbook gate | `node scripts/check-playbooks.mjs` |
| External exclusions | No fal call, no live catalog read, no sandbox allocation, no deploy/secret mutation, no skill seed/eval/activation |

Twenty phase-associated test/spec files currently cover storyboard/cost, action routing,
transactional media state, callback/auth/redaction, render/captions/retention, canvas state, and
browser smoke seams. The audit found no missing completed-scope behavioral assertion requiring a new
test file.

## Fresh Offline Audit — 2026-08-16

| Check | Result |
|---|---|
| `@pikar/cost` full suite | **61/61 passed** (including 34 media tests) |
| Backend `convex/media.test.ts` | **215 passed, 24 skipped**; exit 0; no provider or renderer secret was present |
| Web `mediaCanvas.test.ts` | **24/24 passed** |
| Core focused media files | **317 assertions observed passing** across storyboard (92), assembly (26), render (93), captions (31), specialists (59), and action type (16). The 75-test specialists/action run exited cleanly; the 242-test grouped run exhausted the Windows V8 worker after reporting all four files green, so it is environment evidence rather than a clean repository gate. |
| Golden evaluator self-check | **PASS** — 40 fixtures valid, 12 gated skills, all checks offline |
| Playbook watcher | **PASS** on final rerun. An earlier run returned `block` for another lane's then-dirty `smoke_assemble.sh`; its owner resolved that work before audit close, and the unchanged command then exited 0 with no output. |

Expected stderr from backend negative tests (`OPENAI_API_KEY` / `MEDIA_RENDER_SECRET` absent) proves
the no-live-call refusals; the suite still exited 0. The audit made no implementation or test change.

## Plan-Level Verification Map

| Plans | Requirement behavior | Automated evidence | Status |
|---|---|---|---|
| 20-01–20-04 | Storyboard/cost contracts, trace freeze, transactional caps/concurrency | core/cost suites; `media.test.ts`, `guardrails.test.ts`, `traceParity.test.ts`, `plans.test.ts` | ✅ offline covered |
| 20-05–20-06 | Exhaustive fal request bodies, async batch, authenticated callback, owned-byte landing, honest verdict/redaction | `media.test.ts`, `llmRedaction.test.ts` | ✅ offline covered |
| 20-07–20-10 | Governed external-action routing, specialist isolation, tenant-safe canvas read/write/editor state | action/specialist/dispatch/media/canvas tests; UI build evidence in summaries | ✅ offline covered; browser/provider behavior remains external |
| 20-13–20-17 | Safe assembly, TTS/STT, sandbox request/sidecar, automatic render, captions, retention | assembly/render/captions plus backend media and render-script tests | ✅ offline covered; real sandbox/provider formats remain external |
| 20-18–20-19 | Spend/job readers and non-vacuous scheduled catalog drift detection | `media.test.ts`, fixture/static workflow checks; historical three-outcome live monitor evidence | ✅ offline covered; live vendor drift is scheduled external monitoring |
| 20-20 | Finance predecessor identity and owner ratification | self-check/contracts evidence plus `20-20-SUMMARY.md` | ⚠ externally evidenced complete, not audit-green |
| 20-12 | Media body fixture, complete candidate gates, exact activations, no-spend conversation | self-check plus `20-12-SUMMARY.md` deployment-scoped evidence | ⚠ externally evidenced complete, not audit-green |
| 20-11 | Governed end-to-end paid Run A and observed reconciliation | offline cost/backend/core coverage is green; real provider/render observations absent | ⬜ Tasks 4–5 pending |

**Coverage:** 17/20 plan rows are implemented and offline-covered; 2/20 have complete explicit
external lifecycle evidence without being relabelled automated green; 1/20 is partial. Within the
partial plan, landed Tasks 1-3 are evidenced and Tasks 4-5 remain open.

## Success-Criteria Boundary

| Criterion | Offline evidence | Required external evidence |
|---|---|---|
| Provider/price/auth | Request-body exhaustiveness, price tables, HMAC/SSRF and catalog fixtures | fal accepts the shipped Wan/FLUX/TTS/STT bodies; public callbacks authenticate and land |
| Async state and budget | State transitions, idempotency, whole-job reserve, separate tenant/deployment rails | One Generate click reaches provider/webhook/render without hang and stays below owner maximum |
| Isolation/verdict/logs | Tenant-scoped queries, allow-list/redaction scans, `none_reported` behavior | Deployed rows/logs contain refs/counts only and real missing moderation is recorded honestly |
| Reconciliation/drift | Spend readers, half-open periods, actual/estimate handling, scheduled detector | Provider balance delta matches summed actual cents within one rounding cent |
| Renderer/sidecar/retention | Safe argv/script contracts, sidecar validator, success-delete/failure-keep tests | Real sandbox/ffmpeg/libass succeeds within its ceiling; final mp4/sidecar remain and intermediates are removed |
| Conversational surface | Body/mirror/fixture 38 and canvas state tests | Completed by Plan 20-12's recorded production no-spend observation |

## Manual / External Checkpoints

### Completed evidence, preserved without replay

- Plan 20-20: owner phrase `ratify cloud-dev finance predecessor`, cloud-dev v1 / run `107ee875`.
- Plan 20-12 local: `cockpit-agent@24`, run `62903ef6`, 38/38, owner phrase
  `activate media candidate 24`.
- Plan 20-12 production: `cockpit-agent@5`, run `7d3b852e`, 38/38 with no retries, owner phrase
  `activate media candidate 5`.
- Plan 20-12 conversation: owner verdict `i approve both cases worked`; proposal staged, Generate
  not clicked, and no new media job/spend observed.

These rows are complete historical external evidence. This audit did not query or mutate either
deployment and did not spend money.

### Precise remaining live checkpoint

Plan 20-11 Task 4 requires the owner to approve **exactly one governed Run A** and a hard maximum
(the plan's default request is `approved Run A, max $0.35`):

1. one Wan 2.5 `480p`, `5 s` clip;
2. one FLUX schnell image at the shipped default size;
3. narration for both blocks, captions STT, and one sandbox render;
4. one human Generate click, no regeneration and no direct fal call.

Before spending, an authorized operator must verify deployed secrets and unauthenticated 401s, then
record provider balance and the itemized estimate/reservation. After the run, record submit/webhook
states, actual cents per job, `none_reported` moderation where applicable, render wall-clock,
sidecar validity, refs-only scans, final retention, and provider balance delta. Any mismatch,
provider delta over one rounding cent, timeout, missing webhook, invalid sidecar, or owner cap breach
keeps the phase open; do not work around it inside the gate.

Only after those observations exist may Task 5 write matching reconciliation evidence to
`docs/playbooks/media.md`, create `20-11-SUMMARY.md`, update the matching manual rows here, run the
playbook/repository gates, and create the missing `20-VERIFICATION.md` through owner UAT. MEDIA-01
and Phase 20 remain pending until then.

## Validation Audit 2026-08-16

| Metric | Count |
|---|---|
| Plans audited | 20 |
| Offline-covered plan rows | 17 |
| Completed external lifecycle rows (not automated green) | 2 |
| Partial plan rows | 1 |
| Existing phase-associated test/spec files mapped | 20 |
| Genuine completed-scope automated gaps found | 0 |
| New tests required | 0 |
| Implementation bugs escalated | 0 |

## Validation Sign-Off

- [x] All completed offline scopes have behavioral test seams and commands.
- [x] Current focused cost, backend-media, canvas, and self-check commands passed offline.
- [x] Completed skill lifecycle evidence is deployment-scoped and not relabelled automated green.
- [x] Unsupported LongCat/30-second/fps claims remain deferred.
- [x] No provider, deploy, sandbox, registry mutation, or paid operation ran during this audit.
- [x] Playbook gate exits 0 after the foreign render-smoke lane resolved its worktree edit.
- [ ] Owner-approved governed Run A is observed and reconciled.
- [ ] `20-11-SUMMARY.md` and `20-VERIFICATION.md` exist with matching observed evidence.
- [ ] `nyquist_compliant: true` — deliberately false until the open external rows close.

**Approval:** partial — offline validation complete; paid provider/render reconciliation and final
owner verification remain open.
