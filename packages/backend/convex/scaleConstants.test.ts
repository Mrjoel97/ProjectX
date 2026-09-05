// Phase 25.3 (G17): scale constants and bounded maintenance jobs.
import { REFRESH_TOKEN_TTL_MS } from "@pikar/core/tokenExpiry";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import migrationsSchema from "../node_modules/@convex-dev/migrations/src/component/schema.js";
import { internal } from "./_generated/api";
import { envCents } from "./guardrails";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const migrationsModules = import.meta.glob(
  "../node_modules/@convex-dev/migrations/src/component/**/!(*.test).ts",
);
const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const src = (name: string): string => {
  const hit = Object.entries(sources).find(([p]) => p.endsWith(`/${name}`) || p === `./${name}`);
  if (!hit) throw new Error(`source not loaded: ${name}`);
  return hit[1];
};

describe("the deployment ceilings come from env, with the compiled value as the fallback", () => {
  test("envCents accepts a positive integer and nothing else", () => {
    expect(envCents("7500", 5_000)).toBe(7_500);
    expect(envCents(undefined, 5_000)).toBe(5_000);
    expect(envCents("", 5_000)).toBe(5_000);
    expect(envCents("0", 5_000)).toBe(5_000);
    expect(envCents("-1", 5_000)).toBe(5_000);
    expect(envCents("12.5", 5_000)).toBe(5_000);
    expect(envCents("fifty", 5_000)).toBe(5_000);
  });
  test("the three caps are LITERAL process.env reads (the manifest scan sees literals only)", () => {
    // biome may wrap the call across lines; collapse whitespace after "(" before matching.
    const g = src("guardrails.ts").replace(/\(\s+/g, "(");
    for (const n of [
      "DEPLOYMENT_BUDGET_CENTS",
      "DEPLOYMENT_MEDIA_BUDGET_CENTS",
      "DEPLOYMENT_INGEST_BUDGET_CENTS",
    ]) {
      expect(g, n).toContain(`envCents(process.env.${n}`);
    }
  });
});

describe("the expiring-token scan raises ONE unread reconnect notice, not one per day", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const oneBatch = (t: ReturnType<typeof convexTest>) =>
    t.mutation(internal.gmailAuth.scanExpiringTokens, {
      cursor: null,
      batchSize: 100,
      dryRun: false,
      oneBatchOnly: true,
    });
  test("two daily runs inside the warning window → one notification; a read one re-arms it", async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("migrations", migrationsSchema, migrationsModules);
    await t.run(async (ctx) => {
      await ctx.db.insert("gmailTokens", {
        tenantId: "t_expiring",
        refreshToken: "r",
        scope: "mail",
        updatedAt: Date.now(),
      });
    });
    // Inside the 24 h warning window of the 7-day refresh TTL.
    vi.setSystemTime(Date.now() + REFRESH_TOKEN_TTL_MS - 60 * 60 * 1000);
    await oneBatch(t);
    await oneBatch(t);
    const notes = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_tenant", (q) => q.eq("tenantId", "t_expiring"))
        .collect(),
    );
    expect(notes.filter((n) => n.kind === "gmail_reconnect")).toHaveLength(1);
    // The user dismissed it → the next scan may warn again.
    await t.run(async (ctx) => {
      for (const n of notes) await ctx.db.patch(n._id, { read: true });
    });
    await oneBatch(t);
    const after = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_tenant", (q) => q.eq("tenantId", "t_expiring"))
        .collect(),
    );
    expect(after.filter((n) => n.kind === "gmail_reconnect")).toHaveLength(2);
  });
  test("a fresh grant is left alone", async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("migrations", migrationsSchema, migrationsModules);
    await t.run(async (ctx) => {
      await ctx.db.insert("gmailTokens", {
        tenantId: "t_fresh",
        refreshToken: "r",
        scope: "mail",
        updatedAt: Date.now(),
      });
    });
    await oneBatch(t);
    const notes = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_tenant", (q) => q.eq("tenantId", "t_fresh"))
        .collect(),
    );
    expect(notes).toHaveLength(0);
  });
});

describe("no cron or maintenance job reads a whole table in one transaction any more", () => {
  const strip = (s: string) =>
    s
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
  test("the five jobs the audit named are batch jobs or paged", () => {
    const pr = strip(src("proactiveReview.ts"));
    expect(pr).toContain('table: "users"');
    expect(pr).not.toMatch(/\.collect\(\)/);
    expect(pr).toContain('rateLimiter.check(ctx, "deploymentSpendCents"');
    const ga = strip(src("gmailAuth.ts"));
    expect(ga).toContain('table: "gmailTokens"');
    expect(ga).not.toMatch(/query\("gmailTokens"\)\s*\.collect\(\)/);
    const vi_ = strip(src("vaultIngest.ts"));
    expect(vi_).toContain("retryStuckIngestsBatch = migrations.define");
    expect(vi_).not.toMatch(/query\("vaultDocuments"\)\s*\.collect\(\)/);
    const au = strip(src("audit.ts"));
    expect(au).toContain("reinsertAuditCounts = migrations.define");
    expect(au).not.toMatch(/query\("audit"\)\s*\.collect\(\)/);
    const worm = strip(src("worm.ts"));
    expect(worm).toContain("while (Date.now() < deadline)");
    expect(worm).toContain("if (rows.length < limit) break;");
  });
});
