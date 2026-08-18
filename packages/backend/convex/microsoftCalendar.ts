"use node";

// Microsoft Graph's thin Calendar adapter (CLAUDE.md §1), the twin of calendar.ts.
//
// Pure availability windows, RFC3339 conversion and the deterministic id live in @pikar/core; the
// grant itself lives in microsoftAuth.ts (ADR-018 — ONE Microsoft connection covering Calendar AND
// Mail). This Node module holds ACTIONS ONLY: its DB terminal is the shared calendarComplete.ts,
// because a "use node" module cannot contain a mutation.
//
// TWO PROVIDER FACTS DRIVE THE SHAPE HERE, AND NEITHER MATCHES GOOGLE:
//
//  1. **Availability comes from `/me/calendarView`, NOT `getSchedule`.** getSchedule is the obvious
//     freeBusy analogue and it is WRONG for this product: it is not supported for delegated
//     PERSONAL Microsoft accounts, which are half of what the `common` endpoint admits. calendarView
//     returns events, so the content-stripping below is load-bearing rather than tidy.
//  2. **Microsoft ROTATES refresh tokens.** Google does not. Dropping a rotated token leaves the
//     stored one dead and the connection unrecoverable without re-consent.
import {
  type AvailabilityRange,
  availabilityWindow,
  type CalendarFailureCode,
  type CalendarInspection,
  eventIdFor,
  microsoftUpdateEnabled,
  parseGraphProbe,
  toRfc3339,
} from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import { contentHash } from "./lib/hash";
import { MICROSOFT_TOKEN_ENDPOINT } from "./microsoftAuth";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const CALENDAR_VIEW_ENDPOINT = `${GRAPH_BASE}/me/calendarView`;
const EVENTS_ENDPOINT = `${GRAPH_BASE}/me/calendar/events`;

/** Refresh this far before actual expiry so a token cannot die mid-request. */
const EXPIRY_SKEW_MS = 60_000;

/** ponytail: bounded fan-out. A calendar with more than this in one window is truncated and SAYS SO
 *  (`truncated: true` reaches the audit), rather than paging forever on someone's busiest week.
 *  Upgrade by raising these two together — the item cap is the one that bounds memory. */
const MAX_PAGES = 5;
const MAX_ITEMS = 500;
const PAGE_SIZE = 100;

type GraphTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: "not_connected" | "reauth" | "transient" | "unavailable" };

type BusyRange = { startMs: number; endMs: number };

export type MicrosoftFreeBusyResult =
  | { ok: true; busy: BusyRange[]; truncated: boolean }
  | { ok: false; reason: "not_connected" | "reauth" | "transient" | "unavailable" };

/**
 * The ONE Graph token root, mirroring `gmail.ts`'s `freshAccessToken` — with one deliberate
 * difference: **a still-valid cached access token skips the refresh entirely.** Google's root
 * refreshes unconditionally; doing that against Graph would burn a network round-trip on every
 * availability check and, worse, rotate the refresh token far more often than necessary.
 */
export async function freshGraphToken(
  ctx: ActionCtx,
  tenantId: string,
  nowMs: number,
): Promise<GraphTokenResult> {
  const row: Doc<"microsoftCalendarTokens"> | null = await ctx.runQuery(
    internal.microsoftAuth.getTokens,
    { tenantId },
  );
  if (!row) return { ok: false, reason: "not_connected" };

  // Still good — no network, no rotation.
  if (row.accessToken && row.expiresAt > nowMs + EXPIRY_SKEW_MS) {
    return { ok: true, token: row.accessToken };
  }

  let res: Response;
  try {
    res = await fetch(MICROSOFT_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_OAUTH_CLIENT_ID ?? "",
        client_secret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET ?? "",
        refresh_token: row.refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    // A network outage is recoverable; it must not read as "your grant is dead".
    return { ok: false, reason: "transient" };
  }

  // 429/5xx are the retrier's business. 4xx means the grant itself is finished — reconnect.
  if (res.status === 429 || res.status >= 500) return { ok: false, reason: "transient" };
  if (!res.ok) return { ok: false, reason: "reauth" };

  let body: { access_token?: string; expires_in?: number; refresh_token?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!body.access_token) return { ok: false, reason: "reauth" };

  await ctx.runMutation(internal.microsoftAuth.updateAccess, {
    tenantId,
    accessToken: body.access_token,
    expiresAt: nowMs + (body.expires_in ?? 3600) * 1000,
    // THE ROTATION. Passed through only when present: Microsoft returns a new refresh token on many
    // refreshes and omits it on others, and `updateAccess` keeps the stored one when this is absent.
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
  });
  return { ok: true, token: body.access_token };
}

function availabilityRange(value: string): AvailabilityRange | null {
  return value === "today" || value === "tomorrow" || value === "week" ? value : null;
}

/**
 * Only `https://graph.microsoft.com/v1.0/` next links are followed.
 *
 * `@odata.nextLink` is a provider-supplied URL and this code puts a bearer token on it. An
 * unvalidated next link is a credential-exfiltration primitive: a compromised or spoofed response
 * naming `https://evil.test/...` would have our access token POSTed straight to it. Prefix-checked
 * against the exact v1.0 base, never a substring or hostname `includes`.
 */
function safeNextLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.origin !== "https://graph.microsoft.com") return null;
  if (!url.pathname.startsWith("/v1.0/")) return null;
  return url.toString();
}

