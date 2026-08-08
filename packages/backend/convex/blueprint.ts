/**
 * Business-blueprint reads run on the hot path in the DEFAULT (V8) runtime, with no Node directive.
 * Every handler has an explicit Promise return type to prevent generated-API circular inference.
 * CLAUDE.md §2 bans public query/mutation/action builders; these identity-less tenant-scoped
 * readers deliberately use the allowed internalQuery builder and accept an explicit tenantId.
 */
import { openai } from "@ai-sdk/openai";
import { BUSINESS_BLUEPRINT_SKILL } from "@pikar/contracts/skill";
import {
  aggregatePulse,
  BLUEPRINT_FIELDS,
  BLUEPRINT_SEGMENTS,
  type BlueprintDiffRow,
  type BlueprintField,
  type BusinessBlueprint,
  type DerivedCandidate,
  deserializeBlueprint,
  deserializeProfile,
  dispatchToolFor,
  FIELD_SPEC,
  mergeBlueprint,
  PULSE_WINDOW_MS,
  type PulseGlobals,
  type PulseStep,
  probesFor,
  renderSpine,
  type SegmentPulse,
  serializeBlueprint,
  statedFromProfile,
  validateCandidates,
} from "@pikar/core";
import { DEFAULT_MODEL, priceUsage } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import { categoryFor } from "@pikar/vault";
import { generateObject, jsonSchema, type LanguageModel } from "ai";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { toGoal } from "./goals";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { sealedIn } from "./vaultFolders";

const TOP_ENTITY_COUNT = 20;
const DRIFT_SCAN_CAP = 100;
const CALL_TIMEOUT_MS = 45_000;
const SMOKE_BLUEPRINT_PREFIX = "SMOKE::blueprint::";

