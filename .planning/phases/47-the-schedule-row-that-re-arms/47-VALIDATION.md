---
phase: 47
slug: the-schedule-row-that-re-arms
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-24
---

# Phase 47 — Validation Strategy

> The live DST and OAuth clocks are acceptance prerequisites, not tests that can be made green offline.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest, Node CLI gates, live Convex audit evidence |
| **Config file** | `packages/backend/vitest.config.mts` and existing scripts; Plan 47-16 requires a separate `packages/backend/candidate/recurrence/vitest.config.mts` |
| **Quick run command** | `(cd packages/backend; node node_modules/vitest/vitest.mjs run convex/dstProbe.test.ts convex/routineDecision.test.ts convex/routines.test.ts)` in PowerShell |
| **Full suite command** | Run backend package's direct Vitest entry point after focused failures are classified; backend typecheck separately |
| **Estimated runtime** | Measure during execution; no fixed latency asserted before a run |

## Sampling Rate

- **After every evidence task:** Run only the relevant focused offline check, then record a separate live result or refusal.
- **After each plan wave:** Run the current decision and stage gates plus strict planning/playbook checks. Only the ADR-050-isolated, disabled candidate wave is allowed; no product activation follows.
- **Before phase verification:** Re-run the current decision's three modes and inspect the cited live artifacts independently.
- **Live feedback:** Verify the production target before each read. Recheck each already-armed probe after its recorded transition; a pending or unreachable state is neither a failure of the scheduler nor a pass.

## Per-Task Verification Map

| Task | Requirement | Test Type | Automated Command | Live/Manual Requirement | Status |
|------|-------------|-----------|-------------------|-------------------------|--------|
| 47-10: verify production target and historical armings | ADR-046 D9 / ROUT-02 | collector self-check + read-only target proof | `node packages/backend/scripts/collect-recurrence-evidence.mjs --self-check` | Fresh deployment identity and bounded audit/scheduler read; four armed, zero fired, four pending; never re-arm. See `47-10-TARGET-CHECK.md` | ✅ target check complete; live DST open |
| 47-11: collect four DST traces | ADR-046 D9 / ROUT-02 | probe test + four live collector checkpoints | `(cd packages/backend; node node_modules/vitest/vitest.mjs run convex/dstProbe.test.ts)` | Distinct `--out` directories for fixed `dst-boundary.md`, paired audit rows, spring and fall-back human review | ⬜ pending |
| 47-12: review OAuth and provider read | ROUT-02 | negative collector self-check + live/semantic review | `node packages/backend/scripts/collect-recurrence-evidence.mjs --self-check` | `47-12-OAUTH-REVIEW.md` proves the offline refusal and names the no-routine semantic gap; real seven-day expiry, explicit reconnect, no burst and an owner-designated unattended count-only read remain unobserved | ◐ offline review complete; live/human pending |
| 47-13: review current gate and governing cycle | ROUT-02 | three parser modes + owner checkpoint | `node packages/backend/scripts/check-routine-gate.mjs --self-check` | `47-13-GATE-REVIEW.md` records 0/1/0, 14 findings and twelve semantic judgments; owner selected the non-exposure `build-for-evidence` path; `47-13-SUMMARY.md` closes this checkpoint, not ROUT-02 | ✅ governance choice recorded; recurrence deferred |
| 47-14: establish the intermediate governance gate | ROUT-02 | accepted ADR + distinct stage validator + adversarial three-state tests | `node packages/backend/scripts/check-routine-gate.mjs --self-check` and direct `routineDecision.test.ts`/`routines.test.ts`/`dstProbe.test.ts` | Owner accepted exact ADR-050; root reviewed checker/refusal evidence. Existing `defer` remains valid and `enable-safe` ineligible. No runtime, tenant activation, production deploy or send follows from stage pass. | ✅ accepted empty-inventory stage; no candidate yet |
| 47-15: review inventory and extend stage checker | ROUT-02 | exact six-path pre-build feasibility, closed checker and negative mutations | `node packages/backend/scripts/check-routine-gate.mjs --self-check`; direct `routineDecision.test.ts`; matrix/eligibility/defer/stage exits `0/1/0/0` | Root signed pre-build harness/isolation and post-transition checker/prose review; no candidate code was created in this plan | ✅ local technical review; guarded full Graphify refresh/Convex fixup later exited 0; GSD summary/commit pending |
| 47-16: build and review isolated synthetic candidate | ROUT-02 | separate edge-runtime config, discovered candidate test, typecheck and historical gates | `(cd packages/backend; node node_modules/vitest/vitest.mjs run --config candidate/recurrence/vitest.config.mts candidate/recurrence/model.test.ts)`; candidate/backend typechecks; existing guard tests; matrix/eligibility/defer/stage exits `0/1/0/0` | Root signed actual source/reachability and evidence-limit review in `47-16-TECHNICAL-REVIEW.md`. The later conditional ADR-051/052 D6 wording does not supply real limiter integration, DST/OAuth/provider evidence or a D6 pass; synthetic success cannot mark enable-safe | ✅ local technical review; all six candidate manifest entries match current files after successful graph/fixup; GSD summary/commit pending |
| 47-17: resolve D6 route | ROUT-02 | candidate test/typecheck and four separate governance exits | Explicit candidate runner; checker matrix/eligibility/defer/stage | Independent packet review and owner chose the narrow sweep-only drafting route, not D6 passage | ✅ decision route only |
| 47-18: draft narrow ADR-051 | ROUT-02 | candidate/typecheck and four governance exits | Explicit candidate runner; strict planning/diff | Independent draft review and exact-text owner acceptance; no code or release authority from drafting alone | ✅ exact draft accepted for later transition |
| 47-19: materialize ADR-051 | ROUT-02 | accepted-ADR identity negatives, checker self-check, focused backend tests and four exits | `node packages/backend/scripts/check-routine-gate.mjs --self-check`; focused `routineDecision.test.ts` | Independent governance/source review; historical defer and disabled stage remain valid | ✅ governance transition only |
| 47-20: strengthen disabled candidate | ROUT-02 | synthetic pause/admission/replay/rail tests, typechecks, four exits | Explicit candidate runner and backend guard/typecheck commands in `47-20-TECHNICAL-REVIEW.md` | Independent source/reachability review; real rail, production sweep and D6 evidence still missing | ✅ isolated design evidence only |
| 47-21: reconcile ADR-050 D6 wording | ROUT-02 | exact ADR-052 identity negative controls, checker self-check, focused backend tests, four exits | `node packages/backend/scripts/check-routine-gate.mjs --self-check`; focused tests in `47-21-TECHNICAL-REVIEW.md` | Separately accepted exact text and independent final review; stage frontmatter and operational defer unchanged | ✅ governance wording only |

