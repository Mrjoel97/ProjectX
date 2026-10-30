import { describe, expect, test } from "vitest";
import { validateDesignProfileRef } from "./designKnowledge";
import { designedWebDocumentHash, renderDesignedWebDocument } from "./webDesignRenderer";
import { canonicalWebLayoutPlan, validateWebLayoutPlan, type WebLayoutPlan } from "./webLayoutPlan";
import { materializeWebRecipeWithProvenance } from "./webRecipes";

const plan: WebLayoutPlan = {
  version: 1,
  hero: "overlay-left",
  sectionLayout: "editorial-columns",
  services: "rows",
  gallery: "carousel",
  spacing: "relaxed",
  headingScale: "display",
  motion: "subtle",
};
describe("provider-authored closed layout plan", () => {
  const built = materializeWebRecipeWithProvenance("campaign-landing", {
    brandName: "An independent studio",
    headline: "Designed with purpose",
    formConsent: "Contact me about this inquiry.",
    media: {
      hero: { storageRef: `webasset:scene:${"a".repeat(64)}`, alt: "Provided studio scene" },
    },
    design: { variance: 5, density: 5, motion: 6 },
  });
  test("requires every closed choice and rejects executable or extra fields", () => {
    expect(validateWebLayoutPlan(plan)).toBe(true);
    for (const key of Object.keys(plan)) {
      const incomplete = { ...plan } as Record<string, unknown>;
      delete incomplete[key];
      expect(validateWebLayoutPlan(incomplete)).toBe(false);
    }
    for (const invalid of [
      { ...plan, hero: "<script>" },
      { ...plan, css: "body{}" },
      { ...plan, version: 2 },
      null,
      [],
    ]) {
      expect(validateWebLayoutPlan(invalid)).toBe(false);
      expect(validateDesignProfileRef({ ...built.designProfile, layoutPlan: invalid })).toBe(false);
    }
  });
  test("selected composition changes rendered layout and identity without modifying business content or real form routes", () => {
    const before = JSON.stringify(built.document);
    const profile = { ...built.designProfile, layoutPlan: plan };
    expect(validateDesignProfileRef(profile)).toBe(true);
    const html = renderDesignedWebDocument(built.document, profile, {
      slug: "studio",
      page: "campaign",
    });
    expect(html).toContain('data-layout-hero="overlay-left"');
    expect(html).toContain('data-layout-sections="editorial-columns"');
    expect(html).toContain('action="/p/studio/campaign/forms/signup"');
    expect(html).toContain("Provided studio scene");
    expect(html).not.toMatch(/<script|onload=|https:\/\/fonts/);
    const alternate = { ...profile, layoutPlan: { ...plan, hero: "split" as const } };
    expect(designedWebDocumentHash(built.document, profile)).not.toBe(
      designedWebDocumentHash(built.document, alternate),
    );
    expect(JSON.stringify(built.document)).toBe(before);
  });
  test("canonical key order survives persistence and disabled motion overrides the chosen dial", () => {
    const reordered = Object.fromEntries(Object.entries(plan).reverse()) as WebLayoutPlan;
    expect(JSON.stringify(canonicalWebLayoutPlan(reordered))).toBe(
      JSON.stringify(canonicalWebLayoutPlan(plan)),
    );
    expect(
      designedWebDocumentHash(built.document, { ...built.designProfile, layoutPlan: plan }),
    ).toBe(
      designedWebDocumentHash(built.document, { ...built.designProfile, layoutPlan: reordered }),
    );
    const html = renderDesignedWebDocument(built.document, {
      ...built.designProfile,
      layoutPlan: { ...plan, motion: "none" },
    });
    expect(html).not.toContain("@keyframes pikar-copy-arrive");
    expect(html).toContain("html,.gallery-carousel .gallery-track{scroll-behavior:auto}");
  });
});

const tokens = {
  colors: {
    paper: "#fffaf0",
    card: "#ffffff",
    ink: "#211e19",
    muted: "#665e50",
    accent: "#712b30",
    rule: "#ded6c9",
  },
  typography: { heading: "editorial-serif" as const, body: "humanist-sans" as const },
  spacing: { contentWidth: 1200, sectionGap: 64, copyMeasure: 62, heroMinHeight: 480 },
  footer: "light" as const,
};
test("v2 tokens are bounded, exact, and canonical without changing v1 bytes", () => {
  const v2 = { ...plan, version: 2 as const, designTokens: tokens };
  expect(validateWebLayoutPlan(v2)).toBe(true);
  expect(JSON.stringify(canonicalWebLayoutPlan(plan))).toBe(JSON.stringify(plan));
  const reordered = {
    ...v2,
    designTokens: {
      ...tokens,
      colors: Object.fromEntries(Object.entries(tokens.colors).reverse()),
    },
  };
  expect(JSON.stringify(canonicalWebLayoutPlan(reordered as WebLayoutPlan))).toBe(
    JSON.stringify(canonicalWebLayoutPlan(v2)),
  );
  for (const bad of [
    { ...tokens, css: "body{}" },
    { ...tokens, footer: "url(x)" },
    { ...tokens, colors: { ...tokens.colors, paper: "#fff" } },
    { ...tokens, colors: { ...tokens.colors, accent: "url(https://x)" } },
    { ...tokens, typography: { ...tokens.typography, heading: "custom-font" } },
    ...[0, Infinity, NaN, 1200.5, 1441].map((contentWidth) => ({
      ...tokens,
      spacing: { ...tokens.spacing, contentWidth },
    })),
  ])
    expect(validateWebLayoutPlan({ ...v2, designTokens: bad })).toBe(false);
});
