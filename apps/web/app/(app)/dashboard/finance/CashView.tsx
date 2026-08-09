"use client";

// The Business tab — the tenant's OWN money. Ordered by the capital-posture switch:
// headline → unit economics → solvency → activity → your numbers.
//
// Every figure on this tab is a `CashFigure` from `@pikar/core` — this file renders, it never
// derives. A derived figure is suppressed whenever any input is unknown, and names the missing one.
import { api } from "@pikar/backend/api";
import type {
  CashActivity,
  CashFigure,
  CashInputField,
  CashInputSpec,
  CashInputState,
  Tier,
} from "@pikar/core";
import { cashInputsForTier, validateCashInput } from "@pikar/core";
import { useMutation, useQuery } from "convex/react";
import { type CSSProperties, useMemo, useState } from "react";
import { formatUtcDay } from "./FinanceView";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

const stack: CSSProperties = { display: "grid", gap: "0.75rem" };
const muted: CSSProperties = { color: "var(--ink-soft)", margin: 0, lineHeight: 1.55 };
const cardTitle: CSSProperties = {
  margin: 0,
  fontSize: "1.05rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--ink)",
};
const caps: CSSProperties = {
  color: "var(--ink-soft)",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  margin: 0,
};
const numbersRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.65rem",
  flexWrap: "wrap",
  padding: "0.75rem 0",
  borderBottom: "1px solid var(--rule)",
};
const numbersInput: CSSProperties = {
  width: "9rem",
  minHeight: "2.5rem",
  padding: "0.45rem 0.7rem",
  border: "1px solid var(--rule)",
  borderRadius: "0.5rem",
  font: "inherit",
};
const saveButton: CSSProperties = {
  minHeight: "2.5rem",
  borderRadius: "999px",
  padding: "0.5rem 1.1rem",
  border: "1px solid var(--teal-600)",
  background: "var(--teal-600)",
  color: "var(--card)",
  font: "inherit",
  fontSize: "0.86rem",
  fontWeight: 600,
  cursor: "pointer",
};

/**
 * The business plane's formatter. USD DOLLARS — never hand it cents. `formatUsdCents` in
 * FinanceView.tsx is the other plane's formatter and the two must never be swapped.
 */
export function formatUsdAmount(dollars: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(dollars);
}

function formatFigureValue(value: number, unit: string): string {
  if (unit === "usd") return formatUsdAmount(value);
  if (unit === "ratio") return `${value}:1`;
  if (unit === "months") return `${value} ${value === 1 ? "month" : "months"}`;
  if (unit === "percent") return `${value}%`;
  return String(value);
}

const shortDay = (epochMs: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(epochMs),
  );

/**
 * ONE figure, in whichever of the four truths it is in. FOUR BRANCHES, and collapsing any two of
 * them is the failure this component exists to prevent:
 *
 *   • unknown        — the prompt, and NO number. Not even a zero: a zero here is indistinguishable
 *                      from a measured nothing, which is the whole reason the state exists.
 *   • not-applicable — the reason. Never the word "Unknown", never "$0". "MRR $0" shown to a
 *                      project-based consultant describes a failing subscription business that
 *                      does not exist.
 *   • not-computable — the reason. A real input made the arithmetic undefined; "needs your CAC" is
 *                      a lie to someone who told us it was zero.
 *   • known          — the number, including a real measured zero, plus its provenance.
 *
 * A DERIVED figure always shows what it came from, and a ratio always shows its sample size —
 * including when that sample size is not recorded, which it says rather than quietly omitting.
 * Hiding a number the reader could judge for themselves is its own dishonesty.
 */
export function FigureTile({
  label,
  figure,
  note,
}: {
  label: string;
  figure: CashFigure;
  note?: string;
}) {
  const body = (() => {
    if (figure.state === "unknown") {
      return (
        <>
          <div className="stat-value" style={{ color: "var(--ink-soft)" }}>
            —
          </div>
          <p style={{ ...muted, fontSize: "0.8rem" }}>{figure.needs}</p>
        </>
      );
    }
    if (figure.state === "not-applicable" || figure.state === "not-computable") {
      return (
        <>
          <div className="stat-value" style={{ color: "var(--ink-soft)" }}>
            —
          </div>
          <p style={{ ...muted, fontSize: "0.8rem" }}>{figure.because}</p>
        </>
      );
    }
    return (
      <>
        <div className="stat-value">{formatFigureValue(figure.value, figure.unit)}</div>
        {figure.origin === "derived" && figure.from ? (
          <p style={{ ...muted, fontSize: "0.8rem" }}>
            from {figure.from}
            {figure.unit === "ratio" || figure.sampleSize !== undefined
              ? figure.sampleSize === null || figure.sampleSize === undefined
                ? " · sample size not recorded"
                : ` · from ${figure.sampleSize} ${figure.sampleSize === 1 ? "customer" : "customers"}`
              : null}
          </p>
        ) : null}
        {figure.origin === "stated" ? (
          <p style={{ ...muted, fontSize: "0.8rem" }}>
            {figure.statedAt === undefined
              ? "You told us this."
              : `You told us this on ${shortDay(figure.statedAt)}.`}
            {figure.stale ? " Is this still right?" : ""}
          </p>
        ) : null}
        {figure.origin === "observed" ? (
          <p style={{ ...muted, fontSize: "0.8rem" }}>Measured by Pikar.</p>
        ) : null}
      </>
    );
  })();

  return (
    <div className="stat-tile" data-figure-state={figure.state} data-figure={label}>
      <div className="stat-head">
        <p className="caps-label">{label}</p>
      </div>
      {body}
      {note ? <p style={{ ...muted, fontSize: "0.78rem" }}>{note}</p> : null}
    </div>
  );
}

