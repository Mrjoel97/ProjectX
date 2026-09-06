---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 37
current_plan: 37-01 complete; next per the merged order (rev 5 audit §5) — Track C step 10 (tool registry) while the owner runs the G19 activations
status: complete
stopped_at: "37-01 CLOSED 2026-09-06 — planning corpus repaired: this file collapsed to ONE frontmatter block (history in .planning/archive/STATE-history-2026-09-06.md), ROADMAP progress table regenerated (64 rows, one per heading), REQUIREMENTS ticked where a closed phase certifies (12) and annotated (open: …) where code shipped without live proof (22), loose planning files archived, scripts/check-planning.mjs Stop hook refuses a second frontmatter block, a heading without a row, or a Complete row with un-ticked requirement rows. Do NOT run gsd-tools state * against this file: its writer PREPENDS a block whenever byte 0 is not a dash, which is how 36 blocks accumulated."
last_updated: "2026-09-06T13:22:15+03:00"
progress:
  total_phases: 64
  completed_phases: 48
  total_plans: 443
  completed_plans: 400
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
| 37 Planning-corpus repair (G26) | 2026-09-06 | this commit | the repair above + the Stop-hook rule |
| 36 SMOKE sentinels out of band (G24, ADR-035) | 2026-09-06 | `a6c2d41` `[deploy]` | fixture selection is an operator fact about WHO; full local re-drive 13/13 specs + 4/4 smokes |
| 35 Outcome language + idea-stage artifact (G23, ADR-034) | 2026-09-06 | `2e18522` `[deploy]` | landing/Command Center in outcome language; `pack-offer-and-lead-plan` dark behind the pack gate |

Next in the merged order: Track C step 10 — the tool registry before the next heavy `llm.ts` phase. Owner-side, in parallel and still owed: G19 activations (pack, revenue and cockpit-agent gates → `activateSkill` on prod), `RELIABILITY_SWEEP_ARMED=1` on prod, the QuickBooks runbook (28.2), the pack gate run for `pack-offer-and-lead-plan` (35-02-SUMMARY).

## Session Continuity

Last session: 2026-09-06 — Phases 36 and 37 closed from the release worktree (`C:/Users/expert/AppData/Local/Temp/pikar-release`, branch `feat/28.2-unpark-quickbooks`, pushed `HEAD:main`). The shared tree `C:/Users/expert/desktop/pikar-ai` is on `main` (its stale 28.1 draft is `stash@{0}`). Local stack: detached `convex dev` + `next start :3112` from the release worktree; the local deployment lists the e2e user and the four smoke tenants in `PIKAR_FIXTURE_TENANT_IDS`.

Standing rules for whoever writes this file next: one frontmatter block; edit fields in place; never append a second `---` block; keep the body under ~80 lines — the phase record is where detail goes.
