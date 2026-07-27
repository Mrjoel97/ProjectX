// Pure business-blueprint domain module (CLAUDE.md §1 — Convex-free, portable).
//
// The blueprint is the STANDING business context every agent surface gets, as opposed to
// `vaultGroundHydrated`'s per-query retrieval ("which passages mention X"). It is assembled from
// three inputs — the typed profile (`businessProfile.ts`, free), the entity graph (free DB read),
// and document-derived candidates (ONE model call) — and this module owns the structural half:
// the CLOSED field set, the one totality table every downstream handler indexes, the stated-field
// assembly, the blank-driven probe derivation and the deterministic serializer pair.
//
// Two traps this module exists to make un-steppable-in:
//   - `stage` is `BusinessProfile.stage` — a FREE STRING in the user's own words — and NEVER
//     `tenantProfiles.revenueStage`, which is the closed union `pre-revenue | early-revenue |
//     steady-revenue`. Reading the wrong one is a silent correctness bug no test would catch, so
//     `statedFromProfile` takes a `BusinessProfile` and a `Tier` and nothing else: `revenueStage`
//     is structurally unreachable from here.
//   - `serializeBlueprint` must NEVER emit the literal `- **Persona:**`. `evaluations.ts` and
//     `vault.profileSeedDocs` both use that exact string as a BUSINESS-PROFILE DETECTOR, so a
//     blueprint carrying it is misread as a profile doc by both. The scalar marker is the plain
//     `- <Label>: ` shape for that reason — see `serializeBlueprint`.

import type { BusinessProfile, Tier } from "./businessProfile";

/**
 * The CLOSED field set (17.1-CONTEXT, "The field set is CLOSED"). Fixed and closed, or the diff
 * and the spine cap are both unbounded. Do not add or drop a member without the owner decision
 * that closed this list — and note that adding one is a COMPILE error until `FIELD_SPEC` handles
 * it, which is the point.
 *
 * Array ORDER is the reporting order: probes, serialization and the spine all iterate it, so it
 * is what makes the output byte-deterministic rather than object-key-order dependent.
 */
export const BLUEPRINT_FIELDS = [
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
] as const;

export type BlueprintField = (typeof BLUEPRINT_FIELDS)[number];

/**
 * One field's content. `values` has ONE member for a scalar field, N for a list field, and is
 * NEVER empty — a blank field is `null` on the blueprint, not an empty entry.
 */
export type BlueprintEntry = {
  readonly values: readonly string[];
  /**
   * What the USER asserted vs what the SYSTEM inferred. Drives the `[stated]` / `[source: …]`
   * markers in the spine — the agent must not second-guess a stated fact at the user, and should
   * cite a derived one when it leans on it.
   */
  readonly origin: "stated" | "derived";
  /** Document title backing a derived claim. Present iff `origin === "derived"`. */
  readonly source?: string;
};

/** The blueprint itself: every field present, `null` when blank. Total by construction. */
export type BusinessBlueprint = { readonly [K in BlueprintField]: BlueprintEntry | null };

type FieldSpec = {
  /** Serializer + spine heading. */
  label: string;
  /** true ⇒ rendered as a bullet list; false ⇒ one inline value. */
  list: boolean;
  /** Per-field char cap applied when rendering the spine (the ≈2500-char standing-context budget). */
  cap: number;
  /**
   * Whether the MODEL may propose this field. false ⇒ never probed, never accepted from a
   * candidate. `name` (the user names their own business), `tier` (`deriveTier` owns it) and
   * `entities` (the graph owns it) are all false — none has a model-derivable source.
   */
  derivable: boolean;
  /** The retrieval probe used when this field is BLANK. `null` iff `!derivable`. */
  probe: string | null;
};

/**
 * THE totality table. One `satisfies Record<BlueprintField, FieldSpec>` is what makes the
 * serializer, the diff, the probe map and the spine caps total AT ONCE.
 *
 * A `Record<…>` lookup, deliberately NOT a switch and not a ternary: a switch's `default` branch
 * makes a new field silently inherit some other field's behaviour and makes the coverage test
 * vacuous forever (the `TIER_REASON` idiom, `businessProfile.ts:330`, itself the Phase-15 `armFor`
 * lesson). This way a new field without a spec is a COMPILE error, here, once.
 *
 * The probe wording is deliberately a natural retrieval QUERY, not an instruction: these feed
 * `vaultGroundHydrated`, and one blank field costs one probe. A fully-typed profile therefore
 * costs almost nothing, and all surviving probes feed ONE model call — never one call per field.
 */
