---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 23
current_plan: 23-06 authorized two-turn $1 probe failed closed during A's second native sign-in after the initial authoring/refusal sequence; no certified handoff or activation. Phase 30 exact-byte review console and research Stage 3 same-row PDF dependency shipped to production at 07350fc with CI 34826131926 and deploy 34826722003. Their authenticated live evidence remains open. Six vertical v1 candidates are dormant. Phase 47 remains deferred on real evidence.
status: in_progress
stopped_at: "2026-09-14 — Phase 23 bounded continuation failed closed during A's second native sign-in; source integrity held and no handoff or activation was certified. Phase 30 review console and research Stage 3 deterministic same-row PDF dependency shipped at 07350fc after CI 34826131926 and production deploy 34826722003. Paid/semantic evaluation, Legal-HR attestation, all-six UAT, lifecycle, provider and recurrence gates remain open."
last_updated: "2026-09-14"
progress:
  total_phases: 74
  completed_phases: 55
  total_plans: 457
  completed_plans: 419
  percent: 92
---

# Project State

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

Current owner priority: the Phase 23 native sign-out/sign-in race is repaired in `410aec9`, and failure diagnostics now scrub the password field in `40a6553`; use the remaining authorized bounded probe only after confirming the existing attempt's budget and candidate state. Phase 30's exact-byte review console and research Stage 3's same-row PDF dependency shipped at `07350fc` after CI `34826131926` and production deployment `34826722003`; authenticated live evidence remains open. Phase 31 is complete on production `4df076db`; its direct-context acceptance method and cleanup limits are in `31-VERIFICATION.md`. Recurrence remains deferred until real DST/OAuth evidence passes; do not build its table first. The Sep 12 Intuit app check redirected to sign-in, so renewed provider diagnosis first needs authentication; that check does not reconfirm the older app-record failure.

**LIVE ACCEPTANCE STILL OPEN.** Phase 44 and the updated merged-audit G19 row record successful production activations; the former claim that fixture 33 blocks every activation was stale. New candidates still require fresh exact-version evidence. QuickBooks remains unconnected; Phase 45 records an app-record failure, while the latest developer-app check needs Intuit sign-in before renewed diagnosis. WORM remains OFF under ADR-044; recurrence remains deferred pending real DST and OAuth expiry/reauth traces. Phase 24 semantic review, Phase 23 real author/eval/activation/rollback, current-provider media proof and Phase 25 self-service release qualification remain open. See the 2026-09-12 acceptance audit for current release and evidence work.

## Session Continuity

Progress totals were regenerated from current roadmap dispositions and matching completed plan summaries; they replace stale counters rather than reopening completed work. Pending/in-progress summaries do not count as completed plans.

2026-09-12 continuation: implementation shipped in `1127573`, `000bbace` and `0c258885`, with successful exact CI/production probes. Historical media navigation/caption copy passed authenticated desktop/mobile checks. Forty dormant vertical preflights passed; one capped live run stopped at the third corpus pin after two Data observations, with its budget closed at $0.00406801. A shared-cell mutation was reproduced and repaired without changing source bytes; a new vertical evaluator revision requires fresh evidence. Owner confirmed ordinary OpenRouter access and Tavily Free, and supplied two unused controlled addresses for Phase 23 setup. See the dated acceptance report for source, semantic and lifecycle gaps. No phase was marked complete from code or preflight alone.

2026-09-14 continuation: Phase 30's owner-only, exact-run review console with byte-bound criteria and stale-pin refusal, plus research Stage 3's deterministic PDF attachment to the exact completed `web_research` row, shipped at `07350fc` after CI `34826131926` and production deployment `34826722003`. The authorized Phase 23 continuation failed closed during A's second native sign-in after the initial authoring/refusal sequence; no certified handoff, paid evaluation, semantic review, qualified Legal/HR attestation, all-six UAT or activation/rollback drill is inferred. The follow-up harness repair landed in `410aec9` (wait for signed-out UI before reauth) and `40a6553` (scrub password input on auth failure); the next live attempt still requires read-only confirmation of prior budget/candidate state. The earlier failed PDF and incomplete paid run remain authoritative history.

Historical session (runtime state not reverified): 2026-09-09 — Phase 45 closed from the shared tree `C:/Users/expert/desktop/pikar-ai` on `main`, ten commits pushed `HEAD:main` (`d8fab20`…`85a755d`). CI and deploy-production both green on `e34a447`, the first run with all sixteen free gates executing inside CI on Node 24. Prod `QUICKBOOKS_REDIRECT_URI` is restored to the convex.site callback. PRIOR: 2026-09-06 — Phases 36, 37, 38 and 39 closed from the release worktree (`C:/Users/expert/AppData/Local/Temp/pikar-release`, branch `feat/28.2-unpark-quickbooks`, pushed `HEAD:main`). The shared tree `C:/Users/expert/desktop/pikar-ai` is on `main` (its stale 28.1 draft is `stash@{0}`). Local stack: detached `convex dev` (relaunched 16:20 as `launch-detached.ps1 -Label convex38` after the earlier watcher went silent — check its log mtime before trusting a push) + `next start :3112` from the release worktree; the e2e tenant carries a synthetic stale `gmailTokens` row (delete it with `gmailAuth:deleteTokens` before knowledge-search / briefing specs); the local deployment lists the e2e user and the four smoke tenants in `PIKAR_FIXTURE_TENANT_IDS`.

Standing rules for whoever writes this file next: one frontmatter block; edit fields in place; never append a second `---` block; keep the body under ~80 lines — the phase record is where detail goes.
