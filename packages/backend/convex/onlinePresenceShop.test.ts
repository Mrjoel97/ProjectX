// @vitest-environment node
import type { MerchantSetup } from "@pikar/core/merchantSetup";
import { materializeWebRecipe } from "@pikar/core/webRecipes";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as audit from "./audit";
import { merchantProductConfigRef } from "./merchantCommerce";
import { onlinePresenceShopContext } from "./onlinePresence";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const setupRef = makeFunctionReference<"query">("onlinePresenceShop:setupForPlan");
const projectRef = makeFunctionReference<"query">("onlinePresenceShop:setupForProject");
const approveRef = makeFunctionReference<"mutation">("onlinePresenceShop:approveSetup");
const quote =
  "Seller country US. Buyers US. Currency USD. Tote price 2500 minor units. Stock 12. Tax 0 basis points; shipping 0 minor units. Validity 7 days, retention 7 days. Automatic digital delivery disabled.";
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  const tenantId = await t.run((ctx) => ctx.db.insert("users", {}));
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId,
    threadId: "shop-setup-fixture",
  });
  const started = await t.mutation(internal.onlinePresence.ensureSession, {
    tenantId,
    planId,
    threadId: "shop-setup-fixture",
    text: quote,
  });
  const sourceRef = started.sourceRef;
  const evidence = [{ sourceRef, quote }];
  const draft: MerchantSetup = {
    version: 1,
    sellerCountry: "US",
    currency: "USD",
    countries: ["US"],
    products: [
      {
        catalogueItemId: "tote",
        sku: "tote",
        variant: "standard",
        goodsKind: "physical",
        priceMinor: 2500,
        stock: { kind: "finite", onHand: 12, reservationTtlMs: 600000 },
        evidence,
      },
    ],
    policy: {
      sellerOfRecordRef: sourceRef,
      taxRounding: "half_up",
      physical: {
        shippingSourceRef: sourceRef,
        shippingMinor: 0,
        returnsPolicyRef: sourceRef,
        taxSourceRef: sourceRef,
        taxBasisPoints: 0,
        refundPolicyRef: sourceRef,
        buyerRetentionRef: sourceRef,
      },
    },
    automation: {
      autoDigitalDelivery: false,
      digitalValidityDays: 7,
      buyerRetentionDays: 7,
      policyRef: sourceRef,
    },
    evidence,
  };
  const catalogue = [{ id: "tote", name: "Cotton tote", description: "Cotton carry bag." }];
  const projectId = await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("webProjects", {
      tenantId,
      kind: "storefront",
      slug: "shop-setup",
      title: "Totes",
      publicHost: "",
      domainMode: "platform_path",
      hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
      draftVersion: 1,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("webProjectVersions", {
      tenantId,
      projectId: id,
      version: 1,
      document: materializeWebRecipe("storefront-catalogue", {
        brandName: "Totes",
        items: catalogue,
      }),
      contentHash: "a".repeat(64),
      rendererVersion: "isolated-native-fixture",
      artifactByteLength: 0,
      createdBy: tenantId,
      sourceRefs: [],
      createdAt: now,
    });
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_plan", (q) => q.eq("tenantId", tenantId).eq("planId", planId))
      .unique();
    if (!session) throw Error("session");
    await ctx.db.patch(session._id, {
      projectId: id,
      projectVersion: 1,
      projectContentHash: "a".repeat(64),
      brief: {
        kind: "shop",
        businessName: "Totes",
        headline: "Cotton totes",
        summary: "Cotton carry bags",
        audience: "Shoppers",
        catalogue,
        shopSetup: draft,
        sourceRefs: [sourceRef],
      },
      revision: 1,
    });
    const context = await onlinePresenceShopContext(ctx, tenantId, planId);
    await ctx.db.patch(session._id, {
      sourceSnapshots: context.sources.map(({ ref, revision }) => ({ ref, revision })),
    });
    return id;
  });
  const owner = t.withIdentity({ subject: `${tenantId}|fixture-session` });
  return { t, owner, tenantId, planId, projectId, draft };
}
test("one native exact review provisions products, finite stock, mappings, policy and standing choices atomically", async () => {
  const f = await setup();
  const reviewed = await f.owner.query(setupRef, { planId: f.planId });
  expect(reviewed.ready).toBe(true);
  expect(reviewed.catalogueItems).toEqual([{ id: "tote", name: "Cotton tote" }]);
  const receipt = await f.owner.mutation(approveRef, {
    planId: f.planId,
    expectedRevision: reviewed.expectedRevision,
    packageHash: reviewed.packageHash,
  });
  expect(receipt).toMatchObject({
    approved: true,
    revision: 2,
    testOnly: true,
    checkoutReady: false,
  });
  const rows = await f.t.run(async (ctx) => ({
    products: await ctx.db.query("tenantProducts").collect(),
    stock: await ctx.db.query("tenantStock").collect(),
    mappings: await ctx.db.query("tenantCommerceMappings").collect(),
    policy: await ctx.db.query("tenantCommercePolicies").collect(),
    automation: await ctx.db.query("tenantMerchantAutomation").collect(),
    audits: await ctx.db.query("audit").collect(),
  }));
  expect(rows.products).toHaveLength(1);
  const product = rows.products[0],
    stock = rows.stock[0],
    mapping = rows.mappings[0],
    automation = rows.automation[0];
  if (!product || !stock || !mapping || !automation)
    throw Error("Missing configured shop fixture rows");
  expect(product).toMatchObject({
    tenantId: f.tenantId,
    priceMinor: 2500,
    currency: "USD",
    status: "active",
    goodsKind: "physical",
  });
  expect(stock).toMatchObject({ onHand: 12, reserved: 0, reservationTtlMs: 600000 });
  expect(mapping.productId).toBe(product._id);
  expect(rows.policy).toHaveLength(1);
  expect(automation.autoDigitalDelivery).toBe(false);
  expect(
    rows.audits.find((row) => row.eventType === "online_presence.shop_setup_approved")?.payload,
  ).not.toHaveProperty("setup");
  const after = await f.owner.query(projectRef, { projectId: f.projectId });
  expect(after.ready).toBe(false);
  expect(after.approval).toMatchObject({
    packageHash: reviewed.packageHash,
    current: true,
    version: 1,
  });
  await expect(
    f.owner.mutation(approveRef, {
      planId: f.planId,
      expectedRevision: reviewed.expectedRevision,
      packageHash: reviewed.packageHash,
    }),
  ).rejects.toThrow("STALE_REVISION");
});
test("public approval arguments cannot supply tenant, financial data or an inferred approval", async () => {
  const f = await setup();
  const r = await f.owner.query(setupRef, { planId: f.planId });
  for (const extra of [{ tenantId: f.tenantId }, { products: [] }, { approved: true }])
    await expect(
      f.owner.mutation(approveRef, {
        planId: f.planId,
        expectedRevision: r.expectedRevision,
        packageHash: r.packageHash,
        ...extra,
      }),
    ).rejects.toThrow();
  await expect(f.t.query(setupRef, { planId: f.planId })).rejects.toThrow("UNAUTHENTICATED");
  const stranger = await f.t.run((ctx) => ctx.db.insert("users", {}));
  await expect(
    f.t.withIdentity({ subject: `${stranger}|s` }).query(setupRef, { planId: f.planId }),
  ).rejects.toThrow("ONLINE_PRESENCE_UNAVAILABLE");
});
test("changed package hash, source revision or rendered catalogue refuses before any product write", async () => {
  const f = await setup();
  const r = await f.owner.query(setupRef, { planId: f.planId });
  await expect(
    f.owner.mutation(approveRef, {
      planId: f.planId,
      expectedRevision: r.expectedRevision,
      packageHash: "b".repeat(64),
    }),
  ).rejects.toThrow("SHOP_SETUP_HASH_MISMATCH");
  await f.t.run(async (ctx) => {
    const { session } = await onlinePresenceShopContext(ctx, f.tenantId, f.planId);
    await ctx.db.patch(session._id, {
      humanMessages: session.humanMessages.map((message) => ({
        ...message,
        text: message.text + " Changed source revision.",
      })),
    });
  });
  const changed = await f.owner.query(setupRef, { planId: f.planId });
  expect(changed.ready).toBe(false);
  expect(await f.t.run((ctx) => ctx.db.query("tenantProducts").collect())).toHaveLength(0);
});
test("an omitted or incomplete setup does not become zero-price/default-policy authority", async () => {
  const f = await setup();
  await f.t.run(async (ctx) => {
    const { session } = await onlinePresenceShopContext(ctx, f.tenantId, f.planId);
    await ctx.db.patch(session._id, { brief: { ...session.brief, shopSetup: { version: 1 } } });
  });
  const r = await f.owner.query(setupRef, { planId: f.planId });
  expect(r.ready).toBe(false);
  expect(r.missing.some((m: { field: string }) => m.field === "shopSetup.products")).toBe(true);
  await expect(
    f.owner.mutation(approveRef, {
      planId: f.planId,
      expectedRevision: r.expectedRevision,
      packageHash: "a".repeat(64),
    }),
  ).rejects.toThrow("SHOP_SETUP_NOT_READY");
});
test("private shop version or catalogue changes invalidate the exact reviewed package", async () => {
  const f = await setup();
  const r = await f.owner.query(setupRef, { planId: f.planId });
  await f.t.run((ctx) => ctx.db.patch(f.projectId, { draftVersion: 2, revision: 2 }));
  await expect(
    f.owner.mutation(approveRef, {
      planId: f.planId,
      expectedRevision: r.expectedRevision,
      packageHash: r.packageHash,
    }),
  ).rejects.toThrow("SHOP_SETUP_NOT_READY");
  expect(await f.t.run((ctx) => ctx.db.query("tenantProducts").collect())).toHaveLength(0);
});

