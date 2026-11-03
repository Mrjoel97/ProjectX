import {
  CUSTOMER_SPECIALIST_LIMIT,
  validateCustomerSpecialist,
} from "@pikar/core/customerSpecialists";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAudit } from "./audit";
import {
  customerWorkflowPilotEnabled,
  requireCustomerWorkflowPilot,
} from "./lib/customerWorkflowPilot";
import { tenantMutation, tenantQuery } from "./lib/functions";

const definition = {
  name: v.string(),
  objective: v.string(),
  audience: v.string(),
  instructions: v.string(),
  knowledgeDocumentIds: v.array(v.id("vaultDocuments")),
};
type Definition = Pick<
  Doc<"customerSpecialists">,
  "name" | "objective" | "audience" | "instructions" | "knowledgeDocumentIds"
>;

function normalizeDefinition(input: Definition): Definition {
  return {
    ...validateCustomerSpecialist(input),
    knowledgeDocumentIds: [...new Set(input.knowledgeDocumentIds)],
  };
}

async function activeBrandDocument(ctx: QueryCtx, tenantId: string) {
  const kit = await ctx.db
    .query("brandKits")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  return kit?.active?.docId;
}

export async function validateSpecialistKnowledge(
  ctx: QueryCtx,
  tenantId: string,
  documentIds: Id<"vaultDocuments">[],
) {
  if (documentIds.length === 0) return;
  const brandDocumentId = await activeBrandDocument(ctx, tenantId);
  for (const id of documentIds) {
    const doc = await ctx.db.get(id);
    if (
      !doc ||
      doc.tenantId !== tenantId ||
      doc.status !== "ready" ||
      !doc.text?.trim() ||
      (doc.kind === "brand_kit" && doc._id !== brandDocumentId)
    ) {
      throw new Error("SPECIALIST_KNOWLEDGE_UNAVAILABLE");
    }
  }
}

export async function getCustomerSpecialistVersion(
  ctx: QueryCtx,
  tenantId: string,
  specialistId: Id<"customerSpecialists">,
  revision: number,
  options: { requireCurrent?: boolean } = {},
) {
  requireCustomerWorkflowPilot({ tenantId });
  const specialist = await ctx.db.get(specialistId);
  if (!specialist || specialist.tenantId !== tenantId || specialist.archived) {
    throw new Error("SPECIALIST_UNAVAILABLE");
  }
  if (options.requireCurrent && specialist.revision !== revision) {
    throw new Error("STALE_SPECIALIST");
  }
  const snapshot = await ctx.db
    .query("customerSpecialistVersions")
    .withIndex("by_specialist_revision", (q) =>
      q.eq("specialistId", specialistId).eq("revision", revision),
    )
    .unique();
  if (!snapshot || snapshot.tenantId !== tenantId) throw new Error("SPECIALIST_UNAVAILABLE");
  await validateSpecialistKnowledge(ctx, tenantId, snapshot.knowledgeDocumentIds);
  return snapshot;
}

export const list = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const enabled = customerWorkflowPilotEnabled(ctx.tenantId);
    const specialists = enabled
      ? await ctx.db
          .query("customerSpecialists")
          .withIndex("by_tenant_archived", (q) =>
            q.eq("tenantId", ctx.tenantId).eq("archived", false),
          )
          .order("desc")
          .take(CUSTOMER_SPECIALIST_LIMIT)
      : [];
    return { enabled, specialists };
  },
});

export const knowledgeChoices = tenantQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    requireCustomerWorkflowPilot(ctx);
    const result = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "ready"))
      .order("desc")
      .paginate({ ...paginationOpts, numItems: Math.min(12, paginationOpts.numItems) });
    const brandDocumentId = await activeBrandDocument(ctx, ctx.tenantId);
    return {
      ...result,
      page: result.page
        .filter(
          (doc) => doc.text?.trim() && (doc.kind !== "brand_kit" || doc._id === brandDocumentId),
        )
        .map((doc) => ({ _id: doc._id, title: doc.title })),
    };
  },
});

