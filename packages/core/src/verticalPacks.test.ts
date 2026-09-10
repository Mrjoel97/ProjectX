import { describe, expect, expectTypeOf, it } from "vitest";
import { TIERS } from "./businessProfile";
import {
  recommendVerticals,
  toolsForVerticalWorkflow,
  VERTICAL_IDS,
  VERTICAL_PACKS,
  VERTICAL_REASONS,
  type VerticalEvidence,
  type VerticalId,
  type VerticalWorkflowId,
  verticalIdForSkill,
  verticalSkillName,
  verticalState,
} from "./verticalPacks";
import { LEAF_FORBIDDEN_OPERATIONS, WORKFLOW_PACKS } from "./workflowPacks";

const ready = (): VerticalEvidence => ({
  profileConfirmed: true,
  tier: "sme",
  confirmedNeeds: VERTICAL_IDS,
  repeatCounts: Object.fromEntries(VERTICAL_IDS.map((id) => [id, 3])),
  sources: ["vault"],
  released: VERTICAL_IDS,
  disabled: [],
  reviewReady: VERTICAL_IDS,
  confirmedLegalPlaybook: true,
  deterministicDataValidationReady: true,
  visualSourceReady: true,
  connectorVariants: [],
});

describe("vertical policy contract", () => {
  it("reserves exact native names without recognizing arbitrary registry entries", () => {
    expect(VERTICAL_IDS.map(verticalSkillName)).toEqual([
      "vertical-legal",
      "vertical-hr",
      "vertical-product",
      "vertical-design",
      "vertical-engineering",
      "vertical-data",
    ]);
    for (const id of VERTICAL_IDS) expect(verticalIdForSkill(verticalSkillName(id))).toBe(id);
    for (const name of ["process-sop", "vertical-bio", "__proto__", "vertical-LEGAL"])
      expect(verticalIdForSkill(name)).toBeNull();
  });
  it("has exactly six total definitions and rejects excluded and unknown ids", () => {
    expect(Object.keys(VERTICAL_PACKS)).toEqual([
      "legal",
      "hr",
      "product",
      "design",
      "engineering",
      "data",
    ]);
    expect(new Set(Object.values(VERTICAL_PACKS).map((v) => v.workflowId)).size).toBe(6);
    for (const id of ["bio", "bio-research", "science", "unknown", "__proto__"]) {
      expect(() => verticalState(id as VerticalId, ready())).toThrow("UNKNOWN_VERTICAL");
      expect(() => toolsForVerticalWorkflow(id as VerticalWorkflowId)).toThrow(
        "UNKNOWN_VERTICAL_WORKFLOW",
      );
    }
    for (const id of VERTICAL_IDS) {
      const definition = VERTICAL_PACKS[id];
      expect(definition.id).toBe(id);
      expect(definition.output).toBe("document");
      expect(definition.outputContractId).toBe(`${id}-output.v1`);
      expect(definition.disclaimerId).toBe(`${id}-review.v1`);
      expect(definition.connectorGate).toBeTruthy();
      expect(definition.requiredReview).toBeTruthy();
      expect(definition.disablePolicy).toBe("block-new-starts-preserve-artifacts");
      expect(definition.rollbackPolicy).toBe("exact-previously-active-version");
      expect(WORKFLOW_PACKS[definition.baseTemplateId]).toBeDefined();
    }
  });

  it("keeps every tier and recommendation state on the same minimal native grant", () => {
    expectTypeOf(toolsForVerticalWorkflow).parameters.toEqualTypeOf<[VerticalWorkflowId]>();
    for (const id of VERTICAL_IDS) {
      for (const tier of TIERS) {
        for (const patch of [
          {},
          { disabled: [id] },
          { sources: [] },
          { released: [] },
          { profileConfirmed: false },
        ]) {
          const evidence = { ...ready(), tier, ...patch };
          verticalState(id, evidence);
          recommendVerticals(evidence);
          expect(toolsForVerticalWorkflow(VERTICAL_PACKS[id].workflowId)).toEqual([
            "saveAsDocument",
            "searchVault",
          ]);
          expect(VERTICAL_PACKS[id].operations.filter((o) => o.state === "forbidden")).toEqual(
            LEAF_FORBIDDEN_OPERATIONS,
          );
        }
      }
    }
  });

  it("covers every closed reason and distinguishes insufficient evidence from a missing prerequisite", () => {
    const seen = new Set<string>();
    const cases: Array<[VerticalId, Partial<VerticalEvidence>, string, string]> = [
      ["legal", { profileConfirmed: false }, "hidden", "unconfirmed-profile"],
      ["legal", { confirmedNeeds: [] }, "hidden", "no-confirmed-need"],
      ["legal", { repeatCounts: {} }, "hidden", "insufficient-repeat-use"],
      ["legal", { released: [] }, "hidden", "not-released"],
      ["legal", { disabled: ["legal"] }, "disabled", "disabled"],
      ["legal", { sources: [] }, "blocked", "missing-source"],
      ["legal", { reviewReady: [] }, "blocked", "review-required"],
      ["legal", { confirmedLegalPlaybook: false }, "blocked", "playbook-required"],
      ["data", { deterministicDataValidationReady: false }, "blocked", "validator-unavailable"],
      ["design", { visualSourceReady: false }, "blocked", "missing-source"],
      ["product", { connectorVariants: ["product"] }, "blocked", "connector-not-approved"],
      ["legal", {}, "available", "confirmed-repeat-workflow"],
    ];
    for (const [id, patch, state, reason] of cases) {
      const result = verticalState(id, { ...ready(), ...patch });
      expect(result.state).toBe(state);
      expect(result.reason).toBe(reason);
      seen.add(result.reason);
    }
    expect([...seen].sort()).toEqual([...VERTICAL_REASONS].sort());
    for (const count of [-1, 0, 1, 1.5, NaN, Infinity])
      expect(verticalState("legal", { ...ready(), repeatCounts: { legal: count } }).state).toBe(
        "hidden",
      );
    expect(verticalState("legal", { ...ready(), sources: [] }).missingSources).toEqual(["vault"]);
  });

  it("caps recommendations at two with deterministic ranking and independent disable", () => {
    expect(recommendVerticals(ready()).map((r) => r.id)).toEqual(["legal", "hr"]);
    expect(
      recommendVerticals({ ...ready(), repeatCounts: { legal: 3, data: 5, product: 4 } }).map(
        (r) => r.id,
      ),
    ).toEqual(["data", "product"]);
    expect(recommendVerticals({ ...ready(), disabled: ["legal"] }).map((r) => r.id)).toEqual([
      "hr",
      "product",
    ]);
    expect(recommendVerticals({ ...ready(), released: [] })).toEqual([]);
    expect(recommendVerticals({ ...ready(), profileConfirmed: false })).toEqual([]);
    for (const id of VERTICAL_IDS)
      expect(verticalState(id, { ...ready(), connectorVariants: [id] }).reason).toBe(
        "connector-not-approved",
      );
  });
});
