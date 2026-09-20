---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 03.7
current_plan: Wave 1A — 03.7-10 and 17.1-11 blocked before founder verification; 01-10 complete; 18-11 gated.
status: blocked
stopped_at: "The diagnostic corpus reached case 28: cases 1-23 PASS, case 24 failed semantic reply assertions, then case 28 stopped GOLDEN_PAID_CALL_UNRESOLVED. One separately authorized case-24 retry passed preflight but stopped on the same unresolved guard before verdict. Final ledgers settled at USD 0.16210262 + USD 0.00217592 without breach or unresolved calls; no further retry is authorized."
last_updated: "2026-09-20"
progress:
  total_phases: 76
  completed_phases: 56
  total_plans: 457
  completed_plans: 422
  percent: 92
---

# Project State

## Audit-governed GSD routing (2026-09-20)

**Current Phase:** 03.7 (Wave 1A integration lead; Phase 17.1 remains a parallel gated lane)
**Current Phase Name:** Wave 1A — Foundation truth and evidence debt
**Current Plan:** `03.7-10` and `17.1-11` blocked before founder verification; `01-10` complete; `18-11` gated
**Status:** blocked on case-24 semantics and recurring paid-call settlement observation
**Progress:** `01-10` completed repository-controlled Google OAuth readiness. A later diagnostic preflight passed, then exactly one unfiltered `--no-retry` corpus command ran under the USD 2.00 cap. Cases 1–23 printed PASS; case 24 made one reply call but failed because recipient and subject evidence were absent. The command continued and stopped at case 28 with `GOLDEN_PAID_CALL_UNRESOLVED`. Final reconciliation closed its 209-call ledger at exact USD `0.16210262`, with zero unsettled/unresolved calls and no breach. The founder separately authorized exactly one isolated case-24 retry under `c10fb34` cap support and a USD 0.10 envelope; its preflight passed, but it stopped on the same unresolved guard before a verdict. Its eight calls settled at exact USD `0.00217592`, again without breach or unresolved calls. No automatic or additional retry occurred. The result remains non-certifying and `accepted:false`; both founder gates stay blocked and `18-11` remains gated.

- **Governing reference:** [merged audit](audits/2026-09-10-merged-audit-codebase-review.md), including its G1–G26/H1–H5 reconciliation and owner-adopted Waves 0–8.
- **Execution order:** Phase 37.1 closed Wave 0 planning truth; Waves 1–8 now execute through ordinary GSD phases and plans with the dependencies and exit gates in the merged audit.
- **Immediate handoff:** `01-10` is complete without closing SC-5 or any deployed/live/owner/external layer. `03.7-10` and `17.1-11` remain open after the diagnostic run and one explicit isolated retry. Current briefing cases 16–18 did pass, but case-24 semantic evidence and the recurring settlement-observation guard keep the corpus non-certifying; neither final settled ledger retroactively supplies a runner verdict. No further retry/run authority exists. `18-11` cannot start before an accepted Blueprint baseline. Phase 23 remains preserved and resumes in Wave 4; its expired authorization is not reusable.
- **Founder acceptance contract:** every applicable technical plan must include a plain-language outcome, a browser path for a nontechnical founder, honest loading/empty/error/partial/refusal states, and captured browser evidence in addition to code-level tests.
- **Routing note:** native GSD helpers currently disagree because filename counts treat partial and auxiliary summaries as completion. Phase 37.1 owns that reconciliation; automatic “next phase” suggestions remain advisory until its checker changes pass.

### Roadmap Evolution

- Phase 37.1 inserted after Phase 37: Closure Programme Integration and Wave 0 Baseline (URGENT, owner-authorized 2026-09-19).

## Where the truth lives (Phase 37, 2026-09-06)

- **Phase index:** the progress table in `.planning/ROADMAP.md` — one row per `### Phase` heading, regenerated from the phase directories and checked by `scripts/check-planning.mjs` on every Stop.
- **Requirement truth:** `.planning/REQUIREMENTS.md` — a checkbox is ticked only when a closed phase's own SUMMARY/VERIFICATION certifies it; a row that shipped in code without live proof carries an `*(open: …)*` note instead.
- **Build order:** `.planning/design/system-audit-2026-09-03-merged.md` §5 "The merged order" (owner decisions in §6).
- **Per-phase record:** `.planning/phases/<phase>/` (RESEARCH → PLAN → SUMMARY, VERIFICATION where run).
- **History:** everything this file used to carry (36 stacked snapshots, lane tables from August, the Phase 14 historical position, the accumulated-context log) is in `.planning/archive/STATE-history-2026-09-06.md`, unchanged.

