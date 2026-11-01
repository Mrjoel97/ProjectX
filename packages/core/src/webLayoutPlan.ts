import type { WebDocument } from "@pikar/contracts/webRuntime";

/** Closed presentation instructions; no provider-authored markup or executable style. */
type LayoutChoices = {
  readonly hero: "overlay-left" | "overlay-centered" | "split";
  readonly sectionLayout: "editorial-columns" | "stacked";
  readonly services: "rows" | "columns";
  readonly gallery: "grid" | "carousel";
  readonly spacing: "relaxed" | "compact";
  readonly headingScale: "balanced" | "display";
  readonly motion: "none" | "subtle";
};
export type WebDesignTokens = {
  readonly colors: {
    readonly paper: string;
    readonly card: string;
    readonly ink: string;
    readonly muted: string;
    readonly accent: string;
    readonly rule: string;
  };
  readonly typography: {
    readonly heading: "editorial-serif" | "modern-serif" | "humanist-sans" | "geometric-sans";
    readonly body: "humanist-sans" | "geometric-sans";
  };
  readonly spacing: {
    readonly contentWidth: number;
    readonly sectionGap: number;
    readonly copyMeasure: number;
    readonly heroMinHeight: number;
  };
  readonly footer: "light" | "dark";
};
export const WEB_SECTION_COMPOSITIONS = [
  "editorial-lead",
  "numbered-services",
  "service-panels",
  "image-caption",
  "contact-panel",
  "principles-grid",
  "contact-copy",
] as const;
export type WebSectionPresentation = {
  readonly pageSlug: string;
  readonly nodeId: string;
  readonly composition: (typeof WEB_SECTION_COMPOSITIONS)[number];
};
export type WebPagePresentation = {
  pageSlug: string;
  heroFrame: "content" | "wide-inset";
  chrome: "default" | "editorial-compact";
  contactSurface: "default" | "paper-deep";
};
export type WebHeadingTreatment = {
  pageSlug: string;
  nodeId: string;
  breakAfter: number[];
  emphasisRanges: { start: number; end: number; tone: "accent" | "muted" }[];
};
export type WebLayoutPlan = LayoutChoices &
  (
    | { readonly version: 1 }
    | { readonly version: 2; readonly designTokens: WebDesignTokens }
    | {
        readonly version: 3;
        readonly designTokens: WebDesignTokens;
        readonly sections: WebSectionPresentation[];
        readonly pagePresentation?: WebPagePresentation[];
        readonly headingTreatments?: WebHeadingTreatment[];
      }
  );
