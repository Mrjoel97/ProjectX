import { AUTH_REVOCATION_RETENTION_MS } from "@pikar/core/authLifetime";
import { v } from "convex/values";
import { internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./lib/tenantLifecycle";

/** Security metadata only, retained until every pre-erasure access JWT has expired. */
export async function revokeErasedIdentity(ctx: MutationCtx, userId: string) {
  const existing = await ctx.db
    .query("authRevocations")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (existing)
    await ctx.db.patch(existing._id, { state: "deleted", expiresAt: Number.MAX_SAFE_INTEGER });
  else
    await ctx.db.insert("authRevocations", {
      userId,
      state: "deleted",
      expiresAt: Number.MAX_SAFE_INTEGER,
    });
}

export async function identityIsRevoked(
  ctx: QueryCtx,
  userId: string,
  sessionId?: string,
  allowDeleting = false,
) {
  const row = await ctx.db
    .query("authRevocations")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (!row) return false;
  if (row.state === "deleted") return true;
  if (row.state === "deleting" && !allowDeleting) return true;
  if (row.state === "deleting" && !row.requireLiveSession) return false;
  if (row.expiresAt <= Date.now()) return false;
  if (!row.requireLiveSession) return true;
  const id = sessionId ? ctx.db.normalizeId("authSessions", sessionId) : null;
  const session = id ? await ctx.db.get(id) : null;
  return !session || String(session.userId) !== userId || session.expirationTime <= Date.now();
}

/** Action wrappers cannot read the database directly. Never a public identity lookup. */
export const isRevoked = internalQuery({
  args: {
    userId: v.string(),
    sessionId: v.optional(v.string()),
    allowDeleting: v.optional(v.boolean()),
  },
  handler: (ctx, { userId, sessionId, allowDeleting }) =>
    identityIsRevoked(ctx, userId, sessionId, allowDeleting),
});

export const erasureInProgress = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return row?.state !== undefined;
  },
});

export const beginErasure = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    if (!(await ctx.db.get(userId))) throw new Error("TENANT_SELF_REQUIRED");
    const row = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", String(userId)))
      .unique();
    if (row?.state === "deleted") throw new Error("UNAUTHENTICATED");
    const value = { state: "deleting" as const, expiresAt: Number.MAX_SAFE_INTEGER };
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert("authRevocations", { userId: String(userId), ...value });
  },
});

/** Called only after installed Password has verified the code and invalidated old sessions. */
export const requireLiveSessions = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", String(userId)))
      .unique();
    if (row?.state) throw new Error("UNAUTHENTICATED");
    const value = {
      requireLiveSession: true,
      expiresAt: Date.now() + AUTH_REVOCATION_RETENTION_MS,
    };
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert("authRevocations", { userId: String(userId), ...value });
  },
});

export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("authRevocations")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(256);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length, moreMayRemain: rows.length === 256 };
  },
});
