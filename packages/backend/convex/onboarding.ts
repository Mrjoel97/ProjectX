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
  isPersona,
  type Persona,
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
import { contentHash } from "./lib/hash";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";
import { startIngest } from "./vaultIngest";
import { rag } from "./vaultRag";

const CALL_TIMEOUT_MS = 45_000;

// The free-string vault `kind` for a committed profile (ZERO schema migration — kind is v.string()).
const PROFILE_KIND = "business_profile";

// Map a pricing/audit model id ("openai/gpt-4o-mini") to a direct-OpenAI LanguageModel (mirrors
// vaultLlm.ts resolveModel — the @ai-sdk/openai provider wants the bare name + reads OPENAI_API_KEY).
const resolveModel = (id: string): LanguageModel => openai(id.replace(/^openai\//, ""));

// The Convex arg validator mirroring the pure @pikar/core BusinessProfile. persona is the locked
// union (enterprise is not emittable — SC#1). validateProfile re-checks at the write boundary.
const vProfile = v.object({
  name: v.string(),
  oneLineDescription: v.string(),
  persona: v.union(v.literal("solopreneur"), v.literal("startup"), v.literal("sme")),
  stage: v.string(),
  offering: v.string(),
  targetCustomer: v.string(),
  primaryGoals: v.array(v.string()),
  knownConstraints: v.array(v.string()),
});

// generateObject structured-output schema (jsonSchema, not zod — keeps this V8 adapter zod-free like
// vaultLlm/documentSchema). STRICT mode: every property is also `required`. persona is enum-locked so
// the model can never emit `enterprise` (SC#1 backstop; validateProfile is the trust-boundary gate).
const profileSchema = jsonSchema<BusinessProfile>({
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "oneLineDescription",
    "persona",
    "stage",
    "offering",
    "targetCustomer",
    "primaryGoals",
    "knownConstraints",
  ],
  properties: {
    name: { type: "string" },
    oneLineDescription: { type: "string" },
    persona: { type: "string", enum: ["solopreneur", "startup", "sme"] },
    stage: { type: "string" },
    offering: { type: "string" },
    targetCustomer: { type: "string" },
    primaryGoals: { type: "array", items: { type: "string" } },
    knownConstraints: { type: "array", items: { type: "string" } },
  },
});

// ── Offline SMOKE seam (Pitfall 4, mirrors vaultLlm smokeGraphFixture) ────────
// A convex-test / dev smoke drives extraction deterministically and offline (no OPENAI_API_KEY). The
// sentinel carries no PII. Grammar: `SMOKE::profile::<persona>` (persona optional → solopreneur). The
// fixture is a fully-populated best-fit profile so the confirm/commit E2E runs with no model call.
const SMOKE_PROFILE_PREFIX = "SMOKE::profile::";

function smokeProfileFixture(intakeText: string): BusinessProfile {
  const raw = intakeText.slice(SMOKE_PROFILE_PREFIX.length).trim();
  const persona: Persona = isPersona(raw) ? raw : "solopreneur";
  return {
    name: "Smoke Business",
    oneLineDescription: "A deterministic smoke-fixture business used offline.",
    persona,
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
 * `generateObject` over the intake text, returning the Lean-core structured object (incl. a best-fit
 * persona) to the CALLER ONLY. SC#1: it NEVER auto-commits — no doc insert, no audit write — the
 * persona is a candidate a human confirms via commitProfile. A `SMOKE::profile::` sentinel short-
 * circuits to a deterministic fixture (no model call — the offline/test path).
 */
export const extractProfile = tenantAction({
  args: { intakeText: v.string() },
  handler: async (ctx, { intakeText }): Promise<BusinessProfile> => {
    // Load the extraction prompt FIRST (no hardcoded prompt — §5); fails closed unseeded, so the
    // load is exercised even on the offline path.
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      { name: BUSINESS_PROFILE_SKILL },
    );

    if (intakeText.startsWith(SMOKE_PROFILE_PREFIX)) return smokeProfileFixture(intakeText);

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

// Count populated Lean-core fields (the 6 required strings + the 2 lists when non-empty). A refs-only
// audit signal (§4) — a NUMBER, never a field value — so the ops plane can see "a profile landed"
// without the profile becoming a log.
function populatedFieldCount(p: BusinessProfile): number {
  const strings = [p.name, p.oneLineDescription, p.persona, p.stage, p.offering, p.targetCustomer];
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
 * ONBD-02 commit. The reviewed, human-confirmed profile becomes a `business_profile` vault doc and is
 * embedded via startIngest — retrievable through searchVault / vaultGroundHydrated (SC#2), tenant-
 * scoped so tenant A's profile never reaches tenant B (SC#3). Emits ONE insert-only audit (§3) whose
 * payload is refs/counts/booleans ONLY — {vaultDocId, fieldCount, personaConfirmed} — never a field
 * value (§4, SC#4). validateProfile is the trust-boundary gate (an invalid profile never persists).
 */
export const commitProfile = tenantMutation({
  args: { profile: vProfile },
  handler: async (ctx, { profile }): Promise<{ vaultDocId: Id<"vaultDocuments"> }> => {
    const check = validateProfile(profile);
    if (!check.ok) throw new ConvexError({ code: "INVALID_PROFILE", errors: check.errors });

    const vaultDocId = await writeProfileDoc(ctx, ctx.tenantId, profile);

    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "onboarding.profile_committed",
      actor: "user",
      payload: { vaultDocId, fieldCount: populatedFieldCount(profile), personaConfirmed: true },
    });
    return { vaultDocId };
  },
});

/**
 * ONBD-02 edit. Re-embeds the tenant's profile on change so grounding stays current: the prior rag
 * entry is replaced (writeProfileDoc), and searchVault / vaultGroundHydrated return the updated
 * content. Falls back to a fresh commit when no profile exists yet (edit-before-commit is a no-throw
 * first commit). Same refs/counts-only audit (§4, SC#4), tagged `reembed`.
 */
export const updateProfile = tenantMutation({
  args: { profile: vProfile },
  handler: async (ctx, { profile }): Promise<{ vaultDocId: Id<"vaultDocuments"> }> => {
    const check = validateProfile(profile);
    if (!check.ok) throw new ConvexError({ code: "INVALID_PROFILE", errors: check.errors });

    const existing = await currentProfileDoc(ctx, ctx.tenantId);
    const vaultDocId = await writeProfileDoc(ctx, ctx.tenantId, profile, existing ?? undefined);

    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "onboarding.profile_updated",
      actor: "user",
      payload: {
        vaultDocId,
        fieldCount: populatedFieldCount(profile),
        personaConfirmed: true,
        reembed: existing !== null,
      },
    });
    return { vaultDocId };
  },
});
