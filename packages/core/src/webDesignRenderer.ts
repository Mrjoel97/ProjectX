import type { WebDocument, WebRouteContext } from "@pikar/contracts/webRuntime";
import {
  type DesignKnowledgeBundle,
  type DesignProfileRef,
  validateDesignProfileRef,
  verifiedDesignKnowledgeBundle,
} from "./designKnowledge";
import { webAssetPath } from "./webAssets";
import { canonicalWebDocument, escapeWebText, renderWebPageParts, sha256Bytes } from "./webRuntime";

export const WEB_DESIGN_RENDERER_VERSION = "web-design-renderer-v4" as const;
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
  const colors = PALETTES[direction];
  const accent = parts.document.brand.primaryColor ?? colors.accent;
  const buttonInk =
    webColorContrast("#000000", accent) >= webColorContrast("#ffffff", accent)
      ? "#000000"
      : "#ffffff";
  const linkInk = webColorContrast(accent, colors.paper) >= 4.5 ? accent : colors.ink;
  const spacing = 36 - profile.dials.density * 2;
  const width = 1180 + (profile.dials.variance - 5) * 18;
  const motion = profile.dials.motion <= 2 ? 0 : profile.dials.motion * 12;
  const hoverTransform = motion === 0 ? "none" : "translateY(-2px)";
  const radius = direction === "editorial" ? 0 : direction === "studio" ? 16 : 6;
  const controlHeight = profile.formProfileId === "forms-first" ? 44 : 40;
  const heading =
    direction === "editorial"
      ? 'Georgia,"Times New Roman",serif'
      : direction === "studio"
        ? '"Arial Black",Arial,sans-serif'
        : "Arial,Helvetica,sans-serif";
  const hero = parts.nodes.find((entry) => entry.node.kind === "hero");
  const heroIndex = hero ? parts.nodes.indexOf(hero) : -1;
  const cta = hero
    ? parts.nodes.slice(heroIndex + 1).find((entry) => entry.node.kind === "cta")
    : undefined;
  const rail = hero
    ? (parts.nodes.find(
        (entry) => entry.node.kind === "media" && entry.node.placement === "hero",
      ) ??
      parts.nodes.find((entry) => entry.node.kind === "form") ??
      (direction === "studio"
        ? parts.nodes.find((entry) => entry.node.kind === "section" && entry.node.id === "services")
        : undefined) ??
      (direction === "technical"
        ? parts.nodes.find((entry) => entry.node.kind === "section" && entry.node.id === "proof")
        : undefined))
    : undefined;
  const heroLength = hero?.node.kind === "hero" ? hero.node.heading.length : 0;
  const headlineSize = heroLength > 100 ? "3.6rem" : heroLength > 65 ? "4.4rem" : "5.8rem";
  const content = parts.nodes
    .filter((entry) => entry !== hero && entry !== cta && entry !== rail)
    .map((entry) => `<div class="content-block node-${entry.node.kind}">${entry.html}</div>`)
    .join("");
  const heroHtml = hero
    ? `<div class="hero-composition${rail ? " has-rail" : ""}"><div class="hero-copy">${hero.html}${cta ? `<div class="hero-action">${cta.html}</div>` : ""}</div>${rail ? `<div class="hero-rail${rail.node.kind === "media" ? " hero-visual" : ""}">${rail.html}</div>` : ""}</div>`
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
  const css = `:root{color-scheme:light;--paper:${colors.paper};--card:${colors.card};--ink:${colors.ink};--muted:${colors.muted};--accent:${accent};--button-ink:${buttonInk};--link:${linkInk};--rule:${colors.rule};--space:${spacing}px;--measure:${width}px;--radius:${radius}px;--control-height:${controlHeight}px;--hero:${colors.hero};--hero-ink:${colors.heroInk};--heading:${heading}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:400 1rem/1.6 system-ui,sans-serif;overflow-wrap:anywhere}a{color:var(--link);text-underline-offset:.25em}button,input,textarea,select{font:inherit;min-height:var(--control-height)}img,input,textarea,select{max-width:100%}img:not([src]){display:none}button,.cta{display:inline-flex;justify-content:center;align-items:center;min-height:48px;padding:.8rem 1.4rem;border:1px solid var(--ink);border-radius:var(--radius);background:var(--accent);color:var(--button-ink);font-weight:700;text-decoration:none;line-height:1.25;max-width:100%}button{cursor:pointer}button:active,.cta:active{transform:translateY(1px)}a,button{transition:transform ${motion}ms ease}a:hover,button:hover{transform:${hoverTransform}}:focus-visible{outline:3px solid #000000;outline-offset:3px;box-shadow:0 0 0 3px #ffffff}.skip-link{position:absolute;left:16px;top:-100px;background:var(--card);padding:12px;z-index:2}.skip-link:focus{top:12px}.site-header{max-width:var(--measure);margin:auto;padding:16px 40px;display:flex;align-items:center;justify-content:space-between;gap:24px;border-bottom:0}.brand{display:flex;align-items:center;gap:12px;color:inherit;font-size:1.2rem;letter-spacing:-.04em;font-weight:800;text-decoration:none;max-width:36ch}.site-header nav ul{list-style:none;display:flex;gap:26px;padding:0;margin:0;flex-wrap:wrap}.site-header nav a{display:inline-flex;align-items:center;min-height:44px;color:inherit;font-size:.87rem;font-weight:600;text-decoration:none}.site-header nav a:hover{text-decoration:underline}main{max-width:var(--measure);margin:auto;padding:0 40px}main>*{min-width:0}.hero-composition{display:grid;grid-template-columns:minmax(0,1fr);gap:calc(var(--space)*2.5);padding:64px 0 72px;align-items:center}.hero-copy,.hero-rail{min-width:0}.hero{padding:0;background:transparent}.hero h1{margin:0;font-family:var(--heading);font-weight:${direction === "editorial" ? 400 : 700};font-size:clamp(2.15rem,6vw,${headlineSize});line-height:1.04;letter-spacing:${direction === "editorial" ? "-.045em" : "-.055em"};max-width:${direction === "editorial" ? "19ch" : "17ch"};text-wrap:balance}.hero p:not(.eyebrow){margin:26px 0 0;max-width:55ch;font-size:1.13rem;line-height:1.65;color:inherit}.eyebrow{font-size:.76rem;letter-spacing:.11em;margin:0 0 20px;font-weight:700}.hero-action{margin-top:30px}.hero-action form{margin:0;padding:0;background:transparent;border:0}.hero-rail{padding:28px;background:var(--card);border:0;border-radius:var(--radius);color:var(--ink)}.hero-rail h2{font-size:1.4rem;margin-top:0}.hero-rail p{margin:0;padding:14px 0;border-bottom:0}h2,h3{font-family:var(--heading);line-height:1.2;letter-spacing:-.03em}h2{font-size:clamp(1.6rem,3vw,2.3rem);margin:0 0 26px}p{max-width:65ch}.content-flow{display:grid;gap:0}.content-block{padding:calc(var(--space)*2) 0;border-top:0}.content-block>section{min-width:0}.content-block>p{font-size:1.1rem;margin:0}.content-block #services>p{margin:0;padding:20px 0;border-bottom:0;display:block;font-size:1.15rem;max-width:none}#about>p{font-size:1.15rem;line-height:1.8}#proof>p{padding:4px 0;margin:22px 0}.node-form{max-width:760px}.hero-rail form{margin:0}fieldset{margin:0;padding:0;border:0;min-width:0}legend{font-family:var(--heading);font-size:1.7rem;padding:0;margin-bottom:18px}label{display:block;margin:14px 0;color:var(--ink);font-size:.9rem;font-weight:600}input:not([type=checkbox]){display:block;width:100%;margin-top:7px;padding:.65rem .8rem;background:#ffffff;color:#152938;border:1px solid #617181;border-radius:var(--radius)}label:has(input[type=checkbox]){display:flex;align-items:flex-start;gap:10px;font-size:.82rem;line-height:1.6;font-weight:400}input[type=checkbox]{min-height:0;width:18px;height:18px;flex:0 0 18px;margin:4px 0;accent-color:var(--link)}.site-footer{max-width:var(--measure);margin:30px auto 0;padding:30px 40px;border-top:0;font-size:.84rem;color:var(--muted)}.site-footer>footer{margin-top:12px}.catalogue-items{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.catalogue-items article{padding:24px;border:0;border-radius:var(--radius)}.catalogue-items h3{margin-top:0}.commerce-unavailable{font-size:.86rem;color:var(--muted);margin-top:24px}
body[data-pattern=hero-features-cta] .hero-copy{max-width:700px}body[data-art-direction=editorial] .hero-composition.has-rail{grid-template-columns:minmax(0,1.45fr) minmax(280px,.65fr)}body[data-art-direction=editorial] .content-block #services{display:grid;grid-template-columns:minmax(180px,.55fr) minmax(0,1fr);column-gap:70px}body[data-art-direction=editorial] #services>h2{grid-row:1/10}body[data-art-direction=editorial] #about{max-width:820px;margin-left:auto}
body[data-art-direction=studio] .hero-composition.has-rail{grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);align-items:start}body[data-art-direction=studio] .hero-rail{background:var(--card);transform:translateY(16px)}body[data-art-direction=studio] .hero{padding-left:0}body[data-art-direction=studio] .content-block #services>p{display:inline-block;width:calc(50% - 14px);vertical-align:top;min-height:110px;padding:22px;margin:0 24px 20px 0;background:var(--card);border:0;border-radius:var(--radius)}body[data-art-direction=studio] .content-block #services>p:nth-of-type(even){margin-right:0}body[data-art-direction=studio] #about{padding:24px 30px;background:var(--card);border-radius:var(--radius)}
body[data-art-direction=technical] .site-header{background:var(--hero);color:var(--hero-ink);border-color:#456072}body[data-art-direction=technical] .hero-composition{background:var(--hero);color:var(--hero-ink);padding:52px 36px;margin:24px 0 0;border-radius:var(--radius)}body[data-art-direction=technical] .hero-composition.has-rail{grid-template-columns:minmax(0,1.3fr) minmax(260px,.7fr)}body[data-art-direction=technical] .hero h1{font-size:clamp(2.1rem,5vw,${headlineSize});font-weight:700}body[data-art-direction=technical] .hero-action button{border-color:var(--accent)}body[data-art-direction=technical] .content-block #services{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 30px}body[data-art-direction=technical] #services>h2{grid-column:1/-1}body[data-art-direction=technical] .content-block #services>p{font-size:1.02rem}body[data-art-direction=technical] #proof>p{border-color:var(--link)}
@media(min-width:768px) and (max-width:1000px){body[data-art-direction=editorial] .hero-composition.has-rail,body[data-art-direction=studio] .hero-composition.has-rail,body[data-art-direction=technical] .hero-composition.has-rail{grid-template-columns:minmax(0,1fr)}.hero h1{max-width:24ch;font-size:clamp(2.4rem,5vw,4rem)}}@media(max-width:767px){.site-header{padding:20px;align-items:flex-start;flex-direction:column;gap:14px}.site-header nav ul{gap:12px 20px}.site-header nav a{font-size:.82rem}main{padding:0 20px}.hero-composition{padding:36px 0 42px;gap:26px}.hero h1{font-size:clamp(2rem,10vw,3.3rem);max-width:100%}.hero p:not(.eyebrow){font-size:1rem;margin-top:20px}.hero-action{margin-top:24px}.hero-rail{padding:22px}.content-block{padding:30px 0}.site-footer{padding:24px 20px;margin-top:16px}.catalogue-items{grid-template-columns:1fr}body[data-pattern=hero-features-cta] .hero-copy{max-width:700px}body[data-art-direction=editorial] .hero-composition.has-rail,body[data-art-direction=studio] .hero-composition.has-rail,body[data-art-direction=technical] .hero-composition.has-rail{grid-template-columns:minmax(0,1fr)}body[data-art-direction=editorial] .content-block #services,body[data-art-direction=technical] .content-block #services{display:block}body[data-art-direction=studio] .hero-rail{transform:none}body[data-art-direction=studio] .hero{padding-left:18px;border-left-width:4px}body[data-art-direction=studio] .content-block #services>p{display:block;width:100%;margin-right:0;min-height:0}body[data-art-direction=technical] .hero-composition{padding:28px 22px;margin-top:16px}#about>p{font-size:1rem}}
.brand-logo{height:40px;width:auto;max-width:140px;object-fit:contain}.web-media{margin:0;overflow:hidden;min-width:0}.web-media img{display:block;max-width:100%}.hero-visual{padding:0!important;background:transparent!important;transform:none!important}.hero-visual .web-media{width:100%;min-height:320px}.hero-visual img{min-height:320px}#gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}#gallery>h2{grid-column:1/-1}@media(max-width:767px){.brand-logo{max-width:110px;height:36px}.hero-visual .web-media,.hero-visual img{min-height:220px}#gallery{grid-template-columns:1fr;gap:20px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;transform:none!important;scroll-behavior:auto!important}}`;
  const description = parts.page.description ?? parts.document.description ?? parts.document.title;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="${WEB_DESIGN_RENDERER_VERSION}"><title>${escapeWebText(parts.page.title)} · ${escapeWebText(parts.document.brand.name)}</title><meta name="description" content="${escapeWebText(description)}"><style>${css}</style></head><body data-art-direction="${direction}" data-pattern="${profile.patternId}"><a class="skip-link" href="#main-content">Skip to content</a><header class="site-header"><a class="brand" href="${escapeWebText(home)}">${logoHtml}<span>${brand}</span></a>${parts.navigationHtml}</header><main id="main-content" data-page="${escapeWebText(parts.page.slug)}">${heroHtml}<div class="content-flow">${content}</div></main><footer class="site-footer"><span>${brand}</span>${footnote}</footer></body></html>`;
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
