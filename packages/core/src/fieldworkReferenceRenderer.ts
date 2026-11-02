import type {
  WebCtaNode,
  WebDocument,
  WebMediaNode,
  WebRouteContext,
  WebSectionNode,
} from "@pikar/contracts/webRuntime";
import type { DesignProfileRef } from "./designKnowledge";
import { FIELDWORK_REFERENCE_CSS } from "./fieldworkReferenceStyles";
import { webAssetPath } from "./webAssets";
import { WEB_CAROUSEL_TAG } from "./webCarouselRuntime";
import { validateWebLayoutPlanForDocument } from "./webLayoutPlan";
import { escapeWebText as e, renderWebPageParts } from "./webRuntime";

const refuse = (): never => {
  throw Error("FIELDWORK_REFERENCE_SLOT_UNSUPPORTED");
};
const attribute = (id: string | undefined) => (id ? ` id="${e(id)}"` : "");
const paragraph = (text: string, cls = "") => `<p${cls ? ` class="${cls}"` : ""}>${e(text)}</p>`;

// First-party adaptations for operational routes and content lengths absent in the visual reference.
const adaptation = `
body{min-height:100vh;display:flex;flex-direction:column}main{flex:1;min-width:0}.site-header{position:relative;top:auto}.site-header a,.button{min-width:44px;min-height:44px}.wordmark{display:inline-flex;align-items:center;gap:.5rem}.wordmark img{max-width:48px;max-height:44px}.hero-image{inset:0}.hero-bottom p{max-width:57ch}.hero-bottom form{margin:0}.hero-bottom .button{white-space:normal}.hero-content h1,.section h2,.service h3{overflow-wrap:break-word}.contact form{margin-inline:auto;text-align:start}.contact-teaser form{margin-block:0}.contact-teaser legend{padding:0;font-size:clamp(2.3rem,4.2vw,4rem);line-height:1.12;margin-bottom:1.5rem}.hero-caption{position:absolute;bottom:.75rem;right:.75rem;max-width:45ch;margin:0;padding:.4rem .7rem;background:rgba(20,25,20,.87);color:#fff;font-size:.75rem}.contact fieldset{border:0;padding:0;margin:0;display:grid;gap:1.2rem}.contact form{margin-top:2rem;max-width:42rem}.contact legend{font-family:var(--serif);font-size:1.5rem;margin-bottom:1rem}.contact label{display:block;line-height:1.5}.contact input:not([type=checkbox]){display:block;width:100%;border:1px solid var(--muted);padding:.8rem;background:var(--white);font:inherit}.contact label:has(input[type=checkbox]){display:flex;align-items:center;min-height:44px;gap:.75rem}.contact input[type=checkbox]{width:24px;height:24px;flex:none}.contact button,.hero-bottom button{cursor:pointer}.contact button{justify-self:start}.inner-intro{padding-bottom:clamp(24px,4vw,48px)}.inner-intro h1{font:400 clamp(3rem,7vw,6rem)/1.04 var(--serif);margin:.3em 0}.inner-intro+.section{padding-top:clamp(40px,5vw,68px)}.material-track{scroll-behavior:auto}.material-viewport{max-width:100%}.material-track figure{margin:0}.material-track img{display:block}.material-gallery:not(.gallery-carousel) .material-track{flex-wrap:wrap}.service .detail{margin-top:.5rem}.skip-link{position:absolute;left:1rem;top:-100px;z-index:5;padding:.8rem;background:var(--white);color:var(--ink)}.skip-link:focus{top:0}footer a{min-width:44px;min-height:44px;display:inline-flex;align-items:center}.service-list>*{min-width:0}
@media(max-width:760px){.site-header{flex-wrap:wrap}.site-header nav{flex-wrap:wrap}.hero-content{padding-inline:clamp(1.2rem,6vw,2.4rem)}.hero-bottom{display:flex;flex-direction:column;align-items:start;gap:1rem}.hero-bottom>p{margin:0}.hero-content h1{max-width:100%}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}`;

