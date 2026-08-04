// The lean cockpit delivery workflow (DLVR-01 / SC4-SC5). Fans out the existing
// governed per-send step (pipeline.ts step 4) once per recipient row, grouped by
// planId. Reuses gmail.send + workpool retries + audit + telemetry + DLQ VERBATIM —
// the ONLY new code here is the fan-out loop + per-recipient try/catch isolation.
//
// Approve-time (executePlan, plan 07) seeds one `requests` row per recipient (same
// body, distinct recipient + distinct correlationId, shared planId) then starts this
// workflow. Each row carries its OWN correlationId so audit/telemetry/DLQ key by it —
// a shared cid would collapse per-recipient isolation (telemetry write-once would drop
// all but the first). Isolation IS the try/catch: a recipient whose send throws
// terminally is caught, dead-lettered on its own row, and the loop continues (SC5); the
// workflow still returns success, so the onComplete catch-all archives nothing (correct —
// RESEARCH-delivery §8.6).
//
// step.runAction (workpool default retries), NOT retrier.run: a workflow handler has no
// scheduler ctx (02-06). deliverApprovedPlan is the delivery lane's sole workflow;
// executePlan (plan 07) is its sole starter (the zero-sends-before-Approve invariant).
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { workflow } from "./index";

export const deliverApprovedPlan = workflow.define({
  args: {
    planId: v.id("plans"),
    tenantId: v.string(),
    requestIds: v.array(v.id("requests")),
    correlationIds: v.array(v.string()), // parallel to requestIds — deterministic, no extra read
  },
  handler: async (step, { planId, tenantId, requestIds, correlationIds }): Promise<null> => {
    for (let i = 0; i < requestIds.length; i++) {
      const requestId = requestIds[i];
      const correlationId = correlationIds[i];
      if (!requestId || !correlationId) continue; // parallel arrays; guards noUncheckedIndexedAccess
      await step.runMutation(internal.pipeline.setStatus, { requestId, status: "delivering" });
      try {
        const result = await step.runAction(internal.gmail.send, { requestId }); // workpool retries
        if (!result.delivered) continue; // held at awaiting_reauth — a hold, not a failure
        await step.runMutation(internal.pipeline.setStatus, { requestId, status: "sent" });
        // No LLM ran in a pure delivery fan-out → empty usage/decision accumulators.
        await step.runMutation(internal.telemetry.writeTerminal, {
          requestId,
          correlationId,
          outcome: {
            reviewOutcome: "sent",
            durationMs: 0,
            decisionCounts: {},
            regenerateCount: 0,
            usages: [],
          },
        });
      } catch (e) {
        // Per-recipient isolation (SC5): dead-letter THIS row on its own cid, keep the loop going.
        await step.runMutation(internal.deadLetter.deadLetterRecipient, {
          tenantId,
          requestId,
          correlationId,
          workflowId: String(step.workflowId),
          error: String(e),
        });
      }
    }
    await step.runMutation(internal.deliverApprovedPlan.markPlanDone, { planId });
    return null;
  },
});

// Local plan-done setter so Plan 04 compiles standalone in Wave 2 (no dependency on
// Plan 06's richer setPlanStatus, which Plan 07 uses for the approve-gate transitions).
export const markPlanDone = internalMutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    await ctx.db.patch(planId, { status: "done" });
  },
});