## Current Position

Last three closes, newest first:

| Phase | Closed | Head | What |
|---|---|---|---|
| 47 The schedule row that re-arms (IN PROGRESS) | — | this commit | G25's build blocked by its own gate (correctly); **ADR-044 T3 CLOSED** — §4 checked against ROWS and holding on production (672 + 9 rows, 0 violations); **T1 CLOSED** — the false “no personal data” claim narrowed and four prose copies collapsed onto one constant |
| 46 The autonomy / standing-approval ADR (Track C step 13, G25) | 2026-09-09 | this commit | **ADR-046** — a standing approval READS and PREPARES, never sends; a closed material-change list compared over structured values; skip-never-burst; one active run; `provider_refusal` terminal; pause cancels AND the callback re-reads after claiming; audit refs + a closed outcome class; whole-envelope reservation before the first paid call. D9 defines the `dst-boundary` live-evidence row instead of weakening the gate. No code |
| 45 The gates nobody ran, and a connector nobody could connect | 2026-09-09 | this commit | sixteen free `--self-test` gates now RUN in CI (nothing ever had); absence assertions need a positive control; every workflow moved to Node 24 after the new gate's first red proved CI had never used production's runtime; production data cleaned; QuickBooks NOT connected — Intuit cannot read the app record, proven against the app's own registered redirect URI |
| 44 Erasure actually erases (a live product-claim defect, not a build-guide step) | 2026-09-08 | this commit | erasure deletes the FILES, the RAG chunks and the chat threads, not just the rows; ADR-044 says the audit archive's “no personal data” claim does NOT hold and WORM stays off; ADR-045 severs the `betaInvites` bridge (cleared, not deleted — the invite stays spent) and gives `tenantExport` its files |
| 43 Batch content and the content queue (Track C step 11, **G10 closed**) | 2026-09-08 | `1f1f4c0` `[deploy]` | a content batch is a ROOT on `channel: vault` with up to MAX_FAN_OUT variant children under ONE approval; ADR-042 (a channel is a terminal, not an inherited default); Approve arms the timed children and PUBLISHES the untimed; `createVariants` is the door. FOUND: a gated skill withholds INSTRUCTIONS, never REACHABILITY |
| 42-03 the governed fan-out (Track C step 11, **G6 closed**) | 2026-09-07 | this commit | `dispatchTeam`: <=5 specialists, one approval, the envelope divided by a worker count the RAIL caps (ADR-038); children born `kind: "memo"`; the sweep resolves a dead worker instead of stranding the team |
| 42-02 durable specialist runs (Track C step 11, G6) | 2026-09-07 | `0dfe186` `[deploy]` | a dispatch is a journaled workflow with `{ retry: false }` on the paid step, a free idempotent `onDispatchComplete` landing, and a `dispatchLive` that asks the component instead of guessing |
| 42-01 the plan-row migration (Track C step 11, G6) | 2026-09-07 | `4e307bb` `[deploy]` | ADR-037 as code: `parentPlanId` + `by_parent`, newest-root reads via `lib/planRow.ts`, `plans.byId` under the whole Approvals plane, lifetime ceilings deleted and concurrency interlocks kept, `applyActOnGap` inserts a root per gap |
| 41 The plan-row ADR (Track C step 11, G6/G10) | 2026-09-07 | `1e2e3a1` `[deploy]` | ADR-037 accepted — a root is an artifact, a child is a worker. No code |
| 40 Document Canvas (Track C step 11, G5, DOC-01) | 2026-09-06 | `b82c345` `[deploy]` | inline PDF in the Output card, `vaultSheets` grid at ingest + `SheetGrid`, `.xlsx` on both planes from `spreadsheet-drafter@1`, ADR-036; cockpit-agent v3 = candidate v28, gate 45/46, NOT activated |
| 39 Research engine (Track C step 11, G4, RSCH-01) | 2026-09-06 | `4b8fe5b` `[deploy]` | `readPage` bounded to the run's own search results, page-read/snippet-only labels, shared staleness window, honest footer, research-specialist v4 gated 46/46 and active locally |
| 38 Tool registry (Track C step 10) | 2026-09-06 | `23351ff` `[deploy]` | `buildCockpitTools(ToolContext, ToolGrants)`, `grantsFor` in core, shared validator at both doors, 23-class snapshot held, tenant pin now reaches dispatched specialists |

