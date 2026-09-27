import type {
  WebDocument,
  WebFormNode,
  WebFormResult,
  WebMetricKind,
  WebNode,
  WebPage,
} from "@pikar/contracts/webRuntime";
import {
  ABUSE_BUCKET_RETENTION_MS,
  IDEMPOTENCY_RETENTION_MS,
  parseInboundWebForm,
} from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { isAddressSuppressed, upsertContactRow } from "./contacts";
import { contentHash } from "./lib/hash";

const HOUR_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_BUCKET = 5;
const CLEANUP_BATCH_SIZE = 100;

function hostKey(value: string): string {
  return value.trim().toLowerCase();
}

function pageFor(document: WebDocument, pageSlug: string): WebPage | null {
  return document.pages.find((page) => page.slug === pageSlug) ?? null;
}

function formFor(page: WebPage, formId: string): WebFormNode | null {
  const walk = (nodes: readonly WebNode[]): WebFormNode | null => {
    for (const node of nodes) {
      if (node.kind === "form" && node.id === formId) return node;
      if (node.kind === "section") {
        const nested = walk(node.children);
        if (nested) return nested;
      }
    }
    return null;
  };
  return walk(page.nodes);
}

async function cleanupExpired(ctx: MutationCtx, tenantId: string, now: number): Promise<void> {
  const expired = await ctx.db
    .query("webSubmissions")
    .withIndex("by_tenant_expires_at", (q) => q.eq("tenantId", tenantId).lt("expiresAt", now))
    .take(100);
  for (const row of expired) await ctx.db.delete(row._id);
}

async function recordMetricRow(
  ctx: MutationCtx,
  projectId: Id<"webProjects">,
  tenantId: string,
  version: number,
  kind: WebMetricKind,
  now = Date.now(),
): Promise<void> {
  const windowStartedAt = Math.floor(now / HOUR_MS) * HOUR_MS;
  const existing = await ctx.db
    .query("webMetrics")
    .withIndex("by_tenant_project_kind_window", (q) =>
      q
        .eq("tenantId", tenantId)
        .eq("projectId", projectId)
        .eq("kind", kind)
        .eq("windowStartedAt", windowStartedAt),
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { count: existing.count + 1, updatedAt: now, version });
  } else {
    await ctx.db.insert("webMetrics", {
      tenantId,
      projectId,
      version,
      kind,
      count: 1,
      windowStartedAt,
      windowEndsAt: windowStartedAt + HOUR_MS,
      updatedAt: now,
    });
  }
}

export const recordMetric = internalMutation({
  args: {
    host: v.string(),
    slug: v.string(),
    page: v.string(),
    kind: v.union(
      v.literal("page_view"),
      v.literal("cta_click"),
      v.literal("form_accepted"),
      v.literal("form_rejected"),
    ),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const resolved = await ctx.runQuery(internal.webProjects.resolvePublished, {
      host: hostKey(args.host),
      slug: args.slug,
    });
    if (resolved.state !== "published") return { ok: false };
    if (!pageFor(resolved.version.document as WebDocument, args.page)) return { ok: false };
    await recordMetricRow(
      ctx,
      resolved.project._id,
      resolved.project.tenantId,
      resolved.version.version,
      args.kind,
    );
    return { ok: true };
  },
});

