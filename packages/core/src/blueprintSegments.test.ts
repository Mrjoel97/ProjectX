import { describe, expect, it } from "vitest";
import { BLUEPRINT_FIELDS, type BlueprintField, type BusinessBlueprint } from "./blueprint";
import {
  BLUEPRINT_SEGMENTS,
  firstGap,
  SEGMENT_FLOW,
  segmentFill,
  segmentHeadline,
} from "./blueprintSegments";

const stated = (...values: string[]) => ({ values, origin: "stated" as const });

/** Every field null — the shape `mergeBlueprint` produces for an empty business. */
const blank = (): BusinessBlueprint =>
  Object.fromEntries(BLUEPRINT_FIELDS.map((f) => [f, null])) as unknown as BusinessBlueprint;

const segment = (id: string) => {
  const found = BLUEPRINT_SEGMENTS.find((s) => s.id === id);
  if (!found) throw new Error(`no segment ${id}`);
  return found;
};

describe("SEGMENT_FLOW — the wiring the canvas draws", () => {
  // The bug this guards: a segment is renamed or dropped and an edge points at a node that is no
  // longer drawn, so the canvas renders a wire into empty space.
  it("every endpoint resolves to a real segment", () => {
    const ids = new Set(BLUEPRINT_SEGMENTS.map((s) => s.id));
    for (const edge of SEGMENT_FLOW) {
      expect(ids.has(edge.from), `unknown from: ${edge.from}`).toBe(true);
      expect(ids.has(edge.to), `unknown to: ${edge.to}`).toBe(true);
      expect(edge.from).not.toBe(edge.to);
    }
  });

  it("reaches every segment — no node is left unwired", () => {
    const touched = new Set(SEGMENT_FLOW.flatMap((e) => [e.from, e.to]));
    expect([...BLUEPRINT_SEGMENTS.map((s) => s.id)].filter((id) => !touched.has(id))).toEqual([]);
  });
});

describe("firstGap — where the chain breaks", () => {
  it("returns the first incomplete segment in chain order", () => {
    // Foundation complete, Offer half-done -> Offer is the break, not the later Money model.
    const blueprint = {
      ...blank(),
      oneLineDescription: stated("Fractional CFO"),
      name: stated("Acme"),
      stage: stated("advisory"),
      tier: stated("solopreneur"),
      offering: stated("Retainer"),
    } as BusinessBlueprint;
    expect(firstGap(blueprint)?.id).toBe("offer");
  });

  // The honesty rule: Leads has no fields, so no answer and no document could ever close it.
  // Naming it as the gap would send the user to a specialist to fix an unrecordable thing.
  it("never returns a segment that has no fields to fill", () => {
    const everythingFillable = Object.fromEntries(
      BLUEPRINT_FIELDS.map((f) => [f, stated("known")]),
    ) as unknown as BusinessBlueprint;
    expect(segmentFill(everythingFillable, segment("leads"))).toEqual({ filled: 0, total: 0 });
    expect(firstGap(everythingFillable)).toBeNull();
  });

  it("returns the earliest gap on a blank blueprint", () => {
    expect(firstGap(blank())?.id).toBe("foundation");
  });
});

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
