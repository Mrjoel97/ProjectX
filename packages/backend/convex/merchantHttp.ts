import type { WebCatalogueItem, WebDocument, WebNode } from "@pikar/contracts/webRuntime";
import type { MerchantProvider } from "@pikar/contracts/tenantCommerce";
import {
  renderMerchantCart,
  renderMerchantCommerceLink,
  renderMerchantOrderStatus,
  type MerchantCartView,
  type MerchantOrderStatusView,
} from "@pikar/core/merchantBuyer";
import { digitalEntitlementAccessible } from "@pikar/core/tenantMerchant";
import { parseWebAssetRef } from "@pikar/core/webAssets";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { makeFunctionReference, type HttpRouter } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  httpAction,
  internalQuery,
  type ActionCtx,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { verifyStripeSignature } from "./billingWebhook";
import { internalMutation } from "./lib/tenantLifecycle";
import { merchantClient, missingMerchantConfiguration, wire } from "./lib/merchantProviderClient";
import { merchantReadiness } from "./merchantCommerce";
import { reconcileMerchantPayment, startMerchantCheckout } from "./merchantProvider";
import { createCartForTenant, placeOrderForTenant } from "./tenantOrders";

export const MERCHANT_CHECKOUT_RUNTIME = "merchant-checkout-v1";
const qref = (name: string) => makeFunctionReference<"query">(`merchantHttp:${name}`);
const mref = (name: string) => makeFunctionReference<"mutation">(`merchantHttp:${name}`);
const digest = (value: string) => sha256Bytes(new TextEncoder().encode(value));
const tokenValid = (value: string) => /^[a-f0-9]{64}$/.test(value);
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
type Db = QueryCtx | MutationCtx;
function catalogue(document: WebDocument): WebCatalogueItem[] {
  const items: WebCatalogueItem[] = [];
  const visit = (nodes: readonly WebNode[]) => {
    for (const node of nodes) {
      if (node.kind === "catalogue") items.push(...node.items);
      if (node.kind === "section") visit(node.children);
    }
  };
  for (const page of document.pages) visit(page.nodes);
  if (
    !items.length ||
    items.length > 50 ||
    new Set(items.map((item) => item.id)).size !== items.length
  )
    throw Error("MERCHANT_CATALOGUE_INVALID");
  return items;
}
async function publicProject(ctx: Db, host: string, slug: string) {
  const resolved = (await ctx.runQuery(
    makeFunctionReference<"query">("webProjects:resolvePublished"),
    { host, slug },
  )) as { state: string; project?: Doc<"webProjects">; version?: Doc<"webProjectVersions"> };
  if (
    resolved.state !== "published" ||
    resolved.project?.kind !== "storefront" ||
    !resolved.version
  )
    throw Error("MERCHANT_SHOP_UNAVAILABLE");
  return { project: resolved.project, version: resolved.version };
}
async function shopContext(ctx: Db, host: string, slug: string) {
  const { project, version } = await publicProject(ctx, host, slug),
    readiness = await merchantReadiness(ctx, project.tenantId, project._id);
  if (!readiness.publicCheckoutReady) throw Error("MERCHANT_SHOP_UNAVAILABLE");
  const policy = await ctx.db
    .query("tenantCommercePolicies")
    .withIndex("by_tenant_project_revision", (q) =>
      q.eq("tenantId", project.tenantId).eq("projectId", project._id),
    )
    .order("desc")
    .first();
  if (!policy) throw Error("MERCHANT_POLICY_UNAVAILABLE");
  const items = [];
  for (const item of catalogue(version.document as WebDocument)) {
    const mapping = await ctx.db
      .query("tenantCommerceMappings")
      .withIndex("by_tenant_project_item", (q) =>
        q
          .eq("tenantId", project.tenantId)
          .eq("projectId", project._id)
          .eq("presentationItemId", item.id),
      )
      .unique();
    if (!mapping) throw Error("MERCHANT_PRODUCT_MAPPING_REQUIRED");
    const product = await ctx.db.get(mapping.productId);
    if (
      !product ||
      product.tenantId !== project.tenantId ||
      product.status !== "active" ||
      product.currency !== policy.currency ||
      !product.goodsKind
    )
      throw Error("MERCHANT_PRODUCT_UNAVAILABLE");
    const stock = await ctx.db
      .query("tenantStock")
      .withIndex("by_tenant_product", (q) =>
        q.eq("tenantId", project.tenantId).eq("productId", product._id),
      )
      .unique();
    if (!stock || (stock.kind === "untracked" && !stock.approvedUntracked))
      throw Error("MERCHANT_STOCK_POLICY_REQUIRED");
    const asset = item.imageStorageRef ? parseWebAssetRef(item.imageStorageRef) : null;
    items.push({
      ...item,
      productId: product._id,
      productRevision: product.revision,
      unitMinor: product.priceMinor,
      maxQuantity:
        stock.kind === "finite"
          ? Math.max(0, Math.min(100, (stock.onHand ?? 0) - (stock.reserved ?? 0)))
          : 100,
      ...(asset ? { imagePath: `/p/${slug}/assets/${asset.assetId}/${asset.digest}` } : {}),
    });
  }
  const providers = readiness.providers
    .filter((provider) => provider.blockers.length === 0)
    .map((provider) => provider.provider);
  const accounts = await ctx.db
    .query("tenantMerchantAccounts")
    .withIndex("by_tenant", (q) => q.eq("tenantId", project.tenantId))
    .take(101);
  if (accounts.length > 100) throw Error("MERCHANT_REVIEW_BOUND_EXCEEDED");
  const countries = policy.countries.filter((country) =>
    providers.some((provider) =>
      accounts.some(
        (account) =>
          account.projectId === project._id &&
          account.provider === provider &&
          account.capability?.buyerCountries.includes(country),
      ),
    ),
  );
  const view: MerchantCartView = {
    slug,
    title: (version.document as WebDocument).title,
    currency: policy.currency,
    items,
    countryOptions: countries,
    providers,
    homePage: (version.document as WebDocument).pages[0]!.slug,
  };
  return { project, version, view, items, policy };
}
export const publicShop = internalQuery({
  args: { host: v.string(), slug: v.string() },
  handler: (ctx, args) => shopContext(ctx, args.host, args.slug),
});