const UNIT_ECONOMICS_LABELS: Record<string, string> = {
  cfa: "Does a customer pay for itself in 30 days?",
  ltgp: "Lifetime gross profit",
  ltgpCac: "LTGP:CAC",
  cacPayback: "CAC payback",
  cacVsIndustry: "CAC vs industry average",
  grossMargin: "Gross margin",
  cohortChurn: "Monthly churn",
  referralPct: "Referral share",
};

/**
 * The Hormozi spine. `keys` comes from the tenant's tier set, so a solopreneur is never shown the
 * ratio stack the source material says is unreadable at their sample size.
 */
export function UnitEconomicsSection({
  economics,
  keys,
}: {
  economics: Record<string, CashFigure>;
  keys: readonly string[];
}) {
  if (keys.length === 0) return null;
  return (
    <section style={stack} aria-labelledby="cash-unit-heading">
      <h2 id="cash-unit-heading" style={cardTitle}>
        Does each customer pay for itself?
      </h2>
      <section className="stat-grid" aria-label="Unit economics">
        {keys.map((key) => {
          const figure = economics[key];
          if (!figure) return null;
          return (
            <FigureTile key={key} label={UNIT_ECONOMICS_LABELS[key] ?? key} figure={figure} />
          );
        })}
      </section>
    </section>
  );
}

