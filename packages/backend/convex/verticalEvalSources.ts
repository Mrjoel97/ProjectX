// Controlled, unpaid source provisioning for the native vertical evaluator. Internal CLI only.
import { requireVerticalCorpusCase } from "@pikar/contracts/verticalEval";
import { VERTICAL_IDS, type VerticalId } from "@pikar/core/verticalPacks";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { contentHash } from "./lib/hash";
import { sealedIn } from "./vaultFolders";

export const pinArgs = {
  runId: v.string(),
  caseId: v.string(),
  caseHash: v.string(),
  requestHash: v.string(),
  verticalId: v.union(...VERTICAL_IDS.map((id) => v.literal(id))),
  candidateVersion: v.number(),
  bodyHash: v.string(),
};
export type Pin = {
  runId: string;
  caseId: string;
  caseHash: string;
  requestHash: string;
  verticalId: VerticalId;
  candidateVersion: number;
  bodyHash: string;
};
const mime = v.union(
  v.literal("text/plain"),
  v.literal("text/csv"),
  v.literal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  v.literal("image/png"),
  v.literal("image/jpeg"),
);
const validFormat = (id: VerticalId, type: string) =>
  id === "data"
    ? ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(
        type,
      )
    : id === "design"
      ? ["text/plain", "image/png", "image/jpeg"].includes(type)
      : type === "text/plain";
function identity(pin: Pin) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pin.runId) ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(pin.caseId) ||
    !/^[a-f0-9]{64}$/.test(pin.caseHash) ||
    !/^[a-f0-9]{64}$/.test(pin.requestHash) ||
    !/^[a-f0-9]{64}$/.test(pin.bodyHash) ||
    !Number.isSafeInteger(pin.candidateVersion) ||
    pin.candidateVersion < 1
  )
    throw new Error("VERTICAL_EVAL_INVALID_PIN");
  return {
    tenantId: `packeval-${pin.runId.slice(0, 8)}-${pin.caseId}`,
    threadId: `verticaleval:${pin.runId}:${pin.caseId}`,
  };
}
async function checkFresh(ctx: QueryCtx, pin: Pin) {
  const ids = identity(pin);
  requireVerticalCorpusCase(pin);
  const candidate = await ctx.db
    .query("skills")
    .withIndex("by_name_version", (q) =>
      q.eq("name", `vertical-${pin.verticalId}`).eq("version", pin.candidateVersion),
    )
    .unique();
  if (
    !candidate ||
    candidate.status !== "candidate" ||
    (await contentHash(candidate.body)) !== pin.bodyHash
  )
    throw new Error("VERTICAL_EVAL_CANDIDATE_MISMATCH");
  const [profile, document, plan, previous] = await Promise.all([
    ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ids.tenantId))
      .first(),
    ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ids.tenantId))
      .first(),
    ctx.db
      .query("plans")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ids.tenantId))
      .first(),
    ctx.db
      .query("audit")
      .withIndex("by_tenant_event_ts", (q) =>
        q.eq("tenantId", ids.tenantId).eq("eventType", "vertical_eval.provisioned"),
      )
      .first(),
  ]);
  if (profile || document || plan || previous) throw new Error("VERTICAL_EVAL_TENANT_NOT_FRESH");
  return { ...ids, candidateId: candidate._id };
}
export const preflight = internalQuery({ args: pinArgs, handler: checkFresh });

export const receipt = internalQuery({
  args: pinArgs,
  handler: async (ctx, args) => {
    const ids = identity(args);
    const marker = await ctx.db
      .query("audit")
      .withIndex("by_tenant_event_ts", (q) =>
        q.eq("tenantId", ids.tenantId).eq("eventType", "vertical_eval.provisioned"),
      )
      .unique();
    if (
      !marker ||
      marker.correlationId !== ids.threadId ||
      marker.payload.runId !== args.runId ||
      marker.payload.caseId !== args.caseId ||
      marker.payload.caseHash !== args.caseHash ||
      marker.payload.requestHash !== args.requestHash ||
      marker.payload.bodyHash !== args.bodyHash ||
      marker.payload.candidateVersion !== args.candidateVersion ||
      marker.payload.verticalId !== args.verticalId
    )
      throw new Error("VERTICAL_EVAL_PROVISION_MISMATCH");
    return { ...ids, receiptId: marker._id };
  },
});

/** Validate immutable case authority once; native exact pages include output docs and storage.
 * Any export freeze or page-limit refusal is surfaced, never reported as completed cleanup. */
