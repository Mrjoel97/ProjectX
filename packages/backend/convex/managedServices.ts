// Tenant-owned setup only. No runtime import, scheduler, provider call or execution permission.
import {
  hasPassingAgentTenantEvidence,
  hasPassingEvidence,
  hasPassingTenantEvidence,
  isGatedSkill,
} from "@pikar/contracts/skill";
import { isWorkflowPackSkill } from "@pikar/core";
import {
  deriveManagedServiceReadiness,
  type ManagedServiceConfig,
  type ServiceAccountPin,
  type ServiceSkillPin,
  validateManagedServiceConfig,
} from "@pikar/core/managedServices";
import { NO_GRANTS } from "@pikar/core/toolGrants";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { appendAudit } from "./audit";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";

const LIMIT = 50;
const account = v.object({
  provider: v.union(v.literal("buffer"), v.literal("zernio")),
  connectionId: v.string(),
  accountId: v.string(),
  connectionRevision: v.number(),
});
const skill = v.object({
  skillId: v.string(),
  name: v.string(),
  version: v.number(),
  bodyHash: v.string(),
  tenantId: v.union(v.string(), v.null()),
});
const operation = v.union(
  v.literal("social.prepare"),
  v.literal("social.report"),
  v.literal("business.review"),
  v.literal("workflow.pack.run"),
);

export function managedServiceConfig(row: Doc<"managedServices">): ManagedServiceConfig {
  return {
    tenantId: row.tenantId,
    serviceId: row.serviceId,
    revision: row.revision,
    goal: row.goal,
    operationIds: row.operationIds,
    accounts: row.accounts,
    skills: row.skills,
    budgetLimitCents: row.budgetLimitCents,
  };
}

async function connectionFor(ctx: QueryCtx, tenantId: string, pin: ServiceAccountPin) {
  const rows =
    pin.provider === "buffer"
      ? await ctx.db
          .query("bufferConnections")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
          .take(2)
      : await ctx.db
          .query("zernioConnections")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
          .take(2);
  if (rows.length !== 1 || rows[0]?.connectionId !== pin.connectionId) return null;
  return rows[0];
}

async function skillFor(ctx: QueryCtx, tenantId: string, pin: ServiceSkillPin) {
  if (pin.tenantId !== null && pin.tenantId !== tenantId) return null;
  if (pin.tenantId === null) {
    const id = ctx.db.normalizeId("skills", pin.skillId);
    return id === null ? null : ctx.db.get(id);
  }
  const id = ctx.db.normalizeId("tenantSkills", pin.skillId);
  const row = id === null ? null : await ctx.db.get(id);
  return row?.tenantId === tenantId ? row : null;
}

/** Built solely from indexed tenant reads; client flags cannot open admission. */
export async function managedServiceReadiness(ctx: QueryCtx, row: Doc<"managedServices">) {
  const config = managedServiceConfig(row);
  const accounts = [];
  for (const pin of config.accounts) {
    const current = await connectionFor(ctx, row.tenantId, pin);
    const selected =
      current &&
      ("selectedChannelIds" in current ? current.selectedChannelIds : current.selectedAccountIds);
    const channel = current?.channels.find((c) => c.id === pin.accountId);
    accounts.push({
      ...pin,
      connectionRevision: current?.revision ?? 0,
      connected:
        current?.status === "connected" &&
        Boolean(current.ciphertextB64 && current.ivB64) &&
        selected?.includes(pin.accountId) === true &&
        channel?.available === true &&
        (!("expiresAt" in current) || current.expiresAt > Date.now()),
    });
  }
  const skills = [];
  for (const pin of config.skills) {
    const current = await skillFor(ctx, row.tenantId, pin);
    const overlay = await ctx.db
      .query("tenantSkills")
      .withIndex("by_tenant_name_status", (q) =>
        q.eq("tenantId", row.tenantId).eq("name", pin.name).eq("status", "active"),
      )
      .take(2);
    let qualified = false;
    if (current && current.status === "active" && !isWorkflowPackSkill(current.name)) {
      if ("tenantId" in current) {
        const target = {
          candidateId: String(current._id),
          registryTenantId: current.tenantId,
          name: current.name,
          version: current.version,
        };
        qualified =
          overlay.length === 1 &&
          overlay[0]?._id === current._id &&
          (current.author === "system" ||
            (current.author === "agent"
              ? current.ownerApproval !== undefined &&
                hasPassingAgentTenantEvidence(current.evidence, target)
              : hasPassingTenantEvidence(current.evidence, target)));
      } else {
        const active = await ctx.db
          .query("skills")
          .withIndex("by_name_status", (q) => q.eq("name", pin.name).eq("status", "active"))
          .take(2);
        qualified =
          overlay.length === 0 &&
          active.length === 1 &&
          active[0]?._id === current._id &&
          (!isGatedSkill(current.name) ||
            hasPassingEvidence(current.evidence, current.name, current.version));
      }
    }
    skills.push({
      ...pin,
      name: current?.name ?? pin.name,
      version: current?.version ?? 0,
      bodyHash: current ? await contentHash(current.body) : "",
      qualified,
    });
  }
  // Same source kind as onboarding/proactive review, never the separate business blueprint.
  const document = await ctx.db
    .query("vaultDocuments")
    .withIndex("by_tenant_kind_status", (q) =>
      q.eq("tenantId", row.tenantId).eq("kind", "business_profile").eq("status", "ready"),
    )
    .order("desc")
    .first();
  const businessProfileReady = Boolean(document?.text?.trim());
  const missingSources =
    config.operationIds.includes("business.review") && !businessProfileReady
      ? ["business_profile" as const]
      : [];
  // There is no Phase48 seal in this implementation. Deliberately NO environment/client override.
  const readiness = deriveManagedServiceReadiness(config, {
    tenantId: row.tenantId,
    permissionRevision: row.controlRevision,
    admittedOperationIds: [],
    toolGrants: NO_GRANTS,
    availableToolNames: [],
    accounts,
    skills,
  });
  return {
    ready: false as const,
    reasons: [
      ...readiness.reasons,
      ...(missingSources.length ? ["source_unavailable" as const] : []),
      ...(row.controlState !== "active" ? ["service_paused_or_stopped" as const] : []),
    ],
    accounts,
    skills,
    sources: { businessProfileReady },
    missingSources,
    qualification: "unavailable" as const,
  };
}