function mediaImage(node: WebMediaNode, route: WebRouteContext, hero = false) {
  const src = webAssetPath(node.storageRef, route.slug);
  if (!src) return refuse();
  return `<img${hero ? ' class="hero-image"' : ""} data-asset-ref="${e(node.storageRef)}" src="${e(src)}" alt="${e(node.alt)}" loading="${hero ? "eager" : "lazy"}" decoding="async" style="object-fit:${node.crop ?? "cover"};object-position:${node.focalPoint?.x ?? 50}% ${node.focalPoint?.y ?? 50}%">`;
}

function cta(node: WebCtaNode, route: WebRouteContext) {
  const target = e(node.target.kind === "local" ? node.target.path : node.target.url);
  return node.analytics
    ? `<form method="post" action="/p/${route.slug}/${route.page}/cta/${node.id}"><button class="button" type="submit" data-target="${target}">${e(node.label)}</button></form>`
    : `<a class="button" href="${target}">${e(node.label)}</a>`;
}

function serviceRows(node: WebSectionNode) {
  return node.children
    .map((child, index) => {
      if (child.kind !== "text" && (child.kind !== "section" || !child.heading)) return refuse();
      const title = child.kind === "text" ? child.text : child.heading!;
      const description =
        child.kind === "section"
          ? child.children
              .map((item, i) =>
                item.kind === "text" ? paragraph(item.text, i > 0 ? "detail" : "") : refuse(),
              )
              .join("")
          : "";
      return `<article class="service"${attribute(child.kind === "section" ? child.id : undefined)}><span class="service-number">${String(index + 1).padStart(2, "0")}</span><div><h3>${e(title)}</h3></div>${description}</article>`;
    })
    .join("");
}

