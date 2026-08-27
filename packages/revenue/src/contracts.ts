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