export const purgeCase = internalAction({
  args: pinArgs,
  handler: async (
    ctx,
    args,
  ): Promise<{ tenantId: string; deleted: number; blobs: number; done: true }> => {
    const { tenantId, receiptId } = await ctx.runQuery(internal.verticalEvalSources.receipt, args);
    await ctx.runMutation(internal.verticalEvalEvidence.claimCleanup, args);
    let deleted = 0;
    let blobs = 0;
    for (let page = 0; page < 50; page++) {
      const result = await ctx.runMutation(internal.tenantDelete.purgeEvalTenant, {
        tenantId,
        exact: true,
        limit: 200,
        preserveAuditId: receiptId,
        preserveSpendEvents: true,
      });
      deleted += result.deleted;
      blobs += result.blobs;
      if (result.done) return { tenantId, deleted, blobs, done: true };
    }
    throw new Error("VERTICAL_EVAL_CLEANUP_PAGE_LIMIT");
  },
});

/** Actual immutable provision record and current owned source state, never runner claims. */
export async function verifyCaseState(ctx: QueryCtx, args: Pin) {
  const ids = identity(args);
  const marker = await ctx.db
    .query("audit")
    .withIndex("by_tenant_event_ts", (q) =>
      q.eq("tenantId", ids.tenantId).eq("eventType", "vertical_eval.provisioned"),
    )
    .unique();
  const payload = marker?.payload;
  if (
    !marker ||
    marker.correlationId !== ids.threadId ||
    marker.tenantId !== ids.tenantId ||
    payload.runId !== args.runId ||
    payload.caseId !== args.caseId ||
    payload.verticalId !== args.verticalId ||
    payload.caseHash !== args.caseHash ||
    payload.requestHash !== args.requestHash ||
    payload.bodyHash !== args.bodyHash ||
    payload.candidateVersion !== args.candidateVersion
  )
    throw new Error("VERTICAL_EVAL_PROVISION_MISMATCH");
  const candidate = await ctx.db.get(payload.candidateId as Id<"skills">);
  const plan = await ctx.db.get(payload.planId as Id<"plans">);
  if (
    !candidate ||
    candidate.status !== "candidate" ||
    candidate.name !== `vertical-${args.verticalId}` ||
    candidate.version !== args.candidateVersion ||
    (await contentHash(candidate.body)) !== args.bodyHash ||
    !plan ||
    plan.tenantId !== ids.tenantId ||
    plan.threadId !== ids.threadId
  )
    throw new Error("VERTICAL_EVAL_CANDIDATE_MISMATCH");
  const sourceRefs = payload.sourceRefs as {
    ref: string;
    docId: Id<"vaultDocuments">;
    hash: string;
    storageId: Id<"_storage">;
    mimeType: string;
    size: number;
  }[];
  for (const source of sourceRefs) {
    const doc = await ctx.db.get(source.docId);
    const metadata = await ctx.db.system.get("_storage", source.storageId);
    const digest = btoa(
      String.fromCharCode(
        ...(source.hash.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16)),
      ),
    );
    if (
      !doc ||
      doc.tenantId !== ids.tenantId ||
      doc.status !== "ready" ||
      doc.contentHash !== source.hash ||
      doc.storageId !== source.storageId ||
      doc.mimeType !== source.mimeType ||
      doc.size !== source.size ||
      !metadata ||
      metadata.size !== source.size ||
      metadata.sha256 !== digest ||
      (metadata.contentType !== undefined && metadata.contentType !== source.mimeType) ||
      (doc.mimeType === "text/plain" && (await contentHash(doc.text ?? "")) !== source.hash) ||
      (await sealedIn(ctx, [doc])).size > 0
    )
      throw new Error("VERTICAL_EVAL_SOURCE_CHANGED");
  }
  return { ...ids, planId: plan._id, candidateId: candidate._id, sourceRefs };
}
export const verifyCase = internalQuery({ args: pinArgs, handler: verifyCaseState });

