import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_FIELDS,
  type BlueprintEntry,
  type BlueprintField,
  type BusinessBlueprint,
  deserializeBlueprint,
  FIELD_SPEC,
  mergeBlueprint,
  probesFor,
  renderSpine,
  SPINE_CHAR_CAP,
  serializeBlueprint,
  statedFromProfile,
  validateCandidates,
} from "./blueprint";
import type { BusinessProfile } from "./businessProfile";
import { GOALS_SPINE_MAX, type Goal } from "./goals";

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
    BLUEPRINT_FIELDS.map((f) => [f, over[f] ?? null]),
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
      stated.stage?.values[0],
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
      [],
    );
    for (const f of ["name", "offering", "primaryGoals", "knownConstraints", "entities"] as const) {
      expect({ f, value: stated[f] }).toEqual({ f, value: undefined });
    }
    // …and a partially-blank list keeps only the surviving values.
    expect(
      statedFromProfile(profile({ primaryGoals: ["", "Ship v2"] }), "startup", []).primaryGoals,
    ).toEqual({ values: ["Ship v2"], origin: "stated" });
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

/** Every field carrying a 10,000-char value AND a long source title — the pathological max.
 *  Module-scoped (not just the hard-cap describe's) so the goals-block worst-case test below
 *  can combine it with an oversized goals list instead of the softer `FULL` fixture. */
const HUGE = blueprint(
  Object.fromEntries(
    BLUEPRINT_FIELDS.map((f) => [
      f,
      {
        values: ["x".repeat(10_000), "y".repeat(10_000)],
        origin: "derived",
        source: "A quarterly business review deck with an extremely long file name.pptx",
      },
    ]),
  ) as Partial<Record<BlueprintField, BlueprintEntry>>,
);

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
    expect(Object.keys(deserializeBlueprint("garbage")).sort()).toEqual(
      [...BLUEPRINT_FIELDS].sort(),
    );
  });
});

// ── The citation trust boundary (item 3) ───────────────────────────────────────────────────────

/** The index-parallel grounding results a probe pass produced. The model cites an INDEX into this. */
const SOURCES = [
  { docId: "d1", title: "Pricing deck.pdf" },
  { docId: "d2", title: "Ops notes.docx" },
];