type GraphEvent = {
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  showAs?: string;
};

/**
 * Graph returns `dateTime` WITHOUT an offset and names the zone separately. `Date.parse` on a bare
 * `2026-08-14T09:00:00.0000000` is treated as LOCAL time by the runtime, which would silently shift
 * every busy block by the server's offset. We always request UTC, so append the Z ourselves rather
 * than trusting the parser to guess.
 */
function graphInstant(slot: { dateTime?: string; timeZone?: string } | undefined): number | null {
  const raw = slot?.dateTime;
  if (!raw) return null;
  const zone = (slot?.timeZone ?? "UTC").toUpperCase();
  // We only ever ask for UTC; anything else means the request contract changed underneath us and
  // guessing an offset would produce confidently-wrong availability.
  if (zone !== "UTC") return null;
  const ms = Date.parse(/[Zz]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Read availability from the primary calendar. Content-free by construction. */
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
  ): Promise<MicrosoftFreeBusyResult> => {
    const range = availabilityRange(rawRange);
    if (!range) return { ok: false, reason: "unavailable" };

    const { fromMs, toMs } = availabilityWindow(range, nowMs);

    const access = await freshGraphToken(ctx, tenantId, nowMs);
    if (!access.ok) return { ok: false, reason: access.reason };

    const busy: BusyRange[] = [];
    let truncated = false;
    // `$select` is the content firewall: subject, body, location, organizer and attendees are never
    // requested, so they cannot be logged, audited or accidentally returned. Asserting on the
    // REQUEST (as the tests do) is the only way to prove that — a stub answers whatever it was told.
    const first = new URL(CALENDAR_VIEW_ENDPOINT);
    first.searchParams.set("startDateTime", toRfc3339(fromMs));
    first.searchParams.set("endDateTime", toRfc3339(toMs));
    first.searchParams.set("$select", "start,end,showAs");
    first.searchParams.set("$top", String(PAGE_SIZE));
    let next: string | null = first.toString();

    for (let page = 0; page < MAX_PAGES && next; page++) {
      let res: Response;
      try {
        res = await fetch(next, {
          headers: {
            Authorization: `Bearer ${access.token}`,
            // Ask Graph to speak UTC so `graphInstant` never has to guess an offset.
            Prefer: 'outlook.timezone="UTC"',
          },
        });
      } catch {
        return { ok: false, reason: "transient" };
      }
      if (res.status === 429 || res.status >= 500) return { ok: false, reason: "transient" };
      if (res.status === 401 || res.status === 403) return { ok: false, reason: "reauth" };
      if (!res.ok) return { ok: false, reason: "unavailable" };

      let body: { value?: GraphEvent[]; "@odata.nextLink"?: unknown };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        return { ok: false, reason: "unavailable" };
      }

      for (const ev of body.value ?? []) {
        if (busy.length >= MAX_ITEMS) {
          truncated = true;
          break;
        }
        // `showAs: "free"` is a real calendar state (a transparent event). Treating it as busy
        // would refuse a slot the user considers open.
        if ((ev.showAs ?? "busy").toLowerCase() === "free") continue;
        const startMs = graphInstant(ev.start);
        const endMs = graphInstant(ev.end);
        // A malformed instant is DROPPED, not guessed. An invented range would be a confidently
        // wrong "you are busy" that the user cannot see the cause of.
        if (startMs === null || endMs === null || endMs <= startMs) continue;
        busy.push({ startMs, endMs });
      }

      if (truncated) break;
      next = safeNextLink(body["@odata.nextLink"]);
      if (next && page === MAX_PAGES - 1) truncated = true;
    }

    // Refs and counts only (CLAUDE.md §4): a provider code, the closed range enum, a count and a
    // boolean. No event property, no next link, no tz string from the provider.
    await ctx.runMutation(internal.audit.log, {
      tenantId,
      correlationId,
      eventType: "calendar.availability.listed",
      actor: "system",
      payload: { provider: "microsoft", range, busyCount: busy.length, truncated },
    });
    // `tz` is accepted for signature parity with the Google adapter; Graph is asked for UTC and the
    // caller converts for display. Named here so the unused-parameter is deliberate, not an oversight.
    void tz;
    return { ok: true, busy, truncated };
  },
});