/** Code-owned shopping navigation is separate from the immutable renderer artifact. */
export async function decorateMerchantPage(
  ctx: ActionCtx,
  args: { projectId: string; version: number; slug: string; html: string },
) {
  const ready = (await ctx.runQuery(qref("decoration"), {
    projectId: args.projectId,
    version: args.version,
    slug: args.slug,
  })) as boolean;
  return {
    html: ready
      ? args.html.replace(
          /<\/body>\s*<\/html>\s*$/i,
          `${renderMerchantCommerceLink({ slug: args.slug })}</body></html>`,
        )
      : args.html,
    commerceRuntime: MERCHANT_CHECKOUT_RUNTIME,
    enabled: ready,
  };
}
export const decoration = internalQuery({
  args: { projectId: v.id("webProjects"), version: v.number(), slug: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (
      !project ||
      project.slug !== args.slug ||
      project.kind !== "storefront" ||
      project.publishedVersion !== args.version
    )
      return false;
    const lifecycle = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", project.tenantId))
      .unique();
    if (lifecycle?.state) return false;
    return (await merchantReadiness(ctx, project.tenantId, project._id)).publicCheckoutReady;
  },
});
const selection = v.array(
  v.object({ id: v.string(), quantity: v.number(), revision: v.number(), unitMinor: v.number() }),
);
export const preparePublicCheckout = internalMutation({
  args: {
    host: v.string(),
    slug: v.string(),
    buyerToken: v.string(),
    provider: v.union(v.literal("stripe"), v.literal("paypal")),
    country: v.string(),
    selection,
  },
  handler: async (ctx, args) => {
    if (
      !tokenValid(args.buyerToken) ||
      args.selection.length < 1 ||
      args.selection.length > 50 ||
      new Set(args.selection.map((item) => item.id)).size !== args.selection.length
    )
      throw Error("MERCHANT_SELECTION_INVALID");
    const context = await shopContext(ctx, args.host, args.slug),
      tenantId = context.project.tenantId;
    if (
      !context.view.providers.includes(args.provider) ||
      !context.view.countryOptions.includes(args.country)
    )
      throw Error("MERCHANT_PROVIDER_OR_COUNTRY_UNAVAILABLE");
    const buyerTokenHash = digest(args.buyerToken),
      buyerRequestHash = digest(
        JSON.stringify([context.version.version, args.selection, args.country, args.provider]),
      );
    const existing = await ctx.db
      .query("tenantCarts")
      .withIndex("by_tenant_project_buyer", (q) =>
        q
          .eq("tenantId", tenantId)
          .eq("projectId", context.project._id)
          .eq("buyerTokenHash", buyerTokenHash),
      )
      .unique();
    if (existing) {
      if (existing.buyerRequestHash !== buyerRequestHash)
        throw Error("MERCHANT_SELECTION_ALREADY_SUBMITTED");
      const order = await ctx.db
        .query("tenantOrders")
        .withIndex("by_tenant_cart", (q) => q.eq("tenantId", tenantId).eq("cartId", existing._id))
        .unique();
      if (!order) throw Error("MERCHANT_CHECKOUT_REQUIRES_RECONCILIATION");
      return { tenantId, orderId: order._id };
    }
    const selected = args.selection.filter((item) => item.quantity > 0);
    if (!selected.length) throw Error("MERCHANT_SELECTION_INVALID");
    const lines = selected.map((item) => {
      const actual = context.items.find((candidate) => candidate.id === item.id);
      if (
        !actual ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > actual.maxQuantity ||
        item.unitMinor !== actual.unitMinor ||
        item.revision !== actual.productRevision
      )
        throw Error("MERCHANT_PRICE_OR_STOCK_CHANGED");
      return {
        presentationItemId: actual.id,
        productId: actual.productId,
        quantity: item.quantity,
        expectedProductRevision: actual.productRevision,
        expectedUnitMinor: actual.unitMinor,
      };
    });
    // Conservative tenant/project bound limits anonymous reservation pressure without retaining IPs.
    const recent = await ctx.db
      .query("tenantCarts")
      .withIndex("by_tenant_project", (q) =>
        q.eq("tenantId", tenantId).eq("projectId", context.project._id),
      )
      .order("desc")
      .take(101);
    if (recent.filter((cart) => cart.createdAt > Date.now() - 3600000).length >= 100)
      throw Error("MERCHANT_CHECKOUT_RATE_LIMITED");
    const cart = await createCartForTenant(ctx, tenantId, {
      projectId: context.project._id,
      lines,
      addressCountry: args.country,
    });
    await ctx.db.patch(cart.cartId, { buyerTokenHash, buyerRequestHash });
    const order = await placeOrderForTenant(ctx, tenantId, {
      cartId: cart.cartId,
      expectedCartRevision: cart.revision,
      retryKey: buyerTokenHash,
    });
    if (!order.orderId || order.status !== "local_pending") throw Error("MERCHANT_ORDER_REFUSED");
    return { tenantId, orderId: order.orderId };
  },
});

