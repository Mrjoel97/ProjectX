// Agent activity-trace content-plane adapter (CLAUDE.md §1: thin adapter — this module only
// reads and writes rows; the decision about WHEN a step starts and ends belongs to the SDK's
// generateText lifecycle callbacks, Plan 02).
//
// Mirrors briefings.ts exactly, including its most important property: this module writes NO
// log-plane row. The trace is UI state, not an audit trail — the agent's refs-only audit trail
// already exists (mailbox.searched / mailbox.listed / briefing.created), written by the ACTING
// module. A second, less-governed shadow log here would be a §4 regression with no requirement
// behind it (03.9-RESEARCH §Anti-patterns).
//
// §4 on this path is enforced by the SCHEMA, not by vigilance: the row has no field that can
// hold text (see schema.ts). The human-readable verb is a code-owned map in the UI keyed off
// the closed `tool` union.
//
// The writers are internal (called from the agent loop); the reader is a tenantQuery so the
// browser subscribes and the trace fills live, guarded on ctx.tenantId.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { tenantQuery } from "./lib/functions";
import schema, { AGENT_STEP_REFUSAL } from "./schema";

// DERIVED from schema.ts — the single source of truth for the closed tool union (the briefings.ts
// ITEMS precedent: a hand-copied validator is a duplicate that WILL drift, and a drifted literal
// means a silently swallowed insert, since the SDK eats callback throws). ponytail rung 2.
const TOOL = schema.tables.agentSteps.validator.fields.tool;
/** The refusal union, REQUIRED here while the column is optional — one definition (schema.ts). */
const REFUSAL = AGENT_STEP_REFUSAL;

/**
 * The activity card shows at most 12 rows. Parallel tool calls and fallback attempts can exceed
 * that display bound; writers therefore join by the exact indexed step identity. Reads are
 * ALWAYS bounded — a `.collect()` here is the exact failure Phase 2 documented for `audit`:
 * it eventually exceeds Convex read limits and hard-fails rather than degrading.
 */
const TURN_STEP_CAP = 12;

/** What the UI renders. Named so the client can derive it via FunctionReturnType (cards.tsx). */
export type StepView = {
  stepKey: string;
  tool: string;
  phase: "running" | "done" | "error";
  startedAt: number;
  durationMs?: number;
};

/**
 * Open a step. Append-only: every attempt gets its own row, including the ones the fallback
 * retry re-runs — the trace is the one place a user can see that a retry occurred, and silently
 * de-duplicating it would hide something that really happened (research Pitfall 3).
 */
export const record = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    stepKey: v.string(),
    tool: TOOL,
    startedAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("agentSteps", { ...args, phase: "running" }),
});

/**
 * Close a step. Terminal on BOTH success and failure — `onToolExecutionEnd` fires either way,
 * discriminated by `toolOutput.type`, so a throwing tool cannot leave a spinner running.
 *
 * An unmatched (tenantId, turnId, stepKey) is a NO-OP, not a throw: an out-of-order or duplicate
 * finish must not blow up a mutation, and since the SDK swallows callback exceptions a throw here
 * would fail SILENTLY in production while every unit test passed (research Pitfall 6).
 */
export const finish = internalMutation({
  args: {
    tenantId: v.string(),
    turnId: v.string(),
    stepKey: v.string(),
    phase: v.union(v.literal("done"), v.literal("error")),
    durationMs: v.optional(v.number()),
    endedAt: v.number(),
  },
  handler: async (ctx, { tenantId, turnId, stepKey, phase, durationMs, endedAt }) => {
    // Preserve the original first-recorded match for duplicate keys; do not require uniqueness.
    const row = await ctx.db
      .query("agentSteps")
      .withIndex("by_turn_step", (q) =>
        q.eq("tenantId", tenantId).eq("turnId", turnId).eq("stepKey", stepKey),
      )
      .first();
    if (!row) return; // no-op
    await ctx.db.patch(row._id, { phase, durationMs, endedAt });
  },
});

/**
 * Stamp WHY a call ended without doing its work.
 *
 * Separate from `finish` on purpose, and it must stay separate. `finish` is driven by the SDK's
 * `onToolExecutionEnd`, which fires AFTER `execute` returns and cannot see the difference between
 * a refusal sentence and a success sentence — that is exactly the blindness this closes. The tool
 * itself is the only thing that knows, so the tool calls this at its own refusal exits, before it
 * returns. `finish` then patches `phase`/`durationMs`/`endedAt` and leaves `refusal` alone, which
 * is the ordering that always happens in production and is pinned by a test.
 *
 * An unmatched (tenantId, turnId, stepKey) is a NO-OP, not a throw — `finish`'s contract, for
 * `finish`'s reason: the SDK swallows callback exceptions, so a throw here would fail SILENTLY in
 * production while every unit test passed.
 */
export const refuse = internalMutation({
  args: {
    tenantId: v.string(),
    turnId: v.string(),
    stepKey: v.string(),
    refusal: REFUSAL,
  },
  handler: async (ctx, { tenantId, turnId, stepKey, refusal }) => {
    // Same exact join and duplicate-key behavior as finish, independent of the UI row cap.
    const row = await ctx.db
      .query("agentSteps")
      .withIndex("by_turn_step", (q) =>
        q.eq("tenantId", tenantId).eq("turnId", turnId).eq("stepKey", stepKey),
      )
      .first();
    if (!row) return; // no-op
    await ctx.db.patch(row._id, { refusal });
  },
});

/**
 * The tenant's NEWEST turn → feeds the activity card and the in-progress chat bubble.
 *
 * Takes NO threadId, deliberately. On the first message the browser has no threadId until
 * `sendCockpitMessage` RESOLVES — i.e. until the wait is already over — so a byThread-only read
 * would be `"skip"` for the entire first turn: blank at exactly the moment a first-time user
 * decides the product is broken (research Pitfall 1). The client filters on the returned
 * threadId instead. `tenantQuery({ args: {} })` is an established shape (cockpit.listThreads),
 * and the wrapper is what scopes this to one tenant (§2 — the multi-tenant linchpin).
 *
 * Explicit return type (Convex guidelines §96): inferred through the generated api it would
 * collapse sibling functions to `any`.
 */
export const latestTurn = tenantQuery({
  args: {},
  handler: async (ctx): Promise<{ threadId: string; steps: StepView[] } | null> => {
    // Rows are append-only, so index order (_creationTime) IS recency — `.order("desc").first()`
    // is the whole "newest turn" story, no scan (the briefings.byThread property). This needs
    // by_tenant (["tenantId"] alone): on an index with a threadId in the prefix, threadId would
    // dominate the sort and hand back the alphabetically-largest thread instead. See schema.ts.
    const newest = await ctx.db
      .query("agentSteps")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .first();
    if (!newest) return null;

    const steps = await ctx.db
      .query("agentSteps")
      .withIndex("by_turn", (q) => q.eq("tenantId", ctx.tenantId).eq("turnId", newest.turnId))
      .take(TURN_STEP_CAP);

    return {
      threadId: newest.threadId,
      // Ascending by startedAt so the UI renders them in the order they happened (insertion order
      // is close but not guaranteed — the awaited callbacks interleave with the driver's rows).
      steps: steps
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((s) => ({
          stepKey: s.stepKey,
          tool: s.tool,
          phase: s.phase,
          startedAt: s.startedAt,
          durationMs: s.durationMs,
        })),
    };
  },
});
