import { ZERNIO_DAY_MS, ZERNIO_REFRESH_MS, type ZernioReport } from "@pikar/core/zernio";
import { ZERNIO_ID } from "@pikar/core/zernioPilot";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { assertTenantWritable, internalMutation } from "./lib/tenantLifecycle";
import { captureServiceObservation } from "./serviceOutcomes";

export const zernioChannelValue = v.object({
  id: v.string(),
  name: v.string(),
  platform: v.union(v.literal("instagram"), v.literal("tiktok")),
  available: v.boolean(),
});
export const zernioReportValue = v.object({
  fromDate: v.string(),
  toDate: v.string(),
  fetchedAt: v.number(),
  accounts: v.array(
    v.object({
      accountId: v.string(),
      platform: v.union(v.literal("instagram"), v.literal("tiktok")),
      posts: v.array(
        v.object({
          postId: v.string(),
          nativePostUrl: v.optional(v.string()),
          source: v.union(v.literal("external"), v.literal("zernio")),
          updatedAt: v.union(v.string(), v.null()),
          metrics: v.object({
            impressions: v.optional(v.number()),
            reach: v.optional(v.number()),
            likes: v.optional(v.number()),
            comments: v.optional(v.number()),
            shares: v.optional(v.number()),
            saves: v.optional(v.number()),
            clicks: v.optional(v.number()),
            views: v.optional(v.number()),
            engagementRate: v.optional(v.number()),
          }),
        }),
      ),
    }),
  ),
});
const envelope = {
  ciphertextB64: v.string(),
  ivB64: v.string(),
  keyVersion: v.union(v.literal("v1"), v.literal("v2")),
};
export const hashZernioTicket = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`zernio-connect:${value}`)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