describe("validateCandidates — an invented citation DROPS the claim (item 3)", () => {
  it("out-of-range, the -1 sentinel, and a non-integer index are ALL dropped, none kept uncited", () => {
    const out = validateCandidates(
      [
        { field: "offering", values: ["Beans"], sourceIndex: SOURCES.length }, // one past the end
        { field: "targetCustomer", values: ["Cafés"], sourceIndex: -1 }, // strict-schema "no source"
        { field: "revenueModel", values: ["Wholesale"], sourceIndex: 999 },
        { field: "bindingConstraint", values: ["Roasting"], sourceIndex: 1.5 },
        { field: "stage", values: ["Growing"], sourceIndex: Number.NaN },
      ],
      SOURCES,
    );
    // The KEY SET, not one field: nothing was emitted at all, so nothing was emitted with a
    // missing or placeholder source.
    expect(Object.keys(out.derived)).toEqual([]);
    expect(out.dropped.map((d) => [d.field, d.reason])).toEqual([
      ["offering", "bad_citation"],
      ["targetCustomer", "bad_citation"],
      ["revenueModel", "bad_citation"],
      ["bindingConstraint", "bad_citation"],
      ["stage", "bad_citation"],
    ]);
  });

  it("with NO sources at all, every candidate is dropped — index 0 cites nothing", () => {
    const out = validateCandidates([{ field: "offering", values: ["Beans"], sourceIndex: 0 }], []);
    expect(Object.keys(out.derived)).toEqual([]);
    expect(out.dropped).toEqual([{ field: "offering", reason: "bad_citation" }]);
  });

  it("the model cannot rename the business or reclassify the tier — non-derivable fields drop", () => {
    const out = validateCandidates(
      [
        { field: "name", values: ["Globex"], sourceIndex: 0 },
        { field: "tier", values: ["enterprise"], sourceIndex: 0 },
        { field: "entities", values: ["Globex"], sourceIndex: 0 },
        { field: "profitMargin", values: ["40%"], sourceIndex: 0 },
        { field: "__proto__", values: ["owned"], sourceIndex: 0 },
      ],
      SOURCES,
    );
    expect(Object.keys(out.derived)).toEqual([]);
    expect(out.dropped.map((d) => [d.field, d.reason])).toEqual([
      ["name", "not_derivable"],
      ["tier", "not_derivable"],
      ["entities", "not_derivable"],
      ["profitMargin", "unknown_field"],
      ["__proto__", "unknown_field"],
    ]);
  });

  it("an empty or whitespace-only candidate drops — an entry is NEVER empty", () => {
    const out = validateCandidates(
      [
        { field: "offering", values: [], sourceIndex: 0 },
        { field: "revenueModel", values: ["  ", "\n"], sourceIndex: 1 },
      ],
      SOURCES,
    );
    expect(Object.keys(out.derived)).toEqual([]);
    expect(out.dropped.map((d) => d.reason)).toEqual(["empty", "empty"]);
  });

  it("a SURVIVING candidate carries origin 'derived' and the source DOCUMENT TITLE", () => {
    const out = validateCandidates(
      [
        { field: "offering", values: ["  Single-origin beans  "], sourceIndex: 1 },
        {
          field: "primaryGoals",
          values: ["Reach £10k MRR", "  ", "Open a roastery"],
          sourceIndex: 0,
        },
      ],
      SOURCES,
    );
    expect(out.derived).toEqual({
      // The TITLE, not the docId — it is what the spine's `[source: …]` marker shows the agent.
      offering: { values: ["Single-origin beans"], origin: "derived", source: "Ops notes.docx" },
      primaryGoals: {
        values: ["Reach £10k MRR", "Open a roastery"],
        origin: "derived",
        source: "Pricing deck.pdf",
      },
    });
    expect(out.dropped).toEqual([]);
  });

  it("the FIRST candidate for a field wins — `evaluations.ts:271`'s rule, ONE rule in the codebase", () => {
    const out = validateCandidates(
      [
        { field: "offering", values: ["First"], sourceIndex: 0 },
        { field: "offering", values: ["Second"], sourceIndex: 1 },
      ],
      SOURCES,
    );
    expect(out.derived.offering).toEqual({
      values: ["First"],
      origin: "derived",
      source: "Pricing deck.pdf",
    });
    // A duplicate is not a validation failure — the field DID make it in, so it is not reported.
    expect(out.dropped).toEqual([]);
  });

  it("drops are REPORTED so the live gate can count them (VALIDATION L2: 0 and 8 are both signals)", () => {
    const clean = validateCandidates(
      [{ field: "offering", values: ["Beans"], sourceIndex: 0 }],
      SOURCES,
    );
    expect(clean.dropped).toHaveLength(0);
    const dirty = validateCandidates(
      [
        { field: "offering", values: ["Beans"], sourceIndex: 7 },
        { field: "name", values: ["Globex"], sourceIndex: 0 },
      ],
      SOURCES,
    );
    expect(dirty.dropped).toHaveLength(2);
  });
});

// ── Precedence as CODE, and the two-kind diff (items 2, 5, 29) ─────────────────────────────────

/** A derived entry, always carrying the source title a derived claim must have. */
const derivedEntry = (value: string, source = "Deck.pptx"): BlueprintEntry => ({
  values: [value],
  origin: "derived",
  source,
});

