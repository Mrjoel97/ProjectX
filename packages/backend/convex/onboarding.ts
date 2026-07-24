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
import { BUSINESS_PROFILE_SKILL } from "@pikar/contracts/skill";
import { type BusinessProfile, isPersona, type Persona } from "@pikar/core";
import { DEFAULT_MODEL } from "@pikar/cost";
import { generateObject, jsonSchema, type LanguageModel } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { tenantAction, tenantQuery } from "./lib/functions";

const CALL_TIMEOUT_MS = 45_000;

// The free-string vault `kind` for a committed profile (ZERO schema migration — kind is v.string()).
const PROFILE_KIND = "business_profile";

// Map a pricing/audit model id ("openai/gpt-4o-mini") to a direct-OpenAI LanguageModel (mirrors
// vaultLlm.ts resolveModel — the @ai-sdk/openai provider wants the bare name + reads OPENAI_API_KEY).
const resolveModel = (id: string): LanguageModel => openai(id.replace(/^openai\//, ""));

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
