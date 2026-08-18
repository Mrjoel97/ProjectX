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
  type CalendarFailureCode,
  type CalendarInspection,
  type CalendarProvider,
  changedFields,
  eventIdFor,
  hasScope,
  manageability,
  parseCalendarProvider,
  providerSupports,
  toRfc3339,
} from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { freshAccessToken } from "./gmail";

const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";
const EVENTS_INSERT_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const EVENT_URL = (id: string) => `${EVENTS_INSERT_ENDPOINT}/${encodeURIComponent(id)}`;

/** The narrow projection Google is asked for. `summary` is the ONLY text; description, location,
 *  organizer, conferenceData and hangoutLink are never requested, so they cannot escape. */
const INSPECT_FIELDS = "id,etag,summary,start,end,attendees";

type BusyRange = { startMs: number; endMs: number };

type FreeBusyResult =
  | { ok: true; busy: BusyRange[]; fixture: boolean }
  | { ok: false; reason: "not_connected" | "reauth" | "unavailable" };

export type CreateEventResult = {
  planId: Id<"plans">;
  tenantId: string;
  correlationId: string;
} & ( // the create/GET response, and a later round-trip to fetch it is a second chance to be wrong. // (17-08, gated on the Graph probe); it is captured now because both providers offer it only on // holds the event and its durable version. The etag is what event-specific concurrency needs // 17-07: `provider` and `etag` widen the CREATED variant so the terminal records WHICH calendar
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

// ── 17-08 Task 2: provider-neutral inspection and conditional management ───────────────────────
//
// ONE decision tree, two providers. The attendee refusal, the desired-state reconciliation, the
// conflict handling and the ownership guards live here ONCE; the provider modules contribute only
// their HTTP. A second copy of "refuse if attendees > 0" is a second place for it to be missing.
//
// THE SHAPE OF THE GUARANTEE: the GET answers three questions — does it exist, did it grow guests,
// is the desired state already there — and NOTHING ELSE. The version arbitration stays server-side
// in the provider's 412 against the etag the HUMAN approved. Comparing versions in this file and
// then writing would be a read-modify-write race with the compare moved client-side; the gap
// between the read and the write IS the race, and moving the comparison here only hides it from
// the HTTP status (ADR-023, "Forbidden").

export type ManageEventResult = {
  planId: Id<"plans">;
  tenantId: string;
  correlationId: string;
} & (
  | {
      outcome: "updated";
      managedEventId: Id<"calendarEvents">;
      provider: CalendarProvider;
      etag: string | null;
    }
  | { outcome: "deleted"; managedEventId: Id<"calendarEvents">; provider: CalendarProvider }
  /** A bounded CODE from @pikar/core. Terminal and never retried — the plan is finished, wrongly. */
  | { outcome: "refused"; code: CalendarFailureCode }
  | { outcome: "reauth"; provider: CalendarProvider }
  | { outcome: "terminal"; status: number; reason: string }
);

type InspectOutcome =
  | { outcome: "ok"; inspection: CalendarInspection }
  | { outcome: "reauth" }
  | { outcome: "terminal"; status: number; reason: string };

type WriteOutcome =
  | { outcome: "updated"; etag: string | null }
  | { outcome: "deleted" }
  | { outcome: "refused"; code: CalendarFailureCode }
  | { outcome: "reauth" }
  | { outcome: "terminal"; status: number; reason: string };

type GoogleEventBody = {
  id?: unknown;
  etag?: unknown;
  summary?: unknown;
  start?: { dateTime?: unknown };
  end?: { dateTime?: unknown };
  attendees?: unknown;
};

/** Google's RFC3339 carries its own offset, unlike Graph's zone-less `dateTime`. */
function googleInstant(slot: { dateTime?: unknown } | undefined): number | null {
  if (typeof slot?.dateTime !== "string") return null;
  const ms = Date.parse(slot.dateTime);
  return Number.isFinite(ms) ? ms : null;
}

/** Shared status mapping for every Google management call. 429/5xx THROW so the retrier owns them;
 *  everything else becomes a bounded code or a status-only terminal. */
function googleTransient(status: number, verb: string): void {
  if (status === 429 || status >= 500) {
    throw new Error(`calendar_manage_transient verb=${verb} status=${status}`);
  }
}

async function googleInspect(token: string | null, eventId: string): Promise<InspectOutcome> {
  if (!token) return { outcome: "reauth" };
  const url = new URL(EVENT_URL(eventId));
  url.searchParams.set("fields", INSPECT_FIELDS);

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error("calendar_manage_transient verb=get status=0");
  }
  googleTransient(res.status, "get");
  if (res.status === 401) return { outcome: "reauth" };
  // A definite absence, not a failure. The delete path reads it as "already done" and the update
  // path as `not_found`; collapsing them here would make one of the two answers wrong.
  if (res.status === 404 || res.status === 410) {
    return { outcome: "ok", inspection: { exists: false } };
  }
  if (!res.ok) {
    const reason = await reasonCode(res);
    if (res.status === 403 && isReauthReason(reason)) return { outcome: "reauth" };
    return { outcome: "terminal", status: res.status, reason };
  }

  let body: GoogleEventBody;
  try {
    body = (await res.json()) as GoogleEventBody;
  } catch {
    return { outcome: "terminal", status: res.status, reason: "malformed_inspect_response" };
  }
  const startMs = googleInstant(body.start);
  const endMs = googleInstant(body.end);
  if (typeof body.id !== "string" || startMs === null || endMs === null || endMs <= startMs) {
    // An event we cannot pin to an instant is one we must not compute a desired state against.
    return { outcome: "terminal", status: res.status, reason: "inspect_unparseable" };
  }
  return {
    outcome: "ok",
    inspection: {
      exists: true,
      externalEventId: body.id,
      ...(typeof body.etag === "string" ? { etag: body.etag } : {}),
      title: typeof body.summary === "string" ? body.summary : "",
      startMs,
      durationMs: endMs - startMs,
      // A COUNT (§4) — enough to refuse the write, never enough to name a guest.
      attendeeCount: Array.isArray(body.attendees) ? body.attendees.length : 0,
    },
  };
}

