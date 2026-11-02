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
      media: { hero: { storageRef: `webasset:photo:${"a".repeat(64)}`, alt: "Test photograph" } },
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
    await test.step("maintain hero text contrast on a white photograph", async () => {
      // A white source is the brightest possible backdrop at every point in this static scrim.
      await page.addStyleTag({
        content: ".hero:has(>.hero-image){background:#fff}.hero-image{visibility:hidden}",
      });
      const samples = await page
        .locator(".hero h1, .hero h1 em, .hero-bottom p")
        .evaluateAll((elements) =>
          elements.map((element) => {
            const range = window.document.createRange();
            const points: { x: number; y: number }[] = [];
            for (const child of element.childNodes) {
              if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
              range.selectNodeContents(child);
              for (const box of range.getClientRects()) {
                for (const x of [box.left + 1, box.right - 1])
                  for (const y of [box.top + 1, box.bottom - 1])
                    points.push({ x: Math.floor(x), y: Math.floor(y) });
              }
            }
            const style = getComputedStyle(element);
            return {
              color: style.color,
              minimum: parseFloat(style.fontSize) >= 24 ? 3.15 : 4.75,
              points,
            };
          }),
        );
      await page.addStyleTag({
        content:
          ".hero-content *{-webkit-text-fill-color:transparent!important;text-shadow:none!important}",
      });
      const imageUrl = (await page.screenshot()).toString("base64");
      const minima = await page.evaluate(
        async ({ imageUrl, samples }) => {
          const binary = Uint8Array.from(atob(imageUrl), (c) => c.charCodeAt(0));
          const image = await createImageBitmap(new Blob([binary], { type: "image/png" }));
          const canvas = window.document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          const luminance = (rgb: number[]) =>
            rgb.slice(0, 3).reduce((total, byte, index) => {
              const v = byte / 255;
              return (
                total +
                [0.2126, 0.7152, 0.0722][index]! *
                  (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
              );
            }, 0);
          return samples.map(({ color, points }) => {
            const ink = luminance(color.match(/[\d.]+/g)!.map(Number));
            return Math.min(
              ...points.map(({ x, y }) => {
                const background = luminance(Array.from(context.getImageData(x, y, 1, 1).data));
                return (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05);
              }),
            );
          });
        },
        { imageUrl, samples },
      );
      expect(samples).toHaveLength(3);
      for (const [i, sample] of samples.entries()) {
        expect(sample.points.length).toBeGreaterThan(0);
        expect(minima[i]).toBeGreaterThanOrEqual(sample.minimum);
      }
    });
  });
}
