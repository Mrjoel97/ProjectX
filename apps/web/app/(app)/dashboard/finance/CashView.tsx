"use client";

// The Business tab — the tenant's OWN money. Ordered by the capital-posture switch:
// headline → unit economics → solvency → activity → your numbers.
//
// Every figure on this tab is a `CashFigure` from `@pikar/core` — this file renders, it never
// derives. A derived figure is suppressed whenever any input is unknown, and names the missing one.
import { api } from "@pikar/backend/api";
import type { CashActivity, CashInputField, CashInputSpec, CashInputState, Tier } from "@pikar/core";
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
          : state.stale
            ? `Last confirmed ${formatUtcDay(state.statedAt as number)}. Still right? Confirm or update it.`
            : `Last confirmed ${formatUtcDay(state.statedAt as number)}.`}
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

export function CashTab() {
  return (
    <div style={{ display: "grid", gap: "1.75rem" }}>
      <ConnectedActivity />
      <ConnectedNumbers />
    </div>
  );
}
