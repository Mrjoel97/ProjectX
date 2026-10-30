import { WEB_CAROUSEL_SCRIPT } from "@pikar/core/webCarouselRuntime";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderDesignedWebDocument } from "@pikar/core/webDesignRenderer";
import { materializeWebRecipeWithProvenance } from "@pikar/core/webRecipes";
import { expect, test } from "@playwright/test";

test("reduced-motion gallery arrows move instantly despite the global motion reset", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 900 });
  const result = materializeWebRecipeWithProvenance("campaign-landing", {
    brandName: "Gallery fixture", headline: "Three image studies", formConsent: "Fixture only.",
    media: { gallery: [1, 2, 3].map(index => ({ storageRef: `webasset:fixture:${"a".repeat(64)}`, alt: `Study ${index}` })) },
    design: { variance: 5, density: 5, motion: 6 },
  });
  await page.setContent(renderDesignedWebDocument(result.document, result.designProfile, { slug: "fixture", page: "campaign" }));
  await expect(page.locator(".gallery-carousel")).toHaveClass(/is-ready/);
  const track = page.locator(".gallery-track");
  const position = () => track.evaluate(element => getComputedStyle(element).transform);
  const initial = await position();
  await page.getByRole("button", { name: "Next image" }).click();
  await expect.poll(position).not.toBe(initial);
  expect(await track.evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
  await page.getByRole("button", { name: "Previous image" }).click();
  await expect.poll(position).toBe(initial);
});

