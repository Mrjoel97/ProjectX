"use client";

// The Business tab — the tenant's OWN money. Ordered by the capital-posture switch:
// headline → unit economics → solvency → activity → your numbers.
//
// Every figure on this tab is a `CashFigure` from `@pikar/core` — this file renders, it never
// derives. A derived figure is suppressed whenever any input is unknown, and names the missing one.
import { api } from "@pikar/backend/api";
import type { CashActivity } from "@pikar/core";
import { useQuery } from "convex/react";
import { type CSSProperties, useMemo } from "react";

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
    </div>
  );
}
