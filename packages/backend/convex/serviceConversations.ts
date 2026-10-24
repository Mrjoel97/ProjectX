// Operational interview state only. Confirmed statements live in the existing Foundation
// interview; this adapter never publishes documents, infers tiers, coaches with a model or grants tools.
import { deserializeProfile } from "@pikar/core";
import {
  assessServiceKnowledge,
  SERVICE_KNOWLEDGE_KEYS,
  type ServiceKnowledgeAssessment,
  type ServiceKnowledgeCandidate,
  type ServiceKnowledgeKey,
} from "@pikar/core/serviceKnowledge";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { appendAudit } from "./audit";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { internalMutation } from "./lib/tenantLifecycle";
import { currentProfileDoc } from "./onboarding";

type ReadCtx = Pick<QueryCtx, "db">;
type Conversation = NonNullable<Doc<"managedServices">["knowledgeConversation"]>;
const keyValue = v.union(
  v.literal("offering"),
  v.literal("targetCustomer"),
  v.literal("brandVoice"),
  v.literal("publishingBoundaries"),
);
const casArgs = {
  serviceId: v.string(),
  expectedRevision: v.number(),
  expectedControlRevision: v.number(),
  expectedConversationRevision: v.number(),
};
type CasArgs = {
  serviceId: string;
  expectedRevision: number;
  expectedControlRevision: number;
  expectedConversationRevision: number;
};
const confirmationArgs = { ...casArgs, reviewHash: v.string() };
type ConfirmArgs = CasArgs & { reviewHash: string };
const labels: Record<ServiceKnowledgeKey, string> = {
  offering: "Offering",
  targetCustomer: "Target customer",
  brandVoice: "Brand voice",
  publishingBoundaries: "Publishing boundaries",
};
const eventRef = (eventId: string) => `foundation-event:${eventId}`;
const fail = (code: string): never => {
  throw new Error(code);
};
const safeRevision = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
async function serviceFor(
  ctx: ReadCtx,
  tenantId: string,
  serviceId: string,
): Promise<Doc<"managedServices">> {
  if (serviceId !== "social-marketing") return fail("SERVICE_CONVERSATION_UNAVAILABLE");
  const rows = await ctx.db
    .query("managedServices")
    .withIndex("by_tenant_service", (q) => q.eq("tenantId", tenantId).eq("serviceId", serviceId))
    .take(2);
  if (rows.length !== 1 || !rows[0]) return fail("SERVICE_CONVERSATION_UNAVAILABLE");
  return rows[0];
}
function checkCas(row: Doc<"managedServices">, args: CasArgs) {
  if (
    ![args.expectedRevision, args.expectedControlRevision, args.expectedConversationRevision].every(
      safeRevision,
    ) ||
    row.revision !== args.expectedRevision ||
    row.controlRevision !== args.expectedControlRevision ||
    (row.knowledgeConversation?.revision ?? 0) !== args.expectedConversationRevision
  )
    fail("SERVICE_CONVERSATION_STALE");
}
const bound = (row: Doc<"managedServices">, conversation: Conversation) =>
  conversation.configRevision === row.revision &&
  conversation.controlRevision === row.controlRevision;
async function noWork(ctx: ReadCtx, row: Doc<"managedServices">) {
  for (const state of ["claimed", "running", "unknown"] as const) {
    const pending = await ctx.db
      .query("managedServiceRuns")
      .withIndex("by_service_state", (q) =>
        q.eq("tenantId", row.tenantId).eq("serviceId", row._id).eq("state", state),
      )
      .first();
    if (pending) fail("SERVICE_CONVERSATION_WORK_ACTIVE");
  }
}

