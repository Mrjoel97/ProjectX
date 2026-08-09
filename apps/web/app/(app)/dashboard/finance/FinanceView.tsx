"use client";

// FIN-01 Cost Console. THIS PAGE READS WHAT PIKAR SPENDS — it is not a business-money surface.
// There is no revenue, invoice or cash-position data anywhere in the system, so a "Revenue" tile
// would be a fabricated number (BRAND §5, owner rename decision 2026-08-07: Finance → Cost; Cash is
// Phase 28's separate surface). Currency is USD everywhere.
//
// THE THREE THINGS THIS PAGE MUST NOT DO, all of them ways of turning a truthful backend into a
// dishonest screen (docs/playbooks/dashboard-pages.md §"Finance projections and owner controls"):
//   1. Render an `unknown` window as `$0`. Instrumentation started at a moment; before it we were
//      not watching, and that can never be backfilled. Unknown gets its own copy, never a number.
//   2. Describe media's `unlanded` money as "pending". That rail has NO refund path, so the gap
//      between reservation and landing is permanent. `unlandedResolves` says so per rail.
//   3. Show a capped window's totals as the period's spend. `bound.partial` means the figure is a
//      FLOOR.
//
// Every section owns its own `useQuery`, so a ledger error cannot erase the live budget rails —
// they are different planes and must fail independently (the ApprovalsView section idiom).
import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
  useMemo,
  useState,
} from "react";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const LEDGER_PAGE_SIZE = 25;

// ── styles ────────────────────────────────────────────────────────────────────────────
// Inline `CSSProperties`, matching ApprovalsView: almost none of the mockup's class names exist in
// `globals.css` (`.card`, `.meter`, `.pill`, `.btn`, `.sec` are mockup-only, and `.ledger` IS
// defined but is the DARK marketing audit block from the landing page — using it here would render
// this console on a navy panel). The five `stat-*` classes below are the real shared ones.
const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  padding: "1rem",
  boxShadow: "0 10px 30px color-mix(in srgb, var(--ink) 7%, transparent)",
};
const stack: CSSProperties = { display: "grid", gap: "0.75rem" };
const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "0.65rem",
};
const muted: CSSProperties = { color: "var(--ink-soft)", margin: 0, lineHeight: 1.55 };
const caps: CSSProperties = {
  color: "var(--ink-soft)",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  margin: 0,
};
const cardTitle: CSSProperties = {
  margin: 0,
  fontSize: "1.05rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--ink)",
};
const button: CSSProperties = {
  minHeight: "2.5rem",
  borderRadius: "999px",
  padding: "0.5rem 1.1rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  font: "inherit",
  fontSize: "0.86rem",
  fontWeight: 600,
  cursor: "pointer",
};
const primary: CSSProperties = {
  ...button,
  borderColor: "var(--teal-600)",
  background: "var(--teal-600)",
  color: "var(--card)",
};
const table: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.88rem",
};
const th: CSSProperties = {
  ...caps,
  textAlign: "left",
  padding: "0.4rem 0.5rem",
  borderBottom: "1px solid var(--rule)",
  whiteSpace: "nowrap",
};
const td: CSSProperties = {
  padding: "0.45rem 0.5rem",
  borderBottom: "1px solid color-mix(in srgb, var(--rule) 55%, transparent)",
  verticalAlign: "top",
};
const numeric: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const mono: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.78rem",
  color: "var(--ink-soft)",
  wordBreak: "break-all",
};
/** Horizontal scroll container — a data table must never make the PAGE scroll sideways. */
const scroller: CSSProperties = { overflowX: "auto" };

// ── pure helpers (exported so the DOM-free runner can cover them) ──────────────────────

/**
 * Integer USD cents → a displayable amount. The backend never sends a float or another currency
 * (`createDashboardMoney` refuses both), so this formats rather than defends — but it stays a pure
 * exported function because it is the one arithmetic-shaped thing on this page.
 */
export function formatUsdCents(amountCents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    amountCents / 100,
  );
}

/** USD dollars (the per-request budget is stored in dollars, not cents). */
export function formatUsd(amountUsd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(amountUsd);
}

