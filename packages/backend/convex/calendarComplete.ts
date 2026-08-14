// The action-retrier terminal for the calendar externalAction arm. NOT "use node": this is an
// internalMutation, while the Node calendar.ts module may hold only actions (the 01-07 rule;
// gmail.ts ↔ gmailAuth.ts is the shipped precedent). This is the SINGLE writer of plan status,
// audit, and dead letters for the calendar write arm.
//
// The retrier terminal receives ONLY {runId, result}; unlike the workflow terminal there is no
// context passthrough. A successful return carries refs from createEvent. A failed or canceled run
// is resolved through plans.by_calendar_run because runId is the only correlation handle supplied.
import { onCompleteValidator } from "@convex-dev/action-retrier";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { CreateEventResult } from "./calendar";

function createEventResult(value: unknown): CreateEventResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.planId !== "string" ||
    typeof row.tenantId !== "string" ||
    typeof row.correlationId !== "string"
  ) {
    return null;
  }

  const refs = {
    planId: row.planId as Id<"plans">,
    tenantId: row.tenantId,
    correlationId: row.correlationId,
  };
  if (
    row.outcome === "created" &&
    typeof row.eventId === "string" &&
    typeof row.duplicate === "boolean"
  ) {
    return {
      ...refs,
      outcome: "created",
      eventId: row.eventId,
      duplicate: row.duplicate,
      // 17-07: NOT required in the runtime check, deliberately. A retrier result produced by the
      // PREVIOUS deploy can still be in flight when this one lands, and rejecting it here would
      // strand a real created event as an unparseable result — the plan would sit at `delivering`
      // forever with the event existing in the provider. Absent provider means Google, the same
      // rule the schema states for `plans.calendarProvider`; absent etag means "unknown version".
      provider: row.provider === "microsoft" ? "microsoft" : "google",
      etag: typeof row.etag === "string" ? row.etag : null,
    };
  }
  if (row.outcome === "reauth") return { ...refs, outcome: "reauth" };
  if (
    row.outcome === "terminal" &&
    typeof row.status === "number" &&
    typeof row.reason === "string"
  ) {
    return { ...refs, outcome: "terminal", status: row.status, reason: row.reason };
  }
  return null;
}

export const onCreateComplete = internalMutation({
  args: onCompleteValidator,
  handler: async (ctx, { runId, result }): Promise<void> => {
    if (result.type === "success") {
      const value = createEventResult(result.returnValue);
      if (!value) return;

      const plan = await ctx.db.get(value.planId);
      if (
        plan?.kind !== "calendar_event" ||
        plan.tenantId !== value.tenantId ||
        plan.status !== "delivering"
      ) {
        return;
      }

      if (value.outcome === "created") {
        await ctx.db.patch(value.planId, {
          status: "done",
          calendarEventId: value.eventId,
        });
        await ctx.runMutation(internal.audit.log, {
          tenantId: value.tenantId,
          correlationId: value.correlationId,
          eventType: "calendar.event.created",
          actor: "system",
          payload: { planId: value.planId, eventId: value.eventId },
        });
        return;
      }

      if (value.outcome === "reauth") {
        await ctx.runMutation(internal.notifications.notify, {
          tenantId: value.tenantId,
          kind: "gmail_reconnect",
          message:
            "I couldn't reach Google Calendar — reconnect Google Mail + Calendar to continue.",
        });
        return;
      }

      await ctx.db.insert("deadLetters", {
        tenantId: value.tenantId,
        correlationId: value.correlationId,
        workflowId: String(runId),
        payload: { planId: value.planId, status: value.status },
        error: `calendar_insert ${value.status} ${value.reason}`,
        status: "new",
        createdAt: Date.now(),
      });
      await ctx.runMutation(internal.audit.log, {
        tenantId: value.tenantId,
        correlationId: value.correlationId,
        eventType: "deadletter.written",
        actor: "system",
        payload: { workflowId: String(runId), kind: "terminal", status: "new" },
      });
      return;
    }

    // ponytail: one indexed lookup, directly in this non-Node mutation. A helper query would only
    // add another function boundary around the sole runId→plan resolution.
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_calendar_run", (q) => q.eq("calendarRunId", String(runId)))
      .unique();
    if (!plan) return;

    const error = result.type === "failed" ? result.error : "canceled";
    const correlationId = plan.correlationId ?? "";
    await ctx.db.insert("deadLetters", {
      tenantId: plan.tenantId,
      correlationId,
      workflowId: String(runId),
      payload: { planId: plan._id, runId: String(runId) },
      error,
      status: "new",
      createdAt: Date.now(),
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: plan.tenantId,
      correlationId,
      eventType: "deadletter.written",
      actor: "system",
      payload: { workflowId: String(runId), kind: result.type, status: "new" },
    });
  },
});
