import { WEB_CAROUSEL_TAG } from "./webCarouselRuntime";
import type {
  WebCatalogueNode,
  WebDocument,
  WebFormNode,
  WebRouteContext,
  WebSectionNode,
} from "@pikar/contracts/webRuntime";
import {
  type DesignKnowledgeBundle,
  type DesignProfileRef,
  validateDesignProfileRef,
  verifiedDesignKnowledgeBundle,
} from "./designKnowledge";
import { webAssetPath } from "./webAssets";
import { canonicalWebLayoutPlan, type WebLayoutPlan } from "./webLayoutPlan";
import {
  canonicalWebDocument,
  escapeWebText,
  renderWebMedia,
  renderWebPageParts,
  sha256Bytes,
} from "./webRuntime";

export const WEB_DESIGN_RENDERER_VERSION = "web-design-renderer-v15" as const;
const encoder = new TextEncoder();

/** The renderer depends on the selected records, not merely the bundle's role labels. */
export function assertDesignProfileSources(
  profile: DesignProfileRef,
  bundle: DesignKnowledgeBundle = verifiedDesignKnowledgeBundle,
): void {
  if (!validateDesignProfileRef(profile) || bundle.bundleHash !== profile.bundleHash)
    throw new Error("WEB_DESIGN_PROFILE_INVALID");
  const selected = [
    [
      profile.patternId,
      profile.patternId === "landing-proof" ? "nexscope-ecommerce" : "ui-ux-pro-max",
    ],
    [profile.styleId, "ui-ux-pro-max"],
    [profile.typographyId, "ui-ux-pro-max"],
    [profile.formProfileId, "ui-ux-pro-max"],
    ["taste-baseline", "taste-skill"],
    [profile.paletteId, "nexscope-ecommerce"],
  ] as const;
  for (const [id, sourceRole] of selected) {
    if (!bundle.records.some((record) => record.id === id && record.sourceRole === sourceRole))
      throw new Error(`WEB_DESIGN_SOURCE_MISSING:${sourceRole}:${id}`);
  }
}

const PALETTES = {
  editorial: {
    paper: "#f4f6fa",
    card: "#ffffff",
    ink: "#162838",
    muted: "#465b6d",
    accent: "#254e72",
    rule: "#bdcbd6",
    hero: "#f4f6fa",
    heroInk: "#162838",
  },
  studio: {
    paper: "#ffffff",
    card: "#fff0f3",
    ink: "#281d29",
    muted: "#64535f",
    accent: "#ad2247",
    rule: "#dbc9d3",
    hero: "#ffffff",
    heroInk: "#281d29",
  },
  technical: {
    paper: "#f1f5f8",
    card: "#ffffff",
    ink: "#152938",
    muted: "#456072",
    accent: "#71e1c2",
    rule: "#bfd0dc",
    hero: "#102331",
    heroInk: "#f1f7fb",
  },
} as const;

