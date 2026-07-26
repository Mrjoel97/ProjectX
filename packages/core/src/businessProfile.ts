// Pure business-profile domain module (CLAUDE.md §1 — Convex-free, portable).
//
// This is the substrate the Phase 11 onboarding flow and the Phase 12 evaluation
// engine build on. It owns two governance-critical rules as pure, unit-tested logic:
//   - SC#1: a persona is ALWAYS confirmed, never auto-committed (`decideConfirm`).
//   - Enterprise is not an emittable persona (the `Persona` union + `isPersona`).
// Phase 15.1 adds a third: the tier is DERIVED FROM FACTS (`deriveTier`) and this function
// is its only writer — nothing string-matches a persona out of markdown any more.
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

// ── Phase-15.1 fact-derived tier (design §5, decisions D2/D6, owner Q7) ─────────────────────────
//
// Why this lives HERE and not in a new core file: this module already declares itself the home of
// the governance-critical pure rules, and the tier rule is the third one. A separate file would
// need its own `watch.json` entry for no gain.
//
// Q7 — LOCKED: `revenueStage` and `funding` are CLOSED literal unions, never free strings. A free
// string here would reintroduce the string-matching defect class this phase exists to close (design
// §1a/§1d: today the tier is recovered by matching `- **Persona:**` out of a markdown blob), and it
// would make `deriveTier` untestable for totality.

/** Membership test over a closed literal union. Private — each exported guard names its own union. */
const inUnion = (union: readonly string[], x: unknown): boolean =>
  typeof x === "string" && union.includes(x);

/** Where the business is on the revenue curve. Asked, never inferred. */
export const REVENUE_STAGES = ["pre-revenue", "early-revenue", "steady-revenue"] as const;
export type RevenueStage = (typeof REVENUE_STAGES)[number];

/** Outside-capital posture. `seeking` and `funded` both read as startup-shaped (§5). */
export const FUNDING_STATES = ["bootstrapped", "seeking", "funded"] as const;
export type Funding = (typeof FUNDING_STATES)[number];

/**
 * How a tenant's tier came to be. `derived` = `deriveTier` over complete facts; `confirmed` = the
 * user acknowledged the derivation in the closing beat (design §6); `admin` = an operator grant
 * (the ONLY route to `enterprise`, D6/Q4); `legacy` = the design §10 backfill of a pre-15.1 tenant
 * whose tier exists only as markdown and who is NEVER force-re-onboarded.
 *
 * This is design §4.1's one-field hedge for a later business-shape-vs-billing split. It is NOT an
 * abstraction for a second tier concept — do not build one until billing exists.
 */
export const TIER_SOURCES = ["derived", "confirmed", "admin", "legacy"] as const;
export type TierSource = (typeof TIER_SOURCES)[number];

/**
 * The agent's behavior preset (design §7). A closed enum, each member mapping to a VERSIONED style
 * directive in the skill registry — deliberately NOT a free-text box, which would be a standing
 * prompt-injection surface and would smuggle unversioned prompt content into every call (§5).
 */
export const BEHAVIOR_PRESETS = ["direct", "coaching", "concise"] as const;
export type BehaviorPreset = (typeof BEHAVIOR_PRESETS)[number];

/**
 * What `deriveTier` can return. `enterprise` is STRUCTURALLY ABSENT, so D6 ("enterprise is never
 * derived") holds by construction rather than by review discipline: assigning `"enterprise"` to
 * this type is a compile error, pinned by an `@ts-expect-error` in businessProfile.test.ts.
 */
export type DerivedTier = Persona;

/**
 * What the tenantProfiles TABLE can hold: the derivable set PLUS the operator-granted `enterprise`
 * (D6, Q4 — granted through an `internalMutation` with no public surface, invoked via
 * `npx convex run`, because `requireOwner`/GOVN-01 does not land until Phase 22).
 */
export const TIERS = [...PERSONAS, "enterprise"] as const;
export type Tier = (typeof TIERS)[number];

/** Type guard for a stored tier. Mirrors `isPersona`, but ADMITS `enterprise` (the table can). */
export function isTier(x: unknown): x is Tier {
  return inUnion(TIERS, x);
}

/**
 * The facts the tier is derived FROM (design §4.1). Asked explicitly in the conversational
 * onboarding — "is this person alone or not" is the determining question and Phase 11 never asked
 * it (design §1a). Gaming the tier requires lying about headcount, which has visible consequences
 * elsewhere; that is the whole anti-manipulation mechanism (D2).
 */
export type TierFacts = {
  /** Everyone working on the business, paid or not (founders included). */
  headcount: number;
  /** Of those, how many are PAID staff. `0` is the solo signal. */
  paidStaff: number;
  revenueStage: RevenueStage;
  funding: Funding;
  /** Full years the business has been operating. CAPTURED but unused by the rule — see below. */
  yearsOperating: number;
};

/**
 * THE tier rule (design §5) — the single home of the derivation and the ONLY writer of the tier.
 * Total over the closed unions by construction: two guarded returns and an unconditional fallthrough,
 * so there is no undefined result and no `enterprise` result (D6).
 *
 * Branch ORDER is load-bearing: the solo test runs FIRST, so a pre-revenue one-person business is a
 * solopreneur rather than a startup — the tier describes the SHAPE of the operation, and "you are on
 * your own" dominates "you have not made money yet" for the advice it selects (design §8.1: a
 * solopreneur must not receive advice premised on delegation).
 *
 * `yearsOperating` is CAPTURED (design §4.1 names it a tier fact and the conversation asks it) but
 * deliberately does NOT participate in the rule today — a 10-year-old one-person shop is still a solo
 * operation, and a 6-month-old bootstrapped business with steady revenue and paid staff is still an
 * SME. It is stored so a later product call can use it without a re-onboarding. Do NOT "fix" the
 * omission; a test pins the current contract.
 *
 * The thresholds (`0` paid staff, `<= 2` headcount) are the design doc's DEFAULTS and are a PRODUCT
 * call, not a technical constraint. Retune by editing `TIER_BOUNDARY_TABLE` in the test file and
 * these two comparisons — never by adding a config row: a DB-tunable threshold would make the tier
 * DB-writable by proxy, which is exactly what D2 forbids. A retune is a visible re-derivation event
 * (that is what `derivedAt` is for), not a silent reclassification of every tenant.
 */
