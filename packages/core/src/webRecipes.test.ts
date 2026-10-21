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
    const landing = { brandName: "A", headline: "B", ctaLabel: "Learn more" };
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

  it("preserves explicit HTTPS inquiry destinations in both site and landing recipes", () => {
    const ctaHref = "https://appointments.example/consultation?service=design&locale=en";
    for (const family of ["business-site", "campaign-landing"] as const) {
      const input = {
        brandName: "Acme",
        headline: "Design services",
        ctaLabel: "Book a consultation",
        ctaHref,
      };
      const result = materializeWebRecipeWithProvenance(family, input);
      const node = result.document.pages[0]?.nodes.find((entry) => entry.kind === "cta");
      expect(node).toMatchObject({
        id: "primary",
        target: { kind: "https", url: ctaHref },
        analytics: true,
      });
      const html = renderWebDocument(result.document, {
        slug: "acme",
        page: result.document.pages[0]?.slug ?? "home",
      });
      expect(html).toContain("/cta/primary");
      expect(html).toContain(
        "https://appointments.example/consultation?service=design&amp;locale=en",
      );
      expect(result.recipe.compilerId).toBe("web-recipes-v3");
      expect(
        materializeWebRecipeWithProvenance(family, {
          ...input,
          ctaHref: "https://appointments.example/other",
        }).inputHash,
      ).not.toBe(result.inputHash);
    }
  });

  it("rejects missing, ambiguous, credentialed and executable CTA destinations", () => {
    const base = { brandName: "Acme", headline: "Our services" };
    for (const family of ["business-site", "campaign-landing"] as const) {
      for (const ctaHref of [
        "javascript:alert(1)",
        "data:text/html,hello",
        "http://inquiry.example/",
        "//inquiry.example/",
        "https://user:secret@inquiry.example/",
        "https://inquiry.example\\@other.example/",
        "https://inquiry.example/\nnext",
        'https://inquiry.example/"onclick=bad',
        "https://",
      ])
        expect(validateWebRecipeInput(family, { ...base, ctaLabel: "Contact", ctaHref }).ok).toBe(
          false,
        );
      expect(validateWebRecipeInput(family, { ...base, ctaLabel: "Contact" }).ok).toBe(false);
      expect(
        validateWebRecipeInput(family, { ...base, ctaHref: "https://inquiry.example/" }).ok,
      ).toBe(false);
    }
    expect(
      validateWebRecipeInput("campaign-landing", {
        ...base,
        ctaLabel: "Contact",
        ctaHref: "https://inquiry.example/",
        ctaPath: "/contact",
      }).ok,
    ).toBe(false);
    expect(
      validateWebRecipeInput("storefront-catalogue", {
        brandName: "Acme",
        items: [{ id: "one", name: "Thing", description: "A thing" }],
        ctaLabel: "Contact",
        ctaHref: "https://inquiry.example/",
      }).ok,
    ).toBe(false);
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

  it("builds a coherent multiple-page business website using the allocated project route", () => {
    const input = {
      brandName: "Acme Tax",
      headline: "Tax and accounting services",
      summary: "We help merchants understand stock, shipping and tax records.",
      about: "Acme supports local businesses.",
      services: ["Tax planning", "Inventory accounting"],
      ctaLabel: "Arrange a consultation",
      ctaHref: "https://booking.example/consultation",
      contactConsent: "I agree that Acme can contact me about my inquiry.",
      pageMode: "multi-page",
      projectSlug: "acme-tax",
    } as const;
    const materialized = materializeWebRecipeWithProvenance("business-site", input);
    expect(materialized.document.pages.map((page) => page.slug)).toEqual([
      "home",
      "about",
      "services",
      "contact",
    ]);
    expect(materialized.document.navigation.map((item) => item.path)).toEqual([
      "/p/acme-tax/home",
      "/p/acme-tax/about",
      "/p/acme-tax/services",
      "/p/acme-tax/contact",
    ]);
    for (const page of materialized.document.pages) {
      const html = renderWebDocument(materialized.document, {
        slug: "acme-tax",
        page: page.slug,
      });
      for (const target of materialized.document.navigation)
        expect(html).toContain(`href="${target.path}"`);
      expect(html).toContain('<header><a href="/p/acme-tax/home">Acme Tax</a></header>');
      expect(html).not.toContain("<img");
    }
    const contact = renderWebDocument(materialized.document, {
      slug: "acme-tax",
      page: "contact",
    });
    expect(contact).toContain("/p/acme-tax/contact/forms/contact");
    expect(contact).toContain("/p/acme-tax/contact/cta/primary");
    expect(canonicalWebDocument(materialized.document)).toContain("Tax planning");
    expect(
      materializeWebRecipe("business-site", { brandName: "Acme", headline: "Our work" }).pages,
    ).toHaveLength(1);
    for (const projectSlug of [undefined, "../other", "Other", "x".repeat(65)])
      expect(validateWebRecipeInput("business-site", { ...input, projectSlug }).ok).toBe(false);
  });

  it("permits legitimate business copy while keeping transaction capabilities structurally closed", () => {
    const copy = {
      brandName: "Merchant Tax Advisors",
      headline: "Tax, stock and shipping advice",
      summary: "We explain checkout and payment records.",
      services: ["Inventory accounting", "Refund reconciliation"],
    };
    expect(validateWebRecipeInput("business-site", copy).ok).toBe(true);
    expect(
      validateWebRecipeInput("campaign-landing", {
        brandName: copy.brandName,
        headline: copy.headline,
        offer: copy.summary,
      }).ok,
    ).toBe(true);
    for (const forbidden of ["checkout", "payment", "merchant", "inventory", "cart"])
      expect(
        validateWebRecipeInput("business-site", { ...copy, [forbidden]: { enabled: true } }).ok,
      ).toBe(false);
    expect(
      validateWebRecipeInput("business-site", { ...copy, headline: "<script>attack()</script>" })
        .ok,
    ).toBe(false);
  });

  it("omits unsupported empty pages and keeps real business content on the home page", () => {
    const minimal = materializeWebRecipe("business-site", {
      brandName: "Acme",
      headline: "Our work",
      summary: "A real summary",
      pageMode: "multi-page",
      projectSlug: "acme",
    });
    expect(minimal.pages.map((page) => page.slug)).toEqual(["home"]);
    const complete = materializeWebRecipe("business-site", {
      brandName: "Acme",
      headline: "Our work",
      services: ["Research"],
      about: "An independent practice",
      pageMode: "multi-page",
      projectSlug: "acme",
    });
    expect(complete.pages.map((page) => page.slug)).toEqual(["home", "about", "services"]);
    expect(
      canonicalWebDocument({
        ...complete,
        pages: [complete.pages[0] as (typeof complete.pages)[number]],
      }),
    ).toContain("An independent practice");
    expect(complete.navigation.some((item) => item.path.endsWith("/contact"))).toBe(false);
  });

  it("admits only closed art direction and safe brand colors and includes them in input identity", () => {
    const base = { brandName: "Acme", headline: "Our work" };
    for (const family of ["business-site", "campaign-landing"] as const) {
      const directed = materializeWebRecipeWithProvenance(family, {
        ...base,
        artDirection: "studio",
        primaryColor: "#123ABC",
      });
      expect(directed.designProfile.artDirection).toBe("studio");
      expect(directed.document.brand.primaryColor).toBe("#123ABC");
      expect(directed.inputHash).not.toBe(
        materializeWebRecipeWithProvenance(family, base).inputHash,
      );
      for (const primaryColor of ["red", "#123", "#12345678", "#fff;url(evil)"])
        expect(validateWebRecipeInput(family, { ...base, primaryColor }).ok).toBe(false);
      expect(validateWebRecipeInput(family, { ...base, artDirection: "wild" }).ok).toBe(false);
    }
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