const resolveModel = (id: string): LanguageModel => openai(id.replace(/^openai\//, ""));

type DeriveCandidatesResult =
  | {
      ok: false;
      reason:
        | "kill_switch"
        | "daily_budget_exhausted"
        | "deployment_budget_exhausted"
        | "deployment_budget_exhausted";
    }
  | { ok: true; candidates: DerivedCandidate[] };

type GroundedSource = { docId: string; title: string; text: string };
type HydratedGround = { docIds: string[]; titles: string[]; chunks: string[] };
type Probe = { field: BlueprintField; query: string };
type BuildBlueprintDraftResult =
  | {
      ok: false;
      reason:
        | "kill_switch"
        | "daily_budget_exhausted"
        | "deployment_budget_exhausted"
        | "deployment_budget_exhausted";
    }
  | {
      ok: true;
      additions: number;
      contradictions: number;
      dropped: number;
      sourceDocCount: number;
    };
type BlueprintDraft = {
  blueprint: BusinessBlueprint;
  diff: BlueprintDiffRow[];
  sourceDocIds: string[];
};
type ConfirmBlueprintResult =
  | { ok: false; reason: "no_draft" }
  | { ok: true; docId: Id<"vaultDocuments"> };
type BlueprintStateResult = {
  state: "none" | "live" | "live_stale" | "draft";
  live: BusinessBlueprint | null;
  draft: BusinessBlueprint | null;
  diff: BlueprintDiffRow[];
  unincorporatedCount: number;
  confirmedAt: number | null;
};

const BLUEPRINT_KIND = "business_blueprint";
const BLUEPRINT_TITLE = "Business blueprint";
const BLUEPRINT_FIELD_SET = new Set<string>(BLUEPRINT_FIELDS);

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

/**
 * Sequentially grounds every blank-field probe and folds the parallel arrays into one
 * source-indexed list. Exported only so the offline test can inject a deterministic grounding
 * function; production passes `vaultGroundHydrated` verbatim.
 */
export async function __collectGroundedSources(
  probes: readonly Probe[],
  ground: (query: string) => Promise<HydratedGround>,
): Promise<GroundedSource[]> {
  const sources: GroundedSource[] = [];
  const indexByDocId = new Map<string, number>();

  // ponytail: N sequential vaultGroundHydrated actions, one rag.search each (about six on this
  // cold path). Upgrade path if latency bites: one action that accepts all N queries.
  for (const { query } of probes) {
    const { docIds, titles, chunks } = await ground(query);
    for (let index = 0; index < docIds.length; index += 1) {
      const docId = docIds[index];
      if (!docId) continue;
      const text = chunks[index] ?? "";
      const existingIndex = indexByDocId.get(docId);
      if (existingIndex !== undefined) {
        const existing = sources[existingIndex];
        if (existing && text && !existing.text.includes(text)) {
          existing.text = `${existing.text}\n\n${text}`.trim();
        }
        continue;
      }
      indexByDocId.set(docId, sources.length);
      sources.push({ docId, title: titles[index] ?? "", text });
    }
  }
  return sources;
}

type LiveBlueprint = {
  docId: string;
  text: string;
  sourceDocIds: readonly string[];
  confirmedAt: number | null;
};

async function readLiveForTenant(ctx: QueryCtx, tenantId: string): Promise<LiveBlueprint | null> {
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
  handler: async (ctx, { tenantId }): Promise<LiveBlueprint | null> =>
    await readLiveForTenant(ctx, tenantId),
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

/** Cold synthesis-only read: whether a live blueprint has any ready document drift. */
export const unincorporatedCountForTenant = internalQuery({
  args: { tenantId: v.string(), sourceDocIds: v.array(v.string()) },
  handler: async (ctx, { tenantId, sourceDocIds }): Promise<number> =>
    (await unincorporatedFor(ctx, tenantId, sourceDocIds)).count,
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
  handler: async (ctx, { tenantId, fields, sources }): Promise<DeriveCandidatesResult> => {
    // FIN-01 replay identity, MINTED not derived. Nothing journaled reaches here: the only ref in
    // scope is `tenantId`, and `buildBlueprintDraft` (a plain tenantAction) can be re-run — or
    // re-entered on action retry — as often as the user presses "Build blueprint". Each re-entry
    // re-runs the generateObject below, so the second charge is REAL; a tenant-scoped constant
    // would collapse every rebuild after the first onto one `actual` row and put the ledger below
    // the limiter, the unrecoverable direction. There is exactly one model call per run, so the
    // runId alone separates run N from run N+1.
    const runId = crypto.randomUUID();
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      { name: BUSINESS_BLUEPRINT_SKILL },
    );

    const gate = await ctx.runMutation(internal.guardrails.preCall, { tenantId });
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
      await ctx.runMutation(internal.guardrails.recordSpend, {
        tenantId,
        costUsd: priced.value,
        correlationId: `blueprint:derive:${runId}`,
        model: DEFAULT_MODEL,
        kind: "blueprint.derive", // code-owned token, refs only (§4)
      });
    }
    return { ok: true, candidates: object.candidates };
  },
});

/** Persist a draft on an EXISTING tier row. Never inserts, replaces, or touches live source ids. */
export const writeDraft = internalMutation({
  args: { tenantId: v.string(), draftJson: v.string() },
  handler: async (ctx, { tenantId, draftJson }): Promise<void> => {
    const existing = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    if (!existing) throw new ConvexError({ code: "NO_TENANT_PROFILE" });
    await ctx.db.patch(existing._id, {
      blueprintDraft: draftJson,
      blueprintDraftAt: Date.now(),
    });
  },
});

/**
 * D2's only promotion path: one persisted draft becomes the one live Blueprint document.
 *
 * DELIBERATE EXCEPTION to the vault ingest invariant: this document is written directly at
 * `status: "ready"` and no ingest workflow is started. The Blueprint is NOT embedded and NOT
 * graph-extracted. The standing spine already injects it unconditionally; retrieval would both
 * duplicate it and feed its entities back into the graph that the next rebuild ranks.
 */
export const confirmBlueprint = tenantMutation({
  args: { acceptedContradictions: v.array(v.string()) },
  handler: async (ctx, { acceptedContradictions }): Promise<ConfirmBlueprintResult> => {
    const row = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (!row?.blueprintDraft) return { ok: false, reason: "no_draft" };

    for (const field of acceptedContradictions) {
      if (!BLUEPRINT_FIELD_SET.has(field)) {
        throw new ConvexError({ code: "INVALID_BLUEPRINT_FIELD", field });
      }
    }

    const draft = JSON.parse(row.blueprintDraft) as BlueprintDraft;
    const accepted = new Set(acceptedContradictions);
    const final: { -readonly [K in BlueprintField]: BusinessBlueprint[K] } = {
      ...draft.blueprint,
    };
    for (const diffRow of draft.diff) {
      if (diffRow.kind !== "contradiction") continue;
      final[diffRow.field] = accepted.has(diffRow.field) ? diffRow.derived : diffRow.stated;
    }

    const text = serializeBlueprint(final);
    const hash = await contentHash(text);
    const size = new TextEncoder().encode(text).length;
    const pointedDoc = row.blueprintDocId ? await ctx.db.get(row.blueprintDocId) : null;

    let docId: Id<"vaultDocuments">;
    if (pointedDoc?.tenantId === ctx.tenantId && pointedDoc.kind === BLUEPRINT_KIND) {
      await ctx.db.patch(pointedDoc._id, {
        title: BLUEPRINT_TITLE,
        text,
        contentHash: hash,
        size,
        status: "ready",
      });
      docId = pointedDoc._id;
    } else {
      docId = await ctx.db.insert("vaultDocuments", {
        tenantId: ctx.tenantId,
        title: BLUEPRINT_TITLE,
        kind: BLUEPRINT_KIND,
        category: categoryFor({ source: "agent" }),
        source: "agent",
        mimeType: "text/markdown",
        size,
        contentHash: hash,
        text,
        status: "ready",
        createdAt: Date.now(),
      });
    }

    await ctx.db.patch(row._id, {
      blueprintDocId: docId,
      blueprintConfirmedAt: Date.now(),
      blueprintSourceDocIds: draft.sourceDocIds,
      blueprintDraft: undefined,
      blueprintDraftAt: undefined,
    });
    const sourceDocCount = draft.sourceDocIds.length;
    const fieldCount = BLUEPRINT_FIELDS.filter((field) => final[field] !== null).length;
    const additionsApplied = draft.diff.filter((diffRow) => diffRow.kind === "addition").length;
    const contradictionsAccepted = draft.diff.filter(
      (diffRow) => diffRow.kind === "contradiction" && accepted.has(diffRow.field),
    ).length;
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "blueprint.confirmed",
      actor: "user",
      // §4: refs and COUNTS only. Never a field value — this table must not become a honeypot.
      // The test asserts the sorted KEY SET, so an added key fails there rather than shipping.
      payload: {
        docId,
        sourceDocCount,
        fieldCount,
        additionsApplied,
        contradictionsAccepted,
      },
    });
    return { ok: true, docId };
  },
});