test("failure after product insertion rolls back the entire native approval", async () => {
  const f = await setup();
  const r = await f.owner.query(setupRef, { planId: f.planId });
  const fault = vi
    .spyOn(audit, "appendAudit")
    .mockRejectedValueOnce(Error("NATIVE_FIXTURE_AUDIT_FAILURE"));
  try {
    await expect(
      f.owner.mutation(approveRef, {
        planId: f.planId,
        expectedRevision: r.expectedRevision,
        packageHash: r.packageHash,
      }),
    ).rejects.toThrow("NATIVE_FIXTURE_AUDIT_FAILURE");
  } finally {
    fault.mockRestore();
  }
  const counts = await f.t.run(async (ctx) => ({
    products: (await ctx.db.query("tenantProducts").collect()).length,
    stock: (await ctx.db.query("tenantStock").collect()).length,
    mappings: (await ctx.db.query("tenantCommerceMappings").collect()).length,
    policies: (await ctx.db.query("tenantCommercePolicies").collect()).length,
    automation: (await ctx.db.query("tenantMerchantAutomation").collect()).length,
  }));
  expect(counts).toEqual({ products: 0, stock: 0, mappings: 0, policies: 0, automation: 0 });
});

test("digital sale file and explicit untracked choice become authoritative only through native exact approval", async () => {
  const f = await setup();
  const file = await f.t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(["synthetic pattern file"], { type: "application/pdf" }),
    );
    const text =
      "Pattern price 1000 minor units. Untracked digital stock. This is the owned pattern file for sale.";
    const id = await ctx.db.insert("vaultDocuments", {
      tenantId: f.tenantId,
      title: "Pattern",
      kind: "upload",
      category: "operations",
      source: "upload",
      mimeType: "application/pdf",
      size: 22,
      contentHash: "b".repeat(64),
      text,
      storageId,
      status: "ready",
      createdAt: Date.now(),
    });
    const { session } = await onlinePresenceShopContext(ctx, f.tenantId, f.planId);
    const sourceRef = `vault:${id}`;
    const draft = structuredClone(f.draft);
    draft.products.push({
      catalogueItemId: "pattern",
      sku: "pattern",
      variant: "standard",
      goodsKind: "digital",
      priceMinor: 1000,
      stock: { kind: "untracked" },
      digitalDeliverySourceRef: sourceRef,
      evidence: [{ sourceRef, quote: text }],
    });
    draft.policy.digital = {
      deliveryRef: sourceRef,
      revocationRef: draft.policy.sellerOfRecordRef,
      noShipping: true,
      taxSourceRef: draft.policy.sellerOfRecordRef,
      taxBasisPoints: 0,
      refundPolicyRef: draft.policy.sellerOfRecordRef,
      buyerRetentionRef: draft.policy.sellerOfRecordRef,
    };
    const catalogue = [
      ...session.brief.catalogue,
      { id: "pattern", name: "Pattern PDF", description: "Digital sewing pattern" },
    ];
    await ctx.db.patch(session._id, {
      brief: {
        ...session.brief,
        catalogue,
        shopSetup: draft,
        sourceRefs: [...session.brief.sourceRefs, sourceRef],
      },
    });
    const version = await ctx.db
      .query("webProjectVersions")
      .withIndex("by_tenant_project_version", (q) =>
        q.eq("tenantId", f.tenantId).eq("projectId", f.projectId).eq("version", 1),
      )
      .unique();
    if (!version) throw Error("fixture");
    await ctx.db.patch(version._id, {
      document: materializeWebRecipe("storefront-catalogue", {
        brandName: "Totes",
        items: catalogue,
      }),
    });
    const current = await onlinePresenceShopContext(ctx, f.tenantId, f.planId);
    await ctx.db.patch(session._id, {
      sourceSnapshots: current.sources.map(({ ref, revision }) => ({ ref, revision })),
    });
    return id;
  });
  const r = await f.owner.query(setupRef, { planId: f.planId });
  expect(r.ready).toBe(true);
  await f.owner.mutation(approveRef, {
    planId: f.planId,
    expectedRevision: r.expectedRevision,
    packageHash: r.packageHash,
  });
  const product = await f.t.run((ctx) =>
    ctx.db
      .query("tenantProducts")
      .withIndex("by_tenant_sku_variant", (q) =>
        q.eq("tenantId", f.tenantId).eq("sku", "pattern").eq("variant", "standard"),
      )
      .unique(),
  );
  expect(product).toMatchObject({
    goodsKind: "digital",
    digitalDeliveryDocumentId: file,
    revision: 2,
  });
  expect(product?.digitalDeliverySourceHash).toMatch(/^sha256:/);
  const stock = await f.t.run((ctx) =>
    ctx.db
      .query("tenantStock")
      .withIndex("by_tenant_product", (q) =>
        q.eq("tenantId", f.tenantId).eq("productId", product!._id),
      )
      .unique(),
  );
  expect(stock).toMatchObject({ kind: "untracked", approvedUntracked: true });
  const approval = await f.t.run((ctx) =>
    ctx.db
      .query("audit")
      .withIndex("by_tenant_event_ts", (q) =>
        q.eq("tenantId", f.tenantId).eq("eventType", "online_presence.shop_setup_approved"),
      )
      .order("desc")
      .first(),
  );
  expect(approval?.payload.productConfigRefs).toContain(
    merchantProductConfigRef(product!, "pattern"),
  );
});