export const status = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    return {
      configured:
        !!process.env.CONNECTOR_CREDENTIAL_KEY_V1 &&
        !!process.env.CONVEX_SITE_URL &&
        !!process.env.SITE_URL,
      status: row?.status ?? "disconnected",
      channels: row?.channels ?? [],
      selectedAccountIds: row?.selectedAccountIds ?? [],
      dailyReports: row?.dailyReports ?? false,
      lastAttemptAt: row?.lastAttemptAt ?? null,
      lastFailure: row?.lastFailure ?? null,
      nextRefreshAt: row?.nextRefreshAt ?? 0,
    };
  },
});
export const latestReport = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("zernioReports")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    return row?.report ?? null;
  },
});
export const beginConnect = tenantMutation({
  args: { profileId: v.string() },
  handler: async (ctx, { profileId }) => {
    if (!ZERNIO_ID.test(profileId) || !process.env.CONNECTOR_CREDENTIAL_KEY_V1)
      throw new Error("ZERNIO_CONNECTION_INVALID");
    const site = new URL(process.env.CONVEX_SITE_URL ?? "");
    if (site.protocol !== "https:" || !site.hostname.endsWith(".convex.site"))
      throw new Error("ZERNIO_NOT_CONFIGURED");
    const ticket = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const old = await ctx.db
      .query("zernioConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    const row = {
      tenantId: ctx.tenantId,
      profileId,
      connectionId: crypto.randomUUID(),
      revision: (old?.revision ?? 0) + 1,
      status: "connecting" as const,
      channels: [],
      selectedAccountIds: [],
      dailyReports: false,
      nextReportAt: 0,
      nextRefreshAt: 0,
      updatedAt: Date.now(),
      ticketHash: await hashZernioTicket(ticket),
      connectExpiresAt: Date.now() + 600_000,
      connectClaimed: false,
    };
    if (old) await ctx.db.replace(old._id, row);
    else await ctx.db.insert("zernioConnections", row);
    const report = await ctx.db
      .query("zernioReports")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (report) await ctx.db.delete(report._id);
    return { url: new URL(`/zernio/connect?ticket=${ticket}`, site).toString() };
  },
});
/** One-use public HTTP capability; the authenticated mutation above owns tenant/profile binding. */
export const claimConnect = internalMutation({
  args: { ticketHash: v.string() },
  handler: async (ctx, { ticketHash }) => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_ticket", (q) => q.eq("ticketHash", ticketHash))
      .unique();
    if (
      !row ||
      row.status !== "connecting" ||
      row.connectClaimed ||
      (row.connectExpiresAt ?? 0) <= Date.now()
    )
      return null;
    await assertTenantWritable(ctx, row.tenantId);
    await ctx.db.patch(row._id, { ticketHash: undefined, connectClaimed: true });
    return row;
  },
});
export const completeConnect = internalMutation({
  args: {
    tenantId: v.string(),
    connectionId: v.string(),
    channels: v.array(zernioChannelValue),
    ...envelope,
  },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
      .unique();
    if (
      !row ||
      row.connectionId !== a.connectionId ||
      row.status !== "connecting" ||
      !row.connectClaimed ||
      (row.connectExpiresAt ?? 0) <= Date.now()
    )
      return false;
    if (a.channels.length > 100) throw new Error("ZERNIO_CONNECTION_INVALID");
    await ctx.db.patch(row._id, {
      ...a,
      status: "connected",
      updatedAt: Date.now(),
      connectClaimed: undefined,
      connectExpiresAt: undefined,
    });
    return true;
  },
});
export const connection = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const revoked = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", tenantId))
      .unique();
    if (revoked?.state) return null;
    return ctx.db
      .query("zernioConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
  },
});
export const failConnect = internalMutation({
  args: { tenantId: v.string(), connectionId: v.string(), failure: v.string() },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
      .unique();
    if (row?.connectionId === a.connectionId && row.status === "connecting")
      await ctx.db.patch(row._id, {
        status: "disconnected",
        lastFailure: a.failure,
        connectClaimed: undefined,
        connectExpiresAt: undefined,
        ticketHash: undefined,
      });
  },
});
export const selectAccounts = tenantMutation({
  args: { accountIds: v.array(v.string()), dailyReports: v.boolean() },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (
      !row ||
      row.status !== "connected" ||
      a.accountIds.length > 2 ||
      new Set(a.accountIds).size !== a.accountIds.length ||
      (a.dailyReports && !a.accountIds.length) ||
      a.accountIds.some((id) => !row.channels.some((c) => c.id === id && c.available))
    )
      throw new Error("ZERNIO_ACCOUNT_NOT_ALLOWED");
    const changed =
      JSON.stringify([...row.selectedAccountIds].sort()) !==
      JSON.stringify([...a.accountIds].sort());
    await ctx.db.patch(row._id, {
      selectedAccountIds: a.accountIds,
      dailyReports: a.dailyReports,
      nextReportAt: Date.now(),
      revision: row.revision + 1,
      // Scheduling edits cancel old workers without changing the configured account scope.
      grantRevision: (row.grantRevision ?? row.revision) + (changed ? 1 : 0),
      lease: undefined,
      leaseUntil: undefined,
      updatedAt: Date.now(),
    });
    if (changed) {
      const report = await ctx.db
        .query("zernioReports")
        .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
        .unique();
      if (report) await ctx.db.delete(report._id);
    }
  },
});
export const disconnect = tenantMutation({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (row)
      await ctx.db.replace(row._id, {
        tenantId: ctx.tenantId,
        connectionId: crypto.randomUUID(),
        profileId: "",
        revision: row.revision + 1,
        status: "disconnected",
        channels: [],
        selectedAccountIds: [],
        dailyReports: false,
        nextReportAt: 0,
        nextRefreshAt: 0,
        updatedAt: Date.now(),
      });
    const report = await ctx.db
      .query("zernioReports")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (report) await ctx.db.delete(report._id);
  },
});
export const claimReport = internalMutation({
  args: { tenantId: v.string(), connectionId: v.string(), revision: v.number(), lease: v.string() },
  handler: async (ctx, a) => {
    await assertTenantWritable(ctx, a.tenantId);
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
      .unique();
    if (
      !row ||
      row.connectionId !== a.connectionId ||
      row.revision !== a.revision ||
      row.status !== "connected" ||
      !row.selectedAccountIds.length ||
      row.nextRefreshAt > Date.now() ||
      (row.leaseUntil ?? 0) > Date.now()
    )
      return null;
    await ctx.db.patch(row._id, {
      lease: a.lease,
      leaseUntil: Date.now() + 600_000,
      nextRefreshAt: Date.now() + ZERNIO_REFRESH_MS,
      lastAttemptAt: Date.now(),
    });
    return row;
  },
});
export const finishReport = internalMutation({
  args: {
    tenantId: v.string(),
    connectionId: v.string(),
    revision: v.number(),
    lease: v.string(),
    report: v.optional(zernioReportValue),
    channels: v.optional(v.array(zernioChannelValue)),
    failure: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
      .unique();
    if (
      !row ||
      row.connectionId !== a.connectionId ||
      row.revision !== a.revision ||
      row.lease !== a.lease ||
      row.status !== "connected"
    )
      return false;
    if (a.report) {
      if (
        a.report.accounts.length !== row.selectedAccountIds.length ||
        a.report.accounts.some((c) => !row.selectedAccountIds.includes(c.accountId))
      )
        throw new Error("ZERNIO_ACCOUNT_NOT_ALLOWED");
      const previous = await ctx.db
        .query("zernioReports")
        .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
        .unique();
      const snapshot = { tenantId: a.tenantId, connectionId: a.connectionId, report: a.report };
      if (previous) await ctx.db.replace(previous._id, snapshot);
      else await ctx.db.insert("zernioReports", snapshot);
      await captureServiceObservation(ctx, row, a.report);
    }
    await ctx.db.patch(row._id, {
      lease: undefined,
      leaseUntil: undefined,
      lastFailure: a.failure,
      channels: a.channels ?? row.channels,
      status: a.failure === "reauth_required" ? "reauth_required" : "connected",
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const agentReport = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const revoked = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", tenantId))
      .unique();
    if (revoked?.state) return { state: "unavailable" };
    const connection = await ctx.db
      .query("zernioConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    if (!connection || connection.status !== "connected")
      return { state: "unavailable", settingsPath: "/connect-zernio" };
    const row = await ctx.db
      .query("zernioReports")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    if (!row || row.connectionId !== connection.connectionId)
      return { state: "not_refreshed", settingsPath: "/dashboard/marketing" };
    const report: ZernioReport = row.report;
    return {
      state:
        connection.lastFailure || Date.now() - report.fetchedAt > ZERNIO_DAY_MS ? "stale" : "ready",
      provider: "zernio",
      ...report,
      accounts: report.accounts.map((a) => ({
        ...a,
        postCount: a.posts.length,
        sampled: a.posts.length > 20,
        posts: a.posts.slice(0, 20),
      })),
      metricScope: "post_lifetime",
      publisherAttribution: "unverified",
      missingMetricMeaning: "unavailable",
      sampleLimitPerAccount: 20,
      reachAndRateAggregation: "unsupported",
      retrievalIsUpstreamFreshness: false,
    };
  },
});
/** Bounded opt-in dispatch. Each worker rechecks generation, selection and erasure. */
export const tickReports = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("zernioConnections")
      .withIndex("by_report_due", (q) => q.eq("dailyReports", true).lte("nextReportAt", Date.now()))
      .take(25);
    for (const row of due) {
      const revocation = await ctx.db
        .query("authRevocations")
        .withIndex("by_userId", (q) => q.eq("userId", row.tenantId))
        .unique();
      if (revocation?.state) continue;
      await ctx.db.patch(row._id, { nextReportAt: Date.now() + ZERNIO_DAY_MS });
      if (row.status === "connected" && row.selectedAccountIds.length)
        await ctx.scheduler.runAfter(0, internal.zernioActions.refreshScheduled, {
          tenantId: row.tenantId,
          connectionId: row.connectionId,
          revision: row.revision,
        });
    }
  },
});
