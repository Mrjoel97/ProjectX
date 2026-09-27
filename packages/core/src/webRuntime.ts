import {
  ABUSE_BUCKET_RETENTION_MS,
  type CtaTarget,
  IDEMPOTENCY_RETENTION_MS,
  MAX_WEB_DEPTH,
  MAX_WEB_DOCUMENT_BYTES,
  MAX_WEB_NODES,
  MAX_WEB_PAGES,
  MAX_WEB_URLS,
  WEB_RENDERER_VERSION,
  WEB_RUNTIME_LIMITS,
  type WebAttribution,
  type WebDocument,
  type WebNavigationItem,
  type WebNode,
  type WebPage,
  type WebRouteContext,
} from "@pikar/contracts/webRuntime";

export { ABUSE_BUCKET_RETENTION_MS, IDEMPOTENCY_RETENTION_MS, WEB_RENDERER_VERSION };

export type WebValidationIssue = { readonly path: string; readonly code: string };
export type WebValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly WebValidationIssue[] };

const encoder = new TextEncoder();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
const hasControl = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
const hasWhitespaceOrControl = (value: string): boolean =>
  [...value].some((character) => character.charCodeAt(0) <= 0x20);
const text = (value: unknown, max: number = WEB_RUNTIME_LIMITS.maxTextLength): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !hasControl(value);
const optionalText = (
  value: unknown,
  max: number = WEB_RUNTIME_LIMITS.maxTextLength,
): value is string | undefined => value === undefined || text(value, max);
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
const slug = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) &&
  value.length <= WEB_RUNTIME_LIMITS.maxSlugLength;
const safeLocalPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 512 &&
  value.startsWith("/") &&
  !value.startsWith("//") &&
  !hasWhitespaceOrControl(value) &&
  !/[\\]/.test(value) &&
  !/[#]/.test(value);
const safeHttps = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2048 || hasWhitespaceOrControl(value))
    return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};
const safeColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
const safeStorageRef = (value: unknown): value is string =>
  typeof value === "string" && /^storage:[a-zA-Z0-9:_-]{1,240}$/.test(value);
const commerceActionText =
  /\b(?:buy|cart|checkout|payment|merchant|inventory|stock|tax|shipping|refund|order|fulfil(?:ment|lment))\b/i;
const safePublisherText = (value: unknown, max: number): value is string =>
  text(value, max) && !commerceActionText.test(value);
const validObject = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  isRecord(value) && hasOnly(value, keys);

function issue(errors: WebValidationIssue[], path: string, code: string): void {
  errors.push({ path, code });
}

function validateAttribution(
  value: unknown,
  path: string,
  errors: WebValidationIssue[],
): value is WebAttribution | undefined {
  if (value === undefined) return true;
  if (!validObject(value, ["source", "medium", "campaign"])) {
    issue(errors, path, "unknown_field");
    return false;
  }
  for (const key of ["source", "medium", "campaign"] as const) {
    if (value[key] !== undefined && !text(value[key], WEB_RUNTIME_LIMITS.maxAttributionLength)) {
      issue(errors, `${path}.${key}`, "invalid_attribution");
    }
  }
  return true;
}

function validateTarget(
  value: unknown,
  path: string,
  errors: WebValidationIssue[],
): value is CtaTarget {
  if (!validObject(value, ["kind", "path", "url"]) || typeof value.kind !== "string") {
    issue(errors, path, "invalid_target");
    return false;
  }
  if (value.kind === "local") {
    if (!safeLocalPath(value.path)) issue(errors, `${path}.path`, "unsafe_url");
    return true;
  }
  if (value.kind === "https") {
    if (!safeHttps(value.url)) issue(errors, `${path}.url`, "unsafe_url");
    return true;
  }
  issue(errors, `${path}.kind`, "closed_union");
  return false;
}

