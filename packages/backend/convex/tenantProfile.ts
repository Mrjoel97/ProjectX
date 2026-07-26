// The tier CONTROL PLANE adapter (Phase 15.1, design §4.1) — a THIN adapter (CLAUDE.md §1) over
// the pure `@pikar/core` tier surface. `deriveTier` and the slot rules live in `businessProfile.ts`;
// this file only reads and writes the `tenantProfiles` row and emits the tier-change audit event.
//
// DEFAULT (V8) runtime — deliberately NO `"use node"`. `llm.ts` is the ONE node module in this
// deployment; a second one re-triggers the documented TS `internal`-graph circular-inference cliff
// (see onboarding.ts:7-11).
//
// EVERY handler carries an explicit `Promise<…>` return type. An inferred one has already collapsed
// the generated API to `any` once in this repo (13-01, ~90 unrelated `apps/web` errors); the
// annotation is the tripwire, not decoration.
//
// §2: `tenantQuery`/`tenantMutation` for the identity-bearing surfaces; the allow-listed
// `internalQuery`/`internalMutation` for the identity-less ones (the `vaultGroundHydrated` /
// `actOnGapInternal` precedents — their callers are `internalAction`s carrying no live identity).
import type {
  BehaviorPreset,
  Funding,
  RevenueStage,
  Tier,
  TierFacts,
  TierSource,
} from "@pikar/core";
import {
  BEHAVIOR_PRESETS,
  deriveTier,
  FUNDING_STATES,
  missingSlots,
  REVENUE_STAGES,
  sanitizeAgentName,
  TIER_SOURCES,
  TIERS,
} from "@pikar/core";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { internalQuery } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import schema from "./schema";

// Derive the arg validators from the schema (the `evaluations.ts:42` rung-2 precedent) so the
// mutation's args can never drift from the table shape.
const tpFields = schema.tables.tenantProfiles.validator.fields;

type TpDoc = Doc<"tenantProfiles">;

/** Everything writable on the row EXCEPT the system fields and the immutable `tenantId`. */
type TpWrite = Partial<Omit<TpDoc, "_id" | "_creationTime" | "tenantId">>;

// ── Compile-time binds: the TABLE's literals and the DOMAIN's unions must agree ────────────────
// Both directions, so neither side can silently drift wider than the other. This is the
// `_stepTools` mechanism (dispatch.ts:131) applied to five enums: a literal added to the schema but
// not to `@pikar/core` (or the reverse) is a COMPILE error here rather than a runtime surprise.
const _tierToDoc: readonly TpDoc["tier"][] = TIERS;
const _docToTier: readonly Tier[] = [] as TpDoc["tier"][];
const _sourceToDoc: readonly TpDoc["tierSource"][] = TIER_SOURCES;
const _docToSource: readonly TierSource[] = [] as TpDoc["tierSource"][];
const _stageToDoc: readonly NonNullable<TpDoc["revenueStage"]>[] = REVENUE_STAGES;
const _docToStage: readonly RevenueStage[] = [] as NonNullable<TpDoc["revenueStage"]>[];
const _fundingToDoc: readonly NonNullable<TpDoc["funding"]>[] = FUNDING_STATES;
const _docToFunding: readonly Funding[] = [] as NonNullable<TpDoc["funding"]>[];
const _presetToDoc: readonly NonNullable<TpDoc["behaviorPreset"]>[] = BEHAVIOR_PRESETS;
const _docToPreset: readonly BehaviorPreset[] = [] as NonNullable<TpDoc["behaviorPreset"]>[];

/**
 * `missingSlots` also reports `oneLineDescription`, which is Phase-11 narrative living on the vault
 * doc — NOT a tier fact and not this mutation's business. Feeding it a placeholder isolates the
 * FACT slots without re-deriving the slot list here (one source of truth, not two).
 */
const NARRATIVE_PLACEHOLDER = "x";

/** One row per tenant is THE invariant of this table — `.unique()`, never `.first()`, so a
 *  duplicate is LOUD rather than silently shadowed (the `plans.byThread` precedent). */
const byTenant = (db: DatabaseReader, tenantId: string): Promise<TpDoc | null> =>
  db
    .query("tenantProfiles")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();

/** Drop `undefined` keys so a partial write never patches a field to absent by accident. */
const definedOnly = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, val]) => val !== undefined)) as T;

/**
 * The tenant's tier row, read WITHOUT an identity. Its callers are `internalAction`s
 * (`evaluations.runEvaluation`, `dispatch.runSpecialist`) that carry no live identity, so the
 * tenant travels as an explicit validated arg — the `vaultGroundHydrated` convention.
 */
