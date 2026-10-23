import {
  SERVICE_OBSERVATION_LIMIT,
  serviceReportIdentity,
  serviceReportMovement,
  serviceSourceFreshness,
} from "@pikar/core/serviceOutcomes";
import { projectSocialServiceOutcome } from "@pikar/core/socialServiceOutcome";
import { ZERNIO_DAY_MS, type ZernioReport } from "@pikar/core/zernio";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { readBusinessLedgerForTenant } from "./blueprint";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";

/** Called only after finishReport verifies the exact current connection, revision and lease. */
export async function captureServiceObservation(
  ctx: MutationCtx,
  connection: Doc<"zernioConnections">,
  report: ZernioReport,
) {
  const connectionRevision = connection.grantRevision ?? connection.revision;
  const snapshotHash = await contentHash(`${connectionRevision}:${serviceReportIdentity(report)}`);
  const existing = await ctx.db
    .query("serviceOutcomeObservations")
    .withIndex("by_connection_createdAt", (q) =>
      q.eq("tenantId", connection.tenantId).eq("connectionId", connection.connectionId),
    )
    .order("desc")
    .first();
  if (existing?.snapshotHash === snapshotHash) return existing._id;
  const id = await ctx.db.insert("serviceOutcomeObservations", {
    tenantId: connection.tenantId,
    connectionId: connection.connectionId,
    connectionRevision,
    snapshotHash,
    report,
    createdAt: Date.now(),
  });
  const rows = await ctx.db
    .query("serviceOutcomeObservations")
    .withIndex("by_tenant", (q) => q.eq("tenantId", connection.tenantId))
    .order("desc")
    .take(SERVICE_OBSERVATION_LIMIT + 1);
  for (const row of rows.slice(SERVICE_OBSERVATION_LIMIT)) await ctx.db.delete(row._id);
  return id;
}

export const bindGoal = tenantMutation({
  args: {
    serviceId: v.id("managedServices"),
    goalId: v.id("goals"),
    expectedRevision: v.number(),
    expectedControlRevision: v.number(),
  },
  handler: async (ctx, args): Promise<{ revision: number; controlRevision: number }> => {
    const [service, goal] = await Promise.all([
      ctx.db.get(args.serviceId),
      ctx.db.get(args.goalId),
    ]);
    if (!service || service.tenantId !== ctx.tenantId || !goal || goal.tenantId !== ctx.tenantId)
      throw new Error("SERVICE_GOAL_UNAVAILABLE");
    if (
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < 1 ||
      !Number.isSafeInteger(args.expectedControlRevision) ||
      args.expectedControlRevision < 1 ||
      !Number.isSafeInteger(service.revision) ||
      service.revision >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(service.controlRevision) ||
      service.controlRevision >= Number.MAX_SAFE_INTEGER ||
      service.revision !== args.expectedRevision ||
      service.controlRevision !== args.expectedControlRevision
    )
      throw new Error("SERVICE_CONFIGURATION_STALE");
    const revision = service.revision + 1,
      controlRevision = service.controlRevision + 1;
    await ctx.db.patch(service._id, {
      goalId: goal._id,
      revision,
      controlRevision,
      updatedAt: Date.now(),
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      actor: "user",
      eventType: "managed_service.goal_linked",
      payload: { serviceRef: service._id, goalRef: goal._id, revision, controlRevision },
    });
    return { revision, controlRevision };
  },
});

export const recordUsefulness = tenantMutation({
  args: {
    runId: v.id("managedServiceRuns"),
    usefulness: v.union(v.literal("accepted"), v.literal("rejected")),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.tenantId !== ctx.tenantId) throw new Error("SERVICE_RUN_UNAVAILABLE");
    if (!["completed", "failed", "stopped"].includes(run.state))
      throw new Error("SERVICE_RESULT_UNRESOLVED");
    await ctx.db.patch(run._id, { usefulness: args.usefulness, usefulnessAt: Date.now() });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      actor: "user",
      eventType: "managed_service.usefulness_recorded",
      payload: { runRef: run._id, usefulness: args.usefulness },
    });
    return { ok: true };
  },
});

export const historyPage = tenantQuery({
  args: { connectionId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("zernioConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (
      !connection ||
      connection.connectionId !== args.connectionId ||
      connection.status !== "connected"
    )
      throw new Error("SERVICE_SOURCE_UNAVAILABLE");
    const result = await ctx.db
      .query("serviceOutcomeObservations")
      .withIndex("by_connection_createdAt", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("connectionId", args.connectionId),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(20, Math.max(1, args.paginationOpts.numItems)),
      });
    return {
      ...result,
      page: result.page.filter(
        (row) =>
          row.connectionRevision === (connection.grantRevision ?? connection.revision) &&
          row.report.accounts.every(
            (a) =>
              connection.selectedAccountIds.includes(a.accountId) &&
              connection.channels.some((c) => c.id === a.accountId && c.available),
          ),
      ),
    };
  },
});