function validateNavigation(
  value: unknown,
  path: string,
  errors: WebValidationIssue[],
): value is readonly WebNavigationItem[] {
  if (!Array.isArray(value) || value.length > WEB_RUNTIME_LIMITS.maxNavigationItems) {
    issue(errors, path, "navigation_limit");
    return false;
  }
  value.forEach((item, index) => {
    if (
      !validObject(item, ["label", "path"]) ||
      !text(item.label, WEB_RUNTIME_LIMITS.maxShortTextLength) ||
      !safeLocalPath(item.path)
    ) {
      issue(errors, `${path}[${index}]`, "invalid_navigation");
    }
  });
  return true;
}

function validateNode(
  value: unknown,
  path: string,
  errors: WebValidationIssue[],
  depth: number,
  counter: { count: number; urls: number },
): value is WebNode {
  counter.count += 1;
  if (
    counter.count > MAX_WEB_NODES ||
    depth > MAX_WEB_DEPTH ||
    !isRecord(value) ||
    typeof value.kind !== "string"
  ) {
    issue(errors, path, counter.count > MAX_WEB_NODES ? "node_limit" : "depth_or_node_invalid");
    return false;
  }
  const kind = value.kind;
  if (kind === "shell") {
    if (
      !validObject(value, ["kind", "heading"]) ||
      !optionalText(value.heading, WEB_RUNTIME_LIMITS.maxShortTextLength)
    )
      issue(errors, path, "invalid_shell");
    return true;
  }
  if (kind === "navigation") {
    if (
      !validObject(value, ["kind", "items"]) ||
      !validateNavigation(value.items, `${path}.items`, errors)
    )
      issue(errors, path, "invalid_navigation");
    counter.urls += Array.isArray(value.items) ? value.items.length : 0;
    return true;
  }
  if (kind === "hero") {
    const valid =
      validObject(value, ["kind", "eyebrow", "heading", "body"]) &&
      text(value.heading) &&
      optionalText(value.eyebrow, WEB_RUNTIME_LIMITS.maxShortTextLength) &&
      optionalText(value.body);
    if (!valid) issue(errors, path, "invalid_hero");
    return true;
  }
  if (kind === "text") {
    if (!validObject(value, ["kind", "text"]) || !text(value.text))
      issue(errors, path, "invalid_text");
    return true;
  }
  if (kind === "media") {
    if (
      !validObject(value, ["kind", "storageRef", "alt"]) ||
      !safeStorageRef(value.storageRef) ||
      !text(value.alt, WEB_RUNTIME_LIMITS.maxShortTextLength)
    )
      issue(errors, path, "invalid_media");
    return true;
  }
  if (kind === "catalogue") {
    const valid =
      validObject(value, ["kind", "heading", "items"]) &&
      optionalText(value.heading, WEB_RUNTIME_LIMITS.maxShortTextLength) &&
      Array.isArray(value.items) &&
      value.items.length > 0 &&
      value.items.length <= WEB_RUNTIME_LIMITS.maxNavigationItems;
    if (!valid) issue(errors, path, "invalid_catalogue");
    if (Array.isArray(value.items)) {
      const itemIds = new Set<string>();
      value.items.forEach((item, index) => {
        const itemValid =
          validObject(item, [
            "id",
            "name",
            "description",
            "imageStorageRef",
            "displayPriceText",
            "availabilityLabel",
          ]) &&
          id(item.id) &&
          safePublisherText(item.name, WEB_RUNTIME_LIMITS.maxShortTextLength) &&
          safePublisherText(item.description, WEB_RUNTIME_LIMITS.maxTextLength) &&
          (item.imageStorageRef === undefined || safeStorageRef(item.imageStorageRef)) &&
          (item.displayPriceText === undefined || safePublisherText(item.displayPriceText, 128)) &&
          (item.availabilityLabel === undefined || safePublisherText(item.availabilityLabel, 128));
        if (!itemValid) issue(errors, `${path}.items[${index}]`, "invalid_catalogue_item");
        if (isRecord(item) && typeof item.id === "string" && itemIds.has(item.id))
          issue(errors, `${path}.items[${index}].id`, "duplicate_catalogue_item");
        if (isRecord(item) && typeof item.id === "string") itemIds.add(item.id);
      });
    }
    return true;
  }
  if (kind === "cta") {
    const valid =
      validObject(value, ["kind", "id", "label", "target", "analytics"]) &&
      id(value.id) &&
      text(value.label, WEB_RUNTIME_LIMITS.maxShortTextLength) &&
      validateTarget(value.target, `${path}.target`, errors) &&
      (value.analytics === undefined || typeof value.analytics === "boolean");
    if (!valid) issue(errors, path, "invalid_cta");
    counter.urls += 1;
    return true;
  }
  if (kind === "form") {
    const fields = value.fields;
    const validFields =
      Array.isArray(fields) &&
      fields.length > 0 &&
      fields.length <= 3 &&
      fields.includes("email") &&
      fields.every((field) => field === "email" || field === "name" || field === "company") &&
      new Set(fields).size === fields.length;
    const valid =
      validObject(value, ["kind", "id", "heading", "fields", "consent", "attribution"]) &&
      id(value.id) &&
      optionalText(value.heading, WEB_RUNTIME_LIMITS.maxShortTextLength) &&
      validFields &&
      text(value.consent, WEB_RUNTIME_LIMITS.maxConsentLength) &&
      validateAttribution(value.attribution, `${path}.attribution`, errors);
    if (!valid) issue(errors, path, "invalid_form");
    return true;
  }
  if (kind === "section") {
    const valid =
      validObject(value, ["kind", "id", "heading", "children"]) &&
      id(value.id) &&
      optionalText(value.heading, WEB_RUNTIME_LIMITS.maxShortTextLength) &&
      Array.isArray(value.children) &&
      value.children.length > 0 &&
      value.children.length <= WEB_RUNTIME_LIMITS.maxNavigationItems;
    if (!valid) issue(errors, path, "invalid_section");
    if (Array.isArray(value.children))
      value.children.forEach((child, index) => {
        validateNode(child, `${path}.children[${index}]`, errors, depth + 1, counter);
      });
    return true;
  }
  if (kind === "footer") {
    if (
      !validObject(value, ["kind", "text"]) ||
      !text(value.text, WEB_RUNTIME_LIMITS.maxTextLength)
    )
      issue(errors, path, "invalid_footer");
    return true;
  }
  issue(errors, `${path}.kind`, "closed_union");
  return false;
}

