// The durable managed-event registry (17-08 Task 1) — what makes a created event MANAGEABLE later.
//
// Without a row carrying {provider, externalEventId, etag}, an update is a read-modify-write against
// a version nobody recorded. `manageability` (@pikar/core) is the pre-provider gate that reads this
// table, and every refusal it can return — `not_found`, `attendees_present`, `needs_inspection` —
// traces back to a fact stored here rather than to a provider round trip.
//
// SCOPE, and it is a refusal not an omission: management covers Pikar-CREATED, attendee-free events
// only. Arbitrary mailbox events are never discovered into this table, so they can never be written
// by the manage path. That boundary lives in what this module refuses to insert.
//
// §2: no raw `query`/`mutation` import. The one tenant-facing reader below goes through the scoped
// wrapper; everything else is `internalMutation`/`internalQuery` and is unreachable from a client.
import { manageability } from "@pikar/core";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { tenantQuery } from "./lib/functions";

/** The provider union, mirrored from the schema. A closed code, never provider prose. */
const PROVIDER = v.union(v.literal("google"), v.literal("microsoft"));

/**
 * The largest page an operator may ask the migration to scan. Clamped rather than validated so a
 * fat-fingered `limit: 5000` becomes a bounded page instead of an error — the operator's next call
 * carries the cursor and makes progress either way.
 */
export const MIGRATION_MAX_LIMIT = 100;

/**
 * Upsert the registry row for a created event.
 *
 * Keyed on `tenantId + provider + externalEventId`, and the TENANT COMES FIRST in that key on
 * purpose: two tenants can legitimately hold the same provider event id (a shared calendar, a
 * restored backup, a fixture), so a lookup without the tenant predicate would let one tenant's
 * update resolve to another tenant's row. Convex requires index prefixes to be equated in order,
 * which makes the tenant predicate unwritable-to-forget rather than merely wrong to omit.
 *
 * Idempotent by construction: a retrier can deliver the same success twice, so a second call finds
 * the row and patches it rather than inserting a twin.
 */
