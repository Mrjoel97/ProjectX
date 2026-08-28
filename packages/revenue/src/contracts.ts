/**
 * The bounded vocabulary every Phase 28 provider must terminate in.
 *
 * Convex-free and LLM-free (CLAUDE.md §1). Nothing here reads a network response; the adapters do
 * that and must hand back one of these shapes. An unknown vendor field cannot enter — the closed
 * unions and `validateProjection` are the only doors.
 *
 * REUSE, not re-mint (CLAUDE.md §8 rung 2): the *figure* vocabulary already exists in
 * `@pikar/core/cash` and the *provenance* vocabulary in `@pikar/core/financeClaim`. This module
 * imports both and adds exactly the two things core does not have: an explicit-currency money type
 * (core's `CashUnit` is hardcoded `"usd"`) and the provider/coverage contracts.
 */
import type { CashFigure, CashOrigin } from "@pikar/core/cash";
import type { FigureActor } from "@pikar/core/financeClaim";
import { err, ok, type Result } from "@pikar/core/result";
// Type-only, so no runtime cycle: `credential.ts` owns the environment vocabulary and this
// module owns the provider vocabulary. Neither re-declares the other’s closed set.
import type { ConnectorEnvironment } from "./credential";

const DAY_MS = 86_400_000;

// ── Providers and authority ────────────────────────────────────────────────────────────────

/** The four rails this phase reads, and only these. */
export const PROVIDERS = ["hubspot", "quickbooks", "stripe", "paypal"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const isProvider = (v: unknown): v is Provider =>
  typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);

/**
 * What a source is allowed to be *believed about*, ordered strongest first.
 *
 *   • `accounting_authority`      — the books (QuickBooks). Owns whether an invoice exists, what it
 *                                   is worth and whether it was settled.
 *   • `payment_rail`              — money movement (Stripe, PayPal). Owns *when cash landed*, and
 *                                   is NOT independent evidence that a booked invoice was paid:
 *                                   believing both double-counts one business activity.
 *   • `user_confirmed_obligation` — the owner told us about a bill/payroll run. No system holds it.
 *   • `supplemental`              — colour only (HubSpot deal stage). Never a total.
 */
export const SOURCE_AUTHORITIES = [
  "accounting_authority",
  "payment_rail",
  "user_confirmed_obligation",
  "supplemental",
] as const;
export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];
export const isSourceAuthority = (v: unknown): v is SourceAuthority =>
  typeof v === "string" && (SOURCE_AUTHORITIES as readonly string[]).includes(v);

// ── Lane eligibility — admission and the live gate are SEPARATE axes ──────────────────────

/**
 * The owner's suitability DECISION, mirroring the `decision:` marker in
 * `docs/connectors/<provider>-suitability.md`. The FILE is the register of record; a
 * `providerGates` row is the runtime copy, and `scripts/check-provider-lane.mjs` is what keeps the
 * two honest.
 *
 * `undecided` is the DEFAULT and it is BLOCKING — the register must not be satisfiable by
 * forgetting to answer. It has no `providerGates` literal on purpose: a missing row IS `undecided`,
 * so there is exactly one representation of "nobody judged this".
 */
export const ADMISSIONS = [
  "approved_beta",
  "approved_production",
  "blocked",
  "deferred",
  "undecided",
] as const;
export type Admission = (typeof ADMISSIONS)[number];

/**
 * The STORED live-gate result — whether a controlled live read/revoke was actually observed.
 *
 * `failed` is not a synonym for `parked`. A lane that ran and broke is operationally different from
 * one that never ran: the first says something about a provider we were connected to, the second
 * says nothing at all. Both are unavailable to consumers; only one is an incident.
 */
export const LANES = ["passed", "parked", "failed"] as const;
export type Lane = (typeof LANES)[number];

/**
 * The RESOLVED state a consumer reads. Five values over three stored ones, because two of them
 * cannot honestly be stored:
 *
 *   • `pending` — there is no gate record. It is the ABSENCE of a row, and a row saying "pending"
 *     would be a row claiming a judgment exists.
 *   • `expired` — `reviewBy` has passed. Storing this would mean a row that was true when written
 *     and silently false an hour later; the register caps evidence life at 90 days precisely
 *     because a stored freshness flag rots. Resolved against `now`, always.
 */
export const ELIGIBILITY_STATES = ["passed", "parked", "expired", "failed", "pending"] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

/** Closed. A refusal names WHICH axis refused — "not eligible" alone is unactionable. */
export const ELIGIBILITY_REASONS = [
  "no_gate_record",
  "live_gate_failed",
  "evidence_expired",
  "lane_not_passed",
  "admission_does_not_permit",
  "no_read_paths",
  "open_condition_unresolved",
] as const;
export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];