const CHOICES = {
  hero: ["overlay-left", "overlay-centered", "split"],
  sectionLayout: ["editorial-columns", "stacked"],
  services: ["rows", "columns"],
  gallery: ["grid", "carousel"],
  spacing: ["relaxed", "compact"],
  headingScale: ["balanced", "display"],
  motion: ["none", "subtle"],
} as const;
const COLOR_KEYS = ["paper", "card", "ink", "muted", "accent", "rule"] as const;
const BOUNDS = {
  contentWidth: [960, 1440],
  sectionGap: [32, 144],
  copyMeasure: [36, 80],
  heroMinHeight: [360, 760],
} as const;
const HEADINGS = ["editorial-serif", "modern-serif", "humanist-sans", "geometric-sans"] as const;
const BODIES = ["humanist-sans", "geometric-sans"] as const;
/** Descriptive JSON contract shared by generation and review prompts. */
export const WEB_LAYOUT_PLAN_PROMPT_SCHEMA = {
  version: 3,
  ...CHOICES,
  pagePresentation: {
    optional: true,
    count: "0..8 unique exact pageSlug",
    heroFrame: ["content", "wide-inset"],
    chrome: ["default", "editorial-compact"],
    contactSurface: ["default", "paper-deep"],
  },
  headingTreatments: {
    optional: true,
    count: "0..48 unique exact pageSlug+hero/section nodeId",
    breakAfter: "0..4 UTF-16 source offsets at whitespace boundaries",
    emphasisRanges:
      "0..4 nonoverlapping {start,end,tone:accent|muted} UTF-16 source spans; never replace source text; never split a surrogate pair",
  },
  sections: {
    count:
      "0..24 unique existing top-level section/form references; cover every eligible node; empty only when none exist; preserve order/content",
    pageSlug: "exact existing page slug",
    nodeId: "exact existing section/form ID",
    composition: WEB_SECTION_COMPOSITIONS,
  },
  designTokens: {
    colors: Object.fromEntries(COLOR_KEYS.map((key) => [key, "six-digit hex color (#RRGGBB)"])),
    typography: { heading: HEADINGS, body: BODIES },
    spacing: {
      contentWidth: "integer pixels 960..1440",
      sectionGap: "integer pixels 32..144",
      copyMeasure: "integer characters 36..80",
      heroMinHeight: "integer pixels 360..760",
    },
    footer: ["light", "dark"],
  },
} as const;
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function validateWebDesignTokens(value: unknown): value is WebDesignTokens {
  if (
    !exact(value, ["colors", "typography", "spacing", "footer"]) ||
    !exact(value.colors, COLOR_KEYS) ||
    !exact(value.typography, ["heading", "body"]) ||
    !exact(value.spacing, Object.keys(BOUNDS))
  )
    return false;
  const colors = value.colors,
    typography = value.typography,
    spacing = value.spacing;
  return (
    COLOR_KEYS.every(
      (key) => typeof colors[key] === "string" && /^#[0-9a-fA-F]{6}$/.test(colors[key] as string),
    ) &&
    HEADINGS.includes(typography.heading as (typeof HEADINGS)[number]) &&
    BODIES.includes(typography.body as (typeof BODIES)[number]) &&
    Object.entries(BOUNDS).every(
      ([key, [min, max]]) =>
        typeof spacing[key] === "number" &&
        Number.isInteger(spacing[key]) &&
        (spacing[key] as number) >= min &&
        (spacing[key] as number) <= max,
    ) &&
    (value.footer === "light" || value.footer === "dark")
  );
}
export function validateWebLayoutPlan(value: unknown): value is WebLayoutPlan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (plan.version !== 1 && plan.version !== 2 && plan.version !== 3) return false;
  if (
    !exact(plan, [
      "version",
      ...Object.keys(CHOICES),
      ...(plan.version !== 1 ? ["designTokens"] : []),
      ...(plan.version === 3
        ? [
            "sections",
            ...(Object.hasOwn(plan, "pagePresentation") ? ["pagePresentation"] : []),
            ...(Object.hasOwn(plan, "headingTreatments") ? ["headingTreatments"] : []),
          ]
        : []),
    ])
  )
    return false;
  return (
    Object.entries(CHOICES).every(
      ([key, choices]) =>
        typeof plan[key] === "string" &&
        (choices as readonly string[]).includes(plan[key] as string),
    ) &&
    (plan.version === 1 || validateWebDesignTokens(plan.designTokens)) &&
    (plan.version !== 3 ||
      (validateSections(plan.sections) &&
        validatePresentation(plan.pagePresentation) &&
        validateTreatments(plan.headingTreatments)))
  );
}
/** Keep v1 byte order unchanged; v2 nested keys are canonical after database rehydration. */
export function canonicalWebLayoutPlan(value: WebLayoutPlan): WebLayoutPlan {
  if (!validateWebLayoutPlan(value)) throw new Error("WEB_LAYOUT_PLAN_INVALID");
  const base = {
    version: 1 as const,
    hero: value.hero,
    sectionLayout: value.sectionLayout,
    services: value.services,
    gallery: value.gallery,
    spacing: value.spacing,
    headingScale: value.headingScale,
    motion: value.motion,
  };
  if (value.version === 1) return base;
  const t = value.designTokens;
  const canonicalTokens: WebDesignTokens = {
    colors: {
      paper: t.colors.paper,
      card: t.colors.card,
      ink: t.colors.ink,
      muted: t.colors.muted,
      accent: t.colors.accent,
      rule: t.colors.rule,
    },
    typography: { heading: t.typography.heading, body: t.typography.body },
    spacing: {
      contentWidth: t.spacing.contentWidth,
      sectionGap: t.spacing.sectionGap,
      copyMeasure: t.spacing.copyMeasure,
      heroMinHeight: t.spacing.heroMinHeight,
    },
    footer: t.footer,
  };
  if (value.version === 2) return { ...base, version: 2, designTokens: canonicalTokens };
  return {
    ...base,
    version: 3,
    designTokens: canonicalTokens,
    ...(value.pagePresentation === undefined
      ? {}
      : {
          pagePresentation: [...value.pagePresentation]
            .sort((a, b) => compareText(a.pageSlug, b.pageSlug))
            .map(({ pageSlug, heroFrame, chrome, contactSurface }) => ({
              pageSlug,
              heroFrame,
              chrome,
              contactSurface,
            })),
        }),
    ...(value.headingTreatments === undefined
      ? {}
      : {
          headingTreatments: [...value.headingTreatments]
            .sort((a, b) => compareText(`${a.pageSlug}:${a.nodeId}`, `${b.pageSlug}:${b.nodeId}`))
            .map(({ pageSlug, nodeId, breakAfter, emphasisRanges }) => ({
              pageSlug,
              nodeId,
              breakAfter: [...breakAfter].sort((a, b) => a - b),
              emphasisRanges: [...emphasisRanges]
                .sort((a, b) => a.start - b.start)
                .map(({ start, end, tone }) => ({ start, end, tone })),
            })),
        }),
    sections: [...value.sections]
      .sort((a, b) =>
        a.pageSlug < b.pageSlug
          ? -1
          : a.pageSlug > b.pageSlug
            ? 1
            : a.nodeId < b.nodeId
              ? -1
              : a.nodeId > b.nodeId
                ? 1
                : 0,
      )
      .map(({ pageSlug, nodeId, composition }) => ({ pageSlug, nodeId, composition })),
  };
}

