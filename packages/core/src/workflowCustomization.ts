// Phase 29 (ROUT-01 / ROUT-02) — the pure contracts for customizing an APPROVED workflow pack,
// and for pinning one so a human can re-run it by hand.
//
// THE POINT OF THIS FILE: Phase 21 gave a tenant a free-text adaptation body appended under a fixed
// marker (`composeUserSkillBody`, `packages/contracts/src/skill.ts` L429). Phase 29 puts a CLOSED,
// TYPED FORM in front of that body. A user changes terminology, tone, thresholds, source
// preferences and bounded instructions. A user cannot add a tool, executable code, a secret, a
// remote URL or an MCP server — not because a prompt asks them not to, but because there is no
// field whose name they can spell that would carry one.
//
// TWO LAYERS, in this order:
//   1. THE KEY MUST BE DECLARED. `tools`, `mcpServers`, `apiKey`, `webhookUrl` are not fields, so
//      they are rejected before their values are ever looked at. This is the real firewall.
//   2. The VALUE is content-scanned. Layer 2 exists because an "instruction" field is legitimately
//      free prose, and prose is where a payload hides.
//
// STRUCTURALLY ABSENT, and enforced by `workflowCustomization.test.ts`: every recurrence word.
// A pin has no cadence, no timezone, no next-run and no enabled flag. Recurrence is deferred behind
// the 29-11 decision gate and this file must not pre-build its vocabulary.
//
// ponytail: no hash here. `canonicalCustomization` returns the deterministic STRING; the caller
// hashes it with the repo's one SHA-256 (`convex/lib/hash.ts` `contentHash`). A second hash
// implementation is exactly what that module exists to prevent, and a lineage fingerprint is not
// the place to introduce a weaker one.
import { err, ok, type Result } from "./result";
import type { PackSource, WorkflowPackId } from "./workflowPacks";

// ── The closed field vocabulary ────────────────────────────────────────────────────────────

export const CUSTOMIZATION_FIELD_KINDS = [
  /** What the business calls a thing. Short, free text. */
  "terminology",
  /** One of a closed option list. Never free text. */
  "tone",
  /** A number in a declared range. */
  "threshold",
  /** A subset of a declared source list. Never an arbitrary source name. */
  "source_preference",
  /** Bounded free prose. The widest field, and the one layer 2 exists for. */
  "instruction",
] as const satisfies readonly string[];
export type CustomizationFieldKind = (typeof CUSTOMIZATION_FIELD_KINDS)[number];

/**
 * Kinds whose change invalidates a standing approval (29-RESEARCH, "Material changes").
 *
 * Tone and terminology are deliberately NOT here: rewording is not a change of what the workflow
 * does. They still mint a new immutable candidate and still require eval — `requiresEval` is
 * separate from `material` precisely so the two cannot be confused.
 */
export const MATERIAL_FIELD_KINDS = [
  "threshold",
  "source_preference",
  "instruction",
] as const satisfies readonly CustomizationFieldKind[];

export type CustomizationField =
  | {
      readonly key: string;
      readonly kind: "terminology";
      readonly label: string;
      readonly maxBytes: number;
    }
  | {
      readonly key: string;
      readonly kind: "tone";
      readonly label: string;
      readonly options: readonly string[];
    }
  | {
      readonly key: string;
      readonly kind: "threshold";
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly integer: boolean;
    }
  | {
      readonly key: string;
      readonly kind: "source_preference";
      readonly label: string;
      readonly sources: readonly PackSource[];
    }
  | {
      readonly key: string;
      readonly kind: "instruction";
      readonly label: string;
      readonly maxBytes: number;
    };

/** A versioned schema belonging to ONE approved product template. */
export type CustomizationSchema = {
  readonly templateId: WorkflowPackId;
  readonly templateVersion: number;
  readonly fields: readonly CustomizationField[];
};

/** What a user submitted. Every field is optional — absence means "use the template's default". */
export type CustomizationValues = Readonly<Record<string, string | number | readonly string[]>>;

/**
 * There is deliberately no `maxFields`. It existed, bounded a PRODUCT-AUTHORED schema (there is no
 * untrusted producer of a `CustomizationSchema`), and was read by nothing — not by
 * `validateCustomization`, not by a test. A cap the code never applies is a documented invariant
 * with no enforcement, which is worse than no cap: a later plan trusts the number. Deleted rather
 * than enforced. Both survivors below bound UNTRUSTED user input and are enforced in
 * `validateCustomization`.
 */
export const CUSTOMIZATION_CAPS = {
  /** Entries in one source-preference list. */
  maxValuesPerField: 8,
  /** Absolute ceiling on any single value, matching `USER_SKILL_ADAPTATION_MAX_BYTES`. */
  valueMaxBytes: 4_000,
} as const;