describe("mergeBlueprint — the typed value wins (item 2, the owner-required rule)", () => {
  it("a contradicting derived candidate does NOT change the typed value; it raises ONE row", () => {
    const { blueprint: merged, diff } = mergeBlueprint(
      { targetCustomer: entry("independent consultants") },
      { targetCustomer: derivedEntry("enterprise procurement teams", "Pricing deck.pdf") },
    );

    // The value the user typed survived, still marked as their own words.
    expect(merged.targetCustomer).toEqual({
      values: ["independent consultants"],
      origin: "stated",
    });

    // …and the disagreement is SURFACED, never silently applied.
    expect(diff).toEqual([
      {
        kind: "contradiction",
        field: "targetCustomer",
        stated: { values: ["independent consultants"], origin: "stated" },
        derived: {
          values: ["enterprise procurement teams"],
          origin: "derived",
          source: "Pricing deck.pdf",
        },
      },
    ]);
  });

  it("holds for EVERY field in the closed set — a property, not one hand-picked field", () => {
    const allStated: Partial<Record<BlueprintField, BlueprintEntry>> = {};
    const allDerived: Partial<Record<BlueprintField, BlueprintEntry>> = {};
    for (const f of BLUEPRINT_FIELDS) {
      allStated[f] = entry(`typed ${f}`);
      allDerived[f] = derivedEntry(`derived ${f}`);
    }

    const { blueprint: merged, diff } = mergeBlueprint(allStated, allDerived);

    // There is no branch that assigns a derived entry over a stated one. This loop is what
    // survives someone adding a twelfth field.
    for (const f of BLUEPRINT_FIELDS) {
      expect({ f, entry: merged[f] }).toEqual({ f, entry: allStated[f] });
    }
    expect(diff).toHaveLength(BLUEPRINT_FIELDS.length);
    expect(diff.every((row) => row.kind === "contradiction")).toBe(true);
  });

  it("a derived candidate that AGREES with the typed value raises no row", () => {
    const { blueprint: merged, diff } = mergeBlueprint(
      { offering: entry("Single-origin beans") },
      { offering: derivedEntry("  Single-origin beans  ") },
    );
    expect(merged.offering).toEqual({ values: ["Single-origin beans"], origin: "stated" });
    expect(diff).toEqual([]);
  });
});

describe("mergeBlueprint — diff classification (item 5)", () => {
  it("blank → derived value is an ADDITION", () => {
    const { blueprint: merged, diff } = mergeBlueprint({}, { offering: derivedEntry("Beans") });
    expect(merged.offering).toEqual(derivedEntry("Beans"));
    expect(diff).toEqual([{ kind: "addition", field: "offering", derived: derivedEntry("Beans") }]);
  });

  it("typed ≠ derived is a CONTRADICTION and nothing else", () => {
    const { diff } = mergeBlueprint(
      { stage: entry("pre-launch idea") },
      { stage: derivedEntry("scaling") },
    );
    expect(diff.map((r) => r.kind)).toEqual(["contradiction"]);
  });

  it("unchanged versus `live` is NEITHER — no row at all", () => {
    const live = blueprint({ offering: derivedEntry("Beans") });
    const { diff } = mergeBlueprint({}, { offering: derivedEntry("Beans") }, live);
    expect(diff).toEqual([]);
  });

  it("a CHANGED derived value is still an ADDITION, never a contradiction", () => {
    // `live.offering` was inferred from doc A; this run infers a different value from doc B.
    // A contradiction is only ever raised against content the USER typed — a changed inference
    // replaces a system inference, never user content, so there is nothing for the user to lose
    // by accepting it in the default-ON group.
    const live = blueprint({ offering: derivedEntry("Beans", "Doc A.pdf") });
    const { blueprint: merged, diff } = mergeBlueprint(
      {},
      { offering: derivedEntry("Beans and brewing kit", "Doc B.pdf") },
      live,
    );
    expect(diff).toEqual([
      {
        kind: "addition",
        field: "offering",
        derived: derivedEntry("Beans and brewing kit", "Doc B.pdf"),
      },
    ]);
    expect(merged.offering).toEqual(derivedEntry("Beans and brewing kit", "Doc B.pdf"));
  });

  it("a contradiction row carries BOTH values and the derived source — the UI defaults it OFF", () => {
    const { diff } = mergeBlueprint(
      { targetCustomer: entry("independent consultants") },
      { targetCustomer: derivedEntry("enterprise buyers", "Ops notes.docx") },
    );
    const [row] = diff;
    expect(row?.kind).toBe("contradiction");
    if (row?.kind !== "contradiction") throw new Error("expected a contradiction row");
    expect(row.stated.values).toEqual(["independent consultants"]);
    expect(row.derived.values).toEqual(["enterprise buyers"]);
    expect(row.derived.source).toBe("Ops notes.docx");
  });
});