export type MicrosoftCreateResult =
  | { outcome: "created"; eventId: string; etag: string | null; duplicate: boolean }
  | { outcome: "reauth" }
  | { outcome: "terminal"; status: number; reason: string };

/**
 * Create one timed event. Subject and UTC start/end ONLY.
 *
 * No attendees, no body, no location, no online-meeting surface — not an omission but the boundary:
 * every one of those either invites the model to write prose into a provider record or turns an
 * approved plan into an INVITATION that mails other people, which would route around the send path
 * and its suppression checks entirely.
 */
export const createEvent = internalAction({
  args: {
    planId: v.id("plans"),
    tenantId: v.string(),
    correlationId: v.string(),
    subject: v.string(),
    startMs: v.number(),
    endMs: v.number(),
    nowMs: v.number(),
  },
  handler: async (
    ctx,
    { planId, tenantId, subject, startMs, endMs, nowMs },
  ): Promise<MicrosoftCreateResult> => {
    const access = await freshGraphToken(ctx, tenantId, nowMs);
    if (!access.ok) {
      if (access.reason === "transient") {
        // Thrown, not returned: the retrier's business, and it carries refs/status only.
        throw new Error(`microsoft_calendar_transient:${planId}`);
      }
      return access.reason === "unavailable"
        ? { outcome: "terminal", status: 0, reason: "token_unavailable" }
        : { outcome: "reauth" };
    }

    // THE IDEMPOTENCY KEY. Deterministic from the plan id via the same `eventIdFor` the Google
    // branch uses for its event id, so a retry of the SAME plan re-sends the SAME transactionId and
    // Graph collapses it instead of creating a second meeting. Graph caps this at 256 chars.
    const transactionId = `pikar-${eventIdFor(planId)}`;

    let res: Response;
    try {
      res = await fetch(EVENTS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject,
          start: { dateTime: toRfc3339(startMs), timeZone: "UTC" },
          end: { dateTime: toRfc3339(endMs), timeZone: "UTC" },
          transactionId,
        }),
      });
    } catch {
      throw new Error(`microsoft_calendar_transient:${planId}`);
    }

    if (res.status === 429 || res.status >= 500) {
      throw new Error(`microsoft_calendar_transient:${planId}:${res.status}`);
    }
    if (res.status === 401 || res.status === 403) return { outcome: "reauth" };
    if (!res.ok) {
      // Status only. A Graph error body can name the directory and the account; it never enters a
      // reason string that reaches audit or the dead-letter payload.
      return { outcome: "terminal", status: res.status, reason: "create_rejected" };
    }

    let body: { id?: string; "@odata.etag"?: string };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { outcome: "terminal", status: res.status, reason: "malformed_create_response" };
    }
    if (!body.id) {
      return { outcome: "terminal", status: res.status, reason: "create_without_id" };
    }

    return {
      outcome: "created",
      eventId: body.id,
      // The etag is what event-specific concurrency needs later (17-08, gated on the probe). Captured
      // now because it is only offered on the create response and a later GET is a second round-trip.
      etag: typeof body["@odata.etag"] === "string" ? body["@odata.etag"] : null,
      // Graph collapses a repeated transactionId silently — it returns the ORIGINAL event rather
      // than reporting a duplicate — so this adapter cannot distinguish first-write from retry the
      // way Google's 409 branch can. Reported honestly as false rather than guessed.
      duplicate: false,
    };
  },
});

