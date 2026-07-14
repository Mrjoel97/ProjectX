// Cockpit plan/draft content-plane adapter (CLAUDE.md §1: thin adapter; §4: raw
// content — recipients/subject/body — lives HERE, never in an audit/DLQ payload).
//
// DECISION #1: the `plans` table is the plan/draft content plane; the REPORT is a
// LIVE PROJECTION over the fan-out `requests` rows (by_plan), NOT a patched report[]
// array and NOT a writer. Reactivity of requests.status + the gmail.sent audit insert
// makes the report fill live per recipient — this module writes no report field.
//
// Writers are internal (called by the agent action / executePlan / the fan-out
// workflow). Readers are tenantQuery so the browser subscribes and the PLAN/DRAFT/
// REPORT cards update live; every reader is guarded on ctx.tenantId (no cross-tenant leak).
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { tenantQuery } from "./lib/functions";

// PINNED plan lifecycle (schema.ts): collecting → proposed → approved → delivering → done.
const PLAN_STATUS = v.union(
  v.literal("collecting"),
  v.literal("proposed"),
  v.literal("approved"),
  v.literal("delivering"),
  v.literal("done"),
);

// Mirrors plans.candidates in schema.ts (mirrors @pikar/core ContactMatch/NameCandidates, Plan 01).
const CANDIDATES = v.array(
  v.object({
    name: v.string(),
    matches: v.array(
      v.object({
        address: v.string(),
        displayName: v.optional(v.string()),
        lastSubject: v.optional(v.string()),
        lastDateMs: v.optional(v.number()),
        count: v.number(),
      }),
    ),
  }),
);

// Mirrors plans.attachments in schema.ts — generated outbound attachment refs (CKPT-02).
const ATTACHMENTS = v.array(
  v.object({
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
  }),
);

/**
 * Create the single `plans` row for a thread (the agent creates it on first turn).
 * Starts at "collecting" with empty recipients; returns planId for the conversation to patch.
 */
export const insertPlan = internalMutation({
  args: { tenantId: v.string(), threadId: v.string() },
  handler: async (ctx, { tenantId, threadId }) =>
    await ctx.db.insert("plans", {
      tenantId,
      threadId,
      status: "collecting",
      recipients: [],
      createdAt: Date.now(),
    }),
});

/**
 * Patch slot fields as the guided conversation fills them and when the draft lands
 * (status → "proposed"). Only supplied fields are written (undefined = untouched).
 */
export const patchPlan = internalMutation({
  args: {
    planId: v.id("plans"),
    recipients: v.optional(v.array(v.string())),
    mode: v.optional(v.union(v.literal("individual"), v.literal("group"))),
    subject: v.optional(v.string()),
    bodyIntent: v.optional(v.string()),
    body: v.optional(v.string()),
    status: v.optional(PLAN_STATUS),
    greetingName: v.optional(v.string()), // resolve path persists the drafter greeting through patchPlan
    recipientBodies: v.optional(v.record(v.string(), v.string())), // address(lowercased) → tailored body override (CKPT-03); the tool passes the full merged map
  },
  handler: async (ctx, { planId, ...patch }) => {
    // Drop undefined keys so a partial patch never clobbers a filled slot with undefined.
    const fields = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(planId, fields);
  },
});

/** Terminal/CAS-friendly status setter (executePlan → approved; fan-out → done). */
export const setPlanStatus = internalMutation({
  args: { planId: v.id("plans"), status: PLAN_STATUS },
  handler: async (ctx, { planId, status }) => {
    await ctx.db.patch(planId, { status });
  },
});

/**
 * TRANSIENT candidate writer (cockpit calls after a name search). Holds fetched
 * candidates + same-turn pendingValid addresses on the content plane so the resolution
 * card renders across turns. Content-plane only — never audited (CLAUDE.md §4).
 *
 * ADDITIVE (upsert-by-name): resolveContacts searches ONE name per call, but the agent
 * resolves EACH named person in a multi-name turn ("Sarah and Zach") with its own call.
 * A wholesale replace let the second search obliterate the first — one name silently
 * dropped from the ResolutionCard while the agent's reply claimed both (the disconnect).
 * So we MERGE: incoming names upsert by name (a re-search of the same name replaces just
 * that name's matches — never a duplicate section), other parked names are preserved, and
 * pendingValid unions in (case-insensitive). clearCandidates still wipes both on pick.
 */