async function buyerPayment(ctx: Db, paymentId: Id<"tenantMerchantPayments">, access: string) {
  if (!tokenValid(access)) throw Error("MERCHANT_RECEIPT_UNAVAILABLE");
  const payment = await ctx.db.get(paymentId);
  if (!payment?.buyerTokenHash || payment.buyerTokenHash !== digest(access))
    throw Error("MERCHANT_RECEIPT_UNAVAILABLE");
  const lifecycle = await ctx.db
    .query("authRevocations")
    .withIndex("by_userId", (q) => q.eq("userId", payment.tenantId))
    .unique();
  if (lifecycle?.state) throw Error("MERCHANT_RECEIPT_UNAVAILABLE");
  const policy = await ctx.db
    .query("tenantMerchantAutomation")
    .withIndex("by_tenant_project", (q) =>
      q.eq("tenantId", payment.tenantId).eq("projectId", payment.projectId),
    )
    .unique();
  if (Date.now() > payment.createdAt + (policy?.buyerRetentionDays ?? 30) * 86400000)
    throw Error("MERCHANT_RECEIPT_EXPIRED");
  return payment;
}
export const receipt = internalQuery({
  args: { paymentId: v.id("tenantMerchantPayments"), access: v.string() },
  handler: async (ctx, args) => {
    const payment = await buyerPayment(ctx, args.paymentId, args.access),
      order = await ctx.db.get(payment.orderId);
    if (!order || order.tenantId !== payment.tenantId) throw Error("MERCHANT_RECEIPT_UNAVAILABLE");
    const rows = await ctx.db
      .query("tenantMerchantOperations")
      .withIndex("by_tenant_order", (q) =>
        q.eq("tenantId", payment.tenantId).eq("orderId", payment.orderId),
      )
      .take(101);
    if (rows.length > 100) throw Error("MERCHANT_RECEIPT_UNAVAILABLE");
    const refunded = rows.some((op) => op.kind === "refund" && op.state.status === "succeeded"),
      pendingRefund = rows.some(
        (op) =>
          op.kind === "refund" && (op.state.status === "pending" || op.state.status === "unknown"),
      );
    const downloads = rows
      .filter(
        (op) =>
          !refunded &&
          !pendingRefund &&
          op.storageId &&
          digitalEntitlementAccessible(op.state, {
            tenantId: payment.tenantId,
            orderId: payment.orderId,
            now: Date.now(),
          }),
      )
      .map((op) => ({
        href: `/merchant/download/${op._id}?access=${args.access}`,
        label: "Download your purchase",
      }));
    const state = payment.state.status as MerchantOrderStatusView["status"];
    const notices: MerchantOrderStatusView["notices"] = [
      ...(refunded ? ["refunded" as const] : pendingRefund ? ["refund_pending" as const] : []),
      ...(state === "merchant_review"
        ? ["stock_review" as const]
        : state === "unknown"
          ? ["payment_unknown" as const]
          : state !== "paid"
            ? ["payment_pending" as const]
            : downloads.length
              ? ["delivery_ready" as const]
              : rows.some(
                    (op) => op.kind === "physical_shipment" && op.state.status === "succeeded",
                  )
                ? []
                : ["delivery_pending" as const]),
    ];
    return {
      payment,
      view: {
        status: state,
        currency: order.snapshot.currency,
        totalMinor: order.snapshot.totalMinor,
        notices,
        digitalLinks: downloads,
        fulfilments: rows
          .filter((op) => op.kind === "physical_shipment")
          .map((op) => ({ kind: op.kind, status: op.state.status })),
      },
    };
  },
});
export const download = internalQuery({
  args: { operationId: v.id("tenantMerchantOperations"), access: v.string() },
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.operationId);
    if (!op || op.kind !== "digital_entitlement" || !op.storageId)
      throw Error("MERCHANT_DOWNLOAD_UNAVAILABLE");
    const payment = await buyerPayment(ctx, op.paymentId, args.access);
    if (
      payment.tenantId !== op.tenantId ||
      payment.state.status !== "paid" ||
      !digitalEntitlementAccessible(op.state, {
        tenantId: payment.tenantId,
        orderId: payment.orderId,
        now: Date.now(),
      })
    )
      throw Error("MERCHANT_DOWNLOAD_UNAVAILABLE");
    const refunds = await ctx.db
      .query("tenantMerchantOperations")
      .withIndex("by_tenant_order", (q) =>
        q.eq("tenantId", payment.tenantId).eq("orderId", payment.orderId),
      )
      .take(101);
    if (
      refunds.length > 100 ||
      refunds.some((row) => row.kind === "refund" && row.state.status !== "failed")
    )
      throw Error("MERCHANT_DOWNLOAD_UNAVAILABLE");
    const metadata = await ctx.db.system.get(op.storageId);
    if (!metadata || metadata.size > 10 * 1024 * 1024) throw Error("MERCHANT_DOWNLOAD_UNAVAILABLE");
    return { storageId: op.storageId, size: metadata.size };
  },
});