const sourceArgs = { ref: v.string(), mimeType: mime, bytes: v.bytes() };
/** Bytes are exact synthetic fixtures supplied by the operator runner, never fetched from a URL. */
export const provision = internalAction({
  args: {
    ...pinArgs,
    sources: v.array(v.object(sourceArgs)),
    reviewReady: v.boolean(),
    legalPlaybookRef: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    tenantId: string;
    candidateId: Id<"skills">;
    threadId: string;
    planId: Id<"plans">;
    sourceRefs: { ref: string; docId: Id<"vaultDocuments">; hash: string }[];
  }> => {
    const { sources, reviewReady, legalPlaybookRef, ...pin } = args;
    await ctx.runQuery(internal.verticalEvalSources.preflight, pin);
    if (sources.length > 5 || (pin.verticalId === "data" && sources.length > 1))
      throw new Error("VERTICAL_EVAL_SOURCE_LIMIT");
    let total = 0;
    const refs = new Set<string>();
    const prepared = [];
    for (const source of sources) {
      total += source.bytes.byteLength;
      if (
        !new RegExp(`^fixture:${pin.verticalId}:[a-z0-9-]{1,64}$`).test(source.ref) ||
        refs.has(source.ref)
      )
        throw new Error("VERTICAL_EVAL_SOURCE_REF");
      refs.add(source.ref);
      if (source.bytes.byteLength > 1024 * 1024 || total > 2 * 1024 * 1024)
        throw new Error("VERTICAL_EVAL_SOURCE_LIMIT");
      if (!validFormat(pin.verticalId, source.mimeType))
        throw new Error("VERTICAL_EVAL_SOURCE_FORMAT");
      const text =
        source.mimeType === "text/plain"
          ? new TextDecoder("utf-8", { fatal: true }).decode(source.bytes)
          : undefined;
      if (text !== undefined && (source.bytes.byteLength > 32 * 1024 || !text.trim()))
        throw new Error("VERTICAL_EVAL_SOURCE_LIMIT");
      prepared.push({
        ref: source.ref,
        mimeType: source.mimeType,
        bytes: source.bytes,
        text,
        hash: await contentHash(source.bytes),
      });
    }
    if (
      legalPlaybookRef !== undefined &&
      (pin.verticalId !== "legal" || !refs.has(legalPlaybookRef))
    )
      throw new Error("VERTICAL_EVAL_PLAYBOOK_REF");
    const stored: Id<"_storage">[] = [];
    try {
      const records = [];
      for (const source of prepared) {
        const storageId = await ctx.storage.store(
          new Blob([source.bytes], { type: source.mimeType }),
        );
        stored.push(storageId);
        records.push({
          ref: source.ref,
          mimeType: source.mimeType,
          storageId,
          hash: source.hash,
          size: source.bytes.byteLength,
          ...(source.text === undefined ? {} : { text: source.text }),
        });
      }
      return await ctx.runMutation(internal.verticalEvalSources.commit, {
        ...pin,
        sources: records,
        reviewReady,
        ...(legalPlaybookRef === undefined ? {} : { legalPlaybookRef }),
      });
    } catch (error) {
      for (const id of stored) await ctx.storage.delete(id);
      throw error;
    }
  },
});