function validatePage(
  value: unknown,
  path: string,
  errors: WebValidationIssue[],
  counter: { count: number; urls: number },
): value is WebPage {
  if (
    !validObject(value, ["slug", "title", "description", "nodes"]) ||
    !slug(value.slug) ||
    !text(value.title, WEB_RUNTIME_LIMITS.maxShortTextLength) ||
    !optionalText(value.description) ||
    !Array.isArray(value.nodes) ||
    value.nodes.length === 0 ||
    value.nodes.length > WEB_RUNTIME_LIMITS.maxNavigationItems
  ) {
    issue(errors, path, "invalid_page");
    return false;
  }
  const localIds = new Set<string>();
  value.nodes.forEach((node, index) => {
    validateNode(node, `${path}.nodes[${index}]`, errors, 1, counter);
    if (
      (node.kind === "cta" || node.kind === "form" || node.kind === "section") &&
      localIds.has(node.id)
    )
      issue(errors, `${path}.nodes[${index}].id`, "duplicate_id");
    if (node.kind === "cta" || node.kind === "form" || node.kind === "section")
      localIds.add(node.id);
  });
  return true;
}

export function validateWebDocument(input: unknown): WebValidationResult<WebDocument> {
  const errors: WebValidationIssue[] = [];
  const counter = { count: 0, urls: 0 };
  if (
    !validObject(input, ["kind", "title", "description", "brand", "navigation", "pages", "footer"])
  ) {
    return { ok: false, errors: [{ path: "$", code: "unknown_field" }] };
  }
  if (input.kind !== "site" && input.kind !== "landing" && input.kind !== "storefront")
    issue(errors, "kind", "closed_union");
  if (!text(input.title, WEB_RUNTIME_LIMITS.maxShortTextLength))
    issue(errors, "title", "invalid_title");
  if (!optionalText(input.description)) issue(errors, "description", "invalid_description");
  if (
    !validObject(input.brand, ["name", "primaryColor", "logoStorageRef"]) ||
    !text(input.brand.name, WEB_RUNTIME_LIMITS.maxBrandNameLength) ||
    (input.brand.primaryColor !== undefined && !safeColor(input.brand.primaryColor)) ||
    (input.brand.logoStorageRef !== undefined && !safeStorageRef(input.brand.logoStorageRef))
  )
    issue(errors, "brand", "invalid_brand");
  validateNavigation(input.navigation, "navigation", errors);
  counter.urls += Array.isArray(input.navigation) ? input.navigation.length : 0;
  if (!Array.isArray(input.pages) || input.pages.length === 0 || input.pages.length > MAX_WEB_PAGES)
    issue(errors, "pages", "page_limit");
  if (Array.isArray(input.pages)) {
    const pageSlugs = new Set<string>();
    input.pages.forEach((page, index) => {
      validatePage(page, `pages[${index}]`, errors, counter);
      if (isRecord(page) && typeof page.slug === "string" && pageSlugs.has(page.slug))
        issue(errors, `pages[${index}].slug`, "duplicate_page");
      if (isRecord(page) && typeof page.slug === "string") pageSlugs.add(page.slug);
    });
  }
  if (input.kind === "storefront" && Array.isArray(input.pages)) {
    let catalogueNodes = 0;
    const walk = (node: unknown, path: string): void => {
      if (!isRecord(node) || typeof node.kind !== "string") return;
      if (node.kind === "catalogue") catalogueNodes += 1;
      if (node.kind === "cta" || node.kind === "form")
        issue(errors, path, "storefront_commerce_action");
      for (const [key, value] of Object.entries(node))
        if (key !== "kind" && typeof value === "string" && commerceActionText.test(value))
          issue(errors, `${path}.${key}`, "storefront_commerce_text");
      if (node.kind === "section" && Array.isArray(node.children)) {
        node.children.forEach((child, index) => {
          walk(child, `${path}.children[${index}]`);
        });
      }
    };
    input.pages.forEach((page, pageIndex) => {
      if (isRecord(page) && Array.isArray(page.nodes)) {
        page.nodes.forEach((node, nodeIndex) => {
          walk(node, `pages[${pageIndex}].nodes[${nodeIndex}]`);
        });
      }
    });
    if (Array.isArray(input.navigation)) {
      input.navigation.forEach((item, index) => {
        if (
          isRecord(item) &&
          ((typeof item.label === "string" && commerceActionText.test(item.label)) ||
            (typeof item.path === "string" && commerceActionText.test(item.path)))
        )
          issue(errors, `navigation[${index}]`, "storefront_commerce_navigation");
      });
    }
    if (catalogueNodes === 0) issue(errors, "pages", "storefront_catalogue_required");
  }
  if (
    input.footer !== undefined &&
    (!validObject(input.footer, ["kind", "text"]) ||
      input.footer.kind !== "footer" ||
      !text(input.footer.text))
  )
    issue(errors, "footer", "invalid_footer");
  if (counter.urls > MAX_WEB_URLS) issue(errors, "$", "url_limit");
  if (encoder.encode(JSON.stringify(input)).byteLength > MAX_WEB_DOCUMENT_BYTES)
    issue(errors, "$", "document_size");
  return errors.length ? { ok: false, errors } : { ok: true, value: input as WebDocument };
}