function validatePresentation(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 8) return false;
  const seen = new Set();
  return value.every(
    (v) =>
      exact(v, ["pageSlug", "heroFrame", "chrome", "contactSurface"]) &&
      typeof v.pageSlug === "string" &&
      !seen.has(v.pageSlug) &&
      seen.add(v.pageSlug) &&
      ["content", "wide-inset"].includes(String(v.heroFrame)) &&
      ["default", "editorial-compact"].includes(String(v.chrome)) &&
      ["default", "paper-deep"].includes(String(v.contactSurface)),
  );
}
function validateTreatments(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 48) return false;
  const seen = new Set();
  return value.every((v) => {
    if (
      !exact(v, ["pageSlug", "nodeId", "breakAfter", "emphasisRanges"]) ||
      typeof v.pageSlug !== "string" ||
      typeof v.nodeId !== "string" ||
      seen.has(`${v.pageSlug}:${v.nodeId}`) ||
      !Array.isArray(v.breakAfter) ||
      v.breakAfter.length > 4 ||
      !v.breakAfter.every((n) => Number.isInteger(n) && n > 0 && n < 10000) ||
      new Set(v.breakAfter).size !== v.breakAfter.length ||
      !Array.isArray(v.emphasisRanges) ||
      v.emphasisRanges.length > 4
    )
      return false;
    seen.add(`${v.pageSlug}:${v.nodeId}`);
    const ranges = v.emphasisRanges;
    if (
      !ranges.every(
        (r) =>
          exact(r, ["start", "end", "tone"]) &&
          Number.isInteger(r.start) &&
          Number.isInteger(r.end) &&
          Number(r.start) >= 0 &&
          Number(r.end) > Number(r.start) &&
          Number(r.end) <= 10000 &&
          ["accent", "muted"].includes(String(r.tone)),
      )
    )
      return false;
    const ordered = [...ranges].sort((a, b) => a.start - b.start);
    return ordered.every((r, i) => i === 0 || ordered[i - 1].end <= r.start);
  });
}
function validateSections(value: unknown): value is readonly WebSectionPresentation[] {
  if (!Array.isArray(value) || value.length > 24) return false;
  const refs = new Set<string>();
  return value.every((section) => {
    if (
      !exact(section, ["pageSlug", "nodeId", "composition"]) ||
      typeof section.pageSlug !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(section.pageSlug) ||
      typeof section.nodeId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(section.nodeId) ||
      !WEB_SECTION_COMPOSITIONS.includes(
        section.composition as WebSectionPresentation["composition"],
      )
    )
      return false;
    const key = `${section.pageSlug}:${section.nodeId}`;
    if (refs.has(key)) return false;
    refs.add(key);
    return true;
  });
}
/** Bind annotations to canonical content, never model-authored routing or synthetic node IDs.
 * Only top-level sections/forms are eligible. No annotation changes document order or content.
 */
