import {
  type BusinessSiteInput,
  type CampaignLandingInput,
  validateWebRecipeInput,
} from "./webRecipes";

/** A one-time attended build, independent of the planned recurring-service engine. */
export const ONLINE_PRESENCE_TOOLS = Object.freeze([
  "readOnlinePresenceContext",
  "searchVault",
  "saveOnlinePresenceBrief",
  "buildOnlinePresenceProject",
] as const);

export type OnlinePresenceKind = "landing" | "website" | "shop";
export type OnlinePresenceBrief = {
  kind: OnlinePresenceKind;
  businessName: string;
  headline: string;
  summary: string;
  audience: string;
  offer?: string;
  services?: readonly string[];
  about?: string;
  ctaLabel?: string;
  ctaHref?: string;
  proof?: readonly string[];
  /** Exact, adapter-issued references. A reference is provenance, not proof of a claim. */
  sourceRefs: readonly string[];
  /** Exact user-supplied disclosure copy; absence means no inquiry form. */
  contactConsent?: string;
};

/** Populated by the tenant-scoped adapter, never accepted from model/tool arguments. */
export type OnlinePresenceSource = {
  ref: string;
  kind: "foundation" | "blueprint" | "vault" | "user";
  revision: string;
  text: string;
  intent: "current" | "planned";
  status: "approved" | "draft";
  visibility: "private" | "public" | "unspecified";
  stale?: boolean;
  /** A context-tool excerpt, never the full trusted snapshot used during save/build. */
  truncated?: boolean;
};

export type OnlinePresenceMissingReason =
  | "missing"
  | "invalid"
  | "unknown_source"
  | "unapproved_source"
  | "conflicting_source"
  | "unsupported_sales_path"
  | "commerce_unavailable";
export type OnlinePresenceMissing = {
  field: string;
  reason: OnlinePresenceMissingReason;
  question: string;
};
export type OnlinePresenceWarning = {
  code:
    | "private_source"
    | "publication_permission_unset"
    | "planned_source"
    | "stale_source"
    | "truncated_source"
    | "claim_support_requires_review";
  sourceRef?: string;
};
export type OnlinePresenceAssessment = {
  warnings: readonly OnlinePresenceWarning[];
} & (
  | { ok: false; missing: readonly OnlinePresenceMissing[] }
  | {
      ok: true;
      brief: OnlinePresenceBrief;
      recipeId: "campaign-landing" | "business-site";
      input: BusinessSiteInput | CampaignLandingInput;
      /** Persist these selected revisions alongside the brief; do not log their text. */
      sources: readonly OnlinePresenceSource[];
      publicationRequiresExactVersionApproval: true;
    }
);

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const list = (value: unknown, max: number, length: number): value is readonly string[] =>
  Array.isArray(value) && value.length <= length && value.every((entry) => text(entry, max));
const KEYS = [
  "kind",
  "businessName",
  "headline",
  "summary",
  "audience",
  "offer",
  "services",
  "about",
  "ctaLabel",
  "ctaHref",
  "proof",
  "sourceRefs",
  "contactConsent",
] as const;

/** Validate before saving AND immediately before materializing; selected sources can change.
 * Private approved facts can inform a private draft. They never authorize publication, and
 * source selection never certifies that generated copy is semantically supported. */
