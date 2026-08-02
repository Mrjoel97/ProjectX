import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_FIELDS,
  type BlueprintField,
  type BusinessBlueprint,
} from "./blueprint";
import { BLUEPRINT_SEGMENTS, segmentFill, segmentHeadline } from "./blueprintSegments";

/** Every field null — the shape `mergeBlueprint` produces for an empty business. */
const blank = (): BusinessBlueprint =>
  Object.fromEntries(BLUEPRINT_FIELDS.map((f) => [f, null])) as unknown as BusinessBlueprint;

const segment = (id: string) => {
  const found = BLUEPRINT_SEGMENTS.find((s) => s.id === id);
  if (!found) throw new Error(`no segment ${id}`);
  return found;
};

describe("segment assignment", () => {
  // The bug this guards: a twelfth blueprint field is added and silently never renders.
  it("claims every blueprint field exactly once", () => {
    const claimed = BLUEPRINT_SEGMENTS.flatMap((s) => s.fields as readonly BlueprintField[]);
    expect([...claimed].sort()).toEqual([...BLUEPRINT_FIELDS].sort());
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it("puts bindingConstraint in Direction, not Offer", () => {
    expect(segment("direction").fields).toContain("bindingConstraint");
    expect(segment("offer").fields).not.toContain("bindingConstraint");
  });
});

describe("segmentFill", () => {
  it("counts populated fields against the segment's own size", () => {
    const blueprint = {
      ...blank(),
      offering: { values: ["Fractional CFO retainer"], origin: "stated" },
    } as BusinessBlueprint;
    expect(segmentFill(blueprint, segment("offer"))).toEqual({ filled: 1, total: 2 });
  });

  // Honest zeros: Leads has no fields yet, so it must not invent a denominator.
  it("reports total 0 for a segment with no fields yet", () => {
    expect(segmentFill(blank(), segment("leads"))).toEqual({ filled: 0, total: 0 });
  });
});

describe("segmentHeadline", () => {
  it("returns the FIRST populated field in the segment's own order", () => {
    const blueprint = {
      ...blank(),
      offering: { values: ["Retainer"], origin: "stated" },
      targetCustomer: { values: ["Series-A founders"], origin: "stated" },
    } as BusinessBlueprint;
    expect(segmentHeadline(blueprint, segment("offer"))).toBe("Retainer");
  });

  it("joins a list field's values", () => {
    const blueprint = {
      ...blank(),
      primaryGoals: { values: ["Productize", "Hire an analyst"], origin: "stated" },
    } as BusinessBlueprint;
    expect(segmentHeadline(blueprint, segment("direction"))).toBe("Productize · Hire an analyst");
  });

  it("returns null when nothing in the segment is populated", () => {
    expect(segmentHeadline(blank(), segment("money-model"))).toBeNull();
  });
});
