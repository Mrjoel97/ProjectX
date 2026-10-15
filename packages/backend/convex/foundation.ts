import type { EntryId } from "@convex-dev/rag";
import {
  BLUEPRINT_FIELDS,
  type BusinessBlueprint,
  deriveTier,
  deserializeBlueprint,
  missingSlots,
  type ProfileInput,
  serializeBlueprint,
  serializeProfile,
  statedFromProfile,
  type TierFacts,
  validateProfile,
} from "@pikar/core";
import {
  emptyFoundationProfile,
  FOUNDATION_MAX_ANSWERS,
  FOUNDATION_MAX_TEXT,
  FOUNDATION_MAX_TOTAL_TEXT,
  FOUNDATION_TRANSCRIPT_TTL,
  renderFoundation,
} from "@pikar/core/foundation";
import { categoryFor } from "@pikar/vault";
import { ConvexError, type Infer, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, internalQuery, type QueryCtx } from "./_generated/server";
import {
  foundationAnswer,
  foundationProfile,
  foundationSection,
  foundationSlots,
} from "./lib/foundationValidators";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { internalAction, internalMutation } from "./lib/tenantLifecycle";
import { currentProfileDoc, currentTierRow, validateAndWriteProfile } from "./onboarding";
import { startIngest } from "./vaultIngest";
import { rag } from "./vaultRag";

const read = (ctx: Pick<QueryCtx, "db">, tenantId: string) =>
  ctx.db
    .query("foundationInterviews")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
const checkRevision = (row: Doc<"foundationInterviews"> | null, revision: number) => {
  if (!row || row.revision !== revision) throw new ConvexError({ code: "STALE_INTERVIEW" });
  return row;
};
export const enabled = tenantQuery({
  args: {},
  handler: async (): Promise<boolean> => process.env.FOUNDATION_ONBOARDING_ENABLED === "1",
});
export const get = tenantQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"foundationInterviews"> | null> => read(ctx, ctx.tenantId),
});
export const begin = tenantMutation({
  args: {},
  handler: async (ctx): Promise<Id<"foundationInterviews">> => {
    const existing = await read(ctx, ctx.tenantId);
    if (existing) return existing._id;
    const profile = await ctx.runQuery(api.onboarding.getProfile, {});
    const facts = await currentTierRow(ctx, ctx.tenantId);
    const { persona: _tier, ...input } = profile ?? {
      ...emptyFoundationProfile(),
      persona: "solopreneur",
    };
    return ctx.db.insert("foundationInterviews", {
      tenantId: ctx.tenantId,
      revision: 0,
      profile: input,
      slots: facts
        ? {
            headcount: facts.headcount,
            paidStaff: facts.paidStaff,
            revenueStage: facts.revenueStage,
            funding: facts.funding,
            yearsOperating: facts.yearsOperating,
            oneLineDescription: input.oneLineDescription,
          }
        : {},
      answers: [],
      phase: profile ? "enrichment" : "essential",
      state: "active",
      reply: "",
      updatedAt: Date.now(),
    });
  },
});

// Only this internal commit accepts extraction output. Public voice tools carry user text, not tier.
export const saveTurn = internalMutation({
  args: {
    tenantId: v.string(),
    revision: v.number(),
    profile: foundationProfile,
    slots: foundationSlots,
    answer: foundationAnswer,
    reply: v.string(),
  },
  handler: async (ctx, a): Promise<number> => {
    const existing = await read(ctx, a.tenantId);
    if (existing?.answers.some((x) => x.eventId === a.answer.eventId)) return existing.revision;
    const row = checkRevision(existing, a.revision);
    if (
      row.answers.length >= FOUNDATION_MAX_ANSWERS ||
      row.answers.reduce((sum, x) => sum + x.text.length, a.answer.text.length) >
        FOUNDATION_MAX_TOTAL_TEXT
    )
      throw new ConvexError({ code: "INTERVIEW_LIMIT" });
    await ctx.db.patch(row._id, {
      profile: a.profile,
      slots: a.slots,
      answers: [...row.answers, a.answer],
      reply: a.reply,
      revision: row.revision + 1,
      phase: missingSlots(a.slots).length ? "essential" : "enrichment",
      state: "active",
      updatedAt: Date.now(),
    });
    return row.revision + 1;
  },
});

