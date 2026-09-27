import type { ProjectKind, WebDocument } from "@pikar/contracts/webRuntime";
import {
  type DesignDials,
  type DesignProfileRef,
  selectDesignProfile,
  validateDesignProfileRef,
} from "./designKnowledge";
import { canonicalWebDocument, sha256Bytes, validateWebDocument } from "./webRuntime";

export const WEB_RECIPE_SCHEMA_VERSION = 1 as const;
export const WEB_RECIPE_COMPILER_ID = "web-recipes-v1" as const;
export const WEB_RECIPE_BUNDLE_HASH =
  "d818e4d9ab6fcf85b3725d578edf2fbace642dc0472e1d94922c030f7df016a8" as const;

export type WebRecipeId = "business-site" | "campaign-landing" | "storefront-catalogue";
export type WebRecipeRegistryName =
  | "web-recipe-business-site"
  | "web-recipe-campaign-landing"
  | "web-recipe-storefront-catalogue";

export type WebRecipeField = {
  readonly id: string;
  readonly label: string;
  readonly type: "text" | "text-list" | "email" | "catalogue-list" | "dials";
  readonly required: boolean;
  readonly maxLength?: number;
};

export type WebRecipeDefinition = {
  readonly id: WebRecipeId;
  readonly registryName: WebRecipeRegistryName;
  readonly family: "business" | "campaign" | "storefront";
  readonly outputKind: ProjectKind;
  readonly schemaVersion: typeof WEB_RECIPE_SCHEMA_VERSION;
  readonly compilerId: typeof WEB_RECIPE_COMPILER_ID;
  readonly bundleHash: typeof WEB_RECIPE_BUNDLE_HASH;
  readonly fields: readonly WebRecipeField[];
  readonly template: {
    readonly descriptor: string;
    readonly nodes: readonly string[];
    readonly excludes: readonly string[];
  };
  readonly bodyHash: string;
};

export type BusinessSiteInput = {
  readonly brandName: string;
  readonly headline: string;
  readonly summary?: string;
  readonly services?: readonly string[];
  readonly about?: string;
  readonly contactConsent?: string;
  readonly design?: Partial<DesignDials>;
};
export type CampaignLandingInput = {
  readonly brandName: string;
  readonly headline: string;
  readonly offer?: string;
  readonly proofPoints?: readonly string[];
  readonly ctaLabel?: string;
  readonly ctaPath?: string;
  readonly formConsent?: string;
  readonly attributionSource?: string;
  readonly design?: Partial<DesignDials>;
};
export type StorefrontCatalogueInput = {
  readonly brandName: string;
  readonly intro?: string;
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly imageStorageRef?: string;
    readonly displayPriceText?: string;
    readonly availabilityLabel?: string;
  }[];
  readonly design?: Partial<DesignDials>;
};
export type WebRecipeInput = BusinessSiteInput | CampaignLandingInput | StorefrontCatalogueInput;

export type WebRecipeValidationIssue = { readonly path: string; readonly code: string };
export type WebRecipeValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly WebRecipeValidationIssue[] };