export const CUSTOMIZATION_REJECTIONS = [
  "unknown_field",
  "wrong_type",
  "too_large",
  "out_of_range",
  "unknown_option",
  "unknown_source",
  "too_many_values",
  "forbidden_content",
] as const satisfies readonly string[];
export type CustomizationRejection = (typeof CUSTOMIZATION_REJECTIONS)[number];

export type CustomizationError = {
  readonly key: string;
  readonly reason: CustomizationRejection;
};

// ── Layer 2: forbidden content ─────────────────────────────────────────────────────────────

/**
 * Payload shapes that have no business in a terminology, tone or instruction value.
 *
 * DELIBERATELY NOT HERE: bare `import`, `=>`, `function`, `class`, `<`. Each of those appears in
 * ordinary business English ("import duties", "NPS < 30"), and a guard that eats the product is a
 * worse outcome than one that misses an exotic phrasing — the closed KEY set in layer 1 is what
 * actually stops a tool grant, and this list is the second lock, not the only one.
 */
const FORBIDDEN_VALUE_PATTERNS: readonly RegExp[] = [
  /\b[a-z][a-z0-9+.-]*:\/\//i, // any scheme-qualified remote address
  /\bwww\./i, // bare host
  // `\bmcp\b` alone misses `mcpServers` (no boundary after "mcp"), and `\bmcp` alone refuses the
  // surname "McPherson". Match the standalone word OR the server compound, and nothing else.
  /\bmcp(?:\b|[_\-\s]*serv)/i, // MCP server / mcpServers config
  /```/, // fenced code
  /<\s*script/i, // script tag
  /\$\{/, // template-literal / env interpolation
  /\{\{/, // handlebars-style injection
  /-{5}BEGIN/, // PEM key block
  /\bbearer\s+\S{8,}/i, // bearer token
  /\bapi[_\- ]?key\b/i, // credential field name
  /\b(?:access|refresh)[_\- ]?token\b/i,
  /\bsk-[A-Za-z0-9]{16,}/, // provider secret key
  /\bprocess\.env\b/, // env read
  /\brequire\s*\(/, // module load
  /\beval\s*\(/, // dynamic code — matched as a STRING here, never executed
];

function hasForbiddenContent(value: string): boolean {
  return FORBIDDEN_VALUE_PATTERNS.some((re) => re.test(value));
}

/** UTF-8 BYTES, not characters: a character cap lets one multibyte paste carry ~3x the budget. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

// ── Validation ─────────────────────────────────────────────────────────────────────────────

/**
 * Check a submitted value set against exactly one approved template schema.
 *
 * Returns EVERY rejection, not the first: a form that reveals one problem per round-trip is a form
 * people give up on, and each `{key, reason}` is a closed enum a UI can render without prose.
 */
export function validateCustomization(
  schema: CustomizationSchema,
  values: CustomizationValues,
): Result<CustomizationValues, readonly CustomizationError[]> {
  const byKey = new Map(schema.fields.map((f) => [f.key, f]));
  const errors: CustomizationError[] = [];
  const accepted: Record<string, string | number | readonly string[]> = {};

  for (const key of Object.keys(values)) {
    const field = byKey.get(key);
    // LAYER 1. An undeclared key never reaches its value. `tools` is not a field, so it is not a
    // question of what `tools` contains.
    if (!field) {
      errors.push({ key, reason: "unknown_field" });
      continue;
    }

    const raw = values[key];

    if (field.kind === "threshold") {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        errors.push({ key, reason: "wrong_type" });
        continue;
      }
      if (field.integer && !Number.isInteger(raw)) {
        errors.push({ key, reason: "wrong_type" });
        continue;
      }
      if (raw < field.min || raw > field.max) {
        errors.push({ key, reason: "out_of_range" });
        continue;
      }
      accepted[key] = raw;
      continue;
    }

    if (field.kind === "source_preference") {
      if (!Array.isArray(raw)) {
        errors.push({ key, reason: "wrong_type" });
        continue;
      }
      if (raw.length > CUSTOMIZATION_CAPS.maxValuesPerField) {
        errors.push({ key, reason: "too_many_values" });
        continue;
      }
      if (raw.some((s) => typeof s !== "string")) {
        errors.push({ key, reason: "wrong_type" });
        continue;
      }
      if (raw.some((s) => !(field.sources as readonly string[]).includes(s as string))) {
        errors.push({ key, reason: "unknown_source" });
        continue;
      }
      accepted[key] = raw as readonly string[];
      continue;
    }

    if (typeof raw !== "string") {
      errors.push({ key, reason: "wrong_type" });
      continue;
    }

    if (field.kind === "tone") {
      if (!field.options.includes(raw)) {
        errors.push({ key, reason: "unknown_option" });
        continue;
      }
      accepted[key] = raw;
      continue;
    }

    // terminology | instruction — the free-text kinds.
    const cap = Math.min(field.maxBytes, CUSTOMIZATION_CAPS.valueMaxBytes);
    if (byteLength(raw) > cap) {
      errors.push({ key, reason: "too_large" });
      continue;
    }
    // LAYER 2.
    if (hasForbiddenContent(raw)) {
      errors.push({ key, reason: "forbidden_content" });
      continue;
    }
    accepted[key] = raw;
  }

  return errors.length > 0 ? err(errors) : ok(accepted);
}

// ── Deterministic rendering + lineage ──────────────────────────────────────────────────────

/**
 * Order a source-preference list by the FIELD's declared order, never by submission order and
 * never alphabetically. That makes both the rendered body and the lineage string independent of
 * which checkbox the user clicked first, without inventing an ordering the schema did not state.
 */
function orderedSources(
  field: Extract<CustomizationField, { kind: "source_preference" }>,
  chosen: readonly string[],
): string[] {
  return field.sources.filter((s) => chosen.includes(s));
}

function renderValue(
  field: CustomizationField,
  raw: string | number | readonly string[] | undefined,
): string | null {
  if (raw === undefined) return null;
  if (field.kind === "threshold") return typeof raw === "number" ? String(raw) : null;
  if (field.kind === "source_preference")
    return Array.isArray(raw) ? orderedSources(field, raw as readonly string[]).join(", ") : null;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/**
 * Render the tenant's adaptation body from the exact approved template version.
 *
 * SCHEMA ORDER, not object-key order: the same choices submitted by two different UIs must produce
 * byte-identical bodies, or the lineage hash means nothing. An undeclared key cannot reach the
 * output because the loop iterates `schema.fields`, not `values`.
 */
export function renderCustomization(
  schema: CustomizationSchema,
  values: CustomizationValues,
): string {
  const sections: string[] = [];
  for (const field of schema.fields) {
    if (!Object.hasOwn(values, field.key)) continue;
    const rendered = renderValue(field, values[field.key]);
    if (rendered === null) continue;
    sections.push(`### ${field.label}\n\n${rendered}`);
  }
  return sections.join("\n\n");
}