// Fictional business briefs for presentation checks, never customer facts or live qualification.
test("split hero keeps dark text on light paper and editorial sections do not create phantom rows", async ({ page }) => {
  const result = materializeWebRecipeWithProvenance("business-site", {
    brandName: "Studio fixture", headline: "Thoughtful identities for independent businesses",
    summary: "Brand and website design.", about: "A small independent design studio.",
    services: ["Brand identity", "Website design"], artDirection: "studio",
    media: { hero: { storageRef: `webasset:fixture:${"a".repeat(64)}`, alt: "Studio material study" } },
  });
  const profile = { ...result.designProfile, layoutPlan: {
    version: 2, hero: "split", sectionLayout: "editorial-columns", services: "columns", gallery: "grid", spacing: "compact", headingScale: "balanced", motion: "subtle",
    designTokens: { colors: { paper: "#F6FBF5", card: "#F0F5F0", ink: "#181D1A", muted: "#414846", accent: "#32534A", rule: "#C1C8C4" }, typography: { heading: "editorial-serif", body: "humanist-sans" }, spacing: { contentWidth: 1280, copyMeasure: 62, heroMinHeight: 560, sectionGap: 64 }, footer: "light" },
  } as const };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setContent(renderDesignedWebDocument(result.document, profile));
    expect(await page.locator("h1").evaluate(el => getComputedStyle(el).color)).toBe("rgb(24, 29, 26)");
    expect(await page.locator("body").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(246, 251, 245)");
    expect(await page.locator(".hero-composition").evaluate(el => getComputedStyle(el).minHeight)).toBe("0px");
    expect(await page.locator("#about").evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(280);
    expect(await page.locator(".footer-brand").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(36);
    expect(await page.locator("#services>p").allTextContents()).toEqual(["Brand identity", "Website design"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.setContent(renderDesignedWebDocument(result.document, { ...profile, layoutPlan: { ...profile.layoutPlan, hero: "overlay-left" } }));
  expect(await page.locator("h1").evaluate(el => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
});

const contact = {
  pageMode: "multi-page",
  projectSlug: "design-fixture",
  ctaLabel: "Discuss your plans",
  ctaHref: "https://example.com/inquiry",
  contactConsent: "I agree that the team may contact me about this inquiry.",
} as const;
const fixtures = [
  {
    id: "advisory",
    recipe: "business-site",
    input: {
      ...contact,
      brandName: "Mtaa Advisory",
      headline: "Clarity for your next move.",
      summary: "Practical financial planning for independent businesses in Dar es Salaam.",
      services: [
        "Business planning for your next decision.",
        "Financial reporting for independent owners.",
        "Cash flow planning for what comes next.",
      ],
      about:
        "Mtaa Advisory works alongside independent business owners. Bring your questions, your numbers and your next decision.",
      artDirection: "editorial",
      primaryColor: "#245745",
    },
  },
  {
    id: "studio",
    recipe: "business-site",
    input: {
      ...contact,
      brandName: "Fieldwork Studio",
      headline: "Make the useful beautiful.",
      summary:
        "Brand and digital design for independent businesses with something different to say.",
      services: [
        "Brand identity shaped around your business.",
        "Digital experiences for your customers.",
        "Creative direction across every touchpoint.",
      ],
      about:
        "Fieldwork starts with your business, your customers and the details that set you apart.",
      artDirection: "studio",
    },
  },
  {
    id: "technical",
    recipe: "business-site",
    input: {
      ...contact,
      brandName: "Relay Systems",
      headline: "Systems that work together.",
      summary: "Practical integration and technical support for growing operations.",
      services: [
        "Platform integration for the tools you depend on.",
        "Workflow review for manual handoffs.",
        "Technical support with a clear next step.",
      ],
      about:
        "Relay works from the systems you already use, the existing constraints and what success needs to look like.",
      artDirection: "technical",
    },
  },
  {
    id: "campaign",
    recipe: "campaign-landing",
    input: {
      brandName: "Mtaa Workshop",
      headline: "Plan your next quarter.",
      offer:
        "A focused planning session for independent owners. Bring your goals and work through your priorities.",
      proofPoints: [
        "Work through revenue, costs and operating priorities.",
        "Prepare a plan around your actual business constraints.",
      ],
      ctaLabel: "Ask about the workshop",
      ctaHref: "https://example.com/workshop",
      formConsent: "I agree to be contacted about this workshop inquiry.",
      artDirection: "editorial",
    },
  },
] as const;

for (const direction of ["editorial", "studio", "technical"] as const) {
  for (const width of [1440, 768, 390]) {
    test(`${direction} renders real hero and gallery image bytes at ${width}px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(60_000);
      const files = ["design-study", "color-study", "booklet-study"].map((name) => {
        const bytes = readFileSync(
          new URL(`./fixtures/online-presence/${name}.png`, import.meta.url),
        );
        const digest = createHash("sha256").update(bytes).digest("hex");
        return {
          bytes,
          digest,
          ref: `webasset:${name}:${digest}`,
          path: `/p/media-site/assets/${name}/${digest}`,
        };
      });
      const result = materializeWebRecipeWithProvenance("business-site", {
        brandName: "Fieldwork Studio",
        headline: "Make the useful beautiful.",
        summary:
          "Brand and digital design for independent businesses. Generated illustration studies shown below.",
        services: [
          "Brand identity shaped around your business.",
          "Digital experiences for your customers.",
        ],
        about: "We start with your business, your customers and the details that set you apart.",
        ctaLabel: "Discuss your project",
        ctaHref: "https://example.com/inquiry",
        artDirection: direction,
        pageMode: "multi-page",
        projectSlug: "media-site",
        media: {
          hero: {
            storageRef: files[0]!.ref,
            alt: "Generated paper composition study",
            crop: "cover",
            aspect: "landscape",
            focalPoint: { x: 55, y: 50 },
          },
          gallery: files.slice(1).map((file, index) => ({
            storageRef: file.ref,
            alt: index === 0 ? "Generated colour print study" : "Generated folded booklet study",
            crop: "contain",
          })),
        },
      });
      const home = result.document.pages[0]!;
      const unexpected: string[] = [];
      const loadedAssets: string[] = [];
      const rootUrl = `https://design-fixture.test/p/media-site/${home.slug}`;
      await page.route("**/*", async (route) => {
        const url = route.request().url();
        const targetPage = result.document.pages.find(
          (candidate) => url === `https://design-fixture.test/p/media-site/${candidate.slug}`,
        );
        if (targetPage)
          return route.fulfill({
            contentType: "text/html",
            body: renderDesignedWebDocument(result.document, result.designProfile, {
              slug: "media-site",
              page: targetPage.slug,
            }),
          });
        const file = files.find(
          (candidate) => url === `https://design-fixture.test${candidate.path}`,
        );
        if (file) {
          loadedAssets.push(file.ref);
          return route.fulfill({ contentType: "image/png", body: file.bytes });
        }
        unexpected.push(url);
        return route.abort();
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(rootUrl);
      const images = page.locator("img[data-asset-ref]");
      await expect(images).toHaveCount(3);
      for (const image of await images.all()) {
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
          .toBeGreaterThan(1000);
        await image.evaluate((element) => (element as HTMLImageElement).decode());
        expect(await image.getAttribute("alt")).toMatch(/^Generated /);
        const box = await image.boundingBox();
        expect(box!.width).toBeGreaterThan(100);
        expect(box!.height).toBeGreaterThan(100);
        const figure = await image.locator("..").boundingBox();
        expect(figure!.width / figure!.height).toBeCloseTo(1.6, 1);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      const heroMedia = await images.first().boundingBox();
      const frame = await page.locator("main").boundingBox();
      if (width === 1440)
        expect(heroMedia!.width / frame!.width).toBeGreaterThan(
          direction === "editorial" ? 0.9 : 0.35,
        );
      expect(new Set(loadedAssets).size).toBe(3);
      expect(unexpected).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(await images.first().evaluate((image) => getComputedStyle(image).objectPosition)).toBe(
        "55% 50%",
      );
      const action = page.getByRole("button", { name: "Discuss your project" });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect((await action.boundingBox())!.y).toBeLessThan(900);
      await page.screenshot({
        path: testInfo.outputPath(`media-${direction}-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("navigation", { name: "Primary", exact: true })
        .getByRole("link", { name: "About", exact: true })
        .click();
      await expect(page.locator("h1")).toHaveText("About");
      await expect(
        page
          .getByRole("navigation", { name: "Primary", exact: true })
          .locator('a[aria-current="page"]'),
      ).toHaveText("About");
      await page
        .getByRole("navigation", { name: "Footer", exact: true })
        .getByRole("link", { name: "Home", exact: true })
        .click();
      await expect(page.locator("h1")).toHaveText("Make the useful beautiful.");
      expect(unexpected).toEqual([]);
    });
  }
}

for (const fixture of fixtures) {
  for (const width of [1440, 768, 390]) {
    test(`${fixture.id} preserves readable content and real controls at ${width}px`, async ({
      page,
    }, testInfo) => {
      const result = materializeWebRecipeWithProvenance(fixture.recipe, fixture.input);
      const requests: string[] = [];
      await page.route("**/*", (route) => {
        requests.push(route.request().url());
        return route.abort();
      });
      await page.setViewportSize({ width, height: 900 });
      for (const savedPage of result.document.pages) {
        const html = renderDesignedWebDocument(result.document, result.designProfile, {
          slug: "design-fixture",
          page: savedPage.slug,
        });
        await page.setContent(html);
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        const headings = await page.locator("h1,h2,h3").evaluateAll((items) =>
          items.map((el) => {
            // A heading can span grid rows while its text stays on one line. Measure ink, not the box.
            const range = document.createRange();
            range.selectNodeContents(el);
            const lines = new Set(
              [...range.getClientRects()]
                .filter((rect) => rect.width > 0 && rect.height > 0)
                .map((rect) => Math.round(rect.top)),
            );
            return { text: el.textContent, lines: lines.size };
          }),
        );
        for (const heading of headings)
          expect(heading.lines, heading.text ?? "heading").toBeLessThan(2.2);
        for (const service of await page.locator(".hero-rail #services>p").all()) {
          expect((await service.boundingBox())!.width).toBeGreaterThan(200);
        }
        const fontSize = await page
          .locator("body")
          .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
        expect(fontSize).toBeGreaterThanOrEqual(16);
        const main = await page.locator("main").boundingBox();
        expect(main).not.toBeNull();
        if (main) expect(Math.abs(main.x - (width - main.x - main.width))).toBeLessThan(2);
        // Existing user-visible destinations and consent remain present in the redesigned output.
        for (const link of await page.locator("nav a").all()) {
          expect(await link.getAttribute("href")).toMatch(/^\/p\/design-fixture\/[a-z0-9-]+$/);
          const box = await link.boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
        }
        const action = page.getByRole("button", { name: fixture.input.ctaLabel });
        if (savedPage.slug === result.document.pages[0]?.slug || savedPage.slug === "contact") {
          await expect(action).toHaveCount(1);
          const box = await action.boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
          if (savedPage.slug === result.document.pages[0]?.slug) expect(box?.y).toBeLessThan(900);
          expect(await action.getAttribute("data-target")).toBe(fixture.input.ctaHref);
          expect(await action.locator("..").getAttribute("action")).toBe(
            `/p/design-fixture/${savedPage.slug}/cta/primary`,
          );
        }
        for (const consent of await page.locator('input[name="consent"]').all()) {
          await expect(consent).not.toBeChecked();
          await expect(consent).toHaveAttribute("required", "");
        }
        expect(await page.locator("iframe").count()).toBe(0);
        const scripts = await page.locator("script").allTextContents();
        expect(scripts.length).toBeLessThanOrEqual(1);
        if (scripts.length) expect(scripts[0]).toBe(WEB_CAROUSEL_SCRIPT);
        await page.screenshot({
          path: testInfo.outputPath(`${savedPage.slug}-${width}.png`),
          fullPage: true,
        });
      }
      expect(requests).toEqual([]);
    });
  }
}

test("a light customer brand colour still produces a readable, keyboard-accessible action", async ({
  page,
}) => {
  const result = materializeWebRecipeWithProvenance("business-site", {
    ...contact,
    brandName: "Light Brand",
    headline: "Plan with clarity.",
    summary: "A fictional brief to exercise customer brand contrast.",
    artDirection: "editorial",
    primaryColor: "#ffff99",
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.setContent(
    renderDesignedWebDocument(result.document, result.designProfile, {
      slug: "design-fixture",
      page: "home",
    }),
  );
  const button = page.getByRole("button", { name: contact.ctaLabel });
  const contrast = await button.evaluate((el) => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (channels: number[]) =>
      channels
        .map((value) => value / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
        .reduce((total, value, index) => {
          const weight = [0.2126, 0.7152, 0.0722][index];
          if (weight === undefined) throw new Error("Unsupported RGB channel count");
          return total + value * weight;
        }, 0);
    const style = getComputedStyle(el);
    const text = luminance(rgb(style.color));
    const fill = luminance(rgb(style.backgroundColor));
    return (Math.max(text, fill) + 0.05) / (Math.min(text, fill) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await button.focus();
  await expect(button).toBeFocused();
  expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
});

test("long multilingual business copy reflows without hiding content or horizontal scrolling", async ({
  page,
}) => {
  const brandName = "Huduma za biashara na mipango kwa wajasiriamali wa Dar es Salaam";
  const headline =
    "Tunasaidia biashara yako kupanga hatua inayofuata kwa uelewa wa mapato, matumizi na malengo yako.";
  const result = materializeWebRecipeWithProvenance("business-site", {
    ...contact,
    brandName,
    headline,
    summary: "Tumia taarifa zako kupanga hatua zinazofuata.",
    services: ["Mipango ya biashara", "Uchambuzi wa mtiririko wa fedha"],
    artDirection: "technical",
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.setContent(
    renderDesignedWebDocument(result.document, result.designProfile, {
      slug: "design-fixture",
      page: "home",
    }),
  );
  await expect(page.locator("h1")).toHaveText(headline);
  await expect(page.locator("h1")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.locator("h1").evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(
    true,
  );
});
