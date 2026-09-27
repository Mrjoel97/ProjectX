import type { WebRecipeId, WebRecipeInput } from "./webRecipes";
import { sha256Bytes } from "./webRuntime";

export type WebRecipeCorpusKind =
  | "positive"
  | "partial"
  | "required"
  | "unknown"
  | "non-canonical"
  | "max"
  | "one-over"
  | "injection"
  | "cross-family"
  | "changed-version"
  | "changed-body"
  | "changed-bundle"
  | "repeat"
  | "design-dial"
  | "source-coverage"
  | "source-influence"
  | "source-removal"
  | "consent"
  | "attribution"
  | "no-commerce";

export type WebRecipeCorpusCase = {
  readonly id: `${WebRecipeId}.${WebRecipeCorpusKind}`;
  readonly family: WebRecipeId;
  readonly kind: WebRecipeCorpusKind;
  readonly expected: "pass" | "reject" | "identity";
  readonly input?: unknown;
  readonly inputs?: readonly unknown[];
};

const businessBase = {
  brandName: "Acme Studio",
  headline: "A clear business site",
  summary: "A bounded summary.",
  services: ["Strategy", "Delivery"],
  about: "Publisher-authored business information.",
  contactConsent: "I agree to hear from this publisher.",
} satisfies WebRecipeInput;

const campaignBase = {
  brandName: "Acme Studio",
  headline: "A bounded campaign",
  offer: "A clear publisher-authored offer.",
  proofPoints: ["Published proof point"],
  ctaLabel: "Learn more",
  ctaPath: "/learn",
  formConsent: "I agree to hear from this publisher.",
  attributionSource: "publisher-newsletter",
} satisfies WebRecipeInput;

const catalogueItems = [
  {
    id: "item-1",
    name: "Item One",
    description: "Publisher-authored description.",
    displayPriceText: "From 10",
    availabilityLabel: "Contact publisher",
  },
] as const;

const storefrontBase = {
  brandName: "Acme Catalogue",
  intro: "A presentation-only catalogue.",
  items: catalogueItems,
} satisfies WebRecipeInput;

const baseFor = (family: WebRecipeId): WebRecipeInput =>
  family === "business-site"
    ? businessBase
    : family === "campaign-landing"
      ? campaignBase
      : storefrontBase;

const requiredFor = (family: WebRecipeId): readonly unknown[] =>
  (family === "storefront-catalogue" ? ["brandName", "items"] : ["brandName", "headline"]).map(
    (missing) =>
      Object.fromEntries(Object.entries(baseFor(family)).filter(([key]) => key !== missing)),
  );

const partialFor = (family: WebRecipeId): unknown =>
  family === "business-site"
    ? { brandName: "Acme Studio", headline: "A clear business site" }
    : family === "campaign-landing"
      ? { brandName: "Acme Studio", headline: "A bounded campaign" }
      : { brandName: "Acme Catalogue", items: catalogueItems };

const injectionFor = (family: WebRecipeId): readonly unknown[] => {
  const payloads = [
    "<script>alert(1)</script>",
    "<img src=x>",
    'onclick="alert(1)"',
    "javascript:alert(1)",
    "data:text/html,alert(1)",
  ];
  return payloads.map((payload) => {
    if (family === "business-site") return { ...businessBase, headline: payload };
    if (family === "campaign-landing") return { ...campaignBase, offer: payload };
    return { ...storefrontBase, items: [{ ...catalogueItems[0], description: payload }] };
  });
};

const maxFor = (family: WebRecipeId): unknown => {
  if (family === "business-site")
    return {
      ...businessBase,
      brandName: "B".repeat(128),
      headline: "H".repeat(256),
      summary: "S".repeat(4000),
      services: Array.from({ length: 8 }, (_, index) => `Service ${index}`),
      about: "A".repeat(4000),
      contactConsent: "C".repeat(512),
    };
  if (family === "campaign-landing")
    return {
      ...campaignBase,
      brandName: "B".repeat(128),
      headline: "H".repeat(256),
      offer: "O".repeat(4000),
      proofPoints: Array.from({ length: 6 }, (_, index) => `Proof ${index}`),
      ctaLabel: "L".repeat(128),
      formConsent: "C".repeat(512),
      attributionSource: "A".repeat(128),
    };
  return {
    ...storefrontBase,
    brandName: "B".repeat(128),
    intro: "I".repeat(4000),
    items: Array.from({ length: 20 }, (_, index) => ({
      id: `item-${index}`,
      name: `Item ${index}`,
      description: "Description",
      displayPriceText: "From 10",
      availabilityLabel: "Contact publisher",
    })),
  };
};

const oneOverFor = (family: WebRecipeId): unknown => {
  if (family === "business-site") return { ...businessBase, brandName: "B".repeat(129) };
  if (family === "campaign-landing") return { ...campaignBase, headline: "H".repeat(257) };
  return {
    ...storefrontBase,
    items: Array.from({ length: 21 }, (_, index) => ({
      id: `item-${index}`,
      name: `Item ${index}`,
      description: "Description",
    })),
  };
};

