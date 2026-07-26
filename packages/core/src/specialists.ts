// The dispatchable-specialist registry (DISP-01). Pure TS, Convex-free (CLAUDE.md §1) —
// the dispatcher in convex/dispatch.ts is the thin adapter that consumes it.
//
// Wave 0 (15-01) shipped the TYPES and the fail-closed lookup with the registry deliberately
// EMPTY. 15-02 fills it: a specialist is now a resolvable (skill body, tool-set) pair.
// 15.1-05 adds the per-tenant PROMPT BLOCK (`tierBriefing`) the dispatcher prepends — ADR-009.

import { type BehaviorPreset, sanitizeAgentName, type Tier } from "./businessProfile";

/** The closed set of dispatchable specialist routes — exactly the routes `diagnose()` emits. */
export const SPECIALIST_ROUTES = [
  "offer-architect",
  "money-model-designer",
  "lead-engine",
] as const satisfies readonly string[];
export type SpecialistRoute = (typeof SPECIALIST_ROUTES)[number];

/** A specialist is a (skill body, tool-set) pair — the body is a registry row (§5, versioned
 *  and rollback-able), the tool-set is a CAPABILITY grant and therefore code-owned, never
 *  DB-writable. A row that could widen its own tools would be a privilege-escalation path.
 *  ADR-007 records the split. */
export type SpecialistSpec = {
  readonly skillName: string;
  readonly tools: readonly string[];
  /** the closed agentSteps.tool literal this specialist's trace step writes */
  readonly stepTool: "dispatchOfferArchitect" | "dispatchMoneyModelDesigner" | "dispatchLeadEngine";
};

/**
 * THE capability grant. `searchVault` ONLY — a specialist reads the tenant's own grounded corpus
 * and returns prose; every write stays behind the ONE human Approve gate.
 *
 * Deliberately NOT granted: `evaluateBusiness`. Despite its "evaluation read" framing it calls
 * `internal.evaluations.runEvaluation`, which PERSISTS a new `evaluations` row plus an audit row
 * on every call and re-enters the diagnostic engine in the middle of a dispatch — a write and a
 * re-entrancy hazard wearing a read's clothes (RESEARCH Pitfall 10). The evaluation snapshot
 * reaches the specialist through its PROMPT instead (15-03 injects
 * `internal.evaluations.lastForThread`), which is cheaper and strictly read-only. Do not "fix"
 * this by adding the tool back.
 */
const SPECIALIST_TOOLS = ["searchVault"] as const;

// The §5 skill-registry row names. These are the string VALUES of `OFFER_ARCHITECT_SKILL` /
// `MONEY_MODEL_DESIGNER_SKILL` / `LEAD_ENGINE_SKILL` in packages/contracts/src/skill.ts, inlined
// because @pikar/contracts is not a dependency of @pikar/core (package.json) and adding one to
// carry three strings would invert nothing but the dependency graph. `specialists.test.ts` reads
// that file off disk and asserts the copies match, so a rename on either side fails a test.
export const SPECIALISTS: Readonly<Record<SpecialistRoute, SpecialistSpec>> = {
  "offer-architect": {
    skillName: "offer-architect",
    tools: SPECIALIST_TOOLS,
    stepTool: "dispatchOfferArchitect",
  },
  "money-model-designer": {
    skillName: "money-model-designer",
    tools: SPECIALIST_TOOLS,
    stepTool: "dispatchMoneyModelDesigner",
  },
  "lead-engine": {
    skillName: "lead-engine",
    tools: SPECIALIST_TOOLS,
    stepTool: "dispatchLeadEngine",
  },
};

export type ResolvedSpecialist =
  | { ok: true; route: SpecialistRoute; spec: SpecialistSpec }
  | { ok: false; reason: "unknown_route" };

/**
 * Fail-closed lookup — mirrors parseRouting (packages/contracts/src/routing.ts). There is
 * deliberately NO default specialist: "a route the system cannot validate is a route it must
 * not take". `gap.route` persists as v.string() (schema.ts), including the deliberate "" that
 * diagnose() emits on its not-enough-data ask branch, so rows predating the union reach here
 * un-narrowed — the RUNTIME branch stays load-bearing now that the type is closed, and the type
 * is not sufficient on its own.
 *
 * hasOwnProperty, not `SPECIALISTS[route]`: a bare index signature resolves "__proto__" and
 * "constructor" to Object.prototype members, which are truthy, so a truthiness guard would
 * happily "route" on them.
 *
 * Returns a discriminated result and NEVER throws — a governed stop returns, only bugs throw.
 */
export function resolveSpecialist(route: string): ResolvedSpecialist {
  if (!Object.hasOwn(SPECIALISTS, route)) {
    return { ok: false, reason: "unknown_route" };
  }
  const known = route as SpecialistRoute;
  return { ok: true, route: known, spec: SPECIALISTS[known] };
}

/**
 * Cycle refusal for a dispatch chain: would re-entering `route` repeat an ancestor?
 *
 * It lives here rather than inline in convex/dispatch.ts because it is the predicate that must
 * already be CORRECT the day MAX_DEPTH rises — at depth 1 a depth cap hides every cycle, so a
 * cycle bug would ship silently and surface only on the depth change. Here it is unit-testable
 * with no Convex harness; the dispatcher CALLS it and does not re-derive it.
 */