function luminance(color: string): number {
  const channels = [1, 3, 5]
    .map((start) => Number.parseInt(color.slice(start, start + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}

export function webColorContrast(foreground: string, background: string): number {
  if (![foreground, background].every((color) => /^#[0-9a-fA-F]{6}$/.test(color)))
    throw new Error("WEB_COLOR_INVALID");
  const light = luminance(foreground);
  const dark = luminance(background);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

/** Validated AST items, not model-authored HTML. No ordering/payment capability is inferred. */
function designedCatalogue(node: WebCatalogueNode, route: WebRouteContext): string {
  return `<section class="catalogue" aria-label="Catalogue presentation">${node.heading ? `<h2>${escapeWebText(node.heading)}</h2>` : ""}<div class="catalogue-items">${node.items.map((item) => `<article data-catalogue-id="${escapeWebText(item.id)}">${item.imageStorageRef ? renderWebMedia({ kind: "media", storageRef: item.imageStorageRef, alt: item.name, aspect: "square", crop: "contain" }, route) : ""}<div class="product-copy"><h3>${escapeWebText(item.name)}</h3>${item.displayPriceText ? `<p class="display-price">${escapeWebText(item.displayPriceText)}</p>` : ""}${item.availabilityLabel ? `<p class="availability">${escapeWebText(item.availabilityLabel)}</p>` : ""}<details><summary>View details</summary><p>${escapeWebText(item.description)}</p></details></div></article>`).join("")}</div><p class="commerce-unavailable">Ordering is unavailable in this presentation-only catalogue.</p></section>`;
}

function designedInquiry(node: WebFormNode, route: WebRouteContext): string {
  const labels = { email: "Email address", name: "Your name", company: "Business name" };
  return `<form id="inquiry-${escapeWebText(node.id)}" method="post" action="/p/${route.slug}/${route.page}/forms/${node.id}"><fieldset><legend>${escapeWebText(node.heading ?? "Start a conversation")}</legend>${node.fields.map((field) => `<label>${labels[field]}<input name="${field}" type="${field === "email" ? "email" : "text"}" autocomplete="${field === "company" ? "organization" : field}"${field === "email" ? " required" : ""}></label>`).join("")}<label><input name="consent" type="checkbox" required> ${escapeWebText(node.consent)}</label><button type="submit">Send inquiry</button></fieldset></form>`;
}

/** Approved media with a single immutable first-party carousel runtime. */
function designedGallery(node: WebSectionNode, route: WebRouteContext, plan?: WebLayoutPlan): string | undefined {
  if (node.id !== "gallery" || !node.children.every((child) => child.kind === "media"))
    return undefined;
  const images = node.children.filter((child) => child.kind === "media");
  const carousel = images.length >= 3 && images.length <= 6 && plan?.gallery !== "grid";
  const label = node.heading ?? "Gallery";
  const slides = images.map((image, index) => `<li id="gallery-image-${index + 1}" class="gallery-slide" aria-label="Image ${index + 1} of ${images.length}">${renderWebMedia(image, route)}<p class="gallery-caption">${escapeWebText(image.alt)}</p></li>`).join("");
  const controls = carousel ? '<div class="gallery-controls" aria-label="Gallery controls"><button type="button" data-gallery-previous aria-label="Previous image">←</button><button type="button" data-gallery-next aria-label="Next image">→</button></div>' : '';
  return `<section id="gallery" class="designed-gallery${carousel ? " gallery-carousel" : ""}" aria-labelledby="gallery-heading"><div class="gallery-heading"><h2 id="gallery-heading">${escapeWebText(label)}</h2>${carousel ? '<p id="gallery-help">Images move automatically. Focus or hover to pause; press Space to pause or resume.</p>' : ""}</div><div class="gallery-viewport"${carousel ? ' tabindex="0" role="region" aria-roledescription="carousel" aria-label="Gallery images" aria-describedby="gallery-help"' : ''}><ul class="gallery-track">${slides}</ul></div>${controls}</section>`;

}

/** Closed Pikar-owned art direction, informed by reviewed Taste guidance. The pinned source
 * bundle is provenance, not executable prompts or a claim of an upstream design system. */
export function renderDesignedWebDocument(
  document: WebDocument,
  profile: DesignProfileRef,
  route?: WebRouteContext,
): string {
  assertDesignProfileSources(profile);
  const parts = renderWebPageParts(document, route);
  const direction = profile.artDirection ?? "editorial";
  const surfaceStyle = profile.surfaceStyle ?? "minimal";
  const layoutPlan = profile.layoutPlan;
  const designTokens = layoutPlan?.version === 2 ? layoutPlan.designTokens : undefined;
  const innerPage = !!designTokens && parts.page.slug !== parts.document.pages[0]?.slug;
  const baseColors = designTokens ? { ...designTokens.colors, hero: designTokens.colors.paper, heroInk: designTokens.colors.ink } : PALETTES[direction];
  const colors =
    !designTokens && surfaceStyle === "glass"
      ? { ...baseColors, paper: "#f3f6f4", card: "#e7eeea", ink: "#163a34", muted: "#375b54" }
      : !designTokens && surfaceStyle === "clay"
        ? { ...baseColors, paper: "#f8f4ee", card: "#efe8df", ink: "#303d36", muted: "#536458" }
        : baseColors;
  const accent = parts.document.brand.primaryColor ?? colors.accent;
  const buttonInk =
    webColorContrast("#000000", accent) >= webColorContrast("#ffffff", accent)
      ? "#000000"
      : "#ffffff";
  const linkInk = webColorContrast(accent, colors.paper) >= 4.5 ? accent : colors.ink;
  const buttonEdge =
    surfaceStyle === "glass"
      ? Math.min(webColorContrast(accent, "#153b36"), webColorContrast(accent, "#293d39")) >= 3
        ? "transparent"
        : "#ffffff"
      : Math.min(webColorContrast(accent, colors.paper), webColorContrast(accent, colors.card)) >= 3
        ? "transparent"
        : colors.ink;
  const spacing = 36 - profile.dials.density * 2;
  const width = designTokens?.spacing.contentWidth ?? (1180 + (profile.dials.variance - 5) * 18);
  const motion = profile.dials.motion <= 2 || layoutPlan?.motion === "none" ? 0 : profile.dials.motion * 12;
  const hoverTransform = motion === 0 ? "none" : "translateY(-2px)";
  const radius = surfaceStyle === "clay" ? 24 : 0;
  const copyMeasure = profile.patternId === "hero-features-cta" ? "700px" : "100%";
  const controlHeight = profile.formProfileId === "forms-first" ? 44 : 40;
  const tokenFonts = { "editorial-serif": 'Georgia,"Times New Roman",serif', "modern-serif": '"Palatino Linotype",Palatino,Georgia,serif', "humanist-sans": '"Segoe UI",Calibri,Arial,sans-serif', "geometric-sans": '"Century Gothic",Futura,Arial,sans-serif' };
  const heading = designTokens ? tokenFonts[designTokens.typography.heading] :
    direction === "editorial"
      ? 'Georgia,"Times New Roman",serif'
      : direction === "studio"
        ? '"Arial Black",Arial,sans-serif'
        : "Arial,Helvetica,sans-serif";
  const hero = parts.nodes.find((entry) => entry.node.kind === "hero");
  const inquiry = parts.nodes.find((entry) => entry.node.kind === "form");
  const contactPage = parts.document.pages.find((page) =>
    page.nodes.some((node) => node.kind === "form"),
  );
  const catalogue = parts.nodes.find((entry) => entry.node.kind === "catalogue");
  const entryHtml = (entry: (typeof parts.nodes)[number]) =>
    entry.node.kind === "catalogue"
      ? designedCatalogue(entry.node, parts.route)
      : entry.node.kind === "form"
        ? designedInquiry(entry.node, parts.route)
        : entry.node.kind === "section"
          ? (designedGallery(entry.node, parts.route, layoutPlan) ?? (innerPage && entry.node.id === "services" && hero?.node.kind === "hero" && entry.node.heading === hero.node.heading ? entry.html.replace(`<h2>${escapeWebText(entry.node.heading)}</h2>`, "") : entry.html))
          : entry.html;
  const heroIndex = hero ? parts.nodes.indexOf(hero) : -1;
  const cta = hero
    ? parts.nodes.slice(heroIndex + 1).find((entry) => entry.node.kind === "cta")
    : undefined;
  const rail = hero
    ? (parts.nodes.find(
        (entry) =>
          entry.node.kind === "media" && entry.node.placement === "hero" && entry.html.length > 0,
      ) ??
      parts.nodes.find((entry) => entry.node.kind === "form") ??
      (!innerPage && direction === "studio"
        ? parts.nodes.find((entry) => entry.node.kind === "section" && entry.node.id === "services")
        : undefined) ??
      (!innerPage && direction === "technical"
        ? parts.nodes.find((entry) => entry.node.kind === "section" && entry.node.id === "proof")
        : undefined))
    : undefined;
  const heroLength = hero?.node.kind === "hero" ? hero.node.heading.length : 0;
  const headlineSize = heroLength > 100 ? "3.6rem" : heroLength > 65 ? "4.4rem" : "5.8rem";
  const content = parts.nodes
    .filter((entry) => entry !== hero && entry !== cta && entry !== rail)
    .map(
      (entry) =>
        `<div class="content-block node-${entry.node.kind}"${entry === catalogue ? ' id="pikar-collection"' : ""}>${entryHtml(entry)}</div>`,
    )
    .join("");
  const heroHtml = hero
    ? `<div class="hero-composition${rail ? " has-rail" : ""}${rail?.node.kind === "media" ? " has-media" : ""}"><div class="hero-copy">${hero.html}${cta ? `<div class="hero-action">${cta.html}</div>` : inquiry?.node.kind === "form" && rail !== inquiry ? `<div class="hero-action"><a class="cta" href="#inquiry-${escapeWebText(inquiry.node.id)}">Get in touch</a></div>` : !inquiry && contactPage && contactPage.slug !== parts.page.slug ? `<div class="hero-action"><a class="cta" href="/p/${parts.route.slug}/${contactPage.slug}">Get in touch</a></div>` : catalogue ? '<div class="hero-action"><a class="cta" href="#pikar-collection">Explore the collection</a></div>' : ""}</div>${rail ? `<div class="hero-rail${rail.node.kind === "media" ? " hero-visual" : ""}">${entryHtml(rail)}</div>` : ""}</div>`
    : "";
  const home = `/p/${parts.route.slug}/${parts.document.pages[0]?.slug ?? parts.route.page}`;
  const brand = escapeWebText(parts.document.brand.name);
  const logoSrc = parts.document.brand.logo
    ? webAssetPath(parts.document.brand.logo.storageRef, parts.route.slug)
    : null;
  const logoHtml =
    logoSrc && parts.document.brand.logo
      ? `<img class="brand-logo" src="${escapeWebText(logoSrc)}" alt="${escapeWebText(parts.document.brand.logo.alt)}" data-webasset-ref="${escapeWebText(parts.document.brand.logo.storageRef)}" data-asset-ref="${escapeWebText(parts.document.brand.logo.storageRef)}" decoding="async">`
      : "";
  const footnote = parts.document.footer
    ? `<p>${escapeWebText(parts.document.footer.text)}</p>`
    : "";
  const css = `:root{color-scheme:light;--paper:${colors.paper};--card:${colors.card};--ink:${colors.ink};--muted:${colors.muted};--accent:${accent};--button-ink:${buttonInk};--link:${linkInk};--rule:${colors.rule};--space:${spacing}px;--measure:${width}px;--radius:${radius}px;--copy-measure:${copyMeasure};--control-height:${controlHeight}px;--hero:${colors.hero};--hero-ink:${colors.heroInk};--heading:${heading}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:400 1rem/1.6 system-ui,sans-serif;overflow-wrap:anywhere}a{color:var(--link);text-underline-offset:.25em}button,input,textarea,select{font:inherit;min-height:var(--control-height)}img,input,textarea,select{max-width:100%}img:not([src]){display:none}button,.cta{display:inline-flex;justify-content:center;align-items:center;min-height:48px;padding:.8rem 1.4rem;border:2px solid var(--ink);border-radius:var(--radius);background:var(--accent);color:var(--button-ink);font-weight:700;text-decoration:none;line-height:1.25;max-width:100%}button{cursor:pointer}button:active,.cta:active{transform:translateY(1px)}a,button{transition:transform ${motion}ms ease}a:hover,button:hover{transform:${hoverTransform}}:focus-visible{outline:3px solid #000000;outline-offset:3px;box-shadow:0 0 0 3px #ffffff}.skip-link{position:absolute;left:20px;top:-100px;background:var(--card);padding:12px;z-index:2}.skip-link:focus{top:12px}.site-header,main,.site-footer{max-width:var(--measure);margin-inline:auto;padding-inline:32px}.site-header{padding-block:20px;display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{display:flex;align-items:center;gap:12px;color:inherit;font-size:1.2rem;letter-spacing:-.04em;font-weight:800;text-decoration:none;max-width:36ch;min-height:44px}.site-header nav ul,.site-footer nav ul{list-style:none;display:flex;gap:8px 26px;padding:0;margin:0;flex-wrap:wrap}.site-header nav a{display:inline-flex;align-items:center;min-height:44px;min-width:44px;color:inherit;font-size:.94rem;font-weight:600;text-decoration:none}.site-header nav a:hover,.site-header nav a[aria-current=page]{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:.45em}main>*{min-width:0}.hero-composition{display:grid;grid-template-columns:minmax(0,1fr);gap:calc(var(--space)*2.5);padding:56px 0 64px;align-items:center}.hero-copy,.hero-rail{min-width:0}.hero-copy{max-width:var(--copy-measure)}.hero{padding:0;background:transparent}.hero h1{margin:0;font-family:var(--heading);font-weight:${direction === "editorial" ? 400 : 700};font-size:clamp(2.15rem,6vw,${headlineSize});line-height:1.04;letter-spacing:${direction === "editorial" ? "-.045em" : "-.055em"};max-width:${direction === "editorial" ? "20ch" : "19ch"};text-wrap:balance}.hero p:not(.eyebrow){margin:26px 0 0;max-width:55ch;font-size:1.13rem;line-height:1.65;color:inherit}.eyebrow{font-size:1rem;margin:0 0 20px}.hero-action{margin-top:30px}.hero-action form{margin:0;padding:0;background:transparent;border:0}.hero-rail{padding:28px;background:var(--card);border:0;border-radius:var(--radius);color:var(--ink)}.hero-rail h2{font-size:1.4rem;margin-top:0}.hero-rail p{margin:0;padding:14px 0}h2,h3{font-family:var(--heading);line-height:1.2;letter-spacing:-.03em}h2{font-size:clamp(1.7rem,3.2vw,2.6rem);margin:0 0 28px}p{max-width:65ch}.content-flow{display:grid;gap:0}.content-block{padding:calc(var(--space)*2) 0;border-top:0}.content-block>section{min-width:0}.content-block>p{font-size:1.2rem;margin:0}.content-block #services>p{margin:0;padding:18px 0;max-width:none}#about>p{font-size:1.25rem;line-height:1.65;margin:0}#proof>p{padding:4px 0;margin:22px 0}.node-form{max-width:760px}.hero-rail form{margin:0}fieldset{margin:0;padding:0;border:0;min-width:0}legend{font-family:var(--heading);font-size:1.7rem;padding:0;margin-bottom:18px}label{display:block;margin:14px 0;color:var(--ink);font-size:.95rem;font-weight:600}input:not([type=checkbox]){display:block;width:100%;margin-top:7px;padding:.65rem .8rem;background:#ffffff;color:#152938;border:1px solid #617181;border-radius:var(--radius)}label:has(input[type=checkbox]){display:flex;align-items:flex-start;gap:10px;font-size:.9rem;line-height:1.6;font-weight:400}input[type=checkbox]{min-height:0;width:18px;height:18px;flex:0 0 18px;margin:4px 0;accent-color:var(--link)}.brand-logo{height:40px;width:auto;max-width:140px;object-fit:contain}.web-media{position:relative;margin:0;overflow:hidden;min-width:0}.web-media img{position:absolute;inset:0;display:block;max-width:100%}.hero-rail.hero-visual{padding:0;background:transparent;transform:none}.hero-visual .web-media{width:100%}#gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}#gallery>h2{grid-column:1/-1}.catalogue-items{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.catalogue-items article{padding:24px;border:0;border-radius:var(--radius)}.catalogue-items h3{margin-top:0}.commerce-unavailable{font-size:.95rem;margin-top:24px}.site-footer{padding-block:48px 32px;margin-top:32px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px 48px;align-items:end}.footer-brand{color:inherit;font-family:var(--heading);font-weight:700;font-size:clamp(2rem,5vw,4rem);line-height:1.1;letter-spacing:-.045em;text-decoration:none;max-width:24ch;min-width:0}.site-footer nav a{display:inline-flex;align-items:center;min-height:44px;min-width:44px;color:inherit;font-size:1rem}.site-footer p{grid-column:1/-1;font-size:.95rem;margin:0}.node-text>p{max-width:65ch}
body[data-art-direction=editorial] .hero-composition.has-rail{grid-template-columns:minmax(0,1.3fr) minmax(300px,.7fr)}body[data-art-direction=editorial] .hero-composition.has-media{grid-template-columns:minmax(0,1fr);gap:32px;padding-top:36px}body[data-art-direction=editorial] .has-media .hero-copy{max-width:100%;display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);column-gap:64px;align-items:start}body[data-art-direction=editorial] .has-media .hero{display:contents}body[data-art-direction=editorial] .has-media h1{grid-column:1;grid-row:1/3;font-size:clamp(3rem,5.5vw,5.3rem)}body[data-art-direction=editorial] .has-media .hero p{grid-column:2;margin:8px 0 0}body[data-art-direction=editorial] .has-media .hero-action{grid-column:2;margin-top:24px}body[data-art-direction=editorial] .has-media .hero-visual{width:100%}body[data-art-direction=editorial] #services{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 48px}body[data-art-direction=editorial] #services>h2{grid-column:1/-1}body[data-art-direction=editorial] #services>p{font-family:var(--heading);font-size:1.65rem;line-height:1.4;max-width:30ch}body[data-art-direction=editorial] #about{padding:40px;background:var(--card);display:grid;grid-template-columns:minmax(0,.6fr) minmax(0,1.4fr);gap:24px 48px}body[data-art-direction=editorial] #about>h2{margin:0}body[data-art-direction=editorial] #about>p{font-size:1.5rem;line-height:1.5}
body[data-art-direction=studio] .hero-composition.has-rail{grid-template-columns:minmax(0,1.35fr) minmax(0,.65fr);gap:48px;align-items:center}body[data-art-direction=studio] .hero-composition.has-media{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}body[data-art-direction=studio] .hero-composition.has-media h1{font-size:clamp(2.6rem,4.8vw,4.8rem)}body[data-art-direction=studio] .hero-rail:not(.hero-visual){padding:32px;background:var(--card)}body[data-art-direction=studio] #services{display:grid;grid-template-columns:minmax(0,.65fr) minmax(0,1.35fr);column-gap:48px}body[data-art-direction=studio] #services>h2{grid-row:1/12}body[data-art-direction=studio] #services>p{font-size:clamp(1.3rem,2.4vw,2rem);line-height:1.4;padding:0 0 24px}body[data-art-direction=studio] .hero-rail #services{display:block}body[data-art-direction=studio] .hero-rail #services>h2{margin-bottom:16px}body[data-art-direction=studio] .hero-rail #services>p{font-size:1.1rem;line-height:1.5;padding:12px 0}body[data-art-direction=studio] #about{background:var(--card);padding:44px}body[data-art-direction=studio] #about>p{font-size:clamp(1.25rem,2.1vw,1.75rem);max-width:52ch}body[data-art-direction=studio] #gallery{grid-template-columns:minmax(0,1fr)}body[data-art-direction=studio] .site-footer{background:var(--ink);color:var(--paper)}
body[data-art-direction=technical] .site-header{background:var(--hero);color:var(--hero-ink)}body[data-art-direction=technical] .hero-composition{background:var(--hero);color:var(--hero-ink);padding:44px 32px;margin:20px 0 0}body[data-art-direction=technical] .hero-composition.has-rail{grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:36px}body[data-art-direction=technical] .hero h1{font-size:clamp(2.1rem,4.5vw,${headlineSize});font-weight:700}body[data-art-direction=technical] .hero-action button{border-color:var(--accent)}body[data-art-direction=technical] #services{display:grid;grid-template-columns:minmax(0,.65fr) minmax(0,1.35fr);gap:0 32px}body[data-art-direction=technical] #services>h2{grid-row:1/12}body[data-art-direction=technical] #services>p{font-size:1.2rem}body[data-art-direction=technical] #about{padding:36px;background:var(--card)}body[data-art-direction=technical] #about>p{font-size:1.3rem;max-width:62ch}body[data-art-direction=technical] .site-footer{background:var(--hero);color:var(--hero-ink)}
@media(min-width:768px) and (max-width:1000px){body[data-art-direction=editorial] .hero-composition.has-rail,body[data-art-direction=studio] .hero-composition.has-rail,body[data-art-direction=technical] .hero-composition.has-rail{grid-template-columns:minmax(0,1fr)}.hero h1{max-width:24ch;font-size:clamp(2.4rem,5vw,4rem)}body[data-art-direction=editorial] .has-media .hero-copy{column-gap:32px}body[data-art-direction=editorial] .has-media h1{font-size:clamp(2.6rem,5.2vw,3.8rem)}body[data-art-direction=studio] .hero-composition.has-media{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px}body[data-art-direction=studio] .hero-composition.has-media h1{font-size:clamp(2.4rem,4vw,3rem)}.site-footer{grid-template-columns:minmax(0,1fr)}.site-footer nav ul{gap:8px 22px}}
@media(max-width:767px){.site-header,main,.site-footer{padding-inline:20px}.site-header{padding-block:16px;align-items:flex-start;flex-direction:column;gap:8px}.site-header nav ul{gap:8px 20px}.site-header nav a{font-size:.94rem}.hero-composition{padding:32px 0 40px;gap:24px}.hero h1{font-size:clamp(2rem,10vw,3.3rem);max-width:100%}.hero p:not(.eyebrow){font-size:1rem;margin-top:20px}.hero-action{margin-top:24px}.hero-rail{padding:22px}.content-block{padding:30px 0}.site-footer{grid-template-columns:minmax(0,1fr);padding-block:32px 24px;margin-top:20px;gap:24px}.footer-brand{font-size:clamp(2rem,10vw,3rem)}.site-footer nav ul{gap:8px 20px}.catalogue-items{grid-template-columns:1fr}.brand-logo{max-width:110px;height:36px}body[data-art-direction=editorial] .hero-composition.has-rail,body[data-art-direction=studio] .hero-composition.has-rail,body[data-art-direction=technical] .hero-composition.has-rail{grid-template-columns:minmax(0,1fr)}body[data-art-direction=editorial] .has-media .hero-copy{display:block}body[data-art-direction=editorial] .has-media .hero{display:block}body[data-art-direction=editorial] .has-media h1{font-size:clamp(2rem,10vw,3.3rem)}body[data-art-direction=editorial] .has-media .hero p{margin-top:20px}body[data-art-direction=editorial] .hero-composition.has-media{padding-top:32px;gap:28px}body[data-art-direction=editorial] #services,body[data-art-direction=studio] #services,body[data-art-direction=technical] #services{display:block}body[data-art-direction=editorial] #services>p{font-size:1.4rem;padding:10px 0}body[data-art-direction=studio] #services>p{font-size:1.35rem;padding-bottom:20px}body[data-art-direction=editorial] #about,body[data-art-direction=studio] #about,body[data-art-direction=technical] #about{padding:24px;display:block}body[data-art-direction=editorial] #about>h2{margin-bottom:24px}body[data-art-direction=editorial] #about>p,body[data-art-direction=studio] #about>p,body[data-art-direction=technical] #about>p{font-size:1.15rem}body[data-art-direction=studio] .hero-composition.has-media{gap:24px}body[data-art-direction=studio] .hero-composition.has-media h1{font-size:clamp(2rem,10vw,3.3rem)}body[data-art-direction=technical] .hero-composition{padding:28px 22px;margin-top:12px}#gallery{grid-template-columns:1fr;gap:20px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}*:not(.gallery-track),*:before,*:after{transform:none!important}}`;
  // Styles are closed, code-owned compositions. Glass has a readable opaque fallback;
  // the optional blur never supplies contrast. Clay is confined to tactile objects/controls.
  const surfaceCss = `
body[data-surface-style=minimal] .site-header{padding-block:28px}
body[data-surface-style=minimal] .hero-composition.has-media{position:relative;isolation:isolate;display:flex;align-items:center;min-height:680px;padding:64px;margin-block:12px 0;overflow:hidden;background:#202925}
body[data-surface-style=minimal] .hero-composition.has-media:before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,rgba(0,0,0,.74) 0%,rgba(0,0,0,.64) 55%,rgba(0,0,0,.12) 100%)}
body[data-surface-style=minimal] .has-media .hero-rail.hero-visual{position:absolute;inset:0;z-index:-2;width:100%;height:100%;padding:0}
body[data-surface-style=minimal] .hero-visual .web-media{width:100%;height:100%;aspect-ratio:auto!important}
body[data-surface-style=minimal] .has-media .hero-copy{display:block;width:min(100%,640px);max-width:var(--copy-measure);color:#ffffff}
body[data-surface-style=minimal] .has-media .hero{display:block;background:transparent;color:inherit}
body[data-surface-style=minimal] .has-media .hero h1{font-size:clamp(3rem,5.8vw,5.5rem);max-width:14ch;color:#ffffff}
body[data-surface-style=minimal] .has-media .hero p{font-size:1.05rem;line-height:1.65;max-width:42ch;margin-top:24px;color:#ffffff}
body[data-surface-style=minimal] .has-media .hero-action{margin-top:28px}
body[data-surface-style=minimal] .has-media .hero-action button,body[data-surface-style=minimal] .has-media .hero-action .cta{border-color:#ffffff}
body[data-surface-style=minimal] .content-block{padding-block:calc(var(--space)*2.5)}
body[data-surface-style=minimal] #gallery{gap:32px}
body[data-surface-style=minimal] .site-footer{padding-block:64px 40px}
body[data-surface-style=minimal] .footer-brand{font-weight:400;font-size:clamp(2.8rem,6.8vw,6rem)}
body[data-surface-style=glass]{--paper:#f3f6f4;--card:#e7eeea;--ink:#163a34;--muted:#375b54}
body[data-surface-style=glass] .site-header{background:transparent;color:var(--ink);padding-block:24px}
body[data-surface-style=glass] .hero-composition.has-media{position:relative;isolation:isolate;display:flex;align-items:center;min-height:650px;padding:48px;margin:12px 0 0;overflow:hidden;background:#153b36;border-radius:28px}
body[data-surface-style=glass] .has-media .hero-rail.hero-visual{position:absolute;inset:0;z-index:-1;width:100%;height:100%;padding:0}
body[data-surface-style=glass] .has-media .hero-visual .web-media{width:100%;height:100%;aspect-ratio:auto!important}
body[data-surface-style=glass] .has-media .hero-copy{display:block;width:min(100%,590px);max-width:var(--copy-measure);padding:40px;background:#153b36;color:#ffffff;border-radius:22px}
body[data-surface-style=glass] .has-media .hero{display:block;background:transparent;color:inherit}
body[data-surface-style=glass] .has-media .hero h1{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:clamp(2.65rem,4.8vw,4.8rem);line-height:1.04;max-width:17ch;letter-spacing:-.045em}
body[data-surface-style=glass] .has-media .hero p{margin:24px 0 0;font-size:1.05rem;line-height:1.6;max-width:42ch;color:#ffffff}
body[data-surface-style=glass] .has-media .hero-action{margin-top:28px}
body[data-surface-style=glass] .has-media .hero-action button,body[data-surface-style=glass] .has-media .hero-action .cta{border-color:${buttonEdge};border-radius:100px}
body[data-surface-style=glass] .node-form{max-width:none;padding:40px;background:var(--card);margin-block:48px;border-radius:24px}
body[data-surface-style=glass] .node-form>form{max-width:600px;margin:auto}
body[data-surface-style=glass] #proof{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 48px}
body[data-surface-style=glass] #proof>h2{grid-column:1/-1}
body[data-surface-style=glass] #proof>p{font-size:1.4rem;line-height:1.45;margin:0;padding:0}
body[data-surface-style=glass] .site-footer{background:transparent;color:var(--ink);padding-block:48px}
body[data-surface-style=clay]{--paper:#f8f4ee;--card:#efe8df;--ink:#303d36;--muted:#536458}
body[data-surface-style=clay] .site-header{background:transparent;color:var(--ink);padding-block:28px}
body[data-surface-style=clay] .hero-composition.has-media{position:relative;isolation:isolate;display:flex;align-items:flex-start;min-height:680px;padding:56px;gap:0;overflow:hidden;border-radius:28px;background:#303d36;color:#ffffff;margin:0}
body[data-surface-style=clay] .has-media .hero-rail.hero-visual{position:absolute;inset:0;z-index:-2;width:100%;height:100%;padding:0;border-radius:0}
body[data-surface-style=clay] .has-media .hero-visual .web-media{width:100%;height:100%;aspect-ratio:auto!important}
body[data-surface-style=clay] .has-media .hero-copy{position:relative;z-index:0;display:block;width:min(100%,680px);max-width:var(--copy-measure);margin-inline:auto;text-align:center}
body[data-surface-style=clay] .has-media .hero-copy:before{content:"";position:absolute;inset:-64px -50vw -100px;z-index:-1;background:linear-gradient(180deg,rgba(0,0,0,.72) 0%,rgba(0,0,0,.68) calc(100% - 100px),rgba(0,0,0,0) 100%);pointer-events:none}
body[data-surface-style=clay] .has-media .hero{display:block;background:transparent;color:inherit}
body[data-surface-style=clay] .hero h1{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:clamp(2.6rem,5vw,5.1rem);max-width:14ch;letter-spacing:-.045em}
body[data-surface-style=clay] .has-media .hero h1{margin-inline:auto}
body[data-surface-style=clay] .has-media .hero p{margin:24px auto 0;font-size:1.05rem;line-height:1.6;max-width:43ch;color:inherit}
body[data-surface-style=clay] .has-media .hero-action button,body[data-surface-style=clay] .has-media .hero-action .cta{border-color:#ffffff}
body[data-surface-style=clay] .catalogue-items{gap:28px;align-items:start}
body[data-surface-style=clay] .catalogue-items article{padding:0;background:transparent;overflow:visible}
.catalogue-items .web-media{width:100%;background:var(--card)}
body[data-surface-style=clay] .catalogue-items .web-media{border-radius:28px;box-shadow:inset 0 2px 3px #ffffff,0 12px 28px #303d3612;overflow:hidden}
.product-copy{padding:24px 0}
.product-copy h3{font-family:var(--heading);font-size:1.5rem;font-weight:500;margin:0}
.product-copy .display-price{font-size:1.15rem;margin:8px 0 16px;font-variant-numeric:tabular-nums}
.product-copy details{margin-top:16px}
.product-copy summary{display:inline-flex;align-items:center;min-height:44px;cursor:pointer;font-weight:600;text-decoration:underline;text-underline-offset:.3em}
.product-copy details>p{line-height:1.65;margin:16px 0 0}
body[data-surface-style=clay] button,body[data-surface-style=clay] .cta{border-color:${buttonEdge};box-shadow:inset 0 2px 2px #ffffff55,0 6px 12px #303d3615}
body[data-surface-style=clay] .site-footer{background:transparent;color:var(--ink);padding-block:48px}
body[data-surface-style=clay] .footer-brand{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:clamp(3rem,7vw,6rem)}
@supports(backdrop-filter:blur(20px)){body[data-surface-style=glass] .has-media .hero-copy{background:rgba(12,35,30,.88);backdrop-filter:blur(20px)}}
@media(max-width:1000px){body[data-surface-style=minimal] .hero-composition.has-media{padding:44px;min-height:620px}body[data-surface-style=minimal] .has-media .hero h1{font-size:clamp(2.8rem,5.8vw,4.5rem)}body[data-surface-style=glass] .hero-composition.has-media{padding:32px;min-height:600px}body[data-surface-style=glass] .has-media .hero-copy{max-width:540px;padding:32px}body[data-surface-style=clay] .hero-composition.has-media{padding:44px 40px;min-height:620px}body[data-surface-style=clay] .hero h1{font-size:clamp(2.6rem,5vw,3.8rem)}}
@media(max-width:767px){body[data-surface-style=minimal] .hero-composition.has-media{padding:220px 24px 32px;min-height:620px;align-items:flex-end}body[data-surface-style=minimal] .hero-composition.has-media:before{background:rgba(0,0,0,.64)}body[data-surface-style=minimal] .has-media .hero h1{font-size:clamp(2.3rem,10vw,3.4rem);max-width:17ch}body[data-surface-style=minimal] .has-media .hero p{font-size:1rem;margin-top:20px}body[data-surface-style=minimal] .site-header{padding-block:20px}body[data-surface-style=minimal] .content-block{padding-block:32px}body[data-surface-style=minimal] .site-footer{padding-block:40px 28px}body[data-surface-style=glass] .hero-composition.has-media{padding:180px 16px 16px;align-items:flex-end;min-height:650px;border-radius:20px}body[data-surface-style=glass] .has-media .hero-copy{padding:26px 24px;width:100%;border-radius:16px}body[data-surface-style=glass] .has-media .hero h1{font-size:clamp(2rem,9vw,3rem);max-width:17ch}body[data-surface-style=glass] .has-media .hero p{font-size:1rem;margin-top:20px}body[data-surface-style=glass] .has-media .hero-action{margin-top:22px}body[data-surface-style=glass] #proof{grid-template-columns:1fr;gap:24px}body[data-surface-style=glass] #proof>p{font-size:1.25rem}body[data-surface-style=glass] .node-form{padding:24px;margin-block:24px}body[data-surface-style=clay] .hero-composition.has-media{padding:32px 24px;min-height:620px;gap:0}body[data-surface-style=clay] .hero h1{font-size:clamp(2.4rem,10vw,3.6rem);max-width:17ch}body[data-surface-style=clay] .has-media .hero-visual{border-radius:0}body[data-surface-style=clay] .has-media .hero p{font-size:1rem;margin-top:20px}body[data-surface-style=clay] .has-media .hero-action{margin-top:22px}.catalogue-items .product-copy{padding-bottom:8px}body[data-surface-style=clay] .catalogue-items{gap:32px}}
`;
  // ponytail: native CSS keeps this fixed motion vocabulary script-free. Unrecognized view
  // timelines retain the complete static page; richer scroll scenes need a separate runtime decision.
  // Copy never fades out, and layout, visibility and action availability never depend on animation.
  const galleryCss = `
h2,h3{text-wrap:balance}p{text-wrap:pretty}.hero p:not(.eyebrow){max-width:48ch}
#gallery.designed-gallery{display:block}.gallery-heading{display:flex;align-items:baseline;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:28px}.gallery-heading h2{margin:0;max-width:24ch}.gallery-heading p{margin:0;max-width:40ch}
.gallery-track{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px;min-width:0}.gallery-slide{min-width:0;scroll-margin-block:24px}.gallery-caption{margin:16px 0 0;font-size:1rem;line-height:1.5;max-width:52ch}.gallery-carousel .gallery-track{display:flex;overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x proximity;scroll-behavior:smooth;gap:28px;padding-bottom:16px;scrollbar-width:thin}.gallery-carousel .gallery-slide{flex:0 0 calc((100% - 28px)/2);scroll-snap-align:start;scroll-snap-stop:normal}.gallery-track .web-media{aspect-ratio:4/3!important}.gallery-carousel .web-media{height:260px;aspect-ratio:auto!important}.gallery-carousel .web-media img{height:100%;width:100%;object-fit:cover}.gallery-viewport{min-width:0}.gallery-carousel.is-ready .gallery-viewport{overflow:hidden}.gallery-carousel.is-ready .gallery-track{overflow:visible;scroll-snap-type:none;will-change:transform}.gallery-controls{visibility:hidden}.gallery-carousel.is-ready .gallery-controls{visibility:visible}.gallery-controls{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}.gallery-controls button{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;background:var(--card);color:var(--ink);text-decoration:none;border:1px solid currentColor}.gallery-controls button:hover,.gallery-controls button:focus-visible{background:var(--ink);color:var(--paper)}
@media(max-width:767px){.gallery-carousel .web-media{height:220px}.gallery-track{grid-template-columns:1fr;gap:24px}.gallery-carousel .gallery-slide{flex-basis:100%}.gallery-carousel .gallery-track{gap:16px}.gallery-heading{gap:12px}.gallery-heading p{font-size:1rem}}
@media(prefers-reduced-motion:reduce){.gallery-carousel .gallery-track{scroll-behavior:auto;scroll-snap-type:none}}
`;
  const layoutCss = layoutPlan ? `
body[data-layout-spacing=relaxed] .content-block{padding-block:80px}body[data-layout-spacing=compact] .content-block{padding-block:40px}
body[data-layout-hero] .hero-composition.has-media{isolation:isolate;position:relative;overflow:hidden;margin:0 0 32px;gap:0;min-height:640px;padding:56px;display:flex;align-items:center;background:#14231f;color:#ffffff}
body[data-layout-hero] .has-media .hero-rail.hero-visual{position:absolute;inset:0;z-index:-2;width:100%;height:100%;padding:0;background:transparent;border-radius:0}
body[data-layout-hero] .has-media .hero-visual .web-media{width:100%;height:100%;aspect-ratio:auto!important}
body[data-layout-hero] .hero-composition.has-media:before{content:"";position:absolute;inset:0;z-index:-1;background:rgba(0,0,0,.64);pointer-events:none}
body[data-layout-hero] .has-media .hero-copy:before{display:none}body[data-layout-hero] .has-media .hero-copy{position:relative;z-index:0;display:block;width:100%;max-width:780px;margin:0;padding:0;background:transparent;backdrop-filter:none;border:0;box-shadow:none;color:inherit;text-align:left}
body[data-layout-hero] .has-media .hero{display:block;color:inherit;background:transparent}body[data-layout-hero] .has-media .hero h1{margin:0;max-width:18ch;font-size:clamp(2.3rem,5.5vw,5.4rem);text-wrap:balance}body[data-layout-hero] .has-media .hero p{margin:24px 0 0;max-width:48ch;color:inherit;text-align:inherit;font-size:1.1rem;line-height:1.6}
body[data-layout-hero] .has-media .hero-action{margin-top:28px}body[data-layout-hero] .has-media .hero-action .cta,body[data-layout-hero] .has-media .hero-action button{border-color:#ffffff}
body[data-layout-hero=overlay-centered] .has-media .hero-copy{margin-inline:auto;text-align:center}body[data-layout-hero=overlay-centered] .has-media .hero h1,body[data-layout-hero=overlay-centered] .has-media .hero p{margin-inline:auto}
body[data-layout-hero=split] .hero-composition.has-media{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:48px;padding:48px 0;min-height:0;background:transparent;color:var(--ink);overflow:visible}body[data-layout-hero=split] .hero-composition.has-media:before{display:none}body[data-layout-hero=split] .has-media .hero h1,body[data-layout-hero=split] .has-media .hero p{color:var(--ink)}body[data-layout-hero=split] .has-media .hero-rail.hero-visual{position:relative;inset:auto;z-index:auto;height:auto}body[data-layout-hero=split] .has-media .hero-visual .web-media{height:auto;aspect-ratio:4/5!important}body[data-layout-hero=split] .has-media .hero-action .cta,body[data-layout-hero=split] .has-media .hero-action button{border-color:var(--ink)}
body[data-layout-heading=balanced] .has-media .hero h1{font-size:clamp(2.3rem,4.4vw,4.4rem)}body[data-layout-heading=display] .has-media .hero h1{font-size:clamp(2.6rem,6vw,6rem)}body[data-layout-heading] h2{max-width:24ch;text-wrap:balance}
body[data-layout-sections=editorial-columns] #about,body[data-layout-sections=editorial-columns] #proof{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:24px 56px;align-items:start}body[data-layout-sections=editorial-columns] #about>h2,body[data-layout-sections=editorial-columns] #proof>h2{grid-column:1;grid-row:1}body[data-layout-sections=editorial-columns] #about>p,body[data-layout-sections=editorial-columns] #proof>p{grid-column:2;margin:0;max-width:55ch}
body[data-layout-sections=stacked] #about,body[data-layout-sections=stacked] #proof{display:block}body[data-layout-sections=stacked] #about>p,body[data-layout-sections=stacked] #proof>p{max-width:65ch;margin:20px 0}
body[data-layout-services=rows] #services{display:block}body[data-layout-services=rows] #services>p{display:block;max-width:none;padding:24px 0;margin:0;border-bottom:1px solid var(--rule);font-size:clamp(1.25rem,2.2vw,1.9rem);line-height:1.45}
body[data-layout-services=columns] #services{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 48px}body[data-layout-services=columns] #services>h2{grid-column:1/-1;grid-row:auto}body[data-layout-services=columns] #services>p{padding:0;margin:0;font-size:1.2rem;line-height:1.6}
@media(max-width:767px){body[data-layout-hero] .hero-composition.has-media{padding:40px 24px;min-height:600px}body[data-layout-hero] .has-media .hero h1{font-size:clamp(2.2rem,9vw,3.4rem);max-width:18ch}body[data-layout-hero=split] .hero-composition.has-media{grid-template-columns:1fr;gap:28px;min-height:0;padding:24px 0}body[data-layout-hero] .has-media .hero p{font-size:1rem;line-height:1.6}body[data-layout-sections=editorial-columns] #about,body[data-layout-sections=editorial-columns] #proof,body[data-layout-services=columns] #services{display:block}body[data-layout-sections=editorial-columns] #about>p,body[data-layout-sections=editorial-columns] #proof>p,body[data-layout-services=columns] #services>p{margin:20px 0}body[data-layout-spacing=relaxed] .content-block{padding-block:44px}body[data-layout-spacing=compact] .content-block{padding-block:28px}}
` : "";
  const layoutAttributes = layoutPlan ? ` data-layout-hero="${layoutPlan.hero}" data-layout-spacing="${layoutPlan.spacing}" data-layout-heading="${layoutPlan.headingScale}" data-layout-sections="${layoutPlan.sectionLayout}" data-layout-services="${layoutPlan.services}"` : "";
  const motionCss =
    motion === 0
      ? "html,.gallery-carousel .gallery-track{scroll-behavior:auto}button:active,.cta:active{transform:none}"
      : `
@media(prefers-reduced-motion:no-preference){
:root{--motion-enter:${420 + profile.dials.motion * 36}ms;--motion-step:70ms;--motion-rise:${6 + profile.dials.motion}px;--motion-feedback:${140 + profile.dials.motion * 6}ms;--motion-ease:cubic-bezier(.22,1,.36,1)}
@keyframes pikar-copy-arrive{from{transform:translateY(var(--motion-rise))}to{transform:none}}
@keyframes pikar-picture-settle{from{transform:scale(1.025)}to{transform:none}}
@keyframes pikar-section-arrive{from{transform:translateY(10px)}to{transform:none}}
@keyframes pikar-detail-open{from{transform:translateY(4px)}to{transform:none}}
.hero h1{animation:pikar-copy-arrive var(--motion-enter) var(--motion-ease) backwards}
.hero p{animation:pikar-copy-arrive var(--motion-enter) var(--motion-ease) backwards;animation-delay:var(--motion-step)}
.hero-action{animation:pikar-copy-arrive var(--motion-enter) var(--motion-ease) backwards;animation-delay:calc(var(--motion-step)*2)}
.hero-visual img{animation:pikar-picture-settle var(--motion-enter) cubic-bezier(.33,1,.68,1) backwards}
.hero-action:hover,.hero-action:focus-within,.hero-action:active{animation:none}
button,.cta{transition:transform var(--motion-feedback) var(--motion-ease)}
.catalogue-items details[open]>p{animation:pikar-detail-open var(--motion-feedback) var(--motion-ease)}
@supports (animation-timeline:view()) and (animation-range:entry 0% cover 20%){
.content-block.node-section>section>h2,.content-block.node-text>p{animation:pikar-section-arrive 1ms linear both;animation-timeline:view();animation-range:entry 0% cover 20%}
#gallery>.web-media img,.gallery-slide .web-media img,.catalogue-items article>.web-media img{animation:pikar-picture-settle 1ms linear both;animation-timeline:view();animation-range:entry 0% cover 20%}
}
}
`;
  const navigationLinks = parts.document.navigation
    .map(
      (item) =>
        `<li><a href="${escapeWebText(item.path)}"${item.path === `/p/${parts.route.slug}/${parts.page.slug}` ? ' aria-current="page"' : ""}>${escapeWebText(item.label)}</a></li>`,
    )
    .join("");
  const primaryNavigation = navigationLinks
    ? `<nav aria-label="Primary"><ul>${navigationLinks}</ul></nav>`
    : "";
  const footerNavigation = navigationLinks
    ? `<nav aria-label="Footer"><ul>${navigationLinks}</ul></nav>`
    : "";
  const presentationCss = designTokens ? `body{font-family:${tokenFonts[designTokens.typography.body]}}body[data-layout-hero] .site-footer{background:${designTokens.footer === "light" ? colors.paper : colors.ink};color:${designTokens.footer === "light" ? colors.ink : colors.paper};border-color:${colors.rule}}body[data-layout-hero] .site-footer a,body[data-layout-hero] .site-footer p{color:inherit}body[data-layout-hero]:not([data-layout-hero=split]) .hero-composition.has-media{min-height:${designTokens.spacing.heroMinHeight}px}body[data-layout-hero] .hero h1{font-weight:${designTokens.typography.heading.endsWith("serif") ? 400 : 600}}@media(max-width:767px){body[data-layout-hero]:not([data-layout-hero=split]) .hero-composition.has-media{min-height:${Math.min(480, designTokens.spacing.heroMinHeight)}px}}body[data-layout-spacing] .content-block{padding-block:clamp(28px,6vw,${designTokens.spacing.sectionGap}px)}.content-flow p,.hero p:not(.eyebrow){max-width:${designTokens.spacing.copyMeasure}ch}body[data-layout-services=columns] #services>p{max-width:${designTokens.spacing.copyMeasure}ch}
body[data-layout-hero] .footer-brand{display:inline-flex;align-items:center;min-height:44px;min-width:44px;font-size:clamp(1.5rem,2.4vw,2.25rem);line-height:1.2;letter-spacing:-.025em;font-weight:500}
body[data-layout-sections] #about{padding:0;background:transparent}body[data-layout-sections] #about>p{font-size:clamp(1.05rem,1.5vw,1.25rem);line-height:1.65}
body[data-layout-services=columns] #services{gap:28px 40px}body[data-layout-services=columns] #services>h2{margin-bottom:4px}body[data-layout-services=columns] #services>p{border-top:1px solid var(--rule);padding:20px 0 4px;font-size:clamp(1.1rem,1.8vw,1.4rem);font-weight:500;line-height:1.5}
body[data-layout-hero] .hero-composition.has-rail:not(.has-media){align-items:start;gap:clamp(24px,5vw,64px);padding-block:40px}body[data-layout-hero] .has-rail:not(.has-media) .hero-rail{padding:0;background:transparent}
@media(max-width:767px){body[data-layout-services=columns] #services>p{margin:16px 0 0}body[data-layout-hero] .hero-composition.has-rail:not(.has-media){padding-block:24px}}
` : '';
  const innerComposition = innerPage ? (inquiry ? "inquiry" : parts.nodes.some(entry => entry.node.kind === "section" && entry.node.id === "services") ? "services" : "editorial") : undefined;
  const innerPageCss = innerPage ? `
body[data-inner-page] main{padding-top:48px;padding-bottom:48px}body[data-inner-page]:not([data-inner-page=inquiry]) main{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:40px 64px;align-items:start}
body[data-inner-page] .hero-composition,body[data-inner-page] .hero-composition.has-rail:not(.has-media){padding:0;margin:0;min-height:0;gap:48px;align-items:start}body[data-inner-page] .hero h1{font-size:clamp(2.5rem,4.8vw,4.5rem);line-height:1.1;max-width:18ch}body[data-inner-page] .hero-action{margin-top:28px}
body[data-inner-page][data-layout-spacing] .content-block{padding:0}body[data-inner-page] .content-flow{gap:24px;min-width:0}body[data-inner-page=editorial][data-layout-spacing] .content-block.node-text{background:var(--card);border:1px solid var(--rule);padding:32px}body[data-inner-page=editorial] .node-text>p{font-size:clamp(1.2rem,2vw,1.6rem);line-height:1.65;margin:0;max-width:48ch}
body[data-inner-page=services] #services{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}body[data-inner-page=services] #services>h2{grid-column:1/-1;font-size:1.35rem;margin:0 0 8px}body[data-inner-page=services] #services>p{background:var(--card);border:1px solid var(--rule);padding:28px;margin:0;min-width:0;font-size:1.3rem;line-height:1.5;font-weight:500;max-width:none}
body[data-inner-page=inquiry] .hero-composition.has-rail{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:64px}body[data-inner-page=inquiry] .has-rail:not(.has-media) .hero-rail{background:var(--card);border:1px solid var(--rule);padding:36px}body[data-inner-page=inquiry] legend{font-size:1.5rem;margin-bottom:12px}body[data-inner-page=inquiry] form button{margin-top:12px}body[data-inner-page=inquiry] label:has(input[type=checkbox]){min-height:44px;align-items:center}
body[data-inner-page] .site-footer{border-top:1px solid var(--rule);margin-top:8px;padding-top:28px;padding-bottom:28px;align-items:center}
@media(max-width:767px){body[data-inner-page] main{padding-top:28px;padding-bottom:32px}body[data-inner-page]:not([data-inner-page=inquiry]) main,body[data-inner-page=inquiry] .hero-composition.has-rail{display:grid;grid-template-columns:minmax(0,1fr);gap:28px}body[data-inner-page=editorial][data-layout-spacing] .content-block.node-text{padding:24px}body[data-inner-page=services] #services{grid-template-columns:minmax(0,1fr)}body[data-inner-page=services] #services>p{padding:24px}body[data-inner-page=inquiry] .has-rail:not(.has-media) .hero-rail{padding:24px}}
` : '';
  const description = parts.page.description ?? parts.document.description ?? parts.document.title;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="${WEB_DESIGN_RENDERER_VERSION}"><title>${escapeWebText(parts.page.title)} · ${escapeWebText(parts.document.brand.name)}</title><meta name="description" content="${escapeWebText(description)}"><style>${css}${surfaceCss}${galleryCss}${layoutCss}${presentationCss}${innerPageCss}${motionCss}</style></head><body data-art-direction="${direction}" data-surface-style="${surfaceStyle}" data-pattern="${profile.patternId}"${layoutAttributes}${innerComposition ? ` data-inner-page="${innerComposition}"` : ""}><a class="skip-link" href="#main-content">Skip to content</a><header class="site-header"><a class="brand" href="${escapeWebText(home)}">${logoHtml}<span>${brand}</span></a>${primaryNavigation}</header><main id="main-content" data-page="${escapeWebText(parts.page.slug)}">${heroHtml}<div class="content-flow">${content}</div></main><footer class="site-footer"><a class="footer-brand" href="${escapeWebText(home)}">${brand}</a>${footerNavigation}${footnote}</footer>${content.includes('class="designed-gallery gallery-carousel"') ? WEB_CAROUSEL_TAG : ""}</body></html>`;
}

export function renderDesignedWebDocumentBytes(
  document: WebDocument,
  profile: DesignProfileRef,
  route?: WebRouteContext,
): Uint8Array {
  return encoder.encode(renderDesignedWebDocument(document, profile, route));
}

/** Includes every page, the selected profile and renderer identity, even for route-specific previews. */
export function designedWebDocumentHashMaterial(
  document: WebDocument,
  profile: DesignProfileRef,
  route?: WebRouteContext,
): Uint8Array {
  const rendered = renderDesignedWebDocument(document, profile, route);
  // Convex may rehydrate object keys in a different insertion order. Hash the closed profile
  // semantically, with every validated field in one fixed order, rather than its incidental
  // JavaScript object layout. Rendering above validates both identity and selected sources.
  const canonicalProfile = {
    bundleHash: profile.bundleHash,
    compilerHash: profile.compilerHash,
    patternId: profile.patternId,
    styleId: profile.styleId,
    paletteId: profile.paletteId,
    typographyId: profile.typographyId,
    formProfileId: profile.formProfileId,
    dials: {
      variance: profile.dials.variance,
      motion: profile.dials.motion,
      density: profile.dials.density,
    },
    ...(profile.pageOverride === undefined ? {} : { pageOverride: profile.pageOverride }),
    ...(profile.artDirection === undefined ? {} : { artDirection: profile.artDirection }),
    ...(profile.surfaceStyle === undefined ? {} : { surfaceStyle: profile.surfaceStyle }),
    ...(profile.layoutPlan === undefined ? {} : { layoutPlan: canonicalWebLayoutPlan(profile.layoutPlan) }),
  };
  return encoder.encode(
    `${WEB_DESIGN_RENDERER_VERSION}\n${canonicalWebDocument(document)}\n${JSON.stringify(canonicalProfile)}\n${rendered}`,
  );
}

export function designedWebDocumentHash(
  document: WebDocument,
  profile: DesignProfileRef,
  route?: WebRouteContext,
): string {
  return sha256Bytes(designedWebDocumentHashMaterial(document, profile, route));
}
