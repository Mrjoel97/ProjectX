/**
 * Business-blueprint reads run on the hot path in the DEFAULT (V8) runtime, with no Node directive.
 * Every handler has an explicit Promise return type to prevent generated-API circular inference.
 * CLAUDE.md §2 bans public query/mutation/action builders; these identity-less tenant-scoped
 * readers deliberately use the allowed internalQuery builder and accept an explicit tenantId.
 */
import { openai } from "@ai-sdk/openai";
import { BUSINESS_BLUEPRINT_SKILL } from "@pikar/contracts/skill";
import { DEFAULT_MODEL, priceUsage } from "@pikar/cost";
import {
  deserializeBlueprint,
  FIELD_SPEC,
  renderSpine,
  type DerivedCandidate,
} from "@pikar/core";
import { scanText } from "@pikar/pii";
import { generateObject, jsonSchema, type LanguageModel } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery, type QueryCtx } from "./_generated/server";

const TOP_ENTITY_COUNT = 20;
const DRIFT_SCAN_CAP = 100;
const CALL_TIMEOUT_MS = 45_000;
const SMOKE_BLUEPRINT_PREFIX = "SMOKE::blueprint::";

const resolveModel = (id: string): LanguageModel => openai(id.replace(/^openai\//, ""));

type DeriveCandidatesResult =
  | { ok: false; reason: "kill_switch" | "daily_budget_exhausted" }
  | { ok: true; candidates: DerivedCandidate[] };

const candidatesSchema = jsonSchema<{ candidates: DerivedCandidate[] }>({
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "values", "sourceIndex"],
        properties: {
          field: { type: "string" },
          values: { type: "array", items: { type: "string" } },
          sourceIndex: { type: "integer" },
        },
      },
    },
  },
});

function smokeCandidatesFixture(safeText: string): DerivedCandidate[] {
  const start = safeText.indexOf(SMOKE_BLUEPRINT_PREFIX);
  if (start === -1) return [];
  const line = safeText.slice(start + SMOKE_BLUEPRINT_PREFIX.length).split(/\r?\n/, 1)[0] ?? "";
  const candidates: DerivedCandidate[] = [];
  for (const segment of line.split("::")) {
    const [field, rawValues, rawSourceIndex] = segment.split("|");
    const sourceIndex = Number(rawSourceIndex);
    if (!field || !rawValues || !Number.isInteger(sourceIndex)) continue;
    candidates.push({
      field,
      values: rawValues
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      sourceIndex,
    });
  }
  return candidates;
}

function candidatePrompt(
  fields: readonly string[],
  sources: readonly { title: string; text: string }[],
): string {
  const fieldBlock = fields
    .map((field) => {
      const spec = Object.hasOwn(FIELD_SPEC, field)
        ? FIELD_SPEC[field as keyof typeof FIELD_SPEC]
        : undefined;
      return `- ${field}: ${spec?.probe ?? "derive only when a cited source supports it"}`;
    })
    .join("\n");
  const sourceBlock = sources
    .map(({ title, text }, index) => `[${index}] ${title}\n${text}`)
    .join("\n\n");
  return `FIELDS TO FILL:\n${fieldBlock}\n\nSOURCES:\n${sourceBlock}`;
}

type LiveBlueprint = {
  docId: string;
  text: string;
  sourceDocIds: readonly string[];
  confirmedAt: number | null;
};

async function readLiveForTenant(
  ctx: QueryCtx,
  tenantId: string,
): Promise<LiveBlueprint | null> {
  try {
    const profile = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    if (!profile?.blueprintDocId) return null;

    const doc = await ctx.db.get(profile.blueprintDocId);
    if (doc?.tenantId !== tenantId || doc.kind !== "business_blueprint" || !doc.text) return null;

    return {
      docId: doc._id,
      text: doc.text,
      sourceDocIds: profile.blueprintSourceDocIds ?? [],
      confirmedAt: profile.blueprintConfirmedAt ?? null,
    };
  } catch {
    return null;
  }
}

/** The live blueprint, read in TWO document reads. The unbounded `.collect` shape used by
 *  `currentProfileDoc` (onboarding.ts:521-533) is FORBIDDEN here: it reads every vaultDocuments row
 *  INCLUDING the `text` blob, and this runs on every grounding call. */
