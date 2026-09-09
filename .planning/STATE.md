---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 46
current_plan: PHASE 46 COMPLETE (1 plan). **ADR-046 accepted — a standing approval READS and PREPARES; it never sends.** No code and no schema change: `schema.ts`'s “deliberately NO `routines` table” sentence is still true, as G25's own row demands (“do not build the table first”). Research found G25's headline HALF STALE — the recurrence arithmetic already exists, proven against real ICU tzdata as a deliberately UNIMPORTED spike — and that ROUT-02 had already run a formal gate saying `defer`, whose seven `manual` rows were recommendations nobody had ruled on. Those rows now have a ruling. THE STRUCTURAL FIX is D9: `check-routine-gate.mjs` demanded `live` evidence for `dst-boundary` that could not exist until the feature shipped, so the ADR DEFINES the row (a throwaway scheduled function across a real transition — a trace, not a test) instead of weakening the gate. Every matrix row is still `missing` on purpose: a row moves to `pass` when the ruling is IMPLEMENTED, not when the ADR is accepted
status: complete
stopped_at: "46-01 2026-09-09 — PHASE 46 CLOSED. ADR-046 accepted. Owner decided all four questions: read + prepare only; reserve the envelope up front; a throwaway scheduled function firing across a real DST transition is admissible `live` evidence for `dst-boundary`; skip a missed occurrence and never burst. Nine decisions D1-D9 rule the seven `manual` ROUT-02 rows plus the `cost` row's missing half. Research first paid for itself twice: it found the recurrence ARITHMETIC already built and proven (so the ADR does not re-decide time), and it found the live-evidence BOOTSTRAP in `check-routine-gate.mjs` that would have kept G25 shut forever. `29-RECURRENCE-DECISION.md` is NOT edited — CLAUDE.md §9, supersede never amend; its `decision: defer` key is read by 29-12/29-13 and a later phase flips it by EARNING the rows. NEXT: the consuming phase in G25's stated order — schedule row that re-arms, per-run budget RESERVATION (D8, with a release path on every terminal class of D5), and DLQ. Research first, owner questions before code."
last_updated: "2026-09-09T14:05:00+03:00"
progress:
  total_phases: 72
  completed_phases: 55
  total_plans: 469
  completed_plans: 447
  percent: 95
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

Next in the merged order: **the G25 CONSUMING phase** — schedule row that re-arms, per-run budget reservation and DLQ, in G25's stated order, now that ADR-046 exists. Track C step 13's ADR closed 2026-09-09. Step 12 is settled and not next: the retention ADR shipped as ADR-044 (Phase 44), workspace identity waits on a first team customer that does not exist, and BYOK is premature. G25's own row fixes the order — standing-approval ADR BEFORE any schedule row, and “do not build the table first”. Track B step 7 (one revenue connector, G22) is DONE on our side and blocked on Intuit repairing this account's app record; it is not waiting on us.

**OWNER-SIDE, AND THE FIRST ITEM BLOCKS EVERY ACTIVATION.** (1) **Decide fixture 33.** It has been carried since Phase 40 as a stochastic research-lane flake; it is not. See `.planning/phases/43-batch-content-and-the-content-queue/43-FIXTURE-33-FINDING.md`: `evidenceVerdict`'s `declaredUnsupported` leg is provably dead code (`S===0 || (Q && S===0)` ≡ `S===0`, 0 of 24 inputs make a difference), and the fixture asserts a value the code computes with exactly the counter-based rule the fixture's own description says cannot express it. Three options; the recommended one changes NO production behaviour. Until this is decided there is no green gate run, and `shouldRecordEvidence` refuses a filtered run, so no gated skill can be activated at all. (2) Then the full unfiltered pinned run, dev then prod: `pnpm eval:golden -- --skill cockpit-agent@N` (~$0.85 each). `N` is readable ONLY at `/ops` in a signed-in browser — `candidatesForReview` is an `ownerQuery` and the CLI carries no identity. **Candidates STACK**: one Activate flips the Phase 40 canvas edits, the ADR-040 `dispatchTeam` section AND `createVariants` together, and the 46-case suite exercises none of them. (3) `npx convex env set --prod RELIABILITY_SWEEP_ARMED 1`. (4) The G19 activations (pack, revenue, cockpit-agent, research-specialist v4). (5) The QuickBooks lane pass — the runbook is ALREADY WRITTEN, eight steps in `docs/playbooks/revenue-connectors.md`; what is owed is executing it (prod env, gate row, connect as owner, live read, confirmed revoke, seal, per-deployment eval evidence, activation, subset release). (6) The pack gate run for `pack-offer-and-lead-plan` (35-02-SUMMARY).

## Session Continuity

Last session: 2026-09-09 — Phase 45 closed from the shared tree `C:/Users/expert/desktop/pikar-ai` on `main`, ten commits pushed `HEAD:main` (`d8fab20`…`85a755d`). CI and deploy-production both green on `e34a447`, the first run with all sixteen free gates executing inside CI on Node 24. Prod `QUICKBOOKS_REDIRECT_URI` is restored to the convex.site callback. PRIOR: 2026-09-06 — Phases 36, 37, 38 and 39 closed from the release worktree (`C:/Users/expert/AppData/Local/Temp/pikar-release`, branch `feat/28.2-unpark-quickbooks`, pushed `HEAD:main`). The shared tree `C:/Users/expert/desktop/pikar-ai` is on `main` (its stale 28.1 draft is `stash@{0}`). Local stack: detached `convex dev` (relaunched 16:20 as `launch-detached.ps1 -Label convex38` after the earlier watcher went silent — check its log mtime before trusting a push) + `next start :3112` from the release worktree; the e2e tenant carries a synthetic stale `gmailTokens` row (delete it with `gmailAuth:deleteTokens` before knowledge-search / briefing specs); the local deployment lists the e2e user and the four smoke tenants in `PIKAR_FIXTURE_TENANT_IDS`.

Standing rules for whoever writes this file next: one frontmatter block; edit fields in place; never append a second `---` block; keep the body under ~80 lines — the phase record is where detail goes.