export const commit = internalMutation({
  args: {
    ...pinArgs,
    reviewReady: v.boolean(),
    legalPlaybookRef: v.optional(v.string()),
    sources: v.array(
      v.object({
        ref: v.string(),
        mimeType: mime,
        storageId: v.id("_storage"),
        hash: v.string(),
        size: v.number(),
        text: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const ids = await checkFresh(ctx, args);
    if (args.sources.length > 5 || (args.verticalId === "data" && args.sources.length > 1))
      throw new Error("VERTICAL_EVAL_SOURCE_LIMIT");
    const refs = new Set<string>();
    let total = 0;
    for (const source of args.sources) {
      if (
        !new RegExp(`^fixture:${args.verticalId}:[a-z0-9-]{1,64}$`).test(source.ref) ||
        refs.has(source.ref)
      )
        throw new Error("VERTICAL_EVAL_SOURCE_REF");
      refs.add(source.ref);
      total += source.size;
      if (
        !Number.isSafeInteger(source.size) ||
        source.size < 0 ||
        source.size > 1024 * 1024 ||
        total > 2 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(source.hash)
      )
        throw new Error("VERTICAL_EVAL_SOURCE_LIMIT");
      if (!validFormat(args.verticalId, source.mimeType))
        throw new Error("VERTICAL_EVAL_SOURCE_FORMAT");
      const metadata = await ctx.db.system.get("_storage", source.storageId);
      const digest = btoa(
        String.fromCharCode(
          ...(source.hash.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16)),
        ),
      );
      if (
        !metadata ||
        metadata.size !== source.size ||
        metadata.sha256 !== digest ||
        (metadata.contentType !== undefined && metadata.contentType !== source.mimeType)
      )
        throw new Error("VERTICAL_EVAL_STORAGE_MISMATCH");
      if (
        source.mimeType === "text/plain" &&
        (source.size > 32 * 1024 ||
          !source.text?.trim() ||
          (await contentHash(source.text)) !== source.hash)
      )
        throw new Error("VERTICAL_EVAL_SOURCE_CHANGED");
      if (source.mimeType !== "text/plain" && source.text !== undefined)
        throw new Error("VERTICAL_EVAL_SOURCE_FORMAT");
    }
    if (
      args.legalPlaybookRef !== undefined &&
      (args.verticalId !== "legal" || !refs.has(args.legalPlaybookRef))
    )
      throw new Error("VERTICAL_EVAL_PLAYBOOK_REF");
    const sourceRefs = [];
    for (const source of args.sources) {
      const text = source.mimeType === "text/plain";
      const docId = await ctx.db.insert("vaultDocuments", {
        tenantId: ids.tenantId,
        title: source.ref,
        kind: text ? "brain_dump" : "upload",
        category: text ? "brain-dumps" : "my-uploads",
        source: text ? "paste" : "upload",
        mimeType: source.mimeType,
        storageId: source.storageId,
        size: source.size,
        contentHash: source.hash,
        ...(source.text === undefined ? {} : { text: source.text }),
        status: "ready",
        createdAt: Date.now(),
      });
      sourceRefs.push({
        ref: source.ref,
        docId,
        hash: source.hash,
        storageId: source.storageId,
        mimeType: source.mimeType,
        size: source.size,
      });
    }
    const profileId = await ctx.db.insert("tenantProfiles", {
      tenantId: ids.tenantId,
      tier: "startup",
      tierSource: "confirmed",
      derivedAt: Date.now(),
      verticalPreferences: {
        needs: [args.verticalId],
        reviewReady: args.reviewReady ? [args.verticalId] : [],
        ...(args.legalPlaybookRef === undefined
          ? {}
          : { legalPlaybookDocId: sourceRefs.find((s) => s.ref === args.legalPlaybookRef)?.docId }),
      },
    });
    const planId = await ctx.db.insert("plans", {
      tenantId: ids.tenantId,
      threadId: ids.threadId,
      status: "collecting",
      createdAt: Date.now(),
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ids.tenantId,
      correlationId: ids.threadId,
      eventType: "vertical_eval.provisioned",
      actor: "system",
      payload: {
        runId: args.runId,
        caseId: args.caseId,
        caseHash: args.caseHash,
        requestHash: args.requestHash,
        verticalId: args.verticalId,
        candidateId: ids.candidateId,
        candidateVersion: args.candidateVersion,
        bodyHash: args.bodyHash,
        planId,
        profileId,
        sourceRefs,
      },
    });
    return {
      tenantId: ids.tenantId,
      candidateId: ids.candidateId,
      threadId: ids.threadId,
      planId,
      sourceRefs,
    };
  },
});

/** Cleanup ONLY an unexecuted provision. Execution artifacts need the native retention/deletion plane. */
export const cleanup = internalMutation({
  args: pinArgs,
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.verticalEvalEvidence.claimCleanup, args);
    const ids = identity(args);
    const marker = await ctx.db
      .query("audit")
      .withIndex("by_tenant_event_ts", (q) =>
        q.eq("tenantId", ids.tenantId).eq("eventType", "vertical_eval.provisioned"),
      )
      .unique();
    if (
      !marker ||
      marker.correlationId !== ids.threadId ||
      marker.tenantId !== ids.tenantId ||
      marker.payload.caseHash !== args.caseHash ||
      marker.payload.requestHash !== args.requestHash ||
      marker.payload.bodyHash !== args.bodyHash ||
      marker.payload.candidateVersion !== args.candidateVersion
    )
      throw new Error("VERTICAL_EVAL_PROVISION_MISMATCH");
    const docs = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ids.tenantId))
      .take(6);
    const owned = new Set(
      marker.payload.sourceRefs.map((source: { docId: string }) => source.docId),
    );
    const steps = await ctx.db
      .query("agentSteps")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ids.tenantId))
      .first();
    if (steps || docs.some((doc) => !owned.has(doc._id)))
      throw new Error("VERTICAL_EVAL_EXECUTED_CLEANUP_REQUIRES_NATIVE_RETENTION");
    for (const doc of docs) {
      if (doc.storageId) await ctx.storage.delete(doc.storageId);
      await ctx.db.delete(doc._id);
    }
    const plan = await ctx.db.get(marker.payload.planId as Id<"plans">);
    const profile = await ctx.db.get(marker.payload.profileId as Id<"tenantProfiles">);
    if (plan?.tenantId === ids.tenantId) await ctx.db.delete(plan._id);
    if (profile?.tenantId === ids.tenantId) await ctx.db.delete(profile._id);
    return { removedSourceCount: docs.length, auditRetained: true };
  },
});
