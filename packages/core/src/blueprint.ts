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

// ── The stored blueprint markdown ──────────────────────────────────────────────────────────────
//
// Mirrors `serializeProfile`/`deserializeProfile` in shape and inherits its invariant verbatim:
//   "Deterministic = same input yields byte-identical output (no dates, no ordering churn) so
//    re-embedding on edit replaces cleanly and diffs stay meaningful."
// Here that is load-bearing twice over: the staleness count and the confirmation date are computed
// at READ time in the spine, and either one baked into the stored text would break the rebuild diff
// (every rebuild would "differ") and the `contentHash` dedup.
//
// The scalar marker prefix is the plain `- <Label>: `, deliberately NOT `- **<Label>:** `:
// `- **Persona:**` is the exact BUSINESS-PROFILE DETECTOR string in `evaluations.ts` and
// `vault.profileSeedDocs`, and the bolded shape is one careless edit away from it.

const HEADING = "# Business blueprint";
const STATED = "[stated]";
const SOURCE_PREFIX = "source: ";

/**
 * `[stated]` / `[source: <title>]` — the suffix that round-trips `origin` and `source`.
 *
 * ponytail: a `derived` entry with no `source` serializes as an empty title and reads back as
 * `source: ""`, because the type contract is "present iff `origin === 'derived'`". Ceiling: that
 * one malformed shape does not round-trip. Upgrade path: make `source` required on a `derived`
 * entry via a discriminated union if a producer is ever able to omit it.
 */
const marker = (entry: BlueprintEntry): string =>
  entry.origin === "stated" ? STATED : `[${SOURCE_PREFIX}${entry.source ?? ""}]`;

/**
 * Split `"<value> [stated]"` / `"<value> [source: <title>]"` back into its parts.
 *
 * The suffix is parsed from the LAST `[` on the line, so a VALUE containing brackets still parses
 * and a source TITLE containing `]` still round-trips. Returns `null` for anything that does not
 * carry a recognized marker — the "degrade, never throw" rule.
 */
function parseMarked(rest: string): BlueprintEntry | null {
  const open = rest.lastIndexOf("[");
  const close = rest.lastIndexOf("]");
  if (open === -1 || close < open) return null;
  const value = rest.slice(0, open).trim();
  if (value === "") return null;
  const mark = rest.slice(open + 1, close);
  if (mark === "stated") return { values: [value], origin: "stated" };
  if (mark.startsWith(SOURCE_PREFIX))
    return { values: [value], origin: "derived", source: mark.slice(SOURCE_PREFIX.length) };
  return null;
}

/**
 * Render a blueprint to the deterministic markdown stored as its `business_blueprint` vault doc.
 *
 * Driven off `FIELD_SPEC[f].label` / `.list` and iterated in `BLUEPRINT_FIELDS` order, so a new
 * field cannot be forgotten and the byte output cannot drift with object key order. A `null` field
 * is simply omitted — `deserializeBlueprint` fills it back as `null`.
 */
export function serializeBlueprint(b: BusinessBlueprint): string {
  const scalars: string[] = [];
  const sections: string[] = [];
  for (const field of BLUEPRINT_FIELDS) {
    const entry = b[field];
    if (entry === null) continue;
    const [first] = entry.values;
    if (first === undefined) continue; // an empty entry is a blank field, not an empty section
    const spec = FIELD_SPEC[field];
    const mark = marker(entry);
    if (spec.list) {
      sections.push("", `## ${spec.label}`, "", ...entry.values.map((v) => `- ${v} ${mark}`));
    } else {
      scalars.push(`- ${spec.label}: ${first} ${mark}`);
    }
  }
  return [HEADING, "", ...scalars, ...sections, ""].join("\n");
}

/**
 * Inverse of `serializeBlueprint` — parses by the serializer's FIXED MARKERS, never line offsets
 * (the `deserializeProfile` rule).
 *
 * TOTAL by construction: it iterates `BLUEPRINT_FIELDS` and fills every one of the eleven fields,
 * `null` when absent. It NEVER throws — a deleted-and-replaced vault doc, or any foreign blob, must
 * degrade to "no blueprint" rather than crash a grounding call.
 */
export function deserializeBlueprint(markdown: string): BusinessBlueprint {
  const lines = markdown.split("\n");

  const scalar = (label: string): BlueprintEntry | null => {
    const prefix = `- ${label}: `;
    const line = lines.find((l) => l.startsWith(prefix));
    return line === undefined ? null : parseMarked(line.slice(prefix.length));
  };

  const section = (label: string): BlueprintEntry | null => {
    const start = lines.findIndex((l) => l.trim() === `## ${label}`);
    if (start === -1) return null;
    const values: string[] = [];
    let origin: BlueprintEntry["origin"] = "stated";
    let source: string | undefined;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.startsWith("#")) break;
      if (!line.startsWith("- ")) continue;
      const parsed = parseMarked(line.slice(2));
      if (parsed === null) continue;
      // Origin is a property of the FIELD, not of an individual value — the first item carries it.
      if (values.length === 0) {
        origin = parsed.origin;
        source = parsed.source;
      }
      values.push(...parsed.values);
    }
    if (values.length === 0) return null;
    return source === undefined ? { values, origin } : { values, origin, source };
  };

  return Object.fromEntries(
    BLUEPRINT_FIELDS.map((field) => {
      const spec = FIELD_SPEC[field];
      return [field, spec.list ? section(spec.label) : scalar(spec.label)];
    })
    // `Object.fromEntries` cannot express the per-key mapped type; the map above is driven off
    // BLUEPRINT_FIELDS, so every key is present by construction.
  ) as unknown as BusinessBlueprint;
}