export const forTenant = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<TpDoc | null> => byTenant(ctx.db, tenantId),
});

/**
 * The UI read. Returns the row AS-IS: the profile page composes `TIER_REASON[row.tier]` and
 * `missingSlots(row)` from `@pikar/core` itself — fewer moving parts than a server-side view object,
 * and the reason table stays in the one place that owns it.
 */
export const get = tenantQuery({
  args: {},
  handler: async (ctx): Promise<TpDoc | null> => byTenant(ctx.db, ctx.tenantId),
});

/** What `saveFacts` / `grantEnterprise` hand back: enums and a flag — safe to return and to log. */
export type SaveFactsResult = { tier: Tier; tierSource: TierSource; changed: boolean };

/**
 * Write the tier FACTS and re-derive the tier from them.
 *
 * **There is deliberately NO `tier` argument and there never will be.** The tier is a derived
 * OUTPUT of the facts write, never an input to it (design §9, amended; D2). A caller-supplied tier
 * would make the tier DB-writable by proxy — exactly the defect this phase exists to close.
 *
 * Three behaviours worth knowing before you change this:
 * - **Incomplete facts on a tenant with NO row FAIL CLOSED** (`INCOMPLETE_FACTS`). A row cannot
 *   exist without a tier, and inventing one is the silent-solopreneur reclassification this phase
 *   kills.
 * - **Incomplete facts on a tenant that HAS a row patch the facts only.** The legacy tier stands
 *   until the user completes the facts (design §10 — no forced re-onboarding).
 * - **`tierSource: "admin"` is STICKY.** An operator grant is not undone by the tenant editing
 *   headcount (D6).
 */
export const saveFacts = tenantMutation({
  args: {
    headcount: tpFields.headcount,
    paidStaff: tpFields.paidStaff,
    revenueStage: tpFields.revenueStage,
    funding: tpFields.funding,
    yearsOperating: tpFields.yearsOperating,
    agentName: tpFields.agentName,
    behaviorPreset: tpFields.behaviorPreset,
  },
  handler: async (ctx, args): Promise<SaveFactsResult> => {
    const existing = await byTenant(ctx.db, ctx.tenantId);

    // Merge provided-over-stored with `??` (NULLISH, never `||`): `headcount: 0` is an ANSWER.
    const facts: Partial<TierFacts> = {
      headcount: args.headcount ?? existing?.headcount,
      paidStaff: args.paidStaff ?? existing?.paidStaff,
      revenueStage: args.revenueStage ?? existing?.revenueStage,
      funding: args.funding ?? existing?.funding,
      yearsOperating: args.yearsOperating ?? existing?.yearsOperating,
    };

    const write: TpWrite = definedOnly<TpWrite>({
      ...facts,
      // A trust boundary, not a cosmetic field — this string rides into a model system prompt.
      agentName: args.agentName === undefined ? undefined : sanitizeAgentName(args.agentName),
      behaviorPreset: args.behaviorPreset,
    });

    const missing = missingSlots({ ...facts, oneLineDescription: NARRATIVE_PLACEHOLDER });
    if (missing.length > 0) {
      if (!existing) throw new ConvexError({ code: "INCOMPLETE_FACTS", missing });
      await ctx.db.patch(existing._id, write);
      return { tier: existing.tier, tierSource: existing.tierSource, changed: false };
    }

    // `missingSlots` just proved every fact slot present and in-union; that is the narrowing it
    // performs but cannot express in the return type.
    const derived = deriveTier(facts as TierFacts);
    const sticky = existing?.tierSource === "admin";
    const tier: Tier = sticky ? existing.tier : derived;
    const tierSource: TierSource = sticky ? "admin" : "derived";
    const changed = existing?.tier !== tier;

    // A re-derivation refreshes `derivedAt` even when the tier lands in the same place — the
    // timestamp records WHEN the rule last ran, not when the answer last moved. A sticky admin row
    // takes the facts and nothing else.
    if (!existing) {
      await ctx.db.insert("tenantProfiles", {
        tenantId: ctx.tenantId,
        ...write,
        tier,
        tierSource,
        derivedAt: Date.now(),
      });
    } else if (sticky) {
      await ctx.db.patch(existing._id, write);
    } else {
      await ctx.db.patch(existing._id, { ...write, tier, tierSource, derivedAt: Date.now() });
    }

    return { tier, tierSource, changed };
  },
});