test("a new title-only version reuses approved products and preserves stock already sold", async () => {
  const f = await setup();
  const first = await f.owner.query(setupRef, { planId: f.planId });
  await f.owner.mutation(approveRef, {
    planId: f.planId,
    expectedRevision: first.expectedRevision,
    packageHash: first.packageHash,
  });
  const before = await f.t.run(async (ctx) => {
    const product = (await ctx.db.query("tenantProducts").collect())[0];
    const stock = (await ctx.db.query("tenantStock").collect())[0];
    if (!product || !stock) throw Error("Missing approved product/stock fixture");
    await ctx.db.patch(stock._id, { onHand: 9, revision: stock.revision + 1 });
    return { product, stock };
  });
  await f.t.run(async (ctx) => {
    const current = await ctx.db
      .query("webProjectVersions")
      .withIndex("by_tenant_project_version", (q) =>
        q.eq("tenantId", f.tenantId).eq("projectId", f.projectId).eq("version", 1),
      )
      .unique();
    if (!current) throw Error("fixture");
    const { _id, _creationTime, ...version } = current;
    await ctx.db.insert("webProjectVersions", {
      ...version,
      version: 2,
      document: { ...version.document, title: "New title" },
      contentHash: "c".repeat(64),
    });
    await ctx.db.patch(f.projectId, { draftVersion: 2, revision: 2 });
    const { session } = await onlinePresenceShopContext(ctx, f.tenantId, f.planId);
    await ctx.db.patch(session._id, {
      projectVersion: 2,
      projectContentHash: "c".repeat(64),
      revision: session.revision + 1,
    });
  });
  const r = await f.owner.query(setupRef, { planId: f.planId });
  expect(r.ready).toBe(true);
  expect(r.inventoryReview).toEqual([
    { catalogueItemId: "tote", action: "preserve", currentOnHand: 9, requestedOnHand: 12 },
  ]);
  const second = await f.owner.mutation(approveRef, {
    planId: f.planId,
    expectedRevision: r.expectedRevision,
    packageHash: r.packageHash,
  });
  expect(second).toMatchObject({
    version: 2,
    policyRevision: 1,
    automationRevision: 1,
    productIds: [before.product._id],
  });
  const after = await f.t.run(async (ctx) => ({
    products: await ctx.db.query("tenantProducts").collect(),
    stock: await ctx.db.get(before.stock._id),
    mapping: await ctx.db.query("tenantCommerceMappings").collect(),
  }));
  expect(after.products).toHaveLength(1);
  const currentProduct = after.products[0],
    currentMapping = after.mapping[0];
  if (!currentProduct || !currentMapping) throw Error("Missing rebound product/mapping fixture");
  expect(currentProduct.revision).toBe(before.product.revision);
  expect(after.stock).toMatchObject({ onHand: 9, revision: before.stock.revision + 1 });
  expect(currentMapping.revision).toBe(1);
});