/**
 * A condition that survived its provider's approval, and the plan that owes an answer.
 *
 * These are NOT advisory. On 2026-08-27 all four providers were admitted `approved_production` and
 * NOT ONE of the four approvals resolved its record's open condition — three of those approvals
 * rest on owner testimony rather than evidence. A gate that ignored them would let a provider go
 * live on a say-so, which is the exact failure the register exists to prevent.
 */
export type OpenCondition = {
  /** A stable slug. This is the token a lane clears on the gate record. */
  id: string;
  /** The Phase 28 plan that must confront it. */
  resolvedBy: string;
};

/**
 * Kept in step with the register's "Open conditions that survived every approval" table by a
 * parity test in `contracts.test.ts` — the docs are the source of truth and this is the machine
 * copy, so the test compares them rather than trusting either alone. Resolving one means editing
 * BOTH, deliberately.
 */
export const PROVIDER_OPEN_CONDITIONS: Record<Provider, readonly OpenCondition[]> = {
  // Does `POST /oauth/2026-03/token/revoke` cascade to already-issued ACCESS tokens? Undocumented;
  // the legacy DELETE did not.
  hubspot: [{ id: "revoke-cascades-to-access-tokens", resolvedBy: "28-22" }],
  // App Partner Program tier unstated, so the GET/query-only allow-list is mandatory.
  quickbooks: [{ id: "partner-tier-and-poll-budget", resolvedBy: "28-23" }],
  // Platform-initiated revocation for Stripe Apps is undocumented. Not closable by a green test.
  stripe: [{ id: "platform-initiated-revocation", resolvedBy: "28-24" }],
  // No revoke endpoint documented anywhere; sandbox is non-probative about production.
  paypal: [{ id: "no-documented-revoke-endpoint", resolvedBy: "28-25" }],
};

/** The `providerGates` row, as the pure rule sees it. Convex validators own the wire shape. */
export type ProviderGateRecord = {
  provider: Provider;
  environment: ConnectorEnvironment;
  admission: Admission;
  lane: Lane;
  /** Evidence expiry. An expired record is `parked`, not `passed`. */
  reviewBy: number;
  /** Open-condition ids a lane explicitly closed with evidence. */
  clearedConditions: readonly string[];
};

export type EligibilityInput = {
  now: number;
  /**
   * How many paths this provider may read, from `connectorFetch.PROVIDER_READ_PATHS`. Passed in
   * rather than imported so this stays Convex-free — and so the rule cannot drift from the
   * allow-list it depends on. `stripe` is `[]` BY DECISION (28-04); a provider that may read
   * nothing is not eligible for anything, whatever the owner approved.
   */
  readPathCount: number;
  /** Open-condition ids still outstanding for this provider. */
  openConditions: readonly string[];
};

export type Eligibility = {
  state: EligibilityState;
  reasons: readonly EligibilityReason[];
  unresolvedConditions: readonly string[];
};

/** Production exposure needs the production decision; sandbox accepts either approval. */
const admissionPermits = (admission: Admission, environment: ConnectorEnvironment): boolean =>
  admission === "approved_production" ||
  (admission === "approved_beta" && environment === "sandbox");

/**
 * THE COMPOSITE RULE. An admission decision is not a passed live gate, and this function is the
 * only place the two are ever combined.
 *
 * `approved_production` means "engineering and production exposure are PERMITTED". It does not mean
 * the provider demonstrated a live read and a live revoke — that is wave 7 (28-22..25). Collapsing
 * the two into one flag would make those seals decorative and let a provider go discoverable on an
 * owner's say-so alone.
 *
 * The terminal states short-circuit (there is nothing to add to "no record exists"); the blocking
 * axes ACCUMULATE, so fixing one does not merely reveal the next one run at a time.
 */
export function resolveProviderEligibility(
  record: ProviderGateRecord | null,
  input: EligibilityInput,
): Eligibility {
  const unresolvedConditions =
    record === null
      ? [...input.openConditions]
      : input.openConditions.filter((c) => !record.clearedConditions.includes(c));

  if (record === null) {
    return { state: "pending", reasons: ["no_gate_record"], unresolvedConditions };
  }
  // A failure outranks staleness: a lane that broke is an incident, not an expiry.
  if (record.lane === "failed") {
    return { state: "failed", reasons: ["live_gate_failed"], unresolvedConditions };
  }
  if (record.reviewBy <= input.now) {
    return { state: "expired", reasons: ["evidence_expired"], unresolvedConditions };
  }

  const reasons: EligibilityReason[] = [];
  if (record.lane !== "passed") reasons.push("lane_not_passed");
  if (!admissionPermits(record.admission, record.environment)) {
    reasons.push("admission_does_not_permit");
  }
  if (input.readPathCount <= 0) reasons.push("no_read_paths");
  if (unresolvedConditions.length > 0) reasons.push("open_condition_unresolved");

  return {
    state: reasons.length === 0 ? "passed" : "parked",
    reasons,
    unresolvedConditions,
  };
}

