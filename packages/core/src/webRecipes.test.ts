import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getWebRecipeDefinition,
  materializeWebRecipe,
  materializeWebRecipeWithProvenance,
  validateWebRecipeInput,
  WEB_RECIPE_DEFINITIONS,
  webRecipeDefinitionHashMaterial,
  webRecipeDocumentHash,
  webRecipeInputHashMaterial,
} from "./webRecipes";
import { canonicalWebDocument, renderWebDocument } from "./webRuntime";

describe("canonical web recipes", () => {
  it("exposes exactly the three closed recipe families", () => {
    expect(
      WEB_RECIPE_DEFINITIONS.map((recipe) => [recipe.id, recipe.registryName, recipe.outputKind]),
    ).toEqual([
      ["business-site", "web-recipe-business-site", "site"],
      ["campaign-landing", "web-recipe-campaign-landing", "landing"],
      ["storefront-catalogue", "web-recipe-storefront-catalogue", "storefront"],
    ]);
  });

  it("rejects unknown, over-bound and executable inputs", () => {
    expect(
      validateWebRecipeInput("business-site", { brandName: "A", headline: "B", script: "alert(1)" })
        .ok,
    ).toBe(false);
    expect(
      validateWebRecipeInput("campaign-landing", {
        brandName: "A",
        headline: "B",
        ctaPath: "javascript:alert(1)",
      }).ok,
    ).toBe(false);
    expect(
      validateWebRecipeInput("storefront-catalogue", {
        brandName: "A",
        items: [{ id: "x", name: "X", description: "Y", quantity: 1 }],
      }).ok,
    ).toBe(false);
    expect(
      validateWebRecipeInput("business-site", {
        brandName: "A",
        headline: "B",
        design: { density: 11 },
      }).ok,
    ).toBe(false);
    expect(
      validateWebRecipeInput("business-site", {
        brandName: "A",
        headline: "B",
        services: Array.from({ length: 9 }, () => "service"),
      }).ok,
    ).toBe(false);
    expect(
      validateWebRecipeInput("campaign-landing", {
        brandName: "A",
        headline: "B",
        proofPoints: Array.from({ length: 7 }, () => "fact"),
      }).ok,
    ).toBe(false);
    expect(
      validateWebRecipeInput("storefront-catalogue", {
        brandName: "A",
        items: Array.from({ length: 21 }, (_, index) => ({
          id: `item-${index}`,
          name: "Item",
          description: "Description",
        })),
      }).ok,
    ).toBe(false);
    expect(
      validateWebRecipeInput("business-site", {
        brandName: "A",
        headline: "B",
        offer: "cross-family",
      }).ok,
    ).toBe(false);
  });

  it("requires only the fields appropriate to each family", () => {
    expect(validateWebRecipeInput("business-site", { brandName: "A" }).ok).toBe(false);
    expect(validateWebRecipeInput("campaign-landing", { brandName: "A" }).ok).toBe(false);
    expect(validateWebRecipeInput("storefront-catalogue", { brandName: "A" }).ok).toBe(false);
    expect(
      validateWebRecipeInput("storefront-catalogue", {
        brandName: "A",
        items: [{ id: "one", name: "Thing", description: "A thing" }],
      }).ok,
    ).toBe(true);
  });

  it("enforces every required field and the declared 256-character local CTA path", () => {
    for (const [family, valid, required] of [
      ["business-site", { brandName: "A", headline: "B" }, ["brandName", "headline"]],
      ["campaign-landing", { brandName: "A", headline: "B" }, ["brandName", "headline"]],
      [
        "storefront-catalogue",
        { brandName: "A", items: [{ id: "x", name: "X", description: "Y" }] },
        ["brandName", "items"],
      ],
    ] as const) {
      expect(validateWebRecipeInput(family, valid).ok).toBe(true);
      for (const missing of required) {
        const omitted = Object.fromEntries(
          Object.entries(valid).filter(([key]) => key !== missing),
        );
        expect(validateWebRecipeInput(family, omitted).ok).toBe(false);
      }
    }
    const landing = { brandName: "A", headline: "B" };
    expect(
      validateWebRecipeInput("campaign-landing", { ...landing, ctaPath: `/${"a".repeat(255)}` }).ok,
    ).toBe(true);
    expect(
      validateWebRecipeInput("campaign-landing", { ...landing, ctaPath: `/${"a".repeat(256)}` }).ok,
    ).toBe(false);
    expect(
      validateWebRecipeInput("campaign-landing", {
        ...landing,
        ctaPath: "/p/spring-offer/campaign",
      }).ok,
    ).toBe(true);
    for (const ctaPath of [
      "/p/spring-offer/campaign/extra",
      "/p/spring_offer/campaign",
      "/p/spring-offer/%2e%2e",
      "//outside.example/campaign",
    ])
      expect(validateWebRecipeInput("campaign-landing", { ...landing, ctaPath }).ok).toBe(false);
  });

  it("materializes validated editable documents without invented proof or commerce", () => {
    const business = materializeWebRecipe("business-site", {
      brandName: "Acme",
      headline: "Useful work",
    });
    expect(business.kind).toBe("site");
    expect(canonicalWebDocument(business)).not.toContain("conversion");
    const landing = materializeWebRecipe("campaign-landing", {
      brandName: "Acme",
      headline: "Try it",
    });
    expect(landing.kind).toBe("landing");
    const storefront = materializeWebRecipe("storefront-catalogue", {
      brandName: "Acme",
      items: [
        {
          id: "one",
          name: "Thing",
          description: "A thing",
          displayPriceText: "$10",
          availabilityLabel: "Ask us",
        },
      ],
    });
    const html = renderWebDocument(storefront);
    expect(html).toContain("commerce-unavailable");
    expect(html).toContain("Ordering is unavailable");
    expect(html).not.toMatch(/checkout|javascript:|<script/i);
  });

  it("rejects every listed storefront commerce field or semantic", () => {
    const fields = [
      "quantity",
      "inventory",
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
    ];
    for (const field of fields) {
      expect(
        validateWebRecipeInput("storefront-catalogue", {
          brandName: "Acme",
          items: [{ id: "one", name: "Thing", description: "A thing", [field]: "forbidden" }],
        }),
      ).toMatchObject({ ok: false });
    }
    expect(
      validateWebRecipeInput("storefront-catalogue", {
        brandName: "Acme",
        items: [{ id: "one", name: "Buy now", description: "A thing" }],
      }).ok,
    ).toBe(false);
  });

  it("preserves repeat output/hash and returns separate immutable design provenance", () => {
    const input = {
      brandName: "Acme",
      headline: "Launch",
      proofPoints: ["Publisher fact"],
      ctaLabel: "Learn more",
      ctaPath: "/learn",
      formConsent: "I agree",
      attributionSource: "newsletter",
    };
    const first = materializeWebRecipeWithProvenance("campaign-landing", input);
    const second = materializeWebRecipeWithProvenance("campaign-landing", input);
    expect(canonicalWebDocument(first.document)).toBe(canonicalWebDocument(second.document));
    expect(first.inputHash).toBe(second.inputHash);
    expect(first.recipe.bodyHash).toBe(getWebRecipeDefinition("campaign-landing")?.bodyHash);
    for (const [recipeId, recipeInput] of [
      ["business-site", { brandName: "Acme", headline: "Work", contactConsent: "I agree" }],
      ["campaign-landing", input],
      [
        "storefront-catalogue",
        { brandName: "Acme", items: [{ id: "one", name: "Thing", description: "A thing" }] },
      ],
    ] as const) {
      const document = materializeWebRecipe(recipeId, recipeInput);
      const expected = `sha256:${createHash("sha256")
        .update(new TextEncoder().encode(canonicalWebDocument(document)))
        .digest("hex")}`;
      expect(webRecipeDocumentHash(recipeId, recipeInput)).toBe(expected);
    }
    const bodyExpected = `sha256:${createHash("sha256")
      .update(new TextEncoder().encode(webRecipeDefinitionHashMaterial(first.recipe)))
      .digest("hex")}`;
    expect(first.recipe.bodyHash).toBe(bodyExpected);
    const inputExpected = `sha256:${createHash("sha256")
      .update(new TextEncoder().encode(webRecipeInputHashMaterial("campaign-landing", input)))
      .digest("hex")}`;
    expect(first.inputHash).toBe(inputExpected);
    expect(first.designProfile.bundleHash).toBeDefined();
  });

  it("preserves route, consent, attribution and analytics identities across design changes", () => {
    const original = materializeWebRecipe("campaign-landing", {
      brandName: "Acme",
      headline: "Launch",
      ctaLabel: "Learn",
      ctaPath: "/learn",
      formConsent: "I agree",
      attributionSource: "email",
      design: { density: 2 },
    });
    const revised = materializeWebRecipe("campaign-landing", {
      brandName: "Acme",
      headline: "Launch",
      ctaLabel: "Learn",
      ctaPath: "/learn",
      formConsent: "I agree",
      attributionSource: "email",
      design: { density: 8 },
    });
    expect(revised.pages[0]?.nodes).toEqual(original.pages[0]?.nodes);
  });
});