export type WebRecipeMaterialization = {
  readonly document: WebDocument;
  readonly recipe: WebRecipeDefinition;
  readonly inputHash: string;
  readonly designProfile: DesignProfileRef;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
const text = (value: unknown, max = 4_000): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !hasControlCharacter(value) &&
  !/<\/?[a-z][^>]*>|(?:javascript:|data:(?:text|application)\/)|\bon[a-z]+\s*=|\b(?:buy|cart|checkout|payment|merchant|inventory|stock|tax|shipping|refund|fulfil(?:ment|lment)|conversion|guarantee(?:d)?|number one|#1)\b/i.test(
    value,
  );
const optionalText = (value: unknown, max = 4_000): value is string | undefined =>
  value === undefined || text(value, max);
const textList = (value: unknown, maxItems = 8): value is readonly string[] =>
  Array.isArray(value) && value.length <= maxItems && value.every((item) => text(item, 512));
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
const localPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 256 &&
  // A recipe page is served at /p/:projectSlug/:pageSlug. Keep that exact public shape
  // alongside the existing one/two-segment local destinations; never admit arbitrary depth.
  /^(?:\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?|\/p\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(
    value,
  );
const inputKeys: Record<WebRecipeId, readonly string[]> = {
  "business-site": [
    "brandName",
    "headline",
    "summary",
    "services",
    "about",
    "contactConsent",
    "design",
  ],
  "campaign-landing": [
    "brandName",
    "headline",
    "offer",
    "proofPoints",
    "ctaLabel",
    "ctaPath",
    "formConsent",
    "attributionSource",
    "design",
  ],
  "storefront-catalogue": ["brandName", "intro", "items", "design"],
};

function issue(errors: WebRecipeValidationIssue[], path: string, code: string): void {
  errors.push({ path, code });
}

function validateDials(value: unknown, path: string, errors: WebRecipeValidationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || !hasOnly(value, ["variance", "motion", "density"])) {
    issue(errors, path, "unknown_field");
    return;
  }
  for (const key of ["variance", "motion", "density"] as const) {
    if (
      value[key] !== undefined &&
      (!Number.isInteger(value[key]) || Number(value[key]) < 1 || Number(value[key]) > 10)
    )
      issue(errors, `${path}.${key}`, "dial_out_of_range");
  }
}

function validateItems(value: unknown, errors: WebRecipeValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    issue(errors, "items", "catalogue_limit");
    return;
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    if (
      !isRecord(item) ||
      !hasOnly(item, [
        "id",
        "name",
        "description",
        "imageStorageRef",
        "displayPriceText",
        "availabilityLabel",
      ])
    ) {
      issue(errors, `items[${index}]`, "unknown_field");
      return;
    }
    if (!id(item.id)) issue(errors, `items[${index}].id`, "invalid_id");
    if (typeof item.id === "string" && ids.has(item.id))
      issue(errors, `items[${index}].id`, "duplicate_id");
    if (typeof item.id === "string") ids.add(item.id);
    if (!text(item.name, 256)) issue(errors, `items[${index}].name`, "invalid_text");
    if (!text(item.description)) issue(errors, `items[${index}].description`, "invalid_text");
    if (
      item.imageStorageRef !== undefined &&
      !/^storage:[a-zA-Z0-9:_-]{1,240}$/.test(String(item.imageStorageRef))
    )
      issue(errors, `items[${index}].imageStorageRef`, "invalid_storage_ref");
    for (const key of ["displayPriceText", "availabilityLabel"] as const)
      if (item[key] !== undefined && !text(item[key], 128))
        issue(errors, `items[${index}].${key}`, "invalid_text");
  });
}

export function validateWebRecipeInput(
  idValue: WebRecipeId,
  input: unknown,
): WebRecipeValidationResult<WebRecipeInput> {
  const errors: WebRecipeValidationIssue[] = [];
  if (!RECIPES_BY_ID[idValue])
    return { ok: false, errors: [{ path: "recipe", code: "unknown_recipe" }] };
  if (!isRecord(input) || !hasOnly(input, inputKeys[idValue]))
    return { ok: false, errors: [{ path: "$", code: "unknown_field" }] };
  if (!text(input.brandName, 128)) issue(errors, "brandName", "required_text");
  if (idValue !== "storefront-catalogue" && !text(input.headline, 256))
    issue(errors, "headline", "required_text");
  validateDials(input.design, "design", errors);
  if (idValue === "business-site") {
    if (!optionalText(input.summary)) issue(errors, "summary", "invalid_text");
    if (input.services !== undefined && !textList(input.services))
      issue(errors, "services", "invalid_text_list");
    if (!optionalText(input.about)) issue(errors, "about", "invalid_text");
    if (!optionalText(input.contactConsent, 512))
      issue(errors, "contactConsent", "invalid_consent");
  } else if (idValue === "campaign-landing") {
    if (!optionalText(input.offer)) issue(errors, "offer", "invalid_text");
    if (input.proofPoints !== undefined && !textList(input.proofPoints, 6))
      issue(errors, "proofPoints", "invalid_text_list");
    if (!optionalText(input.ctaLabel, 128)) issue(errors, "ctaLabel", "invalid_text");
    if (input.ctaPath !== undefined && !localPath(input.ctaPath))
      issue(errors, "ctaPath", "invalid_path");
    if (!optionalText(input.formConsent, 512)) issue(errors, "formConsent", "invalid_consent");
    if (!optionalText(input.attributionSource, 128))
      issue(errors, "attributionSource", "invalid_attribution");
  } else {
    validateItems(input.items, errors);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: input as WebRecipeInput };
}

