import type { WebDocument, WebRouteContext } from "@pikar/contracts/webRuntime";
import {
  type DesignKnowledgeBundle,
  type DesignProfileRef,
  validateDesignProfileRef,
  verifiedDesignKnowledgeBundle,
} from "./designKnowledge";
import { canonicalWebDocument, renderWebDocument, sha256Bytes } from "./webRuntime";

export const WEB_DESIGN_RENDERER_VERSION = "web-design-renderer-v1" as const;
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

/** Closed, code-owned presentation; all document nodes remain rendered by the Phase 48 renderer. */
export function renderDesignedWebDocument(
  document: WebDocument,
  profile: DesignProfileRef,
  route?: WebRouteContext,
): string {
  assertDesignProfileSources(profile);
  const html = renderWebDocument(document, WEB_DESIGN_RENDERER_VERSION, route);
  const spacing = 12 + profile.dials.density * 2;
  const width = 72 - profile.dials.variance;
  const motion = profile.dials.motion <= 2 ? 0 : profile.dials.motion * 12;
  const hoverTransform = motion === 0 ? "none" : "translateY(-2px)";
  const pattern = profile.patternId === "hero-features-cta" ? "center" : "left";
  const palette = profile.paletteId === "trust-commerce" ? "#0b4f4a" : "#0e1419";
  const radius = profile.styleId === "minimal-swiss" ? 12 : 0;
  const font =
    profile.typographyId === "modern-professional" ? "system-ui,sans-serif" : "sans-serif";
  const controlHeight = profile.formProfileId === "forms-first" ? 44 : 40;
  const css = `:root{color-scheme:light;--paper:#f8fafc;--card:#fff;--ink:#0e1419;--muted:#55606c;--teal:${palette};--space:${spacing}px;--measure:${width}ch}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:400 1rem/1.6 ${font};overflow-wrap:anywhere}header,main,footer{max-width:var(--measure);margin:auto;padding:var(--space)}header{border-bottom:2px solid var(--teal)}header a{color:var(--teal);font-weight:700}main{display:grid;gap:var(--space)}main>*{min-width:0}section,form,article{background:var(--card);padding:var(--space);border-radius:${radius}px}h1,h2,h3{line-height:1.15;letter-spacing:-.025em}h1{text-align:${pattern};font-size:clamp(2rem,5vw,4rem)}p{max-width:65ch}a{color:var(--teal);text-underline-offset:.2em}img,input,textarea,select{max-width:100%}button,input,textarea,select{font:inherit;min-height:${controlHeight}px}button{background:var(--teal);color:#fff;border:0;border-radius:8px;padding:.6em 1em}label{display:block;font-weight:600}:focus-visible{outline:3px solid var(--teal);outline-offset:3px}a,button{transition:transform ${motion}ms ease}a:hover,button:hover{transform:${hoverTransform}}@media(max-width:600px){header,main,footer{padding:16px}main{display:block}main>*{margin-block:16px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;transform:none!important;scroll-behavior:auto!important}}`;
  return html.replace("</head>", `<style>${css}</style></head>`);
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