export const liveForTenant = internalQuery({
  args: { tenantId: v.string() },
  handler: async (
    ctx,
    { tenantId },
  ): Promise<LiveBlueprint | null> => await readLiveForTenant(ctx, tenantId),
});

/** Top graph entities by degree — a free DB read, one of the blueprint's three inputs (D4). */
export const topEntities = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<string[]> =>
    (
      await ctx.db
        .query("graphNodes")
        .withIndex("by_tenant_degree", (q) => q.eq("tenantId", tenantId))
        .order("desc")
        .take(TOP_ENTITY_COUNT)
    ).map((node) => node.name),
});

/**
 * The blueprint's ONE governed model call. The skill load is deliberately first, including before
 * the offline seam: an unseeded deployment must never synthesize from a hardcoded fallback.
 */
export const deriveCandidates = internalAction({
  args: {
    tenantId: v.string(),
    fields: v.array(v.string()),
    sources: v.array(v.object({ title: v.string(), text: v.string() })),
  },
  handler: async (ctx, { fields, sources }): Promise<DeriveCandidatesResult> => {
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      { name: BUSINESS_BLUEPRINT_SKILL },
    );

    const gate = await ctx.runMutation(internal.guardrails.preCall, {});
    if (!gate.ok) return { ok: false, reason: gate.reason };

    const scan = scanText(candidatePrompt(fields, sources));
    if (!scan.ok) throw new Error("blueprint: candidate scan failed");
    const safePrompt = scan.value.safeText;

    if (safePrompt.includes(SMOKE_BLUEPRINT_PREFIX)) {
      return { ok: true, candidates: smokeCandidatesFixture(safePrompt) };
    }

    const { object, usage } = await generateObject({
      model: resolveModel(DEFAULT_MODEL),
      schema: candidatesSchema,
      system: skill.body,
      prompt: safePrompt,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      maxRetries: 1,
    });
    const priced = priceUsage(DEFAULT_MODEL, usage);
    if (priced.ok) {
      await ctx.runMutation(internal.guardrails.recordSpend, { costUsd: priced.value });
    }
    return { ok: true, candidates: object.candidates };
  },
});

/** Stage-1 drift: a pure set difference, no detector, no cron (CONTEXT: "there is no separate
 *  drift detector"). `ready` docs whose id is not in the LIVE blueprint's source set.
 *  ponytail: a PLAIN async helper, not a registered internalQuery — every caller
 *  (`spineForTenant` here, `blueprintState` in plan 08) lives in this module, so registering it
 *  would add a `ctx.runQuery` hop to the exact path this plan exists to keep cheap. */
async function unincorporatedFor(
  ctx: QueryCtx,
  tenantId: string,
  sourceDocIds: readonly string[],
): Promise<{ count: number; docIds: string[] }> {
  const sourceSet = new Set(sourceDocIds);
  /**
   * ponytail: Convex has no projection, so this bounded read pulls whole rows including `text`.
   * Ceiling ≈ 100 × document size per grounding call. Upgrade path: maintain
   * `blueprintStaleCount` on tenantProfiles and increment it when a document reaches `ready`.
   * Deliberately deferred because that requires editing `vaultIngest.ts`, which Phase 15.2's lane
   * is actively restructuring (the same reason the automatic Stage-2 trigger is deferred).
   */
  const ready = await ctx.db
    .query("vaultDocuments")
    .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "ready"))
    .take(DRIFT_SCAN_CAP);
  const docIds = ready
    .filter((doc) => doc.kind !== "business_blueprint" && !sourceSet.has(doc._id))
    .map((doc) => doc._id);
  return { count: docIds.length, docIds };
}

/** The ONE function both seams call (BLPR-02). Returns the rendered standing-context block, or
 *  null when the tenant has no live blueprint — in which case every caller's output is
 *  byte-identical to today. */
export const spineForTenant = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<string | null> => {
    try {
      const live = await readLiveForTenant(ctx, tenantId);
      if (live === null) return null;
      const blueprint = deserializeBlueprint(live.text);
      const { count } = await unincorporatedFor(ctx, tenantId, live.sourceDocIds);
      return renderSpine(blueprint, { unincorporatedCount: count });
    } catch {
      return null;
    }
  },
});
