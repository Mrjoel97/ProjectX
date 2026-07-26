// The onboarding / business-profile adapter (ONBD-01/02) — a THIN adapter (§1) over the pure
// @pikar/core business-profile module + the vault ingest/ground spine. Domain logic (Persona,
// serializeProfile, validateProfile, SC#1 confirm-not-assume) lives in @pikar/core; this file only
// reads/writes the DB and orchestrates: the profile is "just another vault doc", so embed + tenant
// scope + retrieval come FREE from startIngest / vaultGroundHydrated (persistBrief clone, §1).
//
// DEFAULT-runtime (V8) module — NO `"use node"` (Pitfall 3, mirrors vaultLlm.ts): llm.ts is the ONE
// node module; a second re-triggers the TS `internal`-graph circular-inference cliff. `generateObject`
// runs fine in V8 (the AI SDK uses fetch). Every handler carries an explicit `Promise<...>` return
// type (the §96 mitigation) and the extractor uses `jsonSchema` (never zod), so this file stays clear
// of the cliff while co-locating the query/mutation/action surface.
//
// SC#1 (persona is confirmed, never auto-committed): extractProfile RETURNS the structured object to
// the caller ONLY — it inserts no doc and writes no audit. commitProfile is the SEPARATE, explicit
// human-confirmed write. §4: no onboarding audit/telemetry/DLQ payload ever carries profile prose or
// field values — refs/hashes/ids/counts/booleans ONLY. The profile `text` is vault CONTENT (kept on
// the row + rag chunks), never a log.

import { openai } from "@ai-sdk/openai";
import type { EntryId } from "@convex-dev/rag";
import { BUSINESS_PROFILE_SKILL } from "@pikar/contracts/skill";
import {
  type BusinessProfile,
  deserializeProfile,
  missingSlots,
  type ProfileInput,
  serializeProfile,
  validateProfile,
} from "@pikar/core";
import { DEFAULT_MODEL } from "@pikar/cost";
import { categoryFor } from "@pikar/vault";
import { generateObject, jsonSchema, type LanguageModel } from "ai";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { startIngest } from "./vaultIngest";
import { rag } from "./vaultRag";

const CALL_TIMEOUT_MS = 45_000;

// The free-string vault `kind` for a committed profile (ZERO schema migration — kind is v.string()).
const PROFILE_KIND = "business_profile";

