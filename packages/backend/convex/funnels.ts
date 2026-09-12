import {
  FUNNEL_SOURCE_MAX_LENGTH,
  FUNNEL_STAGE_COUNTER,
  FUNNEL_STAGES,
  FUNNEL_TITLE_MAX_LENGTH,
  normalizeFunnelSource,
  parseFunnelCounters,
  parseFunnelStage,
} from "@pikar/core/marketing";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";

const TOKEN_DOMAIN = "pikar:funnel:v1:";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const LIST_LIMIT = 100;

function siteOrigin(): string | null {
  try {
    const url = new URL(process.env.CONVEX_SITE_URL ?? "");
    return url.protocol === "https:" &&
      /^[a-z0-9-]+\.convex\.site$/.test(url.hostname) &&
      !url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/** Only the configured deployment's native HTTPS storage URL can leave the public resolver. */
export function isTrustedFunnelStorageUrl(value: string): boolean {
  try {
    const site = siteOrigin();
    if (!site) return false;
    const expected = new URL(
      process.env.CONVEX_CLOUD_URL ?? site.replace(/\.convex\.site$/, ".convex.cloud"),
    );
    const url = new URL(value);
    return (
      expected.protocol === "https:" &&
      url.protocol === "https:" &&
      url.origin === expected.origin &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith("/api/storage/")
    );
  } catch {
    return false;
  }
}

export const create = tenantMutation({
  args: { vaultDocId: v.id("vaultDocuments"), title: v.string(), source: v.string() },
  handler: async (ctx, args) => {
    const title = args.title.trim();
    const source = normalizeFunnelSource(args.source);
    if (!title || args.title.length > FUNNEL_TITLE_MAX_LENGTH || !source)
      throw new Error("INVALID_FUNNEL_INPUT");
    const origin = siteOrigin();
    if (!origin) throw new Error("FUNNEL_NOT_CONFIGURED");
    const doc = await ctx.db.get(args.vaultDocId);
    if (!doc || doc.tenantId !== ctx.tenantId || doc.status !== "ready" || !doc.storageId)
      throw new Error("ARTIFACT_UNAVAILABLE");
    if (!(await ctx.db.system.get(doc.storageId))) throw new Error("ARTIFACT_UNAVAILABLE");
    const location = await ctx.storage.getUrl(doc.storageId);
    if (!location || !isTrustedFunnelStorageUrl(location)) throw new Error("ARTIFACT_UNAVAILABLE");
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const tokenHash = await contentHash(TOKEN_DOMAIN + token);
    if (
      await ctx.db
        .query("funnels")
        .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
        .first()
    )
      throw new Error("FUNNEL_CREATION_RETRY_REQUIRED");
    const id = await ctx.db.insert("funnels", {
      tenantId: ctx.tenantId,
      vaultDocId: doc._id,
      storageId: doc.storageId,
      title,
      source,
      tokenHash,
      status: "active",
      createdAt: Date.now(),
      visits: 0,
      claims: 0,
      downloads: 0,
    });
    const urls = Object.fromEntries(
      FUNNEL_STAGES.map((stage) => [
        stage,
        `${origin}/f/${token}/${stage}?s=${encodeURIComponent(source)}`,
      ]),
    ) as Record<(typeof FUNNEL_STAGES)[number], string>;
    return { id, token, urls };
  },
});

export const list = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("funnels")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(LIST_LIMIT + 1);
    return {
      items: rows.slice(0, LIST_LIMIT).map((row) => ({
        id: row._id,
        title: row.title,
        source: row.source,
        status: row.status,
        createdAt: row.createdAt,
        deactivatedAt: row.deactivatedAt ?? null,
        counters: parseFunnelCounters(row),
      })),
      hasMore: rows.length > LIST_LIMIT,
    };
  },
});

export const deactivate = tenantMutation({
  args: { id: v.id("funnels") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.tenantId !== ctx.tenantId) throw new Error("FUNNEL_UNAVAILABLE");
    if (row.status === "deactivated") return { changed: false };
    await ctx.db.patch(id, { status: "deactivated", deactivatedAt: Date.now() });
    return { changed: true };
  },
});

/** Public HTTP will call this internal transaction; callers cannot select a tenant/destination. */
export const resolveAndIncrement = internalMutation({
  args: { token: v.string(), stage: v.string(), source: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ location: string } | null> => {
    const stage = parseFunnelStage(args.stage);
    if (
      !stage ||
      !TOKEN.test(args.token) ||
      (args.source !== undefined &&
        (args.source.length > FUNNEL_SOURCE_MAX_LENGTH ||
          normalizeFunnelSource(args.source) === null))
    )
      return null;
    const tokenHash = await contentHash(TOKEN_DOMAIN + args.token);
    const matches = await ctx.db
      .query("funnels")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .take(2);
    if (matches.length !== 1) return null;
    const row = matches[0];
    if (row?.status !== "active") return null;
    const counters = parseFunnelCounters(row);
    const counter = FUNNEL_STAGE_COUNTER[stage];
    if (!counters || counters[counter] === Number.MAX_SAFE_INTEGER) return null;
    const doc = await ctx.db.get(row.vaultDocId);
    if (
      !doc ||
      doc.tenantId !== row.tenantId ||
      doc.status !== "ready" ||
      !(await ctx.db.system.get(row.storageId))
    )
      return null;
    const location = await ctx.storage.getUrl(row.storageId);
    if (!location || !isTrustedFunnelStorageUrl(location)) return null;
    await ctx.db.patch(row._id, { [counter]: counters[counter] + 1 });
    return { location };
  },
});