// ── 17-08 Task 2: inspection, and the probe-gated conditional PATCH ────────────────────────────
//
// THERE IS NO DELETE WRITER IN THIS MODULE, and its absence is the feature (ADR-023). The 17-07
// probe measured `staleDeleteStatus: 204` with `staleDeletePreserved: false`: Graph IGNORES
// `If-Match` on event DELETE and the stale delete destroyed the event anyway. Two racing cancels —
// or a cancel racing an edit — would destroy an event whose state the caller never saw. The refusal
// is raised in `calendar.manageEvent` before a token is fetched; nothing here can be reached to
// perform it, and no probe result may add it back (a superseding ADR would, an executor may not).

const EVENT_URL = (id: string) => `${EVENTS_ENDPOINT}/${encodeURIComponent(id)}`;

/** The deployment identity the probe binds itself to. ONE implementation, used by the probe that
 *  writes the hash and by the gate that checks it, so the two cannot drift apart. */
async function deploymentUrlHash(): Promise<string> {
  return contentHash(process.env.CONVEX_SITE_URL ?? process.env.CONVEX_CLOUD_URL ?? "unknown");
}

export type MicrosoftInspectResult =
  | { outcome: "ok"; inspection: CalendarInspection }
  | { outcome: "reauth" }
  | { outcome: "terminal"; status: number; reason: string };

export type MicrosoftPatchResult =
  | { outcome: "updated"; etag: string | null }
  | { outcome: "refused"; code: CalendarFailureCode }
  | { outcome: "reauth" }
  | { outcome: "terminal"; status: number; reason: string };

/**
 * Read the current state of ONE event, narrowly.
 *
 * `$select` is the content firewall and it is asserted on the REQUEST, because a stub answers
 * whatever it was told: subject is the only text requested, and location, organizer, body and
 * onlineMeeting are never asked for, so they cannot be logged, returned or leaked. Attendees ARE
 * requested — the write must refuse an event that grew guests — but only their COUNT survives this
 * function. The response object is discarded at the `return`; nothing downstream ever sees it.
 */
export const inspectEvent = internalAction({
  args: { tenantId: v.string(), externalEventId: v.string(), nowMs: v.number() },
  handler: async (ctx, { tenantId, externalEventId, nowMs }): Promise<MicrosoftInspectResult> => {
    const access = await freshGraphToken(ctx, tenantId, nowMs);
    if (!access.ok) {
      if (access.reason === "transient") throw new Error("microsoft_calendar_transient:inspect");
      return access.reason === "unavailable"
        ? { outcome: "terminal", status: 0, reason: "token_unavailable" }
        : { outcome: "reauth" };
    }

    const url = new URL(EVENT_URL(externalEventId));
    url.searchParams.set("$select", "id,subject,start,end,attendees");

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${access.token}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      });
    } catch {
      throw new Error("microsoft_calendar_transient:inspect");
    }

    if (res.status === 429 || res.status >= 500) {
      throw new Error(`microsoft_calendar_transient:inspect:${res.status}`);
    }
    if (res.status === 401 || res.status === 403) return { outcome: "reauth" };
    // A DEFINITE absence, not a failure: the delete path reads this as "already done" and the
    // update path as `not_found`. Deciding that here would collapse two different right answers.
    if (res.status === 404 || res.status === 410) {
      return { outcome: "ok", inspection: { exists: false } };
    }
    if (!res.ok) return { outcome: "terminal", status: res.status, reason: "inspect_rejected" };

    let body: {
      id?: string;
      "@odata.etag"?: string;
      subject?: string;
      start?: { dateTime?: string; timeZone?: string };
      end?: { dateTime?: string; timeZone?: string };
      attendees?: unknown[];
    };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { outcome: "terminal", status: res.status, reason: "malformed_inspect_response" };
    }

    const startMs = graphInstant(body.start);
    const endMs = graphInstant(body.end);
    if (!body.id || startMs === null || endMs === null || endMs <= startMs) {
      // An event we cannot pin to an instant is one we must not compute a desired state against.
      return { outcome: "terminal", status: res.status, reason: "inspect_unparseable" };
    }

    return {
      outcome: "ok",
      inspection: {
        exists: true,
        externalEventId: body.id,
        ...(typeof body["@odata.etag"] === "string" ? { etag: body["@odata.etag"] } : {}),
        title: body.subject ?? "",
        startMs,
        durationMs: endMs - startMs,
        // A COUNT (§4). Enough to refuse the write, never enough to name a guest.
        attendeeCount: Array.isArray(body.attendees) ? body.attendees.length : 0,
      },
    };
  },
});

