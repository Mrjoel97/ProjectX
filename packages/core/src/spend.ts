/**
 * FIN-01 spend arithmetic — the PURE half of the Finance ledger (CLAUDE.md §1).
 *
 * The Convex adapter (`convex/spendLedger.ts`) owns storage, correlation idempotence and
 * bounded reads. Everything that can be decided without a database lives here.
 *
 * TWO PLANES, DELIBERATELY. The rate limiter stays ENFORCEMENT truth — it decides whether a
 * spend may happen at all. This ledger is REPORTING/RECONCILIATION truth — it remembers what
 * happened. They are not redundant: a limiter is a gauge of the present and structurally
 * cannot answer "what did this tenant spend last Tuesday on the media rail".
 */

import { createDashboardMoney, type DashboardMoney, type DashboardMoneyPhase } from "./dashboard";

/** The three metered rails. A fourth is a deliberate schema edit, not a string. */
export const SPEND_RAILS = ["reasoning", "media", "ingest"] as const;
export type SpendRail = (typeof SPEND_RAILS)[number];

/**
 * The movement phases, matching `spendEvents.phase` in the schema exactly.
 * `adjustment` is a post-hoc correction UPWARD (we owe more than we recorded); money coming
 * back is a `refunded` movement. Both are positive — direction lives in the phase, never in
 * the sign, so no consumer has to guess whether a negative number is a credit or a bug.
 */
export const SPEND_PHASES = ["estimated", "reserved", "actual", "refunded", "adjustment"] as const;
export type SpendPhase = (typeof SPEND_PHASES)[number];

export interface SpendMovement {
  rail: SpendRail;
  phase: SpendPhase;
  /** Positive integer USD cents. */
  amountCents: number;
  /** Server-minted, ref-derived. Identity for replay suppression is (correlationId, phase). */
  correlationId: string;
  /** Code-owned model id, never a caller-supplied string. */
  model?: string;
  /** Code-owned work kind (e.g. `video`, `embed`), never a caller-supplied string. */
  kind?: string;
}

// Refs, ids and code-owned tokens only — no space, so a pasted sentence cannot pass (CLAUDE.md §4).
const TOKEN = /^[A-Za-z0-9._:@/-]+$/;

function requireToken(value: string, name: string, maxLength: number): void {
  if (!value || value.length > maxLength || !TOKEN.test(value)) {
    throw new Error(`${name} must be a code-owned token of 1-${maxLength} ref-safe characters`);
  }
}

/**
 * Validate one movement at the trust boundary and return a defensive copy. Throws rather than
 * coercing: a movement that cannot be trusted must never reach an append-only table, where it
 * can be neither corrected nor deleted.
 */
export function validateSpendMovement(input: SpendMovement): SpendMovement {
  if (!(SPEND_RAILS as readonly string[]).includes(input.rail)) {
    throw new Error(`unknown spend rail: ${String(input.rail)}`);
  }
  if (!(SPEND_PHASES as readonly string[]).includes(input.phase)) {
    throw new Error(`unknown spend phase: ${String(input.phase)}`);
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("spend amountCents must be a positive safe integer");
  }
  requireToken(input.correlationId, "correlationId", 128);
  if (input.model !== undefined) requireToken(input.model, "model", 64);
  if (input.kind !== undefined) requireToken(input.kind, "kind", 64);

  const movement: SpendMovement = {
    rail: input.rail,
    phase: input.phase,
    amountCents: input.amountCents,
    correlationId: input.correlationId,
  };
  if (input.model !== undefined) movement.model = input.model;
  if (input.kind !== undefined) movement.kind = input.kind;
  return movement;
}

export type SpendTotals = {
  [Phase in DashboardMoneyPhase]: Extract<DashboardMoney, { phase: Phase }>;
};

export type SpendAggregate =
  | { coverage: "unknown"; reason: "not-started" | "window-precedes-coverage" }
  | { coverage: "covered"; totals: SpendTotals };

export interface SpendAggregateInput {
  /** Movements already restricted to the reported window by the caller's indexed read. */
  movements: readonly SpendMovement[];
  /** Inclusive start of the reported window. */
  windowSinceMs: number;
  /** Absent means instrumentation never started for this tenant. */
  coverageStartedAt?: number;
}

/**
 * Total a covered window, or say the window is UNKNOWN.
 *
 * The unknown branch is the whole point. Summing an uninstrumented window yields `0`, and a
 * zero that means "we were not watching" is indistinguishable on a Finance page from a zero
 * that means "nothing was spent". Only an explicit coverage start can tell them apart, and a
 * gap can never be backfilled — the events were simply never observed.
 */
export function aggregateSpend(input: SpendAggregateInput): SpendAggregate {
  if (input.coverageStartedAt === undefined) {
    return { coverage: "unknown", reason: "not-started" };
  }
  if (input.windowSinceMs < input.coverageStartedAt) {
    return { coverage: "unknown", reason: "window-precedes-coverage" };
  }

  const sums: Record<SpendPhase, number> = {
    estimated: 0,
    reserved: 0,
    actual: 0,
    refunded: 0,
    adjustment: 0,
  };
  for (const raw of input.movements) {
    const movement = validateSpendMovement(raw);
    sums[movement.phase] += movement.amountCents;
  }

  // An adjustment corrects what was charged, so landed cost is actual + adjustment.
  const landed = sums.actual + sums.adjustment;
  // Reserved money that neither landed nor came back. Clamped: a landing larger than its
  // reservation is a reconciliation signal, not a negative balance to display.
  const unlanded = Math.max(0, sums.reserved - landed - sums.refunded);

  return {
    coverage: "covered",
    totals: {
      estimated: createDashboardMoney("estimated", sums.estimated),
      reserved: createDashboardMoney("reserved", sums.reserved),
      actual: createDashboardMoney("actual", landed),
      refunded: createDashboardMoney("refunded", sums.refunded),
      unlanded: createDashboardMoney("unlanded", unlanded),
    },
  };
}