const definitionSeed = [
  {
    id: "business-site",
    registryName: "web-recipe-business-site",
    family: "business",
    outputKind: "site",
    fields: [
      { id: "brandName", label: "Brand name", type: "text", required: true, maxLength: 128 },
      { id: "headline", label: "Headline", type: "text", required: true, maxLength: 256 },
      { id: "summary", label: "Summary", type: "text", required: false, maxLength: 4000 },
      { id: "services", label: "Services", type: "text-list", required: false, maxLength: 512 },
      { id: "about", label: "About", type: "text", required: false, maxLength: 4000 },
      {
        id: "contactConsent",
        label: "Contact consent",
        type: "text",
        required: false,
        maxLength: 512,
      },
      { id: "design", label: "Design dials", type: "dials", required: false },
    ],
    template: {
      descriptor: "hero-summary-services-about-consented-contact",
      nodes: ["hero", "text", "section", "form"],
      excludes: ["html", "css", "js", "provider-claims", "domain-claims", "merchant-claims"],
    },
  },
  {
    id: "campaign-landing",
    registryName: "web-recipe-campaign-landing",
    family: "campaign",
    outputKind: "landing",
    fields: [
      { id: "brandName", label: "Brand name", type: "text", required: true, maxLength: 128 },
      { id: "headline", label: "Campaign headline", type: "text", required: true, maxLength: 256 },
      { id: "offer", label: "Offer", type: "text", required: false, maxLength: 4000 },
      {
        id: "proofPoints",
        label: "Publisher proof points",
        type: "text-list",
        required: false,
        maxLength: 512,
      },
      {
        id: "ctaLabel",
        label: "Call to action label",
        type: "text",
        required: false,
        maxLength: 128,
      },
      {
        id: "ctaPath",
        label: "Local call to action path",
        type: "text",
        required: false,
        maxLength: 256,
      },
      { id: "formConsent", label: "Form consent", type: "text", required: false, maxLength: 512 },
      {
        id: "attributionSource",
        label: "Attribution source",
        type: "text",
        required: false,
        maxLength: 128,
      },
      { id: "design", label: "Design dials", type: "dials", required: false },
    ],
    template: {
      descriptor: "hero-offer-proof-local-cta-consented-form",
      nodes: ["hero", "section", "cta", "form"],
      excludes: ["html", "css", "js", "pixels", "embeds", "conversion-claims"],
    },
  },
  {
    id: "storefront-catalogue",
    registryName: "web-recipe-storefront-catalogue",
    family: "storefront",
    outputKind: "storefront",
    fields: [
      { id: "brandName", label: "Brand name", type: "text", required: true, maxLength: 128 },
      {
        id: "intro",
        label: "Catalogue introduction",
        type: "text",
        required: false,
        maxLength: 4000,
      },
      {
        id: "items",
        label: "Presentation items",
        type: "catalogue-list",
        required: true,
        maxLength: 20,
      },
      { id: "design", label: "Design dials", type: "dials", required: false },
    ],
    template: {
      descriptor: "catalogue-presentation-without-ordering",
      nodes: ["hero", "catalogue", "text"],
      excludes: [
        "inventory",
        "quantity",
        "cart",
        "buy",
        "checkout",
        "payment",
        "merchant",
        "tax",
        "shipping",
        "refund",
        "order",
        "fulfilment",
        "html",
        "css",
        "js",
      ],
    },
  },
] as const;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function stableHash(value: string): string {
  return `sha256:${sha256Bytes(new TextEncoder().encode(value))}`;
}

const RECIPES_BY_ID = Object.fromEntries(
  definitionSeed.map((seed) => {
    const base = {
      ...seed,
      schemaVersion: WEB_RECIPE_SCHEMA_VERSION,
      compilerId: WEB_RECIPE_COMPILER_ID,
      bundleHash: WEB_RECIPE_BUNDLE_HASH,
    } as const;
    return [seed.id, Object.freeze({ ...base, bodyHash: stableHash(stableStringify(base)) })];
  }),
) as unknown as Record<WebRecipeId, WebRecipeDefinition>;

