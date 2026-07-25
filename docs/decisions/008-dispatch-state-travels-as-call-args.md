# ADR-008: Dispatch lineage and limit state travel as validator-checked call args, never as DB state

- **Status**: Accepted (2026-07-25 — Phase 15, DISP-01; recorded with the first governed dispatch)
- **Recorded**: 2026-07-25 (`packages/backend/convex/dispatch.ts` — `runSpecialist`)

## Context

The governed dispatcher (SC #2/#3/#5) needs six pieces of state to travel from the executive turn
into a specialist run, and to keep travelling if the tree ever grows past one hop:

| Field | Purpose |
| --- | --- |
| `rootRequestId` | the correlation key the whole call tree is keyed on (SC #3) |
| `parentAgentId` | the EDGE — who dispatched this hop |
| `depth` | the `MAX_DEPTH` cap (SC #2) |
| `ancestry` | the `wouldCycle` A→B→A refusal (SC #2) |
| `envelopeCents` | the tree's ONE cost ceiling |
| `spentCents` | how much of that ceiling the tree has already drawn down |

A Convex **action has no ambient context**: there is no request-scoped store, and a `ctx` cannot be
extended across a `runAction` boundary — the callee gets a fresh `ctx` and exactly the args the
caller passed. So this state either travels as **arguments** or it is **persisted and re-read**.
There is no third option, and `dispatch.ts` is `"use node"`, so it cannot even hold a `ctx.db`
handle of its own.

## Decision

**All six travel as arguments on an `internalAction`, checked at the boundary by Convex
validators** (`dispatchArgs` in `dispatch.ts`, shared by the production entry point and the offline
twin so the two cannot drift). Nothing about a dispatch's lineage or its limits is persisted as
mutable run state.

Two properties fall straight out:

- **Checked at every hop.** The validators run on every call, so a malformed `depth` or a missing
  `rootRequestId` is a boundary rejection, not a runtime surprise three frames in.
- **Structurally non-suppliable by the model.** `runSpecialist` is an `internalAction`. It is not in
  `buildCockpitTools`, so no tool `execute` can reach it and no model output can set `depth: 0` or
  hand itself a fresh `envelopeCents`. This is the `runCockpitAgent.skillVersions` precedent
  (`llm.ts:1935-1938`) applied to the governance plane.

At `MAX_DEPTH = 1` the entire travelling state is **five scalars and one small array**.

## Also recorded: `rootRequestId` is minted fresh, and it is NOT `planId`

`rootRequestId = crypto.randomUUID()` at the dispatch entry point. Two nearby identifiers look like
they would do and neither does:

- **`planId` is not a per-run identity.** `plans.byThread` is a `.unique()` read and 12-05 made
  `actOnGap` **RECYCLE** the thread's single plan row rather than insert a second. Two dispatches on
  one thread would therefore collide on the same `planId`, and `audit.by_correlation` would return
  one merged, unreconstructable tree.
- **`plans.correlationId` is not set yet.** It is written at `executePlan` (`schema.ts:251`) — i.e.
  *after* the human Approve gate. A dispatch happens BEFORE Approve (the specialist's output is what
  the human then approves), so at dispatch time that field is empty.

`planId` still rides the audit payload as a ref, because "which plan was this hop working on" is a
real question. It is just not the tree's identity.

## Alternatives rejected

- **A `subAgentRuns` row (or any DB row) holding the live state.** Read-modify-write across a
  NON-transactional action: an action's `runQuery`/`runMutation` calls are separate transactions, so
  two hops racing on a `spentCents` field is a lost update — and the envelope, whose entire job is
  to be a ceiling, is exactly the field that would be lost. It also adds a row to create, clean up
  and reconcile on a thrown hop, for zero benefit at depth 1. And a second run-state plane beside an
  insert-only `audit` is the anti-pattern §3 exists to prevent.
- **Deriving the state at each hop instead of carrying it.** `depth` and `ancestry` have no
  derivable source; re-deriving the envelope from `remainingDailyCents` at every hop turns ONE tree
  ceiling into a FRESH allowance per hop, which is the opposite of the guarantee. (Mutation-checked:
  making the derivation unconditional turns three envelope tests red.)
- **A public (client-callable) entry point.** Then `depth`/`envelopeCents` are caller-supplied from
  outside the trust boundary, and the cap is advisory.
- **Convex components' workflow state.** A durable workflow gives real per-run state, but the whole
  point of dispatch is that it is a SEQUENTIAL second call into the ONE loop, not orchestration.
  Adding a workflow would add rows, latency and a second failure plane to a synchronous
  return-a-value call.

## Consequences

- **Raising `MAX_DEPTH` later changes ONE constant.** `ancestry` already travels and `wouldCycle`
  already runs, so the A→B→A refusal is correct on the day depth rises rather than being written
  then. The tests for it already exist (`dispatch.test.ts`), which is why cycle refusal shipped at a
  depth where it is structurally unreachable.
- **The caller owns the threading.** A multi-hop caller must pass hop N's returned `spentCents` and
  `envelopeCents` into hop N+1. `DispatchResult` returns both on the success arm specifically so
  that is a copy, not a computation. Forgetting to thread them yields a fresh allowance per hop —
  asserted against in `dispatch.test.ts` ("the envelope is drawn down ACROSS hops").
- **Adding a seventh field is an arg, a validator entry, and a payload key** — visible in one
  file, with no migration.
- **Lineage is reconstructed, not stored.** There is no run table to query: the tree IS
  `audit.by_correlation(rootRequestId)` ordered by `ts`, and the tree's cost is a SUM over those
  rows. Zero new tables, zero new indexes, zero schema change (Wave 0 froze `schema.ts`).