const answerForTenant = async (
  ctx: ActionCtx & { tenantId: string },
  a: {
    revision: number;
    eventId: string;
    sourceDocId?: Id<"vaultDocuments">;
    answer: string;
    section: Infer<typeof foundationSection>;
    intent: "current" | "planned";
  },
): Promise<{ revision: number; reply: string; complete: boolean }> => {
  if (
    !a.answer.trim() ||
    a.answer.length > FOUNDATION_MAX_TEXT ||
    !/^[a-zA-Z0-9_-]{1,120}$/.test(a.eventId)
  )
    throw new ConvexError({ code: "INVALID_ANSWER" });
  const existing: Doc<"foundationInterviews"> | null = await ctx.runQuery(
    internal.foundation.getInternal,
    { tenantId: ctx.tenantId },
  );
  if (existing?.answers.some((x) => x.eventId === a.eventId))
    return {
      revision: existing.revision,
      reply: existing.reply,
      complete: !missingSlots(existing.slots).length,
    };
  const row = checkRevision(existing, a.revision);
  if (
    a.sourceDocId &&
    !(await ctx.runQuery(internal.vault.getDoc, {
      vaultDocId: a.sourceDocId,
      tenantId: ctx.tenantId,
    }))
  )
    throw new ConvexError({ code: "INVALID_SOURCE" });
  let profile: ProfileInput = row.profile;
  let slots = row.slots;
  let reply = "Saved as a draft. You can review your foundation or continue with another section.";
  if (a.section === "essentials") {
    if (!profile.oneLineDescription)
      profile = await ctx.runAction(internal.onboarding.extractProfileInternal, {
        tenantId: ctx.tenantId,
        intakeText: a.answer,
      });
    const turn = await ctx.runAction(internal.onboarding.converseInternal, {
      tenantId: ctx.tenantId,
      slots: { ...slots, oneLineDescription: profile.oneLineDescription },
      userMessage: a.answer,
    });
    slots = turn.slots;
    profile = {
      ...profile,
      oneLineDescription: slots.oneLineDescription ?? profile.oneLineDescription,
    };
    reply = turn.reply;
  }
  const revision: number = await ctx.runMutation(internal.foundation.saveTurn, {
    tenantId: ctx.tenantId,
    revision: a.revision,
    profile,
    slots,
    answer: {
      section: a.section,
      text: a.answer.trim(),
      intent: a.intent,
      eventId: a.eventId,
      ...(a.sourceDocId ? { sourceDocId: a.sourceDocId } : {}),
    },
    reply,
  });
  return { revision, reply, complete: !missingSlots(slots).length };
};

export const answer = tenantAction({
  args: {
    revision: v.number(),
    eventId: v.string(),
    sourceDocId: v.optional(v.id("vaultDocuments")),
    answer: v.string(),
    section: foundationSection,
    intent: v.union(v.literal("current"), v.literal("planned")),
  },
  handler: answerForTenant,
});

export const edit = tenantMutation({
  args: { revision: v.number(), profile: foundationProfile, answers: v.array(foundationAnswer) },
  handler: async (ctx, a): Promise<number> => {
    const row = checkRevision(await read(ctx, ctx.tenantId), a.revision);
    if (
      a.answers.length > FOUNDATION_MAX_ANSWERS ||
      a.answers.reduce((sum, x) => sum + x.text.length, 0) > FOUNDATION_MAX_TOTAL_TEXT ||
      a.answers.some((x) => !x.text.trim() || x.text.length > FOUNDATION_MAX_TEXT) ||
      JSON.stringify(a.profile).length > 24000
    )
      throw new ConvexError({ code: "INVALID_DRAFT" });
    // An edited statement keeps its source id; new statements must use the answer path.
    if (
      a.answers.some(
        (x) =>
          !row.answers.some(
            (old) =>
              old.eventId === x.eventId &&
              old.section === x.section &&
              old.sourceDocId === x.sourceDocId,
          ),
      )
    )
      throw new ConvexError({ code: "INVALID_SOURCE" });
    await ctx.db.patch(row._id, {
      profile: a.profile,
      answers: a.answers,
      slots: { ...row.slots, oneLineDescription: a.profile.oneLineDescription },
      state: "active",
      revision: row.revision + 1,
      updatedAt: Date.now(),
    });
    return row.revision + 1;
  },
});