export const WEB_RECIPE_DEFINITIONS = Object.freeze([
  RECIPES_BY_ID["business-site"],
  RECIPES_BY_ID["campaign-landing"],
  RECIPES_BY_ID["storefront-catalogue"],
]) as readonly WebRecipeDefinition[];

export function getWebRecipeDefinition(idValue: string): WebRecipeDefinition | undefined {
  return RECIPES_BY_ID[idValue as WebRecipeId];
}

export function validateWebRecipeDefinition(input: unknown): input is WebRecipeDefinition {
  if (
    !isRecord(input) ||
    !hasOnly(input, [
      "id",
      "registryName",
      "family",
      "outputKind",
      "schemaVersion",
      "compilerId",
      "bundleHash",
      "fields",
      "template",
      "bodyHash",
    ])
  )
    return false;
  if (typeof input.id !== "string") return false;
  const expected = getWebRecipeDefinition(input.id);
  if (
    !expected ||
    input.registryName !== expected.registryName ||
    input.family !== expected.family ||
    input.outputKind !== expected.outputKind ||
    input.schemaVersion !== WEB_RECIPE_SCHEMA_VERSION ||
    input.compilerId !== WEB_RECIPE_COMPILER_ID ||
    input.bundleHash !== WEB_RECIPE_BUNDLE_HASH ||
    input.bodyHash !== expected.bodyHash
  )
    return false;
  return stableStringify(input) === stableStringify(expected);
}

export const parseWebRecipeDefinition = (input: unknown): WebRecipeDefinition => {
  if (!validateWebRecipeDefinition(input)) throw new Error("WEB_RECIPE_DEFINITION_INVALID");
  return input;
};
export const WEB_RECIPES = WEB_RECIPE_DEFINITIONS;

function documentForBusiness(input: BusinessSiteInput): WebDocument {
  const nodes: WebDocument["pages"][number]["nodes"] = [
    { kind: "hero", heading: input.headline, ...(input.summary ? { body: input.summary } : {}) },
    ...(input.services?.length
      ? [
          {
            kind: "section" as const,
            id: "services",
            heading: "Services",
            children: input.services.map((service) => ({ kind: "text" as const, text: service })),
          },
        ]
      : []),
    ...(input.about
      ? [
          {
            kind: "section" as const,
            id: "about",
            heading: "About",
            children: [{ kind: "text" as const, text: input.about }],
          },
        ]
      : []),
    ...(input.contactConsent
      ? [
          {
            kind: "form" as const,
            id: "contact",
            heading: "Contact",
            fields: ["email" as const],
            consent: input.contactConsent,
          },
        ]
      : []),
  ];
  return {
    kind: "site",
    title: input.brandName,
    brand: { name: input.brandName },
    navigation: [],
    pages: [{ slug: "home", title: input.headline, nodes }],
  };
}

function documentForCampaign(input: CampaignLandingInput): WebDocument {
  const nodes: WebDocument["pages"][number]["nodes"] = [
    { kind: "hero", heading: input.headline, ...(input.offer ? { body: input.offer } : {}) },
    ...(input.proofPoints?.length
      ? [
          {
            kind: "section" as const,
            id: "proof",
            heading: "What we can support",
            children: input.proofPoints.map((proof) => ({ kind: "text" as const, text: proof })),
          },
        ]
      : []),
    ...(input.ctaLabel && input.ctaPath
      ? [
          {
            kind: "cta" as const,
            id: "primary",
            label: input.ctaLabel,
            target: { kind: "local" as const, path: input.ctaPath },
            analytics: true,
          },
        ]
      : []),
    ...(input.formConsent
      ? [
          {
            kind: "form" as const,
            id: "signup",
            fields: ["email" as const],
            consent: input.formConsent,
            ...(input.attributionSource
              ? { attribution: { source: input.attributionSource } }
              : {}),
          },
        ]
      : []),
  ];
  return {
    kind: "landing",
    title: input.brandName,
    brand: { name: input.brandName },
    navigation: [],
    pages: [{ slug: "campaign", title: input.headline, nodes }],
  };
}