async function readRunOutcome(
  ctx: QueryCtx & { tenantId: string },
  { runId }: { runId: Id<"managedServiceRuns"> },
) {
  const run = await ctx.db.get(runId);
  if (!run || run.tenantId !== ctx.tenantId) throw new Error("SERVICE_RUN_UNAVAILABLE");
  const goal = run.goalId ? await ctx.db.get(run.goalId) : null;
  const service = await ctx.db.get(run.serviceId);
  const connection = await ctx.db
    .query("zernioConnections")
    .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
    .unique();
  const configMatches =
    service?.tenantId === ctx.tenantId && service.revision === run.configRevision;
  const pins = configMatches
    ? service.accounts.filter(
        (a) =>
          a.provider === "zernio" &&
          a.connectionId === connection?.connectionId &&
          a.connectionRevision === (connection.grantRevision ?? connection.revision),
      )
    : [];
  const pin = pins[0];
  const available =
    !!pin &&
    connection?.status === "connected" &&
    pins.every(
      (p) =>
        connection.selectedAccountIds.includes(p.accountId) &&
        connection.channels.some((c) => c.id === p.accountId && c.available),
    );
  const history =
    available && connection
      ? await ctx.db
          .query("serviceOutcomeObservations")
          .withIndex("by_connection_createdAt", (q) =>
            q.eq("tenantId", ctx.tenantId).eq("connectionId", connection.connectionId),
          )
          .order("desc")
          .take(SERVICE_OBSERVATION_LIMIT)
      : [];
  const scoped = history
    .filter(
      (row) =>
        connection !== null &&
        row.connectionRevision === (connection.grantRevision ?? connection.revision) &&
        row.report.accounts.every((a) => connection.selectedAccountIds.includes(a.accountId)),
    )
    .slice(0, 2);
  const reports: ZernioReport[] = scoped.map((row) => ({
    ...row.report,
    accounts: row.report.accounts.filter((a) => pins.some((p) => p.accountId === a.accountId)),
  }));
  const cached = available
    ? await ctx.db
        .query("zernioReports")
        .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
        .unique()
    : null;
  const [currentReport, previousReport] = reports;
  const [currentObservation] = scoped;
  // A deduplicated retrieval keeps the original observation time; expose the current fetch separately.
  if (
    cached &&
    connection &&
    currentReport &&
    currentObservation &&
    cached.connectionId === connection.connectionId &&
    serviceReportIdentity(cached.report) === serviceReportIdentity(currentObservation.report)
  )
    currentReport.fetchedAt = cached.report.fetchedAt;
  const drafts = await ctx.db
    .query("bufferPosts")
    .withIndex("by_managed_service_run", (q) =>
      q.eq("tenantId", ctx.tenantId).eq("managedServiceRunId", run._id),
    )
    .take(11);
  const bufferConnection = drafts.length
    ? await ctx.db
        .query("bufferConnections")
        .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
        .unique()
    : null;
  const retrieval = serviceSourceFreshness({
    fetchedAt: currentReport?.fetchedAt ?? Number.NaN,
    sourceUpdatedAt: null,
    now: Date.now(),
    maxAgeMs: ZERNIO_DAY_MS,
  }).retrieval;
  return {
    runId: run._id,
    serviceId: run.serviceId,
    planId: run.planId ?? null,
    threadId: run.threadId ?? null,
    operational: run.state,
    goal: goal?.tenantId === ctx.tenantId ? { goalId: goal._id, status: goal.status } : null,
    usefulness: run.usefulness ?? "unreviewed",
    businessImprovement: "not_established" as const,
    reporting: {
      state: !available
        ? ("unavailable" as const)
        : scoped.length === 0
          ? ("insufficient_history" as const)
          : connection?.lastFailure || retrieval !== "fresh"
            ? ("stale" as const)
            : scoped.length < 2
              ? ("insufficient_history" as const)
              : ("ready" as const),
      retrieval,
      sourceFailure: !!connection?.lastFailure,
      observations: scoped.map((row) => ({
        observationId: row._id,
        snapshotHash: row.snapshotHash,
        retrievedAt: row.report.fetchedAt,
        capturedAt: row.createdAt,
      })),
      movement:
        previousReport && currentReport && !connection?.lastFailure
          ? serviceReportMovement(previousReport, currentReport, Date.now(), ZERNIO_DAY_MS)
          : null,
    },
    social: drafts.slice(0, 10).map((draft) =>
      projectSocialServiceOutcome({
        tenantId: ctx.tenantId,
        runId: run._id,
        draft: {
          draftRef: draft._id,
          tenantId: draft.tenantId,
          connectionId: draft.connectionId,
          managedServiceRunId: draft.managedServiceRunId,
          channelId: draft.channelId,
          revision: draft.revision,
          platform:
            draft.platform ??
            (bufferConnection?.connectionId === draft.connectionId
              ? (bufferConnection.channels.find((c) => c.id === draft.channelId)?.service ??
                "unknown")
              : "unknown"),
          status: draft.status,
          approvedAt: draft.approvedAt,
          bufferPostId: draft.bufferPostId,
        },
        report:
          available && connection && currentReport
            ? {
                tenantId: ctx.tenantId,
                connectionId: connection.connectionId,
                report: currentReport,
              }
            : null,
        selectedConnectionId: available && connection ? connection.connectionId : null,
        selectedAccountIds: pins.map((p) => p.accountId),
        now: Date.now(),
        maxReportAgeMs: ZERNIO_DAY_MS,
      }),
    ),
    socialTruncated: drafts.length > 10,
    // These stores retain cost and latency authority; no copied numeric result lives here.
    accounting: { ledgerRunId: run._id, activityTurnId: run.turnId ?? null },
  };
}