export const FIELD_SPEC = {
  name: { label: "Name", list: false, cap: 80, derivable: false, probe: null },
  oneLineDescription: {
    label: "One-line description",
    list: false,
    cap: 280,
    derivable: true,
    probe: "what this business does, described in one sentence",
  },
  stage: {
    label: "Stage",
    list: false,
    cap: 100,
    derivable: true,
    probe: "what stage the business is at — an idea, launching, growing, or established",
  },
  tier: { label: "Tier", list: false, cap: 20, derivable: false, probe: null },
  offering: {
    label: "Offering",
    list: false,
    cap: 280,
    derivable: true,
    probe: "what the business sells, its products and services",
  },
  targetCustomer: {
    label: "Target customer",
    list: false,
    cap: 240,
    derivable: true,
    probe: "who the business sells to — its customers, market and audience",
  },
  revenueModel: {
    label: "Revenue model",
    list: false,
    cap: 240,
    derivable: true,
    probe: "how the business makes money — pricing, packages, subscriptions, fees and margins",
  },
  bindingConstraint: {
    label: "Binding constraint",
    list: false,
    cap: 240,
    derivable: true,
    probe: "the single biggest bottleneck or constraint limiting growth",
  },
  primaryGoals: {
    label: "Primary goals",
    list: true,
    cap: 280,
    derivable: true,
    probe: "the goals, targets and objectives the business is working toward",
  },
  knownConstraints: {
    label: "Known constraints",
    list: true,
    cap: 280,
    derivable: true,
    probe: "the constraints, limitations, risks and blockers the business is working under",
  },
  entities: { label: "Entities", list: true, cap: 240, derivable: false, probe: null },
} as const satisfies Record<BlueprintField, FieldSpec>;

/** A field's content is PRESENT when it trims non-empty — the `SLOT_PRESENT` rule, not `!value`. */
const surviving = (values: readonly string[]): string[] =>
  values.filter((v) => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());

/**
 * The STATED half of a blueprint: what the user typed, plus the two things the system already
 * knows without a model call (the tier row and the entity graph).
 *
 * `stage` comes from `profile.stage` — the free string. `tier` comes from the `tier` ARGUMENT
 * (the `tenantProfiles` row is the record) and is `stated`, because the user answered the facts
 * it was derived from. `entities` are `derived` with a `source`: they are INFERRED from documents,
 * so they must not wear the `[stated]` marker the agent reads as settled.
 *
 * `revenueModel` and `bindingConstraint` are deliberately absent — nothing TYPES them today, so
 * they are exactly the fields the probe pass exists to fill (widening `BusinessProfile` for them
 * would drag the Phase-12 evaluator, the onboarding validator and the profile form along).
 *
 * A field with no surviving value is simply ABSENT from the record, never an entry with an empty
 * value — that absence is what `probesFor` reads as a blank.
 */
export function statedFromProfile(
  profile: BusinessProfile,
  tier: Tier,
  entities: readonly string[]
): Partial<Record<BlueprintField, BlueprintEntry>> {
  const out: Partial<Record<BlueprintField, BlueprintEntry>> = {};
  const put = (
    field: BlueprintField,
    raw: readonly string[],
    origin: BlueprintEntry["origin"],
    source?: string
  ): void => {
    const values = surviving(raw);
    if (values.length === 0) return;
    out[field] = source === undefined ? { values, origin } : { values, origin, source };
  };

  put("name", [profile.name], "stated");
  put("oneLineDescription", [profile.oneLineDescription], "stated");
  put("stage", [profile.stage], "stated");
  put("tier", [tier], "stated");
  put("offering", [profile.offering], "stated");
  put("targetCustomer", [profile.targetCustomer], "stated");
  put("primaryGoals", profile.primaryGoals, "stated");
  put("knownConstraints", profile.knownConstraints, "stated");
  put("entities", entities, "derived", "entity graph");
  return out;
}

/**
 * The probes for what is still BLANK, in `BLUEPRINT_FIELDS` order.
 *
 * Cost scales with blanks, not with the field set: a typed field generates no probe, a
 * non-derivable field generates none ever. Accepts both a `statedFromProfile` record and a whole
 * `BusinessBlueprint` (a `null` field reads as blank), so the drift rebuild uses the same function.
 */
export function probesFor(
  stated: Partial<Record<BlueprintField, BlueprintEntry | null>>
): { field: BlueprintField; query: string }[] {
  const probes: { field: BlueprintField; query: string }[] = [];
  for (const field of BLUEPRINT_FIELDS) {
    if (stated[field] != null) continue;
    const { probe } = FIELD_SPEC[field];
    if (probe === null) continue; // not model-derivable — no source to probe
    probes.push({ field, query: probe });
  }
  return probes;
}
