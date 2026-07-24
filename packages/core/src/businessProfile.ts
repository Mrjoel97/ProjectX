// Pure business-profile domain module (CLAUDE.md §1 — Convex-free, portable).
//
// This is the substrate the Phase 11 onboarding flow and the Phase 12 evaluation
// engine build on. It owns two governance-critical rules as pure, unit-tested logic:
//   - SC#1: a persona is ALWAYS confirmed, never auto-committed (`decideConfirm`).
//   - Enterprise is not an emittable persona (the `Persona` union + `isPersona`).
// No Convex, no network — the backend `onboarding.ts` adapter is where this meets the DB.

/** The locked persona set. Enterprise is deliberately OUT (never emittable). */
export const PERSONAS = ["solopreneur", "startup", "sme"] as const;

export type Persona = (typeof PERSONAS)[number];

/** Type guard — the sole gate deciding whether a raw string is an emittable persona. */
export function isPersona(x: unknown): x is Persona {
  return typeof x === "string" && (PERSONAS as readonly string[]).includes(x);
}

/**
 * The Lean-core business profile. Field names are a DOWNSTREAM CONTRACT — the Phase 12
 * eval engine reads them; rename only in lockstep with the evaluator (see onboarding.md).
 */
export type BusinessProfile = {
  /** Business name. */
  name: string;
  /** One-line description of what the business does. */
  oneLineDescription: string;
  /** Inferred-then-confirmed persona. */
  persona: Persona;
  /** Lifecycle stage in the user's own words (e.g. "idea", "early-revenue", "scaling"). */
  stage: string;
  /** What the business sells / offers. */
  offering: string;
  /** Who the business serves. */
  targetCustomer: string;
  /** The user's primary goals (may be empty). */
  primaryGoals: string[];
  /** Known constraints / limitations (may be empty). */
  knownConstraints: string[];
};

/** An extraction inference carrying a candidate persona, pre-confirmation. */
export type PersonaInference = { persona: Persona };

/** Outcome of the SC#1 gate: the candidate persona plus a mandatory confirm flag. */
export type ConfirmDecision = { persona: Persona; needsConfirm: true };

/**
 * SC#1 — persona is confirm-not-assume. This ALWAYS returns `needsConfirm: true`;
 * there is deliberately no branch that auto-commits a persona. The only way a persona
 * becomes committed is an explicit human confirmation downstream of this function.
 */
export function decideConfirm(inference: PersonaInference): ConfirmDecision {
  return { persona: inference.persona, needsConfirm: true };
}

/** Structured validation result — `ok` or a list of human-readable errors. */
export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

// Sparse-start (idea-stage onboarding): the ONLY required text field is a one-line description
// of the idea/business. name/stage/offering/targetCustomer are legitimately empty for someone
// arriving with a vague idea and no business yet (ONBD-02 covers "business/idea") — they are
// enriched later on the profile page as the idea becomes a venture. persona is validated
// separately (always inferred + confirmed). This is the front-door gate: admit an idea, don't
// demand a finished business.
const REQUIRED_STRINGS: readonly (keyof BusinessProfile)[] = ["oneLineDescription"];

/**
 * Validate a Lean-core profile at the trust boundary (before it is committed as a vault doc).
 * SPARSE-START: only `oneLineDescription` must be non-empty (an idea-stage user has that but not
 * yet a name/offering/customer); persona must be emittable; the two lists must be arrays (empty is
 * allowed — an absent goal is not fabricated). The optional strings may be empty and are filled in
 * later as the idea matures.
 */
export function validateProfile(profile: BusinessProfile): ValidationResult {
  const errors: string[] = [];
  for (const key of REQUIRED_STRINGS) {
    const value = profile[key];
    if (typeof value !== "string" || value.trim() === "") errors.push(`${key} is required`);
  }
  if (!isPersona(profile.persona)) {
    errors.push(`persona must be one of ${PERSONAS.join(" | ")}`);
  }
  if (!Array.isArray(profile.primaryGoals)) errors.push("primaryGoals must be an array");
  if (!Array.isArray(profile.knownConstraints)) errors.push("knownConstraints must be an array");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

const bullets = (items: string[]): string =>
  items.length === 0 ? "_None specified_" : items.map((i) => `- ${i}`).join("\n");

/**
 * Render a profile to deterministic markdown for storage as a vault document.
 * Deterministic = same input yields byte-identical output (no dates, no ordering
 * churn) so re-embedding on edit replaces cleanly and diffs stay meaningful.
 */
export function serializeProfile(profile: BusinessProfile): string {
  return [
    // Sparse-start: an idea-stage profile may have no name yet — fall back so the vault doc
    // never embeds a bare "# " heading (matches onboarding.ts writeProfileDoc's title fallback).
    `# ${profile.name || "Business profile"}`,
    "",
    profile.oneLineDescription,
    "",
    `- **Persona:** ${profile.persona}`,
    `- **Stage:** ${profile.stage}`,
    `- **Offering:** ${profile.offering}`,
    `- **Target customer:** ${profile.targetCustomer}`,
    "",
    "## Primary goals",
    "",
    bullets(profile.primaryGoals),
    "",
    "## Known constraints",
    "",
    bullets(profile.knownConstraints),
    "",
  ].join("\n");
}

/**
 * Inverse of `serializeProfile` — parse the committed vault-doc markdown back into a structured
 * `BusinessProfile` so the profile page can pre-fill an editable form from what was actually stored
 * (there is NO separately-persisted structured copy; the markdown IS the record, incl. for profiles
 * committed by earlier plans). Parses by the serializer's fixed markers, not brittle line offsets.
 *
 * ponytail: this mirrors `serializeProfile`'s fixed shape — the two must change together (a round-trip
 * test in businessProfile.test.ts enforces it). Ceiling: an empty name serializes to the literal
 * "Business profile" heading, so a business genuinely named "Business profile" round-trips to an empty
 * name — harmless on an enrichment form (the user just retypes it). Upgrade path: persist structured
 * JSON on the vault row if that collision ever matters.
 */
export function deserializeProfile(markdown: string): BusinessProfile {
  const lines = markdown.split("\n");

  const heading = (lines[0] ?? "").replace(/^#\s*/, "").trim();
  const name = heading === "Business profile" ? "" : heading;

  // A `- **Label:** value` bullet from the header block.
  const field = (labelText: string): string => {
    const prefix = `- **${labelText}:**`;
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : "";
  };

  // oneLineDescription is everything between the heading and the first header bullet.
  const firstBullet = lines.findIndex((l) => l.startsWith("- **Persona:**"));
  const oneLineDescription = lines
    .slice(1, firstBullet === -1 ? 1 : firstBullet)
    .join("\n")
    .trim();

  // List items under a `## Header` up to the next `## ` (skips the `_None specified_` placeholder).
  const sectionItems = (header: string): string[] => {
    const start = lines.findIndex((l) => l.trim() === `## ${header}`);
    if (start === -1) return [];
    const items: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i] ?? "";
      if (l.startsWith("## ")) break;
      if (l.startsWith("- ")) {
        const value = l.slice(2).trim();
        if (value !== "" && value !== "_None specified_") items.push(value);
      }
    }
    return items;
  };

  const persona = field("Persona");
  return {
    name,
    oneLineDescription,
    persona: isPersona(persona) ? persona : "solopreneur",
    stage: field("Stage"),
    offering: field("Offering"),
    targetCustomer: field("Target customer"),
    primaryGoals: sectionItems("Primary goals"),
    knownConstraints: sectionItems("Known constraints"),
  };
}