## Wave 0 Requirements

Existing tests, collectors and gate cover offline infrastructure. No new fixture stands in for a live observation. The earlier 2026-09-24 `UNREACHABLE` production attempt did not prove that an armed job disappeared; Plan 47-10 restored verified read-only production access and found all four pending. The OAuth collector's prior access-token refresh criterion is insufficient for the decision record's seven-day reconnect semantics, so its fail-closed correction and negative test must be verified before any OAuth live call. The owner accepted ADR-050's separately reviewed `build-for-evidence` stage. Plan 47-14 established the empty-inventory gate; 47-15 reviewed and declared exactly six isolated candidate paths; 47-16 built and locally reviewed only those disabled files. Plans 47-17–21 accepted the conditional sweep-only D6 governance route and strengthened the isolated candidate, but they did not implement a production sweep or pass D6. ADR-051 conditionally replaces per-routine pending-function cancellation only when the no-pending-callback invariant is proven; ADR-052 reconciles ADR-050's candidate wording without declaring that proof complete. The 2026-09-25 guarded full Graphify refresh and post-refresh Convex edge fixup exited 0; 47-15/16 GSD bookkeeping and all live/integration evidence remain open. Historical operational `defer` still forbids tenant/production recurrence.

**Focused baseline, 2026-09-24:** Direct Vitest passed `dstProbe.test.ts` 7/7 and `routineDecision.test.ts` 83/83. The closed `routines.test.ts` inventory initially failed 4/9 on nine new modules, a `tenantOrders` timer and the web-form-retention cron. Those additions were reviewed for recurrence semantics, pinned, and the file then passed 9/9; concurrent order/form tests passed 12/12 and 8/8. Backend typecheck passed. The actual decision gate returned `--matrix` 0, `--eligibility` 1 (14 findings, including the obsolete `provider-read` citation), and `--validate-decision` 0. The inventory repair is not evidence that the live recurrence gate opened. The `pnpm exec vitest` shim fails in this Windows shell, hence the direct Node invocation above.

**2026-09-25 current offline recheck:** The isolated edge-runtime candidate suite passed 25/25. The checker self-check passed 32/32; matrix/eligibility/defer/stage exits remained **0/1/0/0**, with the eligibility refusal naming 14 unsatisfied findings. This is synthetic design and governance evidence only. It does not satisfy D6's live/integration requirements, the four future DST audit pairs, OAuth reconnect, provider read, owner acceptance or tenant activation.

## Manual-Only Verifications

| Behavior | Why Manual | Test Instructions |
|----------|------------|-------------------|
| Convex job truly fires across DST | A unit test cannot advance a production scheduler across a real transition | Inspect the two same-correlation audit rows, fired instant, wall time, offsets and independent collector result. |
| OAuth expiry and explicit reconnect | Requires a real grant and elapsed provider clock | Inspect refs-only token-state transition and reauth record; verify no catch-up burst and no secret/body in artifact. |
| Evidence relevance and owner decision | The parser proves file shape/identity, not semantic truth | Read each cited trace; accept `enable-safe` only if every matrix row really passes. |
| Governance ordering | D1–D8 rows require implementation/tests while `defer` prohibits operational implementation | ADR-050 permits only the isolated six-file candidate; ADR-051/052 conditionally specify sweep-only D6 evidence, not a pass. Review actual production source and all required live artifacts before any later enable-safe decision. |
| Intermediate-stage boundary | A structural parser cannot judge whether a candidate is unreachable from tenant/public paths | Review exact stage artifact, checker diff and negative mutations in 47-15, then actual source/reachability after 47-16 candidate build. |

## Validation Sign-Off

- [x] Plans 47-10 through 47-21 each map to an automated check or explicit live/manual acceptance item; 47-15/16 have local technical reviews but still lack GSD completion summaries/commits.
- [x] Every task, including each human checkpoint, has an automated preflight alongside its separate live/manual acceptance; no three consecutive tasks lack offline feedback.
- [x] Current `defer` decision validates, and the closed-inventory drift was reviewed and resolved on its own merits; this does not change live eligibility.
- [x] `nyquist_compliant: true` reflects the plan/check mapping, not completed live evidence or Phase 47 acceptance.

**Approval:** pending
