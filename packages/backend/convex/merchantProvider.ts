import type { MerchantCheckoutAttempt, MerchantProvider } from "@pikar/contracts/tenantCommerce";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";
import { tenantAction } from "./lib/functions";
import { internalAction } from "./lib/tenantLifecycle";
import {
  makeMerchantCapability,
  merchantClient,
  missingMerchantConfiguration,
  paypalCapability,
  paypalPaymentReceipt,
  safeMerchantUrl,
  stripeCapability,
  stripePaymentReceipt,
  wire,
} from "./lib/merchantProviderClient";

const provider = v.union(v.literal("stripe"), v.literal("paypal"));
type Context = {
  project: Doc<"webProjects">;
  account: Doc<"tenantMerchantAccounts"> | null;
  email?: string;
  policy: Doc<"tenantCommercePolicies"> | null;
};
const queryRef = (name: string) => makeFunctionReference<"query">(`merchantCommerce:${name}`);
const mutationRef = (name: string) => makeFunctionReference<"mutation">(`merchantCommerce:${name}`);
const hash = (value: string) => sha256Bytes(new TextEncoder().encode(value));
function siteOrigin() {
  const url = new URL(process.env.SITE_URL ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/")
    throw Error("MERCHANT_SITE_URL_REQUIRED");
  return url.origin;
}
const safeFailure = (error: unknown) =>
  error instanceof Error && /^MERCHANT_[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : "MERCHANT_PROVIDER_OUTCOME_UNKNOWN";
export async function refreshMerchantForTenant(
  ctx: ActionCtx,
  tenantId: string,
  projectId: Id<"webProjects">,
  name: MerchantProvider,
) {
  const context = (await ctx.runQuery(queryRef("accountContext"), {
    tenantId,
    projectId,
    provider: name,
  })) as Context;
  const account = context.account;
  if (!account) return { ok: false, ready: false, reason: "merchant_onboarding_required" };
  const missingKeyNames = missingMerchantConfiguration(name);
  if (missingKeyNames.length)
    return { ok: false, ready: false, reason: "provider_configuration_required", missingKeyNames };
  try {
    const client = merchantClient(name);
    let identity: { providerAccountId: string; sellerCountry: string; currency: string };
    if (name === "stripe") {
      if (!account.providerAccountId)
        return { ok: false, ready: false, reason: "merchant_onboarding_required" };
      const value = await client.stripe(
        `/v2/core/accounts/${encodeURIComponent(account.providerAccountId)}?include[]=configuration.merchant&include[]=defaults&include[]=identity`,
      );
      identity = {
        providerAccountId: account.providerAccountId,
        ...stripeCapability(value, account.providerAccountId),
      };
    } else {
      let seller = account.providerAccountId;
      const base = `/v1/customer/partners/${encodeURIComponent(process.env.MERCHANT_PAYPAL_PARTNER_MERCHANT_ID!)}/merchant-integrations`;
      if (!seller) {
        const listing = await client.paypal(
          `${base}?tracking_id=${encodeURIComponent(account.trackingId)}`,
        );
        const matches = Array.isArray(listing.merchant_integrations)
          ? listing.merchant_integrations
              .map(wire)
              .filter((row) => row.tracking_id === account.trackingId)
          : listing.tracking_id === account.trackingId
            ? [listing]
            : [];
        if (matches.length !== 1 || typeof matches[0]!.merchant_id !== "string")
          return { ok: false, ready: false, reason: "merchant_onboarding_incomplete" };
        seller = matches[0]!.merchant_id as string;
      }
      identity = paypalCapability(
        await client.paypal(`${base}/${encodeURIComponent(seller)}`),
        account.trackingId,
      );
    }
    if (
      (account.sellerCountry && account.sellerCountry !== identity.sellerCountry) ||
      (account.currency && account.currency !== identity.currency)
    )
      throw Error("MERCHANT_ACCOUNT_COUNTRY_CURRENCY_MISMATCH");
    // Initial test scope is domestic and exact settlement currency. Shipping-policy geography
    // is not evidence that a provider permits every international country/currency combination.
    const capability = makeMerchantCapability({
      tenantId,
      accountId: account._id,
      provider: name,
      ...identity,
      buyerCountries: context.policy?.countries.includes(identity.sellerCountry)
        ? [identity.sellerCountry]
        : [],
      now: Date.now(),
    });
    await ctx.runMutation(mutationRef("updateAccount"), {
      tenantId,
      accountId: account._id,
      expectedRevision: account.revision,
      providerAccountId: identity.providerAccountId,
      capability,
    });
    return { ok: true, ready: true };
  } catch (error) {
    const reason = safeFailure(error);
    await ctx.runMutation(mutationRef("updateAccount"), {
      tenantId,
      accountId: account._id,
      expectedRevision: account.revision,
      failure: reason,
    });
    return { ok: false, ready: false, reason };
  }
}
export const refresh = tenantAction({
  args: { projectId: v.id("webProjects"), provider },
  handler: (ctx, args) =>
    refreshMerchantForTenant(ctx, ctx.tenantId, args.projectId, args.provider),
});
export const connect = tenantAction({
  args: {
    projectId: v.id("webProjects"),
    provider,
    sellerCountry: v.optional(v.string()),
    currency: v.optional(v.string()),
    shareDataConsent: v.literal(true),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; url?: string; reason?: string; missingKeyNames?: string[] }> => {
    const context = (await ctx.runQuery(queryRef("accountContext"), {
      tenantId: ctx.tenantId,
      projectId: args.projectId,
      provider: args.provider,
    })) as Context;
    const missingKeyNames = missingMerchantConfiguration(args.provider);
    if (missingKeyNames.length)
      return { ok: false, reason: "provider_configuration_required", missingKeyNames };
    const account = (await ctx.runMutation(mutationRef("beginAccount"), {
      tenantId: ctx.tenantId,
      projectId: args.projectId,
      provider: args.provider,
      ...(args.sellerCountry ? { sellerCountry: args.sellerCountry } : {}),
      ...(args.currency ? { currency: args.currency } : {}),
    })) as Doc<"tenantMerchantAccounts">;
    try {
      const client = merchantClient(args.provider),
        origin = siteOrigin();
      const returnUrl = `${origin}/dashboard/sites?project=${encodeURIComponent(args.projectId)}&merchant=return`;
      let url: string;
      if (args.provider === "stripe") {
        let id = account.providerAccountId;
        if (!id) {
          const created = await client.stripe(
            "/v2/core/accounts",
            "POST",
            {
              display_name: context.project.title,
              ...(context.email ? { contact_email: context.email } : {}),
              ...(args.sellerCountry
                ? { identity: { country: args.sellerCountry.toLowerCase() } }
                : {}),
              configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
              defaults: {
                responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
              },
              dashboard: "full",
              include: ["configuration.merchant", "identity", "defaults"],
            },
            undefined,
            `merchant-onboard:${account.trackingId}`,
          );
          if (
            created.livemode !== false ||
            typeof created.id !== "string" ||
            !/^acct_[A-Za-z0-9]+$/.test(created.id)
          )
            throw Error("MERCHANT_TEST_ACCOUNT_REQUIRED");
          id = created.id;
          await ctx.runMutation(mutationRef("updateAccount"), {
            tenantId: ctx.tenantId,
            accountId: account._id,
            expectedRevision: account.revision,
            providerAccountId: id,
          });
        }
        const linked = await client.stripe("/v2/core/account_links", "POST", {
          account: id,
          use_case: {
            type: "account_onboarding",
            account_onboarding: {
              configurations: ["merchant"],
              refresh_url: returnUrl,
              return_url: returnUrl,
            },
          },
        });
        if (linked.livemode !== false || linked.account !== id)
          throw Error("MERCHANT_TEST_ACCOUNT_REQUIRED");
        url = safeMerchantUrl(linked.url, "stripe");
      } else {
        const referral = await client.paypal(
          "/v2/customer/partner-referrals",
          "POST",
          {
            tracking_id: account.trackingId,
            operations: [
              {
                operation: "API_INTEGRATION",
                api_integration_preference: {
                  rest_api_integration: {
                    integration_method: "PAYPAL",
                    integration_type: "THIRD_PARTY",
                    third_party_details: { features: ["PAYMENT", "REFUND"] },
                  },
                },
              },
            ],
            products: ["EXPRESS_CHECKOUT"],
            legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: args.shareDataConsent }],
            partner_config_override: { return_url: returnUrl },
          },
          undefined,
          `onboard-${account.trackingId}`.slice(-38),
        );
        const links = Array.isArray(referral.links) ? referral.links.map(wire) : [];
        url = safeMerchantUrl(links.find((link) => link.rel === "action_url")?.href, "paypal");
      }
      const current = (await ctx.runQuery(queryRef("accountContext"), {
        tenantId: ctx.tenantId,
        projectId: args.projectId,
        provider: args.provider,
      })) as Context;
      await ctx.runMutation(mutationRef("updateAccount"), {
        tenantId: ctx.tenantId,
        accountId: account._id,
        expectedRevision: current.account!.revision,
        onboardingUrl: url,
      });
      return { ok: true, url };
    } catch (error) {
      const current = (await ctx.runQuery(queryRef("accountContext"), {
        tenantId: ctx.tenantId,
        projectId: args.projectId,
        provider: args.provider,
      })) as Context;
      const reason = safeFailure(error);
      await ctx.runMutation(mutationRef("updateAccount"), {
        tenantId: ctx.tenantId,
        accountId: account._id,
        expectedRevision: current.account!.revision,
        failure: reason,
      });
      return { ok: false, reason };
    }
  },
});
export async function startMerchantCheckout(
  ctx: ActionCtx,
  tenantId: string,
  orderId: Id<"tenantOrders">,
  name: MerchantProvider,
) {
  let context = (await ctx.runQuery(queryRef("checkoutContext"), {
    tenantId,
    orderId,
    provider: name,
  })) as {
    order: Doc<"tenantOrders">;
    account: Doc<"tenantMerchantAccounts"> | null;
    payment: Doc<"tenantMerchantPayments"> | null;
  };
  if (context.payment) {
    if (
      context.payment.provider !== name ||
      !context.payment.checkoutUrl ||
      context.payment.state.status === "unknown"
    )
      return { ok: false, reason: "merchant_payment_requires_reconciliation" };
    return { ok: true, paymentId: context.payment._id, url: context.payment.checkoutUrl };
  }
  const refreshed = await refreshMerchantForTenant(ctx, tenantId, context.order.projectId, name);
  if (!refreshed.ok) return refreshed;
  const payment = (await ctx.runMutation(mutationRef("prepareCheckout"), {
    tenantId,
    orderId,
    provider: name,
  })) as Doc<"tenantMerchantPayments">;
  const state = payment.state as MerchantCheckoutAttempt,
    client = merchantClient(name);
  try {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    await ctx.runMutation(mutationRef("updateCheckout"), {
      tenantId,
      paymentId: payment._id,
      buyerTokenHash: hash(token),
    });
    const site = new URL(process.env.CONVEX_SITE_URL ?? "");
    if (site.protocol !== "https:" || site.username || site.password || site.pathname !== "/")
      throw Error("MERCHANT_PUBLIC_HOST_REQUIRED");
    const returnUrl = `${site.origin}/merchant/order/${payment._id}?access=${token}`;
    let providerOrderId: string, url: string;
    if (name === "stripe") {
      const body = new URLSearchParams({
        mode: "payment",
        client_reference_id: orderId,
        "line_items[0][price_data][currency]": state.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(state.totalMinor),
        "line_items[0][price_data][product_data][name]": "Merchant order",
        "line_items[0][quantity]": "1",
        success_url: returnUrl,
        cancel_url: returnUrl,
      });
      if (context.order.snapshot.lines.some((line) => line.goodsKind === "physical"))
        body.set(
          "shipping_address_collection[allowed_countries][0]",
          context.order.snapshot.country,
        );
      for (const [key, value] of Object.entries({
        orderId,
        attemptId: state.attemptId,
        quoteHash: state.quoteHash,
      })) {
        body.set(`metadata[${key}]`, value);
        body.set(`payment_intent_data[metadata][${key}]`, value);
      }
      const created = await client.stripe(
        "/v1/checkout/sessions",
        "POST",
        body,
        state.providerAccountRef,
        state.idempotencyKey,
      );
      if (
        created.livemode !== false ||
        typeof created.id !== "string" ||
        !created.id.startsWith("cs_test_")
      )
        throw Error("MERCHANT_TEST_PAYMENT_REQUIRED");
      providerOrderId = created.id;
      url = safeMerchantUrl(created.url, "stripe");
    } else {
      const created = await client.paypal(
        "/v2/checkout/orders",
        "POST",
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: orderId,
              custom_id: state.attemptId,
              invoice_id: state.quoteHash,
              payee: { merchant_id: state.providerAccountRef },
              amount: { currency_code: state.currency, value: (state.totalMinor / 100).toFixed(2) },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                return_url: returnUrl,
                cancel_url: returnUrl,
                user_action: "PAY_NOW",
                shipping_preference: context.order.snapshot.lines.some(
                  (line) => line.goodsKind === "physical",
                )
                  ? "GET_FROM_FILE"
                  : "NO_SHIPPING",
              },
            },
          },
        },
        state.providerAccountRef,
        state.idempotencyKey.slice(-38),
      );
      if (typeof created.id !== "string" || !/^[A-Z0-9-]{8,64}$/.test(created.id))
        throw Error("MERCHANT_PROVIDER_RESPONSE_INVALID");
      providerOrderId = created.id;
      const links = Array.isArray(created.links) ? created.links.map(wire) : [];
      url = safeMerchantUrl(
        links.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href,
        "paypal",
      );
    }
    await ctx.runMutation(mutationRef("updateCheckout"), {
      tenantId,
      paymentId: payment._id,
      providerOrderId,
      checkoutUrl: url,
    });
    return { ok: true, paymentId: payment._id, url };
  } catch (error) {
    await ctx.runMutation(mutationRef("updateCheckout"), {
      tenantId,
      paymentId: payment._id,
      unknown: true,
    });
    return { ok: false, reason: safeFailure(error) };
  }
}
export const checkout = tenantAction({
  args: { orderId: v.id("tenantOrders"), provider },
  handler: (ctx, args) => startMerchantCheckout(ctx, ctx.tenantId, args.orderId, args.provider),
});
export async function reconcileMerchantPayment(
  ctx: ActionCtx,
  payment: Doc<"tenantMerchantPayments">,
  eventRef: string,
  capture = false,
) {
  const state = payment.state as MerchantCheckoutAttempt;
  if (!payment.providerOrderId) throw Error("MERCHANT_PROVIDER_ORDER_REQUIRED");
  const client = merchantClient(payment.provider);
  let value: Record<string, unknown>;
  if (payment.provider === "stripe")
    value = await client.stripe(
      `/v1/checkout/sessions/${encodeURIComponent(payment.providerOrderId)}?expand[]=payment_intent`,
      "GET",
      undefined,
      state.providerAccountRef,
    );
  else {
    value = await client.paypal(
      `/v2/checkout/orders/${encodeURIComponent(payment.providerOrderId)}`,
      "GET",
      undefined,
      state.providerAccountRef,
    );
    if (capture && value.status === "APPROVED")
      value = await client.paypal(
        `/v2/checkout/orders/${encodeURIComponent(payment.providerOrderId)}/capture`,
        "POST",
        {},
        state.providerAccountRef,
        `capture-${payment._id}`.slice(-38),
      );
  }
  if (value.id !== payment.providerOrderId) throw Error("MERCHANT_PAYMENT_BINDING_MISMATCH");
  const receipt =
    payment.provider === "stripe"
      ? stripePaymentReceipt(value, state, eventRef)
      : paypalPaymentReceipt(value, state, eventRef);
  const orderContext = (await ctx.runQuery(queryRef("checkoutContext"), {
    tenantId: payment.tenantId,
    orderId: payment.orderId,
    provider: payment.provider,
  })) as { order: Doc<"tenantOrders"> };
  const personal =
    receipt.outcome === "succeeded"
      ? verifiedBuyerDetails(
          value,
          payment.provider,
          orderContext.order.snapshot.country,
          orderContext.order.snapshot.lines.some((line) => line.goodsKind === "physical"),
        )
      : {};
  return ctx.runMutation(mutationRef("applyPayment"), {
    tenantId: payment.tenantId,
    paymentId: payment._id,
    receipt,
    ...personal,
  });
}
export const reconcile = tenantAction({
  args: { paymentId: v.id("tenantMerchantPayments") },
  handler: async (ctx, args) => {
    const payment = (await ctx.runQuery(queryRef("paymentForTenant"), {
      tenantId: ctx.tenantId,
      paymentId: args.paymentId,
    })) as Doc<"tenantMerchantPayments">;
    return reconcileMerchantPayment(
      ctx,
      payment,
      `provider-read:${payment._id}:${payment.revision}`,
      true,
    );
  },
});
export const verifiedWebhook = internalAction({
  args: { tenantId: v.string(), paymentId: v.id("tenantMerchantPayments"), eventRef: v.string() },
  handler: async (ctx, args) => {
    const payment = (await ctx.runQuery(queryRef("paymentForTenant"), {
      tenantId: args.tenantId,
      paymentId: args.paymentId,
    })) as Doc<"tenantMerchantPayments">;
    return reconcileMerchantPayment(ctx, payment, args.eventRef);
  },
});

