import { readFileSync } from "node:fs";
import { renderDesignedWebDocument } from "@pikar/core/webDesignRenderer";
import { materializeWebRecipeWithProvenance } from "@pikar/core/webRecipes";
import { expect, test } from "@playwright/test";

// Compare the native output to the independent, originally approved HTML at the same viewport.
// Copy, assets and form destinations belong to the new business and are intentionally different.
for (const width of [1440, 390]) {
  test(`selected website preserves the approved Fieldwork component geometry at ${width}px`, async ({
    page,
  }) => {
    const reference = readFileSync(
      new URL("../public/presence-examples/fieldwork.html", import.meta.url),
      "utf8",
    );
    const { document, designProfile } = materializeWebRecipeWithProvenance("business-site", {
      brandName: "Source studio",
      headline: "Source work for local shops",
      summary: "Identity and print for local shops.",
      about: "A small independent practice.",
      services: ["Identity", "Print"],
    });
    const layoutPlan = {
      version: 3,
      hero: "overlay-left",
      sectionLayout: "stacked",
      services: "rows",
      gallery: "carousel",
      spacing: "relaxed",
      headingScale: "display",
      motion: "subtle",
      designTokens: {
        colors: {
          paper: "#ffffff",
          card: "#ffffff",
          ink: "#222222",
          muted: "#444444",
          accent: "#112233",
          rule: "#dddddd",
        },
        typography: { heading: "editorial-serif", body: "humanist-sans" },
        spacing: { contentWidth: 1200, sectionGap: 64, copyMeasure: 62, heroMinHeight: 480 },
        footer: "light",
      },
      sections: [
        { pageSlug: "home", nodeId: "services", composition: "numbered-services" },
        { pageSlug: "home", nodeId: "about", composition: "editorial-lead" },
      ],
    } as const;
    const rendered = renderDesignedWebDocument(
      document,
      {
        ...designProfile,
        approvedTemplate: "fieldwork-v1",
        layoutPlan: { ...layoutPlan, sections: [...layoutPlan.sections] },
      },
      { slug: "source-studio", page: "home" },
    );
    const measure = () => {
      const el = (selector: string) => window.document.querySelector<HTMLElement>(selector)!;
      const hero = el(".hero").getBoundingClientRect();
      const heading = getComputedStyle(el(".hero h1"));
      const services = getComputedStyle(el(".service-list"));
      return {
        inset: hero.left,
        width: hero.width,
        height: hero.height,
        font: heading.fontFamily,
        size: heading.fontSize,
        line: heading.lineHeight,
        paper: getComputedStyle(window.document.body).backgroundColor,
        serviceColor: getComputedStyle(el(".services")).backgroundColor,
        columns: services.gridTemplateColumns,
        gap: services.columnGap,
      };
    };
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/*", (r) => r.abort());
    await page.setContent(reference);
    const expected = await page.evaluate(measure);
    await page.setContent(rendered);
    expect(await page.evaluate(measure)).toEqual(expected);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Source work for local shops");
    expect(
      await page.locator("main > section").evaluateAll((nodes) => nodes.map((el) => el.id)),
    ).toEqual(["page-hero", "about", "services"]);
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth)).toBe(width);
  });
}
