import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_FIELDS,
  type BlueprintEntry,
  type BlueprintField,
  type BusinessBlueprint,
  deserializeBlueprint,
  FIELD_SPEC,
  probesFor,
  serializeBlueprint,
  statedFromProfile,
} from "./blueprint";
import type { BusinessProfile } from "./businessProfile";

/** A fully-typed profile. Overrides let a case blank exactly the fields it cares about. */
const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  name: "Acme Ltd",
  oneLineDescription: "We roast single-origin coffee for independent cafés.",
  persona: "solopreneur",
  stage: "pre-launch idea",
  offering: "Single-origin beans, roasted to order",
  targetCustomer: "Independent cafés in the north of England",
  primaryGoals: ["Reach £10k MRR"],
  knownConstraints: ["One person, no staff"],
  ...over,
});

const entry = (value: string): BlueprintEntry => ({ values: [value], origin: "stated" });

/** A whole blueprint: every field `null` unless the case supplies one. */
const blueprint = (over: Partial<Record<BlueprintField, BlueprintEntry>> = {}): BusinessBlueprint =>
  Object.fromEntries(
    BLUEPRINT_FIELDS.map((f) => [f, over[f] ?? null])
  ) as unknown as BusinessBlueprint;

describe("the closed field set and its totality table", () => {
  it("FIELD_SPEC covers every blueprint field and nothing else (item 6, runtime half)", () => {
    // The COMPILE half is `satisfies Record<BlueprintField, FieldSpec>` in the module — a 12th
    // field without a spec entry is a typecheck error, mutation-verified in the plan's gate.
    expect(Object.keys(FIELD_SPEC).sort()).toEqual([...BLUEPRINT_FIELDS].sort());
  });

  it("the field set is exactly the eleven locked fields", () => {
    expect([...BLUEPRINT_FIELDS]).toEqual([
      "name",
      "oneLineDescription",
      "stage",
      "tier",
      "offering",
      "targetCustomer",
      "revenueModel",
      "bindingConstraint",
      "primaryGoals",
      "knownConstraints",
      "entities",
    ]);
  });

  it("a probe exists exactly when the field is model-derivable", () => {
    for (const f of BLUEPRINT_FIELDS) {
      expect({ f, hasProbe: FIELD_SPEC[f].probe !== null }).toEqual({
        f,
        hasProbe: FIELD_SPEC[f].derivable,
      });
    }
  });

  it("name, tier and entities are never model-derivable", () => {
    expect(FIELD_SPEC.name.derivable).toBe(false);
    expect(FIELD_SPEC.tier.derivable).toBe(false);
    expect(FIELD_SPEC.entities.derivable).toBe(false);
  });
});

describe("statedFromProfile", () => {
  it("puts the profile's FREE-STRING stage on `stage`, never a revenueStage union member (item 9)", () => {
    const stated = statedFromProfile(profile({ stage: "pre-launch idea" }), "solopreneur", []);
    expect(stated.stage).toEqual({ values: ["pre-launch idea"], origin: "stated" });
    // "pre-launch idea" is not a member of REVENUE_STAGES — reading `tenantProfiles.revenueStage`
    // instead would have produced one of those three literals.
    expect(["pre-revenue", "early-revenue", "steady-revenue"]).not.toContain(
      stated.stage?.values[0]
    );
    expect(stated.tier).toEqual({ values: ["solopreneur"], origin: "stated" });
  });

  it("marks the typed fields `stated` and the graph entities `derived` with a source", () => {
    const stated = statedFromProfile(profile(), "sme", ["Acme", "Bean Co"]);
    expect(stated.name).toEqual({ values: ["Acme Ltd"], origin: "stated" });
    expect(stated.primaryGoals).toEqual({ values: ["Reach £10k MRR"], origin: "stated" });
    expect(stated.entities).toEqual({
      values: ["Acme", "Bean Co"],
      origin: "derived",
      source: "entity graph",
    });
  });

  it("never states revenueModel or bindingConstraint — nothing types them today", () => {
    const stated = statedFromProfile(profile(), "solopreneur", ["Acme"]);
    expect(stated.revenueModel).toBeUndefined();
    expect(stated.bindingConstraint).toBeUndefined();
  });

  it("a blank or whitespace-only field is ABSENT, never an entry with an empty value", () => {
    const stated = statedFromProfile(
      profile({ name: "", offering: "   ", primaryGoals: [], knownConstraints: ["", "  "] }),
      "startup",
      []
    );
    for (const f of ["name", "offering", "primaryGoals", "knownConstraints", "entities"] as const) {
      expect({ f, value: stated[f] }).toEqual({ f, value: undefined });
    }
    // …and a partially-blank list keeps only the surviving values.
    expect(statedFromProfile(profile({ primaryGoals: ["", "Ship v2"] }), "startup", []).primaryGoals)
      .toEqual({ values: ["Ship v2"], origin: "stated" });
  });
});

