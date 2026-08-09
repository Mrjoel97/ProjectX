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
import { GOALS_SPINE_MAX, type Goal, nearestActive, renderGoalLines } from "./goals";

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
  /**
   * The field's budget in the spine, measured on the WHOLE RENDERED LINE (`- Label: value
   * [marker]`), not on the value alone. Line-level is what makes the block's total bound
   * arithmetic — `sum(cap) + framing ≤ SPINE_CHAR_CAP` — provable rather than hopeful, and it is
   * why a very long source title costs the VALUE room instead of overflowing the budget.
   * Unused by `serializeBlueprint`: the STORED markdown is never truncated.
   */
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
    cap: 220,
    derivable: true,
    probe: "what this business does, described in one sentence",
  },
  stage: {
    label: "Stage",
    list: false,
    cap: 80,
    derivable: true,
    probe: "what stage the business is at — an idea, launching, growing, or established",
  },
  tier: { label: "Tier", list: false, cap: 60, derivable: false, probe: null },
  offering: {
    label: "Offering",
    list: false,
    cap: 240,
    derivable: true,
    probe: "what the business sells, its products and services",
  },
  targetCustomer: {
    label: "Target customer",
    list: false,
    cap: 200,
    derivable: true,
    probe: "who the business sells to — its customers, market and audience",
  },
  revenueModel: {
    label: "Revenue model",
    list: false,
    cap: 200,
    derivable: true,
    probe: "how the business makes money — pricing, packages, subscriptions, fees and margins",
  },
  bindingConstraint: {
    label: "Binding constraint",
    list: false,
    cap: 200,
    derivable: true,
    probe: "the single biggest bottleneck or constraint limiting growth",
  },
  primaryGoals: {
    label: "Primary goals",
    list: true,
    cap: 240,
    derivable: true,
    probe: "the goals, targets and objectives the business is working toward",
  },
  knownConstraints: {
    label: "Known constraints",
    list: true,
    cap: 240,
    derivable: true,
    probe: "the constraints, limitations, risks and blockers the business is working under",
  },
  entities: { label: "Entities", list: true, cap: 200, derivable: false, probe: null },
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

// ── The citation trust boundary ────────────────────────────────────────────────────────────────

/**
 * What the model returns — one proposed field, with an INDEX into the grounding results it was
 * shown. Mirrors the strict `jsonSchema` the adapter sends (every property required — strict-mode
 * legality is statically asserted in `llmRedaction.test.ts`), which is why "no source" arrives as
 * the sentinel `-1` rather than an omitted field.
 *
 * `field` is deliberately `string` and not `BlueprintField`: it is UNTRUSTED input, and a cast
 * would launder a model's invention into the type system.
 */
export type DerivedCandidate = {
  readonly field: string;
  readonly values: readonly string[];
  readonly sourceIndex: number;
};

/** Why a candidate did not make it in. Reported, never silent — see `validateCandidates`. */
export type DroppedCandidate = {
  readonly field: string;
  readonly reason: "unknown_field" | "not_derivable" | "bad_citation" | "empty";
};

const isBlueprintField = (f: unknown): f is BlueprintField =>
  typeof f === "string" && (BLUEPRINT_FIELDS as readonly string[]).includes(f);

/**
 * THE TRUST BOUNDARY. Admits only candidates that survive every check; everything else is DROPPED
 * and REPORTED.
 *
 * 17.1-CONTEXT: *"An out-of-range index means an invented citation and that field is **DROPPED, not
 * kept uncited**. A blueprint claim with no traceable source is the confidently-unfounded grounding
 * this whole phase exists to prevent."* CLAUDE.md §8 names validation at a trust boundary as one of
 * the things never to be lazy about.
 *
 * **A missing citation is NOT a formatting problem.** This is the function most likely to be
 * "simplified" later by someone who thinks the fix is to emit the field with a placeholder source —
 * that would put an unfounded claim in front of every agent, wearing a marker that says a document
 * backs it. If the model could not cite it, the system does not know it.
 *
 * `sources` is the index-parallel grounding result the probe pass produced (`vaultGroundHydrated`
 * returns parallel `docIds`/`titles`/`chunks`). The range test handles the `-1` sentinel and an
 * out-of-range index in the SAME branch, because CONTEXT requires they be treated identically.
 */
