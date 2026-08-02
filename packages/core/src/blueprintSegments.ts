// The blueprint's PRESENTATION grouping (Phase: profile tabs, 2026-08-02 spec §4).
//
// A segment is a business-shaped bucket over the CLOSED field set in `blueprint.ts`. It adds no
// data: `BLUEPRINT_FIELDS` is unchanged and this module never widens it. Segments are named after
// `SPECIALIST_ROUTES` so each one has an agent that could fill it — the "Ask <specialist>" action
// is deferred (spec D5), which is why `specialist` is declared here but not yet consumed.
//
// Lives in core, not in the web app, because the totality guarantee below is domain logic and is
// worth testing without a browser (CLAUDE.md §1).

import type { BlueprintField, BusinessBlueprint } from "./blueprint";
import type { SpecialistRoute } from "./specialists";

export type BlueprintSegment = {
  readonly id: string;
  readonly label: string;
  /** Reporting order WITHIN the segment. The first entry is the most identifying field — it is
   *  what `segmentHeadline` shows on the overview tile, so this order is load-bearing. */
  readonly fields: readonly BlueprintField[];
  /** The specialist that could fill this segment, or null where no agent owns it. */
  readonly specialist: SpecialistRoute | null;
};

export const BLUEPRINT_SEGMENTS = [
  {
    id: "foundation",
    label: "Foundation",
    fields: ["oneLineDescription", "name", "stage", "tier"],
    specialist: null,
  },
  {
    id: "offer",
    label: "Offer",
    fields: ["offering", "targetCustomer"],
    specialist: "offer-architect",
  },
  {
    id: "money-model",
    label: "Money model",
    fields: ["revenueModel"],
    specialist: "money-model-designer",
  },
  // No field TODAY. Renders "Not tracked yet" rather than a fake denominator, and is the first
  // segment real per-department content would land in (spec D1).
  { id: "leads", label: "Leads", fields: [], specialist: "lead-engine" },
  {
    id: "direction",
    label: "Direction",
    fields: ["primaryGoals", "knownConstraints", "bindingConstraint"],
    specialist: null,
  },
  { id: "evidence", label: "Evidence", fields: ["entities"], specialist: "research" },
] as const satisfies readonly BlueprintSegment[];

type AssignedField = (typeof BLUEPRINT_SEGMENTS)[number]["fields"][number];

/**
 * COMPILE-TIME TOTALITY. A blueprint field that no segment claims makes the line below an error,
 * here, once — the `FIELD_SPEC` discipline (`blueprint.ts:103`) applied to the UI grouping.
 *
 * The tuple wrapper is load-bearing: a bare `BlueprintField extends AssignedField` DISTRIBUTES
 * over the union and the `never` branch is then absorbed by the union of the others, so an
 * unassigned field would pass. `[A] extends [B]` compares the unions whole.
 */
type EveryFieldAssigned = [BlueprintField] extends [AssignedField] ? true : never;
const _everyFieldAssigned: EveryFieldAssigned = true;
void _everyFieldAssigned;

/** How much of a segment is known. `total` is the segment's own field count — never padded. */
export function segmentFill(
  blueprint: BusinessBlueprint,
  segment: BlueprintSegment,
): { filled: number; total: number } {
  let filled = 0;
  for (const field of segment.fields) if (blueprint[field] !== null) filled += 1;
  return { filled, total: segment.fields.length };
}

/**
 * The one-line summary for the overview tile: the FIRST populated field in the segment's own
 * order. Deterministic by construction — there is no ranking heuristic to drift. Clipping to one
 * visual line is the caller's job (CSS), not this function's.
 */
export function segmentHeadline(
  blueprint: BusinessBlueprint,
  segment: BlueprintSegment,
): string | null {
  for (const field of segment.fields) {
    const entry = blueprint[field];
    if (entry !== null && entry.values.length > 0) return entry.values.join(" · ");
  }
  return null;
}
