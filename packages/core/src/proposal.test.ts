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

import { classifyProposal, sweepable } from "./proposal";

const fact = {
  target: { store: "scorecard" as const, field: "cac" },
  value: 340,
  confidence: "high" as const,
  origin: "stated" as const,
  actor: "agent" as const,
  basis: "vaultDoc:abc123",
  observedAt: 1_700_000_000_000,
  sourceLocator: { kind: "vault_doc" as const, vaultDocId: "abc123" },
};

describe("what may be swept into accept-all", () => {
  test("a fact filling a blank is sweepable", () => {
    expect(classifyProposal(fact, null)).toBe("blank");
    expect(sweepable("blank")).toBe(true);
  });

  test("overwriting a value the USER stated is a contradiction, never swept", () => {
    const current = { value: 150, statedByUser: true, statedAt: 1_600_000_000_000 };
    expect(classifyProposal(fact, current)).toBe("overwrite");
    expect(sweepable("overwrite")).toBe(false);
  });

  test("overwriting an AGENT-written value is NOT a contradiction", () => {
    // The owner's word is what accept-all must never quietly replace. A prior agent figure
    // carries no such authority, so a newer one may sweep.
    const current = { value: 150, statedByUser: false, statedAt: 1_600_000_000_000 };
    expect(classifyProposal(fact, current)).toBe("blank");
  });

  test("a fact older than the stored figure is stale, never swept", () => {
    const current = { value: 150, statedByUser: false, statedAt: 1_800_000_000_000 };
    expect(classifyProposal(fact, current)).toBe("stale");
    expect(sweepable("stale")).toBe(false);
  });

  test("staleness is checked before the overwrite rule, so an old fact over a user value is stale", () => {
    const current = { value: 150, statedByUser: true, statedAt: 1_800_000_000_000 };
    expect(classifyProposal(fact, current)).toBe("stale");
  });

  test("an unknown stored time does not make a fact stale", () => {
    // A legacy row with no recorded time must not silently block every new fact.
    const current = { value: 150, statedByUser: false, statedAt: null };
    expect(classifyProposal(fact, current)).toBe("blank");
  });

  test("an equal timestamp is not stale — only strictly older is", () => {
    const current = { value: 150, statedByUser: false, statedAt: fact.observedAt };
    expect(classifyProposal(fact, current)).toBe("blank");
  });
});
