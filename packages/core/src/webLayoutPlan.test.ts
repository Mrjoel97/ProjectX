import { describe, expect, test } from "vitest";
import { validateDesignProfileRef } from "./designKnowledge";
import { designedWebDocumentHash, renderDesignedWebDocument } from "./webDesignRenderer";
import {
  canonicalWebLayoutPlan,
  validateWebLayoutPlan,
  validateWebLayoutPlanForDocument,
  type WebLayoutPlan,
} from "./webLayoutPlan";
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

describe("v3 document-bound section presentation", () => {
  const document = {
    kind: "site" as const,
    title: "Studio",
    brand: { name: "Studio" },
    navigation: [],
    pages: [
      {
        slug: "home",
        title: "Home",
        nodes: [
          {
            kind: "section" as const,
            id: "services",
            heading: "Practice",
            children: [{ kind: "text" as const, text: "Source service" }],
          },
        ],
      },
    ],
  };
  const sections = [
    { pageSlug: "home", nodeId: "services", composition: "service-panels" as const },
  ];
  const v3 = { ...plan, version: 3 as const, designTokens: tokens, sections };
  test("preserves legacy bytes and exact source content", () => {
    const before = JSON.stringify(document);
    expect(validateWebLayoutPlanForDocument(document, v3)).toBe(true);
    expect(JSON.stringify(document)).toBe(before);
    const v2 = { ...plan, version: 2 as const, designTokens: tokens };
    expect(JSON.stringify(canonicalWebLayoutPlan(v2))).toBe(JSON.stringify(v2));
    expect(
      canonicalWebLayoutPlan({
        ...v3,
        sections: [{ composition: "service-panels", nodeId: "services", pageSlug: "home" }],
      }),
    ).toEqual(canonicalWebLayoutPlan(v3));
  });
  test("refuses missing coverage, foreign refs, duplicate refs, arbitrary fields and incompatible compositions", () => {
    for (const bad of [
      [sections[0], sections[0]],
      [{ ...sections[0], nodeId: "" }],
      [{ ...sections[0], css: "color:red" }],
      [{ ...sections[0], composition: "html" }],
      Array(25).fill(sections[0]),
    ])
      expect(validateWebLayoutPlan({ ...v3, sections: bad })).toBe(false);
    for (const refs of [
      [],
      [{ ...sections[0], pageSlug: "foreign" }],
      [{ ...sections[0], nodeId: "missing" }],
      [{ ...sections[0], composition: "contact-panel" }],
      [{ ...sections[0], composition: "image-caption" }],
    ])
      expect(validateWebLayoutPlanForDocument(document, { ...v3, sections: refs })).toBe(false);
    expect(
      validateWebLayoutPlanForDocument(
        { ...document, pages: [document.pages[0]!, document.pages[0]!] },
        v3,
      ),
    ).toBe(false);
    expect(
      validateWebLayoutPlanForDocument(
        { ...document, pages: [{ ...document.pages[0]!, nodes: [] }] },
        { ...v3, sections: [] },
      ),
    ).toBe(true);
  });
  test("composition cannot silently discard an embedded action", () => {
    const altered = {
      ...document,
      pages: [
        {
          ...document.pages[0]!,
          nodes: [
            {
              ...document.pages[0]!.nodes[0]!,
              children: [
                {
                  kind: "cta" as const,
                  id: "retain",
                  label: "Contact",
                  target: { kind: "local" as const, path: "/contact" },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(validateWebLayoutPlanForDocument(altered, v3)).toBe(false);
  });
});

test("v3 accepts supported source structures and canonicalizes annotation order", () => {
  const document = {
    kind: "site" as const,
    title: "Studio",
    brand: { name: "Studio" },
    navigation: [],
    pages: [
      {
        slug: "home",
        title: "Home",
        nodes: [
          {
            kind: "section" as const,
            id: "intro",
            heading: "Practice",
            children: [{ kind: "text" as const, text: "Source introduction" }],
          },
          {
            kind: "section" as const,
            id: "services",
            heading: "Services",
            children: [
              {
                kind: "section" as const,
                id: "identity",
                heading: "Identity",
                children: [{ kind: "text" as const, text: "Source description" }],
              },
            ],
          },
          {
            kind: "section" as const,
            id: "gallery",
            children: [
              {
                kind: "media" as const,
                storageRef: `webasset:scene:${"a".repeat(64)}`,
                alt: "Source image",
              },
              { kind: "text" as const, text: "Source caption" },
            ],
          },
          {
            kind: "form" as const,
            id: "inquiry",
            fields: ["email" as const],
            consent: "Source consent",
          },
        ],
      },
    ],
  };
  const sections = [
    { pageSlug: "home", nodeId: "intro", composition: "editorial-lead" as const },
    { pageSlug: "home", nodeId: "services", composition: "numbered-services" as const },
    { pageSlug: "home", nodeId: "gallery", composition: "image-caption" as const },
    { pageSlug: "home", nodeId: "inquiry", composition: "contact-panel" as const },
  ];
  const v3 = { ...plan, version: 3 as const, designTokens: tokens, sections };
  expect(validateWebLayoutPlanForDocument(document, v3)).toBe(true);
  expect(JSON.stringify(canonicalWebLayoutPlan({ ...v3, sections: [...sections].reverse() }))).toBe(
    JSON.stringify(canonicalWebLayoutPlan(v3)),
  );
  expect(validateWebLayoutPlanForDocument(document, { ...v3, sections: sections.slice(1) })).toBe(
    false,
  );
});

test("v3 supports source-authorized title-only service without inventing description", () => {
  const document = {
    kind: "site" as const,
    title: "Studio",
    brand: { name: "Studio" },
    navigation: [],
    pages: [
      {
        slug: "home",
        title: "Home",
        nodes: [
          {
            kind: "section" as const,
            id: "services",
            heading: "Practice",
            children: [
              { kind: "section" as const, id: "identity", heading: "Identity", children: [] },
            ],
          },
        ],
      },
    ],
  };
  const v3 = {
    ...plan,
    version: 3 as const,
    designTokens: tokens,
    sections: [{ pageSlug: "home", nodeId: "services", composition: "service-panels" as const }],
  };
  expect(validateWebLayoutPlanForDocument(document, v3)).toBe(true);
  const blankTitle = {
    ...document,
    pages: [
      {
        ...document.pages[0]!,
        nodes: [
          {
            ...document.pages[0]!.nodes[0]!,
            children: [{ kind: "section" as const, id: "identity", heading: " ", children: [] }],
          },
        ],
      },
    ],
  };
  expect(validateWebLayoutPlanForDocument(blankTitle, v3)).toBe(false);
});

test("v3 principles and contact preserve source structure and refuse multiple carousel targets", () => {
  const principles = {
    kind: "section" as const,
    id: "principles",
    children: [1, 2, 3].map((i) => ({
      kind: "section" as const,
      id: `principle-${i}`,
      heading: `Source ${i}`,
      children: [{ kind: "text" as const, text: "Source detail" }],
    })),
  };
  const contact = {
    kind: "section" as const,
    id: "contact",
    heading: "Get in touch",
    children: [
      { kind: "text" as const, text: "Source invitation" },
      {
        kind: "cta" as const,
        id: "contact-link",
        label: "Write to us",
        target: { kind: "https" as const, url: "https://example.com/contact" },
      },
    ],
  };
  const document = {
    kind: "site" as const,
    title: "Studio",
    brand: { name: "Studio" },
    navigation: [],
    pages: [{ slug: "home", title: "Home", nodes: [principles, contact] }],
  };
  const v3 = {
    ...plan,
    version: 3 as const,
    designTokens: tokens,
    sections: [
      { pageSlug: "home", nodeId: "principles", composition: "principles-grid" as const },
      { pageSlug: "home", nodeId: "contact", composition: "contact-copy" as const },
    ],
  };
  expect(validateWebLayoutPlanForDocument(document, v3)).toBe(true);
  expect(
    validateWebLayoutPlanForDocument(
      {
        ...document,
        pages: [
          {
            ...document.pages[0]!,
            nodes: [{ ...principles, children: principles.children.slice(1) }, contact],
          },
        ],
      },
      v3,
    ),
  ).toBe(false);
  const galleries = ["one", "two"].map((id) => ({
    kind: "section" as const,
    id,
    children: [
      {
        kind: "media" as const,
        storageRef: `webasset:scene:${"a".repeat(64)}`,
        alt: "Source image",
      },
    ],
  }));
  const galleryPlan = {
    ...v3,
    sections: galleries.map((node) => ({
      pageSlug: "home",
      nodeId: node.id,
      composition: "image-caption" as const,
    })),
  };
  const galleryDocument = { ...document, pages: [{ ...document.pages[0]!, nodes: galleries }] };
  expect(validateWebLayoutPlanForDocument(galleryDocument, galleryPlan)).toBe(false);
  expect(
    validateWebLayoutPlanForDocument(galleryDocument, { ...galleryPlan, gallery: "grid" }),
  ).toBe(true);
});

test("optional page and heading treatment is source-bound, Unicode-safe and canonical", () => {
  const document = {
    kind: "site" as const,
    title: "Source",
    brand: { name: "Source" },
    navigation: [],
    pages: [
      {
        slug: "home",
        title: "Home",
        nodes: [{ kind: "hero" as const, id: "intro", heading: "Make 😀 good things" }],
      },
    ],
  };
  const treatment = {
    pageSlug: "home",
    nodeId: "intro",
    breakAfter: [8],
    emphasisRanges: [{ start: 8, end: 12, tone: "accent" as const }],
  };
  const selected = {
    ...plan,
    version: 3 as const,
    designTokens: tokens,
    sections: [],
    pagePresentation: [
      {
        pageSlug: "home",
        heroFrame: "wide-inset" as const,
        chrome: "editorial-compact" as const,
        contactSurface: "paper-deep" as const,
      },
    ],
    headingTreatments: [treatment],
  };
  expect(validateWebLayoutPlanForDocument(document, selected)).toBe(true);
  for (const broken of [
    { ...treatment, nodeId: "missing" },
    { ...treatment, breakAfter: [6] },
    { ...treatment, breakAfter: [10] },
    { ...treatment, emphasisRanges: [{ start: 6, end: 12, tone: "accent" }] },
    {
      ...treatment,
      emphasisRanges: [
        { start: 8, end: 12, tone: "accent" },
        { start: 9, end: 15, tone: "muted" },
      ],
    },
    { ...treatment, emphasisRanges: [{ start: 8, end: 999, tone: "accent" }] },
  ])
    expect(
      validateWebLayoutPlanForDocument(document, { ...selected, headingTreatments: [broken] }),
    ).toBe(false);
  expect(
    validateWebLayoutPlan({
      ...selected,
      headingTreatments: [{ ...treatment, text: "Replacement" }],
    }),
  ).toBe(false);
  expect(
    validateWebLayoutPlanForDocument(document, {
      ...selected,
      pagePresentation: [{ ...selected.pagePresentation[0], pageSlug: "missing" }],
    }),
  ).toBe(false);
  const canonical = canonicalWebLayoutPlan(selected);
  const reordered = {
    ...selected,
    headingTreatments: [
      {
        emphasisRanges: [{ tone: "accent" as const, end: 12, start: 8 }],
        breakAfter: [8],
        nodeId: "intro",
        pageSlug: "home",
      },
    ],
  };
  expect(JSON.stringify(canonicalWebLayoutPlan(reordered))).toBe(JSON.stringify(canonical));
  const { designProfile } = materializeWebRecipeWithProvenance("business-site", {
    brandName: "Source",
    headline: "Source",
  });
  const html = renderDesignedWebDocument(document, { ...designProfile, layoutPlan: selected });
  expect(html).toContain('Make 😀 <br><em class="heading-tone-accent">good</em> things');
  expect(html).toContain('data-hero-frame="wide-inset"');
  const { pagePresentation: _presentation, ...headingOnly } = selected;
  const headingOnlyHtml = renderDesignedWebDocument(document, {
    ...designProfile,
    layoutPlan: headingOnly,
  });
  expect(headingOnlyHtml).toContain(
    ".heading-tone-accent{color:var(--accent);font-weight:inherit}",
  );
  expect(headingOnlyHtml).toContain(".heading-tone-muted{color:var(--muted);font-weight:inherit}");
  expect(headingOnlyHtml).toContain('<em class="heading-tone-accent">good</em>');
  expect(headingOnlyHtml).not.toContain("data-page-chrome=");

  expect(JSON.stringify(document)).toContain("Make 😀 good things");
  const legacyHtml = renderDesignedWebDocument(document, {
    ...designProfile,
    layoutPlan: { ...plan, version: 2, designTokens: tokens },
  });
  expect(legacyHtml).not.toContain("data-hero-frame=");
  expect(legacyHtml).not.toContain("heading-tone-accent");
});