async function nativeSources(
  ctx: ReadCtx,
  service: Doc<"managedServices">,
): Promise<{ candidates: ServiceKnowledgeCandidate[]; snapshot: unknown }> {
  const candidates: ServiceKnowledgeCandidate[] = [];
  const witnesses: { ref: string; actualHash: string | null }[] = [];
  const interview = await ctx.db
    .query("foundationInterviews")
    .withIndex("by_tenant", (q) => q.eq("tenantId", service.tenantId))
    .unique();
  const profile = await currentProfileDoc(ctx, service.tenantId);
  const published = await ctx.db
    .query("foundationRevisions")
    .withIndex("by_tenant", (q) => q.eq("tenantId", service.tenantId))
    .order("desc")
    .first();
  if (profile?.text && profile.text.length <= 150_000) {
    const actualHash = await contentHash(profile.text);
    const snapshot = published?.documents.find((item) => item.kind === "business_profile");
    let sourcesCurrent = true;
    const sourceIds = [
      ...new Set(
        published?.answers.flatMap((answer) => (answer.sourceDocId ? [answer.sourceDocId] : [])) ??
          [],
      ),
    ];
    if (sourceIds.length > 20) sourcesCurrent = false;
    for (const ref of sourceIds.slice(0, 20)) {
      const id = ctx.db.normalizeId("vaultDocuments", ref);
      const doc = id ? await ctx.db.get(id) : null;
      if (!doc || doc.tenantId !== service.tenantId || doc.status !== "ready")
        sourcesCurrent = false;
    }
    const nativeConfirmation =
      !!published &&
      !!snapshot &&
      published.docIds.includes(profile._id) &&
      sourcesCurrent &&
      profile.status === "ready" &&
      profile.contentHash === actualHash &&
      (await contentHash(snapshot.text)) === actualHash;
    const values =
      nativeConfirmation && published ? published.profile : deserializeProfile(profile.text);
    for (const key of ["offering", "targetCustomer"] as const) {
      const value = values[key].trim();
      if (!value || value.length > 4000) continue;
      const sourceRef =
        nativeConfirmation && published
          ? `foundation-profile:${published._id}:${profile._id}:${key}`
          : `profile:${profile._id}:${key}`;
      candidates.push({
        key,
        value,
        sourceRef,
        sourceHash: actualHash,
        confirmedAt: nativeConfirmation && published ? published.createdAt : null,
        sourceState: nativeConfirmation ? "current" : "unverified",
      });
      witnesses.push({ ref: sourceRef, actualHash });
    }
  }
  const confirmed = service.knowledgeConversation?.confirmedAnswers ?? [];
  if (
    confirmed.length > 4 ||
    new Set(confirmed.map((item) => item.key)).size !== confirmed.length ||
    (interview?.answers.length ?? 0) > 100
  )
    fail("SERVICE_CONVERSATION_INVALID");
  for (const ref of confirmed) {
    const answer = interview?.answers.find((item) => item.eventId === ref.eventId);
    const actualHash = answer ? await contentHash(answer.text) : null;
    const audit = await ctx.db.get(ref.confirmationRef);
    const fieldRef = `${ref.key}:${ref.eventId}:${ref.sourceHash}`;
    const authenticatedConfirmation =
      audit?.tenantId === service.tenantId &&
      audit.actor === "user" &&
      audit.eventType === "service.knowledge_confirmed" &&
      audit.ts === ref.confirmedAt &&
      audit.payload.serviceRef === service._id &&
      Array.isArray(audit.payload.fieldRefs) &&
      audit.payload.fieldRefs.some((item: unknown) => item === fieldRef);
    const prefix = `${labels[ref.key]}: `;
    const value = answer?.text.startsWith(prefix) ? answer.text.slice(prefix.length) : "";
    const sourceState = !answer
      ? "withdrawn"
      : actualHash !== ref.sourceHash || answer.intent !== "current" || !value.trim()
        ? "changed"
        : authenticatedConfirmation
          ? "current"
          : "unverified";
    candidates.push({
      key: ref.key,
      value,
      sourceRef: eventRef(ref.eventId),
      sourceHash: ref.sourceHash,
      confirmedAt: authenticatedConfirmation ? ref.confirmedAt : null,
      sourceState,
      supersedes: ref.supersedes,
    });
    witnesses.push({ ref: eventRef(ref.eventId), actualHash });
  }
  return {
    candidates,
    snapshot: {
      witnesses,
      interviewId: interview?._id ?? null,
      interviewRevision: interview?.revision ?? null,
    },
  };
}

