import { validateDesignProfileRef } from "@pikar/core/designKnowledge";
import { merchantSetupSourceRefs } from "@pikar/core/merchantSetup";
import {
  assessOnlinePresenceBrief,
  mergeOnlinePresenceBrief,
  type OnlinePresenceAssessment,
  type OnlinePresenceMissing,
  type OnlinePresenceSource,
  type OnlinePresenceWarning,
} from "@pikar/core/onlinePresence";
import { parseWebAssetRef } from "@pikar/core/webAssets";
import { canonicalWebLayoutPlan, validateWebLayoutPlan } from "@pikar/core/webLayoutPlan";
import { materializeWebRecipe, validateWebRecipeMedia } from "@pikar/core/webRecipes";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { tenantQuery } from "./lib/functions";
import { assertTenantWritable, internalMutation } from "./lib/tenantLifecycle";
import { type ShopSetupReview, shopSetupReviewForTenant } from "./onlinePresenceShop";
import { imageSource, listImageCandidates, resolveDocumentAssets } from "./webAssets";
import type { WebProviderReceipt } from "./webProjects";
import { createProjectWithVersion, reviseProjectWithVersion } from "./webProjects";
import { materializeActiveRecipe } from "./webRecipes";

type DatabaseCtx = QueryCtx | MutationCtx;
type Session = Doc<"onlinePresenceSessions">;
const hash = (value: unknown): string =>
  sha256Bytes(new TextEncoder().encode(JSON.stringify(value)));

async function ownedPlan(ctx: DatabaseCtx, tenantId: string, planId: Id<"plans">) {
  const plan = await ctx.db.get(planId);
  if (!plan || plan.tenantId !== tenantId) throw new Error("ONLINE_PRESENCE_UNAVAILABLE");
  return plan;
}

async function ownedSession(
  ctx: DatabaseCtx,
  tenantId: string,
  planId: Id<"plans">,
): Promise<Session> {
  const plan = await ownedPlan(ctx, tenantId, planId);
  const session = await ctx.db
    .query("onlinePresenceSessions")
    .withIndex("by_tenant_plan", (q) => q.eq("tenantId", tenantId).eq("planId", planId))
    .unique();
  if (!session || session.threadId !== plan.threadId)
    throw new Error("ONLINE_PRESENCE_UNAVAILABLE");
  return session;
}

/** Only the authenticated cockpit calls this with an actual human message. It is deliberately
 * absent from ONLINE_PRESENCE_TOOLS: generated prose cannot become a user statement. */
