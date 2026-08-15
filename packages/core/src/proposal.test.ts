import { describe, expect, test } from "vitest";
import { BLUEPRINT_FIELDS, FIELD_SPEC } from "./blueprint";
import { CASH_INPUTS } from "./cash";
import { PROPOSAL_TARGETS, proposalTarget } from "./proposal";

describe("the target registry is closed and total", () => {
  test("every CASH_INPUTS field is a target, on its own store", () => {
    for (const spec of CASH_INPUTS) {
      const target = proposalTarget(spec.store, spec.field);
      expect(target, `${spec.field} missing from PROPOSAL_TARGETS`).not.toBeNull();
      expect(target?.valueType).toBe("number");
    }
  });

  test("every model-derivable blueprint field is a profile target", () => {
    for (const field of BLUEPRINT_FIELDS) {
      if (!FIELD_SPEC[field].derivable) continue;
      expect(proposalTarget("profile", field), `${field} missing`).not.toBeNull();
    }
  });

  test("a non-derivable blueprint field is NOT a target", () => {
    // `entities` is graph-derived and `tier` is computed; neither may be proposed.
    expect(proposalTarget("profile", "entities")).toBeNull();
    expect(proposalTarget("profile", "tier")).toBeNull();
  });

  test("no target names a field absent from its source list", () => {
    const cashFields = new Set(CASH_INPUTS.map((s) => `${s.store}:${s.field}`));
    const blueprintFields = new Set<string>(BLUEPRINT_FIELDS);
    for (const t of PROPOSAL_TARGETS) {
      if (t.store === "financeInputs" || t.store === "scorecard") {
        expect(cashFields.has(`${t.store}:${t.field}`), `${t.field} not in CASH_INPUTS`).toBe(true);
      } else if (t.store === "profile") {
        expect(blueprintFields.has(t.field), `${t.field} not in BLUEPRINT_FIELDS`).toBe(true);
      }
    }
  });

  test("no duplicate store+field pair", () => {
    const keys = PROPOSAL_TARGETS.map((t) => `${t.store}:${t.field}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("an unknown pair resolves to null rather than throwing", () => {
    expect(proposalTarget("scorecard", "notAField")).toBeNull();
  });
});
