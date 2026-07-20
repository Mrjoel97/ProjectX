# Deferred items — Phase 06 Live Voice Sessions

Out-of-scope discoveries logged during execution / owner UAT (not built here — the scope
boundary rule: only build what the phase's requirements cover; new capability gets a
deliberate future slot, never a squeeze-in).

## From owner UAT 2026-07-21 (post-close) — brief→plan is email-only

- **A voice brief cannot become a NON-EMAIL "step-by-step plan" directly; the agent asks
  what to do with it.** Clicking "Turn this into a plan" (VOIC-04) seeds the cockpit thread
  with the brief's Decisions + Action items, but the Executive Agent (`cockpit-agent` skill)
  is an **email-composition** agent: a "plan" to it is recipients + subject + body. A brief
  carries none of those, so — correctly and safely (ADR-004: never guess an outward action /
  a recipient) — it asks one clarifying question ("email this? summarize it?") instead of
  auto-producing a filled plan. The owner expected a plan to appear on click and had to
  answer the agent first.

- **Why NOT fixed now (by design, not a bug):** Phase 6 **SC#4 is met** — "an approved plan
  enters the normal request pipeline with the review gate" works end to end (the owner drove
  a brief → email + PDF → real governed send successfully). The gap is a UX-expectation
  mismatch (the button implied an instant plan), not a functional failure. A true
  brief→structured-plan / task-list that isn't email-shaped is **genuinely new agent
  capability** (a new plan *type* + governed tools), and it is **not** covered by any later
  roadmap phase (7 = resilience/ops, 8 = SkillOpt prompt-tuning, 9 = beta productionization).
  Building it now would be scope creep on a closed phase.

- **What WAS done now (honesty-only, no behavior change):** renamed the PostCall button from
  "Turn this into a plan" → "Continue with your agent" (+ matching supporting copy) so it no
  longer over-promises an instant plan. The handoff behavior is unchanged.

- **Fix owner / upgrade path (future milestone, deliberate):** broaden the Executive Agent's
  notion of a "plan" beyond email — e.g. a task-list / saved-summary plan type, or (lighter)
  a more directive brief seed that drafts a proposable body from the action items and asks
  ONLY for the recipient. Any new plan type MUST arrive as a governed tool + the existing
  human Approve gate (ADR-004), never as agent-driven UI or an ungated send. Relevant seams:
  `packages/voice/src/brief.ts` `planSeedFromBrief` (the seed text), the `cockpit-agent`
  skill (eval-gated, Phase 3.6), and `plans` schema/tools (cockpit.ts / cockpitTools.ts).
