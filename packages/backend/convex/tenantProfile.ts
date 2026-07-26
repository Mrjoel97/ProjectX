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
  deserializeProfile,
  FUNDING_STATES,
  isTier,
  missingSlots,
  REVENUE_STAGES,
  sanitizeAgentName,
  TIER_SOURCES,
  TIERS,
} from "@pikar/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { migrations } from "./migrations";
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

/** The tier facts, in `REQUIRED_SLOTS` order minus the narrative slot this module does not own. */
const FACT_KEYS = ["headcount", "paidStaff", "revenueStage", "funding", "yearsOperating"] as const;

/**
 * Design §9's *"a tier change is a MOMENT, not a setting"* on the LOG plane. It rides the existing
 * insert-only `internal.audit.log` — there is deliberately NO `tierHistory` table: the audit table
 * already IS the append-only log, and a second one is a second thing to keep honest (the 15-03
 * `subAgentRuns` non-decision, same reasoning).
 *
 * The payload is FOUR keys and they are all enums or a COUNT (the `populatedFieldCount` precedent,
 * onboarding.ts:182-189). **Never put a fact VALUE here** (CLAUDE.md §4): `headcount` is arguably
 * just a count, but `revenueStage`/`funding` are business-sensitive and a tenant's staffing numbers
 * are precisely what §4 exists to keep out of the log. The test asserts the sorted KEY SET, so an
 * added key fails there rather than shipping a honeypot.
 */
const TIER_CHANGED_EVENT = "tenant.tier_changed";

async function logTierChange(
  ctx: MutationCtx,
  a: {
    tenantId: string;
    from: Tier | null;
    to: Tier;
    tierSource: TierSource;
    factsChanged: number;
  },
): Promise<void> {
  await ctx.runMutation(internal.audit.log, {
    tenantId: a.tenantId,
    correlationId: crypto.randomUUID(),
    eventType: TIER_CHANGED_EVENT,
    actor: "user",
    payload: { from: a.from, to: a.to, tierSource: a.tierSource, factsChanged: a.factsChanged },
  });
}

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

    // How many fact fields THIS call actually moved — a COUNT, never a value.
    const factsChanged = FACT_KEYS.filter(
      (k) => args[k] !== undefined && args[k] !== existing?.[k],
    ).length;

    if (changed) {
      await logTierChange(ctx, {
        tenantId: ctx.tenantId,
        from: existing?.tier ?? null,
        to: tier,
        tierSource,
        factsChanged,
      });
    }

    return { tier, tierSource, changed };
  },
});

/**
 * D6 — enterprise is NEVER derived; it is GRANTED. `requireOwner` (GOVN-01) does not land until
 * Phase 22 and is a recorded open blocker, so this is an `internalMutation` with NO public API
 * surface at all (the `actOnGapInternal` precedent) — an operator invokes it directly:
 *
 *   npx convex run tenantProfile:grantEnterprise '{"tenantId":"..."}'
 *
 * Deliberately NOT a `tenantMutation`, no UI, no route: a fourth tenant-callable pseudo-admin
 * function would DEEPEN the Phase-22 blocker (three already exist — STATE.md's Blockers section).
 * D6 holds by construction regardless of who can call this, because `deriveTier`'s return type
 * structurally excludes `"enterprise"`. **GOVN-01 IS NOT CLOSED BY THIS PHASE.**
 *
 * The grant leaves the facts untouched and makes `tierSource: "admin"` — which `saveFacts` treats
 * as STICKY, so a later tenant facts edit cannot undo it.
 */
export const grantEnterprise = internalMutation({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<SaveFactsResult> => {
    const existing = await byTenant(ctx.db, tenantId);
    const grant = { tier: "enterprise", tierSource: "admin", derivedAt: Date.now() } as const;
    const changed = existing?.tier !== grant.tier;

    if (existing) await ctx.db.patch(existing._id, grant);
    else await ctx.db.insert("tenantProfiles", { tenantId, ...grant });

    if (changed) {
      await logTierChange(ctx, {
        tenantId,
        from: existing?.tier ?? null,
        to: grant.tier,
        tierSource: grant.tierSource,
        factsChanged: 0, // a grant moves no facts
      });
    }

    return { tier: grant.tier, tierSource: grant.tierSource, changed };
  },
});

/**
 * SC#6 / design §10 — backfill existing tenants into the control plane.
 *
 * OPSG-06: resumable + batched via `@convex-dev/migrations`, NEVER an ad-hoc backfill (the
 * `vaultSweep.ts:4-5` house rule — a `.collect()` over `vaultDocuments` is an unbounded read over a
 * table holding book-sized uploads, and it fails mid-way with no cursor). It lives HERE rather than
 * in a new module because a migration belongs beside the table it fills (the `vaultSweep.ts`
 * precedent, same instance, same table).
 *
 * **NO FORCED RE-ONBOARDING**: the legacy tier stands until the user completes the facts. That is
 * why the row it writes carries no facts at all and why `saveFacts` patches such a row without
 * re-deriving.
 */
export const backfillLegacyTier = migrations.define({
  table: "vaultDocuments",
  migrateOne: async (ctx, doc) => {
    if (doc.kind !== "business_profile" || doc.status === "failed" || !doc.text) return;

    const existing = await byTenant(ctx.db, doc.tenantId);
    // Double duty: IDEMPOTENCY (a second run adds nothing, a tenant's second profile doc adds
    // nothing) AND the never-downgrade rule (a row already at `derived` is authoritative and must
    // not be reverted to `legacy`). Do NOT "improve" this into an upsert.
    if (existing) return;

    // `deserializeProfile`'s fallback to "solopreneur" on a garbage `Persona:` line is ACCEPTABLE
    // here: a legacy row records what the system ALREADY BELIEVED. SC#2b is about the AUTHORITATIVE
    // read (plan 04 repoints `evaluations.ts` at this table); it is not about the backfill.
    const persona = deserializeProfile(doc.text).persona;
    await ctx.db.insert("tenantProfiles", {
      tenantId: doc.tenantId,
      tier: isTier(persona) ? persona : "solopreneur",
      tierSource: "legacy",
      derivedAt: Date.now(),
    });
  },
});

/**
 * The operator one-shot runner (the `vaultSweep.runSweep` precedent, bound to this migration):
 *
 *   npx convex run tenantProfile:runBackfillLegacyTier
 *
 * It cannot be RUN for real in this worktree (no `CONVEX_DEPLOYMENT`); it is exercised only through
 * `convex-test`'s in-memory DB, and the live run is deferred to integration on `main`.
 */
export const runBackfillLegacyTier = migrations.runner(internal.tenantProfile.backfillLegacyTier);
