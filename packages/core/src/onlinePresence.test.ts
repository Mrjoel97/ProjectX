import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  assessOnlinePresenceBrief,
  mergeOnlinePresenceBrief,
  ONLINE_PRESENCE_TOOLS,
  type OnlinePresenceSource,
  onlinePresenceServiceState,
} from "./onlinePresence";
import { materializeWebRecipe, validateWebRecipeInput } from "./webRecipes";
import { validateWebDocument } from "./webRuntime";

const source: OnlinePresenceSource = {
  ref: "foundation:business:3",
  kind: "foundation",
  revision: "3",
  text: "Acme designs gardens for homeowners.",
  intent: "current",
  status: "approved",
  visibility: "unspecified",
};
const brief = {
  kind: "website",
  businessName: "Acme",
  headline: "Gardens designed around you",
  summary: "Garden design for homeowners.",
  audience: "Homeowners",
  sourceRefs: [source.ref],
};
const assess = (overrides: Record<string, unknown> = {}, sources = [source]) =>
  assessOnlinePresenceBrief({ ...brief, ...overrides }, sources);

describe("online presence revision contract", () => {
  const previous = {
    ...brief,
    services: ["Layout", "Print", "Unsupported third service"],
    about: "Acme helps homeowners plan gardens.",
    contactConsent: "I agree to be contacted.",
    media: { hero: { storageRef: `webasset:asset:${"a".repeat(64)}`, alt: "Garden illustration" } },
    design: { artDirection: "studio", primaryColor: "#246B58" },
  };

  test("service-only and headline-only revisions retain omitted optional fields and four-page inputs", () => {
    const services = mergeOnlinePresenceBrief(previous, {
      ...brief,
      services: ["Layout", "Print"],
    });
    expect(services.ok).toBe(true);
    if (!services.ok) throw new Error("Expected revision");
    expect(services.brief).toMatchObject({
      about: previous.about,
      media: previous.media,
      contactConsent: previous.contactConsent,
      services: ["Layout", "Print"],
    });
    expect(services.inheritedMedia).toBe(true);
    const headline = mergeOnlinePresenceBrief(services.brief, {
      ...brief,
      headline: "A better garden",
    });
    if (!headline.ok) throw new Error("Expected headline revision");
    const checked = assessOnlinePresenceBrief(headline.brief, [source]);
    if (!checked.ok) throw new Error("Expected complete preserved brief");
    const document = materializeWebRecipe(checked.recipeId, {
      ...checked.input,
      pageMode: "multi-page",
      projectSlug: "acme",
    });
    expect(document.pages.map((page) => page.slug)).toEqual([
      "home",
      "about",
      "services",
      "contact",
    ]);
    expect(document.pages[0]?.nodes).toContainEqual(
      expect.objectContaining({ kind: "media", ...previous.media.hero }),
    );
    expect(previous.services).toHaveLength(3);
  });

  test("nested objects replace as a whole; only explicit clear removes an omitted optional field", () => {
    const result = mergeOnlinePresenceBrief(
      previous,
      { ...brief, design: { artDirection: "technical" } },
      ["about", "media"],
    );
    if (!result.ok) throw new Error("Expected explicit removal");
    expect(result.brief).not.toHaveProperty("about");
    expect(result.brief).not.toHaveProperty("media");
    expect(result.brief.design).toEqual({ artDirection: "technical" });
    expect(result.inheritedMedia).toBe(false);
    expect(mergeOnlinePresenceBrief(previous, {}).ok).toBe(true);
    const missingRequired = mergeOnlinePresenceBrief(previous, {});
    if (missingRequired.ok)
      expect(assessOnlinePresenceBrief(missingRequired.brief, [source]).ok).toBe(false);
  });

  test.each(
    [["headline"], ["unknown"], ["media", "media"], ["ctaHref"], ["ctaLabel"], null, "media"].map(
      (clearFields) => ({ clearFields }),
    ),
  )("rejects unsupported, duplicate or partial CTA clears: %j", ({ clearFields }) => {
    expect(mergeOnlinePresenceBrief(previous, brief, clearFields).ok).toBe(false);
  });
  test("rejects set-and-clear conflicts and preserves an invalid CTA until explicitly cleared", () => {
    expect(mergeOnlinePresenceBrief(previous, { ...brief, about: "Changed" }, ["about"]).ok).toBe(
      false,
    );
    const invalid = { ...previous, ctaLabel: "Inquire", ctaHref: "mailto:inquiry@example.com" };
    const kept = mergeOnlinePresenceBrief(invalid, brief);
    if (!kept.ok) throw new Error("Expected preserved invalid draft");
    expect(assessOnlinePresenceBrief(kept.brief, [source]).ok).toBe(false);
    const cleared = mergeOnlinePresenceBrief(invalid, brief, ["ctaLabel", "ctaHref"]);
    if (!cleared.ok) throw new Error("Expected explicit pair clear");
    expect(assessOnlinePresenceBrief(cleared.brief, [source]).ok).toBe(true);
  });
});