export function wouldCycle(ancestry: readonly string[], route: string): boolean {
  return ancestry.includes(route);
}

/**
 * Which §5 registry row carries each behaviour preset's style directive (design §7).
 *
 * Inlined for the same reason the specialist skill names above are: @pikar/contracts is NOT a
 * dependency of @pikar/core, and adding one to carry three strings would invert nothing but the
 * dependency graph. `specialists.test.ts` reads `contracts/src/skill.ts` off disk and asserts these
 * copies equal the `STYLE_*_SKILL` constants, so a rename on either side fails a test.
 */
export const PRESET_SKILL = {
  direct: "style-direct",
  coaching: "style-coaching",
  concise: "style-concise",
} as const satisfies Record<BehaviorPreset, string>;

/**
 * What each tier MEANS, as a structural constraint on the advice — not a description of the user.
 *
 * A `satisfies Record<Tier, string>` TABLE, deliberately NOT a switch or a ternary: a ternary is
 * total by construction, so adding a tier literal would silently inherit the else-branch's clause
 * and the distinctness test would be vacuous forever (the Phase-15 `armFor` lesson, actionType.ts;
 * the same reasoning that shapes TIER_REASON in businessProfile.ts). A new tier without a clause is
 * a COMPILE error here.
 */
const TIER_FACT = {
  solopreneur:
    "one person, no paid staff — there is nobody to delegate to, so every step must be" +
    " executable by the owner alone",
  startup:
    "a small team still finding repeatable revenue, or building on outside funding — steps" +
    " must be cheap to reverse and fast to test",
  sme:
    "an established business with steady revenue and paid staff — there is a team to assign" +
    " work to and an existing process to change",
  enterprise:
    "operating at granted enterprise scale — assume multiple teams, established process, and" +
    " internal approval steps between a decision and its execution",
} as const satisfies Record<Tier, string>;

/**
 * The per-tenant block `convex/dispatch.ts` PREPENDS to a dispatched specialist's prompt (SC#5,
 * ADR-009). Deterministic string assembly: no model call, no I/O, no Convex.
 *
 * Shape — every line is omitted when its input is absent, so a sparse tenant yields a short block
 * and a tenant with nothing known yields `""` (the caller skips it entirely):
 *
 *     Agent name: <sanitized>
 *     Business tier: <tier> — <structural consequence>
 *
 *     <styleDirective body>
 *
 * **Why this is CODE-owned and not a registry row (§5) — this is not a violation.** These are FACTS
 * about the tenant plus the structural consequence of those facts, exactly the class `TASK_LINE`
 * already occupies in `dispatch.ts` ("driver-plane synthetic string, not a skill"). The part that is
 * genuinely prompt CONTENT — the VOICE — is `styleDirective`, and that IS a versioned registry row
 * (`PRESET_SKILL` above). Same split as ADR-007: what the agent is TOLD is DB-editable and
 * eval-reviewable; what is structurally TRUE about the tenant is not.
 *
 * `agentName` is sanitized HERE rather than at the call site, so there is exactly ONE place a
 * user-authored string can reach a model prompt. Do not sanitize it again upstream and do not skip
 * it here on the assumption that someone else did.
 *
 * An ABSENT tier produces NO tier claim — never an invented "solopreneur". A missing profile row
 * must not become a silent classification; that defect class is what this phase exists to close.
 */
export function tierBriefing(a: {
  tier?: Tier;
  agentName?: string;
  styleDirective?: string;
}): string {
  const lines: string[] = [];
  const name = a.agentName === undefined ? "" : sanitizeAgentName(a.agentName);
  if (name !== "") lines.push(`Agent name: ${name}`);
  if (a.tier !== undefined) lines.push(`Business tier: ${a.tier} — ${TIER_FACT[a.tier]}`);

  const directive = a.styleDirective?.trim();
  const facts = lines.join("\n");
  if (!directive) return facts;
  return facts === "" ? directive : `${facts}\n\n${directive}`;
}

/**
 * Compose the memo body a specialist run produces. Deterministic string assembly over the
 * specialist's own output — no model call, no second derivation.
 *
 * §5 does NOT apply: this is a document the USER reads at the Approve gate, not an agent prompt
 * (the `buildMemo` precedent, convex/evaluations.ts:541-546).
 *
 * `incomplete` marks a run that hit the turn's shared cost ceiling. The marker lives in the BODY,
 * never on the plan row.
 * ponytail: ceiling is a body marker. A `plans.status` literal (e.g. "partial") would be the
 * structured upgrade path, but it touches the PINNED status enum (schema.ts:155-164) with
 * apps/web blast radius, and the body is visible at exactly the surface where the human decides.
 * Upgrade only if something other than a human needs to branch on incompleteness.
 */
export function specialistMemoBody(args: {
  route: string;
  body: string;
  incomplete: boolean;
}): string {
  const ceiling = args.incomplete
    ? "\n> **Incomplete — cost ceiling reached.** This is what the specialist finished before the" +
      " run's shared budget ran out; approve it as-is or ask for another pass."
    : "";
  return `> Produced by the **${args.route}** specialist.${ceiling}\n\n${args.body}`;
}
