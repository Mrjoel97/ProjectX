import { describe, expect, test } from "vitest";
import { verifiedDesignKnowledgeBundle } from "./designKnowledge";
import {
  assertDesignProfileSources,
  designedWebDocumentHash,
  renderDesignedWebDocument,
} from "./webDesignRenderer";
import { materializeWebRecipeWithProvenance } from "./webRecipes";
import { canonicalWebDocument, renderWebDocument } from "./webRuntime";

describe("closed recipe design renderer", () => {
  const base = {
    brandName: "Acme Studio",
    headline: "A clear campaign",
    formConsent: "I agree to hear from this publisher.",
    attributionSource: "publisher-newsletter",
    ctaLabel: "Learn more",
    ctaPath: "/learn",
  };

  test("dials change actual styled HTML while document and form identities stay fixed", () => {
    const original = materializeWebRecipeWithProvenance("campaign-landing", base);
    const dialled = materializeWebRecipeWithProvenance("campaign-landing", {
      ...base,
      design: { variance: 7, motion: 6, density: 8 },
    });
    expect(canonicalWebDocument(original.document)).toBe(canonicalWebDocument(dialled.document));
    const first = renderDesignedWebDocument(original.document, original.designProfile);
    const second = renderDesignedWebDocument(dialled.document, dialled.designProfile);
    expect(first).not.toBe(second);
    expect(first).not.toBe(renderWebDocument(original.document));
    expect(first).toContain("@media(prefers-reduced-motion:reduce)");
    expect(first).toContain("I agree to hear from this publisher.");
    expect(designedWebDocumentHash(original.document, original.designProfile)).not.toBe(
      designedWebDocumentHash(dialled.document, dialled.designProfile),
    );
    for (const role of ["ui-ux-pro-max", "taste-skill", "nexscope-ecommerce"] as const) {
      const without = {
        ...verifiedDesignKnowledgeBundle,
        records: verifiedDesignKnowledgeBundle.records.filter(
          (record) => record.sourceRole !== role,
        ),
      };
      expect(() => assertDesignProfileSources(original.designProfile, without)).toThrow(
        /WEB_DESIGN_SOURCE_MISSING/,
      );
    }
  });

  test("rejects injected profile identity before rendering", () => {
    const original = materializeWebRecipeWithProvenance("campaign-landing", base);
    expect(() =>
      renderDesignedWebDocument(original.document, {
        ...original.designProfile,
        paletteId: "unsafe",
      }),
    ).toThrow(/WEB_DESIGN_PROFILE_INVALID/);
  });

  test("hashes a validated profile independently of persistence key order", () => {
    const { document, designProfile: profile } = materializeWebRecipeWithProvenance(
      "campaign-landing",
      base,
    );
    const reordered = {
      dials: {
        density: profile.dials.density,
        motion: profile.dials.motion,
        variance: profile.dials.variance,
      },
      formProfileId: profile.formProfileId,
      typographyId: profile.typographyId,
      paletteId: profile.paletteId,
      styleId: profile.styleId,
      patternId: profile.patternId,
      compilerHash: profile.compilerHash,
      bundleHash: profile.bundleHash,
      ...(profile.pageOverride === undefined ? {} : { pageOverride: profile.pageOverride }),
    };
    const persisted = JSON.parse(JSON.stringify(reordered));
    const expected = designedWebDocumentHash(document, profile);
    expect(designedWebDocumentHash(document, reordered)).toBe(expected);
    expect(designedWebDocumentHash(document, persisted)).toBe(expected);
    expect(
      designedWebDocumentHash(document, {
        ...profile,
        dials: { ...profile.dials, density: profile.dials.density === 1 ? 2 : 1 },
      }),
    ).not.toBe(expected);
  });

  test("disabled motion has no hover translation and long text can wrap on narrow screens", () => {
    const output = materializeWebRecipeWithProvenance("campaign-landing", {
      ...base,
      headline: "W".repeat(256),
      design: { motion: 1 },
    });
    const html = renderDesignedWebDocument(output.document, output.designProfile);
    expect(html).toContain("transition:transform 0ms ease");
    expect(html).toContain("a:hover,button:hover{transform:none}");
    expect(html).toContain(
      "@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;transform:none!important",
    );
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain("main>*{min-width:0}");
    expect(html).toContain("img,input,textarea,select{max-width:100%}");
    expect(html).toContain("W".repeat(256));
  });
});