export const checkpoint = tenantMutation({
  args: {
    eventId: v.string(),
    text: v.string(),
    speaker: v.union(v.literal("user"), v.literal("agent")),
  },
  handler: async (ctx, a): Promise<null> => {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(a.eventId) || a.text.length > FOUNDATION_MAX_TEXT)
      throw new ConvexError({ code: "INVALID_CHECKPOINT" });
    if (!(await read(ctx, ctx.tenantId))) throw new ConvexError({ code: "NO_INTERVIEW" });
    const previous = await ctx.db
      .query("foundationTranscripts")
      .withIndex("by_tenant_event", (q) => q.eq("tenantId", ctx.tenantId).eq("eventId", a.eventId))
      .unique();
    if (!previous)
      await ctx.db.insert("foundationTranscripts", {
        ...a,
        tenantId: ctx.tenantId,
        expiresAt: Date.now() + FOUNDATION_TRANSCRIPT_TTL,
      });
    return null;
  },
});
export const purgeTranscripts = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const expired = await ctx.db
      .query("foundationTranscripts")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(100);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === 100)
      await ctx.scheduler.runAfter(0, internal.foundation.purgeTranscripts, {});
    return expired.length;
  },
});

export const context = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<string> => {
    const row = await read(ctx, tenantId);
    if (!row) throw new ConvexError({ code: "NO_INTERVIEW" });
    return JSON.stringify({
      phase: row.phase,
      missing: missingSlots(row.slots),
      profile: row.profile,
      facts: row.slots,
      answers: row.answers.slice(-8),
      nextStep: row.reply,
    }).slice(0, 18000);
  },
});

async function projection(ctx: Pick<QueryCtx, "db">, row: Doc<"foundationInterviews">) {
  const facts = await currentTierRow(ctx as QueryCtx, row.tenantId);
  const tier = facts?.tierSource === "admin" ? facts.tier : deriveTier(row.slots as TierFacts);
  const profile = { ...row.profile, persona: tier };
  const previous = facts?.blueprintDocId ? await ctx.db.get(facts.blueprintDocId) : null;
  const live =
    previous?.tenantId === row.tenantId && previous.text
      ? deserializeBlueprint(previous.text)
      : null;
  const stated = statedFromProfile(profile, tier, []);
  const blueprint = Object.fromEntries(
    BLUEPRINT_FIELDS.map((key) => [key, stated[key] ?? live?.[key] ?? null]),
  ) as BusinessBlueprint;
  return {
    documents: renderFoundation(profile, row.answers),
    blueprint: serializeBlueprint(blueprint),
    previousBlueprint: previous?.text ?? "",
  };
}

export const review = tenantQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    revision: number;
    documents: ReturnType<typeof renderFoundation>;
    blueprint: string;
    previousBlueprint: string;
    reviewHash: string;
  } | null> => {
    const row = await read(ctx, ctx.tenantId);
    if (!row || missingSlots(row.slots).length || !validateProfile(row.profile).ok) return null;
    const projected = await projection(ctx, row);
    return {
      revision: row.revision,
      ...projected,
      reviewHash: await contentHash(JSON.stringify(projected)),
    };
  },
});

