import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { renderFieldworkReferenceDocument } from "./fieldworkReferenceRenderer";
import { FIELDWORK_REFERENCE_CSS } from "./fieldworkReferenceStyles";
import { hasUnsafeWebMarkup, WEB_CAROUSEL_TAG } from "./webCarouselRuntime";
import type { WebLayoutPlan } from "./webLayoutPlan";
import { materializeWebRecipeWithProvenance } from "./webRecipes";

const asset = (id: number) => ({
  storageRef: "webasset:image" + id + ":" + String(id).repeat(64),
  alt: "Owned image " + id,
  caption: "Caption " + id,
});
const input = {
  brandName: "Harbor Studio Demo",
  headline: "Thoughtful design for local shops.",
  summary: "Visual identity and print layout for independent retailers.",
  about: "A small design practice.",
  services: ["Visual identity design", "Print layout design"],
  contactConsent: "Contact me about this inquiry.",
  pageMode: "multi-page",
  projectSlug: "harbor",
};
const plan = {
  version: 3,
  hero: "overlay-left",
  sectionLayout: "editorial-columns",
  services: "columns",
  gallery: "carousel",
  spacing: "compact",
  headingScale: "display",
  motion: "subtle",
  designTokens: {
    colors: {
      paper: "#f3f0e8",
      card: "#e6e1d5",
      ink: "#20241f",
      muted: "#62665d",
      accent: "#bd7250",
      rule: "#c8c4b9",
    },
    typography: { heading: "editorial-serif", body: "humanist-sans" },
    spacing: { contentWidth: 1240, sectionGap: 80, copyMeasure: 58, heroMinHeight: 640 },
    footer: "light",
  },
  sections: [
    { pageSlug: "home", nodeId: "about", composition: "editorial-lead" },
    { pageSlug: "home", nodeId: "services", composition: "numbered-services" },
    { pageSlug: "services", nodeId: "services", composition: "numbered-services" },
    { pageSlug: "contact", nodeId: "contact", composition: "contact-panel" },
  ],
} satisfies WebLayoutPlan;
describe("Fieldwork selected component slots", () => {
  test("production stylesheet matches the approved source rather than a visual approximation", () => {
    const html = readFileSync(
      new URL("../../../apps/web/public/presence-examples/fieldwork.html", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");
    expect(html.match(/<style>([\s\S]*?)<\/style>/)?.[1]).toBe(FIELDWORK_REFERENCE_CSS);
  });
  test("site follows the approved sequence, preserves actual links, consent and functional form", () => {
    const { document, designProfile } = materializeWebRecipeWithProvenance("business-site", input);
    const render = (page: string) =>
      renderFieldworkReferenceDocument(
        document,
        { ...designProfile, layoutPlan: plan },
        { page, slug: "harbor" },
        "test",
      );
    const home = render("home");
    expect(home.indexOf('class="section about"')).toBeLessThan(
      home.indexOf('class="section services"'),
    );
    expect(home.indexOf('class="section services"')).toBeLessThan(
      home.indexOf('class="section contact contact-teaser"'),
    );
    expect(home).toContain('href="/p/harbor/contact"');
    expect(home).toContain("Visual identity design");
    expect(home).toContain('action="/p/harbor/contact/forms/contact"');
    expect(home).toContain(input.contactConsent);
    expect(home).not.toContain(WEB_CAROUSEL_TAG);
    expect(home).not.toContain("Fieldwork Design Studio");
    const contact = render("contact");
    expect(contact).toContain('action="/p/harbor/contact/forms/contact"');
    expect(contact).toContain(input.contactConsent);
    expect(contact).toContain('<h1 id="fieldwork:page-heading">Contact</h1>');
    expect(contact).toContain('<legend class="fieldwork-sr-only">Contact</legend>');
    expect(home).toContain("<legend>Contact</legend>");
    const services = render("services");
    expect(services).toContain('<h1 id="fieldwork:page-heading">Services</h1>');
    expect(services).not.toContain("<h2>Services</h2>");
    expect(services).toContain('id="services" aria-labelledby="fieldwork:page-heading"');
    expect(services).toContain("<h2>Visual identity design</h2>");
    expect(home).toContain('<div class="section-heading"><h2>Services</h2></div>');
    expect(hasUnsafeWebMarkup(home)).toBe(false);
  });
  test("three verified gallery slots use the immutable two-control runtime", () => {
    const { document, designProfile } = materializeWebRecipeWithProvenance("business-site", {
      ...input,
      media: { hero: asset(1), gallery: [asset(2), asset(3), asset(4)] },
    });
    const html = renderFieldworkReferenceDocument(
      document,
      {
        ...designProfile,
        layoutPlan: {
          ...plan,
          sections: [
            ...plan.sections,
            { pageSlug: "home", nodeId: "gallery", composition: "image-caption" },
          ],
        },
      },
      { page: "home", slug: "harbor" },
      "test",
    );
    expect(html).toContain(WEB_CAROUSEL_TAG);
    expect(html.match(/<button type="button" data-gallery-/g) ?? []).toHaveLength(2);
    expect(html).toContain("Caption 3");
    expect(hasUnsafeWebMarkup(html)).toBe(false);
  });
});
