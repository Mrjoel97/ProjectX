// The action-retrier terminal for the calendar externalAction arm. NOT "use node": this is an
// internalMutation, while the Node calendar.ts module may hold only actions (the 01-07 rule;
// gmail.ts ↔ gmailAuth.ts is the shipped precedent). This is the SINGLE writer of plan status,
// audit, and dead letters for the calendar write arm.
//
// The retrier terminal receives ONLY {runId, result}; unlike the workflow terminal there is no
// context passthrough. A successful return carries refs from createEvent. A failed or canceled run
// is resolved through plans.by_calendar_run because runId is the only correlation handle supplied.
import { onCompleteValidator } from "@convex-dev/action-retrier";
import { CALENDAR_FAILURE_CODES, type CalendarFailureCode, RECONNECT } from "@pikar/core";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { CreateEventResult, ManageEventResult } from "./calendar";

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
        // 17-08 Task 1: the durable registry row is written BEFORE the plan is marked done, and the
        // order is the guarantee. Marking the plan first would leave a done plan whose event exists
        // on a real calendar with nothing recording its provider/id/etag — an event Pikar created
        // and can never manage, with no signal that anything is missing. If this insert throws, the
        // mutation rolls back and the retrier redelivers against a plan still at `delivering`.
        //
        // The row is built from the plan's OWN staged fields, never from anything the model or the
        // provider echoed back: the title and instant a human approved are the only ones that may
        // become a durable record.
        if (
          plan.eventTitle !== undefined &&
          plan.eventStartMs !== undefined &&
          plan.eventDurationMs !== undefined &&
          plan.eventTz !== undefined
        ) {
          await ctx.runMutation(internal.calendarEvents.upsertManaged, {
            tenantId: value.tenantId,
            sourcePlanId: value.planId,
            provider: value.provider,
            externalEventId: value.eventId,
            // `null` from the wire means "unknown version" — drop the key rather than store null,
            // so `manageability` reports `needs_inspection` instead of reading a falsy etag.
            ...(value.etag === null ? {} : { etag: value.etag }),
            title: plan.eventTitle,
            startMs: plan.eventStartMs,
            durationMs: plan.eventDurationMs,
            tz: plan.eventTz,
            // The create writer has never been able to send guests (17-04's attendee scan).
            attendeeFree: true,
          });
        }
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

// ── 17-08 Task 3: the MANAGEMENT terminal ──────────────────────────────────────────────────────
//
// Sibling of `onCreateComplete`, and deliberately a second function rather than a branch inside it:
// the two write different tables, different audit names and different terminal states, and a shared
// body would make "did the shipped create path change?" un-answerable by a diff — the same reason
// `calendarManagement.ts` is a second module beside `calendar.ts`.

/** Exact parsing. An unreadable result is DROPPED, never guessed at: writing a "probably updated"
 *  row from a shape we could not read is how a registry stops describing the calendar. */
function manageEventResult(value: unknown): ManageEventResult | null {
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
  // Absent provider means Google — the same rule the schema states for `plans.calendarProvider`,
  // and the same tolerance `onCreateComplete` extends to a result produced by a previous deploy.
  const provider = row.provider === "microsoft" ? "microsoft" : "google";

  if (
    (row.outcome === "updated" || row.outcome === "deleted") &&
    typeof row.managedEventId === "string"
  ) {
    const managedEventId = row.managedEventId as Id<"calendarEvents">;
    return row.outcome === "updated"
      ? {
          ...refs,
          outcome: "updated",
          managedEventId,
          provider,
          etag: typeof row.etag === "string" ? row.etag : null,
        }
      : { ...refs, outcome: "deleted", managedEventId, provider };
  }
  if (row.outcome === "refused" && typeof row.code === "string") {
    const code = CALENDAR_FAILURE_CODES.find((c) => c === row.code);
    // A code outside the closed vocabulary is not a refusal we can render, so it is not a refusal
    // we accept. Falling back to a generic one would put an unbounded string on a plan row.
    return code ? { ...refs, outcome: "refused", code } : null;
  }
  if (row.outcome === "reauth") return { ...refs, outcome: "reauth", provider };
  if (
    row.outcome === "terminal" &&
    typeof row.status === "number" &&
    typeof row.reason === "string"
  ) {
    return { ...refs, outcome: "terminal", status: row.status, reason: row.reason };
  }
  return null;
}

/** STATIC copy per code — no event title, no time, no etag, no provider prose (§4). The etag is
 *  exactly what moved in a conflict, so quoting it would put the one moving part into a row the
 *  user reads. `provider_unsupported` names the limitation because ADR-023 requires the absence to
 *  be a visible product surface rather than a silent hole. */
