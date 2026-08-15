import { describe, expect, test } from "vitest";
import { BLUEPRINT_FIELDS, FIELD_SPEC } from "./blueprint";
import type { BusinessProfile } from "./businessProfile";
import { CASH_INPUTS } from "./cash";
import { PROPOSAL_TARGETS, proposalTarget } from "./proposal";

// The `BusinessProfile` keys the profile writer can actually persist into — mirrors
// `proposal.ts`'s private `PROFILE_WRITABLE_FIELDS` EXACTLY (not merely a superset — a looser
// mirror here would blunt the regression guard below) so this test can assert against the real
// write target rather than trusting the registry's own filter to have applied it correctly.
// `persona` is never derivable/proposable (tier is computed, not model-derivable) and
// `primaryGoals`/`knownConstraints` are `string[]` slots a scalar `ProposalTarget` cannot write to
// without list-field handling the applier does not have yet (fix round 2, finding B) — both
// excluded here for the same reason `proposal.ts` excludes them.
const PROFILE_KEYS: readonly (keyof BusinessProfile)[] = [
  "name",
  "oneLineDescription",
  "stage",
  "offering",
  "targetCustomer",
];

describe("the target registry is closed and total", () => {
  test("every CASH_INPUTS field is a target, on its own store", () => {
    for (const spec of CASH_INPUTS) {
      const target = proposalTarget(spec.store, spec.field);
      expect(target, `${spec.field} missing from PROPOSAL_TARGETS`).not.toBeNull();
      expect(target?.valueType).toBe("number");
    }
  });

  test("every model-derivable blueprint field that has a BusinessProfile slot is a profile target", () => {
    for (const field of BLUEPRINT_FIELDS) {
      if (!FIELD_SPEC[field].derivable) continue;
      if (!(PROFILE_KEYS as readonly string[]).includes(field)) continue;
      expect(proposalTarget("profile", field), `${field} missing`).not.toBeNull();
    }
  });

  test("every profile target names a real, SCALAR-WRITABLE BusinessProfile key — no silent-drop or writer-crash field", () => {
    // The regression guard for BOTH fix rounds. `revenueModel` / `bindingConstraint`: derivable
    // blueprint fields with NO slot on `BusinessProfile` — a proposal for either passed
    // `proposalTarget`'s existence check, got merged onto the write object by the applier, and was
    // silently dropped by `serializeProfile` on write (fix round 1, finding 2). `primaryGoals` /
    // `knownConstraints`: DO have a slot, but it is `string[]`, not the scalar every profile
    // `ProposalTarget` is registered as — a proposal for either would merge a bare string onto a
    // list slot and throw inside `serializeProfile`'s `bullets()` (fix round 2, finding B). This
    // must fail if any of the four, or any other unwritable/non-scalar field, is ever re-added to
    // the profile slice of `PROPOSAL_TARGETS`.
    for (const t of PROPOSAL_TARGETS) {
      if (t.store !== "profile") continue;
      expect(
        (PROFILE_KEYS as readonly string[]).includes(t.field),
        `${t.field} is a profile target but not a scalar-writable BusinessProfile key`,
      ).toBe(true);
    }
    expect(proposalTarget("profile", "revenueModel")).toBeNull();
    expect(proposalTarget("profile", "bindingConstraint")).toBeNull();
    expect(proposalTarget("profile", "primaryGoals")).toBeNull();
    expect(proposalTarget("profile", "knownConstraints")).toBeNull();
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
