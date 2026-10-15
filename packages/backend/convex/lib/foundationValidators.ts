import { v } from "convex/values";
export const foundationSection = v.union(
  v.literal("essentials"),
  v.literal("offers"),
  v.literal("operations"),
  v.literal("delivery"),
  v.literal("goals"),
  v.literal("constraints"),
);
export const foundationProfile = v.object({
  name: v.string(),
  oneLineDescription: v.string(),
  stage: v.string(),
  offering: v.string(),
  targetCustomer: v.string(),
  primaryGoals: v.array(v.string()),
  knownConstraints: v.array(v.string()),
});
export const foundationSlots = v.object({
  oneLineDescription: v.optional(v.string()),
  headcount: v.optional(v.number()),
  paidStaff: v.optional(v.number()),
  revenueStage: v.optional(
    v.union(v.literal("pre-revenue"), v.literal("early-revenue"), v.literal("steady-revenue")),
  ),
  funding: v.optional(
    v.union(v.literal("bootstrapped"), v.literal("seeking"), v.literal("funded")),
  ),
  yearsOperating: v.optional(v.number()),
});
export const foundationAnswer = v.object({
  section: foundationSection,
  text: v.string(),
  eventId: v.string(),
  sourceDocId: v.optional(v.string()),
  intent: v.union(v.literal("current"), v.literal("planned")),
});