test("explicit reviewed price/policy changes preserve in-flight quote and stale product race refuses", async () => {
  const f = await setup();
  const first = await f.owner.query(setupRef, { planId: f.planId });
  const initial = await f.owner.mutation(approveRef, {
    planId: f.planId,
    expectedRevision: first.expectedRevision,
    packageHash: first.packageHash,
  });
  const cart = await f.owner.mutation(
    makeFunctionReference<"mutation">("tenantOrders:createCart"),
    {
      projectId: f.projectId,
      addressCountry: "US",
      lines: [
        {
          presentationItemId: "tote",
          productId: initial.productIds[0],
          quantity: 1,
          expectedProductRevision: 1,
          expectedUnitMinor: 2500,
        },
      ],
    },
  );
  const order = await f.owner.mutation(
    makeFunctionReference<"mutation">("tenantOrders:placeOrder"),
    { cartId: cart.cartId, expectedCartRevision: cart.revision, retryKey: "native-price-update" },
  );
  const orderId = order.orderId as Id<"tenantOrders">;
  const before = await f.t.run((ctx) => ctx.db.get(orderId));
  const text = "Tote price 3000 minor units. Stock 12. Shipping 100 minor units. Validity 8 days.";
  const human = await f.t.mutation(internal.onlinePresence.ensureSession, {
    tenantId: f.tenantId,
    planId: f.planId,
    threadId: "shop-setup-fixture",
    text,
  });
  await f.t.run(async (ctx) => {
    const { session } = await onlinePresenceShopContext(ctx, f.tenantId, f.planId);
    const draft = structuredClone(session.brief.shopSetup);
    draft.products[0].priceMinor = 3000;
    draft.products[0].evidence = [{ sourceRef: human.sourceRef, quote: text }];
    draft.policy.physical.shippingMinor = 100;
    draft.automation.digitalValidityDays = 8;
    draft.evidence.push({ sourceRef: human.sourceRef, quote: text });
    await ctx.db.patch(session._id, {
      brief: {
        ...session.brief,
        shopSetup: draft,
        sourceRefs: [...session.brief.sourceRefs, human.sourceRef],
      },
    });
    const current = await onlinePresenceShopContext(ctx, f.tenantId, f.planId);
    await ctx.db.patch(session._id, {
      sourceSnapshots: current.sources.map(({ ref, revision }) => ({ ref, revision })),
    });
  });
  const r = await f.owner.query(setupRef, { planId: f.planId });
  expect(r.ready).toBe(true);
  await f.owner.mutation(makeFunctionReference<"mutation">("tenantCatalogue:editProduct"), {
    productId: initial.productIds[0],
    expectedRevision: 1,
    priceMinor: 3500,
  });
  await expect(
    f.owner.mutation(approveRef, {
      planId: f.planId,
      expectedRevision: r.expectedRevision,
      packageHash: r.packageHash,
    }),
  ).rejects.toThrow("SHOP_SETUP_HASH_MISMATCH");
  const fresh = await f.owner.query(setupRef, { planId: f.planId });
  const receipt = await f.owner.mutation(approveRef, {
    planId: f.planId,
    expectedRevision: fresh.expectedRevision,
    packageHash: fresh.packageHash,
  });
  expect(receipt).toMatchObject({ policyRevision: 2, automationRevision: 2 });
  const after = await f.t.run((ctx) => ctx.db.get(orderId));
  expect(after?.snapshot).toEqual(before?.snapshot);
  expect(after?.snapshotHash).toEqual(before?.snapshotHash);
  expect(after?.snapshot.totalMinor).toBe(2500);
  const product = await f.t.run((ctx) => ctx.db.get(initial.productIds[0] as Id<"tenantProducts">));
  expect(product).toMatchObject({ priceMinor: 3000, revision: 3 });
});