describe("mergeBlueprint — the drift contract (item 29)", () => {
  it("an identical rebuild produces an EMPTY diff, so nothing is proposed", () => {
    const stated = { name: entry("Acme Ltd"), targetCustomer: entry("Independent cafés") };
    const derived = {
      offering: derivedEntry("Single-origin beans"),
      revenueModel: derivedEntry("Wholesale + subscription", "Pricing deck.pdf"),
    };
    const first = mergeBlueprint(stated, derived);
    expect(first.diff.length).toBeGreaterThan(0);

    // Same inputs, now with the previous result as `live` — the diff IS the drift signal, so an
    // identical rebuild is silently discarded.
    const second = mergeBlueprint(stated, derived, first.blueprint);
    expect(second.diff).toEqual([]);
    expect(second.blueprint).toEqual(first.blueprint);
  });

  it("a rebuild whose probes came back EMPTY carries the previous value forward, silently", () => {
    // Monotone: a blank probe pass must not blank a field the blueprint already had, or every
    // sparse rebuild would read as drift.
    const live = blueprint({
      offering: derivedEntry("Beans"),
      bindingConstraint: derivedEntry("Roasting capacity"),
    });
    const { blueprint: merged, diff } = mergeBlueprint({}, {}, live);
    expect(merged).toEqual(live);
    expect(diff).toEqual([]);
  });

  it("with no `live` at all, every blank field is null and the merge is total", () => {
    const { blueprint: merged } = mergeBlueprint({ name: entry("Acme Ltd") }, {});
    expect(Object.keys(merged).sort()).toEqual([...BLUEPRINT_FIELDS].sort());
    expect(merged.offering).toBeNull();
    expect(merged.name).toEqual(entry("Acme Ltd"));
  });
});

// ── The spine: the standing-context block both seams inject (items 4, 26, 27) ──────────────────

/** The line for one field, or `undefined` if the field did not render. */
const spineLine = (spine: string, field: BlueprintField): string | undefined =>
  spine.split("\n").find((l) => l.startsWith(`- ${FIELD_SPEC[field].label}: `));

describe("renderSpine — origin markers (item 26)", () => {
  const spine = renderSpine(FULL, { unincorporatedCount: 0 });

  it("a stated field carries [stated] and NEVER a [source: …] marker", () => {
    expect(spineLine(spine, "name")).toBe("- Name: Acme Ltd [stated]");
    expect(spineLine(spine, "stage")).toContain("[stated]");
    // What lets the agent treat a stated fact as settled: it is not attributed to a document.
    for (const f of ["name", "stage", "tier", "primaryGoals"] as const) {
      expect({ f, cited: spineLine(spine, f)?.includes("[source:") }).toEqual({ f, cited: false });
    }
  });

  it("a derived field carries [source: <the actual document title>]", () => {
    expect(spineLine(spine, "targetCustomer")).toBe(
      "- Target customer: Independent cafés [source: Deck.pptx]",
    );
    expect(spineLine(spine, "bindingConstraint")).toContain("[source: Ops notes.docx]");
  });

  it("renders a labelled block the model reads as CONTEXT, and skips null fields entirely", () => {
    const sparse = renderSpine(blueprint({ name: entry("Acme Ltd") }), { unincorporatedCount: 0 });
    expect(sparse).toContain("<business_blueprint>");
    expect(sparse).toContain("</business_blueprint>");
    expect(sparse).toContain("- Name: Acme Ltd [stated]");
    expect(spineLine(sparse, "offering")).toBeUndefined();
  });

  it("NEVER emits `- **Persona:**` — the profile detector applies to the spine too", () => {
    // The spine is fed into `evaluations.ts`, whose detector is that exact literal.
    expect(spine).not.toContain("- **Persona:**");
    expect(spine).not.toContain("**");
  });
});