export const publish = tenantMutation({
  args: { revision: v.number(), reviewHash: v.string() },
  handler: async (ctx, { revision, reviewHash }): Promise<{ docIds: Id<"vaultDocuments">[] }> => {
    const row = checkRevision(await read(ctx, ctx.tenantId), revision);
    if (row.publishedRevision === revision && row.docIds) return { docIds: row.docIds };
    if (missingSlots(row.slots).length || !validateProfile(row.profile).ok)
      throw new ConvexError({ code: "INCOMPLETE_ONBOARDING" });
    const { oneLineDescription: _description, ...facts } = row.slots;
    await ctx.runMutation(api.tenantProfile.saveFacts, facts);
    const projected = await projection(ctx, row);
    if ((await contentHash(JSON.stringify(projected))) !== reviewHash)
      throw new ConvexError({ code: "STALE_REVIEW" });
    const tier = await currentTierRow(ctx, ctx.tenantId);
    if (!tier) throw new ConvexError({ code: "INCOMPLETE_ONBOARDING" });
    const oldProfile = await currentProfileDoc(ctx, ctx.tenantId);
    // Avoid racing a prior ingestion workflow while replacing its current sources.
    for (const id of row.docIds ?? []) {
      const doc = await ctx.db.get(id);
      if (doc && !["ready", "failed"].includes(doc.status))
        throw new ConvexError({ code: "INDEXING_IN_PROGRESS" });
    }
    const overview = projected.documents[0];
    if (!overview) throw new Error("FOUNDATION_PROJECTION_EMPTY");
    const approvedProfile = { ...row.profile, persona: tier.tier };
    const appendix = overview.text.slice(serializeProfile(approvedProfile).length);
    const profileResult = await validateAndWriteProfile(
      ctx,
      ctx.tenantId,
      approvedProfile,
      oldProfile ?? undefined,
      appendix,
    );
    if (!profileResult.ok) throw new ConvexError({ code: "INVALID_PROFILE" });
    const docIds = [profileResult.vaultDocId];
    for (const [index, doc] of projected.documents.slice(1).entries()) {
      const hash = await contentHash(doc.text);
      const previousId = row.docIds?.[index + 1];
      const previous = previousId ? await ctx.db.get(previousId) : null;
      const fields = {
        title: doc.title,
        text: doc.text,
        contentHash: hash,
        size: new TextEncoder().encode(doc.text).length,
        status: "processing" as const,
      };
      let id: Id<"vaultDocuments">;
      if (previous?.tenantId === ctx.tenantId && previous.kind === doc.kind) {
        id = previous._id;
        if (previous.ragEntryId && !previous.ragEntryId.startsWith("smoke::"))
          await rag.deleteAsync(ctx, { entryId: previous.ragEntryId as EntryId });
        await ctx.db.patch(id, {
          ...fields,
          ragEntryId: undefined,
          failureReason: undefined,
          graphCleanupHash: hash,
        });
        await ctx.scheduler.runAfter(0, internal.vaultGraph.clearAndReingest, {
          vaultDocId: id,
          tenantId: ctx.tenantId,
          expectedContentHash: hash,
        });
      } else {
        id = await ctx.db.insert("vaultDocuments", {
          ...fields,
          tenantId: ctx.tenantId,
          kind: doc.kind,
          mimeType: "text/markdown",
          source: "agent",
          category: categoryFor({ source: "agent" }),
          createdAt: Date.now(),
        });
        await startIngest(ctx, {
          tenantId: ctx.tenantId,
          vaultDocId: id,
          correlationId: crypto.randomUUID(),
        });
      }
      docIds.push(id);
    }
    const blueprintFields = {
      text: projected.blueprint,
      contentHash: await contentHash(projected.blueprint),
      size: new TextEncoder().encode(projected.blueprint).length,
      status: "ready" as const,
    };
    let blueprintDocId = tier.blueprintDocId;
    const pointed = blueprintDocId ? await ctx.db.get(blueprintDocId) : null;
    if (pointed?.tenantId === ctx.tenantId && pointed.kind === "business_blueprint")
      await ctx.db.patch(pointed._id, blueprintFields);
    else
      blueprintDocId = await ctx.db.insert("vaultDocuments", {
        ...blueprintFields,
        tenantId: ctx.tenantId,
        title: "Business blueprint",
        kind: "business_blueprint",
        mimeType: "text/markdown",
        source: "agent",
        category: categoryFor({ source: "agent" }),
        createdAt: Date.now(),
      });
    await ctx.db.patch(tier._id, {
      blueprintDocId,
      blueprintConfirmedAt: Date.now(),
      blueprintSourceDocIds: docIds,
      blueprintDraft: undefined,
      blueprintDraftAt: undefined,
    });
    await ctx.db.insert("foundationRevisions", {
      tenantId: ctx.tenantId,
      revision,
      documents: projected.documents,
      profile: row.profile,
      slots: row.slots,
      answers: row.answers,
      docIds,
      createdAt: Date.now(),
    });
    await ctx.db.patch(row._id, {
      publishedRevision: revision,
      docIds,
      state: "published",
      phase: "enrichment",
      updatedAt: Date.now(),
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "onboarding.foundation_published",
      actor: "user",
      payload: { revision, documentCount: docIds.length, blueprintDocId: blueprintDocId ?? null },
    });
    return { docIds };
  },
});

