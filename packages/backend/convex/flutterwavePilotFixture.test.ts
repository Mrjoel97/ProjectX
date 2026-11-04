// @vitest-environment node
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const prepare = makeFunctionReference<"mutation">("flutterwavePilotFixture:prepare");
const review = makeFunctionReference<"query">("onlinePresenceShop:setupForProject");
const email = "verified-stage-owner@example.test";
afterEach(() => vi.unstubAllEnvs());

test("operator bootstrap stays in dedicated staging, requires a verified owner, and prepares one review without financial authority", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "auditCounts",
    aggregateSchema,
    import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts"),
  );
  const user = await t.run((ctx) => ctx.db.insert("users", { email }));
  vi.stubEnv("CONVEX_CLOUD_URL", "https://production.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://production.convex.site");
  await expect(t.mutation(prepare, { confirmedOwnerEmail: email })).rejects.toThrow(
    "DEDICATED_STAGE",
  );
  vi.stubEnv("CONVEX_CLOUD_URL", "https://third-gecko-977.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://third-gecko-977.convex.site");
  await expect(t.mutation(prepare, { confirmedOwnerEmail: email })).rejects.toThrow(
    "VERIFIED_OWNER",
  );
  await t.run((ctx) => ctx.db.patch(user, { owner: true }));
  await expect(t.mutation(prepare, { confirmedOwnerEmail: email })).rejects.toThrow(
    "VERIFIED_OWNER",
  );
  await t.run((ctx) => ctx.db.patch(user, { emailVerificationTime: Date.now() }));
  const f = await t.mutation(prepare, { confirmedOwnerEmail: email });
  const repeated = await t.mutation(prepare, { confirmedOwnerEmail: email });
  expect(f).toMatchObject({ tenantId: user, created: true });
  expect(repeated).toEqual({ ...f, created: false });
  const r = await t
    .withIdentity({ subject: `${user}|fixture` })
    .query(review, { projectId: f.projectId });
  expect(r).toMatchObject({
    ready: true,
    approval: null,
    projectId: f.projectId,
    version: 1,
    setup: {
      sellerCountry: "TZ",
      currency: "TZS",
      products: [{ goodsKind: "physical", priceMinor: 100000 }],
    },
  });
  expect(r.packageHash).toMatch(/^[a-f0-9]{64}$/);
  await t.run(async (ctx) => {
    const [project] = await ctx.db.query("webProjects").collect();
    expect(project?.publishedVersion).toBeUndefined();
    expect(project?.approvedVersion).toBeUndefined();
    expect(await ctx.db.query("tenantProducts").take(1)).toEqual([]);
    expect(await ctx.db.query("tenantMerchantAccounts").take(1)).toEqual([]);
    expect(await ctx.db.query("tenantMerchantPayments").take(1)).toEqual([]);
    expect((await ctx.db.query("vaultDocuments").collect()).length).toBe(1);
    expect((await ctx.db.query("onlinePresenceSessions").unique())?.humanMessages).toEqual([]);
  });
  // Exercise the normal owner-only confirmation in memory, after checking the bootstrap
  // created no approvals or sellable products. A repeated bootstrap must preserve it.
  const approved = await t
    .withIdentity({ subject: `${user}|fixture` })
    .mutation(makeFunctionReference<"mutation">("onlinePresenceShop:approveSetup"), {
      planId: f.planId,
      expectedRevision: r.expectedRevision,
      packageHash: r.packageHash,
    });
  expect(approved).toMatchObject({ approved: true, testOnly: true, checkoutReady: false });
  expect(await t.mutation(prepare, { confirmedOwnerEmail: email })).toEqual(repeated);
  expect(await t.run((ctx) => ctx.db.query("tenantProducts").unique())).toMatchObject({
    currency: "TZS",
    priceMinor: 100000,
  });
});