export function validateWebLayoutPlanForDocument(
  document: WebDocument,
  plan: unknown,
): plan is WebLayoutPlan {
  if (!validateWebLayoutPlan(plan)) return false;
  if (plan.version !== 3) return true;
  if (
    plan.pagePresentation?.some(
      (ref) => document.pages.filter((p) => p.slug === ref.pageSlug).length !== 1,
    )
  )
    return false;
  for (const ref of plan.headingTreatments ?? []) {
    const page = document.pages.find((p) => p.slug === ref.pageSlug);
    const nodes = page?.nodes.filter(
      (n) => (n.kind === "hero" || n.kind === "section") && n.id === ref.nodeId,
    );
    if (nodes?.length !== 1) return false;
    const heading = nodes[0] && "heading" in nodes[0] ? nodes[0].heading : undefined;
    if (!heading) return false;
    const boundary = (n: number) =>
      n >= 0 &&
      n <= heading.length &&
      !(
        n > 0 &&
        n < heading.length &&
        /[\uD800-\uDBFF]/.test(heading.charAt(n - 1)) &&
        /[\uDC00-\uDFFF]/.test(heading.charAt(n))
      );
    if (
      ref.breakAfter.some(
        (n) =>
          !boundary(n) ||
          n >= heading.length ||
          !(/\s/.test(heading.slice(n - 1, n)) || /\s/.test(heading.slice(n, n + 1))),
      )
    )
      return false;
    if (ref.emphasisRanges.some((r) => !boundary(r.start) || !boundary(r.end))) return false;
  }

  const required = document.pages.flatMap((page) =>
    page.nodes
      .filter((node) => node.kind === "section" || node.kind === "form")
      .map((node) => ({ pageSlug: page.slug, nodeId: "id" in node ? node.id : "" })),
  );
  if (
    required.length !== plan.sections.length ||
    required.some(
      (ref) =>
        !plan.sections.some(
          (section) => section.pageSlug === ref.pageSlug && section.nodeId === ref.nodeId,
        ),
    )
  )
    return false;
  if (plan.gallery === "carousel") {
    const pages = plan.sections
      .filter((ref) => ref.composition === "image-caption")
      .map((ref) => ref.pageSlug);
    if (new Set(pages).size !== pages.length) return false;
  }
  return plan.sections.every((ref) => {
    const pages = document.pages.filter((page) => page.slug === ref.pageSlug);
    if (pages.length !== 1) return false;
    const nodes = pages[0]?.nodes.filter((node) => "id" in node && node.id === ref.nodeId) ?? [];
    if (nodes.length !== 1) return false;
    const node = nodes[0];
    if (!node) return false;
    if (ref.composition === "contact-panel") return node.kind === "form";
    if (node.kind !== "section") return false;
    if (ref.composition === "principles-grid")
      return (
        node.children.length === 3 &&
        node.children.every(
          (child) =>
            child.kind === "section" &&
            !!child.heading?.trim() &&
            child.children.length > 0 &&
            child.children.every((item) => item.kind === "text"),
        )
      );
    if (ref.composition === "contact-copy")
      return (
        !!node.heading?.trim() &&
        node.children.length > 0 &&
        node.children.every((child) => child.kind === "text" || child.kind === "cta")
      );
    if (ref.composition === "image-caption")
      return (
        node.children.some((child) => child.kind === "media") &&
        node.children.every((child) => child.kind === "media" || child.kind === "text")
      );
    if (ref.composition === "editorial-lead")
      return (
        !!node.heading?.trim() &&
        node.children.length > 0 &&
        node.children.every((child) => child.kind === "text")
      );
    return (
      node.children.length > 0 &&
      node.children.every(
        (child) =>
          child.kind === "text" ||
          (child.kind === "section" &&
            !!child.heading?.trim() &&
            child.children.every((item) => item.kind === "text")),
      )
    );
  });
}
