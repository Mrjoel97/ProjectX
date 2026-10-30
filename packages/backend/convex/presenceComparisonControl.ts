import { websiteDesignProposalSkillBody } from "@pikar/contracts/skills/websiteDesignProposal";
import {
  comparisonLedgerAdmission,
  PRESENCE_COMPARISON_CAP_CENTS,
  PRESENCE_COMPARISON_FIXTURE,
  type PresenceComparisonAdmission,
} from "@pikar/core/presenceComparison";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { appendAudit } from "./audit";
import { internalMutation } from "./lib/tenantLifecycle";
import { assertPresenceDesignStage } from "./presenceDesignProbe";

export const COMPARISON_NAMESPACE = "control:presence-comparison:v1";
const correlation = (runRef: string) => `presence-comparison:${runRef}`;
const fixtureHash = () =>
  sha256Bytes(new TextEncoder().encode(JSON.stringify(PRESENCE_COMPARISON_FIXTURE)));
/** Prepare an original in-house benchmark prompt as a candidate only. Never activates a skill. */
export const prepare = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ skillVersion: number; skillBodyHash: string; candidateOnly: boolean }> => {
    assertPresenceDesignStage();
    const rows = await ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) => q.eq("name", "website-design-proposal"))
      .take(21);
    if (rows.length > 20) throw Error("PRESENCE_COMPARISON_SKILL_HISTORY_LIMIT");
    const existing = rows.find(
      (row) =>
        row.body === websiteDesignProposalSkillBody &&
        (row.status === "candidate" || row.status === "active"),
    );
    if (existing)
      return {
        skillVersion: existing.version,
        skillBodyHash: sha256Bytes(new TextEncoder().encode(existing.body)),
        candidateOnly: existing.status !== "active",
      };
    const version = Math.max(0, ...rows.map((row) => row.version)) + 1;
    await ctx.db.insert("skills", {
      name: "website-design-proposal",
      version,
      body: websiteDesignProposalSkillBody,
      status: "candidate",
      createdAt: Date.now(),
    });
    return {
      skillVersion: version,
      skillBodyHash: sha256Bytes(new TextEncoder().encode(websiteDesignProposalSkillBody)),
      candidateOnly: true,
    };
  },
});
export const admission = internalQuery({
  args: {},
  handler: async (ctx): Promise<PresenceComparisonAdmission> => {
    assertPresenceDesignStage();
    return comparisonLedgerAdmission(
      await ctx.db.query("spendEvents").take(5001),
      PRESENCE_COMPARISON_CAP_CENTS,
    );
  },
});
/** Claim before opening an envelope. A process loss is not permission to open a replacement. */
export const claim = internalMutation({
  args: { runRef: v.string() },
  handler: async (
    ctx,
    { runRef },
  ): Promise<PresenceComparisonAdmission & { fixtureHash: string }> => {
    if (!/^[a-f0-9]{8}$/.test(runRef)) throw Error("PRESENCE_COMPARISON_ID_INVALID");
    assertPresenceDesignStage();
    const history = await ctx.db
      .query("audit")
      .withIndex("by_tenant_ts", (q) => q.eq("tenantId", COMPARISON_NAMESPACE))
      .take(501);
    if (history.length > 500) throw Error("PRESENCE_COMPARISON_HISTORY_LIMIT");
    const terminals = new Set(
      history
        .filter((row) =>
          ["presence_comparison.completed", "presence_comparison.stopped"].includes(row.eventType),
        )
        .map((row) => row.correlationId),
    );
    if (
      history.some(
        (row) =>
          row.eventType === "presence_comparison.claimed" && !terminals.has(row.correlationId),
      )
    )
      throw Error("PRESENCE_COMPARISON_PRIOR_RUN_OPEN");
    const prior = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlation(runRef)))
      .first();
    if (prior) throw Error("PRESENCE_COMPARISON_ALREADY_CLAIMED");
    const admission = comparisonLedgerAdmission(
      await ctx.db.query("spendEvents").take(5001),
      PRESENCE_COMPARISON_CAP_CENTS,
    );
    await appendAudit(ctx, {
      tenantId: COMPARISON_NAMESPACE,
      correlationId: correlation(runRef),
      eventType: "presence_comparison.claimed",
      actor: "operator",
      payload: { fixtureHash: fixtureHash(), capCents: admission.capCents },
    });
    return { ...admission, fixtureHash: fixtureHash() };
  },
});
export const record = internalMutation({
  args: {
    runRef: v.string(),
    event: v.union(v.literal("opened"), v.literal("completed"), v.literal("stopped")),
    payload: v.record(
      v.string(),
      v.union(v.string(), v.number(), v.boolean(), v.array(v.string())),
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    assertPresenceDesignStage();
    if (!/^[a-f0-9]{8}$/.test(args.runRef)) throw Error("PRESENCE_COMPARISON_ID_INVALID");
    const claimed = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlation(args.runRef)))
      .first();
    if (!claimed || claimed.tenantId !== COMPARISON_NAMESPACE)
      throw Error("PRESENCE_COMPARISON_NOT_CLAIMED");
    await appendAudit(ctx, {
      tenantId: COMPARISON_NAMESPACE,
      correlationId: correlation(args.runRef),
      eventType: `presence_comparison.${args.event}`,
      actor: "operator",
      payload: args.payload,
    });
  },
});