async function recordRevision(
  ctx: MutationCtx,
  tenantId: string,
  specialistId: Id<"customerSpecialists">,
  revision: number,
  fields: Definition,
) {
  await ctx.db.insert("customerSpecialistVersions", {
    tenantId,
    specialistId,
    revision,
    ...fields,
    createdAt: Date.now(),
  });
  await appendAudit(ctx, {
    tenantId,
    correlationId: `customer-specialist:${specialistId}:${revision}`,
    eventType: "customer_specialist.saved",
    actor: "user",
    payload: {
      specialistRef: specialistId,
      revision,
      sourceCount: fields.knowledgeDocumentIds.length,
    },
  });
}

export const create = tenantMutation({
  args: definition,
  handler: async (ctx, args) => {
    requireCustomerWorkflowPilot(ctx);
    const fields = normalizeDefinition(args);
    const existing = await ctx.db
      .query("customerSpecialists")
      .withIndex("by_tenant_archived", (q) => q.eq("tenantId", ctx.tenantId).eq("archived", false))
      .take(CUSTOMER_SPECIALIST_LIMIT);
    const matching = existing.find(
      (row) => JSON.stringify(normalizeDefinition(row)) === JSON.stringify(fields),
    );
    if (matching) return { specialistId: matching._id, revision: matching.revision };
    if (existing.length >= CUSTOMER_SPECIALIST_LIMIT) throw new Error("SPECIALIST_LIMIT_REACHED");
    await validateSpecialistKnowledge(ctx, ctx.tenantId, fields.knowledgeDocumentIds);
    const now = Date.now();
    const specialistId = await ctx.db.insert("customerSpecialists", {
      tenantId: ctx.tenantId,
      ...fields,
      revision: 1,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    await recordRevision(ctx, ctx.tenantId, specialistId, 1, fields);
    return { specialistId, revision: 1 };
  },
});

export const update = tenantMutation({
  args: { specialistId: v.id("customerSpecialists"), expectedRevision: v.number(), ...definition },
  handler: async (ctx, args) => {
    requireCustomerWorkflowPilot(ctx);
    const previous = await ctx.db.get(args.specialistId);
    if (!previous || previous.tenantId !== ctx.tenantId || previous.archived) {
      throw new Error("SPECIALIST_UNAVAILABLE");
    }
    if (previous.revision !== args.expectedRevision) throw new Error("STALE_SPECIALIST");
    const fields = normalizeDefinition(args);
    await validateSpecialistKnowledge(ctx, ctx.tenantId, fields.knowledgeDocumentIds);
    const revision = previous.revision + 1;
    await ctx.db.patch(previous._id, { ...fields, revision, updatedAt: Date.now() });
    await recordRevision(ctx, ctx.tenantId, previous._id, revision, fields);
    return { specialistId: previous._id, revision };
  },
});

export const archive = tenantMutation({
  args: { specialistId: v.id("customerSpecialists"), expectedRevision: v.number() },
  handler: async (ctx, { specialistId, expectedRevision }) => {
    requireCustomerWorkflowPilot(ctx);
    const previous = await ctx.db.get(specialistId);
    if (!previous || previous.tenantId !== ctx.tenantId || previous.archived) {
      throw new Error("SPECIALIST_UNAVAILABLE");
    }
    if (previous.revision !== expectedRevision) throw new Error("STALE_SPECIALIST");
    await ctx.db.patch(specialistId, { archived: true, updatedAt: Date.now() });
    await appendAudit(ctx, {
      tenantId: ctx.tenantId,
      correlationId: `customer-specialist:${specialistId}:${expectedRevision}`,
      eventType: "customer_specialist.archived",
      actor: "user",
      payload: { specialistRef: specialistId, revision: expectedRevision },
    });
    return null;
  },
});
