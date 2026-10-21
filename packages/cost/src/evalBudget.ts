/** Conservative provider-contract bounds, reviewed against OpenRouter /api/v1/models 2026-09-10.
 * Reserve the WHOLE accepted context, not chars/4. Provider max_price is also enforced on wire.
 * These are ceilings, not billing rates: reconciliation uses the provider's reported USD cost.
 */
export const EVAL_MODEL_BOUNDS: Readonly<
  Record<
    string,
    {
      contextTokens: number;
      promptPerMillion: number;
      completionPerMillion: number;
    }
  >
> = {
  "or/openai/gpt-5.6-luna": {
    contextTokens: 1_050_000,
    promptPerMillion: 0.5,
    completionPerMillion: 1.8,
  },
  "or/openai/gpt-4.1-mini": {
    contextTokens: 1_047_576,
    promptPerMillion: 0.4,
    completionPerMillion: 1.6,
  },
};
export const EVAL_MAX_OUTPUT_TOKENS = 8192;
export const EVAL_MAX_BUDGET_CENTS = 1000;
export const EVAL_BUDGET_LIFETIME_MS = 60 * 60 * 1000;

export function evalCallCeilingCents(model: string, outputTokens: number): number {
  const bound = EVAL_MODEL_BOUNDS[model];
  if (!bound) throw new Error("EVAL_MODEL_UNSUPPORTED");
  if (
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 1 ||
    outputTokens > EVAL_MAX_OUTPUT_TOKENS
  )
    throw new Error("EVAL_OUTPUT_LIMIT_REQUIRED");
  return Math.ceil(
    (bound.contextTokens * bound.promptPerMillion + outputTokens * bound.completionPerMillion) /
      10_000,
  );
}

export function evalActualCents(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error("EVAL_COST_UNKNOWN");
  return Math.ceil(costUsd * 100);
}

const NANOS_PER_CENT = 10_000_000;
const invalidLedger = (): never => {
  throw new Error("EVAL_LEDGER_INVALID");
};
const safeNonnegative = (value: number): number =>
  Number.isSafeInteger(value) && value >= 0 ? value : invalidLedger();
const centsToNanos = (value: number): number => {
  safeNonnegative(value);
  return safeNonnegative(value * NANOS_PER_CENT);
};

/** Round each reported decimal USD amount UP, including exponent notation. Multiplying a
 * binary float by 1e9 can round a value just above an integer down onto that integer first. */
function actualNanos(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) invalidLedger();
  const [coefficient, exponent = "0"] = usd.toString().split("e");
  if (coefficient === undefined) return invalidLedger();
  const [whole = "0", fraction = ""] = coefficient.split(".");
  const digits = BigInt(whole + fraction);
  const power = Number(exponent) + 9 - fraction.length;
  const scale = 10n ** BigInt(Math.abs(power));
  const nanos = power >= 0 ? digits * scale : (digits + scale - 1n) / scale;
  if (nanos > BigInt(Number.MAX_SAFE_INTEGER)) invalidLedger();
  return Number(nanos);
}

/** Opt-in family arithmetic only. Legacy per-call cents and daily/deployment rails stay intact.
 * Callers must read these rows and append a reservation in the SAME transaction. Unknown calls
 * retain their FULL ceiling. Native breach flags still prevent new admission; known overages
 * remain visible here with availability clamped at zero rather than losing the observed bill. */
export function evalLedgerUsageNanos(
  capCents: number,
  reservations: readonly { correlationId: string; amountCents: number }[],
  settlements: readonly { correlationId: string; evalActualUsd: number }[],
): {
  remainingNanos: number;
  remainingCents: number;
  actualNanos: number;
  outstandingNanos: number;
} {
  if (
    !Number.isSafeInteger(capCents) ||
    capCents < 1 ||
    capCents > EVAL_MAX_BUDGET_CENTS ||
    !Array.isArray(reservations) ||
    !Array.isArray(settlements) ||
    reservations.length > 500 ||
    settlements.length > 500
  )
    invalidLedger();
  const ceilings = new Map<string, number>();
  for (const row of reservations) {
    if (
      !row ||
      typeof row.correlationId !== "string" ||
      !row.correlationId.trim() ||
      row.correlationId.length > 160 ||
      row.correlationId !== row.correlationId.trim() ||
      ceilings.has(row.correlationId) ||
      !Number.isSafeInteger(row.amountCents) ||
      row.amountCents < 1
    )
      invalidLedger();
    ceilings.set(row.correlationId, centsToNanos(row.amountCents));
  }
  const settled = new Set<string>();
  let actual = 0,
    outstanding = 0;
  for (const row of settlements) {
    if (!row || !ceilings.has(row.correlationId) || settled.has(row.correlationId)) invalidLedger();
    actual = safeNonnegative(actual + actualNanos(row.evalActualUsd));
    settled.add(row.correlationId);
  }
  for (const [id, ceiling] of ceilings) {
    if (!settled.has(id)) outstanding = safeNonnegative(outstanding + ceiling);
  }
  const used = safeNonnegative(actual + outstanding);
  const remainingNanos = Math.max(0, centsToNanos(capCents) - used);
  return {
    remainingNanos,
    remainingCents: Math.floor(remainingNanos / NANOS_PER_CENT),
    actualNanos: actual,
    outstandingNanos: outstanding,
  };
}

export function evalLedgerCanReserve(remainingNanos: number, newCallCeilingCents: number): boolean {
  safeNonnegative(remainingNanos);
  if (!Number.isSafeInteger(newCallCeilingCents) || newCallCeilingCents < 1) invalidLedger();
  return centsToNanos(newCallCeilingCents) <= remainingNanos;
}
