# The Goal Engine (Chief-of-Staff loop) — design capture

**Captured:** 2026-08-21, owner-directed ("gain deep understanding then draft its plan").
**Status:** DESIGN CAPTURE, pre-phase. Registered as gap G13 in the Consistency Audit (rev 4). Not scheduled; prerequisites below. Every factual claim here was verified against source on branch `closure/phases-14-25` with file:line evidence (verification sweep 2026-08-21).
**What it is:** the missing orient-and-propose layer — a persistent model of the user's business goals that senses state, holds an agenda, and proactively stages governed proposals through the existing approval gate to advance those goals. The system today has "sense" and "act"; it has no "orient" and almost no initiative.

---

## 1. The loop, mapped onto what actually exists

| Stage | What exists today | What's missing |
|---|---|---|
| **Sense** | Evaluation engine (Phase 12): `diagnose → leverageRank`, gaps as `{label, leverageRank, route, playbook, citationDocId?, proofMetric?}` (`schema.ts:1093-1106` — ranked by gate order, no severity field, identity = `route/playbook`). Weekly cron `proactiveReview.runWeekly` (Mon 06:00) runs a real evaluation per onboarded tenant on the pinned `proactive-review` thread with delta tracking (`gapsOpened/gapsClosed`). Vault, connectors, cash staleness flags (`needsConfirmation`, >90d). | Cross-thread agenda. The gap "agenda" is the latest evaluations row per thread, last-write-wins — no gap lifecycle (acted-on / dismissed / recurring), no dedupe across threads. |
| **Orient** | `goals` table — the living-map "intention plane" (`schema.ts:2012-2026`): user-authored, segment-anchored, `active/achieved/dropped`, one-level parents. The 3 nearest-dated active goals already reach the model on EVERY cockpit turn via `spineForTenant` (clipped to 64 chars; undated goals never reach the spine). | Everything else. Nothing links a goal to a gap, a plan, or an outcome. The agent cannot write goals (deliberate — see §3). No standing model of "where the business is trying to go and what's blocking it." |
| **Propose** | `applyActOnGap` (`evaluations.ts:900-992`): gap → either an approvable memo (deterministic `buildMemo` — can never assert an ungrounded number) or a specialist dispatch. Reachable ONLY from the UI "Act on this" button. The approvals surface, budget rails, and per-plan gate all exist and are exactly the right chassis. | Initiative. Nothing calls actOnGap unprompted. The weekly review can't even be conversed with (the review thread has no plans row; the composer is suppressed — though actOnGap works there because it inserts one). |
| **Act** | The whole workflow ecosystem: dispatch, delivery workflows, media, calendar, CRM; Phases 27–30 add the packaged verbs. | Durable fan-out (G6) so multi-part proposals survive execution. |
| **Measure** | Only `telemetry.reviewOutcome ∈ {sent, failed}` — whether a send happened, never whether it worked. Goal instrumentation is `cycleTimeDays` on achievement, nothing more. | Phase 27's planned refs/counts-only outcome-measurement layer (time-to-first-outcome, acceptance, completion — `ROADMAP.md:121,127`) and Phase 28's revenue signals are the designated substrate. The goal↔plan↔outcome join does not exist anywhere. |
| **Learn** | The delta between weekly evaluations (`gapsOpened/gapsClosed` — and note the 13-02 lesson: citations re-recorded on restatement, or re-runs report false progress). | Feeding measured outcomes back into the agenda and the goal statuses (as PROPOSALS — see §3). |

## 2. Design convictions (owner-endorsed)

1. **The brain proposes; the user approves. Autonomy is earned, not assumed.** The governance moat (approval gates, budget rails, append-only audit) is built for exactly this shape. The brain stages plans onto the approvals surface — "your CAC is unknown and it's blocking your growth model; here are three ways to establish it" — and autonomy tiers are then earned per workflow: **suggest → schedule → auto-execute within a pre-approved grant and budget.** The tier ladder needs its own ADR (see §4) and must be reconciled with the standing non-goal "fully autonomous mode (no review gate)" (`REQUIREMENTS.md:256`, `research/FEATURES-v1.md:65`): the top tier is a *pre-authorized grant with per-run notification, spend cap, and kill switch* — never the absence of review.
2. **Self-filling data never launders provenance.** The provenance-laundering defect class shipped three times. The live guard is the ADR-021 split: `userProvided` is literal ("never widened to include a non-user write"), `fieldProvenance` records every actor, an agent write actively DROPS a path from `userProvided`, and `applyFinanceClaims` stamps `actor:"agent"` from the door, never from the row. A brain that fills gaps fills them as **cited proposals the user confirms**. For the idea-stage user (sparse-start onboarding admits six slots and nothing else), the brain's job is a **progressive interview driven by the gap list** — the gaps ARE its agenda; the quiet `recordScorecardAnswer` path (asks in conversation, stores with provenance, never crosses Approve) already exists as the mechanism. Today the only unprompted outbound act in the whole product is the Monday notification; everything else waits for the user to open a page.