/** Closed private order projection, obtained only from the exact-account provider read. */
export function verifiedBuyerDetails(
  value: Record<string, unknown>,
  provider: MerchantProvider,
  country: string,
  physical: boolean,
) {
  const payer = wire(value.payer),
    details = wire(value.customer_details),
    unit = Array.isArray(value.purchase_units) ? wire(value.purchase_units[0]) : {};
  const shipping =
      provider === "stripe"
        ? wire(wire(value.collected_information).shipping_details ?? value.shipping_details)
        : wire(unit.shipping),
    address = wire(shipping.address);
  const email = provider === "stripe" ? details.email : payer.email_address;
  const result: {
    buyerEmail?: string;
    buyerAddress?: {
      name: string;
      line1: string;
      line2?: string;
      city: string;
      region?: string;
      postalCode: string;
      country: string;
    };
    deliveryReviewReason?: "buyer_address_missing" | "buyer_country_mismatch";
  } = {};
  if (typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    result.buyerEmail = email;
  if (!physical) return result;
  const text = (x: unknown) =>
    typeof x === "string" && x.trim().length > 0 && x.length <= 200 && !/[\u0000-\u001f]/.test(x)
      ? x
      : undefined;
  const name = text(provider === "stripe" ? shipping.name : wire(shipping.name).full_name),
    line1 = text(address.line1 ?? address.address_line_1),
    line2 = text(address.line2 ?? address.address_line_2),
    city = text(address.city ?? address.admin_area_2),
    region = text(address.state ?? address.admin_area_1),
    postalCode = text(address.postal_code),
    actualCountry = text(address.country ?? address.country_code);
  if (!name || !line1 || !city || !postalCode || !actualCountry) {
    result.deliveryReviewReason = "buyer_address_missing";
    return result;
  }
  if (actualCountry !== country) {
    result.deliveryReviewReason = "buyer_country_mismatch";
    return result;
  }
  result.buyerAddress = {
    name,
    line1,
    city,
    postalCode,
    country: actualCountry,
    ...(line2 ? { line2 } : {}),
    ...(region ? { region } : {}),
  };
  return result;
}

/** Bounded read-only provider maintenance. No checkout, capture, refund or onboarding creation. */
export const maintenanceCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows: Doc<"tenantMerchantAccounts">[] = [];
    for (const provider of ["stripe", "paypal"] as const) {
      if (missingMerchantConfiguration(provider).length) continue;
      for (const status of ["ready", "unavailable", "connecting"] as const) {
        rows.push(
          ...(await ctx.db
            .query("tenantMerchantAccounts")
            .withIndex("by_status_provider_updated", (q) =>
              q
                .eq("status", status)
                .eq("provider", provider)
                .lt("updatedAt", Date.now() - 10 * 60000),
            )
            .take(3)),
        );
      }
    }
    const result = [];
    for (const account of rows) {
      const lifecycle = await ctx.db
        .query("authRevocations")
        .withIndex("by_userId", (q) => q.eq("userId", account.tenantId))
        .unique();
      if (
        !lifecycle?.state &&
        account.status !== "revoked" &&
        (account.provider === "paypal" || account.providerAccountId) &&
        missingMerchantConfiguration(account.provider).length === 0
      )
        result.push({
          tenantId: account.tenantId,
          projectId: account.projectId,
          provider: account.provider,
        });
    }
    return result;
  },
});
export const maintainCapabilities = internalAction({
  args: {},
  handler: async (ctx) => {
    const accounts = (await ctx.runQuery(
      makeFunctionReference<"query">("merchantProvider:maintenanceCandidates"),
      {},
    )) as { tenantId: string; projectId: Id<"webProjects">; provider: MerchantProvider }[];
    for (const account of accounts) {
      try {
        await refreshMerchantForTenant(ctx, account.tenantId, account.projectId, account.provider);
      } catch {
        /* Refuse stale/erased ownership; never retry a money write here. */
      }
    }
  },
});