/**
 * `blueprintState` gives `draft` precedence over `live`, so without this a user who opened a draft
 * could never see their live blueprint again without confirming SOMETHING. Discard must discard.
 */
export const discardDraft = tenantMutation({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean }> => {
    const row = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (!row) return { ok: false };
    await ctx.db.patch(row._id, {
      blueprintDraft: undefined,
      blueprintDraftAt: undefined,
    });
    return { ok: true };
  },
});

/** The profile page's one read for the complete four-state Blueprint surface. */
export const blueprintState = tenantQuery({
  args: {},
  handler: async (ctx): Promise<BlueprintStateResult> => {
    const row = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    const liveRow = await readLiveForTenant(ctx, ctx.tenantId);
    const live = liveRow ? deserializeBlueprint(liveRow.text) : null;
    const unincorporatedCount = liveRow
      ? (await unincorporatedFor(ctx, ctx.tenantId, liveRow.sourceDocIds)).count
      : 0;

    let draft: BusinessBlueprint | null = null;
    let diff: BlueprintDiffRow[] = [];
    if (row?.blueprintDraft) {
      const draftBlob = JSON.parse(row.blueprintDraft) as BlueprintDraft;
      draft = draftBlob.blueprint;
      diff = draftBlob.diff;
    }

    const state: BlueprintStateResult["state"] =
      draft !== null
        ? "draft"
        : live === null
          ? "none"
          : unincorporatedCount > 0
            ? "live_stale"
            : "live";
    return {
      state,
      live,
      draft,
      diff,
      unincorporatedCount,
      confirmedAt: liveRow?.confirmedAt ?? null,
    };
  },
});

