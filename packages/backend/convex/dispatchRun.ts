// THE DURABLE SPECIALIST RUN (42-02, G6). A dispatch stops being a bare `scheduler.runAfter` and
// becomes a journaled `@convex-dev/workflow` run with a terminal that fires whatever happens to it.
//
// DEFAULT RUNTIME, deliberately: `workflow.define` returns a RegisteredMutation, and `dispatch.ts`
// — which holds the three actions this steps into — is `"use node"` and may hold only actions. The
// argument validator and the fallback bodies therefore live in `lib/dispatchShared.ts`, which both
// sides import. `pipeline.ts` is the shipped precedent for a non-node workflow module stepping into
// a `"use node"` action (`pipeline.ts:243` → `internal.llm.route`, which is in the node `llm.ts`).
//
// ── THE MONEY RULE, AND WHY IT IS ONE LINE AND NOT THREE ──────────────────────────────────────
//
// The shared `WorkflowManager` sets `retryActionsByDefault: true` with `maxAttempts: 3`
// (`index.ts:10-11`). A specialist turn is NOT idempotent with respect to spend — `runSpecialistTurn`
// bills the model and `recordSpend` draws the rail down before any throw can be caught — so
// inheriting that default would turn one failed $0.02 turn into three. The repo already refused
// this exact bug one level down: `vaultIngestPool` leaves the flag at `false` because "`extractDoc`
// charges OCR pages via `recordSpend` before it reaches the ingest seam ... a silent retry would
// double-charge a reservation" (`index.ts:35-39`). The same sentence is true here, word for word.
//
// `{ retry: false }` on the step is what defeats it: the option flows verbatim into
// `workpool.enqueueAction`, and workpool's `getRetryBehavior` returns `undefined` on an explicit
// `false`, which means no retry behaviour at all. `pipeline.ts:243-247`, `:265-269`, `:347-351` and
// `smoke.ts:54` already do exactly this, on exactly the paid model call.
//
// ONE `workflow.define` with a `kind` switch, not three — and the reason is the failure mode. The
// dangerous edit here is an OMITTED option: a `step.runAction` written without `{ retry: false }`
// re-bills three times, with the compiler, biome and the whole behavioural suite blind to it. One
// call site cannot be half-omitted; three can. `dispatchRunGuard.test.ts` reads this file and pins
// that there is exactly ONE `step.runAction(` and that it carries the option.
//
// Durability is the ONLY thing bought here. The run's guards, its landing and its budget are
// unchanged: `governedDispatch`'s guard order, `dispatchAndLand`'s `finally`, and the envelope
// arithmetic at `dispatch.ts:474-481` are byte-identical.
import { vResultValidator, vWorkflowId, type WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { workflow } from "./index";
import { DISPATCH_ARGS, DISPATCH_KIND, failedMemoFor } from "./lib/dispatchShared";

/** Which action a run of each kind steps into. A record rather than a chain of `if`s so a fourth
 *  kind is a one-line addition that cannot forget the retry option — the option lives at the single
 *  call site below, not beside each target. */
const TARGET = {
  specialist: internal.dispatch.runSpecialist,
  research: internal.dispatch.runResearch,
  media: internal.dispatch.runMedia,
} as const;

/** The refs-only context the terminal receives back (CLAUDE.md §4). Ids, a code-owned `route`
 *  string and a code-owned `kind` literal — never the question, the brief, or a body. */
const RUN_CONTEXT = v.object({
  tenantId: v.string(),
  threadId: v.string(),
  planId: v.id("plans"),
  gapIndex: v.number(),
  route: v.string(),
  rootRequestId: v.string(),
  kind: DISPATCH_KIND,
});

/**
 * THE durable run. One step, because one paid action is all a dispatch is.
 *
 * The handler forwards its own workflow args VERBATIM as the step args, which is what makes replay
 * safe across a deploy: the journal compares the re-issued step's `{name, kind, args}` against the
 * recorded one, so a derivation that never changes can never mismatch. `unstableArgs` is
 * deliberately NOT set — it would permanently disable that check for no measured benefit.
 *
 * Nothing non-deterministic may run here. The workflow environment deletes `crypto` and `process`
 * before the handler executes, so `rootRequestId` is minted by the CALLER and travels in the args.
 */
export const dispatchRun = workflow.define({
  args: { kind: DISPATCH_KIND, ...DISPATCH_ARGS },
  handler: async (step, { kind, ...args }): Promise<null> => {
    // { retry: false } — READ THE MONEY RULE IN THIS FILE'S HEADER BEFORE TOUCHING THIS LINE.
    // Without it the shared manager retries a BILLED model turn up to three times.
    await step.runAction(TARGET[kind], args, { retry: false });
    return null;
  },
});

/**
 * THE way a dispatch is started, replacing three bare `scheduler.runAfter(0, internal.dispatch.*)`
 * calls (`evaluations.ts` applyActOnGap, and the two cockpit tools in `llm.ts`).
 *
 * A starter MUTATION rather than each caller invoking `workflow.start` itself, for one reason that
 * matters: `llm.ts` is `"use node"` and cannot import `workflow` from `./index`. This keeps the
 * node side calling `ctx.runMutation(internal.dispatchRun.startDispatchRun, …)` — a one-symbol swap
 * from what it did before — and keeps every workflow symbol on the V8 side.
 *
 * The `workflowId` lands on the plan row so the reliability sweep can ask the component whether the
 * run is still alive instead of guessing from `_scheduled_functions`. That column already exists
 * (`schema.ts`, `workflowId`) and `resetPlan` deliberately does not clear it, which is safe because
 * a start always overwrites it.
 */
export const startDispatchRun = internalMutation({
  args: { kind: DISPATCH_KIND, ...DISPATCH_ARGS },
  handler: async (ctx, args): Promise<string> => {
    const { kind, tenantId, threadId, planId, gapIndex, route, rootRequestId } = args;
    const workflowId = await workflow.start(ctx, internal.dispatchRun.dispatchRun, args, {
      onComplete: internal.dispatchRun.onDispatchComplete,
      context: { tenantId, threadId, planId, gapIndex, route, rootRequestId, kind }, // refs only (§4)
    });
    await ctx.db.patch(planId, { workflowId });
    return workflowId;
  },
});

/**
 * THE TERMINAL. `onComplete` fires once per workflow, on success, on failure and on cancellation —
 * including the case `dispatchAndLand`'s `finally` cannot reach, where the action never returns at
 * all. That is the whole durability claim, stated honestly: the run gets a SECOND, FREE, idempotent
 * landing attempt. It is not a rescue from eviction, and it is not a re-run.
 *
 * WHY THIS CANNOT DOUBLE-CHARGE, which is the property owner decision 2 protects.
 * `landSpecialistResult` is a MUTATION and calls no model. Its CAS returns early unless the row is
 * still `collecting` AND `kind === "memo"` AND the tenant matches, so on the normal path — where
 * the action's own `finally` already landed the row — this is a no-op that writes nothing. On the
 * path where the action died before landing, it is the only landing there will be. Free either way.
 */
export const onDispatchComplete = internalMutation({
  args: { workflowId: vWorkflowId, result: vResultValidator, context: RUN_CONTEXT },
  handler: async (ctx, { result, context }): Promise<void> => {
    if (result.kind === "success") return; // the action landed its own row; nothing to do

    // Refs and a CODE only — never `result.error`, which can carry prompt or grounded prose (§4).
    // `subagent.refused` with `reason` is already the shape this path writes at `dispatch.ts`, and
    // it is already on the read-time allowlist, so no projection change is needed.
    await ctx.runMutation(internal.audit.log, {
      tenantId: context.tenantId,
      correlationId: context.rootRequestId,
      eventType: "subagent.refused",
      actor: "system",
      payload: {
        rootRequestId: context.rootRequestId,
        planId: String(context.planId),
        specialist: context.route,
        reason: "error",
      },
    });

    await ctx.runMutation(internal.evaluations.landSpecialistResult, {
      tenantId: context.tenantId,
      threadId: context.threadId,
      planId: context.planId,
      gapIndex: context.gapIndex,
      route: context.route,
      incomplete: false,
      fallbackReason: "error",
      // The kind's own honest sentence. A research or media run has no evaluation row and no gap,
      // so the gap path's LOST_CONTEXT_MEMO ("the evaluation it was based on is no longer on file")
      // is FALSE for it — the exact dead-end those two constants exist to remove.
      ...(failedMemoFor(context.kind) === undefined
        ? {}
        : { fallbackBody: failedMemoFor(context.kind) }),
    });
  },
});

/**
 * Is this plan's dispatch still running? Asks the workflow component directly.
 *
 * `workflow.status` THROWS on an id the component cannot resolve (its handler asserts), so the call
 * is wrapped: an unresolvable id means "not live as far as we can tell", and the caller falls
 * through to its legacy scan. A throw here would kill the sweep batch this runs inside — the
 * watchdog the caller exists to keep honest.
 */
export async function dispatchWorkflowLive(
  ctx: Parameters<typeof workflow.status>[0],
  workflowId: string,
): Promise<boolean | null> {
  try {
    const status = await workflow.status(ctx, workflowId as WorkflowId);
    return status.type === "inProgress";
  } catch {
    return null; // unresolvable id — the caller decides what to do with "unknown"
  }
}