describe("renderSpine — the staleness line (item 27)", () => {
  it("names the count when documents are unincorporated", () => {
    const spine = renderSpine(FULL, { unincorporatedCount: 7 });
    expect(spine).toContain("7 documents");
    expect(spine).toContain("⚠");
    // It must let the agent SAY it is missing something rather than assert into the gap.
    expect(spine).toContain("missing something");
  });

  it("emits NO staleness line at all when the count is 0", () => {
    const spine = renderSpine(FULL, { unincorporatedCount: 0 });
    expect(spine).not.toContain("⚠");
    expect(spine).not.toContain("documents have been added");
  });
});

describe("renderSpine — the hard cap (item 4)", () => {
  it("renders within SPINE_CHAR_CAP no matter how large the values are", () => {
    const spine = renderSpine(HUGE, { unincorporatedCount: 999 });
    expect(spine.length).toBeLessThanOrEqual(SPINE_CHAR_CAP);
  });

  it("truncates each field's line to its FIELD_SPEC cap, VISIBLY", () => {
    const spine = renderSpine(HUGE, { unincorporatedCount: 999 });
    for (const f of BLUEPRINT_FIELDS) {
      const line = spineLine(spine, f);
      expect({ f, over: (line?.length ?? 0) > FIELD_SPEC[f].cap }).toEqual({ f, over: false });
    }
    expect(spine).toContain("…"); // truncation is visible, never silent
  });

  it("the per-field caps SUM under the total — that is what makes the hard assertion a tripwire", () => {
    const capSum = BLUEPRINT_FIELDS.reduce((n, f) => n + FIELD_SPEC[f].cap, 0);
    expect(capSum).toBeLessThan(SPINE_CHAR_CAP);
  });
});

describe("renderSpine — a blueprint with nothing in it", () => {
  it("still names the business as unknown rather than emitting an empty fence", () => {
    const spine = renderSpine(blueprint(), { unincorporatedCount: 0 });
    expect(spine).toContain("<business_blueprint>");
    expect(spine).toContain("(nothing confirmed about this business yet)");
    // Pinned: it does NOT throw, because a grounding call must never crash on a sparse tenant.
    expect(spine.length).toBeLessThanOrEqual(SPINE_CHAR_CAP);
  });
});

describe("renderSpine — the goals block (17.1 goals slice, task 3)", () => {
  it("omits the goals block entirely when no goals are passed", () => {
    expect(renderSpine(FULL, { unincorporatedCount: 0 })).not.toContain("Goals:");
  });

  it("renders the nearest deadlines under a Goals heading", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 7, 8);
    const g = (id: string, text: string, inDays: number): Goal => ({
      id,
      segmentId: "direction",
      text,
      targetDate: now + inDays * day,
      status: "active",
      createdAt: now,
      statusChangedAt: now,
    });
    const spine = renderSpine(FULL, {
      unincorporatedCount: 0,
      goals: [g("b", "Ship the landing page", 12), g("a", "Reach 10 paying customers", 3)],
    });
    expect(spine).toContain("Goals:");
    // Nearest first, and the block sits inside the fence.
    expect(spine.indexOf("Reach 10 paying customers")).toBeLessThan(
      spine.indexOf("Ship the landing page"),
    );
    expect(spine.trimEnd().endsWith("</business_blueprint>")).toBe(true);
  });

  // The near-miss case: HUGE (every field maxed to its FIELD_SPEC cap, capSum 1960) + the
  // longest staleness message + an oversized goals list is the REAL worst case, not a soft one —
  // measured at 2495/2500, a ~5-char margin. Any future FIELD_SPEC cap, GOAL_LINE_CAP or
  // GOALS_BLOCK_CAP change must redo this arithmetic; a test built on `FULL`'s realistic-length
  // values would leave ~1000 slack chars and silently miss a miscalibration here.
  it("stays under the char cap at the true worst case: HUGE fields, max staleness, max goals", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 7, 8);
    const goals: Goal[] = Array.from({ length: GOALS_SPINE_MAX + 2 }, (_, i) => ({
      id: `g${i}`,
      segmentId: "direction",
      text: "z".repeat(400),
      targetDate: now + i * day,
      status: "active" as const,
      createdAt: now,
      statusChangedAt: now,
    }));
    // Does not throw — the tripwire inside renderSpine is the assertion.
    const spine = renderSpine(HUGE, { unincorporatedCount: 999, goals });
    // Measured margin on record: 2495/2500 today (~5 chars). Logged, not just asserted, so a CI
    // run surfaces the exact number without needing a debugger.
    console.log(`worst-case spine: ${spine.length}/${SPINE_CHAR_CAP} chars`);
    expect(spine.length).toBeLessThanOrEqual(SPINE_CHAR_CAP);
    // Only GOALS_SPINE_MAX lines survive, and the block never exceeds its reserved budget.
    expect(spine.split("\n").filter((l) => l.includes("[due "))).toHaveLength(GOALS_SPINE_MAX);
  });
});

