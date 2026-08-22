// RPRT-01 — the GOVERNANCE read plane (plan 26-15): the audit record a browser may see, plus the
// two deployment-global facts that stay owner-only.
//
// **THIS MODULE EXISTS BECAUSE THE MOCKUP WAS WRONG TWICE**, and both corrections are structural
// rather than cosmetic:
//
//  1. "Rows carry refs, hashes, ids and counts only — that is a SCHEMA property, so this viewer is
//     safe by construction, not by filtering." It is not a schema property. `audit.log` declares
//     `payload: v.any()`, and a nested object is in the table today (`piiCounts`). So the viewer is
//     safe by FILTERING, and the filter is `@pikar/contracts/auditProjection` — allowlisted keys
//     per event, then a shape check on every surviving value. Nothing here reads `payload` for any
//     other purpose, and no code path stringifies it.
//  2. "WORM export — Healthy · lag 5h." `exportCursors` holds ONE number: the ts the exporter last
//     said it had written. It is a CURSOR POSITION, not a durability receipt — no S3 object is
//     read back, no Object Lock retention is checked, and a cron that dies mid-upload after
//     advancing would look identical. `wormExport` therefore returns `lastCursorAdvanceMs` and
//     deliberately returns NO `healthy` flag and NO `status`: the name of the field is the
//     correction, and a health verdict this data cannot support must not be inventable downstream.
//
// The window ceiling and the cursor row name are IMPORTED, never re-typed — a report that names a
// different cursor than the exporter advances, or a wider window than the business plane allows,
// is a drift bug that reads as a feature.
import { projectAuditRow } from "@pikar/contracts/auditProjection";
import { GATED_SKILLS } from "@pikar/contracts/skill";
import {
  compareDashboardOrder,
  dashboardCursorFor,
  parseDashboardCursor,
  resolveDashboardWindow,
} from "@pikar/core";
import { v } from "convex/values";
import { ownerQuery, tenantQuery } from "./lib/functions";
import { MAX_WINDOW_MS } from "./reportsBusiness";
import { REGISTRY_SKILL_NAMES } from "./skills";
import { CURSOR_NAME } from "./wormCursor";

const DEFAULT_PAGE = 25;
const MAX_PAGE = 100;

/** Rows the WORM lag read will look at before reporting a floor. */
const AWAITING_CAP = 500;

const clampPage = (requested: number | undefined): number =>
  requested === undefined ? DEFAULT_PAGE : Math.max(1, Math.min(MAX_PAGE, Math.trunc(requested)));

/**
 * One page of the tenant's own governance record, newest first, sanitized before it is serialized.
 *
 * THE ORDER MATTERS AND IS THE POINT: `projectAuditRow` runs inside this handler, so the raw row
 * never reaches a return value that Convex would serialize to the client. There is no "raw" mode
 * and no debug flag — a second code path that returns the unfiltered row is how the first one stops
 * being the boundary.
 *
 * ponytail: the cursor is `(ts, _id)` through `@pikar/core`'s shared dashboard cursor, the same one
 * the Content shelf pages on, so a forged or oversized cursor THROWS rather than silently restarting
 * at page one. Ceiling, inherited from that helper and real: a page can skip rows only if more than
 * `limit` of ONE tenant's audit rows share a single millisecond and sort ahead of the cursor id.
 * Upgrade path if that ever happens: widen the fetch by the number of boundary ties.
 */