const boundaryInputsFor = (family: WebRecipeId, over: boolean): readonly unknown[] => {
  const base = baseFor(family);
  const length = (limit: number) => "Z".repeat(limit + Number(over));
  const dial = over ? 11 : 10;
  const variants: unknown[] = [
    { ...base, brandName: length(128) },
    ...(["variance", "motion", "density"] as const).map((key) => ({
      ...base,
      design: { [key]: dial },
    })),
  ];
  if (family === "business-site") {
    variants.push(
      { ...base, headline: length(256) },
      { ...base, summary: length(4000) },
      { ...base, about: length(4000) },
      { ...base, contactConsent: length(512) },
      { ...base, services: Array.from({ length: 8 + Number(over) }, (_, i) => `Service ${i}`) },
      { ...base, services: [length(512)] },
    );
  } else if (family === "campaign-landing") {
    variants.push(
      { ...base, headline: length(256) },
      { ...base, offer: length(4000) },
      { ...base, ctaLabel: length(128) },
      { ...base, formConsent: length(512) },
      { ...base, attributionSource: length(128) },
      { ...base, proofPoints: Array.from({ length: 6 + Number(over) }, (_, i) => `Proof ${i}`) },
      { ...base, proofPoints: [length(512)] },
      { ...base, ctaPath: `/${"a".repeat(255 + Number(over))}` },
    );
  } else {
    const item = catalogueItems[0];
    variants.push(
      { ...base, intro: length(4000) },
      { ...base, items: [{ ...item, id: `i${"d".repeat(63 + Number(over))}` }] },
      { ...base, items: [{ ...item, name: length(256) }] },
      { ...base, items: [{ ...item, description: length(4000) }] },
      { ...base, items: [{ ...item, displayPriceText: length(128) }] },
      { ...base, items: [{ ...item, availabilityLabel: length(128) }] },
      {
        ...base,
        items: [{ ...item, imageStorageRef: `storage:${"s".repeat(240 + Number(over))}` }],
      },
      {
        ...base,
        items: Array.from({ length: 20 + Number(over) }, (_, i) => ({ ...item, id: `item-${i}` })),
      },
    );
  }
  return variants;
};

const commerceAttempts = [
  "inventory",
  "quantity",
  "cart",
  "buy",
  "checkout",
  "payment",
  "merchantUrl",
  "tax",
  "shipping",
  "refund",
  "order",
  "fulfilment",
] as const;

const noCommerceFor = (family: WebRecipeId): readonly unknown[] =>
  commerceAttempts.map((field) => ({
    ...baseFor(family),
    [field]: field === "merchantUrl" ? "https://merchant.example.test" : "attempt",
  }));

const caseFor = (
  family: WebRecipeId,
  kind: WebRecipeCorpusKind,
  expected: WebRecipeCorpusCase["expected"],
  input?: unknown,
  inputs?: readonly unknown[],
): WebRecipeCorpusCase => ({
  id: `${family}.${kind}` as WebRecipeCorpusCase["id"],
  family,
  kind,
  expected,
  ...(input === undefined ? {} : { input }),
  ...(inputs === undefined ? {} : { inputs }),
});

const casesFor = (family: WebRecipeId): readonly WebRecipeCorpusCase[] => {
  const base = baseFor(family);
  return [
    caseFor(family, "positive", "pass", base),
    caseFor(family, "partial", "pass", partialFor(family)),
    caseFor(family, "required", "reject", undefined, requiredFor(family)),
    caseFor(family, "unknown", "reject", { ...base, unexpected: true }),
    caseFor(family, "non-canonical", "reject", { ...base, metadata: { source: "untrusted" } }),
    caseFor(family, "max", "pass", undefined, [
      maxFor(family),
      ...boundaryInputsFor(family, false),
    ]),
    caseFor(family, "one-over", "reject", undefined, [
      oneOverFor(family),
      ...boundaryInputsFor(family, true),
    ]),
    caseFor(family, "injection", "reject", undefined, injectionFor(family)),
    caseFor(family, "cross-family", "reject", base),
    caseFor(family, "changed-version", "identity"),
    caseFor(family, "changed-body", "identity"),
    caseFor(family, "changed-bundle", "identity"),
    caseFor(family, "repeat", "pass", base),
    caseFor(family, "design-dial", "pass", {
      ...base,
      design: { variance: 7, motion: 6, density: 8 },
    }),
    caseFor(family, "source-coverage", "pass", base),
    caseFor(family, "source-influence", "pass", base),
    caseFor(family, "source-removal", "identity", base),
    caseFor(family, "consent", "pass", base),
    caseFor(family, "attribution", "pass", base),
    caseFor(family, "no-commerce", "reject", undefined, noCommerceFor(family)),
  ];
};

/** The complete private corpus. Inputs are consumed by the offline evaluator and never written to evidence. */
export const WEB_RECIPE_FIXTURE_CORPUS = Object.freeze([
  ...casesFor("business-site"),
  ...casesFor("campaign-landing"),
  ...casesFor("storefront-catalogue"),
] as readonly WebRecipeCorpusCase[]);

export const WEB_RECIPE_FIXTURE_CASE_IDS = Object.freeze(
  WEB_RECIPE_FIXTURE_CORPUS.map((fixture) => fixture.id),
);

export const WEB_RECIPE_FIXTURE_CASES_PER_FAMILY = 20 as const;

/** Entire ordered corpus, including inputs and expectations; JSON serialization is the canonical LF form. */
export function webRecipeFixtureContentHash(
  corpus: readonly WebRecipeCorpusCase[] = WEB_RECIPE_FIXTURE_CORPUS,
): string {
  return sha256Bytes(new TextEncoder().encode(JSON.stringify(corpus)));
}

export function webRecipeFixturesFor(family: WebRecipeId): readonly WebRecipeCorpusCase[] {
  return WEB_RECIPE_FIXTURE_CORPUS.filter((fixture) => fixture.family === family);
}
