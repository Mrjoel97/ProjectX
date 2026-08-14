---
phase: 20
slug: media-canvas
status: in_progress
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-01
revised: 2026-08-10
---

# Phase 20 — Validation Strategy

> Current validation contract after the 2026-08-10 closure-plan refresh. This supersedes the old
> `$0.75` Runs A+B+C gate and the two-task 20-12 map.

## Current evidence boundary

- Plans 20-01 through 20-10 and 20-13 through 20-19 are implemented with summaries. Their offline
  tests, fixture seams, budget rails, adapter, webhook, canvas, renderer, captions, retention and
  drift detection are landed evidence; do not replay them to close planning bookkeeping.
- 20-11 Tasks 1-3 landed in commit `1db8a03`: ADR-012, ADR-013, requirements/roadmap/todo corrections
  and four playbooks. They are **complete evidence**, not pending tasks. Only supported Run A and its
  evidence write remain.
- LongCat Runs B/C, the 30-second block and fps-divisor probe are **deferred, not failed and not
  silently simulated**. Current code has no LongCat price row/adapter arm and accepts only 5/10-second
  storyboard blocks. A direct fal call would bypass the governed path and cannot validate MEDIA-01.
- Finance-bearing source instructions landed but need their own live lifecycle. Plan 20-20 owns one
  separately authorized finance candidate/eval/activation cycle. Plan 20-12 then owns one separately
  authorized media body/fixture candidate cycle.

## Test infrastructure

| Property | Current contract |
|---|---|
| Framework | Vitest + convex-test, already pinned |
| Offline provider seams | `FAL_FIXTURE`, `MEDIA_SANDBOX_FIXTURE`, pure `@pikar/core`/`@pikar/cost` functions |
| Quick media gate | `pnpm --filter @pikar/cost test` · `pnpm --filter @pikar/core test` · targeted backend media tests |
| Repository gate | `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` |
| Typecheck invariant | Exit 0. The old remembered 150/15/13-error baselines are obsolete. |
| Skill fixture preflight | `node packages/backend/scripts/run-eval-golden.mjs --self-check` — $0, no live calls |
| Playbook gate | `node scripts/check-playbooks.mjs` |
| Offline cost | $0. Tests must not call fal, OpenAI or Vercel. |

`MEDIA_SANDBOX_FIXTURE` remains the default in tests. A test must never create a real sandbox: an
accidental allocation consumes quota and is not stronger evidence than the explicit owner live gate.

## Sampling cadence

- After an offline implementation task: run its targeted tests plus typecheck for touched packages.
- Before any live/paid checkpoint: run fixture self-check, relevant tests, playbook gate and
  `git diff --check`; show exact local/live fingerprints and cost ceiling.
- After each live mutation: read the exact row back. A successful command without readback is not
  activation evidence.
- Partial golden runs are diagnostic only. Only a complete candidate-pinned gate records evidence.

## Implemented-plan evidence map

| Plans | Evidence | Status |
|---|---|---|
| 20-01, 20-03 | Pure storyboard/cost core, media-director body/mirrors | ✅ summaries landed |
| 20-02, 20-04 | Schema/trace freeze and transactional whole-job budget rails | ✅ summaries landed |
| 20-05, 20-06 | fal adapter, authenticated webhook, byte landing and honest verdict | ✅ summaries landed |
| 20-07, 20-08 | Governed action/dispatch surfaces and structural no-paid specialist path | ✅ summaries landed |
| 20-09, 20-10 | Canvas backend/UI, estimates, editor invalidation and isolation | ✅ summaries landed |
| 20-13 through 20-17 | Assembly contract, voice, renderer, automatic assembly, captions, retention | ✅ summaries landed |
| 20-18, 20-19 | Reconciliation readers and scheduled catalog/endpoint drift detector | ✅ summaries landed |
| 20-11 Tasks 1-3 | ADR/document/playbook correction set | ✅ `1db8a03` |

## Remaining per-task validation map