export const auditPage = tenantQuery({
  args: {
    sinceMs: v.number(),
    untilMs: v.number(),
    browserTimeZone: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const window = resolveDashboardWindow({
      sinceMs: args.sinceMs,
      untilMs: args.untilMs,
      browserTimeZone: args.browserTimeZone,
      maxSpanMs: MAX_WINDOW_MS,
    });
    const limit = clampPage(args.limit);
    const after = args.cursor === undefined ? null : parseDashboardCursor(args.cursor);

    // The cursor narrows the RANGE (one contiguous read on `by_tenant_ts`) and the id tiebreak is
    // settled by the filter below — `lte` on the millisecond, because rows sharing the cursor's ms
    // are still ahead of it until the id says otherwise.
    const upperExclusive =
      after === null ? window.untilMs : Math.min(window.untilMs, after.createdAt + 1);
    const fetched = await ctx.db
      .query("audit")
      .withIndex("by_tenant_ts", (q) =>
        q.eq("tenantId", ctx.tenantId).gte("ts", window.sinceMs).lt("ts", upperExclusive),
      )
      .order("desc")
      .take(limit + 1);

    const ordered = fetched.filter(
      (r) => after === null || compareDashboardOrder({ createdAt: r.ts, id: r._id }, after) > 0,
    );
    const page = ordered.slice(0, limit);
    const rows = page.map((r) =>
      projectAuditRow({
        ts: r.ts,
        eventType: r.eventType,
        actor: r.actor,
        correlationId: r.correlationId,
        payload: r.payload,
      }),
    );

    // THE INVARIANT SIGNAL, and its scope is deliberate. A key that is not allowlisted is the
    // contract WORKING and is silent; `unsafeDrops` counts only keys we promised were refs whose
    // value was not one — i.e. a write site drifting from §4. Every field logged is code-owned:
    // `unsafeDrops > 0` requires a KNOWN event, so `eventType` is a key of the allowlist table, and
    // the count is a count. No key names, no values, nothing off the row.
    const dropped = rows.filter((r) => r.unsafeDrops > 0);
    if (dropped.length > 0) {
      const total = dropped.reduce((n, r) => n + r.unsafeDrops, 0);
      const events = [...new Set(dropped.map((r) => r.eventType))].sort().join(",");
      console.warn(
        `[reportsGovernance] audit projection refused ${total} ref(s) on ${events} — an allowlisted key carried a non-ref value`,
      );
    }

    const last = page.at(-1);
    const nextCursor =
      fetched.length > limit && last !== undefined
        ? dashboardCursorFor({ createdAt: last.ts, id: last._id })
        : null;

    return { window, rows, nextCursor };
  },
});

/**
 * OWNER-ONLY. Where the WORM export cursor stands — NOT whether the export is healthy.
 *
 * Every field name here is chosen so a later page cannot render a durability claim off it.
 * `lastCursorAdvanceMs` is null until the exporter has ever advanced, which is a different fact
 * from "0 rows behind": a deployment that never ran an export has no lag, and saying so would be
 * the mockup's green "Healthy" pill with new data behind it.
 *
 * `rowsAwaitingExport` is a FLOOR — `take(CAP + 1)` then slice, the house idiom — because an exact
 * count of an unbounded table is the read that fails first for the busiest deployment, which is
 * exactly the one whose lag matters. `oldestAwaitingMs` is exact and is the honest version of
 * "lag": one ascending row, no cap involved.
 *
 * Cross-tenant on purpose: the export is deployment-global, `audit.by_ts` is the named exception in
 * `isolation.test.ts`, and this is owner-gated with no tenant-facing caller.
 */
export const wormExport = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("exportCursors")
      .withIndex("by_name", (q) => q.eq("name", CURSOR_NAME))
      .unique();
    // `?? 0` matches `wormCursor.getCursor`'s baseline: nothing exported means everything is behind.
    const since = row?.lastExportedTs ?? 0;
    const awaiting = await ctx.db
      .query("audit")
      .withIndex("by_ts", (q) => q.gt("ts", since))
      .take(AWAITING_CAP + 1);

    return {
      lastCursorAdvanceMs: row?.lastExportedTs ?? null,
      rowsAwaitingExport: Math.min(awaiting.length, AWAITING_CAP),
      awaitingPartial: awaiting.length > AWAITING_CAP,
      oldestAwaitingMs: awaiting[0]?.ts ?? null,
    };
  },
});

/**
 * OWNER-ONLY. Which prompt version is live for each registry skill — name, version, status, gate.
 * Never a body.
 *
 * The no-body boundary is the REFUSAL, exactly as `skills.candidatesForReview` documents it: the
 * `skills` table is deployment-global and `body` is the raw prompt, so the check happens before a
 * registry row is read rather than by trimming fields off one that was.
 *
 * The name list is `REGISTRY_SKILL_NAMES`, derived from the very array `seedSkills` writes — one
 * indexed read per skill instead of a growing scan over every version ever published, and no second
 * hand-typed copy of the registry to drift.
 *
 * `status` is READ OFF THE ROW even though the index range already pinned it to "active". Writing
 * the literal here would be a field asserting a value the row could contradict, which is the shape
 * of the defect 26-14 shipped. A skill with no active version is ABSENT rather than reported at
 * version 0 — ponytail: the deployment hazard of an unseeded gated skill (`classifyDoc` fails
 * closed) is worth surfacing, and the upgrade path is returning the registry with `version: null`
 * for the gaps; nothing in this phase asks for it yet.
 */
export const activeSkills = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const out: { name: string; version: number; status: string; gated: boolean }[] = [];
    for (const name of REGISTRY_SKILL_NAMES) {
      const row = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
        .unique();
      if (row === null) continue;
      out.push({
        name,
        version: row.version,
        status: row.status,
        gated: GATED_SKILLS.includes(name),
      });
    }
    return out;
  },
});