describe("attended online presence brief", () => {
  test("passes closed business-fitting art direction and a bounded color to both recipe families", () => {
    for (const kind of ["landing", "website"] as const) {
      const result = assess({ kind, design: { artDirection: "studio", primaryColor: "#246B58" } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected designed brief");
      expect(result.input).toMatchObject({ artDirection: "studio", primaryColor: "#246B58" });
      expect(result.brief.design).toEqual({ artDirection: "studio", primaryColor: "#246B58" });
      expect(result.input).not.toHaveProperty("design");
    }
    const automaticPalette = assess({ design: { artDirection: "editorial" } });
    expect(automaticPalette.ok).toBe(true);
    if (automaticPalette.ok) expect(automaticPalette.input).not.toHaveProperty("primaryColor");
  });

  test.each([
    null,
    [],
    "studio",
    { artDirection: "luxury" },
    { surfaceStyle: "arbitrary-style" },
    { surfaceStyle: "glass;background:url(https://example.com)" },
    { surfaceStyle: 42 },
    { css: "body{color:red}" },
    { primaryColor: "#abc" },
    { primaryColor: "#12345678" },
    { primaryColor: "rgb(1,2,3)" },
    { primaryColor: "#123456;background:url(https://example.com)" },
    { primaryColor: 123456 },
  ])("rejects unknown direction, arbitrary presentation code and unsupported color shapes: %j", (design) => {
    const result = assess({ design });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.missing).toContainEqual(expect.objectContaining({ reason: "invalid" }));
  });

  test("carries each requested visual style into both materialized recipe profiles", () => {
    for (const kind of ["website", "landing"] as const) {
      for (const surfaceStyle of ["minimal", "glass", "clay"] as const) {
        const result = assess({ kind, design: { surfaceStyle } });
        if (!result.ok) throw new Error("Expected supported visual style");
        expect(result.input).toMatchObject({ surfaceStyle });
        expect(result.brief.design).toEqual({ surfaceStyle });
      }
    }
  });

  test("materializes approved context into an existing business recipe without inventing consent", () => {
    const result = assess();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected complete brief");
    expect(result.recipeId).toBe("business-site");
    expect(validateWebRecipeInput(result.recipeId, result.input).ok).toBe(true);
    expect(result.input).not.toHaveProperty("contactConsent");
    expect(result.sources).toEqual([source]);
    expect(result.publicationRequiresExactVersionApproval).toBe(true);
  });

  test("a private draft preserves private, planned, stale and unverified publication warnings", () => {
    const result = assess({}, [
      { ...source, visibility: "private", intent: "planned", stale: true },
    ]);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "private_source",
      "planned_source",
      "stale_source",
      "claim_support_requires_review",
    ]);
    expect(assess().warnings).toContainEqual({
      code: "publication_permission_unset",
      sourceRef: source.ref,
    });
  });

  test("asks only for the missing field when the other business facts are present", () => {
    const result = assess({ audience: "" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected incomplete brief");
    expect(result.missing).toEqual([
      { field: "audience", reason: "missing", question: "Who should this online presence serve?" },
    ]);
  });

  test.each([
    ["unknown", [], "unknown_source"],
    ["draft", [{ ...source, status: "draft" as const }], "unapproved_source"],
    ["conflict", [source, { ...source, revision: "4" }], "conflicting_source"],
  ])("refuses %s references using adapter-owned sources", (_name, sources, reason) => {
    const result = assess({}, sources as OnlinePresenceSource[]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected refusal");
    expect(result.missing).toContainEqual(expect.objectContaining({ field: "sourceRefs", reason }));
  });

  test("does not permit duplicate sources, unknown fields, or a model-owned readiness flag", () => {
    const result = assess({ sourceRefs: [source.ref, source.ref], commerceReady: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected refusal");
    expect(result.missing).toContainEqual(
      expect.objectContaining({ field: "commerceReady", reason: "invalid" }),
    );
    expect(result.missing).toContainEqual(
      expect.objectContaining({ field: "sourceRefs", reason: "invalid" }),
    );
  });

  test("a shop draft asks for actual catalogue facts instead of inventing products or prices", () => {
    const result = assess({ kind: "shop" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected missing catalogue facts");
    expect(result.missing).toContainEqual(
      expect.objectContaining({ field: "catalogue", reason: "missing" }),
    );
    expect(onlinePresenceServiceState(result)).toBe("needs_information");
  });

  test("materializes a sourced private catalogue presentation without financial or checkout authority", () => {
    const catalogue = [
      {
        id: "garden-plan",
        name: "Garden plan",
        description: "An illustrated planning guide.",
        imageStorageRef: `webasset:ownedasset:${"b".repeat(64)}`,
      },
    ];
    const result = assess({
      kind: "shop",
      catalogue,
      design: { surfaceStyle: "glass", artDirection: "studio" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected private shop presentation");
    expect(result.recipeId).toBe("storefront-catalogue");
    expect(result.input).toMatchObject({
      brandName: brief.businessName,
      intro: brief.summary,
      items: catalogue,
      surfaceStyle: "glass",
    });
    expect(result.input).not.toHaveProperty("totalMinor");
    expect(result.input).not.toHaveProperty("merchantAccountRef");
    const document = materializeWebRecipe(result.recipeId, result.input);
    expect(document.kind).toBe("storefront");
    expect(document.pages[0]?.nodes).toContainEqual(
      expect.objectContaining({ kind: "catalogue", items: catalogue }),
    );
    expect(
      validateWebDocument({
        ...document,
        pages: [
          {
            ...document.pages[0],
            nodes: [
              ...(document.pages[0]?.nodes ?? []),
              {
                kind: "cta",
                label: "Buy now",
                target: { kind: "https", url: "https://example.com/checkout" },
              },
            ],
          },
        ],
      }).ok,
    ).toBe(false);
  });

  test.each(
    [
      [],
      null,
      [{ id: "item", name: "Missing description" }],
      Array.from({ length: 51 }, (_, index) => ({
        id: `item-${index}`,
        name: "Item",
        description: "Description",
      })),
      [{ id: "item", name: "Item", description: "Description", unitMinor: 100 }],
      [{ id: "item", name: "Item", description: "Description", goodsKind: "service" }],
    ].map((catalogue) => ({ catalogue })),
  )("refuses malformed, unbounded or financial catalogue payloads: %j", ({ catalogue }) => {
    const result = assess({ kind: "shop", catalogue });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.missing).toContainEqual(
        expect.objectContaining({ field: "catalogue", reason: "invalid" }),
      );
  });

  test.each([
    "storage:legacy-image",
    "https://example.com/image.png",
    "javascript:alert(1)",
    `webasset:owned:${"a".repeat(63)}`,
  ])("new shop briefs refuse product image references outside owned prepared assets: %s", (imageStorageRef) => {
    expect(
      assess({
        kind: "shop",
        catalogue: [{ id: "item", name: "Item", description: "Description", imageStorageRef }],
      }).ok,
    ).toBe(false);
  });

  test("omitted catalogue lists preserve content and report inheritance; explicit set/clear do not", () => {
    const catalogue = [{ id: "item", name: "Item", description: "Description" }];
    const previous = { ...brief, kind: "shop", catalogue };
    const inherited = mergeOnlinePresenceBrief(previous, { ...brief, kind: "shop" });
    expect(inherited).toMatchObject({ ok: true, inheritedCatalogue: true, brief: { catalogue } });
    const replaced = mergeOnlinePresenceBrief(previous, {
      ...brief,
      kind: "shop",
      catalogue: [{ ...catalogue[0], name: "New title" }],
    });
    expect(replaced).toMatchObject({ ok: true, inheritedCatalogue: false });
    const cleared = mergeOnlinePresenceBrief(previous, { ...brief, kind: "shop" }, ["catalogue"]);
    expect(cleared).toMatchObject({ ok: true, inheritedCatalogue: false });
    if (cleared.ok) expect(cleared.brief).not.toHaveProperty("catalogue");
  });

  test("maps a supported landing CTA and preserves explicit consent text", () => {
    const result = assess({
      kind: "landing",
      ctaLabel: "Learn more",
      ctaHref: "/about",
      contactConsent: "I agree to be contacted about this inquiry.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected complete brief");
    expect(result.recipeId).toBe("campaign-landing");
    expect(result.input).toMatchObject({
      offer: brief.summary,
      ctaLabel: "Learn more",
      ctaPath: "/about",
      formConsent: "I agree to be contacted about this inquiry.",
    });
  });

  test("maps real HTTPS booking destinations for both supported outcomes", () => {
    for (const kind of ["landing", "website"] as const) {
      const result = assess({
        kind,
        ctaLabel: "Book a consultation",
        ctaHref: "https://example.com/consultation",
      });
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.input).toHaveProperty("ctaHref", "https://example.com/consultation");
    }
  });

  test.each([
    "landing",
    "website",
  ] as const)("materializes a consent-only %s inquiry form without an external CTA", (kind) => {
    const consent = "I consent to Acme contacting me about my inquiry.";
    const result = assess({ kind, contactConsent: consent });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a complete built-in inquiry brief");
    expect(result.input).not.toHaveProperty("ctaLabel");
    expect(result.input).not.toHaveProperty("ctaHref");
    expect(result.input).not.toHaveProperty("ctaPath");
    const document = materializeWebRecipe(
      result.recipeId,
      kind === "website"
        ? { ...result.input, pageMode: "multi-page", projectSlug: "acme-inquiry" }
        : result.input,
    );
    const nodes = document.pages.flatMap((page) => page.nodes);
    expect(nodes.filter((node) => node.kind === "form")).toEqual([
      expect.objectContaining({ fields: ["email"], consent }),
    ]);
    expect(nodes.some((node) => node.kind === "cta")).toBe(false);
    if (kind === "website") {
      expect(document.pages.find((page) => page.slug === "contact")?.nodes).toContainEqual(
        expect.objectContaining({ kind: "form", consent }),
      );
      expect(document.navigation).toContainEqual(
        expect.objectContaining({ path: "/p/acme-inquiry/contact" }),
      );
    }
  });

  test("still refuses a mailto CTA when a valid built-in inquiry consent is supplied", () => {
    const result = assess({
      ctaLabel: "Inquire now",
      ctaHref: "mailto:inquiry@example.com",
      contactConsent: "I consent to Acme contacting me about my inquiry.",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected unsupported CTA refusal");
    expect(result.missing).toContainEqual(
      expect.objectContaining({ field: "ctaHref", reason: "unsupported_sales_path" }),
    );
  });

  test("blocks executable destinations, unsupported text and incomplete CTA pairs", () => {
    for (const overrides of [
      { kind: "landing", ctaLabel: "Continue", ctaHref: "javascript:alert(1)" },
      { headline: "<script>alert(1)</script>" },
      { ctaLabel: "Contact us" },
      { contactConsent: true },
    ])
      expect(assess(overrides).ok).toBe(false);
  });
});

test("progress requires exact immutable artifact receipts and never inherits another version's approval", () => {
  const assessment = assess();
  const artifact = { projectId: "project", versionId: "v2", contentHash: "a".repeat(64) };
  expect(onlinePresenceServiceState(assessment)).toBe("ready_to_build");
  expect(onlinePresenceServiceState(assessment, artifact)).toBe("awaiting_review");
  expect(
    onlinePresenceServiceState(assessment, {
      ...artifact,
      contentHash: `sha256:${artifact.contentHash}`,
    }),
  ).toBe("awaiting_review");
  expect(
    onlinePresenceServiceState(assessment, {
      ...artifact,
      approvedVersionId: "v1",
      publishedVersionId: "v1",
    }),
  ).toBe("awaiting_review");
  expect(onlinePresenceServiceState(assessment, { ...artifact, approvedVersionId: "v2" })).toBe(
    "approved",
  );
  expect(onlinePresenceServiceState(assessment, { ...artifact, publishedVersionId: "v2" })).toBe(
    "awaiting_review",
  );
  expect(
    onlinePresenceServiceState(assessment, {
      ...artifact,
      approvedVersionId: "v2",
      publishedVersionId: "v2",
    }),
  ).toBe("published");
  expect(onlinePresenceServiceState(assessment, { ...artifact, contentHash: "" })).toBe(
    "ready_to_build",
  );
});

test("the service grant contains only context, draft and build tools, with a complete registry mirror", async () => {
  expect(ONLINE_PRESENCE_TOOLS).toEqual([
    "readOnlinePresenceContext",
    "prepareOnlinePresenceAssets",
    "searchVault",
    "saveOnlinePresenceBrief",
    "buildOnlinePresenceProject",
  ]);
  expect(Object.isFrozen(ONLINE_PRESENCE_TOOLS)).toBe(true);
  const { onlinePresenceSpecialistSkillBody } = await import(
    "../../contracts/src/skills/onlinePresenceSpecialist"
  );
  const canonical = readFileSync(
    new URL("../../contracts/skills/online-presence-specialist.md", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  expect(onlinePresenceSpecialistSkillBody).toBe(canonical);
  for (const tool of ONLINE_PRESENCE_TOOLS) expect(canonical).toContain(`\`${tool}\``);
});
