"use node";

// Google Calendar's thin HTTP adapter (CLAUDE.md §1). Pure availability windows, scope checks,
// event-id derivation, and RFC3339 conversion live in @pikar/core/calendar. This Node module holds
// actions ONLY: its DB terminal lives in the non-Node calendarComplete.ts because a "use node"
// module cannot contain a mutation. Both actions reuse freshAccessToken from gmail.ts — the ONE
// token-refresh root. Epoch-ms values become RFC3339 only here, at the provider boundary.
import {
  type AvailabilityRange,
  availabilityWindow,
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_FREEBUSY_SCOPE,
  type CalendarProvider,
  eventIdFor,
  hasScope,
  parseCalendarProvider,
  toRfc3339,
} from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { freshAccessToken } from "./gmail";

const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";
const EVENTS_INSERT_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

type BusyRange = { startMs: number; endMs: number };

type FreeBusyResult =
  | { ok: true; busy: BusyRange[]; fixture: boolean }
  | { ok: false; reason: "not_connected" | "reauth" | "unavailable" };

export type CreateEventResult = {
  planId: Id<"plans">;
  tenantId: string;
  correlationId: string;
} & // the create/GET response, and a later round-trip to fetch it is a second chance to be wrong. // (17-08, gated on the Graph probe); it is captured now because both providers offer it only on // holds the event and its durable version. The etag is what event-specific concurrency needs // 17-07: `provider` and `etag` widen the CREATED variant so the terminal records WHICH calendar
(
  | {
      outcome: "created";
      eventId: string;
      duplicate: boolean;
      provider: CalendarProvider;
      etag: string | null;
    }
  | { outcome: "reauth" }
  | { outcome: "terminal"; status: number; reason: string }
);

type GoogleFreeBusy = {
  calendars?: {
    primary?: {
      busy?: { start?: string; end?: string }[];
      errors?: unknown[];
    };
  };
};

type GoogleError = {
  error?: {
    errors?: { reason?: unknown }[];
    status?: unknown;
  };
};

function availabilityRange(value: string): AvailabilityRange | null {
  switch (value) {
    case "today":
    case "tomorrow":
    case "week":
      return value;
    default:
      return null;
  }
}

function busyRanges(body: GoogleFreeBusy): BusyRange[] | null {
  const primary = body.calendars?.primary;
  if (!primary || (primary.errors?.length ?? 0) > 0) return null;

  const busy: BusyRange[] = [];
  for (const block of primary.busy ?? []) {
    if (!block.start || !block.end) return null;
    const startMs = Date.parse(block.start);
    const endMs = Date.parse(block.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    busy.push({ startMs, endMs });
  }
  return busy;
}

async function reasonCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as GoogleError;
    const candidate = body.error?.errors?.[0]?.reason ?? body.error?.status;
    return typeof candidate === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(candidate)
      ? candidate
      : "unknown";
  } catch {
    return "unknown";
  }
}

function isReauthReason(reason: string): boolean {
  return /auth|permission|scope/i.test(reason);
}

/** Read the primary calendar's availability. The trusted client supplies both `nowMs` and `tz`;
 *  neither comes from the model, and this action never invents a second clock source. */