export function renderFieldworkReferenceDocument(
  document: WebDocument,
  profile: DesignProfileRef,
  routeInput: WebRouteContext | undefined,
  rendererVersion: string,
): string {
  const parts = renderWebPageParts(document, routeInput);
  const { page, route } = parts;
  const plan = profile.layoutPlan;
  if (
    document.kind !== "site" ||
    plan?.version !== 3 ||
    !validateWebLayoutPlanForDocument(document, plan)
  )
    return refuse();
  const isHome = page.slug === document.pages[0]?.slug;
  const hero = page.nodes.find((n) => n.kind === "hero");
  if (!hero || page.nodes.filter((n) => n.kind === "hero").length !== 1) return refuse();
  const media = page.nodes.filter((n) => n.kind === "media");
  if (media.length > 1 || media.some((n) => n.placement !== "hero")) return refuse();
  const heroImage = media[0];
  const buttons = page.nodes.filter((n) => n.kind === "cta");
  if (buttons.length > 1) return refuse();
  const localNavigation = page.nodes.find((n) => n.kind === "navigation");
  const navigation = localNavigation?.items ?? document.navigation;
  if (
    localNavigation &&
    document.navigation.length &&
    JSON.stringify(localNavigation.items) !== JSON.stringify(document.navigation)
  )
    return refuse();
  const nav = navigation.map((n) => `<a href="${e(n.path)}">${e(n.label)}</a>`).join("");
  const home =
    navigation.find((n) => n.path === "#home" || n.path.endsWith("/" + document.pages[0]?.slug))
      ?.path ?? `/p/${route.slug}/${document.pages[0]!.slug}`;
  const contact = navigation.find((n) => n.path.endsWith("/contact") || n.path === "#contact");
  const contactLink = contact
    ? `<a class="button" href="${e(contact.path)}">${e(contact.label)}</a>`
    : "";
  const linkedForm = page.nodes.find((n) => n.kind === "form");
  const heroAction = buttons[0] ? cta(buttons[0], route) : contactLink;
  const heading = (id: string | undefined, value: string, heroTitle = false) => {
    const treatment = plan.headingTreatments?.find(
      (t) => t.pageSlug === page.slug && t.nodeId === id,
    );
    if (!treatment) {
      // Style the ending of a long source headline without inserting or replacing words.
      const end = heroTitle && value.match(/\s+(\S+\s+\S+[.!?]?)$/u);
      return end && end.index !== undefined && end.index > 8
        ? e(value.slice(0, end.index + 1)) + `<em>${e(end[1]!)}</em>`
        : e(value);
    }
    const cuts = [
      ...new Set([
        0,
        value.length,
        ...treatment.breakAfter,
        ...treatment.emphasisRanges.flatMap((r) => [r.start, r.end]),
      ]),
    ].sort((a, b) => a - b);
    return cuts
      .slice(0, -1)
      .map((start, i) => {
        const end = cuts[i + 1]!;
        const range = treatment.emphasisRanges.find((r) => start >= r.start && end <= r.end);
        const text = e(value.slice(start, end));
        return (
          (treatment.breakAfter.includes(start) ? "<br>" : "") + (range ? `<em>${text}</em>` : text)
        );
      })
      .join("");
  };
  const heroTitle = heading(hero.id, hero.heading, isHome);
  const intro = isHome
    ? `<section class="hero"${attribute(hero.id)}>${heroImage ? mediaImage(heroImage, route, true) : ""}<div class="hero-content">${hero.eyebrow ? paragraph(hero.eyebrow, "eyebrow") : ""}<h1>${heroTitle}</h1><div class="hero-bottom">${hero.body ? paragraph(hero.body) : ""}${heroAction}</div></div>${heroImage?.caption ? paragraph(heroImage.caption, "hero-caption") : ""}</section>`
    : `<section class="section inner-intro"${attribute(hero.id)}>${hero.eyebrow ? paragraph(hero.eyebrow, "eyebrow") : ""}<h1>${heroTitle}</h1>${hero.body ? paragraph(hero.body, "lead") : ""}${heroImage ? mediaImage(heroImage, route) + (heroImage.caption ? paragraph(heroImage.caption) : "") : ""}${buttons[0] ? heroAction : ""}</section>`;
  const blocks: { order: number; html: string }[] = [];
  let galleryCount = 0,
    autoplay = false;
  const section = (n: WebSectionNode) => {
    const type = plan.sections.find(
      (s) => s.pageSlug === page.slug && s.nodeId === n.id,
    )?.composition;
    const title = n.heading
      ? `<div class="section-heading"><h2>${heading(n.id, n.heading)}</h2></div>`
      : "";
    const wrap = (cls: string, body: string) =>
      `<section class="section ${cls}"${attribute(n.id)}>${title}${body}</section>`;
    switch (type) {
      case "editorial-lead":
        return {
          order: 1,
          html: wrap(
            "about",
            `<div class="about-grid">${n.children.map((c, i) => (c.kind === "text" ? paragraph(c.text, i ? "secondary" : "lead") : refuse())).join("")}</div>`,
          ),
        };
      case "principles-grid":
        return {
          order: 2,
          html: wrap(
            "about",
            `<div class="principles">${n.children.map((c, i) => (c.kind === "section" ? `<article class="principle"${attribute(c.id)}><span>0${i + 1}</span><h3>${heading(c.id, c.heading ?? "")}</h3>${c.children.map((p) => (p.kind === "text" ? paragraph(p.text) : refuse())).join("")}</article>` : refuse())).join("")}</div>`,
          ),
        };
      case "numbered-services":
      case "service-panels":
        return {
          order: 4,
          html: wrap("services", `<div class="service-list">${serviceRows(n)}</div>`),
        };
      case "image-caption": {
        if (++galleryCount > 1) return refuse();
        const images = n.children.filter((c) => c.kind === "media");
        if (
          !images.length ||
          images.length > 6 ||
          n.children.some((c) => c.kind !== "text" && c.kind !== "media")
        )
          return refuse();
        autoplay = images.length >= 3;
        const first = n.children.findIndex((c) => c.kind === "media"),
          last = n.children.map((c) => c.kind).lastIndexOf("media");
        if (n.children.slice(first, last + 1).some((c) => c.kind !== "media")) return refuse();
        const copy = (nodes: typeof n.children, cls: string) =>
          nodes.map((c) => (c.kind === "text" ? paragraph(c.text, cls) : refuse())).join("");
        const slides = images
          .map(
            (img) =>
              `<figure>${mediaImage(img, route)}${img.caption ? `<figcaption>${e(img.caption)}</figcaption>` : ""}</figure>`,
          )
          .join("");
        const controls = autoplay
          ? '<div class="material-controls"><p>Hover or focus to pause. Use the arrows to explore.</p><div><button type="button" data-gallery-previous aria-label="Previous image">←</button><button type="button" data-gallery-next aria-label="Next image">→</button></div></div>'
          : "";
        return {
          order: 3,
          html: wrap(
            "materials",
            copy(n.children.slice(0, first), "material-intro") +
              `<div class="material-gallery${autoplay ? " gallery-carousel" : ""}"><div class="material-viewport gallery-viewport"${autoplay ? ' tabindex="0" role="region" aria-roledescription="carousel" aria-label="Gallery images"' : ""}><div class="material-track gallery-track">${slides}</div></div>${controls}</div>` +
              copy(n.children.slice(last + 1), "material-note"),
          ),
        };
      }
      case "contact-copy":
        return {
          order: 5,
          html: wrap(
            "contact",
            `<div class="contact-inner">${n.children.map((c) => (c.kind === "text" ? paragraph(c.text) : c.kind === "cta" ? cta(c, route) : refuse())).join("")}</div>`,
          ),
        };
      default:
        return refuse();
    }
  };
  for (const { node, html } of parts.nodes) {
    switch (node.kind) {
      case "hero":
      case "media":
      case "cta":
      case "navigation":
        break;
      case "section":
        blocks.push(section(node));
        break;
      case "text":
        blocks.push({
          order: 1,
          html: `<section class="section about"><div class="about-grid">${paragraph(node.text, "lead")}</div></section>`,
        });
        break;
      case "form":
        blocks.push({
          order: 5,
          html: `<section class="section contact"><div class="contact-inner">${html.replace('<button type="submit">', '<button class="button" type="submit">')}</div></section>`,
        });
        break;
      case "footer":
        break;
      default:
        return refuse();
    }
  }
  if (isHome && contact && !linkedForm && !blocks.some((b) => b.order === 5)) {
    // Reuse the real destination's exact form and consent, including its original submission route.
    const destination = document.pages.find((p) => contact.path === `/p/${route.slug}/${p.slug}`);
    const targetForms = destination
      ? renderWebPageParts(document, { slug: route.slug, page: destination.slug }).nodes.filter(
          (n) => n.node.kind === "form",
        )
      : [];
    if (targetForms.length > 1) return refuse();
    const panel = targetForms[0]
      ? targetForms[0].html.replace(
          '<button type="submit">',
          '<button class="button" type="submit">',
        )
      : contactLink;
    blocks.push({
      order: 5,
      html: `<section class="section contact contact-teaser"><div class="contact-inner">${panel}</div></section>`,
    });
  }
  const logo = document.brand.logo;
  const logoPath = logo && webAssetPath(logo.storageRef, route.slug);
  if ((logo && !logoPath) || document.brand.logoStorageRef) return refuse();
  const wordmark = `${logo && logoPath ? `<img data-asset-ref="${e(logo.storageRef)}" src="${e(logoPath)}" alt="${e(logo.alt)}">` : ""}${e(document.brand.name)}`;
  const footer = [
    ...page.nodes.filter((n) => n.kind === "footer").map((n) => n.text),
    ...(document.footer ? [document.footer.text] : []),
  ]
    .map((t) => `<span>${e(t)}</span>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="${e(rendererVersion)}"><meta name="description" content="${e(hero.body ?? page.title)}"><title>${e(page.title)} · ${e(document.brand.name)}</title><style>${FIELDWORK_REFERENCE_CSS}${adaptation}</style></head><body><a class="skip-link" href="#main-content">Skip to content</a><header class="site-header"><a class="wordmark" href="${e(home)}">${wordmark}</a><nav aria-label="Primary navigation">${nav}</nav></header><main id="main-content" data-page="${e(page.slug)}">${intro}${blocks
    .sort((a, b) => a.order - b.order)
    .map((b) => b.html)
    .join(
      "",
    )}</main><footer><a href="${e(home)}">${e(document.brand.name)}</a>${footer}</footer>${autoplay ? WEB_CAROUSEL_TAG : ""}</body></html>`;
}
