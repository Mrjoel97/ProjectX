/** Closed layout instructions that a design provider can select without authoring executable UI. */
export type WebLayoutPlan = {
  readonly version: 1;
  readonly hero: "overlay-left" | "overlay-centered" | "split";
  readonly sectionLayout: "editorial-columns" | "stacked";
  readonly services: "rows" | "columns";
  readonly gallery: "grid" | "carousel";
  readonly spacing: "relaxed" | "compact";
  readonly headingScale: "balanced" | "display";
  readonly motion: "none" | "subtle";
};

const CHOICES = {
  hero: ["overlay-left", "overlay-centered", "split"],
  sectionLayout: ["editorial-columns", "stacked"],
  services: ["rows", "columns"],
  gallery: ["grid", "carousel"],
  spacing: ["relaxed", "compact"],
  headingScale: ["balanced", "display"],
  motion: ["none", "subtle"],
} as const;

export function validateWebLayoutPlan(value: unknown): value is WebLayoutPlan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (
    plan.version !== 1 ||
    Object.keys(plan).length !== 8 ||
    Object.keys(plan).some((key) => key !== "version" && !Object.hasOwn(CHOICES, key))
  )
    return false;
  return Object.entries(CHOICES).every(
    ([key, choices]) =>
      typeof plan[key] === "string" && (choices as readonly string[]).includes(plan[key] as string),
  );
}

/** Fixed key order makes persisted provider plans hash-identical after database rehydration. */
export function canonicalWebLayoutPlan(value: WebLayoutPlan): WebLayoutPlan {
  if (!validateWebLayoutPlan(value)) throw new Error("WEB_LAYOUT_PLAN_INVALID");
  return {
    version: 1,
    hero: value.hero,
    sectionLayout: value.sectionLayout,
    services: value.services,
    gallery: value.gallery,
    spacing: value.spacing,
    headingScale: value.headingScale,
    motion: value.motion,
  };
}
