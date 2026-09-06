---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 41
current_plan: 41-01 complete (ADR-037 accepted); next per the merged order (rev 5 audit §5) — Phase 42/43 durable runs + fan-out and batches (G6/G10), which consume ADR-037; owner owes the G19 activations incl. research-specialist v4 AND cockpit-agent v3 on prod
status: complete
stopped_at: "41 CLOSED 2026-09-07 — THE PLAN-ROW ADR (ADR-037), the decision G6 and G10 both consume. NO CODE, NO SCHEMA: the deliverable is the decision. `parentPlanId` optional + `by_parent`; no parent = a ROOT (its own artifact, its own approval), a parent = a FAN-OUT CHILD (no approval of its own) — one discriminator, both questions, no backfill. `plans.byThread` becomes the NEWEST ROOT by bounded descending scan (smoke.ts:893-898 is the shipped idiom; the draft ADR had invented a take(32) that exists nowhere in this repo). Owner answered WIDE on kinds, which forced the decision the adversary found: a thread may hold several ROOTS, so newest-root alone could strand a half-composed email under a staged reel. Resolved by splitting LIFETIME ceilings (image_already_started, 'start a new chat' — these die) from CONCURRENCY interlocks (draft_in_progress, *_in_flight, the UNDERWAY replies — these survive), yielding AT MOST ONE ROOT PER THREAD IN `collecting`, which makes newest-root provably the row the user is typing into and collapses eight refusal branches into one predicate. Children land at `approved` (the only status besides collecting that no approvals query pages); only the parent flips to `proposed` = one fan-out, one card. The weekly review inserts ROOTS not children (a staged gap must stay approvable). Envelope divided at the mint site; governedDispatch byte-identical. Supersedes ADR-033 D3 + ADR-014's one-image bullet; ADR-008 explicitly NOT superseded (premise changed, decision stands); ADR-014's back-reference to a ADR-012 ceiling that does not exist is retired on this ADR's own terms. TWO ADVERSARIAL PASSES EARNED THEIR KEEP: the first refuted 7 claims and found gapAction.test.ts:343-344 (a test arguing AGAINST this direction) that the synthesis never mentioned; the second returned NOT SAFE TO ACCEPT, catching 4 materially wrong citations (one pointing an implementer at `add_only`, a refusal that must survive) and an internal contradiction in the review decision. PRIOR (same day, out of band): the owner reported a held reel — a STOCK scene whose picture job FAILED was drawn `nothing to buy` because trackerView's buysPicture asked the PAID question where the render trigger asks the PIPELINE one, so Pictures read `Done — All 2 ready` over a hole. THREE copies of that predicate existed; media.md's own 2026-08-26 entry had closed 'TWO'. Fixed by landsPictureRow in @pikar/core/render, shipped and deployed as efdfdb0. PRIOR: 40 CLOSED 2026-09-06 — Document Canvas (G5, DOC-01), ADR-036, cockpit-agent v3 seeded as CANDIDATE v28 and NOT activated (EVAL_GATE correctly refused: 45/46 twice on a stochastic research-lane case proven unrelated). Do NOT run gsd-tools state * against this file."
last_updated: "2026-09-07T00:55:00+03:00"
progress:
  total_phases: 66
  completed_phases: 52
  total_plans: 448
  completed_plans: 406
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
| 40 Document Canvas (Track C step 11, G5, DOC-01) | 2026-09-06 | this commit | inline PDF in the Output card, `vaultSheets` grid at ingest + `SheetGrid`, `.xlsx` on both planes from `spreadsheet-drafter@1`, ADR-036; cockpit-agent v3 = candidate v28, gate 45/46, NOT activated |
| 39 Research engine (Track C step 11, G4, RSCH-01) | 2026-09-06 | `4b8fe5b` `[deploy]` | `readPage` bounded to the run's own search results, page-read/snippet-only labels, shared staleness window, honest footer, research-specialist v4 gated 46/46 and active locally |
| 38 Tool registry (Track C step 10) | 2026-09-06 | `23351ff` `[deploy]` | `buildCockpitTools(ToolContext, ToolGrants)`, `grantsFor` in core, shared validator at both doors, 23-class snapshot held, tenant pin now reaches dispatched specialists |

Next in the merged order: Track C step 11 continues — **Phase 41 the plan-row ADR** (parent/child vs batch-grouped rows; the migration shape for `plans.by_thread`'s five `.unique()` sites), then 42/43 durable runs + fan-out and batches (G6, G10). `.planning/phases/39-research-engine/39-RESEARCH.md` §4 carries the measured state for both. Owner-side, in parallel and still owed: G19 activations (pack, revenue, cockpit-agent AND now research-specialist v4 gates → `activateSkill` on prod), `RELIABILITY_SWEEP_ARMED=1` on prod, the QuickBooks runbook (28.2), the pack gate run for `pack-offer-and-lead-plan` (35-02-SUMMARY).

## Session Continuity

Last session: 2026-09-06 — Phases 36, 37, 38 and 39 closed from the release worktree (`C:/Users/expert/AppData/Local/Temp/pikar-release`, branch `feat/28.2-unpark-quickbooks`, pushed `HEAD:main`). The shared tree `C:/Users/expert/desktop/pikar-ai` is on `main` (its stale 28.1 draft is `stash@{0}`). Local stack: detached `convex dev` (relaunched 16:20 as `launch-detached.ps1 -Label convex38` after the earlier watcher went silent — check its log mtime before trusting a push) + `next start :3112` from the release worktree; the e2e tenant carries a synthetic stale `gmailTokens` row (delete it with `gmailAuth:deleteTokens` before knowledge-search / briefing specs); the local deployment lists the e2e user and the four smoke tenants in `PIKAR_FIXTURE_TENANT_IDS`.

Standing rules for whoever writes this file next: one frontmatter block; edit fields in place; never append a second `---` block; keep the body under ~80 lines — the phase record is where detail goes.
