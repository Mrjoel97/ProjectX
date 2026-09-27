import {
  MAX_WEB_DOCUMENT_BYTES,
  WEB_RENDERER_VERSION,
  type WebDocument,
} from "@pikar/contracts/webRuntime";
import { describe, expect, it } from "vitest";
import {
  hashWebDocument,
  renderWebDocument,
  renderWebDocumentBytes,
  validateWebDocument,
} from "./webRuntime";

const siteFixture = (): WebDocument => ({
  kind: "site",
  title: "Acme & Co",
  description: "A <trusted> studio",
  brand: { name: "Acme & Co", primaryColor: "#0f766e" },
  navigation: [
    { label: "Home", path: "/" },
    { label: "Contact", path: "/contact" },
  ],
  pages: [
    {
      slug: "home",
      title: "Welcome",
      nodes: [
        { kind: "hero", heading: "Build <bold>trust</bold>", body: "We make useful things." },
        { kind: "text", text: "A & B" },
        {
          kind: "cta",
          id: "book",
          label: "Book a call",
          target: { kind: "local", path: "/contact" },
          analytics: true,
        },
        {
          kind: "media",
          storageRef: "storage:hero-image",
          alt: "Team at work",
        },
      ],
    },
  ],
  footer: { kind: "footer", text: "© Acme" },
});

const landingFixture = (): WebDocument => ({
  kind: "landing",
  title: "Launch",
  brand: { name: "Launch Co" },
  navigation: [],
  pages: [
    {
      slug: "offer",
      title: "Offer",
      nodes: [
        {
          kind: "form",
          id: "signup",
          heading: "Get updates",
          fields: ["email", "name"],
          consent: "I agree to receive updates from Launch Co.",
        },
      ],
    },
  ],
});