async function googlePatch(
  token: string | null,
  eventId: string,
  expectedEtag: string,
  desired: { title: string; startMs: number; durationMs: number; tz: string },
): Promise<WriteOutcome> {
  if (!token) return { outcome: "reauth" };
  let res: Response;
  try {
    res = await fetch(EVENT_URL(eventId), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // The whole point. Google answers 412 when the version moved under us.
        "If-Match": expectedEtag,
      },
      body: JSON.stringify({
        summary: desired.title,
        start: { dateTime: toRfc3339(desired.startMs), timeZone: desired.tz },
        end: { dateTime: toRfc3339(desired.startMs + desired.durationMs), timeZone: desired.tz },
        // No `attendees`, and NO `sendUpdates` query parameter: either one would make Google email
        // people on the app's behalf, outside the plan/audit/redaction/dead-letter spine.
      }),
    });
  } catch {
    throw new Error("calendar_manage_transient verb=patch status=0");
  }
  googleTransient(res.status, "patch");
  if (res.status === 401) return { outcome: "reauth" };
  if (res.status === 412) return { outcome: "refused", code: "conflict" };
  if (res.status === 404 || res.status === 410) return { outcome: "refused", code: "not_found" };
  if (!res.ok) {
    const reason = await reasonCode(res);
    if (res.status === 403 && isReauthReason(reason)) return { outcome: "reauth" };
    return { outcome: "terminal", status: res.status, reason };
  }
  let etag: string | null = null;
  try {
    const body = (await res.json()) as { etag?: unknown };
    if (typeof body.etag === "string") etag = body.etag;
  } catch {
    // A successful PATCH with an unreadable body still moved the event. A null version means
    // "management must re-read first" — never "any version will do".
  }
  return { outcome: "updated", etag };
}

/** GOOGLE ONLY. Microsoft never reaches this function: `providerSupports` refuses a Graph delete
 *  before a token is fetched, because Graph ignores `If-Match` on event DELETE (ADR-023). */