Current owner priority: the Phase 23 native sign-out/sign-in race is repaired in `410aec9`, and failure diagnostics now scrub the password field in `40a6553`. The 2026-09-14 production reconciliation matched the exact authorization envelope and proved $0 spend, zero calls/turns, zero unsettled reservations, no breach and no candidate; the expired one-shot authorization cannot be reused, so the next authoring probe needs fresh bounded approval. Phase 30's exact-byte review console and research Stage 3's same-row PDF dependency shipped at `07350fc` after CI `34826131926` and production deployment `34826722003`; authenticated live evidence remains open. Phase 31 is complete on production `4df076db`; its direct-context acceptance method and cleanup limits are in `31-VERIFICATION.md`. Recurrence remains deferred until real DST/OAuth evidence passes; do not build its table first. The Sep 12 Intuit app check redirected to sign-in, so renewed provider diagnosis first needs authentication; that check does not reconfirm the older app-record failure.

**LIVE ACCEPTANCE STILL OPEN.** Phase 44 and the updated merged-audit G19 row record successful production activations; the former claim that fixture 33 blocks every activation was stale. New candidates still require fresh exact-version evidence. QuickBooks remains unconnected; Phase 45 records an app-record failure, while the latest developer-app check needs Intuit sign-in before renewed diagnosis. WORM remains OFF under ADR-044; recurrence remains deferred pending real DST and OAuth expiry/reauth traces. Phase 24 semantic review, Phase 23 real author/eval/activation/rollback, current-provider media proof and Phase 25 self-service release qualification remain open. See the 2026-09-12 acceptance audit for current release and evidence work.

## Session Continuity

Progress totals were regenerated from current roadmap dispositions and matching completed plan summaries; they replace stale counters rather than reopening completed work. Pending/in-progress summaries do not count as completed plans.

2026-09-12 continuation: implementation shipped in `1127573`, `000bbace` and `0c258885`, with successful exact CI/production probes. Historical media navigation/caption copy passed authenticated desktop/mobile checks. Forty dormant vertical preflights passed; one capped live run stopped at the third corpus pin after two Data observations, with its budget closed at $0.00406801. A shared-cell mutation was reproduced and repaired without changing source bytes; a new vertical evaluator revision requires fresh evidence. Owner confirmed ordinary OpenRouter access and Tavily Free, and supplied two unused controlled addresses for Phase 23 setup. See the dated acceptance report for source, semantic and lifecycle gaps. No phase was marked complete from code or preflight alone.

2026-09-14 continuation: Phase 30's owner-only, exact-run review console with byte-bound criteria and stale-pin refusal, plus research Stage 3's deterministic PDF attachment to the exact completed `web_research` row, shipped at `07350fc` after CI `34826131926` and production deployment `34826722003`. The authorized Phase 23 continuation failed closed during A's second native sign-in; no certified handoff, paid evaluation, semantic review, qualified Legal/HR attestation, all-six UAT or activation/rollback drill is inferred. The follow-up harness repair landed in `410aec9` (wait for signed-out UI before reauth) and `40a6553` (scrub password input on auth failure). Read-only production reconciliation later matched the authorization hash to a closed, expired envelope with $0 spend, zero calls/turns, zero unsettled reservations and no breach; exact source and `/ops` checks found no candidate. A fresh bounded authorization is required for another authoring probe. The earlier failed PDF and incomplete paid run remain authoritative history.

Historical session (runtime state not reverified): 2026-09-09 — Phase 45 closed from the shared tree `C:/Users/expert/desktop/pikar-ai` on `main`, ten commits pushed `HEAD:main` (`d8fab20`…`85a755d`). CI and deploy-production both green on `e34a447`, the first run with all sixteen free gates executing inside CI on Node 24. Prod `QUICKBOOKS_REDIRECT_URI` is restored to the convex.site callback. PRIOR: 2026-09-06 — Phases 36, 37, 38 and 39 closed from the release worktree (`C:/Users/expert/AppData/Local/Temp/pikar-release`, branch `feat/28.2-unpark-quickbooks`, pushed `HEAD:main`). The shared tree `C:/Users/expert/desktop/pikar-ai` is on `main` (its stale 28.1 draft is `stash@{0}`). Local stack: detached `convex dev` (relaunched 16:20 as `launch-detached.ps1 -Label convex38` after the earlier watcher went silent — check its log mtime before trusting a push) + `next start :3112` from the release worktree; the e2e tenant carries a synthetic stale `gmailTokens` row (delete it with `gmailAuth:deleteTokens` before knowledge-search / briefing specs); the local deployment lists the e2e user and the four smoke tenants in `PIKAR_FIXTURE_TENANT_IDS`.

Standing rules for whoever writes this file next: one frontmatter block; edit fields in place; never append a second `---` block; keep the body under ~80 lines — the phase record is where detail goes.