// Map a pricing/audit model id ("openai/gpt-4o-mini") to a direct-OpenAI LanguageModel (mirrors
// vaultLlm.ts resolveModel — the @ai-sdk/openai provider wants the bare name + reads OPENAI_API_KEY).
const resolveModel = (id: string): LanguageModel => openai(id.replace(/^openai\//, ""));

// The Convex arg validator mirroring the pure @pikar/core `ProfileInput` — the profile MINUS the
// tier (Phase 15.1, design §9, defect 1b). There is deliberately NO `persona` field and there never
// will be: the tier is DERIVED from asked facts (`tenantProfile.saveFacts`) and spliced into the
// serialized doc by the write paths below. Because a Convex `v.object` rejects an EXTRA key, a
// caller that sends a tier is refused here — the control is GONE, not hidden (SC#1b, pinned by
// onboarding.test.ts "refuses a caller-supplied tier"). validateProfile re-checks the rest.
const vProfile = v.object({
  name: v.string(),
  oneLineDescription: v.string(),
  stage: v.string(),
  offering: v.string(),
  targetCustomer: v.string(),
  primaryGoals: v.array(v.string()),
  knownConstraints: v.array(v.string()),
});

// generateObject structured-output schema (jsonSchema, not zod — keeps this V8 adapter zod-free like
// vaultLlm/documentSchema). STRICT mode: every property is also `required`.
//
// Defect 1a closed at the STRUCTURAL level: there is no `persona` property, so the model has nowhere
// to put a guess even if a future skill-body edit reintroduced the instruction to make one. A
// classification is ASKED (design §6) and DERIVED (`deriveTier`), never inferred from prose.
const profileSchema = jsonSchema<ProfileInput>({
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "oneLineDescription",
    "stage",
    "offering",
    "targetCustomer",
    "primaryGoals",
    "knownConstraints",
  ],
  properties: {
    name: { type: "string" },
    oneLineDescription: { type: "string" },
    stage: { type: "string" },
    offering: { type: "string" },
    targetCustomer: { type: "string" },
    primaryGoals: { type: "array", items: { type: "string" } },
    knownConstraints: { type: "array", items: { type: "string" } },
  },
});

// ── Offline SMOKE seam (Pitfall 4, mirrors vaultLlm smokeGraphFixture) ────────
// A convex-test / dev smoke drives extraction deterministically and offline (no OPENAI_API_KEY). The
// sentinel carries no PII. Grammar: `SMOKE::profile::<anything>`. The fixture is a fully-populated
// profile so the review/commit E2E runs with no model call.
//
// Phase 15.1: the suffix was `<persona>` and selected the fixture's persona. Extraction emits no
// classification any more, so the suffix is INERT — it is deliberately still ACCEPTED (the grammar
// is unchanged) so every existing caller, fixture and dev smoke keeps working untouched; it simply
// selects nothing. Do not "clean up" by rejecting it: that would be a breaking change to a seam
// whose whole job is to stay boring.
const SMOKE_PROFILE_PREFIX = "SMOKE::profile::";

function smokeProfileFixture(): ProfileInput {
  return {
    name: "Smoke Business",
    oneLineDescription: "A deterministic smoke-fixture business used offline.",
    stage: "early-revenue",
    offering: "A smoke offering.",
    targetCustomer: "Smoke customers.",
    primaryGoals: ["Grow revenue"],
    knownConstraints: ["Solo operator"],
  };
}

/**
 * ONBD-01 first-run gate signal. Returns `{ needsOnboarding: true }` for a tenant with no committed
 * business-profile doc, `false` once one exists (a `failed` ingest doesn't count — the user must
 * re-commit). Refs/booleans ONLY — no profile content crosses this boundary (§4).
 */
export const status = tenantQuery({
  args: {},
  handler: async (ctx): Promise<{ needsOnboarding: boolean }> => {
    const docs = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    const hasProfile = docs.some((d) => d.kind === PROFILE_KIND && d.status !== "failed");
    return { needsOnboarding: !hasProfile };
  },
});

/**
 * ONBD-02 profile read — the edit-form loader. Returns the tenant's committed Lean-core profile as a
 * STRUCTURED object (parsed back from the vault doc's markdown via @pikar/core `deserializeProfile`,
 * the serializer's inverse), or `null` if none is committed yet. There is no separate structured copy
 * — the vault doc `text` is the record — so the parse is the read boundary. Content plane (§4): the
 * returned object is profile CONTENT for the owning tenant's own edit surface, tenant-scoped by
 * `ctx.tenantId`; it is NEVER written to a log.
 */
export const getProfile = tenantQuery({
  args: {},
  handler: async (ctx): Promise<BusinessProfile | null> => {
    const doc = await currentProfileDoc(ctx, ctx.tenantId);
    return doc?.text ? deserializeProfile(doc.text) : null;
  },
});

/**
 * ONBD-01 extraction. Loads the UNGATED business-profile skill (§5, fails closed unseeded) and runs
 * `generateObject` over the intake text, returning the Lean-core structured object to the CALLER
 * ONLY. SC#1: it NEVER auto-commits — no doc insert, no audit write — the draft is reviewed by a
 * human before `commitProfile` writes anything. It returns a `ProfileInput`: no tier, no persona,
 * no classification of any kind (defect 1a). A `SMOKE::profile::` sentinel short-circuits to a
 * deterministic fixture (no model call — the offline/test path).
 */
export const extractProfile = tenantAction({
  args: { intakeText: v.string() },
  handler: async (ctx, { intakeText }): Promise<ProfileInput> => {
    // Load the extraction prompt FIRST (no hardcoded prompt — §5); fails closed unseeded, so the
    // load is exercised even on the offline path.
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      { name: BUSINESS_PROFILE_SKILL },
    );

    if (intakeText.startsWith(SMOKE_PROFILE_PREFIX)) return smokeProfileFixture();

    const { object } = await generateObject({
      model: resolveModel(DEFAULT_MODEL),
      schema: profileSchema,
      system: skill.body,
      prompt: intakeText,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      maxRetries: 1,
    });
    return object;
  },
});

// ── Commit / edit — the persistBrief clone (SC#2/#3, ONBD-02) ─────────────────