export function assessOnlinePresenceBrief(
  raw: unknown,
  sources: readonly OnlinePresenceSource[],
): OnlinePresenceAssessment {
  const missing: OnlinePresenceMissing[] = [];
  const warnings: OnlinePresenceWarning[] = [];
  const add = (field: string, reason: OnlinePresenceMissingReason, question: string) => {
    if (!missing.some((entry) => entry.field === field && entry.reason === reason))
      missing.push({ field, reason, question });
  };
  if (!record(raw))
    return {
      ok: false,
      missing: [{ field: "$", reason: "invalid", question: "Provide a structured website brief." }],
      warnings,
    };
  for (const key of Object.keys(raw))
    if (!(KEYS as readonly string[]).includes(key))
      add(key, "invalid", "Remove the unsupported brief field.");
  if (!["landing", "website", "shop"].includes(String(raw.kind)))
    add("kind", "missing", "Do you need a landing page, a business website, or an online shop?");
  // This gate is unconditional. Neither model prose nor a caller-supplied readiness bit opens commerce.
  if (raw.kind === "shop")
    add(
      "kind",
      "commerce_unavailable",
      "Online shop checkout and fulfilment are not ready. We can record requirements, but cannot deliver or publish a working shop yet.",
    );
  const required = {
    businessName: [128, "What business name should appear publicly?"],
    headline: [256, "What main message should the page communicate?"],
    summary: [4000, "What does the business offer?"],
    audience: [1000, "Who should this online presence serve?"],
  } as const;
  for (const [field, [max, question]] of Object.entries(required))
    if (!text(raw[field], max))
      add(field, raw[field] === undefined || raw[field] === "" ? "missing" : "invalid", question);
  for (const [field, max] of Object.entries({
    offer: 4000,
    about: 4000,
    ctaLabel: 128,
    ctaHref: 256,
    contactConsent: 512,
  }))
    if (raw[field] !== undefined && !text(raw[field], max))
      add(field, "invalid", `Provide valid ${field} text or leave it out.`);
  for (const [field, limit] of [
    ["services", 8],
    ["proof", 6],
  ] as const)
    if (raw[field] !== undefined && !list(raw[field], 512, limit))
      add(field, "invalid", `Provide at most ${limit} short ${field} entries.`);

  const selected: OnlinePresenceSource[] = [];
  if (!list(raw.sourceRefs, 256, 32) || raw.sourceRefs.length === 0)
    add(
      "sourceRefs",
      "missing",
      "Provide approved business information or select the supporting business documents.",
    );
  else {
    const seen = new Set<string>();
    for (const ref of raw.sourceRefs) {
      if (seen.has(ref)) {
        add("sourceRefs", "invalid", "Each source reference must appear once.");
        continue;
      }
      seen.add(ref);
      const matches = sources.filter((source) => source.ref === ref);
      if (!matches.length) {
        add(
          "sourceRefs",
          "unknown_source",
          "A selected business source is unavailable; select its current version.",
        );
        continue;
      }
      const source = matches[0];
      if (matches.length !== 1 || !source) {
        add(
          "sourceRefs",
          "conflicting_source",
          "Resolve the conflicting source versions before continuing.",
        );
        continue;
      }
      if (
        source.status !== "approved" ||
        !text(source.revision, 256) ||
        !text(source.text, 100000)
      ) {
        add(
          "sourceRefs",
          "unapproved_source",
          "Confirm the draft business information before using it for this website.",
        );
        continue;
      }
      selected.push({ ...source });
      if (source.visibility === "private")
        warnings.push({ code: "private_source", sourceRef: ref });
      if (source.visibility === "unspecified")
        warnings.push({ code: "publication_permission_unset", sourceRef: ref });
      if (source.intent === "planned") warnings.push({ code: "planned_source", sourceRef: ref });
      if (source.stale) warnings.push({ code: "stale_source", sourceRef: ref });
      if (source.truncated) warnings.push({ code: "truncated_source", sourceRef: ref });
    }
  }
  if (missing.length) return { ok: false, missing, warnings };
  const brief = raw as OnlinePresenceBrief;
  const recipeId = brief.kind === "landing" ? "campaign-landing" : "business-site";
  const input: BusinessSiteInput | CampaignLandingInput =
    recipeId === "campaign-landing"
      ? {
          brandName: brief.businessName,
          headline: brief.headline,
          offer: brief.offer ?? brief.summary,
          ...(brief.proof === undefined ? {} : { proofPoints: brief.proof }),
          ...(brief.ctaLabel === undefined ? {} : { ctaLabel: brief.ctaLabel }),
          ...(brief.ctaHref === undefined
            ? {}
            : brief.ctaHref.startsWith("/")
              ? { ctaPath: brief.ctaHref }
              : { ctaHref: brief.ctaHref }),
          ...(brief.contactConsent === undefined ? {} : { formConsent: brief.contactConsent }),
        }
      : {
          brandName: brief.businessName,
          headline: brief.headline,
          summary: brief.summary,
          ...(brief.services === undefined ? {} : { services: brief.services }),
          ...(brief.about === undefined ? {} : { about: brief.about }),
          ...(brief.ctaLabel === undefined ? {} : { ctaLabel: brief.ctaLabel }),
          ...(brief.ctaHref === undefined ? {} : { ctaHref: brief.ctaHref }),
          ...(brief.contactConsent === undefined ? {} : { contactConsent: brief.contactConsent }),
        };
  // Reuse recovered runtime validation rather than duplicate its safe URL/content contract.
  const checked = validateWebRecipeInput(recipeId, input);
  if (!checked.ok) {
    for (const error of checked.errors)
      add(
        error.path === "ctaPath" ? "ctaHref" : error.path,
        ["ctaPath", "ctaHref"].includes(error.path) ? "unsupported_sales_path" : "invalid",
        ["ctaPath", "ctaHref"].includes(error.path)
          ? "Provide a real HTTPS destination for the call to action."
          : `Revise ${error.path}: ${error.code}.`,
      );
  }
  if ((brief.ctaLabel === undefined) !== (brief.ctaHref === undefined))
    add(
      "ctaHref",
      "missing",
      "Provide both the call to action label and its real destination, or omit both.",
    );
  if (missing.length) return { ok: false, missing, warnings };
  warnings.push({ code: "claim_support_requires_review" });
  return {
    ok: true,
    brief: { ...brief, sourceRefs: [...brief.sourceRefs] },
    recipeId,
    input,
    sources: selected,
    warnings,
    publicationRequiresExactVersionApproval: true,
  };
}

export type OnlinePresenceArtifact = {
  projectId: string;
  versionId: string;
  contentHash: string;
  approvedVersionId?: string;
  publishedVersionId?: string;
};

/** Adapter receipts, never model-written state, determine the next service step. No operation
 * returned here grants approval or publication authority to a leaf agent. */
export function onlinePresenceServiceState(
  assessment: OnlinePresenceAssessment,
  artifact?: OnlinePresenceArtifact,
): "needs_information" | "ready_to_build" | "awaiting_review" | "approved" | "published" {
  if (!assessment.ok) return "needs_information";
  if (!artifact) return "ready_to_build";
  if (
    !text(artifact.projectId, 256) ||
    !text(artifact.versionId, 256) ||
    !/^(?:sha256:)?[a-f0-9]{64}$/.test(artifact.contentHash)
  )
    return "ready_to_build";
  if (
    artifact.publishedVersionId === artifact.versionId &&
    artifact.approvedVersionId === artifact.versionId
  )
    return "published";
  if (artifact.approvedVersionId === artifact.versionId) return "approved";
  return "awaiting_review";
}