export function validateCandidates(
  candidates: readonly DerivedCandidate[],
  sources: readonly { docId: string; title: string }[]
): {
  derived: Partial<Record<BlueprintField, BlueprintEntry>>;
  dropped: readonly DroppedCandidate[];
} {
  const derived: Partial<Record<BlueprintField, BlueprintEntry>> = {};
  const dropped: DroppedCandidate[] = [];

  for (const candidate of candidates) {
    const { field } = candidate;
    // Membership test, never a cast — `field` arrives from a model.
    if (!isBlueprintField(field)) {
      dropped.push({ field: String(field), reason: "unknown_field" });
      continue;
    }
    // `name` / `tier` / `entities`: the user names their own business, `deriveTier` owns the tier,
    // the graph owns the entities. A model may not propose any of them.
    if (!FIELD_SPEC[field].derivable) {
      dropped.push({ field, reason: "not_derivable" });
      continue;
    }
    // FIRST wins, matching `evaluations.ts:271`'s documented first-write-wins rule — ONE rule in
    // the codebase, not two. A later duplicate is not a validation failure (the field DID make it
    // in), so it is skipped rather than reported.
    if (derived[field] !== undefined) continue;

    const i = candidate.sourceIndex;
    // Belt AND braces, both deliberate: the range test states the rule, and the lookup's
    // `undefined` is the second gate. Either alone drops an invented citation — do not "tidy" one
    // away on the grounds that the other covers it.
    const source = Number.isInteger(i) && i >= 0 && i < sources.length ? sources[i] : undefined;
    if (source === undefined) {
      dropped.push({ field, reason: "bad_citation" });
      continue;
    }

    const values = surviving(Array.isArray(candidate.values) ? candidate.values : []);
    if (values.length === 0) {
      dropped.push({ field, reason: "empty" });
      continue;
    }

    // The TITLE, not the docId: it is what the spine's `[source: …]` marker shows the agent.
    derived[field] = { values, origin: "derived", source: source.title };
  }

  return { derived, dropped };
}

// ── Precedence, and the two-kind diff ──────────────────────────────────────────────────────────

/**
 * The ONLY two kinds, deliberately. There is no third kind for "the derived value changed":
 * a `contradiction` is only ever raised against content the USER typed, and a changed inference
 * replaces a system inference — never user content — so there is nothing for the user to lose by
 * accepting it fast. That is why a blank/previously-derived field taking a NEW derived value is an
 * `addition`, and why the UI can default the whole addition group ON with one Accept while every
 * contradiction is checkboxed individually and defaulted OFF.
 *
 * Additions are non-destructive BY CONSTRUCTION; contradictions are the only destructive case.
 * The row shape carries enough for the surface to make that split without re-deriving it.
 */
export type BlueprintDiffRow =
  | { kind: "addition"; field: BlueprintField; derived: BlueprintEntry }
  | {
      kind: "contradiction";
      field: BlueprintField;
      stated: BlueprintEntry;
      derived: BlueprintEntry;
    };

/** Order-sensitive equality over the trimmed values. ONE helper — three ad-hoc comparisons is how
 *  the addition and contradiction branches end up disagreeing about what "changed" means. */
const sameValues = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v.trim() === (b[i] ?? "").trim());

/**
 * Merge the stated half with the model's validated candidates. Returns the blueprint AND the diff
 * the confirm surface reviews.
 *
 * **Precedence is CODE, never a prompt (D5).** There is deliberately NO branch in this function
 * that assigns a derived entry over a stated one — that ABSENCE is the guarantee, in the same way
 * `businessProfile.ts:78` records *"there is deliberately no branch that auto-commits a persona"*.
 * The model returns candidates only: it is never shown `live` and is never asked to merge anything,
 * because a merge rule in a prompt is a request while a function with no overwrite branch is a
 * guarantee (the `canComplete`/`missingSlots` reasoning, `businessProfile.ts:345`).
 *
 * Total over `BLUEPRINT_FIELDS`, so a twelfth field cannot silently miss the diff.
 *
 * ponytail: contradiction rows RE-SURFACE on every rebuild — there is no decline-tracking. The
 * user asked for the rebuild, and a standing disagreement between what they typed and what their
 * documents say is worth showing again. Ceiling: it could become noise. Upgrade path: a per-row
 * "dismissed" set keyed by field + derived values. Note this is why item 29's "identical rebuild ⇒
 * empty diff" is about a run where the derived half AGREES with the stated half.
 */