// Count populated Lean-core fields (the 5 supplied strings + the 2 lists when non-empty). A refs-only
// audit signal (§4) — a NUMBER, never a field value — so the ops plane can see "a profile landed"
// without the profile becoming a log. Phase 15.1: `persona` left the count because it left the
// INPUT — counting a field the caller cannot supply would report the same +1 on every write.
function populatedFieldCount(p: ProfileInput): number {
  const strings = [p.name, p.oneLineDescription, p.stage, p.offering, p.targetCustomer];
  return (
    strings.filter((s) => s.trim() !== "").length +
    (p.primaryGoals.length > 0 ? 1 : 0) +
    (p.knownConstraints.length > 0 ? 1 : 0)
  );
}

// The SHARED persistBrief clone (voice.ts:299) — the profile is "just another vault doc", so embed +
// tenant scope + retrieval come FREE from startIngest / vaultGroundHydrated (§1). `existing` re-embeds
// an edit IN PLACE on the same row: the stale rag entry is deleted (clean replace) and the row is
// reset to `processing` before re-ingest. `text` is vault CONTENT (§4) — kept on the row, never a log.
// ponytail: an edit re-attributes the graph to the SAME sourceDocId but doesn't GC the prior version's
// edges (upsertGraph dedups new ones; a short structured profile yields few) — the ceiling is routing
// through vault.deleteVaultDoc's full cascade if profile-graph staleness ever matters.
async function writeProfileDoc(
  ctx: MutationCtx,
  tenantId: string,
  profile: BusinessProfile,
  existing?: Doc<"vaultDocuments">,
): Promise<Id<"vaultDocuments">> {
  const text = serializeProfile(profile);
  const hash = await contentHash(text);
  const size = new TextEncoder().encode(text).length;
  const title = profile.name || "Business profile";

  let vaultDocId: Id<"vaultDocuments">;
  if (existing) {
    if (existing.ragEntryId)
      await rag.deleteAsync(ctx, { entryId: existing.ragEntryId as EntryId }); // replace, not orphan
    await ctx.db.patch(existing._id, {
      title,
      text,
      contentHash: hash,
      size,
      status: "processing",
      ragEntryId: undefined,
      failureReason: undefined,
    });
    vaultDocId = existing._id;
  } else {
    vaultDocId = await ctx.db.insert("vaultDocuments", {
      tenantId,
      title,
      kind: PROFILE_KIND, // NEW free-string kind — ZERO schema migration
      category: categoryFor({ source: "agent" }), // → "workspace-docs"
      source: "agent",
      mimeType: "text/markdown",
      size,
      contentHash: hash,
      text, // serializeProfile output — content plane (§4)
      status: "processing",
      createdAt: Date.now(),
    });
  }
  await startIngest(ctx, { vaultDocId, tenantId, correlationId: crypto.randomUUID() });
  return vaultDocId;
}

/**
 * The tenant's tier row — the RECORD (design §4.2). Both write paths read it here and splice
 * `row.tier` into the serialized markdown, which is only ever a PROJECTION of it.
 *
 * A direct `ctx.db` read, deliberately NOT `ctx.runQuery(internal.tenantProfile.forTenant, …)`: this
 * runs inside a mutation, so it is the SAME transaction either way and the query hop buys nothing.
 * `.unique()` mirrors `tenantProfile.byTenant` — one row per tenant is THE invariant of that table,
 * so a duplicate is LOUD rather than silently shadowed.
 */
const currentTierRow = (
  ctx: QueryCtx | MutationCtx,
  tenantId: string,
): Promise<Doc<"tenantProfiles"> | null> =>
  ctx.db
    .query("tenantProfiles")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();

// The tenant's current committed profile doc (newest non-failed), or null. The edit target + the
// re-commit guard.
async function currentProfileDoc(
  ctx: QueryCtx | MutationCtx,
  tenantId: string,
): Promise<Doc<"vaultDocuments"> | null> {
  const docs = await ctx.db
    .query("vaultDocuments")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  const profiles = docs
    .filter((d) => d.kind === PROFILE_KIND && d.status !== "failed")
    .sort((a, b) => b.createdAt - a.createdAt);
  return profiles[0] ?? null;
}