const REFUSAL_MESSAGE: Record<CalendarFailureCode, string> = {
  conflict:
    "That calendar event changed since you approved this — nothing was written. Ask me again and I'll restage it against the current version.",
  not_found: "That calendar event no longer exists, so there was nothing to change.",
  reauth: "I couldn't reach your calendar — reconnect it and ask me again.",
  attendees_present:
    "That event now has guests, so I left it alone — changing it could email them without going through your approvals.",
  needs_inspection:
    "I don't have a current version for that event yet, so I didn't write to it. Ask me again and I'll re-read it first.",
  not_managed: "I can only change events I created for you.",
  provider_unsupported:
    "Microsoft Outlook can't cancel an event safely through its API, so I did not touch it — the event is still on your calendar. Delete it in Outlook, or ask me to move it instead.",
  provider_error: "Your calendar provider refused that change, so nothing was written.",
};

export const onManageComplete = internalMutation({
  args: onCompleteValidator,
  handler: async (ctx, { runId, result }): Promise<void> => {
    if (result.type === "success") {
      const value = manageEventResult(result.returnValue);
      if (!value) return;

      // Re-read the plan and hold it to all three facts. A completion for another tenant, another
      // kind, or a plan that has already moved on writes NOTHING — that is what makes a replayed or
      // forged result harmless.
      const plan = await ctx.db.get(value.planId);
      if (
        plan?.kind !== "calendar_manage" ||
        plan.tenantId !== value.tenantId ||
        plan.status !== "delivering"
      ) {
        return;
      }

      const audit = (
        eventType: string,
        managedEventId: Id<"calendarEvents">,
        provider: string,
        operation: string,
      ) =>
        ctx.runMutation(internal.audit.log, {
          tenantId: value.tenantId,
          correlationId: value.correlationId,
          eventType,
          actor: "system",
          // Refs and CODES only. Never the title, never the etag, never a provider body.
          payload: { planId: value.planId, managedEventId, provider, operation },
        });

      if (value.outcome === "updated") {
        // ORDER IS THE GUARANTEE, exactly as in `onCreateComplete`: the registry is written BEFORE
        // the plan is marked done. Marking first would leave a done plan whose provider event has
        // moved while the row still describes the old state — and no signal anything is stale.
        //
        // The state written is recomputed from the PLAN's own staged fields, never echoed out of
        // the provider result: the title and instant a human approved are the only ones that may
        // become a durable record. An absent staged field means "leave it alone".
        await ctx.runMutation(internal.calendarEvents.applyUpdate, {
          tenantId: value.tenantId,
          managedEventId: value.managedEventId,
          ...(value.etag === null ? {} : { etag: value.etag }),
          ...(plan.eventTitle === undefined ? {} : { title: plan.eventTitle }),
          ...(plan.eventStartMs === undefined ? {} : { startMs: plan.eventStartMs }),
          ...(plan.eventDurationMs === undefined ? {} : { durationMs: plan.eventDurationMs }),
        });
        await ctx.db.patch(value.planId, { status: "done" });
        await audit("calendar.event.updated", value.managedEventId, value.provider, "update");
        return;
      }

      if (value.outcome === "deleted") {
        await ctx.runMutation(internal.calendarEvents.markDeleted, {
          tenantId: value.tenantId,
          managedEventId: value.managedEventId,
        });
        await ctx.db.patch(value.planId, { status: "done" });
        await audit("calendar.event.deleted", value.managedEventId, value.provider, "delete");
        return;
      }

      if (value.outcome === "refused") {
        // A BOUNDED terminal state. `canceled` is the only terminal non-success status, and it is
        // literally true here: the act was halted before it changed anything, on either plane.
        // `cancelKind: "refused"` says WHO stopped it — see the schema note.
        await ctx.db.patch(value.planId, {
          status: "canceled",
          cancelKind: "refused",
          calendarFailureCode: value.code,
          canceledAt: Date.now(),
        });
        await ctx.runMutation(internal.notifications.notify, {
          tenantId: value.tenantId,
          kind: "calendar_manage_refused",
          message: REFUSAL_MESSAGE[value.code],
        });
        return;
      }

      if (value.outcome === "reauth") {
        // PROVIDER-SPECIFIC. A Microsoft outage that wrote `gmail_reconnect` would send the user to
        // the Google consent screen to fix an Outlook connection: the banner clears, the real
        // problem stands. The plan stays `delivering` — recoverable, as `onCreateComplete` leaves
        // its own reauth case.
        await ctx.runMutation(internal.notifications.notify, {
          tenantId: value.tenantId,
          kind: RECONNECT[value.provider].kind,
          message: RECONNECT[value.provider].holdMessage,
        });
        return;
      }

      await ctx.db.insert("deadLetters", {
        tenantId: value.tenantId,
        correlationId: value.correlationId,
        workflowId: String(runId),
        payload: { planId: value.planId, status: value.status },
        error: `calendar_manage ${value.status} ${value.reason}`,
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

    // A failed/canceled run carries only {runId, result}, so the plan is resolved through the same
    // `by_calendar_run` index the create terminal uses — `calendarRunId` is the COMMON Calendar run
    // correlation column, shared by both occupants of the arm.
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
