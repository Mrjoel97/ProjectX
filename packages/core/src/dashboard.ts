// Pure shared contracts for connected dashboard pages (CLAUDE.md §1).
// No clock, framework, persistence, or formatting dependency belongs in this module.

export type DashboardTimeZoneSource = "tenant" | "browser-fallback";

export interface DashboardWindow {
  /** Inclusive epoch-millisecond boundary. */
  sinceMs: number;
  /** Exclusive epoch-millisecond boundary. */
  untilMs: number;
  /** A validated IANA timezone used for display, never for persistence/filtering. */
  timeZone: string;
  /** Makes the temporary browser-derived timezone contract visible to every consumer. */
  timeZoneSource: DashboardTimeZoneSource;
}

export interface DashboardWindowInput {
  sinceMs: number;
  untilMs: number;
  maxSpanMs: number;
  tenantTimeZone?: string;
  browserTimeZone: string;
  /** Optional inclusive lower coverage boundary. */
  coverageSinceMs?: number;
  /** Optional exclusive upper coverage boundary. */
  coverageUntilMs?: number;
}

function requireSafeMs(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer epoch ms`);
}

function requireIanaTimeZone(value: string): void {
  if (!value.trim()) throw new Error("timeZone must be a named IANA timezone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
  } catch {
    throw new Error("timeZone must be a named IANA timezone");
  }
}

/**
 * Validate a requested half-open window, then clamp it to known data coverage.
 *
 * The caller chooses the maximum span; this helper cannot silently turn an oversized request into
 * a cheaper/different report. Coverage clamping is explicit and happens only after validation.
 */
export function resolveDashboardWindow(input: DashboardWindowInput): DashboardWindow {
  requireSafeMs(input.sinceMs, "sinceMs");
  requireSafeMs(input.untilMs, "untilMs");
  requireSafeMs(input.maxSpanMs, "maxSpanMs");
  if (input.maxSpanMs <= 0) throw new Error("maxSpanMs must be greater than zero");
  if (input.sinceMs >= input.untilMs) throw new Error("sinceMs must be before untilMs");
  if (input.untilMs - input.sinceMs > input.maxSpanMs) {
    throw new Error("dashboard window exceeds its maximum span");
  }

  if (input.coverageSinceMs !== undefined) requireSafeMs(input.coverageSinceMs, "coverageSinceMs");
  if (input.coverageUntilMs !== undefined) requireSafeMs(input.coverageUntilMs, "coverageUntilMs");
  if (
    input.coverageSinceMs !== undefined &&
    input.coverageUntilMs !== undefined &&
    input.coverageSinceMs >= input.coverageUntilMs
  ) {
    throw new Error("coverageSinceMs must be before coverageUntilMs");
  }

  const sinceMs = Math.max(input.sinceMs, input.coverageSinceMs ?? input.sinceMs);
  const untilMs = Math.min(input.untilMs, input.coverageUntilMs ?? input.untilMs);
  if (sinceMs >= untilMs) throw new Error("dashboard window has no covered time");

  const timeZone = input.tenantTimeZone ?? input.browserTimeZone;
  requireIanaTimeZone(timeZone);
  return {
    sinceMs,
    untilMs,
    timeZone,
    timeZoneSource: input.tenantTimeZone === undefined ? "browser-fallback" : "tenant",
  };
}

export type DashboardMoneyPhase = "estimated" | "reserved" | "actual" | "refunded" | "unlanded";

export type DashboardMoney = {
  [Phase in DashboardMoneyPhase]: {
    phase: Phase;
    amountCents: number;
    currency: "USD";
  };
}[DashboardMoneyPhase];

/** Build a display-boundary money value without accepting floats, negatives, or another currency. */
export function createDashboardMoney<Phase extends DashboardMoneyPhase>(
  phase: Phase,
  amountCents: number,
): Extract<DashboardMoney, { phase: Phase }> {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error("dashboard money must use non-negative integer USD cents");
  }
  return { phase, amountCents, currency: "USD" } as Extract<DashboardMoney, { phase: Phase }>;
}

export type DashboardPartialReason =
  | "row-cap"
  | "time-cap"
  | "legacy-window"
  | "coverage-gap"
  | "source-unavailable";

export interface DashboardBound {
  returned: number;
  limit: number;
  nextCursor: string | null;
  partial: boolean;
  partialReason?: DashboardPartialReason;
}

/**
 * Validate the metadata that keeps bounded results honest.
 * A result can be partial without another cursor (for example, legacy or coverage gaps).
 */
export function createDashboardBound(bound: DashboardBound): DashboardBound {
  if (!Number.isSafeInteger(bound.limit) || bound.limit <= 0) {
    throw new Error("dashboard limit must be a positive safe integer");
  }
  if (!Number.isSafeInteger(bound.returned) || bound.returned < 0 || bound.returned > bound.limit) {
    throw new Error("dashboard returned count must be between zero and limit");
  }
  if (bound.nextCursor !== null && !bound.partial) {
    throw new Error("a nextCursor requires partial results");
  }
  if (bound.partial !== (bound.partialReason !== undefined)) {
    throw new Error("partial and partialReason must be declared together");
  }
  return { ...bound };
}

export interface DashboardOrderKey {
  createdAt: number;
  id: string;
}

/** Newest-first total order; descending id makes equal timestamps deterministic. */
export function compareDashboardOrder(a: DashboardOrderKey, b: DashboardOrderKey): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

const CURSOR_PREFIX = "v1:";

export function dashboardCursorFor(key: DashboardOrderKey): string {
  requireSafeMs(key.createdAt, "cursor createdAt");
  if (!key.id || key.id.length > 512) throw new Error("cursor id must contain 1-512 characters");
  return `${CURSOR_PREFIX}${key.createdAt}:${encodeURIComponent(key.id)}`;
}

export function parseDashboardCursor(cursor: string): DashboardOrderKey {
  if (!cursor.startsWith(CURSOR_PREFIX) || cursor.length > 1_024) {
    throw new Error("invalid dashboard cursor");
  }
  const separator = cursor.indexOf(":", CURSOR_PREFIX.length);
  if (separator < 0) throw new Error("invalid dashboard cursor");
  const createdAt = Number(cursor.slice(CURSOR_PREFIX.length, separator));
  let id: string;
  try {
    id = decodeURIComponent(cursor.slice(separator + 1));
  } catch {
    throw new Error("invalid dashboard cursor");
  }
  requireSafeMs(createdAt, "cursor createdAt");
  if (!id || id.length > 512 || dashboardCursorFor({ createdAt, id }) !== cursor) {
    throw new Error("invalid dashboard cursor");
  }
  return { createdAt, id };
}

/**
 * Product copy for page-wide states is code-owned. Backends return typed facts, never display prose.
 * Page-specific detail can sit beside this vocabulary without changing what these states mean.
 */
export const DASHBOARD_STATE_COPY = {
  loading: { label: "Loading", retry: false },
  empty: { label: "Nothing here yet", retry: false },
  ready: { label: "Ready", retry: false },
  partial: { label: "Some results are not shown", retry: false },
  busy: { label: "Working", retry: false },
  error: { label: "This could not be loaded", retry: true },
  refusal: { label: "This action is not available", retry: false },
} as const;

export type DashboardPageState = keyof typeof DASHBOARD_STATE_COPY;

export type DashboardRefusalReason =
  | "unauthenticated"
  | "forbidden"
  | "owner-required"
  | "reauthorization-required"
  | "governed";

type CompleteDashboardBound = DashboardBound & {
  partial: false;
  partialReason?: never;
};

type PartialDashboardBound = DashboardBound & {
  partial: true;
  partialReason: DashboardPartialReason;
};

/** Closed page-result vocabulary; data-bearing success never shares a shape with failure/refusal. */
export type DashboardResult<Data> =
  | { state: "loading" }
  | { state: "empty" }
  | { state: "ready"; data: Data; bound: CompleteDashboardBound }
  | { state: "partial"; data: Data; bound: PartialDashboardBound }
  | { state: "busy" }
  | { state: "error"; code: "query-failed" | "timed-out"; retryable: true }
  | { state: "refusal"; reason: DashboardRefusalReason };
