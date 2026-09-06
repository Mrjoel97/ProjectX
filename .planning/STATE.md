---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 40
current_plan: 40-01/02/03 complete; next per the merged order (rev 5 audit §5) — Phase 41 the plan-row ADR, then durable runs/batches (42/43, G6/G10); owner owes the G19 activations incl. research-specialist v4 AND cockpit-agent v3 on prod
status: complete
stopped_at: "40 CLOSED 2026-09-06 — Document Canvas (G5, DOC-01): vaultSheets capped grid written at ingest (separate table BY DESIGN — the vault read bound counts vaultDocuments.text only), SheetGrid in the vault preview with its ceilings in words, .xlsx on BOTH planes through markdownToSheets + sheetsToXlsx and the new ungated spreadsheet-drafter@1 (stored bytes read back as a workbook in test), regenerateAttachment keeps its format, inline PDF in OutputCard under the restated bearer-URL rule, ADR-036 accepted. cockpit-agent body v3 is written and seeded as a CANDIDATE — its local eval gate + activation is the one open item. PRIOR: 39-01 CLOSED 2026-09-06 — the research specialist reads the pages it cites: readPage (Tavily /extract, bounded to URLs the run's own search returned, 6 reads × 6k chars), page-read/snippet-only labels, RESEARCH_STALE_AFTER_MS shared by the reuse window and the card stamp, LIMITS_FOOTER rewritten, skill v4 = research-specialist@10 through the eval gate 46/46 ($0.80) and active on the local deployment (readPage ×20 over 7 runs). Packs deliberately NOT granted readPage until their bodies are revised through the pack gate (pinned by test). Do NOT run gsd-tools state * against this file."
last_updated: "2026-09-06T20:30:00+03:00"
progress:
  total_phases: 66
  completed_phases: 51
  total_plans: 448
  completed_plans: 405
  percent: 90
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
| 40 Document Canvas (Track C step 11, G5, DOC-01) | 2026-09-06 | this commit | inline PDF in the Output card, `vaultSheets` grid at ingest + `SheetGrid`, `.xlsx` on both planes from `spreadsheet-drafter@1`, ADR-036 |
| 39 Research engine (Track C step 11, G4, RSCH-01) | 2026-09-06 | `4b8fe5b` `[deploy]` | `readPage` bounded to the run's own search results, page-read/snippet-only labels, shared staleness window, honest footer, research-specialist v4 gated 46/46 and active locally |
| 38 Tool registry (Track C step 10) | 2026-09-06 | `23351ff` `[deploy]` | `buildCockpitTools(ToolContext, ToolGrants)`, `grantsFor` in core, shared validator at both doors, 23-class snapshot held, tenant pin now reaches dispatched specialists |

Next in the merged order: Track C step 11 continues — **Phase 41 the plan-row ADR** (parent/child vs batch-grouped rows; the migration shape for `plans.by_thread`'s five `.unique()` sites), then 42/43 durable runs + fan-out and batches (G6, G10). `.planning/phases/39-research-engine/39-RESEARCH.md` §4 carries the measured state for both. Owner-side, in parallel and still owed: G19 activations (pack, revenue, cockpit-agent AND now research-specialist v4 gates → `activateSkill` on prod), `RELIABILITY_SWEEP_ARMED=1` on prod, the QuickBooks runbook (28.2), the pack gate run for `pack-offer-and-lead-plan` (35-02-SUMMARY).

## Session Continuity

Last session: 2026-09-06 — Phases 36, 37, 38 and 39 closed from the release worktree (`C:/Users/expert/AppData/Local/Temp/pikar-release`, branch `feat/28.2-unpark-quickbooks`, pushed `HEAD:main`). The shared tree `C:/Users/expert/desktop/pikar-ai` is on `main` (its stale 28.1 draft is `stash@{0}`). Local stack: detached `convex dev` (relaunched 16:20 as `launch-detached.ps1 -Label convex38` after the earlier watcher went silent — check its log mtime before trusting a push) + `next start :3112` from the release worktree; the e2e tenant carries a synthetic stale `gmailTokens` row (delete it with `gmailAuth:deleteTokens` before knowledge-search / briefing specs); the local deployment lists the e2e user and the four smoke tenants in `PIKAR_FIXTURE_TENANT_IDS`.

Standing rules for whoever writes this file next: one frontmatter block; edit fields in place; never append a second `---` block; keep the body under ~80 lines — the phase record is where detail goes.
