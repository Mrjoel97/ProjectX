import type { WebDocument } from "@pikar/contracts/webRuntime";
import { hasUnsafeWebMarkup, WEB_CAROUSEL_SCRIPT_POLICY } from "@pikar/core/webCarouselRuntime";
import { renderDesignedWebDocument } from "@pikar/core/webDesignRenderer";
import { materializeWebRecipeWithProvenance } from "@pikar/core/webRecipes";
import provenance from "../../../../public/presence-examples/provenance.json";

export const PRESENCE_EXAMPLES = [
  {
    id: "studio",
    title: "Quiet Form",
    kind: "Website",
    style: "Polished minimal",
    image: "/presence-examples/studio.webp",
    description: "Light, materials and a considered studio presence.",
  },
  {
    id: "retreat",
    title: "Stillwater",
    kind: "Landing page",
    style: "Photo-led glass",
    image: "/presence-examples/retreat.webp",
    description: "An immersive campaign with one clear invitation.",
  },
  {
    id: "homeware",
    title: "Soft Form",
    kind: "Shop",
    style: "Soft, sculptural clay",
    image: "/presence-examples/homeware.webp",
    description: "A tactile collection with image-led product details.",
  },
] as const;
export type PresenceExampleId = (typeof PRESENCE_EXAMPLES)[number]["id"];
export const isPresenceExampleId = (id: string): id is PresenceExampleId =>
  PRESENCE_EXAMPLES.some((example) => example.id === id);

function asset(name: string) {
  const entry = provenance.assets.find((candidate) => candidate.name === name);
  if (
    !entry ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    entry.path !== `/presence-examples/${name}.webp`
  )
    throw new Error("EXAMPLE_ASSET_UNAVAILABLE");
  return { ref: `webasset:example_${name}:${entry.sha256}`, path: entry.path };
}

/** Fictional presentation fixtures use the production compiler/renderer. They create no project,
 * registry evidence, provider request or public merchant capability. */
export function buildPresenceExample(id: PresenceExampleId) {
  const hero = asset(id);
  // Material studies are explicitly illustrative, never photographs of a client's work.
  const gallery =
    id === "studio"
      ? [
          {
            name: "homeware",
            alt: "Generated study of sculptural ceramics and warm interior materials",
          },
          {
            name: "bowl",
            alt: "Generated peach ceramic bowl, an illustrative colour and material study",
          },
          {
            name: "vase",
            alt: "Generated cream ceramic vase, an illustrative study of form and proportion",
          },
        ]
      : [];
  const media = {
    hero: {
      storageRef: hero.ref,
      alt: `Generated ${id === "studio" ? "light-filled architectural interior" : id === "retreat" ? "lakeside cabin at dusk" : "sculptural ceramic collection"} illustration`,
      crop: "cover" as const,
      aspect: "landscape" as const,
      focalPoint: { x: id === "retreat" ? 72 : 55, y: 50 },
    },
    ...(gallery.length
      ? {
          gallery: gallery.map(({ name, alt }) => ({
            storageRef: asset(name).ref,
            alt,
            crop: "cover" as const,
            aspect: "landscape" as const,
          })),
        }
      : {}),
  };
  const result =
    id === "studio"
      ? materializeWebRecipeWithProvenance("business-site", {
          brandName: "Quiet Form",
          headline: "Space to feel at home.",
          summary:
            "A fictional architecture and interiors studio exploring light, natural materials and the way we live.",
          services: [
            "Architecture shaped around everyday life.",
            "Interiors with warmth, clarity and room to breathe.",
            "Material direction, from the first sketch to the final detail.",
          ],
          about:
            "Quiet Form begins with a simple question: how should a space feel? This example brings considered proportions, honest materials and a calm point of view together.",
          contactConsent: "I agree to be contacted about my design inquiry.",
          pageMode: "multi-page",
          projectSlug: "example-studio",
          artDirection: "editorial",
          surfaceStyle: "minimal",
          design: { motion: 6 },
          primaryColor: "#344A3E",
          media,
        })
      : id === "retreat"
        ? materializeWebRecipeWithProvenance("campaign-landing", {
            brandName: "Stillwater",
            headline: "A little closer to quiet.",
            offer:
              "A fictional lakeside retreat concept. Slow mornings, forest paths and a warm place to return to.",
            proofPoints: [
              "A private cabin, imagined around the view.",
              "Space for unhurried mornings and evenings by the water.",
            ],
            formConsent: "I agree to be contacted about this retreat inquiry.",
            artDirection: "editorial",
            surfaceStyle: "glass",
            design: { motion: 6 },
            primaryColor: "#D5E8C5",
            media,
          })
        : materializeWebRecipeWithProvenance("storefront-catalogue", {
            brandName: "Soft Form",
            intro:
              "Sculptural pieces for everyday rituals. A fictional collection of ceramic forms, illustrated in soft colour.",
            items: [
              {
                id: "jug",
                name: "The everyday jug",
                description:
                  "A seafoam ceramic jug with a generous handle and a softly rounded silhouette. An illustrated product concept for this example.",
                imageStorageRef: asset("jug").ref,
                displayPriceText: "$48 · example price",
              },
              {
                id: "bowl",
                name: "The gathering bowl",
                description:
                  "A low peach ceramic bowl, imagined for fruit, shared tables and small daily rituals. An illustrated product concept for this example.",
                imageStorageRef: asset("bowl").ref,
                displayPriceText: "$36 · example price",
              },
              {
                id: "vase",
                name: "The quiet vase",
                description:
                  "A cream ceramic vase with a narrow opening and a gentle sculptural profile. An illustrated product concept for this example.",
                imageStorageRef: asset("vase").ref,
                displayPriceText: "$54 · example price",
              },
            ],
            artDirection: "editorial",
            surfaceStyle: "clay",
            design: { motion: 6 },
            primaryColor: "#365447",
            media,
          });
  const document: WebDocument = {
    ...result.document,
    footer: {
      kind: "footer",
      text: "Fictional design example · generated illustrations and sample content. No reservation or purchase is offered.",
    },
  };
  const slug = `example-${id}`;
  const images = [
    hero,
    ...gallery.map(({ name }) => asset(name)),
    ...(id === "homeware" ? [asset("jug"), asset("bowl"), asset("vase")] : []),
  ];
  const pages = document.pages.map((page) => ({
    slug: page.slug,
    title: page.title,
    html: renderDesignedWebDocument(document, result.designProfile, { slug, page: page.slug }),
  }));
  return { document, designProfile: result.designProfile, pages, images };
}

/** Code-owned public demo assets only. Private project previews use their separate authorized path. */
export function examplePresentationHtml(
  html: string,
  images: readonly { ref: string; path: string }[],
  origin: string,
): string {
  if (hasUnsafeWebMarkup(html)) throw new Error("UNSAFE_EXAMPLE_ARTIFACT");
  const host = new URL(origin).origin;
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const image of doc.querySelectorAll("img")) {
    const entry = images.find(
      (candidate) => candidate.ref === image.getAttribute("data-asset-ref"),
    );
    if (!entry || !/^\/presence-examples\/[a-z]+\.webp$/.test(entry.path))
      throw new Error("EXAMPLE_ASSET_MISMATCH");
    image.src = new URL(entry.path, host).href;
  }
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = `default-src 'none'; img-src ${host}; style-src 'unsafe-inline'; ${WEB_CAROUSEL_SCRIPT_POLICY}; connect-src 'none'; form-action 'none'`;
  const base = doc.createElement("base");
  base.target = "_blank";
  doc.head.prepend(policy, base);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