function documentForStorefront(input: StorefrontCatalogueInput): WebDocument {
  return {
    kind: "storefront",
    title: input.brandName,
    ...(input.intro ? { description: input.intro } : {}),
    brand: { name: input.brandName },
    navigation: [],
    pages: [
      {
        slug: "catalogue",
        title: input.brandName,
        nodes: [
          ...(input.intro
            ? [{ kind: "hero" as const, heading: input.brandName, body: input.intro }]
            : [{ kind: "hero" as const, heading: input.brandName }]),
          { kind: "catalogue" as const, heading: "Catalogue", items: input.items },
        ],
      },
    ],
  };
}

export function materializeWebRecipe(idValue: WebRecipeId, input: unknown): WebDocument {
  const checked = validateWebRecipeInput(idValue, input);
  if (!checked.ok)
    throw new Error(
      `WEB_RECIPE_INPUT_INVALID:${checked.errors.map((entry) => entry.code).join(",")}`,
    );
  const document =
    idValue === "business-site"
      ? documentForBusiness(checked.value as BusinessSiteInput)
      : idValue === "campaign-landing"
        ? documentForCampaign(checked.value as CampaignLandingInput)
        : documentForStorefront(checked.value as StorefrontCatalogueInput);
  const result = validateWebDocument(document);
  if (!result.ok)
    throw new Error(
      `WEB_RECIPE_DOCUMENT_INVALID:${result.errors.map((entry) => entry.code).join(",")}`,
    );
  return result.value;
}

export function materializeWebRecipeWithProvenance(
  idValue: WebRecipeId,
  input: unknown,
): WebRecipeMaterialization {
  const checked = validateWebRecipeInput(idValue, input);
  if (!checked.ok)
    throw new Error(
      `WEB_RECIPE_INPUT_INVALID:${checked.errors.map((entry) => entry.code).join(",")}`,
    );
  const document = materializeWebRecipe(idValue, checked.value);
  const design = isRecord(checked.value.design) ? checked.value.design : {};
  const selection = selectDesignProfile({
    pageGoal:
      idValue === "business-site"
        ? "business"
        : idValue === "campaign-landing"
          ? "campaign"
          : "catalogue",
    dials: design as Partial<DesignDials>,
  });
  if (!validateDesignProfileRef(selection.profile)) throw new Error("WEB_RECIPE_PROFILE_INVALID");
  return {
    document,
    recipe: RECIPES_BY_ID[idValue],
    inputHash: stableHash(webRecipeInputHashMaterial(idValue, checked.value)),
    designProfile: selection.profile,
  };
}

export function webRecipeInputHashMaterial(idValue: WebRecipeId, input: unknown): string {
  const checked = validateWebRecipeInput(idValue, input);
  if (!checked.ok)
    throw new Error(
      `WEB_RECIPE_INPUT_INVALID:${checked.errors.map((entry) => entry.code).join(",")}`,
    );
  return stableStringify(checked.value);
}

export function hashWebRecipeDefinition(definition: WebRecipeDefinition): string {
  return stableHash(webRecipeDefinitionHashMaterial(definition));
}

export function hashWebRecipeInput(idValue: WebRecipeId, input: unknown): string {
  return stableHash(webRecipeInputHashMaterial(idValue, input));
}

export function canonicalWebRecipeDefinition(definition: WebRecipeDefinition): string {
  if (
    !RECIPES_BY_ID[definition.id] ||
    RECIPES_BY_ID[definition.id].bodyHash !== definition.bodyHash
  )
    throw new Error("WEB_RECIPE_DEFINITION_INVALID");
  return stableStringify({ ...definition, bodyHash: definition.bodyHash });
}

export function webRecipeDefinitionHashMaterial(definition: WebRecipeDefinition): string {
  if (
    !RECIPES_BY_ID[definition.id] ||
    RECIPES_BY_ID[definition.id].bodyHash !== definition.bodyHash
  )
    throw new Error("WEB_RECIPE_DEFINITION_INVALID");
  const { bodyHash: _bodyHash, ...body } = definition;
  return stableStringify(body);
}

export function webRecipeDocumentHash(idValue: WebRecipeId, input: unknown): string {
  return stableHash(canonicalWebDocument(materializeWebRecipe(idValue, input)));
}