export const upsertManaged = internalMutation({
  args: {
    tenantId: v.string(),
    sourcePlanId: v.id("plans"),
    provider: PROVIDER,
    externalEventId: v.string(),
    /** ABSENT means "unknown version", never "no concurrency check needed" — see the schema note. */
    etag: v.optional(v.string()),
    title: v.string(),
    startMs: v.number(),
    durationMs: v.number(),
    tz: v.string(),
    attendeeFree: v.boolean(),
  },
  handler: async (ctx, a): Promise<Id<"calendarEvents">> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("calendarEvents")
      .withIndex("by_tenant_provider_external", (q) =>
        q
          .eq("tenantId", a.tenantId)
          .eq("provider", a.provider)
          .eq("externalEventId", a.externalEventId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        // A replay carries the same facts; a re-create after a delete revives the row. Either way
        // the LATEST provider truth wins, and `status` returns to active because the event exists.
        etag: a.etag,
        title: a.title,
        startMs: a.startMs,
        durationMs: a.durationMs,
        tz: a.tz,
        status: "active",
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("calendarEvents", {
      tenantId: a.tenantId,
      provider: a.provider,
      externalEventId: a.externalEventId,
      ...(a.etag === undefined ? {} : { etag: a.etag }),
      title: a.title,
      startMs: a.startMs,
      durationMs: a.durationMs,
      tz: a.tz,
      sourcePlanId: a.sourcePlanId,
      attendeeFree: a.attendeeFree,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** One row, tenant-checked. The tenant comparison is part of the identity, not a courtesy — the
 *  `_id` alone is a global handle and a foreign id must resolve to nothing, not to a row. */
export const getManaged = internalQuery({
  args: { tenantId: v.string(), managedEventId: v.id("calendarEvents") },
  handler: async (ctx, { tenantId, managedEventId }): Promise<Doc<"calendarEvents"> | null> => {
    const row = await ctx.db.get(managedEventId);
    return row && row.tenantId === tenantId ? row : null;
  },
});

/**
 * The STAGING SNAPSHOT: everything a `calendar_manage` proposal must pin at Approve time, plus the
 * verdict on whether the row can be managed at all.
 *
 * The etag rides it because `plans.calendarExpectedEtag` is the If-Match value the write will send,
 * and it must be the version the HUMAN approved against — a model-supplied etag would let a stale
 * plan overwrite a newer calendar edit, which is the exact data-loss path the field exists to close.
 */
export const stagingSnapshot = internalQuery({
  args: { tenantId: v.string(), managedEventId: v.id("calendarEvents") },
  handler: async (ctx, { tenantId, managedEventId }) => {
    const row = await ctx.db.get(managedEventId);
    if (!row || row.tenantId !== tenantId) return null;
    const verdict = manageability({
      status: row.status,
      attendeeFree: row.attendeeFree,
      ...(row.etag === undefined ? {} : { etag: row.etag }),
    });
    return {
      provider: row.provider,
      externalEventId: row.externalEventId,
      ...(row.etag === undefined ? {} : { etag: row.etag }),
      title: row.title,
      startMs: row.startMs,
      durationMs: row.durationMs,
      tz: row.tz,
      manageable: verdict.ok,
      ...(verdict.ok ? {} : { code: verdict.code }),
    };
  },
});

/** The bounded tenant-facing listing (17-09's tool reads this). CONTENT-PLANE title/time plus refs
 *  — no token, no provider body, no raw response, because none of those are on the row to leak. */
export const listManaged = tenantQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const take = Math.min(Math.max(limit ?? 25, 1), MIGRATION_MAX_LIMIT);
    const found = await ctx.db
      .query("calendarEvents")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "active"))
      .order("desc")
      .take(take);
    return found.map((r) => ({
      managedEventId: r._id,
      provider: r.provider,
      title: r.title,
      startMs: r.startMs,
      durationMs: r.durationMs,
      tz: r.tz,
      // A caller that cannot see WHY a row is unmanageable will propose an update that refuses at
      // the provider gate instead of being told here.
      needsInspection: r.etag === undefined,
    }));
  },
});

/** Terminal writer for a successful UPDATE: the provider's new version plus the state we sent. */
export const applyUpdate = internalMutation({
  args: {
    tenantId: v.string(),
    managedEventId: v.id("calendarEvents"),
    etag: v.optional(v.string()),
    title: v.optional(v.string()),
    startMs: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, a): Promise<boolean> => {
    const row = await ctx.db.get(a.managedEventId);
    if (!row || row.tenantId !== a.tenantId || row.status !== "active") return false;
    await ctx.db.patch(a.managedEventId, {
      ...(a.etag === undefined ? {} : { etag: a.etag }),
      ...(a.title === undefined ? {} : { title: a.title }),
      ...(a.startMs === undefined ? {} : { startMs: a.startMs }),
      ...(a.durationMs === undefined ? {} : { durationMs: a.durationMs }),
      updatedAt: Date.now(),
    });
    return true;
  },
});

/** Terminal writer for a successful DELETE. The row is marked, never removed: the audit trail of
 *  "Pikar put this on a calendar and later took it off" is the point of the registry. */
export const markDeleted = internalMutation({
  args: { tenantId: v.string(), managedEventId: v.id("calendarEvents") },
  handler: async (ctx, { tenantId, managedEventId }): Promise<boolean> => {
    const row = await ctx.db.get(managedEventId);
    if (!row || row.tenantId !== tenantId) return false;
    await ctx.db.patch(managedEventId, { status: "deleted", updatedAt: Date.now() });
    return true;
  },
});

/**
 * Backfill registry rows for pre-17-05 successful creates — OPERATOR-ONLY and EXPLICIT.
 *
 * It is a setup command rather than a lazy read-repair on purpose: a listing tool that quietly
 * materialised rows would make the first read of a tenant's calendar a write, and the rows it
 * created would be exactly the ones with no etag — i.e. unmanageable rows appearing as if they had
 * been recorded all along.
 *
 * THREE REFUSALS, each one a thing it would be easy to do and wrong:
 *  1. **No network.** It never calls a provider to discover the missing etag. The absence is
 *     recorded honestly and `manageability` reports `needs_inspection` until 17-08's inspect path
 *     refreshes it.
 *  2. **No invented version.** There is no placeholder etag. A fabricated If-Match value would be
 *     worse than none: it turns a refusal into a silent overwrite.
 *  3. **No invented event.** A legacy plan with no staged title/instant is SKIPPED and counted. An
 *     invented time on a real calendar is the worst available repair.
 *
 * Bounded by construction: `take(limit)` over the `by_calendar_run`-free plan scan is clamped to
 * MIGRATION_MAX_LIMIT and paged by cursor, never `.collect()` over an unbounded table.
 */
export const migrateLegacyCalendarEvents = internalMutation({
  args: {
    dryRun: v.boolean(),
    limit: v.optional(v.number()),
    /** The `_creationTime` of the last plan scanned. Cursor pagination, not an offset. */
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, { dryRun, limit, cursor }) => {
    const take = Math.min(Math.max(limit ?? MIGRATION_MAX_LIMIT, 1), MIGRATION_MAX_LIMIT);
    const page = await ctx.db
      .query("plans")
      .withIndex("by_creation_time", (q) =>
        cursor === undefined ? q : q.gt("_creationTime", cursor),
      )
      .take(take);

    let scanned = 0;
    let inserted = 0;
    let existing = 0;
    let skipped = 0;
    const sample: string[] = [];

    for (const plan of page) {
      if (plan.kind !== "calendar_event" || typeof plan.calendarEventId !== "string") continue;
      scanned++;

      // Absent provider MEANS google — the shipped slice was Google-only and the schema says so.
      const provider = plan.calendarProvider === "microsoft" ? "microsoft" : "google";

      if (
        plan.eventTitle === undefined ||
        plan.eventStartMs === undefined ||
        plan.eventDurationMs === undefined ||
        plan.eventTz === undefined
      ) {
        skipped++;
        continue;
      }

      const already = await ctx.db
        .query("calendarEvents")
        .withIndex("by_tenant_provider_external", (q) =>
          q
            .eq("tenantId", plan.tenantId)
            .eq("provider", provider)
            .eq("externalEventId", plan.calendarEventId as string),
        )
        .unique();
      if (already) {
        existing++;
        continue;
      }

      if (sample.length < 5) sample.push(plan.calendarEventId);
      if (dryRun) continue;

      const now = Date.now();
      await ctx.db.insert("calendarEvents", {
        tenantId: plan.tenantId,
        provider,
        externalEventId: plan.calendarEventId,
        // NO etag key at all — see refusal 2.
        title: plan.eventTitle,
        startMs: plan.eventStartMs,
        durationMs: plan.eventDurationMs,
        tz: plan.eventTz,
        sourcePlanId: plan._id,
        // A pre-17-05 create went out through the same attendee-free writer; the create path has
        // never been able to send guests.
        attendeeFree: true,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      inserted++;
    }

    const last = page[page.length - 1];
    return {
      scanned,
      inserted,
      existing,
      skipped,
      // Refs and counts only — an event id is an opaque provider handle, never content.
      sample,
      nextCursor: last?._creationTime ?? null,
      done: page.length < take,
    };
  },
});