export const RAIL_LABELS = {
  reasoning: "Reasoning & drafting",
  media: "Media generation",
  ingest: "Vault ingest",
} as const;

export type RailName = keyof typeof RAIL_LABELS;

/**
 * What `unlanded` money MEANS on this rail. Two different facts wearing one word.
 *
 * On reasoning and ingest it is money in flight — a reservation whose work has not finished, or
 * whose refund is still owed. On MEDIA the rail consumes the whole job estimate up front and has no
 * refund path at all, so the gap is never coming back. Calling that "pending" tells the owner to
 * expect a credit that cannot arrive.
 */
export function unlandedCopy(resolves: boolean): string {
  return resolves
    ? "Reserved and not yet settled — still expected to land as spend or come back as a refund."
    : "Reserved and never returned. This rail has no refund path, so the difference is permanent — not pending.";
}

/** Absolute instant in a named zone, with the zone spelled out. Never a bare local time. */
export function formatInstant(epochMs: number, timeZone: string): string {
  try {
    return `${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(epochMs))} (${timeZone})`;
  } catch {
    return `${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(epochMs))} (UTC)`;
  }
}

export function formatUtcDay(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(epochMs));
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Why a period is Unknown, in words. **There is deliberately no number in either branch.** A zero
 * here would be indistinguishable from a period we watched and in which nothing was spent, and the
 * whole point of `spendCoverage` is that those are different answers.
 */
export function coverageCopy(
  reason: "not-started" | "window-precedes-coverage",
  coverageStartedAt: number | null,
): string {
  // No figure appears in either branch, and that is the whole contract: a rendered amount here —
  // even a zero — is indistinguishable from a period we watched in which nothing was spent. The
  // component test asserts this branch renders no currency mark at all.
  if (reason === "not-started") {
    return "Cost tracking has not started for this workspace yet, so this period is Unknown rather than zero. It begins the first time a spend gate runs.";
  }
  const from =
    coverageStartedAt === null ? "later than this window" : formatUtcDay(coverageStartedAt);
  return `Cost tracking began ${from}. Anything before that is Unknown rather than zero, and it cannot be reconstructed.`;
}

const STATE_COPY = {
  loading: "Loading cost…",
  empty: "No cost recorded in this period.",
  partial:
    "More rows exist than this bounded page shows. Totals here are a floor, not the period's spend.",
  unknown: "This period is Unknown.",
  clamped: "Showing only the period cost tracking covers.",
  busy: "Applying…",
  error: "Couldn’t load cost. Retry when the connection is ready.",
  refusal: "That control is not available to this account. Nothing changed.",
} as const;

export type FinanceState = keyof typeof STATE_COPY;

/**
 * The window was shortened to where instrumentation begins, and this says so.
 *
 * Found by the 26-10 UAT: a fixed 30-day window over a tenant covered since yesterday made
 * `aggregateSpend` return `unknown` for the WHOLE period — so the totals read "Unknown" while the
 * per-day series directly beneath them showed real money on a covered day. One uncovered day at the
 * start suppressed every day we did observe, for a month after any tenant starts.
 *
 * Clamping is only safe because it is ANNOUNCED. A silent clamp reports a confident total for a
 * narrower period than the reader asked for, which is the failure the coverage field exists to
 * prevent. A tenant with NO coverage at all is never clamped — that stays the full Unknown state.
 */
export function CoverageClampNotice({ startedAt }: { startedAt: number }) {
  return (
    <FinanceStateNotice state="clamped">
      Showing since <strong>{formatUtcDay(startedAt)}</strong>, when cost tracking began. Earlier
      days are Unknown rather than zero, and cannot be reconstructed.
    </FinanceStateNotice>
  );
}

/** One accessible, screen-reader-announced notice per page state. */
export function FinanceStateNotice({
  state,
  children,
}: {
  state: FinanceState;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-finance-state={state}
      style={{
        border: "1px dashed var(--rule)",
        borderRadius: "0.75rem",
        padding: "0.85rem 1rem",
        color: "var(--ink-soft)",
        background: "color-mix(in srgb, var(--card) 70%, transparent)",
      }}
    >
      {children ?? STATE_COPY[state]}
    </div>
  );
}