export async function serviceKnowledgeFor(
  ctx: ReadCtx,
  service: Doc<"managedServices">,
): Promise<{ assessment: ServiceKnowledgeAssessment; sourceHash: string }> {
  const { candidates } = await nativeSources(ctx, service);
  const assessment = assessServiceKnowledge({
    operationIds: service.operationIds,
    candidates,
    nowMs: Date.now(),
  });
  return { assessment, sourceHash: await knowledgeHash(service, candidates) };
}
async function knowledgeHash(
  service: Doc<"managedServices">,
  candidates: ServiceKnowledgeCandidate[],
): Promise<string> {
  // No unrelated Foundation answers, UI revision or fetched timestamp enters the execution pin.
  return contentHash(
    JSON.stringify({
      operations: service.operationIds,
      candidates: await Promise.all(
        candidates.map(async (candidate) => ({
          ...candidate,
          value: await contentHash(candidate.value),
        })),
      ),
    }),
  );
}
export async function readConfirmedKnowledgeForTenant(
  ctx: ReadCtx,
  tenantId: string,
): Promise<{
  items: {
    serviceId: string;
    serviceRef: Id<"managedServices">;
    knowledge: ServiceKnowledgeCandidate[];
  }[];
  truncated: boolean;
}> {
  const rows = await ctx.db
    .query("managedServices")
    .withIndex("by_tenant_service", (q) =>
      q.eq("tenantId", tenantId).eq("serviceId", "social-marketing"),
    )
    .take(2);
  if (rows.length > 1) return fail("SERVICE_CONVERSATION_UNAVAILABLE");
  const items: {
    serviceId: string;
    serviceRef: Id<"managedServices">;
    knowledge: ServiceKnowledgeCandidate[];
  }[] = [];
  let truncated = false;
  let valueChars = 0;
  for (const row of rows) {
    // Reference memory outlives a user's choice to schedule reporting alone; this does not
    // change the actual service's readiness, operation grants or execution fingerprint.
    const { assessment } = await serviceKnowledgeFor(ctx, {
      ...row,
      operationIds: ["social.prepare"],
    });
    const knowledge: ServiceKnowledgeCandidate[] = [];
    for (const key of SERVICE_KNOWLEDGE_KEYS) {
      const matches = assessment.knowledge.filter((source) => source.key === key);
      const candidate =
        matches.find((source) => source.sourceRef.startsWith("foundation-event:")) ?? matches[0];
      if (!candidate) continue;
      const next = {
        serviceId: row.serviceId,
        serviceRef: row._id,
        knowledge: [...knowledge, candidate],
      };
      if (
        valueChars + candidate.value.length > 16_000 ||
        JSON.stringify([...items, next]).length > 24_000
      ) {
        truncated = true;
        continue;
      }
      knowledge.push(candidate);
      valueChars += candidate.value.length;
    }
    if (knowledge.length) items.push({ serviceId: row.serviceId, serviceRef: row._id, knowledge });
  }
  return { items, truncated };
}
export const confirmedContext = internalQuery({
  args: { tenantId: v.string() },
  handler: (ctx, { tenantId }): ReturnType<typeof readConfirmedKnowledgeForTenant> =>
    readConfirmedKnowledgeForTenant(ctx, tenantId),
});