describe("probesFor — cost scales with BLANKS (item 14)", () => {
  it("a field the user typed generates NO probe", () => {
    const stated = statedFromProfile(profile(), "solopreneur", ["Acme"]);
    // Everything derivable is typed except the two fields no profile carries.
    expect(probesFor(stated).map((p) => p.field)).toEqual(["revenueModel", "bindingConstraint"]);
  });

  it("a blueprint with every derivable field stated costs NOTHING — no probes at all", () => {
    const full: Partial<Record<BlueprintField, BlueprintEntry>> = {};
    for (const f of BLUEPRINT_FIELDS) if (FIELD_SPEC[f].derivable) full[f] = entry("typed");
    expect(probesFor(full)).toEqual([]);
  });

  it("two blanks ⇒ exactly two probes, one per blank field, in BLUEPRINT_FIELDS order", () => {
    const stated: Partial<Record<BlueprintField, BlueprintEntry>> = {
      ...statedFromProfile(profile({ offering: "", targetCustomer: "" }), "solopreneur", []),
      revenueModel: entry("subscription"),
      bindingConstraint: entry("founder time"),
    };
    const probes = probesFor(stated);
    expect(probes.map((p) => p.field)).toEqual(["offering", "targetCustomer"]);
    for (const p of probes) expect(p.query).toBe(FIELD_SPEC[p.field].probe);
  });

  it("never probes a non-derivable field, even when it is blank", () => {
    const fields = probesFor({}).map((p) => p.field);
    expect(fields).not.toContain("name");
    expect(fields).not.toContain("tier");
    expect(fields).not.toContain("entities");
    expect(fields).toHaveLength(BLUEPRINT_FIELDS.filter((f) => FIELD_SPEC[f].derivable).length);
  });
});

// ── The deterministic serializer pair (the STORED blueprint markdown) ──────────────────────────

/** Every field populated, both origins, scalar and list, a source title carrying punctuation. */
const FULL = blueprint({
  name: { values: ["Acme Ltd"], origin: "stated" },
  oneLineDescription: { values: ["We roast single-origin coffee."], origin: "stated" },
  stage: { values: ["pre-launch idea"], origin: "stated" },
  tier: { values: ["solopreneur"], origin: "stated" },
  offering: {
    values: ["Single-origin beans, roasted to order"],
    origin: "derived",
    source: "Pricing & margins] — Q3 (final).pdf",
  },
  targetCustomer: { values: ["Independent cafés"], origin: "derived", source: "Deck.pptx" },
  revenueModel: { values: ["Wholesale + subscription"], origin: "derived", source: "Deck.pptx" },
  bindingConstraint: { values: ["Roasting capacity"], origin: "derived", source: "Ops notes.docx" },
  primaryGoals: { values: ["Reach £10k MRR", "Open a second roastery"], origin: "stated" },
  knownConstraints: { values: ["One person, no staff"], origin: "stated" },
  entities: { values: ["Acme", "Bean Co"], origin: "derived", source: "entity graph" },
});

describe("serializeBlueprint / deserializeBlueprint", () => {
  it("round-trips a FULL blueprint, including a source title containing punctuation (item 1)", () => {
    expect(deserializeBlueprint(serializeBlueprint(FULL))).toEqual(FULL);
  });

  it("round-trips a SPARSE blueprint — the sparse-start common case (item 1)", () => {
    const sparse = blueprint({
      oneLineDescription: { values: ["An idea for a coffee subscription."], origin: "stated" },
    });
    expect(deserializeBlueprint(serializeBlueprint(sparse))).toEqual(sparse);
  });

  it("round-trips an EMPTY blueprint (every field null)", () => {
    const empty = blueprint();
    expect(deserializeBlueprint(serializeBlueprint(empty))).toEqual(empty);
  });

  it("NEVER emits `- **Persona:**` — the profile-detector collision (item 7)", () => {
    // `evaluations.ts` and `vault.profileSeedDocs` both use that EXACT string to detect a
    // business-profile doc; a blueprint carrying it is misread as one by BOTH.
    for (const b of [FULL, blueprint(), blueprint({ tier: entry("solopreneur") })]) {
      expect(serializeBlueprint(b)).not.toContain("- **Persona:**");
      expect(serializeBlueprint(b)).not.toContain("**");
    }
  });

  it("is byte-deterministic and carries no date and no document count (item 8)", () => {
    // The staleness count and the confirmation date are computed at READ time in the spine.
    // Either one inside the stored text breaks the diff and the `contentHash` dedup.
    expect(serializeBlueprint(FULL)).toBe(serializeBlueprint(FULL));
    expect(serializeBlueprint(FULL)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(serializeBlueprint(FULL)).not.toContain("documents added");
  });

  it("marks stated vs derived per field, and keeps the plain `- Label:` scalar shape", () => {
    const md = serializeBlueprint(FULL);
    expect(md).toContain("- Stage: pre-launch idea [stated]");
    expect(md).toContain("- Target customer: Independent cafés [source: Deck.pptx]");
    expect(md).toContain("- Acme [source: entity graph]");
  });

  it("degrades a foreign / unparseable blob to an all-null blueprint rather than throwing", () => {
    // A deleted-and-replaced vault doc must degrade to "no blueprint", never crash a grounding call.
    for (const junk of ["", "not markdown at all", "# Business profile\n\n- **Persona:** sme\n"]) {
      expect(deserializeBlueprint(junk)).toEqual(blueprint());
    }
  });

  it("deserialize is TOTAL — it fills all eleven fields whatever it is handed", () => {
    expect(Object.keys(deserializeBlueprint("garbage")).sort()).toEqual([...BLUEPRINT_FIELDS].sort());
  });
});
