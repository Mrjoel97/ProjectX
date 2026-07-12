---
title: Scheduled send — deferred (v1) and recurring (post-verification) tiers
status: decided (Tier 1 → Phase 3.5 in v1; Tier 2 deferred, design constraints recorded)
decided: 2026-07-12
decision: Split the founder's scheduling intent into two tiers. Tier 1 (one-shot
  deferred send, "send this at 4 AM") enters v1 as Phase 3.5 / SCHD-01 — it is the
  time dimension of the existing per-plan approval model. Tier 2 (recurring send,
  "every day at 8 AM") is a standing-instruction subsystem gated on verified OAuth
  (post-Phase 9); its governance question is named here so Tier 1 stores time in a
  way that doesn't foreclose it.
---

# Scheduled Send

Founder intent (2026-07-12): the user asks in natural language and the agent handles
the *when* as well as the *what* — "send this at 4 AM", "send it every day at 8 AM",
"every 1st of the month at 5 AM". The cockpit's guided flow already covers the
*what* end-to-end (natural-language intake → slot-filling → one PLAN → one Approve →
hands-off governed fan-out). Scheduling adds the time dimension to that machinery —
it composes onto the plan/approve/execute spine, it does not change it.

## Tier 1 — deferred send (v1, Phase 3.5, SCHD-01)

One email (or fan-out), one approval, delayed execution.

- **Intake**: one optional slot in the guided conversation ("when should this go?" /
  natural-language time in the goal). Absent → send immediately on Approve (today's
  behavior is the default; nothing regresses).
- **Approval**: the PLAN card shows the resolved **absolute** time in the user's
  timezone before Approve — the plan the user approves includes the *when*
  (per-plan approval covers deferred execution with zero new governance).
- **Execution**: `executePlan` schedules the existing `deliverApprovedPlan` workflow
  via Convex's built-in scheduler (`runAt`) instead of starting it immediately.
  Audit/telemetry/DLQ/reauth handling reused verbatim.
- **Halt (hard requirement)**: a scheduled plan is cancellable any time before it
  fires — the card shows "Scheduled for …" + Cancel; cancellation is audited. This
  is the PROJECT.md halt-control promise applied to time.
- **Failure at fire time**: identical to immediate sends — an expired token lands
  `awaiting_reauth` + notification; never a silent loss, never an unaudited retry.
- **Timezone**: times resolve against the user's timezone captured client-side;
  the stored value is an absolute epoch ms. Ambiguity ("4 AM" — today or tomorrow?)
  is a re-ask, never a guess (same rule as recipients).

## Tier 2 — recurring send (deferred; design constraints recorded now)

A standing instruction that acts without the user present. Deliberately **not** v1:

1. **Structural blocker**: Gmail Testing mode's 7-day refresh-token expiry means a
   monthly/weekly schedule finds a dead token on most runs until Google OAuth
   verification completes (Phase 9, blocked on legal entity). Built before that,
   the feature fails weekly through no fault of the code — trust damage, not value.
2. **Open governance decision (named, not made)**: recurring execution must choose
   between (a) **approve-template-once** — identical approved content each run
   (default position: this, it preserves "single approval before anything leaves
   the building"), or (b) **bounded per-run re-draft** — an unattended LLM call
   producing unreviewed outbound content, which breaks the current approval model
   and requires its own decision record (per-run notification, budget cap per
   standing instruction, eval gate, kill switch). Do not build (b) casually.
3. **New machinery**: runtime-registered schedules (dynamic crons), per-run audit
   trail, a standing-instructions surface in the cockpit (list / pause / cancel),
   timezone-aware recurrence rules.
4. **Validation hook**: beta users' actual asks ("daily digest"? "monthly invoice"?)
   rank which recurrence patterns to build — evidence per `moat-strategy.md`.

**Tier-1 compatibility rule**: Phase 3.5 stores the send time as one nullable
absolute-time field on the plan — a recurrence rule later becomes a sibling
structure that *mints* plans, so Tier 1's schema needs nothing speculative now.

## Amends (process rule: scope decisions name the PRD lines they change)

- `.planning/PROJECT.md` — Active requirement added ("Deferred send…", SCHD-01);
  Out of Scope gains "Recurring/standing-instruction sends" with pointer here;
  Key Decisions row added (2026-07-12).
- `.planning/REQUIREMENTS.md` — **SCHD-01** minted under new "Scheduling" section;
  traceability row Phase 3.5; count 43 → **44**.
- `.planning/ROADMAP.md` — **Phase 3.5: Deferred Send (INSERTED)** added after
  Phase 3.4 (zero renumber of 4–9), details section with success criteria.