export const ensureSession = internalMutation({
  args: { tenantId: v.string(), threadId: v.string(), planId: v.id("plans"), text: v.string() },
  handler: async (ctx, args): Promise<{ revision: number; sourceRef: string }> => {
    await assertTenantWritable(ctx, args.tenantId);
    const plan = await ownedPlan(ctx, args.tenantId, args.planId);
    if (plan.threadId !== args.threadId) throw new Error("ONLINE_PRESENCE_UNAVAILABLE");
    const text = args.text.trim();
    if (!text || text.length > 8000) throw new Error("ONLINE_PRESENCE_REQUEST_INVALID");
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_thread", (q) =>
        q.eq("tenantId", args.tenantId).eq("threadId", args.threadId),
      )
      .unique();
    if (session && session.planId !== args.planId) throw new Error("ONLINE_PRESENCE_UNAVAILABLE");
    // startOnlinePresence records the first request before routing through sendCockpitMessage.
    // Reuse just that initial source on the immediate handoff; later identical answers remain turns.
    const first = session?.humanMessages[0];
    if (
      session?.revision === 1 &&
      session.humanMessages.length === 1 &&
      session.brief === undefined &&
      first?.text === text
    )
      return { revision: session.revision, sourceRef: first.ref };
    const sequence = (session?.humanMessages.at(-1)?.sequence ?? 0) + 1;
    const sourceRef = `user:${args.planId}:${sequence}`;
    const humanMessages = [...(session?.humanMessages ?? []), { ref: sourceRef, text, sequence }];
    // ponytail: bounded attended history. Never silently reinterpret an evicted source as current.
    if (humanMessages.length > 32) throw new Error("ONLINE_PRESENCE_CONVERSATION_LIMIT");
    const revision = (session?.revision ?? 0) + 1;
    if (session)
      await ctx.db.patch(session._id, {
        humanMessages,
        revision,
        status: "collecting",
        updatedAt: Date.now(),
      });
    else
      await ctx.db.insert("onlinePresenceSessions", {
        tenantId: args.tenantId,
        threadId: args.threadId,
        planId: args.planId,
        humanMessages,
        revision,
        status: "collecting",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    return { revision, sourceRef };
  },
});

async function sourceForDocument(
  ctx: DatabaseCtx,
  tenantId: string,
  id: Id<"vaultDocuments">,
  kind: OnlinePresenceSource["kind"],
): Promise<OnlinePresenceSource | null> {
  const doc = await ctx.db.get(id);
  if (doc) {
    const image = await imageSource(ctx, tenantId, doc);
    if (image)
      return {
        ref: image.sourceRef,
        kind: "vault",
        revision: image.sourceRevision,
        text: "Owned image selected for private website preparation. Image descriptions are not business evidence.",
        intent: "current",
        status: "approved",
        visibility: "private",
      };
    // A missing/invalid raster must not fall back to treating its generation prompt as facts.
    if (
      doc.kind === "image" ||
      doc.mimeType.startsWith("image/") ||
      doc.storedMimeType?.startsWith("image/")
    )
      return null;
  }
  if (
    !doc ||
    doc.tenantId !== tenantId ||
    doc.status !== "ready" ||
    !doc.text ||
    (kind === "vault" &&
      (doc.origin === "agent" ||
        doc.origin === "folder_digest" ||
        doc.kind === "web_research" ||
        doc.driveOwnedByMe === false))
  )
    return null;
  if (doc.text.length > 100000) return null;
  return {
    ref: `vault:${doc._id}`,
    kind,
    revision: hash({ text: doc.text, contentHash: doc.contentHash }),
    text: doc.text,
    intent: doc.text.includes("Intended future practice") ? "planned" : "current",
    // Ready owned evidence is admitted for PRIVATE preparation, never certified for public use.
    status: "approved",
    visibility: "private",
    ...(doc.retrievedAt && Date.now() - doc.retrievedAt > 24 * 60 * 60 * 1000
      ? { stale: true }
      : {}),
  };
}

async function resolveSources(
  ctx: DatabaseCtx,
  session: Session,
  selected: readonly string[] = [],
): Promise<OnlinePresenceSource[]> {
  const sources: OnlinePresenceSource[] = [];
  const seen = new Set<string>();
  const add = (source: OnlinePresenceSource | null) => {
    if (source && !seen.has(source.ref)) {
      sources.push(source);
      seen.add(source.ref);
    }
  };
  const foundation = await ctx.db
    .query("foundationRevisions")
    .withIndex("by_tenant", (q) => q.eq("tenantId", session.tenantId))
    .order("desc")
    .first();
  for (const id of foundation?.docIds.slice(0, 6) ?? [])
    add(await sourceForDocument(ctx, session.tenantId, id, "foundation"));
  const profile = await ctx.db
    .query("tenantProfiles")
    .withIndex("by_tenant", (q) => q.eq("tenantId", session.tenantId))
    .unique();
  if (profile?.blueprintDocId && profile.blueprintConfirmedAt)
    add(await sourceForDocument(ctx, session.tenantId, profile.blueprintDocId, "blueprint"));
  // Legacy confirmed profiles are useful even before the Foundation feature was enabled.
  if (!foundation) {
    const profiles = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_kind_status", (q) =>
        q.eq("tenantId", session.tenantId).eq("kind", "business_profile").eq("status", "ready"),
      )
      .order("desc")
      .take(1);
    if (profiles[0])
      add(await sourceForDocument(ctx, session.tenantId, profiles[0]._id, "foundation"));
  }
  for (const message of session.humanMessages)
    add({
      ref: message.ref,
      kind: "user",
      revision: hash(message.text),
      text: message.text,
      intent: "current",
      status: "approved",
      visibility: "unspecified",
    });
  for (const ref of selected.slice(0, 32)) {
    if (seen.has(ref) || !ref.startsWith("vault:")) continue;
    const id = ctx.db.normalizeId("vaultDocuments", ref.slice(6));
    if (id) add(await sourceForDocument(ctx, session.tenantId, id, "vault"));
  }
  return sources;
}

const selectedRefs = (brief: unknown): string[] => {
  if (
    !brief ||
    typeof brief !== "object" ||
    !("sourceRefs" in brief) ||
    !Array.isArray(brief.sourceRefs)
  )
    return [];
  return brief.sourceRefs.filter((ref): ref is string => typeof ref === "string").slice(0, 32);
};