export function mergeBlueprint(
  stated: Partial<Record<BlueprintField, BlueprintEntry>>,
  derived: Partial<Record<BlueprintField, BlueprintEntry>>,
  live?: BusinessBlueprint | null
): { blueprint: BusinessBlueprint; diff: BlueprintDiffRow[] } {
  const out: Partial<Record<BlueprintField, BlueprintEntry | null>> = {};
  const diff: BlueprintDiffRow[] = [];

  for (const field of BLUEPRINT_FIELDS) {
    const typed = stated[field];
    const candidate = derived[field];
    const previous = live?.[field] ?? null;

    if (typed !== undefined) {
      // The user's value. Full stop — the only thing a candidate can do here is raise a row.
      out[field] = typed;
      if (candidate !== undefined && !sameValues(typed.values, candidate.values)) {
        diff.push({ kind: "contradiction", field, stated: typed, derived: candidate });
      }
      continue;
    }

    if (candidate !== undefined) {
      out[field] = candidate;
      // Non-destructive by construction: this field carried no typed content. It is only NEWS if
      // the live blueprint does not already say the same thing.
      if (previous === null || !sameValues(previous.values, candidate.values)) {
        diff.push({ kind: "addition", field, derived: candidate });
      }
      continue;
    }

    // Neither: carry the previous value forward. A rebuild whose probes came back empty must not
    // blank a field the blueprint already had — that keeps the blueprint monotone and keeps the
    // diff empty on an identical rebuild.
    out[field] = previous;
  }

  return { blueprint: out as BusinessBlueprint, diff };
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

// ── The spine: the standing-context block ──────────────────────────────────────────────────────

/**
 * The spine's hard ceiling. Budgeted OUTSIDE `vaultGround.ts`'s `TOTAL_CHAR_CAP` (8000), which
 * stays entirely for retrieval results — the spine is not a search result and must not compete
 * with them for budget.
 *
 * The bound is arithmetic, not hopeful: every field line is capped at `FIELD_SPEC[f].cap`, so the
 * worst case is `sum(cap)` + this block's own framing, and both are fixed constants.
 */
export const SPINE_CHAR_CAP = 2500;

const SPINE_OPEN = "<business_blueprint>";
const SPINE_CLOSE = "</business_blueprint>";
const SPINE_INTRO =
  "Facts marked [stated] are the user's own words — settled, do not second-guess them. " +
  "Facts marked [source: X] were inferred from X — cite X when you lean on it.";
const SPINE_EMPTY = "- (nothing confirmed about this business yet)";
/** A long file name must cost the VALUE room, never the block's budget. */
const SOURCE_TITLE_CAP = 40;

/** Truncate VISIBLY, never silently. `n <= 0` yields nothing at all rather than overflowing by one. */
const clip = (s: string, n: number): string =>
  n <= 0 ? "" : s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;

/** `- <Label>: <values> [marker]`, guaranteed no longer than the field's cap. */
function spineLine(field: BlueprintField, entry: BlueprintEntry): string {
  const spec = FIELD_SPEC[field];
  const head = `- ${spec.label}: `;
  // The marker is the load-bearing half of the line — it is what tells the agent whether a fact is
  // settled or challengeable — so the value yields budget to it, never the other way round.
  const mark =
    entry.origin === "stated"
      ? STATED
      : `[${SOURCE_PREFIX}${clip(entry.source ?? "", SOURCE_TITLE_CAP)}]`;
  const body = surviving(entry.values).join("; ");
  return `${head}${clip(body, spec.cap - head.length - mark.length - 1)} ${mark}`;
}

/**
 * The standing-context block BOTH seams inject verbatim: the cockpit turn prompt (`llm.ts`) and
 * `vaultGroundHydrated`'s `spine` return field. ONE renderer, so the two seams cannot drift.
 *
 * NOT the same bytes as `serializeBlueprint`: this one carries a READ-TIME staleness count, which
 * is exactly why it must not be what gets stored — determinism, and therefore the rebuild diff and
 * the `contentHash` dedup, would break.
 *
 * A labelled fence (the `<vault_context>` idiom already used in `llm.ts`) so the model reads it as
 * CONTEXT rather than as an instruction. Never `- **<Label>:** `: the spine is fed into
 * `evaluations.ts`, whose business-profile detector is the exact literal `- **Persona:**`.
 *
 * Also carries the goals block (spec §5.3 as amended): the `GOALS_SPINE_MAX` nearest deadlines,
 * budgeted to `GOALS_BLOCK_CAP` — the headroom the field caps leave under `SPINE_CHAR_CAP`.
 */
export function renderSpine(
  blueprint: BusinessBlueprint,
  opts: { unincorporatedCount: number; goals?: readonly Goal[] },
): string {
  const lines: string[] = [];
  for (const field of BLUEPRINT_FIELDS) {
    const entry = blueprint[field];
    // A sparse blueprint renders short — a null field is skipped entirely, not rendered as blank.
    if (entry !== null && surviving(entry.values).length > 0) lines.push(spineLine(field, entry));
  }

  // The deadline block (spec §5.3 as amended). Budgeted, not hoped: `renderGoalLines` caps each
  // line and `nearestActive` caps the count, so the worst case is GOALS_BLOCK_CAP — which fits the
  // headroom the field caps leave under SPINE_CHAR_CAP. Absent goals render NOTHING, keeping the
  // no-goals spine byte-identical to before this block existed.
  const goalLines = renderGoalLines(nearestActive(opts.goals ?? [], GOALS_SPINE_MAX));

  const out = [
    SPINE_OPEN,
    SPINE_INTRO,
    "",
    ...(lines.length > 0 ? lines : [SPINE_EMPTY]),
    ...(goalLines.length > 0 ? ["", "Goals:", ...goalLines] : []),
    // Emitted iff something is unincorporated. Worded so the agent can SAY it is missing something
    // instead of asserting into the gap.
    ...(opts.unincorporatedCount > 0
      ? [
          `⚠ ${opts.unincorporatedCount} documents have been added since this was confirmed — ` +
            "it may be missing something; say so rather than guessing.",
        ]
      : []),
    SPINE_CLOSE,
    "",
  ].join("\n");

  // A code-bug tripwire, not a runtime path: it can only fire if the per-field caps were mis-set
  // so they no longer sum under the total. Mutation-verified in 17.1-03 by raising one cap.
  if (out.length > SPINE_CHAR_CAP) {
    throw new Error(
      `blueprint spine is ${out.length} chars, over SPINE_CHAR_CAP (${SPINE_CHAR_CAP}) — the ` +
        "FIELD_SPEC caps no longer sum under the total"
    );
  }
  return out;
}