function ensureDocument(input: unknown): WebDocument {
  const result = validateWebDocument(input);
  if (!result.ok)
    throw new Error(`WEB_DOCUMENT_INVALID:${result.errors.map((error) => error.code).join(",")}`);
  return result.value;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}
function attribute(name: string, value: string): string {
  return ` ${name}="${escapeHtml(value)}"`;
}
function targetUrl(target: CtaTarget): string {
  return target.kind === "local" ? target.path : target.url;
}
function routeOrDefault(document: WebDocument, route?: WebRouteContext): WebRouteContext {
  const fallback = document.pages[0]?.slug ?? "home";
  const candidate = route ?? { slug: fallback, page: fallback };
  if (!slug(candidate.slug) || !slug(candidate.page)) throw new Error("WEB_ROUTE_INVALID");
  return candidate;
}

function renderNode(node: WebNode, route: WebRouteContext, depth = 0): string {
  switch (node.kind) {
    case "shell":
      return `<div class="web-shell">${node.heading ? `<h1>${escapeHtml(node.heading)}</h1>` : ""}</div>`;
    case "navigation":
      return `<nav aria-label="Primary"><ul>${node.items.map((item) => `<li><a${attribute("href", item.path)}>${escapeHtml(item.label)}</a></li>`).join("")}</ul></nav>`;
    case "hero":
      return `<section class="hero">${node.eyebrow ? `<p class="eyebrow">${escapeHtml(node.eyebrow)}</p>` : ""}<h1>${escapeHtml(node.heading)}</h1>${node.body ? `<p>${escapeHtml(node.body)}</p>` : ""}</section>`;
    case "text":
      return `<p>${escapeHtml(node.text)}</p>`;
    case "media":
      return `<figure><img${attribute("alt", node.alt)}${attribute("data-storage-ref", node.storageRef)}></figure>`;
    case "catalogue":
      return `<section class="catalogue" aria-label="Catalogue presentation">${node.heading ? `<h2>${escapeHtml(node.heading)}</h2>` : ""}<div class="catalogue-items">${node.items.map((item) => `<article${attribute("data-catalogue-id", item.id)}><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p>${item.imageStorageRef ? `<img${attribute("alt", item.name)}${attribute("data-storage-ref", item.imageStorageRef)}>` : ""}${item.displayPriceText ? `<p class="display-price">${escapeHtml(item.displayPriceText)}</p>` : ""}${item.availabilityLabel ? `<p class="availability">${escapeHtml(item.availabilityLabel)}</p>` : ""}</article>`).join("")}</div><p class="commerce-unavailable">Ordering is unavailable in this presentation-only catalogue.</p></section>`;
    case "cta": {
      const url = targetUrl(node.target);
      if (node.analytics)
        return `<form method="post"${attribute("action", `/p/${route.slug}/${route.page}/cta/${node.id}`)}><button type="submit"${attribute("data-target", url)}>${escapeHtml(node.label)}</button></form>`;
      return `<a class="cta"${attribute("href", url)}>${escapeHtml(node.label)}</a>`;
    }
    case "form":
      return `<form method="post"${attribute("action", `/p/${route.slug}/${route.page}/forms/${node.id}`)}><fieldset>${node.heading ? `<legend>${escapeHtml(node.heading)}</legend>` : ""}${node.fields.map((field) => `<label>${escapeHtml(field)}<input name="${field}" type="${field === "email" ? "email" : "text"}"></label>`).join("")}<label><input name="consent" type="checkbox" required> ${escapeHtml(node.consent)}</label><button type="submit">Submit</button></fieldset></form>`;
    case "section":
      return `<section${attribute("id", node.id)}>${node.heading ? `<h2>${escapeHtml(node.heading)}</h2>` : ""}${node.children.map((child) => renderNode(child, route, depth + 1)).join("")}</section>`;
    case "footer":
      return `<footer>${escapeHtml(node.text)}</footer>`;
    default:
      throw new Error("WEB_NODE_INVALID");
  }
}