// ── Profile confirmation surface — D5 interaction and BRAND source scan ──────────────────────
//
// This scan lives in @pikar/core because the backend vitest environment is `edge-runtime` and
// cannot read app source. The first test is deliberately a POSITIVE non-vacuity anchor: every
// absence rule below could otherwise pass over an empty or wrong file forever.
describe("profile Blueprint confirmation surface source contract", () => {
  const readUi = (name: "BlueprintPanel" | "BlueprintDiff") => {
    try {
      return readFileSync(
        new URL(`../../../apps/web/app/(app)/dashboard/profile/${name}.tsx`, import.meta.url),
        "utf8",
      );
    } catch {
      return "";
    }
  };
  const panelSource = readUi("BlueprintPanel");
  const diffSource = readUi("BlueprintDiff");
  const allSource = `${panelSource}\n${diffSource}`;

  it("first anchors on contradiction review and the confirmation mutation", () => {
    expect(diffSource).toMatch(/contradiction/i);
    expect(diffSource).toMatch(/api\s*\.\s*blueprint\s*\.\s*confirmBlueprint/);
  });

  it("uses brand colour tokens without spending approval amber or hardcoded hex", () => {
    expect(allSource).toMatch(/var\(\s*--[a-z0-9-]+\s*\)/i);
    expect(allSource).not.toMatch(/--held(?:-text)?\b/i);
    expect(allSource).not.toMatch(/#[0-9a-f]{6}\b/i);
  });

  it("defaults the one additions group ON", () => {
    expect(diffSource).toMatch(
      /const\s*\[\s*acceptAdditions\s*,\s*setAcceptAdditions\s*\]\s*=\s*useState\(\s*true\s*\)/,
    );
    expect(diffSource).toMatch(
      /<input[\s\S]{0,500}?name="accept-additions"[\s\S]{0,500}?checked=\{acceptAdditions\}[\s\S]{0,500}?\/>/,
    );
  });

  it("defaults every destructive contradiction checkbox OFF", () => {
    const contradictionInput = diffSource.match(
      /<input[\s\S]{0,700}?data-blueprint-control="contradiction"[\s\S]{0,700}?\/>/,
    )?.[0];
    expect(contradictionInput).toMatch(/checked=\{acceptedContradictions\.has\(row\.field\)\}/);
    expect(contradictionInput).not.toMatch(/defaultChecked|checked\s*=\s*\{\s*true\s*\}/);
  });

  it("labels additions and contradictions in visible words, not colour alone", () => {
    expect(diffSource).toMatch(/>\s*Addition\s*</);
    expect(diffSource).toMatch(/>\s*Contradiction\s*</);
  });

  // page.tsx (the stale-count badge) is NOT part of allSource above and legitimately uses
  // --held for its color-mix background tint and --held-text for its text colour. This guard
  // only stops --held itself from being spent as a text colour there (1.9:1 on light paper,
  // fails WCAG — BRAND §2). It must NOT flag the color-mix background usage.
  it("page.tsx never spends --held itself as a text colour (background tint via color-mix is fine)", () => {
    const pageSource = readFileSync(
      new URL("../../../apps/web/app/(app)/dashboard/profile/page.tsx", import.meta.url),
      "utf8",
    );
    expect(pageSource.length).toBeGreaterThan(0);
    expect(pageSource).not.toMatch(/color:\s*["']?var\(\s*--held\s*\)/i);
  });
});
