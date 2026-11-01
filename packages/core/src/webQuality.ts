import type { WebDocument, WebNode } from "@pikar/contracts/webRuntime";
import { hasUnsafeWebMarkup } from "./webCarouselRuntime";
import { escapeWebText, sha256Bytes, validateWebDocument } from "./webRuntime";

export const WEB_QUALITY_POLICY_VERSION = "web-quality-v1" as const;
export type WebQualityIssue = {
  readonly pageSlug?: string;
  readonly code: string;
  readonly repair: string;
};
export type WebQualityArtifact = { readonly pageSlug: string; readonly html: string };

/** Deterministic checks on code-owned rendered artifacts, NOT an HTML sanitizer or visual review.
 * A pass never certifies provider fidelity, contrast over photography or browser layout. */
export function assessWebQuality(input: {
  document: WebDocument;
  artifacts: readonly WebQualityArtifact[];
  routeSlug: string;
}) {
  const issues: WebQualityIssue[] = [];
  const add = (code: string, repair: string, pageSlug?: string) =>
    issues.push({ code, repair, ...(pageSlug ? { pageSlug } : {}) });
  const validation = validateWebDocument(input.document);
  if (!validation.ok) {
    add("invalid_document", "Repair the structured document before rendering.");
    return result();
  }
  const document = validation.value;
  const paths = new Set(document.pages.map((page) => `/p/${input.routeSlug}/${page.slug}`));
  const localTarget = (path: string, pageSlug?: string) => {
    if (!paths.has(path))
      add(
        "unresolved_local_target",
        "Point navigation and local actions at an existing page.",
        pageSlug,
      );
  };
  document.navigation.forEach((item) => {
    localTarget(item.path);
  });
  const seen = new Set<string>();
  for (const artifact of input.artifacts) {
    if (seen.has(artifact.pageSlug) || !document.pages.some((p) => p.slug === artifact.pageSlug))
      add(
        "unexpected_artifact",
        "Render exactly one artifact for each document page.",
        artifact.pageSlug,
      );
    seen.add(artifact.pageSlug);
  }
  for (const page of document.pages) {
    const artifact = input.artifacts.find((entry) => entry.pageSlug === page.slug);
    if (!artifact) {
      add("missing_artifact", "Render the missing page before review.", page.slug);
      continue;
    }
    const html = artifact.html;
    if (!/^<!doctype html>/i.test(html.trim()) || !/<\/html>\s*$/i.test(html))
      add("incomplete_artifact", "Produce a complete native HTML document.", page.slug);
    if (hasUnsafeWebMarkup(html))
      add("executable_artifact", "Render only approved code-owned components.", page.slug);
    if ((html.match(/<h1(?:\s|>)/gi) ?? []).length !== 1)
      add("page_heading", "Give each page exactly one clear primary heading.", page.slug);
    if (!/<meta\s+[^>]*name=["']viewport["']/i.test(html))
      add("viewport_missing", "Include the native responsive viewport declaration.", page.slug);
    if (/animation\s*:/i.test(html) && !/prefers-reduced-motion\s*:\s*reduce/i.test(html))
      add(
        "reduced_motion_missing",
        "Provide a reduced-motion alternative to animation.",
        page.slug,
      );
    const walk = (node: WebNode): void => {
      if (node.kind === "navigation")
        node.items.forEach((item) => {
          localTarget(item.path, page.slug);
        });
      if (node.kind === "cta" && node.target.kind === "local")
        localTarget(node.target.path, page.slug);
      if (node.kind === "media") {
        if (!html.includes(`data-asset-ref="${escapeWebText(node.storageRef)}"`))
          add(
            "image_not_rendered",
            "Render the approved image rather than silently dropping it.",
            page.slug,
          );
        if (!html.includes(`alt="${escapeWebText(node.alt)}"`))
          add("image_alt_not_rendered", "Preserve the approved image description.", page.slug);
      }
      if (node.kind === "form") {
        const endpoint = `/p/${input.routeSlug}/${page.slug}/forms/${node.id}`;
        if (!html.includes(`action="${endpoint}"`) || !html.includes(escapeWebText(node.consent)))
          add(
            "inquiry_not_connected",
            "Preserve the native inquiry endpoint and supplied consent.",
            page.slug,
          );
      }
      if (node.kind === "section") node.children.forEach(walk);
    };
    page.nodes.forEach(walk);
  }
  return result();

  function result() {
    return {
      policyVersion: WEB_QUALITY_POLICY_VERSION,
      ok: issues.length === 0,
      issues,
      artifactHashes: input.artifacts.map((artifact) => ({
        pageSlug: artifact.pageSlug,
        contentHash: sha256Bytes(new TextEncoder().encode(artifact.html)),
      })),
      // This explicit state prevents a static pass being promoted into browser evidence.
      browserReviewRequired: true as const,
      requiredBrowserChecks: [
        "desktop_mobile_layout",
        "image_loading",
        "contrast",
        "keyboard_navigation",
        "reduced_motion",
        "design_fidelity",
      ] as const,
    };
  }
}