function renderPage(document: WebDocument, page: WebPage, route: WebRouteContext): string {
  const navigation = document.navigation.length
    ? `<nav aria-label="Primary"><ul>${document.navigation.map((item) => `<li><a${attribute("href", item.path)}>${escapeHtml(item.label)}</a></li>`).join("")}</ul></nav>`
    : "";
  return `<main${attribute("data-page", page.slug)}>${navigation}${page.nodes.map((node) => renderNode(node, route)).join("")}${document.footer ? renderNode(document.footer, route) : ""}</main>`;
}

function canonicalNode(node: WebNode): unknown {
  switch (node.kind) {
    case "shell":
      return { kind: node.kind, ...(node.heading === undefined ? {} : { heading: node.heading }) };
    case "navigation":
      return {
        kind: node.kind,
        items: node.items.map((item) => ({ label: item.label, path: item.path })),
      };
    case "hero":
      return {
        kind: node.kind,
        ...(node.eyebrow === undefined ? {} : { eyebrow: node.eyebrow }),
        heading: node.heading,
        ...(node.body === undefined ? {} : { body: node.body }),
      };
    case "text":
      return { kind: node.kind, text: node.text };
    case "media":
      return { kind: node.kind, storageRef: node.storageRef, alt: node.alt };
    case "catalogue":
      return {
        kind: node.kind,
        ...(node.heading === undefined ? {} : { heading: node.heading }),
        items: node.items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          ...(item.imageStorageRef === undefined ? {} : { imageStorageRef: item.imageStorageRef }),
          ...(item.displayPriceText === undefined
            ? {}
            : { displayPriceText: item.displayPriceText }),
          ...(item.availabilityLabel === undefined
            ? {}
            : { availabilityLabel: item.availabilityLabel }),
        })),
      };
    case "cta":
      return {
        kind: node.kind,
        id: node.id,
        label: node.label,
        target:
          node.target.kind === "local"
            ? { kind: "local", path: node.target.path }
            : { kind: "https", url: node.target.url },
        ...(node.analytics === undefined ? {} : { analytics: node.analytics }),
      };
    case "form":
      return {
        kind: node.kind,
        id: node.id,
        ...(node.heading === undefined ? {} : { heading: node.heading }),
        fields: [...node.fields],
        consent: node.consent,
        ...(node.attribution === undefined
          ? {}
          : {
              attribution: {
                ...(node.attribution.source === undefined
                  ? {}
                  : { source: node.attribution.source }),
                ...(node.attribution.medium === undefined
                  ? {}
                  : { medium: node.attribution.medium }),
                ...(node.attribution.campaign === undefined
                  ? {}
                  : { campaign: node.attribution.campaign }),
              },
            }),
      };
    case "section":
      return {
        kind: node.kind,
        id: node.id,
        ...(node.heading === undefined ? {} : { heading: node.heading }),
        children: node.children.map((child) => canonicalNode(child)),
      };
    case "footer":
      return { kind: node.kind, text: node.text };
  }
}