/** Shared server-only source authority for exact shop-package review. The authenticated adapter
 * supplies tenantId; a model payload never chooses or approves a session or source revision. */
export async function onlinePresenceShopContext(
  ctx: DatabaseCtx,
  tenantId: string,
  planId: Id<"plans">,
): Promise<{ session: Session; sources: OnlinePresenceSource[] }> {
  const session = await ownedSession(ctx, tenantId, planId);
  const sources = await resolveSources(ctx, session, selectedRefs(session.brief));
  return { session, sources };
}

function brandColorSourced(assessment: Extract<OnlinePresenceAssessment, { ok: true }>): boolean {
  const color = assessment.brief.design?.primaryColor;
  if (!color) return true;
  // The pure validator has already closed this value to #RRGGBB. Match the full color token,
  // including case-insensitive evidence, rather than accepting the prefix of an eight-digit color.
  const token = new RegExp(`${color}(?![a-f0-9])`, "i");
  return assessment.sources.some((source) => token.test(source.text));
}

async function assetSourcesCurrent(
  ctx: DatabaseCtx,
  tenantId: string,
  assessment: Extract<OnlinePresenceAssessment, { ok: true }>,
): Promise<boolean> {
  try {
    const snapshots = await resolveDocumentAssets(
      ctx,
      tenantId,
      materializeWebRecipe(assessment.recipeId, assessment.input),
    );
    for (const snapshot of snapshots) {
      const row = await ctx.db.get(snapshot.assetId);
      const source = assessment.sources.find((entry) => entry.ref === snapshot.sourceRef);
      if (!row || !source || row.sourceRevision !== source.revision) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function localDestinationAvailable(
  ctx: DatabaseCtx,
  tenantId: string,
  href: string,
): Promise<boolean> {
  if (!href.startsWith("/")) return true;
  const match = /^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(href);
  if (!match) return false;
  const project = await ctx.db
    .query("webProjects")
    .withIndex("by_tenant_slug", (q) => q.eq("tenantId", tenantId).eq("slug", match[1] ?? ""))
    .first();
  if (!project?.publishedVersion || project.kind === "storefront") return false;
  const version = await ctx.db
    .query("webProjectVersions")
    .withIndex("by_tenant_project_version", (q) =>
      q
        .eq("tenantId", tenantId)
        .eq("projectId", project._id)
        .eq("version", project.publishedVersion ?? 0),
    )
    .first();
  return (
    !!version &&
    version.contentHash === project.publishedContentHash &&
    version.document.pages.some((page: { slug: string }) => page.slug === match[2])
  );
}

type StatusAssessment =
  | {
      ok: false;
      missing: readonly OnlinePresenceMissing[];
      warnings: readonly OnlinePresenceWarning[];
    }
  | {
      ok: true;
      warnings: readonly OnlinePresenceWarning[];
      recipeId: "business-site" | "campaign-landing" | "storefront-catalogue";
      publicationRequiresExactVersionApproval: true;
    };
const statusAssessment = (assessment: OnlinePresenceAssessment): StatusAssessment =>
  assessment.ok
    ? {
        ok: true,
        warnings: assessment.warnings,
        recipeId: assessment.recipeId,
        publicationRequiresExactVersionApproval: true,
      }
    : assessment;

/** Requested excerpts and the latest human answer get priority inside a fixed content budget.
 * All refs remain visible so the agent can request a different excerpt without asking the user. */
function contextSources(
  sources: OnlinePresenceSource[],
  requested: readonly string[],
): OnlinePresenceSource[] {
  const latest = sources.filter((source) => source.kind === "user").at(-1)?.ref;
  const order = [
    ...new Set([...(latest ? [latest] : []), ...requested, ...sources.map((source) => source.ref)]),
  ];
  const projected = new Map<string, OnlinePresenceSource>();
  let remaining = 24000;
  for (const ref of order) {
    const source = sources.find((entry) => entry.ref === ref);
    if (!source) continue;
    const text = source.text.slice(0, Math.min(6000, remaining));
    remaining -= text.length;
    projected.set(ref, {
      ...source,
      text,
      ...(text.length < source.text.length ? { truncated: true } : {}),
    });
  }
  return sources.map(
    (source) => projected.get(source.ref) ?? { ...source, text: "", truncated: true },
  );
}

export type OnlinePresenceArtifactReceipt = {
  kind: "site" | "landing" | "storefront";
  projectId: Id<"webProjects">;
  version: number;
  contentHash: string;
  projectUrl: string;
  approvedVersion?: number;
  publishedVersion?: number;
  currentDraftVersion?: number;
  projectRevision: number;
  publicationRequiresExactVersionApproval: true;
};
async function artifactFor(
  ctx: DatabaseCtx,
  session: Session,
): Promise<OnlinePresenceArtifactReceipt | null> {
  if (!session.projectId || session.projectVersion === undefined || !session.projectContentHash)
    return null;
  const project = await ctx.db.get(session.projectId);
  if (!project || project.tenantId !== session.tenantId) return null;
  const version = await ctx.db
    .query("webProjectVersions")
    .withIndex("by_tenant_project_version", (q) =>
      q
        .eq("tenantId", session.tenantId)
        .eq("projectId", project._id)
        .eq("version", session.projectVersion ?? 0),
    )
    .first();
  if (!version || version.contentHash !== session.projectContentHash) return null;
  return {
    kind: project.kind,
    projectId: project._id,
    version: session.projectVersion,
    contentHash: session.projectContentHash,
    projectUrl: `/dashboard/sites?project=${project._id}`,
    ...(project.approvedVersion === session.projectVersion &&
    project.approvedContentHash === session.projectContentHash
      ? { approvedVersion: project.approvedVersion }
      : {}),
    ...(project.publishedVersion === session.projectVersion &&
    project.publishedContentHash === session.projectContentHash
      ? { publishedVersion: project.publishedVersion }
      : {}),
    ...(project.draftVersion === undefined ? {} : { currentDraftVersion: project.draftVersion }),
    projectRevision: project.revision,
    publicationRequiresExactVersionApproval: true,
  };
}

export type OnlinePresenceContext = {
  assetCandidates: Awaited<ReturnType<typeof listImageCandidates>>;
  shopSetupReview: ShopSetupReview | null;
  briefBuilt: boolean;
  revision: number;
  threadId: string;
  planId: Id<"plans">;
  sources: OnlinePresenceSource[];
  brief: unknown | null;
  artifact: OnlinePresenceArtifactReceipt | null;
  assessment: StatusAssessment | null;
  latestUserMessage: string;
};

export const contextForTenant = internalQuery({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    sourceRefs: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<OnlinePresenceContext> => {
    const session = await ownedSession(ctx, args.tenantId, args.planId);
    const sources = await resolveSources(
      ctx,
      session,
      args.sourceRefs ?? selectedRefs(session.brief),
    );
    const assessment = assessOnlinePresenceBrief(session.brief, sources);
    return {
      briefBuilt:
        assessment.ok &&
        session.builtBriefHash ===
          hash({
            brief: assessment.brief,
            sourceSnapshots: assessment.sources.map(({ ref, revision }) => ({ ref, revision })),
          }),
      revision: session.revision,
      threadId: session.threadId,
      planId: session.planId,
      sources: contextSources(sources, args.sourceRefs ?? selectedRefs(session.brief)),
      brief: session.brief ?? null,
      artifact: await artifactFor(ctx, session),
      assessment: session.brief === undefined ? null : statusAssessment(assessment),
      latestUserMessage: session.humanMessages.at(-1)?.text ?? "",
      assetCandidates: await listImageCandidates(ctx, args.tenantId),
      shopSetupReview:
        session.brief && typeof session.brief === "object" && session.brief.kind === "shop"
          ? await shopSetupReviewForTenant(ctx, args.tenantId, args.planId)
          : null,
    };
  },
});

export const saveBrief = internalMutation({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    expectedRevision: v.number(),
    brief: v.any(),
    clearFields: v.optional(
      v.array(
        v.union(
          v.literal("offer"),
          v.literal("services"),
          v.literal("about"),
          v.literal("ctaLabel"),
          v.literal("ctaHref"),
          v.literal("proof"),
          v.literal("contactConsent"),
          v.literal("design"),
          v.literal("media"),
          v.literal("catalogue"),
          v.literal("shopSetup"),
        ),
      ),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; revision: number; assessment: StatusAssessment }> => {
    await assertTenantWritable(ctx, args.tenantId);
    const session = await ownedSession(ctx, args.tenantId, args.planId);
    if (session.revision !== args.expectedRevision) throw new Error("STALE_REVISION");
    const merged = mergeOnlinePresenceBrief(session.brief, args.brief, args.clearFields);
    if (!merged.ok)
      return {
        ok: false,
        revision: session.revision,
        assessment: { ok: false, missing: merged.missing, warnings: [] },
      };
    const brief = merged.brief;
    if ((merged.inheritedMedia || merged.inheritedCatalogue) && Array.isArray(brief.sourceRefs)) {
      const images: { storageRef: string }[] = [];
      if (merged.inheritedMedia && validateWebRecipeMedia(brief.media))
        images.push(
          ...[brief.media.logo, brief.media.hero, ...(brief.media.gallery ?? [])].filter(
            (image): image is NonNullable<typeof image> => image !== undefined,
          ),
        );
      if (merged.inheritedCatalogue && Array.isArray(brief.catalogue)) {
        for (const item of brief.catalogue) {
          if (item && typeof item === "object" && typeof item.imageStorageRef === "string")
            images.push({ storageRef: item.imageStorageRef });
        }
      }
      const refs: string[] = [];
      for (const image of images) {
        if (!image) continue;
        const ref = parseWebAssetRef(image.storageRef);
        const id = ref ? ctx.db.normalizeId("webAssets", ref.assetId) : null;
        const asset = id ? await ctx.db.get(id) : null;
        if (
          !ref ||
          !asset ||
          asset.tenantId !== args.tenantId ||
          asset.contentHash !== ref.contentHash
        )
          return {
            ok: false,
            revision: session.revision,
            assessment: {
              ok: false,
              missing: [
                {
                  field: "media",
                  reason: "unknown_source",
                  question:
                    "The retained image is unavailable; select an owned prepared image or explicitly clear media.",
                },
              ],
              warnings: [],
            },
          };
        refs.push(`vault:${asset.vaultDocumentId}`);
      }
      brief.sourceRefs = [
        ...brief.sourceRefs,
        ...new Set(refs.filter((ref) => !(brief.sourceRefs as unknown[]).includes(ref))),
      ];
    }
    if (merged.inheritedShopSetup && Array.isArray(brief.sourceRefs)) {
      const previous = new Map(
        (session.sourceSnapshots ?? []).map((snapshot) => [snapshot.ref, snapshot.revision]),
      );
      const refs = merchantSetupSourceRefs(brief.shopSetup).filter((ref) => previous.has(ref));
      const current = await resolveSources(ctx, session, [...selectedRefs(brief), ...refs]);
      if (
        refs.some((ref) => {
          const source = current.find((source) => source.ref === ref);
          return (
            !source ||
            source.revision !== previous.get(ref) ||
            source.status !== "approved" ||
            source.intent !== "current" ||
            source.stale
          );
        })
      )
        return {
          ok: false,
          revision: session.revision,
          assessment: {
            ok: false,
            missing: [
              {
                field: "shopSetup",
                reason: "unknown_source",
                question:
                  "Refresh the changed or unavailable shop setup evidence before retaining this package.",
              },
            ],
            warnings: [],
          },
        };
      brief.sourceRefs = [...new Set([...brief.sourceRefs, ...refs])];
    }
    const sources = await resolveSources(ctx, session, selectedRefs(brief));
    const assessment = assessOnlinePresenceBrief(brief, sources);
    if (assessment.ok && !(await assetSourcesCurrent(ctx, args.tenantId, assessment)))
      return {
        ok: false,
        revision: session.revision,
        assessment: {
          ok: false,
          missing: [
            {
              field: "media",
              reason: "unknown_source",
              question:
                "Use prepared owned images and include each returned image source reference in the brief.",
            },
          ],
          warnings: assessment.warnings,
        },
      };
    if (assessment.ok && !brandColorSourced(assessment))
      return {
        ok: false,
        revision: session.revision,
        assessment: {
          ok: false,
          missing: [
            {
              field: "design.primaryColor",
              reason: "missing",
              question:
                "Use a brand color explicitly stated in the selected business evidence, or omit it for a suitable default palette.",
            },
          ],
          warnings: assessment.warnings,
        },
      };
    // Source/disclosure wording must occur in a real user message; a model cannot invent consent.
    const consent = brief.contactConsent;
    if (
      typeof consent === "string" &&
      !session.humanMessages.some((message) => message.text.includes(consent))
    )
      return {
        ok: false,
        revision: session.revision,
        assessment: {
          ok: false,
          missing: [
            {
              field: "contactConsent",
              reason: "missing",
              question: "Provide the exact inquiry consent/disclosure wording to use.",
            },
          ],
          warnings: assessment.warnings,
        },
      };
    if (
      assessment.ok &&
      assessment.brief.ctaHref &&
      !(await localDestinationAvailable(ctx, args.tenantId, assessment.brief.ctaHref))
    )
      return {
        ok: false,
        revision: session.revision,
        assessment: {
          ok: false,
          missing: [
            {
              field: "ctaHref",
              reason: "unsupported_sales_path",
              question:
                "Provide an existing published page destination or a real HTTPS inquiry/booking URL.",
            },
          ],
          warnings: assessment.warnings,
        },
      };
    if (
      assessment.ok &&
      assessment.brief.ctaHref &&
      !assessment.sources.some((source) => source.text.includes(assessment.brief.ctaHref ?? ""))
    )
      return {
        ok: false,
        revision: session.revision,
        assessment: {
          ok: false,
          missing: [
            {
              field: "ctaHref",
              reason: "missing",
              question: "Provide the real inquiry or booking destination to use.",
            },
          ],
          warnings: assessment.warnings,
        },
      };
    // Preserve incomplete requirements, including the requested shop, without persisting malformed
    // or unbounded tool payloads. They still cannot reach the materializer until assessment passes.
    if (!assessment.ok) {
      if (
        !assessment.missing.some((entry) => entry.reason === "invalid") &&
        JSON.stringify(brief).length <= 32000
      ) {
        const revision = session.revision + 1;
        await ctx.db.patch(session._id, {
          brief,
          sourceSnapshots: undefined,
          revision,
          status: assessment.missing.some((entry) => entry.reason === "commerce_unavailable")
            ? "blocked"
            : "collecting",
          updatedAt: Date.now(),
        });
        return { ok: false, revision, assessment: statusAssessment(assessment) };
      }
      return { ok: false, revision: session.revision, assessment: statusAssessment(assessment) };
    }
    const revision = session.revision + 1;
    await ctx.db.patch(session._id, {
      brief: assessment.brief,
      sourceSnapshots: assessment.sources.map(({ ref, revision }) => ({ ref, revision })),
      revision,
      status: "ready",
      updatedAt: Date.now(),
    });
    return { ok: true, revision, assessment: statusAssessment(assessment) };
  },
});

export async function prepareRequiredDesign(
  ctx: MutationCtx,
  args: { tenantId: string; planId: Id<"plans">; expectedRevision: number },
) {
  await assertTenantWritable(ctx, args.tenantId);
  const session = await ownedSession(ctx, args.tenantId, args.planId);
  if (session.revision !== args.expectedRevision) throw new Error("STALE_REVISION");
  const sources = await resolveSources(ctx, session, selectedRefs(session.brief));
  const assessment = assessOnlinePresenceBrief(session.brief, sources);
  if (!assessment.ok)
    return {
      ok: false as const,
      revision: session.revision,
      assessment: statusAssessment(assessment),
    };
  if (!(await assetSourcesCurrent(ctx, args.tenantId, assessment)))
    return { ok: false as const, revision: session.revision, reason: "asset_source_unavailable" };
  if (!brandColorSourced(assessment))
    return { ok: false as const, revision: session.revision, reason: "brand_color_not_sourced" };
  if (
    assessment.brief.contactConsent &&
    !session.humanMessages.some((message) =>
      message.text.includes(assessment.brief.contactConsent ?? ""),
    )
  )
    return { ok: false as const, revision: session.revision, reason: "consent_not_user_supplied" };
  if (
    assessment.brief.ctaHref &&
    !assessment.sources.some((source) => source.text.includes(assessment.brief.ctaHref ?? ""))
  )
    return { ok: false as const, revision: session.revision, reason: "destination_not_sourced" };
  if (
    assessment.brief.ctaHref &&
    !(await localDestinationAvailable(ctx, args.tenantId, assessment.brief.ctaHref))
  )
    return { ok: false as const, revision: session.revision, reason: "destination_unavailable" };
  if (
    hash(session.sourceSnapshots) !==
    hash(assessment.sources.map(({ ref, revision }) => ({ ref, revision })))
  )
    return { ok: false as const, revision: session.revision, reason: "source_revision_changed" };
  const briefHash = hash({ brief: assessment.brief, sourceSnapshots: session.sourceSnapshots });
  if (session.builtBriefHash === briefHash) {
    const artifact = await artifactFor(ctx, session);
    if (artifact) return { ok: true as const, revision: session.revision, artifact };
    return { ok: false as const, revision: session.revision, reason: "project_missing" };
  }
  const existing = session.projectId ? await ctx.db.get(session.projectId) : null;
  if (existing && existing.tenantId !== args.tenantId)
    throw new Error("ONLINE_PRESENCE_UNAVAILABLE");
  if (session.projectId && !existing)
    return { ok: false as const, revision: session.revision, reason: "project_missing" };
  const slug =
    existing?.slug ??
    `presence-${hash({ tenantId: args.tenantId, sessionId: session._id }).slice(0, 24)}`;
  const values =
    assessment.recipeId === "business-site"
      ? { ...assessment.input, pageMode: "multi-page", projectSlug: slug }
      : assessment.input;
  const prepared = await materializeActiveRecipe(ctx, assessment.recipeId, values);
  if (existing && existing.kind !== prepared.document.kind)
    return { ok: false as const, revision: session.revision, reason: "project_kind_changed" };

  return {
    ok: true as const,
    session,
    assessment,
    prepared,
    existing,
    slug,
    briefHash,
    sourceFingerprint: hash(assessment.sources.map(({ ref, revision }) => ({ ref, revision }))),
  };
}

export const designSnapshot = internalMutation({
  args: { tenantId: v.string(), planId: v.id("plans"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const snapshot = await prepareRequiredDesign(ctx, args);
    if (!snapshot.ok || !snapshot.prepared || !snapshot.session || !snapshot.assessment)
      return snapshot;
    return {
      ok: true as const,
      revision: snapshot.session.revision,
      briefHash: snapshot.briefHash,
      sourceFingerprint: snapshot.sourceFingerprint,
      brief: snapshot.assessment.brief,
      document: snapshot.prepared.document,
      recipeRef: snapshot.prepared.recipeRef,
      slug: snapshot.slug,
    };
  },
});

export const buildProject = internalMutation({
  args: {
    tenantId: v.string(),
    planId: v.id("plans"),
    expectedRevision: v.number(),
    designCompletion: v.optional(v.object({ profile: v.any(), providerReceipt: v.any() })),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    revision: number;
    artifact?: OnlinePresenceArtifactReceipt;
    reason?: string;
    assessment?: StatusAssessment;
  }> => {
    const snapshot = await prepareRequiredDesign(ctx, args);
    if (!snapshot.ok || !snapshot.prepared || !snapshot.session || !snapshot.assessment)
      return snapshot;
    const { session, assessment, prepared, existing, slug, briefHash, sourceFingerprint } =
      snapshot;
    if (!args.designCompletion)
      return { ok: false, revision: session.revision, reason: "required_design_pipeline" };
    const completion = args.designCompletion;
    if (
      !validateDesignProfileRef(completion.profile) ||
      !validateWebLayoutPlan(completion.profile.layoutPlan)
    )
      throw Error("PRESENCE_DESIGN_PROFILE_INVALID");
    const providerReceipt = completion.providerReceipt as WebProviderReceipt;
    if (
      providerReceipt.briefHash !== briefHash ||
      providerReceipt.sourceFingerprint !== sourceFingerprint ||
      providerReceipt.layoutHash !== hash(canonicalWebLayoutPlan(completion.profile.layoutPlan))
    )
      throw Error("PRESENCE_DESIGN_CONTEXT_CHANGED");
    const evidence = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) =>
        q.eq("correlationId", "presence-design:" + args.planId + ":" + providerReceipt.runRef),
      )
      .take(5);
    const claimed = evidence[0],
      terminal = evidence.at(-1);
    if (
      !claimed ||
      !terminal ||
      claimed.tenantId !== args.tenantId ||
      claimed.actor !== "presence-design-control" ||
      claimed.payload.workflow !== true ||
      claimed.payload.revision !== session.revision ||
      claimed.payload.sourceFingerprint !== sourceFingerprint ||
      terminal.eventType !== "presence_design.kimi_complete" ||
      terminal.payload.designHash !== providerReceipt.stitchHash ||
      terminal.payload.proposalHash !== providerReceipt.kimiHash ||
      terminal.payload.artifactsHash !==
        hash(
          providerReceipt.artifactHashes.map(({ pageSlug, contentHash }) => ({
            pageSlug,
            contentHash,
          })),
        )
    )
      throw Error("PRESENCE_DESIGN_EVIDENCE_REQUIRED");
    prepared.recipeRef.designProfile = completion.profile;
    const versionSourceRefs = assessment.sources.map(
      (source) => `${source.ref}#${source.revision}`,
    );
    const scoped = Object.assign(ctx, { tenantId: args.tenantId, userId: args.tenantId });
    const receipt = existing
      ? await reviseProjectWithVersion(scoped, {
          projectId: existing._id,
          document: prepared.document,
          expectedRevision: existing.revision,
          recipeRef: prepared.recipeRef,
          providerReceipt,
          createdBy: args.tenantId,
          sourceRefs: versionSourceRefs,
          sourceWarnings: assessment.warnings,
        })
      : await createProjectWithVersion(scoped, {
          kind: prepared.document.kind,
          slug,
          title: assessment.brief.businessName,
          document: prepared.document,
          recipeRef: prepared.recipeRef,
          providerReceipt,
          createdBy: args.tenantId,
          sourceRefs: versionSourceRefs,
          sourceWarnings: assessment.warnings,
        });
    const revision = session.revision + 1;
    await ctx.db.patch(session._id, {
      projectId: receipt.projectId,
      projectVersion: receipt.version,
      projectContentHash: receipt.contentHash,
      builtBriefHash: briefHash,
      status: "awaiting_review",
      revision,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get(session._id);
    if (!updated) throw new Error("ONLINE_PRESENCE_UNAVAILABLE");
    const artifact = await artifactFor(ctx, updated);
    if (!artifact) throw new Error("ONLINE_PRESENCE_UNAVAILABLE");
    await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("presenceBrowserRun:run"), {
      tenantId: args.tenantId,
      projectId: receipt.projectId,
      version: receipt.version,
    });
    return { ok: true, revision, artifact };
  },
});

export const sessionForThread = tenantQuery({
  args: { threadId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    | (Session & {
        artifact: OnlinePresenceArtifactReceipt | null;
        assessment: StatusAssessment | null;
      })
    | null
  > => {
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_thread", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("threadId", args.threadId),
      )
      .unique();
    if (!session) return null;
    await ownedPlan(ctx, ctx.tenantId, session.planId);
    const sources = await resolveSources(ctx, session, selectedRefs(session.brief));
    return {
      ...session,
      artifact: await artifactFor(ctx, session),
      assessment:
        session.brief === undefined
          ? null
          : statusAssessment(assessOnlinePresenceBrief(session.brief, sources)),
    };
  },
});

/** Routing lookup before any paid model call. Absence is a normal result. */
export const lookupSession = internalQuery({
  args: {
    tenantId: v.string(),
    planId: v.optional(v.id("plans")),
    threadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    sessionId: Id<"onlinePresenceSessions">;
    threadId: string;
    revision: number;
  } | null> => {
    const plan = args.planId ? await ownedPlan(ctx, args.tenantId, args.planId) : null;
    const threadId = args.threadId ?? plan?.threadId;
    if (!threadId || (plan && plan.threadId !== threadId)) return null;
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_thread", (q) =>
        q.eq("tenantId", args.tenantId).eq("threadId", threadId),
      )
      .unique();
    if (session) await ownedPlan(ctx, args.tenantId, session.planId);
    return session && (!plan || session.planId === plan._id)
      ? { sessionId: session._id, threadId: session.threadId, revision: session.revision }
      : null;
  },
});

/** Review evidence comes from the exact immutable version, never the session's latest brief. */
export const sessionForProject = tenantQuery({
  args: { projectId: v.id("webProjects"), version: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    threadId: string;
    revision: number;
    projectId: Id<"webProjects">;
    version: number;
    contentHash: string;
    sourceRefs: string[];
    sourceWarnings: { code: string; sourceRef?: string }[];
  } | null> => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tenantId !== ctx.tenantId) return null;
    const session = await ctx.db
      .query("onlinePresenceSessions")
      .withIndex("by_tenant_project", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("projectId", args.projectId),
      )
      .first();
    if (!session) return null;
    await ownedPlan(ctx, ctx.tenantId, session.planId);
    const requested = args.version ?? session.projectVersion;
    if (requested === undefined || !Number.isSafeInteger(requested) || requested < 1) return null;
    const version = await ctx.db
      .query("webProjectVersions")
      .withIndex("by_tenant_project_version", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("projectId", project._id).eq("version", requested),
      )
      .first();
    if (!version) return null;
    return {
      threadId: session.threadId,
      revision: session.revision,
      projectId: project._id,
      version: version.version,
      contentHash: version.contentHash,
      sourceRefs: version.sourceRefs,
      sourceWarnings: version.sourceWarnings ?? [
        { code: "publication_permission_unset" },
        { code: "claim_support_requires_review" },
      ],
    };
  },
});
