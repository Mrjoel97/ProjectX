import { designKnowledgeBundle } from "./designKnowledge.generated";

/** Immutable identities accepted from the Plan 49-01 offline compiler. */
export const DESIGN_KNOWLEDGE_SCHEMA_VERSION = "design-knowledge-v1" as const;
export const DESIGN_KNOWLEDGE_COMPILER_HASH =
  "1bc4fd5816563fb9195f3f47cf30eb04d2e3c2734b0db7b4b355aff12272b8f5" as const;
export const DESIGN_KNOWLEDGE_INPUT_HASH =
  "cc6ba41543fec188a611c9c66c76cad1e97b46ad132374c68b33c0a43b15bec8" as const;
export const DESIGN_KNOWLEDGE_BUNDLE_HASH =
  "d818e4d9ab6fcf85b3725d578edf2fbace642dc0472e1d94922c030f7df016a8" as const;

export type DesignSourceRole = "ui-ux-pro-max" | "taste-skill" | "nexscope-ecommerce";
export type DesignSourceStatus = "active" | "supplemental" | "experimental" | "excluded";
export type DesignRuleSeverity = "must" | "should" | "advisory";
export type DesignRuleCategory =
  | "security"
  | "privacy"
  | "legal"
  | "accessibility"
  | "semantics"
  | "brand"
  | "aesthetics"
  | "commerce-boundary";

export type DesignKnowledgeRecord = {
  readonly id: string;
  readonly kind:
    | "landingPattern"
    | "designProfile"
    | "formRule"
    | "paletteProfile"
    | "tasteDial"
    | "typographyProfile"
    | "catalogueCopy";
  readonly sourceRole: DesignSourceRole;
  readonly status: DesignSourceStatus;
  readonly label: string;
  readonly category: DesignRuleCategory;
  readonly severity: DesignRuleSeverity;
  readonly applicability: readonly string[];
  readonly conflicts: readonly string[];
  readonly sourceRefs: readonly string[];
};

export type DesignKnowledgeBundle = {
  readonly schemaVersion: typeof DESIGN_KNOWLEDGE_SCHEMA_VERSION;
  readonly compilerSchemaVersion: typeof DESIGN_KNOWLEDGE_SCHEMA_VERSION;
  readonly compilerHash: typeof DESIGN_KNOWLEDGE_COMPILER_HASH;
  readonly inputHash: typeof DESIGN_KNOWLEDGE_INPUT_HASH;
  readonly bundleHash: typeof DESIGN_KNOWLEDGE_BUNDLE_HASH;
  readonly records: readonly DesignKnowledgeRecord[];
};

export type DesignDials = {
  readonly variance: number;
  readonly motion: number;
  readonly density: number;
};

export type DesignBrief = {
  readonly businessType?: string;
  readonly audience?: string;
  readonly brandName?: string;
  readonly tone?: string;
  readonly pageGoal?: "business" | "campaign" | "catalogue" | "unknown";
  readonly accessibilityPosture?: "standard" | "high";
  readonly regulatoryPosture?: "standard" | "strict";
  readonly dials?: Partial<DesignDials>;
};

export type DesignProfileRef = {
  readonly bundleHash: typeof DESIGN_KNOWLEDGE_BUNDLE_HASH;
  readonly compilerHash: typeof DESIGN_KNOWLEDGE_COMPILER_HASH;
  readonly patternId: string;
  readonly styleId: string;
  readonly paletteId: string;
  readonly typographyId: string;
  readonly formProfileId: string;
  readonly dials: DesignDials;
  readonly pageOverride?: string;
};

export type DesignSelection = {
  readonly profile: DesignProfileRef;
  readonly fallback: boolean;
  readonly reason?: "unknown_brief" | "bounded_match";
};

export const DESIGN_PRECEDENCE = [
  "pikar-security-privacy-legal",
  "accessibility-semantics",
  "tenant-brand-facts",
  "aesthetic-guidance",
] as const;

const REQUIRED_RECORDS = [
  "landing-proof",
  "product-copy",
  "minimal-swiss",
  "forms-first",
  "hero-features-cta",
  "trust-commerce",
  "taste-baseline",
  "modern-professional",
] as const;

const METADATA: Record<
  string,
  Omit<DesignKnowledgeRecord, "id" | "label"> & { readonly label?: string }