export function canonicalWebDocument(document: WebDocument): string {
  const validated = ensureDocument(document);
  const canonical = {
    kind: validated.kind,
    title: validated.title,
    ...(validated.description === undefined ? {} : { description: validated.description }),
    brand: {
      name: validated.brand.name,
      ...(validated.brand.primaryColor === undefined
        ? {}
        : { primaryColor: validated.brand.primaryColor }),
      ...(validated.brand.logoStorageRef === undefined
        ? {}
        : { logoStorageRef: validated.brand.logoStorageRef }),
    },
    navigation: validated.navigation.map((item) => ({ label: item.label, path: item.path })),
    pages: validated.pages.map((page) => ({
      slug: page.slug,
      title: page.title,
      ...(page.description === undefined ? {} : { description: page.description }),
      nodes: page.nodes.map((node) => canonicalNode(node)),
    })),
    ...(validated.footer === undefined
      ? {}
      : { footer: { kind: "footer", text: validated.footer.text } }),
  };
  return JSON.stringify(canonical);
}

export const canonicalSerializeWebDocument = canonicalWebDocument;
export const serializeWebDocument = canonicalWebDocument;

function parseRenderArgs(
  versionOrRoute?: string | WebRouteContext,
  maybeRoute?: WebRouteContext,
): { version: string; route?: WebRouteContext } {
  return typeof versionOrRoute === "string"
    ? { version: versionOrRoute, route: maybeRoute }
    : { version: WEB_RENDERER_VERSION, route: versionOrRoute };
}

