import {
  canClaimResearchPage,
  RESEARCH_REQUEST_LIFETIME_MS,
  researchPageLimit,
} from "@pikar/core/researchControl";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const RESEARCH_CONTROL_TOMBSTONE_MS = 24 * 60 * 60 * 1000;

/** Admitted by the authenticated driver, never by a model tool or a caller-supplied row ID. */
export const admit = internalMutation({
  args: { tenantId: v.string(), requestId: v.string(), limit: v.number() },
  handler: async (ctx, { tenantId, requestId, limit }) => {
    researchPageLimit(limit);
    if (
      !tenantId ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId)
    )
      throw new Error("RESEARCH_REQUEST_INVALID");
    const existing = await ctx.db
      .query("researchControls")
      .withIndex("by_tenant_request", (q) => q.eq("tenantId", tenantId).eq("requestId", requestId))
      .unique();
    if (existing) {
      if (existing.limit !== limit) throw new Error("RESEARCH_LIMIT_IMMUTABLE");
      return existing._id;
    }
    const expiresAt = Date.now() + RESEARCH_REQUEST_LIFETIME_MS;
    const controlId = await ctx.db.insert("researchControls", {
      tenantId,
      requestId,
      limit,
      attempts: [],
      expiresAt,
      closed: false,
    });
    // Keep an expired tombstone long enough to reject delayed replays, then remove refs-only state.
    // This one durable cleanup is registered atomically, never re-arms, and is not recurrence.
    await ctx.scheduler.runAt(
      expiresAt + RESEARCH_CONTROL_TOMBSTONE_MS,
      internal.researchControl.purgeExpired,
      {
        tenantId,
        requestId,
        controlId,
      },
    );
    return controlId;
  },
});

/** A repeated claim returns false: acknowledging an old claim cannot permit another egress. */
export const claim = internalMutation({
  args: {
    tenantId: v.string(),
    controlId: v.id("researchControls"),
    requestId: v.string(),
    attemptId: v.string(),
  },
  handler: async (ctx, { tenantId, controlId, requestId, attemptId }) => {
    const control = await ctx.db.get(controlId);
    if (
      !control ||
      control.tenantId !== tenantId ||
      control.requestId !== requestId ||
      !canClaimResearchPage(control, attemptId, Date.now())
    )
      return false;
    await ctx.db.patch(controlId, { attempts: [...control.attempts, attemptId] });
    return true;
  },
});

export const close = internalMutation({
  args: { tenantId: v.string(), controlId: v.id("researchControls"), requestId: v.string() },
  handler: async (ctx, { tenantId, controlId, requestId }) => {
    const control = await ctx.db.get(controlId);
    if (!control || control.tenantId !== tenantId || control.requestId !== requestId) return false;
    await ctx.db.patch(controlId, { closed: true });
    return true;
  },
});

/** Scheduled once by `admit`; ownership and retention are rechecked before deletion. */
export const purgeExpired = internalMutation({
  args: { tenantId: v.string(), controlId: v.id("researchControls"), requestId: v.string() },
  handler: async (ctx, { tenantId, controlId, requestId }) => {
    const control = await ctx.db.get(controlId);
    if (
      !control ||
      control.tenantId !== tenantId ||
      control.requestId !== requestId ||
      Date.now() < control.expiresAt + RESEARCH_CONTROL_TOMBSTONE_MS
    )
      return false;
    await ctx.db.delete(controlId);
    return true;
  },
});
