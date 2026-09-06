---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 38
current_plan: 38-01 complete; next per the merged order (rev 5 audit §5) — Track C step 11 (research engine G4, Document Canvas G5, durable runs G6/G10) while the owner runs the G19 activations
status: complete
stopped_at: "38-01 CLOSED 2026-09-06 — tool registry, scope A: buildCockpitTools(ToolContext, ToolGrants); grantsFor in @pikar/core is the one grant derivation; TOOL_CONTEXT_ARGS is the shared validator at both agent doors; 23-class byte-identical snapshot (toolRegistrySnapshot.test.ts) held through the refactor; the executive loop now forwards tenantSkillIds to dispatched specialists; live 8/8 on the local deployment. Do NOT run gsd-tools state * against this file (its writer prepends blocks; the Phase 37 hook refuses the result)."
last_updated: "2026-09-06T16:40:00+03:00"
progress:
  total_phases: 65
  completed_phases: 49
  total_plans: 444
  completed_plans: 401
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
| 38 Tool registry (Track C step 10) | 2026-09-06 | this commit | `buildCockpitTools(ToolContext, ToolGrants)`, `grantsFor` in core, shared validator at both doors, 23-class snapshot held, tenant pin now reaches dispatched specialists |
| 37 Planning-corpus repair (G26) | 2026-09-06 | `dee3f97` `[deploy]` | one STATE block, regenerated ROADMAP table, requirement rows ticked/annotated, `check-planning.mjs` Stop hook |
| 36 SMOKE sentinels out of band (G24, ADR-035) | 2026-09-06 | `a6c2d41` `[deploy]` | fixture selection is an operator fact about WHO; full local re-drive 13/13 specs + 4/4 smokes |

Next in the merged order: Track C step 11 — research engine (G4), Document Canvas (G5), durable runs + fan-out under one plan-row ADR (G6, G10); each now adds tools through `ToolContext`/`ToolGrants` + the snapshot test instead of a ninth positional. Owner-side, in parallel and still owed: G19 activations (pack, revenue and cockpit-agent gates → `activateSkill` on prod), `RELIABILITY_SWEEP_ARMED=1` on prod, the QuickBooks runbook (28.2), the pack gate run for `pack-offer-and-lead-plan` (35-02-SUMMARY).

## Session Continuity

Last session: 2026-09-06 — Phases 36, 37 and 38 closed from the release worktree (`C:/Users/expert/AppData/Local/Temp/pikar-release`, branch `feat/28.2-unpark-quickbooks`, pushed `HEAD:main`). The shared tree `C:/Users/expert/desktop/pikar-ai` is on `main` (its stale 28.1 draft is `stash@{0}`). Local stack: detached `convex dev` (relaunched 16:20 as `launch-detached.ps1 -Label convex38` after the earlier watcher went silent — check its log mtime before trusting a push) + `next start :3112` from the release worktree; the e2e tenant carries a synthetic stale `gmailTokens` row (delete it with `gmailAuth:deleteTokens` before knowledge-search / briefing specs); the local deployment lists the e2e user and the four smoke tenants in `PIKAR_FIXTURE_TENANT_IDS`.

Standing rules for whoever writes this file next: one frontmatter block; edit fields in place; never append a second `---` block; keep the body under ~80 lines — the phase record is where detail goes.
