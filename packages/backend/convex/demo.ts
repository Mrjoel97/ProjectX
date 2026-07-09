// Demo module proving the tenant wrapper end-to-end (target of tenant.test.ts).
// It uses ONLY tenantMutation/tenantQuery — never the raw builders — so tenantId
// is injected from the identity and every row is written/read under scope.

import { v } from "convex/values";
import { tenantMutation, tenantQuery } from "./lib/functions";

/** Insert a demo item owned by the calling tenant. */
export const addItem = tenantMutation({
  args: { label: v.string() },
  handler: async (ctx, { label }) => {
    return await ctx.db.insert("demoItems", { tenantId: ctx.tenantId, label });
  },
});

/** List only the calling tenant's demo items (scoped via the by_tenant index). */
export const listItems = tenantQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("demoItems")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
  },
});
