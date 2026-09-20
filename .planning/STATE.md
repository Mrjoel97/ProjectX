---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 03.7
current_plan: Wave 1 — diagnose invite preflight and provider HTTP 400; preserve all acceptance gates.
status: in_progress
stopped_at: "Direct OAuth run reached signup but invite preflight did not enable submission; five checks did not run. Reconcile exact invite read-only. HTTP_400 remains unresolved; no further paid work."
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
**Current Plan:** preserve completed repository work and execute bounded live qualification under the [standing authorization](audits/2026-09-20-standing-execution-authorization.md)
**Status:** Wave 1 acceptance in progress; provisioning repair verified, signup preflight diagnosis open, exact live/provider/founder acceptance unproven
**Progress:** `01-10` is technically ready for its later external gate. `03.7-10` current offline gates are green (46 core, 9 backend, evaluator self-check and Playwright discovery). `17.1-11` current offline gates are green (77 core and 100 backend tests, including non-empty source and standing-spine controls). `18-11` Tasks 1-2 are complete: 27 core, 230 backend and 13 web tests pass; invalid replacements now refuse before scan/draft/render/storage or spend, the late refusal remains cleanup-safe for races, and the Output card exposes honest loading/missing/partial/empty and saved-not-sent states. Latest corpus `72a43b32` is non-certifying; all six calls are settled and its closed budget accounts USD `0.03000392`, including `0.03` conservative exposure. The Blueprint baseline remains `accepted:false`, so live and founder layers are not claimed.

- **Governing reference:** [merged audit](audits/2026-09-10-merged-audit-codebase-review.md), including its G1–G26/H1–H5 reconciliation and owner-adopted Waves 0–8.
- **Execution order:** Phase 37.1 closed Wave 0 planning truth; Waves 1–8 now execute through ordinary GSD phases and plans with the dependencies and exit gates in the merged audit.
- **Immediate handoff:** the user's standing authorization supersedes prior permission stops. Current corpus `72a43b32` on evaluator `6d27a820…` passed preflight but failed at its first chat before a case verdict. Budget `ps7d509t3e281pb14ry373r7s18er6cr` is closed: six calls settled, zero unresolved, USD `0.00000392` observed plus `0.03` conservative, no breach. Diagnose before any paid retry; deterministic browser evidence continues separately. Blueprint remains `accepted:false`; Phase 18 live acceptance remains gated. Phase 23 stays in Wave 4.
- **Current repairs:** `20dbfe7` adds closed provider-failure tokens while preserving conservative accounting: 22 focused tests, backend typecheck, three identity tests and runner self-check pass. Evaluator is `764154e2…`. `afecf0a` adds desktop/mobile capture and secret-safe browser provisioning diagnostics; its earlier claimed web typecheck pass was contradicted by a verified exit 2 for Node's `Error` type. Commit `1b06fb3` repairs that helper and the CLI's suppressed-null lookup using a shared resolver and non-null internal provisioning envelope. Verified: 19 owner tests, two web diagnostic tests, backend/web typechecks exit 0, formatting and playbook checks. Runtime read/browser verification remains pending; no passing registry evidence is claimed.
- **Wave 2 tracking:** plans `25-14`–`25-17` are prepared and unexecuted. Ledger reconciliation has 478 rows, including 28 in Wave 2; its exhaustive verifier passes and historical rows remain unchanged.
- **Browser attempts (2026-09-20):** PID 20452 failed at the old nullable lookup. After `1b06fb3`, a read-only call returned exact `{result:null}`, exit 0. PID 2444 failed in discovery because the package script forwarded a literal `--`; earlier controller validation was insufficient. Root's direct Node `--list` from `apps/web` selected exactly six tests, exit 0. Web recovery used direct Next PID 12708. Corrected OAuth PID 18448 (`oauth-readiness-direct-20260920-170704`) reached signup but Create Account stayed disabled: invite preflight did not confirm validity. One setup failed, five checks did not run. No retry or acceptance; reconcile that exact invite/user and backend targeting read-only. Historical failed identities remain unreconciled.
- **Single diagnostic after explicit approval:** `294a80bc` terminated exit 2; budget `ps76pamnqe9fjayrf955ty18kh8er47j` is closed with six settled calls, zero unresolved and no breach: USD 0.00000392 observed plus USD 0.03 conservative. Approval disclosure omitted the runner's five synthetic embedding setup calls; the owner was informed and further paid work stopped. Existing CLI inline-query/component reads recovered only `EVAL_MODEL_RESPONSE_FAILED_CONSERVATIVE_HTTP_400`, with no raw workflow persistence or source/schema change. HTTP 400 does not identify the rejected field; offline request-shape diagnosis is next. No registry evidence, replay or acceptance is claimed.
- **External facts (2026-09-20):** owner confirmed provisional name `pikar-ai`; registered legal information remains pending. Phase 32's entity/provider gate is not cleared by that provisional name.
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