/**
 * The deterministic lineage/diff input. Hand it to the repo's existing SHA-256 `contentHash`.
 *
 * It carries the TEMPLATE IDENTITY as well as the values, so "the same words against a republished
 * template" is a different fingerprint — which is what makes a stale pin detectable.
 */
export function canonicalCustomization(
  schema: CustomizationSchema,
  values: CustomizationValues,
): string {
  const parts: string[] = [`template=${schema.templateId}@${schema.templateVersion}`];
  for (const field of schema.fields) {
    if (!Object.hasOwn(values, field.key)) continue;
    const rendered = renderValue(field, values[field.key]);
    if (rendered === null) continue;
    parts.push(`${field.key}=${JSON.stringify(rendered)}`);
  }
  return parts.join("\n");
}

// ── Material change ────────────────────────────────────────────────────────────────────────

export type MaterialChangeKind = CustomizationFieldKind | "template_version";

/**
 * Classify what moved between two value sets.
 *
 * `material` answers "does a standing approval survive this?" — no, for a threshold, a source set,
 * an instruction, or a template-version bump. `requiresEval` answers "may this run before it has
 * been evaluated?" — never, for ANY change, including a tone-only one. They are separate booleans
 * because collapsing them is how a "cosmetic" edit skips its gate.
 */
export function classifyCustomizationChange(
  schema: CustomizationSchema,
  before: CustomizationValues,
  after: CustomizationValues,
  afterSchema: CustomizationSchema = schema,
): {
  readonly changed: readonly string[];
  readonly kinds: readonly MaterialChangeKind[];
  readonly material: boolean;
  readonly requiresEval: boolean;
} {
  const changed: string[] = [];
  const kinds: MaterialChangeKind[] = [];
  let material = false;

  if (
    schema.templateId !== afterSchema.templateId ||
    schema.templateVersion !== afterSchema.templateVersion
  ) {
    kinds.push("template_version");
    material = true;
  }

  for (const field of schema.fields) {
    const a = Object.hasOwn(before, field.key) ? renderValue(field, before[field.key]) : null;
    const b = Object.hasOwn(after, field.key) ? renderValue(field, after[field.key]) : null;
    if (a === b) continue;
    changed.push(field.key);
    if (!kinds.includes(field.kind)) kinds.push(field.kind);
    if ((MATERIAL_FIELD_KINDS as readonly string[]).includes(field.kind)) material = true;
  }

  return {
    changed,
    kinds,
    material,
    requiresEval: changed.length > 0 || kinds.includes("template_version"),
  };
}

