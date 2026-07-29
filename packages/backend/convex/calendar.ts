"use node";

// Google Calendar's thin HTTP adapter (CLAUDE.md §1). Pure availability windows, scope checks,
// event-id derivation, and RFC3339 conversion live in @pikar/core/calendar. This Node module holds
// actions ONLY: its DB terminal lives in the non-Node calendarComplete.ts because a "use node"
// module cannot contain a mutation. Both actions reuse freshAccessToken from gmail.ts — the ONE
// token-refresh root. Epoch-ms values become RFC3339 only here, at the provider boundary.
import {
  availabilityWindow,
  type AvailabilityRange,
  CALENDAR_FREEBUSY_SCOPE,
  hasScope,
  toRfc3339,
} from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { freshAccessToken } from "./gmail";

const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";

type BusyRange = { startMs: number; endMs: number };

type FreeBusyResult =
  | { ok: true; busy: BusyRange[]; fixture: boolean }
  | { ok: false; reason: "not_connected" | "reauth" | "unavailable" };

type GoogleFreeBusy = {
  calendars?: {
    primary?: {
      busy?: { start?: string; end?: string }[];
      errors?: unknown[];
    };
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
      const busy = fixture.busy.filter(
        (block) => block.startMs < toMs && block.endMs > fromMs,
      );
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
