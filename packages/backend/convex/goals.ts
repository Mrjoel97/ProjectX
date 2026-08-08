// Thin adapter over the `goals` table (CLAUDE.md §1). Selection, rendering and cycle-time
// arithmetic live in `@pikar/core`'s goals module; this file scopes, validates and audits.
import { BLUEPRINT_SEGMENTS, type Goal } from "@pikar/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { tenantMutation, tenantQuery } from "./lib/functions";

// Widened to Set<string> deliberately: BLUEPRINT_SEGMENTS' `.id` is a literal union, but the
// membership check below is against a caller-supplied `string` arg — Set<Literal>.has(string)
// fails to typecheck otherwise (contravariant parameter check).
const KNOWN_SEGMENT_IDS = new Set<string>(BLUEPRINT_SEGMENTS.map((s) => s.id));
const STATUSES = ["active", "achieved", "dropped"] as const;
const TEXT_MAX = 500;

// Exported for `blueprint.ts`'s `spineForTenant` (Task 4b) — the one row→core-`Goal` mapper,
// shared rather than duplicated.
export function toGoal(row: Doc<"goals">): Goal {
  return {
    id: row._id,
    segmentId: row.segmentId,
    text: row.text,
    targetDate: row.targetDate,
    parentId: row.parentId,
    status: row.status,
    createdAt: row.createdAt,
    statusChangedAt: row.statusChangedAt,
  };
}

export const listGoals = tenantQuery({
  args: {},
  handler: async (ctx): Promise<Goal[]> => {
    const rows: Doc<"goals">[] = [];
    for (const status of STATUSES) {
      const forStatus = await ctx.db
        .query("goals")
        .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", status))
        .collect();
      rows.push(...forStatus);
    }
    return rows.map(toGoal);
  },
});

export const addGoal = tenantMutation({
  args: {
    segmentId: v.string(),
    text: v.string(),
    targetDate: v.optional(v.number()),
    parentId: v.optional(v.id("goals")),
  },
  handler: async (ctx, args): Promise<{ id: Id<"goals"> }> => {
    if (!KNOWN_SEGMENT_IDS.has(args.segmentId)) {
      throw new ConvexError({ code: "INVALID_SEGMENT", segmentId: args.segmentId });
    }
    const text = args.text.trim();
    if (text.length === 0 || text.length > TEXT_MAX) {
      throw new ConvexError({ code: "INVALID_TEXT" });
    }
    // Convex float64 permits NaN/Infinity, and any finite value with |ms| > 8.64e15 is an
    // Invalid Date. Core's `isoDay` calls `new Date(ms).toISOString()`, which THROWS on all of
    // those — and that throw lands in `spineForTenant`'s catch-all, blanking the WHOLE blueprint
    // spine (every field, not just goals) for every cockpit turn and vault-grounding call.
    if (
      args.targetDate !== undefined &&
      !(Number.isFinite(args.targetDate) && Math.abs(args.targetDate) <= 8.64e15)
    ) {
      throw new ConvexError({ code: "INVALID_TARGET_DATE" });
    }
    let nested = false;
    if (args.parentId !== undefined) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.tenantId !== ctx.tenantId) {
        throw new ConvexError({ code: "PARENT_NOT_FOUND" });
      }
      if (parent.parentId !== undefined) {
        throw new ConvexError({ code: "NESTING_TOO_DEEP" });
      }
      nested = true;
    }
    const now = Date.now();
    const goalId = await ctx.db.insert("goals", {
      tenantId: ctx.tenantId,
      segmentId: args.segmentId,
      text,
      targetDate: args.targetDate,
      parentId: args.parentId,
      status: "active",
      createdAt: now,
      statusChangedAt: now,
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "goal.added",
      actor: "user",
      // §4: refs, enums and counts only — never `text`.
      payload: {
        goalId,
        segmentId: args.segmentId,
        hasTargetDate: args.targetDate !== undefined,
        nested,
      },
    });
    return { id: goalId };
  },
});

export const setGoalStatus = tenantMutation({
  args: {
    id: v.id("goals"),
    status: v.union(v.literal("active"), v.literal("achieved"), v.literal("dropped")),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const row = await ctx.db.get(args.id);
    if (!row || row.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "GOAL_NOT_FOUND" });
    }
    const from = row.status;
    const statusChangedAt = Date.now();
    await ctx.db.patch(args.id, { status: args.status, statusChangedAt });
    const cycleDays = Math.max(0, Math.round((statusChangedAt - row.createdAt) / 86_400_000));
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "goal.status_changed",
      actor: "user",
      // §4: ids, enums and counts only — never `text`.
      payload: { goalId: args.id, from, to: args.status, cycleDays },
    });
    return { ok: true };
  },
});
