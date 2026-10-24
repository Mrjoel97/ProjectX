// Tenant-owned setup and built-in attended readiness. No runtime import, scheduler or provider call.
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
  managedServiceToolNames,
  type ServiceAccountPin,
  type ServiceSkillPin,
  validateManagedServiceConfig,
} from "@pikar/core/managedServices";
import { grantsFor, NO_GRANTS } from "@pikar/core/toolGrants";
import { EVAL_MAX_BUDGET_CENTS } from "@pikar/cost/evalBudget";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { appendAudit } from "./audit";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { reconcileStandingServiceAccounting } from "./lib/managedServiceBudget";
import { serviceKnowledgeFor } from "./serviceConversations";

const LIMIT = 50;
// ADR-066: existing built-in attended social operations only. This supplies no publishing,
// authored-skill, pack, business-review, vertical or recurrence admission.
const ATTENDED_SOCIAL_OPERATIONS = ["social.prepare", "social.report"] as const;
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

/** Same registry authority as skills.loadSkill, with tenant overrides explicitly excluded.
 * Bootstrap/rollback ACTIVE rows remain runnable; this reader neither activates nor certifies. */
async function activeBuiltinCockpitFor(ctx: QueryCtx, tenantId: string) {
  const active = await ctx.db
    .query("skills")
    .withIndex("by_name_status", (q) => q.eq("name", "cockpit-agent").eq("status", "active"))
    .take(2);
  const overlay = await ctx.db
    .query("tenantSkills")
    .withIndex("by_tenant_name_status", (q) =>
      q.eq("tenantId", tenantId).eq("name", "cockpit-agent").eq("status", "active"),
    )
    .first();
  return active.length === 1 && !overlay ? (active[0] ?? null) : null;
}