> = {
  "landing-proof": {
    sourceRole: "nexscope-ecommerce",
    status: "supplemental",
    category: "semantics",
    severity: "should",
    applicability: ["landing", "campaign"],
    conflicts: [],
    sourceRefs: ["nexscope:ecommerce-landing-audit"],
    kind: "catalogueCopy",
  },
  "product-copy": {
    sourceRole: "nexscope-ecommerce",
    status: "supplemental",
    category: "brand",
    severity: "advisory",
    applicability: ["site", "landing", "storefront"],
    conflicts: [],
    sourceRefs: ["nexscope:product-description"],
    kind: "catalogueCopy",
  },
  "minimal-swiss": {
    sourceRole: "ui-ux-pro-max",
    status: "active",
    category: "aesthetics",
    severity: "advisory",
    applicability: ["site", "landing", "storefront"],
    conflicts: ["motion-excess"],
    sourceRefs: ["ui-ux-pro-max:style-catalogue"],
    kind: "designProfile",
  },
  "forms-first": {
    sourceRole: "ui-ux-pro-max",
    status: "active",
    category: "accessibility",
    severity: "must",
    applicability: ["site", "landing"],
    conflicts: [],
    sourceRefs: ["ui-ux-pro-max:form-guidelines"],
    kind: "formRule",
  },
  "hero-features-cta": {
    sourceRole: "ui-ux-pro-max",
    status: "active",
    category: "semantics",
    severity: "should",
    applicability: ["landing", "campaign"],
    conflicts: [],
    sourceRefs: ["ui-ux-pro-max:landing-patterns"],
    kind: "landingPattern",
  },
  "trust-commerce": {
    sourceRole: "nexscope-ecommerce",
    status: "supplemental",
    category: "commerce-boundary",
    severity: "should",
    applicability: ["storefront"],
    conflicts: [],
    sourceRefs: ["nexscope:brand-trust"],
    kind: "paletteProfile",
  },
  "taste-baseline": {
    sourceRole: "taste-skill",
    status: "experimental",
    category: "aesthetics",
    severity: "advisory",
    applicability: ["site", "landing", "storefront"],
    conflicts: [],
    sourceRefs: ["taste:design-dials"],
    kind: "tasteDial",
  },
  "modern-professional": {
    sourceRole: "ui-ux-pro-max",
    status: "active",
    category: "aesthetics",
    severity: "advisory",
    applicability: ["site", "landing", "storefront"],
    conflicts: [],
    sourceRefs: ["ui-ux-pro-max:typography"],
    kind: "typographyProfile",
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
const boundedDial = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
const PROFILE_IDS = {
  pattern: new Set(["landing-proof", "hero-features-cta"]),
  style: new Set(["minimal-swiss"]),
  palette: new Set(["trust-commerce"]),
  typography: new Set(["modern-professional"]),
  form: new Set(["forms-first"]),
} as const;

function buildRecord(id: string, label: string): DesignKnowledgeRecord {
  const metadata = METADATA[id];
  if (!metadata) throw new Error(`DESIGN_KNOWLEDGE_RECORD_UNKNOWN:${id}`);
  return { id, label, ...metadata };
}

/** Parse only the exact generated Plan 49-01 shape; unknown/partial bundles fail closed. */
export function parseDesignKnowledgeBundle(
  input: unknown = designKnowledgeBundle,
): DesignKnowledgeBundle {
  if (
    !isRecord(input) ||
    !hasOnly(input, ["schemaVersion", "compilerSchemaVersion", "inputHash", "records"])
  )
    throw new Error("DESIGN_KNOWLEDGE_BUNDLE_INVALID");
  // The generated module is the sole accepted canonical byte shape. This exact comparison
  // rejects label/data edits, reordered or duplicate records, missing records and identity drift
  // before any derived metadata can be trusted.
  if (JSON.stringify(input) !== JSON.stringify(designKnowledgeBundle))
    throw new Error("DESIGN_KNOWLEDGE_BUNDLE_BYTES_INVALID");
  if (
    input.schemaVersion !== 1 ||
    input.compilerSchemaVersion !== DESIGN_KNOWLEDGE_SCHEMA_VERSION ||
    input.inputHash !== DESIGN_KNOWLEDGE_INPUT_HASH ||
    !Array.isArray(input.records) ||
    input.records.length !== REQUIRED_RECORDS.length
  )
    throw new Error("DESIGN_KNOWLEDGE_BUNDLE_IDENTITY_INVALID");
  const records = input.records.map((record) => {
    if (
      !isRecord(record) ||
      !hasOnly(record, ["id", "kind", "data"]) ||
      typeof record.id !== "string"
    )
      throw new Error("DESIGN_KNOWLEDGE_RECORD_INVALID");
    if (
      !REQUIRED_RECORDS.includes(record.id as (typeof REQUIRED_RECORDS)[number]) ||
      !isRecord(record.data)
    )
      throw new Error(`DESIGN_KNOWLEDGE_RECORD_UNKNOWN:${record.id}`);
    const label = record.data.label;
    if (typeof label !== "string" || label.length === 0)
      throw new Error("DESIGN_KNOWLEDGE_LABEL_INVALID");
    const metadata = METADATA[record.id];
    if (!metadata) throw new Error(`DESIGN_KNOWLEDGE_RECORD_UNKNOWN:${record.id}`);
    if (record.kind !== metadata.kind)
      throw new Error(`DESIGN_KNOWLEDGE_KIND_INVALID:${record.id}`);
    return buildRecord(record.id, label);
  });
  const ids = records.map((record) => record.id);
  if (
    new Set(ids).size !== REQUIRED_RECORDS.length ||
    ids.some((id) => !REQUIRED_RECORDS.includes(id as never))
  )
    throw new Error("DESIGN_KNOWLEDGE_RECORD_SET_INVALID");
  return {
    schemaVersion: DESIGN_KNOWLEDGE_SCHEMA_VERSION,
    compilerSchemaVersion: DESIGN_KNOWLEDGE_SCHEMA_VERSION,
    compilerHash: DESIGN_KNOWLEDGE_COMPILER_HASH,
    inputHash: DESIGN_KNOWLEDGE_INPUT_HASH,
    bundleHash: DESIGN_KNOWLEDGE_BUNDLE_HASH,
    records: records.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export const verifiedDesignKnowledgeBundle = parseDesignKnowledgeBundle();

export function validateDesignProfileRef(input: unknown): input is DesignProfileRef {
  if (
    !isRecord(input) ||
    !hasOnly(input, [
      "bundleHash",
      "compilerHash",
      "patternId",
      "styleId",
      "paletteId",
      "typographyId",
      "formProfileId",
      "dials",
      "pageOverride",
    ])
  )
    return false;
  if (
    input.bundleHash !== DESIGN_KNOWLEDGE_BUNDLE_HASH ||
    input.compilerHash !== DESIGN_KNOWLEDGE_COMPILER_HASH ||
    typeof input.patternId !== "string" ||
    !PROFILE_IDS.pattern.has(input.patternId) ||
    typeof input.styleId !== "string" ||
    !PROFILE_IDS.style.has(input.styleId) ||
    typeof input.paletteId !== "string" ||
    !PROFILE_IDS.palette.has(input.paletteId) ||
    typeof input.typographyId !== "string" ||
    !PROFILE_IDS.typography.has(input.typographyId) ||
    typeof input.formProfileId !== "string" ||
    !PROFILE_IDS.form.has(input.formProfileId) ||
    !isRecord(input.dials) ||
    !hasOnly(input.dials, ["variance", "motion", "density"]) ||
    !boundedDial(input.dials.variance) ||
    !boundedDial(input.dials.motion) ||
    !boundedDial(input.dials.density) ||
    (input.pageOverride !== undefined &&
      (typeof input.pageOverride !== "string" || input.pageOverride.length > 64))
  )
    return false;
  return true;
}

function dial(value: number | undefined, fallback: number): number {
  return boundedDial(value) ? value : fallback;
}

/** Deterministic closed selection; unknown briefs get one explicit bounded fallback. */
export function selectDesignProfile(brief: DesignBrief = {}): DesignSelection {
  const input = (isRecord(brief) ? brief : {}) as DesignBrief;
  const knownGoal =
    input.pageGoal === "business" ||
    input.pageGoal === "campaign" ||
    input.pageGoal === "catalogue";
  const storefront = input.pageGoal === "catalogue";
  const campaign = input.pageGoal === "campaign";
  const accessibility =
    input.accessibilityPosture === "high" || input.regulatoryPosture === "strict";
  const profile: DesignProfileRef = {
    bundleHash: DESIGN_KNOWLEDGE_BUNDLE_HASH,
    compilerHash: DESIGN_KNOWLEDGE_COMPILER_HASH,
    patternId: campaign ? "hero-features-cta" : "landing-proof",
    styleId: "minimal-swiss",
    paletteId: storefront ? "trust-commerce" : "trust-commerce",
    typographyId: "modern-professional",
    formProfileId: "forms-first",
    dials: {
      variance: dial(input.dials?.variance, 5),
      motion: accessibility ? 1 : dial(input.dials?.motion, 3),
      density: dial(input.dials?.density, storefront ? 5 : 2),
    },
    ...(campaign ? { pageOverride: "campaign" } : {}),
  };
  return {
    profile,
    fallback: !knownGoal,
    ...(knownGoal ? { reason: "bounded_match" as const } : { reason: "unknown_brief" as const }),
  };
}

export function designKnowledgeIdentity(): Readonly<{
  schemaVersion: string;
  compilerHash: string;
  inputHash: string;
  bundleHash: string;
}> {
  return {
    schemaVersion: DESIGN_KNOWLEDGE_SCHEMA_VERSION,
    compilerHash: DESIGN_KNOWLEDGE_COMPILER_HASH,
    inputHash: DESIGN_KNOWLEDGE_INPUT_HASH,
    bundleHash: DESIGN_KNOWLEDGE_BUNDLE_HASH,
  };
}
