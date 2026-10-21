import { renderDesignedWebDocument } from "@pikar/core/webDesignRenderer";
import { materializeWebRecipeWithProvenance } from "@pikar/core/webRecipes";
import { expect, test } from "@playwright/test";

// Fictional business briefs for presentation checks, never customer facts or live qualification.
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
        expect(await page.locator("script,iframe").count()).toBe(0);
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
        .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
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