test("inventory changes with held reservations refuse and a stock revision race invalidates review", async () => {
  const f = await setup();
  const first = await f.owner.query(setupRef, { planId: f.planId });
  const initial = await f.owner.mutation(approveRef, {
    planId: f.planId,
    expectedRevision: first.expectedRevision,
    packageHash: first.packageHash,
  });
  const text = "Tote price 2500 minor units. Stock 13.";
  const human = await f.t.mutation(internal.onlinePresence.ensureSession, {
    tenantId: f.tenantId,
    planId: f.planId,
    threadId: "shop-setup-fixture",
    text,
  });
  await f.t.run(async (ctx) => {
    const { session } = await onlinePresenceShopContext(ctx, f.tenantId, f.planId);
    const draft = structuredClone(session.brief.shopSetup);
    draft.products[0].stock.onHand = 13;
    draft.products[0].evidence = [{ sourceRef: human.sourceRef, quote: text }];
    await ctx.db.patch(session._id, {
      brief: {
        ...session.brief,
        shopSetup: draft,
        sourceRefs: [...session.brief.sourceRefs, human.sourceRef],
      },
    });
    const current = await onlinePresenceShopContext(ctx, f.tenantId, f.planId);
    await ctx.db.patch(session._id, {
      sourceSnapshots: current.sources.map(({ ref, revision }) => ({ ref, revision })),
    });
  });
  const r = await f.owner.query(setupRef, { planId: f.planId });
  expect(r.ready).toBe(true);
  await f.owner.mutation(makeFunctionReference<"mutation">("tenantCatalogue:reserveProduct"), {
    productId: initial.productIds[0],
    expectedStockRevision: 1,
    quantity: 1,
  });
  const held = await f.owner.query(setupRef, { planId: f.planId });
  expect(held.ready).toBe(false);
  expect(held.missing.some((m: { field: string }) => m.field === "stock")).toBe(true);
  await expect(
    f.owner.mutation(approveRef, {
      planId: f.planId,
      expectedRevision: r.expectedRevision,
      packageHash: r.packageHash,
    }),
  ).rejects.toThrow("SHOP_SETUP_NOT_READY");
  const product = await f.t.run((ctx) => ctx.db.get(initial.productIds[0] as Id<"tenantProducts">));
  expect(product?.revision).toBe(1);
});