async function googleDelete(
  token: string | null,
  eventId: string,
  expectedEtag: string,
): Promise<WriteOutcome> {
  if (!token) return { outcome: "reauth" };
  let res: Response;
  try {
    res = await fetch(EVENT_URL(eventId), {
      method: "DELETE",
      // NO BODY, and no `sendUpdates` — a cancellation notice is an outbound external communication
      // with no plan row, no audit event and no redaction pass.
      headers: { Authorization: `Bearer ${token}`, "If-Match": expectedEtag },
    });
  } catch {
    throw new Error("calendar_manage_transient verb=delete status=0");
  }
  googleTransient(res.status, "delete");
  if (res.status === 401) return { outcome: "reauth" };
  if (res.status === 412) return { outcome: "refused", code: "conflict" };
  // Already gone IS the desired end state. Idempotent success, not a failure.
  if (res.status === 404 || res.status === 410) return { outcome: "deleted" };
  if (!res.ok) {
    const reason = await reasonCode(res);
    if (res.status === 403 && isReauthReason(reason)) return { outcome: "reauth" };
    return { outcome: "terminal", status: res.status, reason };
  }
  return { outcome: "deleted" };
}

/**
 * The provider-neutral management action the `calendar_manage` retrier arm runs (17-08 Task 3
 * wires it behind Approve). Everything it returns is refs, ids, statuses and bounded codes — the
 * event title never crosses this boundary, because the terminal recomputes the desired state from
 * the plan's OWN staged fields, exactly as the create terminal does.
 */
