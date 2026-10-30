import type { ProjectKind, WebDocument, WebMediaNode } from "@pikar/contracts/webRuntime";
import {
  type ArtDirection,
  type DesignDials,
  type DesignProfileRef,
  type SurfaceStyle,
  selectDesignProfile,
  validateDesignProfileRef,
} from "./designKnowledge";
import { parseWebAssetRef } from "./webAssets";
import {
  canonicalWebDocument,
  sha256Bytes,
  validateWebDocument,
  validateWebMediaInput,
} from "./webRuntime";

export const WEB_RECIPE_SCHEMA_VERSION = 1 as const;
export const WEB_RECIPE_COMPILER_ID = "web-recipes-v8" as const;
export type WebRecipeMedia = {
  readonly logo?: { readonly storageRef: string; readonly alt: string };
  readonly hero?: Omit<WebMediaNode, "kind" | "placement">;
  readonly gallery?: readonly Omit<WebMediaNode, "kind" | "placement">[];
};

export function validateWebRecipeMedia(value: unknown): value is WebRecipeMedia {
  if (!isRecord(value) || !hasOnly(value, ["logo", "hero", "gallery"])) return false;
  if (
    value.logo !== undefined &&
    (!isRecord(value.logo) ||
      !hasOnly(value.logo, ["storageRef", "alt"]) ||
      !parseWebAssetRef(value.logo.storageRef) ||
      !text(value.logo.alt, 256))
  )
    return false;
  const image = (entry: unknown) =>
    isRecord(entry) &&
    hasOnly(entry, ["storageRef", "alt", "crop", "aspect", "focalPoint"]) &&
    validateWebMediaInput(entry);
  if (value.hero !== undefined && !image(value.hero)) return false;
  return (
    value.gallery === undefined ||
    (Array.isArray(value.gallery) && value.gallery.length <= 6 && value.gallery.every(image))
  );
}
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
  readonly type: "text" | "text-list" | "email" | "catalogue-list" | "dials" | "media";
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
  readonly surfaceStyle?: SurfaceStyle;
  readonly media?: WebRecipeMedia;
  readonly artDirection?: ArtDirection;
  readonly primaryColor?: string;
  readonly brandName: string;
  readonly headline: string;
  readonly summary?: string;
  readonly services?: readonly string[];
  readonly about?: string;
  readonly ctaLabel?: string;
  readonly ctaHref?: string;
  readonly pageMode?: "multi-page";
  readonly projectSlug?: string;
  readonly contactConsent?: string;
  readonly design?: Partial<DesignDials>;
};
export type CampaignLandingInput = {
  readonly surfaceStyle?: SurfaceStyle;
  readonly media?: WebRecipeMedia;
  readonly artDirection?: ArtDirection;
  readonly primaryColor?: string;
  readonly brandName: string;
  readonly headline: string;
  readonly offer?: string;
  readonly proofPoints?: readonly string[];
  readonly ctaLabel?: string;
  readonly ctaPath?: string;
  readonly ctaHref?: string;
  readonly formConsent?: string;
  readonly attributionSource?: string;
  readonly design?: Partial<DesignDials>;
};
export type StorefrontCatalogueInput = {
  readonly surfaceStyle?: SurfaceStyle;
  readonly media?: WebRecipeMedia;
  readonly artDirection?: ArtDirection;
  readonly primaryColor?: string;
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
  !/<\/?[a-z][^>]*>|(?:javascript:|data:(?:text|application)\/)|\bon[a-z]+\s*=/i.test(value);
const catalogueText = (value: unknown, max = 4_000): value is string =>
  text(value, max) &&
  !/\b(?:buy|cart|checkout|payment|merchant|inventory|stock|tax|shipping|refund|fulfil(?:ment|lment))\b/i.test(
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
const httpsHref = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("https://") ||
    /[\s\\<>"']/.test(value) ||
    hasControlCharacter(value)
  )
    return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};
const inputKeys: Record<WebRecipeId, readonly string[]> = {
  "business-site": [
    "surfaceStyle",
    "brandName",
    "media",
    "artDirection",
    "primaryColor",
    "headline",
    "summary",
    "services",
    "about",
    "ctaLabel",
    "ctaHref",
    "pageMode",
    "projectSlug",
    "contactConsent",
    "design",
  ],
  "campaign-landing": [
    "surfaceStyle",
    "media",
    "artDirection",
    "primaryColor",
    "brandName",
    "headline",
    "offer",
    "proofPoints",
    "ctaLabel",
    "ctaPath",
    "ctaHref",
    "formConsent",
    "attributionSource",
    "design",
  ],
  "storefront-catalogue": [
    "surfaceStyle",
    "brandName",
    "intro",
    "items",
    "design",
    "artDirection",
    "primaryColor",
    "media",
  ],
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
    if (!catalogueText(item.name, 256)) issue(errors, `items[${index}].name`, "invalid_text");
    if (!catalogueText(item.description))
      issue(errors, `items[${index}].description`, "invalid_text");
    if (
      item.imageStorageRef !== undefined &&
      !parseWebAssetRef(item.imageStorageRef) &&
      !/^storage:[a-zA-Z0-9:_-]{1,240}$/.test(String(item.imageStorageRef))
    )
      issue(errors, `items[${index}].imageStorageRef`, "invalid_storage_ref");
    for (const key of ["displayPriceText", "availabilityLabel"] as const)
      if (item[key] !== undefined && !catalogueText(item[key], 128))
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
  if (input.media !== undefined && !validateWebRecipeMedia(input.media))
    issue(errors, "media", "invalid_media");
  if (
    input.surfaceStyle !== undefined &&
    input.surfaceStyle !== "minimal" &&
    input.surfaceStyle !== "glass" &&
    input.surfaceStyle !== "clay"
  )
    issue(errors, "surfaceStyle", "invalid_surface_style");
  if (
    input.artDirection !== undefined &&
    input.artDirection !== "editorial" &&
    input.artDirection !== "studio" &&
    input.artDirection !== "technical"
  )
    issue(errors, "artDirection", "invalid_art_direction");
  if (
    input.primaryColor !== undefined &&
    (typeof input.primaryColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(input.primaryColor))
  )
    issue(errors, "primaryColor", "invalid_brand_color");
  if (idValue !== "storefront-catalogue") {
    if (!optionalText(input.ctaLabel, 128)) issue(errors, "ctaLabel", "invalid_text");
    if (input.ctaHref !== undefined && !httpsHref(input.ctaHref))
      issue(errors, "ctaHref", "invalid_https_url");
    const hasTarget = input.ctaHref !== undefined || input.ctaPath !== undefined;
    if ((input.ctaLabel !== undefined) !== hasTarget)
      issue(errors, "ctaLabel", "cta_pair_required");
    if (input.ctaHref !== undefined && input.ctaPath !== undefined)
      issue(errors, "ctaHref", "ambiguous_cta_target");
  }
  if (idValue === "business-site") {
    if (input.pageMode !== undefined && input.pageMode !== "multi-page")
      issue(errors, "pageMode", "invalid_page_mode");
    if (
      input.pageMode === "multi-page" &&
      (typeof input.projectSlug !== "string" ||
        input.projectSlug.length > 64 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.projectSlug))
    )
      issue(errors, "projectSlug", "required_project_slug");
    if (input.projectSlug !== undefined && input.pageMode !== "multi-page")
      issue(errors, "projectSlug", "page_mode_required");
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
    if (input.ctaPath !== undefined && !localPath(input.ctaPath))
      issue(errors, "ctaPath", "invalid_path");
    if (!optionalText(input.formConsent, 512)) issue(errors, "formConsent", "invalid_consent");
    if (!optionalText(input.attributionSource, 128))
      issue(errors, "attributionSource", "invalid_attribution");
  } else {
    if (!catalogueText(input.brandName, 128)) issue(errors, "brandName", "invalid_text");
    if (input.intro !== undefined && !catalogueText(input.intro))
      issue(errors, "intro", "invalid_text");
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
      {
        id: "media",
        label: "Prepared business images",
        type: "media",
        required: false,
        maxLength: 8,
      },
      { id: "artDirection", label: "Art direction", type: "text", required: false, maxLength: 16 },
      { id: "surfaceStyle", label: "Surface style", type: "text", required: false, maxLength: 16 },
      { id: "primaryColor", label: "Brand accent", type: "text", required: false, maxLength: 7 },
      { id: "brandName", label: "Brand name", type: "text", required: true, maxLength: 128 },
      { id: "headline", label: "Headline", type: "text", required: true, maxLength: 256 },
      { id: "summary", label: "Summary", type: "text", required: false, maxLength: 4000 },
      { id: "services", label: "Services", type: "text-list", required: false, maxLength: 512 },
      { id: "about", label: "About", type: "text", required: false, maxLength: 4000 },
      {
        id: "pageMode",
        label: "Multiple business pages",
        type: "text",
        required: false,
        maxLength: 16,
      },
      { id: "projectSlug", label: "Project route", type: "text", required: false, maxLength: 64 },
      {
        id: "ctaLabel",
        label: "Call to action label",
        type: "text",
        required: false,
        maxLength: 128,
      },
      {
        id: "ctaHref",
        label: "HTTPS call to action destination",
        type: "text",
        required: false,
        maxLength: 2048,
      },
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
      nodes: ["hero", "text", "section", "cta", "form"],
      excludes: ["html", "css", "js", "provider-claims", "domain-claims", "merchant-claims"],
    },
  },
  {
    id: "campaign-landing",
    registryName: "web-recipe-campaign-landing",
    family: "campaign",
    outputKind: "landing",
    fields: [
      {
        id: "media",
        label: "Prepared business images",
        type: "media",
        required: false,
        maxLength: 8,
      },
      { id: "artDirection", label: "Art direction", type: "text", required: false, maxLength: 16 },
      { id: "surfaceStyle", label: "Surface style", type: "text", required: false, maxLength: 16 },
      { id: "primaryColor", label: "Brand accent", type: "text", required: false, maxLength: 7 },
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
      {
        id: "ctaHref",
        label: "HTTPS call to action destination",
        type: "text",
        required: false,
        maxLength: 2048,
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
      {
        id: "media",
        label: "Prepared business images",
        type: "media",
        required: false,
        maxLength: 8,
      },
      { id: "artDirection", label: "Art direction", type: "text", required: false, maxLength: 16 },
      { id: "surfaceStyle", label: "Surface style", type: "text", required: false, maxLength: 16 },
      { id: "primaryColor", label: "Brand accent", type: "text", required: false, maxLength: 7 },
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
    ...(input.ctaLabel && input.ctaHref
      ? [
          {
            kind: "cta" as const,
            id: "primary",
            label: input.ctaLabel,
            target: { kind: "https" as const, url: input.ctaHref },
            analytics: true,
          },
        ]
      : []),
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
  if (input.pageMode === "multi-page") {
    const pages = [
      {
        slug: "home",
        title: input.headline,
        nodes: nodes.filter((node) => node.kind !== "form"),
      },
      ...(input.about
        ? [
            {
              slug: "about",
              title: `About ${input.brandName}`,
              nodes: [
                { kind: "hero" as const, heading: "About" },
                { kind: "text" as const, text: input.about },
              ],
            },
          ]
        : []),
      ...(input.services?.length
        ? [
            {
              slug: "services",
              title: "Services",
              nodes: [
                { kind: "hero" as const, heading: "Services" },
                ...nodes.filter((node) => node.kind === "section" && node.id === "services"),
              ],
            },
          ]
        : []),
      ...(input.contactConsent || input.ctaHref
        ? [
            {
              slug: "contact",
              title: `Contact ${input.brandName}`,
              nodes: [
                { kind: "hero" as const, heading: "Contact" },
                ...nodes.filter((node) => node.kind === "form" || node.kind === "cta"),
              ],
            },
          ]
        : []),
    ];
    return {
      kind: "site",
      title: input.brandName,
      brand: {
        name: input.brandName,
        ...(input.primaryColor ? { primaryColor: input.primaryColor } : {}),
      },
      navigation: pages.map((page) => ({
        label:
          page.slug === "home"
            ? "Home"
            : page.slug === "about"
              ? "About"
              : page.slug === "contact"
                ? "Contact"
                : page.title,
        path: `/p/${input.projectSlug}/${page.slug}`,
      })),
      pages,
    };
  }
  return {
    kind: "site",
    title: input.brandName,
    brand: {
      name: input.brandName,
      ...(input.primaryColor ? { primaryColor: input.primaryColor } : {}),
    },
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
    ...(input.ctaLabel && (input.ctaPath || input.ctaHref)
      ? [
          {
            kind: "cta" as const,
            id: "primary",
            label: input.ctaLabel,
            target: input.ctaHref
              ? { kind: "https" as const, url: input.ctaHref }
              : { kind: "local" as const, path: input.ctaPath as string },
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
    brand: {
      name: input.brandName,
      ...(input.primaryColor ? { primaryColor: input.primaryColor } : {}),
    },
    navigation: [],
    pages: [{ slug: "campaign", title: input.headline, nodes }],
  };
}

function documentForStorefront(input: StorefrontCatalogueInput): WebDocument {
  return {
    kind: "storefront",
    title: input.brandName,
    ...(input.intro ? { description: input.intro } : {}),
    brand: {
      name: input.brandName,
      ...(input.primaryColor ? { primaryColor: input.primaryColor } : {}),
    },
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
  const sourceDocument =
    idValue === "business-site"
      ? documentForBusiness(checked.value as BusinessSiteInput)
      : idValue === "campaign-landing"
        ? documentForCampaign(checked.value as CampaignLandingInput)
        : documentForStorefront(checked.value as StorefrontCatalogueInput);
  const media = checked.value.media;
  const document: WebDocument = media
    ? {
        ...sourceDocument,
        brand: { ...sourceDocument.brand, ...(media.logo ? { logo: media.logo } : {}) },
        pages: sourceDocument.pages.map((page, index) =>
          index === 0
            ? {
                ...page,
                nodes: [
                  ...page.nodes,
                  ...(media.hero
                    ? [{ ...media.hero, kind: "media" as const, placement: "hero" as const }]
                    : []),
                  ...(media.gallery?.length
                    ? [
                        {
                          kind: "section" as const,
                          id: "gallery",
                          heading: "Gallery",
                          children: media.gallery.map((image) => ({
                            ...image,
                            kind: "media" as const,
                            placement: "gallery" as const,
                          })),
                        },
                      ]
                    : []),
                ],
              }
            : page,
        ),
      }
    : sourceDocument;
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
    ...(checked.value.artDirection ? { artDirection: checked.value.artDirection } : {}),
    ...(checked.value.surfaceStyle ? { surfaceStyle: checked.value.surfaceStyle } : {}),
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