/**
 * User-facing "Build blueprint" action: typed profile + graph + grounded blanks → one draft blob.
 * Derived content is never written to the vault and therefore cannot reach an agent before confirm.
 */
export const buildBlueprintDraft = tenantAction({
  args: {},
  handler: async (ctx): Promise<BuildBlueprintDraftResult> => {
    const tenantId = ctx.tenantId;
    const row: Doc<"tenantProfiles"> | null = await ctx.runQuery(internal.tenantProfile.forTenant, {
      tenantId,
    });
    if (!row) throw new ConvexError({ code: "NO_TENANT_PROFILE" });

    const profileDocs: { docId: string; title: string; text: string }[] = await ctx.runQuery(
      internal.vault.profileSeedDocs,
      { tenantId },
    );
    const profile = deserializeProfile(profileDocs[0]?.text ?? "");
    const entities: string[] = await ctx.runQuery(internal.blueprint.topEntities, { tenantId });
    const stated = statedFromProfile(profile, row.tier, entities);

    const live: LiveBlueprint | null = await ctx.runQuery(internal.blueprint.liveForTenant, {
      tenantId,
    });
    const liveBlueprint = live ? deserializeBlueprint(live.text) : null;

    // A one-line typed-profile edit over a current live blueprint is free: reuse the live derived
    // slots. If any ready document is new, probe the blanks so a user-triggered rebuild still
    // performs Stage-2 drift detection rather than freezing yesterday's inferences.
    const unincorporatedCount =
      live === null
        ? 0
        : await ctx.runQuery(internal.blueprint.unincorporatedCountForTenant, {
            tenantId,
            sourceDocIds: [...live.sourceDocIds],
          });
    const probeBase =
      liveBlueprint !== null && unincorporatedCount === 0
        ? { ...liveBlueprint, ...stated }
        : stated;
    const probes = probesFor(probeBase);

    const sources = await __collectGroundedSources(probes, async (query) =>
      ctx.runAction(internal.vaultGround.vaultGroundHydrated, { tenantId, query }),
    );

    let derived: ReturnType<typeof validateCandidates>["derived"] = {};
    let dropped: ReturnType<typeof validateCandidates>["dropped"] = [];
    if (probes.length > 0) {
      const synthesis: DeriveCandidatesResult = await ctx.runAction(
        internal.blueprint.deriveCandidates,
        {
          tenantId,
          fields: probes.map(({ field }) => field),
          sources: sources.map(({ title, text }) => ({ title, text })),
        },
      );
      if (!synthesis.ok) return synthesis;
      ({ derived, dropped } = validateCandidates(synthesis.candidates, sources));
    }

    const { blueprint, diff } = mergeBlueprint(stated, derived, liveBlueprint);
    const sourceDocIds =
      sources.length > 0 ? sources.map(({ docId }) => docId) : [...(live?.sourceDocIds ?? [])];
    await ctx.runMutation(internal.blueprint.writeDraft, {
      tenantId,
      draftJson: JSON.stringify({ blueprint, diff, sourceDocIds }),
    });

    return {
      ok: true,
      additions: diff.filter((item: BlueprintDiffRow) => item.kind === "addition").length,
      contradictions: diff.filter((item: BlueprintDiffRow) => item.kind === "contradiction").length,
      dropped: dropped.length,
      sourceDocCount: sources.length,
    };
  },
});

