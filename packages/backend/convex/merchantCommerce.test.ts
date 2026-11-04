import { exportableTables } from "@pikar/core/tenantData";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { flutterwaveReference, makeMerchantCapability } from "./lib/merchantProviderClient";
import { configureAutomationForTenant, merchantProductConfigRef } from "./merchantCommerce";
import { bindDigitalDeliveryForTenant } from "./merchantOperations";
import schema from "./schema";
import { createProductForTenant } from "./tenantCatalogue";
import {
  configurePolicyForTenant,
  createCartForTenant,
  mapProductForTenant,
  placeOrderForTenant,
} from "./tenantOrders";

const modules = import.meta.glob("./**/*.*s"),
  aggregateModules = import.meta.glob(
    "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
  );
const mutation = (name: string) => makeFunctionReference<"mutation">(`merchantCommerce:${name}`);
const status = makeFunctionReference<"query">("merchantCommerce:status");
function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}
async function setup(t: ReturnType<typeof harness>, provider: "stripe" | "flutterwave" = "stripe") {
  const isFlutterwave = provider === "flutterwave";
  const currency = isFlutterwave ? "TZS" : "GBP";
  const providerAccountId = isFlutterwave ? "12345" : "acct_fixture";
  vi.stubEnv("MERCHANT_STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
  vi.stubEnv("MERCHANT_STRIPE_TEST_WEBHOOK_SECRET", "whsec_fixture");
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "native-merchant@example.test" }),
      tenantId = String(userId),
      now = Date.now();
    const projectId = await ctx.db.insert("webProjects", {
      tenantId,
      kind: "storefront",
      slug: "native-shop",
      title: "Shop",
      publicHost: "native.test",
      domainMode: "platform_path",
      hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
      draftVersion: 1,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    const document = {
      kind: "storefront",
      title: "Shop",
      brand: { name: "Shop" },
      navigation: [],
      pages: [
        {
          slug: "catalogue",
          title: "Shop",
          nodes: [
            {
              kind: "catalogue",
              items: [{ id: "item-one", name: "Lamp", description: "A real lamp" }],
            },
          ],
        },
      ],
    };
    await ctx.db.insert("webProjectVersions", {
      tenantId,
      projectId,
      version: 1,
      document,
      contentHash: "sha256:" + "1".repeat(64),
      rendererVersion: "native-fixture",
      artifactByteLength: 0,
      createdBy: tenantId,
      createdAt: now,
      sourceRefs: [],
    });
    const product = await createProductForTenant(ctx, tenantId, {
      sku: "lamp",
      variant: "one",
      currency,
      priceMinor: 1000,
      status: "active",
      goodsKind: "physical",
      stock: { kind: "finite", onHand: 2, reservationTtlMs: 60000 },
    });
    const policy = await configurePolicyForTenant(ctx, tenantId, {
      projectId,
      expectedRevision: 0,
      sellerOfRecordRef: "merchant-confirmed",
      currency,
      countries: ["TZ"],
      taxRounding: "half_up",
      physical: {
        taxSourceRef: "tax-confirmed",
        taxBasisPoints: 0,
        shippingSourceRef: "shipping-confirmed",
        shippingMinor: 0,
        returnsPolicyRef: "returns-confirmed",
        refundPolicyRef: "refund-confirmed",
        buyerRetentionRef: "retention-confirmed",
      },
    });
    await mapProductForTenant(ctx, tenantId, {
      projectId,
      presentationItemId: "item-one",
      productId: product.productId,
      expectedRevision: 0,
    });
    await configureAutomationForTenant(ctx, tenantId, {
      projectId,
      expectedRevision: 0,
      autoDigitalDelivery: false,
      digitalValidityDays: 7,
      buyerRetentionDays: 7,
      policyRef: "approved-owner-policy",
    });
    const policyRow = await ctx.db
      .query("tenantCommercePolicies")
      .withIndex("by_tenant_project_revision", (q) =>
        q.eq("tenantId", tenantId).eq("projectId", projectId),
      )
      .first();
    await ctx.db.insert("audit", {
      tenantId,
      actor: "online-presence-shop-owner-review",
      correlationId: "native-owner-review",
      eventType: "online_presence.shop_setup_approved",
      payload: {
        projectId,
        version: 1,
        contentHash: "sha256:" + "1".repeat(64),
        packageHash: "sha256:" + "2".repeat(64),
        policyId: policyRow!._id,
        policyRevision: 1,
        automationRevision: 1,
        productIds: [product.productId],
        productConfigRefs: [
          merchantProductConfigRef((await ctx.db.get(product.productId))!, "item-one"),
        ],
      },
      ts: now,
    });
    const accountId = await ctx.db.insert("tenantMerchantAccounts", {
      tenantId,
      projectId,
      provider,
      environment: "test",
      sellerCountry: "TZ",
      currency,
      revision: 1,
      status: "ready",
      providerAccountId,
      trackingId: "fixture",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(accountId, {
      capability: makeMerchantCapability({
        tenantId,
        accountId,
        providerAccountId,
        provider,
        sellerCountry: "TZ",
        currency,
        buyerCountries: ["TZ"],
        now,
      }),
    });
    if (isFlutterwave) {
      vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_SECRET_KEY", "FLWSECK_TEST-fixture-X");
      vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_WEBHOOK_SECRET", "flutterwave-test-webhook-secret");
      vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_ACCOUNT_ID", providerAccountId);
      vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_TENANT_ID", tenantId);
      vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_PROJECT_ID", projectId);
    }
    const cart = await createCartForTenant(ctx, tenantId, {
      projectId,
      addressCountry: "TZ",
      lines: [
        {
          presentationItemId: "item-one",
          productId: product.productId,
          quantity: 1,
          expectedProductRevision: 1,
          expectedUnitMinor: 1000,
        },
      ],
    });
    const order = await placeOrderForTenant(ctx, tenantId, {
      cartId: cart.cartId,
      expectedCartRevision: 1,
      retryKey: "native-payment",
    });
    return {
      tenantId,
      userId,
      projectId,
      productId: product.productId,
      accountId,
      orderId: order.orderId!,
      policy,
    };
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("merchant payment integration", () => {
  test("private order preparation rejects stale or foreign selections and reserves only once per request", async () => {
    const t = harness();
    const shop = await setup(t, "flutterwave");
    const owner = t.withIdentity({ subject: `${shop.userId}|session` });
    const fn = makeFunctionReference<"mutation">("merchantPilot:prepareOrder");
    const input = {
      projectId: shop.projectId,
      presentationItemId: "item-one",
      productId: shop.productId,
      productRevision: 1,
      unitMinor: 1000,
      requestId: crypto.randomUUID(),
    };
    const counts = () =>
      t.run(async (ctx) => ({
        carts: (await ctx.db.query("tenantCarts").collect()).length,
        orders: (await ctx.db.query("tenantOrders").collect()).length,
        holds: (await ctx.db.query("tenantReservations").collect()).length,
        reserved: (await ctx.db.query("tenantStock").unique())?.reserved,
      }));
    const baseline = await counts();
    const other = await t.run((ctx) =>
      ctx.db.insert("users", { email: "other-shop@example.test" }),
    );
    const foreign = t.withIdentity({ subject: `${other}|session` });
    await expect(foreign.mutation(fn, input)).rejects.toThrow("MERCHANT_PROJECT_UNAVAILABLE");
    await expect(owner.mutation(fn, { ...input, requestId: "invalid" })).rejects.toThrow(
      "PRIVATE_TEST_UNAVAILABLE",
    );
    for (const stale of [
      { presentationItemId: "retired" },
      { productRevision: 2 },
      { unitMinor: 900 },
    ]) {
      await expect(owner.mutation(fn, { ...input, ...stale })).rejects.toThrow(
        "TEST_PRICE_CHANGED",
      );
    }
    expect(await counts()).toEqual(baseline);
    const [first, duplicate] = await Promise.all([
      owner.mutation(fn, input),
      owner.mutation(fn, input),
    ]);
    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({ totalMinor: 1000, currency: "TZS", status: "pending" });
    expect(first.orderId).not.toBe(shop.orderId);
    await expect(owner.mutation(fn, { ...input, unitMinor: 1200 })).rejects.toThrow(
      "TEST_ORDER_SELECTION_CHANGED",
    );
    expect(await owner.mutation(fn, input)).toEqual(first);
    expect(await counts()).toEqual({
      carts: baseline.carts + 1,
      orders: baseline.orders + 1,
      holds: baseline.holds + 1,
      reserved: (baseline.reserved ?? 0) + 1,
    });
  });
  test("Flutterwave private TZ/TZS proof binds the seller, consumes the order once and never opens public checkout", async () => {
    const t = harness();
    const a = await setup(t, "flutterwave");
    const actor = t.withIdentity({ subject: `${a.userId}|session` });
    const readStatus = () => actor.query(status, { projectId: a.projectId });
    const initial = await readStatus();
    expect(initial.publicCheckoutReady).toBe(false);
    expect(initial.privateFlutterwavePilot).toMatchObject({
      canStartTest: true,
      verifiedTestPayment: false,
      items: [{ productId: a.productId, presentationItemId: "item-one", unitMinor: 1000 }],
    });
    const payment = await t.mutation(mutation("prepareCheckout"), {
      tenantId: a.tenantId,
      orderId: a.orderId,
      provider: "flutterwave",
    });
    const args = { tenantId: a.tenantId, paymentId: payment._id };
    const claim = {
      ...args,
      providerOrderId: flutterwaveReference(payment.state),
      buyerTokenHash: "b".repeat(64),
    };
    await expect(
      t.mutation(mutation("claimFlutterwaveCheckout"), {
        ...claim,
        providerOrderId: "other-order",
      }),
    ).rejects.toThrow("REFERENCE_INVALID");
    expect(await t.mutation(mutation("claimFlutterwaveCheckout"), claim)).toBe(true);
    expect(await t.mutation(mutation("claimFlutterwaveCheckout"), claim)).toBe(false);
    const receipt = {
      ...payment.state,
      amountMinor: 1000,
      outcome: "succeeded",
      paymentRef: "100099",
      eventRef: "flutterwave-success-100099",
      verification: { method: "provider_read", evidenceRef: "flutterwave-transaction-100099" },
    };
    const apply = (overrides: Record<string, unknown> = {}) =>
      t.mutation(mutation("applyPayment"), { ...args, receipt: { ...receipt, ...overrides } });
    await expect(apply({ providerAccountRef: "999" })).rejects.toThrow("foreign");
    await expect(apply({ currency: "GBP" })).rejects.toThrow("payment_conflict");
    await expect(
      apply({ verification: { method: "signed_webhook", evidenceRef: "webhook-only" } }),
    ).rejects.toThrow("invalid_receipt");
    await apply();
    expect(await apply()).toMatchObject({ duplicate: true, status: "paid" });
    // A delayed exception on the original /payments request cannot undo confirmed payment.
    await t.mutation(mutation("updateCheckout"), { ...args, unknown: true });
    expect(await readStatus()).toMatchObject({
      privateFlutterwavePilot: { verifiedTestPayment: true },
      publicCheckoutReady: false,
    });
    const stock = await t.run((ctx) =>
      ctx.db
        .query("tenantStock")
        .withIndex("by_tenant_product", (q) =>
          q.eq("tenantId", a.tenantId).eq("productId", a.productId),
        )
        .unique(),
    );
    expect(stock).toMatchObject({ reserved: 0, onHand: 1 });
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_ACCOUNT_ID", "999");
    expect(await readStatus()).toMatchObject({
      privateFlutterwavePilot: { canStartTest: false, verifiedTestPayment: false },
      publicCheckoutReady: false,
    });
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_PROJECT_ID", "different-project");
    expect((await readStatus()).privateFlutterwavePilot).toBeNull();
    await expect(t.mutation(mutation("claimFlutterwaveCheckout"), claim)).rejects.toThrow(
      "UNAVAILABLE",
    );
  });
  test.each([
    "active",
    "restricted",
  ])("Stripe refresh uses indexed includes and respects %s capability", async (capability) => {
    const t = harness(),
      a = await setup(t),
      actor = t.withIdentity({ subject: `${a.userId}|session` });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(
        "https://api.stripe.com/v2/core/accounts/acct_fixture",
      );
      if (url.searchParams.has("include[]"))
        return Response.json({ error: { code: "invalid_fields" } }, { status: 400 });
      expect([...url.searchParams.entries()]).toEqual([
        ["include[0]", "configuration.merchant"],
        ["include[1]", "defaults"],
        ["include[2]", "identity"],
      ]);
      return Response.json({
        id: "acct_fixture",
        object: "v2.core.account",
        livemode: false,
        dashboard: "full",
        identity: { country: "TZ" },
        defaults: {
          currency: "gbp",
          responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
        },
        configuration: { merchant: { capabilities: { card_payments: { status: capability } } } },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await actor.action(makeFunctionReference<"action">("merchantProvider:refresh"), {
      projectId: a.projectId,
      provider: "stripe",
    });
    expect(result).toMatchObject({ ok: capability === "active", ready: capability === "active" });
    if (capability === "restricted") expect(result.reason).toBe("MERCHANT_ACCOUNT_NOT_READY");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const account = await t.run((ctx) => ctx.db.get(a.accountId));
    expect(account?.status).toBe(capability === "active" ? "ready" : "unavailable");
  });
  test("Stripe onboarding resumes the owned test account with accepted account-link fields", async () => {
    const t = harness(),
      a = await setup(t),
      actor = t.withIdentity({ subject: `${a.userId}|session` });
    vi.stubEnv("SITE_URL", "https://www.pikar-ai.com");
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.stripe.com/v2/core/account_links");
      const body = JSON.parse(String(init?.body));
      // The pinned Stripe API rejects configurations on this request, even though
      // configurations can appear on the returned account-link object.
      if (body.use_case.account_onboarding.configurations !== undefined)
        return Response.json({ error: { code: "invalid_fields" } }, { status: 400 });
      expect(body.account).toBe("acct_fixture");
      expect(body.use_case).toEqual({
        type: "account_onboarding",
        account_onboarding: {
          refresh_url: `https://www.pikar-ai.com/dashboard/sites?project=${a.projectId}&merchant=return`,
          return_url: `https://www.pikar-ai.com/dashboard/sites?project=${a.projectId}&merchant=return`,
        },
      });
      return Response.json({
        account: "acct_fixture",
        livemode: false,
        url: "https://connect.stripe.com/setup/test-fixture",
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await actor.action(makeFunctionReference<"action">("merchantProvider:connect"), {
      projectId: a.projectId,
      provider: "stripe",
      shareDataConsent: true,
    });
    expect(result).toEqual({ ok: true, url: "https://connect.stripe.com/setup/test-fixture" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const account = await t.run((ctx) => ctx.db.get(a.accountId));
    expect(account).toMatchObject({ providerAccountId: "acct_fixture", status: "connecting" });
  });
  test("merchant buyer data exports only to its tenant without access secrets and financial history prevents partial erasure", async () => {
    const t = harness(),
      a = await setup(t),
      actor = t.withIdentity({ subject: `${a.userId}|session` });
    const payment = await t.mutation(mutation("prepareCheckout"), {
      tenantId: a.tenantId,
      orderId: a.orderId,
      provider: "stripe",
    });
    await t.run((ctx) =>
      ctx.db.patch(payment._id, {
        buyerEmail: "buyer@example.test",
        buyerAddress: {
          name: "Test buyer",
          line1: "Test address",
          city: "Test city",
          postalCode: "00000",
          country: "TZ",
        },
        buyerTokenHash: "private-buyer-capability",
        checkoutUrl: "https://checkout.stripe.com/c/pay/test-private",
      }),
    );
    const exportFn = makeFunctionReference<"query">("tenantExport:exportTenantData"),
      cursor = {
        tableIndex: exportableTables().indexOf("tenantMerchantPayments"),
        cursor: null,
        rowsExported: 0,
        tableRows: 0,
        truncated: false,
        generatedAt: "2026-10-24T00:00:00.000Z",
      };
    const mine = await actor.query(exportFn, { cursor });
    expect(mine.table.rows).toHaveLength(1);
    expect(mine.table.rows[0]).toMatchObject({
      buyerEmail: "buyer@example.test",
      state: { currency: "GBP", totalMinor: 1000, quoteHash: payment.state.quoteHash },
    });
    expect(mine.table.rows[0]).not.toHaveProperty("buyerTokenHash");
    expect(mine.table.rows[0]).not.toHaveProperty("checkoutUrl");
    const otherId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "other-export@example.test" }),
    );
    const other = t.withIdentity({ subject: `${otherId}|session` });
    expect((await other.query(exportFn, { cursor })).table.rows).toEqual([]);
    await expect(
      t.mutation(makeFunctionReference<"mutation">("tenantDelete:authorizeTenantDeletion"), {
        tenantId: a.tenantId,
        userId: a.tenantId,
      }),
    ).rejects.toThrow("COMMERCE_RETENTION_POLICY_REQUIRED");
    expect(await t.run((ctx) => ctx.db.get(payment._id))).toMatchObject({
      buyerEmail: "buyer@example.test",
    });
  });

  test("ingesting Vault custody refuses sale/delivery; a released paid snapshot remains immutable and refund revokes access", async () => {
    const t = harness(),
      a = await setup(t),
      token = "b".repeat(64);
    const delivery = await t.run(async (ctx) => {
      const sourceBytes = new TextEncoder().encode("Purchased guide bytes"),
        storageId = await ctx.storage.store(new Blob([sourceBytes], { type: "application/pdf" }));
      const documentId = await ctx.db.insert("vaultDocuments", {
        tenantId: a.tenantId,
        title: "Released guide",
        kind: "upload",
        category: "general",
        source: "upload",
        mimeType: "application/pdf",
        storageId,
        contentHash: "guide-source-v1",
        size: sourceBytes.length,
        status: "ready",
        createdAt: Date.now(),
      });
      const product = await createProductForTenant(ctx, a.tenantId, {
        sku: "guide",
        variant: "download",
        currency: "GBP",
        priceMinor: 700,
        status: "active",
        goodsKind: "digital",
        stock: { kind: "untracked", approved: true },
      });
      const folderId = await ctx.db.insert("vaultFolders", {
        tenantId: a.tenantId,
        name: "Sale source ingest",
        source: "upload",
        status: "ingesting",
        memberCount: 1,
        terminalCount: 0,
        failedCount: 0,
        reservedCents: 0,
        spentCents: 0,
        createdAt: Date.now(),
      });
      await ctx.db.patch(documentId, { folderId });
      await expect(
        bindDigitalDeliveryForTenant(ctx, a.tenantId, {
          productId: product.productId,
          expectedRevision: 1,
          documentId,
          releaseForSaleConsent: true,
        }),
      ).rejects.toThrow("MERCHANT_DIGITAL_SOURCE_UNAVAILABLE");
      await ctx.db.patch(folderId, { status: "complete", terminalCount: 1 });
      await bindDigitalDeliveryForTenant(ctx, a.tenantId, {
        productId: product.productId,
        expectedRevision: 1,
        documentId,
        releaseForSaleConsent: true,
      });
      await configurePolicyForTenant(ctx, a.tenantId, {
        projectId: a.projectId,
        expectedRevision: 1,
        sellerOfRecordRef: "merchant-confirmed",
        currency: "GBP",
        countries: ["TZ"],
        taxRounding: "half_up",
        digital: {
          taxSourceRef: "tax-confirmed",
          taxBasisPoints: 0,
          deliveryRef: "guide-delivery",
          revocationRef: "refund-revocation",
          noShipping: true,
          refundPolicyRef: "refund-confirmed",
          buyerRetentionRef: "retention-confirmed",
        },
      });
      await mapProductForTenant(ctx, a.tenantId, {
        projectId: a.projectId,
        presentationItemId: "guide",
        productId: product.productId,
        expectedRevision: 0,
      });
      await configureAutomationForTenant(ctx, a.tenantId, {
        projectId: a.projectId,
        expectedRevision: 1,
        autoDigitalDelivery: true,
        digitalValidityDays: 7,
        buyerRetentionDays: 7,
        policyRef: "native-approved-digital-delivery",
      });
      const cart = await createCartForTenant(ctx, a.tenantId, {
        projectId: a.projectId,
        addressCountry: "TZ",
        lines: [
          {
            presentationItemId: "guide",
            productId: product.productId,
            quantity: 1,
            expectedProductRevision: 2,
            expectedUnitMinor: 700,
          },
        ],
      });
      const order = await placeOrderForTenant(ctx, a.tenantId, {
        cartId: cart.cartId,
        expectedCartRevision: 1,
        retryKey: "digital-native-proof",
      });
      return { orderId: order.orderId!, documentId, storageId, folderId };
    });
    const payment = await t.mutation(mutation("prepareCheckout"), {
      tenantId: a.tenantId,
      orderId: delivery.orderId,
      provider: "stripe",
    });
    await t.mutation(mutation("updateCheckout"), {
      tenantId: a.tenantId,
      paymentId: payment._id,
      buyerTokenHash: sha256Bytes(new TextEncoder().encode(token)),
    });
    await t.mutation(mutation("applyPayment"), {
      tenantId: a.tenantId,
      paymentId: payment._id,
      receipt: {
        ...payment.state,
        amountMinor: 700,
        eventRef: "stripe:evt_digital",
        paymentRef: "pi_digital",
        outcome: "succeeded",
        verification: {
          method: "provider_read",
          evidenceRef: "actual-offline-provider-adapter-fixture",
        },
      },
    });
    await t.mutation(makeFunctionReference<"mutation">("merchantOperations:afterPayment"), {
      tenantId: a.tenantId,
      paymentId: payment._id,
    });
    const grant = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("tenantMerchantOperations")
          .withIndex("by_tenant_order", (q) =>
            q.eq("tenantId", a.tenantId).eq("orderId", delivery.orderId),
          )
          .collect()
      ).find((row) => row.kind === "digital_entitlement"),
    );
    expect(grant).toBeDefined();
    await t.run((ctx) =>
      ctx.db.patch(delivery.folderId, { status: "ingesting", terminalCount: 0 }),
    );
    await expect(
      t.action(makeFunctionReference<"action">("merchantOperations:deliverDigital"), {
        tenantId: a.tenantId,
        operationId: grant!._id,
      }),
    ).rejects.toThrow("MERCHANT_DIGITAL_SOURCE_UNAVAILABLE");
    await t.run((ctx) => ctx.db.patch(delivery.folderId, { status: "complete", terminalCount: 1 }));
    await t.action(makeFunctionReference<"action">("merchantOperations:deliverDigital"), {
      tenantId: a.tenantId,
      operationId: grant!._id,
    });
    const download = makeFunctionReference<"query">("merchantHttp:download"),
      args = { operationId: grant!._id, access: token };
    const available = await t.query(download, args);
    expect(available.storageId).not.toBe(delivery.storageId);
    await t.run((ctx) => ctx.db.patch(delivery.documentId, { contentHash: "changed-original" }));
    const downloadedText = await t.run(async (ctx) =>
      (await ctx.storage.get(available.storageId))!.text(),
    );
    expect(downloadedText).toBe("Purchased guide bytes");
    await expect(t.query(download, { ...args, access: "c".repeat(64) })).rejects.toThrow(
      "UNAVAILABLE",
    );
    const current = await t.run((ctx) => {
      const paymentId = ctx.db.normalizeId("tenantMerchantPayments", payment._id);
      if (!paymentId) throw Error("INVALID_NATIVE_PAYMENT_ID");
      return ctx.db.get(paymentId);
    });
    const prepared = await t.mutation(
      makeFunctionReference<"mutation">("merchantOperations:prepareRefund"),
      {
        tenantId: a.tenantId,
        paymentId: payment._id,
        expectedRevision: current!.revision,
        amountMinor: 700,
        requestKey: "native-refund-key",
      },
    );
    await t.mutation(makeFunctionReference<"mutation">("merchantOperations:applyRefund"), {
      tenantId: a.tenantId,
      operationId: prepared.operation._id,
      receipt: {
        ...prepared.operation.state,
        providerRefundRef: "re_digital",
        eventRef: "refund:evt_digital",
        outcome: "succeeded",
        verification: { method: "provider_read", evidenceRef: "exact-test-refund" },
      },
    });
    await expect(t.query(download, args)).rejects.toThrow("UNAVAILABLE");
    expect((await t.run((ctx) => ctx.db.get(grant!._id)))!.state.status).toBe("revoked");
  });
  test("positive exact-account provider receipt consumes once, earns Stripe-only readiness; PayPal remains deferred", async () => {
    const t = harness(),
      a = await setup(t),
      actor = t.withIdentity({ subject: `${a.userId}|session` });
    expect((await actor.query(status, { projectId: a.projectId })).publicCheckoutReady).toBe(false);
    const payment = await t.mutation(mutation("prepareCheckout"), {
      tenantId: a.tenantId,
      orderId: a.orderId,
      provider: "stripe",
    });
    const receipt = {
      ...payment.state,
      amountMinor: 1000,
      eventRef: "stripe:evt_fixture",
      paymentRef: "pi_fixture",
      outcome: "succeeded",
      verification: { method: "provider_read", evidenceRef: "stripe-session:cs_test_fixture" },
    };
    await t.mutation(mutation("applyPayment"), {
      tenantId: a.tenantId,
      paymentId: payment._id,
      receipt,
    });
    expect(
      await t.mutation(mutation("applyPayment"), {
        tenantId: a.tenantId,
        paymentId: payment._id,
        receipt,
      }),
    ).toMatchObject({ duplicate: true, status: "paid" });
    const stock = await t.run((ctx) =>
      ctx.db
        .query("tenantStock")
        .withIndex("by_tenant_product", (q) =>
          q.eq("tenantId", a.tenantId).eq("productId", a.productId),
        )
        .unique(),
    );
    expect(stock).toMatchObject({ onHand: 1, reserved: 0 });
    const ready = await actor.query(status, { projectId: a.projectId });
    expect(ready.publicCheckoutReady).toBe(true);
    expect(
      ready.providers.find((p: { provider: string }) => p.provider === "paypal").blockers.length,
    ).toBeGreaterThan(0);
    await t.run((ctx) => ctx.db.patch(a.productId, { priceMinor: 1400, revision: 2 }));
    expect((await actor.query(status, { projectId: a.projectId })).blockers).toContain(
      "exact_native_shop_setup_review_required",
    );
    await t.run((ctx) => ctx.db.patch(a.productId, { priceMinor: 1000, revision: 1 }));
    vi.stubEnv("CONVEX_SITE_URL", "https://native.test");
    await t.run(async (ctx) => {
      const version = await ctx.db
        .query("webProjectVersions")
        .withIndex("by_tenant_project_version", (q) =>
          q.eq("tenantId", a.tenantId).eq("projectId", a.projectId).eq("version", 1),
        )
        .unique();
      await ctx.db.patch(version!._id, {
        artifacts: [{ pageSlug: "catalogue", html: "<html></html>", byteLength: 13 }],
      });
      await ctx.db.patch(a.projectId, {
        publishedVersion: 1,
        publishedContentHash: version!.contentHash,
      });
    });
    const preparePublic = makeFunctionReference<"mutation">("merchantHttp:preparePublicCheckout"),
      selection = {
        host: "native.test",
        slug: "native-shop",
        buyerToken: "d".repeat(64),
        provider: "stripe",
        country: "TZ",
        selection: [{ id: "item-one", quantity: 1, revision: 1, unitMinor: 1000 }],
      };
    const first = await t.mutation(preparePublic, selection),
      repeated = await t.mutation(preparePublic, selection);
    expect(repeated.orderId).toBe(first.orderId);
    await expect(
      t.mutation(preparePublic, {
        ...selection,
        buyerToken: "e".repeat(64),
        selection: [{ id: "item-one", quantity: 1, revision: 1, unitMinor: 1 }],
      }),
    ).rejects.toThrow();
    await t.run((ctx) => ctx.db.patch(a.accountId, { providerAccountId: "acct_rebound" }));
    expect((await actor.query(status, { projectId: a.projectId })).publicCheckoutReady).toBe(false);
  });
  test("foreign tenant, foreign account and wrong amount receipts cannot touch stock or certify payment", async () => {
    const t = harness(),
      a = await setup(t);
    await expect(
      t.run((ctx) =>
        createCartForTenant(ctx, a.tenantId, {
          projectId: a.projectId,
          addressCountry: "TZ",
          lines: [
            {
              presentationItemId: "item-one",
              productId: "not-a-product-id",
              quantity: 1,
              expectedProductRevision: 1,
              expectedUnitMinor: 1000,
            },
          ],
        }),
      ),
    ).rejects.toThrow("INVALID_CART_PRODUCT_ID");
    const payment = await t.mutation(mutation("prepareCheckout"), {
      tenantId: a.tenantId,
      orderId: a.orderId,
      provider: "stripe",
    });
    const receipt = {
      ...payment.state,
      amountMinor: 1000,
      eventRef: "stripe:evt_attack",
      paymentRef: "pi_attack",
      outcome: "succeeded",
      verification: { method: "provider_read", evidenceRef: "trusted-test-read" },
    };
    await expect(
      t.mutation(mutation("applyPayment"), {
        tenantId: "foreign",
        paymentId: payment._id,
        receipt,
      }),
    ).rejects.toThrow("UNAVAILABLE");
    await expect(
      t.mutation(mutation("applyPayment"), {
        tenantId: a.tenantId,
        paymentId: payment._id,
        receipt: { ...receipt, providerAccountRef: "acct_other" },
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(mutation("applyPayment"), {
        tenantId: a.tenantId,
        paymentId: payment._id,
        receipt: { ...receipt, amountMinor: 1 },
      }),
    ).rejects.toThrow();
    const stock = await t.run((ctx) =>
      ctx.db
        .query("tenantStock")
        .withIndex("by_tenant_product", (q) =>
          q.eq("tenantId", a.tenantId).eq("productId", a.productId),
        )
        .unique(),
    );
    expect(stock).toMatchObject({ onHand: 2, reserved: 1 });
  });
  test("expired payment is actual merchant review and neither oversells nor silently fulfils", async () => {
    vi.useFakeTimers();
    const t = harness(),
      a = await setup(t);
    const payment = await t.mutation(mutation("prepareCheckout"), {
      tenantId: a.tenantId,
      orderId: a.orderId,
      provider: "stripe",
    });
    vi.setSystemTime(Date.now() + 61000);
    await t.mutation(mutation("applyPayment"), {
      tenantId: a.tenantId,
      paymentId: payment._id,
      receipt: {
        ...payment.state,
        amountMinor: 1000,
        eventRef: "stripe:evt_late",
        paymentRef: "pi_late",
        outcome: "succeeded",
        verification: { method: "provider_read", evidenceRef: "late-provider-read" },
      },
    });
    expect((await t.run((ctx) => ctx.db.get(a.orderId)))?.status).toBe("paid_needs_review");
    const stock = await t.run((ctx) =>
      ctx.db
        .query("tenantStock")
        .withIndex("by_tenant_product", (q) =>
          q.eq("tenantId", a.tenantId).eq("productId", a.productId),
        )
        .unique(),
    );
    expect(stock).toMatchObject({ onHand: 2, reserved: 0 });
  });
  test("an old owner setup does not approve a changed catalogue or policy currency", async () => {
    const t = harness(),
      a = await setup(t),
      actor = t.withIdentity({ subject: `${a.userId}|session` });
    await t.run(async (ctx) => {
      const version = await ctx.db
        .query("webProjectVersions")
        .withIndex("by_tenant_project_version", (q) =>
          q.eq("tenantId", a.tenantId).eq("projectId", a.projectId).eq("version", 1),
        )
        .unique();
      await ctx.db.insert("webProjectVersions", {
        ...Object.fromEntries(Object.entries(version!).filter(([key]) => !key.startsWith("_"))),
        version: 2,
        contentHash: "sha256:" + "3".repeat(64),
      } as never);
      await ctx.db.patch(a.projectId, { draftVersion: 2 });
      await ctx.db.patch(a.productId, { currency: "USD" });
    });
    const next = await actor.query(status, { projectId: a.projectId, version: 2 });
    expect(next.blockers).toContain("exact_native_shop_setup_review_required");
    expect(next.blockers).toContain("product_policy_currency_mismatch");
  });
  test("a private Flutterwave hosted checkout settles once from the bound provider read", async () => {
    const t = harness();
    const shop = await setup(t, "flutterwave");
    const owner = t.withIdentity({ subject: `${shop.userId}|session` });
    vi.stubEnv("CONVEX_SITE_URL", "https://some.convex.site");
    let reference = "";
    let actualAmount = 9;
    let actualStatus = "pending";
    const link = "https://checkout.flutterwave.com/v3/hosted/pay/test_example";
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v3/balances/TZS")
        return Response.json({ status: "success", data: { currency: "TZS" } });
      if (path === "/v3/payments") {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          amount: 10,
          currency: "TZS",
          customer: { email: "buyer@example.test" },
        });
        reference = body.tx_ref;
        return Response.json({ status: "success", data: { link } });
      }
      if (path !== "/v3/transactions/42/verify") throw Error("Unexpected provider call");
      return Response.json({
        status: "success",
        data: {
          id: 42,
          account_id: 12345,
          tx_ref: reference,
          status: actualStatus,
          amount: actualAmount,
          currency: "TZS",
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const checkout = await owner.action(
      makeFunctionReference<"action">("merchantProvider:checkout"),
      {
        orderId: shop.orderId,
        provider: "flutterwave",
        buyerEmail: "buyer@example.test",
      },
    );
    expect(checkout).toMatchObject({ ok: true, url: link });
    expect(reference).toMatch(/^pikar-flw-[a-f0-9]{64}$/);
    // Publication closes private checkout link reuse. An already-issued payment must still settle.
    await t.run((ctx) => ctx.db.patch(shop.projectId, { publishedVersion: 1 }));
    expect(
      await owner.action(makeFunctionReference<"action">("merchantProvider:checkout"), {
        orderId: shop.orderId,
        provider: "flutterwave",
        buyerEmail: "buyer@example.test",
      }),
    ).toEqual({ ok: false, reason: "merchant_provider_unavailable" });
    const notify = () =>
      t.fetch("/merchant/flutterwave/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "verif-hash": "flutterwave-test-webhook-secret",
        },
        // The callback claims payment even when the provider read disagrees.
        body: JSON.stringify({
          event: "charge.completed",
          data: {
            id: 42,
            account_id: 12345,
            tx_ref: reference,
            amount: 10,
            currency: "TZS",
            status: "successful",
          },
        }),
      });
    const readState = () =>
      t.run(async (ctx) => {
        const payment = await ctx.db.query("tenantMerchantPayments").unique();
        const stock = await ctx.db.query("tenantStock").unique();
        const events = await ctx.db.query("tenantMerchantEvents").collect();
        return { status: payment?.state.status, onHand: stock?.onHand, events: events.length };
      });
    expect((await notify()).status).toBe(503);
    expect(await readState()).toEqual({ status: "pending", onHand: 2, events: 0 });
    actualAmount = 10;
    expect((await notify()).status).toBe(200);
    expect(await readState()).toEqual({ status: "pending", onHand: 2, events: 1 });
    actualStatus = "successful";
    expect((await notify()).status).toBe(200);
    expect((await notify()).status).toBe(200);
    expect(await readState()).toEqual({ status: "paid", onHand: 1, events: 2 });
    expect(await owner.query(status, { projectId: shop.projectId })).toMatchObject({
      publicCheckoutReady: false,
      privateFlutterwavePilot: null,
    });
  });
});