/**
 * ONBD-02 commit — and the design §6 COMPLETION GATE.
 *
 * The reviewed profile becomes a `business_profile` vault doc and is embedded via startIngest —
 * retrievable through searchVault / vaultGroundHydrated (SC#2), tenant-scoped so tenant A's profile
 * never reaches tenant B (SC#3).
 *
 * **First-time onboarding cannot complete while a required fact slot is empty (SC#3b).** The
 * guarantee lives HERE, in code, never in a prompt: "always ask about headcount" in a skill body is
 * a model-temperature guarantee, which is precisely the defect (1a) this phase exists to close. A
 * free-roaming conversation will sometimes get absorbed in the user's product idea and wrap up warm
 * and useless. The refusal is also what makes the tier splice below TOTAL — past this line there is
 * always a row, so the markdown can never project an `undefined` tier.
 *
 * `updateProfile` deliberately carries NO such gate — design §10 forbids forced re-onboarding of a
 * legacy tenant (SC#6c).
 *
 * Emits ONE insert-only audit (§3) whose payload is refs/counts/enums ONLY —
 * `{vaultDocId, fieldCount, tierSource}` — never a field value (§4, SC#4). The old
 * `personaConfirmed: true` is DELETED rather than corrected: the audit table is append-only, so a
 * historical row that claimed a confirmation cannot be repaired; the fix is to stop writing it.
 */
export const commitProfile = tenantMutation({
  args: { profile: vProfile },
  handler: async (ctx, { profile }): Promise<{ vaultDocId: Id<"vaultDocuments"> }> => {
    const check = validateProfile(profile);
    if (!check.ok) throw new ConvexError({ code: "INVALID_PROFILE", errors: check.errors });

    const row = await currentTierRow(ctx, ctx.tenantId);
    const missing = missingSlots({
      ...(row ?? {}),
      oneLineDescription: profile.oneLineDescription,
    });
    // `!row` is redundant at runtime (a missing row leaves all five fact slots missing) and is
    // there so the splice below type-checks without a non-null assertion. Both halves say the same
    // thing: there is no completion without facts.
    if (!row || missing.length > 0) {
      throw new ConvexError({ code: "INCOMPLETE_ONBOARDING", missing });
    }

    // §4.2 — the markdown is a PROJECTION, the table is the record.
    const vaultDocId = await writeProfileDoc(ctx, ctx.tenantId, { ...profile, persona: row.tier });

    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "onboarding.profile_committed",
      actor: "user",
      payload: {
        vaultDocId,
        fieldCount: populatedFieldCount(profile),
        tierSource: row.tierSource,
      },
    });
    return { vaultDocId };
  },
});

/**
 * ONBD-02 edit. Re-embeds the tenant's profile on change so grounding stays current: the prior rag
 * entry is replaced (writeProfileDoc), and searchVault / vaultGroundHydrated return the updated
 * content. Falls back to a fresh commit when no profile doc exists yet (edit-before-commit is a
 * no-throw first commit).
 *
 * **No slot gate here (SC#6c).** A pre-15.1 tenant has a `tierSource: "legacy"` row with no facts at
 * all, and design §10 forbids forcing them back through onboarding — they must still be able to
 * correct their own profile. The gate lives on `commitProfile`, which such a tenant never reaches.
 *
 * A MISSING tier row is still fatal (`INCOMPLETE_FACTS`): after the plan-02 backfill every tenant
 * with a committed profile has one, so its absence means something is wrong — and defaulting to
 * `"solopreneur"` here would be defect 1d in a new costume.
 *
 * Same refs/counts/enums-only audit (§4, SC#4), tagged `reembed`. `personaConfirmed` is gone: on an
 * EDIT it was not merely redundant but FALSE — nothing was confirmed.
 */
export const updateProfile = tenantMutation({
  args: { profile: vProfile },
  handler: async (ctx, { profile }): Promise<{ vaultDocId: Id<"vaultDocuments"> }> => {
    const check = validateProfile(profile);
    if (!check.ok) throw new ConvexError({ code: "INVALID_PROFILE", errors: check.errors });

    const row = await currentTierRow(ctx, ctx.tenantId);
    if (!row) {
      // The same `missing` shape `commitProfile` reports, so one UI branch renders both.
      throw new ConvexError({
        code: "INCOMPLETE_FACTS",
        missing: missingSlots({ oneLineDescription: profile.oneLineDescription }),
      });
    }

    const existing = await currentProfileDoc(ctx, ctx.tenantId);
    // §4.2 — the markdown follows the TABLE, on an edit exactly as on a commit.
    const vaultDocId = await writeProfileDoc(
      ctx,
      ctx.tenantId,
      { ...profile, persona: row.tier },
      existing ?? undefined,
    );

    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "onboarding.profile_updated",
      actor: "user",
      payload: {
        vaultDocId,
        fieldCount: populatedFieldCount(profile),
        tierSource: row.tierSource,
        reembed: existing !== null,
      },
    });
    return { vaultDocId };
  },
});