export function CashStateNotice({
  state,
  children,
}: {
  state: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-cash-state={state}
      style={{
        border: "1px dashed var(--rule)",
        borderRadius: "0.75rem",
        padding: "0.85rem 1rem",
        color: "var(--ink-soft)",
        background: "color-mix(in srgb, var(--card) 70%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Reach-outs, posts and the streak.
 *
 * This is the most important row on the page for the smallest user, and the one the source material
 * most directly supports: at the earliest levels the readable signals are INPUTS, not rates — rates
 * at small samples are explicitly unreadable. It is also the only row that needs no data entry.
 *
 * ponytail: "posts per day" has no source yet — Pikar delivers email, not social posts. It renders
 * as an explicit "not tracked yet" rather than as a zero. Upgrade path: a social rail feeds the same
 * shape.
 */
export function ActivitySection({
  activity,
  partial,
}: {
  activity: CashActivity;
  partial: boolean;
}) {
  return (
    <section style={stack} aria-labelledby="cash-activity-heading">
      <h2 id="cash-activity-heading" style={cardTitle}>
        What you did — measured, not asked
      </h2>
      <p style={muted}>
        Counted from what Pikar actually delivered. Nothing here needs you to enter a number.
      </p>
      {partial ? (
        <CashStateNotice state="partial">
          More sends exist than this bounded read counts. These counts are a floor, not the period's
          activity.
        </CashStateNotice>
      ) : null}
      <section className="stat-grid" aria-label="Activity">
        <div className="stat-tile">
          <div className="stat-head">
            <p className="caps-label">Reach-outs today</p>
          </div>
          <div className="stat-value">{activity.todayCount}</div>
          <p style={{ ...muted, fontSize: "0.8rem" }}>{activity.last7Count} in the last 7 days</p>
        </div>
        <div className="stat-tile">
          <div className="stat-head">
            <p className="caps-label">Streak</p>
          </div>
          <div className="stat-value">{activity.streakDays}</div>
          <p style={{ ...muted, fontSize: "0.8rem" }}>
            {activity.streakDays}-day streak · consecutive days you sent something, ending today
          </p>
        </div>
        <div className="stat-tile">
          <div className="stat-head">
            <p className="caps-label">Posts per day</p>
          </div>
          <div className="stat-value">—</div>
          <p style={{ ...muted, fontSize: "0.8rem" }}>
            Not tracked yet — Pikar delivers email, not posts.
          </p>
        </div>
      </section>
    </section>
  );
}

/**
 * One row: a real `<label>`, a number input seeded from the stored value, a Save button and a
 * provenance line — `Unlocks <what>` when never answered, `Last confirmed <date>` otherwise, with a
 * confirm-or-update prompt appended once the input goes stale (CLAUDE.md §10: `--ink-soft` and an
 * explicit word, never the approval-gate amber).
 *
 * Validated on change with the SAME `validateCashInput` the mutation enforces — this is convenience,
 * not the trust boundary, which is why Save disables on an invalid draft rather than merely warning.
 */
function InputRow({
  spec,
  state,
  busy,
  onSave,
}: {
  spec: CashInputSpec;
  state: CashInputState;
  busy: boolean;
  onSave: (field: CashInputField, value: number) => void;
}) {
  const [draft, setDraft] = useState(state.value === null ? "" : String(state.value));
  const hasDraft = draft.trim() !== "";
  const parsed = Number(draft);
  const check = hasDraft ? validateCashInput(spec.field, parsed) : null;
  const inputId = `cash-input-${spec.field}`;

  return (
    <div style={numbersRow} data-cash-field={spec.field}>
      <label htmlFor={inputId} style={{ ...caps, flex: "1 1 12rem" }}>
        {spec.label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        style={numbersInput}
      />
      <button
        type="button"
        aria-label={`Save ${spec.label}`}
        style={saveButton}
        disabled={busy || check?.ok !== true}
        onClick={() => onSave(spec.field, parsed)}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <p style={{ ...muted, fontSize: "0.8rem", width: "100%", margin: 0 }}>
        {state.value === null
          ? `Unlocks ${spec.unlocks}.`
          : state.statedAt === null
            ? // A legacy value with no recorded date (it predates confirm-or-update tracking).
              // Unknown age is never rendered as fresh — honest about not knowing, not silent.
              "No confirmation date on file. Still right? Confirm or update it."
            : state.stale
              ? `Last confirmed ${formatUtcDay(state.statedAt)}. Still right? Confirm or update it.`
              : `Last confirmed ${formatUtcDay(state.statedAt)}.`}
      </p>
      {check && !check.ok ? (
        <p role="alert" style={{ ...muted, fontSize: "0.8rem", width: "100%", margin: 0 }}>
          {check.reason}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The collection surface. Rows are `cashInputsForTier(tier)` INTERSECTED with `inputs` — the tier
 * decides which fields are asked at all, and a field with no matching entry in `inputs` is skipped
 * rather than invented. No arithmetic here beyond formatting (CLAUDE.md §1).
 */
export function NumbersPanel({
  inputs,
  tier,
  busy,
  error,
  onSave,
}: {
  inputs: CashInputState[];
  tier: Tier;
  busy: boolean;
  error: string | null;
  onSave: (field: CashInputField, value: number) => void;
}) {
  const byField = new Map(inputs.map((state) => [state.field, state]));
  const specs = cashInputsForTier(tier).filter((spec) => byField.has(spec.field));
  return (
    <section style={stack} aria-labelledby="cash-numbers-heading">
      <h2 id="cash-numbers-heading" style={cardTitle}>
        Your numbers
      </h2>
      <p style={muted}>What you tell us. Confirmed inputs unlock the ratios above.</p>
      {error ? (
        <p role="alert" style={{ ...muted, color: "var(--ink)" }}>
          {error}
        </p>
      ) : null}
      <div>
        {specs.map((spec) => {
          const state = byField.get(spec.field);
          return state ? (
            <InputRow key={spec.field} spec={spec} state={state} busy={busy} onSave={onSave} />
          ) : null;
        })}
      </div>
    </section>
  );
}

function ConnectedNumbers() {
  const inputsResult = useQuery(api.cash.inputs, {});
  const tierRow = useQuery(api.tenantProfile.get);
  const saveInput = useMutation(api.cash.saveInput);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (inputsResult === undefined) {
    return <CashStateNotice state="loading">Loading your numbers…</CashStateNotice>;
  }
  const tier: Tier = tierRow?.tier ?? "solopreneur";

  const save = async (field: CashInputField, value: number) => {
    setBusy(true);
    setError(null);
    try {
      await saveInput({ field, value });
    } catch {
      // A refusal is an expected answer, not a crash — the mutation is the trust boundary and this
      // is only the busy/refusal presentation (the OperatorTab `run` precedent).
      setError("That number could not be saved. Nothing changed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <NumbersPanel
      inputs={inputsResult.inputs}
      tier={tier}
      busy={busy}
      error={error}
      onSave={(field, value) => void save(field, value)}
    />
  );
}

function ConnectedActivity() {
  // Frozen once per mount: a sliding window would make every render a new subscription.
  const window = useMemo(() => {
    const untilMs = Date.now();
    return { sinceMs: untilMs - WINDOW_DAYS * DAY_MS, untilMs };
  }, []);
  const result = useQuery(api.cash.activity, window);
  if (result === undefined)
    return <CashStateNotice state="loading">Loading activity…</CashStateNotice>;
  return <ActivitySection activity={result.activity} partial={result.bound.partial} />;
}

function ConnectedUnitEconomics() {
  const economics = useQuery(api.cash.unitEconomics, {});
  if (economics === undefined)
    return <CashStateNotice state="loading">Loading unit economics…</CashStateNotice>;
  // ponytail: Task 8 supplies the per-tier metric set; until then every figure the query returns
  // is shown. `Object.keys` is safe here — `CashUnitEconomics` is a plain, fully-populated record.
  return <UnitEconomicsSection economics={economics} keys={Object.keys(economics)} />;
}

export function CashTab() {
  return (
    <div style={{ display: "grid", gap: "1.75rem" }}>
      <ConnectedActivity />
      <ConnectedUnitEconomics />
      <ConnectedNumbers />
    </div>
  );
}