type BlueprintPulseResult = {
  segments: Record<string, SegmentPulse>;
  globals: PulseGlobals;
};

/**
 * The pulse layer's ONE read (living-map §3.1). Counts and timestamps only cross the wire (D6):
 * the narrowing into `PulseStep` below is the enforcement point — nothing content-shaped leaves.
 * `now` is a client arg: queries must be deterministic, and the 30-day window is the client's
 * clock's business.
 */
export const blueprintPulse = tenantQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<BlueprintPulseResult> => {
    const since = now - PULSE_WINDOW_MS;
    const steps: PulseStep[] = [];
    for (const segment of BLUEPRINT_SEGMENTS) {
      const tool = dispatchToolFor(segment);
      if (tool === null) continue;
      const rows = await ctx.db
        .query("agentSteps")
        .withIndex("by_tenant_tool_startedAt", (q) =>
          q
            .eq("tenantId", ctx.tenantId)
            // Safe: dispatchToolFor returns SPECIALISTS[*].stepTool, each a member of the closed
            // agentSteps.tool union (core's totality test asserts distinctness+shape).
            .eq("tool", tool as never)
            .gt("startedAt", since),
        )
        .collect();
      for (const r of rows)
        steps.push({
          tool: r.tool,
          phase: r.phase,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          durationMs: r.durationMs,
        });
    }

    // Windowed on createdAt (the existing index), not on reaching the status — a send/plan created
    // >30d ago that completes today is missed. Day-granular readout; the approximation is acceptable
    // and named.
    const sent = await ctx.db
      .query("requests")
      .withIndex("by_tenant_status_createdAt", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("status", "sent").gt("createdAt", since),
      )
      .collect();
    const done = await ctx.db
      .query("plans")
      .withIndex("by_tenant_status_createdAt", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("status", "done").gt("createdAt", since),
      )
      .collect();
    let plansInFlight = 0;
    for (const status of ["collecting", "proposed", "delivering"] as const) {
      const rows = await ctx.db
        .query("plans")
        .withIndex("by_tenant_status_createdAt", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("status", status),
        )
        .collect();
      plansInFlight += rows.length;
    }

    return {
      segments: aggregatePulse(steps, now),
      globals: { sent30d: sent.length, plansDone30d: done.length, plansInFlight },
    };
  },
});

/** Stage-1 drift: a pure set difference, no detector, no cron (CONTEXT: "there is no separate
 *  drift detector"). `ready` docs whose id is not in the LIVE blueprint's source set.
 *  ponytail: a PLAIN async helper, not a registered internalQuery — every caller
 *  (`spineForTenant`, synthesis's thin count query here, `blueprintState` in plan 08) lives in
 *  this module; only the action needs a registered hop because actions cannot read `ctx.db`. */
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
  // SEALING (VALT-07), site 3 of 3 — the one that is easiest to miss and most expensive to miss.
  // A folder's members reach `status: "ready"` at ingest step 6 DURING the sealed window, and
  // `spineForTenant` runs this helper on EVERY grounding call. Without the filter, uploading a
  // folder makes the blueprint spine announce drift the user cannot act on, on every cockpit turn,
  // for the whole ingest window — a user-visible lie about their own vault. The predicate is
  // `vaultFolders.sealedIn`, called directly on rows already read here (no second doc read).
  const sealed = await sealedIn(ctx, ready);
  const docIds = ready
    .filter(
      (doc) => doc.kind !== "business_blueprint" && !sourceSet.has(doc._id) && !sealed.has(doc._id),
    )
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
      const goalRows = await ctx.db
        .query("goals")
        .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "active"))
        .collect();
      return renderSpine(blueprint, {
        unincorporatedCount: count,
        goals: goalRows.map(toGoal),
      });
    } catch {
      return null;
    }
  },
});
