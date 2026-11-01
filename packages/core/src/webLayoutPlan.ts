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
export type WebLayoutPlan = LayoutChoices &
  ({ readonly version: 1 } | { readonly version: 2; readonly designTokens: WebDesignTokens });
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
  version: 2,
  ...CHOICES,
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
  if (plan.version !== 1 && plan.version !== 2) return false;
  if (
    !exact(plan, [
      "version",
      ...Object.keys(CHOICES),
      ...(plan.version === 2 ? ["designTokens"] : []),
    ])
  )
    return false;
  return (
    Object.entries(CHOICES).every(
      ([key, choices]) =>
        typeof plan[key] === "string" &&
        (choices as readonly string[]).includes(plan[key] as string),
    ) &&
    (plan.version === 1 || validateWebDesignTokens(plan.designTokens))
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
  return {
    ...base,
    version: 2,
    designTokens: {
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
    },
  };
}