| Task | Scope | Test/evidence | Cost/authority | Status |
|---|---|---|---|---|
| 11-T4 | Supported governed Run A only | Real proposal → one Wan 480p/5s + one FLUX image → voice/captions → webhook → sandbox render → retained reel | Owner approves deployment/live access and hard media maximum (default plan asks max $0.35) | ⬜ pending |
| 11-T5 | Run A reconciliation/summary/manual rows | `check-playbooks`, matching actual cents/provider delta/reservation/render/retention refs | $0 documentation after observation | ⬜ pending |
| 20-T1 | Finance gate decision | Local/live sha/version/candidate inventory + runner self-check | Owner names paid hard maximum | ⬜ pending |
| 20-T2 | Finance seed + complete eval | Exact candidate pin; fixture 37 `financeClaimCount: 1`; full case result/cost | Paid model gate, expected about $0.35 but governed by owner maximum | ⬜ pending |
| 20-T3 | Finance activation | Evidence pin reviewed, exact-version activation, active-row readback | Separate owner activation authority | ⬜ pending |
| 20-T4 | Finance evidence docs | `agent-runtime.md`, `skill-registry.md`, 20-20 summary, playbook gate | $0 | ⬜ pending |
| 12-T1 | Media body/mirror/fixture/playbooks | Contracts drift tests; fixture 38 `mediaDispatchCount`; runner self-check; agent-runtime/cockpit/skill-registry updated before pause | $0 offline | ⬜ pending |
| 12-T2 | Media gate decision | Body diff, predecessor active sha/version, empty stream, cost estimate | Owner names a second paid hard maximum | ⬜ pending |
| 12-T3 | Media seed + complete eval | Exact candidate pin; complete run includes finance fixture 37 and media fixture 38 | Separately paid model gate, expected about $0.35 + new case but governed by owner maximum | ⬜ pending |
| 12-T4 | Media activation | Exact-version owner authorization and active-row readback | Separate owner activation authority | ⬜ pending |
| 12-T5 | Later conversational observation | Ordinary video ask stages proposal; no Generate click; media provider spend remains $0 | Human observation, no fal spend | ⬜ pending |
| 12-T6 | Media evidence docs | Evidence-only playbook updates + 20-12 summary + playbook gate | $0 | ⬜ pending |

## Live and paid checkpoints

### Gate A — 20-11 supported media Run A

This is the **only fal/Vercel media-generation spend** remaining in Phase 20. It is not the only paid
activity overall because the two candidate gates below spend model budget.

Supported shape:

- one Wan 2.5 480p 5-second clip (`$0.25` modelled);
- one FLUX schnell image (`~$0.009` modelled);
- two narration takes, captions STT and one sandbox render (`~$0.03` modelled together);
- expected total about `$0.29`; no submit until owner names a hard maximum (plan default asks max
  `$0.35`); one Generate click, no regeneration.

Evidence required: pre/post provider balance, summed actual cents, reservation versus independently
floored lines, webhook status, render wall-clock, sidecar validity, `none_reported` moderation state,
refs-only scans and delete-on-success retention.

Explicitly not part of Gate A: LongCat comparison, 30-second narration/coherence, fps divisor. Those
require a future implemented adapter/price/storyboard plan before any honest live proof.

### Gate B — 20-20 finance candidate lifecycle

1. `$0` self-check and exact fingerprint inventory.
2. Owner approves a hard model-spend maximum.
3. Seed/read back candidate; complete candidate-pinned gate including fixture 37; record evidence.
4. Owner separately authorizes exact-version activation; read active row back.

This gate changes no body/runner/fixture source. It certifies the already-landed finance fingerprint
so the media edit is not bundled with an unevaluated instruction delta.

### Gate C — 20-12 media candidate lifecycle

1. Offline body/mirror/fixture 38 plus watched playbooks complete first.
2. Owner approves a separate hard model-spend maximum.
3. Seed/read back media candidate; complete run includes fixtures 37 and 38; record evidence.
4. Owner separately authorizes exact-version activation; read active row back.
5. At a later checkpoint, ordinary language stages a proposal with no Generate click and $0 fal
   media spend. Activation is not inferred from that conversation and the conversation is not folded
   into the activation checkpoint.

## Success-criteria validation map

| SC | Automated evidence | Remaining live evidence |
|---|---|---|
| SC1 provider/price/auth | Adapter exhaustiveness, exact request keys, fixture/catalog drift tests | Gate A accepts shipped bodies and reconciles actual cents |
| SC2 async state | Backend workflow/status tests and canvas UI/build | Gate A observes pending → webhook → render without synchronous hang |
| SC3 capped separate budget | Pure cost tests, transactional reserve/concurrency/isolation tests | Gate A records estimate/reservation/actual without exceeding approved maximum |
| SC4 refs/isolation/verdict | Backend isolation, allow-list and redaction scans | Gate A confirms deployed rows/logs contain refs/counts only |
| SC5 reconciliation/drift | Spend readers, catalog fixture and scheduled detector | Gate A is first supported-path real reconciliation |
| SC6 renderer/sidecar | Sandbox option/return/sidecar/failure-matrix tests | Gate A proves real sandbox/ffmpeg/sidecar inside time ceiling |
| SC7 retention | Success-delete/failure-keep and render-invalidation tests | Gate A observes intermediates removed only after final publish |
| Conversational surface | Fixture 38 exact dispatch count and body/mirror tests | Gate C later no-spend real conversation |

## Nyquist sign-off

- [x] Offline tests use fixtures/pure seams and cost $0.
- [x] Landed Tasks 1-3 of 20-11 are identified by commit rather than left pending.
- [x] Unsupported LongCat/30-second claims are explicitly deferred.
- [x] Finance and media paid evals have separate owner approvals and separate activation authorities.
- [x] Media activation and later conversational observation are distinct.
- [ ] Gate A observed and reconciled.
- [ ] Finance candidate gate/evidence/activation complete.
- [ ] Media candidate gate/evidence/activation complete.
- [ ] Later no-spend media conversation observed.
- [ ] Final playbook gate, repository gate and Phase 20 verification pass.

**Approval:** pending the open rows above.