export const publication = tenantQuery({
  args: {},
  handler: async (ctx): Promise<{ id: Id<"vaultDocuments">; title: string; status: string }[]> => {
    const row = await read(ctx, ctx.tenantId);
    const docs = await Promise.all((row?.docIds ?? []).map((id) => ctx.db.get(id)));
    return docs
      .filter((d): d is Doc<"vaultDocuments"> => !!d && d.tenantId === ctx.tenantId)
      .map((d) => ({ id: d._id, title: d.title, status: d.status }));
  },
});
export const history = tenantQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"foundationRevisions">[]> =>
    ctx.db
      .query("foundationRevisions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(10),
});
export const discard = tenantMutation({
  args: { revision: v.number() },
  handler: async (ctx, { revision }): Promise<null> => {
    const row = checkRevision(await read(ctx, ctx.tenantId), revision);
    const approved =
      row.publishedRevision === undefined
        ? null
        : await ctx.db
            .query("foundationRevisions")
            .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
            .order("desc")
            .first();
    if (approved)
      await ctx.db.patch(row._id, {
        profile: approved.profile,
        slots: approved.slots,
        answers: approved.answers,
        docIds: approved.docIds,
        revision: row.revision + 1,
        publishedRevision: row.revision + 1,
        state: "published",
        reply: "",
        updatedAt: Date.now(),
      });
    else await ctx.db.delete(row._id);
    // Retention cleanup remains bounded and resumable; approved Vault content is not a draft.
    await ctx.scheduler.runAfter(0, internal.foundation.discardTranscripts, {
      tenantId: ctx.tenantId,
      expiresBefore: Date.now() + FOUNDATION_TRANSCRIPT_TTL,
    });
    return null;
  },
});
export const discardTranscripts = internalMutation({
  args: { tenantId: v.string(), expiresBefore: v.number() },
  handler: async (ctx, { tenantId, expiresBefore }): Promise<null> => {
    const rows = await ctx.db
      .query("foundationTranscripts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .take(100);
    for (const row of rows) if (row.expiresAt <= expiresBefore) await ctx.db.delete(row._id);
    if (rows.length === 100 && rows.some((row) => row.expiresAt <= expiresBefore))
      await ctx.scheduler.runAfter(0, internal.foundation.discardTranscripts, {
        tenantId,
        expiresBefore,
      });
    return null;
  },
});

export const getInternal = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<Doc<"foundationInterviews"> | null> =>
    read(ctx, tenantId),
});
export const answerFromVoice = internalAction({
  args: {
    sessionId: v.id("voiceSessions"),
    eventId: v.string(),
    answer: v.string(),
    section: foundationSection,
    intent: v.union(v.literal("current"), v.literal("planned")),
  },
  handler: async (ctx, a): Promise<{ revision: number; reply: string; complete: boolean }> => {
    const session = await ctx.runQuery(internal.voice.getSession, { sessionId: a.sessionId });
    if (!session?.onboarding || session.status !== "active" || session.endsAt <= Date.now())
      throw new Error("VOICE_SESSION_INACTIVE");
    const row = await ctx.runQuery(internal.foundation.getInternal, { tenantId: session.tenantId });
    if (!row) throw new Error("VOICE_INTERVIEW_MISSING");
    return answerForTenant(
      { ...ctx, tenantId: session.tenantId },
      { ...a, revision: row.revision },
    );
  },
});