describe("web runtime contract and renderer", () => {
  it("accepts both site and landing documents", () => {
    expect(validateWebDocument(siteFixture())).toEqual({ ok: true, value: siteFixture() });
    expect(validateWebDocument(landingFixture()).ok).toBe(true);
  });

  it("rejects executable content, unsafe URLs, and unbounded documents", () => {
    const hostile = {
      ...siteFixture(),
      pages: [
        {
          ...siteFixture().pages[0],
          nodes: [
            { kind: "html", html: "<script>alert(1)</script>" },
            {
              kind: "cta",
              id: "x",
              label: "x",
              target: { kind: "unsafe", url: "javascript:alert(1)" },
            },
          ],
        },
      ],
    };
    expect(validateWebDocument(hostile).ok).toBe(false);
    expect(validateWebDocument({ ...siteFixture(), title: "x".repeat(1000) }).ok).toBe(false);
    expect(validateWebDocument({ ...siteFixture(), pages: [] }).ok).toBe(false);
  });

  it("escapes text and emits an analytics CTA as a no-JavaScript POST form", () => {
    const html = renderWebDocument(siteFixture(), { slug: "acme", page: "home" });
    expect(html).toContain("&lt;bold&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/p/acme/home/cta/book"');
    expect(html).not.toMatch(/<script|\son[a-z]+\s*=/i);
    expect(html).not.toContain("javascript:");
  });

  it("produces byte-identical UTF-8 output and stable hashes", () => {
    const a = renderWebDocumentBytes(siteFixture(), { slug: "acme", page: "home" });
    const b = renderWebDocumentBytes(siteFixture(), { slug: "acme", page: "home" });
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(hashWebDocument(siteFixture(), { slug: "acme", page: "home" })).toBe(
      hashWebDocument(siteFixture(), { slug: "acme", page: "home" }),
    );
    expect(WEB_RENDERER_VERSION).toMatch(/^web-/);
    expect(a.byteLength).toBeLessThanOrEqual(MAX_WEB_DOCUMENT_BYTES);
  });

  it("changes hash when renderer identity changes", () => {
    const document = siteFixture();
    expect(hashWebDocument(document, "web-v1", { slug: "acme", page: "home" })).not.toBe(
      hashWebDocument(document, "web-v2", { slug: "acme", page: "home" }),
    );
  });

  it("changes the project hash when a secondary page changes", () => {
    const document = {
      ...siteFixture(),
      pages: [
        ...siteFixture().pages,
        { slug: "about", title: "About", nodes: [{ kind: "text" as const, text: "Original" }] },
      ],
    };
    const revised = {
      ...document,
      pages: document.pages.map((page) =>
        page.slug === "about"
          ? { ...page, nodes: [{ kind: "text" as const, text: "Revised" }] }
          : page,
      ),
    };
    expect(hashWebDocument(document)).not.toBe(hashWebDocument(revised));
  });

  it("rejects unsafe form, media, navigation, and duplicate route identifiers", () => {
    const invalid = {
      ...landingFixture(),
      navigation: [{ label: "bad", path: "javascript:alert(1)" }],
      pages: [
        {
          ...landingFixture().pages[0],
          slug: "offer",
          nodes: [
            { kind: "media", storageRef: "https://secret.example/file", alt: "x" },
            { kind: "form", id: "signup", fields: ["name"], consent: "" },
            { kind: "form", id: "signup", fields: ["email"], consent: "yes" },
          ],
        },
        { ...landingFixture().pages[0], slug: "offer", nodes: [{ kind: "text", text: "x" }] },
      ],
    };
    expect(validateWebDocument(invalid).ok).toBe(false);
  });

  it("enforces URL, node, and document byte ceilings", () => {
    const manyLinks = Array.from({ length: 30 }, (_, index) => ({
      label: `Link ${index}`,
      path: `/${index}`,
    }));
    expect(validateWebDocument({ ...landingFixture(), navigation: manyLinks }).ok).toBe(false);
    const deep = {
      kind: "section",
      id: "one",
      children: [
        {
          kind: "section",
          id: "two",
          children: [
            {
              kind: "section",
              id: "three",
              children: [
                {
                  kind: "section",
                  id: "four",
                  children: [
                    { kind: "section", id: "five", children: [{ kind: "text", text: "too deep" }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(
      validateWebDocument({
        ...landingFixture(),
        pages: [{ slug: "offer", title: "Offer", nodes: [deep] }],
      }).ok,
    ).toBe(false);
    expect(validateWebDocument({ ...landingFixture(), description: "x".repeat(5000) }).ok).toBe(
      false,
    );
  });

  it("accepts only inert storefront catalogue presentation and renders its unavailable state", () => {
    const storefront: WebDocument = {
      kind: "storefront",
      title: "Catalogue",
      brand: { name: "Acme" },
      navigation: [],
      pages: [
        {
          slug: "catalogue",
          title: "Catalogue",
          nodes: [
            {
              kind: "catalogue",
              heading: "Our work",
              items: [
                {
                  id: "one",
                  name: "Thing",
                  description: "A thing",
                  displayPriceText: "$10",
                  availabilityLabel: "Ask us",
                },
              ],
            },
          ],
        },
      ],
    };
    expect(validateWebDocument(storefront).ok).toBe(true);
    const html = renderWebDocument(storefront);
    expect(html).toContain("Ordering is unavailable in this presentation-only catalogue.");
    expect(html).not.toMatch(/<script|javascript:|checkout/i);
  });

  it("rejects storefront commerce actions and forbidden catalogue fields", () => {
    const storefront: WebDocument = {
      kind: "storefront",
      title: "Catalogue",
      brand: { name: "Acme" },
      navigation: [],
      pages: [
        {
          slug: "catalogue",
          title: "Catalogue",
          nodes: [
            {
              kind: "catalogue",
              items: [{ id: "one", name: "Buy now", description: "Thing" }],
            },
          ],
        },
      ],
    };
    expect(validateWebDocument(storefront).ok).toBe(false);
    expect(
      validateWebDocument({
        ...storefront,
        pages: [
          {
            ...storefront.pages[0],
            nodes: [
              { kind: "cta", id: "buy", label: "Buy", target: { kind: "local", path: "/buy" } },
            ],
          },
        ],
      }).ok,
    ).toBe(false);
  });
});