type SummaryResult = FunctionReturnType<typeof api.finance.summary>;
type RailView = SummaryResult["rails"][number];
type TrackedResult = SummaryResult["tracked"];
type SeriesResult = FunctionReturnType<typeof api.finance.spendSeries>;
type LedgerResult = FunctionReturnType<typeof api.finance.mediaLedger>;
type ControlsResult = FunctionReturnType<typeof api.finance.controls>;
type GlobalRailsResult = FunctionReturnType<typeof api.finance.globalRails>;

/**
 * One budget rail. The percentage is ALSO stated in words beside the meter, because a bar that is
 * the only carrier of "you are nearly out" encodes meaning in a visual alone (BRAND §6). The meter
 * is a native `<progress>` — the in-app precedent (ApprovalsView delivery progress) and it needs no
 * new CSS. Deliberately NOT the mockup's `.meter.warn`, whose amber is `--held`: BRAND §2 reserves
 * amber for the approval gate, "spend amber in exactly one place".
 */
export function RailTile({ rail }: { rail: RailView }) {
  const pctUsed = rail.capCents === 0 ? 0 : Math.round((rail.usedCents / rail.capCents) * 100);
  return (
    <div className="stat-tile" data-rail={rail.rail}>
      <div className="stat-head">
        <p className="caps-label">{RAIL_LABELS[rail.rail as RailName] ?? rail.rail}</p>
      </div>
      <div className="stat-value">{formatUsdCents(rail.remainingCents)}</div>
      <progress
        value={rail.usedCents}
        max={rail.capCents}
        aria-label={`${RAIL_LABELS[rail.rail as RailName] ?? rail.rail}: ${pctUsed}% of today's budget used`}
        style={{ width: "100%" }}
      />
      <p style={{ ...muted, fontSize: "0.8rem" }}>
        left of {formatUsdCents(rail.capCents)} today · {pctUsed}% used · resets{" "}
        {formatInstant(rail.resetsAtMs, rail.resetTimeZone)}
      </p>
    </div>
  );
}

const PHASE_ORDER = ["estimated", "reserved", "actual", "refunded", "unlanded"] as const;
const PHASE_LABELS: Record<(typeof PHASE_ORDER)[number], string> = {
  estimated: "Estimated",
  reserved: "Reserved",
  actual: "Landed",
  refunded: "Refunded",
  unlanded: "Unlanded",
};

/**
 * The window's totals, or the reason they cannot be stated.
 *
 * `unlandedResolves` is threaded in per rail rather than summarised once: the blended `unlanded`
 * figure is the SUM of three per-rail numbers that do not mean the same thing, so the per-rail table
 * carries the meaning and the blended row carries only the arithmetic.
 */