export const freeBusy = internalAction({
  args: {
    tenantId: v.string(),
    correlationId: v.string(),
    range: v.string(),
    tz: v.string(),
    nowMs: v.number(),
  },
  handler: async (
    ctx,
    { tenantId, correlationId, range: rawRange, tz, nowMs },
  ): Promise<FreeBusyResult> => {
    // `range` crosses into the audit plane, so reject anything outside the closed enum before
    // touching a fixture, token, network, or audit row.
    const range = availabilityRange(rawRange);
    if (!range) return { ok: false, reason: "unavailable" };

    const audit = (busyCount: number) =>
      ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId,
        eventType: "calendar.availability.listed",
        actor: "system",
        payload: { range, busyCount },
      });

    const { fromMs, toMs } = availabilityWindow(range, nowMs);

    // 1. FIXTURE FIRST — before the token, so an offline tenant needs no Google grant or network.
    const fixture: Doc<"calendarFixtures"> | null = await ctx.runQuery(
      internal.smoke.getCalendarFixture,
      { tenantId },
    );
    if (fixture) {
      const busy = fixture.busy.filter((block) => block.startMs < toMs && block.endMs > fromMs);
      await audit(busy.length);
      return { ok: true, busy, fixture: true };
    }

    // 2. Read the stored Google grant. No row means nothing was read, so no audit.
    const token: Doc<"gmailTokens"> | null = await ctx.runQuery(internal.gmailAuth.getTokens, {
      tenantId,
    });
    if (!token) return { ok: false, reason: "not_connected" };

    // 3. Scope BEFORE refresh. A refresh succeeds even when the grant cannot call Calendar; doing
    // this later would make a permanent reconnect condition look like a provider failure.
    if (!hasScope(token.scope, CALENDAR_FREEBUSY_SCOPE)) {
      return { ok: false, reason: "reauth" };
    }

    // 4. ONE shared refresh root. A dead grant is recoverable conversation state, never a throw.
    const access = await freshAccessToken(ctx, tenantId);
    if (!access.ok) {
      return {
        ok: false,
        reason: access.reason === "not_connected" ? "not_connected" : "reauth",
      };
    }

    try {
      // 5. ponytail: primary calendar only. Upgrade by expanding `items` here (up to Google's
      // documented 50-calendar cap), while keeping freeBusy so provider content cannot enter.
      const response = await fetch(FREEBUSY_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeMin: toRfc3339(fromMs),
          timeMax: toRfc3339(toMs),
          timeZone: tz,
          items: [{ id: "primary" }],
        }),
      });
      if (!response.ok) return { ok: false, reason: "unavailable" };

      // 6. Provider strings stop at this boundary; the governed loop receives epoch ms only.
      const busy = busyRanges((await response.json()) as GoogleFreeBusy);
      if (!busy) return { ok: false, reason: "unavailable" };

      // 7. Exactly one refs/counts-only audit row after a successful provider read.
      await audit(busy.length);
      return { ok: true, busy, fixture: false };
    } catch {
      // A read outage is a recoverable conversational result. Never surface provider bodies/errors.
      return { ok: false, reason: "unavailable" };
    }
  },
});

/** Create one timed event from an approved plan row. The returned terminal shape is refs, ids,
 *  statuses, and reason codes only because the retrier hands it directly to calendarComplete.ts. */