export function renderWebDocument(
  documentInput: WebDocument,
  versionOrRoute?: string | WebRouteContext,
  maybeRoute?: WebRouteContext,
): string {
  const document = ensureDocument(documentInput);
  const { version, route: suppliedRoute } = parseRenderArgs(versionOrRoute, maybeRoute);
  if (!text(version, 64)) throw new Error("WEB_RENDERER_VERSION_INVALID");
  const route = routeOrDefault(document, suppliedRoute);
  const page =
    document.pages.find((candidate) => candidate.slug === route.page) ?? document.pages[0]!;
  const description = document.description ?? page.description ?? document.title;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="${escapeHtml(version)}"><title>${escapeHtml(document.title)}</title><meta name="description" content="${escapeHtml(description)}"></head><body><header><a href="/">${escapeHtml(document.brand.name)}</a></header>${renderPage(document, page, route)}</body></html>`;
}

export function renderWebDocumentBytes(
  document: WebDocument,
  versionOrRoute?: string | WebRouteContext,
  maybeRoute?: WebRouteContext,
): Uint8Array {
  return encoder.encode(renderWebDocument(document, versionOrRoute, maybeRoute));
}

export function webDocumentHashMaterial(
  document: WebDocument,
  versionOrRoute?: string | WebRouteContext,
  maybeRoute?: WebRouteContext,
): Uint8Array {
  const { version, route } = parseRenderArgs(versionOrRoute, maybeRoute);
  // The project content hash covers the WHOLE canonical document, not only the first rendered
  // page. A route-specific hash remains available when a caller explicitly supplies a route.
  const bytes = route
    ? renderWebDocumentBytes(document, version, route)
    : encoder.encode(canonicalWebDocument(document));
  const prefix = encoder.encode(`${version}\n`);
  const material = new Uint8Array(prefix.length + bytes.length);
  material.set(prefix);
  material.set(bytes, prefix.length);
  return material;
}

// Small synchronous SHA-256 implementation keeps this contract package portable to browser and
// edge runtimes. It receives only already-canonical bytes and never hashes request content.
export function sha256Bytes(input: Uint8Array): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const padded = new Uint8Array(((input.length + 9 + 63) >> 6) << 6);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = input.length * 8;
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1)
      words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15]!;
      const y = words[index - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + constants[index]! + words[index]!) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

export function hashWebDocument(
  document: WebDocument,
  versionOrRoute?: string | WebRouteContext,
  maybeRoute?: WebRouteContext,
): string {
  return `sha256:${sha256Bytes(webDocumentHashMaterial(document, versionOrRoute, maybeRoute))}`;
}

export const contentHash = hashWebDocument;

export const rendererIdentity = (document: WebDocument, route?: WebRouteContext) => ({
  rendererVersion: WEB_RENDERER_VERSION,
  contentHash: hashWebDocument(document, route),
  byteLength: renderWebDocumentBytes(document, route).byteLength,
});

export const webRuntimeRetention = {
  idempotencyMs: IDEMPOTENCY_RETENTION_MS,
  abuseBucketMs: ABUSE_BUCKET_RETENTION_MS,
} as const;