export function TrackedTotals({
  tracked,
  coverageStartedAt,
  unlandedResolves,
  partial,
}: {
  tracked: TrackedResult;
  coverageStartedAt: number | null;
  unlandedResolves: Record<string, boolean>;
  partial: boolean;
}) {
  if (tracked.coverage === "unknown") {
    return (
      <FinanceStateNotice state="unknown">
        <strong>Unknown</strong> — {coverageCopy(tracked.reason, coverageStartedAt)}
      </FinanceStateNotice>
    );
  }
  const rails = Object.keys(tracked.byRail) as RailName[];
  return (
    <div style={stack}>
      {partial ? <FinanceStateNotice state="partial" /> : null}
      <div style={scroller}>
        <table style={table}>
          <caption style={{ ...caps, textAlign: "left", paddingBottom: "0.4rem" }}>
            Tracked cost by rail, in USD
          </caption>
          <thead>
            <tr>
              <th style={th} scope="col">
                Rail
              </th>
              {PHASE_ORDER.map((phase) => (
                <th key={phase} style={{ ...th, textAlign: "right" }} scope="col">
                  {PHASE_LABELS[phase]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rails.map((name) => (
              <tr key={name} data-rail-row={name}>
                <th style={{ ...td, fontWeight: 600 }} scope="row">
                  {RAIL_LABELS[name] ?? name}
                </th>
                {PHASE_ORDER.map((phase) => (
                  <td key={phase} style={numeric}>
                    {formatUsdCents(tracked.byRail[name][phase].amountCents)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th style={{ ...td, fontWeight: 700 }} scope="row">
                All rails
              </th>
              {PHASE_ORDER.map((phase) => (
                <td key={phase} style={{ ...numeric, fontWeight: 700 }}>
                  {formatUsdCents(tracked.totals[phase].amountCents)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <ul style={{ ...muted, fontSize: "0.82rem", margin: 0, paddingLeft: "1.1rem" }}>
        {rails
          .filter((name) => tracked.byRail[name].unlanded.amountCents > 0)
          .map((name) => (
            <li key={name} data-unlanded={name}>
              <strong>
                {RAIL_LABELS[name] ?? name}:{" "}
                {formatUsdCents(tracked.byRail[name].unlanded.amountCents)} unlanded.
              </strong>{" "}
              {unlandedCopy(unlandedResolves[name] === true)}
            </li>
          ))}
      </ul>
    </div>
  );
}

/**
 * The period as UTC days. A table, not a bar chart: the axis values are the point, and the mockup's
 * `.bars` primitives do not exist in `globals.css`. Each row carries an inline proportional bar as
 * decoration only (`aria-hidden`), so nothing is encoded in the visual alone.
 *
 * A bucket that starts before coverage renders "Unknown", never `$0` — the same rule as the totals,
 * applied per day, which is why the backend aggregates each bucket separately.
 *
 * ponytail: a text series with a decorative bar. Upgrade path if the owner wants the mockup's real
 * chart is a charting primitive in `globals.css`, not more inline style here.
 */
export function SpendSeriesTable({ buckets }: { buckets: SeriesResult["buckets"] }) {
  const peak = buckets.reduce(
    (max, bucket) =>
      bucket.coverage === "covered" ? Math.max(max, bucket.totals.actual.amountCents) : max,
    0,
  );
  return (
    <div style={scroller}>
      <table style={table}>
        <caption style={{ ...caps, textAlign: "left", paddingBottom: "0.4rem" }}>
          Landed cost per UTC day
        </caption>
        <thead>
          <tr>
            <th style={th} scope="col">
              Day (UTC)
            </th>
            <th style={{ ...th, textAlign: "right" }} scope="col">
              Landed
            </th>
            <th style={th} scope="col">
              <span aria-hidden="true">Share</span>
              <span className="sr-only" style={{ position: "absolute", left: "-9999px" }}>
                Proportion of the peak day
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.startMs} data-bucket={bucket.startMs}>
              <th style={{ ...td, fontWeight: 500 }} scope="row">
                {formatUtcDay(bucket.startMs)}
              </th>
              <td style={numeric}>
                {bucket.coverage === "covered" ? (
                  formatUsdCents(bucket.totals.actual.amountCents)
                ) : (
                  <span style={{ color: "var(--ink-soft)" }}>Unknown</span>
                )}
              </td>
              <td style={td} aria-hidden="true">
                <span
                  style={{
                    display: "block",
                    height: "0.5rem",
                    borderRadius: "999px",
                    background: "var(--teal-600)",
                    width:
                      bucket.coverage === "covered" && peak > 0
                        ? `${Math.round((bucket.totals.actual.amountCents / peak) * 100)}%`
                        : "0%",
                    minWidth:
                      bucket.coverage === "covered" && bucket.totals.actual.amountCents > 0
                        ? "2px"
                        : 0,
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PHASE_PILL: Record<string, string> = {
  estimated: "Estimated",
  reserved: "Reserved",
  actual: "Landed",
  refunded: "Refunded",
  adjustment: "Adjustment",
};

/** One media movement. Refs, phases and money only — never a prompt, a filename or a person. */
export function MediaLedgerTable({ items }: { items: LedgerResult["items"] }) {
  return (
    <div style={scroller}>
      <table style={table}>
        <caption style={{ ...caps, textAlign: "left", paddingBottom: "0.4rem" }}>
          Media movements, newest first
        </caption>
        <thead>
          <tr>
            <th style={th} scope="col">
              When
            </th>
            <th style={th} scope="col">
              Movement
            </th>
            <th style={{ ...th, textAlign: "right" }} scope="col">
              Amount
            </th>
            <th style={th} scope="col">
              Kind
            </th>
            <th style={th} scope="col">
              Correlation
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} data-movement-id={item.id}>
              <td style={td}>{formatUtcDay(item.createdAt)}</td>
              <td style={td} data-phase={item.phase}>
                {PHASE_PILL[item.phase] ?? item.phase}
              </td>
              <td style={numeric}>{formatUsdCents(item.amountCents)}</td>
              <td style={td}>{item.kind ?? item.model ?? "—"}</td>
              <td style={{ ...td, ...mono }}>{item.correlationId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One deployment control. `requiresConfirmation` is a backend fact, not a UI preference, so the
 * confirm step is driven by it rather than by a prop someone can forget: every one of these changes
 * what the WHOLE deployment may spend, for every tenant.
 *
 * The confirm step is in-component, never `window.confirm` — a browser modal blocks the page and
 * cannot be driven by the browser spec that has to prove this boundary.
 */
export function ControlRow({
  label,
  description,
  state,
  actionLabel,
  requiresConfirmation,
  busy,
  onConfirm,
}: {
  label: string;
  description: string;
  state: string;
  actionLabel: string;
  requiresConfirmation: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <div style={{ ...card, ...row }} data-control={label}>
      <div style={{ flex: "1 1 16rem" }}>
        <p style={caps}>{label}</p>
        <p style={{ ...muted, fontSize: "0.85rem" }}>{description}</p>
        <p style={{ margin: "0.35rem 0 0", fontWeight: 700 }}>{state}</p>
      </div>
      {armed || !requiresConfirmation ? (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            style={primary}
            disabled={busy}
            onClick={() => {
              setArmed(false);
              onConfirm();
            }}
          >
            {busy ? "Applying…" : `Confirm — ${actionLabel}`}
          </button>
          {requiresConfirmation ? (
            <button type="button" style={button} disabled={busy} onClick={() => setArmed(false)}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : (
        <button type="button" style={button} onClick={() => setArmed(true)}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * The owner section, as a PURE component so both roles are testable without a server.
 *
 * A non-owner sees a sentence and nothing else — no ceiling, no utilization, no switch state. That
 * is presentation only; the wrappers on `finance.globalRails`/`controls` are what actually stop
 * them, and a non-owner calling those directly gets `OWNER_REQUIRED`.
 */
export function DeploymentSection({
  isOwner,
  controls,
  globalRails,
  busy,
  refusal,
  onToggleMaster,
  onToggleMedia,
  onSaveBudget,
}: {
  isOwner: boolean;
  controls: ControlsResult | undefined;
  globalRails: GlobalRailsResult | undefined;
  busy: boolean;
  refusal: string | null;
  onToggleMaster: (on: boolean) => void;
  onToggleMedia: (on: boolean) => void;
  onSaveBudget: (usd: number) => void;
}) {
  if (!isOwner) {
    return (
      <section style={stack} aria-labelledby="deployment-heading">
        <h2 id="deployment-heading" style={cardTitle}>
          Deployment controls
        </h2>
        <p style={muted}>
          Deployment-wide budget ceilings and kill switches are managed by the operator. Your own
          budget rails are above.
        </p>
      </section>
    );
  }
  return (
    <section style={stack} aria-labelledby="deployment-heading">
      <h2 id="deployment-heading" style={cardTitle}>
        Deployment controls
      </h2>
      <p style={muted}>
        These are shared across every tenant, not just yours. Each is a separate budget with its own
        ceiling — there is no single combined limit.
      </p>
      {refusal ? <FinanceStateNotice state="refusal">{refusal}</FinanceStateNotice> : null}
      {globalRails === undefined ? (
        <FinanceStateNotice state="loading" />
      ) : (
        <section className="stat-grid" aria-label="Deployment ceilings">
          {globalRails.rails.map((rail) => (
            <RailTile key={rail.rail} rail={rail} />
          ))}
        </section>
      )}
      {controls === undefined ? (
        <FinanceStateNotice state="loading" />
      ) : (
        <div style={stack}>
          <ControlRow
            label="Master kill switch"
            description="Stops every model call for every tenant, including the email cockpit and vault ingest."
            state={
              controls.masterKillSwitch.on
                ? "On — all model calls are paused."
                : "Off — model calls permitted within budget."
            }
            actionLabel={controls.masterKillSwitch.on ? "Turn off" : "Turn on"}
            requiresConfirmation={controls.masterKillSwitch.requiresConfirmation}
            busy={busy}
            onConfirm={() => onToggleMaster(!controls.masterKillSwitch.on)}
          />
          <ControlRow
            label="Media kill switch"
            description="Stops paid generation for every tenant. Pausing this does not pause the email cockpit."
            state={
              controls.mediaKillSwitch.on
                ? "On — paid generation is paused."
                : "Off — paid generation permitted."
            }
            actionLabel={controls.mediaKillSwitch.on ? "Turn off" : "Turn on"}
            requiresConfirmation={controls.mediaKillSwitch.requiresConfirmation}
            busy={busy}
            onConfirm={() => onToggleMedia(!controls.mediaKillSwitch.on)}
          />
          <BudgetControl controls={controls} busy={busy} onSave={onSaveBudget} />
        </div>
      )}
    </section>
  );
}

/** The per-request ceiling. Range comes from the backend, so the input cannot offer an invalid one. */
export function BudgetControl({
  controls,
  busy,
  onSave,
}: {
  controls: ControlsResult;
  busy: boolean;
  onSave: (usd: number) => void;
}) {
  const [draft, setDraft] = useState(String(controls.budgetUsdPerRequest.usd));
  const [armed, setArmed] = useState(false);
  const parsed = Number(draft);
  const valid =
    Number.isFinite(parsed) &&
    parsed >= controls.budgetUsdPerRequest.minUsd &&
    parsed <= controls.budgetUsdPerRequest.maxUsd;
  return (
    <div style={{ ...card, ...row }} data-control="Per-request budget">
      <div style={{ flex: "1 1 16rem" }}>
        <p style={caps}>Per-request budget ceiling</p>
        <p style={{ ...muted, fontSize: "0.85rem" }}>
          A single request may never cost more than this, whatever model is chosen. Applies to every
          tenant.
        </p>
        <p style={{ margin: "0.35rem 0 0", fontWeight: 700 }}>
          Now {formatUsd(controls.budgetUsdPerRequest.usd)} · allowed{" "}
          {formatUsd(controls.budgetUsdPerRequest.minUsd)} to{" "}
          {formatUsd(controls.budgetUsdPerRequest.maxUsd)}
        </p>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="budget-usd" style={caps}>
          USD
        </label>
        <input
          id="budget-usd"
          type="number"
          inputMode="decimal"
          step="0.001"
          min={controls.budgetUsdPerRequest.minUsd}
          max={controls.budgetUsdPerRequest.maxUsd}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setArmed(false);
          }}
          style={{
            width: "7rem",
            minHeight: "2.5rem",
            padding: "0.45rem 0.7rem",
            border: "1px solid var(--rule)",
            borderRadius: "0.5rem",
            font: "inherit",
          }}
        />
        {armed ? (
          <button
            type="button"
            style={primary}
            disabled={busy || !valid}
            onClick={() => {
              setArmed(false);
              onSave(parsed);
            }}
          >
            {busy ? "Applying…" : "Confirm — save ceiling"}
          </button>
        ) : (
          <button type="button" style={button} disabled={!valid} onClick={() => setArmed(true)}>
            Save
          </button>
        )}
      </div>
      {valid ? null : (
        <p role="alert" style={{ ...muted, width: "100%", fontSize: "0.82rem" }}>
          Enter an amount between {formatUsd(controls.budgetUsdPerRequest.minUsd)} and{" "}
          {formatUsd(controls.budgetUsdPerRequest.maxUsd)}.
        </p>
      )}
    </div>
  );
}

// ── connected sections ────────────────────────────────────────────────────────────────

type ReportWindow = {
  window: { sinceMs: number; untilMs: number; browserTimeZone: string };
  /** Non-null when the window was shortened to the coverage start — the page MUST announce it. */
  clampedTo: number | null;
  ready: boolean;
};

/**
 * The reported window, shortened to where instrumentation begins.
 *
 * `finance.coverage` is read FIRST so the window can be sized before any total is requested. The
 * alternative — ask for 30 days, learn the period predates coverage, and blank every figure — is
 * what the 26-10 UAT found on a real tenant: "Unknown" above a table showing $1.52 on a covered
 * day. One uncovered day must not suppress the days we did observe.
 *
 * Two cases are deliberately NOT clamped. A tenant with no coverage row keeps the full Unknown
 * state, because there is genuinely nothing to show. And a coverage start at or after `untilMs`
 * leaves the window alone rather than inverting it — `resolveDashboardWindow` would throw, and a
 * crash is a worse answer than Unknown.
 */
function useReportWindow(): ReportWindow {
  // Frozen once per mount: a window that slides on every render would make each subscription a new
  // query and the totals would flicker against a moving boundary.
  const base = useMemo(() => {
    const untilMs = Date.now();
    return {
      sinceMs: untilMs - WINDOW_DAYS * DAY_MS,
      untilMs,
      browserTimeZone: browserTimeZone(),
    };
  }, []);
  const coverage = useQuery(api.finance.coverage, {});
  if (coverage === undefined) return { window: base, clampedTo: null, ready: false };
  const startedAt = coverage.coverageStartedAt;
  const clamp = startedAt !== null && startedAt > base.sinceMs && startedAt < base.untilMs;
  return {
    window: clamp ? { ...base, sinceMs: startedAt as number } : base,
    clampedTo: clamp ? (startedAt as number) : null,
    ready: true,
  };
}

function RailsSection({ report }: { report: ReportWindow }) {
  // The rails are limiter state and do not depend on the window, but `summary` carries both — so
  // this waits for the resolved window rather than firing a second subscription on a throwaway one.
  const summary = useQuery(api.finance.summary, report.ready ? report.window : "skip");
  return (
    <section style={stack} aria-labelledby="rails-heading">
      <h2 id="rails-heading" style={cardTitle}>
        Your budget rails — live
      </h2>
      <p style={muted}>
        What is left of each of your three daily budgets right now. These are enforcement figures
        from the limiter, not history: they answer whether the next call will be allowed.
      </p>
      {summary === undefined ? (
        <FinanceStateNotice state="loading" />
      ) : (
        <section className="stat-grid" aria-label="Budget rails">
          {summary.rails.map((rail) => (
            <RailTile key={rail.rail} rail={rail} />
          ))}
        </section>
      )}
    </section>
  );
}

function TrackedSection({ report }: { report: ReportWindow }) {
  const args = report.ready ? report.window : "skip";
  const summary = useQuery(api.finance.summary, args);
  const series = useQuery(api.finance.spendSeries, args);
  return (
    <section style={stack} aria-labelledby="tracked-heading">
      <h2 id="tracked-heading" style={cardTitle}>
        Where it went — last {WINDOW_DAYS} days
      </h2>
      <p style={muted}>
        Recorded history from the spend ledger. This is a different plane from the rails above: it
        says what happened, not what is allowed next.
      </p>
      {report.clampedTo === null ? null : <CoverageClampNotice startedAt={report.clampedTo} />}
      <div style={card}>
        {summary === undefined ? (
          <FinanceStateNotice state="loading" />
        ) : (
          <TrackedTotals
            tracked={summary.tracked}
            coverageStartedAt={summary.coverageStartedAt}
            unlandedResolves={summary.unlandedResolves}
            partial={summary.bound.partial}
          />
        )}
      </div>
      <div style={card}>
        {series === undefined ? (
          <FinanceStateNotice state="loading" />
        ) : series.buckets.length === 0 ? (
          <FinanceStateNotice state="empty" />
        ) : (
          <SpendSeriesTable buckets={series.buckets} />
        )}
      </div>
    </section>
  );
}

function LedgerSection({ report }: { report: ReportWindow }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useQuery(
    api.finance.mediaLedger,
    report.ready
      ? {
          sinceMs: report.window.sinceMs,
          untilMs: report.window.untilMs,
          paginationOpts: { numItems: LEDGER_PAGE_SIZE, cursor },
        }
      : "skip",
  );
  return (
    <section style={stack} aria-labelledby="ledger-heading">
      <h2 id="ledger-heading" style={cardTitle}>
        Media job ledger
      </h2>
      <div style={card}>
        {page === undefined ? (
          <FinanceStateNotice state="loading" />
        ) : page.items.length === 0 ? (
          <FinanceStateNotice state="empty">No media movements in this period.</FinanceStateNotice>
        ) : (
          <>
            <MediaLedgerTable items={page.items} />
            <p style={{ ...muted, fontSize: "0.82rem", marginTop: "0.6rem" }}>
              {unlandedCopy(page.unlandedResolves)}
            </p>
          </>
        )}
        {page?.bound.partial ? (
          <div style={{ ...row, marginTop: "0.75rem" }}>
            <FinanceStateNotice state="partial">
              More movements exist beyond this bounded page.
            </FinanceStateNotice>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" style={button} onClick={() => setCursor(null)}>
                First page
              </button>
              <button
                type="button"
                style={button}
                onClick={() => setCursor(page.nextCursor)}
                disabled={page.nextCursor === null}
              >
                Next page
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ConnectedDeployment() {
  const viewer = useQuery(api.owner.viewer, {});
  const isOwner = viewer?.isOwner === true;
  // `"skip"` matters here: an owner query fired by a non-owner throws OWNER_REQUIRED and would put
  // the whole page into the error boundary for a caller who is simply not the owner.
  const controls = useQuery(api.finance.controls, isOwner ? {} : "skip");
  const globalRails = useQuery(api.finance.globalRails, isOwner ? {} : "skip");
  const setMaster = useMutation(api.finance.setMasterKillSwitch);
  const setMedia = useMutation(api.finance.setMediaKillSwitch);
  const setBudget = useMutation(api.finance.setPerRequestBudget);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setRefusal(null);
    try {
      await action();
    } catch (error) {
      // A refusal is an expected answer, not a crash — it must not reach the error boundary.
      setRefusal(
        /OWNER_REQUIRED/.test(String(error))
          ? "That control is owner-only. Nothing changed."
          : "That change was refused. Nothing changed.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (viewer === undefined) return <FinanceStateNotice state="loading" />;
  return (
    <DeploymentSection
      isOwner={isOwner}
      controls={controls ?? undefined}
      globalRails={globalRails ?? undefined}
      busy={busy}
      refusal={refusal}
      onToggleMaster={(on) => void run(() => setMaster({ on }))}
      onToggleMedia={(on) => void run(() => setMedia({ on }))}
      onSaveBudget={(budgetUsd) => void run(() => setBudget({ budgetUsd }))}
    />
  );
}

function ConnectedFinance() {
  const report = useReportWindow();
  return (
    <div style={{ display: "grid", gap: "1.75rem", padding: "1.5rem 0" }}>
      <header style={stack}>
        <p style={caps}>Spend control · USD</p>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            fontSize: "clamp(1.9rem, 1.4rem + 1.8vw, 2.6rem)",
          }}
        >
          Know what it costs
        </h1>
        <p style={muted}>
          Everything Pikar can spend runs through three hard budget rails. This page reads cost only
          — it has no revenue, invoice or cash data, and it never estimates any.
        </p>
      </header>
      <RailsSection report={report} />
      <TrackedSection report={report} />
      <LedgerSection report={report} />
      <ConnectedDeployment />
    </div>
  );
}

class FinanceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Finance view failed", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ ...stack, padding: "1.5rem 0" }}>
        <FinanceStateNotice state="error" />
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" style={primary} onClick={() => window.location.reload()}>
            Retry
          </button>
          <Link href="/dashboard/workspace" style={button}>
            Back to workspace
          </Link>
        </div>
      </div>
    );
  }
}

export function FinanceView() {
  return (
    <FinanceErrorBoundary>
      <ConnectedFinance />
    </FinanceErrorBoundary>
  );
}