// ── Optimistic concurrency ─────────────────────────────────────────────────────────────────

export const STALE_BASE_ERROR = "STALE_BASE_VERSION" as const;

/**
 * Refuse a save whose base is not the version currently in the database.
 *
 * There is deliberately no merge. Two people editing one workflow's thresholds cannot have both
 * intents satisfied, and a silent last-write-wins is the version of that failure nobody notices.
 */
export function checkBaseVersion(
  expectedBase: number | null,
  currentActive: number | null,
): Result<true, string> {
  if (expectedBase === currentActive) return ok(true);
  return err(
    `${STALE_BASE_ERROR}: expected ${currentActive ?? "none"}, saw ${expectedBase ?? "none"}`,
  );
}

// ── The manual pin (ROUT-02) ───────────────────────────────────────────────────────────────

/**
 * A `tenantSkills` ROW ID, as this pure package can carry one.
 *
 * `@pikar/core` cannot import Convex's `Id<"tenantSkills">` (it has no Convex dependency and must
 * stay portable), so the id travels as an opaque string that is never parsed, compared by parts or
 * constructed here. The Convex side validates it as `v.id("tenantSkills")` — `savedPrompts
 * .tenantSkillId` in `schema.ts`, and the landed `tenantSkillIds` rail at `dispatch.ts:234/:256`,
 * `llm.ts:1840/:5424` — so a string that is not a real row id is refused by the validator before
 * any handler sees it. The brand keeps a bare `string` from being passed by accident.
 */
export type TenantSkillRef = string & { readonly __tenantSkillRow: unique symbol };

/**
 * Everything a manual re-run must resolve against. Refs, a version and a hash — no prompt text, no
 * plan, no recipient, no schedule.
 *
 * `tenantSkillId` NAMES THE EXACT CANDIDATE ROW, not a (name, version) pair. Two tenants can hold
 * the same skill name AND the same version, which is why `recordTenantEvalEvidence` keys on the row
 * id and why the landed pin rail is `Record<string, Id<"tenantSkills">>` rather than a number. This
 * type originally carried `tenantSkillVersion: number | null` and compared that number — the pure
 * contract contradicting both its own schema field and the landed rail one scope down, and
 * unusable against the row this same plan defined without an extra read to turn an id into a
 * version. No version is kept even as display metadata: a second, non-authoritative copy of the
 * same fact is what a later reader compares by mistake.
 *
 * `tenantSkillId: null` means "run the approved product template with no tenant customization",
 * which is a genuinely different pin from any customized version and must not collapse into one.
 */
export type WorkflowPin = {
  readonly templateId: WorkflowPackId;
  readonly templateVersion: number;
  readonly tenantSkillId: TenantSkillRef | null;
  /** SHA-256 of `canonicalCustomization`, computed by the caller. */
  readonly customizationHash: string;
  readonly sourcePreferences: readonly PackSource[];
};

/**
 * A stable identity for "this exact workflow at this exact template version and candidate row".
 * Order-independent in its source list so two equivalent pins are one pin.
 */
export function pinIdentity(pin: WorkflowPin): string {
  const sources = [...pin.sourcePreferences].sort().join(",");
  return [
    pin.templateId,
    `t${pin.templateVersion}`,
    `c${pin.tenantSkillId ?? "none"}`,
    pin.customizationHash,
    sources,
  ].join("|");
}

/**
 * Is this pin still pointing at what is live?
 *
 * A `false` here does NOT mean "refuse the run" — it means the run must re-resolve against the
 * current active version rather than assume the pinned one is still there. A pinned rerun creates a
 * fresh request and crosses every current gate; it never replays.
 *
 * `active.tenantSkillId` is the id of the tenant's currently ACTIVE candidate row for this
 * template, read by the caller. Comparing row ids means a republished candidate that happens to
 * reuse a version number cannot read as "still live".
 */
export function pinMatchesActive(
  pin: WorkflowPin,
  active: { readonly templateVersion: number; readonly tenantSkillId: TenantSkillRef | null },
): boolean {
  return (
    pin.templateVersion === active.templateVersion && pin.tenantSkillId === active.tenantSkillId
  );
}

/**
 * The correlation id for ONE run of a pin.
 *
 * `runId` is minted fresh per run by the caller (`crypto.randomUUID()`), so two "Run again" clicks
 * can never share a correlation — which is the mechanical reason a rerun cannot resolve to an
 * earlier run's plan, budget reservation or approval. Same `runId` twice is the same string on
 * purpose: that is retry idempotence WITHIN one run, not reuse across runs.
 */
export function freshRunCorrelation(pinId: string, runId: string): string {
  return `pin:${pinId}:${runId}`;
}