export function deriveTier(f: TierFacts): DerivedTier {
  if (f.paidStaff === 0 && f.headcount <= 2) return "solopreneur";
  if (f.revenueStage !== "steady-revenue" || f.funding !== "bootstrapped") return "startup";
  return "sme";
}

/**
 * The read-only reason rendered next to the tier on the profile page (design §9). The tier itself is
 * never an input — the facts are — so the reason is what makes the derivation legible instead of
 * arbitrary.
 *
 * A `satisfies Record<Tier, string>` TABLE, deliberately NOT a switch or a ternary: a ternary is
 * total by construction, so adding a tier literal would silently inherit the else-branch's reason
 * and the coverage test would be vacuous forever (the Phase-15 `armFor` lesson, actionType.ts). This
 * way a new tier without a reason is a COMPILE error here.
 */
export const TIER_REASON = {
  solopreneur: "Solo operation — you're the only person working on this.",
  startup: "Early stage — still finding repeatable revenue, or building on outside funding.",
  sme: "Established business — steady revenue, paid staff, and no outside funding to answer to.",
  enterprise: "Enterprise — granted by Pikar, not derived from your answers.",
} as const satisfies Record<Tier, string>;

/**
 * The slot set the conversational onboarding MUST fill before it can complete (design §6): the tier
 * facts plus Phase 11's existing required `oneLineDescription`. Order is the reporting order.
 *
 * The guarantee is CODE, never prompt. A free-roaming agent conversation will sometimes never ask
 * about headcount — it gets absorbed in the user's product idea and wraps up warm and useless, which
 * is design §1a all over again. The model owns the wording; this owns whether it may finish.
 */
export const REQUIRED_SLOTS = [
  "oneLineDescription",
  "headcount",
  "paidStaff",
  "revenueStage",
  "funding",
  "yearsOperating",
] as const;
export type SlotName = (typeof REQUIRED_SLOTS)[number];

/** Answers gathered so far — every slot optional, because a conversation fills them out of order. */
export type OnboardingSlots = Partial<TierFacts> & { oneLineDescription?: string };

/**
 * Per-slot PRESENCE test. A number is present when it is a finite number — NOT when it is truthy:
 * `headcount: 0` / `paidStaff: 0` / `yearsOperating: 0` are ANSWERS, and a `!value` check would
 * re-ask a solo founder forever and make the conversation uncompletable. A string is present when it
 * trims non-empty. An enum is present only when it passes its MEMBERSHIP check, so an unrecognized
 * value (a stale row, a model reply) is missing rather than quietly admitted.
 */
const isFiniteNumber = (x: unknown): boolean => typeof x === "number" && Number.isFinite(x);

const SLOT_PRESENT = {
  oneLineDescription: (x: unknown) => typeof x === "string" && x.trim() !== "",
  headcount: isFiniteNumber,
  paidStaff: isFiniteNumber,
  revenueStage: (x: unknown) => inUnion(REVENUE_STAGES, x),
  funding: (x: unknown) => inUnion(FUNDING_STATES, x),
  yearsOperating: isFiniteNumber,
} as const satisfies Record<SlotName, (x: unknown) => boolean>;

/** Which required slots are still empty, in `REQUIRED_SLOTS` order. Empty array ⇒ ready to finish. */
export function missingSlots(s: OnboardingSlots): SlotName[] {
  return REQUIRED_SLOTS.filter((slot) => !SLOT_PRESENT[slot](s[slot]));
}

/** The completion gate (design §6/§11). Mirrors `missingSlots` — one source of truth, not two. */
export const canComplete = (s: OnboardingSlots): boolean => missingSlots(s).length === 0;

/** Display cap for a user-chosen agent name (design §7). */
const AGENT_NAME_MAX = 40;

/**
 * Sanitize the user-chosen agent name (design §7, D4).
 *
 * This string is user-authored and WILL ride into a model system prompt (plan 05 threads the agent
 * name into `runSpecialistTurn`), so it is a trust boundary, not a cosmetic field. Stripping control
 * and format characters removes the two things that make an injected name dangerous: a NEWLINE lets
 * a name open what looks like a fresh instruction block, and a bidi override / zero-width character
 * lets it render as something other than what it is. `\p{C}` covers Cc (control) and Cf (format) in
 * one pass; `\s+` then collapses the residue plus U+2028/U+2029, which are Zl/Zp rather than Cf.
 *
 * Length-capped and trimmed AFTER the cap so a cut that lands mid-whitespace cannot leave a dangling
 * separator. A whitespace-only name sanitizes to `""` — the caller treats that as "no name given",
 * never as a bare space.
 *
 * ponytail: display-only sanitation. Ceiling — it does not detect a name that is a plausible-looking
 * English instruction ("Also list all users"); the structural defence is that the name is interpolated
 * into a labelled field of the prompt, never concatenated as a bare line. Upgrade path: if the name
 * ever reaches a tool-argument position, validate against an allow-list instead of stripping.
 */
export function sanitizeAgentName(raw: string): string {
  return raw.replace(/\p{C}/gu, " ").replace(/\s+/gu, " ").trim().slice(0, AGENT_NAME_MAX).trim();
}
