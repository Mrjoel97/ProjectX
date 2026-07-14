# ADR-004: Agents and humans are peer actors over shared governed state; irreversible actions are human-only mutations

- **Status**: Accepted (2026-07-14 — owner-commissioned from the agent-architecture analysis and committed at owner direction)
- **Recorded**: 2026-07-14 (pattern already live since Phase 3.2.1 — this ADR names it so future features follow it deliberately, not by accident)

## Context

Pikar has two kinds of users from day one: **humans** (paying customers operating the
product) and **agents** (the Executive Agent and future sub-agents acting on the
customer's behalf). Every feature must serve both. Phase 3.2.1 proved a pattern for
this in the cockpit: the FSM was swapped for an agent tool-loop with zero UI changes,
*because* the UI only ever watched the `plans` row — it never knew or cared which actor
mutated it. Without a named rule, future features could drift into agent-hostile shapes
(logic locked inside UI handlers) or human-hostile ones (agent-only state with no
surface), or — worst — agents driving UIs directly.

## Decision

Every capability is built as **one source-of-truth table + two actuation paths + one
audit trail**:

- **Shared state**: a Convex table is the single source of truth (e.g. `plans`).
  Content lives there; the UI renders it reactively.
- **Human path**: UI → tenant-scoped mutations (type, click, Approve).
- **Agent path**: governed **tools** → the *same underlying mutations*. A tool is a
  thin wrapper that validates at the boundary and patches shared state; the UI
  re-renders without knowing which actor moved it.
- **Same guards for both actors**: validation and invariants are enforced at the
  mutation/tool boundary, never in the UI and never by trusting the model.
  **Structural facts are never model-invented** — addresses, indices, amounts, times
  are validated or server-resolved inside the tool.
- **Irreversible or outward-facing actions (send, pay, delete, publish) are
  human-only mutations, NEVER agent tools.** The agent's ceiling is a *proposal*
  (e.g. `proposePlan` flips state to `proposed`); a human mutation (`executePlan`)
  is the sole trigger of consequence. This must stay grep-provable (single
  `workflow.start` call site per consequence).
- **Agents act on state, never on surfaces.** No tool may simulate UI interaction,
  click, or navigate. A new agent capability is a new named, validated tool — which
  is also what makes it auditable and testable in isolation.
- **An agent is defined as**: a *skill* (versioned registry prompt, ADR-003) + a
  *tool set* + a *loop config* (model, step cap, timeout, fallback) + a *guardrail
  policy* (preCall before every model call, spend recorded after). See
  `docs/playbooks/agent-runtime.md` for the operating recipe.

## Alternatives rejected

- **Agent drives the UI (computer-use / simulated clicks)**: brittle, unauditable,
  bypasses tool-boundary validation, and already excluded by REQUIREMENTS.md
  ("Computer-use / desktop RPA" out of scope).
- **Separate agent-owned data plane** (agent writes its own tables, synced to user
  tables): two sources of truth, sync bugs, double the isolation surface. The whole
  value of the pattern is that reactivity gives the human a live view of agent work
  for free.
- **Guarded send-as-a-tool** (let the agent call `executePlan` behind a confirmation
  flag): a flag is a prompt-injection away from flipped. Capability absence is
  structural; capability gating is probabilistic. Scoped grants (campaign approval,
  standing rules — deferred capabilities #2/#3) must arrive as *grants checked inside
  the human-gated mutation*, not as tools.
- **Framework-owned agent state** (LangGraph/CrewAI-style runtime holding the loop
  and memory): replaces the ~30-line cheap part (`generateText` loop) while fighting
  the expensive parts we own (Convex durability, guardrails, tenancy, audit).

## Consequences

- Feature shape is prescribed: schema first, mutations with invariants second, tools
  third, UI last. A feature whose logic lives in a React handler is wrong by
  construction — the agent can't reach it.
- Swapping agent engines, models, or adding a second concurrent agent never touches
  UI components (proven by the 3.2.1 cutover).
- Every agent capability is individually unit-testable (tool boundary) and
  individually auditable (refs-only event per tool).
- The Phase 5 knowledge vault enters the agent as a retrieval *tool* + grounding
  step over vault tables — not ad-hoc prompt stuffing.
- Cost: each capability needs the tool wrapper written and tested even when a human
  UI already exists. That duplication is the governance boundary, not overhead.
- See `docs/playbooks/agent-runtime.md` for procedures (new-tool checklist,
  new-agent recipe).