## 3. Written prohibitions the design must respect (all verified)

| Prohibition | Where | Consequence for the design |
|---|---|---|
| No agent goal-write tool | living-map design §10 (`docs/superpowers/specs/2026-08-08-blueprint-living-map-design.md:221-223`) | The brain READS goals; goal edits (including "mark achieved") arrive as proposals the user confirms on the profile surface — or the §10 decision is explicitly revisited in the phase's ADR, never silently. |
| Standing commitments arrive as grants checked inside the human-gated mutation, never as tools | ADR-004 (`docs/decisions/004-agents-humans-peer-actors.md:55-58`) — "a flag is a prompt-injection away from flipped; capability absence is structural" | Autonomy tiers 2–3 are implemented as scoped grants validated inside `executePlan`-class mutations. |
| Recurrence is fail-closed until the standing-instruction approval model, OAuth lifetime, missed-run semantics, timezone/DST, idempotency, and pause/revoke are decided and tested | ROUT-02 (`REQUIREMENTS.md:211`, `ROADMAP.md:183,188`; Phase 29 plans 29-11..13 branch on proving it was NOT built) | The brain's own cadence rides the existing weekly cron until the ROUT-02 decisions land; tier-2 "schedule" is gated on Phase 29. |
| `savedPrompts` is fenced — no routines table, no cron, no scheduler words (statically scanned by its test) | `savedPrompts.ts:7-11` + `savedPrompts.test.ts` | Any brain state lives in NEW tables (e.g. `agenda`, goal-plan links), never grafted onto savedPrompts. |
| New proactive notification kinds go BESIDE `NOTIFICATION_KINDS`, not in it | `notificationTemplates.ts:28-48` — kinds in the list arm the Gmail path; weekly_review deliberately sits outside; static label-only test | Brain notifications: direct insert (the proactiveReview pattern), code-owned static copy, opt-in `KIND_HREF` deep link. |
| §4 content/log firewall | CLAUDE.md; statically scanned | Agenda/goal text never enters audit/deadLetters/telemetry payloads — refs and counts only. |

## 4. What a Goal Engine phase actually builds (sketch, not a PLAN)

**v0 — "the agenda speaks" (propose-only tier; collides with no prohibition):**
- A persistent, tenant-scoped agenda derived from the proactive-review thread's gap list, with per-gap lifecycle (`open / proposed / acted / dismissed / recurring`) — the cross-thread table that doesn't exist today.
- The weekly review upgraded from "a notification that a row changed" to **one staged proposal**: the top-leverage open gap becomes an approvable memo/plan via the existing `applyActOnGap` internals (unprompted caller, same governed terminals). The review thread gains a plans row so the user can converse with it.
- The progressive interview: when the top item is a `notEnoughData` nudge rather than a gap, the proposal is a conversation opener that asks for the missing facts through `recordScorecardAnswer` (provenance-correct by construction).
- Goal linkage v0: proposals cite which active goal (if any) the gap blocks, read-only from the spine.

**v1 — orient (after Phase 27's measurement layer):**
- Goal↔plan↔outcome join table; executed plans report refs/counts outcomes; the weekly delta includes "what moved toward which goal."
- Goal-status PROPOSALS (achieved/dropped suggestions the user confirms), respecting living-map §10.

**v2 — earned autonomy (after Phase 29 ROUT-02 decisions + ADR-004 grants):**
- Per-workflow autonomy tiers as scoped grants inside the human-gated mutations: suggest (default) → schedule (recurrence, fail-closed semantics) → auto-execute within grant + budget + per-run notification + kill switch.
- The tier ladder gets its own ADR, explicitly reconciling with the "no fully autonomous mode" non-goal.

**New ADRs required:** autonomy tiers (v2); agenda persistence + gap lifecycle (v0); goal-write proposal flow vs §10 (v1).

## 5. Sequencing and prerequisites

This is the capstone, and its prerequisites are the reason for much of the current queue:
1. **Phase 25.1 (in execution)** — a brain acting unprompted on a pipeline with silent failure states would destroy trust instantly; honest terminals are its precondition.
2. **G6 Durable Agent Runs & Governed Fan-Out** — gives it hands that survive; a multi-part proposal needs durable, parallel, provenance-preserving execution.
3. **Phases 27–28** — the workflows are the verbs it conjugates, and 27's outcome-measurement layer is its "measure" stage.
4. **Phase 29 ROUT-02 decisions** — the gate for anything beyond the suggest tier.

v0 has a smaller true prerequisite set (25.1 only, since it is propose-only on existing machinery) and could be pulled forward as a thin phase if the owner wants initiative sooner; v1/v2 must wait for their substrate.

---
*This document is a capture, not a commitment: it exists so the idea survives with its constraints attached. The phase itself gets minted (roadmap entry, requirements IDs, PLAN.md files) when its slot in the sequence arrives — or earlier for v0 on the owner's call.*