test("headline-only saving retains only prior snapshot-bound setup evidence and refuses changed revisions", async () => {
  const f = await setup();
  const human = await f.t.mutation(internal.onlinePresence.ensureSession, {
    tenantId: f.tenantId,
    planId: f.planId,
    threadId: "shop-setup-fixture",
    text: "Use the new headline: Carry what matters.",
  });
  const current = await f.t.run((ctx) => onlinePresenceShopContext(ctx, f.tenantId, f.planId));
  const brief = {
    kind: "shop",
    businessName: "Totes",
    headline: "Carry what matters",
    summary: "Cotton carry bags",
    audience: "Shoppers",
    sourceRefs: [human.sourceRef],
  };
  const saved = await f.t.mutation(internal.onlinePresence.saveBrief, {
    tenantId: f.tenantId,
    planId: f.planId,
    expectedRevision: current.session.revision,
    brief,
  });
  expect(saved.ok).toBe(true);
  const after = await f.t.run((ctx) => onlinePresenceShopContext(ctx, f.tenantId, f.planId));
  expect(after.session.brief.shopSetup).toEqual(f.draft);
  expect(after.session.brief.sourceRefs).toContain(f.draft.policy.sellerOfRecordRef);
  expect(after.session.sourceSnapshots).toEqual(
    expect.arrayContaining(current.session.sourceSnapshots ?? []),
  );
  await f.t.run((ctx) =>
    ctx.db.patch(after.session._id, {
      humanMessages: after.session.humanMessages.map((m, i) =>
        i === 0 ? { ...m, text: `${m.text} Changed source identity.` } : m,
      ),
    }),
  );
  const refused = await f.t.mutation(internal.onlinePresence.saveBrief, {
    tenantId: f.tenantId,
    planId: f.planId,
    expectedRevision: after.session.revision,
    brief: { ...brief, headline: "Another heading" },
  });
  expect(refused.ok).toBe(false);
  if (!refused.assessment || refused.assessment.ok)
    throw Error("Expected refused setup source assessment");
  expect(refused.assessment.missing).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: "shopSetup", reason: "unknown_source" }),
    ]),
  );
});