const serviceFor = (ctx: QueryCtx, tenantId: string, serviceId: string) =>
  ctx.db
    .query("managedServices")
    .withIndex("by_tenant_service", (q) => q.eq("tenantId", tenantId).eq("serviceId", serviceId))
    .unique();
const view = (row: Doc<"managedServices">) => ({
  id: row._id,
  ...managedServiceConfig(row),
  controlState: row.controlState,
  controlRevision: row.controlRevision,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const setup = tenantMutation({
  args: {
    serviceId: v.string(),
    expectedRevision: v.number(),
    goal: v.string(),
    operationIds: v.array(operation),
    accounts: v.array(account),
    skills: v.array(skill),
    budgetLimitCents: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < 0 ||
      args.expectedRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new Error("SERVICE_STALE_REVISION");
    const { expectedRevision: _expectedRevision, ...values } = args;
    const config: ManagedServiceConfig = {
      ...values,
      tenantId: ctx.tenantId,
      revision: args.expectedRevision + 1,
    };
    validateManagedServiceConfig(config);
    const existing = await serviceFor(ctx, ctx.tenantId, args.serviceId);
    if ((existing?.revision ?? 0) !== args.expectedRevision)
      throw new Error("SERVICE_STALE_REVISION");
    if (existing && existing.controlRevision >= Number.MAX_SAFE_INTEGER)
      throw new Error("SERVICE_STALE_REVISION");
    if (
      !existing &&
      (
        await ctx.db
          .query("managedServices")
          .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
          .take(LIMIT)
      ).length >= LIMIT
    )
      throw new Error("SERVICE_LIMIT_REACHED");
    for (const pin of config.accounts) {
      const current = await connectionFor(ctx, ctx.tenantId, pin);
      if (!current?.channels.some((c) => c.id === pin.accountId))
        throw new Error("SERVICE_REFERENCE_NOT_OWNED");
    }
    for (const pin of config.skills)
      if (!(await skillFor(ctx, ctx.tenantId, pin))) throw new Error("SERVICE_REFERENCE_NOT_OWNED");
    const now = Date.now();
    const changes = {
      ...values,
      tenantId: ctx.tenantId,
      revision: config.revision,
      controlRevision: (existing?.controlRevision ?? 0) + 1,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, changes);
    const id = existing
      ? existing._id
      : await ctx.db.insert("managedServices", {
          ...changes,
          controlState: "active",
          createdAt: now,
        });
    return { id, revision: config.revision, controlRevision: changes.controlRevision };
  },
});

export const list = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("managedServices")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .take(LIMIT + 1);
    return { items: rows.slice(0, LIMIT).map(view), truncated: rows.length > LIMIT };
  },
});

export const status = tenantQuery({
  args: { serviceId: v.string() },
  handler: async (ctx, { serviceId }) => {
    const row = await serviceFor(ctx, ctx.tenantId, serviceId);
    return row ? { ...view(row), readiness: await managedServiceReadiness(ctx, row) } : null;
  },
});

export const readiness = tenantQuery({
  args: { serviceId: v.string(), expectedRevision: v.number() },
  handler: async (ctx, { serviceId, expectedRevision }) => {
    const row = await serviceFor(ctx, ctx.tenantId, serviceId);
    if (!row || row.revision !== expectedRevision) throw new Error("SERVICE_STALE_REVISION");
    return managedServiceReadiness(ctx, row);
  },
});

/** Fences local configuration only; no worker/provider cancellation is implied. */
export const setControl = tenantMutation({
  args: {
    serviceId: v.string(),
    expectedRevision: v.number(),
    expectedControlRevision: v.number(),
    action: v.union(v.literal("pause"), v.literal("stop")),
  },
  handler: async (ctx, args) => {
    const row = await serviceFor(ctx, ctx.tenantId, args.serviceId);
    if (
      !row ||
      row.revision !== args.expectedRevision ||
      row.controlRevision !== args.expectedControlRevision ||
      row.controlRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new Error("SERVICE_STALE_REVISION");
    if (
      row.controlState === "stopped" ||
      (row.controlState === "paused" && args.action === "pause")
    )
      throw new Error("SERVICE_INVALID_CONTROL");
    const controlState = args.action === "pause" ? ("paused" as const) : ("stopped" as const);
    const controlRevision = row.controlRevision + 1;
    await ctx.db.patch(row._id, { controlState, controlRevision, updatedAt: Date.now() });
    await appendAudit(ctx, {
      tenantId: ctx.tenantId,
      correlationId: `managed-service:${row._id}:${controlRevision}`,
      eventType: "managed_service.control_changed",
      actor: "user",
      payload: { serviceRef: row._id, revision: row.revision, controlRevision, controlState },
    });
    return {
      revision: row.revision,
      controlRevision,
      controlState,
      providerCancellationRequested: false as const,
    };
  },
});