export type ServiceConversationView = {
  serviceId: string;
  goal: string;
  revision: number;
  controlRevision: number;
  conversationRevision: number;
  budgetLimitCents: number;
  state: "collecting" | "deferred" | "review" | "ready";
  needsRebind: boolean;
  nextQuestion: ServiceKnowledgeAssessment["nextQuestion"];
  canConfirm: boolean;
  reviewHash: string;
  answers: {
    key: ServiceKnowledgeKey;
    value: string;
    origin: "draft" | "confirmed" | "existing";
    sourceState: ServiceKnowledgeCandidate["sourceState"] | "draft";
    sourceRef: string | null;
    sourceHash: string | null;
    confirmedAt: number | null;
  }[];
  launchState: "resume_required" | "started" | null;
  launchRunId: Id<"managedServiceRuns"> | null;
  launchRunState: string | null;
};
async function viewFor(
  ctx: ReadCtx,
  service: Doc<"managedServices">,
): Promise<ServiceConversationView> {
  const conversation = service.knowledgeConversation;
  const { candidates, snapshot } = await nativeSources(ctx, service);
  const assessment = assessServiceKnowledge({
    operationIds: service.operationIds,
    candidates,
    nowMs: Date.now(),
  });
  const draftAnswers = conversation?.draftAnswers ?? [];
  if (
    draftAnswers.length > 4 ||
    new Set(draftAnswers.map((item) => item.key)).size !== draftAnswers.length
  )
    fail("SERVICE_CONVERSATION_INVALID");
  const preview = assessServiceKnowledge({
    operationIds: service.operationIds,
    candidates: [
      ...candidates.filter(
        (candidate) => !draftAnswers.some((answer) => answer.key === candidate.key),
      ),
      ...draftAnswers.map((answer) => ({
        key: answer.key,
        value: answer.value,
        sourceRef: `draft:${answer.key}`,
        sourceHash: "0".repeat(64),
        confirmedAt: Date.now(),
        sourceState: "current" as const,
      })),
    ],
    nowMs: Date.now(),
  });
  const needsRebind = conversation !== undefined && !bound(service, conversation);
  const confirmedSourcesMatch =
    conversation?.confirmedSourceHash === (await knowledgeHash(service, candidates));
  const state =
    conversation?.state === "deferred"
      ? "deferred"
      : conversation?.state === "ready" && assessment.ready && confirmedSourcesMatch && !needsRebind
        ? "ready"
        : preview.ready
          ? "review"
          : "collecting";
  const launched = conversation?.launchRunId ? await ctx.db.get(conversation.launchRunId) : null;
  return {
    serviceId: service.serviceId,
    goal: service.goal,
    revision: service.revision,
    controlRevision: service.controlRevision,
    budgetLimitCents: service.budgetLimitCents,
    conversationRevision: conversation?.revision ?? 0,
    state,
    needsRebind,
    nextQuestion: preview.nextQuestion,
    canConfirm: conversation !== undefined && !needsRebind && preview.ready,
    reviewHash: await contentHash(
      JSON.stringify({
        config: service.revision,
        control: service.controlRevision,
        conversation: conversation?.revision ?? 0,
        candidates,
        snapshot,
        draftAnswers,
      }),
    ),
    answers: SERVICE_KNOWLEDGE_KEYS.flatMap<ServiceConversationView["answers"][number]>((key) => {
      const draft = draftAnswers.find((answer) => answer.key === key);
      if (draft)
        return [
          {
            key,
            value: draft.value,
            origin: "draft" as const,
            sourceState: "draft" as const,
            sourceRef: null,
            sourceHash: null,
            confirmedAt: null,
          },
        ];
      const known =
        assessment.knowledge.find((answer) => answer.key === key) ??
        candidates.find((answer) => answer.key === key && answer.value);
      return known
        ? [
            {
              key,
              value: known.value,
              origin: known.sourceRef.startsWith("foundation-event:")
                ? ("confirmed" as const)
                : ("existing" as const),
              sourceState: known.sourceState,
              sourceRef: known.sourceRef,
              sourceHash: known.sourceHash,
              confirmedAt: known.confirmedAt,
            },
          ]
        : [];
    }),
    launchState: needsRebind ? null : (conversation?.launchState ?? null),
    launchRunId: needsRebind ? null : (conversation?.launchRunId ?? null),
    launchRunState:
      !needsRebind && launched?.tenantId === service.tenantId && launched.serviceId === service._id
        ? launched.state
        : null,
  };
}
export const read = tenantQuery({
  args: { serviceId: v.string() },
  handler: async (ctx, { serviceId }): Promise<ServiceConversationView | null> => {
    if (serviceId !== "social-marketing") return null;
    const row = await ctx.db
      .query("managedServices")
      .withIndex("by_tenant_service", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("serviceId", serviceId),
      )
      .first();
    return row ? viewFor(ctx, await serviceFor(ctx, ctx.tenantId, serviceId)) : null;
  },
});
export const begin = tenantMutation({
  args: casArgs,
  handler: async (ctx, args): Promise<ServiceConversationView> => {
    const service = await serviceFor(ctx, ctx.tenantId, args.serviceId);
    checkCas(service, args);
    const old = service.knowledgeConversation;
    if (old && bound(service, old) && old.state !== "deferred") return viewFor(ctx, service);
    await noWork(ctx, service);
    const conversation: Conversation = {
      revision: (old?.revision ?? 0) + 1,
      configRevision: service.revision,
      controlRevision: service.controlRevision,
      state: "collecting",
      draftAnswers: old?.draftAnswers ?? [],
      confirmedAnswers: old?.confirmedAnswers ?? [],
      requestKey: `service-intake-${crypto.randomUUID()}`,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(service._id, { knowledgeConversation: conversation });
    return viewFor(ctx, { ...service, knowledgeConversation: conversation });
  },
});
export const save = tenantMutation({
  args: { ...casArgs, key: keyValue, value: v.string() },
  handler: async (ctx, args): Promise<ServiceConversationView> => {
    const service = await serviceFor(ctx, ctx.tenantId, args.serviceId);
    checkCas(service, args);
    const old = service.knowledgeConversation;
    if (!old || !bound(service, old)) return fail("SERVICE_CONVERSATION_STALE_BINDING");
    if (!args.value.trim() || args.value.length > 4000)
      return fail("SERVICE_CONVERSATION_INVALID_ANSWER");
    await noWork(ctx, service);
    const conversation: Conversation = {
      ...old,
      revision: old.revision + 1,
      state: "collecting",
      draftAnswers: [
        ...old.draftAnswers.filter((answer) => answer.key !== args.key),
        { key: args.key, value: args.value.trim() },
      ],
      reviewHash: undefined,
      confirmedFromRevision: undefined,
      launchState: undefined,
      launchRunId: undefined,
      requestKey: old.state === "ready" ? `service-intake-${crypto.randomUUID()}` : old.requestKey,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(service._id, { knowledgeConversation: conversation });
    return viewFor(ctx, { ...service, knowledgeConversation: conversation });
  },
});
export const defer = tenantMutation({
  args: casArgs,
  handler: async (ctx, args): Promise<ServiceConversationView> => {
    const service = await serviceFor(ctx, ctx.tenantId, args.serviceId);
    checkCas(service, args);
    const old = service.knowledgeConversation;
    if (!old || !bound(service, old)) return fail("SERVICE_CONVERSATION_STALE_BINDING");
    await noWork(ctx, service);
    const conversation: Conversation = {
      ...old,
      revision: old.revision + 1,
      state: "deferred",
      updatedAt: Date.now(),
    };
    await ctx.db.patch(service._id, { knowledgeConversation: conversation });
    return viewFor(ctx, { ...service, knowledgeConversation: conversation });
  },
});

async function confirmFor(
  ctx: MutationCtx & { tenantId: string },
  args: ConfirmArgs,
): Promise<ServiceConversationView> {
  const service = await serviceFor(ctx, ctx.tenantId, args.serviceId);
  const old = service.knowledgeConversation;
  if (!old || !bound(service, old) || service.controlState !== "active")
    return fail("SERVICE_CONVERSATION_STALE_BINDING");
  if (
    service.revision !== args.expectedRevision ||
    service.controlRevision !== args.expectedControlRevision ||
    ![args.expectedRevision, args.expectedControlRevision, args.expectedConversationRevision].every(
      safeRevision,
    )
  )
    return fail("SERVICE_CONVERSATION_STALE");
  const ready = await viewFor(ctx, service);
  if (
    old.state === "ready" &&
    old.confirmedFromRevision === args.expectedConversationRevision &&
    old.reviewHash === args.reviewHash &&
    ready.state === "ready"
  )
    return ready;
  if (
    old.state === "ready" &&
    old.revision === args.expectedConversationRevision &&
    ready.reviewHash === args.reviewHash &&
    ready.state === "ready"
  )
    return ready;
  checkCas(service, args);
  await noWork(ctx, service);
  if (
    !ready.canConfirm ||
    ready.reviewHash !== args.reviewHash ||
    !/^[a-f0-9]{64}$/.test(args.reviewHash)
  )
    return fail("SERVICE_CONVERSATION_STALE_REVIEW");
  const { candidates } = await nativeSources(ctx, service);
  let interview = await ctx.db
    .query("foundationInterviews")
    .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
    .unique();
  if (old.draftAnswers.length && !interview) {
    await ctx.runMutation(api.foundation.begin, {});
    interview = await ctx.db
      .query("foundationInterviews")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
  }
  const at = Date.now();
  const newRefs: Omit<Conversation["confirmedAnswers"][number], "confirmationRef">[] = [];
  for (const answer of old.draftAnswers) {
    if (!interview) return fail("SERVICE_CONVERSATION_FOUNDATION_UNAVAILABLE");
    const eventId = `svc_${old.requestKey}_${old.revision}_${answer.key}`;
    const text = `${labels[answer.key]}: ${answer.value}`;
    const hash = await contentHash(text);
    const revision: number = await ctx.runMutation(internal.foundation.saveTurn, {
      tenantId: ctx.tenantId,
      revision: interview.revision,
      profile: interview.profile,
      slots: interview.slots,
      answer: {
        eventId,
        text,
        section:
          answer.key === "offering" || answer.key === "targetCustomer" ? "offers" : "constraints",
        intent: "current",
      },
      reply: "",
    });
    interview = { ...interview, revision };
    const supersedes = [
      ...new Set(
        candidates
          .filter((candidate) => candidate.key === answer.key)
          .flatMap((candidate) => [candidate.sourceRef, ...(candidate.supersedes ?? [])]),
      ),
    ];
    if (supersedes.length > 16) return fail("SERVICE_CONVERSATION_HISTORY_LIMIT");
    newRefs.push({ key: answer.key, eventId, sourceHash: hash, confirmedAt: at, supersedes });
  }
  const confirmationRef = await appendAudit(ctx, {
    tenantId: ctx.tenantId,
    correlationId: crypto.randomUUID(),
    eventType: "service.knowledge_confirmed",
    actor: "user",
    payload: {
      serviceRef: service._id,
      conversationRevision: old.revision,
      reviewHash: args.reviewHash,
      fieldRefs: newRefs.map((ref) => `${ref.key}:${ref.eventId}:${ref.sourceHash}`),
      fieldCount: newRefs.length,
    },
  });
  const confirmation = await ctx.db.get(confirmationRef);
  if (!confirmation) return fail("SERVICE_CONVERSATION_CONFIRMATION_UNAVAILABLE");
  const conversation: Conversation = {
    ...old,
    revision: old.revision + 1,
    state: "ready",
    draftAnswers: [],
    confirmedAnswers: [
      ...old.confirmedAnswers.filter((ref) => !newRefs.some((next) => next.key === ref.key)),
      ...newRefs.map((ref) => ({ ...ref, confirmedAt: confirmation.ts, confirmationRef })),
    ],
    confirmedFromRevision: old.revision,
    reviewHash: args.reviewHash,
    updatedAt: at,
  };
  await ctx.db.patch(service._id, { knowledgeConversation: conversation });
  const knowledge = await serviceKnowledgeFor(ctx, {
    ...service,
    knowledgeConversation: conversation,
  });
  if (!knowledge.assessment.ready) return fail("SERVICE_CONVERSATION_SOURCES_CHANGED");
  const confirmedConversation: Conversation = {
    ...conversation,
    confirmedSourceHash: knowledge.sourceHash,
  };
  await ctx.db.patch(service._id, { knowledgeConversation: confirmedConversation });
  const result = await viewFor(ctx, { ...service, knowledgeConversation: confirmedConversation });
  if (result.state !== "ready") return fail("SERVICE_CONVERSATION_SOURCES_CHANGED");
  return result;
}
export const confirm = tenantMutation({
  args: confirmationArgs,
  handler: (ctx, args): Promise<ServiceConversationView> => confirmFor(ctx, args),
});
export const recordLaunch = internalMutation({
  args: {
    tenantId: v.string(),
    serviceId: v.string(),
    expectedRevision: v.number(),
    expectedControlRevision: v.number(),
    requestKey: v.string(),
    state: v.union(v.literal("started"), v.literal("resume_required")),
    runId: v.optional(v.id("managedServiceRuns")),
  },
  handler: async (ctx, args): Promise<void> => {
    const service = await serviceFor(ctx, args.tenantId, args.serviceId);
    const conversation = service.knowledgeConversation;
    if (
      !conversation ||
      !bound(service, conversation) ||
      conversation.requestKey !== args.requestKey ||
      service.revision !== args.expectedRevision ||
      service.controlRevision !== args.expectedControlRevision
    )
      return;
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (
        !run ||
        run.tenantId !== args.tenantId ||
        run.serviceId !== service._id ||
        run.requestKey !== args.requestKey
      )
        return;
    }
    if (conversation.launchRunId && !args.runId) return;
    await ctx.db.patch(service._id, {
      knowledgeConversation: {
        ...conversation,
        launchState: args.state,
        ...(args.runId ? { launchRunId: args.runId } : {}),
        updatedAt: Date.now(),
      },
    });
  },
});
export const launchContext = internalQuery({
  args: { tenantId: v.string(), serviceId: v.string() },
  handler: async (ctx, args): Promise<{ requestKey: string }> => {
    const service = await serviceFor(ctx, args.tenantId, args.serviceId);
    if (!service.knowledgeConversation || !bound(service, service.knowledgeConversation))
      return fail("SERVICE_CONVERSATION_STALE_BINDING");
    return { requestKey: service.knowledgeConversation.requestKey };
  },
});
export const confirmAndContinue = tenantAction({
  args: confirmationArgs,
  handler: async (
    ctx,
    args,
  ): Promise<{
    conversation: ServiceConversationView;
    launch: {
      state: "started" | "already_completed" | "resume_required";
      runId: Id<"managedServiceRuns"> | null;
      runState: string | null;
    };
  }> => {
    const conversation: ServiceConversationView = await ctx.runMutation(
      api.serviceConversations.confirm,
      args,
    );
    const { requestKey }: { requestKey: string } = await ctx.runQuery(
      internal.serviceConversations.launchContext,
      { tenantId: ctx.tenantId, serviceId: args.serviceId },
    );
    try {
      const run = await ctx.runAction(api.managedServiceRuns.start, {
        serviceId: args.serviceId,
        expectedRevision: args.expectedRevision,
        expectedControlRevision: args.expectedControlRevision,
        requestKey,
      });
      const state =
        run.state === "completed"
          ? "already_completed"
          : run.state === "claimed" || run.state === "running"
            ? "started"
            : "resume_required";
      await ctx.runMutation(internal.serviceConversations.recordLaunch, {
        tenantId: ctx.tenantId,
        serviceId: args.serviceId,
        expectedRevision: args.expectedRevision,
        expectedControlRevision: args.expectedControlRevision,
        requestKey,
        state: state === "resume_required" ? "resume_required" : "started",
        runId: run.runId,
      });
      return {
        conversation: {
          ...conversation,
          launchState: state === "resume_required" ? "resume_required" : "started",
          launchRunId: run.runId,
          launchRunState: run.state,
        },
        launch: { state, runId: run.runId, runState: run.state },
      };
    } catch {
      await ctx.runMutation(internal.serviceConversations.recordLaunch, {
        tenantId: ctx.tenantId,
        serviceId: args.serviceId,
        expectedRevision: args.expectedRevision,
        expectedControlRevision: args.expectedControlRevision,
        requestKey,
        state: "resume_required",
      });
      return {
        conversation: { ...conversation, launchState: "resume_required" },
        launch: { state: "resume_required", runId: null, runState: null },
      };
    }
  },
});