export const createEvent = internalAction({
  args: {
    planId: v.id("plans"),
    tenantId: v.string(),
    correlationId: v.string(),
  },
  handler: async (ctx, { planId, tenantId, correlationId }): Promise<CreateEventResult> => {
    const refs = { planId, tenantId, correlationId };

    const plan: Doc<"plans"> | null = await ctx.runQuery(internal.plans.getById, { planId });
    if (!plan) return { ...refs, outcome: "terminal", status: 0, reason: "plan_not_found" };
    if (plan.tenantId !== tenantId) {
      return { ...refs, outcome: "terminal", status: 0, reason: "tenant_mismatch" };
    }

    // A partially staged row is permanently unsatisfiable. Return before token or network work so
    // the retrier does not burn all four attempts on missing content-plane fields.
    if (
      plan.eventTitle == null ||
      plan.eventStartMs == null ||
      plan.eventDurationMs == null ||
      plan.eventTz == null
    ) {
      return { ...refs, outcome: "terminal", status: 0, reason: "incomplete_stage" };
    }

    // 17-07: the provider branch, AFTER plan/tenant/stage validation so both providers inherit the
    // identical refusals. `parseCalendarProvider` treats an ABSENT value as Google, which is what
    // keeps every plan staged before this phase executing exactly as it did — the compatibility
    // guarantee, expressed once as a pure default rather than as an `if` at each call site.
    const provider: CalendarProvider = parseCalendarProvider(plan.calendarProvider);
    if (provider === "microsoft") {
      // Delegated wholesale. Token logic is NEVER copied into this module: microsoftAuth owns the
      // grant and microsoftCalendar owns the Graph calls, so there is exactly one place each can
      // be wrong.
      const ms = await ctx.runAction(internal.microsoftCalendar.createEvent, {
        planId,
        tenantId,
        correlationId,
        subject: plan.eventTitle,
        startMs: plan.eventStartMs,
        endMs: plan.eventStartMs + plan.eventDurationMs,
        nowMs: Date.now(),
      });
      if (ms.outcome === "created") {
        return {
          ...refs,
          outcome: "created",
          eventId: ms.eventId,
          duplicate: ms.duplicate,
          provider: "microsoft",
          etag: ms.etag,
        };
      }
      return ms.outcome === "reauth"
        ? { ...refs, outcome: "reauth" }
        : { ...refs, outcome: "terminal", status: ms.status, reason: ms.reason };
    }

    const token: Doc<"gmailTokens"> | null = await ctx.runQuery(internal.gmailAuth.getTokens, {
      tenantId,
    });
    if (!token) return { ...refs, outcome: "reauth" };

    // Scope BEFORE refresh: the refresh grant can succeed while still lacking Calendar access.
    if (!hasScope(token.scope, CALENDAR_EVENTS_SCOPE)) {
      return { ...refs, outcome: "reauth" };
    }

    const access = await freshAccessToken(ctx, tenantId);
    if (!access.ok) return { ...refs, outcome: "reauth" };

    const eventId = eventIdFor(planId);
    const response = await fetch(EVENTS_INSERT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: eventId,
        summary: plan.eventTitle,
        // ponytail: timed events only. All-day events require a mutually exclusive date shape;
        // upgrade with one staged boolean and one branch at this provider boundary.
        start: { dateTime: toRfc3339(plan.eventStartMs), timeZone: plan.eventTz },
        end: {
          dateTime: toRfc3339(plan.eventStartMs + plan.eventDurationMs),
          timeZone: plan.eventTz,
        },
        // Pitfall 3: guest-list fields stay absent because Google could send invitations outside
        // the governed plan, audit, redaction, and dead-letter path.
      }),
    });

    // A retried create either succeeds or collides with its deterministic id; the collision means
    // the event already exists and is therefore the idempotent success case.
    if (response.status === 409) {
      // 17-07: a duplicate is still a success, but it arrives with NO body and therefore no etag —
      // and 17-08 needs the version of the event that actually exists. One bounded GET of the
      // deterministic id recovers it. A failed recovery degrades to `etag: null` rather than
      // failing the create: the event exists either way, and a null version means "management must
      // re-read first", which is honest. It must never mean "any version will do".
      let etag: string | null = null;
      try {
        const existing = await fetch(`${EVENTS_INSERT_ENDPOINT}/${encodeURIComponent(eventId)}`, {
          headers: { Authorization: `Bearer ${access.token}` },
        });
        if (existing.ok) {
          const body = (await existing.json()) as { etag?: unknown };
          if (typeof body.etag === "string") etag = body.etag;
        }
      } catch {
        // Recovery is best-effort by design; see above.
      }
      return { ...refs, outcome: "created", eventId, duplicate: true, provider: "google", etag };
    }

    if (response.ok) {
      let returnedId = eventId;
      let etag: string | null = null;
      try {
        const body = (await response.json()) as { id?: unknown; etag?: unknown };
        if (typeof body.id === "string") returnedId = body.id;
        if (typeof body.etag === "string") etag = body.etag;
      } catch {
        // The deterministic request id remains the provider ref if a successful body is empty.
      }
      return {
        ...refs,
        outcome: "created",
        eventId: returnedId,
        duplicate: false,
        provider: "google",
        etag,
      };
    }

    if (response.status === 429 || response.status >= 500) {
      throw new Error(`calendar_insert_transient status=${response.status}`);
    }

    const reason = await reasonCode(response);
    if (response.status === 401 || (response.status === 403 && isReauthReason(reason))) {
      return { ...refs, outcome: "reauth" };
    }

    // Never carry the provider's message or raw response body into the retrier terminal.
    return { ...refs, outcome: "terminal", status: response.status, reason };
  },
});
