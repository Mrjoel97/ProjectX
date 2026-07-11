// Wave-1 STUB. Convex's generated `internal` API is typed from the file tree, so a
// missing pipeline.ts is a HARD compile error — 02-03's workflow.start target and
// 02-05's awaiting_reauth setter both need these symbols to exist NOW. Plan 02-06
// (Wave 3) replaces the no-op handler with the real route→draft→gate→deliver spine
// and REUSES setStatus.
import { workflow } from "./index";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// The 11-member requests.status union (kept in sync with schema.ts).
export const REQUEST_STATUS = v.union(
  v.literal("submitted"),
  v.literal("routing"),
  v.literal("drafting"),
  v.literal("awaiting_review"),
  v.literal("approved"),
  v.literal("delivering"),
  v.literal("sent"),
  v.literal("rejected"),
  v.literal("expired"),
  v.literal("failed"),
  v.literal("awaiting_reauth"),
);

// ponytail: no-op handler — 02-06 fills the real spine. Args match 02-03's workflow.start.
export const pipelineWorkflow = workflow.define({
  args: { correlationId: v.string(), requestId: v.id("requests"), tenantId: v.string() },
  handler: async () => {},
});

// Reused by 02-05 (awaiting_reauth + sent) and 02-06 (every stage transition).
export const setStatus = internalMutation({
  args: { requestId: v.id("requests"), status: REQUEST_STATUS },
  handler: async (ctx, { requestId, status }) => {
    await ctx.db.patch(requestId, { status });
  },
});
