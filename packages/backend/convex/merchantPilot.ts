import { sha256Bytes } from "@pikar/core/webRuntime";
import { v } from "convex/values";
import { tenantMutation } from "./lib/functions";
import { merchantReadiness } from "./merchantCommerce";
import { createCartForTenant, placeOrderForTenant } from "./tenantOrders";

/** Prepare one item under the seller's approved policy. A browser retry reopens the
 * same immutable test order, including when the first response was lost. */
export const prepareOrder = tenantMutation({
  args: {
    projectId: v.id("webProjects"),
    presentationItemId: v.string(),
    productId: v.id("tenantProducts"),
    productRevision: v.number(),
    unitMinor: v.number(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const pilot = (await merchantReadiness(ctx, ctx.tenantId, args.projectId))
      .privateFlutterwavePilot;
    if (
      !pilot ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.requestId)
    )
      throw Error("PRIVATE_TEST_UNAVAILABLE");
    const buyerTokenHash = sha256Bytes(
      new TextEncoder().encode(`flutterwave-pilot/${args.requestId}`),
    );
    const requestHash = sha256Bytes(
      new TextEncoder().encode(
        JSON.stringify([
          args.presentationItemId,
          args.productId,
          args.productRevision,
          args.unitMinor,
        ]),
      ),
    );
    let cart = await ctx.db
      .query("tenantCarts")
      .withIndex("by_tenant_project_buyer", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("projectId", args.projectId)
          .eq("buyerTokenHash", buyerTokenHash),
      )
      .unique();
    if (cart && cart.buyerRequestHash !== requestHash) throw Error("TEST_ORDER_SELECTION_CHANGED");
    if (!cart) {
      if (!pilot.canStartTest) throw Error("PRIVATE_TEST_UNAVAILABLE");
      const item = pilot.items.find(
        (item) =>
          item.presentationItemId === args.presentationItemId && item.productId === args.productId,
      );
      if (
        !item ||
        item.productRevision !== args.productRevision ||
        item.unitMinor !== args.unitMinor
      )
        throw Error("TEST_PRICE_CHANGED");
      const created = await createCartForTenant(ctx, ctx.tenantId, {
        projectId: args.projectId,
        addressCountry: "TZ",
        lines: [
          {
            productId: item.productId,
            presentationItemId: item.presentationItemId,
            quantity: 1,
            expectedProductRevision: item.productRevision,
            expectedUnitMinor: item.unitMinor,
          },
        ],
      });
      await ctx.db.patch(created.cartId, { buyerTokenHash, buyerRequestHash: requestHash });
      cart = await ctx.db.get(created.cartId);
    }
    if (!cart) throw Error("CART_UNAVAILABLE");
    const placed = await placeOrderForTenant(ctx, ctx.tenantId, {
      cartId: cart._id,
      expectedCartRevision: 1,
      retryKey: args.requestId,
    });
    const order = placed.orderId && (await ctx.db.get(placed.orderId));
    if (
      !order ||
      order.snapshot.country !== "TZ" ||
      order.snapshot.currency !== "TZS" ||
      order.snapshot.totalMinor % 100 !== 0
    )
      throw Error("TEST_ORDER_REQUIRES_WHOLE_TZS");
    return {
      orderId: order._id,
      totalMinor: order.snapshot.totalMinor,
      currency: order.snapshot.currency,
      status: order.status,
    };
  },
});
