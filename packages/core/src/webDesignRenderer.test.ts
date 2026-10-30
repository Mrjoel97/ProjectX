import { WEB_CAROUSEL_TAG, hasUnsafeWebMarkup } from "./webCarouselRuntime";
import { describe, expect, test } from "vitest";
import { verifiedDesignKnowledgeBundle } from "./designKnowledge";
import {
  assertDesignProfileSources,
  designedWebDocumentHash,
  renderDesignedWebDocument,
  WEB_DESIGN_RENDERER_VERSION,
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

  test("v2 presentation preserves validated palette, typography, spacing and light footer without replacing content", () => {
    const { document, designProfile } = materializeWebRecipeWithProvenance("campaign-landing", base);
    const html = renderDesignedWebDocument(document, { ...designProfile, layoutPlan: {
      version: 2, hero: "split", sectionLayout: "stacked", services: "rows", gallery: "grid", spacing: "compact", headingScale: "balanced", motion: "subtle",
      designTokens: { colors: { paper: "#faf8f2", card: "#ffffff", ink: "#222222", muted: "#555555", accent: "#224433", rule: "#cccccc" }, typography: { heading: "modern-serif", body: "humanist-sans" }, spacing: { contentWidth: 1100, sectionGap: 60, copyMeasure: 48, heroMinHeight: 440 }, footer: "light" },
    } });
    expect(html).toContain("--paper:#faf8f2");
    expect(html).toContain("--measure:1100px");
    expect(html).toContain('--heading:"Palatino Linotype",Palatino,Georgia,serif');
    expect(html).toContain("padding-block:clamp(28px,6vw,60px)");
    expect(html).toContain("max-width:48ch");
    expect(html).toContain(".site-footer{background:#faf8f2;color:#222222;border-color:#cccccc}");
    expect(html).toContain(base.headline);
    expect(html).toContain(base.formConsent);
    expect(hasUnsafeWebMarkup(html)).toBe(false);
  });

  test("approved galleries become keyboard-accessible first-party carousels with real asset routes", () => {
    const gallery = ["Workspace", "Material detail", "Design process"].map((alt, index) => ({
      storageRef: `webasset:photo${index}:${String(index + 1).repeat(64)}`,
      alt,
    }));
    const { document, designProfile } = materializeWebRecipeWithProvenance("campaign-landing", {
      ...base, media: { gallery }, design: { variance: 5, density: 5, motion: 6 },
    });
    const html = renderDesignedWebDocument(document, designProfile, { slug: "gallery", page: "campaign" });
    expect(html).toContain('class="designed-gallery gallery-carousel"');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html.match(/data-gallery-(?:previous|next) aria-label/g)).toHaveLength(2);
    expect(html).toContain(WEB_CAROUSEL_TAG);
    expect(hasUnsafeWebMarkup(html)).toBe(false);
    for (let index = 1; index <= 3; index += 1) {

      expect(html).toContain(`id="gallery-image-${index}"`);
      expect(html).toContain(`/p/gallery/assets/photo${index - 1}/${String(index).repeat(64)}`);
    }
    expect(html).toContain("scroll-snap-type:x proximity");
    expect(html).toContain(".gallery-carousel .gallery-track{scroll-behavior:auto;scroll-snap-type:none}");
    expect(html.replace(WEB_CAROUSEL_TAG, "")).not.toMatch(/<script|aria-hidden="true"/);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("*:not(.gallery-track),*:before,*:after{transform:none!important}");
  });

  test("small galleries remain readable grids and gallery labels are escaped", () => {
    const { document, designProfile } = materializeWebRecipeWithProvenance("campaign-landing", {
      ...base,
      media: { gallery: [{ storageRef: `webasset:detail:${"a".repeat(64)}`, alt: 'Paper & "ink"' }] },
    });
    const html = renderDesignedWebDocument(document, designProfile);
    expect(html).toContain('class="designed-gallery"');
    expect(html).not.toContain('class="gallery-controls"');
    expect(html).toContain('Paper &amp; &quot;ink&quot;');
    expect(html).toContain('class="gallery-caption"');
  });

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

  test("surface choices are hash-bound while retaining exactly the same supported content, assets and form routes", () => {
    const input = {
      ...base,
      media: {
        hero: { storageRef: `webasset:source:${"a".repeat(64)}`, alt: "Owner supplied scene" },
      },
    };
    const outputs = ["minimal", "glass", "clay"].map((surfaceStyle) =>
      materializeWebRecipeWithProvenance("campaign-landing", { ...input, surfaceStyle }),
    );
    expect(new Set(outputs.map(({ document }) => canonicalWebDocument(document))).size).toBe(1);
    const hashes = outputs.map(({ document, designProfile }) =>
      designedWebDocumentHash(document, designProfile),
    );
    expect(new Set(hashes).size).toBe(3);
    for (const { document, designProfile } of outputs) {
      const html = renderDesignedWebDocument(document, designProfile, {
        slug: "owned",
        page: "campaign",
      });
      expect(html).toContain(`data-surface-style="${designProfile.surfaceStyle}"`);
      expect(html).toContain('action="/p/owned/campaign/forms/signup"');
      expect(html).toContain('action="/p/owned/campaign/cta/primary"');
      expect(html).toContain(`/p/owned/assets/source/${"a".repeat(64)}`);
      expect(html).toContain("I agree to hear from this publisher.");
      expect(html.replace(WEB_CAROUSEL_TAG, "")).not.toMatch(/<script|onload=|https:\/\/fonts/);
    }
    const { document, designProfile } = outputs[0]!;
    expect(() =>
      renderDesignedWebDocument(document, { ...designProfile, surfaceStyle: "unsafe" } as never),
    ).toThrow("WEB_DESIGN_PROFILE_INVALID");
    expect(() =>
      materializeWebRecipeWithProvenance("campaign-landing", {
        ...input,
        surfaceStyle: "backdrop:url(evil)",
      }),
    ).toThrow("invalid_surface_style");
  });

  test("consent-only image-backed campaigns link to their actual inquiry form without inventing an external target", () => {
    const { document, designProfile } = materializeWebRecipeWithProvenance("campaign-landing", {
      brandName: "Retreat",
      headline: "A quiet place",
      formConsent: "Contact me about this inquiry.",
      surfaceStyle: "glass",
      media: { hero: { storageRef: `webasset:scene:${"b".repeat(64)}`, alt: "Provided scene" } },
    });
    const html = renderDesignedWebDocument(document, designProfile, {
      slug: "retreat",
      page: "campaign",
    });
    expect(html).toContain('href="#inquiry-signup"');
    expect(html).toContain(
      '<form id="inquiry-signup" method="post" action="/p/retreat/campaign/forms/signup">',
    );
    expect(html).toContain('name="email" type="email" autocomplete="email" required');
    expect(html).not.toContain("data-target=");
    expect(document.pages[0]?.nodes.some((node) => node.kind === "cta")).toBe(false);
  });

  test("catalogue uses real hash-bound item images and native details, with no inferred checkout", () => {
    const ref = `webasset:vessel:${"c".repeat(64)}`;
    const { document, designProfile } = materializeWebRecipeWithProvenance("storefront-catalogue", {
      brandName: "Ceramics",
      surfaceStyle: "clay",
      items: [
        {
          id: "jug",
          name: "A ceramic jug",
          description: "A supplied product description.",
          imageStorageRef: ref,
          displayPriceText: "$48",
        },
      ],
    });
    const html = renderDesignedWebDocument(document, designProfile, {
      slug: "ceramics",
      page: "catalogue",
    });
    expect(html.indexOf(`data-asset-ref="${ref}"`)).toBeLessThan(
      html.indexOf("<h3>A ceramic jug</h3>"),
    );
    expect(html).toContain(
      "<details><summary>View details</summary><p>A supplied product description.</p></details>",
    );
    expect(html).toContain("Ordering is unavailable");
    expect(html.replace(WEB_CAROUSEL_TAG, "")).not.toMatch(/<form|buy now|add to cart|payment|checkout/i);
    expect(() =>
      materializeWebRecipeWithProvenance("storefront-catalogue", {
        brandName: "Ceramics",
        items: [
          {
            id: "jug",
            name: "Jug",
            description: "Vessel",
            imageStorageRef: "https://outside.example/jug.jpg",
          },
        ],
      }),
    ).toThrow("invalid_storage_ref");
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
      ...(profile.surfaceStyle === undefined ? {} : { surfaceStyle: profile.surfaceStyle }),
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
      "@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important",
    );
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain("main>*{min-width:0}");
    expect(html).toContain("img,input,textarea,select{max-width:100%}");
    expect(html).toContain("W".repeat(256));
    expect(html).toContain("html,.gallery-carousel .gallery-track{scroll-behavior:auto}button:active,.cta:active{transform:none}");
    expect(html).not.toContain("@keyframes");
  });

  test("motion changes only presentation across surfaces, preserving every owned image, action and source fact", () => {
    const input = {
      ...base,
      media: {
        hero: { storageRef: `webasset:owned_scene:${"a".repeat(64)}`, alt: "Selected scene" },
      },
    };
    for (const surfaceStyle of ["minimal", "glass", "clay"] as const) {
      const still = materializeWebRecipeWithProvenance("campaign-landing", {
        ...input,
        surfaceStyle,
        design: { motion: 1 },
      });
      const moving = materializeWebRecipeWithProvenance("campaign-landing", {
        ...input,
        surfaceStyle,
        design: { motion: 10 },
      });
      const route = { slug: "owned-campaign", page: "campaign" };
      const stillHtml = renderDesignedWebDocument(still.document, still.designProfile, route);
      const movingHtml = renderDesignedWebDocument(moving.document, moving.designProfile, route);
      const withoutStyle = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, "");
      expect(canonicalWebDocument(still.document)).toBe(canonicalWebDocument(moving.document));
      expect(withoutStyle(stillHtml)).toBe(withoutStyle(movingHtml));
      expect(movingHtml).toContain('action="/p/owned-campaign/campaign/cta/primary"');
      expect(movingHtml).toContain('action="/p/owned-campaign/campaign/forms/signup"');
      expect(movingHtml).toContain("I agree to hear from this publisher.");
      expect(movingHtml.replace(WEB_CAROUSEL_TAG, "")).not.toMatch(/<script|onload=|animationend|<canvas/);
      expect(designedWebDocumentHash(still.document, still.designProfile, route)).not.toBe(
        designedWebDocumentHash(moving.document, moving.designProfile, route),
      );
    }
  });

  test("hero choreography consumes bounded dial tokens and releases actions immediately on user intent", () => {
    const durations: number[] = [];
    for (const motion of [3, 6, 10]) {
      const result = materializeWebRecipeWithProvenance("campaign-landing", {
        ...base,
        design: { motion },
      });
      const html = renderDesignedWebDocument(result.document, result.designProfile);
      const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
      const enter = Number(css.match(/--motion-enter:(\d+)ms/)?.[1]);
      const step = Number(css.match(/--motion-step:(\d+)ms/)?.[1]);
      const rise = Number(css.match(/--motion-rise:(\d+)px/)?.[1]);
      const feedback = Number(css.match(/--motion-feedback:(\d+)ms/)?.[1]);
      durations.push(enter);
      expect(enter).toBeGreaterThanOrEqual(500);
      expect(enter + step * 2).toBeLessThanOrEqual(1_000);
      expect(rise).toBeGreaterThan(0);
      expect(rise).toBeLessThanOrEqual(16);
      expect(feedback).toBeGreaterThanOrEqual(150);
      expect(feedback).toBeLessThanOrEqual(200);
      expect(css).toContain(".hero h1{animation:pikar-copy-arrive var(--motion-enter)");
      expect(css).toContain("animation-delay:var(--motion-step)");
      expect(css).toContain("animation-delay:calc(var(--motion-step)*2)");
      expect(css).toContain("translateY(var(--motion-rise))");
      expect(css).toContain("button,.cta{transition:transform var(--motion-feedback)");
      expect(css).toContain(
        ".hero-action:hover,.hero-action:focus-within,.hero-action:active{animation:none}",
      );
    }
    expect(durations[0]).toBeLessThan(durations[1]!);
    expect(durations[1]).toBeLessThan(durations[2]!);
  });

  test("progressive scroll effects are motion-preference and feature guarded, with no hidden or script-dependent content", () => {
    const result = materializeWebRecipeWithProvenance("campaign-landing", {
      ...base,
      design: { motion: 6 },
    });
    const html = renderDesignedWebDocument(result.document, result.designProfile);
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const layer = css.slice(css.indexOf("@media(prefers-reduced-motion:no-preference)"));
    expect(layer).toContain(
      "@supports (animation-timeline:view()) and (animation-range:entry 0% cover 20%)",
    );
    expect(layer).toContain(
      "animation:pikar-section-arrive 1ms linear both;animation-timeline:view();animation-range:entry 0% cover 20%",
    );
    expect(layer).toContain("#gallery>.web-media img,.gallery-slide .web-media img,.catalogue-items article>.web-media img");
    expect(layer).toContain(".catalogue-items details[open]>p");
    expect(layer).not.toMatch(
      /opacity:|visibility:|display:|pointer-events:|height:|width:|filter:|infinite|javascript|url\(/i,
    );
    const keyframes = [...layer.matchAll(/@keyframes [^{]+\{from\{([^}]+)\}to\{([^}]+)\}\}/g)];
    expect(keyframes).toHaveLength(4);
    for (const frame of keyframes) {
      expect(frame[1]).toMatch(/^transform:/);
      expect(frame[2]).toBe("transform:none");
    }
    expect(css).toContain(
      "@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}",
    );
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

  test("tactile and glass control boundaries remain distinguishable for pale and dark source colors", () => {
    for (const surfaceStyle of ["glass", "clay"] as const) {
      for (const primaryColor of ["#FFFFFF", "#FFFF00", "#001122", "#777777"]) {
        const result = materializeWebRecipeWithProvenance("campaign-landing", {
          ...base,
          surfaceStyle,
          primaryColor,
        });
        const html = renderDesignedWebDocument(result.document, result.designProfile);
        const edge = html.match(
          surfaceStyle === "glass"
            ? /\[data-surface-style=glass\] \.has-media \.hero-action \.cta\{border-color:([^;}]+)/
            : /\[data-surface-style=clay\] \.cta\{border-color:([^;}]+)/,
        )?.[1];
        const backgrounds =
          surfaceStyle === "glass" ? ["#153b36", "#293d39"] : ["#f8f4ee", "#efe8df"];
        expect(edge).toBeDefined();
        for (const background of backgrounds)
          expect(
            webColorContrast(
              edge === "transparent" ? primaryColor : (edge ?? primaryColor),
              background,
            ),
          ).toBeGreaterThanOrEqual(3);
      }
    }
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

test("short navigation labels retain 44px touch targets in both header and footer", () => {
  const result = materializeWebRecipeWithProvenance("business-site", {
    brandName: "Studio",
    headline: "Thoughtful design",
    summary: "A small design practice.",
    services: ["Identity design"],
    about: "A local studio.",
    contactConsent: "I agree to hear from this studio.",
    pageMode: "multi-page",
    projectSlug: "studio",
  });
  for (const page of result.document.pages) {
    const html = renderDesignedWebDocument(result.document, result.designProfile, {
      slug: "studio",
      page: page.slug,
    });
    expect(html).toContain(`content="${WEB_DESIGN_RENDERER_VERSION}"`);
    for (const selector of [".site-header nav a", ".site-footer nav a"]) {
      const declaration = html.slice(html.indexOf(`${selector}{`)).split("}")[0];
      expect(declaration).toContain("display:inline-flex;");
      expect(declaration).toContain("min-height:44px;");
      expect(declaration).toContain("min-width:44px;");
    }
    for (const label of ["Home", "About"]) {
      expect(html.split(`>${label}</a>`)).toHaveLength(3);
    }
  }
});

test("image composition respects owned crop and navigation retains exact per-page destinations", () => {
  const media = {
    hero: {
      storageRef: `webasset:owned_image:${"a".repeat(64)}`,
      alt: "Supplied business illustration",
      aspect: "landscape" as const,
      focalPoint: { x: 35, y: 60 },
    },
  };
  const result = materializeWebRecipeWithProvenance("business-site", {
    brandName: "A business",
    headline: "A useful service",
    about: "Approved business background.",
    ctaLabel: "Start a conversation",
    ctaHref: "https://example.com/inquiry",
    pageMode: "multi-page",
    projectSlug: "owned-business",
    media,
    artDirection: "editorial",
  });
  const html = renderDesignedWebDocument(result.document, result.designProfile, {
    slug: "owned-business",
    page: "home",
  });
  expect(html).toContain('class="hero-composition has-rail has-media"');
  expect(html).toContain("aspect-ratio:16 / 10");
  expect(html).toContain("object-position:35% 60%");
  expect(html.replace(WEB_CAROUSEL_TAG, "")).not.toMatch(/min-height:(320|220)px/);
  expect(html).toContain(".web-media img{position:absolute;inset:0");
  expect(html).toContain(
    '<nav aria-label="Primary"><ul><li><a href="/p/owned-business/home" aria-current="page">Home</a>',
  );
  expect(html).toContain('<nav aria-label="Footer">');
  expect(html).toContain('<a class="footer-brand" href="/p/owned-business/home">A business</a>');
  expect(html.split('action="/p/owned-business/home/cta/primary"')).toHaveLength(2);
  expect(html.replace(WEB_CAROUSEL_TAG, "")).not.toMatch(/<script|onload=|testimonials|guaranteed/);
});

test("the selected landing pattern changes a consumed copy measure on the same document", () => {
  const result = materializeWebRecipeWithProvenance("campaign-landing", {
    brandName: "Campaign",
    headline: "A supported business offer",
    ctaLabel: "Inquire",
    ctaHref: "https://example.com/inquiry",
  });
  const campaign = renderDesignedWebDocument(result.document, {
    ...result.designProfile,
    patternId: "hero-features-cta",
  });
  const business = renderDesignedWebDocument(result.document, {
    ...result.designProfile,
    patternId: "landing-proof",
  });
  const css = (html: string) => html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  expect(css(campaign)).toContain("--copy-measure:700px;");
  expect(css(business)).toContain("--copy-measure:100%;");
  for (const html of [campaign, business])
    expect(css(html)).toContain(".hero-copy{max-width:var(--copy-measure)}");
  expect(css(campaign)).not.toBe(css(business));
  // A multi-column media lead is a composition, not the single text measure.
  expect(css(campaign)).toContain(
    "body[data-art-direction=editorial] .has-media .hero-copy{max-width:100%;display:grid",
  );
  expect(canonicalWebDocument(result.document)).toContain("A supported business offer");
});

test("minimal image-led heroes overlay real readable HTML and preserve the exact inquiry destination", () => {
  const imageRef = `webasset:studio_image:${"c".repeat(64)}`;
  const result = materializeWebRecipeWithProvenance("business-site", {
    brandName: "Quiet Form",
    headline: "Space to feel at home.",
    summary: "Interiors shaped around the way you live.",
    surfaceStyle: "minimal",
    artDirection: "editorial",
    contactConsent: "I agree to be contacted about this inquiry.",
    media: {
      hero: { storageRef: imageRef, alt: "Supplied interior illustration", aspect: "landscape" },
    },
  });
  const html = renderDesignedWebDocument(result.document, result.designProfile, {
    slug: "quiet-form",
    page: "home",
  });
  const hero = html.slice(
    html.indexOf('<div class="hero-composition'),
    html.indexOf('<div class="content-flow"'),
  );
  expect(hero).toContain("<h1>Space to feel at home.</h1>");
  expect(hero).toContain("Interiors shaped around the way you live.");
  expect(hero).toContain(`data-asset-ref="${imageRef}"`);
  expect(hero).toContain('href="#inquiry-contact"');
  expect(html).toContain('id="inquiry-contact"');
  expect(html).toContain('action="/p/quiet-form/home/forms/contact"');
  expect(html).toContain("I agree to be contacted about this inquiry.");
  expect(html).toContain("body[data-surface-style=minimal] .has-media .hero-copy{display:block");
  expect(html).toContain(
    "linear-gradient(90deg,rgba(0,0,0,.74) 0%,rgba(0,0,0,.64) 55%,rgba(0,0,0,.12) 100%)",
  );
  expect(html).toContain(".hero-composition.has-media:before{background:rgba(0,0,0,.64)}");
  // Even the brightest possible image under the mobile scrim has readable white text.
  expect(webColorContrast("#ffffff", "#5c5c5c")).toBeGreaterThanOrEqual(4.5);
  expect(hero).not.toMatch(/<script|<canvas|<svg|onload=|background-image:/);
});

test("clay shop heroes overlay real copy and collection action while preserving all product images and facts", () => {
  const heroRef = `webasset:collection_scene:${"d".repeat(64)}`;
  const productRef = `webasset:jug_photo:${"e".repeat(64)}`;
  const result = materializeWebRecipeWithProvenance("storefront-catalogue", {
    brandName: "Soft Form",
    intro: "Sculptural pieces for everyday rituals, with the full product facts below.",
    surfaceStyle: "clay",
    design: { motion: 6 },
    media: {
      hero: { storageRef: heroRef, alt: "Selected collection scene", focalPoint: { x: 55, y: 50 } },
    },
    items: [
      {
        id: "jug",
        name: "Everyday jug",
        description: "A supplied product description.",
        displayPriceText: "£48",
        imageStorageRef: productRef,
      },
    ],
  });
  const html = renderDesignedWebDocument(result.document, result.designProfile, {
    slug: "soft-form",
    page: "catalogue",
  });
  const hero = html.slice(
    html.indexOf('<div class="hero-composition'),
    html.indexOf('<div class="content-flow"'),
  );
  expect(hero).toContain("<h1>Soft Form</h1>");
  expect(hero).toContain("Sculptural pieces for everyday rituals");
  expect(hero).toContain(`data-asset-ref="${heroRef}"`);
  expect(hero).toContain('href="#pikar-collection"');
  expect(html).toContain('id="pikar-collection"');
  expect(html).toContain(`data-asset-ref="${productRef}"`);
  expect(html).toContain("Everyday jug");
  expect(html).toContain("£48");
  expect(html).toContain("A supplied product description.");
  expect(html).toContain("object-position:55% 50%");
  expect(html).toContain(
    "body[data-surface-style=clay] .hero-composition.has-media{position:relative;isolation:isolate;display:flex",
  );
  expect(html).toContain(
    "body[data-surface-style=clay] .has-media .hero-rail.hero-visual{position:absolute;inset:0;z-index:-2;width:100%;height:100%",
  );
  expect(html).toContain(
    "body[data-surface-style=clay] .hero-composition.has-media{padding:32px 24px;min-height:620px;gap:0}",
  );
  // The scrim's fully protected region tracks actual copy height, not a fixed viewport percentage.
  expect(html).toContain('.hero-copy:before{content:"";position:absolute;inset:-64px -50vw -100px');
  expect(html).toContain("rgba(0,0,0,.68) calc(100% - 100px)");
  expect(webColorContrast("#ffffff", "#6e6e6e")).toBeGreaterThanOrEqual(4.5);
  expect(html.replace(WEB_CAROUSEL_TAG, "")).not.toMatch(/<script|<form|buy now|add to cart|background-image:/i);
});