/** Built solely from indexed tenant reads; client flags cannot open admission. */
export async function managedServiceReadiness(ctx: QueryCtx, row: Doc<"managedServices">) {
  const config = managedServiceConfig(row);
  const socialOperations = config.operationIds.every((operation) =>
    ATTENDED_SOCIAL_OPERATIONS.some((admitted) => admitted === operation),
  );
  const globalCockpitOnly =
    config.skills.length === 1 &&
    config.skills[0]?.name === "cockpit-agent" &&
    config.skills[0]?.tenantId === null;
  const builtInScope =
    row.serviceId === "social-marketing" && socialOperations && globalCockpitOnly;
  const builtinCockpit = builtInScope ? await activeBuiltinCockpitFor(ctx, row.tenantId) : null;
  const accounts = [];
  for (const pin of config.accounts) {
    const current = await connectionFor(ctx, row.tenantId, pin);
    const selected =
      current &&
      ("selectedChannelIds" in current ? current.selectedChannelIds : current.selectedAccountIds);
    const channel = current?.channels.find((c) => c.id === pin.accountId);
    accounts.push({
      ...pin,
      connectionRevision: current
        ? "grantRevision" in current
          ? (current.grantRevision ?? current.revision)
          : current.revision
        : 0,
      connected:
        current?.status === "connected" &&
        Boolean(current.ciphertextB64 && current.ivB64) &&
        selected?.includes(pin.accountId) === true &&
        channel?.available === true,
    });
  }
  const skills = [];
  for (const pin of config.skills) {
    const current = await skillFor(ctx, row.tenantId, pin);
    const overlay = builtInScope
      ? []
      : await ctx.db
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
      } else if (builtInScope) {
        qualified = builtinCockpit?._id === current._id;
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
  // Admission is a code-owned capability boundary. Exact native account/skill evidence below
  // remains mandatory; neither a browser flag nor an unrelated qualification can supply it.
  const readiness = deriveManagedServiceReadiness(config, {
    tenantId: row.tenantId,
    permissionRevision: row.controlRevision,
    admittedOperationIds: builtInScope ? ATTENDED_SOCIAL_OPERATIONS : [],
    toolGrants: builtInScope ? grantsFor({}) : NO_GRANTS,
    availableToolNames: builtInScope ? managedServiceToolNames(ATTENDED_SOCIAL_OPERATIONS) : [],
    accounts,
    skills,
  });
  const businessKnowledge = await serviceKnowledgeFor(ctx, row);
  const reasons = [
    ...readiness.reasons,
    ...(!socialOperations ? ["unsupported_service_operation" as const] : []),
    ...(row.serviceId !== "social-marketing" ? ["unsupported_service_identity" as const] : []),
    ...(!globalCockpitOnly ? ["unsupported_skill_scope" as const] : []),
    ...(config.budgetLimitCents < 1 || config.budgetLimitCents > EVAL_MAX_BUDGET_CENTS
      ? ["budget_limit_unavailable" as const]
      : []),
    ...(missingSources.length ? ["source_unavailable" as const] : []),
    ...(!businessKnowledge.assessment.ready ? ["business_information_required" as const] : []),
    ...(row.controlState !== "active" ? ["service_paused_or_stopped" as const] : []),
  ];
  const ready = reasons.length === 0;
  return {
    ready,
    reasons,
    accounts,
    skills,
    sources: { businessProfileReady },
    businessKnowledge: {
      ready: businessKnowledge.assessment.ready,
      gaps: businessKnowledge.assessment.gaps,
      nextQuestion: businessKnowledge.assessment.nextQuestion,
    },
    missingSources,
    qualification: ready ? ("builtin_attended_social" as const) : ("unavailable" as const),
  };
}

const serviceFor = (ctx: QueryCtx, tenantId: string, serviceId: string) =>
  ctx.db
    .query("managedServices")
    .withIndex("by_tenant_service", (q) => q.eq("tenantId", tenantId).eq("serviceId", serviceId))
    .unique();
const view = (row: Doc<"managedServices">) => ({
  id: row._id,
  goalId: row.goalId ?? null,
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
    if (existing) {
      await ctx.db.patch(existing._id, changes);
      await ctx.runMutation(internal.managedServiceRecurrence.suspendForService, {
        tenantId: ctx.tenantId,
        serviceId: existing._id,
        reason: "approval_stale",
      });
    }
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

/** Safe owned options, resolved by the server so users never type native IDs or hashes. */
export const setupOptions = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const accounts: (ServiceAccountPin & { label: string; available: boolean })[] = [];
    let truncated = false;
    for (const provider of ["buffer", "zernio"] as const) {
      const rows =
        provider === "buffer"
          ? await ctx.db
              .query("bufferConnections")
              .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
              .take(2)
          : await ctx.db
              .query("zernioConnections")
              .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
              .take(2);
      const row = rows.length === 1 ? rows[0] : undefined;
      if (!row) continue;
      const selected =
        "selectedChannelIds" in row ? row.selectedChannelIds : row.selectedAccountIds;
      const channels = row.channels.filter((channel) => selected.includes(channel.id));
      truncated ||= channels.length > 50;
      for (const channel of channels.slice(0, 50))
        accounts.push({
          provider,
          connectionId: row.connectionId,
          accountId: channel.id,
          connectionRevision:
            "grantRevision" in row ? (row.grantRevision ?? row.revision) : row.revision,
          label: channel.name,
          available:
            row.status === "connected" &&
            Boolean(row.ciphertextB64 && row.ivB64) &&
            channel.available,
        });
    }
    const skills: ServiceSkillPin[] = [];
    const cockpit = await activeBuiltinCockpitFor(ctx, ctx.tenantId);
    if (cockpit)
      skills.push({
        skillId: cockpit._id,
        name: cockpit.name,
        version: cockpit.version,
        bodyHash: await contentHash(cockpit.body),
        tenantId: null,
      });
    return { accounts, skills, budgetLimitCents: 100, truncated };
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
    action: v.union(v.literal("pause"), v.literal("stop"), v.literal("resume")),
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
      (args.action === "resume" && row.controlState === "active") ||
      (args.action !== "resume" && row.controlState === "stopped") ||
      (row.controlState === "paused" && args.action === "pause")
    )
      throw new Error("SERVICE_INVALID_CONTROL");
    const controlState =
      args.action === "resume"
        ? ("active" as const)
        : args.action === "pause"
          ? ("paused" as const)
          : ("stopped" as const);
    const controlRevision = row.controlRevision + 1;
    await ctx.db.patch(row._id, { controlState, controlRevision, updatedAt: Date.now() });
    if (args.action !== "resume") {
      await ctx.runMutation(internal.managedServiceRecurrence.suspendForService, {
        tenantId: ctx.tenantId,
        serviceId: row._id,
        reason: "paused",
      });
      const unbound = await ctx.db
        .query("managedServiceRuns")
        .withIndex("by_service_state", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("serviceId", row._id).eq("state", "claimed"),
        )
        .take(2);
      if (
        unbound.length === 1 &&
        unbound[0] &&
        !unbound[0].workflowId &&
        !unbound[0].threadId &&
        !unbound[0].planId
      ) {
        await ctx.db.patch(unbound[0]._id, {
          state: "stopped",
          terminalCode: "control_changed",
          updatedAt: Date.now(),
        });
        await reconcileStandingServiceAccounting(ctx, ctx.tenantId, unbound[0]._id, true);
      }
    }
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