// ── Code-owned caps ───────────────────────────────────────────────────────────────────────

/**
 * Bounds owned by THIS repo, never by a provider's pagination cursor. A read that hits one of
 * these is `partial`, never `ready` — see `validateProjection`.
 */
export const CAPS = {
  /** Pages of a paginated provider list per projection. */
  maxPages: 20,
  /** Normalized rows per projection. */
  maxItems: 2_000,
  /** Raw response bytes an adapter may buffer before it must stop and report `capped`. */
  maxBytes: 2_000_000,
  /** 13 months, so a full trailing-year AR window fits and a "since forever" read does not. */
  maxWindowDays: 400,
  /** Source refs recorded on one projection. */
  maxSources: 200,
} as const;

/** Long enough for a real provider id (`inv_1P4kQ2Jd...`), far short of a pasted record. */
export const REF_CHAR_CAP = 128;

/** Straight AND curly quotes: a possessive ("Acme’s invoice") is the realistic §4 leak. */
const CONTENT_SHAPED = /["'‘’“”\n\r\t]/;

// ── Source refs ───────────────────────────────────────────────────────────────────────────

/** Refs, ids and kinds ONLY — never a customer name, a memo line or an amount (CLAUDE.md §4). */
export type SourceRef = {
  provider: Provider;
  /** A record class: `invoice`, `payment`, `charge`, `deal`. Not a label the user wrote. */
  kind: string;
  /** The provider's own opaque id. */
  id: string;
};

export function validateSourceRef(refValue: SourceRef): Result<true, string> {
  if (!isProvider(refValue.provider)) return err("Unknown provider.");
  for (const [name, value] of [
    ["kind", refValue.kind],
    ["id", refValue.id],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "") return err(`A ref needs a ${name}.`);
    if (value.length > REF_CHAR_CAP) return err(`A ref ${name} is too long to be an id.`);
    if (CONTENT_SHAPED.test(value)) return err(`A ref ${name} must be an id, not content.`);
  }
  return ok(true);
}

// ── Projections ───────────────────────────────────────────────────────────────────────────

export type CoverageWindow = { startMs: number; endMs: number };

export type ProjectionMeta = {
  provider: Provider;
  authority: SourceAuthority;
  /** When the read happened, so freshness is shown rather than assumed. */
  retrievedAt: number;
  window: CoverageWindow;
  /** A cap was hit: the items are a PREFIX of reality. Only legal on a `partial` projection. */
  capped: boolean;
  sources: readonly SourceRef[];
};

/**
 * The three — and only three — ways a provider read can end.
 *
 * `partial` is not a soft `ready`: it carries what is MISSING, and every downstream confidence
 * rule reads that. Collapsing `partial` into `ready` with fewer rows is how a capped list becomes
 * a confident total.
 */
export type Projection<T> =
  | { state: "ready"; meta: ProjectionMeta; items: readonly T[] }
  | { state: "partial"; meta: ProjectionMeta; items: readonly T[]; missing: string }
  | { state: "unavailable"; provider: Provider; because: string };

export function validateProjection<T>(p: Projection<T>): Result<true, string> {
  if (p.state === "unavailable") {
    if (!isProvider(p.provider)) return err("Unknown provider.");
    return p.because.trim() === "" ? err("An unavailable read must say why.") : ok(true);
  }

  const m = p.meta;
  if (!isProvider(m.provider)) return err("Unknown provider.");
  if (!isSourceAuthority(m.authority)) return err("Unknown source authority.");
  if (!Number.isFinite(m.retrievedAt) || m.retrievedAt < 0) {
    return err("A projection must record a valid retrieval time.");
  }
  if (!Number.isFinite(m.window.startMs) || !Number.isFinite(m.window.endMs)) {
    return err("A coverage window must be a real interval.");
  }
  if (m.window.endMs < m.window.startMs)
    return err("A coverage window cannot end before it starts.");
  if (m.window.endMs - m.window.startMs > CAPS.maxWindowDays * DAY_MS) {
    return err("A coverage window exceeds the read cap.");
  }
  if (p.items.length > CAPS.maxItems) return err("A projection exceeds the item cap.");
  if (m.sources.length > CAPS.maxSources) return err("A projection exceeds the source-ref cap.");
  for (const r of m.sources) {
    const v = validateSourceRef(r);
    if (!v.ok) return v;
  }
  if (p.state === "ready" && m.capped) {
    return err("A capped read is partial, never ready.");
  }
  if (p.state === "partial" && p.missing.trim() === "") {
    return err("A partial read must name what is missing.");
  }
  return ok(true);
}

// ── Money ─────────────────────────────────────────────────────────────────────────────────

/** An ISO 4217 alpha-3 code, uppercase. Validated by `money.ts` — never trusted as typed. */
export type Currency = string;

/**
 * The type core does not have. `@pikar/core`'s `CashUnit` is the literal `"usd"`, which is fine
 * for a single-tenant self-reported figure and wrong the moment a Stripe account settles in EUR.
 *
 * `minor` is a SAFE INTEGER count of the currency's minor unit (cents, yen, fils). No float ever
 * holds a money value here; `money.ts` is the only module allowed to make one.
 */
export type Money = { readonly minor: number; readonly currency: Currency };

// ── Figures ───────────────────────────────────────────────────────────────────────────────

/**
 * The three not-a-number states of `@pikar/core`'s `CashFigure`, reused VERBATIM by exclusion so
 * there is exactly one definition of "unknown vs not-applicable vs not-computable" in the repo.
 * Core's `unknownFigure` / `notApplicable` / `notComputable` constructors return values assignable
 * to this, and should be used rather than object literals.
 */
export type Unresolved = Exclude<CashFigure, { state: "known" }>;

/**
 * A figure over an arbitrary value type. Core's `CashFigure` is `Figure<number>` pinned to
 * `CashUnit`; this generic exists only so a `Money` (currency-carrying) or a day-count can occupy
 * the same four states. `actor` is carried for the same reason core carries it: `origin` cannot
 * answer "who wrote this", and attributing an agent's arithmetic to the owner is a recorded defect
 * class in this repo. Absence means UNKNOWN, never "the user".
 */
export type Figure<V> =
  | Unresolved
  | {
      state: "known";
      origin: CashOrigin;
      actor?: FigureActor;
      value: V;
      /** For `derived`: what it was computed FROM, in words. Never rendered without it. */
      from?: string;
    };

export type MoneyFigure = Figure<Money>;
/** A whole number of days. The one unit core's `CashUnit` has no member for. */
export type DayFigure = Figure<number>;
export type CountFigure = Figure<number>;

export const known = <V>(origin: CashOrigin, value: V, from?: string): Figure<V> => ({
  state: "known",
  origin,
  value,
  ...(from === undefined ? {} : { from }),
});

// ── Coverage and confidence ───────────────────────────────────────────────────────────────

export type Coverage = {
  providers: readonly Provider[];
  authorities: readonly SourceAuthority[];
  /** Any contributing read hit a code-owned cap. */
  capped: boolean;
  /** Any contributing read was `partial`. */
  partial: boolean;
  /** Named missing sources or inputs. Labels only — never a value that was missing. */
  missing: readonly string[];
};

/**
 * Closed. `unavailable` is a first-class answer, not a zero: "we could not see your books" and
 * "your receivables are $0" are different sentences and only one of them is ever true here.
 */
export const FINANCE_CONFIDENCES = ["high", "medium", "low", "unavailable"] as const;
export type FinanceConfidence = (typeof FINANCE_CONFIDENCES)[number];

/** Rank for the monotonicity invariant: degraded coverage may only move this DOWN. */
export const CONFIDENCE_RANK: Record<FinanceConfidence, number> = {
  unavailable: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export const DECISION_SUPPORT_NOTICE =
  "Decision support, not financial, tax or accounting advice. Have a qualified professional review before acting.";

/** Every number this package hands out travels with what it could see and how sure it is. */
export type FinanceResult<T> = {
  value: T;
  coverage: Coverage;
  confidence: FinanceConfidence;
  notice: typeof DECISION_SUPPORT_NOTICE;
};

// ── Normalized business rows ──────────────────────────────────────────────────────────────

export type Invoice = {
  ref: SourceRef;
  /** An opaque customer id. NOT a name — names live in Phase 19's contacts substrate. */
  customerRef: string;
  issuedAt: number;
  /** `null` when the provider has no due date. Aging puts these in the `unknown` bucket. */
  dueAt: number | null;
  total: Money;
  /** What is still owed. Equal to `total` for an untouched invoice. */
  outstanding: Money;
};

export type Payment = {
  ref: SourceRef;
  authority: SourceAuthority;
  /** The invoice this settles, when the source knows. `null` for an unlinked rail charge. */
  invoiceId: string | null;
  paidAt: number;
  amount: Money;
};

export type Obligation = {
  ref: SourceRef;
  /** `payroll` drives the payroll-gap answer; everything else is ordinary outflow. */
  kind: "payroll" | "other";
  dueAt: number;
  amount: Money;
};
