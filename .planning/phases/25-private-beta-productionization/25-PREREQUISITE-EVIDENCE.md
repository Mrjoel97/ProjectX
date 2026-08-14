# Phase 25 prerequisite evidence

## Gate status

- **Original audit point:** `aa5445bd9b7288b47f12b7c75607f064fee7be37` on 2026-08-10.
- **Re-audit point:** `d274281` on 2026-08-14, after **141 commits** landed on `feature/cash-business-finance`.
- **Task 1 result:** **STILL BLOCKED — not eligible for owner approval.** Five rows cleared since the
  original audit; ten remain open across implementation, live-UAT, and baseline-stability gates.
- **Evidence rule (unchanged):** a ROADMAP checkbox, plan count, or later narrative does not override a
  SUMMARY/VERIFICATION/UAT artifact that remains open. Completion requires final code plus reconciled
  phase evidence at one auditable commit.
- **Execution boundary:** no Phase 25 application code has been changed. Task 2 inventories, graph
  refresh, test/typecheck qualification, downstream plan reconciliation, and Plan 01+ remain prohibited.
- **What this re-audit changed:** rows only. The 2026-08-14 pass reconciled `REQUIREMENTS.md`
  (VALT-05…12 and VALT-14 to Complete from `15.3-VERIFICATION.md`'s per-requirement table) and
  `ROADMAP.md` (Phase 17 untick, Phase 20.2 registration). No product code, no plan execution.

## Method note — why a checkbox is never the evidence

Every row below is derived from two mechanical facts, never from prose: whether a `NN-PLAN.md` has a
matching `NN-SUMMARY.md`, and the `status:` frontmatter of the phase's VALIDATION/VERIFICATION file.
The 2026-08-10 pass found three phases whose ROADMAP rows disagreed with their own verifiers. The
2026-08-14 pass found a fourth class the checkbox scan cannot catch at all: **a phase with no roadmap
row whatsoever** (20.2), which no audit keyed on roadmap rows would ever have listed as missing.

## Prerequisite completion matrix

| Included lane | Current evidence inspected (2026-08-14) | Current finding | Gate |
| --- | --- | --- | --- |
| Phase 14 — Flagship Voice-Doc | `14-VALIDATION.md` is now `status: complete_with_open_observations`; REQUIREMENTS carries DOCV-01 Complete with the tool-declaration branch and retrieval latency recorded as unmeasured observations rather than blockers. | The bookkeeping inconsistency the original audit blocked on is reconciled. | **PASS — no remaining Phase 14 gate.** |
| Phase 15.3 — Vault folders / Drive import | `15.3-VERIFICATION.md` `human_needed`, 9/10. VALT-05…12 and VALT-14 reconciled to Complete on 2026-08-14 against that report's per-requirement evidence table. VALT-13 remains Pending. | Code is offline-green and 9 requirements are closed. No real Drive file has ever traversed `exportOne → landFile → fan-in → member ingest → digest`; this rail has spent $0. | **BLOCKED — owner live gates H1/H2/H3 ONLY. No code work outstanding; no implementation change is justified unless H1-H3 expose a failure.** |
| Phase 15.4 — Vault redesign / scoped browse | `15.4-VALIDATION.md` `complete`; `15.4-VERIFICATION.md` `passed`, 5/5; VALT-16 Complete. | Absent from the original matrix. Verified complete on inspection. | **PASS — no Phase 15.4 gate.** |
| Phase 16 — Research Sub-Agent | `16-VALIDATION.md` is now `status: complete`; REQUIREMENTS carries DISP-02 Complete (gate `14feb4b7` 34/34, re-confirmed `d17039a8`, `research-specialist@8` activated) and ACTN-03 Complete. | The stale SUMMARY/VALIDATION/DISP-02 baseline the original audit blocked on is reconciled. This matters because Phase 16 moved the shared active-skill baseline later lanes consume. | **PASS — no remaining Phase 16 gate.** |
| Phase 17 — Calendar actions | `17-VERIFICATION.md` `gaps_found`. Plans 17-06…17-11 (waves 2-7) have no SUMMARY. `calendarEvents.ts` and `microsoftCalendar.ts` do not exist on disk; the adapter exports only `freeBusy` and `createEvent`. The ROADMAP row was `[x]` against this verifier and was unticked 2026-08-14. | Worse than the original audit recorded. This is not only an open UAT — ACTN-02's "manage" and "Microsoft" clauses are both unimplemented. The verifier states the live gates "cannot make the missing provider and operations exist". | **BLOCKED — six unexecuted plans (17-06…17-11) AND owner UAT H1-H3.** |
| Phase 17.1 — Business Blueprint | `17.1-10-PLAN.md` still has no SUMMARY. Since the original audit, `a2d7a0b` recorded "gate recovery readiness" and `bc05eed` recorded **failed** L6 recovery evidence. | Not merely unclosed — a recovery attempt has been recorded as failed. The final live gate is further from closure than the original audit implied. | **BLOCKED — execute and close 17.1-10; the failed recovery must be diagnosed first.** |
| Phase 18 — Document & Content Creation | Plans 18-09 and 18-10 have no SUMMARY; `18-VALIDATION.md` `planned`; ACTN-04 Pending. Note 18-09 `depends_on` 18-10, so the two are strictly ordered. | Unchanged from the original audit. | **BLOCKED — complete 18-10, then 18-09.** |
| Phase 19 — Contacts, CRM & Follow-ups | `19-VERIFICATION.md` `passed`, 8/8, `human_verification: complete`, owner-attested inbox proof. ACTN-05 and PIPE-01 Complete. | Complete. The disclosed split-gate caveat (`086f8267` plus isolated `0b2b6b22`) remains an accepted risk, not an open gate. | **PASS — no remaining Phase 19 gate.** |
| Phase 19.1 — Bulk Contact Import (CSV) | `19.1-VERIFICATION.md` `passed`, **11/11**; 7/7 plans; browser UAT `pipeline-uat.spec.ts` 16/16 with `step 3b` uploading a real CSV, measured spend $0.0500; owner gate closed with the verbatim one-word verdict `approved`. All three items open at the gate were resolved 2026-08-11 (`5746523`, `921cc5d`). | The original audit's "not planned or executed" is now fully superseded. The contacts schema-union widening (`origin += imported`, `consentSource += imported-attested`) has landed and is verified, so the baseline Plan 25 must freeze is settled on this axis. | **PASS — no remaining Phase 19.1 gate.** |
| Phase 20 — Media Canvas | Plans 20-11 and 20-12 still have no SUMMARY; `20-VALIDATION.md` `in_progress`; the owner-run fal/sandbox/media-canvas gate is unpaid. Since the original audit the generation stack was **migrated to Wan and OpenAI** (`eb9e2c3`, `5c06b33`) and permissions/routing were repaired (`a9519d1`). | The vendor/live render gate and the shared-skill 20-12 checkpoint are still open, and the provider substrate underneath them changed after the original audit — the unpaid gate would now be qualifying different code than when it was specified. | **BLOCKED — 20-11, 20-12, the paid vendor/render/UAT gate, and final phase verification.** |
| Phase 20.1 — Drive in the Cockpit | `20.1-01-SUMMARY.md` now exists. `20.1-02-PLAN.md` has no SUMMARY and `depends_on: ["20.1-01", "20-12"]`. VALT-15 Pending. | Partially cleared. The remaining plan is chained behind Phase 20's shared cockpit-skill gate and cannot start independently. | **BLOCKED — 20.1-02, gated on 20-12.** |
| Phase 20.2 — Scene Timeline Reels | **NEW ROW — this lane did not exist at the original audit.** `20.2-PLAN.md` is `status: proposed` and carries the entire phase in ONE document with no per-plan SUMMARY files. Six commits have landed (`cca3820` 20.2-01 → `d274281` 20.2-06). Registered in the ROADMAP on 2026-08-14. | A phase serving MEDIA-01 was authored, planned and part-executed while appearing in no ROADMAP, REQUIREMENTS or STATE row. It supersedes the uniform BLOCK DECK contract (`storyboard.ts`, D8) that Phase 20's shipped code is built on. **Its single-document form means plan-level completion cannot be audited the way every other phase is.** | **BLOCKED — in flight, and unauditable by the standard evidence rule until it carries per-plan or per-wave summaries.** |
| Phase 21 — User-Authored Skills & Routines | Six plans on disk; 21-01…21-05 have SUMMARYs; **21-06 and 21-07 do not**. `21-VALIDATION.md` `draft`. SKILL-01 Pending. | The original audit's "not started / no planning directory" is superseded — the lane is 5/7 done. | **BLOCKED — 21-06, then 21-07 (live result).** |
| Phase 22 — Owner Authorization Primitive | `22-VERIFICATION.md` `human_needed`, 4/5. Server boundary proven live with two identities; only the `/ops` owner-vs-non-owner DOM observation and the mount-guard mutation remain. GOVN-01 Pending. | Unchanged — but note the closure is **already scheduled inside Phase 25 itself**: `25-02`'s objective is to expose the admission boundary "while closing Phase 22's outstanding owner/non-owner DOM residue". | **BLOCKED, but NOT independently — this closes as part of 25-02 and needs no separate pass.** |
| Phase 22.1 — Beta Admission Readiness | `22.1-03-PLAN.md` (the deployment/typecheck/CI gate, SC3) has no SUMMARY. GOVN-03 Pending. **However `.github/workflows/ci.yml` and `.github/workflows/deploy-production.yml` now exist**, landed via PRs #1-#10 on the `release-pipeline-activation-20260812` branch (`6aa1736`, `30a7e4a`, `be8c95f`, `7fb2f44`). | SC3's substance was partly delivered **outside its own plan and with no phase bookkeeping**. 22.1-03 must now reconcile against CI that already exists rather than build it from nothing. | **BLOCKED — execute 22.1-03 against the landed CI, not against a green field.** |
| Phase 23 — Agent-Authored Skills | Nine plans now on disk (23-01…23-09); **zero SUMMARYs**. `23-VALIDATION.md` `ready`. SKILL-02 Pending. | The original audit's "no planning directory" is superseded — the lane is planned and validated-ready, but entirely unexecuted. Five plans are `autonomous: true`. | **BLOCKED — largest single unexecuted block in the milestone (9 plans).** |
| Phase 24 — ISO 9001 Conformance Map | `24-01-SUMMARY.md` exists; `24-02-PLAN.md` (`autonomous: false`, GOVN-02) has no SUMMARY. `24-VALIDATION.md` `draft`. | The original audit's "not started" is superseded — one plan remains. | **BLOCKED — 24-02.** |
| Phase 26 — Connected Product Pages / Command Center | 26-01…26-09 have SUMMARYs; **26-10…26-17, 26-19 and 26-20 do not**. 26-18 has a SUMMARY and the Sales Pipeline nav was activated (`d0c2ffb`). All Phase 26 requirements remain Pending. | Partially cleared — the Phase-19-dependent nav gate (26-18) is done. Ten plans remain: source pages, authenticated integration gates, and Command Center. | **BLOCKED — 10 unexecuted plans.** |
| Phase 31 — Marketing Surface & Funnel v0 | Eight plans now on disk (31-00…31-07); **zero SUMMARYs**. `31-VALIDATION.md` exists. MKTG-01…03 Pending. | The original audit's "no planning directory" is superseded — planned, unexecuted. Pulled pre-beta by owner override under ADR-015, not by a Validated line. | **BLOCKED — 8 unexecuted plans.** |

## Cross-phase conflict found 2026-08-14 — Microsoft OAuth is specified twice

**Not a stale row. A live collision between two unexecuted plans, neither of which references the other.**

| | Phase 17-06 (`autonomous: true`) | Phase 25-06 (`autonomous: false`) |
| --- | --- | --- |
| Scope requested | `offline_access Calendars.ReadWrite` | `offline_access Mail.Send Mail.Read` plus identity scopes |
| Auth module | **creates** `microsoftCalendarAuth.ts` (new, parallel) | **extends** `gmailAuth.ts` into the two-provider mail module |
| Callback | adds `/microsoft-calendar/callback` to `http.ts` | adds its Microsoft callback to `http.ts` |
| Consent surface | new `/connect-microsoft` page | extends `connect-gmail/page.tsx` |
| Reconnect UI | "generalize `ReconnectBanner` by provider" | also modifies `ReconnectBanner.tsx` |
| Token row | new Microsoft token row, explicitly "do not rename `gmailTokens`" | 25-05 migrates `gmailTokens`; 25-07 then narrows the provider schema |

**Three files are claimed by both:** `packages/backend/convex/http.ts`,
`apps/web/app/(app)/_components/ReconnectBanner.tsx`, `docs/playbooks/cockpit.md`.

**Consequence if both ship as written:** a beta user connects one Microsoft account through **two**
consent screens into **two** token rows with **two** disconnect controls, and 25-07 ("narrow the
provider schema and fallbacks") reconciles a schema 17-06 widened without its knowledge. The two
scope sets are also incrementally consentable in one grant on the Microsoft v2 `common` endpoint,
so the second consent screen buys nothing.

**This must be decided before 17-06 is executed** — 17-06 is otherwise the only pure-code plan
runnable without an owner checkpoint or a live stack, and building it as written produces ~400 lines
that 25-06 must then unwind. Recorded here rather than resolved: the choice spans two phases and two
requirements (ACTN-02, DLVR-02) and is the owner's.

## Explicit non-prerequisite

| Lane | Evidence | Decision |
| --- | --- | --- |
| Phase 32 — Channel connection, publishing and metrics | ADR-015 and ROADMAP identify tranche B as blocked on a legal entity that has not started. `9a74e59` explicitly defers the legal formation gate. | **EXCLUDED from Phase 25's critical path.** Neither complete nor required for Task 1 approval. |

## Shared-worktree and baseline evidence

`git status --short` at `d274281` reports **24 tracked modifications and 35 untracked paths**, including
active edits to `packages/backend/convex/media.ts`, `render/renderReel.ts`, `schema.ts`, `vault.ts`,
`vaultDrive.ts`, `apps/web/.../MediaCanvas.tsx` and four playbooks. Untracked paths include
`.playwright-cli/`, `.tmp/` and `output/`.

**The baseline is materially less stable than at the original audit, not more.** Between `aa5445b` and
`d274281`:

1. A **finance/cash lane** merged (the working branch is `feature/cash-business-finance`; `convex/cash.ts`
   previously produced the only two `pnpm typecheck` errors on record).
2. The **media generation stack migrated to Wan and OpenAI** — under the requirement Phase 20's unpaid
   vendor gate is meant to qualify.
3. A **production release pipeline and `deploy-production.yml`** landed through ten PRs — territory
   Plans 25-10 and 25-11 own.
4. **Phase 20.2 began rewriting the storyboard/scene contract** that Phase 20's shipped code depends on.
5. `plans.ts` moved from dirty to committed by a concurrent lane mid-session, confirming that lanes
   continue to share one working tree. **Never `git add -A` here.**

Task 2 cannot start before Task 1 approval, and Task 1 cannot be approved while the rows above remain open.

## Exact blockers before owner approval

Ordered by dependency, with owner-only gates marked. **Total unexecuted plans: 39 inside phases 17-25,
plus 18 in the two out-of-range lanes Phase 25 names as its own prerequisites (26, 31).**

1. **20-11 → 20-12 → 20.1-02** — the shared `cockpit-agent` skill chain. One gated skill with one
   candidate stream, so these are strictly serial and they block two phases at once. Highest leverage.
2. **22.1-03** — the CI/typecheck/deployment gate, reconciled against the CI that already landed.
3. **17-06 → 17-11** — calendar management ops, then the Microsoft adapter. Required for ACTN-02;
   the live gates cannot substitute.
4. **18-10 → 18-09** — required for ACTN-04.
5. **17.1-10** — diagnose the recorded failed L6 recovery first *(owner live gate)*.
6. **21-06 → 21-07** *(21-07 owner live result)*.
7. **24-02**, then **Phase 23** (9 plans), then **Phase 31** (8 plans).
8. **Phase 26** — 10 plans: source pages, authenticated gates, Command Center.
9. **Owner live gates, queued and unscheduled:** 15.3 H1/H2/H3 (populated Drive folder + real Shared
   Drive), 17 H1/H2/H3 (real Google consent + live create), 20 fal.ai render gate *(spends money)*.
   Phase 22's `/ops` DOM residue is **not** on this list — 25-02 owns it.
10. **Phase 20.2** must either land per-plan summaries or be explicitly exempted, or MEDIA-01 closes on
    evidence that cannot be audited by this document's own rule.
11. After all lanes land, reach a quiescent worktree and re-inventory the merged finance, media-provider,
    scene-contract, 17.1, schema, skill, CI/deploy and delivery baselines before Task 2 can claim a stable SHA.

**Approval state: not eligible for review. Do not type `approved`.**

---
*Original audit: 2026-08-10 at `aa5445b`. Re-audited 2026-08-14 at `d274281` — 5 rows cleared
(14, 15.4, 16, 19.1, and partially 20.1/21/23/24/26/31 from "not started" to "planned, unexecuted"),
1 row worsened (17.1, failed recovery evidence), 1 row added (20.2), 1 row reclassified as
non-independent (22, absorbed by 25-02).*
