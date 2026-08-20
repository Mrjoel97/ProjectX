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
// §2: no raw `query`/`mutation` import. The management-card reader uses `tenantQuery`; tool-only
// listing/staging seams are internal and carry the governed tenant explicitly.
import {
  buildManageIntent,
  type CalendarFailureCode,
  type CalendarManageIntent,
  manageability,
  providerSupports,
} from "@pikar/core";
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

/** Content-plane snapshot for the management card. Tenant scoping happens in the wrapper and the
 *  row is checked again because a Convex id is globally addressable. No provider id or etag leaves
 *  the backend; the card needs only the exact before-state the user is approving against. */
export const forCard = tenantQuery({
  args: { managedEventId: v.id("calendarEvents") },
  handler: async (ctx, { managedEventId }) => {
    const row = await ctx.db.get(managedEventId);
    if (!row || row.tenantId !== ctx.tenantId) return null;
    return {
      provider: row.provider,
      title: row.title,
      startMs: row.startMs,
      durationMs: row.durationMs,
      tz: row.tz,
    };
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
  // A STRING ref, normalized here (17-09). The id reaches this query from the model's tool call, so
  // a malformed one is an expected input rather than a bug: `v.id()` would throw an
  // ArgumentValidationError, and a crash is a different answer from "no such event". Normalizing
  // makes malformed, missing and FOREIGN refs collapse to the single `null` the tool renders as
  // not-found — a caller must not be able to tell another tenant's row apart from a typo.
  args: { tenantId: v.string(), managedEventId: v.string() },
  handler: async (ctx, { tenantId, managedEventId: raw }) => {
    const managedEventId = ctx.db.normalizeId("calendarEvents", raw);
    if (!managedEventId) return null;
    const row = await ctx.db.get(managedEventId);
    if (!row || row.tenantId !== tenantId) return null;
    const verdict = manageability({
      status: row.status,
      attendeeFree: row.attendeeFree,
      ...(row.etag === undefined ? {} : { etag: row.etag }),
    });
    return {
      // Echoed back NORMALIZED so the staging mutation is handed a real Id and never re-parses the
      // model's string — one normalization, at the boundary.
      managedEventId,
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

/** The most managed events one listing may name. The model gets a bounded, current window, not a
 *  calendar export — and a cap it can disclose beats a page it cannot describe. */
export const MANAGED_LIST_CAP = 20;

/**
 * The bounded listing the 17-09 cockpit tool reads. An `internalQuery` with an EXPLICIT tenant, not
 * a `tenantQuery`: the tool runs inside a Convex action that already carries the governed tenant,
 * and an auth-derived scope would be unreadable from there (and from every offline fixture).
 *
 * WHAT IT OMITS IS THE CONTRACT. Only rows `manageability` would ACCEPT are listed, because this is
 * the model's only route to a managed-event ref: listing a legacy etag-less row, an event that grew
 * guests, or a deleted one would let the model propose a change that dies at the provider gate
 * AFTER the user was told it was staged. The omitted rows are reported as a COUNT (§4) — enough to
 * say "3 more I can't change", never enough to name one.
 *
 * It is strictly READ-ONLY and never repairs what it finds: `migrateLegacyCalendarEvents` is an
 * explicit operator command precisely so that the first read of a tenant's calendar is not a write.
 *
 * ponytail: one bounded scan, filtered and sorted in memory, because start-order and insert-order
 * disagree and there is no `[tenantId, status, startMs]` index. The ceiling is SCAN_MAX active rows
 * per tenant; add that index if a tenant's registry ever outgrows it.
 */
const SCAN_MAX = 100;
export const listManageable = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const scanned = await ctx.db
      .query("calendarEvents")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "active"))
      .take(SCAN_MAX);

    // `status` is already equated by the index; `manageability` still runs over the whole row so
    // the listing and the manage path share ONE definition of "manageable" (CLAUDE.md §8).
    const manageable = scanned.filter(
      (r) =>
        manageability({
          status: r.status,
          attendeeFree: r.attendeeFree,
          ...(r.etag === undefined ? {} : { etag: r.etag }),
        }).ok,
    );
    manageable.sort((a, b) => b.startMs - a.startMs);

    return {
      events: manageable.slice(0, MANAGED_LIST_CAP).map((r) => ({
        // A stable Convex ref, never an array index: a position in a list the model re-derives on
        // the next turn is not an identity, and staging against the wrong one touches a real event.
        managedEventId: r._id,
        provider: r.provider,
        // CONTENT PLANE, and only here: the same title/time the plan card already shows the user.
        // Never copied into audit, telemetry, notifications or trace fields.
        title: r.title,
        startMs: r.startMs,
        durationMs: r.durationMs,
        tz: r.tz,
      })),
      omitted: scanned.length - manageable.length,
      truncated: manageable.length > MANAGED_LIST_CAP || scanned.length === SCAN_MAX,
    };
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
 * Why a code union rather than `CalendarFailureCode` alone: `empty_update` and `delete_has_desired`
 * are not provider failures, they are refusals of a MALFORMED PROPOSAL, and widening the terminal's
 * closed failure vocabulary to carry them would let a staging-time mistake be written onto a plan
 * row as if a calendar had rejected something.
 */
export type StageChangeOutcome =
  | { ok: true; changed: string[] }
  | {
      ok: false;
      code: CalendarFailureCode | "empty_update" | "delete_has_desired" | "plan_mismatch";
    };

/**
 * THE STAGING WRITE (17-09 Task 2) — the whole proposal, in ONE transaction.
 *
 * It is one mutation rather than two because the registry's `etag` and the plan's
 * `calendarExpectedEtag` are compared for equality at delivery (`calendar.manageEvent` step 5): a
 * half-applied stage — fresh etag on the plan, stale one on the row — is not a partial success, it
 * is a proposal that is guaranteed to refuse with `conflict` at the moment the human approves it.
 *
 * WHAT IT TRUSTS AND WHAT IT DOES NOT. `observed` is the provider's own answer from the inspection
 * the caller just performed, so it is written as the row's new truth. `desired` came from the model
 * and is only ever DIFFED against `observed` — it can add a field to the write, never decide that a
 * field is unchanged. The ownership, active-state and manageability checks all re-run here against
 * the stored row, because the inspection happened outside this transaction.
 *
 * This closes the TOCTOU window INSIDE the app. It does not close the provider-side one, and is not
 * meant to: a change made on the calendar between staging and approval is caught by `If-Match`
 * against the etag the human actually approved (ADR-023 — version arbitration stays server-side).
 */
export const stageChange = internalMutation({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    managedEventId: v.id("calendarEvents"),
    operation: v.union(v.literal("update"), v.literal("delete")),
    /** The registry version read before inspection. If another in-app stage refreshed the row while
     *  this action was at the provider, the older inspection must not overwrite the newer mirror. */
    storedEtag: v.string(),
    /** The FRESHLY inspected provider version. Absent means the provider named none — and an
     *  If-Match we cannot send is `needs_inspection`, never "write without a version check". */
    etag: v.optional(v.string()),
    /** What the provider says the event IS right now, never the registry's memory of it. */
    observed: v.object({
      title: v.string(),
      startMs: v.number(),
      durationMs: v.number(),
      attendeeCount: v.number(),
    }),
    /** The model's requested overrides. Every key optional; absent means "leave it alone". */
    desired: v.optional(
      v.object({
        title: v.optional(v.string()),
        startMs: v.optional(v.number()),
        durationMs: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, a): Promise<StageChangeOutcome> => {
    const row = await ctx.db.get(a.managedEventId);
    // A foreign row is indistinguishable from a missing one, here as in `stagingSnapshot`.
    if (!row || row.tenantId !== a.tenantId) return { ok: false, code: "not_managed" };
    if (row.etag !== a.storedEtag) return { ok: false, code: "conflict" };

    // The registry's attendee-free bit is historical. The provider inspection is the fresh fact,
    // and a meeting that grew even one guest must write NOTHING — including no registry refresh.
    if (a.observed.attendeeCount > 0) return { ok: false, code: "attendees_present" };

    const verdict = manageability({
      status: row.status,
      attendeeFree: row.attendeeFree,
      // The FRESH etag decides manageability, not the stored one: inspecting a legacy row is
      // exactly how it stops being `needs_inspection`.
      ...(a.etag === undefined ? {} : { etag: a.etag }),
    });
    if (!verdict.ok) return { ok: false, code: verdict.code };

    // The provider refusal, again, at the staging boundary. `manageEvent` refuses a Microsoft
    // cancel too — but refusing only there would let a user approve a delete that can never run.
    const support = providerSupports(row.provider, a.operation);
    if (!support.ok) return { ok: false, code: support.code };

    let intent: CalendarManageIntent;
    try {
      intent = buildManageIntent({
        operation: a.operation,
        current: { ...a.observed, tz: row.tz },
        ...(a.desired === undefined ? {} : { desired: a.desired }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        code: message.includes("DELETE_HAS_DESIRED") ? "delete_has_desired" : "empty_update",
      };
    }

    const plan = await ctx.db.get(a.planId);
    if (
      !plan ||
      plan.tenantId !== a.tenantId ||
      !["collecting", "proposed"].includes(plan.status) ||
      (plan.kind !== undefined && plan.kind !== "calendar_manage")
    ) {
      return { ok: false, code: "plan_mismatch" };
    }

    const changed = intent.operation === "update" ? intent.changed : {};
    const now = Date.now();

    // 1. The registry mirror catches up to the provider. `status` is deliberately untouched — this
    //    refreshes what we know, it does not decide that anything happened.
    await ctx.db.patch(a.managedEventId, {
      etag: a.etag,
      title: a.observed.title,
      startMs: a.observed.startMs,
      durationMs: a.observed.durationMs,
      attendeeFree: true,
      updatedAt: now,
    });

    // 2. The proposal. Every desired slot is written EXPLICITLY, including the undefined ones:
    //    Convex `patch` deletes a key set to undefined, and a re-stage over a previous proposal
    //    that left a stale `eventTitle` behind would offer a change nobody asked for this time.
    await ctx.db.patch(a.planId, {
      kind: "calendar_manage",
      status: "proposed",
      calendarProvider: row.provider,
      calendarOperation: a.operation,
      calendarManagedEventId: a.managedEventId,
      calendarExpectedEtag: a.etag,
      // A restage after a refusal must not keep rendering the old failure copy.
      calendarFailureCode: undefined,
      eventTitle: changed.title,
      eventStartMs: changed.startMs,
      eventDurationMs: changed.durationMs,
      // The zone rides the registry row (`manageEvent` falls back to it); a management proposal
      // never moves an event between time zones.
      eventTz: undefined,
    });

    return { ok: true, changed: Object.keys(changed) };
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