export const writeCandidates = internalMutation({
  args: {
    planId: v.id("plans"),
    candidates: CANDIDATES,
    pendingValid: v.array(v.string()),
  },
  handler: async (ctx, { planId, candidates, pendingValid }) => {
    const plan = await ctx.db.get(planId);
    // Upsert each incoming name into the parked set: drop any existing entry with the same
    // name (re-search replaces its matches), keep every other name, then append the incoming.
    const incomingNames = new Set(candidates.map((c) => c.name));
    const kept = (plan?.candidates ?? []).filter((c) => !incomingNames.has(c.name));
    const mergedCandidates = [...kept, ...candidates];
    // Union pendingValid case-insensitively (a second search must not wipe held valid addresses).
    const seen = new Set((plan?.pendingValid ?? []).map((a) => a.toLowerCase()));
    const mergedValid = [...(plan?.pendingValid ?? [])];
    for (const a of pendingValid) {
      if (seen.has(a.toLowerCase())) continue;
      seen.add(a.toLowerCase());
      mergedValid.push(a);
    }
    await ctx.db.patch(planId, { candidates: mergedCandidates, pendingValid: mergedValid });
  },
});

/**
 * Wipe-on-pick: unset BOTH transient fields (patch to undefined removes the field in
 * Convex → "no contacts cache at rest"). Does NOT touch greetingName — it must survive
 * to the draft turn.
 */
export const clearCandidates = internalMutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    await ctx.db.patch(planId, { candidates: undefined, pendingValid: undefined });
  },
});

/**
 * The single content-plane write surface for generated attachments (CKPT-02, Plan 04 tools).
 * ALWAYS replaces `attachments` wholesale (supersede/remove = pass the full new array) and
 * sets/clears `attachmentError` directly — passing `attachmentError: undefined` CLEARS it (a
 * successful generate wipes a prior render/cap error), mirroring clearCandidates. Because this
 * writes the error explicitly (not via the drop-undefined patchPlan), the clear path is
 * unambiguous. Content-plane only — NEVER audited (CLAUDE.md §4).
 */
export const recordAttachments = internalMutation({
  args: {
    planId: v.id("plans"),
    attachments: ATTACHMENTS,
    attachmentError: v.optional(v.string()),
  },
  handler: async (ctx, { planId, attachments, attachmentError }) => {
    await ctx.db.patch(planId, { attachments, attachmentError });
  },
});

/**
 * Read one plan row by id (internal). The cockpit Executive-Agent tools (llm.ts) run in the
 * "use node" action with a planId and no ctx.db — they read the row through this. Internal-only;
 * the tool re-checks tenantId against the row before use (no cross-tenant read).
 */
export const getById = internalQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => await ctx.db.get(planId),
});

/**
 * Signed download URLs for a plan's generated attachments (CKPT-02, PLAN/REPORT cards).
 * This is the FIRST `storage.getUrl` in the codebase: the URL is a bearer capability, so it is
 * ONLY ever returned from this tenant-guarded query and NEVER logged (CLAUDE.md §4). Guards on the
 * plan row (mirrors byThread) — a caller whose identity ≠ plan.tenantId gets an empty array, never
 * another tenant's signed URL.
 */
export const attachmentUrls = tenantQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.tenantId !== ctx.tenantId) return [];
    return Promise.all(
      (plan.attachments ?? []).map(async (a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        url: await ctx.storage.getUrl(a.storageId),
      })),
    );
  },
});

/** The tenant's plans row for a thread → feeds the PLAN + DRAFT cards (by_thread). */
export const byThread = tenantQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) =>
    await ctx.db
      .query("plans")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .unique(),
});

/**
 * The LIVE REPORT projection (DECISION #1 / RESEARCH-delivery §3). Reads every
 * `requests` row for planId (by_plan, tenant-guarded) and, for each, joins its
 * `gmail.sent` audit (by_correlation) to surface the delivered messageId. No report[]
 * array is stored; requests.status + the audit insert make this fill live per recipient.
 */
export const reportForPlan = tenantQuery({
  args: { planId: v.id("plans") },
  handler: async (ctx, { planId }) => {
    const rows = await ctx.db
      .query("requests")
      .withIndex("by_plan", (q) => q.eq("planId", planId))
      .collect();

    const report = [];
    for (const r of rows) {
      if (r.tenantId !== ctx.tenantId) continue; // never leak another tenant's row
      const sent = await ctx.db
        .query("audit")
        .withIndex("by_correlation", (q) => q.eq("correlationId", r.correlationId))
        .filter((q) => q.eq(q.field("eventType"), "gmail.sent"))
        .first();
      // Per-recipient delivered attachment(s): re-download the EXACT sent bytes. Storage is
      // immutable per id, so we resolve the persisted send-time refs — never regenerate (§4: url never logged).
      const attachments = [];
      for (const ref of r.attachmentRefs) {
        const att = await ctx.db.get(ref);
        if (!att) continue;
        attachments.push({ filename: att.filename, url: await ctx.storage.getUrl(att.storageId) });
      }
      report.push({
        recipient: r.recipient,
        status: r.status,
        correlationId: r.correlationId,
        messageId: (sent?.payload as { messageId?: string } | undefined)?.messageId ?? null,
        attachments,
      });
    }
    return report;
  },
});