export const submit = internalMutation({
  args: {
    host: v.string(),
    slug: v.string(),
    page: v.string(),
    formId: v.string(),
    raw: v.any(),
    idempotencyKey: v.string(),
    abuseKey: v.string(),
  },
  handler: async (ctx, args): Promise<WebFormResult> => {
    const resolved = await ctx.runQuery(internal.webProjects.resolvePublished, {
      host: hostKey(args.host),
      slug: args.slug,
    });
    if (resolved.state !== "published") return { ok: false, outcome: "unavailable" };
    const document = resolved.version.document as WebDocument;
    const page = pageFor(document, args.page);
    const form = page ? formFor(page, args.formId) : null;
    if (!page || !form) return { ok: false, outcome: "invalid" };

    const now = Date.now();
    await cleanupExpired(ctx, resolved.project.tenantId, now);
    const idempotencyKeyHash = await contentHash(`web-idempotency:v1:${args.idempotencyKey}`);
    const prior = await ctx.db
      .query("webSubmissions")
      .withIndex("by_tenant_idempotency", (q) =>
        q
          .eq("tenantId", resolved.project.tenantId)
          .eq("projectId", resolved.project._id)
          .eq("formId", args.formId)
          .eq("idempotencyKeyHash", idempotencyKeyHash),
      )
      .first();
    if (prior && prior.expiresAt > now) return { ok: true, outcome: "duplicate" };
    if (prior) await ctx.db.delete(prior._id);

    const abuseBucketHash = await contentHash(`web-abuse:v1:${args.abuseKey}`);
    const activeAbuse = await ctx.db
      .query("webSubmissions")
      .withIndex("by_tenant_abuse_bucket", (q) =>
        q
          .eq("tenantId", resolved.project.tenantId)
          .eq("abuseBucketHash", abuseBucketHash)
          .gt("abuseWindowExpiresAt", now),
      )
      .take(MAX_REQUESTS_PER_BUCKET);
    if (activeAbuse.length >= MAX_REQUESTS_PER_BUCKET) {
      await recordMetricRow(
        ctx,
        resolved.project._id,
        resolved.project.tenantId,
        resolved.version.version,
        "form_rejected",
        now,
      );
      return { ok: false, outcome: "rate_limited" };
    }

    const parsed = parseInboundWebForm((args.raw ?? {}) as Record<string, unknown>, form);
    if (!parsed.ok) {
      await ctx.db.insert("webSubmissions", {
        tenantId: resolved.project.tenantId,
        projectId: resolved.project._id,
        version: resolved.version.version,
        formId: args.formId,
        idempotencyKeyHash,
        outcome: parsed.code === "consent_required" ? "consent_required" : "invalid",
        ...(form.attribution ? { attribution: form.attribution } : {}),
        abuseBucketHash,
        createdAt: now,
        expiresAt: now + IDEMPOTENCY_RETENTION_MS,
        abuseWindowExpiresAt: now + ABUSE_BUCKET_RETENTION_MS,
      });
      await recordMetricRow(
        ctx,
        resolved.project._id,
        resolved.project.tenantId,
        resolved.version.version,
        "form_rejected",
        now,
      );
      return {
        ok: false,
        outcome: parsed.code === "consent_required" ? "consent_required" : "invalid",
      };
    }

    if (await isAddressSuppressed(ctx, resolved.project.tenantId, parsed.value.email)) {
      await ctx.db.insert("webSubmissions", {
        tenantId: resolved.project.tenantId,
        projectId: resolved.project._id,
        version: resolved.version.version,
        formId: args.formId,
        idempotencyKeyHash,
        outcome: "suppressed",
        ...(form.attribution ? { attribution: form.attribution } : {}),
        abuseBucketHash,
        createdAt: now,
        expiresAt: now + IDEMPOTENCY_RETENTION_MS,
        abuseWindowExpiresAt: now + ABUSE_BUCKET_RETENTION_MS,
      });
      await recordMetricRow(
        ctx,
        resolved.project._id,
        resolved.project.tenantId,
        resolved.version.version,
        "form_rejected",
        now,
      );
      return { ok: false, outcome: "suppressed" };
    }

    const contact = await upsertContactRow(ctx, resolved.project.tenantId, parsed.value);
    await ctx.db.insert("webSubmissions", {
      tenantId: resolved.project.tenantId,
      projectId: resolved.project._id,
      version: resolved.version.version,
      formId: args.formId,
      idempotencyKeyHash,
      outcome: "accepted",
      outcomeRef: String(contact.id),
      ...(form.attribution ? { attribution: form.attribution } : {}),
      abuseBucketHash,
      createdAt: now,
      expiresAt: now + IDEMPOTENCY_RETENTION_MS,
      abuseWindowExpiresAt: now + ABUSE_BUCKET_RETENTION_MS,
    });
    await recordMetricRow(
      ctx,
      resolved.project._id,
      resolved.project.tenantId,
      resolved.version.version,
      "form_accepted",
      now,
    );
    return { ok: true, outcome: "accepted" };
  },
});

export const cleanup = internalMutation({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    await cleanupExpired(ctx, tenantId, Date.now());
    return null;
  },
});

/** Scheduled retention sweep. The global expiry index selects the oldest expired rows across
 * tenants, so one mutation has a fixed read/write ceiling and no tenant is starved by project
 * ordering. A backlog is visible in the result and drains over subsequent hourly ticks. */
export const cleanupAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const page = await ctx.db
      .query("webSubmissions")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .take(CLEANUP_BATCH_SIZE + 1);
    for (const row of page.slice(0, CLEANUP_BATCH_SIZE)) await ctx.db.delete(row._id);
    return {
      deleted: Math.min(page.length, CLEANUP_BATCH_SIZE),
      hasMore: page.length > CLEANUP_BATCH_SIZE,
    };
  },
});