export const manageEvent = internalAction({
  args: { planId: v.id("plans"), tenantId: v.string(), correlationId: v.string() },
  handler: async (ctx, { planId, tenantId, correlationId }): Promise<ManageEventResult> => {
    const refs = { planId, tenantId, correlationId };
    const stop = (status: number, reason: string): ManageEventResult => ({
      ...refs,
      outcome: "terminal",
      status,
      reason,
    });

    // 1. Re-read the plan. Nothing the retrier handed us is trusted as authority over the row.
    const plan: Doc<"plans"> | null = await ctx.runQuery(internal.plans.getById, { planId });
    if (!plan) return stop(0, "plan_not_found");
    if (plan.tenantId !== tenantId) return stop(0, "tenant_mismatch");
    if (plan.kind !== "calendar_manage") return stop(0, "wrong_kind");
    // `delivering` is the CAS the human approval established. A plan that has moved on — reset,
    // failed, already done — must not have a provider write performed against it.
    if (plan.status !== "delivering") return stop(0, "not_delivering");

    // 2. Re-read the registry row THROUGH the tenant. A foreign ref resolves to nothing, so this
    // fails before any token or provider work rather than after it.
    const managedEventId = plan.calendarManagedEventId;
    if (!managedEventId) return { ...refs, outcome: "refused", code: "not_managed" };
    const row: Doc<"calendarEvents"> | null = await ctx.runQuery(
      internal.calendarEvents.getManaged,
      { tenantId, managedEventId },
    );
    if (!row) return { ...refs, outcome: "refused", code: "not_managed" };

    // 3. The pre-provider gate: deleted rows, attendee-bearing rows and etag-less legacy rows are
    // refused from STORED FACTS, before a provider round trip can be spent learning it.
    const verdict = manageability({
      status: row.status,
      attendeeFree: row.attendeeFree,
      ...(row.etag === undefined ? {} : { etag: row.etag }),
    });
    if (!verdict.ok) return { ...refs, outcome: "refused", code: verdict.code };

    const operation = plan.calendarOperation;
    if (operation !== "update" && operation !== "delete") return stop(0, "operation_unstaged");

    // 4. THE PROVIDER REFUSAL — before a token, before a GET, before any write. A Microsoft
    // cancel/delete stops HERE (ADR-023) and reaches no Graph endpoint at all. It is a product
    // surface, not a no-op: the caller gets a code naming the limitation.
    const provider: CalendarProvider = parseCalendarProvider(row.provider);
    const support = providerSupports(provider, operation);
    if (!support.ok) return { ...refs, outcome: "refused", code: support.code };

    // 5. The version the HUMAN approved against. It must still be the version the registry holds:
    // if another Pikar write landed between staging and delivery, the approval describes a state
    // that no longer exists, and restaging is the only honest answer.
    const expectedEtag = plan.calendarExpectedEtag;
    if (!expectedEtag) return { ...refs, outcome: "refused", code: "needs_inspection" };
    if (expectedEtag !== row.etag) return { ...refs, outcome: "refused", code: "conflict" };

    // 6. Google's token, once, for whichever calls follow. Microsoft's actions own their own.
    let googleToken: string | null = null;
    if (provider === "google") {
      const stored: Doc<"gmailTokens"> | null = await ctx.runQuery(internal.gmailAuth.getTokens, {
        tenantId,
      });
      // Scope BEFORE refresh: a refresh succeeds even when the grant cannot call Calendar.
      if (!stored || !hasScope(stored.scope, CALENDAR_EVENTS_SCOPE)) {
        return { ...refs, outcome: "reauth", provider };
      }
      const access = await freshAccessToken(ctx, tenantId);
      if (!access.ok) return { ...refs, outcome: "reauth", provider };
      googleToken = access.token;
    }

    const nowMs = Date.now();
    const inspected: InspectOutcome =
      provider === "google"
        ? await googleInspect(googleToken, row.externalEventId)
        : await ctx.runAction(internal.microsoftCalendar.inspectEvent, {
            tenantId,
            externalEventId: row.externalEventId,
            nowMs,
          });
    if (inspected.outcome === "reauth") return { ...refs, outcome: "reauth", provider };
    if (inspected.outcome === "terminal") return stop(inspected.status, inspected.reason);
    const view = inspected.inspection;

    // 7. Gone already. For a delete that IS the desired end state (a retry after a lost success
    // response); for an update there is nothing left to move.
    if (!view.exists) {
      return operation === "delete"
        ? { ...refs, outcome: "deleted", managedEventId, provider }
        : { ...refs, outcome: "refused", code: "not_found" };
    }

    // 8. The event grew guests since we created it. Touching it now could make the provider email
    // them, so BOTH verbs refuse — and they refuse before the write request, not after.
    if (view.attendeeCount > 0) return { ...refs, outcome: "refused", code: "attendees_present" };

    if (operation === "delete") {
      const res = await googleDelete(googleToken, row.externalEventId, expectedEtag);
      if (res.outcome === "deleted") {
        return { ...refs, outcome: "deleted", managedEventId, provider };
      }
      if (res.outcome === "reauth") return { ...refs, outcome: "reauth", provider };
      if (res.outcome === "refused") return { ...refs, outcome: "refused", code: res.code };
      if (res.outcome === "terminal") return stop(res.status, res.reason);
      return stop(0, "unexpected_delete_outcome");
    }

    // 9. The complete desired state: staged overrides where the human changed something, registry
    // state where they did not. An absent staged field means "leave it alone".
    const desired = {
      title: plan.eventTitle ?? row.title,
      startMs: plan.eventStartMs ?? row.startMs,
      durationMs: plan.eventDurationMs ?? row.durationMs,
      tz: plan.eventTz ?? row.tz,
    };

    // 10. EXACTLY-ONCE. If the provider already holds the desired state, a retry after a lost
    // success response must report success rather than a false conflict — the etag has moved on
    // precisely BECAUSE our own earlier write landed.
    //
    // `tz` is deliberately absent from the comparison: Graph is asked to speak UTC and echoes UTC
    // back, so a registry zone of `Africa/Dar_es_Salaam` would never compare equal and every
    // Microsoft update would be forced into a PATCH that changes nothing. The absolute instant is
    // the fact; the zone rides the write payload.
    const changed = changedFields(
      { title: view.title, startMs: view.startMs, durationMs: view.durationMs, tz: row.tz },
      { title: desired.title, startMs: desired.startMs, durationMs: desired.durationMs },
    );
    if (Object.keys(changed).length === 0) {
      return { ...refs, outcome: "updated", managedEventId, provider, etag: view.etag ?? null };
    }

    const res: WriteOutcome =
      provider === "google"
        ? await googlePatch(googleToken, row.externalEventId, expectedEtag, desired)
        : await ctx.runAction(internal.microsoftCalendar.patchEvent, {
            tenantId,
            externalEventId: row.externalEventId,
            expectedEtag,
            title: desired.title,
            startMs: desired.startMs,
            durationMs: desired.durationMs,
            nowMs,
          });
    if (res.outcome === "updated") {
      return { ...refs, outcome: "updated", managedEventId, provider, etag: res.etag };
    }
    if (res.outcome === "reauth") return { ...refs, outcome: "reauth", provider };
    if (res.outcome === "refused") return { ...refs, outcome: "refused", code: res.code };
    if (res.outcome === "terminal") return stop(res.status, res.reason);
    return stop(0, "unexpected_update_outcome");
  },
});