export async function boundedMerchantBody(req: Request, limit: number) {
  const declared = req.headers.get("Content-Length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw Error("MERCHANT_BODY_TOO_LARGE");
  const reader = req.body?.getReader();
  if (!reader) throw Error("MERCHANT_BODY_REQUIRED");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw Error("MERCHANT_BODY_TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function sameOrigin(req: Request) {
  return req.headers.get("Origin") === new URL(req.url).origin;
}
function cookie(req: Request, name: string) {
  return (
    req.headers
      .get("Cookie")
      ?.split(";")
      .map((part) => part.trim().split("="))
      .find((part) => part[0] === name)?.[1] ?? ""
  );
}
function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
const response = (text: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(text, { status, headers: { ...headers, ...extra } });
export function registerMerchantRoutes(router: HttpRouter) {
  router.route({
    pathPrefix: "/merchant/",
    method: "GET",
    handler: httpAction(async (ctx, req) => {
      try {
        const url = new URL(req.url),
          parts = url.pathname.split("/").filter(Boolean);
        if (parts.length !== 3) return response("not found", 404);
        if (parts[1] === "shop" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[2]!)) {
          const context = (await ctx.runQuery(qref("publicShop"), {
            host: url.host,
            slug: parts[2],
          })) as Awaited<ReturnType<typeof shopContext>>;
          const name = `mcart_${parts[2]}`,
            prior = cookie(req, name),
            token = tokenValid(prior) ? prior : randomToken();
          return response(renderMerchantCart(context.view), 200, {
            "Content-Type": "text/html; charset=utf-8",
            "Set-Cookie": `${name}=${token}; Path=/merchant/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800`,
          });
        }
        if (parts[1] === "order") {
          const access = url.searchParams.get("access") ?? "",
            result = (await ctx.runQuery(qref("receipt"), { paymentId: parts[2], access })) as {
              payment: Doc<"tenantMerchantPayments">;
              view: MerchantOrderStatusView;
            };
          let html = renderMerchantOrderStatus(result.view);
          if (
            result.payment.provider === "paypal" &&
            (result.payment.state.status === "pending" || result.payment.state.status === "unknown")
          )
            html = html.replace(
              "</main>",
              `<form method="post" action="/merchant/capture/${parts[2]}?access=${access}"><button type="submit">Confirm approved sandbox payment</button></form></main>`,
            );
          return response(html, 200, { "Content-Type": "text/html; charset=utf-8" });
        }
        if (parts[1] === "download") {
          const asset = (await ctx.runQuery(qref("download"), {
            operationId: parts[2],
            access: url.searchParams.get("access") ?? "",
          })) as { storageId: Id<"_storage">; size: number };
          const blob = await ctx.storage.get(asset.storageId);
          if (!blob || blob.size !== asset.size) return response("not found", 404);
          await ctx.runQuery(qref("download"), {
            operationId: parts[2],
            access: url.searchParams.get("access") ?? "",
          });
          return new Response(blob, {
            headers: {
              ...headers,
              "Content-Type": "application/octet-stream",
              "Content-Disposition": 'attachment; filename="purchase.bin"',
            },
          });
        }
        return response("not found", 404);
      } catch {
        return response(
          "This checkout or receipt is unavailable. Return to the shop and review its current setup.",
          404,
        );
      }
    }),
  });
  router.route({
    pathPrefix: "/merchant/",
    method: "POST",
    handler: httpAction(async (ctx, req) => {
      const url = new URL(req.url),
        parts = url.pathname.split("/").filter(Boolean);
      try {
        if (
          parts.length === 3 &&
          parts[2] === "webhook" &&
          (parts[1] === "stripe" || parts[1] === "paypal")
        )
          return await webhook(ctx, req, parts[1]);
        if (!sameOrigin(req)) return response("forbidden", 403);
        if (parts.length !== 3) return response("not found", 404);
        if (parts[1] === "checkout") {
          if (
            req.headers.get("Content-Type")?.split(";")[0] !== "application/x-www-form-urlencoded"
          )
            return response("unsupported request", 415);
          const form = new URLSearchParams(await boundedMerchantBody(req, 8192)),
            provider = form.get("provider");
          if (provider !== "stripe" && provider !== "paypal")
            return response("Choose a provider.", 400);
          const chosen = [];
          for (const [key, value] of form) {
            if (form.getAll(key).length !== 1) throw Error("MERCHANT_DUPLICATE_FIELD");
            if (
              key === "country" ||
              key === "provider" ||
              /^(rev|unit):[A-Za-z0-9_-]{1,128}$/.test(key)
            )
              continue;
            if (!/^qty:[A-Za-z0-9_-]{1,128}$/.test(key) || !/^\d{1,3}$/.test(value))
              throw Error("MERCHANT_SELECTION_INVALID");
            const id = key.slice(4),
              quantity = Number(value);
            if (quantity > 0)
              chosen.push({
                id,
                quantity,
                revision: Number(form.get(`rev:${id}`)),
                unitMinor: Number(form.get(`unit:${id}`)),
              });
          }
          const prepared = (await ctx.runMutation(mref("preparePublicCheckout"), {
            host: url.host,
            slug: parts[2],
            buyerToken: cookie(req, `mcart_${parts[2]}`),
            provider,
            country: form.get("country") ?? "",
            selection: chosen,
          })) as { tenantId: string; orderId: Id<"tenantOrders"> };
          const started = await startMerchantCheckout(
            ctx,
            prepared.tenantId,
            prepared.orderId,
            provider,
          );
          if (!started.ok || !("url" in started) || typeof started.url !== "string")
            return response(
              "Checkout needs merchant review before another attempt. No payment is confirmed.",
              409,
            );
          return response("", 303, { Location: started.url });
        }
        if (parts[1] === "capture") {
          const result = (await ctx.runQuery(qref("receipt"), {
            paymentId: parts[2],
            access: url.searchParams.get("access") ?? "",
          })) as { payment: Doc<"tenantMerchantPayments"> };
          if (result.payment.provider !== "paypal") return response("not found", 404);
          await reconcileMerchantPayment(
            ctx,
            result.payment,
            `buyer-confirm:${result.payment._id}:${result.payment.revision}`,
            true,
          );
          return response("", 303, {
            Location: `/merchant/order/${parts[2]}?access=${url.searchParams.get("access")}`,
          });
        }
        return response("not found", 404);
      } catch {
        return response(
          "The selection changed or checkout is unavailable. Review the shop before continuing; do not retry an uncertain payment.",
          409,
        );
      }
    }),
  });
}
async function webhook(ctx: ActionCtx, req: Request, provider: MerchantProvider) {
  if (missingMerchantConfiguration(provider).length) return response("unavailable", 503);
  const raw = await boundedMerchantBody(req, 65536);
  let event: Record<string, unknown>;
  if (provider === "stripe") {
    if (
      !(await verifyStripeSignature(
        raw,
        req.headers.get("stripe-signature") ?? "",
        process.env.MERCHANT_STRIPE_TEST_WEBHOOK_SECRET!,
        Math.floor(Date.now() / 1000),
      ))
    )
      return response("invalid signature", 400);
    event = wire(JSON.parse(raw));
    if (event.livemode !== false || typeof event.account !== "string")
      return response("invalid mode", 400);
  } else {
    event = wire(JSON.parse(raw));
    const verification = await merchantClient("paypal").paypal(
      "/v1/notifications/verify-webhook-signature",
      "POST",
      {
        auth_algo: req.headers.get("paypal-auth-algo"),
        cert_url: req.headers.get("paypal-cert-url"),
        transmission_id: req.headers.get("paypal-transmission-id"),
        transmission_sig: req.headers.get("paypal-transmission-sig"),
        transmission_time: req.headers.get("paypal-transmission-time"),
        webhook_id: process.env.MERCHANT_PAYPAL_SANDBOX_WEBHOOK_ID,
        webhook_event: event,
      },
    );
    if (verification.verification_status !== "SUCCESS") return response("invalid signature", 400);
  }
  if (typeof event.id !== "string" || event.id.length > 160) return response("invalid event", 400);
  const resource = provider === "stripe" ? wire(wire(event.data).object) : wire(event.resource);
  const providerOrderId =
    provider === "stripe"
      ? resource.id
      : (wire(wire(resource.supplementary_data).related_ids).order_id ??
        (String(event.event_type).startsWith("CHECKOUT.ORDER.") ? resource.id : undefined));
  if (typeof providerOrderId !== "string") return response("ignored", 200);
  const payment = (await ctx.runQuery(
    makeFunctionReference<"query">("merchantCommerce:providerPayment"),
    {
      provider,
      providerOrderId,
      ...(provider === "stripe" ? { providerAccountId: event.account } : {}),
    },
  )) as Doc<"tenantMerchantPayments"> | null;
  if (!payment) return response("ignored", 200);
  // The signature proves delivery; an exact-account provider read proves the actual payment state.
  await ctx.runAction(makeFunctionReference<"action">("merchantProvider:verifiedWebhook"), {
    tenantId: payment.tenantId,
    paymentId: payment._id,
    eventRef: `${provider}:${event.id}`,
  });
  return response("accepted", 200);
}