/**
 * Conditionally move/retitle ONE event. THE PROBE GATE RUNS FIRST — before the token, before the
 * network — so a deployment with no measurement makes no Graph write at all.
 *
 * Why the gate lives on the WRITER and not on the caller: a caller that forgot it would be a silent
 * widening, and there would be no single place to read to know whether Microsoft writes are
 * possible here. It costs the refused path one extra inspection GET (a read of the user's own
 * calendar, which is harmless), and buys a guard nothing can route around.
 */
export const patchEvent = internalAction({
  args: {
    tenantId: v.string(),
    externalEventId: v.string(),
    /** The If-Match value the HUMAN approved against. Never model-supplied — see plans.ts. */
    expectedEtag: v.string(),
    title: v.string(),
    startMs: v.number(),
    durationMs: v.number(),
    nowMs: v.number(),
  },
  handler: async (
    ctx,
    { tenantId, externalEventId, expectedEtag, title, startMs, durationMs, nowMs },
  ): Promise<MicrosoftPatchResult> => {
    // THE GATE. Missing, blank, malformed, wrong-schema, a stale PATCH that was not refused, a 412
    // that still wrote, or a measurement bound to another deployment or account — every one of them
    // is "no evidence", and no evidence means no Microsoft write.
    const enabled = microsoftUpdateEnabled({
      probe: parseGraphProbe(process.env.PHASE17_GRAPH_PROBE),
      deploymentUrlHash: await deploymentUrlHash(),
      accountIdHash: await contentHash(tenantId),
    });
    if (!enabled) return { outcome: "refused", code: "provider_unsupported" };

    const access = await freshGraphToken(ctx, tenantId, nowMs);
    if (!access.ok) {
      if (access.reason === "transient") throw new Error("microsoft_calendar_transient:patch");
      return access.reason === "unavailable"
        ? { outcome: "terminal", status: 0, reason: "token_unavailable" }
        : { outcome: "reauth" };
    }

    let res: Response;
    try {
      res = await fetch(EVENT_URL(externalEventId), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${access.token}`,
          "Content-Type": "application/json",
          // The whole point. Without it this is a read-modify-write race.
          "If-Match": expectedEtag,
        },
        body: JSON.stringify({
          subject: title,
          start: { dateTime: toRfc3339(startMs), timeZone: "UTC" },
          end: { dateTime: toRfc3339(startMs + durationMs), timeZone: "UTC" },
          // No attendees, no body, no location, no reminder/notification option — the same boundary
          // createEvent holds. A PATCH that added guests would mail them an invitation.
        }),
      });
    } catch {
      throw new Error("microsoft_calendar_transient:patch");
    }

    if (res.status === 429 || res.status >= 500) {
      throw new Error(`microsoft_calendar_transient:patch:${res.status}`);
    }
    if (res.status === 401 || res.status === 403) return { outcome: "reauth" };
    // The version moved under us. NEVER retried and never force-overwritten: the human approved
    // against a state that no longer exists, so the right answer is to restage, not to insist.
    if (res.status === 412) return { outcome: "refused", code: "conflict" };
    if (res.status === 404 || res.status === 410) return { outcome: "refused", code: "not_found" };
    if (!res.ok) return { outcome: "terminal", status: res.status, reason: "patch_rejected" };

    let etag: string | null = null;
    try {
      const body = (await res.json()) as { "@odata.etag"?: unknown };
      if (typeof body["@odata.etag"] === "string") etag = body["@odata.etag"];
    } catch {
      // A successful PATCH with an unreadable body still moved the event; a null version means
      // "management must re-read first", which is honest. It must never mean "any version will do".
    }
    return { outcome: "updated", etag };
  },
});

// ── The Graph event-concurrency probe (17-07 Task 1, the gate on 17-08) ────────────────────────
//
// WHY THIS EXISTS AT ALL. Microsoft documents `changeKey` as the event version and a GET event
// returns `@odata.etag`, but the v1.0 event PATCH/DELETE reference does NOT promise `If-Match`
// support or a 412 on a stale one. Generic OData assumptions are not evidence. Management (update /
// move / cancel) without a proven atomic compare-and-swap means a lost update: two edits race and
// the second silently overwrites the first on a real person's calendar.
//
// So 17-08 is gated on THIS returning `supported: true` against a real account. If Graph ignores or
// rejects `If-Match`, the recorded fallback is Microsoft create-only plus Google management while
// ACTN-02 stays pending — and a new plan must choose a Microsoft-DOCUMENTED atomic primitive.
// **Never fall back to unconditional PATCH/DELETE, and never to a GET-then-compare `changeKey`**:
// both are read-modify-write races wearing a seatbelt.
//
// ⚠ RUN THIS ONLY AGAINST A DISPOSABLE ACCOUNT. It creates and deletes a real calendar event.
// It is gated on an explicit env flag so it can never fire as a side effect of anything else.
//
//   npx convex env set PHASE17_ALLOW_DISPOSABLE_GRAPH_PROBE true
//   npx convex run microsoftCalendar:graphConcurrencyProbe '{"tenantId":"<tenant>"}' \
//     > .planning/phases/17-calendar-actions/17-GRAPH-CONCURRENCY-PROBE.json
//   npx convex env remove PHASE17_ALLOW_DISPOSABLE_GRAPH_PROBE
//
// The result is REFS ONLY — hashes, statuses and booleans. No subject, time, body, token or raw
// account id is stored, because this artifact is committed.
export const graphConcurrencyProbe = internalAction({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    // The gate. Not a warning, not a confirm — a refusal, so a stray invocation cannot touch a
    // real calendar.
    if (process.env.PHASE17_ALLOW_DISPOSABLE_GRAPH_PROBE !== "true") {
      throw new Error(
        "graphConcurrencyProbe refused: set PHASE17_ALLOW_DISPOSABLE_GRAPH_PROBE=true and run only against a DISPOSABLE Microsoft account.",
      );
    }

    const nowMs = Date.now();
    const access = await freshGraphToken(ctx, tenantId, nowMs);
    if (!access.ok) throw new Error(`graphConcurrencyProbe: no usable grant (${access.reason})`);
    const auth = { Authorization: `Bearer ${access.token}` };
    const jsonAuth = { ...auth, "Content-Type": "application/json" };

    // A unique marker so a leaked event is identifiable and never collides with real work.
    const marker = `pikar-probe-${eventIdFor(`${tenantId}:${nowMs}`)}`;
    const startMs = nowMs + 86_400_000;
    // The SAME url builder the 17-08 writers use, so a probe cannot measure a path they do not take.
    const eventUrl = EVENT_URL;

    let eventId: string | null = null;
    let freshEtag: string | null = null;
    let initialEtag: string | null = null;
    let changedEtag: string | null = null;
    let stalePatchStatus = 0;
    let staleDeleteStatus = 0;
    let stalePatchPreserved = false;
    let staleDeletePreserved = false;
    let cleanupMissing = false;

    try {
      // 1. E1 — attendee-free, so nothing is mailed to anyone by creating it.
      const created = await fetch(EVENTS_ENDPOINT, {
        method: "POST",
        headers: jsonAuth,
        body: JSON.stringify({
          subject: marker,
          start: { dateTime: toRfc3339(startMs), timeZone: "UTC" },
          end: { dateTime: toRfc3339(startMs + 1_800_000), timeZone: "UTC" },
        }),
      });
      if (!created.ok) throw new Error(`probe create failed: ${created.status}`);
      const createdBody = (await created.json()) as { id?: string; "@odata.etag"?: string };
      if (!createdBody.id) throw new Error("probe create returned no id");
      eventId = createdBody.id;

      // 2. GET E1's authoritative etag (the create response's is not re-read by management).
      const readOne = await fetch(eventUrl(eventId), { headers: auth });
      const readOneBody = (await readOne.json()) as { "@odata.etag"?: string };
      initialEtag = readOneBody["@odata.etag"] ?? createdBody["@odata.etag"] ?? null;
      if (!initialEtag) throw new Error("probe: no etag on the created event");
      freshEtag = initialEtag;

      // 3. A CONDITIONAL update with the CURRENT etag must SUCCEED — the positive witness. Without
      //    it, a Graph that rejects every If-Match would look identical to one that enforces it.
      const updated = await fetch(eventUrl(eventId), {
        method: "PATCH",
        headers: { ...jsonAuth, "If-Match": initialEtag },
        body: JSON.stringify({ subject: `${marker}-v2` }),
      });
      if (!updated.ok) throw new Error(`probe conditional update failed: ${updated.status}`);
      const updatedBody = (await updated.json()) as { "@odata.etag"?: string };
      changedEtag = updatedBody["@odata.etag"] ?? null;
      if (changedEtag) freshEtag = changedEtag;
      // The version MUST move, or there is nothing for a stale comparison to catch.
      if (!changedEtag || changedEtag === initialEtag) {
        throw new Error("probe: the etag did not change across a successful update");
      }

      // 4. THE STALE PATCH. Expect 412.
      const stalePatch = await fetch(eventUrl(eventId), {
        method: "PATCH",
        headers: { ...jsonAuth, "If-Match": initialEtag },
        body: JSON.stringify({ subject: `${marker}-STALE-MUST-NOT-LAND` }),
      });
      stalePatchStatus = stalePatch.status;

      // 5. E2 must be untouched by the refusal — a 412 that still wrote is worse than no 412.
      const afterPatch = await fetch(eventUrl(eventId), { headers: auth });
      const afterPatchBody = (await afterPatch.json()) as { "@odata.etag"?: string };
      stalePatchPreserved = afterPatch.ok && afterPatchBody["@odata.etag"] === changedEtag;
      if (afterPatchBody["@odata.etag"]) freshEtag = afterPatchBody["@odata.etag"];

      // 6. THE STALE DELETE. Expect 412. `DELETE`, never `/cancel` — cancel mails attendees.
      const staleDelete = await fetch(eventUrl(eventId), {
        method: "DELETE",
        headers: { ...auth, "If-Match": initialEtag },
      });
      staleDeleteStatus = staleDelete.status;

      // 7. The event must still EXIST after the refused delete.
      const afterDelete = await fetch(eventUrl(eventId), { headers: auth });
      staleDeletePreserved = afterDelete.ok;
      if (afterDelete.ok) {
        const b = (await afterDelete.json()) as { "@odata.etag"?: string };
        if (b["@odata.etag"]) freshEtag = b["@odata.etag"];
      }
    } finally {
      // Cleanup ALWAYS runs, with the CURRENT version — a probe that leaves an event on a real
      // calendar is a defect regardless of what it proved.
      if (eventId) {
        try {
          await fetch(eventUrl(eventId), {
            method: "DELETE",
            headers: freshEtag ? { ...auth, "If-Match": freshEtag } : auth,
          });
          const gone = await fetch(eventUrl(eventId), { headers: auth });
          cleanupMissing = gone.status === 404;
        } catch {
          cleanupMissing = false;
        }
      }
    }

    const supported =
      stalePatchStatus === 412 &&
      staleDeleteStatus === 412 &&
      stalePatchPreserved &&
      staleDeletePreserved;

    return {
      schema: "phase17-graph-concurrency-probe.v1",
      // The SAME hash the 17-08 update gate recomputes and compares against. One implementation:
      // a probe whose deployment identity is computed differently from the gate's would bind to
      // nothing, and the failure mode would be a silently-refused (or silently-enabled) writer.
      deploymentUrlHash: await deploymentUrlHash(),
      // The PIKAR tenant that owns the grant, hashed. Deliberately NOT the Microsoft account id:
      // reading `/me` needs `User.Read`, and widening the ADR-018 grant to label a probe artifact
      // would be a permission asked for by bookkeeping. This still answers "which connection".
      accountIdHash: await contentHash(tenantId),
      eventIdHash: eventId ? await contentHash(eventId) : "",
      initialEtagHash: initialEtag ? await contentHash(initialEtag) : "",
      changedEtagHash: changedEtag ? await contentHash(changedEtag) : "",
      stalePatchStatus,
      staleDeleteStatus,
      stalePatchPreserved,
      staleDeletePreserved,
      cleanupMissing,
      supported,
      capturedAt: new Date(nowMs).toISOString(),
    };
  },
});

export type { Id };
