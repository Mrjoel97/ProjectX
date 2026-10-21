import { describe, expect, test } from "vitest";
import { verifiedDesignKnowledgeBundle } from "./designKnowledge";
import {
  assertDesignProfileSources,
  designedWebDocumentHash,
  renderDesignedWebDocument,
  webColorContrast,
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
      ...(profile.artDirection === undefined ? {} : { artDirection: profile.artDirection }),
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

  test("art directions change real composition and typography while preserving source facts and actions", () => {
    const input = {
      brandName: "Acme",
      headline: "Clear work for ambitious businesses",
      summary: "Independent expertise for your next move.",
      services: ["Strategy", "Operations"],
      about: "An independent team.",
      ctaLabel: "Start a conversation",
      ctaHref: "https://inquiry.example/",
    };
    const html = ["editorial", "studio", "technical"].map((artDirection) => {
      const result = materializeWebRecipeWithProvenance("business-site", {
        ...input,
        artDirection,
      });
      const rendered = renderDesignedWebDocument(result.document, result.designProfile, {
        slug: "acme",
        page: "home",
      });
      expect(rendered).toContain(`data-art-direction="${artDirection}"`);
      expect(rendered).toContain('action="/p/acme/home/cta/primary"');
      expect(rendered).toContain('data-target="https://inquiry.example/"');
      expect(rendered).toContain("Independent expertise for your next move.");
      expect(rendered).toContain("Strategy");
      expect(rendered).not.toMatch(
        /<script|https:\/\/fonts|unsplash|testimonials|trusted by|guaranteed/i,
      );
      expect(rendered).not.toMatch(/counter\(|Consolas|monospace/);
      expect(rendered).toContain("@media(max-width:767px)");
      return rendered;
    });
    expect(new Set(html).size).toBe(3);
    expect(html[0]).toContain('--heading:Georgia,"Times New Roman",serif');
    expect(html[1]).toContain('class="hero-rail"');
    expect(html[2]).toContain("--hero:#102331");
  });

  test("source brand color persists with accessible computed control contrast, including white and yellow", () => {
    for (const primaryColor of ["#FFFFFF", "#FFFF00", "#001122", "#777777", "#EE3344"]) {
      const result = materializeWebRecipeWithProvenance("campaign-landing", {
        ...base,
        primaryColor,
      });
      const html = renderDesignedWebDocument(result.document, result.designProfile);
      expect(html).toContain(`--accent:${primaryColor}`);
      expect(html).toContain(
        ":focus-visible{outline:3px solid #000000;outline-offset:3px;box-shadow:0 0 0 3px #ffffff}",
      );
      const text = html.match(/--button-ink:(#[a-f0-9]{6})/)?.[1];
      expect(text).toBeDefined();
      expect(webColorContrast(text ?? "#000000", primaryColor)).toBeGreaterThanOrEqual(4.5);
      expect(result.document.brand.primaryColor).toBe(primaryColor);
    }
    expect(() => webColorContrast("red;url(evil)", "#ffffff")).toThrow("WEB_COLOR_INVALID");
  });

  test("legacy profiles remain accepted and both direction and brand color affect immutable identity", () => {
    const original = materializeWebRecipeWithProvenance("campaign-landing", base);
    const { artDirection: _direction, ...legacy } = original.designProfile;
    expect(() => renderDesignedWebDocument(original.document, legacy)).not.toThrow();
    const first = designedWebDocumentHash(original.document, original.designProfile);
    expect(
      designedWebDocumentHash(original.document, {
        ...original.designProfile,
        artDirection: "technical",
      }),
    ).not.toBe(first);
    expect(
      designedWebDocumentHash(
        { ...original.document, brand: { ...original.document.brand, primaryColor: "#223344" } },
        original.designProfile,
      ),
    ).not.toBe(first);
    expect(() =>
      renderDesignedWebDocument(original.document, {
        ...original.designProfile,
        artDirection: "arbitrary",
      } as never),
    ).toThrow("WEB_DESIGN_PROFILE_INVALID");
  });

  test("low visual density is airier and high density is tighter through consumed layout spacing", () => {
    const sparse = materializeWebRecipeWithProvenance("campaign-landing", {
      ...base,
      design: { density: 1 },
    });
    const dense = materializeWebRecipeWithProvenance("campaign-landing", {
      ...base,
      design: { density: 10 },
    });
    const sparseHtml = renderDesignedWebDocument(sparse.document, sparse.designProfile);
    const denseHtml = renderDesignedWebDocument(dense.document, dense.designProfile);
    expect(sparseHtml).toContain("--space:34px");
    expect(denseHtml).toContain("--space:16px");
    expect(sparseHtml).toContain("gap:calc(var(--space)*2.5)");
    expect(denseHtml).toContain("padding:calc(var(--space)*2) 0");
  });

  test("keeps a campaign primary CTA next to its hero when proof precedes it in document order", () => {
    const result = materializeWebRecipeWithProvenance("campaign-landing", {
      ...base,
      proofPoints: ["Publisher-supplied evidence"],
    });
    const html = renderDesignedWebDocument(result.document, result.designProfile, {
      slug: "acme",
      page: "campaign",
    });
    expect(html.indexOf('action="/p/acme/campaign/cta/primary"')).toBeLessThan(
      html.indexOf("Publisher-supplied evidence"),
    );
    expect(html).toContain(
      ".site-header nav a{display:inline-flex;align-items:center;min-height:44px",
    );
  });
});