export const runOutcome = tenantQuery({
  args: { runId: v.id("managedServiceRuns") },
  handler: readRunOutcome,
});

/** A cited view, not a new business-fact store or a goal-achievement writer. */
export const serviceBrainView = tenantQuery({
  args: { serviceId: v.string() },
  handler: async (ctx, { serviceId }) => {
    const service = await ctx.db
      .query("managedServices")
      .withIndex("by_tenant_service", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("serviceId", serviceId),
      )
      .unique();
    if (!service) return null;
    const goal = service.goalId ? await ctx.db.get(service.goalId) : null;
    const document = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_kind_status", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("kind", "business_profile").eq("status", "ready"),
      )
      .order("desc")
      .first();
    const profile = document?.text?.trim() ? document : null;
    const revision = profile
      ? await ctx.db
          .query("foundationRevisions")
          .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
          .order("desc")
          .first()
      : null;
    let confirmedAt: number | null = null;
    // Kind/source labels and copying agent text alone are never confirmation evidence.
    if (
      profile &&
      revision?.docIds.includes(profile._id) &&
      revision.documents.length <= 20 &&
      revision.answers.length <= 100
    ) {
      const snapshot = revision.documents.find((d) => d.kind === "business_profile");
      const refs = [
        ...new Set(revision.answers.flatMap((a) => (a.sourceDocId ? [a.sourceDocId] : []))),
      ];
      let sourcesPresent = refs.length <= 20;
      for (const ref of refs.slice(0, 20)) {
        const id = ctx.db.normalizeId("vaultDocuments", ref);
        const source = id ? await ctx.db.get(id) : null;
        if (!source || source.tenantId !== ctx.tenantId || source.status !== "ready")
          sourcesPresent = false;
      }
      if (snapshot && sourcesPresent && (await contentHash(snapshot.text)) === profile.contentHash)
        confirmedAt = revision.createdAt;
    }
    const freshness = serviceSourceFreshness({
      fetchedAt: confirmedAt ?? Number.NaN,
      sourceUpdatedAt: null,
      now: Date.now(),
      maxAgeMs: 30 * ZERNIO_DAY_MS,
    }).retrieval;
    const latest = await ctx.db
      .query("managedServiceRuns")
      .withIndex("by_service_createdAt", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("serviceId", service._id),
      )
      .order("desc")
      .first();
    const latestOutcome = latest ? await readRunOutcome(ctx, { runId: latest._id }) : null;
    const nextActions: string[] = [];
    if (!goal || goal.tenantId !== ctx.tenantId) nextActions.push("link_goal");
    if (!profile) nextActions.push("provide_business_profile");
    else if (freshness === "unknown") nextActions.push("verify_business_profile");
    else if (freshness === "stale") nextActions.push("refresh_business_profile");
    if (latest?.state === "unknown") nextActions.push("reconcile_uncertain_run");
    else if (latest?.state === "claimed" || latest?.state === "running")
      nextActions.push("wait_for_service_result");
    else if (latestOutcome?.usefulness === "rejected") nextActions.push("revise_service_setup");
    else if (latestOutcome?.usefulness === "unreviewed") nextActions.push("review_service_result");
    else if (!latestOutcome) nextActions.push("review_service_readiness");
    if (latestOutcome?.reporting.state === "stale") nextActions.push("refresh_report");
    for (const item of latestOutcome?.social ?? []) nextActions.push(item.nextAction);
    return {
      serviceId: service._id,
      goal: goal?.tenantId === ctx.tenantId ? { goalId: goal._id, status: goal.status } : null,
      profile: profile
        ? {
            sourceRef: profile._id,
            sourceHash: profile.contentHash,
            sourceCreatedAt: profile.createdAt,
            sourceObservedAt: null,
            confirmedAt,
            confirmationRef: confirmedAt === null ? null : (revision?._id ?? null),
            authority:
              confirmedAt === null
                ? ("source_only" as const)
                : ("user_published_snapshot" as const),
            freshness,
          }
        : null,
      latestOutcome,
      businessKnowledge: await readBusinessLedgerForTenant(ctx, ctx.tenantId),
      nextActions: [...new Set(nextActions)].slice(0, 10),
      businessImprovement: "not_established" as const,
    };
  },
});
